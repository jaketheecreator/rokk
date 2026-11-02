// Where the meter may read: only regular `*.jsonl` files inside
// ~/.claude/projects, checked after resolving symlinks. Read-only.

use std::path::{Component, Path, PathBuf};

/// Session files larger than this are refused.
pub const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;

/// ~/.claude/projects, resolved.
pub fn projects_root(home: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(home.join(".claude").join("projects")).ok()
}

/// Claude Code's folder name for a working directory: every character that
/// is not an ASCII letter or digit becomes `-`.
pub fn folder_name(project_dir: &str) -> String {
    project_dir
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Session ids are UUIDs; anything else is never used to build a path.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.ends_with(".jsonl")
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// The project's folder inside the root, matched case-insensitively (macOS
/// folders are case-insensitive, so `Playbook` and `playbook` are one).
pub fn project_folder(root: &Path, project_dir: &str) -> Option<PathBuf> {
    let want = folder_name(project_dir.trim_end_matches('/'));
    if want.is_empty() || want.len() > 255 {
        return None;
    }
    let entry = std::fs::read_dir(root).ok()?.flatten().find(|e| {
        e.file_name().to_str().is_some_and(|n| n.eq_ignore_ascii_case(&want))
    })?;
    let dir = std::fs::canonicalize(entry.path()).ok()?;
    (dir.starts_with(root) && dir != root && dir.is_dir()).then_some(dir)
}

/// The resolved path when `path` is a regular `*.jsonl` file inside `root`
/// of at most 200 MB; otherwise a plain-language refusal.
pub fn allowed_file(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let refuse = |why: &str| Err(format!("Rokk will not read this file: {why}."));
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return refuse("its path contains '..'");
    }
    let is_jsonl = |p: &Path| p.extension().is_some_and(|e| e == "jsonl");
    if !is_jsonl(path) {
        return refuse("it is not a .jsonl file");
    }
    let Ok(real) = std::fs::canonicalize(path) else {
        return refuse("it does not exist");
    };
    if !real.starts_with(root) {
        return refuse("it is outside ~/.claude/projects");
    }
    if !is_jsonl(&real) {
        return refuse("it points to a file that is not .jsonl");
    }
    match std::fs::metadata(&real) {
        Ok(m) if !m.is_file() => refuse("it is not a regular file"),
        Ok(m) if m.len() > MAX_FILE_BYTES => refuse("it is larger than 200 MB"),
        Ok(_) => Ok(real),
        Err(_) => refuse("it cannot be read"),
    }
}

/// The main session file for an id inside a project folder.
pub fn session_file(root: &Path, folder: &Path, session_id: &str) -> Result<PathBuf, String> {
    if !valid_id(session_id) {
        return Err("Rokk will not read this file: the session id is not valid.".into());
    }
    allowed_file(root, &folder.join(format!("{session_id}.jsonl")))
}

/// Sub-agent transcripts of a session: `<folder>/<id>/subagents/*.jsonl`.
pub fn subagent_files(root: &Path, folder: &Path, session_id: &str) -> Vec<PathBuf> {
    if !valid_id(session_id) {
        return Vec::new();
    }
    let dir = folder.join(session_id).join("subagents");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_name().to_str().is_some_and(valid_file_name))
        .filter_map(|e| allowed_file(root, &e.path()).ok())
        .collect();
    out.sort();
    out
}

/// A session file in a project folder, with its id and modified time.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub id: String,
    pub modified_ms: u64,
}

pub fn candidates(root: &Path, folder: &Path) -> Vec<Candidate> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            let id = name.strip_suffix(".jsonl")?;
            if !valid_id(id) {
                return None;
            }
            let real = allowed_file(root, &e.path()).ok()?;
            let modified = std::fs::metadata(real).ok()?.modified().ok()?;
            let modified_ms = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(Candidate { id: id.to_string(), modified_ms })
        })
        .collect()
}

/// The newest session modified at or after `since_ms`, and whether another
/// one was also active within the same minute.
pub fn best_match(mut list: Vec<Candidate>, since_ms: u64) -> Option<(Candidate, bool)> {
    list.retain(|c| c.modified_ms >= since_ms);
    list.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.id.cmp(&b.id)));
    let first = list.first()?.clone();
    let ambiguous = list.iter().skip(1).any(|c| first.modified_ms - c.modified_ms < 60_000);
    Some((first, ambiguous))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let home = tempfile::tempdir().unwrap();
        let projects = home.path().join(".claude").join("projects");
        let folder = projects.join("-Users-me-code-app");
        std::fs::create_dir_all(&folder).unwrap();
        let root = projects_root(home.path()).unwrap();
        let folder = std::fs::canonicalize(folder).unwrap();
        (home, root, folder)
    }

    #[test]
    fn folder_names_follow_claude_codes_scheme() {
        assert_eq!(folder_name("/Users/me/My portfolio"), "-Users-me-My-portfolio");
        assert_eq!(folder_name("/Users/me/Gist_site.v2"), "-Users-me-Gist-site-v2");
    }

    #[test]
    fn finds_the_project_folder_case_insensitively() {
        let (_h, root, folder) = tree();
        assert_eq!(project_folder(&root, "/Users/me/code/App").as_deref(), Some(folder.as_path()));
        assert_eq!(project_folder(&root, "/Users/me/code/app/").as_deref(), Some(folder.as_path()));
        assert!(project_folder(&root, "/Users/me/other").is_none());
    }

    #[test]
    fn allows_only_regular_jsonl_files_inside_the_tree() {
        let (home, root, folder) = tree();
        let ok = folder.join("abc-123.jsonl");
        std::fs::write(&ok, "{}\n").unwrap();
        assert!(allowed_file(&root, &ok).is_ok());

        // Not .jsonl.
        let txt = folder.join("notes.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(allowed_file(&root, &txt).is_err());
        // A directory named like a session file.
        let dir = folder.join("dir.jsonl");
        std::fs::create_dir(&dir).unwrap();
        assert!(allowed_file(&root, &dir).unwrap_err().contains("not a regular file"));
        // Outside the tree.
        let outside = home.path().join("outside.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();
        assert!(allowed_file(&root, &outside).unwrap_err().contains("outside"));
        // `..` tricks, even when they land back inside.
        let dotdot = folder.join("..").join("-Users-me-code-app").join("abc-123.jsonl");
        assert!(allowed_file(&root, &dotdot).unwrap_err().contains(".."));
        // Missing.
        assert!(allowed_file(&root, &folder.join("missing.jsonl")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_leave_the_tree() {
        use std::os::unix::fs::symlink;
        let (home, root, folder) = tree();
        let outside = home.path().join("secret.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();
        let link = folder.join("link.jsonl");
        symlink(&outside, &link).unwrap();
        assert!(allowed_file(&root, &link).unwrap_err().contains("outside"));
        // A symlink inside the tree to a non-jsonl file.
        let inner = folder.join("inner.txt");
        std::fs::write(&inner, "x").unwrap();
        let link2 = folder.join("link2.jsonl");
        symlink(&inner, &link2).unwrap();
        assert!(allowed_file(&root, &link2).is_err());
        // A symlinked folder inside the tree pointing out.
        let out_dir = home.path().join("elsewhere");
        std::fs::create_dir(&out_dir).unwrap();
        std::fs::write(out_dir.join("s.jsonl"), "{}\n").unwrap();
        symlink(&out_dir, folder.join("sub")).unwrap();
        assert!(allowed_file(&root, &folder.join("sub").join("s.jsonl")).is_err());
    }

    #[test]
    fn session_ids_cannot_build_other_paths() {
        let (_h, root, folder) = tree();
        for bad in ["../x", "a/b", "", "x.jsonl", "..", "a b"] {
            assert!(session_file(&root, &folder, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn picks_the_newest_since_start_and_flags_ambiguity() {
        let c = |id: &str, ms: u64| Candidate { id: id.into(), modified_ms: ms };
        let list = vec![c("old", 1_000), c("a", 500_000), c("b", 470_000)];
        let (best, ambiguous) = best_match(list.clone(), 400_000).unwrap();
        assert_eq!(best.id, "a");
        assert!(ambiguous);
        let (best, ambiguous) = best_match(list.clone(), 480_000).unwrap();
        assert_eq!(best.id, "a");
        assert!(!ambiguous);
        assert!(best_match(list, 600_000).is_none());
    }

    #[test]
    fn lists_only_valid_session_files() {
        let (_h, root, folder) = tree();
        std::fs::write(folder.join("1059605c-0fe2.jsonl"), "{}\n").unwrap();
        std::fs::write(folder.join("bad name.jsonl"), "{}\n").unwrap();
        std::fs::write(folder.join("x.txt"), "{}\n").unwrap();
        let ids: Vec<String> = candidates(&root, &folder).into_iter().map(|c| c.id).collect();
        assert_eq!(ids, vec!["1059605c-0fe2".to_string()]);
    }
}

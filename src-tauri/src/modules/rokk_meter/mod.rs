// Rokk credit meter: reads Claude Code's session files under
// ~/.claude/projects to show where the tokens went. Read-only; it returns
// numbers, times, ids, model names and tool names, never any text, and
// writes, logs and sends nothing. See docs/rokk/METER.md.

pub mod parse;
pub mod paths;
pub mod prices;

use parse::{Session, Snapshot};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Bytes read per call, across the session file and its sub-agent files.
pub const MAX_BYTES_PER_CALL: u64 = 5 * 1024 * 1024;
/// Sessions kept in memory at once.
const MAX_SESSIONS: usize = 8;

/// Read position in one file.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Cursor {
    offset: u64,
    /// Inside a line longer than one read; skip to its end.
    in_long_line: bool,
}

#[derive(Default)]
struct Reader {
    session: Session,
    main: Cursor,
    subagents: HashMap<PathBuf, Cursor>,
    used: u64,
}

fn readers() -> &'static Mutex<HashMap<String, Reader>> {
    static R: OnceLock<Mutex<HashMap<String, Reader>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

enum Outcome {
    Read,
    Truncated,
}

/// Reads complete lines from `cursor` on, at most `budget` bytes. A partial
/// last line is left for the next call; a file shorter than the cursor was
/// truncated.
fn read_lines(path: &Path, cursor: &mut Cursor, budget: &mut u64, mut on_line: impl FnMut(&[u8])) -> Result<Outcome, String> {
    let mut f = std::fs::File::open(path).map_err(|_| "Rokk could not open Claude's session file.".to_string())?;
    let len = f.metadata().map_err(|_| "Rokk could not read Claude's session file.".to_string())?.len();
    if len > paths::MAX_FILE_BYTES {
        return Err("Claude's session file is larger than 200 MB, so Rokk does not read it.".into());
    }
    if len < cursor.offset {
        return Ok(Outcome::Truncated);
    }
    let want = (len - cursor.offset).min(*budget);
    if want == 0 {
        return Ok(Outcome::Read);
    }
    f.seek(SeekFrom::Start(cursor.offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; want as usize];
    f.read_exact(&mut buf).map_err(|_| "Rokk could not read Claude's session file.".to_string())?;
    *budget -= want;

    let mut start = 0usize;
    if cursor.in_long_line {
        match buf.iter().position(|b| *b == b'\n') {
            Some(i) => {
                start = i + 1;
                cursor.in_long_line = false;
            }
            None => {
                cursor.offset += want;
                return Ok(Outcome::Read);
            }
        }
    }
    match buf[start..].iter().rposition(|b| *b == b'\n') {
        Some(rel) => {
            let end = start + rel;
            for line in buf[start..end].split(|b| *b == b'\n') {
                if !line.iter().all(u8::is_ascii_whitespace) {
                    on_line(line);
                }
            }
            cursor.offset += (end + 1) as u64;
        }
        None if want == MAX_BYTES_PER_CALL && start == 0 => {
            // One line longer than a whole read: skip it.
            cursor.offset += want;
            cursor.in_long_line = true;
        }
        None => cursor.offset += start as u64,
    }
    Ok(Outcome::Read)
}

/// One read step for a session; restarts from 0 on truncation or when the
/// caller's offset does not match what is in memory.
fn read_session(root: &Path, folder: &Path, session_id: &str, offset: u64) -> Result<Snapshot, String> {
    let main = paths::session_file(root, folder, session_id)?;
    let mut all = readers().lock().map_err(|_| "meter state is unavailable".to_string())?;
    let mut reset = false;
    if all.get(session_id).is_none_or(|r| r.main.offset != offset) {
        all.insert(session_id.to_string(), Reader::default());
        reset = offset != 0;
    }
    // Forget the least recently used sessions.
    let tick = all.values().map(|r| r.used).max().unwrap_or(0) + 1;
    if all.len() > MAX_SESSIONS {
        if let Some(old) = all.iter().filter(|(k, _)| k.as_str() != session_id).min_by_key(|(_, r)| r.used).map(|(k, _)| k.clone()) {
            all.remove(&old);
        }
    }
    let reader = all.get_mut(session_id).expect("inserted above");
    reader.used = tick;

    for attempt in 0..2 {
        let mut budget = MAX_BYTES_PER_CALL;
        let Reader { session, main: cursor, subagents, .. } = &mut *reader;
        let mut truncated = matches!(read_lines(&main, cursor, &mut budget, |l| session.feed(l))?, Outcome::Truncated);
        for sub in paths::subagent_files(root, folder, session_id) {
            if truncated || budget == 0 {
                break;
            }
            let c = subagents.entry(sub.clone()).or_default();
            truncated |= matches!(read_lines(&sub, c, &mut budget, |l| session.feed(l)), Ok(Outcome::Truncated));
        }
        if truncated && attempt == 0 {
            *reader = Reader { used: tick, ..Default::default() };
            reset = true;
            continue;
        }
        break;
    }

    let len = std::fs::metadata(&main).map(|m| m.len()).unwrap_or(0);
    let mut snap = reader.session.snapshot(session_id, prices::table());
    snap.offset = reader.main.offset;
    snap.reset = reset;
    snap.caught_up = reader.main.offset >= len;
    Ok(snap)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMatch {
    pub session_id: String,
    pub modified_ms: u64,
    pub ambiguous: bool,
}

fn find_at(home: &Path, project_dir: &str, since_ms: u64) -> Option<SessionMatch> {
    let root = paths::projects_root(home)?;
    let folder = paths::project_folder(&root, project_dir)?;
    let (best, ambiguous) = paths::best_match(paths::candidates(&root, &folder), since_ms)?;
    Some(SessionMatch { session_id: best.id, modified_ms: best.modified_ms, ambiguous })
}

fn read_at(home: &Path, project_dir: &str, session_id: &str, offset: u64) -> Result<Snapshot, String> {
    let root = paths::projects_root(home).ok_or("Claude's session folder (~/.claude/projects) was not found.")?;
    let folder = paths::project_folder(&root, project_dir).ok_or("No Claude sessions were found for this folder.")?;
    read_session(&root, &folder, session_id, offset)
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Rokk could not find your home folder.".to_string())
}

/// The session file that best matches a pane: newest modified at or after
/// `since_ms` in the project's folder. Returns an id, never a path.
#[tauri::command]
pub async fn meter_find_session(project_dir: String, since_ms: u64) -> Result<Option<SessionMatch>, String> {
    super::fs::blocking(move || Ok(find_at(&home()?, &project_dir, since_ms))).await
}

/// Reads new lines of a session from `offset` and returns its usage so far.
#[tauri::command]
pub async fn meter_read(session_id: String, project_dir: String, offset: u64) -> Result<Snapshot, String> {
    super::fs::blocking(move || read_at(&home()?, &project_dir, &session_id, offset)).await
}

#[cfg(test)]
mod tests {
    use super::parse::fixtures::*;
    use super::*;
    use std::io::Write;

    struct Tree {
        home: tempfile::TempDir,
        folder: PathBuf,
    }

    fn tree(id: &str) -> Tree {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join(".claude/projects/-Users-me-app");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(format!("{id}.jsonl")), "").unwrap();
        Tree { home, folder }
    }

    fn append(t: &Tree, id: &str, text: &str) {
        let mut f = std::fs::OpenOptions::new().append(true).open(t.folder.join(format!("{id}.jsonl"))).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    fn lines() -> Vec<String> {
        vec![
            prompt("2026-11-01T10:00:00.000Z"),
            reply_full("2026-11-01T10:00:01.000Z", "msg_1", 3, 8, 1000, 50, false, Some(("toolu_1", "Read"))),
            reply_full("2026-11-01T10:00:01.000Z", "msg_1", 3, 400, 1000, 50, false, Some(("toolu_1", "Read"))),
            tool_result("2026-11-01T10:00:02.000Z"),
            reply("2026-11-01T10:00:03.000Z", "msg_2", 2, 90, 1500, 20),
            prompt("2026-11-01T10:05:00.000Z"),
            reply("2026-11-01T10:05:01.000Z", "msg_3", 2, 30, 1600, 0),
        ]
    }

    #[test]
    fn incremental_reads_equal_one_full_read() {
        let full = tree("aaa-1");
        append(&full, "aaa-1", &(lines().join("\n") + "\n"));
        let one = read_at(full.home.path(), "/Users/me/app", "aaa-1", 0).unwrap();

        let inc = tree("bbb-2");
        let mut offset = 0;
        let mut last = None;
        for l in lines() {
            // Write each line in two halves; the first half is a partial line.
            let (a, b) = l.split_at(l.len() / 2);
            append(&inc, "bbb-2", a);
            let s = read_at(inc.home.path(), "/Users/me/app", "bbb-2", offset).unwrap();
            assert_eq!(s.offset, offset, "a partial line must not advance the offset");
            append(&inc, "bbb-2", &format!("{b}\n"));
            let s = read_at(inc.home.path(), "/Users/me/app", "bbb-2", offset).unwrap();
            offset = s.offset;
            last = Some(s);
        }
        let last = last.unwrap();
        assert_eq!(last.totals, one.totals);
        assert_eq!(last.prompts, one.prompts);
        assert_eq!(last.tools, one.tools);
        assert_eq!(last.context_tokens, one.context_tokens);
        assert_eq!(one.totals.output, 400 + 90 + 30);
        assert!(last.caught_up);
    }

    #[test]
    fn truncation_restarts_from_the_beginning() {
        let t = tree("ccc-3");
        append(&t, "ccc-3", &(lines().join("\n") + "\n"));
        let first = read_at(t.home.path(), "/Users/me/app", "ccc-3", 0).unwrap();
        std::fs::write(t.folder.join("ccc-3.jsonl"), prompt("2026-11-01T11:00:00.000Z") + "\n").unwrap();
        let again = read_at(t.home.path(), "/Users/me/app", "ccc-3", first.offset).unwrap();
        assert!(again.reset);
        assert_eq!(again.totals.prompts, 1);
        assert_eq!(again.totals.responses, 0);
    }

    #[test]
    fn an_unknown_offset_rebuilds_from_zero() {
        let t = tree("ddd-4");
        append(&t, "ddd-4", &(lines().join("\n") + "\n"));
        let s = read_at(t.home.path(), "/Users/me/app", "ddd-4", 12_345).unwrap();
        assert!(s.reset);
        assert_eq!(s.totals.prompts, 2);
    }

    #[test]
    fn subagent_usage_counts_in_totals_only() {
        let t = tree("eee-5");
        append(&t, "eee-5", &(lines().join("\n") + "\n"));
        let sub = t.folder.join("eee-5/subagents");
        std::fs::create_dir_all(&sub).unwrap();
        let side = reply_full("2026-11-01T10:05:02.000Z", "msg_side", 1, 7, 99_000, 0, true, Some(("toolu_9", "Grep")));
        std::fs::write(sub.join("agent-x.jsonl"), side + "\n").unwrap();
        std::fs::write(sub.join("agent-x.meta.json"), "{}").unwrap();
        let s = read_at(t.home.path(), "/Users/me/app", "eee-5", 0).unwrap();
        assert_eq!(s.totals.responses, 4);
        assert_eq!(s.context_tokens, Some(2 + 1600));
        assert!(s.tools.iter().any(|c| c.name == "Grep"));
    }

    #[test]
    fn finds_the_newest_session_and_never_a_path() {
        let t = tree("fff-6");
        let m = find_at(t.home.path(), "/Users/me/App", 0).unwrap();
        assert_eq!(m.session_id, "fff-6");
        assert!(!m.ambiguous);
        assert!(find_at(t.home.path(), "/Users/me/other", 0).is_none());
        assert!(find_at(t.home.path(), "/Users/me/app", u64::MAX).is_none());
    }

    #[test]
    fn refuses_bad_ids_and_files_outside() {
        let t = tree("ggg-7");
        assert!(read_at(t.home.path(), "/Users/me/app", "../../x", 0).is_err());
        assert!(read_at(t.home.path(), "/Users/me/app", "missing", 0).is_err());
        assert!(read_at(t.home.path(), "/etc", "ggg-7", 0).is_err());
    }

    #[test]
    fn skips_a_line_longer_than_one_read() {
        let t = tree("hhh-8");
        let huge = format!("{{\"type\":\"user\",\"x\":\"{}\"}}\n", "a".repeat(MAX_BYTES_PER_CALL as usize + 10));
        append(&t, "hhh-8", &huge);
        append(&t, "hhh-8", &(prompt("2026-11-01T10:00:00.000Z") + "\n"));
        let mut offset = 0;
        let mut s = read_at(t.home.path(), "/Users/me/app", "hhh-8", offset).unwrap();
        for _ in 0..4 {
            if s.caught_up {
                break;
            }
            offset = s.offset;
            s = read_at(t.home.path(), "/Users/me/app", "hhh-8", offset).unwrap();
        }
        assert!(s.caught_up);
        assert_eq!(s.totals.prompts, 1);
    }
}

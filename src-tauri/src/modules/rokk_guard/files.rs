// Everything the guard writes on disk. Writes are allowed only to
// ~/.claude/settings.json (plus its one-time backup and temp sibling) and to
// files under ~/.rokk/, checked after resolving symlinks and `..`.

use super::score::{Sensitivity, Verdict};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

pub const WRAPPER_VERSION: u32 = 1;
const STATE_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const STATS_KEEP_DAYS: usize = 60;
/// Prompts in a session that must pass before the guard may fire again.
pub const COOLDOWN_PROMPTS: u64 = 3;

pub fn wrapper_script() -> String {
    format!(
        r#"#!/bin/sh
# rokk-prompt-guard v{WRAPPER_VERSION}. Written by Rokk; see docs/rokk/GUARDS.md.
# Fails open: any problem means no output and exit code 0.
[ -n "$TERAX_TERMINAL" ] || exit 0
app=$(cat "$HOME/.rokk/app-path" 2>/dev/null) || exit 0
[ -x "$app" ] || exit 0
"$app" __rokk_prompt_guard 2>/dev/null
exit 0
"#
    )
}

pub struct Paths {
    pub home: PathBuf,
}

impl Paths {
    pub fn from_home() -> Result<Self, String> {
        dirs::home_dir()
            .map(|home| Self { home })
            .ok_or_else(|| "Rokk could not find your home folder.".to_string())
    }
    pub fn rokk(&self) -> PathBuf {
        self.home.join(".rokk")
    }
    fn claude(&self) -> PathBuf {
        self.home.join(".claude")
    }
    pub fn settings(&self) -> PathBuf {
        self.claude().join("settings.json")
    }
    pub fn backup(&self) -> PathBuf {
        self.claude().join("settings.json.rokk-backup")
    }
    fn settings_tmp(&self) -> PathBuf {
        self.claude().join("settings.json.rokk-tmp")
    }
    pub fn wrapper(&self) -> PathBuf {
        self.rokk().join("hooks").join("prompt-guard")
    }
    pub fn app_path(&self) -> PathBuf {
        self.rokk().join("app-path")
    }
    pub fn config(&self) -> PathBuf {
        self.rokk().join("guard-config.json")
    }
    pub fn state(&self) -> PathBuf {
        self.rokk().join("guard-state.json")
    }
    pub fn stats(&self) -> PathBuf {
        self.rokk().join("guard-stats.json")
    }

    /// `p` in ~ form.
    pub fn tilde(&self, p: &Path) -> String {
        match p.strip_prefix(&self.home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => p.display().to_string(),
        }
    }

    /// A plain-language name for a path, for error messages. Never contents.
    pub fn label(&self, p: &Path) -> String {
        let named = [
            (self.settings(), "Claude's settings file (~/.claude/settings.json)"),
            (self.backup(), "the settings backup (~/.claude/settings.json.rokk-backup)"),
            (self.settings_tmp(), "the settings temp file (~/.claude/settings.json.rokk-tmp)"),
            (self.claude(), "the folder ~/.claude"),
            (self.rokk(), "the folder ~/.rokk"),
            (self.rokk().join("hooks"), "the folder ~/.rokk/hooks"),
            (self.wrapper(), "the hook script (~/.rokk/hooks/prompt-guard)"),
            (self.app_path(), "the app path file (~/.rokk/app-path)"),
            (self.config(), "the guard settings (~/.rokk/guard-config.json)"),
            (self.state(), "the guard state (~/.rokk/guard-state.json)"),
            (self.stats(), "the guard counts (~/.rokk/guard-stats.json)"),
        ];
        named
            .iter()
            .find(|(q, _)| q == p)
            .map_or_else(|| self.tilde(p), |(_, l)| (*l).to_string())
    }

    /// A plain-language I/O failure: which step, which path class.
    pub fn io_error(&self, verb: &str, p: &Path, e: &std::io::Error) -> String {
        let what = self.label(p);
        match e.kind() {
            std::io::ErrorKind::PermissionDenied => {
                format!("Rokk could not {verb} {what}: permission denied (not writable or not readable).")
            }
            std::io::ErrorKind::NotFound => format!("Rokk could not {verb} {what}: its folder is missing."),
            _ => format!("Rokk could not {verb} {what}: {e}."),
        }
    }

    /// The path to write, or an error when it is outside the two allowed
    /// places once symlinks and `..` are resolved.
    pub fn check(&self, target: &Path) -> Result<PathBuf, String> {
        let what = self.label(target);
        if !target.is_absolute() || target.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
            return Err(format!("{} is not a plain full path, so Rokk will not write it.", cap(&what)));
        }
        if std::fs::symlink_metadata(target).is_ok_and(|m| m.file_type().is_symlink()) {
            let to = std::fs::read_link(target).map_or_else(|_| "another place".to_string(), |t| self.tilde(&t));
            return Err(format!("{} is a symlink to {to}, so Rokk will not change it.", cap(&what)));
        }
        let home = std::fs::canonicalize(&self.home)
            .map_err(|e| format!("Rokk could not resolve your home folder ({}): {e}.", self.home.display()))?;
        let resolved = resolve(target)
            .ok_or_else(|| format!("Rokk could not resolve the real location of {what}, so it will not write it."))?;
        let claude = home.join(".claude");
        let settings_files = [
            claude.join("settings.json"),
            claude.join("settings.json.rokk-backup"),
            claude.join("settings.json.rokk-tmp"),
        ];
        let rokk = home.join(".rokk");
        if settings_files.contains(&resolved) || (resolved.starts_with(&rokk) && resolved != rokk) {
            return Ok(target.to_path_buf());
        }
        let expected = target.strip_prefix(&self.home).map(|rest| home.join(rest));
        if expected.as_ref().is_ok_and(|e| *e != resolved) {
            // A folder on the way is a symlink to somewhere else.
            return Err(format!(
                "{} really points to {}, because a folder on the way is a symlink, so Rokk will not change it.",
                cap(&what),
                resolved.display()
            ));
        }
        Err(format!(
            "{} is outside the two places Rokk may write (~/.claude/settings.json and ~/.rokk), so Rokk will not write it.",
            cap(&what)
        ))
    }

    pub fn write(&self, target: &Path, contents: &[u8], mode: Option<u32>) -> Result<(), String> {
        self.check(target)?;
        let dir = target.parent().ok_or_else(|| format!("{} has no folder.", cap(&self.label(target))))?;
        self.make_dir(dir)?;
        // Every file in ~/.claude (settings.json and its backup) goes through
        // the one allowed temp name there.
        let tmp = if dir == self.claude() {
            self.settings_tmp()
        } else {
            let mut name = target.file_name().unwrap_or_default().to_os_string();
            name.push(".rokk-tmp");
            dir.join(name)
        };
        self.check(&tmp)?;
        std::fs::write(&tmp, contents).map_err(|e| self.io_error("write", &tmp, &e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Keep the original file's permissions, or apply the requested mode.
            let perms = match mode {
                Some(m) => Some(std::fs::Permissions::from_mode(m)),
                None => std::fs::metadata(target).ok().map(|m| m.permissions()),
            };
            if let Some(p) = perms {
                let _ = std::fs::set_permissions(&tmp, p);
            }
        }
        #[cfg(not(unix))]
        let _ = mode;
        std::fs::rename(&tmp, target).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            self.io_error("replace", target, &e)
        })
    }

    pub fn remove(&self, target: &Path) -> Result<(), String> {
        self.check(target)?;
        match std::fs::remove_file(target) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(self.io_error("remove", target, &e)),
        }
    }

    /// Creates a folder under ~/.rokk (or checks ~/.claude exists safely).
    fn make_dir(&self, dir: &Path) -> Result<(), String> {
        if dir == self.claude() {
            if std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink()) {
                let to = std::fs::read_link(dir).map_or_else(|_| "another place".to_string(), |t| self.tilde(&t));
                return Err(format!("The folder ~/.claude is a symlink to {to}, so Rokk will not change it."));
            }
            return std::fs::create_dir_all(dir).map_err(|e| self.io_error("create", dir, &e));
        }
        self.check(&dir.join("probe"))?;
        std::fs::create_dir_all(dir).map_err(|e| self.io_error("create", dir, &e))
    }

    /// Copies settings.json to the backup once, if it exists and no backup does.
    pub fn backup_once(&self) -> Result<(), String> {
        let backup = self.backup();
        if std::fs::symlink_metadata(&backup).is_ok() {
            return Ok(());
        }
        match std::fs::read(self.settings()) {
            Ok(bytes) => self.write(&backup, &bytes, None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(self.io_error("read", &self.settings(), &e)),
        }
    }

    pub fn read_settings(&self) -> Result<Option<String>, String> {
        match std::fs::read_to_string(self.settings()) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(self.io_error("read", &self.settings(), &e)),
        }
    }
}

fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

/// Canonical form of `p`: the deepest existing ancestor resolved, with the
/// missing tail appended.
fn resolve(p: &Path) -> Option<PathBuf> {
    let mut existing = p.to_path_buf();
    let mut tail = Vec::new();
    while std::fs::symlink_metadata(&existing).is_err() {
        tail.push(existing.file_name()?.to_os_string());
        existing = existing.parent()?.to_path_buf();
    }
    let mut out = std::fs::canonicalize(&existing).ok()?;
    for part in tail.iter().rev() {
        out.push(part);
    }
    Some(out)
}

// --- Config ---

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct GuardConfig {
    pub enabled: bool,
    pub consented: bool,
    pub sensitivity: Sensitivity,
}

pub fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn write_json<T: Serialize>(paths: &Paths, path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    paths.write(path, &bytes, None)
}

// --- Cooldown state (per session id; no prompt text) ---

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct SessionState {
    /// Prompts seen in this session.
    pub n: u64,
    /// The prompt number the guard last fired on.
    pub fired: Option<u64>,
    /// Last time this session was seen (unix seconds).
    pub seen: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct GuardState {
    pub sessions: BTreeMap<String, SessionState>,
}

/// Session ids are UUIDs; anything else is not used as a key.
pub fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Counts one prompt and decides whether a vague one may fire. Old sessions
/// are pruned on the way.
pub fn cooldown_step(state: &mut GuardState, session: &str, vague: bool, now: u64) -> bool {
    state.sessions.retain(|_, s| now.saturating_sub(s.seen) <= STATE_TTL_SECS);
    if !valid_session_id(session) {
        return vague;
    }
    let s = state.sessions.entry(session.to_string()).or_default();
    s.n += 1;
    s.seen = now;
    let fire = vague && s.fired.is_none_or(|f| s.n - f > COOLDOWN_PROMPTS);
    if fire {
        s.fired = Some(s.n);
    }
    fire
}

// --- Stats (per-day counts; never any prompt text) ---

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct DayCounts {
    pub checked: u64,
    pub fired: u64,
    pub skipped: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct GuardStats {
    pub days: BTreeMap<String, DayCounts>,
    pub last_fire: Option<u64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekStats {
    pub checked: u64,
    pub fired: u64,
    pub skipped: u64,
    pub last_fire: Option<u64>,
}

/// Records one prompt. Takes only the outcome, so text cannot reach the file.
pub fn record(stats: &mut GuardStats, verdict: Verdict, fired: bool, now: u64) {
    let day = stats.days.entry(day_key(now)).or_default();
    day.checked += 1;
    if verdict == Verdict::Skipped {
        day.skipped += 1;
    }
    if fired {
        day.fired += 1;
        stats.last_fire = Some(stats.last_fire.map_or(now, |t| t.max(now)));
    }
    while stats.days.len() > STATS_KEEP_DAYS {
        let oldest = stats.days.keys().next().cloned().unwrap();
        stats.days.remove(&oldest);
    }
}

/// Totals for the last seven days, today included.
pub fn week(stats: &GuardStats, now: u64) -> WeekStats {
    let keys: Vec<String> = (0..7).map(|d| day_key(now.saturating_sub(d * 86_400))).collect();
    let mut out = WeekStats {
        last_fire: stats.last_fire,
        ..Default::default()
    };
    for k in &keys {
        if let Some(d) = stats.days.get(k) {
            out.checked += d.checked;
            out.fired += d.fired;
            out.skipped += d.skipped;
        }
    }
    out
}

/// UTC calendar day, YYYY-MM-DD (civil-from-days, H. Hinnant).
pub fn day_key(unix: u64) -> String {
    let z = (unix / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home() -> (tempfile::TempDir, Paths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths {
            home: dir.path().to_path_buf(),
        };
        (dir, paths)
    }

    #[test]
    fn allows_only_the_two_locations() {
        let (_d, p) = temp_home();
        assert!(p.check(&p.settings()).is_ok());
        assert!(p.check(&p.backup()).is_ok());
        assert!(p.check(&p.wrapper()).is_ok());
        assert!(p.check(&p.stats()).is_ok());
        for bad in [
            p.home.join(".claude").join("settings.local.json"),
            p.home.join(".claude").join("CLAUDE.md"),
            p.home.join(".bashrc"),
            p.home.join(".rokk"),
            p.home.join(".rokk").join("..").join(".bashrc"),
            p.home.join(".rokkx").join("x"),
            PathBuf::from("/etc/passwd"),
            PathBuf::from("relative/.rokk/x"),
        ] {
            assert!(p.check(&bad).is_err(), "{}", bad.display());
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_tricks() {
        use std::os::unix::fs::symlink;
        let (_d, p) = temp_home();
        let outside = tempfile::tempdir().unwrap();

        // ~/.rokk pointing elsewhere.
        symlink(outside.path(), p.rokk()).unwrap();
        assert!(p.check(&p.stats()).is_err());
        assert!(p.write(&p.stats(), b"{}", None).is_err());
        assert!(!outside.path().join("guard-stats.json").exists());
        std::fs::remove_file(p.rokk()).unwrap();

        // A file under ~/.rokk that is itself a symlink.
        std::fs::create_dir_all(p.rokk()).unwrap();
        let target = outside.path().join("victim");
        std::fs::write(&target, "keep").unwrap();
        symlink(&target, p.stats()).unwrap();
        assert!(p.write(&p.stats(), b"{}", None).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "keep");

        // A symlinked folder inside ~/.rokk.
        symlink(outside.path(), p.rokk().join("hooks")).unwrap();
        assert!(p.write(&p.wrapper(), b"x", Some(0o755)).is_err());

        // settings.json as a symlink, and ~/.claude as a symlink.
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        symlink(&target, p.settings()).unwrap();
        assert!(p.write(&p.settings(), b"{}", None).is_err());
        std::fs::remove_file(p.settings()).unwrap();
        std::fs::remove_dir(p.home.join(".claude")).unwrap();
        symlink(outside.path(), p.home.join(".claude")).unwrap();
        assert!(p.write(&p.settings(), b"{}", None).is_err());
        assert!(!outside.path().join("settings.json").exists());
    }

    #[test]
    fn writes_atomically_and_backs_up_once() {
        let (_d, p) = temp_home();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        std::fs::write(p.settings(), "{\"a\":1}").unwrap();
        p.backup_once().unwrap();
        p.write(&p.settings(), b"{\"a\":2}", None).unwrap();
        p.backup_once().unwrap();
        assert_eq!(std::fs::read_to_string(p.backup()).unwrap(), "{\"a\":1}");
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), "{\"a\":2}");
        assert!(!p.home.join(".claude").join("settings.json.rokk-tmp").exists());
    }

    #[test]
    fn backup_goes_through_the_allowed_temp_file() {
        // Regression: the backup's temp file was named
        // settings.json.rokk-backup.rokk-tmp, which check() refuses.
        let (_d, p) = temp_home();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        std::fs::write(p.settings(), "{}").unwrap();
        p.backup_once().unwrap();
        assert_eq!(std::fs::read_to_string(p.backup()).unwrap(), "{}");
        assert!(!p.home.join(".claude").join("settings.json.rokk-backup.rokk-tmp").exists());
        assert!(!p.home.join(".claude").join("settings.json.rokk-tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refusals_name_the_check_and_the_path_class() {
        use std::os::unix::fs::symlink;
        let (_d, p) = temp_home();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        let target = outside.path().join("real.json");
        std::fs::write(&target, "{\"secret\":1}").unwrap();
        symlink(&target, p.settings()).unwrap();
        let err = p.write(&p.settings(), b"{}", None).unwrap_err();
        assert!(err.starts_with("Claude's settings file (~/.claude/settings.json) is a symlink to "), "{err}");
        assert!(err.contains("real.json") && err.ends_with("so Rokk will not change it."), "{err}");
        assert!(!err.contains("secret"));

        let err = p.check(&p.home.join(".bashrc")).unwrap_err();
        assert!(err.contains("outside the two places Rokk may write"), "{err}");

        symlink(outside.path(), p.rokk()).unwrap();
        let err = p.check(&p.stats()).unwrap_err();
        assert!(err.starts_with("The guard counts (~/.rokk/guard-stats.json) really points to"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn io_errors_say_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, p) = temp_home();
        std::fs::create_dir_all(p.rokk()).unwrap();
        std::fs::set_permissions(p.rokk(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = p.write(&p.config(), b"{}", None);
        std::fs::set_permissions(p.rokk(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = result.unwrap_err();
        assert!(err.contains("~/.rokk") && err.contains("permission denied"), "{err}");
    }

    #[test]
    fn no_backup_when_settings_is_missing() {
        let (_d, p) = temp_home();
        p.backup_once().unwrap();
        assert!(!p.backup().exists());
    }

    #[cfg(unix)]
    #[test]
    fn wrapper_is_executable_and_fails_open() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, p) = temp_home();
        p.write(&p.wrapper(), wrapper_script().as_bytes(), Some(0o755)).unwrap();
        let mode = std::fs::metadata(p.wrapper()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        let s = wrapper_script();
        assert!(s.contains("[ -n \"$TERAX_TERMINAL\" ] || exit 0"));
        assert!(s.contains("[ -x \"$app\" ] || exit 0"));
        assert!(s.trim_end().ends_with("exit 0"));
        assert!(!s.contains("exit 2"));
    }

    #[test]
    fn cooldown_skips_the_next_three_prompts_of_a_session() {
        let mut st = GuardState::default();
        let fired: Vec<bool> = (0..6).map(|_| cooldown_step(&mut st, "s-1", true, 100)).collect();
        assert_eq!(fired, [true, false, false, false, true, false]);
        // Another session is independent.
        assert!(cooldown_step(&mut st, "s-2", true, 100));
        // Specific prompts count towards the gap but never fire.
        let mut st = GuardState::default();
        assert!(cooldown_step(&mut st, "a", true, 1));
        for _ in 0..3 {
            assert!(!cooldown_step(&mut st, "a", false, 1));
        }
        assert!(cooldown_step(&mut st, "a", true, 1));
    }

    #[test]
    fn cooldown_prunes_sessions_older_than_a_week() {
        let mut st = GuardState::default();
        cooldown_step(&mut st, "old", true, 0);
        cooldown_step(&mut st, "new", true, STATE_TTL_SECS + 10);
        assert!(!st.sessions.contains_key("old"));
        assert!(st.sessions.contains_key("new"));
        // Ids that are not UUID-like are never stored.
        assert!(cooldown_step(&mut st, "../x", true, STATE_TTL_SECS + 10));
        assert_eq!(st.sessions.len(), 1);
    }

    #[test]
    fn stats_count_per_day_and_sum_the_week() {
        let mut s = GuardStats::default();
        let day = 86_400;
        let now = 20_000 * day + 500;
        record(&mut s, Verdict::Vague, true, now);
        record(&mut s, Verdict::Specific, false, now);
        record(&mut s, Verdict::Skipped, false, now - day);
        record(&mut s, Verdict::Vague, true, now - 8 * day);
        let w = week(&s, now);
        assert_eq!((w.checked, w.fired, w.skipped), (3, 1, 1));
        assert_eq!(w.last_fire, Some(now));
    }

    #[test]
    fn stats_file_cannot_contain_prompt_text() {
        let (_d, p) = temp_home();
        let prompt = "SECRET-PROMPT-7f3a make it better";
        let verdict = super::super::score::score(prompt, Default::default()).verdict;
        let mut s = GuardStats::default();
        record(&mut s, verdict, true, now());
        write_json(&p, &p.stats(), &s).unwrap();
        let mut st = GuardState::default();
        cooldown_step(&mut st, "session-1", true, now());
        write_json(&p, &p.state(), &st).unwrap();
        for file in [p.stats(), p.state()] {
            let text = std::fs::read_to_string(file).unwrap();
            assert!(!text.contains("SECRET"));
            assert!(!text.contains("make it better"));
        }
    }

    #[test]
    fn day_keys_are_utc_dates() {
        assert_eq!(day_key(0), "1970-01-01");
        assert_eq!(day_key(951_782_400), "2000-02-29");
        assert_eq!(day_key(1_793_491_200), "2026-11-01");
    }
}

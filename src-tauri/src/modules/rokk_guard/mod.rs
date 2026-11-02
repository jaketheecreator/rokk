// Rokk guards, served by one Claude Code UserPromptSubmit hook:
// "Clarify vague prompts" asks Claude to ask before building when a prompt
// is too vague, and "Ship it checklist" turns "ship it" into a go or no-go
// check. Each has its own switch; the hook is installed while at least one
// is on. See docs/rokk/GUARDS.md.
//
// The hook runs only where ROKK_TERMINAL is set (Rokk's terminals; the
// original Terax sets only TERAX_TERMINAL). It is a wrapper script in ~/.rokk/hooks that runs this binary with
// the hidden `__rokk_prompt_guard` subcommand. Everything fails open: any
// problem means no output and exit code 0, so Claude carries on as normal.

pub mod files;
pub mod magic;
pub mod score;
pub mod settings_edit;

use files::{GuardConfig, GuardState, GuardStats, Paths, WeekStats};
use score::{Config, Score, Sensitivity, Verdict};
use serde::Serialize;
use serde_json::{json, Value};

pub const ADDITIONAL_CONTEXT: &str = "Rokk guard: the user's request may be underspecified. Before editing files or running commands, ask at most two short, concrete questions about what is missing (what is wrong or wanted, where, and how the user will know it is done), unless the answer is obvious from the code. Then state your plan in at most 3 lines and wait for the user's reply. If the request is already clear, ignore this note and proceed.";
pub const SYSTEM_MESSAGE: &str = "Rokk: this prompt looked vague, so Claude was asked to clarify first.";
pub const SUBCOMMAND: &str = "__rokk_prompt_guard";

const SUPPORTED: bool = cfg!(unix);

pub fn hook_json() -> String {
    output_json(SYSTEM_MESSAGE, ADDITIONAL_CONTEXT)
}

fn output_json(message: &str, context: &str) -> String {
    json!({
        "systemMessage": message,
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    })
    .to_string()
}

pub fn ship_it_json() -> String {
    output_json(magic::SHIP_IT_MESSAGE, magic::SHIP_IT_CONTEXT)
}

/// Entry point for `<app> __rokk_prompt_guard`. Never returns, always exits 0.
#[cfg(unix)]
pub fn run_hook() -> ! {
    use std::io::Write;
    // Fail open well inside the 200 ms budget, whatever happens below.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        std::process::exit(0);
    });
    if let Ok(Some(out)) = std::panic::catch_unwind(hook_output) {
        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(out.as_bytes());
        let _ = stdout.flush();
    }
    std::process::exit(0)
}

/// The hook's stdout, or None for "print nothing". The prompt is read in
/// memory only; nothing of it is written anywhere.
#[cfg(unix)]
fn hook_output() -> Option<String> {
    use std::io::Read;
    std::env::var_os("ROKK_TERMINAL")?;
    let mut buf = Vec::new();
    std::io::stdin().take(1 << 20).read_to_end(&mut buf).ok()?;
    respond(&buf, &Paths::from_home().ok()?)
}

/// The response to one hook input, given the guard's files under `paths`.
#[cfg(unix)]
fn respond(buf: &[u8], paths: &Paths) -> Option<String> {
    let input: Value = serde_json::from_slice(buf).ok()?;
    if input
        .get("hook_event_name")
        .and_then(Value::as_str)
        .is_some_and(|e| e != "UserPromptSubmit")
    {
        return None;
    }
    let prompt = input.get("prompt")?.as_str()?;
    let session = input.get("session_id").and_then(Value::as_str).unwrap_or("");

    let config: GuardConfig = files::read_json(&paths.config());
    // Magic phrases first; they skip the vagueness cooldown.
    if config.ship_it_enabled && magic::magic(prompt) == Some(magic::Magic::ShipIt) {
        let mut stats: GuardStats = files::read_json(&paths.stats());
        files::record_ship_it(&mut stats, files::now());
        let _ = files::write_json(paths, &paths.stats(), &stats);
        return Some(ship_it_json());
    }
    if !config.enabled {
        return None;
    }
    let verdict = score::score(prompt, Config { sensitivity: config.sensitivity }).verdict;
    let now = files::now();

    let mut state: GuardState = files::read_json(&paths.state());
    let fire = files::cooldown_step(&mut state, session, verdict == Verdict::Vague, now);
    let _ = files::write_json(paths, &paths.state(), &state);
    let mut stats: GuardStats = files::read_json(&paths.stats());
    files::record(&mut stats, verdict, fire, now);
    let _ = files::write_json(paths, &paths.stats(), &stats);

    fire.then(hook_json)
}

/// Called at every app start: keeps ~/.rokk/app-path and the wrapper
/// current, but only when the guard was installed before.
pub fn refresh_app_path() {
    if !SUPPORTED {
        return;
    }
    let Ok(paths) = Paths::from_home() else {
        return;
    };
    if std::fs::symlink_metadata(paths.app_path()).is_ok() {
        if let Some(exe) = current_exe() {
            if std::fs::read_to_string(paths.app_path()).ok().as_deref() != Some(exe.as_str()) {
                let _ = paths.write(&paths.app_path(), exe.as_bytes(), None);
            }
        }
    }
    if std::fs::symlink_metadata(paths.wrapper()).is_ok()
        && std::fs::read_to_string(paths.wrapper()).ok() != Some(files::wrapper_script())
    {
        let _ = paths.write(&paths.wrapper(), files::wrapper_script().as_bytes(), Some(0o755));
    }
}

fn current_exe() -> Option<String> {
    std::env::current_exe().ok().map(|p| p.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardStatus {
    supported: bool,
    /// "Clarify vague prompts" is on.
    enabled: bool,
    /// "Ship it checklist" is on.
    ship_it_enabled: bool,
    /// The consent dialog was accepted at least once.
    consented: bool,
    /// Our hook entry is in ~/.claude/settings.json.
    installed: bool,
    /// Our entry is there but from an older version (for example gated on
    /// TERAX_TERMINAL), so Repair should replace it.
    outdated: bool,
    /// The wrapper and the app path file are present and current.
    files_ok: bool,
    sensitivity: Sensitivity,
    version: u32,
    command: String,
    settings_path: String,
    backup_path: String,
    files: Vec<String>,
    error: Option<String>,
}

fn status_at(paths: &Paths) -> GuardStatus {
    let config: GuardConfig = files::read_json(&paths.config());
    let entry = paths.read_settings().and_then(|t| {
        let t = t.unwrap_or_default();
        Ok((settings_edit::has_entry(&t)?, settings_edit::entry_is_current(&t)?))
    });
    let (installed, outdated, error) = match entry {
        Ok((found, current)) => (found, found && !current, None),
        Err(e) => (false, false, Some(e)),
    };
    let wrapper_ok = std::fs::read_to_string(paths.wrapper()).ok() == Some(files::wrapper_script());
    let app_ok = std::fs::read_to_string(paths.app_path())
        .ok()
        .is_some_and(|p| std::path::Path::new(&p).is_file() && Some(p) == current_exe());
    GuardStatus {
        supported: SUPPORTED,
        enabled: config.enabled,
        ship_it_enabled: config.ship_it_enabled,
        consented: config.consented,
        installed,
        outdated,
        files_ok: wrapper_ok && app_ok,
        sensitivity: config.sensitivity,
        version: files::WRAPPER_VERSION,
        command: settings_edit::hook_command(),
        settings_path: "~/.claude/settings.json".into(),
        backup_path: "~/.claude/settings.json.rokk-backup".into(),
        files: vec![
            "~/.rokk/hooks/prompt-guard".into(),
            "~/.rokk/app-path".into(),
            "~/.rokk/guard-config.json".into(),
            "~/.rokk/guard-state.json".into(),
            "~/.rokk/guard-stats.json".into(),
        ],
        error,
    }
}

/// Writes settings.json only when the text changes, backing it up first.
fn write_settings(paths: &Paths, old: Option<&str>, new: &str) -> Result<(), String> {
    if old == Some(new) || (old.is_none() && new.is_empty()) {
        return Ok(());
    }
    paths.backup_once()?;
    paths.write(&paths.settings(), new.as_bytes(), None)
}

/// Sets either switch and keeps the one hook entry in step: installed while
/// at least one feature is on, removed (files kept) when both are off.
fn set_features_at(
    paths: &Paths,
    exe: &str,
    vague: Option<bool>,
    ship_it: Option<bool>,
    sensitivity: Option<Sensitivity>,
) -> Result<(), String> {
    let mut config: GuardConfig = files::read_json(&paths.config());
    let had_config = std::fs::symlink_metadata(paths.config()).is_ok();
    if let Some(v) = vague {
        config.enabled = v;
    }
    if let Some(v) = ship_it {
        config.ship_it_enabled = v;
    }
    if let Some(s) = sensitivity {
        config.sensitivity = s;
    }
    if !(config.enabled || config.ship_it_enabled) {
        remove_entry(paths)?;
        // Turning off before anything was set up writes nothing.
        return if had_config { files::write_json(paths, &paths.config(), &config) } else { Ok(()) };
    }
    if !SUPPORTED {
        return Err("Guards work on macOS and Linux for now.".into());
    }
    if exe.is_empty() {
        return Err("Rokk could not find its own program path.".into());
    }
    let old = paths.read_settings()?;
    // Compute the edit first: invalid JSON stops everything before any write.
    let new = settings_edit::add(old.as_deref().unwrap_or(""))?;
    paths.write(&paths.wrapper(), files::wrapper_script().as_bytes(), Some(0o755))?;
    paths.write(&paths.app_path(), exe.as_bytes(), None)?;
    config.consented = true;
    files::write_json(paths, &paths.config(), &config)?;
    write_settings(paths, old.as_deref(), &new)
}

fn enable_at(paths: &Paths, exe: &str, sensitivity: Option<Sensitivity>) -> Result<(), String> {
    set_features_at(paths, exe, Some(true), None, sensitivity)
}

fn remove_entry(paths: &Paths) -> Result<(), String> {
    let Some(old) = paths.read_settings()? else {
        return Ok(());
    };
    let new = settings_edit::remove(&old)?;
    write_settings(paths, Some(&old), &new)
}

fn disable_at(paths: &Paths, exe: &str) -> Result<(), String> {
    set_features_at(paths, exe, Some(false), None, None)
}

fn remove_all_at(paths: &Paths) -> Result<(), String> {
    remove_entry(paths)?;
    for f in [paths.wrapper(), paths.app_path(), paths.config(), paths.state(), paths.stats()] {
        paths.remove(&f)?;
    }
    // Drop our folders when they are empty; never follow a symlink.
    for dir in [paths.rokk().join("hooks"), paths.rokk()] {
        if std::fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
            let _ = std::fs::remove_dir(&dir);
        }
    }
    Ok(())
}

fn set_sensitivity_at(paths: &Paths, sensitivity: Sensitivity) -> Result<(), String> {
    // Only remembered once the guard has been set up; before that the page
    // passes it to guard_enable.
    if std::fs::symlink_metadata(paths.config()).is_err() {
        return Ok(());
    }
    let mut config: GuardConfig = files::read_json(&paths.config());
    config.sensitivity = sensitivity;
    files::write_json(paths, &paths.config(), &config)
}

fn with_paths<T>(work: impl FnOnce(&Paths) -> Result<T, String>) -> Result<T, String> {
    work(&Paths::from_home()?)
}

#[tauri::command]
pub async fn guard_status() -> Result<GuardStatus, String> {
    super::fs::blocking(|| with_paths(|p| Ok(status_at(p)))).await
}

#[tauri::command]
pub async fn guard_enable(sensitivity: Option<Sensitivity>) -> Result<GuardStatus, String> {
    super::fs::blocking(move || {
        with_paths(|p| {
            let exe = current_exe().ok_or("could not find the Rokk app path")?;
            enable_at(p, &exe, sensitivity)?;
            Ok(status_at(p))
        })
    })
    .await
}

#[tauri::command]
pub async fn guard_disable() -> Result<GuardStatus, String> {
    super::fs::blocking(|| {
        with_paths(|p| {
            let exe = current_exe().unwrap_or_default();
            disable_at(p, &exe).map(|()| status_at(p))
        })
    })
    .await
}

/// Turns the Ship it checklist on or off; installs or removes the shared
/// hook as needed.
#[tauri::command]
pub async fn guard_set_ship_it(enabled: bool) -> Result<GuardStatus, String> {
    super::fs::blocking(move || {
        with_paths(|p| {
            let exe = current_exe().ok_or("could not find the Rokk app path")?;
            set_features_at(p, &exe, None, Some(enabled), None)?;
            Ok(status_at(p))
        })
    })
    .await
}

#[tauri::command]
pub async fn guard_remove_all() -> Result<GuardStatus, String> {
    super::fs::blocking(|| with_paths(|p| remove_all_at(p).map(|()| status_at(p)))).await
}

#[tauri::command]
pub async fn guard_set_sensitivity(sensitivity: Sensitivity) -> Result<GuardStatus, String> {
    super::fs::blocking(move || with_paths(|p| set_sensitivity_at(p, sensitivity).map(|()| status_at(p)))).await
}

/// For the "Test a prompt" box. Pure: nothing is saved or logged.
#[tauri::command]
pub fn guard_score(prompt: String, sensitivity: Option<Sensitivity>) -> Score {
    score::score(&prompt, Config { sensitivity: sensitivity.unwrap_or_default() })
}

/// This week's counts, or None before the guard has seen any prompt.
#[tauri::command]
pub async fn guard_stats() -> Result<Option<WeekStats>, String> {
    super::fs::blocking(|| {
        with_paths(|p| {
            if std::fs::symlink_metadata(p.stats()).is_err() {
                return Ok(None);
            }
            let stats: GuardStats = files::read_json(&p.stats());
            let week = files::week(&stats, files::now());
            Ok((week.checked > 0 || week.ship_it_runs > 0).then_some(week))
        })
    })
    .await
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn home() -> (tempfile::TempDir, Paths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths { home: dir.path().to_path_buf() };
        (dir, paths)
    }

    const EXE: &str = "/bin/sh";

    #[test]
    fn hook_json_is_the_documented_shape() {
        let v: Value = serde_json::from_str(&hook_json()).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit");
        assert_eq!(v["hookSpecificOutput"]["additionalContext"], ADDITIONAL_CONTEXT);
        assert_eq!(v["systemMessage"], SYSTEM_MESSAGE);
        assert!(v.get("decision").is_none());
    }

    #[test]
    fn enable_disable_and_remove_all_round_trip() {
        let (_d, p) = home();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        let original = "{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"Stop\": []\n  }\n}\n";
        std::fs::write(p.settings(), original).unwrap();

        enable_at(&p, EXE, Some(Sensitivity::Medium)).unwrap();
        let s = status_at(&p);
        assert!(s.enabled && s.consented && s.installed);
        assert_eq!(s.sensitivity, Sensitivity::Medium);
        assert_eq!(std::fs::read_to_string(p.backup()).unwrap(), original);
        assert_eq!(std::fs::read_to_string(p.app_path()).unwrap(), EXE);

        // Enabling twice changes nothing.
        let once = std::fs::read_to_string(p.settings()).unwrap();
        enable_at(&p, EXE, None).unwrap();
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), once);

        disable_at(&p, EXE).unwrap();
        let s = status_at(&p);
        assert!(!s.enabled && s.consented && !s.installed);
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), original);
        assert!(p.wrapper().exists(), "disable keeps the files");

        remove_all_at(&p).unwrap();
        assert!(!p.rokk().exists());
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), original);
        // The backup is the person's own data and stays.
        assert!(p.backup().exists());
    }

    #[test]
    fn enable_creates_a_missing_settings_file() {
        let (_d, p) = home();
        enable_at(&p, EXE, None).unwrap();
        assert!(status_at(&p).installed);
        assert!(!p.backup().exists());
    }

    #[test]
    fn invalid_settings_json_is_reported_and_left_alone() {
        let (_d, p) = home();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        std::fs::write(p.settings(), "{ broken").unwrap();
        assert!(enable_at(&p, EXE, None).is_err());
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), "{ broken");
        assert!(!p.rokk().exists(), "nothing is written before the check");
        assert!(!p.backup().exists());
        assert!(status_at(&p).error.is_some());
    }

    fn hook_input(prompt: &str) -> Vec<u8> {
        json!({ "session_id": "s-1", "hook_event_name": "UserPromptSubmit", "prompt": prompt })
            .to_string()
            .into_bytes()
    }

    /// Runs a shell script with only HOME and PATH set, plus `extra`.
    fn run_sh(args: &[&str], home: &std::path::Path, extra: &[(&str, &str)], stdin: &[u8]) -> std::process::Output {
        use std::io::Write;
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.args(args)
            .env_clear()
            .env("HOME", home)
            .env("PATH", "/usr/bin:/bin")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        for (k, v) in extra {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().unwrap();
        let _ = child.stdin.take().unwrap().write_all(stdin);
        child.wait_with_output().unwrap()
    }

    /// The wrapper and hook files, with the app replaced by a stub that
    /// says it ran.
    fn install_with_stub(p: &Paths) {
        use std::os::unix::fs::PermissionsExt;
        let stub = p.home.join("stub-app");
        std::fs::write(&stub, "#!/bin/sh\ncat >/dev/null\nprintf STUB-RAN\n").unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        enable_at(p, stub.to_str().unwrap(), None).unwrap();
    }

    #[test]
    fn without_rokk_terminal_the_wrapper_and_hook_print_nothing_and_exit_0() {
        let (_d, p) = home();
        install_with_stub(&p);
        let wrapper = p.wrapper();
        let command = settings_edit::hook_command();
        // TERAX_TERMINAL alone (the original Terax) is not enough.
        for args in [vec![wrapper.to_str().unwrap()], vec!["-c", command.as_str()]] {
            let out = run_sh(&args, &p.home, &[("TERAX_TERMINAL", "1")], &hook_input("fix it"));
            assert!(out.status.success(), "{args:?}");
            assert!(out.stdout.is_empty(), "{args:?}");
        }
    }

    #[test]
    fn with_rokk_terminal_the_wrapper_and_hook_run_the_app() {
        let (_d, p) = home();
        install_with_stub(&p);
        let wrapper = p.wrapper();
        let command = settings_edit::hook_command();
        for args in [vec![wrapper.to_str().unwrap()], vec!["-c", command.as_str()]] {
            let out = run_sh(&args, &p.home, &[("ROKK_TERMINAL", "1")], &hook_input("fix it"));
            assert!(out.status.success(), "{args:?}");
            assert_eq!(out.stdout, b"STUB-RAN", "{args:?}");
        }
    }

    #[test]
    fn wrapper_with_a_missing_app_prints_nothing_and_exits_0() {
        let (_d, p) = home();
        install_with_stub(&p);
        std::fs::remove_file(p.home.join("stub-app")).unwrap();
        let out = run_sh(&[p.wrapper().to_str().unwrap()], &p.home, &[("ROKK_TERMINAL", "1")], &hook_input("fix it"));
        assert!(out.status.success());
        assert!(out.stdout.is_empty());
    }

    #[test]
    fn fix_it_gets_the_clarification_and_specific_prompts_get_nothing() {
        let (_d, p) = home();
        enable_at(&p, EXE, None).unwrap();
        assert_eq!(respond(&hook_input("fix it"), &p), Some(hook_json()));
        let specific = hook_input("In src/settings/GeneralSection.tsx, add a toggle for the greeting");
        assert_eq!(respond(&specific, &p), None);
        disable_at(&p, EXE).unwrap();
        assert_eq!(respond(&hook_input("fix it"), &p), None);
    }

    #[test]
    fn status_flags_an_old_terax_gated_entry_as_outdated() {
        let (_d, p) = home();
        enable_at(&p, EXE, None).unwrap();
        assert!(!status_at(&p).outdated);
        let text = std::fs::read_to_string(p.settings()).unwrap();
        let old = text.replace("$ROKK_TERMINAL", "$TERAX_TERMINAL");
        std::fs::write(p.settings(), &old).unwrap();
        let s = status_at(&p);
        assert!(s.installed && s.outdated);
        // Enabling again (what Repair does) replaces it with one current entry.
        enable_at(&p, EXE, None).unwrap();
        let s = status_at(&p);
        assert!(s.installed && !s.outdated);
        assert_eq!(std::fs::read_to_string(p.settings()).unwrap(), text);
    }

    /// UserPromptSubmit groups whose command contains our marker.
    fn rokk_entries(text: &str) -> usize {
        let v: Value = serde_json::from_str(text).unwrap();
        v["hooks"]["UserPromptSubmit"].as_array().map_or(0, |a| {
            a.iter()
                .filter(|g| {
                    g["hooks"].as_array().is_some_and(|hs| {
                        hs.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains(settings_edit::MARKER)))
                    })
                })
                .count()
        })
    }

    #[test]
    fn enable_and_repair_collapse_two_rokk_entries_into_one() {
        let (_d, p) = home();
        std::fs::create_dir_all(p.home.join(".claude")).unwrap();
        let ours = settings_edit::hook_group();
        let old = json!({ "hooks": [ { "type": "command", "command": "[ -n \"$TERAX_TERMINAL\" ] && \"$HOME/.rokk/hooks/prompt-guard\"; true" } ] });
        let foreign = json!({ "hooks": [ { "type": "command", "command": "say hi" } ] });
        let start = json!({
            "model": "opus",
            "hooks": {
                "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ],
                "UserPromptSubmit": [ ours, foreign, old ]
            },
            "permissions": { "allow": ["Bash(ls)"] }
        });
        std::fs::write(p.settings(), serde_json::to_string_pretty(&start).unwrap()).unwrap();
        assert_eq!(rokk_entries(&std::fs::read_to_string(p.settings()).unwrap()), 2);

        // Enabling (what Repair does for the vague guard) leaves one.
        enable_at(&p, EXE, None).unwrap();
        let text = std::fs::read_to_string(p.settings()).unwrap();
        assert_eq!(rokk_entries(&text), 1);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        let ups = v["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(ups.len(), 2);
        assert!(ups.iter().any(|g| g["hooks"][0]["command"] == "say hi"));
        assert!(entry_current(&text));

        // The Ship it path (Repair when only Ship it is on) collapses too.
        std::fs::write(p.settings(), serde_json::to_string_pretty(&start).unwrap()).unwrap();
        disable_at(&p, EXE).unwrap();
        assert_eq!(rokk_entries(&std::fs::read_to_string(p.settings()).unwrap()), 0);
        std::fs::write(p.settings(), serde_json::to_string_pretty(&start).unwrap()).unwrap();
        ship(&p, true);
        let text = std::fs::read_to_string(p.settings()).unwrap();
        assert_eq!(rokk_entries(&text), 1);
        assert!(text.contains("say hi") && text.contains("say done") && text.contains("Bash(ls)"));
    }

    fn entry_current(text: &str) -> bool {
        settings_edit::entry_is_current(text).unwrap()
    }

    fn ship(p: &Paths, on: bool) {
        set_features_at(p, EXE, None, Some(on), None).unwrap();
    }

    #[test]
    fn the_two_switches_are_independent_and_share_one_hook() {
        let (_d, p) = home();
        // Ship it alone installs the hook.
        ship(&p, true);
        let s = status_at(&p);
        assert!(s.ship_it_enabled && !s.enabled && s.installed && s.consented);
        // Turning the vague guard on and off leaves the hook for Ship it.
        enable_at(&p, EXE, None).unwrap();
        disable_at(&p, EXE).unwrap();
        let s = status_at(&p);
        assert!(s.ship_it_enabled && !s.enabled && s.installed);
        // And the other way round.
        enable_at(&p, EXE, None).unwrap();
        ship(&p, false);
        let s = status_at(&p);
        assert!(!s.ship_it_enabled && s.enabled && s.installed);
        // Both off: the hook goes, the files stay.
        disable_at(&p, EXE).unwrap();
        let s = status_at(&p);
        assert!(!s.installed && !s.enabled && !s.ship_it_enabled);
        assert!(p.wrapper().exists() && p.config().exists());
    }

    #[test]
    fn switching_is_idempotent_with_exactly_one_entry() {
        let (_d, p) = home();
        ship(&p, true);
        let once = std::fs::read_to_string(p.settings()).unwrap();
        ship(&p, true);
        enable_at(&p, EXE, None).unwrap();
        enable_at(&p, EXE, None).unwrap();
        let after = std::fs::read_to_string(p.settings()).unwrap();
        assert_eq!(after, once);
        // Count entries, not marker text: one command holds the marker twice.
        assert_eq!(rokk_entries(&after), 1);
        ship(&p, false);
        ship(&p, false);
        assert!(status_at(&p).installed, "the vague guard is still on");
    }

    #[test]
    fn turning_off_before_setup_writes_nothing() {
        let (_d, p) = home();
        ship(&p, false);
        disable_at(&p, EXE).unwrap();
        assert!(!p.rokk().exists());
        assert!(!p.settings().exists());
    }

    #[test]
    fn ship_it_gets_the_checklist_only_when_its_switch_is_on() {
        let (_d, p) = home();
        enable_at(&p, EXE, None).unwrap();
        // Vague guard on, Ship it off: "ship it" is skipped, not vague.
        assert_eq!(respond(&hook_input("ship it"), &p), None);
        ship(&p, true);
        // Every time, with no cooldown, even right after a clarification.
        assert_eq!(respond(&hook_input("fix it"), &p), Some(hook_json()));
        for _ in 0..3 {
            assert_eq!(respond(&hook_input("Ship it!"), &p), Some(ship_it_json()));
        }
        // Longer prompts go through the normal guard.
        assert_eq!(respond(&hook_input("ship it to production tomorrow with vercel"), &p), None);
        // Ship it on, vague guard off.
        disable_at(&p, EXE).unwrap();
        assert_eq!(respond(&hook_input("ship it"), &p), Some(ship_it_json()));
        assert_eq!(respond(&hook_input("fix it"), &p), None);
        let stats: GuardStats = files::read_json(&p.stats());
        assert_eq!(files::week(&stats, files::now()).ship_it_runs, 4);
        let text = std::fs::read_to_string(p.stats()).unwrap();
        assert!(!text.contains("ship it") && !text.contains("Ship it") && !text.contains("vercel"));
    }

    #[test]
    fn ship_it_output_is_the_documented_shape() {
        let v: Value = serde_json::from_str(&ship_it_json()).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit");
        assert_eq!(v["hookSpecificOutput"]["additionalContext"], magic::SHIP_IT_CONTEXT);
        assert_eq!(v["systemMessage"], "Rokk: running the ship-it checklist.");
        assert!(v.get("decision").is_none());
    }

    #[test]
    fn scoring_command_is_pure() {
        let s = guard_score("fix it".into(), None);
        assert_eq!(s.verdict, Verdict::Vague);
    }
}

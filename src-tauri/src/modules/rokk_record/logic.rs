// Pure parts of the recorder: the state machine, file names, path rules,
// limits and error codes. No I/O except the path checks, which are tested
// against a temporary folder.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};

pub const MAX_SECONDS: u64 = 10 * 60;
pub const MIN_FREE_TO_START: u64 = 500 * 1024 * 1024;
pub const MIN_FREE_WHILE_RECORDING: u64 = 200 * 1024 * 1024;
/// Longest wait for a file to finalize before the watchdog gives up.
pub const FINALIZE_TIMEOUT_SECS: u64 = 10;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RecState {
    #[default]
    Idle,
    Starting,
    Recording,
    Stopping,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecEvent {
    Start,
    Started,
    Stop,
    Finished,
    Failed,
    /// The finalize watchdog fired.
    Timeout,
}

/// The legal transitions; anything else is refused.
pub fn transition(from: RecState, event: RecEvent) -> Option<RecState> {
    use RecEvent::*;
    use RecState::*;
    match (from, event) {
        (Idle, Start) => Some(Starting),
        (Starting, Started) => Some(Recording),
        (Starting, Failed) => Some(Idle),
        (Recording, Stop) => Some(Stopping),
        (Recording, Failed) => Some(Stopping),
        (Stopping, Finished) => Some(Idle),
        (Stopping, Failed) => Some(Idle),
        (Stopping, Timeout) => Some(Idle),
        _ => None,
    }
}

/// Why a recording is being stopped. Every end of a capture, whatever its
/// origin, goes through the one stop function with one of these.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum StopReason {
    /// "Stop recording" in the menu bar.
    #[serde(rename = "tray")]
    Tray,
    /// Mod+Alt+R, Mod+Alt+S or a button in the app.
    #[serde(rename = "shortcut")]
    Shortcut,
    /// "Stop and discard" in the menu bar or the controller, or a cancel.
    #[serde(rename = "discard")]
    Discard,
    /// Restart in the controller: discard this take, then record again.
    #[serde(rename = "restart")]
    Restart,
    /// The stream or the recording output ended by itself: stopped by macOS,
    /// or by the user from a system control.
    #[serde(rename = "system")]
    System,
    #[serde(rename = "cap")]
    TimeLimit,
    #[serde(rename = "disk")]
    LowDisk,
    #[serde(rename = "window_closed")]
    WindowClosed,
    #[serde(rename = "app_exit")]
    AppExit,
    /// The recording output reported a failure while the stream ran.
    #[serde(rename = "error")]
    CaptureFailed,
}

impl StopReason {
    pub fn name(self) -> &'static str {
        match self {
            StopReason::Tray => "tray",
            StopReason::Shortcut => "shortcut",
            StopReason::Discard => "discard",
            StopReason::Restart => "restart",
            StopReason::System => "system",
            StopReason::TimeLimit => "cap",
            StopReason::LowDisk => "disk",
            StopReason::WindowClosed => "window_closed",
            StopReason::AppExit => "app_exit",
            StopReason::CaptureFailed => "error",
        }
    }
}

impl RecState {
    pub fn name(self) -> &'static str {
        match self {
            RecState::Idle => "idle",
            RecState::Starting => "starting",
            RecState::Recording => "recording",
            RecState::Stopping => "stopping",
        }
    }
}

/// What the ScreenCaptureKit callbacks have reported so far for a session.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Signals {
    /// `stream(_:didStopWithError:)`: the stream ended without our stop.
    pub stream_stopped: bool,
    /// `streamDidBecomeInactive`: every captured window went away.
    pub inactive: bool,
    /// `recordingOutputDidFinishRecording`.
    pub output_finished: bool,
    /// `recordingOutput(_:didFailWithError:)`.
    pub output_failed: bool,
}

/// Checked every second while recording: the stop the callbacks ask for.
/// Nothing outside `Recording`, so a callback that arrives after a stop (or a
/// second stop) does nothing.
pub fn signal_stop(state: RecState, s: Signals) -> Option<StopReason> {
    if state != RecState::Recording {
        return None;
    }
    if s.stream_stopped || s.inactive || s.output_finished {
        Some(StopReason::System)
    } else if s.output_failed {
        Some(StopReason::CaptureFailed)
    } else {
        None
    }
}

/// How the capture ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Finish {
    Done,
    Failed,
    TimedOut,
}

/// How the capture ended, from the result of removing the recording output
/// (`None` while it has not returned) and from the output's own callbacks,
/// which win: a finished file is kept even if the removal call failed
/// because the system had already stopped the stream.
pub fn finish_from(call: Option<bool>, s: Signals) -> Finish {
    if s.output_failed {
        Finish::Failed
    } else if s.output_finished {
        Finish::Done
    } else {
        match call {
            Some(true) => Finish::Done,
            Some(false) => Finish::Failed,
            None => Finish::TimedOut,
        }
    }
}

/// Whether the first bytes of a file look like an MP4 (an `ftyp` box).
pub fn looks_like_mp4(head: &[u8]) -> bool {
    head.len() >= 8 && &head[4..8] == b"ftyp"
}

/// The one terminal result of a stop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    /// Keep (finalize and rename) the file.
    pub keep: bool,
    pub event: RecEvent,
    pub error: Option<ErrorCode>,
}

/// What a stop does, from why it stopped and how the capture ended.
pub fn stop_outcome(reason: StopReason, finish: Finish) -> Outcome {
    match finish {
        Finish::TimedOut => Outcome { keep: false, event: RecEvent::Timeout, error: Some(ErrorCode::FinalizeTimeout) },
        // Stopped from a system control and the file did not finish: nothing
        // to keep, and nothing the user can retry, so it reads as a discard.
        Finish::Failed if reason == StopReason::System => Outcome { keep: false, event: RecEvent::Failed, error: None },
        Finish::Failed => Outcome { keep: false, event: RecEvent::Failed, error: Some(ErrorCode::FinalizeFailed) },
        Finish::Done => match reason {
            StopReason::Discard | StopReason::Restart => Outcome { keep: false, event: RecEvent::Finished, error: None },
            StopReason::CaptureFailed => {
                Outcome { keep: false, event: RecEvent::Failed, error: Some(ErrorCode::CaptureFailed) }
            }
            StopReason::LowDisk => Outcome { keep: true, event: RecEvent::Finished, error: Some(ErrorCode::DiskFull) },
            _ => Outcome { keep: true, event: RecEvent::Finished, error: None },
        },
    }
}

/// "saved", "discarded" or "error": the outcome name of a terminal event.
pub fn outcome_name(finished: bool, error: bool) -> &'static str {
    if error {
        "error"
    } else if finished {
        "saved"
    } else {
        "discarded"
    }
}

/// Why recording stopped on its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoStop {
    TimeLimit,
    LowDisk,
}

pub fn auto_stop(elapsed_secs: u64, free_bytes: Option<u64>) -> Option<AutoStop> {
    if elapsed_secs >= MAX_SECONDS {
        return Some(AutoStop::TimeLimit);
    }
    match free_bytes {
        Some(free) if free < MIN_FREE_WHILE_RECORDING => Some(AutoStop::LowDisk),
        _ => None,
    }
}

/// "00:12", "09:59", "10:00".
pub fn format_elapsed(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

/// The menu bar title while recording.
pub fn tray_title(secs: u64) -> String {
    format!("\u{25CF} {}", format_elapsed(secs))
}

/// Local date and time parts, as from `localtime_r`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

/// `Rokk-YYYY-MM-DD-HHMMSS` with `-2`, `-3`, ... after it when taken.
pub fn base_name(s: Stamp, n: u32) -> String {
    let base = format!(
        "Rokk-{:04}-{:02}-{:02}-{:02}{:02}{:02}",
        s.year, s.month, s.day, s.hour, s.minute, s.second
    );
    if n <= 1 {
        base
    } else {
        format!("{base}-{n}")
    }
}

/// The first final name that is free, together with its partial name.
/// `taken` says whether a file name already exists in the folder.
pub fn pick_names(s: Stamp, taken: impl Fn(&str) -> bool) -> Option<(String, String)> {
    (1..=999).find_map(|n| {
        let base = base_name(s, n);
        let final_name = format!("{base}.mp4");
        let partial = format!("{base}-partial.mp4");
        (!taken(&final_name) && !taken(&partial)).then_some((final_name, partial))
    })
}

/// The output folder, ~/Movies/Rokk.
pub fn output_dir(home: &Path) -> PathBuf {
    home.join("Movies").join("Rokk")
}

/// Accepts only a plain file name the app generated, inside ~/Movies/Rokk
/// once symlinks are resolved.
pub fn check_output(home: &Path, file: &Path) -> Result<PathBuf, RecordError> {
    let bad = || RecordError::new(ErrorCode::FolderNotWritable);
    if file.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(bad());
    }
    let name = file.file_name().and_then(|n| n.to_str()).ok_or_else(bad)?;
    let generated = name.starts_with("Rokk-")
        && name.ends_with(".mp4")
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.');
    if !generated {
        return Err(bad());
    }
    let dir = file.parent().ok_or_else(bad)?;
    let real_dir = std::fs::canonicalize(dir).map_err(|_| bad())?;
    let expected = std::fs::canonicalize(home).map_err(|_| bad())?.join("Movies").join("Rokk");
    if real_dir != expected {
        return Err(bad());
    }
    if std::fs::symlink_metadata(file).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(bad());
    }
    Ok(real_dir.join(name))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unsupported,
    OldMacos,
    NoPermission,
    NotInStage,
    Busy,
    FolderNotWritable,
    DiskFull,
    NoIndicator,
    WindowNotFound,
    CaptureFailed,
    FinalizeFailed,
    FinalizeTimeout,
    NotRecording,
    NotDeletable,
}

/// Every error code, for tests.
#[cfg(test)]
pub const ALL_ERROR_CODES: [ErrorCode; 14] = [
    ErrorCode::Unsupported,
    ErrorCode::OldMacos,
    ErrorCode::NoPermission,
    ErrorCode::NotInStage,
    ErrorCode::Busy,
    ErrorCode::FolderNotWritable,
    ErrorCode::DiskFull,
    ErrorCode::NoIndicator,
    ErrorCode::WindowNotFound,
    ErrorCode::CaptureFailed,
    ErrorCode::FinalizeFailed,
    ErrorCode::FinalizeTimeout,
    ErrorCode::NotRecording,
    ErrorCode::NotDeletable,
];

impl ErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            ErrorCode::Unsupported => "Recording works on macOS only.",
            ErrorCode::OldMacos => "Recording needs macOS 15 or later.",
            ErrorCode::NoPermission => "macOS has not allowed Rokk to record its window yet.",
            ErrorCode::NotInStage => "Recording works in stage mode only.",
            ErrorCode::Busy => "A recording is already running.",
            ErrorCode::FolderNotWritable => "Rokk cannot write to Movies/Rokk.",
            ErrorCode::DiskFull => "There is not enough free disk space to record.",
            ErrorCode::NoIndicator => "Rokk could not show the recording indicator in the menu bar, so it did not record.",
            ErrorCode::WindowNotFound => "Rokk could not find its own window to record.",
            ErrorCode::CaptureFailed => "The recording could not start or stopped unexpectedly.",
            ErrorCode::FinalizeFailed => "The recording could not be saved.",
            ErrorCode::FinalizeTimeout => "Saving the recording took too long, so it was stopped and not kept.",
            ErrorCode::NotRecording => "Nothing is being recorded.",
            ErrorCode::NotDeletable => "Rokk only deletes its own recordings in Movies/Rokk.",
        }
    }
}

/// Validates a recording to delete: an app-generated `.mp4` regular file in
/// ~/Movies/Rokk, after resolving symlinks and `..`.
pub fn check_delete(home: &Path, file: &Path) -> Result<PathBuf, RecordError> {
    let no = || RecordError::new(ErrorCode::NotDeletable);
    let real = check_output(home, file).map_err(|_| no())?;
    match std::fs::symlink_metadata(&real) {
        Ok(m) if m.is_file() => Ok(real),
        _ => Err(no()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RecordError {
    pub code: ErrorCode,
    pub message: String,
}

impl RecordError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, message: code.message().to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Stamp = Stamp { year: 2026, month: 11, day: 2, hour: 9, minute: 5, second: 7 };

    #[test]
    fn only_legal_transitions() {
        use RecEvent::*;
        use RecState::*;
        assert_eq!(transition(Idle, Start), Some(Starting));
        assert_eq!(transition(Starting, Started), Some(Recording));
        assert_eq!(transition(Recording, Stop), Some(Stopping));
        assert_eq!(transition(Stopping, Finished), Some(Idle));
        assert_eq!(transition(Starting, Failed), Some(Idle));
        assert_eq!(transition(Recording, Failed), Some(Stopping));
        assert_eq!(transition(Stopping, Timeout), Some(Idle));
        for bad in [(Idle, Stop), (Idle, Started), (Recording, Start), (Stopping, Start), (Starting, Stop), (Idle, Finished), (Recording, Timeout)] {
            assert_eq!(transition(bad.0, bad.1), None, "{bad:?}");
        }
    }

    #[test]
    fn names_follow_the_pattern_and_never_collide() {
        assert_eq!(base_name(S, 1), "Rokk-2026-11-02-090507");
        assert_eq!(pick_names(S, |_| false), Some(("Rokk-2026-11-02-090507.mp4".into(), "Rokk-2026-11-02-090507-partial.mp4".into())));
        let taken = ["Rokk-2026-11-02-090507.mp4", "Rokk-2026-11-02-090507-2-partial.mp4"];
        assert_eq!(
            pick_names(S, |n| taken.contains(&n)).unwrap().0,
            "Rokk-2026-11-02-090507-3.mp4"
        );
        assert_eq!(pick_names(S, |_| true), None);
    }

    #[test]
    fn elapsed_and_title() {
        assert_eq!(format_elapsed(0), "00:00");
        assert_eq!(format_elapsed(12), "00:12");
        assert_eq!(format_elapsed(599), "09:59");
        assert_eq!(format_elapsed(600), "10:00");
        assert_eq!(tray_title(12), "\u{25CF} 00:12");
    }

    #[test]
    fn caps_and_disk_thresholds() {
        assert_eq!(auto_stop(599, Some(MIN_FREE_WHILE_RECORDING)), None);
        assert_eq!(auto_stop(600, None), Some(AutoStop::TimeLimit));
        assert_eq!(auto_stop(10, Some(MIN_FREE_WHILE_RECORDING - 1)), Some(AutoStop::LowDisk));
        assert_eq!(auto_stop(10, None), None);
        assert!(MIN_FREE_TO_START > MIN_FREE_WHILE_RECORDING);
    }

    #[test]
    fn every_error_has_a_code_and_a_plain_message() {
        for c in ALL_ERROR_CODES {
            let e = serde_json::to_value(RecordError::new(c)).unwrap();
            assert!(e["code"].as_str().unwrap().chars().all(|ch| ch.is_ascii_lowercase() || ch == '_'));
            let m = e["message"].as_str().unwrap();
            assert!(m.ends_with('.') && !m.contains('\u{2014}'), "{m}");
        }
        assert_eq!(serde_json::to_value(ErrorCode::NoIndicator).unwrap(), "no_indicator");
    }

    #[test]
    fn every_stop_path_has_one_outcome() {
        use Finish::*;
        use StopReason::*;
        let saved = Outcome { keep: true, event: RecEvent::Finished, error: None };
        // Stop from the tray, the shortcut, a window close, the cap, quitting.
        for r in [Tray, Shortcut, System, WindowClosed, TimeLimit, AppExit] {
            assert_eq!(stop_outcome(r, Done), saved, "{r:?}");
        }
        assert_eq!(stop_outcome(Discard, Done), Outcome { keep: false, event: RecEvent::Finished, error: None });
        // Restart discards the take the same way; the main window records again.
        assert_eq!(stop_outcome(Restart, Done), stop_outcome(Discard, Done));
        assert_eq!(
            stop_outcome(LowDisk, Done),
            Outcome { keep: true, event: RecEvent::Finished, error: Some(ErrorCode::DiskFull) }
        );
        assert_eq!(stop_outcome(CaptureFailed, Done).error, Some(ErrorCode::CaptureFailed));
        // Finalize failure and the watchdog never keep a file, whatever the reason.
        for r in [Tray, Shortcut, Discard, WindowClosed, TimeLimit, LowDisk, AppExit, CaptureFailed] {
            let f = stop_outcome(r, Failed);
            assert_eq!((f.keep, f.event, f.error), (false, RecEvent::Failed, Some(ErrorCode::FinalizeFailed)));
        }
        for r in ALL_REASONS {
            let t = stop_outcome(r, TimedOut);
            assert_eq!((t.keep, t.event, t.error), (false, RecEvent::Timeout, Some(ErrorCode::FinalizeTimeout)));
        }
        // Every outcome is a legal step out of Stopping.
        for r in ALL_REASONS {
            for f in [Done, Failed, TimedOut] {
                assert_eq!(transition(RecState::Stopping, stop_outcome(r, f).event), Some(RecState::Idle));
            }
        }
    }

    const ALL_REASONS: [StopReason; 10] = [
        StopReason::Tray,
        StopReason::Shortcut,
        StopReason::Discard,
        StopReason::Restart,
        StopReason::System,
        StopReason::TimeLimit,
        StopReason::LowDisk,
        StopReason::WindowClosed,
        StopReason::AppExit,
        StopReason::CaptureFailed,
    ];

    #[test]
    fn reasons_have_stable_names() {
        let names: Vec<_> = ALL_REASONS.iter().map(|r| r.name()).collect();
        assert_eq!(
            names,
            ["tray", "shortcut", "discard", "restart", "system", "cap", "disk", "window_closed", "app_exit", "error"]
        );
        for r in ALL_REASONS {
            assert_eq!(serde_json::to_value(r).unwrap(), r.name());
        }
        assert_eq!(RecState::Stopping.name(), "stopping");
    }

    #[test]
    fn a_second_stop_does_nothing() {
        // The stop function steps Recording -> Stopping first; a second stop
        // (or a stop after the end) is refused before anything else happens.
        assert_eq!(transition(RecState::Recording, RecEvent::Stop), Some(RecState::Stopping));
        for s in [RecState::Stopping, RecState::Idle, RecState::Starting] {
            assert_eq!(transition(s, RecEvent::Stop), None, "{s:?}");
        }
    }

    #[test]
    fn callbacks_ask_for_a_system_stop_only_while_recording() {
        let stopped = Signals { stream_stopped: true, ..Default::default() };
        let inactive = Signals { inactive: true, ..Default::default() };
        let finished = Signals { output_finished: true, ..Default::default() };
        let failed = Signals { output_failed: true, ..Default::default() };
        for s in [stopped, inactive, finished] {
            assert_eq!(signal_stop(RecState::Recording, s), Some(StopReason::System));
        }
        assert_eq!(signal_stop(RecState::Recording, failed), Some(StopReason::CaptureFailed));
        assert_eq!(signal_stop(RecState::Recording, Signals::default()), None);
        // A callback after a user stop, or after the end: nothing.
        for state in [RecState::Stopping, RecState::Idle, RecState::Starting] {
            for s in [stopped, inactive, finished, failed] {
                assert_eq!(signal_stop(state, s), None);
            }
        }
    }

    #[test]
    fn system_stop_with_a_finished_file_is_saved() {
        let s = Signals { stream_stopped: true, output_finished: true, ..Default::default() };
        // The removal call fails once the system has stopped the stream; the
        // finished callback still wins.
        for call in [Some(false), Some(true), None] {
            assert_eq!(finish_from(call, s), Finish::Done);
        }
        let o = stop_outcome(StopReason::System, finish_from(Some(false), s));
        assert_eq!(o, Outcome { keep: true, event: RecEvent::Finished, error: None });
        assert_eq!(outcome_name(o.keep, o.error.is_some()), "saved");
    }

    #[test]
    fn system_stop_with_a_failed_output_is_discarded() {
        let s = Signals { stream_stopped: true, output_failed: true, ..Default::default() };
        for call in [Some(true), Some(false), None] {
            assert_eq!(finish_from(call, s), Finish::Failed);
        }
        let o = stop_outcome(StopReason::System, Finish::Failed);
        assert_eq!(o, Outcome { keep: false, event: RecEvent::Failed, error: None });
        assert_eq!(outcome_name(false, false), "discarded");
        // A stream that stopped with no output callback falls back to the call.
        let bare = Signals { stream_stopped: true, ..Default::default() };
        assert_eq!(finish_from(Some(false), bare), Finish::Failed);
        assert_eq!(finish_from(None, bare), Finish::TimedOut);
    }

    #[test]
    fn mp4_check_reads_the_ftyp_box() {
        assert!(looks_like_mp4(b"\x00\x00\x00\x18ftypmp42"));
        assert!(!looks_like_mp4(b""));
        assert!(!looks_like_mp4(b"\x00\x00\x00\x18moov"));
        assert!(!looks_like_mp4(b"ftyp"));
    }

    #[test]
    fn delete_accepts_only_our_recordings() {
        let (_d, h) = home();
        let dir = output_dir(&h);
        let ours = dir.join("Rokk-2026-11-02-090507.mp4");
        std::fs::write(&ours, b"x").unwrap();
        assert!(check_delete(&h, &ours).is_ok());
        // Missing, a folder, other names, other places, `..`.
        std::fs::create_dir(dir.join("Rokk-2026-11-02-090508.mp4")).unwrap();
        for bad in [
            dir.join("Rokk-2026-11-02-099999.mp4"),
            dir.join("Rokk-2026-11-02-090508.mp4"),
            dir.join("holiday.mp4"),
            dir.join("..").join("Rokk-2026-11-02-090507.mp4"),
            h.join("Rokk-2026-11-02-090507.mp4"),
        ] {
            let e = check_delete(&h, &bad).unwrap_err();
            assert_eq!(e.code, ErrorCode::NotDeletable, "{}", bad.display());
        }
    }

    #[cfg(unix)]
    #[test]
    fn delete_refuses_symlinks() {
        use std::os::unix::fs::symlink;
        let (_d, h) = home();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("keep.mp4");
        std::fs::write(&victim, b"x").unwrap();
        let link = output_dir(&h).join("Rokk-2026-11-02-090507.mp4");
        symlink(&victim, &link).unwrap();
        assert!(check_delete(&h, &link).is_err());
        assert!(victim.exists());
    }

    fn home() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let dir = output_dir(d.path());
        std::fs::create_dir_all(&dir).unwrap();
        let p = d.path().to_path_buf();
        (d, p)
    }

    #[test]
    fn output_paths_stay_in_movies_rokk() {
        let (_d, h) = home();
        let dir = output_dir(&h);
        assert!(check_output(&h, &dir.join("Rokk-2026-11-02-090507.mp4")).is_ok());
        assert!(check_output(&h, &dir.join("Rokk-2026-11-02-090507-partial.mp4")).is_ok());
        for bad in [
            dir.join("notes.mp4"),
            dir.join("Rokk-1.mov"),
            dir.join("Rokk-x y.mp4"),
            dir.join("..").join("Rokk-1.mp4"),
            h.join("Movies").join("Rokk-1.mp4"),
            PathBuf::from("/tmp/Rokk-1.mp4"),
        ] {
            assert!(check_output(&h, &bad).is_err(), "{}", bad.display());
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let h = d.path().to_path_buf();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(h.join("Movies")).unwrap();
        // ~/Movies/Rokk itself is a symlink elsewhere.
        symlink(outside.path(), output_dir(&h)).unwrap();
        assert!(check_output(&h, &output_dir(&h).join("Rokk-1.mp4")).is_err());
        std::fs::remove_file(output_dir(&h)).unwrap();
        // A file inside that is a symlink.
        std::fs::create_dir_all(output_dir(&h)).unwrap();
        let target = outside.path().join("victim.mp4");
        std::fs::write(&target, b"x").unwrap();
        symlink(&target, output_dir(&h).join("Rokk-1.mp4")).unwrap();
        assert!(check_output(&h, &output_dir(&h).join("Rokk-1.mp4")).is_err());
    }
}

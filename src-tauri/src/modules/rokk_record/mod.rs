// Rokk recording (Stage mode, Phase 2): records only the Rokk window to
// ~/Movies/Rokk as MP4, on macOS 15 and later. Fails closed: no capture
// without the menu bar indicator, stage mode and a visible user action.
// See docs/rokk/RECORD.md.

pub mod controller;
pub mod cursor;
pub mod logic;
pub mod zoom;
pub mod zoom_export;
#[cfg(target_os = "macos")]
mod mac;

use logic::{ErrorCode, RecState, RecordError};
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use tauri::AppHandle;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const EVENT: &str = "rokk-record-state";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatus {
    pub supported: bool,
    pub os_ok: bool,
    pub permission: bool,
    pub state: Option<RecState>,
    pub elapsed: u64,
    /// Why the last recording ended, for example "system".
    pub last_reason: Option<&'static str>,
    pub last_error_code: Option<ErrorCode>,
}

/// One state event. A terminal event has `state: "idle"` and carries
/// `finished` (the saved file) or `error`, or neither for a discard.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct StateEvent {
    state: RecState,
    elapsed: u64,
    finished: Option<String>,
    error: Option<RecordError>,
    /// "saved", "discarded" or "error" on the terminal event.
    #[serde(skip_serializing_if = "Option::is_none")]
    outcome: Option<&'static str>,
    /// Size in bytes of the saved file.
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    /// The saved mouse path file, on the terminal event (null when none).
    #[serde(skip_serializing_if = "Option::is_none")]
    sidecar: Option<Option<String>>,
    /// Why the mouse path was not saved although asked for ("write_failed").
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped_reason: Option<Option<&'static str>>,
    /// Why it ended, on the terminal event: "tray", "shortcut", "system", ...
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

impl StateEvent {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn progress(state: RecState, elapsed: u64) -> Self {
        Self {
            state,
            elapsed,
            finished: None,
            error: None,
            outcome: None,
            size: None,
            sidecar: None,
            skipped_reason: None,
            reason: None,
        }
    }

    /// The single terminal event of a recording.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn terminal(
        elapsed: u64,
        reason: Option<logic::StopReason>,
        finished: Option<String>,
        size: Option<u64>,
        error: Option<RecordError>,
        sidecar: Option<String>,
        skipped: Option<&'static str>,
    ) -> Self {
        let outcome = logic::outcome_name(finished.is_some(), error.is_some());
        Self {
            state: RecState::Idle,
            elapsed,
            finished,
            error,
            outcome: Some(outcome),
            size,
            sidecar: Some(sidecar),
            skipped_reason: Some(skipped),
            reason: reason.map(logic::StopReason::name),
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::logic::{self, AutoStop, Finish, RecEvent, StopReason};
    use std::io::Read;
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{Emitter, Manager};

    #[derive(Default)]
    struct Recorder {
        state: RecState,
        started: Option<Instant>,
        label: String,
        dir: PathBuf,
        final_name: String,
        partial: PathBuf,
        session: Option<mac::Session>,
        /// The mouse path thread, when Auto-zoom is on.
        tracker: Option<cursor::Tracker>,
        /// Kept across recordings for `record_status`.
        last_reason: Option<&'static str>,
        last_error_code: Option<ErrorCode>,
    }

    fn recorder() -> &'static Mutex<Recorder> {
        static R: OnceLock<Mutex<Recorder>> = OnceLock::new();
        R.get_or_init(Default::default)
    }

    fn lock() -> std::sync::MutexGuard<'static, Recorder> {
        recorder().lock().unwrap_or_else(|e| e.into_inner())
    }

    fn elapsed(r: &Recorder) -> u64 {
        r.started.map_or(0, |s| s.elapsed().as_secs())
    }

    fn emit_progress(app: &AppHandle, state: RecState, elapsed: u64) {
        let _ = app.emit(EVENT, StateEvent::progress(state, elapsed));
    }

    /// The single terminal event of a recording.
    fn emit_terminal(
        app: &AppHandle,
        elapsed: u64,
        reason: Option<StopReason>,
        finished: Option<String>,
        error: Option<RecordError>,
        sidecar: Option<String>,
        skipped: Option<&'static str>,
    ) {
        let size = finished.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
        let _ = app.emit(EVENT, StateEvent::terminal(elapsed, reason, finished, size, error, sidecar, skipped));
    }

    /// One legal state step, logged as "state a->b" (with the reason when known).
    fn step(r: &mut Recorder, ev: RecEvent, reason: Option<StopReason>) -> bool {
        match logic::transition(r.state, ev) {
            Some(next) => {
                match reason {
                    Some(why) => log::info!("[rokk_record] state {}->{} reason={}", r.state.name(), next.name(), why.name()),
                    None => log::info!("[rokk_record] state {}->{}", r.state.name(), next.name()),
                }
                r.state = next;
                true
            }
            None => false,
        }
    }

    /// Clears a finished recording, keeping what `record_status` reports.
    fn reset(r: &mut Recorder, reason: Option<StopReason>, error: Option<ErrorCode>) {
        *r = Recorder { last_reason: reason.map(StopReason::name), last_error_code: error, ..Recorder::default() };
    }

    pub fn status() -> RecordStatus {
        if let Some(home) = dirs::home_dir() {
            cursor::ensure_migrated(&home);
        }
        let r = lock();
        RecordStatus {
            supported: true,
            os_ok: mac::os_ok(),
            permission: mac::permission_granted(),
            state: Some(r.state),
            elapsed: elapsed(&r),
            last_reason: r.last_reason,
            last_error_code: r.last_error_code,
        }
    }

    pub fn request_permission() -> bool {
        mac::request_permission()
    }

    pub fn start(
        app: &AppHandle,
        label: &str,
        stage_on: bool,
        opts: cursor::Options,
    ) -> Result<RecordStatus, RecordError> {
        let err = |c| Err(RecordError::new(c));
        if !stage_on {
            return err(ErrorCode::NotInStage);
        }
        if !mac::os_ok() {
            return err(ErrorCode::OldMacos);
        }
        if !mac::permission_granted() {
            return err(ErrorCode::NoPermission);
        }
        let window = app.get_webview_window(label).ok_or_else(|| RecordError::new(ErrorCode::WindowNotFound))?;
        if !step(&mut lock(), RecEvent::Start, None) {
            return err(ErrorCode::Busy);
        }
        match prepare_and_capture(app, &window, label) {
            Ok(()) => {
                let now = Instant::now();
                let flags = {
                    let mut r = lock();
                    step(&mut r, RecEvent::Started, None);
                    r.started = Some(now);
                    r.session.as_ref().map(|s| s.flags())
                };
                // Started outside the lock: it reads the window through Tauri.
                if opts.cursor_track {
                    let tracker = cursor::Tracker::start(
                        window.clone(),
                        opts.frame,
                        move || flags.as_ref().and_then(|f| f.started()),
                        now,
                    );
                    let mut r = lock();
                    if r.state == RecState::Recording {
                        r.tracker = tracker;
                    } else {
                        drop(r);
                        let _ = tracker.and_then(cursor::Tracker::finish);
                    }
                }
                emit_progress(app, RecState::Recording, 0);
                controller::sync(app, label, RecState::Recording);
                spawn_ticker(app.clone());
                Ok(status())
            }
            Err(e) => {
                mac::remove_indicator(app);
                controller::sync(app, label, RecState::Idle);
                let partial = {
                    let mut r = lock();
                    let partial = std::mem::take(&mut r.partial);
                    step(&mut r, RecEvent::Failed, None);
                    reset(&mut r, None, Some(e.code));
                    partial
                };
                let _ = std::fs::remove_file(partial);
                emit_terminal(app, 0, None, None, Some(e.clone()), None, None);
                Err(e)
            }
        }
    }

    fn prepare_and_capture(app: &AppHandle, window: &tauri::WebviewWindow, label: &str) -> Result<(), RecordError> {
        let home = dirs::home_dir().ok_or_else(|| RecordError::new(ErrorCode::FolderNotWritable))?;
        let dir = logic::output_dir(&home);
        std::fs::create_dir_all(&dir).map_err(|_| RecordError::new(ErrorCode::FolderNotWritable))?;
        if mac::free_bytes(&dir).is_some_and(|f| f < logic::MIN_FREE_TO_START) {
            return Err(RecordError::new(ErrorCode::DiskFull));
        }
        let (final_name, partial_name) = logic::pick_names(mac::local_stamp(), |n| dir.join(n).exists())
            .ok_or_else(|| RecordError::new(ErrorCode::FolderNotWritable))?;
        let partial = logic::check_output(&home, &dir.join(&partial_name))?;
        cursor::ensure_migrated(&home);
        cursor::remove_orphans(&home);
        logic::check_output(&home, &dir.join(&final_name))?;
        // Writable: create the partial name once, then let the recorder own it.
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .map_err(|_| RecordError::new(ErrorCode::FolderNotWritable))?;
        let _ = std::fs::remove_file(&partial);
        {
            let mut r = lock();
            r.label = label.to_string();
            r.dir = partial.parent().map(PathBuf::from).unwrap_or_default();
            r.final_name = final_name;
            r.partial = partial.clone();
        }

        // The indicator first; without it nothing is captured.
        mac::create_indicator(app, |app, discard| {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = stop(&app, if discard { StopReason::Discard } else { StopReason::Tray });
            });
        })?;
        if !mac::indicator_exists(app) {
            return Err(RecordError::new(ErrorCode::NoIndicator));
        }
        // Created hidden the first time; best effort, never a reason to refuse.
        controller::ensure(app, label);

        let id = mac::window_number(window)?;
        let size = window.outer_size().map_err(|_| RecordError::new(ErrorCode::WindowNotFound))?;
        let session = mac::start(id, size.width, size.height, &partial)?;
        lock().session = Some(session);
        Ok(())
    }

    fn spawn_ticker(app: AppHandle) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let (secs, label, dir, signal) = {
                let r = lock();
                if r.state != RecState::Recording {
                    return;
                }
                let signals = r.session.as_ref().map(|s| s.flags().read()).unwrap_or_default();
                (elapsed(&r), r.label.clone(), r.dir.clone(), logic::signal_stop(r.state, signals))
            };
            // The crate has no "is the stream still running" query; the
            // callback flags read above are that check, once a second.
            let reason = if signal.is_some() {
                signal
            } else if app.get_webview_window(&label).is_none() {
                Some(StopReason::WindowClosed)
            } else {
                match logic::auto_stop(secs, mac::free_bytes(&dir)) {
                    Some(AutoStop::TimeLimit) => Some(StopReason::TimeLimit),
                    Some(AutoStop::LowDisk) => Some(StopReason::LowDisk),
                    None => None,
                }
            };
            if let Some(reason) = reason {
                let _ = stop(&app, reason);
                return;
            }
            mac::set_indicator_title(&app, &logic::tray_title(secs));
            emit_progress(&app, RecState::Recording, secs);
            // Hides it while the Rokk window is minimized or on another Space.
            controller::sync(&app, &label, RecState::Recording);
        });
    }

    /// Finishes the capture on its own thread, giving up after the watchdog.
    /// The recording output's own callbacks decide when they have spoken: a
    /// stream the system already stopped can fail the removal call while the
    /// file still finishes, so a failed call waits a short grace for them.
    fn finish_with_watchdog(session: Option<mac::Session>) -> Finish {
        let Some(session) = session else {
            return Finish::Failed;
        };
        let flags = session.flags();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(session.finish());
        });
        let deadline = Instant::now() + Duration::from_secs(logic::FINALIZE_TIMEOUT_SECS);
        let mut call: Option<bool> = None;
        let mut grace: Option<Instant> = None;
        loop {
            let s = flags.read();
            if s.output_finished || s.output_failed || call == Some(true) {
                break;
            }
            let now = Instant::now();
            if now >= deadline || grace.is_some_and(|g| now >= g) {
                break;
            }
            if call.is_none() {
                if let Ok(ok) = rx.recv_timeout(Duration::from_millis(100)) {
                    call = Some(ok);
                    if !ok {
                        grace = Some(now + Duration::from_secs(2));
                    }
                }
            } else {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let finish = logic::finish_from(call, flags.read());
        if finish == Finish::TimedOut {
            log::info!("[rokk_record] watchdog fired");
        }
        finish
    }

    /// Every way out of a recording ends here: the indicator goes, the file is
    /// finalized or deleted, then exactly one terminal event is emitted.
    pub fn stop(app: &AppHandle, reason: StopReason) -> Result<Option<String>, RecordError> {
        let (session, partial, dir, final_name, secs, label, tracker) = {
            let mut r = lock();
            if !step(&mut r, RecEvent::Stop, Some(reason)) {
                return Err(RecordError::new(ErrorCode::NotRecording));
            }
            (
                r.session.take(),
                r.partial.clone(),
                r.dir.clone(),
                r.final_name.clone(),
                elapsed(&r),
                r.label.clone(),
                r.tracker.take(),
            )
        };
        // The mouse path thread stops first, on every path.
        let track = tracker.and_then(cursor::Tracker::finish);
        mac::remove_indicator(app);
        controller::sync(app, &label, RecState::Stopping);
        emit_progress(app, RecState::Stopping, secs);
        let outcome = logic::stop_outcome(reason, finish_with_watchdog(session));
        let saved = if outcome.keep {
            finalize(&partial, &dir, &final_name)
        } else {
            let _ = std::fs::remove_file(&partial);
            Ok(None)
        };
        // A failed rename turns a finished stop into a failed one.
        let event = if saved.is_err() { RecEvent::Failed } else { outcome.event };
        let (finished, error) = match saved {
            Ok(path) => (path, outcome.error.map(RecordError::new)),
            Err(e) => (None, Some(e)),
        };
        match (&finished, &error) {
            (_, Some(e)) if e.code != ErrorCode::DiskFull => {
                let code = serde_json::to_value(e.code).ok().and_then(|v| v.as_str().map(String::from));
                log::info!("[rokk_record] finalize result=failed code={}", code.as_deref().unwrap_or("unknown"));
            }
            (Some(path), _) => {
                let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                log::info!("[rokk_record] finalize result=saved size={size}");
            }
            _ => log::info!("[rokk_record] finalize result=discarded"),
        }
        let (sidecar, skipped) = save_track(track, finished.as_deref(), reason);
        {
            let mut r = lock();
            step(&mut r, event, Some(reason));
            reset(&mut r, Some(reason), error.as_ref().map(|e| e.code));
        }
        emit_terminal(app, secs, Some(reason), finished.clone(), error.clone(), sidecar, skipped);
        match error {
            Some(e) if e.code != ErrorCode::DiskFull => Err(e),
            _ => Ok(finished),
        }
    }

    /// Writes the mouse path next to a saved recording. Discard, restart and
    /// errors write nothing; the in-memory track is dropped either way.
    fn save_track(
        track: Option<(cursor::Track, i64)>,
        finished: Option<&str>,
        reason: StopReason,
    ) -> (Option<String>, Option<&'static str>) {
        let requested = track.is_some();
        let (n, c, e) = track.as_ref().map(|(t, _)| (t.samples.len(), t.clicks.len(), t.events.len())).unwrap_or_default();
        let kept = finished.is_some() && cursor::end_reason(reason).is_some();
        let saved = match (track, finished, cursor::end_reason(reason)) {
            (Some((t, end_ms)), Some(mp4), Some(why)) => dirs::home_dir().and_then(|home| {
                let json = serde_json::to_vec(&cursor::sidecar(&t, end_ms, why)).ok()?;
                cursor::write(&home, std::path::Path::new(mp4), &json).ok()
            }),
            _ => None,
        };
        // Only a kept recording reports a skip; a discard just drops the track.
        let skipped = (kept && requested && saved.is_none()).then_some("write_failed");
        log::info!(
            "[rokk_record] cursor samples={n} clicks={c} events={e} skipped={}",
            skipped.unwrap_or("none")
        );
        (saved.map(|p| p.display().to_string()), skipped)
    }

    /// Renames the finalized partial file to a free final name; never overwrites.
    fn finalize(partial: &std::path::Path, dir: &std::path::Path, final_name: &str) -> Result<Option<String>, RecordError> {
        let fail = || {
            let _ = std::fs::remove_file(partial);
            RecordError::new(ErrorCode::FinalizeFailed)
        };
        if !partial.is_file() || !valid_mp4(partial) {
            return Err(fail());
        }
        let mut target = dir.join(final_name);
        if target.exists() {
            let stem = final_name.trim_end_matches(".mp4");
            target = (2..1000)
                .map(|n| dir.join(format!("{stem}-{n}.mp4")))
                .find(|p| !p.exists())
                .ok_or_else(fail)?;
        }
        std::fs::rename(partial, &target).map_err(|_| fail())?;
        Ok(Some(target.display().to_string()))
    }

    /// A non-empty file that starts with an MP4 `ftyp` box. Only the first
    /// 12 bytes are read, and never logged.
    fn valid_mp4(path: &std::path::Path) -> bool {
        let mut head = [0u8; 12];
        std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && logic::looks_like_mp4(&head)
    }

    /// Restart from the controller: discard this take, then ask the recording
    /// window to run its normal "Record again" flow (countdown, then start).
    pub fn restart(app: &AppHandle) -> Result<(), RecordError> {
        let label = lock().label.clone();
        stop(app, StopReason::Restart)?;
        app.emit_to(label.as_str(), controller::RESTART_EVENT, ())
            .map_err(|_| RecordError::new(ErrorCode::WindowNotFound))
    }

    pub fn delete(path: &str) -> Result<(), RecordError> {
        let home = dirs::home_dir().ok_or_else(|| RecordError::new(ErrorCode::NotDeletable))?;
        cursor::ensure_migrated(&home);
        let real = logic::check_delete(&home, std::path::Path::new(path))?;
        std::fs::remove_file(&real).map_err(|_| RecordError::new(ErrorCode::NotDeletable))?;
        // The mouse path goes with its recording.
        cursor::delete_for(&home, &real);
        Ok(())
    }

    /// Whether a recording is starting, running or stopping.
    pub fn is_recording() -> bool {
        lock().state != RecState::Idle
    }

    /// App is quitting: finalize a running recording first.
    pub fn on_exit(app: &AppHandle) {
        if lock().state == RecState::Recording {
            let _ = stop(app, StopReason::AppExit);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    fn unsupported<T>() -> Result<T, RecordError> {
        Err(RecordError::new(ErrorCode::Unsupported))
    }
    pub fn status() -> RecordStatus {
        RecordStatus::default()
    }
    pub fn request_permission() -> bool {
        false
    }
    pub fn start(_: &AppHandle, _: &str, _: bool, _: cursor::Options) -> Result<RecordStatus, RecordError> {
        unsupported()
    }
    pub fn stop(_: &AppHandle, _: logic::StopReason) -> Result<Option<String>, RecordError> {
        unsupported()
    }
    pub fn delete(_: &str) -> Result<(), RecordError> {
        unsupported()
    }
    pub fn restart(_: &AppHandle) -> Result<(), RecordError> {
        unsupported()
    }
    pub fn on_exit(_: &AppHandle) {}
    pub fn is_recording() -> bool {
        false
    }
}

pub fn on_exit(app: &AppHandle) {
    // A zoom export in progress is cancelled and its partial file deleted.
    zoom_export::on_exit();
    imp::on_exit(app);
}

/// Whether a recording is starting, running or stopping.
pub fn is_recording() -> bool {
    imp::is_recording()
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(work).await.expect("recorder task panicked")
}

#[tauri::command]
pub async fn record_status() -> RecordStatus {
    blocking(imp::status).await
}

#[tauri::command]
pub async fn record_request_permission() -> bool {
    blocking(imp::request_permission).await
}

#[tauri::command]
pub fn record_open_settings(app: AppHandle) -> Result<(), RecordError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", None::<&str>)
        .map_err(|_| RecordError::new(ErrorCode::Unsupported))
}

#[tauri::command]
pub async fn record_start(
    app: AppHandle,
    window_label: String,
    stage_on: bool,
    cursor_track: Option<bool>,
    frame: Option<cursor::CssRect>,
) -> Result<RecordStatus, RecordError> {
    let opts = cursor::Options { cursor_track: cursor_track.unwrap_or(false), frame };
    blocking(move || imp::start(&app, &window_label, stage_on, opts)).await
}

#[tauri::command]
pub async fn record_stop(app: AppHandle) -> Result<Option<String>, RecordError> {
    blocking(move || imp::stop(&app, logic::StopReason::Shortcut)).await
}

#[tauri::command]
pub async fn record_cancel(app: AppHandle) -> Result<Option<String>, RecordError> {
    blocking(move || imp::stop(&app, logic::StopReason::Discard)).await
}

/// "Discard" in the recording controller.
#[tauri::command]
pub async fn record_stop_discard(app: AppHandle) -> Result<Option<String>, RecordError> {
    blocking(move || imp::stop(&app, logic::StopReason::Discard)).await
}

/// "Restart" in the recording controller.
#[tauri::command]
pub async fn record_restart(app: AppHandle) -> Result<(), RecordError> {
    blocking(move || imp::restart(&app)).await
}

/// Deletes one of Rokk's own recordings in ~/Movies/Rokk, re-validated.
#[tauri::command]
pub async fn record_delete(path: String) -> Result<(), RecordError> {
    blocking(move || imp::delete(&path)).await
}

#[cfg(test)]
mod tests {
    use super::logic::{ErrorCode, RecState, RecordError, StopReason};
    use super::StateEvent;

    #[test]
    fn terminal_event_payload_shape() {
        let saved = serde_json::to_value(StateEvent::terminal(
            12,
            Some(StopReason::System),
            Some("/Users/x/Movies/Rokk/Rokk-2026-11-02-090507.mp4".into()),
            Some(4096),
            None,
            Some("/Users/x/Movies/Rokk/.zoom/Rokk-2026-11-02-090507.zoom.json".into()),
            None,
        ))
        .unwrap();
        assert_eq!(saved["state"], "idle");
        assert_eq!(saved["elapsed"], 12);
        assert_eq!(saved["outcome"], "saved");
        assert_eq!(saved["reason"], "system");
        assert_eq!(saved["size"], 4096);
        assert!(saved["error"].is_null());
        let keys: Vec<_> = saved.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys.len(), 9, "{keys:?}");
        assert_eq!(saved["sidecar"], "/Users/x/Movies/Rokk/.zoom/Rokk-2026-11-02-090507.zoom.json");
        assert!(saved["skippedReason"].is_null());

        let failed = serde_json::to_value(StateEvent::terminal(
            3,
            Some(StopReason::Tray),
            None,
            None,
            Some(RecordError::new(ErrorCode::FinalizeTimeout)),
            None,
            None,
        ))
        .unwrap();
        assert_eq!(failed["outcome"], "error");
        assert_eq!(failed["reason"], "tray");
        assert_eq!(failed["error"]["code"], "finalize_timeout");
        assert!(failed["finished"].is_null());
        assert!(failed.get("size").is_none());

        let discarded =
            serde_json::to_value(StateEvent::terminal(1, Some(StopReason::Discard), None, None, None, None, Some("write_failed")))
                .unwrap();
        assert_eq!(discarded["outcome"], "discarded");
        assert_eq!(discarded["skippedReason"], "write_failed");
        assert!(failed["sidecar"].is_null());

        // Progress events carry no outcome, size or reason.
        let p = serde_json::to_value(StateEvent::progress(RecState::Recording, 5)).unwrap();
        assert!(p.get("outcome").is_none() && p.get("reason").is_none() && p.get("size").is_none());
        assert!(p.get("sidecar").is_none() && p.get("skippedReason").is_none());
        assert_eq!(p["state"], "recording");
    }
}

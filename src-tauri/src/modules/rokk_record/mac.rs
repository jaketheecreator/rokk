// macOS parts: permission, the window id, ScreenCaptureKit and the menu bar
// indicator. Only the Rokk window is captured; no audio, no microphone.

use super::logic::{ErrorCode, RecordError, Signals, Stamp};
use screencapturekit::prelude::*;
use screencapturekit::stream::delegate_trait::StreamCallbacks;
use screencapturekit::recording_output::{
    RecordingCallbacks, SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputFileType,
};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, WebviewWindow};

pub const TRAY_ID: &str = "rokk-recording";
const STOP_ITEM: &str = "rokk-record-stop";
const DISCARD_ITEM: &str = "rokk-record-discard";

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn permission_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Shows the system prompt the first time; returns the current answer.
pub fn request_permission() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Recording straight to a file needs macOS 15.
pub fn os_ok() -> bool {
    SCRecordingOutput::is_available()
}

pub fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some(st.f_bavail as u64 * st.f_frsize as u64)
}

pub fn local_stamp() -> Stamp {
    let now = unsafe { libc::time(std::ptr::null_mut()) };
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&now, &mut tm) };
    Stamp {
        year: tm.tm_year + 1900,
        month: (tm.tm_mon + 1) as u32,
        day: tm.tm_mday as u32,
        hour: tm.tm_hour as u32,
        minute: tm.tm_min as u32,
        second: tm.tm_sec as u32,
    }
}

/// The window's CGWindowID (NSWindow `windowNumber`), read on the main thread.
pub fn window_number(window: &WebviewWindow) -> Result<u32, RecordError> {
    let not_found = || RecordError::new(ErrorCode::WindowNotFound);
    let (tx, rx) = std::sync::mpsc::channel();
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            let n = w.ns_window().ok().map(|ptr| {
                let obj = ptr.cast::<objc2::runtime::AnyObject>();
                let n: isize = unsafe { objc2::msg_send![&*obj, windowNumber] };
                n
            });
            let _ = tx.send(n);
        })
        .map_err(|_| not_found())?;
    match rx.recv_timeout(std::time::Duration::from_secs(2)) {
        Ok(Some(n)) if n > 0 => u32::try_from(n).map_err(|_| not_found()),
        _ => Err(not_found()),
    }
}

/// The menu bar item with "Stop recording" and "Stop and discard". Created
/// before capture. `on_stop` gets `true` for discard.
pub fn create_indicator(app: &AppHandle, on_stop: impl Fn(&AppHandle, bool) + Send + Sync + 'static) -> Result<(), RecordError> {
    let no = |_| RecordError::new(ErrorCode::NoIndicator);
    let stop = MenuItem::with_id(app, STOP_ITEM, "Stop recording", true, None::<&str>).map_err(no)?;
    let discard = MenuItem::with_id(app, DISCARD_ITEM, "Stop and discard", true, None::<&str>).map_err(no)?;
    let menu = Menu::with_items(app, &[&stop, &discard]).map_err(no)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .title(super::logic::tray_title(0))
        .tooltip("Rokk is recording its window")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                STOP_ITEM => on_stop(app, false),
                DISCARD_ITEM => on_stop(app, true),
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| {
            log::info!("[rokk_record] tray created ok=false visible=unknown");
            no(e)
        })?;
    // AppKit gives no reliable way to tell whether the item is on screen
    // (a notch or a menu bar setting can hide it), so visibility is unknown.
    log::info!("[rokk_record] tray created ok=true visible=unknown");
    Ok(())
}

pub fn indicator_exists(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

pub fn set_indicator_title(app: &AppHandle, title: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(Some(title));
    }
}

/// Removes the menu bar item on the main thread, where AppKit expects it.
pub fn remove_indicator(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = handle.remove_tray_by_id(TRAY_ID);
    });
}

/// The callback flags of one session. Callbacks only set flags and log; the
/// one-second tick turns them into a stop, so no callback ever blocks the
/// ScreenCaptureKit queue it runs on.
#[derive(Default)]
pub struct Flags {
    stream_stopped: AtomicBool,
    inactive: AtomicBool,
    output_finished: AtomicBool,
    output_failed: AtomicBool,
}

impl Flags {
    pub fn read(&self) -> Signals {
        Signals {
            stream_stopped: self.stream_stopped.load(Ordering::Acquire),
            inactive: self.inactive.load(Ordering::Acquire),
            output_finished: self.output_finished.load(Ordering::Acquire),
            output_failed: self.output_failed.load(Ordering::Acquire),
        }
    }
}

/// A running capture of one window into one file.
pub struct Session {
    stream: SCStream,
    output: SCRecordingOutput,
    flags: Arc<Flags>,
}

impl Session {
    pub fn flags(&self) -> Arc<Flags> {
        self.flags.clone()
    }

    /// Stops the capture and waits until the file is finalized. `true` when
    /// the recording output was removed cleanly.
    pub fn finish(self) -> bool {
        let removed = self.stream.remove_recording_output(&self.output).is_ok();
        let _ = self.stream.stop_capture();
        removed
    }
}

fn stream_callbacks(flags: &Arc<Flags>) -> StreamCallbacks {
    let (stopped, inactive) = (flags.clone(), flags.clone());
    StreamCallbacks::new()
        .on_error(move |error| {
            let code = error.stream_error_code().map(|c| c.as_raw().to_string());
            log::info!("[rokk_record] callback stream_did_stop error={}", code.as_deref().unwrap_or("none"));
            stopped.stream_stopped.store(true, Ordering::Release);
        })
        .on_inactive(move || {
            log::info!("[rokk_record] callback stream_did_become_inactive");
            inactive.inactive.store(true, Ordering::Release);
        })
        .on_active(|| log::info!("[rokk_record] callback stream_did_become_active"))
        .on_video_effect_start(|| log::info!("[rokk_record] callback video_effect_did_start"))
        .on_video_effect_stop(|| log::info!("[rokk_record] callback video_effect_did_stop"))
}

fn recording_callbacks(flags: &Arc<Flags>) -> RecordingCallbacks {
    let (failed, finished) = (flags.clone(), flags.clone());
    RecordingCallbacks::new()
        .on_start(|| log::info!("[rokk_record] callback recording_did_start"))
        // The message is not logged; only that it failed.
        .on_fail(move |_| {
            log::info!("[rokk_record] callback recording_did_fail");
            failed.output_failed.store(true, Ordering::Release);
        })
        .on_finish(move || {
            log::info!("[rokk_record] callback recording_did_finish");
            finished.output_finished.store(true, Ordering::Release);
        })
}

/// Starts capturing the window with `window_id` into `partial` (MP4, H.264,
/// 30 fps, cursor shown, no audio).
pub fn start(window_id: u32, width: u32, height: u32, partial: &Path) -> Result<Session, RecordError> {
    let capture = |_| RecordError::new(ErrorCode::CaptureFailed);
    let content = SCShareableContent::get().map_err(|_| RecordError::new(ErrorCode::NoPermission))?;
    let window = content
        .windows()
        .into_iter()
        .find(|w| w.window_id() == window_id)
        .ok_or_else(|| RecordError::new(ErrorCode::WindowNotFound))?;
    let filter = SCContentFilter::create().with_window(&window).build().map_err(capture)?;
    let config = SCStreamConfiguration::new()
        .with_width(width.max(2))
        .with_height(height.max(2))
        .with_minimum_frame_interval(&CMTime::new(1, 30))
        .with_shows_cursor(true)
        .with_captures_audio(false);

    let flags = Arc::new(Flags::default());
    let recording = SCRecordingOutputConfiguration::new()
        .map_err(capture)?
        .with_output_url(partial)
        .map_err(|_| RecordError::new(ErrorCode::FolderNotWritable))?
        .with_video_codec(SCRecordingOutputCodec::H264)
        .with_output_file_type(SCRecordingOutputFileType::MP4);
    let output = SCRecordingOutput::new_with_delegate(&recording, recording_callbacks(&flags))
        .ok_or_else(|| RecordError::new(ErrorCode::OldMacos))?;
    let stream = SCStream::new_with_delegate(&filter, &config, stream_callbacks(&flags)).map_err(capture)?;
    stream.add_recording_output(&output).map_err(capture)?;
    if stream.start_capture().is_err() {
        let _ = stream.remove_recording_output(&output);
        return Err(RecordError::new(ErrorCode::CaptureFailed));
    }
    Ok(Session { stream, output, flags })
}

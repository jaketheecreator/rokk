// The recording controller: a small separate window with the timer, Stop,
// Discard and Restart, at the bottom center of the Rokk window. It is a
// separate window because the capture records only the Rokk window itself
// (a desktop-independent window filter), so anything drawn inside that window
// would be in the video. The controller only sends commands; the recorder's
// state stays the single source of truth. See docs/rokk/RECORD.md.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::logic::RecState;

pub const LABEL: &str = "rokk-recorder";
/// Logical size of the controller window.
pub const WIDTH: f64 = 380.0;
pub const HEIGHT: f64 = 56.0;
/// Gap between the controller and the bottom edge of the Rokk window.
pub const BOTTOM_GAP: f64 = 28.0;
/// At most one reposition per this many milliseconds.
pub const THROTTLE_MS: u64 = 50;
/// Sent to the recording window after a restart discarded the take.
pub const RESTART_EVENT: &str = "rokk-record-restart";
/// The only commands the controller page calls.
#[cfg_attr(not(test), allow(dead_code))]
pub const COMMANDS: [&str; 3] = ["record_stop", "record_stop_discard", "record_restart"];

/// A rectangle in logical points (macOS global coordinates, top left origin).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    /// From Tauri's physical position and size, using that window's or
    /// display's own scale factor.
    pub fn from_physical(x: i32, y: i32, w: u32, h: u32, scale: f64) -> Rect {
        let s = if scale > 0.0 { scale } else { 1.0 };
        Rect { x: f64::from(x) / s, y: f64::from(y) / s, w: f64::from(w) / s, h: f64::from(h) / s }
    }
}

/// The controller's logical top left: centered on the Rokk window, its
/// bottom edge `BOTTOM_GAP` above the window's bottom edge, then kept fully
/// inside the display the Rokk window is on.
pub fn place(main: Rect, display: Option<Rect>) -> (f64, f64) {
    let mut x = main.x + (main.w - WIDTH) / 2.0;
    let mut y = main.y + main.h - BOTTOM_GAP - HEIGHT;
    if let Some(d) = display {
        x = x.clamp(d.x, (d.x + d.w - WIDTH).max(d.x));
        y = y.clamp(d.y, (d.y + d.h - HEIGHT).max(d.y));
    }
    (x.round(), y.round())
}

/// What to do with a move or resize event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tick {
    /// Reposition now.
    Now,
    /// Reposition once after this many milliseconds (the trailing update).
    Later(u64),
    /// A trailing update is already scheduled.
    Skip,
}

/// One reposition per `THROTTLE_MS`, with a trailing update so the last
/// position of a drag is always applied.
#[derive(Clone, Copy, Debug, Default)]
pub struct Throttle {
    last: Option<u64>,
    pending: bool,
}

impl Throttle {
    pub fn hit(&mut self, now_ms: u64) -> Tick {
        match self.last {
            Some(last) if now_ms < last + THROTTLE_MS => {
                if self.pending {
                    Tick::Skip
                } else {
                    self.pending = true;
                    Tick::Later(last + THROTTLE_MS - now_ms)
                }
            }
            _ => {
                self.last = Some(now_ms);
                Tick::Now
            }
        }
    }

    /// The trailing update ran.
    pub fn fired(&mut self, now_ms: u64) {
        self.pending = false;
        self.last = Some(now_ms);
    }
}

/// Shown only while recording, and only when the Rokk window is on screen
/// in the current Space.
pub fn should_show(state: RecState, main_minimized: bool, main_on_active_space: bool) -> bool {
    state == RecState::Recording && !main_minimized && main_on_active_space
}

/// The log line for the sharing type read back after setting it to none.
/// The sharing type is only an extra layer: a failure is logged and the
/// recording goes on, because the single-window capture is the guarantee.
pub fn sharing_line(read_back: Result<usize, &str>) -> String {
    match read_back {
        Ok(v) => format!("[rokk_record] controller sharing_type={v}"),
        Err(e) => format!("[rokk_record] controller sharing_type=error {e}"),
    }
}

#[cfg(target_os = "macos")]
pub use mac::{ensure, sync};

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2_app_kit::{NSWindow, NSWindowSharingType};
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

    /// 0 unknown, 1 shown, 2 hidden: skips repeated show or hide calls.
    static SHOWN: AtomicU8 = AtomicU8::new(0);

    fn clock() -> u64 {
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    fn throttle() -> std::sync::MutexGuard<'static, Throttle> {
        static T: OnceLock<Mutex<Throttle>> = OnceLock::new();
        T.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Creates the hidden controller window the first time it is needed and
    /// starts following `main_label`. Best effort: if it cannot be created,
    /// recording goes on with the menu bar item and the shortcuts.
    pub fn ensure(app: &AppHandle, main_label: &str) {
        if app.get_webview_window(LABEL).is_some() {
            return;
        }
        let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("recorder.html".into()))
            .title("Rokk recording controls")
            .inner_size(WIDTH, HEIGHT)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible_on_all_workspaces(false)
            .focused(false)
            // A click works without first making the window key.
            .accept_first_mouse(true)
            // Extra layer only (sharing type none); not the guarantee.
            .content_protected(true)
            .visible(false)
            .build();
        let window = match built {
            Ok(w) => w,
            Err(_) => {
                log::info!("[rokk_record] controller created ok=false");
                return;
            }
        };
        log::info!("[rokk_record] controller created ok=true");
        set_sharing_none(&window);
        if let Some(main) = app.get_webview_window(main_label) {
            let handle = app.clone();
            let label = main_label.to_string();
            main.on_window_event(move |event| {
                if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                    on_main_moved(&handle, &label);
                }
            });
        }
    }

    /// Sets the sharing type to none on the main thread and logs what reads back.
    fn set_sharing_none(window: &WebviewWindow) {
        let w = window.clone();
        let queued = window.run_on_main_thread(move || {
            let line = match w.ns_window() {
                Ok(ptr) => {
                    // Tauri owns this NSWindow; this runs on the main thread.
                    let native = unsafe { &*ptr.cast::<NSWindow>() };
                    native.setSharingType(NSWindowSharingType::None);
                    sharing_line(Ok(native.sharingType().0))
                }
                Err(_) => sharing_line(Err("no_window")),
            };
            log::info!("{line}");
        });
        if queued.is_err() {
            log::info!("{}", sharing_line(Err("main_thread")));
        }
    }

    fn on_main_moved(app: &AppHandle, label: &str) {
        let tick = throttle().hit(clock());
        match tick {
            Tick::Now => reposition(app, label),
            Tick::Skip => {}
            Tick::Later(ms) => {
                let (app, label) = (app.clone(), label.to_string());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    throttle().fired(clock());
                    reposition(&app, &label);
                });
            }
        }
    }

    fn reposition(app: &AppHandle, label: &str) {
        let (Some(main), Some(ctrl)) = (app.get_webview_window(label), app.get_webview_window(LABEL)) else {
            return;
        };
        let (Ok(pos), Ok(size), Ok(scale)) = (main.outer_position(), main.outer_size(), main.scale_factor()) else {
            return;
        };
        let rect = Rect::from_physical(pos.x, pos.y, size.width, size.height, scale);
        let display = main.current_monitor().ok().flatten().map(|m| {
            let (p, s) = (m.position(), m.size());
            Rect::from_physical(p.x, p.y, s.width, s.height, m.scale_factor())
        });
        let (x, y) = place(rect, display);
        let _ = ctrl.set_position(LogicalPosition::new(x, y));
    }

    /// Shows or hides the controller for `state`, following the Rokk window
    /// labelled `label`. Showing uses `orderFrontRegardless`, which puts the
    /// window on screen without taking keyboard focus from the Rokk window.
    pub fn sync(app: &AppHandle, label: &str, state: RecState) {
        let Some(ctrl) = app.get_webview_window(LABEL) else {
            return;
        };
        if state == RecState::Recording {
            reposition(app, label);
        }
        let main = app.get_webview_window(label);
        let _ = app.run_on_main_thread(move || {
            let (minimized, on_space) = main
                .and_then(|m| m.ns_window().ok())
                .map(|ptr| {
                    let native = unsafe { &*ptr.cast::<NSWindow>() };
                    (native.isMiniaturized(), native.isOnActiveSpace())
                })
                .unwrap_or((true, false));
            let show = should_show(state, minimized, on_space);
            let want = if show { 1 } else { 2 };
            if SHOWN.swap(want, Ordering::AcqRel) == want {
                return;
            }
            if let Ok(ptr) = ctrl.ns_window() {
                let native = unsafe { &*ptr.cast::<NSWindow>() };
                if show {
                    native.orderFrontRegardless();
                } else {
                    native.orderOut(None);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISPLAY: Rect = Rect { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 };

    #[test]
    fn bottom_center_28_above_the_bottom_edge() {
        let main = Rect { x: 100.0, y: 50.0, w: 1000.0, h: 700.0 };
        let (x, y) = place(main, Some(DISPLAY));
        assert_eq!(x, 100.0 + (1000.0 - WIDTH) / 2.0);
        assert_eq!(y + HEIGHT, 50.0 + 700.0 - BOTTOM_GAP);
    }

    #[test]
    fn scale_factors_one_and_two_give_the_same_logical_place() {
        let one = Rect::from_physical(100, 50, 1000, 700, 1.0);
        let two = Rect::from_physical(200, 100, 2000, 1400, 2.0);
        assert_eq!(one, two);
        assert_eq!(place(one, Some(DISPLAY)), place(two, Some(DISPLAY)));
        // A bad scale factor falls back to 1.
        assert_eq!(Rect::from_physical(10, 10, 10, 10, 0.0).w, 10.0);
    }

    #[test]
    fn small_windows_stay_centered_and_inside_the_display() {
        let main = Rect { x: 600.0, y: 400.0, w: 200.0, h: 60.0 };
        let (x, y) = place(main, Some(DISPLAY));
        assert_eq!(x, 600.0 + (200.0 - WIDTH) / 2.0);
        assert!(x >= DISPLAY.x && y >= DISPLAY.y);
        assert!(y + HEIGHT <= DISPLAY.y + DISPLAY.h);
    }

    #[test]
    fn a_second_display_is_used_as_is() {
        // A display to the right of the primary one, and one above it.
        let right = Rect { x: 1512.0, y: -200.0, w: 2560.0, h: 1440.0 };
        let main = Rect { x: 2000.0, y: 0.0, w: 1200.0, h: 800.0 };
        let (x, y) = place(main, Some(right));
        assert_eq!((x, y), (2000.0 + (1200.0 - WIDTH) / 2.0, 800.0 - BOTTOM_GAP - HEIGHT));
        let above = Rect { x: 0.0, y: -1080.0, w: 1920.0, h: 1080.0 };
        let main = Rect { x: 100.0, y: -1000.0, w: 800.0, h: 600.0 };
        assert_eq!(place(main, Some(above)).1, -1000.0 + 600.0 - BOTTOM_GAP - HEIGHT);
    }

    #[test]
    fn clamped_inside_the_display() {
        // The window hangs off the left and the bottom of the display.
        let main = Rect { x: -300.0, y: 900.0, w: 400.0, h: 400.0 };
        let (x, y) = place(main, Some(DISPLAY));
        assert_eq!(x, 0.0);
        assert_eq!(y, DISPLAY.h - HEIGHT);
        // Off the right edge.
        let main = Rect { x: 1400.0, y: 100.0, w: 600.0, h: 400.0 };
        assert_eq!(place(main, Some(DISPLAY)).0, DISPLAY.w - WIDTH);
        // No display known: no clamping.
        assert_eq!(place(Rect { x: -300.0, y: 0.0, w: 400.0, h: 400.0 }, None).0, -300.0 + (400.0 - WIDTH) / 2.0);
    }

    #[test]
    fn throttle_one_update_per_50_ms_with_a_trailing_one() {
        let mut t = Throttle::default();
        assert_eq!(t.hit(1000), Tick::Now);
        assert_eq!(t.hit(1010), Tick::Later(40));
        assert_eq!(t.hit(1020), Tick::Skip);
        assert_eq!(t.hit(1049), Tick::Skip);
        t.fired(1050);
        assert_eq!(t.hit(1060), Tick::Later(40));
        t.fired(1100);
        assert_eq!(t.hit(1150), Tick::Now);
        assert_eq!(t.hit(1300), Tick::Now);
    }

    #[test]
    fn shown_only_while_recording_and_on_screen() {
        assert!(should_show(RecState::Recording, false, true));
        for s in [RecState::Idle, RecState::Starting, RecState::Stopping] {
            assert!(!should_show(s, false, true), "{s:?}");
        }
        assert!(!should_show(RecState::Recording, true, true));
        assert!(!should_show(RecState::Recording, false, false));
    }

    #[test]
    fn sharing_type_failure_is_logged_not_refused() {
        assert_eq!(sharing_line(Ok(0)), "[rokk_record] controller sharing_type=0");
        assert_eq!(sharing_line(Err("no_window")), "[rokk_record] controller sharing_type=error no_window");
        // `ensure` returns nothing, so the recorder has no controller error to
        // refuse with; no error message mentions hiding the controls.
        for code in super::super::logic::ALL_ERROR_CODES {
            assert!(!code.message().contains("hide the recording controls"), "{code:?}");
        }
    }

    #[test]
    fn controller_capability_is_minimal() {
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../../../capabilities/recorder.json")).unwrap();
        assert_eq!(cap["windows"], serde_json::json!([LABEL]));
        assert_eq!(cap["permissions"], serde_json::json!(["core:event:allow-listen", "core:event:allow-unlisten"]));
        // The main window's capabilities do not name the controller.
        for other in [include_str!("../../../capabilities/default.json"), include_str!("../../../capabilities/desktop.json")] {
            assert!(!other.contains(LABEL));
        }
    }

    #[test]
    fn the_page_calls_only_the_three_commands() {
        let page = include_str!("../../../../src/modules/rokk-recorder/recorder.ts");
        let called: Vec<&str> = page
            .split("invoke(\"")
            .skip(1)
            .filter_map(|rest| rest.split('"').next())
            .collect();
        assert!(!called.is_empty());
        for c in &called {
            assert!(COMMANDS.contains(c), "{c}");
        }
        for c in COMMANDS {
            assert!(called.contains(&c), "{c}");
        }
    }
}

// Auto-zoom, Phase A: the mouse path saved next to a recording, so a later
// phase can zoom the finished video. Only numbers are kept (times,
// coordinates, button ids), in memory until the recording is saved. See
// docs/rokk/RECORD.md and docs/rokk/ZOOM_MAP.md.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::logic::{self, ErrorCode, RecordError, StopReason};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const VERSION: u32 = 1;
pub const HZ: u32 = 30;
pub const NOTE: &str = "Mouse path only. Contains no screen content.";
pub const MAX_SAMPLES: usize = 40_000;
pub const MAX_CLICKS: usize = 10_000;
pub const MAX_EVENTS: usize = 1_000;
pub const SUFFIX: &str = ".zoom.json";
/// Mouse path files live in ~/Movies/Rokk/.zoom, hidden from Finder.
pub const HIDDEN_DIR: &str = ".zoom";
/// Created in .zoom once the one-time move from the old place is done.
pub const MIGRATED_MARKER: &str = ".migrated-v1";

/// The stage frame rectangle from the page, in CSS pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// What `record_start` gets for the mouse path.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub cursor_track: bool,
    /// Sent by the page only at app zoom 100%, where CSS pixels are points.
    pub frame: Option<CssRect>,
}

/// The Rokk window in global points (top left origin of the main display),
/// with its backing scale factor.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Win {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
    /// Top left of the display the window is on, in points.
    pub display: (f64, f64),
}

impl Win {
    /// From Tauri's physical outer position and size and the window's scale.
    pub fn from_physical(x: i32, y: i32, w: u32, h: u32, scale: f64, display: (i32, i32)) -> Win {
        let s = if scale > 0.0 { scale } else { 1.0 };
        Win {
            x: f64::from(x) / s,
            y: f64::from(y) / s,
            w: f64::from(w) / s,
            h: f64::from(h) / s,
            scale: s,
            display: (f64::from(display.0) / s, f64::from(display.1) / s),
        }
    }
}

/// A global cursor point (points) in video pixels, or `None` outside the window.
pub fn to_video(p: (f64, f64), win: &Win) -> Option<(i64, i64)> {
    let (dx, dy) = (p.0 - win.x, p.1 - win.y);
    if dx < 0.0 || dy < 0.0 || dx >= win.w || dy >= win.h {
        return None;
    }
    Some(((dx * win.scale).round() as i64, (dy * win.scale).round() as i64))
}

/// The stage frame (CSS pixels, page zoom 1) in video pixels. The web view
/// fills the window (overlay title bar), so CSS (0, 0) is the window's top left.
pub fn frame_to_video(r: CssRect, scale: f64) -> Rect {
    let px = |v: f64| (v * scale).round() as i64;
    Rect { x: px(r.x), y: px(r.y), w: px(r.w), h: px(r.h) }
}

/// Buttons that went down since the last poll. Bit 0 is left, bit 1 right.
pub fn pressed(prev: u8, now: u8) -> impl Iterator<Item = u8> {
    (0..2u8).filter(move |b| now & (1 << b) != 0 && prev & (1 << b) == 0)
}

/// What changed about the window, if anything, by priority.
pub fn change(prev: &Win, now: &Win) -> Option<&'static str> {
    if (prev.scale - now.scale).abs() > f64::EPSILON {
        Some("scale")
    } else if prev.display != now.display {
        Some("display")
    } else if (prev.w - now.w).abs() > 0.5 || (prev.h - now.h).abs() > 0.5 {
        Some("resize")
    } else if (prev.x - now.x).abs() > 0.5 || (prev.y - now.y).abs() > 0.5 {
        Some("move")
    } else {
        None
    }
}

/// The end reason written to the file, or `None` when the recording is not
/// kept (discard, restart, error), which writes nothing.
pub fn end_reason(reason: StopReason) -> Option<&'static str> {
    match reason {
        StopReason::Discard | StopReason::Restart | StopReason::CaptureFailed => None,
        other => Some(other.name()),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    pub t_ms: i64,
    pub kind: &'static str,
    /// The window's new rectangle in pixels, global coordinates.
    pub rect: Rect,
}

/// The mouse path in memory.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Track {
    pub video: (i64, i64),
    pub scale: f64,
    /// The stage frame in video pixels, when the page could give it.
    pub frame: Option<Rect>,
    pub samples: Vec<[i64; 3]>,
    pub clicks: Vec<[i64; 4]>,
    pub events: Vec<Event>,
    /// The sample cap was reached; sampling stopped there.
    pub capped: bool,
}

impl Track {
    pub fn sample(&mut self, t_ms: i64, p: Option<(i64, i64)>) {
        let Some((x, y)) = p else { return };
        if self.samples.len() >= MAX_SAMPLES {
            self.capped = true;
            return;
        }
        self.samples.push([t_ms, x, y]);
    }

    pub fn click(&mut self, t_ms: i64, p: Option<(i64, i64)>, button: u8) {
        if let Some((x, y)) = p {
            if self.clicks.len() < MAX_CLICKS {
                self.clicks.push([t_ms, x, y, i64::from(button)]);
            }
        }
    }

    pub fn event(&mut self, t_ms: i64, kind: &'static str, win: &Win) {
        if self.events.len() < MAX_EVENTS {
            let px = |v: f64| (v * win.scale).round() as i64;
            self.events.push(Event { t_ms, kind, rect: Rect { x: px(win.x), y: px(win.y), w: px(win.w), h: px(win.h) } });
        }
    }
}

#[derive(Serialize)]
struct Video {
    width: i64,
    height: i64,
    scale: f64,
}

#[derive(Serialize)]
struct End {
    t_ms: i64,
    reason: &'static str,
}

/// The file, version 1.
#[derive(Serialize)]
pub struct Sidecar<'a> {
    version: u32,
    note: &'static str,
    video: Video,
    /// Null when the page gave no frame (app zoom not 100%); a later phase
    /// then zooms within the whole video.
    frame: Option<Rect>,
    hz: u32,
    samples: &'a [[i64; 3]],
    clicks: &'a [[i64; 4]],
    events: &'a [Event],
    end: End,
}

pub fn sidecar<'a>(track: &'a Track, end_ms: i64, reason: &'static str) -> Sidecar<'a> {
    Sidecar {
        version: VERSION,
        note: NOTE,
        video: Video { width: track.video.0, height: track.video.1, scale: track.scale },
        frame: track.frame,
        hz: HZ,
        samples: &track.samples,
        clicks: &track.clicks,
        events: &track.events,
        end: End { t_ms: end_ms, reason },
    }
}

/// `Rokk-...-HHMMSS.mp4` gives `Rokk-...-HHMMSS.zoom.json`.
pub fn sidecar_name(mp4_name: &str) -> Option<String> {
    let stem = mp4_name.strip_suffix(".mp4")?;
    (!stem.is_empty() && !stem.ends_with("-partial")).then(|| format!("{stem}{SUFFIX}"))
}

/// The MP4 a sidecar name belongs to.
pub fn video_name(sidecar: &str) -> Option<String> {
    let stem = sidecar.strip_suffix(SUFFIX)?;
    (!stem.is_empty()).then(|| format!("{stem}.mp4"))
}

/// A sidecar name for an original recording:
/// `Rokk-YYYY-MM-DD-HHMMSS[-N].zoom.json`.
pub fn sidecar_file_name(name: &str) -> bool {
    video_name(name).is_some_and(|mp4| logic::recording_name(&mp4))
}

/// The sidecar folder as a plain path (not resolved, not created).
pub fn sidecar_dir(home: &Path) -> PathBuf {
    logic::output_dir(home).join(HIDDEN_DIR)
}

/// ~/Movies/Rokk once symlinks are resolved, if it exists there.
fn real_rokk(home: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(logic::output_dir(home)).ok()?;
    let expected = std::fs::canonicalize(home).ok()?.join("Movies").join("Rokk");
    (real == expected).then_some(real)
}

/// The real .zoom folder: a directory, never a symlink or a file. With
/// `create` it is made when missing (default permissions).
fn hidden_dir(home: &Path, create: bool) -> Result<PathBuf, RecordError> {
    let bad = || RecordError::new(ErrorCode::FolderNotWritable);
    let dir = real_rokk(home).ok_or_else(bad)?.join(HIDDEN_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(m) if m.is_dir() => Ok(dir),
        Ok(_) => Err(bad()),
        Err(_) if create => {
            std::fs::create_dir(&dir).map_err(|_| bad())?;
            hidden_dir(home, false)
        }
        Err(_) => Err(bad()),
    }
}

/// Validates a sidecar path: a generated name for an original recording,
/// directly inside ~/Movies/Rokk/.zoom after resolving symlinks, no `..`,
/// the folder a real directory and the file not a symlink. The old place
/// next to the MP4 is refused.
pub fn check_sidecar(home: &Path, file: &Path) -> Result<PathBuf, RecordError> {
    let bad = || RecordError::new(ErrorCode::NotDeletable);
    if file.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(bad());
    }
    let name = file.file_name().and_then(|n| n.to_str()).ok_or_else(bad)?;
    if !sidecar_file_name(name) {
        return Err(bad());
    }
    let parent = file.parent().ok_or_else(bad)?;
    if parent.file_name().and_then(|n| n.to_str()) != Some(HIDDEN_DIR) {
        return Err(bad());
    }
    let dir = hidden_dir(home, false).map_err(|_| bad())?;
    if std::fs::canonicalize(parent).map_err(|_| bad())? != dir {
        return Err(bad());
    }
    let real = dir.join(name);
    if std::fs::symlink_metadata(&real).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(bad());
    }
    Ok(real)
}

/// A sidecar left in the old place (~/Movies/Rokk itself) as a regular
/// file, for the move and the clean-up only.
fn legacy(home: &Path, name: &str) -> Option<PathBuf> {
    if !sidecar_file_name(name) {
        return None;
    }
    let real = real_rokk(home)?.join(name);
    std::fs::symlink_metadata(&real).ok()?.is_file().then_some(real)
}

/// The names in a folder; nothing is followed.
fn list(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect())
        .unwrap_or_default()
}

/// Sidecar names in a listing whose MP4 is not in `videos`.
pub fn orphans(names: &[String], videos: &[String]) -> Vec<String> {
    names
        .iter()
        .filter(|n| sidecar_file_name(n) && video_name(n).is_some_and(|mp4| !videos.contains(&mp4)))
        .cloned()
        .collect()
}

/// Writes the sidecar for a saved MP4 into .zoom (created on demand): a
/// fresh temp name, then a rename to a name that must not exist. Never
/// overwrites. Returns the saved path.
pub fn write(home: &Path, mp4: &Path, json: &[u8]) -> Result<PathBuf, RecordError> {
    let fail = || RecordError::new(ErrorCode::FolderNotWritable);
    let mp4 = logic::check_delete(home, mp4).map_err(|_| fail())?;
    let name = mp4.file_name().and_then(|n| n.to_str()).and_then(sidecar_name).ok_or_else(fail)?;
    // Zoomed copies have no mouse path.
    if !sidecar_file_name(&name) {
        return Err(fail());
    }
    let dir = hidden_dir(home, true).map_err(|_| fail())?;
    let target = dir.join(&name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(fail());
    }
    let tmp = dir.join(format!("{name}.rokk-tmp"));
    if write_new(&tmp, &target, json).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail());
    }
    // A sidecar never outlives its MP4.
    if !mp4.is_file() {
        let _ = std::fs::remove_file(&target);
        return Err(fail());
    }
    Ok(target)
}

/// Writes `json` to a fresh `tmp`, then renames it to `target` if that is
/// still free.
fn write_new(tmp: &Path, target: &Path, json: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(tmp)?;
    f.write_all(json)?;
    f.sync_all()?;
    if std::fs::symlink_metadata(target).is_ok() {
        return Err(std::io::Error::other("exists"));
    }
    std::fs::rename(tmp, target)
}

/// Deletes the sidecar of `mp4` if there is one (in .zoom, and a leftover
/// in the old place). Missing is fine; a zoomed copy has none.
pub fn delete_for(home: &Path, mp4: &Path) {
    let Some(name) = mp4.file_name().and_then(|n| n.to_str()).and_then(sidecar_name) else {
        return;
    };
    if !sidecar_file_name(&name) {
        return;
    }
    if let Ok(real) = check_sidecar(home, &sidecar_dir(home).join(&name)) {
        let _ = std::fs::remove_file(real);
    }
    if let Some(old) = legacy(home, &name) {
        let _ = std::fs::remove_file(old);
    }
}

/// Removes sidecars whose MP4 is gone: in .zoom, and any left in the old
/// place.
pub fn remove_orphans(home: &Path) {
    let Some(rokk) = real_rokk(home) else { return };
    let videos = list(&rokk);
    for name in orphans(&videos, &videos) {
        if let Some(old) = legacy(home, &name) {
            let _ = std::fs::remove_file(old);
        }
    }
    let Ok(dir) = hidden_dir(home, false) else { return };
    for name in orphans(&list(&dir), &videos) {
        if let Ok(real) = check_sidecar(home, &dir.join(&name)) {
            let _ = std::fs::remove_file(real);
        }
    }
}

/// What the one-time move did, for the log line.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Migration {
    pub moved: usize,
    pub removed_orphans: usize,
    pub skipped: usize,
}

/// Moves a file to `to` without ever replacing a file there: a hard link
/// (fails if `to` exists), then the old name goes. Falls back to a rename
/// after checking `to` is free, for volumes without hard links.
fn move_new(from: &Path, to: &Path) -> std::io::Result<()> {
    match std::fs::hard_link(from, to) {
        Ok(()) => std::fs::remove_file(from),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(e),
        Err(_) if std::fs::symlink_metadata(to).is_err() => std::fs::rename(from, to),
        Err(e) => Err(e),
    }
}

/// The one-time move of sidecars from ~/Movies/Rokk into .zoom. Touches
/// only regular files with the exact sidecar name pattern; a copy already in
/// .zoom wins and the old duplicate is deleted; sidecars whose MP4 is gone
/// are deleted. Writes the marker when done. None when there is nothing to
/// do (no folder yet, or already done).
pub fn migrate(home: &Path) -> Option<Migration> {
    let rokk = real_rokk(home)?;
    if let Ok(dir) = hidden_dir(home, false) {
        if std::fs::symlink_metadata(dir.join(MIGRATED_MARKER)).is_ok() {
            return None;
        }
    }
    let dir = hidden_dir(home, true).ok()?;
    let mut m = Migration::default();
    for name in list(&rokk).iter().filter(|n| sidecar_file_name(n)) {
        let Some(old) = legacy(home, name) else {
            m.skipped += 1;
            continue;
        };
        let has_video = video_name(name)
            .is_some_and(|v| std::fs::symlink_metadata(rokk.join(v)).is_ok_and(|x| x.is_file()));
        if !has_video {
            match std::fs::remove_file(&old) {
                Ok(()) => m.removed_orphans += 1,
                Err(_) => m.skipped += 1,
            }
            continue;
        }
        let new = dir.join(name);
        if std::fs::symlink_metadata(&new).is_ok() {
            let _ = std::fs::remove_file(&old);
            m.skipped += 1;
            continue;
        }
        match move_new(&old, &new) {
            Ok(()) => m.moved += 1,
            Err(_) => m.skipped += 1,
        }
    }
    let _ = std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(MIGRATED_MARKER));
    Some(m)
}

/// Runs the move once per app run, lazily, from the record commands that
/// touch sidecars. Never fails the command.
pub fn ensure_migrated(home: &Path) {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(m) = migrate(home) {
        log::info!(
            "[rokk_record] sidecar migration moved={} removed_orphans={} skipped={}",
            m.moved,
            m.removed_orphans,
            m.skipped
        );
    }
}

#[cfg(target_os = "macos")]
pub use mac::Tracker;

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{channel, Receiver};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::WebviewWindow;

    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    // CGEventCreate(NULL) reads the current cursor; CGEventSourceButtonState
    // reads button state. Neither is an event tap, so no permission applies.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    const COMBINED_SESSION_STATE: i32 = 0;

    /// The cursor in global points, top left origin of the main display.
    fn cursor() -> Option<(f64, f64)> {
        unsafe {
            let e = CGEventCreate(std::ptr::null());
            if e.is_null() {
                return None;
            }
            let p = CGEventGetLocation(e);
            CFRelease(e);
            Some((p.x, p.y))
        }
    }

    fn buttons() -> u8 {
        let down = |b| unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, b) };
        u8::from(down(0)) | (u8::from(down(1)) << 1)
    }

    pub fn win(window: &WebviewWindow) -> Option<Win> {
        let pos = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        let scale = window.scale_factor().ok()?;
        let display = window.current_monitor().ok().flatten().map(|m| (m.position().x, m.position().y)).unwrap_or((0, 0));
        Some(Win::from_physical(pos.x, pos.y, size.width, size.height, scale, display))
    }

    /// The sampling thread: 30 Hz, its own thread, until `stop`.
    pub struct Tracker {
        stop: Arc<AtomicBool>,
        done: Receiver<(Track, i64)>,
    }

    impl Tracker {
        /// `started` is set by the recording output's started callback; until
        /// it arrives (at most 1 second), `fallback` is the clock's zero.
        pub fn start(
            window: WebviewWindow,
            frame: Option<CssRect>,
            started: impl Fn() -> Option<Instant> + Send + 'static,
            fallback: Instant,
        ) -> Option<Tracker> {
            let first = win(&window)?;
            let stop = Arc::new(AtomicBool::new(false));
            let (tx, done) = channel();
            let flag = stop.clone();
            std::thread::Builder::new()
                .name("rokk-cursor".into())
                .spawn(move || {
                    let wait_until = Instant::now() + Duration::from_secs(1);
                    let zero = loop {
                        if let Some(t) = started() {
                            break t;
                        }
                        if Instant::now() >= wait_until || flag.load(Ordering::Acquire) {
                            break fallback;
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    };
                    let mut track = Track {
                        video: ((first.w * first.scale).round() as i64, (first.h * first.scale).round() as i64),
                        scale: first.scale,
                        frame: frame.map(|f| frame_to_video(f, first.scale)),
                        ..Track::default()
                    };
                    let mut current = first;
                    let mut prev_buttons = buttons();
                    let tick = Duration::from_millis(1000 / u64::from(HZ));
                    let mut n: u64 = 0;
                    while !flag.load(Ordering::Acquire) {
                        let t = zero.elapsed().as_millis() as i64;
                        // The window, twice a second.
                        if n.is_multiple_of(15) {
                            if let Some(now) = win(&window) {
                                if let Some(kind) = change(&current, &now) {
                                    track.event(t, kind, &now);
                                    current = now;
                                }
                            }
                        }
                        let p = cursor().and_then(|c| to_video(c, &current));
                        if !track.capped {
                            track.sample(t, p);
                        }
                        let b = buttons();
                        for button in pressed(prev_buttons, b) {
                            track.click(t, p, button);
                        }
                        prev_buttons = b;
                        n += 1;
                        std::thread::sleep(tick);
                    }
                    let _ = tx.send((track, zero.elapsed().as_millis() as i64));
                })
                .ok()?;
            Some(Tracker { stop, done })
        }

        /// Stops the thread and returns the track, or `None` if it did not
        /// finish in time (for example while the app quits).
        pub fn finish(self) -> Option<(Track, i64)> {
            self.stop.store(true, Ordering::Release);
            self.done.recv_timeout(Duration::from_secs(1)).ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(x: f64, y: f64, w: f64, h: f64, scale: f64) -> Win {
        Win { x, y, w, h, scale, display: (0.0, 0.0) }
    }

    #[test]
    fn points_to_video_pixels_at_scale_one_and_two() {
        let w1 = win(100.0, 50.0, 800.0, 600.0, 1.0);
        assert_eq!(to_video((100.0, 50.0), &w1), Some((0, 0)));
        assert_eq!(to_video((500.0, 350.0), &w1), Some((400, 300)));
        let w2 = win(100.0, 50.0, 800.0, 600.0, 2.0);
        assert_eq!(to_video((500.0, 350.0), &w2), Some((800, 600)));
        assert_eq!(to_video((100.25, 50.25), &w2), Some((1, 1)));
        // From Tauri's physical numbers.
        let p = Win::from_physical(200, 100, 1600, 1200, 2.0, (0, 0));
        assert_eq!(p, w2);
    }

    #[test]
    fn a_second_display_uses_global_points() {
        // A display left of the main one has negative x; one above, negative y.
        let left = Win::from_physical(-3000, 200, 2000, 1200, 2.0, (-3840, 0));
        assert_eq!((left.x, left.y), (-1500.0, 100.0));
        assert_eq!(to_video((-1400.0, 150.0), &left), Some((200, 100)));
        let above = win(10.0, -900.0, 800.0, 600.0, 1.0);
        assert_eq!(to_video((20.0, -890.0), &above), Some((10, 10)));
    }

    #[test]
    fn outside_samples_are_dropped() {
        let w = win(100.0, 50.0, 800.0, 600.0, 2.0);
        for p in [(99.9, 60.0), (900.0, 60.0), (200.0, 49.0), (200.0, 650.0)] {
            assert_eq!(to_video(p, &w), None, "{p:?}");
        }
        let mut t = Track::default();
        t.sample(0, None);
        t.click(0, None, 0);
        assert!(t.samples.is_empty() && t.clicks.is_empty());
    }

    #[test]
    fn the_sample_cap_is_a_hard_stop() {
        let mut t = Track::default();
        for i in 0..(MAX_SAMPLES as i64 + 50) {
            t.sample(i, Some((1, 1)));
        }
        assert_eq!(t.samples.len(), MAX_SAMPLES);
        assert!(t.capped);
    }

    #[test]
    fn clicks_on_the_down_edge_only() {
        assert_eq!(pressed(0, 1).collect::<Vec<_>>(), [0]);
        assert_eq!(pressed(1, 1).count(), 0);
        assert_eq!(pressed(1, 0).count(), 0);
        assert_eq!(pressed(1, 3).collect::<Vec<_>>(), [1]);
        assert_eq!(pressed(0, 3).collect::<Vec<_>>(), [0, 1]);
        let mut t = Track::default();
        t.click(120, Some((5, 6)), 1);
        assert_eq!(t.clicks, [[120, 5, 6, 1]]);
    }

    #[test]
    fn window_changes_become_events() {
        let a = win(100.0, 50.0, 800.0, 600.0, 2.0);
        assert_eq!(change(&a, &a), None);
        assert_eq!(change(&a, &Win { x: 140.0, ..a }), Some("move"));
        assert_eq!(change(&a, &Win { w: 900.0, ..a }), Some("resize"));
        assert_eq!(change(&a, &Win { scale: 1.0, ..a }), Some("scale"));
        assert_eq!(change(&a, &Win { display: (1512.0, 0.0), x: 1600.0, ..a }), Some("display"));
        let mut t = Track::default();
        t.event(2000, "move", &Win { x: 140.0, ..a });
        assert_eq!(t.events[0], Event { t_ms: 2000, kind: "move", rect: Rect { x: 280, y: 100, w: 1600, h: 1200 } });
    }

    #[test]
    fn frame_in_video_pixels() {
        let r = CssRect { x: 139.0, y: 80.0, w: 1000.0, h: 620.0 };
        assert_eq!(frame_to_video(r, 2.0), Rect { x: 278, y: 160, w: 2000, h: 1240 });
        assert_eq!(frame_to_video(r, 1.0), Rect { x: 139, y: 80, w: 1000, h: 620 });
    }

    #[test]
    fn ending_reasons() {
        for r in [StopReason::Discard, StopReason::Restart, StopReason::CaptureFailed] {
            assert_eq!(end_reason(r), None, "{r:?}");
        }
        for (r, n) in [
            (StopReason::Tray, "tray"),
            (StopReason::Shortcut, "shortcut"),
            (StopReason::System, "system"),
            (StopReason::TimeLimit, "cap"),
            (StopReason::LowDisk, "disk"),
            (StopReason::WindowClosed, "window_closed"),
            (StopReason::AppExit, "app_exit"),
        ] {
            assert_eq!(end_reason(r), Some(n));
        }
    }

    #[test]
    fn names_share_the_mp4_stem() {
        assert_eq!(sidecar_name("Rokk-2026-11-03-143458.mp4").as_deref(), Some("Rokk-2026-11-03-143458.zoom.json"));
        assert_eq!(sidecar_name("Rokk-2026-11-03-143458-2.mp4").as_deref(), Some("Rokk-2026-11-03-143458-2.zoom.json"));
        assert_eq!(sidecar_name("Rokk-2026-11-03-143458-partial.mp4"), None);
        assert_eq!(sidecar_name("notes.txt"), None);
        assert_eq!(video_name("Rokk-2026-11-03-143458.zoom.json").as_deref(), Some("Rokk-2026-11-03-143458.mp4"));
        assert_eq!(video_name("Rokk-1.json"), None);
    }

    #[test]
    fn format_version_one_holds_only_numbers_and_fixed_words() {
        let mut t = Track { video: (2554, 1616), scale: 2.0, frame: Some(Rect { x: 1, y: 2, w: 3, h: 4 }), ..Track::default() };
        t.sample(0, Some((10, 20)));
        t.click(33, Some((11, 21)), 0);
        t.event(500, "resize", &win(0.0, 0.0, 10.0, 10.0, 2.0));
        let v = serde_json::to_value(sidecar(&t, 1000, "tray")).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["hz"], 30);
        assert_eq!(v["note"], NOTE);
        assert_eq!(v["video"], serde_json::json!({ "width": 2554, "height": 1616, "scale": 2.0 }));
        assert_eq!(v["frame"], serde_json::json!({ "x": 1, "y": 2, "w": 3, "h": 4 }));
        assert_eq!(v["samples"], serde_json::json!([[0, 10, 20]]));
        assert_eq!(v["clicks"], serde_json::json!([[33, 11, 21, 0]]));
        assert_eq!(v["end"], serde_json::json!({ "t_ms": 1000, "reason": "tray" }));
        // Privacy: the only strings are the note, the end reason and event kinds.
        let mut strings = Vec::new();
        collect(&v, &mut strings);
        let allowed = [NOTE, "tray", "resize"];
        for s in strings {
            assert!(allowed.contains(&s.as_str()), "{s}");
        }
    }

    fn collect(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
            serde_json::Value::Object(o) => o.values().for_each(|x| collect(x, out)),
            _ => {}
        }
    }

    fn home() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(logic::output_dir(d.path())).unwrap();
        let p = d.path().to_path_buf();
        (d, p)
    }

    #[test]
    fn sidecar_borrows_the_track_and_serializes() {
        let t = Track { video: (10, 10), scale: 1.0, ..Track::default() };
        let json = serde_json::to_string(&sidecar(&t, 5, "system")).unwrap();
        assert!(json.starts_with("{\"version\":1,"), "{json}");
        assert!(json.contains("\"samples\":[]"));
        // No frame from the page (app zoom not 100%): written as null, still saved.
        assert!(json.contains("\"frame\":null"), "{json}");
        assert!(json.ends_with("\"end\":{\"t_ms\":5,\"reason\":\"system\"}}"), "{json}");
    }

    const MP4: &str = "Rokk-2026-11-03-143458.mp4";
    const SIDE: &str = "Rokk-2026-11-03-143458.zoom.json";

    #[test]
    fn written_into_the_hidden_folder_and_never_over_a_file() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let mp4 = dir.join(MP4);
        // No MP4 yet: no sidecar, and no folder made for it.
        assert!(write(&h, &mp4, b"{}").is_err());
        std::fs::write(&mp4, b"x").unwrap();
        let saved = write(&h, &mp4, b"{}").unwrap();
        assert_eq!(saved, std::fs::canonicalize(&dir).unwrap().join(HIDDEN_DIR).join(SIDE));
        assert!(!dir.join(SIDE).exists(), "nothing next to the video");
        // Never overwrites, and leaves no temp file behind.
        assert!(write(&h, &mp4, b"{}").is_err());
        assert!(!sidecar_dir(&h).join(format!("{SIDE}.rokk-tmp")).exists());
        // Other names or places are refused; a zoomed copy has no sidecar.
        assert!(write(&h, &dir.join("holiday.mp4"), b"{}").is_err());
        assert!(write(&h, &h.join(MP4), b"{}").is_err());
        let copy = dir.join("Rokk-2026-11-03-143458-zoom.mp4");
        std::fs::write(&copy, b"x").unwrap();
        assert!(write(&h, &copy, b"{}").is_err());
    }

    #[test]
    fn the_validator_accepts_only_the_hidden_folder() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let side = write(&h, &dir.join(MP4), b"{}").unwrap();
        assert_eq!(check_sidecar(&h, &sidecar_dir(&h).join(SIDE)).unwrap(), side);
        for bad in [
            dir.join(SIDE),                                         // the old place
            h.join(HIDDEN_DIR).join(SIDE),                          // wrong folder
            sidecar_dir(&h).join("..").join(HIDDEN_DIR).join(SIDE), // `..`
            sidecar_dir(&h).join("Rokk-1.zoom.json"),               // wrong name
            sidecar_dir(&h).join("Rokk-2026-11-03-143458.json"),    // wrong extension
            sidecar_dir(&h).join("Rokk-2026-11-03-143458-zoom.zoom.json"),
            sidecar_dir(&h).join(MIGRATED_MARKER),
        ] {
            assert!(check_sidecar(&h, &bad).is_err(), "{}", bad.display());
        }
    }

    #[test]
    fn the_hidden_folder_must_be_a_real_folder() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        std::fs::write(dir.join(MP4), b"x").unwrap();
        // .zoom as a file: nothing is written or accepted.
        std::fs::write(dir.join(HIDDEN_DIR), b"x").unwrap();
        assert!(write(&h, &dir.join(MP4), b"{}").is_err());
        assert!(check_sidecar(&h, &sidecar_dir(&h).join(SIDE)).is_err());
        assert_eq!(migrate(&h), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_hidden_folder_or_sidecar_is_refused() {
        use std::os::unix::fs::symlink;
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join(SIDE), b"x").unwrap();
        symlink(outside.path(), dir.join(HIDDEN_DIR)).unwrap();
        assert!(check_sidecar(&h, &sidecar_dir(&h).join(SIDE)).is_err());
        assert!(write(&h, &dir.join(MP4), b"{}").is_err());
        delete_for(&h, &dir.join(MP4));
        assert!(outside.path().join(SIDE).exists());
        // A symlinked sidecar inside a real .zoom is refused too.
        let (_d2, h2) = home();
        let dir2 = logic::output_dir(&h2);
        std::fs::write(dir2.join(MP4), b"x").unwrap();
        std::fs::create_dir(dir2.join(HIDDEN_DIR)).unwrap();
        let victim = outside.path().join("keep.json");
        std::fs::write(&victim, b"x").unwrap();
        symlink(&victim, dir2.join(HIDDEN_DIR).join(SIDE)).unwrap();
        assert!(check_sidecar(&h2, &sidecar_dir(&h2).join(SIDE)).is_err());
        delete_for(&h2, &dir2.join(MP4));
        assert!(victim.exists());
    }

    #[test]
    fn deleted_together_from_the_hidden_folder() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let mp4 = dir.join(MP4);
        std::fs::write(&mp4, b"x").unwrap();
        let side = write(&h, &mp4, b"{}").unwrap();
        // A leftover in the old place goes too.
        std::fs::write(dir.join(SIDE), b"{}").unwrap();
        std::fs::remove_file(&mp4).unwrap();
        delete_for(&h, &mp4);
        assert!(!side.exists());
        assert!(!dir.join(SIDE).exists());
        // Deleting a zoomed copy touches no sidecar.
        std::fs::write(&mp4, b"x").unwrap();
        let side = write(&h, &mp4, b"{}").unwrap();
        delete_for(&h, &dir.join("Rokk-2026-11-03-143458-zoom.mp4"));
        assert!(side.exists());
    }

    #[test]
    fn orphans_are_removed_at_each_recording_start() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let hidden = dir.join(HIDDEN_DIR);
        std::fs::create_dir(&hidden).unwrap();
        std::fs::write(dir.join("Rokk-2026-11-03-100000.mp4"), b"x").unwrap();
        let kept = hidden.join("Rokk-2026-11-03-100000.zoom.json");
        let gone = hidden.join("Rokk-2026-11-03-100001.zoom.json");
        let old_gone = dir.join("Rokk-2026-11-03-100002.zoom.json");
        let other = hidden.join("notes.zoom.json");
        for p in [&kept, &gone, &old_gone, &other] {
            std::fs::write(p, b"{}").unwrap();
        }
        let names: Vec<String> = ["Rokk-2026-11-03-100000.zoom.json", "Rokk-2026-11-03-100001.zoom.json", "notes.zoom.json"]
            .map(String::from)
            .to_vec();
        assert_eq!(orphans(&names, &["Rokk-2026-11-03-100000.mp4".to_string()]), ["Rokk-2026-11-03-100001.zoom.json"]);
        remove_orphans(&h);
        assert!(kept.exists());
        assert!(!gone.exists());
        assert!(!old_gone.exists());
        assert!(other.exists(), "unrelated files are left alone");
    }

    #[test]
    fn migration_moves_once_never_overwrites_and_cleans_up() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let put = |name: &str, body: &[u8]| std::fs::write(dir.join(name), body).unwrap();
        // a: to move. b: already in .zoom (that one wins). c: MP4 gone.
        put("Rokk-2026-11-03-100000.mp4", b"x");
        put("Rokk-2026-11-03-100000.zoom.json", b"a");
        put("Rokk-2026-11-03-100001.mp4", b"x");
        put("Rokk-2026-11-03-100001.zoom.json", b"old");
        put("Rokk-2026-11-03-100002.zoom.json", b"c");
        put("notes.zoom.json", b"n");
        put("Rokk-2026-11-03-100003-zoom.mp4", b"x");
        let hidden = dir.join(HIDDEN_DIR);
        std::fs::create_dir(&hidden).unwrap();
        std::fs::write(hidden.join("Rokk-2026-11-03-100001.zoom.json"), b"new").unwrap();
        let m = migrate(&h).unwrap();
        assert_eq!(m, Migration { moved: 1, removed_orphans: 1, skipped: 1 });
        assert_eq!(std::fs::read(hidden.join("Rokk-2026-11-03-100000.zoom.json")).unwrap(), b"a");
        assert_eq!(std::fs::read(hidden.join("Rokk-2026-11-03-100001.zoom.json")).unwrap(), b"new");
        for gone in ["Rokk-2026-11-03-100000.zoom.json", "Rokk-2026-11-03-100001.zoom.json", "Rokk-2026-11-03-100002.zoom.json"] {
            assert!(!dir.join(gone).exists(), "{gone}");
        }
        assert!(!hidden.join("Rokk-2026-11-03-100002.zoom.json").exists());
        // Unrelated files stay where they are.
        assert!(dir.join("notes.zoom.json").exists());
        assert!(dir.join("Rokk-2026-11-03-100003-zoom.mp4").exists());
        assert!(hidden.join(MIGRATED_MARKER).exists());
        // A second run does nothing, even with a new legacy file.
        put("Rokk-2026-11-03-100000.zoom.json", b"late");
        assert_eq!(migrate(&h), None);
        assert!(dir.join("Rokk-2026-11-03-100000.zoom.json").exists());
    }

    #[test]
    fn migration_without_a_folder_does_nothing() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(migrate(d.path()), None);
        assert!(!logic::output_dir(d.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn migration_never_follows_symlinks() {
        use std::os::unix::fs::symlink;
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("keep.json");
        std::fs::write(&victim, b"x").unwrap();
        symlink(&victim, dir.join(SIDE)).unwrap();
        let m = migrate(&h).unwrap();
        assert_eq!(m, Migration { moved: 0, removed_orphans: 0, skipped: 1 });
        assert!(victim.exists());
        assert!(!sidecar_dir(&h).join(SIDE).exists());
    }
}

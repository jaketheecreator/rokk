// Auto-zoom, Phase C: renders a NEW MP4 with the zoom baked in. The camera
// path comes from the preview player (algo.ts, sampled at 120 Hz); Rust only
// renders it. The original MP4 and its mouse path file are never modified
// or deleted. Every unsafe call lives in the `av` submodule (macOS only).
// See docs/rokk/ZOOM_MAP.md.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::{cursor, logic, zoom};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

pub const EVENT: &str = "rokk-zoom-export";
/// 11 minutes at 120 Hz; a recording is at most 10 minutes.
pub const MAX_PATH_ENTRIES: usize = 80_000;
pub const MAX_VIDEO_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const FPS: i32 = 30;
pub const MAX_SCALE: f64 = 4.0;
/// The last camera time must be this close to the video's duration.
pub const END_SLACK_MS: f64 = 500.0;
/// Free space needed on top of 1.5 times the estimated size.
pub const DISK_EXTRA: u64 = 500 * 1024 * 1024;
/// At most 10 progress events per second.
pub const PROGRESS_EVERY_MS: u64 = 100;
pub const SMALL_WIDTH: u32 = 1920;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Full,
    Small,
}

impl Quality {
    /// Average bits per second for H.264.
    pub fn bit_rate(self) -> u32 {
        match self {
            Quality::Full => 12_000_000,
            Quality::Small => 6_000_000,
        }
    }

    /// The output size in pixels: even numbers (H.264 needs them), the
    /// source size for Full, 1920 wide with the aspect kept for Small.
    pub fn output_size(self, w: u32, h: u32) -> (u32, u32) {
        let even = |v: u32| (v & !1).max(2);
        match self {
            Quality::Small if w > SMALL_WIDTH => {
                let hh = (f64::from(h) * f64::from(SMALL_WIDTH) / f64::from(w) / 2.0).round() as u32 * 2;
                (SMALL_WIDTH, hh.max(2))
            }
            _ => (even(w), even(h)),
        }
    }
}

/// The estimated output size in bytes.
pub fn estimate_bytes(q: Quality, duration_ms: f64) -> u64 {
    (f64::from(q.bit_rate()) / 8.0 * duration_ms.max(0.0) / 1000.0) as u64
}

/// Enough free space: 1.5 times the estimate plus 500 MB.
pub fn disk_ok(free: u64, estimate: u64) -> bool {
    free >= estimate.saturating_mul(3) / 2 + DISK_EXTRA
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportCode {
    Unsupported,
    OldMacos,
    Busy,
    Recording,
    NotOurs,
    TooLarge,
    NoSidecar,
    BadCameraPath,
    DiskFull,
    OpenFailed,
    RenderFailed,
    WriteFailed,
}

impl ExportCode {
    pub fn message(self) -> &'static str {
        match self {
            ExportCode::Unsupported => "Saving with zoom works on macOS only.",
            ExportCode::OldMacos => "Saving with zoom needs macOS 13 or later.",
            ExportCode::Busy => "A zoomed video is already being saved.",
            ExportCode::Recording => "Stop the recording first, then save with zoom.",
            ExportCode::NotOurs => "Rokk only saves zoomed copies of its own recordings in Movies/Rokk.",
            ExportCode::TooLarge => "This recording is too large to save with zoom (over 4 GB).",
            ExportCode::NoSidecar => "The mouse path file for this recording is missing or damaged.",
            ExportCode::BadCameraPath => "The zoom path is not valid. Close the player and open it again.",
            ExportCode::DiskFull => "There is not enough free disk space to save the zoomed video.",
            ExportCode::OpenFailed => "Rokk could not read this recording.",
            ExportCode::RenderFailed => "The zoomed video could not be made.",
            ExportCode::WriteFailed => "The zoomed video could not be saved.",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            ExportCode::Unsupported => "unsupported",
            ExportCode::OldMacos => "old_macos",
            ExportCode::Busy => "busy",
            ExportCode::Recording => "recording",
            ExportCode::NotOurs => "not_ours",
            ExportCode::TooLarge => "too_large",
            ExportCode::NoSidecar => "no_sidecar",
            ExportCode::BadCameraPath => "bad_camera_path",
            ExportCode::DiskFull => "disk_full",
            ExportCode::OpenFailed => "open_failed",
            ExportCode::RenderFailed => "render_failed",
            ExportCode::WriteFailed => "write_failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ExportError {
    pub code: ExportCode,
    pub message: String,
}

impl ExportError {
    pub fn new(code: ExportCode) -> Self {
        Self { code, message: code.message().to_string() }
    }
}

impl From<ExportCode> for ExportError {
    fn from(code: ExportCode) -> Self {
        Self::new(code)
    }
}

/// Why a camera path was refused. All map to `bad_camera_path`, with this
/// plain reason as the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathProblem {
    Empty,
    TooMany,
    NotFinite,
    NotFromZero,
    NotIncreasing,
    Scale,
    Center,
    Length,
}

impl PathProblem {
    pub fn message(self) -> &'static str {
        match self {
            PathProblem::Empty => "The zoom path is empty.",
            PathProblem::TooMany => "The zoom path has too many points.",
            PathProblem::NotFinite => "The zoom path has a value that is not a number.",
            PathProblem::NotFromZero => "The zoom path does not start at the start of the video.",
            PathProblem::NotIncreasing => "The zoom path times do not keep increasing.",
            PathProblem::Scale => "The zoom path has a zoom level outside 1x to 4x.",
            PathProblem::Center => "The zoom path points outside the video.",
            PathProblem::Length => "The zoom path does not match the length of the video.",
        }
    }

    pub fn error(self) -> ExportError {
        ExportError { code: ExportCode::BadCameraPath, message: self.message().to_string() }
    }
}

/// One camera sample: [t_ms, scale, cx, cy] with the center in the video
/// pixels of the mouse path file.
pub type CamPoint = [f64; 4];

pub fn check_path(path: &[CamPoint], width: f64, height: f64, duration_ms: f64) -> Result<(), PathProblem> {
    let (Some(first), Some(last)) = (path.first(), path.last()) else {
        return Err(PathProblem::Empty);
    };
    if path.len() > MAX_PATH_ENTRIES {
        return Err(PathProblem::TooMany);
    }
    if !path.iter().flatten().all(|v| v.is_finite()) {
        return Err(PathProblem::NotFinite);
    }
    if first[0] != 0.0 {
        return Err(PathProblem::NotFromZero);
    }
    if path.windows(2).any(|w| w[1][0] <= w[0][0]) {
        return Err(PathProblem::NotIncreasing);
    }
    if path.iter().any(|p| !(1.0..=MAX_SCALE).contains(&p[1])) {
        return Err(PathProblem::Scale);
    }
    if path.iter().any(|p| !(0.0..=width).contains(&p[2]) || !(0.0..=height).contains(&p[3])) {
        return Err(PathProblem::Center);
    }
    if (last[0] - duration_ms).abs() > END_SLACK_MS {
        return Err(PathProblem::Length);
    }
    Ok(())
}

/// The camera at `t_ms`, interpolated linearly between samples and held
/// at the ends: (scale, cx, cy).
pub fn view_at(path: &[CamPoint], t_ms: f64) -> (f64, f64, f64) {
    let (Some(first), Some(last)) = (path.first(), path.last()) else {
        return (1.0, 0.0, 0.0);
    };
    let i = path.partition_point(|p| p[0] <= t_ms);
    if i == 0 {
        return (first[1], first[2], first[3]);
    }
    if i == path.len() {
        return (last[1], last[2], last[3]);
    }
    let (a, b) = (path[i - 1], path[i]);
    let u = (t_ms - a[0]) / (b[0] - a[0]);
    let mix = |k: usize| a[k] + (b[k] - a[k]) * u;
    (mix(1), mix(2), mix(3))
}

/// The source rectangle for a view, in Core Image coordinates (origin at
/// the bottom left, so y is flipped): size W/scale by H/scale, centered on
/// (cx, cy) given from the top left, kept inside the video.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn crop_rect(width: f64, height: f64, scale: f64, cx: f64, cy: f64) -> Crop {
    let s = if scale.is_finite() { scale.clamp(1.0, MAX_SCALE) } else { 1.0 };
    let (w, h) = (width / s, height / s);
    let x = (cx - w / 2.0).clamp(0.0, width - w);
    let top = (cy - h / 2.0).clamp(0.0, height - h);
    Crop { x, y: height - top - h, w, h }
}

/// CILanczosScaleTransform's inputScale (vertical) and inputAspectRatio
/// (extra horizontal factor) that map a crop onto the output size.
pub fn lanczos(c: Crop, out_w: f64, out_h: f64) -> (f64, f64) {
    let sy = out_h / c.h;
    let sx = out_w / c.w;
    (sy, sx / sy)
}

/// `<stem>-zoom.mp4`, then `<stem>-zoom-2.mp4` and on, with the partial
/// name next to it; both must be free. Never overwrites.
pub fn pick_zoom_names(stem: &str, taken: impl Fn(&str) -> bool) -> Option<(String, String)> {
    (1..=999).find_map(|n| {
        let base = if n <= 1 { format!("{stem}-zoom") } else { format!("{stem}-zoom-{n}") };
        let final_name = format!("{base}.mp4");
        let partial = format!("{base}-partial.mp4");
        (!taken(&final_name) && !taken(&partial)).then_some((final_name, partial))
    })
}

/// A partial file an export left behind: `<stem>-zoom[-N]-partial.mp4`.
pub fn zoom_partial_name(name: &str) -> bool {
    name.strip_suffix("-partial.mp4").is_some_and(|stem| logic::zoom_copy_name(&format!("{stem}.mp4")))
}

/// Checks the recording to export: an original Rokk recording (not a zoomed
/// copy) as a regular file in ~/Movies/Rokk, at most 4 GB, with its mouse
/// path file. Returns the resolved path and the parsed mouse path file.
pub fn check_video(home: &Path, file: &Path) -> Result<(PathBuf, zoom::Loaded), ExportCode> {
    let name = file.file_name().and_then(|n| n.to_str()).ok_or(ExportCode::NotOurs)?;
    if !logic::recording_name(name) {
        return Err(ExportCode::NotOurs);
    }
    let real = logic::check_delete(home, file).map_err(|_| ExportCode::NotOurs)?;
    let len = std::fs::symlink_metadata(&real).map_err(|_| ExportCode::NotOurs)?.len();
    if len > MAX_VIDEO_BYTES {
        return Err(ExportCode::TooLarge);
    }
    let sidecar = cursor::sidecar_name(name).ok_or(ExportCode::NoSidecar)?;
    let loaded =
        zoom::read(home, &cursor::sidecar_dir(home).join(sidecar)).map_err(|_| ExportCode::NoSidecar)?;
    Ok((real, loaded))
}

/// At most one progress event per PROGRESS_EVERY_MS.
#[derive(Debug, Default)]
pub struct Throttle {
    last_ms: Option<u64>,
}

impl Throttle {
    pub fn ready(&mut self, now_ms: u64) -> bool {
        match self.last_ms {
            Some(last) if now_ms < last + PROGRESS_EVERY_MS => false,
            _ => {
                self.last_ms = Some(now_ms);
                true
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportState {
    Running,
    Done,
    Error,
    Cancelled,
}

impl ExportState {
    pub fn name(self) -> &'static str {
        match self {
            ExportState::Running => "running",
            ExportState::Done => "done",
            ExportState::Error => "error",
            ExportState::Cancelled => "cancelled",
        }
    }
}

/// One "rokk-zoom-export" event. Holds only numbers, fixed words and the
/// output path.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExportEvent {
    pub job: u64,
    pub state: ExportState,
    pub progress: f64,
    pub output: Option<String>,
    pub size: Option<u64>,
    pub code: Option<ExportCode>,
    pub message: Option<String>,
    pub seconds_elapsed: f64,
}

impl ExportEvent {
    fn base(job: u64, state: ExportState, progress: f64, secs: f64) -> Self {
        let r = |v: f64| (v * 1000.0).round() / 1000.0;
        Self {
            job,
            state,
            progress: r(progress.clamp(0.0, 1.0)),
            output: None,
            size: None,
            code: None,
            message: None,
            seconds_elapsed: r(secs),
        }
    }
    pub fn running(job: u64, progress: f64, secs: f64) -> Self {
        Self::base(job, ExportState::Running, progress, secs)
    }
    pub fn done(job: u64, output: String, size: u64, secs: f64) -> Self {
        Self { output: Some(output), size: Some(size), ..Self::base(job, ExportState::Done, 1.0, secs) }
    }
    pub fn failed(job: u64, code: ExportCode, secs: f64) -> Self {
        Self {
            code: Some(code),
            message: Some(code.message().to_string()),
            ..Self::base(job, ExportState::Error, 0.0, secs)
        }
    }
    pub fn cancelled(job: u64, secs: f64) -> Self {
        Self::base(job, ExportState::Cancelled, 0.0, secs)
    }
}

/// The one export that may run, with its cancel flag.
#[derive(Debug, Default)]
pub struct Jobs {
    current: Option<(u64, Arc<AtomicBool>)>,
    next: u64,
}

impl Jobs {
    /// A new job id and its cancel flag, or None while one runs.
    pub fn begin(&mut self) -> Option<(u64, Arc<AtomicBool>)> {
        if self.current.is_some() {
            return None;
        }
        self.next += 1;
        let flag = Arc::new(AtomicBool::new(false));
        self.current = Some((self.next, flag.clone()));
        Some((self.next, flag))
    }

    /// Asks `job` to stop. Idempotent; unknown or finished jobs are ignored.
    pub fn cancel(&self, job: u64) -> bool {
        match &self.current {
            Some((id, flag)) if *id == job => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }

    pub fn cancel_all(&self) -> bool {
        self.current.as_ref().map(|(id, _)| self.cancel(*id)).unwrap_or(false)
    }

    pub fn end(&mut self, job: u64) {
        if self.current.as_ref().is_some_and(|(id, _)| *id == job) {
            self.current = None;
        }
    }

    pub fn running(&self) -> bool {
        self.current.is_some()
    }
}

fn jobs() -> MutexGuard<'static, Jobs> {
    static J: OnceLock<Mutex<Jobs>> = OnceLock::new();
    J.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// Cancel from the player. Idempotent.
pub fn cancel(job: u64) {
    if jobs().cancel(job) {
        log::info!("[rokk_export] cancel requested");
    }
}

/// App exit: cancel a running export and wait briefly for it to delete its
/// partial file.
pub fn on_exit() {
    if !jobs().cancel_all() {
        return;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while jobs().running() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::time::Instant;
    use tauri::{AppHandle, Emitter, Manager};

    pub fn supported() -> bool {
        av::os_at_least_13()
    }

    fn emit(app: &AppHandle, e: ExportEvent) {
        let _ = app.emit(EVENT, e);
    }

    /// Deletes partial files an earlier export left behind (a crash).
    fn remove_stale_partials(home: &Path, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for name in entries.filter_map(|e| e.ok()?.file_name().into_string().ok()) {
            if zoom_partial_name(&name) {
                if let Ok(real) = logic::check_output(home, &dir.join(&name)) {
                    let _ = std::fs::remove_file(real);
                }
            }
        }
    }

    pub fn start(
        app: AppHandle,
        label: String,
        video: &str,
        path: Vec<CamPoint>,
        quality: Quality,
    ) -> Result<u64, ExportError> {
        if !supported() {
            return Err(ExportCode::OldMacos.into());
        }
        if super::super::is_recording() {
            return Err(ExportCode::Recording.into());
        }
        if jobs().running() {
            return Err(ExportCode::Busy.into());
        }
        let home = dirs::home_dir().ok_or(ExportCode::NotOurs)?;
        cursor::ensure_migrated(&home);
        let (mp4, loaded) = check_video(&home, Path::new(video))?;
        let probe = av::probe(&mp4).ok_or(ExportCode::OpenFailed)?;
        let (side_w, side_h) = (loaded.video.width as f64, loaded.video.height as f64);
        check_path(&path, side_w, side_h, probe.duration_ms).map_err(PathProblem::error)?;
        let dir = mp4.parent().map(Path::to_path_buf).ok_or(ExportCode::NotOurs)?;
        let estimate = estimate_bytes(quality, probe.duration_ms);
        if super::super::mac::free_bytes(&dir).is_some_and(|free| !disk_ok(free, estimate)) {
            return Err(ExportCode::DiskFull.into());
        }
        let stem = mp4
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".mp4"))
            .map(String::from)
            .ok_or(ExportCode::NotOurs)?;
        remove_stale_partials(&home, &dir);
        let (final_name, partial_name) =
            pick_zoom_names(&stem, |n| dir.join(n).exists()).ok_or(ExportCode::WriteFailed)?;
        let partial = logic::check_output(&home, &dir.join(&partial_name)).map_err(|_| ExportCode::WriteFailed)?;
        let (out_w, out_h) = quality.output_size(probe.width, probe.height);
        let (job, flag) = jobs().begin().ok_or(ExportCode::Busy)?;
        log::info!("[rokk_export] state idle->running quality={quality:?} out={out_w}x{out_h}");
        emit(&app, ExportEvent::running(job, 0.0, 0.0));
        let spec = av::RenderJob {
            src: mp4,
            dst: partial,
            out_w,
            out_h,
            bit_rate: quality.bit_rate(),
            path: Arc::new(path),
            side_w,
            side_h,
            duration_ms: probe.duration_ms,
        };
        let spawned = std::thread::Builder::new()
            .name("rokk-zoom-export".into())
            .spawn(move || run(app, label, job, flag, spec, dir, final_name));
        if spawned.is_err() {
            jobs().end(job);
            return Err(ExportCode::RenderFailed.into());
        }
        Ok(job)
    }

    /// The worker: renders, then renames the partial file or deletes it.
    fn run(app: AppHandle, label: String, job: u64, flag: Arc<AtomicBool>, spec: av::RenderJob, dir: PathBuf, final_name: String) {
        let started = Instant::now();
        let ticks = std::cell::Cell::new(0u32);
        // Checked on every frame; the window check every 15th frame.
        let stop = || {
            ticks.set(ticks.get().wrapping_add(1));
            flag.load(Ordering::SeqCst) || (ticks.get() % 15 == 0 && app.get_webview_window(&label).is_none())
        };
        let mut throttle = Throttle::default();
        let mut progress = |p: f64| {
            let ms = started.elapsed().as_millis() as u64;
            if throttle.ready(ms) {
                emit(&app, ExportEvent::running(job, p, started.elapsed().as_secs_f64()));
            }
        };
        let (frames, result) = av::render(&spec, &stop, &mut progress);
        let secs = started.elapsed().as_secs_f64();
        let outcome = match result {
            Ok(()) => finalize(&spec.dst, &dir, &final_name).map_err(av::Fail::Code),
            Err(e) => Err(e),
        };
        let (event, result_word, size) = match outcome {
            Ok(target) => {
                let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                (ExportEvent::done(job, target.display().to_string(), size, secs), ExportState::Done, size)
            }
            Err(fail) => {
                let _ = std::fs::remove_file(&spec.dst);
                match fail {
                    av::Fail::Cancelled => (ExportEvent::cancelled(job, secs), ExportState::Cancelled, 0),
                    av::Fail::Code(code) => {
                        log::info!("[rokk_export] error code={}", code.name());
                        (ExportEvent::failed(job, code, secs), ExportState::Error, 0)
                    }
                }
            }
        };
        log::info!("[rokk_export] state running->{}", result_word.name());
        log::info!(
            "[rokk_export] frames={frames} seconds={secs:.1} size={size} result={}",
            result_word.name()
        );
        jobs().end(job);
        emit(&app, event);
    }

    /// Renames the finished partial file to a free final name; never
    /// overwrites (a numeric suffix if the name was taken meanwhile).
    fn finalize(partial: &Path, dir: &Path, final_name: &str) -> Result<PathBuf, ExportCode> {
        let stem = final_name.strip_suffix(".mp4").ok_or(ExportCode::WriteFailed)?;
        let target = std::iter::once(dir.join(final_name))
            .chain((2..1000).map(|n| dir.join(format!("{stem}-{n}.mp4"))))
            .find(|p| std::fs::symlink_metadata(p).is_err())
            .ok_or(ExportCode::WriteFailed)?;
        if !partial.is_file() {
            return Err(ExportCode::WriteFailed);
        }
        std::fs::rename(partial, &target).map_err(|_| ExportCode::WriteFailed)?;
        Ok(target)
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use tauri::AppHandle;

    pub fn supported() -> bool {
        false
    }
    pub fn start(_: AppHandle, _: String, _: &str, _: Vec<CamPoint>, _: Quality) -> Result<u64, ExportError> {
        Err(ExportCode::Unsupported.into())
    }
}

/// Every unsafe call of the export. AVFoundation reads the recording
/// through a Core Image composition (crop, then Lanczos scale per frame)
/// and AVAssetWriter writes H.264 at a set average bit rate.
#[cfg(target_os = "macos")]
mod av {
    use super::{crop_rect, lanczos, view_at, CamPoint, Crop, ExportCode, FPS};
    use block2::RcBlock;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::AnyObject;
    use objc2_av_foundation::{
        AVAsset, AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVAssetReaderVideoCompositionOutput,
        AVAssetTrack, AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVAsynchronousCIImageFilteringRequest,
        AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVMutableVideoComposition, AVURLAsset,
        AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey,
        AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalKey,
        AVVideoProfileLevelH264HighAutoLevel, AVVideoProfileLevelKey, AVVideoWidthKey,
    };
    use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
    use objc2_core_image::CIContext;
    use objc2_core_media::CMTime;
    use objc2_foundation::{
        NSArray, NSDictionary, NSError, NSNumber, NSObject, NSOperatingSystemVersion, NSProcessInfo, NSString, NSURL,
    };
    use std::path::{Path, PathBuf};
    use std::ptr::NonNull;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    /// kCVPixelBufferPixelFormatTypeKey and kCVPixelFormatType_32BGRA, as
    /// their values, so Core Video is not needed as a crate.
    const PIXEL_FORMAT_KEY: &str = "PixelFormatType";
    const BGRA: u32 = 0x4247_5241;

    pub fn os_at_least_13() -> bool {
        let v = NSOperatingSystemVersion { majorVersion: 13, minorVersion: 0, patchVersion: 0 };
        NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(v)
    }

    pub struct Probe {
        pub duration_ms: f64,
        pub width: u32,
        pub height: u32,
    }

    pub struct RenderJob {
        pub src: PathBuf,
        pub dst: PathBuf,
        pub out_w: u32,
        pub out_h: u32,
        pub bit_rate: u32,
        pub path: Arc<Vec<CamPoint>>,
        /// The mouse path file's video size, which the camera path uses.
        pub side_w: f64,
        pub side_h: f64,
        pub duration_ms: f64,
    }

    pub enum Fail {
        Cancelled,
        Code(ExportCode),
    }

    fn ms(t: CMTime) -> f64 {
        if t.timescale > 0 {
            t.value as f64 * 1000.0 / f64::from(t.timescale)
        } else {
            0.0
        }
    }

    fn rect(c: Crop) -> CGRect {
        CGRect { origin: CGPoint { x: c.x, y: c.y }, size: CGSize { width: c.w, height: c.h } }
    }

    /// Any object as a dictionary value.
    fn obj(o: &NSObject) -> &AnyObject {
        o
    }

    fn dict(items: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
        let keys: Vec<&NSString> = items.iter().map(|(k, _)| *k).collect();
        let values: Vec<&AnyObject> = items.iter().map(|(_, v)| *v).collect();
        NSDictionary::from_slices(&keys, &values)
    }

    /// A framework string constant, or the given error if it is missing.
    fn constant(c: Option<&'static NSString>) -> Result<&'static NSString, Fail> {
        c.ok_or(Fail::Code(ExportCode::RenderFailed))
    }

    fn open(path: &Path) -> Option<Retained<AVURLAsset>> {
        let url = NSURL::from_file_path(path)?;
        // SAFETY: a file URL and no options. The asset only reads the file.
        Some(unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) })
    }

    fn first_track(asset: &AVAsset, kind: Option<&'static NSString>) -> Option<Retained<AVAssetTrack>> {
        let kind = kind?;
        // SAFETY: a synchronous track query on a local file asset, on this
        // thread. Deprecated in macOS 15 in favor of the async loader, and
        // still supported; the export runs on its own thread, never the
        // main one.
        #[allow(deprecated)]
        let tracks = unsafe { asset.tracksWithMediaType(kind) };
        tracks.firstObject()
    }

    pub fn probe(path: &Path) -> Option<Probe> {
        autoreleasepool(|_| {
            let asset = open(path)?;
            // SAFETY: reading a framework constant.
            let video = first_track(&asset, unsafe { AVMediaTypeVideo })?;
            // SAFETY: plain property reads on objects alive in this scope.
            let (size, duration) = unsafe { (video.naturalSize(), asset.duration()) };
            let (w, h) = (size.width.round(), size.height.round());
            (w >= 2.0 && h >= 2.0 && w <= 16384.0 && h <= 16384.0).then(|| Probe {
                duration_ms: ms(duration),
                width: w as u32,
                height: h as u32,
            })
        })
    }

    /// Hands the composition from AVFoundation's completion queue to the
    /// export thread.
    struct Handoff(Retained<AVMutableVideoComposition>);
    // SAFETY: the composition is created by AVFoundation, retained once in
    // the completion block and then used only by the export thread; no two
    // threads touch it at the same time.
    unsafe impl Send for Handoff {}

    /// The composition: per frame, crop the source to the view and scale it
    /// to the output size with Lanczos, rendered by one reused CIContext.
    fn composition(asset: &AVAsset, job: &RenderJob, src_w: f64, src_h: f64) -> Option<Retained<AVMutableVideoComposition>> {
        let path = job.path.clone();
        let (kx, ky) = (src_w / job.side_w, src_h / job.side_h);
        let (out_w, out_h) = (f64::from(job.out_w), f64::from(job.out_h));
        // SAFETY: creates a new default context. Apple documents CIContext
        // as immutable and safe to share across threads (it is Send + Sync).
        let ctx: Retained<CIContext> = unsafe { CIContext::context() };
        let scale_key = NSString::from_str("inputScale");
        let aspect_key = NSString::from_str("inputAspectRatio");
        let filter = NSString::from_str("CILanczosScaleTransform");
        let applier = RcBlock::new(move |request: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            autoreleasepool(|_| {
                // SAFETY: AVFoundation passes a valid request that stays alive
                // for this call, and each request is finished exactly once.
                let req = unsafe { request.as_ref() };
                // SAFETY: a plain property read on the live request.
                let (s, cx, cy) = view_at(&path, ms(unsafe { req.compositionTime() }));
                let c = crop_rect(src_w, src_h, s, cx * kx, cy * ky);
                let (scale, aspect) = lanczos(c, out_w, out_h);
                let n_scale = NSNumber::new_f64(scale);
                let n_aspect = NSNumber::new_f64(aspect);
                let params = dict(&[(&*scale_key, obj(&n_scale)), (&*aspect_key, obj(&n_aspect))]);
                let to_origin = CGAffineTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: -c.x, ty: -c.y };
                let out_rect = rect(Crop { x: 0.0, y: 0.0, w: out_w, h: out_h });
                // SAFETY: Core Image calls on images owned in this scope; the
                // filter name and its two number parameters match
                // CILanczosScaleTransform's documented inputs.
                unsafe {
                    let out = req
                        .sourceImage()
                        .imageByCroppingToRect(rect(c))
                        .imageByClampingToExtent()
                        .imageByApplyingTransform(to_origin)
                        .imageByApplyingFilter_withInputParameters(&filter, &params)
                        .imageByCroppingToRect(out_rect);
                    req.finishWithImage_context(&out, Some(&ctx));
                }
            });
        });
        let (tx, rx) = mpsc::channel::<Option<Handoff>>();
        let done = RcBlock::new(move |comp: *mut AVMutableVideoComposition, _error: *mut NSError| {
            // SAFETY: AVFoundation passes a valid composition or null;
            // retaining keeps it alive after the block returns.
            let got = unsafe { Retained::retain(comp) }.map(Handoff);
            let _ = tx.send(got);
        });
        // SAFETY: both blocks are 'static, capture only Send + Sync data
        // (an Arc of numbers, a CIContext, strings and a channel sender) and
        // AVFoundation copies them before returning.
        unsafe {
            AVMutableVideoComposition::videoCompositionWithAsset_applyingCIFiltersWithHandler_completionHandler(
                asset, &applier, &done,
            );
        }
        let comp = rx.recv_timeout(Duration::from_secs(30)).ok().flatten()?.0;
        // SAFETY: setters on the composition before any reader uses it.
        unsafe {
            comp.setRenderSize(CGSize { width: out_w, height: out_h });
            comp.setFrameDuration(CMTime::new(1, FPS));
        }
        Some(comp)
    }

    /// H.264 High profile at an average bit rate, constant 30 fps.
    fn video_settings(job: &RenderJob) -> Result<Retained<NSDictionary<NSString, AnyObject>>, Fail> {
        // SAFETY: reading framework string constants.
        let (codec_key, h264, width_key, height_key, props_key, rate_key, profile_key, high, fps_key, gop_key) = unsafe {
            (
                constant(AVVideoCodecKey)?,
                constant(AVVideoCodecTypeH264)?,
                constant(AVVideoWidthKey)?,
                constant(AVVideoHeightKey)?,
                constant(AVVideoCompressionPropertiesKey)?,
                constant(AVVideoAverageBitRateKey)?,
                constant(AVVideoProfileLevelKey)?,
                constant(AVVideoProfileLevelH264HighAutoLevel)?,
                constant(AVVideoExpectedSourceFrameRateKey)?,
                constant(AVVideoMaxKeyFrameIntervalKey)?,
            )
        };
        let rate = NSNumber::new_u32(job.bit_rate);
        let fps = NSNumber::new_i32(FPS);
        let gop = NSNumber::new_i32(FPS * 2);
        let props = dict(&[(rate_key, obj(&rate)), (profile_key, obj(high)), (fps_key, obj(&fps)), (gop_key, obj(&gop))]);
        let w = NSNumber::new_u32(job.out_w);
        let h = NSNumber::new_u32(job.out_h);
        Ok(dict(&[(codec_key, obj(h264)), (width_key, obj(&w)), (height_key, obj(&h)), (props_key, obj(&props))]))
    }

    enum Step {
        Appended(f64),
        End,
        Failed,
    }

    /// Copies one sample from `output` to `input`, inside its own
    /// autorelease pool so no frame outlives the step.
    fn step(output: &objc2_av_foundation::AVAssetReaderOutput, input: &AVAssetWriterInput) -> Step {
        autoreleasepool(|_| {
            // SAFETY: the output belongs to a reader that started reading,
            // and only this thread copies from it.
            match unsafe { output.copyNextSampleBuffer() } {
                Some(sample) => {
                    // SAFETY: a plain read and one append on this thread; the
                    // input reported it was ready for more data just before.
                    let (t, ok) = unsafe { (sample.presentation_time_stamp(), input.appendSampleBuffer(&sample)) };
                    if ok {
                        Step::Appended(ms(t))
                    } else {
                        Step::Failed
                    }
                }
                None => Step::End,
            }
        })
    }

    fn abort(reader: &AVAssetReader, writer: &AVAssetWriter) {
        // SAFETY: called on the export thread, never during a copy or an
        // append. cancelWriting is only called while writing.
        unsafe {
            reader.cancelReading();
            if writer.status() == AVAssetWriterStatus::Writing {
                writer.cancelWriting();
            }
        }
    }

    /// Renders the whole video. Returns the frames written and the result.
    pub fn render(job: &RenderJob, stop: &dyn Fn() -> bool, progress: &mut dyn FnMut(f64)) -> (u64, Result<(), Fail>) {
        let mut frames = 0u64;
        let result = autoreleasepool(|_| render_inner(job, stop, progress, &mut frames));
        (frames, result)
    }

    fn render_inner(
        job: &RenderJob,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(f64),
        frames: &mut u64,
    ) -> Result<(), Fail> {
        let open_failed = || Fail::Code(ExportCode::OpenFailed);
        let render_failed = || Fail::Code(ExportCode::RenderFailed);
        let write_failed = || Fail::Code(ExportCode::WriteFailed);
        let asset = open(&job.src).ok_or_else(open_failed)?;
        // SAFETY: reading framework constants.
        let (video_kind, audio_kind, mp4) = unsafe { (AVMediaTypeVideo, AVMediaTypeAudio, AVFileTypeMPEG4) };
        let video = first_track(&asset, video_kind).ok_or_else(open_failed)?;
        let audio = first_track(&asset, audio_kind);
        // SAFETY: a plain property read.
        let size = unsafe { video.naturalSize() };
        let comp = composition(&asset, job, size.width, size.height).ok_or_else(render_failed)?;

        // Reader: the composition output (BGRA frames at 30 fps), and the
        // audio track as stored, if there is one.
        // SAFETY: creating a reader for a local asset; errors come back as Err.
        let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(&asset) }.map_err(|_| open_failed())?;
        let pixel_key = NSString::from_str(PIXEL_FORMAT_KEY);
        let bgra = NSNumber::new_u32(BGRA);
        let pixels = dict(&[(&*pixel_key, obj(&bgra))]);
        let tracks = NSArray::from_retained_slice(&[video]);
        // SAFETY: the output is configured before it is added and before
        // reading starts, as AVFoundation requires.
        let vout = unsafe {
            let out =
                AVAssetReaderVideoCompositionOutput::assetReaderVideoCompositionOutputWithVideoTracks_videoSettings(
                    &tracks,
                    Some(&pixels),
                );
            out.setVideoComposition(Some(&comp));
            out.setAlwaysCopiesSampleData(false);
            out
        };
        // SAFETY: canAddOutput is checked first, so addOutput cannot throw.
        unsafe {
            if !reader.canAddOutput(&vout) {
                return Err(render_failed());
            }
            reader.addOutput(&vout);
        }

        // Writer.
        let url = NSURL::from_file_path(&job.dst).ok_or_else(write_failed)?;
        let mp4 = mp4.ok_or_else(write_failed)?;
        // SAFETY: a new writer for a file that does not exist yet; errors
        // come back as Err.
        let writer = unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, mp4) }.map_err(|_| write_failed())?;
        let settings = video_settings(job)?;
        let video_kind = video_kind.ok_or_else(render_failed)?;
        // SAFETY: the inputs are configured before writing starts, and
        // canAddInput is checked before each addInput so it cannot throw.
        let vin = unsafe {
            writer.setShouldOptimizeForNetworkUse(true);
            let vin = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(video_kind, Some(&settings));
            vin.setExpectsMediaDataInRealTime(false);
            if !writer.canAddInput(&vin) {
                return Err(write_failed());
            }
            writer.addInput(&vin);
            vin
        };
        // The audio track is copied as stored, only when both sides accept it.
        // SAFETY: same rules as above: configured before reading and writing
        // start, each add checked first.
        let pass = unsafe {
            match (audio, audio_kind) {
                (Some(track), Some(kind)) => {
                    let aout = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, None);
                    aout.setAlwaysCopiesSampleData(false);
                    let ain = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(kind, None);
                    ain.setExpectsMediaDataInRealTime(false);
                    if reader.canAddOutput(&aout) && writer.canAddInput(&ain) {
                        reader.addOutput(&aout);
                        writer.addInput(&ain);
                        Some((aout, ain))
                    } else {
                        None
                    }
                }
                _ => None,
            }
        };

        // SAFETY: everything is configured; start reading, then writing.
        unsafe {
            if !reader.startReading() {
                return Err(open_failed());
            }
            if !writer.startWriting() {
                reader.cancelReading();
                return Err(write_failed());
            }
            writer.startSessionAtSourceTime(CMTime::new(0, 600));
        }

        let duration = job.duration_ms.max(1.0);
        let mut video_done = false;
        let mut audio_done = pass.is_none();
        while !(video_done && audio_done) {
            if stop() {
                abort(&reader, &writer);
                return Err(Fail::Cancelled);
            }
            let mut moved = false;
            // SAFETY: a plain property read.
            if !video_done && unsafe { vin.isReadyForMoreMediaData() } {
                moved = true;
                match step(&vout, &vin) {
                    Step::Appended(t) => {
                        *frames += 1;
                        progress((t / duration).clamp(0.0, 1.0));
                    }
                    Step::End => {
                        // SAFETY: no more samples will be appended to it.
                        unsafe { vin.markAsFinished() };
                        video_done = true;
                    }
                    Step::Failed => {
                        abort(&reader, &writer);
                        return Err(write_failed());
                    }
                }
            }
            if let Some((aout, ain)) = pass.as_ref() {
                // SAFETY: a plain property read.
                if !audio_done && unsafe { ain.isReadyForMoreMediaData() } {
                    moved = true;
                    match step(aout, ain) {
                        Step::Appended(_) => {}
                        Step::End => {
                            // SAFETY: no more samples will be appended to it.
                            unsafe { ain.markAsFinished() };
                            audio_done = true;
                        }
                        Step::Failed => {
                            abort(&reader, &writer);
                            return Err(write_failed());
                        }
                    }
                }
            }
            if !moved {
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        // SAFETY: a plain property read.
        if unsafe { reader.status() } == AVAssetReaderStatus::Failed || *frames == 0 {
            abort(&reader, &writer);
            return Err(render_failed());
        }
        let (tx, rx) = mpsc::channel::<()>();
        let finished = RcBlock::new(move || {
            let _ = tx.send(());
        });
        // SAFETY: all inputs are marked finished; the block only signals a
        // channel and AVFoundation copies it.
        unsafe { writer.finishWritingWithCompletionHandler(&finished) };
        if rx.recv_timeout(Duration::from_secs(120)).is_err() {
            abort(&reader, &writer);
            return Err(write_failed());
        }
        // SAFETY: a plain property read.
        if unsafe { writer.status() } != AVAssetWriterStatus::Completed {
            return Err(write_failed());
        }
        progress(1.0);
        Ok(())
    }
}

// Commands.

#[tauri::command]
pub async fn zoom_export_supported() -> bool {
    tauri::async_runtime::spawn_blocking(imp::supported).await.unwrap_or(false)
}

#[tauri::command]
pub async fn zoom_export_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    video_path: String,
    camera_path: Vec<CamPoint>,
    quality: Quality,
) -> Result<u64, ExportError> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || imp::start(app, label, &video_path, camera_path, quality))
        .await
        .unwrap_or_else(|_| Err(ExportCode::RenderFailed.into()))
}

#[tauri::command]
pub fn zoom_export_cancel(job: u64) {
    cancel(job);
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 2554.0;
    const H: f64 = 1616.0;

    fn path(n: usize, step: f64) -> Vec<CamPoint> {
        (0..n).map(|i| [i as f64 * step, 1.5, 1000.0, 800.0]).collect()
    }

    #[test]
    fn camera_path_accepts_a_good_path() {
        let p = path(1201, 1000.0 / 120.0);
        assert_eq!(check_path(&p, W, H, 10_000.0), Ok(()));
        // Within 500 ms of the duration either way.
        assert_eq!(check_path(&p, W, H, 10_499.0), Ok(()));
        assert_eq!(check_path(&p, W, H, 9_501.0), Ok(()));
    }

    #[test]
    fn camera_path_refuses_every_problem() {
        let good = path(121, 1000.0 / 120.0);
        let end = 1000.0;
        let bad = |f: &dyn Fn(&mut Vec<CamPoint>)| {
            let mut p = good.clone();
            f(&mut p);
            check_path(&p, W, H, end)
        };
        assert_eq!(check_path(&[], W, H, end), Err(PathProblem::Empty));
        assert_eq!(check_path(&path(MAX_PATH_ENTRIES + 1, 0.1), W, H, 8000.0), Err(PathProblem::TooMany));
        assert_eq!(bad(&|p| p[3][2] = f64::NAN), Err(PathProblem::NotFinite));
        assert_eq!(bad(&|p| p[3][1] = f64::INFINITY), Err(PathProblem::NotFinite));
        assert_eq!(bad(&|p| p[0][0] = 1.0), Err(PathProblem::NotFromZero));
        assert_eq!(bad(&|p| p[5][0] = p[4][0]), Err(PathProblem::NotIncreasing));
        assert_eq!(bad(&|p| p[5][0] = p[3][0]), Err(PathProblem::NotIncreasing));
        assert_eq!(bad(&|p| p[2][1] = 0.99), Err(PathProblem::Scale));
        assert_eq!(bad(&|p| p[2][1] = 4.01), Err(PathProblem::Scale));
        assert_eq!(bad(&|p| p[2][2] = -0.5), Err(PathProblem::Center));
        assert_eq!(bad(&|p| p[2][2] = W + 1.0), Err(PathProblem::Center));
        assert_eq!(bad(&|p| p[2][3] = H + 1.0), Err(PathProblem::Center));
        assert_eq!(check_path(&good, W, H, 1501.0), Err(PathProblem::Length));
        assert_eq!(check_path(&good, W, H, 499.0), Err(PathProblem::Length));
        let e = PathProblem::Scale.error();
        assert_eq!(e.code, ExportCode::BadCameraPath);
        assert!(e.message.contains("1x to 4x"));
    }

    #[test]
    fn interpolation_is_linear_and_held_at_the_ends() {
        let p = vec![[0.0, 1.0, 100.0, 200.0], [10.0, 2.0, 300.0, 400.0], [20.0, 2.0, 300.0, 400.0]];
        assert_eq!(view_at(&p, -5.0), (1.0, 100.0, 200.0));
        assert_eq!(view_at(&p, 0.0), (1.0, 100.0, 200.0));
        assert_eq!(view_at(&p, 5.0), (1.5, 200.0, 300.0));
        assert_eq!(view_at(&p, 10.0), (2.0, 300.0, 400.0));
        assert_eq!(view_at(&p, 99.0), (2.0, 300.0, 400.0));
        assert_eq!(view_at(&[], 3.0), (1.0, 0.0, 0.0));
    }

    #[test]
    fn crop_is_the_view_with_y_flipped() {
        // Scale 2 at the center: the middle quarter.
        let c = crop_rect(W, H, 2.0, W / 2.0, H / 2.0);
        assert_eq!(c, Crop { x: W / 4.0, y: H / 4.0, w: W / 2.0, h: H / 2.0 });
        // Near the top: Core Image's y is measured from the bottom.
        let top = crop_rect(1000.0, 800.0, 2.0, 500.0, 200.0);
        assert_eq!(top, Crop { x: 250.0, y: 400.0, w: 500.0, h: 400.0 });
        // Scale 1 is the whole video wherever the center is.
        assert_eq!(crop_rect(W, H, 1.0, 10.0, 10.0), Crop { x: 0.0, y: 0.0, w: W, h: H });
    }

    #[test]
    fn crop_is_clamped_at_every_edge() {
        let (w, h) = (1000.0, 800.0);
        for (cx, cy) in [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h), (w / 2.0, 0.0), (w, h / 2.0), (w / 2.0, h), (0.0, h / 2.0), (-50.0, 9e9)] {
            let c = crop_rect(w, h, 3.0, cx, cy);
            assert!(c.x >= 0.0 && c.x + c.w <= w + 1e-9, "{cx},{cy}: {c:?}");
            assert!(c.y >= 0.0 && c.y + c.h <= h + 1e-9, "{cx},{cy}: {c:?}");
            assert!((c.w - w / 3.0).abs() < 1e-9 && (c.h - h / 3.0).abs() < 1e-9);
        }
        // Top left in screen terms is the top of Core Image's space.
        let tl = crop_rect(w, h, 2.0, 0.0, 0.0);
        assert_eq!((tl.x, tl.y), (0.0, 400.0));
        let br = crop_rect(w, h, 2.0, w, h);
        assert_eq!((br.x, br.y), (500.0, 0.0));
        // Out-of-range scales are held inside 1x to 4x.
        assert_eq!(crop_rect(w, h, 0.5, 1.0, 1.0).w, w);
        assert_eq!(crop_rect(w, h, 9.0, 1.0, 1.0).w, w / 4.0);
        assert_eq!(crop_rect(w, h, f64::NAN, 1.0, 1.0).w, w);
    }

    #[test]
    fn lanczos_maps_the_crop_onto_the_output() {
        let c = crop_rect(W, H, 2.0, W / 2.0, H / 2.0);
        let (scale, aspect) = lanczos(c, W, H);
        assert!((scale - 2.0).abs() < 1e-9 && (aspect - 1.0).abs() < 1e-9);
        let (s, a) = lanczos(c, 1920.0, 1216.0);
        assert!((c.h * s - 1216.0).abs() < 1e-9);
        assert!((c.w * s * a - 1920.0).abs() < 1e-9);
    }

    #[test]
    fn qualities_sizes_and_disk_rule() {
        assert_eq!(Quality::Full.output_size(2554, 1616), (2554, 1616));
        assert_eq!(Quality::Full.output_size(2555, 1617), (2554, 1616));
        assert_eq!(Quality::Small.output_size(2554, 1616), (1920, 1214));
        assert_eq!(Quality::Small.output_size(1280, 801), (1280, 800));
        assert_eq!(Quality::Full.bit_rate(), 12_000_000);
        assert_eq!(Quality::Small.bit_rate(), 6_000_000);
        // A minute at 12 Mbit/s is 90 MB, at 6 Mbit/s 45 MB.
        assert_eq!(estimate_bytes(Quality::Full, 60_000.0), 90_000_000);
        assert_eq!(estimate_bytes(Quality::Small, 60_000.0), 45_000_000);
        let need = 90_000_000 * 3 / 2 + DISK_EXTRA;
        assert!(disk_ok(need, 90_000_000));
        assert!(!disk_ok(need - 1, 90_000_000));
        assert!(!disk_ok(0, 0));
        assert!(!disk_ok(DISK_EXTRA - 1, 0));
        let q: Quality = serde_json::from_str("\"small\"").unwrap();
        assert_eq!(q, Quality::Small);
        assert!(serde_json::from_str::<Quality>("\"huge\"").is_err());
    }

    #[test]
    fn output_names_never_overwrite() {
        let stem = "Rokk-2026-11-02-090507";
        assert_eq!(
            pick_zoom_names(stem, |_| false),
            Some(("Rokk-2026-11-02-090507-zoom.mp4".into(), "Rokk-2026-11-02-090507-zoom-partial.mp4".into()))
        );
        let taken = ["Rokk-2026-11-02-090507-zoom.mp4", "Rokk-2026-11-02-090507-zoom-2-partial.mp4"];
        assert_eq!(
            pick_zoom_names(stem, |n| taken.contains(&n)),
            Some(("Rokk-2026-11-02-090507-zoom-3.mp4".into(), "Rokk-2026-11-02-090507-zoom-3-partial.mp4".into()))
        );
        assert_eq!(pick_zoom_names(stem, |_| true), None);
        for (final_name, partial) in [pick_zoom_names(stem, |_| false).unwrap(), pick_zoom_names(stem, |n| taken.contains(&n)).unwrap()] {
            assert!(logic::zoom_copy_name(&final_name));
            assert!(zoom_partial_name(&partial));
            assert!(!logic::zoom_copy_name(&partial));
            assert!(!logic::recording_name(&final_name));
        }
        assert!(!zoom_partial_name("Rokk-2026-11-02-090507-partial.mp4"));
    }

    #[test]
    fn jobs_allow_one_export_and_cancel_is_idempotent() {
        let mut j = Jobs::default();
        let (id, flag) = j.begin().unwrap();
        assert!(j.running());
        assert!(j.begin().is_none(), "a second export is refused");
        assert!(!j.cancel(id + 1), "an unknown job is ignored");
        assert!(!flag.load(Ordering::SeqCst));
        assert!(j.cancel(id));
        assert!(j.cancel(id), "cancelling twice is fine");
        assert!(flag.load(Ordering::SeqCst));
        j.end(id + 1);
        assert!(j.running(), "ending another job does nothing");
        j.end(id);
        assert!(!j.running());
        assert!(!j.cancel(id), "a finished job is ignored");
        assert!(!j.cancel_all());
        let (next, _) = j.begin().unwrap();
        assert!(next > id);
        assert!(j.cancel_all());
    }

    #[test]
    fn progress_is_throttled_to_ten_per_second() {
        let mut t = Throttle::default();
        let sent = (0..=1000u64).filter(|ms| t.ready(*ms)).count();
        assert_eq!(sent, 11);
        let mut t = Throttle::default();
        assert!(t.ready(5));
        assert!(!t.ready(104));
        assert!(t.ready(105));
    }

    #[test]
    fn event_shape() {
        let keys = |e: &ExportEvent| {
            let v = serde_json::to_value(e).unwrap();
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            (v, k)
        };
        let (run, k) = keys(&ExportEvent::running(3, 0.123_456, 1.5));
        assert_eq!(k, ["code", "job", "message", "output", "progress", "seconds_elapsed", "size", "state"]);
        assert_eq!(run["state"], "running");
        assert_eq!(run["progress"], 0.123);
        assert_eq!(run["job"], 3);
        let (done, _) = keys(&ExportEvent::done(3, "/x/Rokk-2026-11-02-090507-zoom.mp4".into(), 42, 9.0));
        assert_eq!(done["state"], "done");
        assert_eq!(done["progress"], 1.0);
        assert_eq!(done["size"], 42);
        assert!(done["code"].is_null());
        let (err, _) = keys(&ExportEvent::failed(3, ExportCode::DiskFull, 0.2));
        assert_eq!(err["state"], "error");
        assert_eq!(err["code"], "disk_full");
        assert_eq!(err["message"], ExportCode::DiskFull.message());
        let (c, _) = keys(&ExportEvent::cancelled(3, 2.0));
        assert_eq!(c["state"], "cancelled");
        assert!(c["output"].is_null());
        assert_eq!(serde_json::to_value(ExportEvent::running(1, 7.0, 0.0)).unwrap()["progress"], 1.0);
    }

    #[test]
    fn every_code_has_a_stable_name_and_a_plain_message() {
        use ExportCode::*;
        for c in [Unsupported, OldMacos, Busy, Recording, NotOurs, TooLarge, NoSidecar, BadCameraPath, DiskFull, OpenFailed, RenderFailed, WriteFailed] {
            assert_eq!(serde_json::to_value(c).unwrap(), c.name());
            assert!(c.message().ends_with('.') && !c.message().contains('\u{2014}'));
        }
    }

    fn home() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(logic::output_dir(d.path())).unwrap();
        let p = d.path().to_path_buf();
        (d, p)
    }

    fn sidecar_json() -> String {
        format!(
            r#"{{"version":1,"note":"{}","video":{{"width":2554,"height":1616,"scale":2.0}},"frame":null,"hz":30,"samples":[[0,10,10]],"clicks":[],"events":[],"end":{{"t_ms":1000,"reason":"tray"}}}}"#,
            cursor::NOTE
        )
    }

    #[test]
    fn video_check_refuses_every_problem() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let ok = dir.join("Rokk-2026-11-02-090507.mp4");
        std::fs::write(&ok, b"x").unwrap();
        // No mouse path file yet.
        assert_eq!(check_video(&h, &ok).unwrap_err(), ExportCode::NoSidecar);
        // The mouse path file belongs in .zoom; one in the old place is not used.
        std::fs::write(dir.join("Rokk-2026-11-02-090507.zoom.json"), sidecar_json()).unwrap();
        assert_eq!(check_video(&h, &ok).unwrap_err(), ExportCode::NoSidecar);
        let hidden = dir.join(cursor::HIDDEN_DIR);
        std::fs::create_dir(&hidden).unwrap();
        std::fs::write(hidden.join("Rokk-2026-11-02-090507.zoom.json"), b"{").unwrap();
        assert_eq!(check_video(&h, &ok).unwrap_err(), ExportCode::NoSidecar);
        std::fs::write(hidden.join("Rokk-2026-11-02-090507.zoom.json"), sidecar_json()).unwrap();
        let (real, loaded) = check_video(&h, &ok).unwrap();
        assert!(real.ends_with("Rokk-2026-11-02-090507.mp4"));
        assert_eq!(loaded.video.width, 2554);
        // A zoomed copy, other names, outside the folder, `..`, missing.
        let copy = dir.join("Rokk-2026-11-02-090507-zoom.mp4");
        std::fs::write(&copy, b"x").unwrap();
        for bad in [
            copy,
            dir.join("holiday.mp4"),
            h.join("Rokk-2026-11-02-090507.mp4"),
            dir.join("..").join("Rokk").join("Rokk-2026-11-02-090507.mp4"),
            dir.join("Rokk-2026-11-02-090509.mp4"),
        ] {
            assert_eq!(check_video(&h, &bad).unwrap_err(), ExportCode::NotOurs, "{}", bad.display());
        }
    }

    #[cfg(unix)]
    #[test]
    fn video_check_refuses_symlinks() {
        use std::os::unix::fs::symlink;
        let (_d, h) = home();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("keep.mp4");
        std::fs::write(&victim, b"x").unwrap();
        let link = logic::output_dir(&h).join("Rokk-2026-11-02-090507.mp4");
        symlink(&victim, &link).unwrap();
        assert_eq!(check_video(&h, &link).unwrap_err(), ExportCode::NotOurs);
    }
}

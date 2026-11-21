// Share panel helpers (share-assist): read a recording's details, make a
// lighter 1080p copy with the zoom exporter's renderer, save a README GIF
// (AVFoundation frames, ImageIO GIF) and a poster PNG, put the file on the
// pasteboard, and start a native drag of it. Nothing is uploaded or posted;
// no network. Every file written is a NEW generated name in ~/Movies/Rokk,
// written to a partial name first and renamed, never overwriting.
// See docs/rokk/SHARE.md.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::{logic, zoom_export};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const EVENT: &str = "rokk-share-job";
/// A README GIF covers at most 10 seconds.
pub const GIF_MAX_MS: f64 = 10_000.0;
pub const GIF_MIN_MS: f64 = 100.0;
/// The GIF target: under 10 MB (decimal, as the panel shows sizes).
pub const GIF_CAP_BYTES: u64 = 10_000_000;
/// Tried in order until the GIF is under the cap: frame rate first, then width.
pub const GIF_STEPS: [(u32, u32); 6] =
    [(12, 960), (10, 960), (8, 960), (8, 800), (8, 640), (8, 480)];
/// The bit rates a smaller copy may use.
pub const MIN_RATE: u32 = 500_000;
pub const MAX_RATE: u32 = 12_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareCode {
    Unsupported,
    OldMacos,
    Busy,
    Recording,
    NotOurs,
    BadRange,
    BadRate,
    DiskFull,
    OpenFailed,
    RenderFailed,
    WriteFailed,
    CopyFailed,
    DragFailed,
}

impl ShareCode {
    pub fn message(self) -> &'static str {
        match self {
            ShareCode::Unsupported => "This works on macOS only.",
            ShareCode::OldMacos => "This needs macOS 13 or later.",
            ShareCode::Busy => "Rokk is already making a file. Wait for it to finish or cancel it.",
            ShareCode::Recording => "Stop the recording first.",
            ShareCode::NotOurs => "Rokk only shares its own recordings in Movies/Rokk.",
            ShareCode::BadRange => {
                "Choose a start and an end inside the video, at most 10 seconds apart."
            }
            ShareCode::BadRate => "That size is too small for this video.",
            ShareCode::DiskFull => "There is not enough free disk space.",
            ShareCode::OpenFailed => "Rokk could not read this video.",
            ShareCode::RenderFailed => "The file could not be made.",
            ShareCode::WriteFailed => "The file could not be saved.",
            ShareCode::CopyFailed => "The file could not be copied.",
            ShareCode::DragFailed => {
                "The drag did not start. Use Copy file or Show in Finder instead."
            }
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            ShareCode::Unsupported => "unsupported",
            ShareCode::OldMacos => "old_macos",
            ShareCode::Busy => "busy",
            ShareCode::Recording => "recording",
            ShareCode::NotOurs => "not_ours",
            ShareCode::BadRange => "bad_range",
            ShareCode::BadRate => "bad_rate",
            ShareCode::DiskFull => "disk_full",
            ShareCode::OpenFailed => "open_failed",
            ShareCode::RenderFailed => "render_failed",
            ShareCode::WriteFailed => "write_failed",
            ShareCode::CopyFailed => "copy_failed",
            ShareCode::DragFailed => "drag_failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShareError {
    pub code: ShareCode,
    pub message: String,
}

impl From<ShareCode> for ShareError {
    fn from(code: ShareCode) -> Self {
        Self {
            code,
            message: code.message().to_string(),
        }
    }
}

/// The file details the panel shows.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub duration_ms: f64,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub codec: String,
}

/// A saved poster.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub output: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobKind {
    Smaller,
    Gif,
}

/// One "rokk-share-job" event: numbers, fixed words and the output path.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ShareEvent {
    pub job: u64,
    pub kind: JobKind,
    pub state: zoom_export::ExportState,
    pub progress: f64,
    pub output: Option<String>,
    pub size: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub code: Option<ShareCode>,
    pub message: Option<String>,
}

impl ShareEvent {
    pub fn running(job: u64, kind: JobKind, progress: f64) -> Self {
        Self {
            job,
            kind,
            state: zoom_export::ExportState::Running,
            progress: (progress.clamp(0.0, 1.0) * 1000.0).round() / 1000.0,
            output: None,
            size: None,
            width: None,
            height: None,
            fps: None,
            code: None,
            message: None,
        }
    }
    pub fn done(job: u64, kind: JobKind, output: String, size: u64) -> Self {
        Self {
            state: zoom_export::ExportState::Done,
            output: Some(output),
            size: Some(size),
            ..Self::running(job, kind, 1.0)
        }
    }
    pub fn failed(job: u64, kind: JobKind, code: ShareCode) -> Self {
        Self {
            state: zoom_export::ExportState::Error,
            code: Some(code),
            message: Some(code.message().to_string()),
            ..Self::running(job, kind, 0.0)
        }
    }
    pub fn cancelled(job: u64, kind: JobKind) -> Self {
        Self {
            state: zoom_export::ExportState::Cancelled,
            ..Self::running(job, kind, 0.0)
        }
    }
}

/// Fits inside 1920 by 1080 (1080 by 1920 when portrait), never larger than
/// the source, with even sides for H.264.
pub fn fit_1080(w: u32, h: u32) -> (u32, u32) {
    let (bw, bh) = if h > w {
        (1080.0, 1920.0)
    } else {
        (1920.0, 1080.0)
    };
    let (fw, fh) = (f64::from(w.max(2)), f64::from(h.max(2)));
    let k = (bw / fw).min(bh / fh).min(1.0);
    let even = |v: f64| ((v / 2.0).round() as u32 * 2).max(2);
    (even(fw * k), even(fh * k))
}

/// The GIF size: `width` wide (never wider than the source), height kept in
/// proportion, both even.
pub fn gif_size(src_w: u32, src_h: u32, width: u32) -> (u32, u32) {
    let w = width.min(src_w).max(2) & !1;
    let h = ((f64::from(src_h) * f64::from(w) / f64::from(src_w.max(1)) / 2.0).round() as u32 * 2)
        .max(2);
    (w, h)
}

/// The frame times in ms: from `start`, one every 1000/fps ms, before `end`.
pub fn gif_times(start_ms: f64, end_ms: f64, fps: u32) -> Vec<f64> {
    let fps = fps.max(1);
    let n = (((end_ms - start_ms) * f64::from(fps) / 1000.0).round() as usize).max(1);
    (0..n)
        .map(|i| start_ms + i as f64 * 1000.0 / f64::from(fps))
        .collect()
}

/// Checks a GIF range against the video: inside it, at least 0.1 s, at most
/// 10 s (half a millisecond of slack for rounding).
pub fn check_range(start_ms: f64, end_ms: f64, duration_ms: f64) -> Result<(f64, f64), ShareCode> {
    let ok = start_ms.is_finite()
        && end_ms.is_finite()
        && start_ms >= 0.0
        && end_ms <= duration_ms + 0.5
        && end_ms - start_ms >= GIF_MIN_MS
        && end_ms - start_ms <= GIF_MAX_MS + 0.5;
    if ok {
        Ok((start_ms, end_ms.min(duration_ms)))
    } else {
        Err(ShareCode::BadRange)
    }
}

/// A smaller copy's bit rate, refused outside 0.5 to 12 Mbit/s.
pub fn check_rate(bit_rate: u32) -> Result<u32, ShareCode> {
    if (MIN_RATE..=MAX_RATE).contains(&bit_rate) {
        Ok(bit_rate)
    } else {
        Err(ShareCode::BadRate)
    }
}

/// `<stem>-<word>.<ext>`, then `<stem>-<word>-2.<ext>` and on, with the
/// partial name `<base>-partial.<ext>`; both must be free.
pub fn pick_output(
    stem: &str,
    word: &str,
    ext: &str,
    taken: impl Fn(&str) -> bool,
) -> Option<(String, String)> {
    (1..=999).find_map(|n| {
        let base = if n <= 1 {
            format!("{stem}-{word}")
        } else {
            format!("{stem}-{word}-{n}")
        };
        let final_name = format!("{base}.{ext}");
        let partial = format!("{base}-partial.{ext}");
        (!taken(&final_name) && !taken(&partial)).then_some((final_name, partial))
    })
}

fn ends_with_word(stem: &str, word: &str) -> bool {
    let tail = format!("-{word}");
    if stem.ends_with(&tail) {
        return true;
    }
    match stem.rsplit_once('-') {
        Some((base, n)) if (1..=3).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit()) => {
            base.ends_with(&tail)
        }
        _ => false,
    }
}

/// A partial file the share panel left behind (a crash).
pub fn share_partial_name(name: &str) -> bool {
    if !name.starts_with("Rokk-") {
        return false;
    }
    [("mp4", "share"), ("gif", "readme"), ("png", "poster")]
        .iter()
        .any(|(ext, word)| {
            name.strip_suffix(&format!("-partial.{ext}"))
                .is_some_and(|stem| ends_with_word(stem, word))
        })
}

/// Like `logic::check_output`, for any of the share file types: a plain
/// generated name directly inside ~/Movies/Rokk once symlinks are resolved,
/// not a symlink.
pub fn check_share_output(home: &Path, file: &Path, ext: &str) -> Result<PathBuf, ShareCode> {
    let bad = ShareCode::WriteFailed;
    if file
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(bad);
    }
    let name = file.file_name().and_then(|n| n.to_str()).ok_or(bad)?;
    let generated = name.starts_with("Rokk-")
        && name.ends_with(&format!(".{ext}"))
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.');
    if !generated {
        return Err(bad);
    }
    let real_dir = std::fs::canonicalize(file.parent().ok_or(bad)?).map_err(|_| bad)?;
    let expected = std::fs::canonicalize(home)
        .map_err(|_| bad)?
        .join("Movies")
        .join("Rokk");
    if real_dir != expected
        || std::fs::symlink_metadata(file).is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err(bad);
    }
    Ok(real_dir.join(name))
}

/// A smaller copy: `<original or zoomed copy stem>-share[-N].mp4`.
pub fn share_copy_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".mp4") else {
        return false;
    };
    let base = match stem.strip_suffix("-share") {
        Some(b) => b,
        None => match stem.rsplit_once('-') {
            Some((b, n)) if (1..=3).contains(&n.len()) && n.bytes().all(|c| c.is_ascii_digit()) => {
                match b.strip_suffix("-share") {
                    Some(b) => b,
                    None => return false,
                }
            }
            _ => return false,
        },
    };
    let base = format!("{base}.mp4");
    logic::recording_name(&base) || logic::zoom_copy_name(&base)
}

/// The video to share: an original recording or a zoomed copy (the same
/// rules as `record_delete`), or a smaller copy, as a regular file in
/// ~/Movies/Rokk.
pub fn check_source(home: &Path, file: &Path) -> Result<PathBuf, ShareCode> {
    let name = file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if share_copy_name(name) {
        let real = check_share_output(home, file, "mp4").map_err(|_| ShareCode::NotOurs)?;
        return match std::fs::symlink_metadata(&real) {
            Ok(m) if m.is_file() => Ok(real),
            _ => Err(ShareCode::NotOurs),
        };
    }
    logic::check_delete(home, file).map_err(|_| ShareCode::NotOurs)
}

/// For an original recording, its newest zoomed copy if one exists, else the
/// recording itself. A zoomed copy is returned as it is.
pub fn pick_source(home: &Path, file: &Path) -> Result<PathBuf, ShareCode> {
    let real = check_source(home, file)?;
    let name = real
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let Some(stem) = name
        .strip_suffix(".mp4")
        .filter(|_| logic::recording_name(&name))
    else {
        return Ok(real);
    };
    let dir = real
        .parent()
        .map(Path::to_path_buf)
        .ok_or(ShareCode::NotOurs)?;
    let newest = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let e = e.ok()?;
            let n = e.file_name().into_string().ok()?;
            let copy = logic::zoom_copy_name(&n)
                && n.strip_suffix(".mp4").and_then(|s| {
                    s.strip_suffix("-zoom")
                        .or_else(|| s.rsplit_once("-zoom-").map(|(b, _)| b))
                }) == Some(stem);
            let meta = std::fs::symlink_metadata(e.path()).ok()?;
            (copy && meta.is_file()).then(|| (meta.modified().ok(), e.path()))
        })
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p);
    match newest {
        Some(p) => check_source(home, &p),
        None => Ok(real),
    }
}

/// Renames a finished partial file to a free final name; never overwrites.
pub fn finalize(
    partial: &Path,
    dir: &Path,
    final_name: &str,
    ext: &str,
) -> Result<PathBuf, ShareCode> {
    let stem = final_name
        .strip_suffix(&format!(".{ext}"))
        .ok_or(ShareCode::WriteFailed)?;
    let target = std::iter::once(dir.join(final_name))
        .chain((2..1000).map(|n| dir.join(format!("{stem}-{n}.{ext}"))))
        .find(|p| std::fs::symlink_metadata(p).is_err())
        .ok_or(ShareCode::WriteFailed)?;
    if !partial.is_file() {
        return Err(ShareCode::WriteFailed);
    }
    std::fs::rename(partial, &target).map_err(|_| ShareCode::WriteFailed)?;
    Ok(target)
}

fn jobs() -> MutexGuard<'static, zoom_export::Jobs> {
    static J: OnceLock<Mutex<zoom_export::Jobs>> = OnceLock::new();
    J.get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// App exit: cancel a running share job and wait briefly for its cleanup.
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
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Instant;
    use tauri::{AppHandle, Emitter, Manager};

    fn emit(app: &AppHandle, e: ShareEvent) {
        let _ = app.emit(EVENT, e);
    }

    fn home() -> Result<PathBuf, ShareCode> {
        dirs::home_dir().ok_or(ShareCode::NotOurs)
    }

    fn ready() -> Result<(), ShareCode> {
        if !zoom_export::av::os_at_least_13() {
            return Err(ShareCode::OldMacos);
        }
        if super::super::is_recording() {
            return Err(ShareCode::Recording);
        }
        if jobs().running() {
            return Err(ShareCode::Busy);
        }
        Ok(())
    }

    fn stem_and_dir(src: &Path) -> Result<(String, PathBuf), ShareCode> {
        let stem = src
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".mp4"))
            .map(String::from)
            .ok_or(ShareCode::NotOurs)?;
        let dir = src
            .parent()
            .map(Path::to_path_buf)
            .ok_or(ShareCode::NotOurs)?;
        Ok((stem, dir))
    }

    /// Deletes partial files an earlier share job left behind.
    fn remove_stale_partials(home: &Path, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for name in entries.filter_map(|e| e.ok()?.file_name().into_string().ok()) {
            if share_partial_name(&name) {
                let ext = name.rsplit('.').next().unwrap_or_default();
                if let Ok(real) = check_share_output(home, &dir.join(&name), ext) {
                    let _ = std::fs::remove_file(real);
                }
            }
        }
    }

    /// Where a new file goes: the partial path and the final name.
    fn output(
        home: &Path,
        src: &Path,
        word: &str,
        ext: &str,
    ) -> Result<(PathBuf, PathBuf, String), ShareCode> {
        let (stem, dir) = stem_and_dir(src)?;
        remove_stale_partials(home, &dir);
        let (final_name, partial) = pick_output(&stem, word, ext, |n| dir.join(n).exists())
            .ok_or(ShareCode::WriteFailed)?;
        let partial = check_share_output(home, &dir.join(partial), ext)?;
        Ok((dir, partial, final_name))
    }

    pub fn source(path: &str) -> Result<String, ShareCode> {
        Ok(pick_source(&home()?, Path::new(path))?
            .display()
            .to_string())
    }

    pub fn probe(path: &str) -> Result<FileInfo, ShareCode> {
        let src = check_source(&home()?, Path::new(path))?;
        let p = zoom_export::av::probe(&src).ok_or(ShareCode::OpenFailed)?;
        let bytes = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
        Ok(FileInfo {
            name: src
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string(),
            path: src.display().to_string(),
            duration_ms: p.duration_ms,
            width: p.width,
            height: p.height,
            bytes,
            codec: media::codec(&src).unwrap_or_default(),
        })
    }

    /// Runs `work` as the one share job on its own thread, then emits the
    /// final event; the partial file is deleted unless `work` renamed it.
    fn spawn(
        app: AppHandle,
        label: String,
        kind: JobKind,
        partial: PathBuf,
        work: impl FnOnce(&dyn Fn() -> bool, &mut dyn FnMut(f64)) -> Result<ShareEvent, Option<ShareCode>>
            + Send
            + 'static,
    ) -> Result<u64, ShareCode> {
        let (job, flag): (u64, Arc<AtomicBool>) = jobs().begin().ok_or(ShareCode::Busy)?;
        emit(&app, ShareEvent::running(job, kind, 0.0));
        let worker = app.clone();
        let spawned = std::thread::Builder::new()
            .name("rokk-share".into())
            .spawn(move || {
                let started = Instant::now();
                let mut throttle = zoom_export::Throttle::default();
                let ticks = std::cell::Cell::new(0u32);
                let stop = || {
                    ticks.set(ticks.get().wrapping_add(1));
                    flag.load(Ordering::SeqCst)
                        || (ticks.get() % 15 == 0 && worker.get_webview_window(&label).is_none())
                };
                let mut progress = |p: f64| {
                    if throttle.ready(started.elapsed().as_millis() as u64) {
                        emit(&worker, ShareEvent::running(job, kind, p));
                    }
                };
                let result = work(&stop, &mut progress);
                let _ = std::fs::remove_file(&partial);
                let event = match result {
                    Ok(mut e) => {
                        e.job = job;
                        e
                    }
                    Err(None) => ShareEvent::cancelled(job, kind),
                    Err(Some(code)) => ShareEvent::failed(job, kind, code),
                };
                log::info!(
                    "[rokk_share] {kind:?} result={} size={} seconds={:.1}",
                    event.state.name(),
                    event.size.unwrap_or(0),
                    started.elapsed().as_secs_f64()
                );
                jobs().end(job);
                emit(&worker, event);
            });
        if spawned.is_err() {
            jobs().end(job);
            return Err(ShareCode::RenderFailed);
        }
        Ok(job)
    }

    pub fn smaller(
        app: AppHandle,
        label: String,
        path: &str,
        bit_rate: u32,
    ) -> Result<u64, ShareCode> {
        ready()?;
        let home = home()?;
        let src = check_source(&home, Path::new(path))?;
        let rate = check_rate(bit_rate)?;
        let probe = zoom_export::av::probe(&src).ok_or(ShareCode::OpenFailed)?;
        let (out_w, out_h) = fit_1080(probe.width, probe.height);
        let estimate = (f64::from(rate) / 8.0 * probe.duration_ms / 1000.0) as u64;
        let (dir, partial, final_name) = output(&home, &src, "share", "mp4")?;
        if super::super::mac::free_bytes(&dir)
            .is_some_and(|free| !zoom_export::disk_ok(free, estimate))
        {
            return Err(ShareCode::DiskFull);
        }
        let (w, h) = (f64::from(probe.width), f64::from(probe.height));
        // The exporter's renderer with a still camera at 1x: a plain scale.
        let spec = zoom_export::av::RenderJob {
            src,
            dst: partial.clone(),
            out_w,
            out_h,
            bit_rate: rate,
            path: Arc::new(vec![[0.0, 1.0, w / 2.0, h / 2.0]]),
            side_w: w,
            side_h: h,
            duration_ms: probe.duration_ms,
        };
        log::info!("[rokk_share] smaller start out={out_w}x{out_h} rate={rate}");
        spawn(
            app,
            label,
            JobKind::Smaller,
            partial,
            move |stop, progress| {
                let (_, result) = zoom_export::av::render(&spec, stop, progress);
                match result {
                    Ok(()) => {
                        let target = finalize(&spec.dst, &dir, &final_name, "mp4").map_err(Some)?;
                        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                        let mut e = ShareEvent::done(
                            0,
                            JobKind::Smaller,
                            target.display().to_string(),
                            size,
                        );
                        e.width = Some(out_w);
                        e.height = Some(out_h);
                        Ok(e)
                    }
                    Err(zoom_export::av::Fail::Cancelled) => Err(None),
                    Err(zoom_export::av::Fail::Code(_)) => Err(Some(ShareCode::RenderFailed)),
                }
            },
        )
    }

    pub fn gif(
        app: AppHandle,
        label: String,
        path: &str,
        start_ms: f64,
        end_ms: f64,
    ) -> Result<u64, ShareCode> {
        ready()?;
        let home = home()?;
        let src = check_source(&home, Path::new(path))?;
        let probe = zoom_export::av::probe(&src).ok_or(ShareCode::OpenFailed)?;
        let (start, end) = check_range(start_ms, end_ms, probe.duration_ms)?;
        let (dir, partial, final_name) = output(&home, &src, "readme", "gif")?;
        if super::super::mac::free_bytes(&dir)
            .is_some_and(|free| !zoom_export::disk_ok(free, GIF_CAP_BYTES))
        {
            return Err(ShareCode::DiskFull);
        }
        let (src_w, src_h) = (probe.width, probe.height);
        spawn(
            app,
            label,
            JobKind::Gif,
            partial.clone(),
            move |stop, progress| {
                let made =
                    media::gif_fitting(&src, &partial, src_w, src_h, start, end, stop, progress)?;
                let target = finalize(&partial, &dir, &final_name, "gif").map_err(Some)?;
                let mut e =
                    ShareEvent::done(0, JobKind::Gif, target.display().to_string(), made.size);
                e.width = Some(made.width);
                e.height = Some(made.height);
                e.fps = Some(made.fps);
                Ok(e)
            },
        )
    }

    pub fn poster(path: &str, at_ms: f64) -> Result<Saved, ShareCode> {
        let home = home()?;
        let src = check_source(&home, Path::new(path))?;
        let probe = zoom_export::av::probe(&src).ok_or(ShareCode::OpenFailed)?;
        if !(at_ms.is_finite() && at_ms >= 0.0 && at_ms <= probe.duration_ms + 0.5) {
            return Err(ShareCode::BadRange);
        }
        let (dir, partial, final_name) = output(&home, &src, "poster", "png")?;
        let made = media::poster(&src, &partial, at_ms.min(probe.duration_ms));
        let result = made.and_then(|(width, height)| {
            let target = finalize(&partial, &dir, &final_name, "png")?;
            let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
            Ok(Saved {
                output: target.display().to_string(),
                size,
                width,
                height,
            })
        });
        let _ = std::fs::remove_file(&partial);
        log::info!(
            "[rokk_share] poster result={}",
            if result.is_ok() { "done" } else { "error" }
        );
        result
    }

    fn on_main<T: Send + 'static>(
        app: &AppHandle,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Option<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(work());
        })
        .ok()?;
        rx.recv_timeout(std::time::Duration::from_secs(5)).ok()
    }

    pub fn copy_file(app: &AppHandle, path: &str) -> Result<(), ShareCode> {
        let src = check_source(&home()?, Path::new(path))?;
        on_main(app, move || media::copy_file(&src))
            .unwrap_or(false)
            .then_some(())
            .ok_or(ShareCode::CopyFailed)
    }

    pub fn drag(window: tauri::WebviewWindow, path: &str) -> Result<(), ShareCode> {
        let src = check_source(&home()?, Path::new(path))?;
        let app = window.app_handle().clone();
        on_main(&app, move || {
            let ns_window = window.ns_window().ok()?;
            media::drag(ns_window, &src).then_some(())
        })
        .flatten()
        .ok_or(ShareCode::DragFailed)
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use tauri::AppHandle;

    pub fn source(_: &str) -> Result<String, ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn probe(_: &str) -> Result<FileInfo, ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn smaller(_: AppHandle, _: String, _: &str, _: u32) -> Result<u64, ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn gif(_: AppHandle, _: String, _: &str, _: f64, _: f64) -> Result<u64, ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn poster(_: &str, _: f64) -> Result<Saved, ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn copy_file(_: &AppHandle, _: &str) -> Result<(), ShareCode> {
        Err(ShareCode::Unsupported)
    }
    pub fn drag(_: tauri::WebviewWindow, _: &str) -> Result<(), ShareCode> {
        Err(ShareCode::Unsupported)
    }
}

/// Every unsafe call of the share helpers: AVFoundation frames, ImageIO
/// GIF and PNG files, the pasteboard and the drag session (macOS only).
#[cfg(target_os = "macos")]
mod media {
    use super::{gif_size, gif_times, ShareCode, GIF_CAP_BYTES, GIF_STEPS};
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEventType, NSPasteboard, NSPasteboardWriting, NSWindow, NSWorkspace,
    };
    use objc2_av_foundation::{AVAsset, AVAssetImageGenerator, AVMediaTypeVideo, AVURLAsset};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_media::CMTime;
    use objc2_foundation::{
        NSArray, NSDictionary, NSNumber, NSObject, NSObjectProtocol, NSString, NSURL,
    };
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        fn CGImageDestinationCreateWithURL(
            url: *const c_void,
            kind: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *mut c_void;
        fn CGImageDestinationSetProperties(dest: *mut c_void, properties: *const c_void);
        fn CGImageDestinationAddImage(
            dest: *mut c_void,
            image: *const c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
        static kCGImagePropertyGIFDictionary: *const c_void;
        static kCGImagePropertyGIFLoopCount: *const c_void;
        static kCGImagePropertyGIFDelayTime: *const c_void;
        static kCGImagePropertyGIFUnclampedDelayTime: *const c_void;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGImageGetWidth(image: *const c_void) -> usize;
        fn CGImageGetHeight(image: *const c_void) -> usize;
    }

    #[link(name = "CoreMedia", kind = "framework")]
    extern "C" {
        fn CMFormatDescriptionGetMediaSubType(desc: *const c_void) -> u32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    fn open(path: &Path) -> Option<Retained<AVURLAsset>> {
        let url = NSURL::from_file_path(path)?;
        // SAFETY: a file URL and no options. The asset only reads the file.
        Some(unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) })
    }

    fn cm(ms: f64) -> CMTime {
        // SAFETY: a plain value constructor with a positive timescale.
        unsafe { CMTime::new((ms.max(0.0) * 0.6).round() as i64, 600) }
    }

    /// The video codec as a readable name ("H.264", "HEVC") or its FourCC.
    pub fn codec(path: &Path) -> Option<String> {
        autoreleasepool(|_| {
            let asset = open(path)?;
            // SAFETY: a framework constant and a synchronous track query on a
            // local file, off the main thread (deprecated, still supported).
            #[allow(deprecated)]
            let track = unsafe { asset.tracksWithMediaType(AVMediaTypeVideo?) }.firstObject()?;
            // SAFETY: a plain property read.
            let descs = unsafe { track.formatDescriptions() };
            let first = descs.firstObject()?;
            // SAFETY: each element is a CMFormatDescription, toll-free as an
            // object; the call only reads it.
            let sub =
                unsafe { CMFormatDescriptionGetMediaSubType(Retained::as_ptr(&first).cast()) };
            let four: String = sub.to_be_bytes().iter().map(|b| char::from(*b)).collect();
            Some(match four.as_str() {
                "avc1" | "avc3" => "H.264".to_string(),
                "hvc1" | "hev1" => "HEVC".to_string(),
                other => other.trim().to_string(),
            })
        })
    }

    fn generator(asset: &AVAsset, max: Option<(u32, u32)>) -> Retained<AVAssetImageGenerator> {
        // SAFETY: a new generator for a local asset, configured before use:
        // exact frames (zero tolerance), the track's orientation applied.
        unsafe {
            let g = AVAssetImageGenerator::assetImageGeneratorWithAsset(asset);
            g.setAppliesPreferredTrackTransform(true);
            g.setRequestedTimeToleranceBefore(cm(0.0));
            g.setRequestedTimeToleranceAfter(cm(0.0));
            if let Some((w, h)) = max {
                g.setMaximumSize(CGSize {
                    width: f64::from(w),
                    height: f64::from(h),
                });
            }
            g
        }
    }

    fn dict(items: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
        let keys: Vec<&NSString> = items.iter().map(|(k, _)| *k).collect();
        let values: Vec<&AnyObject> = items.iter().map(|(_, v)| *v).collect();
        NSDictionary::from_slices(&keys, &values)
    }

    fn key(k: *const c_void) -> &'static NSString {
        // SAFETY: ImageIO's property keys are constant CFStrings, toll-free
        // bridged to NSString and alive for the whole process.
        unsafe { &*k.cast::<NSString>() }
    }

    fn obj(o: &NSObject) -> &AnyObject {
        o
    }

    /// An ImageIO destination that is released when dropped.
    struct Dest(*mut c_void);

    impl Dest {
        fn new(path: &Path, uti: &str, count: usize) -> Option<Self> {
            let url = NSURL::from_file_path(path)?;
            let kind = NSString::from_str(uti);
            // SAFETY: NSURL and NSString are toll-free bridged to CFURL and
            // CFString; ImageIO returns null on failure, checked below.
            let d = unsafe {
                CGImageDestinationCreateWithURL(
                    Retained::as_ptr(&url).cast(),
                    Retained::as_ptr(&kind).cast(),
                    count,
                    std::ptr::null(),
                )
            };
            (!d.is_null()).then_some(Self(d))
        }
    }

    impl Drop for Dest {
        fn drop(&mut self) {
            // SAFETY: created by a Create function, released exactly once.
            unsafe { CFRelease(self.0) }
        }
    }

    pub struct Gif {
        pub size: u64,
        pub width: u32,
        pub height: u32,
        pub fps: u32,
    }

    /// Writes one GIF attempt. Err(None) is a cancel.
    fn gif_once(
        asset: &AVAsset,
        dst: &Path,
        size: (u32, u32),
        times: &[f64],
        fps: u32,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(f64),
    ) -> Result<(u32, u32), Option<ShareCode>> {
        let gen = generator(asset, Some(size));
        let dest = Dest::new(dst, "com.compuserve.gif", times.len())
            .ok_or(Some(ShareCode::WriteFailed))?;
        let delay = NSNumber::new_f64(1.0 / f64::from(fps));
        let zero = NSNumber::new_i32(0);
        // SAFETY: reading ImageIO's constant keys.
        let (gif_key, loop_key, delay_key, unclamped_key) = unsafe {
            (
                key(kCGImagePropertyGIFDictionary),
                key(kCGImagePropertyGIFLoopCount),
                key(kCGImagePropertyGIFDelayTime),
                key(kCGImagePropertyGIFUnclampedDelayTime),
            )
        };
        let file_props = dict(&[(gif_key, obj(&dict(&[(loop_key, obj(&zero))])))]);
        let frame_inner = dict(&[(delay_key, obj(&delay)), (unclamped_key, obj(&delay))]);
        let frame_props = dict(&[(gif_key, obj(&frame_inner))]);
        // SAFETY: a live destination and a dictionary bridged to CFDictionary.
        unsafe { CGImageDestinationSetProperties(dest.0, Retained::as_ptr(&file_props).cast()) };
        let mut dims = (0, 0);
        for (i, t) in times.iter().enumerate() {
            if stop() {
                return Err(None);
            }
            autoreleasepool(|_| {
                // SAFETY: a synchronous frame request on this worker thread
                // (deprecated in favor of the async call, still supported).
                #[allow(deprecated)]
                let image =
                    unsafe { gen.copyCGImageAtTime_actualTime_error(cm(*t), std::ptr::null_mut()) }
                        .map_err(|_| Some(ShareCode::RenderFailed))?;
                let ptr: *const c_void = Retained::as_ptr(&image).cast();
                // SAFETY: the image is alive in this scope; ImageIO retains
                // what it needs when adding it.
                unsafe {
                    if i == 0 {
                        dims = (CGImageGetWidth(ptr) as u32, CGImageGetHeight(ptr) as u32);
                    }
                    CGImageDestinationAddImage(dest.0, ptr, Retained::as_ptr(&frame_props).cast());
                }
                Ok::<(), Option<ShareCode>>(())
            })?;
            progress((i + 1) as f64 / times.len() as f64);
        }
        // SAFETY: every image is added; finalize writes the file.
        if !unsafe { CGImageDestinationFinalize(dest.0) } {
            return Err(Some(ShareCode::WriteFailed));
        }
        Ok(dims)
    }

    /// The GIF, trying GIF_STEPS until it is under the cap. The last attempt
    /// is kept even when it is still over.
    #[allow(clippy::too_many_arguments)]
    pub fn gif_fitting(
        src: &Path,
        dst: &Path,
        src_w: u32,
        src_h: u32,
        start: f64,
        end: f64,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Gif, Option<ShareCode>> {
        let asset = open(src).ok_or(Some(ShareCode::OpenFailed))?;
        let mut last = None;
        for (fps, width) in GIF_STEPS {
            let _ = std::fs::remove_file(dst);
            let size = gif_size(src_w, src_h, width);
            let times = gif_times(start, end, fps);
            let (w, h) =
                autoreleasepool(|_| gif_once(&asset, dst, size, &times, fps, stop, progress))?;
            let bytes = std::fs::metadata(dst)
                .map(|m| m.len())
                .map_err(|_| Some(ShareCode::WriteFailed))?;
            last = Some(Gif {
                size: bytes,
                width: w,
                height: h,
                fps,
            });
            if bytes <= GIF_CAP_BYTES {
                break;
            }
        }
        last.ok_or(Some(ShareCode::RenderFailed))
    }

    /// A full resolution PNG of the frame at `at_ms`.
    pub fn poster(src: &Path, dst: &Path, at_ms: f64) -> Result<(u32, u32), ShareCode> {
        autoreleasepool(|_| {
            let asset = open(src).ok_or(ShareCode::OpenFailed)?;
            let gen = generator(&asset, None);
            // SAFETY: a synchronous frame request off the main thread.
            #[allow(deprecated)]
            let image =
                unsafe { gen.copyCGImageAtTime_actualTime_error(cm(at_ms), std::ptr::null_mut()) }
                    .map_err(|_| ShareCode::RenderFailed)?;
            let ptr: *const c_void = Retained::as_ptr(&image).cast();
            let dest = Dest::new(dst, "public.png", 1).ok_or(ShareCode::WriteFailed)?;
            // SAFETY: a live image and destination; one image, then finalize.
            unsafe {
                CGImageDestinationAddImage(dest.0, ptr, std::ptr::null());
                if !CGImageDestinationFinalize(dest.0) {
                    return Err(ShareCode::WriteFailed);
                }
                Ok((CGImageGetWidth(ptr) as u32, CGImageGetHeight(ptr) as u32))
            }
        })
    }

    /// Puts the file on the general pasteboard as a file URL. Main thread.
    pub fn copy_file(path: &Path) -> bool {
        let Some(url) = NSURL::from_file_path(path) else {
            return false;
        };
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let item: Retained<ProtocolObject<dyn NSPasteboardWriting>> =
            ProtocolObject::from_retained(url);
        pb.writeObjects(&NSArray::from_retained_slice(&[item]))
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and this class
        // does not implement Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "RokkShareDragSource"]
        struct DragSource;

        unsafe impl NSObjectProtocol for DragSource {}

        unsafe impl NSDraggingSource for DragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn source_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }
        }
    );

    impl DragSource {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            // SAFETY: NSObject's plain init.
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        // The source of the last drag, kept alive while AppKit may call it.
        static SOURCE: RefCell<Option<Retained<DragSource>>> = const { RefCell::new(None) };
    }

    /// Starts a native drag of the file from the window's content view, only
    /// while the left mouse button is down or dragging. Main thread.
    pub fn drag(ns_window: *mut c_void, path: &Path) -> bool {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        if ns_window.is_null() {
            return false;
        }
        let Some(event) = NSApplication::sharedApplication(mtm).currentEvent() else {
            return false;
        };
        if !matches!(
            event.r#type(),
            NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
        ) {
            return false;
        }
        // SAFETY: Tauri's NSWindow pointer for this window, used on the main
        // thread while the window is alive.
        let window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        let Some(view) = window.contentView() else {
            return false;
        };
        let Some(url) = NSURL::from_file_path(path) else {
            return false;
        };
        let item = NSDraggingItem::initWithPasteboardWriter(
            NSDraggingItem::alloc(),
            ProtocolObject::from_ref(&*url),
        );
        let icon = NSWorkspace::sharedWorkspace()
            .iconForFile(&NSString::from_str(&path.display().to_string()));
        let p = view.convertPoint_fromView(event.locationInWindow(), None);
        let frame = CGRect {
            origin: CGPoint {
                x: p.x - 32.0,
                y: p.y - 32.0,
            },
            size: CGSize {
                width: 64.0,
                height: 64.0,
            },
        };
        // SAFETY: the contents are an NSImage, as AppKit documents.
        unsafe { item.setDraggingFrame_contents(frame, Some(&icon)) };
        let source = DragSource::new(mtm);
        let _session = view.beginDraggingSessionWithItems_event_source(
            &NSArray::from_retained_slice(&[item]),
            &event,
            ProtocolObject::from_ref(&*source),
        );
        SOURCE.with(|s| *s.borrow_mut() = Some(source));
        true
    }

    /// Test helpers: a small generated H.264 video (moving color bars).
    #[cfg(test)]
    pub mod testvideo {
        use objc2::encode::{Encoding, RefEncode};
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2_av_foundation::{
            AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor,
            AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeVideo, AVVideoCodecKey,
            AVVideoCodecTypeH264, AVVideoHeightKey, AVVideoWidthKey,
        };
        use objc2_core_media::CMTime;
        use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
        use std::ffi::c_void;
        use std::path::Path;

        #[repr(C)]
        pub struct CVBuffer {
            _p: [u8; 0],
        }
        // SAFETY: CVPixelBufferRef is a pointer to the opaque __CVBuffer.
        unsafe impl RefEncode for CVBuffer {
            const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__CVBuffer", &[]));
        }

        #[link(name = "CoreVideo", kind = "framework")]
        extern "C" {
            fn CVPixelBufferCreate(
                a: *const c_void,
                w: usize,
                h: usize,
                fmt: u32,
                attrs: *const c_void,
                out: *mut *mut CVBuffer,
            ) -> i32;
            fn CVPixelBufferLockBaseAddress(pb: *mut CVBuffer, flags: u64) -> i32;
            fn CVPixelBufferUnlockBaseAddress(pb: *mut CVBuffer, flags: u64) -> i32;
            fn CVPixelBufferGetBaseAddress(pb: *mut CVBuffer) -> *mut u8;
            fn CVPixelBufferGetBytesPerRow(pb: *mut CVBuffer) -> usize;
            fn CVPixelBufferRelease(pb: *mut CVBuffer);
        }

        /// Writes `frames` frames of `w` by `h` at 30 fps to `dst`.
        pub fn write(dst: &Path, w: usize, h: usize, frames: usize) {
            unsafe {
                let url = NSURL::from_file_path(dst).unwrap();
                let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
                    &url,
                    AVFileTypeMPEG4.unwrap(),
                )
                .unwrap();
                let (nw, nh) = (NSNumber::new_usize(w), NSNumber::new_usize(h));
                let keys: [&NSString; 3] = [
                    AVVideoCodecKey.unwrap(),
                    AVVideoWidthKey.unwrap(),
                    AVVideoHeightKey.unwrap(),
                ];
                let values: [&AnyObject; 3] = [AVVideoCodecTypeH264.unwrap(), &nw, &nh];
                let settings: Retained<NSDictionary<NSString, AnyObject>> =
                    NSDictionary::from_slices(&keys, &values);
                let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                    AVMediaTypeVideo.unwrap(),
                    Some(&settings),
                );
                input.setExpectsMediaDataInRealTime(false);
                writer.addInput(&input);
                let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(&input, None);
                assert!(writer.startWriting());
                writer.startSessionAtSourceTime(CMTime::new(0, 30));
                for i in 0..frames {
                    while !input.isReadyForMoreMediaData() {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    let mut pb: *mut CVBuffer = std::ptr::null_mut();
                    assert_eq!(
                        CVPixelBufferCreate(
                            std::ptr::null(),
                            w,
                            h,
                            0x4247_5241,
                            std::ptr::null(),
                            &mut pb
                        ),
                        0
                    );
                    CVPixelBufferLockBaseAddress(pb, 0);
                    let base = CVPixelBufferGetBaseAddress(pb);
                    let row = CVPixelBufferGetBytesPerRow(pb);
                    for y in 0..h {
                        for x in 0..w {
                            let p = base.add(y * row + x * 4);
                            let band = ((x + i * 4) / 16) % 4;
                            *p = (band * 60) as u8;
                            *p.add(1) = (y * 255 / h) as u8;
                            *p.add(2) = 255 - (band * 60) as u8;
                            *p.add(3) = 255;
                        }
                    }
                    CVPixelBufferUnlockBaseAddress(pb, 0);
                    let ok: bool = msg_send![&*adaptor, appendPixelBuffer: pb, withPresentationTime: CMTime::new(i as i64, 30)];
                    assert!(ok, "append frame {i}");
                    CVPixelBufferRelease(pb);
                }
                input.markAsFinished();
                let (tx, rx) = std::sync::mpsc::channel::<()>();
                let done = block2::RcBlock::new(move || {
                    let _ = tx.send(());
                });
                writer.finishWritingWithCompletionHandler(&done);
                rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap();
                assert_eq!(writer.status(), AVAssetWriterStatus::Completed);
            }
        }
    }
}

// Commands.

#[tauri::command]
pub async fn share_source(path: String) -> Result<String, ShareError> {
    tauri::async_runtime::spawn_blocking(move || imp::source(&path).map_err(ShareError::from))
        .await
        .unwrap_or_else(|_| Err(ShareCode::OpenFailed.into()))
}

#[tauri::command]
pub async fn share_probe(path: String) -> Result<FileInfo, ShareError> {
    tauri::async_runtime::spawn_blocking(move || imp::probe(&path).map_err(ShareError::from))
        .await
        .unwrap_or_else(|_| Err(ShareCode::OpenFailed.into()))
}

#[tauri::command]
pub async fn share_smaller_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    bit_rate: u32,
) -> Result<u64, ShareError> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        imp::smaller(app, label, &path, bit_rate).map_err(ShareError::from)
    })
    .await
    .unwrap_or_else(|_| Err(ShareCode::RenderFailed.into()))
}

#[tauri::command]
pub async fn share_gif_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    start_ms: f64,
    end_ms: f64,
) -> Result<u64, ShareError> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        imp::gif(app, label, &path, start_ms, end_ms).map_err(ShareError::from)
    })
    .await
    .unwrap_or_else(|_| Err(ShareCode::RenderFailed.into()))
}

#[tauri::command]
pub fn share_cancel(job: u64) {
    if jobs().cancel(job) {
        log::info!("[rokk_share] cancel requested");
    }
}

#[tauri::command]
pub async fn share_poster(path: String, at_ms: f64) -> Result<Saved, ShareError> {
    tauri::async_runtime::spawn_blocking(move || {
        imp::poster(&path, at_ms).map_err(ShareError::from)
    })
    .await
    .unwrap_or_else(|_| Err(ShareCode::RenderFailed.into()))
}

#[tauri::command]
pub async fn share_copy_file(app: tauri::AppHandle, path: String) -> Result<(), ShareError> {
    tauri::async_runtime::spawn_blocking(move || {
        imp::copy_file(&app, &path).map_err(ShareError::from)
    })
    .await
    .unwrap_or_else(|_| Err(ShareCode::CopyFailed.into()))
}

#[tauri::command]
pub async fn share_drag(window: tauri::WebviewWindow, path: String) -> Result<(), ShareError> {
    tauri::async_runtime::spawn_blocking(move || imp::drag(window, &path).map_err(ShareError::from))
        .await
        .unwrap_or_else(|_| Err(ShareCode::DragFailed.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_sizes_fit_1080_and_stay_even() {
        assert_eq!(fit_1080(2554, 1616), (1706, 1080));
        assert_eq!(fit_1080(3840, 2160), (1920, 1080));
        assert_eq!(
            fit_1080(1280, 720),
            (1280, 720),
            "never larger than the source"
        );
        assert_eq!(fit_1080(1081, 1921), (1080, 1920));
        assert_eq!(fit_1080(1170, 2532), (888, 1920));
        let (w, h) = fit_1080(2555, 1617);
        assert!(w % 2 == 0 && h % 2 == 0 && w <= 1920 && h <= 1080);
    }

    #[test]
    fn share_gif_sizes_and_frame_times() {
        assert_eq!(gif_size(2554, 1616, 960), (960, 608));
        assert_eq!(
            gif_size(320, 200, 960),
            (320, 200),
            "never wider than the source"
        );
        assert_eq!(gif_size(2554, 1616, 480), (480, 304));
        let t = gif_times(1000.0, 3000.0, 12);
        assert_eq!(t.len(), 24);
        assert_eq!(t[0], 1000.0);
        assert!(t.iter().all(|v| *v < 3000.0));
        assert_eq!(gif_times(0.0, 10_000.0, 8).len(), 80);
        assert_eq!(gif_times(0.0, 10.0, 12).len(), 1, "at least one frame");
        // Frame rate drops first, then width.
        assert_eq!(GIF_STEPS[0], (12, 960));
        assert!(GIF_STEPS
            .windows(2)
            .all(|w| w[1].0 < w[0].0 && w[1].1 == w[0].1 || w[1].0 == w[0].0 && w[1].1 < w[0].1));
    }

    #[test]
    fn share_range_and_rate_checks() {
        assert_eq!(check_range(0.0, 10_000.0, 12_000.0), Ok((0.0, 10_000.0)));
        assert_eq!(check_range(500.0, 2_000.0, 2_000.2), Ok((500.0, 2_000.0)));
        for (s, e) in [
            (0.0, 10_001.0),
            (-1.0, 100.0),
            (5.0, 50.0),
            (0.0, 13_000.0),
            (f64::NAN, 1.0),
            (3.0, 2.0),
        ] {
            assert_eq!(
                check_range(s, e, 12_000.0),
                Err(ShareCode::BadRange),
                "{s}..{e}"
            );
        }
        assert_eq!(check_rate(5_000_000), Ok(5_000_000));
        assert_eq!(check_rate(MIN_RATE - 1), Err(ShareCode::BadRate));
        assert_eq!(check_rate(MAX_RATE + 1), Err(ShareCode::BadRate));
    }

    #[test]
    fn share_output_names_never_overwrite() {
        let stem = "Rokk-2026-11-02-090507-zoom";
        assert_eq!(
            pick_output(stem, "share", "mp4", |_| false),
            Some((
                "Rokk-2026-11-02-090507-zoom-share.mp4".into(),
                "Rokk-2026-11-02-090507-zoom-share-partial.mp4".into()
            ))
        );
        let taken = ["Rokk-2026-11-02-090507-readme.gif"];
        assert_eq!(
            pick_output("Rokk-2026-11-02-090507", "readme", "gif", |n| taken
                .contains(&n))
            .unwrap()
            .0,
            "Rokk-2026-11-02-090507-readme-2.gif"
        );
        assert!(pick_output(stem, "poster", "png", |_| true).is_none());
        for (good, ok) in [
            ("Rokk-2026-11-02-090507-share-partial.mp4", true),
            ("Rokk-2026-11-02-090507-zoom-share-3-partial.mp4", true),
            ("Rokk-2026-11-02-090507-readme-partial.gif", true),
            ("Rokk-2026-11-02-090507-poster-2-partial.png", true),
            ("Rokk-2026-11-02-090507-partial.mp4", false),
            ("Rokk-2026-11-02-090507-zoom-partial.mp4", false),
            ("Rokk-2026-11-02-090507-readme-partial.png", false),
            ("holiday-share-partial.mp4", false),
        ] {
            assert_eq!(share_partial_name(good), ok, "{good}");
        }
        // A share copy is neither an original nor a zoomed copy.
        assert!(!logic::recording_name("Rokk-2026-11-02-090507-share.mp4"));
        assert!(!logic::zoom_copy_name(
            "Rokk-2026-11-02-090507-zoom-share.mp4"
        ));
    }

    fn home() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(logic::output_dir(d.path())).unwrap();
        let p = d.path().to_path_buf();
        (d, p)
    }

    #[test]
    fn share_source_prefers_the_newest_zoomed_copy() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let orig = dir.join("Rokk-2026-11-02-090507.mp4");
        std::fs::write(&orig, b"x").unwrap();
        assert!(pick_source(&h, &orig)
            .unwrap()
            .ends_with("Rokk-2026-11-02-090507.mp4"));
        // Another recording's copy does not count.
        std::fs::write(dir.join("Rokk-2026-11-02-090508-zoom.mp4"), b"x").unwrap();
        assert!(pick_source(&h, &orig)
            .unwrap()
            .ends_with("Rokk-2026-11-02-090507.mp4"));
        std::fs::write(dir.join("Rokk-2026-11-02-090507-zoom.mp4"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("Rokk-2026-11-02-090507-zoom-2.mp4"), b"x").unwrap();
        assert!(pick_source(&h, &orig)
            .unwrap()
            .ends_with("Rokk-2026-11-02-090507-zoom-2.mp4"));
        // A zoomed copy is shared as it is; other files are refused.
        let copy = dir.join("Rokk-2026-11-02-090507-zoom.mp4");
        assert!(pick_source(&h, &copy)
            .unwrap()
            .ends_with("Rokk-2026-11-02-090507-zoom.mp4"));
        // A smaller copy can be shared once it exists.
        let small = dir.join("Rokk-2026-11-02-090507-zoom-share.mp4");
        assert_eq!(
            pick_source(&h, &small).unwrap_err(),
            ShareCode::NotOurs,
            "missing"
        );
        std::fs::write(&small, b"x").unwrap();
        assert!(pick_source(&h, &small)
            .unwrap()
            .ends_with("Rokk-2026-11-02-090507-zoom-share.mp4"));
        assert!(share_copy_name("Rokk-2026-11-02-090507-share-2.mp4"));
        assert!(!share_copy_name("Rokk-2026-11-02-090507-share-partial.mp4"));
        assert!(!share_copy_name("holiday-share.mp4"));
        for bad in [
            dir.join("holiday.mp4"),
            h.join("Rokk-2026-11-02-090507.mp4"),
            dir.join("Rokk-2026-11-02-090508-share.mp4"),
        ] {
            assert_eq!(
                pick_source(&h, &bad).unwrap_err(),
                ShareCode::NotOurs,
                "{}",
                bad.display()
            );
        }
        // Outputs: generated names directly in Movies/Rokk only.
        assert!(check_share_output(&h, &dir.join("Rokk-x-readme.gif"), "gif").is_ok());
        assert!(check_share_output(&h, &dir.join("Rokk-x-readme.gif"), "png").is_err());
        assert!(check_share_output(&h, &h.join("Rokk-x-readme.gif"), "gif").is_err());
        assert!(
            check_share_output(&h, &dir.join("..").join("Rokk").join("Rokk-x.png"), "png").is_err()
        );
        assert!(check_share_output(&h, &dir.join("Rokk x.png"), "png").is_err());
    }

    #[test]
    fn share_event_shape_and_codes() {
        let v = serde_json::to_value(ShareEvent::running(2, JobKind::Gif, 0.123_456)).unwrap();
        assert_eq!(v["kind"], "gif");
        assert_eq!(v["state"], "running");
        assert_eq!(v["progress"], 0.123);
        let d = serde_json::to_value(ShareEvent::done(
            2,
            JobKind::Smaller,
            "/x/Rokk-a-share.mp4".into(),
            9,
        ))
        .unwrap();
        assert_eq!(
            (
                d["state"].as_str(),
                d["size"].as_u64(),
                d["progress"].as_f64()
            ),
            (Some("done"), Some(9), Some(1.0))
        );
        let f =
            serde_json::to_value(ShareEvent::failed(2, JobKind::Gif, ShareCode::BadRange)).unwrap();
        assert_eq!(f["code"], "bad_range");
        use ShareCode::*;
        for c in [
            Unsupported,
            OldMacos,
            Busy,
            Recording,
            NotOurs,
            BadRange,
            BadRate,
            DiskFull,
            OpenFailed,
            RenderFailed,
            WriteFailed,
            CopyFailed,
            DragFailed,
        ] {
            assert_eq!(serde_json::to_value(c).unwrap(), c.name());
            assert!(c.message().ends_with('.') && !c.message().contains('\u{2014}'));
        }
    }

    /// Manual: the GIF steps on a real recording, written to a temp folder
    /// (the recording is only read). Run with
    /// `ROKK_SHARE_SAMPLE=<mp4> cargo test --lib rokk_record::share -- --ignored --nocapture`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn share_gif_from_a_real_recording() {
        let Ok(sample) = std::env::var("ROKK_SHARE_SAMPLE") else {
            return;
        };
        let src = PathBuf::from(sample);
        let probe = zoom_export::av::probe(&src).expect("probe");
        let d = tempfile::tempdir().unwrap();
        let gif = d.path().join("sample-readme.gif");
        let end = probe.duration_ms.min(GIF_MAX_MS);
        let started = std::time::Instant::now();
        let made = media::gif_fitting(
            &src,
            &gif,
            probe.width,
            probe.height,
            0.0,
            end,
            &|| false,
            &mut |_| {},
        )
        .ok()
        .expect("gif");
        println!(
            "source {}x{} {:.1}s -> gif {}x{} {} fps {:.2} MB in {:.1}s",
            probe.width,
            probe.height,
            end / 1000.0,
            made.width,
            made.height,
            made.fps,
            made.size as f64 / 1e6,
            started.elapsed().as_secs_f64()
        );
    }

    /// The real AVFoundation and ImageIO paths, on a small generated video.
    #[cfg(target_os = "macos")]
    #[test]
    fn share_gif_poster_and_smaller_copy_from_a_generated_video() {
        let (_d, h) = home();
        let dir = logic::output_dir(&h);
        let src = dir.join("Rokk-2026-11-02-090507.mp4");
        media::testvideo::write(&src, 320, 200, 60);
        let probe = zoom_export::av::probe(&src).expect("probe");
        assert_eq!((probe.width, probe.height), (320, 200));
        assert!(
            (probe.duration_ms - 2000.0).abs() < 50.0,
            "{}",
            probe.duration_ms
        );
        assert_eq!(media::codec(&src).as_deref(), Some("H.264"));

        // GIF: one second at 12 fps from 0.5 s, source narrower than 960.
        let gif = dir.join("Rokk-2026-11-02-090507-readme-partial.gif");
        let mut seen = 0.0;
        let made = media::gif_fitting(&src, &gif, 320, 200, 500.0, 1500.0, &|| false, &mut |p| {
            seen = p
        })
        .ok()
        .expect("gif");
        assert_eq!((made.width, made.height, made.fps), (320, 200, 12));
        assert!(made.size > 0 && made.size <= GIF_CAP_BYTES);
        assert_eq!(seen, 1.0);
        let bytes = std::fs::read(&gif).unwrap();
        assert_eq!(&bytes[..4], b"GIF8", "{:?}", &bytes[..6]);
        assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), 320);
        assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), 200);
        // Frame count: one Graphic Control Extension (0x21 0xF9 0x04) per frame.
        let frames = bytes
            .windows(3)
            .filter(|w| w == &[0x21, 0xF9, 0x04])
            .count();
        assert_eq!(frames, 12);
        // Loops forever: the NETSCAPE2.0 extension with a loop count of 0.
        let at = bytes
            .windows(11)
            .position(|w| w == b"NETSCAPE2.0")
            .expect("loop extension");
        assert_eq!(&bytes[at + 11..at + 15], &[3, 1, 0, 0]);
        // A cancel stops it.
        let cancelled =
            media::gif_fitting(&src, &gif, 320, 200, 0.0, 1000.0, &|| true, &mut |_| {});
        assert!(matches!(cancelled, Err(None)));

        // Poster: a full resolution PNG.
        let png = dir.join("Rokk-2026-11-02-090507-poster-partial.png");
        assert_eq!(media::poster(&src, &png, 1000.0), Ok((320, 200)));
        let b = std::fs::read(&png).unwrap();
        assert_eq!(&b[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes([b[16], b[17], b[18], b[19]]), 320);
        assert_eq!(u32::from_be_bytes([b[20], b[21], b[22], b[23]]), 200);

        // Smaller copy: the exporter's renderer with a still camera.
        let out = dir.join("Rokk-2026-11-02-090507-share-partial.mp4");
        let spec = zoom_export::av::RenderJob {
            src: src.clone(),
            dst: out.clone(),
            out_w: 320,
            out_h: 200,
            bit_rate: MIN_RATE,
            path: std::sync::Arc::new(vec![[0.0, 1.0, 160.0, 100.0]]),
            side_w: 320.0,
            side_h: 200.0,
            duration_ms: probe.duration_ms,
        };
        let (frames, result) = zoom_export::av::render(&spec, &|| false, &mut |_| {});
        assert!(result.is_ok() && frames > 50, "frames={frames}");
        let p = zoom_export::av::probe(&out).expect("probe copy");
        assert_eq!((p.width, p.height), (320, 200));
        let target = finalize(&out, &dir, "Rokk-2026-11-02-090507-share.mp4", "mp4").unwrap();
        assert!(target.ends_with("Rokk-2026-11-02-090507-share.mp4"));
        assert!(src.exists(), "the original is never touched");
    }
}

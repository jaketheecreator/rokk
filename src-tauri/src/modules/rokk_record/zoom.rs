// Auto-zoom, Phase B: reads a saved mouse path file back for the preview
// player. Read only: nothing here writes, renames or deletes. The result
// holds the same numbers and fixed words as the file (see cursor.rs), and is
// refused if it holds anything else. See docs/rokk/ZOOM_MAP.md.

use super::cursor::{self, Rect};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;

/// Larger files are refused before parsing. A 10 minute track is about 300 kB.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024;

const EVENT_KINDS: [&str; 4] = ["move", "resize", "scale", "display"];
const END_REASONS: [&str; 7] = ["tray", "shortcut", "system", "cap", "disk", "window_closed", "app_exit"];

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Video {
    pub width: i64,
    pub height: i64,
    pub scale: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub t_ms: i64,
    pub kind: String,
    pub rect: Rect,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct End {
    pub t_ms: i64,
    pub reason: String,
}

/// A parsed version 1 file.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Loaded {
    pub version: u32,
    pub note: String,
    pub video: Video,
    pub frame: Option<Rect>,
    pub hz: u32,
    pub samples: Vec<[i64; 3]>,
    pub clicks: Vec<[i64; 4]>,
    pub events: Vec<Event>,
    pub end: End,
}

#[derive(Deserialize)]
struct Probe {
    version: u32,
}

/// The short plain errors the player shows.
pub mod why {
    pub const NOT_OURS: &str = "This is not a Rokk mouse path file in Movies/Rokk.";
    pub const NO_VIDEO: &str = "The recording for this mouse path is missing.";
    pub const UNREADABLE: &str = "The mouse path file could not be read.";
    pub const TOO_LARGE: &str = "The mouse path file is too large.";
    pub const VERSION: &str = "The mouse path file is from a newer or older version of Rokk.";
    pub const INVALID: &str = "The mouse path file is damaged.";
}

/// `Rokk-YYYY-MM-DD-HHMMSS.zoom.json`, or with `-N` before the suffix as
/// finalize names a second recording in the same second.
pub fn generated_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(cursor::SUFFIX).and_then(|s| s.strip_prefix("Rokk-")) else {
        return false;
    };
    let b = stem.as_bytes();
    if b.len() < 17 {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    let stamp = digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10) && b[10] == b'-' && digits(11..17);
    let counter = match b[17..].split_first() {
        None => true,
        Some((b'-', n)) => (1..=3).contains(&n.len()) && n.iter().all(u8::is_ascii_digit),
        Some(_) => false,
    };
    stamp && counter
}

/// Checks the path, then reads and validates the file.
pub fn read(home: &Path, file: &Path) -> Result<Loaded, &'static str> {
    let name = file.file_name().and_then(|n| n.to_str()).ok_or(why::NOT_OURS)?;
    if !generated_name(name) {
        return Err(why::NOT_OURS);
    }
    // Directly in ~/Movies/Rokk/.zoom once symlinks and `..` are resolved,
    // not a symlink itself; its MP4 sits one folder up, in ~/Movies/Rokk.
    let real = cursor::check_sidecar(home, file).map_err(|_| why::NOT_OURS)?;
    let mp4 = cursor::video_name(name).ok_or(why::NOT_OURS)?;
    let rokk = real.parent().and_then(Path::parent).ok_or(why::NOT_OURS)?;
    super::logic::check_delete(home, &rokk.join(mp4)).map_err(|_| why::NO_VIDEO)?;
    let meta = std::fs::symlink_metadata(&real).map_err(|_| why::UNREADABLE)?;
    if !meta.is_file() {
        return Err(why::NOT_OURS);
    }
    if meta.len() > MAX_BYTES {
        return Err(why::TOO_LARGE);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&real)
        .and_then(|f| f.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| why::UNREADABLE)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(why::TOO_LARGE);
    }
    parse(&bytes)
}

/// Parses and validates file bytes: version 1, only the fixed words.
pub fn parse(bytes: &[u8]) -> Result<Loaded, &'static str> {
    let probe: Probe = serde_json::from_slice(bytes).map_err(|_| why::INVALID)?;
    if probe.version != cursor::VERSION {
        return Err(why::VERSION);
    }
    let t: Loaded = serde_json::from_slice(bytes).map_err(|_| why::INVALID)?;
    let fixed_words = t.note == cursor::NOTE
        && END_REASONS.contains(&t.end.reason.as_str())
        && t.events.iter().all(|e| EVENT_KINDS.contains(&e.kind.as_str()));
    let sane = t.video.width > 0
        && t.video.height > 0
        && t.video.scale.is_finite()
        && t.video.scale > 0.0
        && t.samples.len() <= cursor::MAX_SAMPLES
        && t.clicks.len() <= cursor::MAX_CLICKS
        && t.events.len() <= cursor::MAX_EVENTS;
    if fixed_words && sane {
        Ok(t)
    } else {
        Err(why::INVALID)
    }
}

/// The preview player's read of a saved mouse path file.
#[tauri::command]
pub async fn zoom_read(path: String) -> Result<Loaded, String> {
    super::blocking(move || {
        let home = dirs::home_dir().ok_or(why::UNREADABLE)?;
        cursor::ensure_migrated(&home);
        read(&home, Path::new(&path))
    })
    .await
    .map_err(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const NAME: &str = "Rokk-2026-11-03-143458.zoom.json";
    const MP4: &str = "Rokk-2026-11-03-143458.mp4";

    fn good() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "note": cursor::NOTE,
            "video": { "width": 2554, "height": 1616, "scale": 2.0 },
            "frame": { "x": 278, "y": 160, "w": 2000, "h": 1240 },
            "hz": 30,
            "samples": [[0, 10, 20], [33, 11, 21]],
            "clicks": [[33, 11, 21, 0]],
            "events": [{ "t_ms": 500, "kind": "move", "rect": { "x": 0, "y": 0, "w": 10, "h": 10 } }],
            "end": { "t_ms": 1000, "reason": "tray" }
        })
    }

    fn home() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let h = d.path().to_path_buf();
        let dir = super::super::logic::output_dir(&h);
        std::fs::create_dir_all(&dir).unwrap();
        (d, h, dir)
    }

    /// ~/Movies/Rokk/.zoom, where sidecars live.
    fn hidden(dir: &Path) -> PathBuf {
        let p = dir.join(cursor::HIDDEN_DIR);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(dir: &Path, name: &str, v: &serde_json::Value) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, serde_json::to_vec(v).unwrap()).unwrap();
        p
    }

    #[test]
    fn reads_a_saved_file() {
        let (_d, h, dir) = home();
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let p = put(&hidden(&dir), NAME, &good());
        let t = read(&h, &p).unwrap();
        assert_eq!(t.video, Video { width: 2554, height: 1616, scale: 2.0 });
        assert_eq!(t.frame, Some(Rect { x: 278, y: 160, w: 2000, h: 1240 }));
        assert_eq!(t.samples, [[0, 10, 20], [33, 11, 21]]);
        assert_eq!(t.clicks, [[33, 11, 21, 0]]);
        assert_eq!(t.end.t_ms, 1000);
        // A null frame is fine: the zoom then uses the whole video.
        let mut v = good();
        v["frame"] = serde_json::Value::Null;
        let p = put(&hidden(&dir), NAME, &v);
        assert_eq!(read(&h, &p).unwrap().frame, None);
    }

    #[test]
    fn the_file_written_by_phase_a_reads_back() {
        let mut track = cursor::Track { video: (100, 50), scale: 1.0, ..cursor::Track::default() };
        track.sample(0, Some((1, 2)));
        let bytes = serde_json::to_vec(&cursor::sidecar(&track, 40, "system")).unwrap();
        let t = parse(&bytes).unwrap();
        assert_eq!((t.video.width, t.video.height, t.frame), (100, 50, None));
        assert_eq!(t.samples, [[0, 1, 2]]);
    }

    #[test]
    fn only_generated_names() {
        assert!(generated_name(NAME));
        assert!(generated_name("Rokk-2026-11-03-143458-2.zoom.json"));
        assert!(generated_name("Rokk-2026-11-03-143458-999.zoom.json"));
        for bad in [
            "Rokk-1.zoom.json",
            "Rokk-2026-11-03-14345.zoom.json",
            "Rokk-2026-11-03-143458-.zoom.json",
            "Rokk-2026-11-03-143458-partial.zoom.json",
            "Rokk-2026-11-03-143458.json",
            "Rokk-2026-11-03-143458.zoom.json.rokk-tmp",
            "Rokk-2026-11-03-143458.mp4",
            "rokk-2026-11-03-143458.zoom.json",
            "Rokk-2026/11-03-143458.zoom.json",
            "notes.zoom.json",
        ] {
            assert!(!generated_name(bad), "{bad}");
        }
    }

    #[test]
    fn refuses_files_outside_the_folder_or_with_wrong_names() {
        let (_d, h, dir) = home();
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let ok = put(&hidden(&dir), NAME, &good());
        assert!(read(&h, &ok).is_ok());
        // The old place next to the MP4 is refused.
        let old = put(&dir, NAME, &good());
        assert_eq!(read(&h, &old), Err(why::NOT_OURS));
        // Outside ~/Movies/Rokk.
        let outside = put(&h, NAME, &good());
        assert_eq!(read(&h, &outside), Err(why::NOT_OURS));
        // `..` escapes, even back into the folder.
        let dotted = dir.join("..").join("Rokk").join(cursor::HIDDEN_DIR).join(NAME);
        assert_eq!(read(&h, &dotted), Err(why::NOT_OURS));
        // Wrong name and wrong extension.
        let other = put(&hidden(&dir), "Rokk-1.zoom.json", &good());
        assert_eq!(read(&h, &other), Err(why::NOT_OURS));
        let json = put(&hidden(&dir), "Rokk-2026-11-03-143458.json", &good());
        assert_eq!(read(&h, &json), Err(why::NOT_OURS));
        assert_eq!(read(&h, &dir.join(MP4)), Err(why::NOT_OURS));
    }

    #[test]
    fn refuses_a_file_without_its_video() {
        let (_d, h, dir) = home();
        let p = put(&hidden(&dir), NAME, &good());
        assert_eq!(read(&h, &p), Err(why::NO_VIDEO));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks() {
        use std::os::unix::fs::symlink;
        let (_d, h, dir) = home();
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let target = put(elsewhere.path(), NAME, &good());
        symlink(&target, hidden(&dir).join(NAME)).unwrap();
        assert_eq!(read(&h, &hidden(&dir).join(NAME)), Err(why::NOT_OURS));
        // A symlinked folder that points outside is refused too.
        let (_d2, h2, _) = home();
        let real = elsewhere.path().join("movies");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join(MP4), b"x").unwrap();
        put(&real, NAME, &good());
        let linked = h2.join("Movies").join("Linked");
        symlink(&real, &linked).unwrap();
        assert_eq!(read(&h2, &linked.join(NAME)), Err(why::NOT_OURS));
    }

    #[test]
    fn refuses_a_file_that_is_too_large() {
        let (_d, h, dir) = home();
        std::fs::write(dir.join(MP4), b"x").unwrap();
        let p = hidden(&dir).join(NAME);
        std::fs::write(&p, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(read(&h, &p), Err(why::TOO_LARGE));
    }

    #[test]
    fn refuses_other_versions_and_damaged_files() {
        let mut v = good();
        v["version"] = 2.into();
        assert_eq!(parse(&serde_json::to_vec(&v).unwrap()), Err(why::VERSION));
        assert_eq!(parse(b"not json"), Err(why::INVALID));
        assert_eq!(parse(b"{}"), Err(why::INVALID));
        // Privacy: only the fixed words, and no extra fields.
        let mut extra = good();
        extra["title"] = "my screen".into();
        assert_eq!(parse(&serde_json::to_vec(&extra).unwrap()), Err(why::INVALID));
        let mut note = good();
        note["note"] = "something else".into();
        assert_eq!(parse(&serde_json::to_vec(&note).unwrap()), Err(why::INVALID));
        let mut kind = good();
        kind["events"][0]["kind"] = "typed".into();
        assert_eq!(parse(&serde_json::to_vec(&kind).unwrap()), Err(why::INVALID));
        let mut reason = good();
        reason["end"]["reason"] = "discard".into();
        assert_eq!(parse(&serde_json::to_vec(&reason).unwrap()), Err(why::INVALID));
        let mut size = good();
        size["video"]["width"] = 0.into();
        assert_eq!(parse(&serde_json::to_vec(&size).unwrap()), Err(why::INVALID));
    }
}

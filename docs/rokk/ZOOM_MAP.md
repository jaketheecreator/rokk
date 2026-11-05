# Auto-zoom for finished recordings: map and plan

Research and plan, 2026-11-03. Phases A (the mouse path) and B (the algorithm and the preview player) are built; section 8 has the rules as built, which replace section 2 where they differ. "Verified" means read in this repo, in a crate's source under `~/.cargo/registry`, or measured with a local tool on this Mac. "Guess" marks everything else.

Auto-zoom is a post effect only:

- While recording, Rokk saves a small sidecar file with the mouse path.
- After recording, a preview player shows the zoom, and "Save with zoom" writes a new file.
- The original MP4 is never modified, and nothing zooms live during a recording.

## 0. Facts this plan rests on (verified)

**This Mac**

- macOS 26.6.2 (25G83), an Apple M1 with 8 GB, and a built-in Retina display at 2560 x 1600.
- System WebKit is 21624.5.1.11.3, the WebKit that ships with Safari 26 on this macOS.
- Tools: Homebrew `ffmpeg` (built with `--enable-gpl --enable-libx264 --enable-videotoolbox`) and `/usr/bin/avconvert`.

**Recordings in `~/Movies/Rokk`** (`ffprobe`, metadata only):

| File | Size (px) | Codec | Average fps | Bit rate |
|---|---|---|---|---|
| Rokk-2026-11-02-151108.mp4 | 2554 x 1616 | H.264 Main | 19.8 | 1.66 Mbit/s |
| Rokk-2026-11-02-224718.mp4 | 2554 x 1616 | H.264 Main | 26.3 | 2.68 Mbit/s |
| Rokk-2026-11-03-143458.mp4 | 2448 x 1616 | H.264 Main | 24.0 | 4.37 Mbit/s |

- **Variable frame rate:** ScreenCaptureKit sends a frame only when the window changes, so the frame rate varies.
- **Leftover file:** an old `Rokk-2026-11-02-151251-partial.mp4` is still in the folder.

**Capture size**

- `rokk_record/mod.rs:254` passes `window.outer_size()` to the capture. That is Tauri's `PhysicalSize`, the window's points times the backing scale factor.
- So the video is already at Retina pixel size (a window of about 1277 x 808 points gives 2554 x 1616).

**The recording output has no bit rate setting**

- In `screencapturekit-11.1.1/src/recording_output.rs`, `SCRecordingOutputConfiguration` offers only `with_output_url`, `with_video_codec` and `with_output_file_type`.
- The low bit rate above is ScreenCaptureKit's own choice.

**Window and web view**

- `tauri.conf.json` uses `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`, so the web view fills the whole window. CSS (0, 0) is the window's top left, at page zoom 1.
- The asset protocol is on with scope `["**"]` (`tauri.conf.json:30-33`), and Tauri 2.12's asset protocol answers HTTP range requests (`tauri-2.12.0/src/protocol/asset.rs:98-101`). A `<video>` in the app can already play a recording through `convertFileSrc`.
- Tauri 2.12 has `AppHandle::cursor_position()` (`tauri-2.12.0/src/app.rs:928`): the global cursor in physical pixels, relative to the top left of the main monitor.

**Crates in `src-tauri/Cargo.lock`** (all 0.3.2 unless noted)

- `objc2` 0.6.4, `objc2-app-kit`, `objc2-core-foundation`, `objc2-core-graphics`, `objc2-core-image`, `objc2-foundation`, `objc2-io-surface`, `objc2-quartz-core`, `objc2-web-kit`, plus several others not used here.
- `block2` 0.6.2 and `dispatch2` 0.3.1.
- Direct dependencies: `objc2`, `objc2-app-kit` (features `NSColor`, `NSPasteboard`, `NSPasteboardItem`, `NSWindow`, `NSWorkspace`), `objc2-foundation`, `block2`.
- **Not in the lock:** `objc2-av-foundation`, `objc2-core-media`, `objc2-core-video`.

**Cursor APIs**

- `objc2-core-graphics` 0.3.2 has `CGEventSourceButtonState` (`src/generated/CGEventSource.rs:104`) and the `CGEvent` feature.
- `rokk_record/mac.rs` already links CoreGraphics with plain `extern "C"` declarations, so more CoreGraphics functions need no new crate.

## 1. Cursor track

### Options

**(a) Pointer events in the page** (`mousemove` and `pointerdown` on `window`, `performance.now()`, throttled to 30 Hz). This **fails over the preview**:

- The stage preview is a cross-origin iframe (`PreviewPane.tsx`, `sandbox` without top navigation).
- Pointer events over it go to the iframe's document and never reach Rokk's page.
- An overlay with `pointer-events: none` does not receive events either. An overlay that does receive them would block clicks into the app, which the preview must keep (STAGE.md).
- So (a) loses the cursor exactly where Auto-zoom matters most.

**(b) Rust polls the global cursor (recommended).** It works over iframes, over native window parts and over the terminal canvas alike.

- **Position:** `CGEventGetLocation(CGEventCreate(NULL))` through `extern "C"` on CoreGraphics. This is the global position in points, with a top-left origin on the main display. It is callable from any thread (guess, per long-standing CoreGraphics behavior; verify in Phase A). It needs no permission: it reads the position, not an event tap.
- **Alternative:** Tauri's `cursor_position()`, already verified, needs no code beyond a call. Its cost per call (it goes through the runtime) is unmeasured. Use it only if the CoreGraphics call turns out to need the main thread.
- **Clicks:** poll `CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft)` and record each up-to-down change. This is not an event tap, so no Accessibility or Input Monitoring permission (guess; verify in Phase A).
- **Rate:** a dedicated thread in `rokk_record` at 30 Hz, started after `recording_did_start` and stopped by the single `stop` function.

### Clock alignment

- The video's time 0 is its first frame.
- The best marker in code is the recording output's `recording_did_start` callback (`mac.rs`, logged since the system-stop fix). Take an `Instant` there; each sample's `t_ms` is milliseconds since that instant.
- The countdown runs before `record_start` (RECORD.md), so it is never part of the track.
- **Guess:** the callback comes within about one frame of the first frame. Phase A should check the offset once: record a click on a known control and compare.

### Mapping into video pixels

- **Window:** read `outer_position()`, `outer_size()` and `scale_factor()` at start and in the existing one-second tick. A sample is `(cursor_points - window_origin_points) * scale`, which is video pixels, because the video is `outer_size()` in physical pixels.
- **Outside the window:** a sample is dropped, not stored (privacy, see below).
- **Window changes:** if the window moves or its scale changes mid-recording, the tick appends an entry to `window_changes`.
- **Resizes:** ScreenCaptureKit keeps the configured output size, so a resize mid-recording scales the content (guess). It is written down so the algorithm can skip that part.
- **Stage frame rectangle:** the page sends it at start, from `getBoundingClientRect()` of `#workspace > div`, in CSS pixels. Rust multiplies by the scale factor.
- **Page zoom** (`view.zoomIn` exists): CSS pixels are no longer points. As built, the positions do not depend on it (global cursor and window rectangle only). The page sends the frame rectangle only at app zoom 100%; otherwise `frame` is null, and the zoom works within the whole video.

### Sidecar format

The file has the same base name as its MP4, for example `Rokk-2026-11-03-143458.zoom.json`. Since 2026-11-05 it lives in the hidden folder `~/Movies/Rokk/.zoom`, so Finder shows only videos (see RECORD.md for the rules and the one-time migration). It is written once at finalize, never while recording:

```json
{
  "version": 1,
  "kind": "rokk-cursor-track",
  "content": "Mouse positions and click times only. No screen content, keys or text.",
  "video": { "width": 2554, "height": 1616 },
  "scale": 2,
  "frame": { "x": 278, "y": 160, "width": 2000, "height": 1240 },
  "rate_hz": 30,
  "samples": [[0, 1200, 900], [33, 1204, 902]],
  "clicks": [[5120, 1310, 880]],
  "window_changes": [],
  "gaps": [[8000, 9400]],
  "ended": "saved"
}
```

- **Fields:**
  - `samples` and `clicks` are `[t_ms, x, y]` integers in video pixels, with `t_ms` since the first frame.
  - `gaps` are spans with the cursor outside the window.
  - `ended` is `saved`, or `system` for a system stop (see section 7).
- **Size:**
  - One sample is about 17 bytes as JSON (`[123456,1234,567],`); 30 Hz is 30 samples a second.
  - 2 minutes is about 3,600 samples, about 61 kB. 10 minutes (the cap) is about 18,000 samples, about 306 kB. Clicks add little.
  - Samples are stored only when the cursor moved more than 1 px, which typically shrinks this a lot (guess).
- **Atomic:** written as `<base>.zoom.json.rokk-tmp`, then renamed, like the guard's settings writes.

### Privacy review

- **What it reveals:** where the pointer was inside the Rokk window, when it moved and when you clicked. It holds no screen content, keys, text, URLs or file names.
- **Combined with the video:** together they show what was clicked, but the video already shows that.
- **Outside Rokk:** positions outside the window are never stored. Off-window activity (other apps) is not recorded.
- **Sharing:** the sidecar is a separate file, so sharing the MP4 does not share it.
- **Deleting:**
  - `record_delete` must delete the sidecar too. It uses the same `check_delete` rules on a name derived from the video, `Rokk-...` plus `.zoom.json` in `~/Movies/Rokk`, not a symlink.
  - "Stop and discard", Restart and the watchdog delete it with the partial file.
  - The `check_output` name rule today accepts only `.mp4`, so Phase A adds a second allowed extension, `.zoom.json`, for exactly that one derived name.
- **Off switch:** the "Auto-zoom" setting off means no sampling thread and no sidecar.

## 2. The zoom algorithm (pure, TypeScript, lazy chunk)

### Signature

```ts
export type Sample = readonly [t: number, x: number, y: number]; // ms, video px
export type Rect = { x: number; y: number; width: number; height: number };
export type ZoomSettings = {
  level: 1.5 | 2;            // default 2
  dwellMs: 600 | 1000 | 1500; // default 1000
  dwellRadius: number;       // video px; default 2.5% of the frame diagonal
  easeInMs: number;          // default 450
  easeOutMs: number;         // default 600
  minGapMs: number;          // default 800
  maxHoldMs: number;         // default 6000
  clickHoldMs: number;       // default 1200
};
export type Keyframe = { t: number; scale: number; cx: number; cy: number };

export function autoZoom(
  samples: readonly Sample[],
  clicks: readonly Sample[],
  frame: Rect | null, // null: zoom within the whole video
  video: { width: number; height: number },
  durationMs: number,
  settings?: Partial<ZoomSettings>,
): Keyframe[];

/** The view at time t: interpolates between keyframes. */
export function viewAt(keys: readonly Keyframe[], t: number): { scale: number; cx: number; cy: number };
```

### Steps

1. **Clean:** drop samples outside `frame`; each run of dropped samples is a break. Sort by `t`.
2. **Dwell detection:**
   - A dwell starts at the first sample `a` where every sample in `[a, a + dwellMs]` lies within `dwellRadius` of their centroid.
   - It extends while new samples stay within `1.5 * dwellRadius` of the running centroid (hysteresis, so small jitter does not end it).
   - It ends at a break, when the cursor leaves that circle, or at `a + maxHoldMs`.
3. **Clicks as anchors:** each click makes a dwell `[tc - easeInMs, tc + clickHoldMs]` centered on the click. A click inside an existing dwell extends it. Clicks outside `frame` are ignored.
4. **Merge:**
   - Two dwells less than `minGapMs` apart with centers within `3 * dwellRadius` become one.
   - Dwells less than `minGapMs` apart with centers farther away become a pan: the scale stays and the center moves over `easeInMs`.
5. **Keyframes per dwell `[a, b]`, center `c`:**
   - Zoom in from scale 1 at `a` to `level` at `a + easeInMs`. Post processing can start at `a`, the moment the mouse arrived, because the whole track is known.
   - Hold until `b`, then zoom out to scale 1 over `easeOutMs`.
6. **Clamp:** the visible rectangle `(width / scale, height / scale)` around `c` must stay inside `frame`. If the frame is smaller than that rectangle, center on the frame.
7. **Interpolation** (`viewAt`):
   - Smootherstep `6u^5 - 15u^4 + 10u^3` between keyframes, for the center.
   - The same curve on `log(scale)` for the scale, so zooming in and out feel even.
   - Deterministic and easy to test.
   - A critically damped spring is a later tuning option (Phase D).
8. **Start and end:**
   - No zoom starts before `dwellMs` into the video, even if the mouse rests at time 0.
   - Every zoom out ends by `durationMs`. If `b + easeOutMs > durationMs`, the zoom out starts at `durationMs - easeOutMs`, and a dwell shorter than its ease is dropped.
9. **Window changes:** dwells overlapping a `window_changes` entry or a resize are dropped (no zoom on a moving target).

### Test cases

- No samples gives no keyframes.
- A still mouse for the whole video zooms in once after `dwellMs`, then out before the end.
- A mouse that never rests gives no zoom.
- Jitter within the radius keeps one dwell.
- A click with no dwell zooms for `clickHoldMs`.
- Two near dwells merge; two far dwells within `minGapMs` pan; far dwells with a long gap zoom out and back in.
- `maxHoldMs` ends a long dwell.
- A dwell at the frame's edge clamps so the view stays inside the frame.
- A frame smaller than the zoomed view centers on the frame.
- The mouse outside the frame breaks a dwell.
- A video shorter than one ease gives no zoom.
- `viewAt` is continuous; at keyframe times it returns the keyframe; it is scale 1 before the first and after the last.
- Levels 1.5 and 2, and dwells 600, 1000 and 1500 ms, change the counts and timings as expected.

## 3. Rendering

The output is a new `Rokk-...-zoom.mp4` next to the original. The speed figures below are guesses: nothing was run.

### R1: hidden `<video>` plus `<canvas>` plus `MediaRecorder` in the WKWebView

- **How:** play the original through `convertFileSrc` (works today, verified above). Draw each frame to a canvas with the current view (`drawImage` with a source rectangle). `canvas.captureStream(30)` feeds `MediaRecorder` with `mimeType: "video/mp4"` and `videoBitsPerSecond`.
- **Capabilities:** WebKit has shipped `MediaRecorder` with MP4 and H.264, `canvas.captureStream` and `requestVideoFrameCallback` for several releases (from WebKit release notes, not verified in this web view). Phase C must feature-detect each, and `MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")`.
- **Speed:** real time at best. 10 s takes about 10 s and 2 minutes about 2 minutes. It needs the window visible and the page not throttled (guess).
- **Weaknesses:** the frame timing follows playback, not the source frames, so drops are possible on a busy Mac. Bit rate control is a hint.
- **Cost:** no new dependency, a small lazy chunk (guess under 2 kB gzip).
- **Progress:** `video.currentTime / duration`. Cancel: stop and discard the blob.
- **Writing:** the page cannot write to `~/Movies/Rokk` (no `fs` plugin permissions in the capabilities), so it needs a new Rust command. That command streams the bytes into a checked `Rokk-...-zoom.mp4` name.

### R2: WebCodecs (`VideoDecoder`, `VideoEncoder`) plus an MP4 demuxer and muxer

- **How:** demux the original, decode each frame with hardware, draw with the view on an `OffscreenCanvas`, encode with hardware, then mux.
- **Availability:** WebKit lists WebCodecs video as shipped (guess for this WKWebView; feature-detect).
- **No demuxer without a library:** splitting the MP4 boxes (`moov`, `stsz`, `stco`, `avcC`) by hand is possible, but it is real work and risky for a variable-frame-rate file.
- **Library candidates** (names known, versions, sizes and licenses not checked here; every one is a new dependency the owner must approve):
  - `mp4box.js` for demuxing (BSD-3-Clause).
  - `mp4-muxer` (MIT), whose author now points to `mediabunny`.
  - `mediabunny` (MPL-2.0), which demuxes and muxes.
- **Size (guess):** tens of kB gzip. They count toward the total client JS budget, which has about 6 kB of room, so R2 needs a budget raise.
- **Speed (guess):** faster than real time with hardware codecs, perhaps 2 to 5 times. 10 s in a few seconds, 2 minutes in under a minute.
- **Progress:** frames done over frames total. Cancel: `close()` the codecs.

### R3: Apple frameworks from Rust (recommended)

- **How:** an `AVAsset` of the original, an `AVMutableVideoComposition` built with `applyingCIFiltersWithHandler`, and `AVAssetExportSession`.
  - The handler draws each frame through a `CIAffineTransform` and a crop, computed from the keyframes at that frame's time.
  - The export writes H.264 or HEVC to an MP4 with hardware encoding.
- **Variable frame rate:** handled by the composition (guess).
- **Bit rate:** export presets pick their own bit rate. For a set bit rate, use `AVAssetReader` plus `AVAssetWriter` (`AVVideoAverageBitRateKey`) instead of the export session. That is the same frameworks with more code.
- **Crates:**
  - Hand-written: `objc2` `msg_send!` plus `block2` (both direct dependencies already) plus `#[link(name = "AVFoundation", kind = "framework")]`, with `objc2-core-image` (in the lock) for `CIFilter`. No new crate, but a lot of `unsafe` code to review.
  - Typed: `objc2-av-foundation`, `objc2-core-media` and probably `objc2-core-video` would be NEW crates (same family, MIT/Apache-2.0, 0.3.x to match the lock). They need the owner's approval.
- **Speed (guess):** hardware decode and encode, several times real time on an M1. 10 s in about 2 to 4 s, 2 minutes in about 20 to 40 s.
- **Cost:** no JS budget cost: only the progress UI is in the page.
- **Progress:** `AVAssetExportSession.progress`, polled every 250 ms and sent as an event. Cancel: `cancelExport`.
- **Failures:** the export reports an error (plain message, partial output deleted); there is not enough disk (reuse the 500 MB start check); the original is missing.
- **Path safety:** the same as `record_delete`. The input must pass `check_delete` (our `.mp4` in `~/Movies/Rokk`, no symlink). The output is a derived `-zoom.mp4` name that must pass `check_output`, written as a partial name and renamed.

### R4: the ffmpeg binary (rejected)

- **License:** the installed `ffmpeg` is Homebrew's GPL build with libx264, which cannot be bundled with Rokk (Apache-2.0).
- **Size:** an LGPL build with only VideoToolbox is still tens of MB, too big for the app.
- **Not reliable:** depending on a user's own ffmpeg would make the feature unreliable.
- `/usr/bin/avconvert` exists, but it only re-exports with presets; it cannot apply a zoom.

### Recommendation

- **R3**, written by hand with `objc2` plus `block2` (no new crate), behind a new command `record_zoom_export(path, keyframes)` with progress events and `record_zoom_cancel`.
- **If the hand-written code proves too large to review,** ask the owner to approve `objc2-av-foundation` and `objc2-core-media`.
- **Fallback:** R1 for a short recording, if R3 fails on some Mac. It is real time, so offer it only below 2 minutes.

## 4. Quality

- **Capture:** the recorder already captures at Retina size (2554 x 1616 for this window). At 2x zoom the visible source is about 1277 x 808 pixels, which is the window at one pixel per point. That is readable but not Retina sharp (guess).
- **The bigger limit is the source bit rate:** 1.4 to 4.4 Mbit/s for 2.5K text. Blocking that is invisible at 1x shows up at 2x (guess). Raising it means replacing `SCRecordingOutput` with sample buffers into `AVAssetWriter`, a later and separate change.
- **Export:**
  - Keep the source size (2554 x 1616), H.264 High or HEVC, about 12 Mbit/s (rule of thumb: about 0.1 bit per pixel per frame at 30 fps).
  - Expected size: about 90 MB a minute (15 MB for 10 s, 180 MB for 2 minutes).
  - A "Smaller file" option at 1920 width and 8 Mbit/s gives about 60 MB a minute.
  - HEVC at the same quality is roughly half the size (guess), but some web sites and older apps do not play it, so H.264 is the default.

## 5. UX (spec only)

- **Stage controls:** a toggle "Auto-zoom", default on, with the line "Saves your mouse path next to the video so it can be zoomed later." It decides only whether the sidecar is saved. Stored in `localStorage["rokk.stage.autozoom"]` and passed to `record_start`.
- **Result card:** an "Auto-zoom" action when a sidecar exists for the saved file. It opens a preview player (a lazy chunk):
  - The original in a hidden `<video>`, drawn into a `<canvas>` with `viewAt` applied live (`requestVideoFrameCallback` when present, else `requestAnimationFrame`).
  - Controls: Play and Pause, a scrubber, an on and off switch, Level (1.5x, 2x), Dwell (0.6, 1.0, 1.5 s) and Reset (defaults). Changing a setting recomputes the keyframes (cheap, pure).
  - "Save with zoom" writes `Rokk-...-zoom.mp4` next to the original, with a progress bar, Cancel and a result line; it never overwrites (same suffix rule as finalize).
- **Accessibility:**
  - Every control is a real button or input, with focus rings, Space for play, and arrow keys on the scrubber.
  - With `prefers-reduced-motion`, the live canvas shows the zoom as a cut, not a smooth move. The exported video keeps the chosen easing, because it is content, not interface.
  - Progress goes through a live region with steps of 10 percent.
  - Captions are not needed: there is no audio.

## 6. Phased plan

| Phase | New files | Upstream files | Rust | New crates | Size cost | Risks | Testing |
|---|---|---|---|---|---|---|---|
| A: sidecar and clock | `rokk_record/cursor.rs`; frontend lines in `rokk-stage/record` | none (`lib.rs` only if a new command) | yes: sampling thread, sidecar write at finalize, delete with the video; `record_start` gains `cursor: bool` and the frame rectangle | none (`extern "C"` CoreGraphics) | under 0.5 kB in the stage chunks | thread or main-thread need of the CG calls; page zoom; clock offset | pure Rust tests: mapping, gaps, JSON shape, the name rule for `.zoom.json`; manual: click a known spot and compare with the video |
| B: algorithm and preview player (built, section 8) | `src/modules/rokk-stage/zoom/` (lazy) | `lib.rs` (one line) | `zoom_read` (read only) | none | about 3 to 4 kB gzip in a new lazy chunk; counts toward the about 6 kB room | budget; WebKit `requestVideoFrameCallback` | the section 2 test list; render states |
| C: export | `rokk_record/zoom_export.rs` (or `rokk_zoom`); progress UI in the player | `lib.rs` (2 command lines) | yes: `record_zoom_export`, `record_zoom_cancel`, progress events | none by hand, or `objc2-av-foundation` and `objc2-core-media` with approval | under 1 kB in the page | the size of `unsafe` FFI; export time on 8 GB Macs; disk | 10 s and 2 min recordings: time, size, playback in QuickTime and a browser; cancel midway leaves no file |
| D: tuning | settings in the player; "Sensitivity" (low, normal, high mapped to radius and dwell) | none | no | none | under 0.5 kB | over-zooming | owner review of real recordings |

Phase B plus C will probably need part of the remaining total budget. A further raise needs the written reason and the owner's approval (Size budget policy).

## 7. Risks and open questions

- **Privacy:** the sidecar reveals pointer activity inside Rokk only. It must be deleted with the video, and the off switch must stop all sampling. Review the JSON once in a real run.
- **Cursor over iframes:** solved by global polling. Pointer events cannot do it.
- **High DPI and mixed displays:** the scale factor comes from the window at each tick. Moving between a 1x and a 2x display mid-recording is written to `window_changes`, and zooms there are skipped.
- **Window moves or resizes mid-recording:** recorded in `window_changes`. Resizes scale the captured content (guess), so the algorithm skips those spans.
- **Page zoom:** CSS pixels versus points under WKWebView page zoom is not verified. Phase A refuses the sidecar unless the zoom is 1, until verified.
- **System stop:** the track is in memory and is written at finalize with `ended: "system"`. A discarded or failed recording deletes it. A crash leaves no sidecar, which is acceptable.
- **Clock offset:** the gap between `recording_did_start` and the first frame is unmeasured.
- **Variable frame rate:** keyframes are in milliseconds, not frames, so they do not depend on the frame rate.
- **Rendering time on slower Macs:** R3 uses hardware codecs, which every Mac that runs the recorder (macOS 15 and later) has. Progress and Cancel are required, and disk space is checked first.
- **Source bit rate:** the low ScreenCaptureKit bit rate limits sharpness at 2x. Fixing it is a recorder change and is out of this plan.

## 8. Phase B as built (with the 2026-11-04 polish)

### Why the first version shook and lingered

- **Shake:**
  - The camera read `video.currentTime` on every animation frame. That clock only moves with decoded frames, and these recordings have a variable frame rate, so the camera repeated values and then stepped.
  - A hard clamp at the edge of the allowed center range added corners to the motion.
- **Lingering:** a resting cursor held the zoom for up to 6 seconds (`maxHoldMs`). Scrolling does not move the cursor, so scrolling the page did not end it. A 1.2 s merge window and a 1 s minimum hold for clicks added to it.
- **The center still shook (second fix):**
  - The debug numbers showed a smooth clock (`uniqueTimeFraction` 1) but a center velocity jump (8.6 px) larger than the largest step (6.7 px), which means two frames moving in opposite directions.
  - Cause: the view center was placed at a fixed fraction of the allowed range `[lo(s), hi(s)]` (the old `place()`). With a stage frame, `range()` switches `max`/`min` branches as the scale changes, so `lo(s)` first shrinks with the view, then grows, then shrinks again. Near a frame edge the center reversed direction twice in each zoom-in and zoom-out, abruptly. Without a frame the range is smooth, which is why the tests missed it.
  - Not the cause: the anchor was already fixed per rest, the follower was already closed form, and nothing is rounded inside `evaluate()`.
- **Scrolling cannot be detected:** the track holds only cursor positions and button states. Seeing scroll-wheel events would need an event tap, which needs a macOS permission (Input Monitoring or Accessibility). It is not planned, so the hold cap does the job instead.

### The algorithm (`src/modules/rokk-stage/zoom/algo.ts`)

`planZoom(track, settings)` returns a plan: a plain array of segments, plus the bounds, video size, level, ease times and time constants. `evaluate(plan, t_ms)` returns `{ scale, cx, cy }`, the view center in video pixels.

- Both are pure and deterministic.
- The camera is a closed-form function of `t`, continuous in value and in velocity everywhere.

**Settings and defaults**

| Setting | Default | Notes |
|---|---|---|
| `level` | 1.8 | clamped to 1.2 to 3 |
| `dwellMs` | 1000 | clamped to 400 to 2500 |
| `mode` | `"clicks"` | `"clicks"` or `"clicks-pauses"`: what may start a zoom (section 11) |
| `holdMs` | 1500 | clamped to 300 to 6000; counted from the end of the zoom-in |
| `dwellRadiusPt` | 30 | points; times the video scale (60 px on Retina) |
| `exitRadiusPt` | 36 | points; times the video scale (72 px on Retina) |
| `exitDelayMs` | 120 | how long the cursor must stay outside the exit radius |
| `clickLeadMs` | 250 | a click anchors this long after it |
| `minGapMs` | 1200 | a new anchor this soon after the exit pans instead |
| `edgeMargin` | 0 | shrinks the bounds on every side |
| `arrivalMinPt` | 80 | points; a pause counts only after the cursor travelled this far (section 11) |
| `arrivalWindowMs` | 1500 | the time before the rest in which that travel is measured |
| `idleCapMs` | 4000 | a pause with no click leaves by this long after its arrival |

**The one motion (`MOTION`, since 2026-11-05)**

| Ease in | Ease out | Curve | Pan follower |
|---|---|---|---|
| 600 ms | 700 ms | smootherstep (C2) | third order, time constant 170 ms |

The Smooth and Snappy feels and the Feel switch are gone; an old `rokk.zoom.feel` value in `localStorage` is left alone and no longer read.

**Rules**

1. **Bounds:** the sidecar's `frame` when not null, cut to the video. Otherwise the whole video.
2. **Rest:** a run of de-jittered samples, each within the dwell radius of the run's first sample, inside the bounds, with no gap over 250 ms. Only in "Clicks and pauses" mode, and only after an arrival (section 11).
   - **De-jitter (`dejitter`):** per run without a gap, a centered 5-sample median (it drops single outliers), then an exponential smoothing with a 100 ms time constant. 20 px jitter at 30 Hz comes out at about 3 px. It is used for rests and anchors only; the raw samples decide gaps, leaving the bounds, the exit and clicks, so the exit stays fast.
   - A run of `dwellMs` makes an anchor at the median of its samples. The anchor is fixed once, when the rest is confirmed, and stays constant for the whole zoom.
   - **Dead zone:** while the cursor stays inside the exit radius nothing moves the anchor; the camera never follows the live cursor during a hold.
   - Its zoom starts at the run's start plus `dwellMs`.
3. **Click:** a click inside the bounds makes an anchor at the click, starting `clickLeadMs` later. Clicks outside the bounds are ignored.
4. **Fast exit:** an anchor starts to leave when the cursor has been outside the exit radius (or outside the bounds, or gone from the window: a gap in the samples) for `exitDelayMs`, counted from the first sample outside. A brief excursion that comes back sooner does not count.
5. **Hold cap:** the zoom leaves at the latest `holdMs` after its zoom-in finishes.
   - A click inside the exit radius restarts the hold from the click.
   - A click elsewhere ends this anchor at once, and that click becomes the next anchor.
6. **One rest, one zoom:** after a hold cap, a new rest only counts once the cursor has left the exit radius. A still cursor (for example while scrolling) never zooms again.
7. **The zoom-in always finishes:** if the exit comes during the zoom-in, the ease-out starts when the zoom-in ends.
8. **Window changes:**
   - Each event is a span of 500 ms on either side of its time; overlapping spans are joined.
   - An anchor whose zoom-in would overlap a span is dropped.
   - A zoom holding when a span begins starts to leave there.
9. **Merge and pan:** an anchor that arrives (when its rest began, or its click anchor time) less than `minGapMs` after the current zoom started to leave joins the segment instead of zooming out. It also joins when it would start before the ease-out ends. The view then pans to it at its arrival time with the same follower, and the scale stays. Merges never cross a window change span. Nothing else keeps a zoom alive.
10. **End of video:** the ease-out ends by the end of the video at the latest. A segment with no room for a full zoom-in is dropped.

**The math**

- **Zoom amount** `z(t)` from 0 to 1, with `scale = 1 + (level - 1) z`:
  - `z = f((t - start) / easeIn, kIn)` during the zoom-in;
  - `z = 1` during the hold;
  - `z = 1 - f((t - outStart) / easeOut, kOut)` during the ease-out;
  - `z = 0` outside segments.
- **The curve:** smootherstep `S(u) = 6u^5 - 15u^4 + 10u^3`.
  - `S(0) = 0` and `S(1) = 1`. `S'(u) = 30u^2 (1 - u)^2` and `S''(u) = 60u (1 - u)(1 - 2u)` are both 0 at `u = 0` and `u = 1`.
  - So the zoom starts and stops with zero speed AND zero acceleration: it is C2, with no jolt at any boundary. `S' >= 0`, so it never overshoots.
  - The old curve (an exponential approach blended into smootherstep, 450 and 500 ms) was C1 only. Its acceleration jumped at the start of each ease.
  - **Measured against the old curve, for the same plan:**

    | Measure | Lower by |
    |---|---|
    | Peak scale velocity, zoom-in | 34% |
    | Peak scale velocity, zoom-out | 39% |
    | Peak center velocity, zoom-in | 45% |
    | Peak pan velocity | 39% |
    | Peak acceleration, zoom-in | 81% |

    At 120 Hz the largest third difference of the scale is 1.1e-4, against 2.2e-3 at the old curve's start.
- **The exit is still prompt:** the ease-out starts at the exit time (120 ms after the cursor leaves the exit radius). The longer 700 ms only spreads the way out; the scale is half way back 350 ms in.
- **Center:**
  - **The follower:** a third-order critically damped follower per axis (a triple pole), `e(t) = (A + B t + C t^2) e^(-w t)` with `w = 1 / 170 ms`, `A = e0`, `B = v0 + w e0` and `C = (a0 + 2 w v0 + w^2 e0) / 2`. It is evaluated in closed form from the last key.
  - **Pans:** each pan starts a new key with the follower's current position, velocity and acceleration, so all three carry over (C2).
  - **Pan timing:** a pan from rest starts with zero acceleration. It settles to 95 percent in about 1.07 s (6.3 time constants), and the debug phase calls it `panning` for 10 time constants.
  - Targets are anchors clamped to the range allowed at full level: the view (video size / level) inside the bounds, or covering them and inside the video when it is larger. Bounds clamp the anchors (constants), never the moving center.
  - A pan that starts while the follower still moves could overshoot its target. `safeTarget` finds the extremes in closed form (the positive roots of `-w C t^2 + (2 C - w B) t + (B - w A) = 0`) and pulls the target in until they stay inside the range.
  - Between two anchors the center therefore moves monotonically in each axis, and it reverses only when the anchor changes.
- **Center and scale on one curve:**
  - `cx = W/2 + z (p - W/2)` (and the same for `cy`), with `z` the zoom amount and `p` the follower's position. So the center starts and stops exactly with the scale, on the same C2 curve.
  - The view stays inside the video for every `z`, because `|cx - W/2| <= z (W/2)(1 - 1/level) <= (W/2)(1 - 1/scale)`. At full level it is inside the frame.
  - It has no branches, so the center moves one way in and one way out.
  - Unlike the earlier zoom about a fixed point, the anchor drifts a little on screen during the zoom-in, in exchange for the center and the scale moving together.
- **Continuity in the tests:**
  - **Sampling:** the tests run at 1 ms and at 120 Hz, at levels 1.8 and 3, through pans, exits, holds and a click.
  - **Velocity:** the velocity change per step stays under a tenth of a step (1 ms).
  - **Acceleration:** the third difference at 120 Hz stays under 1.5e-4 per level step for the scale and under 0.4 px for the center, so the acceleration has no jumps.
  - **Ease boundaries:** speed and acceleration are zero within 1e-6 (scale) and 1e-3 px (center) at every ease boundary.

The tests are in `zoom/algo.test.ts` (71 cases), including the C2 checks, the peak velocity comparison with the old curve (kept inside the test as a reference), holds of 0.3, 0.5 and 6 s (with a new rest arriving during the exit, which pans with no dip), including a still hold under 20 px jitter (path under 1 px), under 2 px of spread over any hold, no reversal inside a segment, monotonic pans, no oscillation at frame edges and the de-jitter itself.

### The player

- **Opening it:** the result card shows "Preview zoom" when the terminal event has a `sidecar` path. It opens `zoom/ZoomPlayer.tsx` by a dynamic import, in the app's dialog.
- **The data:** the sidecar comes from `zoom_read` (Rust, read only, see RECORD.md). The MP4 plays through `convertFileSrc` on the asset protocol, which answers Range requests, so seeking works.
- **The clock (`createMediaClock`):**
  - While playing, the camera time is the newest known media time plus the time since it was seen, times the playback rate. It is at most 80 ms past that media time, and it never goes backwards.
  - Media times come from each decoded frame (`requestVideoFrameCallback`'s `mediaTime`, with `performance.now()` at that moment) and from every change of `currentTime`, whichever is newer. `currentTime` is the only source where frame callbacks are missing.
  - A seek, a rate change, a pause or the end snaps to `currentTime`. While paused the camera uses `currentTime` exactly.
- **The transform:**
  - The camera writes one `translate3d(x, y, 0) scale(s)` per animation frame, with `transform-origin: 0 0`, in pixels of the video's box. Values are rounded to 1/100 px.
  - It writes only when the transform moved by more than 0.005 px or 0.0002 scale.
  - The box size comes from a ResizeObserver, so the loop reads no layout.
  - `will-change: transform` is set only while playing with Zoom on.
- **Controls:**
  - Play and Pause, also Space while the dialog has focus (not on a button).
  - A scrubber with ticks where zoom moments begin: arrow keys seek 1 second, 5 with Shift, plus Home and End.
  - The time and duration.
  - A Zoom switch, on by default, or off with a note when the system asks for reduced motion.
  - Level (1.2x to 3x), Dwell (0.4 s to 2.5 s) and Hold (0.3 s to 6 s) sliders and Reset (all defaults), on one row with the Zoom switch.
  - **Hints:**
    - A 12 px hint line: "Level is how far it zooms. Dwell is how long the mouse rests before it zooms. Hold is how long it stays zoomed."
    - Each slider has a `title` and an `aria-describedby` sentence, for example "Dwell: how long the mouse must rest on a spot before the zoom starts."
- **Layout (2026-11-05):**
  - The dialog is a flex column at most `100vh - 32px` tall, with 18 px padding at the top and bottom and 10 px gaps.
  - The video is at most 660 px wide (about 418 px tall for a 16:10 recording), and its width follows `100vh - 360px` times the aspect, with a 160 px height floor. It keeps its aspect and never shrinks in height alone.
  - The controls column (8 px gaps) scrolls inside as a safety net on short windows; the video does not scroll.

    | Window height | Dialog before | Dialog after |
    |---|---|---|
    | 800 px | about 834 px (spilled) | about 681 px |
    | 900 px | about 871 px | about 681 px |
    | 1080 px | about 871 px | about 681 px |
    | 640 px | | about 543 px (fits; the scroll is only a safety net) |
  - A setting change recomputes the plan after 120 ms without restarting playback, and the new count is announced politely ("3 zoom moments").
- **States:**
  - "Loading the recording...".
  - The error "Rokk could not open this recording." with the plain reason and a Close button.
  - "No zoom moments found. Try a shorter dwell time." for an empty plan (the sliders still work).
- **Closing:** Esc or the close button closes it. The video pauses and lets go of its file, and focus returns to "Preview zoom".

### The debug hook (development builds only)

`window.rokkZoomDebug()` exists only under `pnpm tauri dev` (`import.meta.env.DEV`; it is removed from production builds). It returns numbers for the last 300 rendered frames, in pixels of the video's box on screen. The center is the view center.

- **Velocity jump:** the size of the change of the step vector between two frames (`|b - 2a + z|`), not the change of the step length. A jump larger than both steps means the direction turned by more than 60 degrees.
- **Direction reversal:** two consecutive steps over 0.02 px that point more than 90 degrees apart.
- **Phases:** each frame takes its phase from the plan at its time (`phaseAt`): `entering`, `holding`, `panning` (within 10 center time constants of a pan's start, 1.7 s), `exiting` or `idle`. Each phase reports `{frames, maxCenterStep, maxCenterVelocityJump, directionReversals}`.

| Field | Meaning | Healthy |
|---|---|---|
| `frames` | frames counted | up to 300 |
| `maxScaleStep` | the largest scale change between two frames | under about 0.03 at 60 Hz |
| `maxCenterStep` | the largest center move between two frames | under 2 px while the zoom holds still; a pan moves more on purpose |
| `maxCenterVelocityJump` | the largest change of that move from one frame to the next | below the largest step; shake shows as values above it |
| `maxAcceleration` | the largest second difference of the center's step vectors (how much the per-frame acceleration changes), in px | small and even; a jolt shows as a spike far above the rest |
| `maxScaleAcceleration` | the same for the scale's steps | under about 0.001 at 60 Hz |
| `directionReversals` | reversals over all frames | 0 |
| `uniqueTimeFraction` | the share of frames with a new camera time | 1.0; lower means the clock repeated times (the old shake) |
| `holding` | the phase numbers while the zoom holds | `directionReversals` 0, `maxCenterStep` under 0.5 px |
| `entering`, `exiting` | while zooming in and out | `directionReversals` 0; the jump below the step. The center travels from the video center to the anchor, so for an anchor far from the center the jump can pass 1.5 px at the start of the ease (the zoom's own acceleration, not shake) |
| `panning` | while panning to a new anchor | `directionReversals` 0; the largest jump comes at the pan's start |
| `idle` | no zoom | all 0 |

Paste the object back as it is. Open the player, play for a few seconds, then run `rokkZoomDebug()` in the web inspector console.

## 9. Manual test checklist (Phase B)

- [ ] Record 15 seconds. Rest the mouse on a corner of the page for 2 seconds, click a button, then move on.
- [ ] Open "Preview zoom". The view zooms in near 1 second into the rest, holds while the mouse stays, and eases out when it moves on. The click zooms in on the button.
- [ ] The zoom leaves within about half a second after the cursor leaves.
- [ ] Rest the mouse and scroll the page with the wheel: the zoom holds 1.5 s after zooming in, then leaves, and does not come back while the mouse stays still.
- [ ] Play with the debug hook and paste the `rokkZoomDebug()` numbers. With the mouse resting: `holding.directionReversals` 0 and `holding.maxCenterStep` under 0.5 px; overall `directionReversals` 0; `maxCenterVelocityJump` under 1.5 px per frame outside `panning` for anchors near the middle (and below `maxCenterStep` in every phase); `uniqueTimeFraction` near 1.
- [ ] Rest the mouse next to an edge of the stage frame: the zoom goes in and out without a wobble.
- [ ] The zoom starts and stops gently, with no jolt at either end, and the center and the scale move together.
- [ ] At a 900 px tall window the whole dialog fits, including the quality choice, the soft-text note and "Save with zoom". At 640 px the controls scroll inside and the video stays put.
- [ ] Hover each slider: it explains itself; the hint line is under the row.
- [ ] Drag the scrubber, and use the arrow keys with and without Shift: the zoom follows the new time, and seeking works.
- [ ] Move the Level, Dwell and Hold sliders: the zoom changes without restarting playback. Reset restores 1.8x, 1.0 s and 1.5 s. Hold goes down to 0.3 s.
- [ ] Turn Zoom off: the original plays unzoomed. Turn it on again.
- [ ] Turn on Reduce motion in System Settings, then open the player: Zoom is off, the note shows, and Zoom can be turned on.
- [ ] A recording without a mouse path file (for example one made before Phase A) shows no "Preview zoom" button.
- [ ] Close with Esc and with the close button: the video stops, focus is back on "Preview zoom", and the original MP4 and `.zoom.json` are unchanged (same size and modified time).

## 10. Phase C as built: "Save with zoom" (2026-11-04)

The player's Export section renders a NEW file, `Rokk-YYYY-MM-DD-HHMMSS-zoom.mp4`, next to the original, with the exact camera path the preview shows. The original MP4 and its `.zoom.json` are never modified or deleted by the export.

### One algorithm

- TypeScript computes the camera: `sampleCameraPath(plan, durationMs, hz = 120)` in `zoom/camera.ts` samples `evaluate()` from the current plan and settings.
- The format is a JSON array of `[t_ms, scale, cx, cy]`: `t = 0` first, then every 1000/120 ms, then a last sample at the video's duration. Values are rounded to 3 decimals, and centers are in the mouse path file's video pixels. There are at most 80,000 entries; longer videos are sampled less often.
- Rust (`src-tauri/src/modules/rokk_record/zoom_export.rs`) only renders it: it interpolates linearly between samples at each output frame time and holds the ends.

### Design R-C

- **Reading:** `AVMutableVideoComposition` with the Core Image handler (`videoCompositionWithAsset:applyingCIFiltersWithHandler:completionHandler:`, macOS 13 and later) feeds `AVAssetReaderVideoCompositionOutput` (BGRA, `alwaysCopiesSampleData` off), at a constant 30 fps (`frameDuration` 1/30) and the output size (`renderSize`).
- **Per frame:**
  1. Interpolate the camera at the frame's `compositionTime`.
  2. Crop the source to the view (W/scale by H/scale around the center, clamped inside the video, with y flipped because Core Image's origin is at the bottom left).
  3. Scale with `CILanczosScaleTransform` to the output size and finish the request with one reused `CIContext`.
- **Writing:** `AVAssetWriter` (MP4, `shouldOptimizeForNetworkUse`) with one `AVAssetWriterInput`: H.264, High profile auto level, `AVVideoAverageBitRateKey`, 30 fps expected, a key frame every 2 s. Frames are appended with `appendSampleBuffer`, so no pixel buffer adaptor and no Core Video crate are needed. VideoToolbox picks the hardware encoder.
- **Audio:** copied as stored, only when the recording has an audio track and both sides accept it (Rokk's recordings have none).

### Qualities and sizes

| Quality | Size | Average bit rate | About |
|---|---|---|---|
| Full size (best quality) | the source size (even numbers) | 12 Mbit/s | 90 MB per minute |
| Smaller file (1920 wide) | 1920 wide, aspect kept | 6 Mbit/s | 45 MB per minute |

The player says: "Zoomed text can look soft, because screen recordings are saved at a low quality. A smaller zoom level looks sharper." The source recordings are H.264 Main at about 2.7 Mbit/s, so a zoomed view upscales already compressed text.

### Checks before starting (stable codes)

- `old_macos`: the system is older than macOS 13; the section is hidden by `zoom_export_supported`.
- `recording`: a recording is starting, running or stopping.
- `busy`: only one export runs at a time.
- `not_ours`: the video must be a generated `Rokk-YYYY-MM-DD-HHMMSS.mp4` (counters allowed, not a zoomed copy). It must be a regular file in `~/Movies/Rokk` once symlinks and `..` are resolved (the `record_delete` rules).
- `too_large`: the video is over 4 GB.
- `no_sidecar`: its `.zoom.json` must exist in `~/Movies/Rokk/.zoom` and parse (the `zoom_read` rules).
- `bad_camera_path`: the path breaks a rule, with a plain reason. The rules:
  - at most 80,000 entries;
  - every number finite;
  - times strictly increasing from 0;
  - scale from 1 to 4;
  - centers inside the video;
  - the last time within 500 ms of the video's duration.
- `disk_full`: free space must be at least 1.5 times the estimated size plus 500 MB.
- After starting, it can still fail with `open_failed`, `render_failed` or `write_failed`.

### Files, progress, cancel and memory

- **The output file:** it is written to `<stem>-zoom-partial.mp4` and renamed to `<stem>-zoom.mp4` only after the writer finishes successfully. If that name is taken, it gets a counter (`-zoom-2`); nothing is ever overwritten. A partial file is deleted on cancel and on any error, and stale partial files from a crash are deleted at the next export.
- **Progress and events:** progress is the frame time over the duration. The `rokk-zoom-export` event (`{job, state, progress, output, size, code, message, seconds_elapsed}`, with state `running`, `done`, `error` or `cancelled`) comes at most 10 times a second.
- **Cancel:** `zoom_export_cancel(job)` can be called more than once and sets a flag that is checked on every frame. The export then calls `cancelReading` and `cancelWriting` and deletes the partial file, within about a frame.
  - Closing the window cancels too (checked every 15 frames).
  - Quitting the app cancels and waits up to 2 s for the clean-up.
- **Memory:** the work runs on its own thread, never the main thread.
  - Each frame gets its own autorelease pool, and each sample buffer is dropped right after it is appended. No frame is kept.
  - The writer is fed only when `isReadyForMoreMediaData` says so.
- **Logs:** one line per state change and a final `[rokk_export] frames=<n> seconds=<s> size=<bytes> result=<...>`. They never hold screen content.

### Deleting

- "Delete zoomed copy" uses `record_delete`.
- Its rule now accepts only original recordings (`Rokk-YYYY-MM-DD-HHMMSS.mp4` with up to two counters) and zoomed copies (`<original stem>-zoom.mp4` or `-zoom-N.mp4`), inside `~/Movies/Rokk`.
- Deleting an original removes its `.zoom.json` (in `~/Movies/Rokk/.zoom`), never its zoomed copy.

### Crates (macOS only, approved by the owner on 2026-11-04)

| Crate | Version | License (used under) | Features |
|---|---|---|---|
| `objc2-av-foundation` | 0.3.2 | Zlib OR Apache-2.0 OR MIT (MIT) | `std`, `AVAsset`, `AVAssetTrack`, `AVAssetReader`, `AVAssetReaderOutput`, `AVAssetWriter`, `AVAssetWriterInput`, `AVVideoComposition`, `AVVideoCompositing`, `AVMediaFormat`, `AVVideoSettings`, `block2`, `objc2-core-media`, `objc2-core-image`, `objc2-core-foundation` |
| `objc2-core-media` | 0.3.2 | Zlib OR Apache-2.0 OR MIT (MIT) | `std`, `CMBase`, `CMSampleBuffer`, `CMTime` |

- **Already in `Cargo.lock`**, now also named directly for their types: `objc2-core-image` 0.3.2 (`CIImage`, `CIContext`, `objc2-core-foundation`) and `objc2-core-foundation` 0.3.2 (`CFCGTypes`).
- **`objc2-foundation`** gained the `NSDictionary`, `NSError`, `NSObject` and `NSProcessInfo` features.
- **Defaults are off:** the default features would pull in `objc2-core-video`.
- **Versions:** both crates accept the tree's objc2 0.6.4 and block2 0.6.2, so there is one objc2 in the tree.
- **Notice:** in NOTICE and `docs/rokk/licenses/objc2-LICENSE-MIT.txt`.

### Manual test checklist (Phase C)

- [ ] Export a 10 s recording at Full size and compare it with the preview: the same zoom moments, at the same times and places.
- [ ] Play the zoomed file in QuickTime: it plays to the end, at 30 fps, with the right size.
- [ ] "Play it here" switches the player to the saved file, with Zoom off and the note "This is the saved video".
- [ ] Cancel at about 50 percent: "Cancelled. Nothing was saved.", and `ls ~/Movies/Rokk` shows no `-partial` file.
- [ ] Close the player while saving: it asks to confirm; "Cancel and close" leaves no `-partial` file.
- [ ] Export a 2 minute recording and note the time it takes and the memory in Activity Monitor (it should stay flat).
- [ ] Export at "Smaller file (1920 wide)" and check the size and the file size against "About N MB".
- [ ] Delete the zoomed copy: the original MP4 and `.zoom.json` are untouched (same size and modified time).
- [ ] Start a recording, then try to export from an older player: it refuses with "Stop the recording first, then save with zoom."
- [ ] With Reduce motion on, the progress bar does not animate.

## 11. Triggers: "Zoom on", arrivals and switching zooms off (2026-11-05)

The owner found zooms while scrolling (the cursor rests while the page moves) and while the mouse was simply parked. A resting cursor is ambiguous: Rokk records only the cursor track, so it cannot tell reading, scrolling and idling apart.

### Zoom on

- **"Clicks" (the default):** only clicks start zooms. Pauses are ignored entirely. Clicks still anchor `clickLeadMs` later, merge, pan, hold and exit exactly as before.
- **"Clicks and pauses":** clicks and arrived pauses start zooms. A note says: "Rokk cannot see scrolling, so a pause while you scroll can zoom. Turn it off with its tick."
- **Storage:** the choice is saved in `localStorage["rokk.zoom.mode"]`, and Reset returns to "Clicks". The Dwell slider is muted and disabled in "Clicks" mode, with the title "Dwell only applies to pauses".

### The arrival rule (pauses only)

- **The rule:** a pause anchors only if the de-jittered cursor travelled at least `arrivalMinPt` = 80 points (times the video's scale factor, so 160 px on Retina) within `arrivalWindowMs` = 1500 ms before the rest began. Only steps without a gap count.
- **What it rules out:** a cursor parked from the start, one that only jitters, and one that comes back within a short distance never make a pause zoom.
- **No repeats:** a rest that goes on after its zoom has left never zooms again, because nothing new arrived (and the cursor must still leave the exit radius first).
- **Idle cap:** a pause with no click is treated as idle `idleCapMs` = 4000 ms after its arrival, so its zoom leaves by then even if the hold is longer. A click inside the radius restarts the hold as before.
- **Clicks:** clicks are always valid anchors.

### Ids and skips

- **Ids:** each candidate anchor has the id `kind:t0`, with `t0` rounded to 50 ms. For a click `t0` is its time; for a pause it is the moment the rest began, which does not depend on the Dwell setting. A second anchor with the same id gets `~2`.
- **Skips:** `planZoom(track, settings, skipIds)` removes skipped anchors before merging, so the pans of the remaining ones are planned again.
  - A skip id matches an anchor of the same kind within 100 ms (`SKIP_TOLERANCE_MS`); an id that matches nothing is ignored.
  - The plan lists every candidate in `anchors` (`{id, kind, t0, x, y, enabled}`, in time order); the segments are built from the enabled ones.
- **In the player:**
  - **Ticks:** one tick per candidate anchor: a 14 by 14 px button over the scrubber with a 2 by 10 px bar, filled when on and hollow when off. Click, Enter or Space toggles it; it has `aria-pressed`, the label "Zoom at 0:09 (click), on" and a title.
  - **Status:** next to the time, "4 zooms, 1 off" and "Turn all on".
  - **Saved skips:** the skips are saved per recording (by MP4 file name) in `localStorage["rokk.zoom.off.v1"]`, for the 30 most recent recordings.
- **Export:** "Save with zoom" samples the same plan (mode, settings and skips), so the saved video matches the preview.

### Scrolling (not built)

- **Why it can't be seen now:** scrolling is not in the track and cannot be inferred from it.
- **A possible future:** a Rust local `NSEvent` monitor for scroll-wheel events in Rokk's own window would record scroll event times only (no positions, no content) next to the cursor track. Pauses during scrolling could then be dropped.
- **Unverified:** that a local monitor needs no permission (global monitors need Input Monitoring). See TODO.md.

### Layout with the new controls

- The control row (Zoom, "Zoom on", Level, Dwell, Hold, Reset) fits on one line when the dialog is 1000 px wide (windows from about 1032 px wide); slider tracks are 76 px.
- The scroll note adds one 12 px line, in "Clicks and pauses" mode only.

| Window height | Dialog, Clicks mode | Dialog, Clicks and pauses | Limit (`100vh - 32px`) |
|---|---|---|---|
| 800 px | about 681 px | about 706 px | 768 px |
| 900 px | about 681 px | about 706 px | 868 px |
| 1080 px | about 681 px | about 706 px | 1048 px |

On narrower windows the row wraps (about 42 px more); at 640 px tall with a wrapped row in "Clicks and pauses" mode the controls scroll inside by a few pixels.

### Manual checks (Phase B additions)

- [ ] Default "Clicks": a recording with a parked mouse and a scroll shows no zoom; clicks zoom as before.
- [ ] "Clicks and pauses": moving to a spot and resting zooms once; a parked mouse does not.
- [ ] Click a tick: that zoom turns off (hollow tick), the status shows "N zooms, 1 off", and the merged pans re-plan. Close and reopen the player: the tick is still off. "Turn all on" restores them.
- [ ] Save with zoom after turning a zoom off: the saved video has no zoom there.

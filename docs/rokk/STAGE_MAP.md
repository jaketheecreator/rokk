# Stage mode: research map

Read-only research, 2026-11-02. Nothing was built or changed. "Verified" means checked in this repo, on this Mac (macOS 26.6.2, build 25G83, arm64) or in official documentation. "Guess" means not verified and needs a test.

## 1. Recording on macOS

### (a) getDisplayMedia in the WKWebView

- **Not verified.** It was not tested here, because testing it means running code in the dev app.
- **Guess:** WKWebView support for `navigator.mediaDevices.getDisplayMedia` is limited, and the host app would have to handle the permission request through WebKit delegates that Tauri does not expose.
- **Weak route even if it works:** the page would need MediaRecorder (WebM or MP4 support varies in WebKit), it captures through a system picker, and recording would run inside the same web view that draws the terminal.
- **What exists today:**
  - `src-tauri/Info.plist` has only `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`.
  - `src-tauri/entitlements.plist` has camera and audio-input entitlements, and no App Sandbox.
- **Recommendation:** treat this route as a dead end for v1.

### (b) The system `screencapture` command

- **Verified with `man screencapture`:**
  - `-v` records video until stopped; `-V <seconds>` records for a fixed time.
  - `-R x,y,w,h` captures a rectangle; `-l <windowid>` captures one window; `-D <display>` picks a display.
  - `-x` turns off sounds, `-C` captures the cursor, `-k` shows clicks.
  - `-g` records audio from the default input, and `-G <id>` from a chosen source.
  - `-P` opens the result in QuickTime Player.
- **Not documented, guesses:**
  - Whether `-v` combines with `-R` or `-l` (region or window video).
  - How to stop: the man page says nothing. The common report is that SIGINT (what Ctrl+C sends) ends the recording and writes the file, but this was not tested here.
  - Output is assumed to be MOV.
- **Spawning from Rust:** `std::process::Command::new("/usr/sbin/screencapture")` with `-v -x -l <id> <path>.mov`. Keep the `Child`, send SIGINT with `libc::kill(pid, SIGINT)` (`libc` is already a dependency on Unix in `src-tauri/Cargo.toml`), then wait for it to exit.
- **Fit:** good as a fallback, because it needs no new crate.

### (c) A Rust crate

- `screencapturekit` 11.1.1 (crates.io, updated 2026-10-26, about 3.1M downloads) provides safe ScreenCaptureKit bindings. Per docs.rs:
  - The baseline needs macOS 12.3 or later, and builds need the macOS 13 SDK.
  - Single-window capture uses `SCContentFilter::create().with_window(...)`; region crop uses `SCStreamConfiguration::with_source_rect`.
  - Direct-to-file recording is `SCRecordingOutput`, behind the `macos_15_0` feature.
  - The system picker is `SCContentSharingPicker`, behind `macos_14_0`.
  - It does **not** need ffmpeg; its dependencies are `apple-cf` and `apple-metal`.
- `scap` 0.1.0-beta.1 (updated 2025-08-04) is cross-platform but still beta and hands back frames, so it needs its own encoder. Not recommended.
- **Constraint:** `tauri.conf.json` sets `"minimumSystemVersion": "13.0"`, so `SCRecordingOutput` (macOS 15) needs a runtime version check, with a fallback for macOS 13 and 14.
- **Cost:** a new Rust dependency, which needs the owner's approval. It does not touch the JS budget.

### (d) Permission (Screen Recording)

- **Which app macOS asks for (guess, based on how macOS normally decides):**
  - **Development:** the Rust binary is started by `pnpm tauri dev` from a terminal, so macOS asks for, and lists, the terminal app the owner runs it in, not "Rokk". Unsigned dev builds may also lose the permission after a rebuild.
  - **Packaged:** macOS asks for the signed Rokk.app (identifier `app.crynta.terax`).
- **Detecting it:** CoreGraphics `CGPreflightScreenCaptureAccess()` checks without asking, and `CGRequestScreenCaptureAccess()` asks (both macOS 10.15+; Apple docs). ScreenCaptureKit also fails with an error when permission is missing.
- **Settings link:** `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` is widely used but not officially documented. Open it with the opener plugin, which is already in `lib.rs`.
- **Restart:** after the person grants permission, macOS usually asks them to quit and reopen the app (guess, based on common behavior). The UI should say "Quit and reopen Rokk after allowing it".
- **Recent macOS** (guess): it re-asks about screen recording from time to time.
- **Info.plist:** no usage-description key is known to be required for Screen Recording (guess). Adding one would be harmless.

### (e) Output

- **Proposed** (guess, following macOS conventions): save to `~/Movies/Rokk/`, named `Rokk 2026-11-02 at 14.05.12.mov`.
- **Format:**
  - `SCRecordingOutput` can choose the file type (`SCRecordingOutputFileType`), so MP4 is possible with no conversion on macOS 15 and later.
  - **On this Mac:** `/usr/bin/avconvert` (part of macOS) has presets such as `Preset1920x1080`, `PresetHEVC1920x1080` and `PresetHighestQuality`. Converting MOV to MP4 by output extension is a guess.
  - `/opt/homebrew/bin/ffmpeg` is the owner's own install; never rely on it.

### (f) The exact rectangle

- **Tauri window API (verified permission names in `src-tauri/gen/schemas/desktop-schema.json`):** `innerPosition`, `innerSize` (physical pixels), `scaleFactor` and `currentMonitor` are all readable under `core:window:default`.
- **Coordinates:** a stage rectangle = the inner position plus the stage element's `getBoundingClientRect()`, times the zoom (`.zoom-content` in `App.tsx`), divided by the scale factor for points.
- **Guess:** `screencapture -R` uses points with the origin at the top left of the main display; multi-monitor coordinates need a test.
- **Avoiding the rectangle:** capturing the Rokk **window** (by window id) skips all of this, and automatically leaves out notifications and other windows.

### Recommendation

- **Primary:** a Rust module `rokk_stage` using `screencapturekit` to record **only the Rokk window**, writing MP4 through `SCRecordingOutput` on macOS 15 and later.
- **Fallback** (macOS 13 and 14, or if the crate is not approved): spawn `screencapture -v -x -l <windowid>`, stop it with SIGINT, keep the MOV, and offer MP4 through `avconvert`.
- **Window id:** both routes need it. Get it from the NSWindow `windowNumber` (`objc2` is already used in `main.rs` and `vibrancy.rs`).
- **Must be tested first:** whether `-v` works with `-l`, and whether SIGINT finalizes the file.

## 2. The stage view

### What exists

- `src/app/App.tsx` already has a zen mode:
  - state at line 886, toggled by `view.zenMode` at line 965 (`Mod+Shift+'`);
  - it hides `<Header>` at line 1429 and `<StatusBar>` at line 1582;
  - it does **not** hide the sidebar panel (`id="sidebar"`, line 1467) or the rail (`RokkRailSlot`, line 1578).
- The terminal follows its container: `WebGpuTerminalSurface.ts` uses a `ResizeObserver` (line 273), and `WebGpuWindowCanvas.ts` keeps one canvas that follows the terminal area. Hiding panels therefore resizes the terminal by itself; this follows from the code and was not run.
- **Native traffic lights:** `tauri.conf.json` uses `titleBarStyle: "Overlay"` with `hiddenTitle`. The buttons stay visible in a normal window and would appear in a window recording. Hiding them needs Rust (NSWindow `standardWindowButton(...).setHidden(true)` via `objc2`, guess) or fullscreen, which defeats the window shapes.

### Smallest approach

- **New module:** `src/modules/rokk-stage/`, with a store (`stage on`, `shape`, `content: terminal | preview`) and `StageSlot.tsx`.
- **Hiding by CSS:** the module sets `data-rk-stage` on `<html>`, and a CSS file hides the header, the tab bar, the status bar, `#sidebar` and `#rokk-rail`. It also puts the wallpaper on the window root (`.bg-frame` in `App.tsx` line 1428) and frames the main panel.
- **Guess:** hidden flex siblings let the main panel fill the row, because react-resizable-panels uses flex-grow. Collapsing the sidebar through its `panelRef` is the fallback.
- **Mount like the buddy:** a `<RokkStageSlot />` line after the Toaster, plus a handler line and one `shortcuts.ts` entry, as the rail and buddy did. That is three upstream lines in `App.tsx` and `shortcuts.ts`.
- **Selectors:** the header, tab bar and status bar need stable selectors. Check for ids or classes in `Header.tsx`, `TabBar.tsx` and `StatusBar.tsx`; if none exist, adding an `id` touches one upstream line per file.
- **Shortcut:** `Mod+Alt+S` is free (the Mod+Alt keys in use are `b`, `d` and the arrows). Matching falls back to `e.code`, so Option on macOS is fine.
- **Leaving Stage:**
  - A visible "Exit stage" control (top right, shown on hover or focus, and always in the tab order) plus the shortcut.
  - **No bare Esc:** it belongs to the terminal (vim, Claude Code).
  - Stage also turns off on window blur only if recording is not running.

## 3. Window resizing

- **Capability gap:** `src-tauri/capabilities/default.json` does not grant `core:window:allow-set-size` or `allow-set-position`. Either add them (an upstream config file) or resize in a Rust command (`window.set_size(LogicalSize)`, `set_position`); the Rust command needs no capability change.
- **Remember and restore:** read `outerPosition` and `innerSize` before entering Stage, keep them in the stage store and in localStorage, and restore them on exit and at the next start if the app quit while in Stage.
- **Window-state plugin** (`lib.rs`, `StateFlags::all() & !VISIBLE`): it saves the size at quit, so quitting in Stage would save the stage size. Restoring at start covers this.
- **Minimums:** `tauri.conf.json` sets `minWidth: 420`, `minHeight: 280`.
- **Suggested sizes** in logical points (guesses that leave room for the menu bar and Dock):

| Display | Landscape 16:9 | Portrait 9:16 |
|---|---|---|
| 1440x900 | 1280x720 | 450x800 |
| 1920x1080 | 1440x810 (1600x900 if the Dock is hidden) | 540x960 |

Clamp every preset to 90 percent of `currentMonitor().workArea`, as `clamp_settings_size` does for Settings in `lib.rs`.

## 4. Preview

- `src/modules/preview/PreviewPane.tsx` renders a sandboxed cross-origin `<iframe>` (line 155).
- **Captured:** macOS screen capture records the window's final pixels, so the iframe is captured like everything else. This follows from how the screen is drawn and was not run. Exceptions: protected video (DRM) shows black, and a window with content protection (`set_content_protected`) is blank. Rokk does not set content protection today.
- **Centering:** in Stage the preview tab's pane fills the main panel, and a Rokk wrapper adds padding, centers it and limits its size.
- **Phone frame:** pure CSS (a rounded rectangle with a border and shadow) plus a small SVG notch drawn by us, around a fixed-size preview (for example 390x844 points). No Apple device artwork.

## 5. Wallpapers

- **Format:** CSS gradients and small inline SVG (about 1 to 3 kB each) in a stage CSS file. CSS does not count toward the JS budgets in `.size-limit.json`, which only cover `.js` and `.wasm`.
- **For texture:** WebP images in `public/stage/` (served as files, not bundled), at most about 60 kB each at 1920 wide.
- **Cap:** 400 kB in total for the six (Dune, Tide, Night market, Moss, Paper, Orbit).
- **Existing feature:** a theme background-image setting already exists (`src/settings/sections/ThemesSection.tsx`, `setBackgroundImageId`). Its loader may be reusable; check it before building a new one.
- **Design boards:** not in this repo or in `docs/rokk`. ROADMAP says they are on the design canvas, so the owner needs to export them. Nothing was fetched.

## 6. Safety and privacy

**Risks:**
- Secrets visible in the terminal (keys, `.env` output).
- macOS notifications landing on screen, though window capture leaves them out.
- Other windows, if whole-screen capture is used.
- The mic, if audio is ever enabled.
- Forgetting a recording is running.
- Dev builds asking permission for the wrong app.

**Cheap mitigations:**
- Default to preview-only content, with the terminal hidden.
- Record only the Rokk window, never the whole screen.
- A warning before the first recording, and a short pre-record checklist ("terminal hidden, no keys on screen").
- No audio by default.
- A visible recording indicator in the stage with elapsed time; it also shows in the window title.
- A stop shortcut and a Stop button.
- Stop and save automatically when Stage is exited or the window closes.
- Never record on launch.

## 7. Phased plan

| Phase | Scope | New files | Upstream lines | Rust | Size | Risks | Test |
|---|---|---|---|---|---|---|---|
| 1. Stage view | Toggle, hide chrome, center the active pane, calm default wallpaper (CSS), exit control, `Mod+Alt+S` | `src/modules/rokk-stage/` (store, slot, lazy view), `stage.css` | `App.tsx` about 3 lines (import, handler, slot); `shortcuts.ts` 1 entry; maybe 1 id each in Header, TabBar, StatusBar | No | Lazy chunk about 3 kB gzip; startup only the slot | Selectors for hidden chrome; traffic lights still visible | Vitest for the store and shortcut; manual: terminal resizes, Claude keeps working, exit restores |
| 2. Record and Stop | Record only the Rokk window to `~/Movies/Rokk`, an indicator, Stop, permission check and Settings link | `src-tauri/src/modules/rokk_stage/` (record, permission, window id), UI in the stage module | `modules/mod.rs` 1, `lib.rs` 2 to 3 command names | Yes (and the `screencapturekit` crate, if approved) | About 2 kB of JS | Permission in dev versus packaged; SIGINT behavior; macOS 13 and 14 fallback | Rust: command arguments, path rules, file naming; manual on a packaged build |
| 3. Shapes and looks | Landscape and portrait presets with restore, 6 wallpapers, "Made with Rokk" mark, phone frame for the preview | Wallpaper CSS and WebP, presets | `capabilities/default.json` 2 permissions, or Rust commands instead | Optional (resize in Rust) | WebP up to 400 kB in `public/`; JS about 1 kB | Window-state plugin saving the stage size; multi-monitor | Vitest: preset clamping; manual on 1440x900 and 1920x1080 |
| 4. Share panel | Open the folder, copy a caption, open an upload page, optional MP4 conversion through `avconvert` | Share panel in the stage module | None | Small (open the folder, run `avconvert`) | About 2 kB | Never upload anything ourselves | Vitest for the caption; manual |

Every phase needs no change to the terminal engine, agent detection, the rail, the meter or the guards.

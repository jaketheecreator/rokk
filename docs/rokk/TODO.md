# Rokk TODO: the "rename later" group

These were left as Terax on purpose in phase 1. Each needs a migration or a release decision. See docs/rokk/ARCHITECTURE_MAP.md, section 1.

## Release blocker

- [ ] **Updater URL and public key** (`src-tauri/tauri.conf.json`, `plugins.updater`). They still point at `github.com/crynta/terax-ai/releases` and the Terax minisign key. **These MUST change before any Rokk build ships**, or Rokk will offer and install Terax builds. Also update `src/modules/updater/UpdaterDialog.tsx` at the same time: it says "Terax vX is available" and prints `Terax_*.deb` and `Terax-*.rpm` install commands. Its wording was left unchanged because it describes what the current feed actually delivers. With productName now Rokk, newly built packages will be named `Rokk_*`, so those commands need to match the new feed.

## Needs a data migration

- [ ] **Bundle identifier** `app.crynta.terax`. It decides the app data, config, cache and log directories (Tauri 2 `path` APIs join on `identifier`). Changing it needs a one-time copy of settings, spaces, themes, AI sessions, window state and (on Linux) `secrets.json` from the old directory.
- [ ] **Keychain service** `terax-ai` (`src/modules/ai/config.ts`). Read each key under the old service, write it under the new one, then delete the old entry.
- [ ] **`~/.cache/terax`**: the control descriptor (`src-tauri/src/modules/control.rs`) and shell integration (`src-tauri/src/modules/pty/shell_init.rs`).
- [ ] **Store file names** `terax-*.json` (settings, spaces, custom themes, AI sessions, agents, snippets, todos).

## Needs a compatibility window

- [ ] **`TERAX_*` environment variables**. `TERAX_TERMINAL` gates agent hooks already installed in users' configs, so accept both names before switching.
- [ ] **`ROKK_TERMINAL`** joins this migration list: Rokk sets it next to `TERAX_TERMINAL` (in `pty/shell_init.rs`), and the vague-prompt guard is gated on it. If `TERAX_TERMINAL` is ever renamed, keep `ROKK_TERMINAL` and the guard's gate as they are.
- [ ] **Hook signal** OSC 777 `notify;Terax;...`. The detector would have to accept both markers first.

## Packaging and tooling

- [ ] **Cargo package and binary name** (`terax`, `terax_lib`, `default-run`). These feed the release workflow.
- [ ] **CLI names**: the `terax-cli` sidecar, the `terax` launcher on PATH inside panes, `TERAX_CLI`, and the `build.rs` sidecar path.

## Handshake

- [ ] **Handshake polish:** the owner wants richer animation and extras later.
- [ ] **Terminal font:** Geist Mono with a Nerd Font fallback chain (the UI font is Geist since upgrade 1; terminal and editor fonts are unchanged).
- [ ] **Changes switch** (upgrade 3) and **session rail** (upgrade 4) are next; the Files/Git switch and the right rail in the board are not built yet.
- [ ] **macOS traffic lights:** the top bar is now 56px tall but the native traffic lights keep their default position near the top. Centering them needs `trafficLightPosition` in `src-tauri/tauri.conf.json` (Rust/config follow-up, not done).
- [ ] **Git count freshness:** the status bar shows `sourceControl.changedCount`, which refreshes only while a source-control consumer is on screen, so it can lag until the panel is opened.
- [ ] Before the public release, review Anthropic's brand guidelines for using the Claude spark in a third-party interface; if needed, switch to a neutral agent icon.
- [ ] **Claude "started" versus "working":** the activity store maps the `started` signal to `working`, so a freshly launched Claude shows the turning spark until its first finish or attention. A static spark at launch would need the store to keep a separate started phase.
- [ ] Upstream bug: duplicate @lezer/highlight (1.2.3 and 1.2.5) leaves JS and TS unhighlighted in Terax v0.9.0; fixed here with a pnpm override (in `pnpm-workspace.yaml`, since pnpm 11 ignores the `pnpm` field in `package.json`); consider reporting upstream and note that package.json, pnpm-workspace.yaml and pnpm-lock.yaml are upstream files that need care when merging upstream.
- [ ] Changes view phase 2: attribute edits to Claude exactly, using tool events (see Rail phase 2); today files edited by the user during a session can appear. Also: SidebarRail.tsx is an upstream file that needs care when merging upstream.
- [x] **Size budget:** total client JS raised to 1,530,000 bytes on 2026-10-31 for the session rail (see the policy in docs/rokk/CHANGES.md).
- [ ] Rail phase 2: narrate Read, Edit and Run steps. Options: (a) a new read-only Rust reader limited to ~/.claude/projects/*/*.jsonl with a locking test that rejects any other path, emitting Tauri events; (b) extend the hooks Terax installs in ~/.claude/settings.json to report tool events through the control socket (touches 3 upstream files). Claude's session files are undocumented and change between versions.
- [ ] The session rail touches upstream files (`src/app/App.tsx`, `src/modules/header/Header.tsx`, `src/modules/shortcuts/shortcuts.ts`); they need care when merging upstream.
- [ ] Buddy phase 2: (a) 'Polish with Claude' by running `claude -p` headless in the project folder with the user's own login (needs a new Rust process command, a timeout, and clear consent text); (b) read Claude's last message directly (needs the session-file reader from Rail phase 2); (c) learn house rules from CLAUDE.md; (d) per-project rules.
- [ ] Prompt buddy touches upstream files (`src/app/App.tsx`, `src/modules/header/Header.tsx`, `src/modules/shortcuts/shortcuts.ts`); they need care when merging upstream.
- [ ] **Size budget nearly full again:** total client JS is 1,527,539 of 1,530,000 bytes after Prompt buddy. The next feature needs trimming (for example the `cm-lang-css` chunk) or an approved raise with a written reason.
- [ ] **Settings toggle** for the handshake. Today it is controlled only by `localStorage["rokk.handshake"] = "off"` (see `docs/rokk/HANDSHAKE.md`).

## Executable rename (terax to rokk)

Renaming the compiled program breaks the places below, so migrate them together in one change. Verify first: the macOS Dock label in dev may come from the embedded Info.plist rather than the executable name, so the rename may not be needed for the Dock at all.

- [ ] `src-tauri/installer-hooks.nsh` lines 7-19: the NSIS "Open in" registry entries hardcode `$INSTDIR\terax.exe`. Point them at the new name and remove the old registry keys on upgrade.
- [ ] `src-tauri/src/modules/agent.rs` lines 118-140: the Windows Codex and Gemini hooks embed the absolute executable path. Add that path to the installed-check (`status_needle`) so stale hooks are reported and reinstalled, plus a test that locks it.
- [ ] `.github/workflows/release.yml` lines 130 and 150: the AppImage checks for `usr/bin/terax`.
- [ ] `nix/package.nix` lines 60-62: installs and wraps `usr/bin/terax`.
- [ ] `scripts/app-lab/run.py` lines 68 and 166: finds the app by the process name `terax`.
- [ ] `src-tauri/Cargo.toml`: `default-run = "terax"`.

## Upstream merges

- [ ] The Settings window changes live in upstream Terax files (`src-tauri/src/lib.rs` `open_settings_window`, `src/settings/SettingsApp.tsx`). Merge upstream updates to those files with care; the nav itself is isolated in `src/settings/SettingsSidebar.tsx` and `src/settings/settingsNav.ts`. Keep the `with_denylist(&["settings"])` call on the window-state plugin when merging `lib.rs`, or Settings will reopen at a saved size again.
- [ ] The Graphite surface changes touch upstream Terax theme and layout files (`src/styles/globals.css`, `src/modules/theme/ThemeProvider.tsx`, `index.html`, `settings.html`, `src/modules/tabs/TabBar.tsx`, `src/modules/sidebar/SidebarRail.tsx`, `src/modules/header/SearchInline.tsx`, `src/modules/statusbar/StatusBar.tsx`, `src/modules/statusbar/CwdBreadcrumb.tsx`). Merge upstream updates to them with care; the tokens themselves live in `src/styles/rokk-surfaces.css`.

## Guards

- [ ] **Windows support** for the vague-prompt guard. Windows hooks would call the app by absolute path (as `__terax_notify` does), so a moved or reinstalled app leaves a stale path; needs a stable shim like `~/.rokk/app-path`.
- [ ] **Mid-session hook changes:** the hooks reference says the file watcher normally picks up direct edits to settings files. Test whether a running Claude Code session starts using the guard without a restart, then update the page text.
- [ ] **"Improve my prompt" step:** offer a suggested rewrite of a vague prompt, not only a clarifying question.
- [ ] **Measure the effect:** log turns until done (counts only, no text) to check whether clarifying questions reduce rework.
- [ ] **Tune Medium sensitivity** with real prompts.
- [ ] **Cold start time:** measure how long the hook takes to start the Rokk program on a cold disk; the program exits by itself after 150 ms.
- [ ] Guards touch upstream files (`src-tauri/src/modules/agent.rs` is read for its patterns only; `src-tauri/src/lib.rs`, `src-tauri/src/modules/mod.rs`, `src/settings/SettingsApp.tsx` and `src/modules/settings/openSettingsWindow.ts` are edited); agent.rs, lib.rs and modules/mod.rs need care when merging upstream.
- [ ] `src-tauri/src/modules/pty/shell_init.rs` now sets `ROKK_TERMINAL` (2 lines) and `src/modules/header/Header.tsx` lost the Buddy icon; both are upstream files that need care when merging upstream.
- [ ] Prompt buddy: its dialog returns focus to the removed top-bar button on close; with the button gone, focus is not moved. Fix or delete the module when Buddy is decided.

## Credit meter

- [ ] **Refresh the price table** (`src-tauri/src/modules/rokk_meter/prices.json`) before each release, from https://platform.claude.com/docs/en/about-claude/pricing.
- [ ] **Per-file edit counts** for the loop breaker: needs file paths from tool inputs, which the meter does not read today. A privacy decision first.
- [ ] **Other agents** (Codex, Gemini) are not metered.
- [ ] **Subscription limits** cannot be shown: they are not in the session files.
- [ ] **Weekly summary** of usage, built from the meter and the guard stats.
- [ ] **Active session matching** is by folder and time; reading the session id from a hook would be exact (the guard hook sees `session_id`).
- [ ] `src-tauri/src/lib.rs` and `src-tauri/src/modules/mod.rs` are upstream files, and `src/modules/rokk-rail/SessionRail.tsx` is shared by the rail and the meter; they need care when merging.

## Ship it checklist

- [ ] **Windows support**, with the guard hook.
- [ ] **A short result in the rail** when the checklist finishes (Go or Wait). Needs Claude's report text, which Rokk does not read today.
- [ ] **More phrases and languages.**
- [ ] **Detect how the project deploys** (for example Vercel or Netlify config) and add deploy checks.

## Stage mode

- [ ] **Phase 2, record and stop:**
  - Use ScreenCaptureKit through the `screencapturekit` crate; adding the crate needs the owner's approval.
  - Show a menu bar recording indicator outside the captured area.
  - The Screen Recording permission flow can only be tested in a packaged build.
- [ ] **Phase 3, window shapes and looks:**
  - Portrait and landscape window shapes, using window permissions.
  - Remember and restore the previous size and position, so the window-state plugin does not save the stage size.
  - Hide the traffic lights.
  - A phone frame drawn by us.
- [ ] **Phase 4, share panel:** open the folder, copy a caption, open the upload page.
- [ ] **Merging upstream:** `src/app/App.tsx`, `src/modules/header/Header.tsx`, `src/modules/statusbar/StatusBar.tsx` and `src/modules/shortcuts/shortcuts.ts` are touched by Stage mode. `TabBar.tsx` and `SidebarRail.tsx` are not touched, but stage.css depends on their place inside the header and `#sidebar`. All are upstream files that need care when merging upstream.

## Stage recording

- [ ] **macOS 13 and 14 fallback** with `screencapture -v -x -l <windowid>`. Untested: whether `-v` works with `-l`, and whether SIGINT finalizes the file.
- [ ] **Hide the traffic lights** while recording (Phase 3).
- [ ] **A cursor toggle.**
- [ ] **Optional system audio.**
- [ ] **A recording-in-progress warning on quit.** Today quitting finalizes the file without asking.
- [ ] **Record from a packaged, signed build** to test the permission flow for real.
- [ ] **A Windows and Linux story.**
- [ ] **Countdown digits in Cherry Bomb One:** needs the font file bundled; today they use Geist.
- [ ] **Merging upstream:** `src-tauri/src/lib.rs`, `src-tauri/src/modules/mod.rs`, `src-tauri/Cargo.toml` and `src-tauri/Info.plist` are upstream files that need care when merging upstream. `tauri.conf.json` was not touched.
- [ ] **CI:** `cargo check --locked` needs Cargo.lock updated with the new crates; the next local build does that.
- [ ] **CI:** confirm the release macOS runners link the recording crates. Swift's static compatibility libraries must be in the selected toolchain, which is true for both Xcode and the Command Line Tools with the `build.rs` search path.
- [ ] **Contributor build note:** add to the README or docs/rokk that macOS builds need Xcode or the Command Line Tools with Swift 5.9 or later. This Mac uses Command Line Tools 26.6 with Swift 6.3.3.
- [ ] `src-tauri/build.rs` is an upstream file that needs care when merging upstream.
- [ ] **Verify launch on macOS 13 and 14** (recording disabled, app must start) and **on a clean packaged build** on a Mac without developer tools, to confirm the Swift runtime is found through `/usr/lib/swift`. If launch fails there, options: weak-link the Swift and ScreenCaptureKit pieces, put recording behind a Cargo feature `record` that is off by default, or raise the minimum macOS.
- [x] **Recording controller window:** built (see RECORD.md); pending the manual checklist.
- [ ] **Verify the recording controller on macOS 15 and 26**, and with two displays.
- [ ] **A hotkey while the controller has focus** (for example Escape to stop).
- [ ] **Upstream files touched by the controller:** `vite.config.ts` (one entry line), `src-tauri/src/lib.rs` (two command lines) and the new `src-tauri/capabilities/recorder.json` need care when merging upstream. `tauri.conf.json` was not touched.
- [ ] **Why the finalize hung:** a `-partial.mp4` was left on 2026-11-02 when a stop never finished saving. The watchdog now covers it; find the root cause (ScreenCaptureKit's finalize callback, or the removal of the menu bar item off the main thread) with a real run.
- [ ] **What the red pill is:** confirm from a real run, with the new log lines, which callback the red control at the top left of the captured window sends (`userStopped` `-3817` or `systemStoppedStream` `-3821`), and whether the menu bar item was visible.

## Stage Show switch

- [ ] **A Both layout:** terminal and preview side by side in the frame.
- [ ] **Automatic detection of running dev servers:** needs a Rust listener scan and a privacy review.
- [ ] **Mobile preview with a phone frame, and window shapes** (Phase 3).
- [ ] **Recording another app's window through a system picker:** needs its own consent design.
- [ ] **Non-localhost URLs** in the Show popover.
- [ ] **Upstream files touched:** `src/app/App.tsx` (the stage mount line now passes tabs) and `src/modules/preview/PreviewPane.tsx` (one `data-rokk-preview` attribute) need care when merging upstream.

## Auto-zoom

- [x] **Phase C route decision:** the `objc2-av-foundation` and `objc2-core-media` crates (approved 2026-11-04), design R-C (see ZOOM_MAP.md section 10).
- [ ] **Phase C first build:** the Rust was written without a build. Run `cd src-tauri && cargo test --lib rokk_record 2>&1 | tail -30` and fix what the compiler says. `Cargo.lock` gains the two crates on that first local build, before CI's `--locked` check.
- [ ] **Phase C upstream files:** `src-tauri/Cargo.toml` (the macOS crates and `objc2-foundation` features), `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs` (three command lines) and NOTICE; take care when merging upstream.
- [ ] **HEVC export:** AVFoundation documents the average bit rate key for H.264 only; HEVC needs a check before it is offered.
- [ ] **Scroll awareness for new recordings:** record scroll event times only (no positions, no content) through a local `NSEvent` monitor in Rokk's own window, next to the cursor track, so pauses while scrolling can be dropped. Verify first that a local monitor needs no macOS permission (see ZOOM_MAP.md section 11).
- [ ] **Hide temporary files too:** write the recorder's and the export's `-partial.mp4` files into a hidden folder as well, so Finder never shows them.
- [ ] **Settings: open the mouse path folder:** a Settings button that reveals `~/Movies/Rokk/.zoom` in Finder.
- [ ] **First-recording text:** it still says the mouse path is saved "next to the video" (now in a hidden folder beside it); reword if wanted.
- [ ] **Sites that refuse embedding:** recording another window or browser tab through the system picker (ScreenCaptureKit's content picker) would cover sites that block frames. It needs its own consent design, since it records outside Rokk.
- [ ] **Export frame rate:** the output is a constant 30 fps; a 60 fps option would need the recorder to capture at 60.
- [ ] **Bit rate:** recordings are 1.4 to 4.4 Mbit/s (ScreenCaptureKit's choice; the recording output has no setting), which limits sharpness at 2x.
- [ ] **Size budget:** raised to 1,575,000 bytes for the Phase B player (2026-11-03). The next room must come from trimming Terax's built-in AI agent.
- [ ] **Scroll detection is not planned:** scrolling does not move the cursor, and seeing scroll events would need an event tap and a macOS permission (Input Monitoring or Accessibility). The 1.5 s hold cap covers it.
- [ ] **WebKit media clock:** confirm with `rokkZoomDebug()` that `uniqueTimeFraction` is near 1 on a real recording; if frame callbacks are missing in this WebKit, the clock falls back to `currentTime` changes.
- [ ] **Zoom as the default result:** whether a saved recording should later offer the zoomed version first.
- [ ] **Asset protocol scope (upstream `src-tauri/tauri.conf.json`), owner decision:** the player plays the MP4 through `convertFileSrc`, which works because the asset protocol is already on with scope `["**"]`. Narrowing it to `$MOVIE/Rokk/*.mp4` would break the upstream editor's image, video, audio and PDF preview for files in other folders (`src/modules/editor/EditorPane.tsx:584`), so it was not changed. Options: keep `**`; narrow it and let the editor allow each opened file at runtime through a small Rust command (`asset_protocol_scope().allow_file`), which touches upstream files; or narrow it and drop the editor's media preview.
- [ ] **Upstream files:** `src-tauri/src/lib.rs` gained the `zoom_read` line and `src/styles/compositingBudget.test.ts` an allowlist entry; both need care when merging upstream.
- [ ] **Zoom algorithm parameters:** level, dwell time, dwell radius, ease durations, gap and hold limits, to tune in Phase D.
- [ ] **Verify** that the cursor calls never prompt for a permission, and the clock offset between `recording_did_start` and the first frame.
- [x] **Optional frame:** the sidecar's `frame` is null when the app zoom is not 100%; Phase B then zooms within the whole video.
- [ ] **Stage frame presets and Lock shape** were removed in favor of free resizing; old `rokk.stage.size` preset values are ignored, and `rokk.stage.autozoom` is no longer read.

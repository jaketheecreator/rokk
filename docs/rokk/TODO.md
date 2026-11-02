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

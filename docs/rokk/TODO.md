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
- [ ] **Size budget is full:** after the Changes view, total client JS is 1,504,872 of 1,505,000 bytes. The next feature (the session rail) needs room first: trim existing chunks, or agree a new budget.
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

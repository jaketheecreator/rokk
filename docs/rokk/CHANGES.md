# Rokk changes to Terax

Rokk is based on Terax (Apache License 2.0). This file lists every file Rokk has added, modified or replaced, as Apache-2.0 section 4(b) requires. Phase 1 covers the safe rename group only. Base: Terax at `d0b569c`.

## Added

- `NOTICE`: attribution to Terax and the Cherry Bomb One (SIL OFL 1.1) credit for the wordmark.
- `docs/rokk/ARCHITECTURE_MAP.md`: read-only survey of the codebase for Rokk.
- `docs/rokk/CHANGES.md`: this file.
- `docs/rokk/TODO.md`: the "rename later" group, with the updater marked as a release blocker.
- `docs/rokk/UPSTREAM_README.md`: unchanged copy of the Terax README.
- `docs/rokk/brand/*`: Rokk brand sources supplied by the owner (icon, marks, wordmark, OFL text).
- `public/rokk-mark.svg`: Rokk mark, copied from `docs/rokk/brand/rokk-mark.svg`, used as the favicon.
- `src/components/brand/RokkMark.tsx`: inline SVG mark (static, or animated with `rk-` classes and reduced-motion support), ported from `rokk-mark-animated.svg`.
- `src/components/brand/RokkWordmark.tsx`: inline SVG wordmark using `currentColor`, ported from `rokk-wordmark.svg`.

## Replaced

- `README.md`: new short Rokk README (the original is in `docs/rokk/UPSTREAM_README.md`).
- `public/logo.png`: Rokk 256 px icon (same image as the new `src-tauri/icons/128x128@2x.png`).
- `src-tauri/icons/*` (52 files: desktop png, icns, ico, Square*/StoreLogo, `android/`, `ios/`): regenerated with `pnpm tauri icon docs/rokk/brand/rokk-icon-1024.png`. Same file names, none added or removed.

## Modified

- `CLAUDE.md`: appended a "Rokk rules" section; the existing text is unchanged.
- `index.html`: page title Rokk; favicon now `/rokk-mark.svg`.
- `settings.html`: page title "Rokk Settings"; favicon now `/rokk-mark.svg`.
- `src-tauri/tauri.conf.json`: `productName`, main window title, short and long description, file association name ("Rokk Document").
- `src-tauri/tauri.windows.conf.json`: window title.
- `src-tauri/Cargo.toml`: `description` only.
- `src-tauri/Info.plist`: camera and microphone permission prompts.
- `src/app/components/CloseDialogs.tsx`: "Quit Rokk?".
- `src/modules/agents/components/NotificationBell.tsx`: empty-state text.
- `src/modules/agents/lib/agentIcon.tsx`: built-in agent icon is now `RokkMark` (was `/logo.png`).
- `src/modules/agents/lib/format.ts`: display label for the built-in agent (the `terax` id key is unchanged).
- `src/modules/agents/lib/notify.ts`: test notification title.
- `src/modules/ai/components/AiChat.tsx`: empty-state title.
- `src/modules/ai/components/AiComposerInput.tsx`: placeholder.
- `src/modules/ai/components/AiMiniWindow.tsx`: empty-state logo is now `RokkMark` (static) plus its text.
- `src/modules/ai/components/LocalAgentNotificationsBridge.tsx`: notification titles (the `AGENT` id constant is unchanged).
- `src/modules/ai/components/SelectionAskAi.tsx`: button label.
- `src/modules/ai/config.ts`: the agent's name in both system prompts.
- `src/modules/control/useControlBridge.ts`: error message.
- `src/modules/lsp/components/LspStatusPill.tsx`: message text.
- `src/modules/tabs/lib/useWindowTitle.ts`: window title app name.
- `src/modules/terminal/block/BlockWatermark.tsx`: first-run logo is now `RokkMark` (static).
- `src/settings/components/LspInstallDialog.tsx`: message text.
- `src/settings/sections/AboutSection.tsx`: `RokkMark` logo, default name, tagline, "Based on" and "Terax website" labels.
- `src/settings/sections/AgentsSection.tsx`: placeholder.
- `src/settings/sections/GeneralSection.tsx`: notification and autostart descriptions, error message.
- `src/settings/sections/ModelsSection.tsx`: keychain description.

## Handshake (phase 2)

Added:

- `docs/rokk/HANDSHAKE.md`: how the handshake works, its flag, the dev preview and known gaps.
- `src/modules/rokk-handshake/index.tsx`: lazy entry (default export).
- `src/modules/rokk-handshake/HandshakeOverlay.tsx`: the overlay, the one-time hop mark and the dev-only `window.rokkHandshake()`.
- `src/modules/rokk-handshake/rules.ts`: pure greeting rules.
- `src/modules/rokk-handshake/rules.test.ts`: tests for the rules.

Modified:

- `src/app/App.tsx`: one `React.lazy` import and one `<Suspense>` mount line next to the `Toaster`.
- `src/components/brand/RokkMark.tsx`: exports `BODY_PATH` and `HOLE_PATH` so the handshake reuses the mark shapes.
- `docs/rokk/TODO.md`: added the Settings toggle and the executable rename migration.

## Settings window (phases 3 and 3b)

These edit upstream Terax files (`src-tauri/src/lib.rs`, `src/settings/SettingsApp.tsx`) and need care when merging upstream updates.

Added:

- `src/settings/SettingsSidebar.tsx`: Settings section nav. A plain sticky list (200px, 36px rows, icon plus label, `rounded-lg`, `bg-accent` active row) beside the content, collapsing to a 48px icon column with tooltips and aria-labels below 760px. Roving focus with ArrowUp, ArrowDown, Home and End.
- `src/settings/settingsNav.ts`: pure helpers for the nav (keyboard index math, the narrow-width rule).
- `src/settings/settingsNav.test.ts`: tests for those helpers.
- `src/settings/SettingsSidebar.test.tsx`: markup test (sticky landmark, plain list, `aria-current`, roving tabindex, narrow rail labels).

Modified:

- `src-tauri/src/lib.rs`:
  - The window-state plugin now denylists the `settings` window (`with_denylist(&["settings"])`), so its size and position are never saved or restored. Main and every other window keep their behavior.
  - Settings always opens at 960x680 (was 900x700), with a 760x520 minimum (was 820x620).
  - `clamp_settings_size` (pure, four unit tests) keeps the default inside 90% of the monitor work area.
  - Centering over the main window now runs on macOS, Windows and Linux, with `center()` as the fallback. The macOS-only `PhysicalPosition` import and a stale `allow(unused_variables)` were removed.
- `src/settings/SettingsApp.tsx`: layout shell only.
  - The top tab bar is gone. The header stays as the drag region.
  - `<main>` stays the single scroller. Inside it, one centered container (960px max, 24px padding) holds the sticky nav and the content column (680px max) with a 48px gap (24px when narrow).
  - Sections, labels, icons, order, tab state, `?tab=` deep links and the `terax:settings-tab` event are unchanged.
- `docs/rokk/TODO.md`: added handshake polish and the upstream-merge note.

## Surfaces: "A · Graphite" (upgrade 1)

Added:

- `src/styles/rokk-surfaces.css`: the three-layer surface tokens (window, panel, canvas), shape tokens, state colors, Geist `@font-face`, and the pane overrides.
- `public/fonts/geist/Geist-Regular.woff2`, `Geist-Medium.woff2`, `Geist-SemiBold.woff2`: Geist Sans from the official `geist` 1.9.0 npm tarball (sha512 verified against the registry), as static assets, not a dependency.
- `public/fonts/geist/OFL.txt`: the Geist license (SIL OFL 1.1), copied from the same tarball.
- `docs/rokk/DESIGN_TOKENS.md`: every token, its values and where it is applied.

Modified:

- `src/styles/globals.css`: one import line for `rokk-surfaces.css`, and Geist first in `--font-sans`.
- `src/modules/theme/ThemeProvider.tsx`: sets `data-rk-surface="graphite"` on `<html>` while the default theme is active, and removes it otherwise.
- `index.html`, `settings.html`: the pre-paint script sets the same attribute from the theme fast path (no new colors).
- `src/modules/tabs/TabBar.tsx`: the active tab pill, tab triggers and rename field use `--rk-active`, `--rk-text`, `--rk-text-2`, `--rk-edge` and `--rk-radius-sm`. The active tab is medium weight, and hover is 150 ms.
- `src/modules/sidebar/SidebarRail.tsx`: the Files/Git switch uses the field background with an `--rk-active` segment and `--rk-radius-sm`.
- `src/modules/header/SearchInline.tsx`: the search field uses `--rk-field`, `--rk-edge`, `--rk-radius-sm` and the text tokens.
- `src/modules/statusbar/StatusBar.tsx`: status bar text uses `--rk-text-2`. The bar keeps the window layer behind it, so vibrancy still shows through.
- `src/modules/statusbar/CwdBreadcrumb.tsx`: breadcrumb pills use the text tokens, `--rk-field` hover and `--rk-radius-sm`.
- `NOTICE`: credit line for Geist (SIL OFL 1.1).
- `docs/rokk/TODO.md`: terminal font follow-up and the upstream-merge note for theme and layout files.

## Frame and agent state (upgrade 2)

Added:

- `src/components/brand/RokkStateMark.tsx`: the Rokk mark as an agent state (idle, working, attention, done).
- `src/modules/tabs/lib/tabMarkState.ts` and `tabMarkState.test.ts`: pure state-to-mark mapping, labels, and the "finished until focused" set.
- `src/modules/statusbar/AgentStatePill.tsx`: the status bar pill for the active tab's agent state.
- `src/modules/statusbar/lib/agentPill.ts` and `agentPill.test.ts`: duration formatting, pill styles, and the per-pty working start time (the store records none).

Modified:

- `src/styles/rokk-surfaces.css`: bottom panel gutter, and the stepped working animation for the mark.
- `src/modules/header/Header.tsx`: top bar height, padding, gaps and icon buttons.
- `src/modules/header/SearchInline.tsx`: 210 x 34 search pill with a mono shortcut hint; placeholder is now just the label.
- `src/modules/agents/components/NotificationBell.tsx`: the bell button matches the other top bar icon buttons (no logic change).
- `src/modules/tabs/TabBar.tsx`: tab sizes and weights; terminal tab icons are now `RokkStateMark` with hidden state text.
- `src/modules/explorer/FileExplorer.tsx`, `src/modules/explorer/TreeRow.tsx`: panel header and 29px rows (`ROW_HEIGHT` kept in sync).
- `src/modules/sidebar/SidebarRail.tsx`: Files/Git switch sizes and radii.
- `src/modules/statusbar/StatusBar.tsx`: 48px bar, the agent state pill and git text (new optional props `activeTab`, `gitBranch`, `changedCount`).
- `src/modules/statusbar/CwdBreadcrumb.tsx`: breadcrumb pills and 13px chevrons.
- `src/modules/statusbar/WorkspaceEnvSelector.tsx`: quiet `--rk-text-2` styling.
- `src/modules/ai/components/AiStatusBarControls.tsx`: "Open AI agent" in the pill style (no logic change).
- `src/app/App.tsx`: three props on the `StatusBar` mount line (`activeTab`, `sourceControl.repo?.branch`, `sourceControl.changedCount`).
- `docs/rokk/DESIGN_TOKENS.md`, `docs/rokk/TODO.md`: frame values and follow-ups.

## Claude identity on tabs (upgrade 2b)

Modified:

- `src/styles/rokk-surfaces.css`: `--rk-claude`, `--rk-claude-text` and `--rk-claude-tint`, plus the stepped spark turn (`steps(8, end)`, still with reduced motion).
- `src/components/brand/RokkStateMark.tsx`: new `agent` prop. Claude renders the existing Hugeicons `ClaudeIcon` spark with the same dot badges; other agents keep the Rokk mark.
- `src/modules/tabs/lib/tabMarkState.ts`, `tabMarkState.test.ts`: `isClaudeAgent`, a "Claude is ready" label for idle Claude, and an exited agent no longer keeps an unseen finish.
- `src/modules/tabs/TabBar.tsx`: passes the detected agent to the mark.
- `src/modules/statusbar/lib/agentPill.ts`, `agentPill.test.ts`: the working pill uses the Claude colors for Claude.
- `src/modules/statusbar/AgentStatePill.tsx`: passes the agent to the pill style and the mark.
- `docs/rokk/DESIGN_TOKENS.md`, `docs/rokk/TODO.md`: Claude tokens, contrast results and the brand review note.

## Tab edge and bar spacing (upgrade 2c)

Modified (classes and CSS only, no behavior change):

- `src/modules/tabs/TabBar.tsx`: the sliding active-tab pill no longer has `ring-1 ring-inset ring-[var(--rk-edge)]`; it is a flat `--rk-active` fill. The trigger keeps its focus-visible ring.
- `src/styles/rokk-surfaces.css`: removed the 8px bottom padding under the panels (`main.zoom-content`).
- `src/modules/statusbar/CwdBreadcrumb.tsx`, `src/modules/statusbar/AgentStatePill.tsx`, `src/modules/statusbar/StatusBar.tsx`, `src/modules/statusbar/WorkspaceEnvSelector.tsx`, `src/modules/ai/components/AiStatusBarControls.tsx`, `src/modules/ai/components/AgentStatusPill.tsx`: every status bar item is 28px tall (`h-7`), so it sits 10px from both edges of the 48px bar.
- `docs/rokk/DESIGN_TOKENS.md`: bar and item heights, no gap under the panels.

## Syntax highlighting fix (duplicate @lezer/highlight)

`@lezer/javascript` resolved `@lezer/highlight@1.2.5` while `@codemirror/language` and every editor theme used `1.2.3`, so JS, TS, JSX and TSX tokens never matched a style and rendered as plain text (upstream in Terax v0.9.0 too).

Modified:

- `pnpm-workspace.yaml`: `overrides: "@lezer/highlight": "^1.2.5"`. pnpm 11 no longer reads the `pnpm` field in `package.json`, so the override lives with the repo's other pnpm settings; `package.json` is unchanged.
- `pnpm-lock.yaml`: regenerated by `pnpm install`; only `@lezer/highlight@1.2.5` remains (the Svelte language package re-resolved against it).

Added:

- `src/modules/editor/lib/lezerHighlightSingleton.test.ts`: fails if the lockfile holds more than one `@lezer/highlight` version, or if `@lezer/javascript` and `@codemirror/language` resolve different copies.

## Changes view (upgrade 3)

Added:

- `src/modules/rokk-changes/lib/changes.ts`, `changes.test.ts`: pure baseline versus current diff, per-repo baselines with a cap, sorting and badge text.
- `src/modules/rokk-changes/lib/recorder.ts`: the startup recorder. It takes a baseline on Claude `started` and refreshes on `finished` and `attention`, using the existing `git_resolve_repo` and `git_status` commands only.
- `src/modules/rokk-changes/ChangesView.tsx`, `index.tsx`: the lazy Changes view.
- `docs/rokk/CHANGES_VIEW.md`: how it works and its limits.

Modified (upstream files):

- `src/modules/sidebar/types.ts`: `SidebarViewId` gains `"changes"`.
- `src/modules/sidebar/SidebarRail.tsx`: imports, an optional `repoRoot` prop, the recorder start and count subscription, the Changes segment between Files and Git, and its working-tint badge. The Files and Git segments and the Git badge are unchanged.
- `src/app/App.tsx`: one `React.lazy` line, one `sidebarView === "changes"` branch mounting the view in `<Suspense>`, and the `repoRoot` prop on the `SidebarRail` mount line.
- `docs/rokk/TODO.md`: phase 2 and the merge note.

## Size budget policy

- Rokk features must load lazily (React.lazy or a dynamic import), so they cost nothing at startup until used.
- The startup budget ("main window startup JS", 540 KB in `.size-limit.json`) is never raised without the owner's approval.
- On 2026-10-31 the total budget ("total client JS") was raised from 1,505,000 to 1,530,000 bytes (gzip) to make room for the session rail. The other four budgets are unchanged.
- Every future raise needs a written reason here and the owner's approval.

Modified: `.size-limit.json` (total client JS limit only), `CLAUDE.md` (Rokk rules).

## Session rail (upgrade 4)

Added:

- `src/modules/rokk-rail/lib/rules.ts`, `rules.test.ts`: pure timeline construction, the 20-event and 32-pane caps, closed-pane pruning, durations, tab sorting and labels.
- `src/modules/rokk-rail/lib/timeline.ts`: the startup signal recorder for the timeline.
- `src/modules/rokk-rail/lib/railState.ts`: open state (`rokk.rail`) and width (`rokk.rail.width`).
- `src/modules/rokk-rail/RailSlot.tsx`: renders the handle and panel inside the main panel group only while open.
- `src/modules/rokk-rail/RailToggle.tsx`: the top bar toggle.
- `src/modules/rokk-rail/SessionRail.tsx`, `index.tsx`: the lazy rail content.
- `docs/rokk/SESSION_RAIL.md`.

Modified (upstream files):

- `src/app/App.tsx`: two imports (`RokkRailSlot`, `toggleRail`), one `React.lazy` line, one `"rail.toggle": toggleRail` handler line, and one `<RokkRailSlot><Suspense>...</Suspense></RokkRailSlot>` line after the workspace panel inside the `ResizablePanelGroup`.
- `src/modules/header/Header.tsx`: one import and one `<RailToggle />` line before `SearchInline`.
- `src/modules/shortcuts/shortcuts.ts`: the `rail.toggle` id and its entry (`Mod+Alt+B`, View group).
- `src/styles/rokk-surfaces.css`: `#rokk-rail .terax-pane` uses the panel surface, like the left panel.
- `docs/rokk/TODO.md`: Rail phase 2 and the merge note.

## Prompt buddy (version 1)

Added:

- `src/modules/rokk-buddy/lib/`: the pure libs, each with tests.
  - `rules.ts`: house rules, lockfile and doc detection.
  - `draft.ts`: the deterministic prompt builder.
  - `review.ts`: the report analyzer's pattern tables, file comparison and follow-up.
  - `insert.ts`: the safe paste decision and bracketed encoding.
  - `storage.ts`: localStorage with caps.
- `src/modules/rokk-buddy/`: the components.
  - `BuddyToggle.tsx` (startup: the button, the open state, and the gate that mounts the dialog after the first open).
  - `index.tsx` (lazy entry), `BuddyDialog.tsx`, `DraftTab.tsx`, `RulesTab.tsx`, `ReviewTab.tsx` (its own lazy chunk) and `parts.tsx` (shared controls).
- `docs/rokk/BUDDY.md`.

Modified (upstream files):

- `src/app/App.tsx`: one import (`BuddyGate`, `toggleBuddy`), one `React.lazy` line, one `"buddy.toggle": toggleBuddy` handler line, and one `<BuddyGate><Suspense>...</Suspense></BuddyGate>` line after the `Toaster`.
- `src/modules/header/Header.tsx`: one import and one `<BuddyToggle />` line before `RailToggle`.
- `src/modules/shortcuts/shortcuts.ts`: the `buddy.toggle` id and its entry (`Mod+Alt+D`, AI group).
- `docs/rokk/ROADMAP.md`: the rubber-duck row is Built, version 1.
- `docs/rokk/TODO.md`: Buddy phase 2 and the merge note.

## Visible strings left as Terax on purpose

- `src/modules/updater/UpdaterDialog.tsx`: "Terax vX is available", "Restart Terax", and the `Terax_*.deb` / `Terax-*.rpm` commands. The updater still serves Terax releases, so this text is accurate until the feed changes (see `docs/rokk/TODO.md`).
- `src/settings/sections/AboutSection.tsx`: Bundle ID row (`app.crynta.terax`, the real value) and the Terax repo and website links (credit).
- `src/modules/ai/lib/agent.ts`: OpenRouter `HTTP-Referer: https://terax.ai` and `X-Title: Terax`. These are request headers sent to a third party, not text shown in the app.
- `src/modules/theme/themes/terax-default.ts`: theme name "Terax Default" (tied to the `terax-default` id).
- `terax-icon.png` (repo root): not referenced by any code; it is outside `public/`, so it was not touched.
- `docs/readme/README.*.md` (translations), `TERAX.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `SECURITY.md`: upstream docs, unchanged.
- WebGPU debug labels, `TeraxLspClient`, `TeraxGhostty*` type names and the "Terax Theme" editor language key: code identifiers, not product text.

## Not yet changed (the "rename later" group)

- Bundle identifier `app.crynta.terax` (data, config, cache and log directories).
- Keychain service `terax-ai`.
- Updater endpoint and public key (release blocker).
- `~/.cache/terax` (control descriptor, shell integration).
- Store files `terax-*.json` and `terax:*` localStorage keys.
- `TERAX_*` environment variables and the OSC 777 `notify;Terax;...` hook marker.
- CLI names (`terax-cli`, the `terax` launcher) and the Cargo package and binary name (`terax`, `terax_lib`).

# Rokk architecture map

A read-only survey of the Terax codebase at `d0b569c` (branch `rokk-spike`). It answers one question: can Rokk features be added mostly as new files? Every claim below cites a path. Anything not confirmed in code is marked **unsure**.

Conventions to follow (from `TERAX.md` and `CONTRIBUTING.md`):

- Keep logic in pure functions and keep Tauri commands and React components thin.
- `App.tsx` stays a coordinator, and each feature lives in its own `src/modules/<area>/` with an `index.ts` barrel.
- Heavy code must not land in the eager bundle (`src/app/eager-budget.test.ts`, `.size-limit.json`).
- Anything that touches IPC or the filesystem needs a test that locks its invariant.

---

## 1. Name and brand

### Counts

`rg -i terax` finds about 1,655 matches in 293 files. This excludes `node_modules`, `src-tauri/target`, `.git` and `*.wasm`.

| Extension | Files |
|---|---|
| `.ts` | 133 |
| `.md` | 41 |
| `.rs` | 36 |
| `.tsx` | 35 |
| `.yml` | 6 |
| `.py` | 5 |
| `.zsh` | 4 |
| `.json` | 4 |
| `.html` | 4 |
| `.toml`, `.mjs` | 3 each |
| `.zig`, `.swift`, `.patch`, `.nix`, `.fish` | 2 each |
| `.yaml`, `.sh`, `.ps1`, `.plist` | 1 each |

### Places that matter

| What | Where | Value |
|---|---|---|
| productName | `src-tauri/tauri.conf.json:3` | `Terax` |
| identifier (bundle id) | `src-tauri/tauri.conf.json:5` | `app.crynta.terax` |
| Window title | `src-tauri/tauri.conf.json:17`, `src-tauri/tauri.windows.conf.json:14` | `Terax` |
| Updater endpoint and pubkey | `src-tauri/tauri.conf.json:116-123` | `github.com/crynta/terax-ai/releases/latest/download/latest.json`, crynta minisign key |
| Copyright, descriptions, file association name | `src-tauri/tauri.conf.json:94-100` | `Copyright 2026 Crynta`, `Terax Document` |
| Deep links | none found (no `deep-link` plugin in `Cargo.toml` or `lib.rs`) | none |
| Cargo package and binary | `src-tauri/Cargo.toml:2,8,31` | `terax`, `default-run = "terax"`, lib `terax_lib` |
| CLI crate and sidecar | `src-tauri/crates/terax-cli/Cargo.toml`, `tauri.conf.json:39` (`binaries/terax-cli`), `src-tauri/build.rs` (`terax-cli-<target>`) | `terax-cli` |
| CLI name on PATH inside panes | `src-tauri/src/modules/control.rs:741` | `terax` / `terax.exe` launcher |
| Protocol crate | `src-tauri/crates/terax-control-protocol/` | `terax-control-protocol` |
| npm names | `package.json:2`, `packages/ghostty-core/package.json:2` | `terax`, `@terax/ghostty-core` |
| Cache dir | `src-tauri/src/modules/control.rs:572` (`<cache>/terax/control.json`, `run/<pid>/bin`), `src-tauri/src/modules/pty/shell_init.rs:383,799` (`~/.cache/terax/shell-integration`, `terax.fish`) | `terax` |
| App data dir | derived from `identifier` (`ai_sessions.rs:519` uses `app_data_dir()`, `secrets.rs:46` uses `app_local_data_dir()` on Linux) | moves when the identifier changes |
| Store files | `settings/store.ts:214` (`terax-settings.json`), `spaces/lib/store.ts:21`, `theme/customThemes.ts:5`, `ai/lib/{agents,snippets,todos}.ts`, `ai_sessions.rs:34` (`terax-ai-sessions.json`) | `terax-*.json` |
| Keychain service | `src/modules/ai/config.ts:1` (`KEYRING_SERVICE = "terax-ai"`, sent to `secrets_*`) | `terax-ai` |
| Env vars | `TERAX_TERMINAL`, `TERAX_CONTROL_ADDR/TOKEN`, `TERAX_PANE_ID`, `TERAX_CLI`, `TERAX_BLOCKS`, `TERAX_HOOKS_LOADED`, `TERAX_USER_ZDOTDIR`, ... (about 104 hits in 29 files; `pty/shell_init.rs:174-178`, `pty/scripts/*`) | `TERAX_*` |
| Hook marker | `pty/agent_detect.rs:19-20`, `modules/agent.rs` | OSC 777 `notify;Terax;...`, already written into users' `~/.claude/settings.json` and others |
| Event and URI names | `terax:agent-signal`, `terax:control-request`, `terax:window-presentation`, ... (about 22 hits in 18 files), `terax-pty://` scheme (about 20 hits in 10 files) | internal |
| localStorage keys | `terax:terminal-diagnostics`, `terax:terminal-text-contrast`, ... | `terax:*` |
| Agent memory file | `ai/lib/transport.ts:15`, `ai/lib/slashCommands.ts:34` | `TERAX.md` |
| CSS classes | `terax-pane`, `terax-panel-in`, `terax-blink` (`src/styles/globals.css`, about 13 hits) | internal |
| Icons | `src-tauri/icons/*` (png, icns, ico, android, ios), `terax-icon.png` (root), `public/logo.png` | Terax artwork |
| About screen | `src/settings/sections/AboutSection.tsx:11,25,93,106` | repo URL, name, bundle id |
| README and docs | `README.md`, `docs/readme/*`, `docs/*.png`, `TERAX.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `SECURITY.md` | text and screenshots |

### Rename groups

**Safe to rename now** (display only, nothing stored on disk depends on it):

- `productName` and window titles
- `shortDescription`, `longDescription` and the `Terax Document` name
- About screen text and repo link
- README and docs text
- Icons and logos (`src-tauri/icons/*`, `public/logo.png`, `terax-icon.png`)
- `package.json` `name` (it is private, but check `pnpm-workspace.yaml` and `knip.json` for references)

**Rename later, with care.** Each of these strands existing data or breaks a contract:

- **identifier `app.crynta.terax`.** Changing it moves `app_data_dir` and `app_local_data_dir`, so sessions, settings, spaces, themes and Linux secrets are orphaned. It also changes the macOS keychain and notification identity, window-state and autostart entries.
- **Keychain service `terax-ai`.** Users' saved API keys become invisible. Needs a migration that reads the old name and writes the new one.
- **Updater endpoint and pubkey.** These must point at Rokk's own release feed and signing key before any Rokk build ships. If a Rokk build keeps them, it would auto-update to Terax builds.
- **Cache dirs `~/.cache/terax`** (control descriptor, shell integration), the `terax-*.json` store names and the localStorage keys.
- **Env vars and the OSC 777 marker.** `TERAX_TERMINAL` gates the hooks already installed in users' agent configs. Renaming the marker breaks hooks that are already installed unless the detector accepts both names.
- **CLI names** (`terax-cli`, the `terax` launcher, `TERAX_CLI`) and the `build.rs` sidecar path.
- **Cargo package and binary name** (`terax`, `terax_lib`). These feed release scripts and `.github/workflows/release.yml`.

**Leave alone for now:**

- Internal event names (`terax:*`) and the `terax-pty://` scheme
- CSS classes and the `@terax/ghostty-core` package name
- The `terax-control-protocol` crate name
- Ghostty patch and zig file names (`packages/ghostty-core/adapted/wasm/src/terax.zig`)
- `TERAX.md` as agent memory, unless Rokk wants its own memory file name
- The bench and test identifiers

### Licenses and obligations

- **Repo:** Apache-2.0 (`LICENSE`, `Cargo.toml` `license.workspace`, `package.json:5`). There is no `NOTICE` file.
- **MIT (bundled):** `packages/ghostty-core/LICENSE` (ghostty-web, Coder), `packages/ghostty-core/adapted/LICENSE.ghostty` (Ghostty), `packages/ghostty-core/adapted/LICENSE.restty` (restty). `tauri.conf.json:41-46` ships these under `licenses/terminal/`.
- **xterm.js (bundled):** `src/modules/terminal/ghostty/webgl/LICENSE.xterm-js`. It is also shipped. The header reads like MIT; **unsure**, because I read only the first lines.
- **Fonts, SIL OFL-1.1:** Inter and JetBrains Mono, pulled from `@fontsource*` npm packages by `src/styles/fonts.css`. OFL allows bundling. Its Reserved Font Name rule applies only if you modify and rename the fonts.
- **Icons, MIT:** `@hugeicons/core-free-icons`, `@hugeicons/react`, `@iconify-json/catppuccin`.
- **Agent brand marks:** `src/modules/agents/lib/agentIcon.tsx` draws other companies' marks (Claude, Codex, Gemini, ...). These are trademarks, not code licenses. **Unsure** how they are licensed.

**What rebranding requires under Apache-2.0 §4:**

1. Keep the `LICENSE` file.
2. Keep the existing copyright and attribution notices in the source.
3. Mark the files you modify as changed.
4. Ship any `NOTICE` file (there is none today).

Apache-2.0 §6 grants no trademark rights. That is why the Terax name and logo have to be replaced, not just kept alongside Rokk. The MIT and OFL texts must keep shipping, so keep `bundle.resources`.

---

## 2. Terminal and PTY

**Spawning a shell.**

- `src-tauri/src/modules/pty/session.rs` opens the PTY with portable-pty and spawns the shell.
- `pty/shell_init.rs` builds the shell command. It sets the env (`TERAX_*` and the control vars at `:174-178`) and installs the OSC 7/133 integration scripts from `pty/scripts/`.
- On Windows, `CONPTY_LIFECYCLE_LOCK` and the Job Object (`pty/job.rs`) wrap the spawn.
- Sessions live in `PtyState` (`pty/mod.rs`).

**Output path from Rust to React.** There is one pull stream per window (`docs/architecture/pty-transport-v2.md`):

- A reader thread (`pty/unix_reader.rs`, `pty/output.rs`) runs the DA and agent filters, then hands bytes to the hub.
- The hub thread (`pty/hub.rs`) answers a single outstanding `POST terax-pty://localhost/poll` (`pty/protocol.rs`) with framed binary (`pty/wire.rs`).
- On the frontend, `src/modules/terminal/lib/pty-bridge.ts` → `PtyOutputHub.ts` → `PtyOutputReceiver.ts` → `ptyParseScheduler.ts` → the Ghostty model.

**How Ghostty and WebGPU connect to React.**

- `packages/ghostty-core` holds the WASM (`ghostty-vt.wasm`, `adapted/`, `official/`), loaded by `terminal/ghostty/GhosttyCoreRuntime.ts`.
- `terminal/ghostty/useGhosttyTerminalSession.ts` owns one model and one PTY per leaf.
- `TerminalPane.tsx` renders the leaf. All WebGPU panes draw into one canvas in `[data-terminal-area]` (`TerminalStack.tsx`, `gpu/WebGpuWindowCanvas.ts`).

**Props, refs and the product API.**

- `TerminalPaneProps`: `leafId`, `visible`, `focused`, `initialCwd`, `blocks`, `onSearchReady`, `onExit`, `onCwd`.
- `TerminalPaneHandle`: `write`, `focus`, `getBuffer`, `getSelection` (`TerminalPane.tsx:22-40`).
- `TerminalStack` props (`TerminalStack.tsx:8-17`) are wired from `src/app/components/WorkspaceSurface.tsx`.
- The renderer-neutral API is exported from `src/modules/terminal/index.ts`: `ptyIdForLeaf`, `leafIdForPty`, `leafHasForegroundProcess`, `writeToSession`, `whenSessionReady`, `subscribeAgentSignals`, `useAgentActivityStore`.

**Knowing what runs in a tab.**

- **Yes, Claude Code is already detected.** `pty/agent_detect.rs` watches OSC 133;C;`<cmd>` (preexec, `DEFAULT_AGENTS` includes `claude`) and the hook marker OSC 777.
- It emits `terax:agent-signal` `{id: ptyId, kind: started|working|attention|finished|exited, agent}` (`pty/session.rs:19,227`).
- The frontend has a single listener (`terminal/lib/agentActivity.ts:139`). It feeds the zustand `useAgentActivityStore` (`phases`, `agents` by pty id) and `subscribeAgentSignals(handler)`.
- The tab icons use it (`tabs/lib/tabAgentStatus.ts`), and so do the notifications (`agents/components/AgentNotificationsBridge.tsx`).
- Detection works only on shells with integration (OSC 133) or with installed hooks. It is driven only by OSC sequences, never by raw output.
- **Generic foreground check:** `pty_has_foreground_process` and `pty_has_foreground_job` (`pty/mod.rs:307,324`, `pty/foreground.rs`) return a bool only, with no program name.

**Drawing an overlay without touching the engine.**

- Pane DOM stays per-pane above the canvas: block overlays, scrollbars and selection already work this way (`ghostty/GhosttyBlockOverlay.tsx`).
- Each tab's layer is `div[data-terminal-tab=<tabId>]` (`TerminalStack.tsx`). A new component can portal into that element, or be absolutely positioned over the workspace container in `App.tsx`. Either way the engine is not touched.
- Keep it `pointer-events-none` except for its own controls.
- Mind the compositing budget (`TERAX.md`): no forever-running animations, and no new composited layers at rest.

**`terax-control-protocol`** (`src-tauri/crates/terax-control-protocol/src/lib.rs`):

- It is a JSON request/response schema with `PROTOCOL_VERSION=1` and a 64 KiB maximum message.
- The methods are `ping`, `capabilities`, `identify` and `open`.
- The server is `src-tauri/src/modules/control.rs`. It is a TCP listener on `127.0.0.1:<random>` with a random token and a descriptor at `<cache>/terax/control.json` (mode 0700). Token comparison is constant-time.
- Panes get `TERAX_CONTROL_ADDR`, `TERAX_CONTROL_TOKEN` and `TERAX_PANE_ID`.
- `identify` is forwarded to the frontend as the `terax:control-request` event, answered via `control_respond`. `src/modules/control/useControlBridge.ts` is the receiving end.
- The client is `crates/terax-cli` (`terax open <path>`).

**Could Claude Code hooks or outside scripts send events through it?**

- **Not today.** Unknown methods return `unknown_method` (`control.rs:368`).
- Adding a method such as `event` would touch three existing files: the protocol crate `lib.rs` (constant and `METHODS`), the `control.rs` route, and the `useControlBridge.ts` handler. Optionally a CLI subcommand too.
- A hook running inside a pane inherits the env, so `terax <subcommand>` or a raw TCP write would work.
- **A simpler existing path:** Claude hooks already reach the app through OSC 777 via the hook's `terminalSequence` response (`modules/agent.rs`). They are installed for `UserPromptSubmit`, `Notification` and `Stop` only.

---

## 3. Frontend structure

**State.**

- Stores use zustand, one per module (14 stores), for example `agents/store/agentStore.ts`, `terminal/lib/agentActivity.ts`, `ai/store/chatStore.ts` and `settings/preferences.ts`.
- Persistent settings go through `tauri-plugin-store` (`settings/store.ts`).

**Tab model.**

- `src/modules/tabs/lib/useTabs.ts` is a React `useState` hook, not zustand. Types are at `:41,128`.
- A tab is a tagged union of `terminal | editor | preview | markdown | ai-diff | git-diff | git-history | git-commit-file`.
- Terminal tabs hold a `paneTree` (`terminal/lib/panes.ts`, `leafIds`).
- Tabs are hidden, never unmounted.

**Layout shell** (`src/app/App.tsx:1418-1600`):

- `Header` sits on top.
- Below it, `ResizablePanelGroup` (horizontal) holds the `sidebar` panel (FileExplorer or SourceControlPanel, plus `SidebarRail` from `modules/sidebar`), a `ResizableHandle`, then the `workspace` panel (`WorkspaceSurface`, then `WorkspaceInputBar`).
- `StatusBar` (`modules/statusbar/StatusBar.tsx`) sits at the bottom.
- Global bridges and overlays follow: `AgentNotificationsBridge`, `Toaster`, `TabSwitcherHud`, `CommandPalette`, `UpdaterDialog`, `CloseDialogs`.

**Where a right-side panel would go.**

- Add a third `ResizablePanel` plus a `ResizableHandle` after the `workspace` panel, inside the same `ResizablePanelGroup`, mirroring the sidebar's collapsible props.
- That is the only `App.tsx` edit needed. The panel's content can be a lazy component from a new module.
- **Unsure:** where the AI chat panel mounts. `panelOpen` is passed to `WorkspaceInputBar` (`App.tsx:1558`) and I did not trace it further. Check it does not already claim the right edge.

**Themes and tokens.**

- `src/modules/theme/ThemeProvider.tsx` and `applyTheme.ts` write CSS variables. Presets live in `theme/themes/`, and the default colours are in `src/styles/globals.css`.
- Tokens are also in `src/styles/tokens.ts`, and the Tailwind v4 `@theme` is in CSS. There is no `tailwind.config`.
- User themes come from `customThemes.ts` and `validateTheme.ts`.
- Panes use `.terax-pane` cards on `--background`, and the chrome uses `--frame`.

**Web preview.**

- The preview is an `<iframe sandbox=...>` inside the main webview (`src/modules/preview/PreviewPane.tsx:155-168`), not a Tauri child webview.
- Dev servers are found from a curated port list plus `probeUrl` when the user picks a preset (`PreviewAddressBar.tsx:30-110`). `TERAX.md` mentions a status-bar pill for automatically detected localhost URLs, but I found no such code in `statusbar/`. **Unsure**: it may be gone or live elsewhere.
- **Screen capture:** the iframe is cross-origin (`localhost:<port>`), so its pixels cannot be read from the app's JS (canvas tainting). Capture would need OS-level recording, `getDisplayMedia` (support in WKWebView is **unsure**), or a script injected into the previewed app. None of this exists today.

---

## 4. Claude Code signals

**What already exists.**

- `src-tauri/src/modules/agent.rs` installs hooks into `~/.claude/settings.json` (`UserPromptSubmit`, `Notification`, `Stop`), and into the configs for Codex, Gemini and Pi.
- These hooks return the OSC 777 marker, which `pty/agent_detect.rs` turns into `terax:agent-signal`.
- Notifications are handled by `src/modules/agents/*`: `NotificationBell`, `AgentNotificationsBridge`, `lib/route.ts`, `agentStore.ts`, and the launcher `AgentLauncherPanel.tsx`.
- **The app does not read `~/.claude/projects/*.jsonl` or any other session file.** `rg "\.claude|jsonl"` finds only `agent.rs` and a file-icon table.

**The file watcher.**

- `src-tauri/src/modules/fs/watch.rs` provides `fs_watch_add` and `fs_watch_remove`. It is backed by `watch/macos.rs` (FSEvents), `watch/portable.rs` (the `notify` 8.2 crate) and the pure `watch/plan.rs`.
- It is directory-level and debounced (150 ms, at most 1 s). It emits `fs:changed {paths}`.
- **It only watches workspace-authorized roots** (`prepare_dirs` → `WorkspaceRegistry::is_authorized`, `workspace.rs:33`). It also skips `plan::SKIP_DIRS`.
- So `~/.claude/projects` would be rejected unless it was authorized as a workspace, and that must not be done (it would widen AI tool and fs access).
- It reports which directory changed, not new lines.

**Recommendation: a separate Rust module for the session files.**

- Create `src-tauri/src/modules/claude_sessions.rs`. Reuse the `notify` crate, or poll file size with `dirs::home_dir()`.
- Make it **read-only and hard-scoped** to `~/.claude/projects`. It should tail only appended bytes, from a stored offset per file.
- Parse JSONL into a small typed summary in a pure function, and emit `rokk:claude-activity` events. Cap the sizes.
- It should cost nothing until the rail is opened (start and stop commands).
- Do not reuse `fs_watch_add`.

Files involved:

| Status | Files |
|---|---|
| Existing, to read | `fs/watch.rs`, `fs/watch/plan.rs`, `fs/watch/portable.rs`, `fs/watch/macos.rs`, `modules/agent.rs`, `pty/agent_detect.rs`, `terminal/lib/agentActivity.ts` |
| Existing, to register in | `modules/mod.rs`, `lib.rs` |

---

## 5. Three-day checkpoint

### (a) Handshake overlay when `claude` starts in a tab

**New files:**

- `src/modules/rokk-handshake/index.ts`
- `src/modules/rokk-handshake/HandshakeOverlay.tsx`
- `src/modules/rokk-handshake/lib/handshake.ts` (pure state machine: started → show → dismiss or time out)
- `src/modules/rokk-handshake/lib/handshake.test.ts`

The overlay subscribes through `subscribeAgentSignals` or `useAgentActivityStore` (both already exported from `@/modules/terminal`). It filters on `kind === "started" && agent === "claude"`, maps the pty to a leaf and tab with `leafIdForPty` and the tabs list, and portals into `[data-terminal-tab=<id>]` or positions over the workspace.

**Existing files touched:**

- `src/app/App.tsx`, to mount `<HandshakeOverlay tabs activeId />` next to `AgentNotificationsBridge`. This is the only edit.

**Total: 1 existing file.** Zero Rust. Detection already exists.

### (b) Right-side activity rail fed from Claude Code session files

**New files, Rust:**

- `src-tauri/src/modules/claude_sessions.rs` (commands `claude_sessions_start` and `claude_sessions_stop`, tailer, emitter)
- `src-tauri/src/modules/claude_sessions/parse.rs` (pure JSONL line → event, with tests)

**New files, frontend:**

- `src/modules/rokk-rail/index.ts`
- `src/modules/rokk-rail/ActivityRail.tsx`
- `src/modules/rokk-rail/store/railStore.ts` (zustand, bounded ring)
- `src/modules/rokk-rail/lib/events.ts` and `src/modules/rokk-rail/lib/events.test.ts`

**Existing files touched:**

1. `src-tauri/src/modules/mod.rs` (`pub mod claude_sessions;`)
2. `src-tauri/src/lib.rs` (`.manage(...)` state, and the commands in `generate_handler!`)
3. `src/app/App.tsx` (third `ResizablePanel` and a toggle)
4. Optional: `src/modules/shortcuts/shortcuts.ts` or `src/modules/command-palette/commands.ts` for a toggle shortcut or command
5. Optional: `src/modules/statusbar/StatusBar.tsx` for a toggle button

Notes:

- `Cargo.toml` is not touched, because `notify`, `serde_json` and `dirs` are already dependencies.
- `capabilities/default.json` is not touched. App commands are not plugin permissions; **unsure**, so verify with `removeUnusedCommands: true` in `tauri.conf.json:11`.

**Total: 3 existing files, up to 5 with the optional toggles.**

### Verdict

**Yes.** Both features fit in **4 to 6 existing files combined**, far below 10. The overlap is `App.tsx`. The reasons:

1. Claude start detection, the pty↔leaf mapping and the signal subscription are already public APIs.
2. The layout is a single `ResizablePanelGroup` that takes another panel.
3. New Rust modules only need registering in `mod.rs` and `lib.rs`.

### Biggest risks

- **`App.tsx` merge pressure.** It is 1,669 lines, and every upstream change lands there. Keep the edits to a mount line or two and put the logic in new modules.
- **Detection gaps.** "Started" needs OSC 133 shell integration (bash before 4.4, unintegrated shells, tmux and SSH may miss preexec) or the installed Claude hooks. Hooks cover `UserPromptSubmit`, `Notification` and `Stop`, not `SessionStart`. A `claude` that is never prompted may only be caught by preexec.
- **The JSONL format is undocumented and changes between Claude Code versions.** The parser must be tolerant and versioned. Files can be large, so tail from the end rather than reading whole files. Several sessions can run at once in the same project directory, so mapping a session to a tab needs cwd plus timing. **Unsure** there is a reliable key.
- **Security.** A home-directory reader is a new IPC surface. Hard-scope it to `~/.claude/projects`, never accept a path from the webview, cap the payload sizes, and add a test that locks the scope (required by `CONTRIBUTING.md`).
- **Performance budgets.** `pnpm size` (`.size-limit.json`, 71 KB terminal bundle) and `eager-budget.test.ts` fail if the rail or overlay is in the eager graph. Lazy-load both. The compositing and animation budgets in `TERAX.md` also apply.
- **WebGPU canvas.** A right panel resizes the terminal area. That is supported, but it reallocates the shared canvas (see `TERAX.md` resize notes), so avoid toggling it repeatedly.
- **Rebrand coupling.** If Rokk renames `TERAX_TERMINAL` or the `Terax` OSC marker, the detection the overlay relies on breaks for hooks that are already installed.

---

## 6. How to run checks

From `.github/workflows/ci.yml`, `package.json` and `TERAX.md`:

| Check | Command | Needs |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | Node 24 in CI (README says 22+), pnpm |
| Lint | `pnpm lint` (`biome lint ./src`) | node_modules |
| Type check | `pnpm check-types` (`tsc --noEmit`) | node_modules |
| Tests | `pnpm test` (`vitest run`). The CI terminal job also runs `pnpm exec vitest run src/modules/terminal` on Windows and macOS | node_modules |
| Build and size | `pnpm build`, then `pnpm size` (size-limit) | node_modules. The budget tests read `dist` |
| Advisory | `pnpm audit --prod --audit-level high`, `pnpm exec react-compiler-healthcheck`, `pnpm knip` | node_modules |
| Rust check | `cd src-tauri && cargo check --all-targets --locked` | stable Rust. On Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev` |
| Clippy | `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` | the `clippy` component |
| Rust tests | `cd src-tauri && cargo nextest run --locked` (local fallback: `cargo test --locked`) | `cargo-nextest`. The CI matrix adds `--retries 2` on Windows and macOS |
| Advisory | `cd src-tauri && cargo machete` | `cargo-machete` |
| Fish integration | `fish --no-config src-tauri/src/modules/pty/scripts/init.test.fish` | fish |
| Format | `cargo fmt` before pushing (CONTRIBUTING) | rustfmt |

The release sidecar must exist for release builds (`build.rs` panics if `binaries/terax-cli-<target>` is missing in release). Dev builds use `pnpm build:cli:dev` through `beforeDevCommand`.

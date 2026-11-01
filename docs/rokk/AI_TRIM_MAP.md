# Removing Terax's built-in AI agent: a map

This is a read-only survey; nothing was changed. Sizes are gzip from the build on 2026-10-31 (`pnpm build`, size-limit's gzip). Source sizes are line or file counts. "Upstream file" means a file that exists in Terax v0.9.0.

## What exists only for Terax's AI

### Frontend

| Item | Paths | Size |
|---|---|---|
| AI module: chat panel, composer, sessions, tools, sub-agents, providers, bridges | `src/modules/ai/**` (89 files, about 650 KB source) | see the chunks below |
| Chat UI kit | `src/components/ai-elements/**` (11 files, 96 KB source) | in AI chunks |
| AI mini window | `src/modules/ai/components/AiMiniWindow.tsx` | `AiMiniWindow` chunk 30.3 kB |
| "Open AI agent" button and status bar AI controls | `src/modules/ai/components/AiStatusBarControls.tsx`, `AgentStatusPill.tsx` (built-in agent log pill) | in main and AI chunks |
| Selection "Ask AI" popup | `src/modules/ai/components/SelectionAskAi.tsx` | 0.9 kB |
| AI diff tab (`ai-diff` tab kind) | `src/modules/editor/AiDiffStack.tsx`, `AiDiffStackLazy.tsx`, `AiDiffPane.tsx` | `AiDiffStack` 2.6 kB |
| Editor AI autocomplete | `src/modules/editor/lib/autocomplete/**`, AI hooks in `src/modules/editor/EditorPane.tsx` | in editor chunks (unmeasured) |
| Settings: Models and Agents tabs | `src/settings/sections/ModelsSection.tsx`, `AgentsSection.tsx`, `src/settings/components/ProviderKeyCard.tsx`, `ProviderIcon.tsx` | inside the `settings` chunk (38 kB total; the AI share is unmeasured, roughly 8 to 12 kB) |
| Lazy AI chunks | `ai-anthropic` 68.8, `ai-sdk-shared` 56.5, `ai-google` 23.0, `ai-openai` 20.9, `ai-cerebras` 18.5, `tools` 14.9, `ai-xai` 11.1, `composer` 5.0, `chatStore` 4.7, `ai-groq` 4.3, `AiComposerInput` 3.9, `chatRuntime` 2.7, `AgentRunBridge` 2.3, `agentsStore` 2.1, `AgentSwitcher` 1.9, `snippetsStore` 0.8, `AiInputBar` 0.6, `planStore` 0.4, `agent` 0.1 | **276 kB** together (with AiMiniWindow, SelectionAskAi and AiDiffStack) |
| npm dependencies used only by the AI | `@ai-sdk/anthropic`, `@ai-sdk/cerebras`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`, `@ai-sdk/xai`, `ai` (also used by editor autocomplete, which goes too) | in the chunks above |
| Shortcuts | `ai.toggle` (Mod+I), `ai.toggleMini` (Mod+Shift+I), `ai.askSelection` (Mod+J), `editor.aiComplete` (Alt+\\) in `src/modules/shortcuts/shortcuts.ts`; handlers in `src/app/App.tsx` | small |
| Command palette | "Toggle AI agent" (`ai.toggle`) and the AI group in `src/modules/command-palette/commands.ts` | small |
| Onboarding hints | `src/modules/terminal/block/BlockWatermark.tsx`: "Switch between Shell and AI", "Open the AI assistant" | small |
| Built-in agent notifications | `src/modules/ai/components/LocalAgentNotificationsBridge.tsx`; "Terax agent" rows in `src/modules/agents/components/NotificationBell.tsx` | small |
| AI delegating tasks to Claude ("managed agents") | `src/modules/ai/lib/useAiLiveBridge.ts`, `src/modules/agents/store/managedAgentsStore.ts`, `src/modules/agents/lib/review.ts` | small |

### Rust (`src-tauri`)

| Item | Paths | Size |
|---|---|---|
| AI HTTP proxy with SSRF guard | `src/modules/net.rs`, `src/modules/net/{clients,ip,stream}.rs`; commands `ai_http_stream`, `ai_http_cancel`, `ai_http_ack`, `lm_ping` | 1,961 lines |
| Chat session files | `src/modules/ai_sessions.rs`; commands `ai_session_load`, `ai_session_save`, `ai_session_delete`, `ai_session_finish_migration`, `ai_session_prune_backup` | 1,243 lines |
| Agent shell and background processes (AI tools) | `src/modules/shell/session.rs`, `background.rs`, `ringbuffer.rs`; commands `shell_session_*`, `shell_bg_*` | 511 lines |
| Keychain | `src/modules/secrets.rs`; commands `secrets_get`, `secrets_set`, `secrets_delete`, `secrets_get_all` | 364 lines |
| Crates used only by these | `reqwest`, `rustls`, `bytes`, `futures-util` (net), `keyring` (secrets) | Binary saving is smaller than it looks: `tauri-plugin-updater` brings its own HTTP stack, so `reqwest` and TLS likely stay in the binary (unmeasured) |
| Stays | `shell_run_command` (used by the editor's external formatter), `fs_grep` and `fs_glob` (command palette content search), `tokio` (PTY) | |

### Data the AI saved

- **Keychain:** service `terax-ai` (one entry per provider key). On Linux the fallback is `secrets.json` in the app's local data dir.
- **Stores:**
  - `terax-ai-sessions.json` and the `conversations/` folder in the app data dir;
  - `terax-ai-agents.json`, `terax-ai-snippets.json`, `terax-ai-todos.json`;
  - AI keys inside `terax-settings.json`: model, endpoints, Ollama and OpenAI-compatible URLs, speech-to-text provider and whisper.cpp URL.

## Sorting

**(a) Safe to remove outright** (nothing Rokk keeps imports them):

- the AI provider chunks and `@ai-sdk/*`, `ai`;
- `AiMiniWindow`, `SelectionAskAi`, the chat panel, the composer runtime, tools, sub-agents, `chatRuntime`, `planStore`, `todoStore`, `snippetsStore`, `agentsStore`;
- the Models and Agents settings sections with `ProviderKeyCard` and `ProviderIcon`;
- editor AI autocomplete;
- Rust `net`, `ai_sessions`, `shell/session.rs`, `shell/background.rs`, `ringbuffer.rs`, `secrets.rs`, and their crates.

**(b) Removable with small edits to upstream files:**

- `src/app/App.tsx`:
  - the `AiComposerProvider` root wrapper, `useAiLiveBridge`, `AgentRunBridge`, `LocalAgentNotificationsBridge`, `AiMiniWindow` and `SelectionAskAi` mounts;
  - `togglePanelAndFocus`, the AI shortcut handlers, the `openSettingsWindow("models")` calls, and the `hasComposer` and `panelOpen` props;
  - the ai-diff tab handlers.
- `src/modules/statusbar/StatusBar.tsx`: `AgentStatusPill`, `AiStatusBarControls`, `AiOpenButton`, `useChatStore`.
- `src/settings/SettingsApp.tsx` (drop two tabs) and `src/modules/settings/openSettingsWindow.ts` (`SettingsTab`).
- `src/modules/shortcuts/shortcuts.ts` and `src/modules/command-palette/commands.ts` (AI entries).
- `src/modules/source-control/useSourceControlPanel.ts` and `SourceControlPanel.tsx` (AI commit message).
- `src/modules/editor/EditorPane.tsx` (autocomplete, `endpointIdFromCompatModel`).
- `src/modules/tabs/lib/useTabs.ts`, `TabBar.tsx`, `tabLabel.ts`, `src/modules/editor/useEditorFileSync.ts`, `src/app/components/WorkspaceSurface.tsx` (`ai-diff` tab kind).
- `src/modules/terminal/block/BlockOverlay.tsx` ("Ask AI" attach) and `BlockWatermark.tsx` (hints).
- `src/modules/agents/components/NotificationBell.tsx` (Terax agent row), `src/modules/agents/lib/review.ts` and `managedAgentsStore.ts` (delegation).
- `src/app/hooks/useAppCloseGuard.ts` (flushes chat sessions on quit).
- Rust: `src-tauri/src/lib.rs` (command registrations, `.manage` states, `AiStreamState` cleanup on page load and window destroy), `src/modules/mod.rs`, `src/modules/shell/mod.rs`, `Cargo.toml`.
- Build and config: `package.json` and `pnpm-lock.yaml`, `vite.config.ts` (the `ai-sdk-shared` and provider chunk rules), `knip.json`, and the budget tests (`src/app/eager-budget.test.ts`, `feature-loading.test.tsx`).

**(c) Entangled with things Rokk keeps, and how to untangle:**

1. **`src/modules/ai/lib/native.ts`** is the app's general IPC wrapper (git, fs, workspace), used by about 20 files. That includes source control, the explorer, git history, spaces, `useGitBranch`, the Changes view (`rokk-changes/lib/changes.ts`, `recorder.ts`) and Prompt buddy (`BuddyDialog.tsx`). **Untangle:** move it to `src/lib/native.ts` and leave a one-line re-export in the old path during the transition. Its AI-only methods drop out later.
2. **`src/app/components/WorkspaceInputBar.tsx`** is also the block terminal's command input and the cwd and branch chips. It imports `AiInputBarConnect`, `useComposer`, `Chip` and `ChipsRow` from the AI module. **Untangle:** move `Chip` and `ChipsRow` to `src/components/`, then remove only the composer branch.
3. **`src/modules/settings/store.ts`** mixes AI preferences with general ones, including the agent launch commands Rokk keeps. It imports AI types and defaults from `ai/config.ts`. **Untangle:** delete only the AI keys and types. Values already saved in users' `terax-settings.json` are simply ignored.
4. **Markdown preview** (`src/modules/markdown/MarkdownPreviewPane.tsx`) uses `streamdown` (137.6 kB, the largest chunk) and `ai-elements/markdown-code.tsx`. **Untangle:** keep `streamdown` and move `markdown-code.tsx` to `src/components/markdown/`. Or, for another 137.6 kB, give the preview a lighter renderer (a separate decision; it changes rendering).
5. **`src/components/ai-elements/chat-code.tsx` and `tool.tsx`** read `chatStore`. They go with the AI; only `markdown-code.tsx` needs to move (item 4).
6. **Block terminals' "Shell and AI" switch** (`terminal.toggleInput`): AI is one side of the block input switch. **Untangle:** keep the shell side only. This is block chrome, not the terminal engine, but it is terminal UI, so it needs a careful test.

**What Rokk keeps that does not depend on the AI:**

- Agent detection (`pty/agent_detect.rs`, `terminal/lib/agentActivity.ts`), the handshake, the tab marks and status pill, the session rail, the Changes view and Prompt buddy. None of them import the AI module beyond `native.ts` (item 1).
- The Claude hooks: they stay installable from the notification bell's enable rows and the agent launcher in `App.tsx`. Only the AI delegation path's extra call to `agent_enable_hooks` goes.

## Estimated saving

- **Lazy AI chunks:** about 276 kB gzip. With the AI share of the settings chunk and the small AI code in `main`, about **285 to 300 kB of total client JS**.
- **Startup JS:** only the few kB of eager AI glue in `main` (unmeasured).
- **Markdown renderer:** replacing it would add 137.6 kB more (about 420 to 440 kB in all). That is optional, and it changes rendering.
- **Rust:** about 4,100 lines of AI-only code. The binary saving is unmeasured and smaller than the line count suggests, because of the updater's HTTP stack.

## Files touched

- **Edited:** about **30 upstream files** (category b, plus the untangling edits in c).
- **Deleted:** about **110 files**: 89 in `src/modules/ai`, 10 of 11 in `ai-elements`, 4 settings files, the editor autocomplete and AI diff files, and 6 Rust files.

## Recommended removal order

1. **Untangle first, change nothing visible:**
   - move `native.ts` to `src/lib/native.ts`, re-exported from the old path;
   - move `Chip`, `ChipsRow` and `markdown-code.tsx` out of the AI folders.

   Tests, then commit. This step makes every later step safe.
2. **Switch the AI off at build time** with a compile-time flag, like the existing `__TERAX_BENCH__`. App.tsx, StatusBar, Settings tabs, shortcuts and the palette skip the AI mounts when it is off, so no AI chunk is emitted. This already gives most of the size saving while every file stays in place, which keeps upstream merges cheap.
3. **Remove the AI UI glue:**
   - the AI branch of `WorkspaceInputBar`, the "Ask AI" and "Shell and AI" block paths, and the onboarding hints;
   - the source-control commit-message button, editor autocomplete, and the ai-diff tab kind;
   - the "Terax agent" notification row and the managed-agent delegation.
4. **Remove the Rust side:** the `net`, `ai_sessions`, agent shell and background, and `secrets` commands and states in `lib.rs`, then their crates in `Cargo.toml`. Run the clippy and nextest locking tests.
5. **Delete the files and dependencies:** `src/modules/ai`, the rest of `ai-elements`, the settings sections, `@ai-sdk/*` and `ai` in `package.json` and the lockfile, and the `vite.config.ts` chunk rules. Then update the budgets and tests.
6. **Clean up user data (optional, with consent):** offer a one-time "Remove saved AI keys and chats" action before the keychain code goes.

## Risks

- **Merge conflicts with upstream Terax:** the AI is the most actively developed part of Terax, so after deletion most upstream commits become modify and delete conflicts, and `App.tsx` conflicts grow. Step 2 (a build flag) avoids most of this, and stopping there is a reasonable end state.
- **Saved API keys:** a user who saved keys loses access to them inside Rokk. The keys are not deleted: they stay in the OS keychain under service `terax-ai`, or in `secrets.json` on Linux, invisible to Rokk. Chats stay in `terax-ai-sessions.json` and `conversations/`. Offer an export or a removal step (step 6) and say so in the release notes.
- **Block terminals:** the input bar and the "Shell and AI" switch are shared with the AI, so a careless edit can break shell input in block tabs (item 6 in c). This needs a test.
- **`native.ts` move:** about 20 import sites; a re-export avoids a big-bang change.
- **Settings store:** removing AI keys from the type must not reset the other preferences; saved files keep extra keys harmlessly.
- **Startup budget:** the startup saving is small, because most AI code is already lazy; the real gain is in the total budget.
- **Estimates:** the settings and `main` AI shares and the Rust binary saving are estimates, not measured.

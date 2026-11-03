# Rokk roadmap

Rokk is a free, open-source desktop terminal for people who build with Claude Code. It is a fork of Terax (Apache-2.0). The goal is calm and friendly: the app watches and explains, and Claude does the work.

This file lists everything we have discussed, with its status. Update it whenever something ships. Status values: Built, Partly, Planned, Parked, Dropped.

## Credit saver (flagship)

Rokk exists to help beginners and vibe coders waste fewer AI credits. These features work automatically, so nobody has to remember a command.

| Feature | Status | Notes |
| --- | --- | --- |
| Vague-prompt guard v1 | Built | Settings > Guards (see GUARDS.md). A Claude Code hook asks Claude to ask before building when a prompt is vague. Local, fails open, only in Rokk terminals. |
| Credit meter v1 | Built | Credits section in the session rail (see METER.md): tokens, estimate, context, cache share, per-prompt rows, tool counts. Read-only, local, no text. |
| Loop breaker | Planned, next | Stop and ask after repeated failures. |
| Junk-folder blocker | Planned, next | Deny rules for node_modules and build output. |
| Fresh-session nudge | Planned, next | Suggest a new session when the context is large. |
| Short-report rule | Planned | Ask Claude for short reports. |
| Weekly "what Rokk caught" summary | Planned, next | Built from the guard stats. |

## 1. Built

| Feature | Status | Notes |
| --- | --- | --- |
| Rename to Rokk (phase 1) | Built | Name, icons, logo, NOTICE, README. Internals still say terax on purpose. |
| Brand | Built | Wordmark in Cherry Bomb One (OFL), static app icon (black tile, white small square), animated mark (not looping in the app). |
| Handshake | Built | Pill with a one-time hop when Claude starts in the visible tab. Dev preview: window.rokkHandshake(). |
| Graphite surfaces and Geist UI font | Built | Window, panel and canvas layers, shared radius and gap. |
| Claude-aware tabs and status pill | Built | State marks per terminal tab, Claude spark in its own color, pill at the bottom. |
| Changes view | Built | Files changed since Claude started. No line counts yet. |
| Session rail v1 | Built | Right panel from existing signals. No tool narration yet. |
| Settings layout and window size | Built | Centered floating layout, always opens at the default size. |
| JS and TS highlighting fix | Built | Single @lezer/highlight through a pnpm override. Worth reporting upstream. |

## 2. Planned: the terminal companion

| Feature | Status | Notes |
| --- | --- | --- |
| Mascot as a real character | Planned | Our own character, not Anthropic's. Handshake animation, moods. Needs a human illustrator. |
| Semantic colored lines in the terminal | Planned | Reads, edits and runs get distinct, calm colors. The engine is Ghostty, so this needs care. |
| Session minimap | Planned | A thin overview of a long session. |
| Remembers-you greeting and session brief | Planned | A short welcome back with what happened last time. |
| Free command explainer | Planned | Plain-language explanation of any command, from a local dictionary. |
| "Ship it" | Built v1 | Type ship it and Claude runs a go or no-go checklist (Settings > Guards, see GUARDS.md). Never commits, pushes or deploys on its own. |
| Production preflight | Partly built | Secrets and loose ends are covered by "Ship it"; deploy checks are not. |
| Other magic words | Planned | For example "explain this" and "brief". |
| Rubber-duck prompt buddy | Parked: replaced by Guards; top-bar icon removed, shortcut Mod+Alt+D only | Prompt buddy (`src/modules/rokk-buddy`, see BUDDY.md) still works. Version 1 drafts prompts, reviews pasted reports and pastes safely into Claude, with no AI calls. Guards do the same job automatically. |
| Remember-when | Planned | Search past sessions by what you did, not by command. |
| The safety set | Planned | "Did it cheat?" detector, the stranger test, a keys vault, a production preflight, "what am I missing?". |
| Weekly update drafter | Planned | Turns the week's sessions into a short update. |
| Mascot packs and skins, personality packs | Planned | Open format so others can make their own. |
| Easter eggs | Planned | Small surprises. |
| Rail phase 2: tool narration | Partly | Tool counts by name are delivered by the credit meter. Step-by-step narration is still planned. |
| Changes view phase 2 | Planned | Exact attribution to Claude and line counts, using tool events. |
| Handshake polish | Planned | Richer animation and a Settings toggle. |

## 3. Planned: Stage mode, clips and sharing

| Feature | Status | Notes |
| --- | --- | --- |
| Stage mode, Phase 1 | Built | Stage view with wallpaper, frame, mark, Exit pill and picker (see STAGE.md). `Mod+Alt+S` or the top bar play button. |
| Stage mode, Phase 2 | Built, pending tests in a packaged build | Record the Rokk window to MP4 on macOS 15+ (see RECORD.md). |
| Stage mode, Phase 2: recording controller | Built, pending the manual checklist | A separate window with the timer, Stop, Discard and Restart at the bottom of the stage, not in the video (see RECORD.md). |
| Stage mode, Phases 3 and 4 | Planned | Window shapes, share panel (see STAGE_MAP.md). |
| Recording | Planned | Record button in the top bar, a floating pill and a shortcut. The user picks the capture each time: preview only, preview plus activity, whole screen, or a chosen window. Recording the preview cannot come from app code because it is a cross-origin iframe, so it needs screen capture. |
| Live preview while recording | Planned | Click through the running project while recording. Terminal hidden by default. |
| Mobile app preview | Planned | Realistic iPhone-style frame we draw ourselves. Needs a simulator or emulator window capture; macOS first. Check Apple's device image rules before using any Apple artwork. |
| Watermark | Planned | "Made with Rokk," on by default. |
| Reels and clips | Planned | Render the mascot scene locally, never include secrets. Remix templates later. |
| Sharing, version 1 | Planned | Export, copy a caption, open the upload page. |
| Sharing, version 2 | Planned | Direct post to LinkedIn and YouTube. TikTok needs an audit, X is pay per post. |
| Mascot cameos | Planned | Shareable mascot cards. |

## 4. Release blockers and cleanup

| Item | Status | Notes |
| --- | --- | --- |
| Updater | Blocker | Still points at Terax's releases. Must change or be disabled before any Rokk build ships. |
| Bundle id, keychain name, data folder | Planned | Moving them leaves users' settings and saved keys behind unless migrated. |
| Program name terax to rokk | Planned | Breaks Windows menu entries and hooks, Linux packaging and a profiling script unless migrated together. The macOS hook does not depend on it. |
| Dock label in development | Parked | Shows Terax. A packaged build uses the app bundle name. |
| Terminal font | Planned | Geist Mono with a Nerd Font fallback chain. |
| Traffic light position | Planned | Needs a window config change under src-tauri, so the app restarts. |
| Git decoration colors | Planned | The colored folder names are loud. Soften later. |
| Name and brand checks | Planned | Rokk: domains (rokk.app is taken), GitHub, npm, Homebrew, trademarks. Claude spark: review Anthropic's brand guidelines for third-party use. |
| Merging upstream Terax | Ongoing | Several upstream files are touched (App.tsx, Header.tsx, SidebarRail.tsx, shortcuts.ts, theme files). Keep edits minimal. |
| Size budget | Ongoing | Total client JS limit is 1,560,000 bytes (last raise until Terax's AI agent is trimmed). Startup budget must not move. Rokk features load lazily. |
| Terax's own AI agent | Parked | About 263 kB gzip of lazy chunks Rokk does not need. Remove later, carefully. |
| Contact the Terax author | Planned | After a short demo. The highlighting bug fix is a good opening. |

## 5. Dropped and parked

- Dropped: slash commands for credit saving, because nobody remembers to type them.
- Dropped: quests, and "visit a friend" (needs a relay server and risks leaking secrets).
- Parked: a verification platform for Free Agent athletes, a Skool-like community idea.

## 6. Principles

- Calm and friendly, for beginners and vibe coders. Claude is the agent; Rokk watches and explains.
- New features live in new folders and new Rust modules. Existing upstream files change as little as possible.
- No secrets in clips or shares. No promises the product does not keep.
- Credit Terax. Keep the Apache-2.0 license and notices.

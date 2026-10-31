# Rokk roadmap

Rokk is a free, open-source desktop terminal for people who build with Claude Code. It is a fork of Terax (Apache-2.0). The goal is calm and friendly: the app watches and explains, and Claude does the work.

This file lists everything we have discussed, with its status. Update it whenever something ships. Status values: Built, Partly, Planned, Parked, Dropped.

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
| Magic words, starting with "ship it" | Planned | Go or no-go preflight, push or deploy, a launch moment, a clip, a diary entry. |
| Rubber-duck prompt buddy | Built, version 1: templates only | Prompt buddy (`src/modules/rokk-buddy`, see BUDDY.md): drafts prompts with house rules, reviews a pasted report by pattern matching, drafts a follow-up, pastes safely into Claude. No AI calls yet. |
| Remember-when | Planned | Search past sessions by what you did, not by command. |
| The safety set | Planned | "Did it cheat?" detector, the stranger test, a keys vault, a production preflight, "what am I missing?". |
| Weekly update drafter | Planned | Turns the week's sessions into a short update. |
| Mascot packs and skins, personality packs | Planned | Open format so others can make their own. |
| Easter eggs | Planned | Small surprises. |
| Rail phase 2: tool narration | Planned | Needs a read-only Rust reader for ~/.claude/projects or an extension of the hooks. Claude's session files are undocumented. |
| Changes view phase 2 | Planned | Exact attribution to Claude and line counts, using tool events. |
| Handshake polish | Planned | Richer animation and a Settings toggle. |

## 3. Planned: Stage mode, clips and sharing

| Feature | Status | Notes |
| --- | --- | --- |
| Stage mode | Planned | Original wallpapers (Dune, Tide, Night market, Moss, Paper, Orbit), your work centered, scalable by drag handles and Small, Medium and Fill presets, portrait and landscape. Boards exist on the design canvas. |
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
| Size budget | Ongoing | Total client JS limit is 1,530,000 bytes. Startup budget must not move. Rokk features load lazily. |
| Terax's own AI agent | Parked | About 263 kB gzip of lazy chunks Rokk does not need. Remove later, carefully. |
| Contact the Terax author | Planned | After a short demo. The highlighting bug fix is a good opening. |

## 5. Dropped and parked

- Dropped: quests, and "visit a friend" (needs a relay server and risks leaking secrets).
- Parked: a verification platform for Free Agent athletes, a Skool-like community idea.

## 6. Principles

- Calm and friendly, for beginners and vibe coders. Claude is the agent; Rokk watches and explains.
- New features live in new folders and new Rust modules. Existing upstream files change as little as possible.
- No secrets in clips or shares. No promises the product does not keep.
- Credit Terax. Keep the Apache-2.0 license and notices.

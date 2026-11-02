# Credit meter (version 1)

The **Credits** section in the session rail shows where the tokens went in the active tab's Claude session. It reports what was used, never what was "saved". Tokens and context size are the main numbers, because people use every kind of plan; dollars are a clearly labeled estimate at list price.

## What it shows

- **Tokens used** in this session, with a breakdown: input, output and cache (reads plus writes).
- **Estimate** (the Tokens | Estimate switch): an API-equivalent dollar amount, labeled "Estimate from list prices". Models without a list price get no estimate, and the section says so.
- **Context now:** the tokens in the latest main-thread response (input + cache read + cache write). "Of 1M" and a percent appear only for models whose context window was verified (below). Above 70 percent the bar tints and the text says "Large".
- **From cache:** the share of input tokens served from the cache.
- **This session by prompt:** the last 10 prompts as "Prompt 7, 12:04, 38k tokens, 5 tool calls", newest first, with a bar scaled to the largest. Never any prompt text.
- **Activity:** tool calls by name, for example "6 reads, 3 edits, 2 commands".
- **Cache line:** "Last reply 7 min ago. The cache may have expired, so the next message can cost more." Shown only when the cache lifetime was read from the session file and the last reply is older than it.

It does not show subscription limits (not in the session files), other agents (Codex, Gemini), or any text.

## Privacy

- **Read-only:** the reader (`src-tauri/src/modules/rokk_meter/`) only reads regular `*.jsonl` files inside `~/.claude/projects`. Symlinks are resolved and refused if they leave that folder, and paths with `..`, other file types and folders are refused. Tests cover each case.
- **Nothing kept as text:** message content is skipped while parsing. The reader returns only numbers, timestamps, session and message ids, model names and tool names; a test checks that these are the only string fields in a snapshot. Model and tool names are checked against a safe character set.
- **Nothing written or sent:** what it reads is never written to disk, logged or sent anywhere. In memory it keeps counts per response (by message id) for up to 8 sessions, and the file bytes of the current read only.
- **Investigation:** the format was studied with a script that printed field names, numbers, model names and tool names only.

## Session file format (verified 2026-11-01, Claude Code 2.1.316)

- **Location:** `~/.claude/projects/<folder>/<session-id>.jsonl`. The folder is the working directory with every character that is not an ASCII letter or digit replaced by `-` (`/Users/me/My portfolio` becomes `-Users-me-My-portfolio`). Matched case-insensitively, as macOS folders are.
- **Sub-agents** write `<folder>/<session-id>/subagents/*.jsonl`, with `isSidechain: true` and their own usage. Their tokens count in the totals, the per-prompt rows (by time) and the activity, but not in the context size.
- **Usage:** `assistant` lines have `message.usage` with `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and a `cache_creation` split into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Also used: `message.model`, `message.id`, `timestamp`, `usage.speed` and `usage.inference_geo`. A `<synthetic>` model marks internal messages and is skipped.
- **De-duplication:** one response is written as one line per content block (2 or 3 lines). Usually the usage repeats exactly; in 53 of about 3,300 responses the earlier lines held a partial `output_tokens`. Rule: one response per `message.id` (always present; `requestId` was missing on some lines), keeping the largest value of each field.
- **Prompts:** a `user` line whose content is text, or blocks without `tool_result`, that is not `isMeta`, not `isCompactSummary`, not a sidechain, and was typed by a person (`promptSource` "typed" and `origin.kind` "human" when present). Tool results are `user` lines with `tool_result` blocks. Task notifications and auto-continuations do not count as prompts, but their usage counts.
- **Compaction:** a `system` line with `subtype` "compact_boundary", then a `user` line with `isCompactSummary`. The next response's usage shows the smaller context. `/clear` starts a new session file.
- **Cache lifetime:** every request in the sampled files asked for a 1-hour cache (`ttl: "1h"`), and usage showed 1-hour writes. Claude Code's docs say the lifetime can differ per request, so the meter takes it from the latest cache write in the session (1h or 5m) and hides the cache line when none was seen.
- **Context windows:** 1M tokens for `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` per Anthropic's models overview; requests carry the `context-1m-2025-08-07` beta. Other models show no "of".
- **Active session:** the guard hook sees `session_id` and `transcript_path`, but the app does not store them. Version 1 finds the session as the newest file in the project folder modified at or after the pane's "started" signal (minus 5 seconds). When another session in that folder was also modified within the same minute, the section says "Several Claude sessions are active in this folder; showing the newest."

## Prices

`src-tauri/src/modules/rokk_meter/prices.json` is the only place prices live. Source: https://platform.claude.com/docs/en/about-claude/pricing, fetched 2026-11-01; context windows from https://platform.claude.com/docs/en/about-claude/models/overview.

- Per million tokens: input, 5-minute cache write, 1-hour cache write, cache read, output. Claude Haiku 5.5 uses its higher prices for prompts over 100,000 tokens.
- US-only inference (`inference_geo: "us"`) is multiplied by 1.1. Fast mode responses are not estimated.
- **Prices change. Refresh the table before each release.**

## Reading and polling

- `meter_find_session(project_dir, since_ms)` returns a session id, a modified time and the ambiguous flag; never a path.
- `meter_read(session_id, project_dir, offset)` reads from the byte offset to the end, at most 5 MB per call across the session and its sub-agent files. A partial last line is left for the next call; a file shorter than the offset was truncated and is read again from 0; a line longer than 5 MB is skipped. Malformed lines are counted and skipped. Files over 200 MB are refused.
- The section reads once when shown, then every 2 seconds only while the rail is open and the tab's Claude is working, and once more 2 seconds after it finishes. Background tabs are never read. Each new prompt also checks whether a newer session file appeared (for example after `/clear`).
- When a prompt finishes, a polite live region says "Prompt 7 used 38k tokens". Polling ticks are never announced. The bars are decorative and nothing animates.

## Known limits

- Two Claude sessions in the same folder at once: the newest is shown, with a note.
- A changed or unknown file format shows "Rokk could not read Claude's session files. Usage is not shown." instead of wrong numbers; lines that do not parse are skipped.
- Long working folders: Claude Code may shorten very long folder names; those projects are not found.
- Per-prompt rows depend on timestamps; sub-agent usage is attributed by time.

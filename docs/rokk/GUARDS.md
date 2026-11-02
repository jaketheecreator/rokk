# Guards

Guards are automatic helpers that watch every prompt sent to Claude Code in a Rokk terminal. They run on this Mac and cost no credits themselves. Turn them on in Settings > Guards.

Version 1 has one guard: **Clarify vague prompts**.

## What it does

A vague prompt ("fix it", "make it nicer") makes Claude guess, and a wrong guess costs a redo. When a prompt looks vague, the guard adds one note to Claude's context asking it to ask at most two short questions and state its plan before editing anything. When a prompt is specific, the guard prints nothing and costs nothing.

The note Claude sees (`additionalContext`), exactly:

> Rokk guard: the user's request may be underspecified. Before editing files or running commands, ask at most two short, concrete questions about what is missing (what is wrong or wanted, where, and how the user will know it is done), unless the answer is obvious from the code. Then state your plan in at most 3 lines and wait for the user's reply. If the request is already clear, ignore this note and proceed.

The line the person sees (`systemMessage`), exactly:

> Rokk: this prompt looked vague, so Claude was asked to clarify first.

It never fires twice within 3 prompts of the same Claude session.

## How a prompt is judged

The detector is `src-tauri/src/modules/rokk_guard/score.rs`, a pure function with table tests.

**Skipped** (never fires) when the prompt:
- is empty;
- starts with `/` (slash command), `!` (shell mode) or `#` (memory);
- is an answer or acknowledgement ("yes", "go ahead", "2", "option b", "the first one");
- contains a code block, pasted text, a log or a stack trace;
- is longer than 400 characters;
- is not mostly ASCII letters (other languages are not judged).

**Specificity signals** (each kind counts once): a file name or path, a code name (backticks, camelCase, snake_case), a URL, error text or an error code, a number with a unit or a quantity, a quoted string, and a stated outcome ("should", "so that", "instead of", "expected", "when ... then", "I want it to").

**Vague** when there are no signals and fewer than 25 words, or when a vague phrase from the table is present with at most one signal and fewer than 40 words. **Medium** sensitivity also fires with at most one signal and fewer than 15 words.

## Exactly what it writes

Turning the guard on (after a one-time consent dialog) writes:

| File | What |
|---|---|
| `~/.claude/settings.json` | One entry added under `hooks.UserPromptSubmit` (below). Nothing else in the file changes: it is a text splice, re-checked by parsing before it is written. |
| `~/.claude/settings.json.rokk-backup` | A copy of settings.json made before the first change. Never overwritten. Kept by "Remove everything". |
| `~/.rokk/hooks/prompt-guard` | The wrapper script (mode 0755). |
| `~/.rokk/app-path` | The path to the Rokk program. Refreshed at every app start when it exists, so a moved or reinstalled app never leaves a broken hook. |
| `~/.rokk/guard-config.json` | On or off, consent given, sensitivity. |
| `~/.rokk/guard-state.json` | Per session id: prompt count, last fire, last seen. Pruned after 7 days. |
| `~/.rokk/guard-stats.json` | Per day: prompts checked, fired, skipped; the last fire time. Kept 60 days. |

The hook entry:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "[ -n \"$ROKK_TERMINAL\" ] && [ -x \"$HOME/.rokk/hooks/prompt-guard\" ] && \"$HOME/.rokk/hooks/prompt-guard\"; true",
      "timeout": 2
    }
  ]
}
```

Our entry is recognized only by the substring `/.rokk/hooks/prompt-guard`. Terax's own hook installer recognizes its entries by other markers, so neither removes the other's. If settings.json is invalid JSON, nothing is written and the page shows the error. If settings.json or `~/.claude` is a symlink, the guard refuses to write and asks you to edit it by hand. All writes go to a temp file that is then renamed into place, and the guard can write only to the settings files above and under `~/.rokk`; tests reject anything else, including symlinks and `..`.

Every write goes through a temp file in the same folder: `settings.json.rokk-tmp` for anything in `~/.claude` (settings.json and its backup), and `<name>.rokk-tmp` under `~/.rokk`.

If the guard refuses or fails, the Guards card shows the reason in plain language, naming the check and the file, for example "Claude's settings file (~/.claude/settings.json) is a symlink to ..., so Rokk will not change it". Copy details copies that message and the guard's on, installed and files flags; never any file contents or prompt text.

"Turn off" removes only the hook entry and keeps the files. "Remove everything" removes the hook entry and every file under `~/.rokk` listed above.

## Privacy

The prompt is read in memory, scored, and dropped. It is never logged, stored or sent anywhere, and the guard makes no network calls. The state and stats files hold only counts, times and Claude's session ids; a test asserts that prompt text cannot reach them. The "Test a prompt" box saves and logs nothing.

## Fail-open rule

The guard can never block or slow a prompt:

- it runs only when `ROKK_TERMINAL` is set, that is, only in terminals opened by Rokk (checked by the hook command, the wrapper and the program);
- a missing wrapper, missing app path, missing program, unreadable input, parse error or any other problem prints nothing and exits 0;
- the program exits by itself after 150 ms, and the hook entry has a 2 second timeout; on a timeout Claude Code drops the output and the prompt goes through;
- it never exits with code 2 and never sets `decision: "block"`.

## Its own terminal variable

Rokk sets `ROKK_TERMINAL=1` in every terminal shell it spawns (`src-tauri/src/modules/pty/shell_init.rs`, next to `TERAX_TERMINAL=1`, which stays because agent detection and the handshake depend on it). The guard checks `ROKK_TERMINAL` because the original Terax also sets `TERAX_TERMINAL`: gated on that, the guard would fire inside Terax too.

Version 1 of the guard was gated on `TERAX_TERMINAL`. Its entry carries the same marker, so turning the guard on again or pressing Repair replaces it with exactly one current entry; it is never duplicated. Until then, Settings > Guards shows Repair with "Rokk updated how the guard recognizes its own terminals." At start, Rokk also refreshes the wrapper script (now version 2, gated on `ROKK_TERMINAL`).

Terminal tabs opened before this change do not have `ROKK_TERMINAL`, so the guard stays silent in them. Reopen those tabs (or open new ones) after updating.

## Remove it by hand

1. Open `~/.claude/settings.json` and delete the group under `hooks.UserPromptSubmit` whose command contains `/.rokk/hooks/prompt-guard`. If the backup is all you need, you can copy `~/.claude/settings.json.rokk-backup` back instead (it also undoes later edits).
2. Delete the folder `~/.rokk`.

## Verification (2026-11-01, Claude Code 2.1.316)

Checked against Anthropic's hooks reference (code.claude.com/docs/en/hooks):

- **UserPromptSubmit input:** the hook gets `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` and `prompt` on stdin. A collapsed paste arrives expanded inside `<pasted_content ...>` lines; the guard skips those prompts.
- **Output:** on exit 0, JSON `hookSpecificOutput.additionalContext` (with `hookEventName: "UserPromptSubmit"`) is added to Claude's context next to the prompt. `systemMessage` is shown to the user. Plain stdout would also become context, so the guard prints valid JSON or nothing.
- **Exit codes:** 2 blocks the prompt. Any other non-zero code is a non-blocking error.
- **Timeout:** the default for command hooks on this event is 30 seconds. A timed-out hook's output is discarded and the prompt still reaches Claude.
- **Mid-session changes:** the reference says direct edits to hooks in settings files "are normally picked up automatically by the file watcher". This has not been tested here, so the page still says to start a new Claude session after turning the guard on.
- **Existing Terax hooks:** they are gated with `[ -n "$TERAX_TERMINAL" ] && ...` on macOS and Linux, and call `<app> __terax_notify` on Windows. The guard follows the same pattern with `__rokk_prompt_guard`, on macOS and Linux only.

## Limits

- Windows is not supported yet (see TODO).
- Speed: start-up time of the Rokk program on each prompt is not yet measured on a cold disk.
- Stats days are counted in UTC.
- If our entry was the only `UserPromptSubmit` hook, removing it also removes the empty `UserPromptSubmit` key, and `hooks` if that becomes empty.

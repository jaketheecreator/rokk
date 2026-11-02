# Prompt buddy (version 1)

A floating dialog that helps a beginner write good prompts for Claude Code and sanity-check Claude's reports. Version 1 is templates and pattern matching only: no AI calls, no network, nothing leaves the Mac.

**Parked:** Guards (see GUARDS.md) now do this job automatically. The top bar button was removed, so the dialog is reachable only by the shortcut `Mod+Alt+D` (`buddy.toggle`, AI group, rebindable in Settings > Shortcuts). The module and its tests stay. Esc closes it. Focus is trapped while open and moves to the terminal after "Paste into Claude" (see TODO for focus on a plain close).

## The three tabs

- **Draft:**
  - **Fields:** "What should Claude do?" (required, at most 4,000 characters, with a live count), the type of task (Build, Fix, Explore (read only), Review (read only)), "Don't touch", which checks Claude should run (type check, lint and tests by default) and the report length.
  - **Output:** `lib/draft.ts` builds a deterministic, editable prompt with sections GOAL, BEFORE YOU START, RULES, CHECKS and REPORT. It names the convention docs that exist in the repo root (CLAUDE.md, AGENTS.md, DESIGN_SYSTEM.md, CONTRIBUTING.md) and the package manager from the lockfile.
  - **Buttons:** Copy, Paste into Claude, Save to recent. Recent keeps the last 10.
- **Review:** paste a report and press Analyze (or `Mod+Enter`). `lib/review.ts` matches transparent, case-insensitive pattern tables and returns:
  - a verdict ("Looks complete", "Check a few things", "Not finished");
  - what Claude was unsure about (lines under Unsure, Risks, Caveats and similar headings, plus hedge sentences; at most 8, quoted);
  - which checks were run and whether they passed, failed or were not run;
  - files it mentioned versus the Changes view's changed files, when a baseline exists;
  - three to six things to check yourself;
  - a follow-up prompt that asks Claude to verify each flagged item, with the same house rules.
- **Rules:** the house rules as switches, all on by default:
  - light task and load rule;
  - leave the dev server alone;
  - use the project's package manager (named from the lockfile);
  - no git;
  - no AI attribution;
  - no em dashes;
  - smallest change;
  - say when unsure;
  - inventory first.

  Below them are an "Extra rules" field, Reset to defaults, and "Clear saved text".

## Pasting safely

"Paste into Claude" is enabled only when the active tab is a terminal, its agent is `claude`, and the pane is idle, just started, waiting for you, or finished; never while it works (`lib/insert.ts`, tested as a full table). Otherwise the button is disabled with a visible reason. The text is written as one bracketed paste (`ESC[200~ ... ESC[201~`, using the terminal's own encoder, which also neutralizes escape bytes inside the text), so no Enter or newline is ever sent outside the paste. Then the dialog closes and the terminal gets focus.

"Just started" comes from the session rail's signal log (the last signal is `started`). The activity store alone reports a started Claude as working.

## Storage and privacy

All processing is local and synchronous, and no text is logged. Saved in localStorage, each read and write in try/catch:

| Key | Holds |
|---|---|
| `rokk.buddy.rules` | the house rule switches and extra rules |
| `rokk.buddy.recent` | the last 10 saved prompts |
| `rokk.buddy.draft` | the last Draft fields |

Pasted reports are never stored. "Clear saved text" removes all three keys.

## Limits

- **No direct access to Claude:** it cannot read Claude's report by itself; you paste it in. Reading it directly needs the session-file reader from Rail phase 2.
- **Pattern matching only:** the analysis can miss hedges phrased differently, and can flag harmless uses of words like "might".
- **Pass and fail detection:** it is per sentence, so a report that mixes "3 failed" and "passed when rerun" may read as failed.
- **File comparison:** it matches by path or file name, and only when the Changes view has a baseline.
- **Early pastes:** after Claude's first prompt, the rail may still see the last signal as `started` while Claude is working (the detector sends no new signal), so a paste can land in Claude's input box while it works. No Enter is sent, so it never submits.

# Session rail (version 1)

A right-hand panel that shows the active tab's agent session, built only from signals the app already receives. It invents nothing: there is no tool narration ("Read 6 files") in this version, because the app has no data for it.

## Open and close

- **Toggle button** in the top bar, left of the search pill (right-panel icon, `aria-label="Session panel"`, `aria-pressed`).
- **Shortcut:** `Mod+Alt+B` (`rail.toggle`, View group), registered through the existing shortcut system, so it can be rebound in Settings > Shortcuts. It works while a terminal is focused; plain `Mod+B` stays with the shell and Claude Code.
- Closed by default. The open state persists in `localStorage["rokk.rail"]` (`"1"` or `"0"`), the width in `localStorage["rokk.rail.width"]` (288px by default, resizable from 240px to 360px).

## Data sources

| Section | Data |
|---|---|
| Header chip and agent line | The agent activity store (`useAgentActivityStore`: current phase and agent name per pty) for the active tab. The duration comes from the rail's own signal log. |
| "Claude is waiting for you" | Shown while the active tab's state is attention; the time comes from the last attention signal. |
| Timeline | `src/modules/rokk-rail/lib/timeline.ts`. It records every `terax:agent-signal` through `subscribeAgentSignals`: the last 20 events per pane, at most 32 panes, and logs of closed panes are dropped. `rules.ts` turns them into entries: "Claude started" (clock time), "Working" (duration), "Needed you" (clock time), "Finished" (total), "Exited". |
| Tabs | Every terminal tab's state from the activity store, sorted Needs you, Working, Finished, Idle. Clicking or Enter focuses the tab. |
| Changed so far | The Changes view's baseline data (`rokk-changes/lib/recorder.ts`, no new git calls): count and up to 5 file names. "See all" opens the Changes view in the left panel. Hidden when there is no baseline. |

## Accessibility and motion

- The panel is `<aside aria-label="Session">`.
- A polite live region announces state changes only. Ticking durations are `aria-hidden`.
- The current timeline entry has hidden "(current)" text, and every state also has a text label.
- Nothing loops. The duration ticks once a second only while working.

## Limits

- **History:** a pane's timeline starts when the app first sees a signal for it, so runs from before the app started are unknown. A new "started" begins a fresh run.
- **Durations:** they come from signal times. "Working" also covers the time between a run starting and its first finish or attention, because the store reports `started` as working.
- **No tool steps:** see Rail phase 2 in `docs/rokk/TODO.md`.
- **Open and close:** the panel appears and disappears without a width transition.

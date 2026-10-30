# Rokk handshake

A short greeting that appears when Claude Code starts in a terminal tab. A small pill fades in at the top right of that tab's terminal area. The Rokk mark plays a one-time hop, the caption reads "Claude started", and the pill fades out after about 2.6 seconds.

## How it works

- **Module:** `src/modules/rokk-handshake/`. `index.tsx` is the lazy entry, `HandshakeOverlay.tsx` is the component, `rules.ts` holds the pure decisions and `rules.test.ts` tests them.
- **Mount:** `src/app/App.tsx` loads it with `React.lazy` and mounts it in one `<Suspense fallback={null}>` line next to the `Toaster`. It is not part of the startup bundle.
- **Signal:** it subscribes through `subscribeAgentSignals` (`src/modules/terminal/lib/agentActivity.ts`). That shares the app's single `terax:agent-signal` listener, so no new IPC subscription is added.
- **Payload:** the event carries `{ id, kind, agent? }`. `id` is the pty id. `kind` is one of `started`, `working`, `attention`, `finished`, `exited`. `agent` is present only on `started`. It is normalized by `src-tauri/src/modules/pty/agent_detect.rs` (`match_agent`), so `claude`, `/usr/bin/claude` and `npx claude` all report `claude`.
- **Tab lookup:** the pty id maps to a pane with `leafIdForPty`, then to its tab with `tabIdForLeaf` (`rules.ts`).
- **Placement:** the pill is portaled into that tab's `[data-terminal-tab="<id>"]` layer (`src/modules/terminal/TerminalStack.tsx`). The terminal engine is not touched.
- **Never in the way:** the pill is `pointer-events-none`, so it never blocks typing or clicks. Dialogs and menus portal to `body` at a higher z-index, so they always cover it.

## Rules (`rules.ts`)

- Greet only when the signal is `started` and the agent is `claude`. Other agents and other states are ignored.
- Greet only when the tab is the visible tab.
- At most one greeting per tab every 30 seconds. A skipped signal does not start the cooldown.
- Disabled when `localStorage["rokk.handshake"]` is `"off"`. It is on by default, and any other value leaves it on.

To turn it off from the devtools console: `localStorage.setItem("rokk.handshake", "off")`. To turn it back on: `localStorage.removeItem("rokk.handshake")`. There is no Settings toggle yet (see `docs/rokk/TODO.md`).

## Motion

- The hop is derived from `docs/rokk/brand/rokk-mark-animated.svg`. Its first hop (3.2% to 22% of the 4.8 s loop: wind-up, jump, landing squash and settle, with the body thump) is played twice on a 2.6 s timeline. The second play reverses the translate, so the piece hops bottom-left to top-right and back. The timing functions are the source's own.
- The timeline is fade and scale in (0 to 0.3 s), hop out (0.3 to 1.2 s), hop back (1.2 to 2.1 s), hold, then fade out (2.3 to 2.6 s).
- Every animation runs once (`both` fill, no `infinite`), as `src/styles/motionBudget.test.ts` requires. Class names use the `rk-hs-` prefix.
- With `prefers-reduced-motion: reduce`, the mark stays still and the pill only fades in and out.
- The pill unmounts on its own `animationend`. A timer removes it if that never fires, for example while the window is inactive and animations are paused.

## Accessibility

The pill is `role="status"` with `aria-live="polite"`, so screen readers announce "Claude started". The mark is `aria-hidden`.

## Dev preview

In development builds only, `window.rokkHandshake()` plays the greeting on the active tab, bypassing the rules, so you can iterate on the look without starting Claude. It is guarded by `import.meta.env.DEV` and is not in production builds (verified in `dist/`).

## Known gaps

- **"started" needs a signal from the shell or the hooks.** It comes from shell integration (the `OSC 133;C` preexec mark) or from the Claude hooks Terax installs. Shells without integration, and bash before 4.4, can miss it. So can tmux, SSH sessions and other nested terminals that drop or do not forward the marks.
- **Hook-only start is late.** Without preexec, the Claude hooks arm the detector only on the first `UserPromptSubmit`. The greeting then appears at the first prompt, not at launch.
- **Startup race.** A signal that arrives before the lazy module has loaded is not greeted. This only matters in the first moment after the app starts.
- **Detector arms once per run.** A `claude` started while another agent already owns the pane is not re-announced until that agent exits.

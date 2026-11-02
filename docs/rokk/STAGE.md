# Stage mode (Phase 1)

A presentation view of the Rokk window. The current tab (a terminal, or the live preview) is shown in a centered rounded frame over a wallpaper, with a small "Made with Rokk" mark. Nothing is recorded in this phase.

## Entering and leaving

- **Shortcut:** `Mod+Alt+S` (Cmd+Option+S on macOS, `stage.toggle`, View group, rebindable in Settings > Shortcuts). It works with a terminal focused, like `Mod+Alt+B` for the session panel.
- **Top bar button:** a play triangle next to the session panel button, left of the search pill. It has `aria-label` "Stage mode", `aria-pressed`, and the tooltip "Stage mode (Cmd+Option+S)" with the platform's real keys.
- **One toggle path:** the button calls `toggleStage("mouse")` and the shortcut calls `toggleStage("keyboard")`, both in `src/modules/rokk-stage/lib/stage.ts`.
- **Leaving:** the "Exit stage" pill at the top left, or the shortcut. Escape does not leave, because the terminal and Claude Code use it.
- **Focus:** after leaving, focus returns to the top bar button if stage mode was entered with the mouse, or to what had focus before (the terminal) if it was entered with the keyboard.
- **Automatic exit:** stage mode turns off when the last terminal tab closes, or when zen mode (`Mod+Shift+'`) is toggled. The zen rule avoids two view modes fighting over the header.
- **Never persisted:** stage mode is always off at launch. Only the wallpaper choice is saved, in `localStorage["rokk.stage.wallpaper"]`.

## What changes on screen

While `html[data-rokk-stage="on"]` is set (`src/modules/rokk-stage/stage.css`):

- **Hidden:** the header with the tab bar (`[data-rokk-zone="header"]`) and the status bar (`[data-rokk-zone="statusbar"]`) are removed with `display: none`.
- **Kept in place:** the left panel (`#sidebar`, including its icon rail), the session rail (`#rokk-rail`) and their resize handles get `visibility: hidden`. They keep their size, so nothing saves a collapsed sidebar or a zero rail width, and leaving restores the layout exactly. The rail's open state, the left panel and the active tab are never changed.
- **The frame:** the workspace content (`#workspace > div`) is fixed in the center, `min(1000px, 82vw)` by `min(620px, 100vh - 160px)`, with a 16px radius, the canvas color, a hairline in `--rk-edge` and the shadow `0 30px 70px rgba(0,0,0,0.28)`. **This is the only shadow in the app**, allowed because the frame sits over a wallpaper.
- **Terminal size:** the terminal refits by itself: its surface watches the pane size, and the shared terminal canvas moves with the frame. One window resize event 50 ms after entering and after leaving covers the move.
- **The mark:** "Made with" in Geist 13px and the Cherry Bomb One wordmark (`RokkWordmark`), 28px from the bottom right. Light text, except dark text on Silk.
- **Controls:** the Exit pill and a wallpaper picker at the bottom center (six radio thumbnails with names in labels and tooltips). They hide after 2.5 seconds without mouse movement, unless the pointer is over them or keyboard focus is inside. Any movement or Tab shows them again; with reduced motion they appear and disappear instantly.
- **Accessibility:** the controls are a region labelled "Stage controls". A hidden live region says "Stage mode on" and "Stage mode off".

## Wallpapers

Six files in `public/stage/`: `horizon.webp`, `embers.webp`, `silk.webp`, `lagoon.webp`, `dusk.webp`, `mist.webp`. They are served as files and do not count toward the JS budget.

To replace one, overwrite the file with the same name. Each wallpaper also has a solid fallback color in `lib/stage.ts`, shown while it loads or when the file is missing; the picker then shows plain color swatches. To change the mark's text color for a wallpaper, change its `ink` there.

## Safety

The first time stage mode is entered after each launch, a toast says: "Stage mode shows your terminal. Check it for secrets before you share your screen."

## Known limits

- The native macOS traffic lights stay visible; hiding them needs Rust (Phase 3). The Exit pill sits to their right.
- No recording yet (Phase 2), and no window shapes yet (Phase 3).
- At an app zoom other than 100 percent, the frame's viewport units are scaled by the zoom.

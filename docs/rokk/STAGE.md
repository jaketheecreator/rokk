# Stage mode (Phase 1)

Recording (Phase 2) adds a Record button to the bottom pill and `Mod+Alt+R`; see RECORD.md. While recording, a separate controller window at the bottom center of the stage shows the timer, Stop, Discard and Restart; it is not part of the video. When a recording ends, the controls come back with a result card above the bottom pill. Leaving stage mode always clears the recording attribute.

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

## Show: Terminal or Preview

The bottom pill starts with a two-segment switch, "Terminal | Preview", left of the wallpaper picker. It chooses what the frame shows, and is always derived from the real active tab, so changing tabs another way updates it. An editor or other tab shows neither segment as pressed.

- **Terminal:** activates the most recently active terminal tab in this space. Recency is tracked while stage mode is on; before that, the last terminal tab is used.
- **Preview:** activates the most recently used preview tab. If there is none, the "Address" popover asks for one (since 2026-11-05).
  - **The box:** one input labeled "Address" (placeholder "3000 or https://yoursite.com", URL keyboard, no autocapitalize, spellcheck or autocomplete) and the helper "A port opens localhost. Or paste a full address."
  - **Port chips:** 3000, 5173, 8080, 4321 and 8000 fill the box with `localhost:PORT` and focus it; they do not submit.
  - **Recent:** up to 5 recent addresses (shown as host, port and the first path segment, with the full URL as the title) and a "Clear" button.
  - **Buttons:** Cancel, and "Show it" (or Enter).
  - **Accepted forms** (`show/address.ts`, `parseAddress`):
    - a port from 1 to 65535 becomes `http://localhost:PORT`;
    - `localhost`, `127.0.0.1`, `[::1]` and `0.0.0.0`, with an optional port and path, get `http://`;
    - a hostname with a dot gets `https://`;
    - `http://` and `https://` in any case are kept.
    - The result is the URL constructor's normalized address.
  - **Refused:** empty input, more than 2048 characters, ports out of range or with leading zeros, every other scheme (javascript, data, file, about, blob, ftp, mailto and so on), addresses with a username or password, and anything that does not look like an address. Each refusal shows a plain error line (`role="alert"`).
  - **Local or website:** only the four loopback names count as local; LAN addresses count as websites.
  - **Remembered:** the normalized URLs (nothing else) in `localStorage["rokk.stage.recent"]`, most recent first, up to 5. The box starts with the last one, else the old `rokk.stage.port` value as `localhost:PORT`, which is still read but no longer written.
  - **"Show it":** opens the preview with the app's own `openPreviewTab`, or reuses a preview tab already on that address, then announces "Preview: <address>".
  - Cancel leaves the switch on Terminal.
  - There is no detection of running servers (Rokk has none; see TODO.md).
- **While Preview is selected:** a "Change address" button reopens the popover, a Reload button reloads the preview through its existing handle, and a "Blank?" button shows the hint.
- **The frame:** the preview is the normal preview pane, an iframe, fully interactive. In stage mode the pane's address bar and notices are hidden (`[data-rokk-preview]` in `stage.css`), so the frame shows only the page.
- **Leaving stage mode:** Rokk goes back to the tab that was active on entry, but only when the active tab is still the one the switch chose. If you chose another tab some other way (a shortcut, a tab menu), that tab stays. A preview tab created here stays open as a normal tab.

### A blank frame

Rokk does not probe ports. A blank frame or an error page usually means nothing is listening on that port, or the page refuses to be embedded in another app (for example through `X-Frame-Options` or a frame-ancestors policy).

A hint in the control layer, outside the frame, says so for 8 seconds after a preview is chosen, and again on "Blank?": "If the preview is blank, check that your server is running on localhost:PORT. Some servers block embedding in other apps." The control layer is hidden while recording, so the hint is never recorded; it also never shows while recording or while a popover is open.

For a website, the hint says instead: "Many sites (Google, GitHub and most banks) refuse to be shown inside another app. If the frame is blank, try your own site or a localhost address."

- **Why some sites stay blank:** Rokk's own settings allow https frames (`frame-src 'self' http: https:` in the app's CSP), and the preview iframe's sandbox allows scripts, same-origin, forms and popups. A site that sends `X-Frame-Options` or a `frame-ancestors` policy still refuses to be shown, and Rokk cannot change that.

## Control bar

One glass pill at the bottom center, 52px tall, with nothing wrapping:

- **Show:** "Terminal | Preview". With Preview selected, Change address, Reload and "Blank?" follow.
- **Wallpaper:** one button with the current wallpaper and a chevron. It opens a popover with a 3 by 2 grid of the six wallpapers, a radio group with arrow keys. Choosing one closes it and says "Wallpaper: <name>".
- **Record:** the light pill at the right end.

Popovers:

- Only one is open at a time, the Address popover included.
- They sit 10px above the pill and stay 16px inside the window.
- Focus moves in when one opens and back to its button when it closes.
- Escape closes only the popover (never stage mode), and so does a click outside.
- While one is open the controls stay up; the auto-hide timer starts again when it closes. The blank-preview hint is hidden while one is open.
- **Narrow windows:** a container query on the control layer, which spans the window. Under 640px only the active Show segment keeps its label; the other shows an icon. The pill is at most the window width minus 32px, and fits down to a 600px window.

## Frame size

- **Handles:** eight on the frame (corners and edges, 14px hit areas), in the control layer, so they hide with the controls and are never recorded.
- **Free resizing:** corners and edges change width and height independently. Both opposite sides move, so the frame stays centered.
  - Shift keeps the starting proportions during a drag.
  - The size stays between 360 by 240 and the available area: the window minus 32px left and right, 72px at the top and 96px at the bottom.
- **Reset:** a double click on any handle returns to the default size, `min(1000px, 82vw)` by `min(620px, 100vh - 160px)`, and clears the stored size.
- **Keyboard:** the four edges are buttons ("Resize frame, top edge" and so on).
  - Arrow keys move that edge by 16px, or 64px with Shift; Home resets.
  - The size is announced after half a second: "Frame size: 1100 by 640".
  - The corners are hidden from assistive technology.
- **Saved:** as fractions of the available area in `localStorage["rokk.stage.size"]`.
- **During a drag:** layout updates once per animation frame, the terminal refits when the drag ends, and Escape cancels a drag. Nothing resizes while recording.

## The frame surface

One rounded surface with one soft shadow, no hairline.

- **Terminal:** the frame and the pane inside it share `--rk-canvas`; the pane has no border or radius, and the terminal keeps its text padding.
- **Preview:** the frame, the pane and the preview wrapper are transparent, and the wrapper's padding is 0. The address bar, notices and input bar are hidden. The page fills the frame, and the frame's 16px radius clips it.
- **The DOM:** react-resizable-panels wraps the children, so the chain is `#workspace` (the panel), its inner `<div>` (the frame, with an inline `overflow: auto` that `stage.css` overrides with `!important`), the app's wrapper `<div class="h-full min-h-0 pl-0.5 pr-2">`, then `.terax-pane`.
- **Selectors:** every selector carries `#workspace`, so it beats the Tailwind utilities and `:root .terax-pane`. An earlier rule aimed at `#workspace > div > .terax-pane` and never matched.

### Debugging the frame

In the web inspector's console, with stage mode on and Preview showing, this lists the preview iframe's ancestors with their backgrounds, borders and padding:

```js
(() => {
  let el = document.querySelector('iframe[title="Preview"]');
  let i = 0;
  while (el && i < 16) {
    const s = getComputedStyle(el);
    console.log(i++, (el.id ? "#" + el.id + " " : "") + String(el.className).slice(0, 70),
      "| bg", s.backgroundColor, "| border", s.borderTopWidth, s.borderTopColor,
      "| padding", s.padding, "| radius", s.borderRadius, "| shadow", s.boxShadow !== "none");
    el = el.parentElement;
  }
})();
```

How to read it:

- Each line is one layer, from the iframe outward.
- Any layer between the iframe and the frame (the one with `shadow true`) that shows a background other than `rgba(0, 0, 0, 0)`, a border wider than 0px, or padding other than `0px` paints a rim.
- For a terminal, start from `document.querySelector("#workspace .terax-pane")` instead. The pane should show `--rk-canvas`, a 0px border and a 0px radius.

## Auto-zoom

Always on: the recorder saves the mouse path next to each recording, and there is no toggle (see RECORD.md). After a recording with a mouse path, the result card offers "Preview zoom", a player that shows the recording with the zoom applied, with one gentle motion and a hold of 1.5 s by default (see ZOOM_MAP.md). The video file is not changed. "Save with zoom" in that player writes a new `Rokk-...-zoom.mp4` next to it (macOS 13 and later), with a progress bar and Cancel.

## Wallpapers

Six files in `public/stage/`: `horizon.webp`, `embers.webp`, `silk.webp`, `lagoon.webp`, `dusk.webp`, `mist.webp`. They are served as files and do not count toward the JS budget.

To replace one, overwrite the file with the same name. Each wallpaper also has a solid fallback color in `lib/stage.ts`, shown while it loads or when the file is missing; the wallpaper button and its grid then show the plain color. To change the mark's text color for a wallpaper, change its `ink` there.

## Safety

The first time stage mode is entered after each launch, a toast says: "Stage mode shows your terminal. Check it for secrets before you share your screen."

## Known limits

- The native macOS traffic lights stay visible; hiding them needs Rust (Phase 3). The Exit pill sits to their right.
- Recording is Phase 2 (see RECORD.md). No window shapes yet (Phase 3).
- The Show switch has no "Both" layout, no phone frame and no URLs other than localhost (see TODO.md).
- At an app zoom other than 100 percent, the frame's viewport units are scaled by the zoom.

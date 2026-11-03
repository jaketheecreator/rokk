# Rokk design tokens: "A · Graphite"

The main window has three layers that share one shape language:

- **Window:** header, status bar and the gaps around the panels.
- **Panel:** the left sidebar.
- **Canvas:** the workspace pane, holding the terminal, editor and preview.

All tokens live in `src/styles/rokk-surfaces.css`, imported at the top of `src/styles/globals.css`.

## Colors

The values below are for the default theme. Every other theme maps each token onto its own variables (the fallback column), so its look is unchanged.

| Token | Dark | Light | Fallback (other themes) | Applied to |
|---|---|---|---|---|
| `--rk-window` | `#0F0F0E` | `#E7E4DD` | `var(--frame)` | Window shell, header, status bar, gaps (through `--frame`) |
| `--rk-panel` | `#1A1A18` | `#F6F4EF` | `var(--background)` | Left panel (`#sidebar .terax-pane`), `--card` |
| `--rk-canvas` | `#141413` | `#FFFFFF` | `var(--background)` | Workspace pane, `--background`, terminal background |
| `--rk-edge` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.08)` | `var(--border)` | Pane hairlines, tab pill ring, search field border, `--border` |
| `--rk-text` | `#ECEBE8` | `#1B1B19` | `var(--foreground)` | Primary text, active tab, `--foreground` |
| `--rk-text-2` | `#A19F98` | `#66635C` | `var(--muted-foreground)` | Secondary text, inactive tabs, status bar, `--muted-foreground` |
| `--rk-active` | `#262623` | `#FFFFFF` | foreground at 7% | Active tab pill, active Files/Git segment |
| `--rk-field` | `#242421` | `#EAE7E0` | foreground at 4% | Search field, Files/Git switch, breadcrumb pill hover |

## States

These values apply to every theme, by mode. Each one has a `-tint` variant (16% dark, 10% light) for chips.

| Token | Dark | Light |
|---|---|---|
| `--rk-working` | `#6CA8FF` | `#0959BA` |
| `--rk-attention` | `#F2B34C` | `#994306` |
| `--rk-done` | `#5CC98A` | `#166A46` |

The light state colors are adjusted from the board values (`#0A62CC`, `#A84A07`, `#17714A`). As chip text on their own 10% tint over the window layer, the board values reached only 3.98 to 4.16:1. Each was scaled down in RGB, by 9% for working and attention and 6% for done. The adjusted colors keep at least 4.5:1 on every surface, as chip text and as plain text.

All text tokens meet WCAG AA (4.5:1) on every surface in both modes. The tightest pairs are light `--rk-text-2` on the window (4.72) and dark `--rk-text-2` on `--rk-active` (5.73).

## Claude identity

| Token | Dark | Light | Applied to |
|---|---|---|---|
| `--rk-claude` | `#D97757` | `#C15F3C` | Claude spark on tabs and in the status pill |
| `--rk-claude-text` | `#D97757` | `#92482D` | Status pill text while Claude works |
| `--rk-claude-tint` | 16% of `--rk-claude` | 10% of `--rk-claude` | Status pill background while Claude works |

Icon contrast (3:1 needed):

- `#D97757` in dark mode passes on every surface: window and status bar 6.14, active tab 4.86, panel 5.58, canvas 5.90.
- `#D97757` in light mode fails (window 2.46, active tab 3.12, panel 2.84), so light uses `#C15F3C`: window 3.33, active tab 4.23, panel 3.84, canvas 4.23.

Pill text needs 4.5:1:

- Dark `#D97757` on its tint reaches 5.01.
- Light `#C15F3C` on its tint reaches only 2.99. It is darkened minimally to `#92482D` (4.51) for the text only, so the spark stays `#C15F3C`.

## Shape

| Token | Value | Applied to |
|---|---|---|
| `--rk-radius` | `14px` | Panels (`.terax-pane`), for every theme |
| `--rk-radius-sm` | `10px` | Tabs, tab pill, search field, Files/Git segments, breadcrumb pills |
| `--rk-gap` | `8px` | Documents the existing gutter (window edge to panel and between panels). The layout is unchanged. |

Hairlines are 1px `--rk-edge`. There are no shadows, gradients or glow; the old inset pane shadow is removed. Hover and active colors transition over 150 ms with `ease`, and nothing loops.

## Frame (upgrade 2)

| Element | Value | Where |
|---|---|---|
| Top bar | 56px tall (52px below 768px wide), 18px horizontal padding (macOS keeps the 80px left inset for the native traffic lights), 10px between items | `src/modules/header/Header.tsx` |
| Top bar icon buttons | 31px (17px icon, 7px padding), radius 8px, `--rk-text-2`, hover `--rk-field` | `Header.tsx`, `SearchInline.tsx` (collapsed), `agents/components/NotificationBell.tsx` |
| Tabs | 34px tall (11px above and below in the 56px bar), no border or ring at rest, 15px horizontal padding, 9px between mark and name, 4px between tabs, radius `--rk-radius-sm`, 13px weight 500 in `--rk-text-2`; active weight 600 on `--rk-active` | `src/modules/tabs/TabBar.tsx` |
| Search pill | 210 x 34px, 12px padding, radius 10px, `--rk-field`; shortcut hint in the mono font at 11.5px | `src/modules/header/SearchInline.tsx` |
| Panel gutters | 8px left, right and between panels (`--rk-gap`, from the existing panel padding). No gap under the panels: they end at the status bar's top edge, and none above them: they start right under the top bar. | `src/app/App.tsx` (unchanged) |
| Left panel header | padding 14px 14px 10px, 17px folder icon, project name 14.5px weight 600 | `src/modules/explorer/FileExplorer.tsx` |
| File rows | 29px tall, 13.5px (`ROW_HEIGHT = 29` drives the virtualizer) | `FileExplorer.tsx`, `TreeRow.tsx` |
| Files/Changes/Git switch | container 40px, padding 4px, radius `--rk-radius-sm` on `--rk-field`, 10px side margins, `@container` (inline size); segments 32px, gap 4px, radius 8px, share the space evenly; icon 16px, label 13px, 8px between icon and label; active on `--rk-active` weight 600. Below a switch width of 268px only the active segment shows its label (12px padding) and inactive segments are icon only, at least 36px wide, with a tooltip; from 268px all show icon and label (10px padding). Count badges sit on the icon's top right corner: at least 16 x 16px, 11px weight 600, tabular numbers, "99+" above 99, hidden at zero; Changes uses `--rk-working-tint` and `--rk-working`, Git a neutral pill with a `--rk-edge` border. The count is also in the accessible name ("Git, 35 changes"). 150ms ease on width and background only, none with reduced motion | `src/modules/sidebar/SidebarRail.tsx`, `src/modules/sidebar/railLabels.ts` |
| Status bar | 48px tall, 18px horizontal padding, items vertically centered; every item is 28px tall, so 10px above and below | `src/modules/statusbar/StatusBar.tsx` |
| Breadcrumb pills | 28px tall, 12.5px, 12px horizontal padding, fully rounded, `--rk-field`; current folder weight 600 in `--rk-text`; 13px chevrons | `src/modules/statusbar/CwdBreadcrumb.tsx` |
| Status pills | the agent state pill, git text (12.5px, `--rk-text-2`) and "Open AI agent" in the same pill style | `AgentStatePill.tsx`, `StatusBar.tsx`, `ai/components/AiStatusBarControls.tsx` |

## Agent state mark

`src/components/brand/RokkStateMark.tsx` draws the Rokk body with the small square cut out (it reuses `BODY_PATH` and `HOLE_PATH`) and is `aria-hidden`.

| State | Color | Square | Extra |
|---|---|---|---|
| idle (no agent, or exited) | `--rk-text-2` | bottom left | |
| working | `--rk-working` | top right, toggling with bottom left every 700ms (`steps(1, end)`, still at top right with reduced motion) | |
| attention | `--rk-attention` | bottom left | 5px dot, top right |
| done | `--rk-done` | bottom left | 5px dot, until the tab is next focused |

When the detected agent is Claude, the tab shows the Claude spark (`ClaudeIcon` from `@hugeicons/core-free-icons`, the same icon Terax already used) at 15px in `--rk-claude`:

- static when idle;
- turning in eight discrete steps per 1.2s (`steps(8, end)`) while working, and still with reduced motion;
- a 5px `--rk-attention` or `--rk-done` dot for attention and finished.

An exited Claude goes back to the gray idle Rokk mark. Other agents keep the Rokk mark states. The hidden text is "Claude is ready", "Claude is working", "Claude needs you" or "Claude finished".

Terminal tabs show the mark (private tabs keep their incognito icon); editor, preview and git tabs keep their icons. Each marked tab carries visually hidden text such as "Claude is working". The status bar pill shows the active tab's state: "Claude is working · 2m 14s", "Claude needs you", or "Claude finished" for 8 seconds.

## Terminal background and the canvas

The terminal paints its own background inside the WebGPU canvas from `--terminal-background`, the theme's terminal color field (`src/styles/tokens.ts`). For the default theme, `rokk-surfaces.css` sets `--terminal-background: var(--rk-canvas)` and `--background: var(--rk-canvas)`. The workspace pane, its slack area around the cells and the cells themselves therefore resolve to the same color, so no seam shows. The engine is not touched.

## How the default theme is detected

`ThemeProvider` sets `data-rk-surface="graphite"` on `<html>` while the default theme (`terax-default`) is active, and removes it for any other theme. The pre-paint scripts in `index.html` and `settings.html` set it from the theme fast path (`terax-ui-theme-id-shadow`), so the first frame already has the right layers. Other themes write their variables inline on `<html>`, which beats any stylesheet value.

## Translucency and background images

- **Window vibrancy** (Settings, General) still works. `html[data-vibrancy="on"]` redefines `--frame` at the same weight as the Graphite mapping but later in the cascade, so the window layer turns translucent while the panel and canvas stay solid.
- **Background images** render as a separate overlay with their own opacity (`src/modules/theme/SurfaceLayer.tsx`), above every layer, so they do not change the layer relationships.

## Font

The UI font stack is `'Geist', 'Inter Variable', sans-serif`. Geist Sans 400, 500 and 600 ship as static files in `public/fonts/geist/` (SIL OFL 1.1, `public/fonts/geist/OFL.txt`), declared with `font-display: swap`. The terminal and editor fonts are unchanged.

## Adding a theme

1. Add a file in `src/modules/theme/themes/` with `variants.light` and `variants.dark`. `colors` writes the shadcn variables, and `terminal.background` writes `--terminal-background`.
2. To keep the no-seam rule, set `terminal.background` equal to `colors.background`. Both the pane and the terminal draw it.
3. The theme picks up the shape tokens automatically. Its `--rk-*` colors fall back to its own variables, so tabs, fields and panels follow it without extra work.
4. To give a theme distinct Graphite-style layers, add a `html[data-rk-surface="<name>"]` block in `rokk-surfaces.css` and set the attribute for that theme in `ThemeProvider`.

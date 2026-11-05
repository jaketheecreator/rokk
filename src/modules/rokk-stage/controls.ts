// Pure parts of the stage control bar: one popover at a time, the wallpaper
// grid's arrow keys and popover placement.

export type PopoverId = "port" | "wallpaper";
export type PopoverAction =
  | { type: "open"; id: PopoverId }
  | { type: "toggle"; id: PopoverId }
  | { type: "close" }
  | { type: "escape" }
  | { type: "outside" };

/** Only one popover is open; Escape and an outside click close it. */
export function popover(state: PopoverId | null, a: PopoverAction): PopoverId | null {
  if (a.type === "open") return a.id;
  if (a.type === "toggle") return state === a.id ? null : a.id;
  return null;
}

/** Arrow keys in a grid of `count` items, `cols` wide; wraps at the ends. */
export function gridMove(i: number, key: string, count: number, cols: number): number | null {
  const d: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (!(key in d)) return null;
  return (((i + d[key]) % count) + count) % count;
}

/** How far to shift a popover so it stays 16px inside the window. */
export function clampShift(left: number, right: number, W: number, margin = 16): number {
  if (left < margin) return margin - left;
  if (right > W - margin) return W - margin - right;
  return 0;
}

// Pure parts of the stage frame size: the available area, free resizing,
// keyboard steps and persistence. See docs/rokk/STAGE.md.

export const SIZE_KEY = "rokk.stage.size";
export const MIN_W = 360;
export const MIN_H = 240;
export type Size = { w: number; h: number };
/** A custom size as fractions of the available area. */
export type Fractions = { fw: number; fh: number };
export type Side = "top" | "right" | "bottom" | "left";

/** The window minus 32px left and right, 72px at the top, 96px at the bottom. */
export function area(W: number, H: number): Size {
  return { w: Math.max(0, W - 64), h: Math.max(0, H - 168) };
}

export function clamp(s: Size, W: number, H: number): Size {
  const a = area(W, H);
  const c = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(Math.min(lo, hi), v)));
  return { w: c(s.w, MIN_W, a.w), h: c(s.h, MIN_H, a.h) };
}

/** The default: min(1000px, 82vw) by min(620px, 100vh - 160px), kept inside the area. */
export function defaultSize(W: number, H: number): Size {
  return clamp({ w: Math.min(1000, W * 0.82), h: Math.min(620, H - 160) }, W, H);
}

export function sizeOf(f: Fractions | null, W: number, H: number): Size {
  if (!f) return defaultSize(W, H);
  const a = area(W, H);
  return clamp({ w: f.fw * a.w, h: f.fh * a.h }, W, H);
}

export function fractionsOf(s: Size, W: number, H: number): Fractions {
  const a = area(W, H);
  return { fw: a.w ? s.w / a.w : 1, fh: a.h ? s.h / a.h : 1 };
}

/** The frame's top: centered in the available area. */
export function top(s: Size, H: number): number {
  return Math.round(72 + (area(0, H).h - s.h) / 2);
}

/**
 * One drag step. `hx` and `hy` are the handle's side (-1, 0 or 1). Both
 * opposite sides move, so the frame stays centered. Free by default; with
 * `keep` (Shift held) the starting proportions are kept.
 */
export function drag(start: Size, dx: number, dy: number, hx: number, hy: number, keep: boolean, W: number, H: number): Size {
  let w = start.w + 2 * dx * hx;
  let h = start.h + 2 * dy * hy;
  if (keep && start.w > 0 && start.h > 0) {
    const k = hx && hy ? Math.max(w / start.w, h / start.h) : hx ? w / start.w : h / start.h;
    w = start.w * k;
    h = start.h * k;
  }
  return clamp({ w, h }, W, H);
}

/** An arrow key on an edge handle: 16px (64px with Shift) for that edge. */
export function keyStep(s: Size, side: Side, key: string, shift: boolean, W: number, H: number): Size | null {
  const out: Record<Side, string> = { top: "ArrowUp", bottom: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
  const inn: Record<Side, string> = { top: "ArrowDown", bottom: "ArrowUp", left: "ArrowRight", right: "ArrowLeft" };
  const d = key === out[side] ? 1 : key === inn[side] ? -1 : 0;
  if (!d) return null;
  // Both sides move, so the size changes by twice the step.
  const step = 2 * d * (shift ? 64 : 16);
  const wide = side === "left" || side === "right";
  return clamp({ w: s.w + (wide ? step : 0), h: s.h + (wide ? 0 : step) }, W, H);
}

export function readSize(store: Pick<Storage, "getItem"> | null): Fractions | null {
  try {
    const c = JSON.parse(store?.getItem(SIZE_KEY) ?? "null");
    if (c?.fw > 0 && c.fw <= 1 && c.fh > 0 && c.fh <= 1) return { fw: c.fw, fh: c.fh };
  } catch {
    // Fall through to the default.
  }
  return null;
}

/** Saves a custom size, or clears it (back to the default) with `null`. */
export function writeSize(store: Pick<Storage, "setItem" | "removeItem"> | null, f: Fractions | null): void {
  try {
    if (f) store?.setItem(SIZE_KEY, JSON.stringify(f));
    else store?.removeItem(SIZE_KEY);
  } catch {
    // Remembering the size is a convenience only.
  }
}

/** Drag session: Escape gives back the size from before; no drags while recording. */
export function begin(recording: boolean, size: Size): { cancel: () => Size } | null {
  return recording ? null : { cancel: () => size };
}

export function sizeText(s: Size): string {
  return `Frame size: ${s.w} by ${s.h}`;
}

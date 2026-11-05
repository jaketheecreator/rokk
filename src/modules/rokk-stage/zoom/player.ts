// Pure parts of the "Preview zoom" player: texts, the track from the saved
// file, scrubber ticks and keys, the smoothed media clock, the transform
// writer, the settings debounce and the dev-only motion stats.

import {
  DEFAULTS,
  evaluate,
  type Phase,
  type PlanAnchor,
  planZoom,
  SKIP_TOLERANCE_MS,
  type Track,
  type View,
  type ZoomMode,
  type ZoomPlan,
} from "./algo";

/** Mirrors `Loaded` in src-tauri/src/modules/rokk_record/zoom.rs. */
export type Loaded = {
  version: number;
  video: { width: number; height: number; scale: number };
  frame: { x: number; y: number; w: number; h: number } | null;
  samples: [number, number, number][];
  clicks: [number, number, number, number][];
  events: { t_ms: number }[];
  end: { t_ms: number };
};

export const TITLE = "Preview zoom";
export const ERROR_TITLE = "Rokk could not open this recording.";
export const EMPTY_NOTE = "No zoom moments found. Try a shorter dwell time.";
export const REDUCED_NOTE =
  "Zoom is off because your system asks for reduced motion";
export const DEBOUNCE_MS = 120;
/** Under the settings row; each slider also has its own sentence. */
export const HINT =
  "Level is how far it zooms. Dwell is how long the mouse rests before a pause zoom. Hold is how long it stays zoomed. Click a tick to turn that zoom off.";
/** Shown only in "Clicks and pauses" mode. */
export const SCROLL_NOTE =
  "Rokk cannot see scrolling, so a pause while you scroll can zoom. Turn it off with its tick.";
export const DWELL_OFF = "Dwell only applies to pauses";
/** Dwell is disabled in "Clicks" mode, where pauses never zoom. */
export const sliderOff = (key: string, mode: ZoomMode) =>
  key === "dwellMs" && mode === "clicks";
export const MODE_KEY = "rokk.zoom.mode";
export const OFF_KEY = "rokk.zoom.off.v1";
/** Skip lists are kept for this many recordings, the most recent first. */
export const OFF_CAP = 30;
export const SLIDER_HELP = {
  level: "Level: how far the view zooms in.",
  dwellMs:
    "Dwell: how long the mouse must rest on a spot before the zoom starts.",
  holdMs: "Hold: how long the view stays zoomed after it zooms in.",
} as const;
/** Shown while "Play it here" plays the saved zoomed file. */
export const SAVED_NOTE = "This is the saved video";

export function toTrack(l: Loaded, videoSeconds: number): Track {
  const fromVideo = Number.isFinite(videoSeconds) ? videoSeconds * 1000 : 0;
  return {
    width: l.video.width,
    height: l.video.height,
    scale: l.video.scale,
    frame: l.frame,
    samples: l.samples,
    clicks: l.clicks,
    events: l.events.map((e) => e.t_ms),
    durationMs: Math.max(fromVideo, l.end.t_ms),
  };
}

/** On by default, off when the system asks for reduced motion. */
export const defaultZoomOn = (reducedMotion: boolean) => !reducedMotion;

export const momentsText = (n: number) =>
  `${n} zoom ${n === 1 ? "moment" : "moments"}`;

/** One scrubber tick per candidate zoom: where it is (percent), whether it
 * is on, and its accessible label and tooltip. */
export function ticks(plan: ZoomPlan, durationMs: number) {
  if (!(durationMs > 0)) return [];
  return plan.anchors.map((a) => ({
    id: a.id,
    left: Math.min(100, Math.max(0, (a.t0 / durationMs) * 100)),
    on: a.enabled,
    label: `Zoom at ${formatTime(a.t0 / 1000)} (${a.kind}), ${a.enabled ? "on" : "off"}`,
    title: `Click to turn this zoom ${a.enabled ? "off" : "on"}`,
    anchor: a,
  }));
}

/** "4 zooms, 1 off", or "" with no candidate zooms. */
export function zoomsText(plan: ZoomPlan): string {
  const n = plan.anchors.length;
  const off = plan.anchors.filter((a) => !a.enabled).length;
  if (!n) return "";
  return `${n} ${n === 1 ? "zoom" : "zooms"}${off ? `, ${off} off` : ""}`;
}

/** The skip list after clicking an anchor's tick: off when it was on;
 * when it was off, every skip id that matched it is removed. */
export function toggleSkip(
  off: readonly string[],
  a: Pick<PlanAnchor, "id" | "kind" | "t0" | "enabled">,
): string[] {
  if (a.enabled) return [...off, a.id];
  return off.filter((id) => {
    const [kind, t] = id.split(":");
    return !(
      kind === a.kind &&
      Math.abs(Number.parseFloat(t) - a.t0) <= SKIP_TOLERANCE_MS
    );
  });
}

type Store = Pick<Storage, "getItem" | "setItem"> | null;

export function readMode(store: Store): ZoomMode {
  try {
    return store?.getItem(MODE_KEY) === "clicks-pauses"
      ? "clicks-pauses"
      : "clicks";
  } catch {
    return "clicks";
  }
}

export function writeMode(store: Store, mode: ZoomMode): void {
  try {
    store?.setItem(MODE_KEY, mode);
  } catch {
    // Not saved; the player still works.
  }
}

function offMap(store: Store): Record<string, string[]> {
  try {
    const v = JSON.parse(store?.getItem(OFF_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The zooms switched off for one recording (by its MP4 file name). */
export function readOff(store: Store, file: string): string[] {
  const ids = offMap(store)[file];
  return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}

/** Saves them, most recent recording last, keeping OFF_CAP recordings. */
export function writeOff(
  store: Store,
  file: string,
  ids: readonly string[],
): void {
  const m = offMap(store);
  delete m[file];
  if (ids.length) m[file] = [...ids];
  const keys = Object.keys(m);
  for (const k of keys.slice(0, Math.max(0, keys.length - OFF_CAP)))
    delete m[k];
  try {
    store?.setItem(OFF_KEY, JSON.stringify(m));
  } catch {
    // Not saved; the player still works.
  }
}

/** The new time in seconds for a scrubber key, or null for other keys. */
export function seekKey(
  key: string,
  shift: boolean,
  t: number,
  duration: number,
): number | null {
  const step = shift ? 5 : 1;
  const d =
    key === "ArrowRight" || key === "ArrowUp"
      ? step
      : key === "ArrowLeft" || key === "ArrowDown"
        ? -step
        : 0;
  if (key === "Home") return 0;
  if (key === "End") return duration;
  return d ? Math.min(duration, Math.max(0, t + d)) : null;
}

/** 0:05, 1:23, 12:00. */
export function formatTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Space toggles play, except where it already presses a control. */
export function spaceToggles(
  key: string,
  target: { tagName?: string; type?: string } | null,
): boolean {
  if (key !== " ") return false;
  const tag = target?.tagName?.toLowerCase();
  return tag !== "button" && !(tag === "input" && target?.type !== "range");
}

export function createDebounce(fn: () => void, ms = DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Pauses a video and lets go of its file. */
export function release(
  v: Pick<HTMLVideoElement, "pause" | "removeAttribute" | "load"> | null,
) {
  if (!v) return;
  v.pause();
  v.removeAttribute("src");
  v.load();
}

/** A media clock for the camera: the last known media time (from a decoded
 * frame or a currentTime change) plus the time since, times the rate, at
 * most `aheadMs` past it, and never backwards while playing. */
export function createMediaClock(aheadMs = 80) {
  let base = Number.NEGATIVE_INFINITY;
  let at = 0;
  let last = Number.NEGATIVE_INFINITY;
  return {
    /** A newer media time seen at wall time `now` (older ones are ignored). */
    anchor(mediaMs: number, now: number) {
      if (mediaMs <= base) return;
      base = mediaMs;
      at = now;
    },
    /** Seek, pause, end or rate change: jump to exactly this time. */
    snap(mediaMs: number, now: number) {
      base = mediaMs;
      at = now;
      last = mediaMs;
    },
    read(now: number, rate: number): number {
      const t =
        base + Math.min(Math.max(0, now - at) * Math.max(0, rate), aheadMs);
      last = Math.max(last, t);
      return last;
    },
  };
}

/** The view as one transform with `transform-origin: 0 0`: translate3d then
 * scale, in pixels of the video's box, rounded to 1/100 px. */
export function matrixFor(
  v: View,
  width: number,
  height: number,
  boxW: number,
  boxH: number,
) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const s = Math.round(v.scale * 1e5) / 1e5;
  const tx = r(boxW / 2 - s * v.cx * (boxW / width));
  const ty = r(boxH / 2 - s * v.cy * (boxH / height));
  return {
    s,
    tx,
    ty,
    css: s === 1 ? "none" : `translate3d(${tx}px, ${ty}px, 0) scale(${s})`,
  };
}

export type VideoLike = { style: { transform: string; willChange: string } };
export type Knobs = {
  mode: ZoomMode;
  level: number;
  dwellMs: number;
  holdMs: number;
};
export const DEFAULT_KNOBS: Knobs = {
  mode: DEFAULTS.mode,
  level: DEFAULTS.level,
  dwellMs: DEFAULTS.dwellMs,
  holdMs: DEFAULTS.holdMs,
};
/** One rendered frame for the debug stats, in pixels of the video's box. */
export type Frame = {
  t: number;
  s: number;
  x: number;
  y: number;
  phase?: Phase;
};

/** The plan and the zoom switch for one open player. Setting changes
 * recompute the plan after DEBOUNCE_MS, without touching playback. */
export function createZoomController(
  loaded: Loaded,
  videoSeconds: number,
  reducedMotion: boolean,
  onPlan: (plan: ZoomPlan) => void,
  first: Partial<Knobs> = {},
  firstSkips: readonly string[] = [],
) {
  const track = toTrack(loaded, videoSeconds);
  let knobs = { ...DEFAULT_KNOBS, ...first };
  let skips: ReadonlySet<string> = new Set(firstSkips);
  let zoom = defaultZoomOn(reducedMotion);
  let plan = planZoom(track, knobs, skips);
  let box = { w: track.width, h: track.height };
  let written: { s: number; tx: number; ty: number } | null = null;
  const replan = () => {
    plan = planZoom(track, knobs, skips);
    onPlan(plan);
  };
  const later = createDebounce(replan);
  return {
    plan: () => plan,
    zoom: () => zoom,
    knobs: () => knobs,
    durationMs: track.durationMs,
    set(next: Partial<Knobs>) {
      knobs = { ...knobs, ...next };
      later.call();
    },
    /** Zooms switched off by id; re-plans at once, playback continues. */
    setSkips(ids: readonly string[]) {
      skips = new Set(ids);
      later.cancel();
      replan();
    },
    setZoom(on: boolean) {
      zoom = on;
    },
    setBox(w: number, h: number) {
      if (w > 0 && h > 0) box = { w, h };
      written = null;
    },
    reset() {
      knobs = DEFAULT_KNOBS;
      zoom = defaultZoomOn(reducedMotion);
      later.call();
    },
    /** Writes the transform for media time `t` (ms) when it changed by more
     * than 0.005 px or 0.0002 scale. Returns the frame, in box pixels. */
    frame(v: VideoLike, t: number, playing: boolean): Frame {
      v.style.willChange = playing && zoom ? "transform" : "auto";
      const view = zoom
        ? evaluate(plan, t)
        : { scale: 1, cx: track.width / 2, cy: track.height / 2 };
      const m = matrixFor(view, plan.width, plan.height, box.w, box.h);
      const same =
        written &&
        Math.abs(written.s - m.s) <= 0.0002 &&
        Math.abs(written.tx - m.tx) <= 0.005 &&
        Math.abs(written.ty - m.ty) <= 0.005;
      if (!same) {
        v.style.transform = m.css;
        written = m;
      }
      return {
        t,
        s: m.s,
        x: (view.cx * box.w) / plan.width,
        y: (view.cy * box.h) / plan.height,
      };
    },
    dispose: later.cancel,
  };
}

const PHASES: readonly Phase[] = [
  "entering",
  "holding",
  "panning",
  "exiting",
  "idle",
];
/** Steps shorter than this (px) are rounding noise, not a direction. */
const STILL_PX = 0.02;

/** Dev-only motion stats over rendered frames (box pixels per frame). A
 * velocity jump is the size of the change of the step vector; a direction
 * reversal is two steps pointing more than 90 degrees apart. Each step
 * counts in the phase of the frame it ends on. */
export function debugStats(frames: readonly Frame[]) {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const blank = () => ({
    frames: 0,
    maxCenterStep: 0,
    maxCenterVelocityJump: 0,
    directionReversals: 0,
  });
  const per = Object.fromEntries(PHASES.map((p) => [p, blank()])) as Record<
    Phase,
    ReturnType<typeof blank>
  >;
  const all = blank();
  let maxScaleStep = 0;
  // Second differences of the per-frame steps: a jump in acceleration
  // shows as a spike here even when the steps themselves look smooth.
  let maxAcceleration = 0;
  let maxScaleAcceleration = 0;
  for (let i = 0; i < frames.length; i++) {
    const b = frames[i];
    const ph = per[b.phase ?? "idle"];
    ph.frames++;
    if (i < 1) continue;
    const a = frames[i - 1];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const step = Math.hypot(sx, sy);
    maxScaleStep = Math.max(maxScaleStep, Math.abs(b.s - a.s));
    for (const o of [ph, all])
      o.maxCenterStep = Math.max(o.maxCenterStep, step);
    if (i < 2) continue;
    const z = frames[i - 2];
    const px = a.x - z.x;
    const py = a.y - z.y;
    const jump = Math.hypot(sx - px, sy - py);
    const flip =
      step > STILL_PX && Math.hypot(px, py) > STILL_PX && sx * px + sy * py < 0;
    for (const o of [ph, all]) {
      o.maxCenterVelocityJump = Math.max(o.maxCenterVelocityJump, jump);
      if (flip) o.directionReversals++;
    }
    if (i < 3) continue;
    const y = frames[i - 3];
    maxAcceleration = Math.max(
      maxAcceleration,
      Math.hypot(sx - 2 * px + (z.x - y.x), sy - 2 * py + (z.y - y.y)),
    );
    maxScaleAcceleration = Math.max(
      maxScaleAcceleration,
      Math.abs(b.s - 3 * a.s + 3 * z.s - y.s),
    );
  }
  const out = (o: ReturnType<typeof blank>) => ({
    frames: o.frames,
    maxCenterStep: r(o.maxCenterStep),
    maxCenterVelocityJump: r(o.maxCenterVelocityJump),
    directionReversals: o.directionReversals,
  });
  const unique = new Set(frames.map((f) => f.t)).size;
  return {
    frames: frames.length,
    maxScaleStep: r(maxScaleStep),
    maxCenterStep: r(all.maxCenterStep),
    maxCenterVelocityJump: r(all.maxCenterVelocityJump),
    maxAcceleration: r(maxAcceleration),
    maxScaleAcceleration: Math.round(maxScaleAcceleration * 1e6) / 1e6,
    directionReversals: all.directionReversals,
    uniqueTimeFraction: frames.length ? r(unique / frames.length) : 0,
    entering: out(per.entering),
    holding: out(per.holding),
    panning: out(per.panning),
    exiting: out(per.exiting),
    idle: out(per.idle),
  };
}

/** Radix's close focus handler: back to the button that opened the player. */
export const returnFocusTo =
  (el: () => { focus(): void } | null) => (e: { preventDefault(): void }) => {
    e.preventDefault();
    el()?.focus();
  };

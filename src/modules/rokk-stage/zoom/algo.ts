// Auto-zoom: the zoom plan for a finished recording, from its saved mouse
// path. Pure and deterministic: the same track and settings always give the
// same plan, and the camera is a pure function of time, continuous in value
// and velocity. The rules and the math are in docs/rokk/ZOOM_MAP.md.

export type Rect = { x: number; y: number; w: number; h: number };

/** The mouse path, in video pixels and milliseconds since the first frame. */
export type Track = {
  width: number;
  height: number;
  /** Backing scale factor (2 on Retina). */
  scale: number;
  /** The stage frame, or null to use the whole video. */
  frame: Rect | null;
  samples: readonly (readonly [number, number, number])[];
  /** [t, x, y, button]. */
  clicks: readonly (readonly number[])[];
  /** Window change times (move, resize, scale, display). */
  events: readonly number[];
  durationMs: number;
};

/** The one motion: the zoom eases in and out on a C2 curve (smootherstep,
 * zero speed and zero acceleration at both ends), and pans between anchors
 * follow a third-order critically damped response with this time constant. */
export const MOTION = {
  easeInMs: 600,
  easeOutMs: 700,
  centerTauMs: 170,
} as const;

/** What may start a zoom: clicks only (the default), or clicks and pauses. */
export type ZoomMode = "clicks" | "clicks-pauses";
export type AnchorKind = "click" | "pause";

export type ZoomSettings = {
  mode: ZoomMode;
  level: number;
  dwellMs: number;
  /** Counted from the moment the zoom-in finishes. */
  holdMs: number;
  /** In points; the radius in video pixels is this times the scale. */
  dwellRadiusPt: number;
  exitRadiusPt: number;
  /** The cursor must stay outside the exit radius this long. */
  exitDelayMs: number;
  clickLeadMs: number;
  minGapMs: number;
  edgeMargin: number;
  /** A pause counts only if the cursor moved at least this far (points,
   * times the scale) in the arrivalWindowMs before the rest began. */
  arrivalMinPt: number;
  arrivalWindowMs: number;
  /** A pause with no click is idle this long after its arrival, so its
   * zoom leaves by then even if the hold is longer. */
  idleCapMs: number;
};

export const DEFAULTS: ZoomSettings = {
  mode: "clicks",
  level: 1.8,
  dwellMs: 1000,
  holdMs: 1500,
  dwellRadiusPt: 30,
  exitRadiusPt: 36,
  exitDelayMs: 120,
  clickLeadMs: 250,
  minGapMs: 1200,
  edgeMargin: 0,
  arrivalMinPt: 80,
  arrivalWindowMs: 1500,
  idleCapMs: 4000,
};

export const LEVEL_RANGE = [1.2, 3] as const;
export const DWELL_RANGE = [400, 2500] as const;
export const HOLD_RANGE = [300, 6000] as const;
/** No sample for this long counts as the cursor leaving the window. */
export const GAP_MS = 250;
/** A window change is noticed within half a second, so its span is the
 * half second on either side of the event. */
export const EVENT_SPAN_MS = 500;
/** The de-jitter: a 5-sample median, then this exponential smoothing. */
export const SMOOTH_TAU_MS = 100;
/** A pan counts as settled this many center time constants after it starts. */
export const PAN_SETTLE = 10;

export type Phase = "idle" | "entering" | "holding" | "panning" | "exiting";

/** The follower at time t heads for (tx, ty) from (x, y), moving at
 * (vx, vy) with acceleration (ax, ay). */
export type Key = {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  tx: number;
  ty: number;
};
export type Segment = {
  start: number;
  outStart: number;
  end: number;
  keys: Key[];
};
/** A candidate zoom moment. `id` is the kind and t0 (the click, or the
 * moment the cursor came to rest) rounded to 50 ms; it does not change with
 * the Dwell setting. `enabled` is false when the user switched it off. */
export type PlanAnchor = {
  id: string;
  kind: AnchorKind;
  t0: number;
  x: number;
  y: number;
  enabled: boolean;
};
export type ZoomPlan = {
  segments: Segment[];
  /** Every candidate anchor in time order, skipped ones included. */
  anchors: PlanAnchor[];
  bounds: Rect;
  width: number;
  height: number;
  level: number;
  easeInMs: number;
  easeOutMs: number;
  centerTauMs: number;
};
export type View = { scale: number; cx: number; cy: number };

/** start: the zoom may begin; pan: the view moves here inside a merged
 * segment; out: the zoom may start to leave. */
type Anchor = {
  start: number;
  pan: number;
  out: number;
  x: number;
  y: number;
  kind: AnchorKind;
  t0: number;
};
type Pt = readonly [number, number, number];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const smootherstep = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** The ease curve on [0, 1]: smootherstep S(u) = 6u^5 - 15u^4 + 10u^3.
 * S(0) = 0, S(1) = 1, S' and S'' are 0 at both ends, and S' >= 0. */
export const ease = smootherstep;

export function normalize(s: Partial<ZoomSettings> = {}): ZoomSettings {
  const m = { ...DEFAULTS, ...s };
  return {
    ...m,
    mode: m.mode === "clicks-pauses" ? "clicks-pauses" : "clicks",
    level: clamp(m.level, ...LEVEL_RANGE),
    dwellMs: clamp(m.dwellMs, ...DWELL_RANGE),
    holdMs: clamp(m.holdMs, ...HOLD_RANGE),
  };
}

/** The frame within the video, or the whole video. */
export function boundsOf(
  t: Pick<Track, "width" | "height" | "frame">,
  margin = 0,
): Rect {
  const f = t.frame ?? { x: 0, y: 0, w: t.width, h: t.height };
  const x = clamp(f.x + margin, 0, t.width);
  const y = clamp(f.y + margin, 0, t.height);
  const w = clamp(f.w - 2 * margin, 0, t.width - x);
  const h = clamp(f.h - 2 * margin, 0, t.height - y);
  return w > 0 && h > 0
    ? { x, y, w, h }
    : { x: 0, y: 0, w: t.width, h: t.height };
}

const inside = (b: Rect, x: number, y: number) =>
  x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
const far = (p: Pt, x: number, y: number, r: number) =>
  Math.hypot(p[1] - x, p[2] - y) > r;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The index of the first sample at or after time t. */
function at(s: Track["samples"], t: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The cursor track with its jitter removed: per run without a gap, a
 * centered 5-sample median (it drops single outliers), then an exponential
 * smoothing with SMOOTH_TAU_MS. Same times as the input. */
export function dejitter(S: Track["samples"]): Pt[] {
  const out: Pt[] = [];
  let i0 = 0;
  for (let i = 1; i <= S.length; i++) {
    if (i < S.length && S[i][0] - S[i - 1][0] <= GAP_MS) continue;
    let x = 0;
    let y = 0;
    for (let j = i0; j < i; j++) {
      const k = Math.min(2, j - i0, i - 1 - j);
      const w = S.slice(j - k, j + k + 1);
      const mx = median(w.map((q) => q[1]));
      const my = median(w.map((q) => q[2]));
      const a =
        j === i0 ? 1 : 1 - Math.exp(-(S[j][0] - S[j - 1][0]) / SMOOTH_TAU_MS);
      x += a * (mx - x);
      y += a * (my - y);
      out.push([S[j][0], x, y]);
    }
    i0 = i;
  }
  return out;
}

/** sm: the de-jittered track, for rests and anchors. The raw samples decide
 * timing facts: gaps, leaving the bounds, the exit, clicks. */
type Ctx = {
  t: Track;
  sm: Pt[];
  b: Rect;
  set: ZoomSettings;
  rd: number;
  rx: number;
  /** The arrival distance in video pixels. */
  ra: number;
};

/** Whether the de-jittered cursor travelled at least c.ra within the
 * arrival window before t0: it was moved to this spot. A parked cursor, one
 * resting from the start, or one that only jitters, did not arrive. */
function arrived(c: Ctx, t0: number): boolean {
  const M = c.sm;
  let len = 0;
  for (
    let i = at(M, t0 - c.set.arrivalWindowMs) + 1;
    i < M.length && M[i][0] <= t0;
    i++
  ) {
    const [a, b] = [M[i - 1], M[i]];
    if (b[0] - a[0] <= GAP_MS && a[0] >= t0 - c.set.arrivalWindowMs)
      len += Math.hypot(b[1] - a[1], b[2] - a[2]);
  }
  return len >= c.ra;
}

/** The first rest from time `from`: de-jittered samples within the dwell
 * radius of the run's first one, inside the bounds, with no gap. With
 * `block`, the cursor must first leave the exit radius around it (one rest,
 * one zoom). The anchor is fixed here, once, for the whole zoom. */
function nextDwell(
  c: Ctx,
  from: number,
  block: readonly [number, number] | null,
): Anchor | null {
  const S = c.t.samples;
  const M = c.sm;
  let i = at(S, from);
  if (block) {
    for (let prev = i > 0 ? S[i - 1][0] : from; i < S.length; i++) {
      const p = S[i];
      if (
        p[0] - prev > GAP_MS ||
        !inside(c.b, p[1], p[2]) ||
        far(M[i], block[0], block[1], c.rx)
      )
        break;
      prev = p[0];
    }
  }
  let run: Pt[] = [];
  // A rest the cursor did not arrive at never anchors, however long it lasts.
  let idle = false;
  for (; i < S.length; i++) {
    const p = M[i];
    const last = run[run.length - 1];
    const ok = inside(c.b, S[i][1], S[i][2]);
    if (
      (last && p[0] - last[0] > GAP_MS) ||
      !ok ||
      (run[0] && far(p, run[0][1], run[0][2], c.rd))
    ) {
      run = [];
      idle = false;
    }
    if (!ok) continue;
    run.push(p);
    if (!idle && p[0] - run[0][0] >= c.set.dwellMs) {
      if (!arrived(c, run[0][0])) {
        idle = true;
        continue;
      }
      return {
        start: run[0][0] + c.set.dwellMs,
        pan: run[0][0],
        out: Number.POSITIVE_INFINITY,
        x: median(run.map((q) => q[1])),
        y: median(run.map((q) => q[2])),
        kind: "pause",
        t0: run[0][0],
      };
    }
  }
  return null;
}

/** When the cursor has been outside the exit radius (or the bounds, or the
 * window) for exitDelayMs, from samples after `from`. Infinity if never. */
function exitAt(c: Ctx, from: number, x: number, y: number): number {
  const S = c.t.samples;
  let out: number | null = null;
  let prev = from;
  for (let i = at(S, from + 1e-9); i < S.length; i++) {
    const p = S[i];
    if (p[0] - prev > GAP_MS) return (out ?? prev) + c.set.exitDelayMs;
    if (!inside(c.b, p[1], p[2]) || far(p, x, y, c.rx)) {
      out ??= p[0];
      if (p[0] - out >= c.set.exitDelayMs) return out + c.set.exitDelayMs;
    } else out = null;
    prev = p[0];
  }
  return out === null ? Number.POSITIVE_INFINITY : out + c.set.exitDelayMs;
}

/** Zoom anchors from rests and clicks, in time order, each with the time its
 * zoom may start to leave: the exit, the hold cap, or a click elsewhere. */
function anchorsOf(c: Ctx, easeInMs: number): Anchor[] {
  const clicks = c.t.clicks
    .filter((k) => inside(c.b, k[1], k[2]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Anchor[] = [];
  let from = 0;
  let clickFrom = Number.NEGATIVE_INFINITY;
  let block: readonly [number, number] | null = null;
  while (out.length < 100_000) {
    const d: Anchor | null =
      c.set.mode === "clicks" ? null : nextDwell(c, from, block);
    const k = clicks.find((q) => q[0] >= clickFrom);
    const ka: Anchor | null = k
      ? {
          start: k[0] + c.set.clickLeadMs,
          pan: k[0] + c.set.clickLeadMs,
          out: 0,
          x: k[1],
          y: k[2],
          kind: "click",
          t0: k[0],
        }
      : null;
    const a: Anchor | null = ka && (!d || ka.start <= d.start) ? ka : d;
    if (!a) break;
    const since = a === ka && k ? k[0] : a.start;
    let cap = a.start + easeInMs + c.set.holdMs;
    if (a.kind === "pause") cap = Math.min(cap, a.t0 + c.set.idleCapMs);
    let leave = exitAt(c, since, a.x, a.y);
    for (const q of clicks) {
      if (q[0] <= since || q[0] >= Math.min(leave, cap)) continue;
      // A click inside the radius restarts the hold; one elsewhere ends it,
      // and that click anchors next.
      if (Math.hypot(q[1] - a.x, q[2] - a.y) <= c.rx) cap = q[0] + c.set.holdMs;
      else {
        leave = q[0];
        break;
      }
    }
    const end = Math.min(leave, cap);
    out.push({ ...a, out: Math.max(end, a.start + easeInMs) });
    from = end;
    clickFrom = end > since ? end : since + 1e-9;
    if (leave <= cap) {
      // The cursor moved: clicks from the moment it left may anchor.
      clickFrom = Math.min(clickFrom, leave);
      block = null;
    } else block = [a.x, a.y];
    if (!Number.isFinite(end)) break;
  }
  return out;
}

function spans(events: readonly number[]): [number, number][] {
  const s = [...events]
    .sort((a, b) => a - b)
    .map((e): [number, number] => [e - EVENT_SPAN_MS, e + EVENT_SPAN_MS]);
  const out: [number, number][] = [];
  for (const sp of s) {
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else out.push(sp);
  }
  return out;
}

type Axis = readonly [number, number, number];

/** One axis of a third-order critically damped follower (a triple pole at
 * -w, w = 1 / tau), in closed form: e(t) = (A + B t + C t^2) e^-wt with
 * A = e0, B = v0 + w e0, C = (a0 + 2 w v0 + w^2 e0) / 2. Position, velocity
 * and acceleration carry over at every key. Returns [x, v, a] at dt. */
function axis(
  p: number,
  v: number,
  acc: number,
  target: number,
  w: number,
  dt: number,
): Axis {
  const A = p - target;
  const B = v + w * A;
  const C = (acc + 2 * w * v + w * w * A) / 2;
  const E = Math.exp(-w * dt);
  const q = B - w * A + (2 * C - w * B) * dt - w * C * dt * dt;
  const dq = 2 * C - w * B - 2 * w * C * dt;
  return [target + (A + B * dt + C * dt * dt) * E, q * E, (dq - w * q) * E];
}

function follow(k: Key, t: number, w: number) {
  const dt = Math.max(0, t - k.t);
  const [x, vx, ax] = axis(k.x, k.vx, k.ax, k.tx, w, dt);
  const [y, vy, ay] = axis(k.y, k.vy, k.ay, k.ty, w, dt);
  return { x, y, vx, vy, ax, ay };
}

/** A target for a follower starting at p with velocity v and acceleration
 * a, pulled inside [lo, hi] so the path never overshoots past the range.
 * The extremes of e(t) are where e'(t) = 0: the positive roots of
 * -w C t^2 + (2 C - w B) t + (B - w A) = 0. */
function safeTarget(
  p: number,
  v: number,
  acc: number,
  target: number,
  w: number,
  lo: number,
  hi: number,
): number {
  let tg = clamp(target, lo, hi);
  for (let n = 0; n < 8; n++) {
    const A = p - tg;
    const B = v + w * A;
    const C = (acc + 2 * w * v + w * w * A) / 2;
    const [qa, qb, qc] = [-w * C, 2 * C - w * B, B - w * A];
    // No real roots (d < 0) means a monotone path: the one point checked
    // then lies between p and the target, inside the range. A zero
    // leading term gives a non-finite time, which is skipped.
    const r = Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc));
    const roots = qa
      ? [(-qb - r) / (2 * qa), (-qb + r) / (2 * qa)]
      : [-qc / qb];
    let over = 0;
    for (const t of roots) {
      if (!(t > 0 && t < Number.POSITIVE_INFINITY)) continue;
      const x = axis(p, v, acc, tg, w, t)[0];
      const o = x > hi ? x - hi : x < lo ? x - lo : 0;
      if (Math.abs(o) > Math.abs(over)) over = o;
    }
    if (Math.abs(over) < 1e-9) break;
    tg = clamp(tg - over, lo, hi);
  }
  return tg;
}

/** The range of view centers on one axis at a scale, so the view (size /
 * scale) stays inside the bounds, or covers them and stays in the video. */
function range(
  size: number,
  lo: number,
  len: number,
  scale: number,
): [number, number] {
  const half = size / (2 * scale);
  const a = lo + half;
  const z = lo + len - half;
  return [
    Math.max(Math.min(a, z), half),
    Math.min(Math.max(a, z), size - half),
  ];
}

/** Skip ids match an anchor of the same kind within this much of its t0. */
export const SKIP_TOLERANCE_MS = 100;

function parseId(id: string): { kind: string; t: number } {
  const [kind, t] = id.split(":");
  return { kind, t: Number.parseFloat(t) };
}

export function planZoom(
  track: Track,
  settings: Partial<ZoomSettings> = {},
  skipIds: ReadonlySet<string> = new Set(),
): ZoomPlan {
  const set = normalize(settings);
  const mo = MOTION;
  const bounds = boundsOf(track, set.edgeMargin);
  const base = {
    bounds,
    width: track.width,
    height: track.height,
    level: set.level,
    easeInMs: mo.easeInMs,
    easeOutMs: mo.easeOutMs,
    centerTauMs: mo.centerTauMs,
  };
  if (!(track.width > 0 && track.height > 0 && track.durationMs > 0))
    return { segments: [], anchors: [], ...base };
  const s = track.scale > 0 ? track.scale : 1;
  const ctx: Ctx = {
    t: track,
    sm: dejitter(track.samples),
    b: bounds,
    set,
    rd: set.dwellRadiusPt * s,
    rx: set.exitRadiusPt * s,
    ra: set.arrivalMinPt * s,
  };
  const blocked = spans(track.events);
  const candidates = anchorsOf(ctx, mo.easeInMs)
    // No zoom-in during a window change; a zoom holding when one begins leaves.
    .filter(
      (a) =>
        a.start > 0 &&
        !blocked.some(
          ([b0, b1]) => b0 <= a.start + mo.easeInMs && b1 >= a.start,
        ),
    )
    .map((a) => {
      const cut = blocked.find(([b0]) => b0 > a.start && b0 < a.out);
      return cut ? { ...a, out: Math.max(cut[0], a.start + mo.easeInMs) } : a;
    });
  // Skipped anchors go before merging, so the rest re-plan their pans.
  const skips = [...skipIds].map(parseId);
  const seen = new Set<string>();
  const list = candidates.map((a): PlanAnchor => {
    let id = `${a.kind}:${Math.round(a.t0 / 50) * 50}`;
    for (let n = 2; seen.has(id); n++)
      id = `${a.kind}:${Math.round(a.t0 / 50) * 50}~${n}`;
    seen.add(id);
    const off = skips.some(
      (q) => q.kind === a.kind && Math.abs(q.t - a.t0) <= SKIP_TOLERANCE_MS,
    );
    return { id, kind: a.kind, t0: a.t0, x: a.x, y: a.y, enabled: !off };
  });
  const anchors = candidates.filter((_, i) => list[i].enabled);

  // An anchor arriving within minGapMs of the zoom leaving joins it and pans.
  const groups: Anchor[][] = [];
  let leave = Number.NEGATIVE_INFINITY;
  for (const a of anchors) {
    const g = groups[groups.length - 1];
    const across = blocked.some(([b0, b1]) => b1 >= leave && b0 <= a.start);
    if (
      g &&
      !across &&
      (a.pan - leave < set.minGapMs || a.start < leave + mo.easeOutMs)
    ) {
      g.push(a);
      leave = Math.max(leave, a.out);
    } else {
      groups.push([a]);
      leave = a.out;
    }
  }

  const w = 1 / mo.centerTauMs;
  // Bounds clamp the anchors (constants), never the moving center.
  const rx = range(track.width, bounds.x, bounds.w, set.level);
  const ry = range(track.height, bounds.y, bounds.h, set.level);
  const toTarget = (x: number, y: number): [number, number] => [
    clamp(x, ...rx),
    clamp(y, ...ry),
  ];
  const segments: Segment[] = [];
  for (const g of groups) {
    const start = g[0].start;
    const outStart = Math.min(
      Math.max(...g.map((a) => a.out)),
      track.durationMs - mo.easeOutMs,
    );
    if (outStart < start + mo.easeInMs) continue;
    const [x0, y0] = toTarget(g[0].x, g[0].y);
    const keys: Key[] = [
      { t: start, x: x0, y: y0, vx: 0, vy: 0, ax: 0, ay: 0, tx: x0, ty: y0 },
    ];
    const pans = g.slice(1).map((a) => ({ ...a, pan: Math.max(a.pan, start) }));
    pans.sort((a, b) => a.pan - b.pan || a.start - b.start);
    for (const a of pans) {
      if (a.pan >= outStart) break;
      const now = follow(keys[keys.length - 1], a.pan, w);
      const tx = safeTarget(now.x, now.vx, now.ax, a.x, w, ...rx);
      const ty = safeTarget(now.y, now.vy, now.ay, a.y, w, ...ry);
      keys.push({ t: a.pan, ...now, tx, ty });
    }
    segments.push({ start, outStart, end: outStart + mo.easeOutMs, keys });
  }
  return { segments, anchors: list, ...base };
}

/** The zoom amount, 0 (none) to 1 (level), at time t in a segment. */
function amount(plan: ZoomPlan, s: Segment, t: number): number {
  if (t < s.start + plan.easeInMs) return ease((t - s.start) / plan.easeInMs);
  if (t <= s.outStart) return 1;
  return 1 - ease((t - s.outStart) / plan.easeOutMs);
}

/** Keeps a center inside the range for a scale. */
export function clampCenter(
  plan: Pick<ZoomPlan, "bounds" | "width" | "height">,
  scale: number,
  cx: number,
  cy: number,
) {
  const { bounds: b, width: W, height: H } = plan;
  return {
    cx: clamp(cx, ...range(W, b.x, b.w, scale)),
    cy: clamp(cy, ...range(H, b.y, b.h, scale)),
  };
}

export function evaluate(plan: ZoomPlan, t: number): View {
  const rest = { scale: 1, cx: plan.width / 2, cy: plan.height / 2 };
  if (!Number.isFinite(t)) return rest;
  const seg = plan.segments.find((s) => t > s.start && t < s.end);
  if (!seg) return rest;
  const { width: W, height: H, level } = plan;
  const z = amount(plan, seg, t);
  let k = seg.keys[0];
  for (const key of seg.keys) if (key.t <= t) k = key;
  const p = follow(k, t, 1 / plan.centerTauMs);
  // The center moves on the same curve as the scale: from the video center
  // toward p by the zoom amount z. The view (size / scale) stays inside the
  // video for every z, since z (1 - 1/level) <= 1 - 1/scale. No branches.
  return {
    scale: 1 + (level - 1) * z,
    cx: W / 2 + z * (p.x - W / 2),
    cy: H / 2 + z * (p.y - H / 2),
  };
}

/** What the camera is doing at time t, for the debug hook. */
export function phaseAt(plan: ZoomPlan, t: number): Phase {
  const s = plan.segments.find((q) => t > q.start && t < q.end);
  if (!s) return "idle";
  for (let i = s.keys.length - 1; i >= 1; i--) {
    if (s.keys[i].t <= t) {
      if (t < s.keys[i].t + PAN_SETTLE * plan.centerTauMs) return "panning";
      break;
    }
  }
  if (t < s.start + plan.easeInMs) return "entering";
  return t > s.outStart ? "exiting" : "holding";
}

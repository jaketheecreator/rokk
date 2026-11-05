import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clampCenter,
  DEFAULTS,
  dejitter,
  ease,
  evaluate,
  MOTION,
  normalize,
  PAN_SETTLE,
  phaseAt,
  planZoom,
  type Track,
  type ZoomPlan,
  type ZoomSettings,
} from "./algo";

/** The suites below predate the "Zoom on" mode and the arrival rule: they
 * plan with pauses on, any rest counting as an arrival and no idle cap. The
 * "triggers" suite tests the real defaults. */
const LEGACY = {
  mode: "clicks-pauses",
  arrivalMinPt: 0,
  idleCapMs: Number.POSITIVE_INFINITY,
} as const;
const legacy = (
  t: Track,
  s: Partial<ZoomSettings> = {},
  skip?: ReadonlySet<string>,
) => planZoom(t, { ...LEGACY, ...s }, skip);
type S = [number, number, number];
const W = 2000;
const H = 1200;
const IN = MOTION.easeInMs;
const OUT = MOTION.easeOutMs;

/** Samples every 33 ms at (x, y) from t0 to t1, plus optional jitter. */
function rest(t0: number, t1: number, x: number, y: number, jitter = 0): S[] {
  const out: S[] = [];
  for (let t = t0, i = 0; t <= t1; t += 33, i++)
    out.push([t, x + (i % 2 ? jitter : -jitter), y]);
  return out;
}
/** A steady move from (x0, y0) to (x1, y1). */
function move(
  t0: number,
  t1: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): S[] {
  const out: S[] = [];
  const n = Math.max(1, Math.round((t1 - t0) / 33));
  for (let i = 0; i <= n; i++)
    out.push([t0 + i * 33, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  return out;
}
function track(samples: S[], more: Partial<Track> = {}): Track {
  return {
    width: W,
    height: H,
    scale: 2,
    frame: null,
    samples,
    clicks: [],
    events: [],
    durationMs: 20000,
    ...more,
  };
}
/** Circles 250 px around (700, 500) once every 1.3 s: never rests, even
 * after the de-jitter. */
const zig = (t0: number, t1: number) => {
  const out: S[] = [];
  for (let t = t0; t <= t1; t += 33) {
    const a = ((t - t0) / 1300) * 2 * Math.PI;
    out.push([t, 700 + 250 * Math.cos(a), 500 + 250 * Math.sin(a)]);
  }
  return out;
};
const peak = (p: ZoomPlan, i = 0) =>
  evaluate(p, (p.segments[i].start + IN + p.segments[i].outStart) / 2);

/** Largest value step and velocity change between samples `dt` apart. */
function motion(p: ZoomPlan, t0: number, t1: number, dt: number) {
  let a = evaluate(p, t0);
  let b = evaluate(p, t0 + dt);
  let step = {
    scale: Math.abs(b.scale - a.scale),
    center: Math.hypot(b.cx - a.cx, b.cy - a.cy),
  };
  let jump = { scale: 0, center: 0 };
  for (let t = t0 + 2 * dt; t <= t1; t += dt) {
    const c = evaluate(p, t);
    step = {
      scale: Math.max(step.scale, Math.abs(c.scale - b.scale)),
      center: Math.max(step.center, Math.hypot(c.cx - b.cx, c.cy - b.cy)),
    };
    jump = {
      scale: Math.max(jump.scale, Math.abs(c.scale - 2 * b.scale + a.scale)),
      center: Math.max(
        jump.center,
        Math.hypot(c.cx - 2 * b.cx + a.cx, c.cy - 2 * b.cy + a.cy),
      ),
    };
    a = b;
    b = c;
  }
  return { step, jump };
}

/** Center path length and per-axis velocity sign changes between moving
 * steps over [t0, t1]. A still step (under eps px) ends a motion, so going
 * in, holding still and coming back out is not a reversal. */
function path(
  p: ZoomPlan,
  t0: number,
  t1: number,
  dt = 1000 / 120,
  eps = 1e-6,
) {
  let prev = evaluate(p, t0);
  let length = 0;
  let flips = 0;
  let lo = { x: prev.cx, y: prev.cy };
  let hi = { ...lo };
  const dir = { x: 0, y: 0 };
  for (let t = t0 + dt; t <= t1; t += dt) {
    const v = evaluate(p, t);
    const dx = v.cx - prev.cx;
    const dy = v.cy - prev.cy;
    length += Math.hypot(dx, dy);
    for (const [k, d] of [
      ["x", dx],
      ["y", dy],
    ] as const) {
      const sgn = Math.abs(d) > eps ? Math.sign(d) : 0;
      if (sgn && dir[k] && sgn !== dir[k]) flips++;
      dir[k] = sgn;
    }
    lo = { x: Math.min(lo.x, v.cx), y: Math.min(lo.y, v.cy) };
    hi = { x: Math.max(hi.x, v.cx), y: Math.max(hi.y, v.cy) };
    prev = v;
  }
  return { length, flips, spread: Math.hypot(hi.x - lo.x, hi.y - lo.y) };
}

/** Three rests with pans, a far move and a click: every kind of boundary. */
const busy = () =>
  track(
    [
      ...rest(0, 2000, 300, 200),
      ...move(2033, 2300, 300, 200, 1700, 1000),
      ...rest(2333, 4500, 1700, 1000),
      ...move(4533, 5000, 1700, 1000, 100, 1100),
      ...zig(5033, 7000),
      ...rest(7033, 12000, 1000, 600),
    ],
    { clicks: [[10500, 1000, 600, 0]], durationMs: 14000 },
  );

describe("planZoom basics", () => {
  it("an empty track gives no zoom", () => {
    const p = legacy(track([]));
    expect(p.segments).toEqual([]);
    expect(evaluate(p, 5000)).toEqual({ scale: 1, cx: W / 2, cy: H / 2 });
  });

  it("a zero-size or zero-length video gives no zoom", () => {
    expect(
      legacy(track(rest(0, 5000, 500, 500), { width: 0 })).segments,
    ).toEqual([]);
    expect(
      legacy(track(rest(0, 5000, 500, 500), { durationMs: 0 })).segments,
    ).toEqual([]);
  });

  it("a mouse that never rests gives no zoom", () => {
    expect(legacy(track(zig(0, 10000))).segments).toEqual([]);
  });

  it("one rest zooms in after dwellMs and the hold is capped at 1.5 s after the zoom-in", () => {
    const p = legacy(track(rest(0, 10000, 800, 500)));
    expect(p.segments).toHaveLength(1);
    const s = p.segments[0];
    expect(s.start).toBe(1000);
    expect(s.outStart).toBe(1000 + IN + 1500);
    expect(s.end).toBe(1000 + IN + 1500 + OUT);
    expect(evaluate(p, 999).scale).toBe(1);
    expect(evaluate(p, 2000).scale).toBe(1.8);
    expect(evaluate(p, s.end + 1).scale).toBe(1);
  });

  it("a still mouse does not zoom again after the hold (one rest, one zoom)", () => {
    expect(legacy(track(rest(0, 15000, 800, 500))).segments).toHaveLength(1);
  });

  it("the anchor center is the median of the rest's samples", () => {
    const samples = rest(0, 2000, 800, 500);
    samples[3] = [samples[3][0], 840, 530];
    expect(legacy(track(samples)).segments[0].keys[0]).toMatchObject({
      x: 800,
      y: 500,
    });
  });

  it("no zoom is active at the very start, even if the mouse rests from time 0", () => {
    const p = legacy(track(rest(0, 5000, 600, 600)));
    expect(evaluate(p, 0).scale).toBe(1);
    expect(evaluate(p, 500).scale).toBe(1);
  });

  it("at the end of the video the zoom has eased out", () => {
    const p = legacy(track(rest(0, 2600, 800, 600), { durationMs: 2600 }));
    expect(p.segments[0].end).toBeLessThanOrEqual(2600);
    expect(evaluate(p, 2600).scale).toBe(1);
  });

  it("a rest too close to the end for a full zoom is dropped", () => {
    expect(
      legacy(track(rest(0, 1500, 600, 500), { durationMs: 1500 })).segments,
    ).toEqual([]);
  });
});

describe("fast exit", () => {
  it("leaves 120 ms after the cursor leaves the exit radius", () => {
    const p = legacy(
      track([
        ...rest(0, 2000, 800, 500),
        ...move(2033, 2600, 1100, 500, 1900, 1100),
      ]),
    );
    const s = p.segments[0];
    expect(s.outStart).toBe(2033 + 120);
    expect(evaluate(p, s.outStart + OUT).scale).toBe(1);
    // The ease-out starts at once (gently) and is half way at 350 ms.
    expect(evaluate(p, 2033 + 120 + 60).scale).toBeLessThan(1.8);
    expect(evaluate(p, 2033 + 120 + 350).scale).toBeCloseTo(1.4, 9);
  });

  it("a brief excursion shorter than 120 ms is not an exit", () => {
    const samples = rest(0, 2400, 800, 500);
    samples[50] = [samples[50][0], 1000, 500];
    const p = legacy(track(samples));
    expect(p.segments[0].outStart).toBe(1000 + IN + 1500);
  });

  it("small moves inside the exit radius keep the zoom", () => {
    const p = legacy(track(rest(0, 2400, 800, 500, 30)));
    expect(p.segments[0].outStart).toBe(1000 + IN + 1500);
  });

  it("a move just past the exit radius (36 points, 72 px) leaves", () => {
    // 200 ms just past the radius, then moving on (no new rest to pan to).
    const p = legacy(
      track([
        ...rest(0, 2000, 800, 500),
        ...rest(2033, 2233, 873, 500),
        ...zig(2266, 5000),
      ]),
    );
    expect(p.segments[0].outStart).toBe(2033 + 120);
    const stay = legacy(
      track([...rest(0, 2000, 800, 500), ...rest(2033, 4000, 871, 500)]),
    );
    expect(stay.segments[0].outStart).toBe(1000 + IN + 1500);
  });

  it("leaving during the zoom-in finishes the zoom-in first, then leaves", () => {
    const p = legacy(
      track([
        ...rest(0, 1100, 800, 500),
        ...move(1133, 1600, 1100, 500, 1900, 1100),
      ]),
    );
    expect(p.segments[0].outStart).toBe(1000 + IN);
  });

  it("the mouse leaving the frame or the window is an exit", () => {
    const frame = { x: 400, y: 300, w: 1000, h: 600 };
    const out = legacy(
      track([...rest(0, 2000, 800, 500), ...rest(2033, 4000, 100, 100)], {
        frame,
      }),
    );
    expect(out.segments[0].outStart).toBe(2033 + 120);
    const gap = legacy(track([...rest(0, 2000, 800, 500), ...zig(3000, 6000)]));
    expect(gap.segments[0].outStart).toBe(1980 + 120); // the last sample before the gap
  });

  it("no rule keeps the zoom without a rest or a click", () => {
    const p = legacy(track([...rest(0, 2000, 800, 500), ...zig(2033, 9000)]));
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].end).toBeLessThan(2033 + 120 + OUT + 1);
  });
});

describe("clicks", () => {
  it("a click anchors a zoom after clickLeadMs, held 1.5 s after its zoom-in", () => {
    const p = legacy(
      track(rest(0, 6000, 900, 700), { clicks: [[300, 900, 700, 0]] }),
    );
    expect(p.segments[0].start).toBe(300 + DEFAULTS.clickLeadMs);
    expect(p.segments[0].outStart).toBe(550 + IN + 1500);
  });

  it("a click inside the radius restarts the hold", () => {
    const p = legacy(
      track(rest(0, 10000, 700, 500), { clicks: [[2500, 710, 500, 0]] }),
    );
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].outStart).toBe(2500 + 1500);
  });

  it("a click elsewhere ends this zoom and pans to the click", () => {
    const samples = [
      ...rest(0, 2000, 700, 500),
      [2033, 1200, 700] as S,
      ...rest(2066, 6000, 1200, 700),
    ];
    const p = legacy(track(samples, { clicks: [[2050, 1200, 700, 0]] }));
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].keys[1]).toMatchObject({
      t: 2050 + DEFAULTS.clickLeadMs,
      tx: 1200,
      ty: 700,
    });
  });

  it("clicks outside the frame are ignored", () => {
    const frame = { x: 200, y: 200, w: 1000, h: 600 };
    expect(
      legacy(track(zig(0, 5000), { frame, clicks: [[1000, 1500, 100, 0]] }))
        .segments,
    ).toEqual([]);
  });
});

describe("rests", () => {
  it("jitter inside the dwell radius still counts as resting", () => {
    expect(legacy(track(rest(0, 3000, 800, 600, 25))).segments).toHaveLength(1);
  });

  it("a drift that covers the dwell radius within the dwell is movement", () => {
    // 70 px per second against a 60 px radius (30 points on Retina).
    const samples: S[] = [];
    for (let t = 0; t <= 4000; t += 33) samples.push([t, 300 + 0.07 * t, 600]);
    expect(legacy(track(samples)).segments).toEqual([]);
    const one: S[] = [];
    for (let t = 0; t <= 4000; t += 33) one.push([t, 300 + 0.035 * t, 600]);
    expect(legacy(track(one, { scale: 1 })).segments).toEqual([]);
  });

  it("fast jitter larger than the dwell radius is removed and counts as resting", () => {
    const samples: S[] = [];
    for (let t = 0, i = 0; t <= 4000; t += 33, i++)
      samples.push([t, 800 + (i % 2) * 61, 600]);
    expect(legacy(track(samples)).segments).toHaveLength(1);
  });

  it("a mouse outside the frame never anchors and breaks a rest", () => {
    const frame = { x: 400, y: 300, w: 1000, h: 600 };
    expect(legacy(track(rest(0, 4000, 100, 100), { frame })).segments).toEqual(
      [],
    );
    const broken = [
      ...rest(0, 700, 800, 500),
      [733, 100, 100] as S,
      ...rest(766, 1500, 800, 500),
    ];
    expect(legacy(track(broken, { frame })).segments).toEqual([]);
  });

  it("a gap in the samples breaks a rest", () => {
    expect(
      legacy(track([...rest(0, 600, 800, 500), ...rest(1200, 1800, 800, 500)]))
        .segments,
    ).toEqual([]);
  });
});

describe("merging", () => {
  const twoNear = () => [
    ...rest(0, 2000, 700, 600),
    ...move(2033, 2300, 700, 600, 1400, 800),
    ...rest(2333, 6000, 1400, 800),
  ];

  it("a rest arriving within minGap of the exit pans with no zoom-out", () => {
    const p = legacy(track(twoNear()));
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].keys).toHaveLength(2);
    for (let t = 1000 + IN; t <= p.segments[0].outStart; t += 10)
      expect(evaluate(p, t).scale).toBe(1.8);
    expect(evaluate(p, 2000).cx).toBeCloseTo(700, 5);
    expect(evaluate(p, p.segments[0].outStart).cx).toBeCloseTo(1400, 0);
  });

  it("the merged pan uses the same smoothing (no step in the center)", () => {
    const p = legacy(track(twoNear()));
    expect(motion(p, 0, 7000, 1).jump.center).toBeLessThan(0.15);
  });

  it("rests farther apart than minGap zoom out and in again", () => {
    const samples = [
      ...rest(0, 2000, 500, 400),
      ...zig(2033, 5000),
      ...rest(5033, 7500, 1500, 900),
    ];
    const p = legacy(track(samples));
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0].end).toBeLessThan(p.segments[1].start);
    expect(
      evaluate(p, (p.segments[0].end + p.segments[1].start) / 2).scale,
    ).toBe(1);
  });

  it("segments never overlap and are in time order", () => {
    const s: S[] = [];
    for (let k = 0; k < 6; k++)
      s.push(
        ...rest(k * 3000, k * 3000 + 1800, 300 + k * 200, 300 + k * 100),
        ...zig(k * 3000 + 1833, k * 3000 + 2967),
      );
    const p = legacy(track(s), { minGapMs: 100 });
    for (let i = 1; i < p.segments.length; i++)
      expect(p.segments[i].start).toBeGreaterThanOrEqual(p.segments[i - 1].end);
  });
});

describe("bounds", () => {
  it("frame null uses the whole video; a frame rectangle limits it", () => {
    expect(boundsOf({ width: W, height: H, frame: null })).toEqual({
      x: 0,
      y: 0,
      w: W,
      h: H,
    });
    expect(
      boundsOf({
        width: W,
        height: H,
        frame: { x: 100, y: 50, w: 1000, h: 600 },
      }),
    ).toEqual({ x: 100, y: 50, w: 1000, h: 600 });
    expect(
      boundsOf({
        width: W,
        height: H,
        frame: { x: 1500, y: 1000, w: 1000, h: 600 },
      }),
    ).toEqual({ x: 1500, y: 1000, w: 500, h: 200 });
    expect(
      boundsOf({ width: W, height: H, frame: { x: 0, y: 0, w: 0, h: 0 } }),
    ).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(boundsOf({ width: W, height: H, frame: null }, 10)).toEqual({
      x: 10,
      y: 10,
      w: W - 20,
      h: H - 20,
    });
  });

  const corners: [string, number, number][] = [
    ["top left", 0, 0],
    ["top", W / 2, 0],
    ["top right", W, 0],
    ["right", W, H / 2],
    ["bottom right", W, H],
    ["bottom", W / 2, H],
    ["bottom left", 0, H],
    ["left", 0, H / 2],
  ];
  for (const [name, x, y] of corners) {
    it(`the view stays inside the video at the ${name}, all the way in and out`, () => {
      const p = legacy(track(rest(0, 4000, x, y)));
      for (let t = 0; t < 6000; t += 7) {
        const v = evaluate(p, t);
        const hw = W / (2 * v.scale);
        const hh = H / (2 * v.scale);
        expect(v.cx - hw).toBeGreaterThanOrEqual(-1e-6);
        expect(v.cx + hw).toBeLessThanOrEqual(W + 1e-6);
        expect(v.cy - hh).toBeGreaterThanOrEqual(-1e-6);
        expect(v.cy + hh).toBeLessThanOrEqual(H + 1e-6);
      }
    });
  }

  it("the view stays inside a frame rectangle at its corners", () => {
    const frame = { x: 200, y: 100, w: 1600, h: 1000 };
    for (const [x, y] of [
      [200, 100],
      [1800, 100],
      [1800, 1100],
      [200, 1100],
    ]) {
      const v = peak(legacy(track(rest(0, 4000, x, y), { frame })));
      expect(v.scale).toBe(1.8);
      expect(v.cx - W / (2 * v.scale)).toBeGreaterThanOrEqual(200 - 1e-6);
      expect(v.cx + W / (2 * v.scale)).toBeLessThanOrEqual(1800 + 1e-6);
      expect(v.cy - H / (2 * v.scale)).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(v.cy + H / (2 * v.scale)).toBeLessThanOrEqual(1100 + 1e-6);
    }
  });

  it("clamping at a frame edge gives no oscillation: the center moves one way in and one way out", () => {
    // The old placement switched clamp branches as the scale changed and reversed here.
    for (const frame of [
      { x: 278, y: 160, w: 1400, h: 860 },
      { x: 600, y: 100, w: 1300, h: 1000 },
      { x: 900, y: 500, w: 200, h: 200 },
    ]) {
      for (const [x, y] of [
        [frame.x + 5, frame.y + 5],
        [frame.x + frame.w - 5, frame.y + frame.h - 5],
      ]) {
        const p = legacy(track(rest(0, 6000, x, y), { frame }));
        const s = p.segments[0];
        expect(path(p, s.start, s.start + IN, 1).flips).toBe(0);
        expect(path(p, s.outStart, s.end, 1).flips).toBe(0);
        expect(path(p, s.start - 10, s.end + 10, 1).flips).toBe(0);
      }
    }
  });

  it("the view inside the video at every scale also with a frame, and inside the frame at full level", () => {
    const frame = { x: 278, y: 160, w: 1400, h: 860 };
    const p = legacy(track(rest(0, 6000, 290, 170), { frame }));
    for (let t = 0; t < 7000; t += 5) {
      const v = evaluate(p, t);
      expect(v.cx - W / (2 * v.scale)).toBeGreaterThanOrEqual(-1e-6);
      expect(v.cy + H / (2 * v.scale)).toBeLessThanOrEqual(H + 1e-6);
    }
    const v = peak(p);
    expect(v.cx - W / (2 * v.scale)).toBeGreaterThanOrEqual(frame.x - 1e-6);
    expect(v.cy - H / (2 * v.scale)).toBeGreaterThanOrEqual(frame.y - 1e-6);
  });

  it("a view larger than the frame covers it and stays inside the video", () => {
    const plan = {
      bounds: { x: 900, y: 500, w: 200, h: 200 },
      width: W,
      height: H,
    };
    const c = clampCenter(plan, 1.2, 0, 0);
    const hw = W / 2.4;
    expect(c.cx - hw).toBeLessThanOrEqual(900);
    expect(c.cx + hw).toBeGreaterThanOrEqual(1100);
    expect(c.cx - hw).toBeGreaterThanOrEqual(0);
    expect(clampCenter(plan, 1, 0, 0)).toEqual({ cx: W / 2, cy: H / 2 });
  });
});

describe("window changes", () => {
  it("no zoom starts during a window change, and an active one leaves", () => {
    expect(
      legacy(track(rest(0, 4000, 600, 600), { events: [1200] })).segments,
    ).toEqual([]);
    const p = legacy(track(rest(0, 6000, 600, 600), { events: [2600] }));
    expect(p.segments[0].outStart).toBe(2100);
  });

  it("zooms on both sides of a window change are never merged into one pan", () => {
    const samples = [
      ...rest(0, 2000, 500, 400),
      ...rest(2033, 6000, 1500, 900),
    ];
    for (const s of legacy(track(samples, { events: [2600] })).segments)
      expect(s.keys).toHaveLength(1);
  });
});

describe("de-jitter", () => {
  it("keeps times, keeps a still cursor exactly, and drops a single outlier", () => {
    const s = rest(0, 1000, 800, 500);
    s[10] = [s[10][0], 1400, 900];
    const d = dejitter(s);
    expect(d.map((q) => q[0])).toEqual(s.map((q) => q[0]));
    for (const q of d) expect([q[1], q[2]]).toEqual([800, 500]);
    expect(dejitter([])).toEqual([]);
  });

  it("damps 20 px jitter at 30 Hz to a few px", () => {
    const d = dejitter(rest(0, 2000, 800, 500, 20));
    // Past the start; the last two samples use shorter median windows.
    for (const q of d.slice(10, -2))
      expect(Math.abs(q[1] - 800)).toBeLessThan(6);
  });

  it("restarts after a gap instead of smoothing across it", () => {
    const d = dejitter([
      ...rest(0, 500, 800, 500),
      ...rest(1000, 1500, 1600, 900),
    ]);
    const after = d.find((q) => q[0] === 1000);
    expect(after).toEqual([1000, 1600, 900]);
  });
});

/** The old Smooth curve (before 2026-11-05), kept as a reference: an
 * exponential approach blended into smootherstep, 450 ms in and 500 ms out
 * with time constants of 110 ms. It is C1 but not C2. */
function oldEase(u: number, k: number) {
  const x = Math.min(1, Math.max(0, u));
  const g = 1 - (1 + k * x) * Math.exp(-k * x);
  return g + (1 - g) * x * x * x * (x * (x * 6 - 15) + 10);
}

/** Largest third difference of scale and center (an acceleration jump
 * shows here as a spike) and largest step, sampled every dt ms. */
function jerk(p: ZoomPlan, t0: number, t1: number, dt: number) {
  const v: ReturnType<typeof evaluate>[] = [];
  for (let t = t0; t <= t1; t += dt) v.push(evaluate(p, t));
  let scale = 0;
  let center = 0;
  for (let i = 3; i < v.length; i++) {
    const [a, b, c, d] = [v[i - 3], v[i - 2], v[i - 1], v[i]];
    scale = Math.max(
      scale,
      Math.abs(d.scale - 3 * c.scale + 3 * b.scale - a.scale),
    );
    center = Math.max(
      center,
      Math.hypot(
        d.cx - 3 * c.cx + 3 * b.cx - a.cx,
        d.cy - 3 * c.cy + 3 * b.cy - a.cy,
      ),
    );
  }
  return { scale, center };
}

describe("a still camera during holds", () => {
  it("20 px jitter at 30 Hz moves the held center under 1 px in total", () => {
    const p = legacy(track(rest(0, 5000, 800, 500, 20)));
    const s = p.segments[0];
    expect(path(p, s.start + IN, s.outStart, 1000 / 60).length).toBeLessThan(1);
  });

  it("the anchor is fixed once for the whole zoom", () => {
    const p = legacy(
      track(rest(0, 5000, 800, 500, 20), {
        frame: { x: 278, y: 160, w: 1400, h: 860 },
      }),
    );
    const s = p.segments[0];
    expect(s.keys).toHaveLength(1);
    expect(s.keys[0].tx).toBe(s.keys[0].x);
    const a = evaluate(p, s.start + IN);
    const b = evaluate(p, s.outStart);
    expect([b.cx, b.cy]).toEqual([a.cx, a.cy]);
  });

  it("the center varies under 2 px over any hold, and never reverses inside a segment without a new anchor", () => {
    const frame = { x: 278, y: 160, w: 1400, h: 860 };
    for (const [x, y] of [
      [300, 180],
      [1650, 1000],
      [1000, 600],
      [1600, 200],
    ]) {
      for (const t of [
        track(rest(0, 5000, x, y, 20)),
        track(rest(0, 5000, x, y, 20), { frame }),
      ]) {
        const p = legacy(t);
        const s = p.segments[0];
        expect(path(p, s.start + IN, s.outStart).spread).toBeLessThan(2);
        expect(path(p, s.start - 50, s.end + 50, 1).flips).toBe(0);
      }
    }
  });

  it("the pan from one anchor to the next is monotonic in each axis", () => {
    const frame = { x: 278, y: 160, w: 1400, h: 860 };
    const samples = [
      ...rest(0, 2000, 400, 300, 15),
      ...move(2033, 2300, 400, 300, 1500, 900),
      ...rest(2333, 6000, 1500, 900, 15),
    ];
    const p = legacy(track(samples, { frame }));
    const s = p.segments[0];
    expect(s.keys).toHaveLength(2);
    const k = s.keys[1];
    expect(phaseAt(p, k.t + 1)).toBe("panning");
    expect(phaseAt(p, k.t + PAN_SETTLE * MOTION.centerTauMs + 1)).toBe(
      "holding",
    );
    expect(path(p, k.t, s.outStart, 1).flips).toBe(0);
  });

  it("pans chained faster than the follower settles stay inside the range", () => {
    const clicks = [
      [1000, 1900, 1100, 0],
      [1300, 100, 100, 0],
      [1600, 1900, 100, 0],
      [1900, 100, 1100, 0],
    ];
    const samples = [...rest(0, 6000, 1000, 600)];
    const p = legacy(track(samples, { clicks }));
    for (let t = 0; t < 8000; t += 3) {
      const v = evaluate(p, t);
      expect(v.cx - W / (2 * v.scale)).toBeGreaterThanOrEqual(-1e-6);
      expect(v.cx + W / (2 * v.scale)).toBeLessThanOrEqual(W + 1e-6);
      expect(v.cy - H / (2 * v.scale)).toBeGreaterThanOrEqual(-1e-6);
      expect(v.cy + H / (2 * v.scale)).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  it("phases: idle, entering, holding, exiting", () => {
    const p = legacy(track(rest(0, 8000, 800, 500)));
    const s = p.segments[0];
    expect(phaseAt(p, 500)).toBe("idle");
    expect(phaseAt(p, s.start + 10)).toBe("entering");
    expect(phaseAt(p, s.start + IN + 10)).toBe("holding");
    expect(phaseAt(p, s.outStart + 10)).toBe("exiting");
    expect(phaseAt(p, s.end + 10)).toBe("idle");
  });
});

describe("the one motion", () => {
  it("is 600 ms in, 700 ms out, with a 170 ms pan time constant", () => {
    expect(MOTION).toEqual({ easeInMs: 600, easeOutMs: 700, centerTauMs: 170 });
    const p = legacy(track(rest(0, 8000, 1000, 600)));
    expect([p.easeInMs, p.easeOutMs, p.centerTauMs]).toEqual([600, 700, 170]);
    expect(Object.keys(normalize())).not.toContain("feel");
  });

  it("the ease lands exactly with zero speed and zero acceleration at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    const h = 1e-4;
    for (const u of [0, 1]) {
      const v = (ease(u + h) - ease(u - h)) / (2 * h);
      const a = (ease(u + h) - 2 * ease(u) + ease(u - h)) / (h * h);
      expect(Math.abs(v)).toBeLessThan(1e-6);
      expect(Math.abs(a)).toBeLessThan(1e-2);
    }
    for (let u = 0; u < 1; u += 0.01)
      expect(ease(u + 0.01)).toBeGreaterThanOrEqual(ease(u));
  });

  it("reaches the exact level and returns exactly to 1", () => {
    const p = legacy(track(rest(0, 8000, 1000, 600)));
    const s = p.segments[0];
    expect(evaluate(p, s.start + IN).scale).toBe(1.8);
    expect(evaluate(p, s.outStart).scale).toBe(1.8);
    expect(evaluate(p, s.end).scale).toBe(1);
    expect(s.end - s.outStart).toBe(OUT);
  });

  it("scale and center start and stop together, with zero speed and acceleration at every ease boundary", () => {
    const p = legacy(track(rest(0, 8000, 400, 300)));
    const s = p.segments[0];
    for (const tb of [s.start, s.start + IN, s.outStart, s.end]) {
      for (const dir of [-1, 1]) {
        const at = (k: number) => evaluate(p, tb + dir * k);
        const [a, b, c] = [at(0), at(1), at(2)];
        // Over 1 ms either side: no speed (first difference) and no
        // acceleration (second difference), for both scale and center.
        expect(Math.abs(b.scale - a.scale)).toBeLessThan(1e-6);
        expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeLessThan(1e-3);
        expect(Math.abs(c.scale - 2 * b.scale + a.scale)).toBeLessThan(1e-6);
        expect(
          Math.hypot(c.cx - 2 * b.cx + a.cx, c.cy - 2 * b.cy + a.cy),
        ).toBeLessThan(1e-3);
      }
    }
    // Half way through the zoom-in, the center is half way too.
    const mid = evaluate(p, s.start + IN / 2);
    expect(mid.scale).toBeCloseTo(1.4, 9);
    expect((mid.cx - W / 2) / (s.keys[0].x - W / 2)).toBeCloseTo(0.5, 9);
  });

  it("continuous in value and velocity at every boundary (1 ms steps)", () => {
    const p = legacy(busy(), { level: 3 });
    expect(p.segments.length).toBeGreaterThan(0);
    const m = motion(p, 0, 14000, 1);
    expect(m.step.scale).toBeLessThan(0.03);
    expect(m.jump.scale).toBeLessThan(m.step.scale / 10);
    expect(m.jump.center).toBeLessThan(m.step.center / 10);
    expect(m.jump.scale).toBeLessThan(2e-3);
    expect(m.jump.center).toBeLessThan(1.5);
  });

  it("continuous in acceleration at 120 Hz: no jumps at any boundary", () => {
    for (const level of [1.8, 3]) {
      const p = legacy(busy(), { level });
      const j = jerk(p, 0, 14000, 1000 / 120);
      // A C2 motion's third difference is bounded by its jerk; an
      // acceleration jump would add about a whole acceleration step.
      expect(j.scale).toBeLessThan(1.5e-4 * (level - 1));
      expect(j.center).toBeLessThan(0.4);
    }
    // The old curve, at the same level and frame rate, jumps at its start.
    const dt = 1000 / 120;
    const old = (k: number) => 0.8 * oldEase((k * dt) / 450, 450 / 110);
    const oldJump = Math.abs(old(1) - 3 * old(0) + 3 * old(-1) - old(-2));
    expect(oldJump).toBeGreaterThan(10 * 1.5e-4 * 0.8);
  });

  it("peak velocity is at least 25 percent lower than the old Smooth curve", () => {
    const p = legacy(track(rest(0, 8000, 400, 300)));
    const s = p.segments[0];
    const L = p.level;
    const d = s.keys[0].x - W / 2;
    const peak = (f: (t: number) => number, t0: number, t1: number) => {
      let m = 0;
      for (let t = t0; t < t1; t += 0.25)
        m = Math.max(m, Math.abs(f(t + 0.25) - f(t)) / 0.25);
      return m;
    };
    const newIn = peak((t) => evaluate(p, t).scale, s.start, s.start + IN);
    const newOut = peak((t) => evaluate(p, t).scale, s.outStart, s.end);
    const oldIn = peak(
      (t) => 1 + (L - 1) * oldEase(t / 450, 450 / 110),
      0,
      450,
    );
    const oldOut = peak(
      (t) => 1 + (L - 1) * oldEase(t / 500, 500 / 110),
      0,
      500,
    );
    expect(newIn).toBeLessThanOrEqual(0.75 * oldIn);
    expect(newOut).toBeLessThanOrEqual(0.75 * oldOut);
    // The center during the zoom-in: the old one zoomed about a fixed point.
    const newC = peak((t) => evaluate(p, t).cx, s.start, s.start + IN);
    const oldC = peak(
      (t) => {
        const sc = 1 + (L - 1) * oldEase(t / 450, 450 / 110);
        return W / 2 + ((1 - 1 / sc) / (1 - 1 / L)) * d;
      },
      0,
      450,
    );
    expect(newC).toBeLessThanOrEqual(0.75 * oldC);
    // Pans: third order with tau 170 against second order with tau 140,
    // peaks e0 w 2 e^-2 and e0 w / e.
    expect((2 * Math.exp(-2)) / 170 / (1 / (Math.E * 140))).toBeLessThan(0.75);
  });

  it("no direction reversals through a busy recording without a new anchor", () => {
    const p = legacy(track(rest(0, 9000, 300, 900)));
    expect(path(p, 0, 9000, 1).flips).toBe(0);
  });
});

describe("settings", () => {
  it("settings are clamped to their ranges", () => {
    expect(normalize({ level: 10, dwellMs: 50, holdMs: 100 })).toMatchObject({
      level: 3,
      dwellMs: 400,
      holdMs: 300,
    });
    expect(
      normalize({ level: 0.5, dwellMs: 99999, holdMs: 99999 }),
    ).toMatchObject({ level: 1.2, dwellMs: 2500, holdMs: 6000 });
  });

  it("the level extremes set the zoom depth", () => {
    const s = rest(0, 4000, 1000, 600);
    expect(peak(legacy(track(s), { level: 1.2 })).scale).toBeCloseTo(1.2, 9);
    expect(peak(legacy(track(s), { level: 3 })).scale).toBeCloseTo(3, 9);
  });

  it("the dwell extremes change when the zoom starts and whether it happens", () => {
    const s = [...rest(0, 1500, 1000, 600), ...zig(1533, 6000)];
    expect(legacy(track(s), { dwellMs: 400 }).segments[0].start).toBe(400);
    expect(legacy(track(s), { dwellMs: 2500 }).segments).toEqual([]);
  });

  for (const hold of [300, 500, 6000]) {
    it(`a ${hold / 1000} s hold starts the exit ${hold} ms after the zoom-in, shorter than the eases too`, () => {
      const p = legacy(track(rest(0, 12000, 1000, 600)), { holdMs: hold });
      const s = p.segments[0];
      expect(s.outStart).toBe(1000 + IN + hold);
      expect(evaluate(p, s.start + IN).scale).toBe(1.8);
      expect(evaluate(p, s.outStart + 1).scale).toBeLessThan(1.8);
      expect(evaluate(p, s.end).scale).toBe(1);
      expect(jerk(p, 0, 12000, 1000 / 120).scale).toBeLessThan(1.5e-4 * 0.8);
    });
  }

  for (const hold of [300, 500]) {
    it(`a ${hold / 1000} s hold: a new rest arriving during the exit pans there with no dip`, () => {
      // The first exit would start at 1000 + IN + hold; the mouse moves on
      // and rests again while that exit would still be running.
      const leave = 1000 + IN + hold + 200;
      const samples = [
        ...rest(0, leave, 600, 500),
        ...move(leave + 33, leave + 200, 600, 500, 1300, 700),
        ...rest(leave + 233, leave + 5000, 1300, 700),
      ];
      const p = legacy(track(samples), { holdMs: hold });
      expect(p.segments).toHaveLength(1);
      const s = p.segments[0];
      expect(s.keys).toHaveLength(2);
      for (let t = s.start + IN; t <= s.outStart; t += 10)
        expect(evaluate(p, t).scale).toBe(1.8);
      const j = jerk(p, 0, leave + 5000, 1000 / 120);
      expect(j.center).toBeLessThan(0.4);
    });
  }

  it("is deterministic", () => {
    const t = busy();
    expect(legacy(t)).toEqual(legacy(t));
    expect(dejitter(t.samples)).toEqual(dejitter(structuredClone(t.samples)));
    expect(JSON.stringify(legacy(t, { holdMs: 300 }))).toBe(
      JSON.stringify(legacy(structuredClone(t), { holdMs: 300 })),
    );
  });

  it("before the first sample and after the last the view rests", () => {
    const p = legacy(track(rest(1000, 4000, 600, 500), { durationMs: 12000 }));
    expect(evaluate(p, -500)).toEqual({ scale: 1, cx: W / 2, cy: H / 2 });
    expect(evaluate(p, 500).scale).toBe(1);
    expect(evaluate(p, 11000)).toEqual({ scale: 1, cx: W / 2, cy: H / 2 });
    expect(evaluate(p, Number.NaN)).toEqual({ scale: 1, cx: W / 2, cy: H / 2 });
  });
});

describe("triggers: Zoom on mode, arrival, idle cap, ids and skips", () => {
  const PAUSES = { mode: "clicks-pauses" } as const;
  /** The cursor is moved 540 px to (800, 500), then rests there. */
  const arrive = (t1 = 8000) => [
    ...move(0, 600, 300, 300, 800, 500),
    ...rest(633, t1, 800, 500),
  ];

  it("the default mode is Clicks", () => {
    expect(DEFAULTS.mode).toBe("clicks");
    expect(DEFAULTS).toMatchObject({
      arrivalMinPt: 80,
      arrivalWindowMs: 1500,
      idleCapMs: 4000,
    });
    expect(normalize({ mode: "other" as never }).mode).toBe("clicks");
  });

  it("a cursor parked from t = 0 never makes a pause zoom", () => {
    const p = planZoom(track(rest(0, 8000, 800, 500)), PAUSES);
    expect(p.segments).toEqual([]);
    expect(p.anchors).toEqual([]);
  });

  it("a cursor moved to a spot, then resting, makes one pause zoom", () => {
    const p = planZoom(track(arrive()), PAUSES);
    expect(p.segments).toHaveLength(1);
    expect(p.anchors).toHaveLength(1);
    expect(p.anchors[0]).toMatchObject({ kind: "pause", enabled: true });
    expect(p.anchors[0].t0).toBeGreaterThan(600);
    expect(p.anchors[0].t0).toBeLessThan(1000);
  });

  it("travel under 80 points (160 px on Retina) before a rest is not an arrival", () => {
    const short = [
      ...move(0, 600, 680, 500, 800, 500),
      ...rest(633, 8000, 800, 500),
    ];
    expect(planZoom(track(short), PAUSES).segments).toEqual([]);
    // Jitter alone does not add up to an arrival either.
    expect(
      planZoom(track(rest(0, 8000, 800, 500, 25)), PAUSES).segments,
    ).toEqual([]);
  });

  it("a rest that goes on after its zoom has left never zooms again", () => {
    const p = planZoom(track(arrive(20000)), PAUSES);
    expect(p.segments).toHaveLength(1);
  });

  it("idleCapMs: a pause with no click leaves 4 s after its arrival, even with a long hold", () => {
    const p = planZoom(track(arrive(20000)), { ...PAUSES, holdMs: 6000 });
    expect(p.segments[0].outStart).toBe(p.anchors[0].t0 + 4000);
    // A click inside the radius restarts the hold past the idle cap.
    const t0 = p.anchors[0].t0;
    const click = planZoom(
      track(arrive(20000), { clicks: [[t0 + 3000, 805, 500, 0]] }),
      { ...PAUSES, holdMs: 6000 },
    );
    expect(click.segments[0].outStart).toBe(t0 + 3000 + 6000);
  });

  it("Clicks mode ignores pauses but keeps click zooms, their merge, pan and hold", () => {
    const samples = [
      ...move(0, 600, 300, 300, 800, 500),
      ...rest(633, 2150, 800, 500),
      ...move(2183, 2200, 800, 500, 1500, 900),
      ...rest(2233, 9000, 1500, 900),
    ];
    const clicks = [
      [1000, 800, 500, 0],
      [2200, 1500, 900, 0],
    ];
    const p = planZoom(track(samples, { clicks }));
    expect(p.anchors.map((a) => a.kind)).toEqual(["click", "click"]);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].keys).toHaveLength(2);
    expect(p.segments[0].outStart).toBe(2450 + IN + DEFAULTS.holdMs);
    // Without the clicks, the same arrived rest makes no zoom in Clicks mode.
    expect(planZoom(track(samples)).segments).toEqual([]);
    expect(planZoom(track(samples), PAUSES).anchors[0].kind).toBe("pause");
  });

  it("ids do not change with Dwell, and skips match within 100 ms", () => {
    const ids = [600, 1000, 1500].map(
      (dwellMs) =>
        planZoom(track(arrive()), { ...PAUSES, dwellMs }).anchors[0].id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^pause:\d+$/);
    const t = Number(ids[0].split(":")[1]);
    const skip = (id: string) =>
      planZoom(track(arrive()), PAUSES, new Set([id]));
    expect(skip(`pause:${t + 80}`).segments).toEqual([]);
    expect(skip(`pause:${t + 80}`).anchors[0].enabled).toBe(false);
    expect(skip(`pause:${t + 150}`).segments).toHaveLength(1);
    expect(skip(`click:${t}`).segments).toHaveLength(1);
    expect(skip("nonsense").segments).toHaveLength(1);
  });

  const three = () => {
    const samples = [
      ...rest(0, 950, 400, 300),
      ...move(983, 1000, 400, 300, 1000, 600),
      ...rest(1033, 1950, 1000, 600),
      ...move(1983, 2000, 1000, 600, 1600, 900),
      ...rest(2033, 9000, 1600, 900),
    ];
    const clicks = [
      [500, 400, 300, 0],
      [1000, 1000, 600, 0],
      [2000, 1600, 900, 0],
    ];
    return track(samples, { clicks });
  };

  it("skipping one of three merged zooms re-plans the pans smoothly", () => {
    const all = planZoom(three());
    expect(all.segments).toHaveLength(1);
    expect(all.segments[0].keys).toHaveLength(3);
    const p = planZoom(three(), {}, new Set(["click:1000"]));
    expect(p.anchors.map((a) => a.enabled)).toEqual([true, false, true]);
    expect(p.segments).toHaveLength(1);
    const s = p.segments[0];
    expect(s.keys).toHaveLength(2);
    // It pans straight from the first click to the third (the target is
    // the third click, clamped to the range allowed at 1.8x).
    expect(s.keys[1].t).toBe(2000 + DEFAULTS.clickLeadMs);
    expect(s.keys[1].tx).toBeCloseTo(W - W / 3.6, 6);
    // The pan from the first to the third click never reverses (the exit
    // after it heads back to the center, which is a new anchor).
    expect(path(p, s.start, s.outStart, 1).flips).toBe(0);
    const m = motion(p, 0, 9000, 1);
    expect(m.jump.center).toBeLessThan(m.step.center / 10);
    expect(jerk(p, 0, 9000, 1000 / 120).center).toBeLessThan(0.4);
  });

  it("skipping every zoom leaves the view at scale 1 everywhere", () => {
    const ids = new Set(planZoom(three()).anchors.map((a) => a.id));
    const p = planZoom(three(), {}, ids);
    expect(p.segments).toEqual([]);
    expect(p.anchors.every((a) => !a.enabled)).toBe(true);
    for (let t = 0; t < 9000; t += 50) expect(evaluate(p, t).scale).toBe(1);
  });

  it("is deterministic with modes and skips", () => {
    const skip = new Set(["click:1000"]);
    expect(JSON.stringify(planZoom(three(), {}, skip))).toBe(
      JSON.stringify(planZoom(structuredClone(three()), {}, new Set(skip))),
    );
    expect(planZoom(track(arrive()), PAUSES)).toEqual(
      planZoom(track(arrive()), PAUSES),
    );
  });
});

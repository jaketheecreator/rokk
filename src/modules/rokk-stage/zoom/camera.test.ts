import { describe, expect, it } from "vitest";
import { evaluate, planZoom, type Track } from "./algo";
import { MAX_CAMERA_ENTRIES, sampleCameraPath } from "./camera";

const W = 2000;
const H = 1200;
function track(ms: number, more: Partial<Track> = {}): Track {
  const samples: [number, number, number][] = [];
  for (let t = 0; t <= Math.min(ms, 4000); t += 33) samples.push([t, 300, 200]);
  return {
    width: W,
    height: H,
    scale: 2,
    frame: null,
    samples,
    // A click on the rest: a zoom in the default "Clicks" mode.
    clicks: ms > 0 ? [[300, 300, 200, 0]] : [],
    events: [],
    durationMs: ms,
    ...more,
  };
}

describe("sampleCameraPath", () => {
  it("samples at 120 Hz from 0 with a last sample at the duration", () => {
    const p = sampleCameraPath(planZoom(track(10_000)), 10_000);
    expect(p[0][0]).toBe(0);
    expect(p[p.length - 1][0]).toBe(10_000);
    expect(p).toHaveLength(1201);
    expect(p[1][0]).toBeCloseTo(1000 / 120, 3);
  });

  it("times strictly increase and values have at most 3 decimals", () => {
    const p = sampleCameraPath(planZoom(track(7_777.7)), 7_777.7);
    for (let i = 1; i < p.length; i++)
      expect(p[i][0]).toBeGreaterThan(p[i - 1][0]);
    for (const q of p)
      for (const v of q) expect(Math.round(v * 1000) / 1000).toBe(v);
    expect(p[p.length - 1][0]).toBe(7_777.7);
  });

  it("equals evaluate() at the sample times, inside the video and 1x to 4x", () => {
    const plan = planZoom(
      track(8_000, { frame: { x: 278, y: 160, w: 1400, h: 860 } }),
    );
    const p = sampleCameraPath(plan, 8_000);
    expect(p.some((q) => q[1] > 1.5)).toBe(true);
    for (const [t, s, cx, cy] of p) {
      const v = evaluate(plan, t);
      expect(Math.abs(s - v.scale)).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(cx - v.cx)).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(cy - v.cy)).toBeLessThanOrEqual(0.0005);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(4);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(W);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(H);
    }
  });

  it("stays within 80,000 entries for long videos", () => {
    const plan = planZoom(track(0));
    const p = sampleCameraPath(plan, 11 * 60_000 + 30_000);
    expect(p.length).toBeLessThanOrEqual(MAX_CAMERA_ENTRIES);
    expect(p[p.length - 1][0]).toBe(11 * 60_000 + 30_000);
    for (let i = 1; i < p.length; i++)
      expect(p[i][0]).toBeGreaterThan(p[i - 1][0]);
  });

  it("an empty plan gives scale 1 at the video center", () => {
    const p = sampleCameraPath(planZoom(track(0)), 2_000);
    for (const q of p.slice(0, -1).concat(p.slice(-1)))
      expect(q.slice(1)).toEqual([1, W / 2, H / 2]);
  });

  it("a zero or missing duration gives one sample at 0", () => {
    const plan = planZoom(track(0));
    expect(sampleCameraPath(plan, 0)).toEqual([[0, 1, W / 2, H / 2]]);
    expect(sampleCameraPath(plan, Number.NaN)).toEqual([[0, 1, W / 2, H / 2]]);
  });
});

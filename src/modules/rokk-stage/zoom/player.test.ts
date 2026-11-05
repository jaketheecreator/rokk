import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardActions, ResultCardView } from "../record/RecordControls";
import { resultFor } from "../record/record";
import { DEFAULTS, evaluate, phaseAt, planZoom } from "./algo";
import {
  createDebounce,
  createMediaClock,
  createZoomController,
  DEBOUNCE_MS,
  DEFAULT_KNOBS,
  DWELL_OFF,
  debugStats,
  HINT,
  SLIDER_HELP,
  defaultZoomOn,
  EMPTY_NOTE,
  ERROR_TITLE,
  formatTime,
  type Loaded,
  matrixFor,
  MODE_KEY,
  momentsText,
  OFF_CAP,
  OFF_KEY,
  readMode,
  readOff,
  release,
  returnFocusTo,
  SCROLL_NOTE,
  seekKey,
  sliderOff,
  spaceToggles,
  ticks,
  toggleSkip,
  toTrack,
  writeMode,
  writeOff,
  zoomsText,
} from "./player";
import { sampleCameraPath } from "./camera";
import { Status } from "./ZoomPlayer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

function rest(
  t0: number,
  t1: number,
  x: number,
  y: number,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = t0; t <= t1; t += 33) out.push([t, x, y]);
  return out;
}
const loaded = (
  samples: [number, number, number][],
  endMs = 12000,
  clicks: [number, number, number, number][] = [],
): Loaded => ({
  version: 1,
  video: { width: 2000, height: 1200, scale: 2 },
  frame: null,
  samples,
  clicks,
  events: [],
  end: { t_ms: endMs },
});
/** Two rests three seconds long, six seconds apart, each with a click at
 * its start: two zoom moments in the default "Clicks" mode, starting at 1 s
 * and 7 s (the clicks plus clickLeadMs). */
const twoRests = () =>
  loaded(
    [
      ...rest(0, 3000, 800, 600),
      [3033, 1900, 100],
      ...rest(6000, 9000, 1200, 700),
      [9033, 100, 1100],
    ],
    12000,
    [
      [750, 800, 600, 0],
      [6750, 1200, 700, 0],
    ],
  );
const fakeVideo = () => ({ style: { transform: "", willChange: "" } });

describe("the zoom controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("recomputes the plan once, 120 ms after the last setting change", () => {
    const onPlan = vi.fn();
    const c = createZoomController(twoRests(), 12, false, onPlan);
    expect(c.plan().segments).toHaveLength(2);
    c.set({ level: 2.5 });
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    c.set({ dwellMs: 2500 });
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(onPlan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(c.plan().level).toBe(2.5);
    // The 3 s rests still hold a 2.5 s dwell.
    expect(c.plan().segments.length).toBeGreaterThan(0);
  });

  it("does not touch playback: only the transform changes", () => {
    const c = createZoomController(twoRests(), 12, false, () => {});
    const v = fakeVideo();
    c.frame(v, 2000, true);
    expect(v.style.transform).toMatch(
      /^translate3d\(-?[\d.]+px, -?[\d.]+px, 0\) scale\(1\.8\)$/,
    );
    expect(v.style.willChange).toBe("transform");
    c.frame(v, 2000, false);
    expect(v.style.willChange).toBe("auto");
  });

  it("the Zoom switch shows the original", () => {
    const c = createZoomController(twoRests(), 12, false, () => {});
    const v = fakeVideo();
    c.setZoom(false);
    c.frame(v, 2000, true);
    expect(v.style.transform).toBe("none");
    expect(v.style.willChange).toBe("auto");
  });

  it("reduced motion starts with Zoom off, and Reset keeps that default", () => {
    expect(defaultZoomOn(false)).toBe(true);
    expect(defaultZoomOn(true)).toBe(false);
    const c = createZoomController(twoRests(), 12, true, () => {});
    expect(c.zoom()).toBe(false);
    c.setZoom(true);
    expect(c.zoom()).toBe(true);
    c.reset();
    expect(c.zoom()).toBe(false);
  });

  it("Reset restores the default settings", () => {
    const onPlan = vi.fn();
    const c = createZoomController(twoRests(), 12, false, onPlan);
    c.set({ level: 3, dwellMs: 400, holdMs: 300 });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(c.plan().level).toBe(3);
    c.reset();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(c.knobs()).toEqual(DEFAULT_KNOBS);
    expect(c.plan().level).toBe(DEFAULTS.level);
    expect(c.plan()).toEqual(planZoom(toTrack(twoRests(), 12)));
  });

  it("closing cancels a pending recompute", () => {
    const onPlan = vi.fn();
    const c = createZoomController(twoRests(), 12, false, onPlan);
    c.set({ level: 2 });
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(onPlan).not.toHaveBeenCalled();
  });

  it("the debounce collapses calls", () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 50);
    d.call();
    d.call();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("player parts", () => {
  it("the track uses the longer of the video and the file", () => {
    expect(toTrack(loaded([], 4000), 5).durationMs).toBe(5000);
    expect(toTrack(loaded([], 4000), Number.NaN).durationMs).toBe(4000);
    expect(
      toTrack({ ...loaded([]), events: [{ t_ms: 700 }] }, 1).events,
    ).toEqual([700]);
  });

  it("scrubber ticks: one per candidate zoom, at its click or arrival, with state and labels", () => {
    const plan = planZoom(toTrack(twoRests(), 12));
    const t = ticks(plan, 12000);
    expect(t.map((x) => x.left)).toEqual([
      (750 / 12000) * 100,
      (6750 / 12000) * 100,
    ]);
    expect(t[0]).toMatchObject({
      id: "click:750",
      on: true,
      label: "Zoom at 0:00 (click), on",
      title: "Click to turn this zoom off",
    });
    const off = planZoom(toTrack(twoRests(), 12), {}, new Set(["click:6750"]));
    expect(ticks(off, 12000)[1]).toMatchObject({
      on: false,
      label: "Zoom at 0:06 (click), off",
      title: "Click to turn this zoom on",
    });
    expect(ticks(plan, 0)).toEqual([]);
  });

  it("scrubber keys seek 1 second, 5 with Shift, and stay in range", () => {
    expect(seekKey("ArrowRight", false, 3, 10)).toBe(4);
    expect(seekKey("ArrowLeft", true, 3, 10)).toBe(0);
    expect(seekKey("ArrowUp", true, 8, 10)).toBe(10);
    expect(seekKey("Home", false, 5, 10)).toBe(0);
    expect(seekKey("End", false, 5, 10)).toBe(10);
    expect(seekKey("a", false, 5, 10)).toBeNull();
  });

  it("time is shown as minutes and seconds", () => {
    expect(formatTime(5.9)).toBe("0:05");
    expect(formatTime(83)).toBe("1:23");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });

  it("the transform is one translate3d and scale, centered, rounded to 1/100 px", () => {
    expect(
      matrixFor({ scale: 1, cx: 1000, cy: 600 }, 2000, 1200, 800, 480).css,
    ).toBe("none");
    // A box of 800 x 480 for a 2000 x 1200 video: 0.4 box px per video px.
    // Scale 2 at (500, 300): 400 - 2 * 200 = 0 and 240 - 2 * 120 = 0.
    expect(
      matrixFor({ scale: 2, cx: 500, cy: 300 }, 2000, 1200, 800, 480).css,
    ).toBe("translate3d(0px, 0px, 0) scale(2)");
    expect(
      matrixFor({ scale: 2, cx: 1500, cy: 900 }, 2000, 1200, 800, 480).css,
    ).toBe("translate3d(-800px, -480px, 0) scale(2)");
    expect(
      matrixFor({ scale: 1.5, cx: 1000.0001, cy: 600 }, 2000, 1200, 800, 480)
        .tx,
    ).toBe(-200);
    const plan = planZoom(toTrack(twoRests(), 12));
    expect(matrixFor(evaluate(plan, 0), 2000, 1200, 800, 480).css).toBe("none");
  });

  it("the transform is written only when it changes", () => {
    const c = createZoomController(twoRests(), 12, false, () => {});
    c.setBox(800, 480);
    const writes: string[] = [];
    const v = {
      style: {
        willChange: "",
        get transform() {
          return writes[writes.length - 1] ?? "";
        },
        set transform(x: string) {
          writes.push(x);
        },
      },
    };
    c.frame(v, 2500, true);
    c.frame(v, 2500, true);
    c.frame(v, 2500.0001, true);
    expect(writes).toHaveLength(1);
    c.frame(v, 3500, true);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    c.setBox(400, 240);
    c.frame(v, 2500, true);
    expect(writes[writes.length - 1]).not.toBe(writes[0]);
  });

  it("the media clock runs on between frames, at most 80 ms ahead, never backwards", () => {
    const k = createMediaClock();
    k.snap(1000, 0);
    expect(k.read(16, 1)).toBe(1016);
    expect(k.read(500, 1)).toBe(1080);
    k.anchor(1033, 100);
    expect(k.read(116, 1)).toBe(1080); // a frame behind the clock does not pull it back
    expect(k.read(160, 1)).toBe(1093);
    k.anchor(1020, 170); // older media times are ignored
    expect(k.read(170, 1)).toBe(1103);
    expect(k.read(200, 2)).toBe(1113); // capped at 80 ms past the frame
    k.snap(400, 300); // a seek
    expect(k.read(300, 1)).toBe(400);
  });

  it("the hint and each slider's sentence say what the settings mean", () => {
    expect(HINT).toBe(
      "Level is how far it zooms. Dwell is how long the mouse rests before a pause zoom. Hold is how long it stays zoomed. Click a tick to turn that zoom off.",
    );
    expect(SLIDER_HELP.dwellMs).toBe(
      "Dwell: how long the mouse must rest on a spot before the zoom starts.",
    );
    expect(Object.keys(SLIDER_HELP)).toEqual(["level", "dwellMs", "holdMs"]);
    expect(Object.keys(DEFAULT_KNOBS)).toEqual([
      "mode",
      "level",
      "dwellMs",
      "holdMs",
    ]);
    expect(DEFAULT_KNOBS.mode).toBe("clicks");
    for (const t of [HINT, ...Object.values(SLIDER_HELP)])
      expect(t).not.toMatch(/\u2014/);
  });

  it("the debug stats measure steps, velocity jumps and repeated times", () => {
    const frames = [0, 1, 2, 3, 4].map((i) => ({
      t: i < 2 ? 0 : i * 16,
      s: 1 + i * 0.01,
      x: i * 2 + (i === 4 ? 3 : 0),
      y: 0,
    }));
    expect(debugStats(frames)).toMatchObject({
      frames: 5,
      maxScaleStep: 0.01,
      maxCenterStep: 5,
      maxCenterVelocityJump: 3,
      // Steps 2, 2, 2, 5: the second difference of the steps is 3.
      maxAcceleration: 3,
      maxScaleAcceleration: 0,
      directionReversals: 0,
      uniqueTimeFraction: 0.8,
    });
    expect(debugStats([]).frames).toBe(0);
  });

  it("the debug stats count direction reversals per phase (the jump is of the step vector)", () => {
    const xs = [0, 2, 4, 2, 2.01, 4];
    const frames = xs.map((x, i) => ({
      t: i,
      s: 1,
      x,
      y: 0,
      phase: i < 3 ? ("holding" as const) : ("panning" as const),
    }));
    const d = debugStats(frames);
    // +2 then -2 is a reversal with a jump of 4; a 0.01 px step is too small to count.
    expect(d.directionReversals).toBe(1);
    expect(d.maxCenterVelocityJump).toBe(4);
    expect(d.holding).toEqual({
      frames: 3,
      maxCenterStep: 2,
      maxCenterVelocityJump: 0,
      directionReversals: 0,
    });
    expect(d.panning).toMatchObject({
      frames: 3,
      directionReversals: 1,
      maxCenterVelocityJump: 4,
    });
    expect(d.idle.frames).toBe(0);
  });

  it("with a stage frame, 60 Hz playback has no direction reversals and a still hold", () => {
    // The owner's case: a frame rectangle, a rest near its edge, a pan, a jittery rest.
    const jitter = rest(2066, 6000, 1300, 700).map(
      ([t, x, y], i): [number, number, number] => [
        t,
        x + (i % 2 ? 10 : -10),
        y + (i % 3) * 6,
      ],
    );
    const l = {
      ...loaded(
        [...rest(0, 2000, 420, 330), [2033, 1300, 700], ...jitter],
        8000,
        [
          [200, 420, 330, 0],
          [2100, 1300, 700, 0],
        ],
      ),
      frame: { x: 278, y: 160, w: 1400, h: 860 },
    };
    for (const holdMs of [1500, 6000]) {
      const c = createZoomController(l, 8, false, () => {}, { holdMs });
      c.setBox(880, 528);
      const v = fakeVideo();
      const frames = [];
      for (let t = 0; t < 8000; t += 1000 / 60)
        frames.push({ ...c.frame(v, t, true), phase: phaseAt(c.plan(), t) });
      const d = debugStats(frames);
      expect(d.directionReversals).toBe(0);
      expect(d.holding.frames).toBeGreaterThan(30);
      expect(d.holding.directionReversals).toBe(0);
      expect(d.holding.maxCenterStep).toBeLessThan(0.5);
      expect(d.panning.frames).toBeGreaterThan(0);
      for (const ph of [d.entering, d.exiting])
        expect(ph.maxCenterVelocityJump).toBeLessThan(ph.maxCenterStep);
      expect(d.uniqueTimeFraction).toBe(1);
    }
  });

  it("the camera in Smooth has no jitter at 60 Hz: velocity changes stay small", () => {
    // A plan with a pan, rendered at 60 Hz in a 880 px box.
    const l = loaded(
      [
        ...rest(0, 2000, 700, 600),
        [2033, 1300, 700],
        ...rest(2066, 6000, 1300, 700),
      ],
      12000,
      [
        [300, 700, 600, 0],
        [2100, 1300, 700, 0],
      ],
    );
    const c = createZoomController(l, 8, false, () => {});
    c.setBox(880, 528);
    const v = fakeVideo();
    const frames = [];
    for (let t = 0; t < 8000; t += 1000 / 60) frames.push(c.frame(v, t, true));
    const d = debugStats(frames);
    // The largest change is the follower starting a 600 video px pan (its
    // acceleration starts at once); a jitter would be the size of a step.
    expect(d.maxCenterVelocityJump).toBeLessThan(5);
    expect(d.maxCenterVelocityJump).toBeLessThan(d.maxCenterStep / 2);
    expect(d.uniqueTimeFraction).toBe(1);
  });

  it("Space toggles play except on buttons and text fields", () => {
    expect(spaceToggles(" ", { tagName: "DIV" })).toBe(true);
    expect(spaceToggles(" ", { tagName: "INPUT", type: "range" })).toBe(true);
    expect(spaceToggles(" ", { tagName: "BUTTON" })).toBe(false);
    expect(spaceToggles(" ", { tagName: "INPUT", type: "text" })).toBe(false);
    expect(spaceToggles("Enter", { tagName: "DIV" })).toBe(false);
  });

  it("plan changes are announced as a count", () => {
    expect(momentsText(1)).toBe("1 zoom moment");
    expect(momentsText(3)).toBe("3 zoom moments");
  });

  it("closing pauses the video and releases its file", () => {
    const v = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
    release(v);
    expect(v.pause).toHaveBeenCalled();
    expect(v.removeAttribute).toHaveBeenCalledWith("src");
    expect(v.load).toHaveBeenCalled();
    expect(() => release(null)).not.toThrow();
  });

  it("closing returns focus to the Preview zoom button", () => {
    const button = { focus: vi.fn() };
    const e = { preventDefault: vi.fn() };
    returnFocusTo(() => button)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(button.focus).toHaveBeenCalled();
    expect(() => returnFocusTo(() => null)(e)).not.toThrow();
  });
});

describe("player states", () => {
  const render = (p: Partial<Parameters<typeof Status>[0]>) =>
    renderToString(
      createElement(Status, {
        error: null,
        loading: false,
        empty: false,
        onClose: () => {},
        ...p,
      }),
    );

  it("the error state shows the reason from Rust and a Close button", () => {
    const html = render({
      error: "The recording for this mouse path is missing.",
    });
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain("The recording for this mouse path is missing.");
    expect(html).toContain(">Close</button>");
    expect(html).toContain('role="alert"');
  });

  it("the empty plan suggests a shorter dwell", () => {
    expect(render({ empty: true })).toContain(EMPTY_NOTE);
    expect(render({})).toBe("");
    expect(render({ loading: true })).toContain("Loading");
  });
});

describe("the Preview zoom button", () => {
  const ev = {
    state: "idle" as const,
    elapsed: 10,
    finished: "/Users/x/Movies/Rokk/Rokk-2026-11-03-143458.mp4",
    outcome: "saved" as const,
    size: 1000,
  };

  it("shows only when the recording has a saved mouse path", () => {
    const withPath = resultFor({
      ...ev,
      sidecar: "/Users/x/Movies/Rokk/.zoom/Rokk-2026-11-03-143458.zoom.json",
    });
    const without = resultFor({ ...ev, sidecar: null });
    if (!withPath || !without) throw new Error("cards");
    expect(cardActions(withPath)).toEqual([
      "Show in Finder",
      "Preview zoom",
      "Record again",
      "Delete recording",
      "Done",
    ]);
    expect(cardActions(without)).not.toContain("Preview zoom");
    expect(
      cardActions(
        resultFor({
          ...ev,
          finished: null,
          outcome: "discarded",
          sidecar: "x",
        }) ?? { kind: "discarded" },
      ),
    ).not.toContain("Preview zoom");
    const html = renderToString(
      createElement(ResultCardView, {
        card: withPath,
        onShow: () => {},
        onAgain: () => {},
        onDelete: () => {},
        onDone: () => {},
        onZoom: () => {},
      }),
    );
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*>Preview zoom</);
  });
});

describe("zoom on, ticks and skips", () => {
  const mapStore = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  it("the mode is saved, Clicks by default, and a broken store falls back", () => {
    const s = mapStore();
    expect(readMode(s)).toBe("clicks");
    writeMode(s, "clicks-pauses");
    expect(s.m.get(MODE_KEY)).toBe("clicks-pauses");
    expect(readMode(s)).toBe("clicks-pauses");
    expect(readMode(broken)).toBe("clicks");
    expect(() => writeMode(broken, "clicks")).not.toThrow();
    expect(readMode(null)).toBe("clicks");
  });

  it("skips are kept per recording, capped to the 30 most recent", () => {
    const s = mapStore();
    expect(readOff(s, "a.mp4")).toEqual([]);
    writeOff(s, "a.mp4", ["click:750"]);
    expect(readOff(s, "a.mp4")).toEqual(["click:750"]);
    for (let i = 0; i < 30; i++) writeOff(s, `r${i}.mp4`, ["pause:100"]);
    expect(readOff(s, "a.mp4")).toEqual([]);
    expect(Object.keys(JSON.parse(s.m.get(OFF_KEY) ?? "{}"))).toHaveLength(
      OFF_CAP,
    );
    // Writing an old one again makes it the most recent.
    writeOff(s, "r0.mp4", ["pause:200"]);
    writeOff(s, "new.mp4", ["click:1"]);
    expect(readOff(s, "r0.mp4")).toEqual(["pause:200"]);
    expect(readOff(s, "r1.mp4")).toEqual([]);
    // An empty list removes the entry; damaged data reads as none.
    writeOff(s, "new.mp4", []);
    expect(Object.keys(JSON.parse(s.m.get(OFF_KEY) ?? "{}"))).not.toContain(
      "new.mp4",
    );
    s.m.set(OFF_KEY, "{broken");
    expect(readOff(s, "r0.mp4")).toEqual([]);
    expect(readOff(broken, "a.mp4")).toEqual([]);
    expect(() => writeOff(broken, "a.mp4", ["x"])).not.toThrow();
  });

  it("a tick click turns its zoom off, and on again whatever id matched it", () => {
    const on = {
      id: "pause:9050",
      kind: "pause" as const,
      t0: 9048,
      enabled: true,
    };
    expect(toggleSkip([], on)).toEqual(["pause:9050"]);
    const off = { ...on, enabled: false };
    expect(toggleSkip(["pause:9000", "click:9050", "pause:200"], off)).toEqual([
      "click:9050",
      "pause:200",
    ]);
  });

  it("the status text counts the zooms and the ones off", () => {
    const plan = planZoom(toTrack(twoRests(), 12));
    expect(zoomsText(plan)).toBe("2 zooms");
    const off = planZoom(toTrack(twoRests(), 12), {}, new Set(["click:750"]));
    expect(zoomsText(off)).toBe("2 zooms, 1 off");
    expect(zoomsText(planZoom(toTrack(loaded([]), 12)))).toBe("");
  });

  it("the controller re-plans at once when skips change, without a debounce", () => {
    const onPlan = vi.fn();
    const c = createZoomController(twoRests(), 12, false, onPlan, {}, [
      "click:6750",
    ]);
    expect(c.plan().segments).toHaveLength(1);
    c.setSkips([]);
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(c.plan().segments).toHaveLength(2);
  });

  it("Dwell is disabled in Clicks mode only", () => {
    expect(sliderOff("dwellMs", "clicks")).toBe(true);
    expect(sliderOff("dwellMs", "clicks-pauses")).toBe(false);
    expect(sliderOff("level", "clicks")).toBe(false);
    expect(DWELL_OFF).toBe("Dwell only applies to pauses");
    expect(SCROLL_NOTE).toContain("cannot see scrolling");
  });

  it("export parity: a skipped zoom is gone from the camera path, and Clicks mode ignores pauses", () => {
    const clicksOnly = loaded(
      [...rest(0, 3000, 800, 600), ...rest(3033, 12000, 1300, 700)],
      12000,
      [
        [750, 800, 600, 0],
        [7000, 1300, 700, 0],
      ],
    );
    const withoutB = { ...clicksOnly, clicks: [clicksOnly.clicks[0]] };
    const skipped = planZoom(
      toTrack(clicksOnly, 12),
      {},
      new Set(["click:7000"]),
    );
    expect(sampleCameraPath(skipped, 12000)).toEqual(
      sampleCameraPath(planZoom(toTrack(withoutB, 12)), 12000),
    );
    // The same plan the controller holds is what the export samples.
    const c = createZoomController(clicksOnly, 12, false, () => {}, {}, [
      "click:7000",
    ]);
    expect(sampleCameraPath(c.plan(), 12000)).toEqual(
      sampleCameraPath(skipped, 12000),
    );
    // An arrived pause with no clicks: no zoom in Clicks mode, one with pauses.
    const pause = loaded([
      ...Array.from({ length: 19 }, (_, i): [number, number, number] => [
        i * 33,
        300 + i * 28,
        600,
      ]),
      ...rest(660, 9000, 804, 600),
    ]);
    expect(
      sampleCameraPath(planZoom(toTrack(pause, 12)), 12000).every(
        (q) => q[1] === 1,
      ),
    ).toBe(true);
    expect(
      sampleCameraPath(
        planZoom(toTrack(pause, 12), { mode: "clicks-pauses" }),
        12000,
      ).some((q) => q[1] > 1),
    ).toBe(true);
  });
});

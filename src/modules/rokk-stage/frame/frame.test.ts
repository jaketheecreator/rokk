import { describe, expect, it } from "vitest";
import {
  area,
  begin,
  defaultSize,
  drag,
  fractionsOf,
  keyStep,
  MIN_H,
  MIN_W,
  readSize,
  SIZE_KEY,
  sizeOf,
  sizeText,
  top,
  writeSize,
} from "./frame";

describe("available area and the default size", () => {
  it("leaves room for the Exit pill and the bottom pill", () => {
    expect(area(1280, 800)).toEqual({ w: 1216, h: 632 });
    expect(area(100, 100)).toEqual({ w: 36, h: 0 });
  });

  it.each([
    [1280, 800, { w: 1000, h: 620 }],
    [1440, 900, { w: 1000, h: 620 }],
    [1920, 1080, { w: 1000, h: 620 }],
    [700, 500, { w: 574, h: 332 }],
  ])("at %ix%i the default is the old rule inside the area", (W, H, expected) => {
    expect(defaultSize(W, H)).toEqual(expected);
    const s = defaultSize(W, H);
    expect(top(s, H)).toBeGreaterThanOrEqual(72);
    expect(top(s, H) + s.h).toBeLessThanOrEqual(H - 96);
  });

  it("keeps a tiny window inside the area", () => {
    expect(defaultSize(500, 380)).toEqual({ w: 410, h: 212 });
  });
});

describe("free resizing", () => {
  const W = 1440;
  const H = 900;
  const start = { w: 800, h: 500 };

  it("moves both opposite sides, so the frame stays centered", () => {
    expect(drag(start, 30, 0, 1, 0, false, W, H)).toEqual({ w: 860, h: 500 });
    expect(drag(start, -30, 0, -1, 0, false, W, H)).toEqual({ w: 860, h: 500 });
    expect(drag(start, 0, 20, 0, 1, false, W, H)).toEqual({ w: 800, h: 540 });
  });

  it("changes width and height independently at a corner", () => {
    expect(drag(start, 40, 10, 1, 1, false, W, H)).toEqual({ w: 880, h: 520 });
  });

  it("keeps the starting proportions with Shift", () => {
    expect(drag(start, 40, 10, 1, 1, true, W, H)).toEqual({ w: 880, h: 550 });
    expect(drag(start, 0, 25, 0, 1, true, W, H)).toEqual({ w: 880, h: 550 });
  });

  it("clamps to the minimum and the available area, with no snapping", () => {
    expect(drag(start, -1000, -1000, 1, 1, false, W, H)).toEqual({ w: MIN_W, h: MIN_H });
    expect(drag(start, 2000, 2000, 1, 1, false, W, H)).toEqual(area(W, H));
    // Just under the default size stays just under it.
    expect(drag({ w: 990, h: 612 }, 2, 1, 1, 1, false, W, H)).toEqual({ w: 994, h: 614 });
  });
});

describe("keyboard on the edge handles", () => {
  const W = 1440;
  const H = 900;
  const s = { w: 800, h: 500 };

  it("moves that edge by 16px, 64px with Shift, centered", () => {
    expect(keyStep(s, "right", "ArrowRight", false, W, H)).toEqual({ w: 832, h: 500 });
    expect(keyStep(s, "right", "ArrowLeft", false, W, H)).toEqual({ w: 768, h: 500 });
    expect(keyStep(s, "left", "ArrowLeft", true, W, H)).toEqual({ w: 928, h: 500 });
    expect(keyStep(s, "top", "ArrowUp", false, W, H)).toEqual({ w: 800, h: 532 });
    expect(keyStep(s, "bottom", "ArrowUp", false, W, H)).toEqual({ w: 800, h: 468 });
  });

  it("ignores keys across the edge and clamps", () => {
    expect(keyStep(s, "top", "ArrowLeft", false, W, H)).toBeNull();
    expect(keyStep({ w: MIN_W, h: 500 }, "right", "ArrowLeft", true, W, H)).toEqual({ w: MIN_W, h: 500 });
  });

  it("announces the size in plain words", () => {
    expect(sizeText({ w: 1100, h: 640 })).toBe("Frame size: 1100 by 640");
  });
});

describe("persistence as fractions", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      m,
      s: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    };
  };

  it("stores fractions of the area, adapts to the window, and clears on reset", () => {
    const { m, s } = mem();
    expect(readSize(s)).toBeNull();
    writeSize(s, fractionsOf({ w: 608, h: 316 }, 1280, 800));
    expect(JSON.parse(m.get(SIZE_KEY) ?? "")).toEqual({ fw: 0.5, fh: 0.5 });
    expect(sizeOf(readSize(s), 1920, 1080)).toEqual({ w: 928, h: 456 });
    writeSize(s, null);
    expect(m.has(SIZE_KEY)).toBe(false);
    expect(sizeOf(readSize(s), 1440, 900)).toEqual(defaultSize(1440, 900));
  });

  it("falls back to the default on bad data or failing storage", () => {
    const { m, s } = mem();
    m.set(SIZE_KEY, "{oops");
    expect(readSize(s)).toBeNull();
    m.set(SIZE_KEY, JSON.stringify({ fw: 2, fh: 0.5 }));
    expect(readSize(s)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSize(broken)).toBeNull();
    expect(() => writeSize(broken, { fw: 0.5, fh: 0.5 })).not.toThrow();
    expect(() => writeSize(broken, null)).not.toThrow();
  });
});

describe("drag sessions", () => {
  it("Escape gives back the size from before", () => {
    expect(begin(false, { w: 800, h: 500 })?.cancel()).toEqual({ w: 800, h: 500 });
  });

  it("does not start while recording", () => {
    expect(begin(true, { w: 800, h: 500 })).toBeNull();
  });
});

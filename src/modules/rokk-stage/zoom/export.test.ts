import { describe, expect, it } from "vitest";
import {
  announcement,
  baseName,
  CANCELLED,
  clock,
  type ExportEvent,
  type ExportView,
  IDLE,
  mbText,
  QUALITIES,
  reduce,
  SOFT_NOTE,
  sizeText,
  startError,
} from "./export";

const ev = (e: Partial<ExportEvent>): ExportEvent => ({
  job: 1,
  state: "running",
  progress: 0,
  output: null,
  size: null,
  code: null,
  message: null,
  seconds_elapsed: 0,
  ...e,
});
const pending: ExportView = {
  kind: "running",
  job: null,
  progress: 0,
  seconds: 0,
};

describe("export texts", () => {
  it("estimates about 90 and 45 MB per minute", () => {
    expect(sizeText(60, "full")).toBe("About 90 MB");
    expect(sizeText(60, "small")).toBe("About 45 MB");
    expect(sizeText(10, "full")).toBe("About 15 MB");
    expect(sizeText(0.2, "small")).toBe("About 1 MB");
    expect(sizeText(Number.NaN, "full")).toBe("About 1 MB");
  });

  it("labels, sizes, names, and no promise of sharpness", () => {
    expect(QUALITIES.map((q) => q.label)).toEqual([
      "Full size (best quality)",
      "Smaller file (1920 wide)",
    ]);
    expect(SOFT_NOTE).toContain("can look soft");
    expect(mbText(12_400_000)).toBe("12 MB");
    expect(mbText(10)).toBe("1 MB");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(Number.NaN)).toBe("0:00");
    expect(
      baseName("/Users/x/Movies/Rokk/Rokk-2026-11-02-090507-zoom.mp4"),
    ).toBe("Rokk-2026-11-02-090507-zoom.mp4");
    for (const t of [SOFT_NOTE, CANCELLED, ...QUALITIES.map((q) => q.label)])
      expect(t).not.toMatch(/—|sharp(?!er)/);
  });
});

describe("export state", () => {
  it("follows its job from start to done", () => {
    let v = reduce(pending, ev({ job: 4, progress: 0.25, seconds_elapsed: 2 }));
    expect(v).toEqual({ kind: "running", job: 4, progress: 0.25, seconds: 2 });
    expect(reduce(v, ev({ job: 5, progress: 0.9 }))).toBe(v);
    v = reduce(
      v,
      ev({ job: 4, state: "done", output: "/a/b-zoom.mp4", size: 5_000_000 }),
    );
    expect(v).toEqual({
      kind: "done",
      output: "/a/b-zoom.mp4",
      size: 5_000_000,
    });
    expect(reduce(v, ev({ job: 4, state: "error" }))).toBe(v);
  });

  it("errors and cancels end the run; idle ignores events", () => {
    const run: ExportView = {
      kind: "running",
      job: 2,
      progress: 0.4,
      seconds: 1,
    };
    expect(
      reduce(
        run,
        ev({ job: 2, state: "error", code: "disk_full", message: "No space." }),
      ),
    ).toEqual({
      kind: "error",
      code: "disk_full",
      message: "No space.",
    });
    expect(reduce(run, ev({ job: 2, state: "cancelled" }))).toEqual({
      kind: "cancelled",
    });
    expect(reduce(IDLE, ev({ state: "done" }))).toBe(IDLE);
    expect(reduce(run, ev({ job: 2, progress: 7 }))).toMatchObject({
      progress: 1,
    });
  });

  it("a refused start shows the code and the plain message", () => {
    expect(
      startError({
        code: "recording",
        message: "Stop the recording first, then save with zoom.",
      }),
    ).toEqual({
      kind: "error",
      code: "recording",
      message: "Stop the recording first, then save with zoom.",
    });
    expect(startError("boom")).toMatchObject({
      kind: "error",
      code: "unknown",
    });
  });

  it("announces the start, half way once, and the end, never every tick", () => {
    expect(announcement(IDLE, pending)).toBe("Saving the zoomed video started");
    const at = (p: number): ExportView => ({
      kind: "running",
      job: 1,
      progress: p,
      seconds: 0,
    });
    const said = [0.1, 0.3, 0.49, 0.5, 0.6, 0.9].map((p, i, a) =>
      announcement(at(i ? a[i - 1] : 0), at(p)),
    );
    expect(said.filter(Boolean)).toEqual(["50 percent saved"]);
    expect(
      announcement(at(0.9), {
        kind: "done",
        output: "/x/Rokk-2026-11-02-090507-zoom.mp4",
        size: 3_000_000,
      }),
    ).toBe("Saved Rokk-2026-11-02-090507-zoom.mp4, 3 MB");
    expect(
      announcement(at(0.2), {
        kind: "error",
        code: "x",
        message: "It failed.",
      }),
    ).toBe("It failed.");
    expect(announcement(at(0.2), { kind: "cancelled" })).toBe(CANCELLED);
    expect(
      announcement({ kind: "cancelled" }, { kind: "cancelled" }),
    ).toBeNull();
  });
});

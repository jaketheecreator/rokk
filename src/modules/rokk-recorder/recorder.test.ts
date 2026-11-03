import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecorder, formatElapsed, markup, send } from "./recorder";

const rec = (state: "idle" | "starting" | "recording" | "stopping", elapsed = 0) => ({ state, elapsed });

describe("recording controller page", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("formats the timer", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(12)).toBe("00:12");
    expect(formatElapsed(599)).toBe("09:59");
    expect(formatElapsed(600)).toBe("10:00");
    expect(formatElapsed(-3)).toBe("00:00");
  });

  it("renders three real buttons with labels and a status region", () => {
    const html = markup();
    expect(html.match(/<button type="button"/g)).toHaveLength(3);
    for (const label of ["Stop and save recording", "Stop and discard recording", "Discard and record again"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('role="status"');
    // The timer is not inside the live region.
    expect(html).not.toMatch(/role="status"[^>]*>[^<]*\d\d:\d\d/);
  });

  it("announces start and stop, never the seconds", () => {
    const r = createRecorder(vi.fn(), () => false);
    r.onEvent(rec("recording", 0));
    expect(r.view().announce).toBe("Recording started");
    r.onEvent(rec("recording", 1));
    expect(r.view()).toMatchObject({ timer: "00:01", announce: null });
    r.onEvent(rec("stopping", 1));
    expect(r.view().announce).toBe("Recording stopped");
    r.onEvent(rec("idle", 1));
    expect(r.view().announce).toBeNull();
  });

  it("steps the dot each second, and keeps it lit with reduced motion", () => {
    const r = createRecorder(vi.fn(), () => false);
    r.onEvent(rec("recording", 2));
    expect(r.view().dotOn).toBe(true);
    r.onEvent(rec("recording", 3));
    expect(r.view().dotOn).toBe(false);
    const still = createRecorder(vi.fn(), () => true);
    still.onEvent(rec("recording", 3));
    expect(still.view().dotOn).toBe(true);
  });

  it("each button sends its one command", async () => {
    const invoke = vi.fn(() => Promise.resolve(null));
    await send(invoke, "stop");
    await send(invoke, "discard");
    await send(invoke, "restart");
    expect(invoke.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "record_stop",
      "record_stop_discard",
      "record_restart",
    ]);
  });

  it("sends one command at a time, only while recording", async () => {
    let resolve: () => void = () => {};
    const invoke = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const r = createRecorder(invoke, () => false);
    await r.press("stop");
    expect(invoke).not.toHaveBeenCalled();
    r.onEvent(rec("recording", 4));
    const first = r.press("stop");
    expect(r.view().busy).toBe(true);
    await r.press("discard");
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve();
    await first;
    r.onEvent(rec("idle", 4));
    expect(r.view().busy).toBe(false);
  });

  it("a failed command enables the buttons again", async () => {
    const invoke = vi.fn(() => Promise.reject(new Error("not_recording")));
    const r = createRecorder(invoke, () => false);
    r.onEvent(rec("recording", 1));
    await r.press("restart");
    await vi.runAllTimersAsync();
    expect(r.view().busy).toBe(false);
    expect(invoke).toHaveBeenCalledWith("record_restart");
  });
});

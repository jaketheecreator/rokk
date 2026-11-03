import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exitStage,
  getStage,
  registerRecordingStop,
  requestRecordToggle,
  setRecording,
  toggleStage,
} from "../lib/stage";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cardActions, ResultCardView } from "./RecordControls";
import {
  ACK_KEY,
  announcementFor,
  asRecordError,
  buttonState,
  CHECKLIST_TEXT,
  createStuckWatch,
  eventEffect,
  formatBytes,
  type RecordEvent,
  resultFor,
  DEV_NOTE,
  errorDetail,
  errorLines,
  firstStep,
  reasonText,
  PERMISSION_TEXT,
  type RecordStatus,
  readAck,
  savedToast,
  startAfterOverlay,
  startCountdown,
  writeAck,
} from "./record";

const READY: RecordStatus = { supported: true, osOk: true, permission: true, state: "idle", elapsed: 0 };

describe("Record button states", () => {
  it("is hidden off macOS and when unsupported", () => {
    expect(buttonState(READY, false)).toBe("hidden");
    expect(buttonState(null, true)).toBe("hidden");
    expect(buttonState({ ...READY, supported: false }, true)).toBe("hidden");
  });
  it("is disabled on old macOS, asks for permission, or is ready", () => {
    expect(buttonState({ ...READY, osOk: false }, true)).toBe("tooOld");
    expect(buttonState({ ...READY, permission: false }, true)).toBe("needsPermission");
    expect(buttonState(READY, true)).toBe("ready");
    expect(buttonState({ ...READY, state: "recording" }, true)).toBe("busy");
  });
});

describe("permission flow and checklist", () => {
  it("opens permission first, then the checklist once, then the countdown", () => {
    expect(firstStep("needsPermission", false)).toBe("permission");
    expect(firstStep("ready", false)).toBe("checklist");
    expect(firstStep("ready", true)).toBe("countdown");
    expect(firstStep("tooOld", true)).toBeNull();
    expect(firstStep("busy", true)).toBeNull();
  });

  it("remembers the checklist, surviving storage failures", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readAck(s)).toBe(false);
    writeAck(s);
    expect(m.get(ACK_KEY)).toBe("1");
    expect(readAck(s)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
    };
    expect(readAck(broken)).toBe(false);
    expect(() => writeAck(broken)).not.toThrow();
  });

  it("uses the agreed words", () => {
    expect(PERMISSION_TEXT).toContain("never your other apps, and never audio");
    expect(DEV_NOTE).toContain("(for example Terax)");
    expect(CHECKLIST_TEXT).toContain("Notifications from other apps will not appear, but your cursor will.");
  });
});

describe("countdown", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks 3, 2, 1 and then starts", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const done = vi.fn();
    startCountdown((n) => ticks.push(n), done);
    vi.advanceTimersByTime(2999);
    expect(ticks).toEqual([3, 2, 1]);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("cancel means nothing starts", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const c = startCountdown(() => {}, done);
    vi.advanceTimersByTime(1500);
    c.cancel();
    vi.advanceTimersByTime(10_000);
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the capture only after the overlay is gone and a frame passed", async () => {
    const order: string[] = [];
    let frame: () => void = () => {};
    const p = startAfterOverlay(
      () => order.push("removed"),
      () =>
        new Promise<void>((r) => {
          frame = () => {
            order.push("frame");
            r();
          };
        }),
      async () => {
        order.push("start");
      },
    );
    await Promise.resolve();
    expect(order).toEqual(["removed"]);
    frame();
    await p;
    expect(order).toEqual(["removed", "frame", "start"]);
  });
});

describe("toasts, errors and announcements", () => {
  it("builds the saved toast and error lines", () => {
    expect(savedToast("/Users/me/Movies/Rokk/Rokk-1.mp4")).toEqual({
      title: "Saved to Movies/Rokk",
      path: "/Users/me/Movies/Rokk/Rokk-1.mp4",
    });
    const e = asRecordError({ code: "no_indicator", message: "No indicator." });
    expect(errorLines(e)).toEqual({ title: "No indicator.", detail: "Error code: no_indicator" });
    expect(asRecordError("boom").code).toBe("unknown");
  });

  it("announces start, stop and errors, never the seconds", () => {
    expect(announcementFor("starting", { state: "recording", elapsed: 0 })).toBe("Recording started");
    expect(announcementFor("recording", { state: "recording", elapsed: 5 })).toBeNull();
    expect(announcementFor("stopping", { state: "idle", elapsed: 9, outcome: "discarded", finished: null })).toBe(
      "Recording discarded",
    );
    expect(
      announcementFor("stopping", { state: "idle", elapsed: 9, outcome: "saved", finished: "/m/Rokk/Rokk-1.mp4" }),
    ).toBe("Recording saved, Rokk-1.mp4");
    expect(announcementFor("recording", { state: "idle", elapsed: 9, error: { code: "x", message: "Oops." } })).toBe(
      "Oops.",
    );
  });
});

describe("store: attribute, shortcut and leaving while recording", () => {
  let attrs: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    attrs = new Map();
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      activeElement: null,
      getElementById: () => null,
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });
  afterEach(() => {
    setRecording(false);
    registerRecordingStop(null);
    exitStage();
    vi.runAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sets and clears data-rokk-recording", () => {
    setRecording(true);
    expect(attrs.get("data-rokk-recording")).toBe("on");
    expect(getStage().recording).toBe(true);
    setRecording(false);
    expect(attrs.has("data-rokk-recording")).toBe(false);
  });

  it("Mod+Alt+R works only in stage mode", () => {
    const before = getStage().recordRequest;
    expect(requestRecordToggle()).toBe(false);
    expect(getStage().recordRequest).toBe(before);
    toggleStage("keyboard");
    expect(requestRecordToggle()).toBe(true);
    expect(getStage().recordRequest).toBe(before + 1);
  });

  it("Mod+Alt+S still leaves when the stop call fails", async () => {
    toggleStage("keyboard");
    setRecording(true);
    registerRecordingStop(async () => {
      // What the real hook does when the stop call fails.
      try {
        throw new Error("status failed");
      } catch {
        // shown as an error toast in the app
      } finally {
        setRecording(false);
      }
    });
    toggleStage("keyboard");
    await vi.waitFor(() => expect(getStage().on).toBe(false));
    expect(attrs.has("data-rokk-recording")).toBe(false);
  });

  it("leaving stage mode clears the attribute even without a stop hook", () => {
    toggleStage("keyboard");
    setRecording(true);
    toggleStage("keyboard");
    expect(getStage().on).toBe(false);
    expect(attrs.has("data-rokk-recording")).toBe(false);
  });

  it("leaving stage mode while recording stops first, then leaves", async () => {
    toggleStage("keyboard");
    setRecording(true);
    const stop = vi.fn(async () => {
      setRecording(false);
    });
    registerRecordingStop(stop);
    toggleStage("keyboard");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(getStage().on).toBe(true);
    await vi.waitFor(() => expect(getStage().on).toBe(false));
  });
});

describe("terminal events and the result card", () => {
  const saved: RecordEvent = {
    state: "idle",
    elapsed: 12,
    finished: "/Users/me/Movies/Rokk/Rokk-2026-11-02-151108.mp4",
    outcome: "saved",
    size: 5_703_641,
  };
  const discarded: RecordEvent = { state: "idle", elapsed: 3, finished: null, error: null, outcome: "discarded" };
  const failed: RecordEvent = {
    state: "idle",
    elapsed: 4,
    finished: null,
    error: { code: "finalize_timeout", message: "Saving the recording took too long, so it was stopped and not kept." },
    outcome: "error",
  };

  it("every terminal event clears the recording attribute", () => {
    for (const ev of [saved, discarded, failed]) expect(eventEffect(ev).recording).toBe(false);
    expect(eventEffect({ state: "recording", elapsed: 1 }).recording).toBe(true);
    expect(eventEffect({ state: "stopping", elapsed: 1 }).recording).toBeNull();
  });

  it("maps each outcome to its card", () => {
    expect(resultFor(saved)).toEqual({
      kind: "saved",
      path: saved.finished,
      name: "Rokk-2026-11-02-151108.mp4",
      size: "5.7 MB",
      warning: null,
    });
    expect(resultFor(discarded)).toEqual({ kind: "discarded" });
    expect(resultFor(failed)).toEqual({ kind: "error", error: failed.error });
    expect(resultFor({ state: "recording", elapsed: 1 })).toBeNull();
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(820_000)).toBe("820 KB");
  });

  it("offers the right buttons and wires them", () => {
    const savedCard = resultFor(saved);
    const discardedCard = resultFor(discarded);
    const errorCard = resultFor(failed);
    if (!savedCard || !discardedCard || !errorCard) throw new Error("cards");
    expect(cardActions(savedCard)).toEqual(["Show in Finder", "Record again", "Delete recording", "Done"]);
    expect(cardActions(discardedCard)).toEqual(["Record again", "Done"]);
    expect(cardActions(errorCard)).toEqual(["Try again", "Done"]);
    const html = renderToString(
      createElement(ResultCardView, { card: savedCard, onShow: () => {}, onAgain: () => {}, onDelete: () => {}, onDone: () => {} }),
    );
    expect(html).toContain("Recording saved");
    expect(html).toContain("Rokk-2026-11-02-151108.mp4, 5.7 MB");
    const err = renderToString(
      createElement(ResultCardView, { card: errorCard, onShow: () => {}, onAgain: () => {}, onDelete: () => {}, onDone: () => {} }),
    );
    expect(err).toContain("took too long");
    expect(err).toContain("Error code: finalize_timeout");
    expect(err).toContain("Try again");
  });

  it("Record again skips the checklist once acknowledged", () => {
    expect(firstStep("ready", true)).toBe("countdown");
  });
});

describe("stuck attribute safety net", () => {
  afterEach(() => vi.useRealTimers());

  it("clears a stuck attribute within 2 seconds", async () => {
    vi.useFakeTimers();
    const onStuck = vi.fn();
    const idle: RecordStatus = { ...READY, state: "idle" };
    const w = createStuckWatch(async () => idle, () => true, onStuck);
    await vi.advanceTimersByTimeAsync(1999);
    expect(onStuck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("leaves a real recording alone and treats a failed check as stuck", async () => {
    vi.useFakeTimers();
    const onStuck = vi.fn();
    const live = createStuckWatch(async () => ({ ...READY, state: "recording" }), () => true, onStuck);
    await vi.advanceTimersByTimeAsync(6000);
    expect(onStuck).not.toHaveBeenCalled();
    live.stop();
    const broken = createStuckWatch(
      async () => {
        throw new Error("no recorder");
      },
      () => true,
      onStuck,
    );
    await broken.check();
    expect(onStuck).toHaveBeenCalledTimes(1);
    broken.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("stop reasons", () => {
  const err = { code: "capture_failed", message: "The recording could not start or stopped unexpectedly." };

  it("a system stop that saved reads as a normal save", () => {
    const ev: RecordEvent = {
      state: "idle",
      elapsed: 9,
      finished: "/Users/x/Movies/Rokk/Rokk-2026-11-02-090507.mp4",
      error: null,
      outcome: "saved",
      size: 5_700_000,
      reason: "system",
    };
    const card = resultFor(ev);
    expect(card?.kind).toBe("saved");
    expect(announcementFor("stopping", ev)).toBe("Recording saved, Rokk-2026-11-02-090507.mp4");
    expect(eventEffect(ev).recording).toBe(false);
  });

  it("errors carry the reason in the smaller line only", () => {
    const ev: RecordEvent = { state: "idle", elapsed: 3, error: err, outcome: "error", reason: "error" };
    const card = resultFor(ev);
    expect(card).toEqual({ kind: "error", error: err, reason: "error" });
    expect(errorDetail(err.code, "system")).toBe("Error code: capture_failed, stopped by macOS");
    expect(errorDetail(err.code)).toBe("Error code: capture_failed");
    expect(errorDetail(err.code, "nonsense")).toBe("Error code: capture_failed");
    const html = renderToString(
      createElement(ResultCardView, {
        card: { kind: "error", error: err, reason: "window_closed" },
        onShow: () => {},
        onAgain: () => {},
        onDelete: () => {},
        onDone: () => {},
      }),
    );
    expect(html).toContain("Error code: capture_failed, stopped because the window closed");
  });

  it("every reason has plain words", () => {
    for (const r of ["tray", "shortcut", "discard", "system", "cap", "disk", "window_closed", "app_exit", "error"]) {
      const t = reasonText(r);
      expect(t).toBeTruthy();
      expect(t).not.toContain("\u2014");
    }
    expect(reasonText(null)).toBeNull();
  });
});

describe("restart from the recording controller", () => {
  it("goes back to the countdown with no card or announcement of a discard", () => {
    const ev: RecordEvent = { state: "idle", elapsed: 4, finished: null, error: null, outcome: "discarded", reason: "restart" };
    expect(resultFor(ev)).toBeNull();
    expect(eventEffect(ev)).toMatchObject({ recording: false, card: null });
    expect(announcementFor("stopping", ev)).toBe("Recording stopped");
    expect(reasonText("restart")).toBe("discarded to record again");
  });

  it("a restart that failed still shows the error", () => {
    const error = { code: "finalize_failed", message: "The recording could not be saved." };
    const ev: RecordEvent = { state: "idle", elapsed: 4, error, outcome: "error", reason: "restart" };
    expect(resultFor(ev)).toEqual({ kind: "error", error, reason: "restart" });
  });
});

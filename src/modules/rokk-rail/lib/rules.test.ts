import { describe, expect, it } from "vitest";
import {
  appendEvent,
  buildTimeline,
  chipLabel,
  entryLabel,
  MAX_EVENTS,
  MAX_PANES,
  type PaneEvent,
  type PaneLog,
  pruneLogs,
  runDuration,
  sortRailTabs,
  waitingSince,
} from "./rules";

function run(kinds: PaneEvent["kind"][], step = 1000): PaneEvent[] {
  return kinds.map((kind, i) => ({ kind, at: i * step }));
}

describe("buildTimeline", () => {
  it("builds a full run from real signals only", () => {
    const events = run(["started", "working", "attention", "working", "finished", "exited"]);
    const entries = buildTimeline(events, 10_000);
    expect(entries.map((e) => e.kind)).toEqual([
      "started",
      "working",
      "needed",
      "working",
      "finished",
      "exited",
    ]);
    // Working from the start (0) until it needed the user (2000).
    expect(entries[1].duration).toBe(2000);
    // Total run time from started (0) to finished (4000).
    expect(entries[4].duration).toBe(4000);
    expect(entries.some((e) => e.current)).toBe(false);
  });

  it("marks the live step as current and times it against now", () => {
    const entries = buildTimeline(run(["started"]), 65_000);
    expect(entries.map((e) => e.kind)).toEqual(["started", "working"]);
    expect(entries[1]).toMatchObject({ current: true, duration: 65_000 });
  });

  it("collapses repeated working and attention signals", () => {
    const entries = buildTimeline(
      run(["started", "working", "working", "attention", "attention"]),
      9000,
    );
    expect(entries.map((e) => e.kind)).toEqual(["started", "working", "needed"]);
    expect(entries[2].current).toBe(true);
  });
});

describe("appendEvent", () => {
  it("keeps only the last MAX_EVENTS signals", () => {
    let log: PaneLog | undefined = appendEvent(undefined, { kind: "started", at: 0 }, "claude");
    for (let i = 1; i < 40; i++) {
      log = appendEvent(log, { kind: i % 2 ? "attention" : "working", at: i });
    }
    expect(log?.events).toHaveLength(MAX_EVENTS);
    const events = log?.events ?? [];
    expect(events[events.length - 1]?.at).toBe(39);
    expect(log?.agent).toBe("claude");
  });

  it("starts a fresh run on a new started signal", () => {
    const first = appendEvent(undefined, { kind: "started", at: 0 }, "claude");
    const done = appendEvent(first, { kind: "finished", at: 5 });
    const again = appendEvent(done, { kind: "started", at: 9 }, "claude");
    expect(again.events).toEqual([{ kind: "started", at: 9 }]);
  });
});

describe("pruneLogs", () => {
  const log: PaneLog = { agent: "claude", events: [{ kind: "started", at: 0 }] };

  it("drops panes that closed", () => {
    const logs = new Map([
      [1, log],
      [2, log],
    ]);
    const next = pruneLogs(logs, (id) => id === 2);
    expect([...next.keys()]).toEqual([2]);
  });

  it("caps the number of panes kept", () => {
    const logs = new Map<number, PaneLog>();
    for (let i = 0; i < MAX_PANES + 5; i++) logs.set(i, log);
    expect(pruneLogs(logs, () => true).size).toBe(MAX_PANES);
  });
});

describe("durations and waiting", () => {
  it("reports run time while running and the total once finished", () => {
    const live = buildTimeline(run(["started", "working"]), 7000);
    expect(runDuration(live, 7000)).toBe(7000);
    const done = buildTimeline(run(["started", "working", "finished"]), 99_000);
    expect(runDuration(done, 99_000)).toBe(2000);
    expect(runDuration([], 1)).toBeNull();
  });

  it("knows when the wait for the user began", () => {
    const entries = buildTimeline(run(["started", "attention"]), 5000);
    expect(waitingSince(entries)).toBe(1000);
    expect(waitingSince(buildTimeline(run(["started"]), 5))).toBeNull();
  });
});

describe("tabs and labels", () => {
  it("puts Needs you first, then working, finished, idle, keeping tab order", () => {
    const rows = [
      { id: "a", state: "idle", order: 0 },
      { id: "b", state: "working", order: 1 },
      { id: "c", state: "attention", order: 2 },
      { id: "d", state: "done", order: 3 },
      { id: "e", state: "attention", order: 4 },
    ] as const;
    expect(sortRailTabs(rows).map((r) => r.id)).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("labels chips and timeline entries", () => {
    expect(chipLabel("attention")).toBe("Needs you");
    expect(chipLabel("idle")).toBe("Idle");
    expect(entryLabel("started", "Claude")).toBe("Claude started");
    expect(entryLabel("needed", "Claude")).toBe("Needed you");
  });
});

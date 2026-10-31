import { describe, expect, it } from "vitest";
import {
  formatAgentDuration,
  nextWorkingSince,
  pillStyle,
  tabWorkingSince,
} from "./agentPill";

describe("formatAgentDuration", () => {
  it("formats seconds, minutes with padded seconds, and long runs", () => {
    expect(formatAgentDuration(59_000)).toBe("59s");
    expect(formatAgentDuration(65_000)).toBe("1m 05s");
    expect(formatAgentDuration(134_000)).toBe("2m 14s");
    expect(formatAgentDuration(61 * 60_000)).toBe("61m");
  });

  it("never goes negative and rounds down", () => {
    expect(formatAgentDuration(-500)).toBe("0s");
    expect(formatAgentDuration(59_999)).toBe("59s");
    expect(formatAgentDuration(60_000)).toBe("1m 00s");
  });
});

describe("pillStyle", () => {
  it("uses the state color on its tint, and nothing when idle", () => {
    expect(pillStyle("working")).toContain("--rk-working-tint");
    expect(pillStyle("attention")).toContain("--rk-attention");
    expect(pillStyle("done")).toContain("--rk-done");
    expect(pillStyle("idle")).toBeNull();
  });

  it("uses the Claude color only while Claude works", () => {
    expect(pillStyle("working", "claude")).toContain("--rk-claude-tint");
    expect(pillStyle("working", "claude")).toContain("--rk-claude-text");
    expect(pillStyle("working", "codex")).toContain("--rk-working");
    expect(pillStyle("attention", "claude")).toContain("--rk-attention");
    expect(pillStyle("done", "claude")).toContain("--rk-done");
  });
});

describe("working start times", () => {
  it("records the first working signal and keeps it through attention", () => {
    const first = nextWorkingSince(new Map(), { 1: "working" }, 1000);
    expect(first.get(1)).toBe(1000);
    const later = nextWorkingSince(first, { 1: "attention" }, 5000);
    expect(later.get(1)).toBe(1000);
  });

  it("forgets a pty once it finishes, idles or exits", () => {
    const since = new Map([[1, 1000]]);
    expect(nextWorkingSince(since, { 1: "finished" }, 2000).has(1)).toBe(false);
    expect(nextWorkingSince(since, { 1: "idle" }, 2000).has(1)).toBe(false);
    expect(nextWorkingSince(since, {}, 2000).has(1)).toBe(false);
  });

  it("uses the earliest start among a tab's ptys", () => {
    const since = new Map([
      [1, 3000],
      [2, 1000],
    ]);
    expect(tabWorkingSince(since, [1, 2])).toBe(1000);
    expect(tabWorkingSince(since, [3])).toBeNull();
  });
});

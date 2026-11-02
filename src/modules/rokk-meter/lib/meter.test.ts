import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditsView } from "../CreditsSection";
import {
  activityLine,
  createPoller,
  finishedAnnouncement,
  formatTokens,
  formatUsd,
  type MeterSnapshot,
  POLL_MS,
  toView,
  ttlLine,
} from "./meter";

function snapshot(over: Partial<MeterSnapshot> = {}): MeterSnapshot {
  return {
    sessionId: "s-1",
    offset: 10,
    reset: false,
    caughtUp: true,
    totals: { input: 38_000, output: 21_000, cacheRead: 300_000, cacheWrite: 53_000, responses: 9, prompts: 7 },
    models: [],
    prompts: [
      { index: 6, startedMs: Date.UTC(2026, 10, 1, 11, 50), tokens: 19_000, toolCalls: 1 },
      { index: 7, startedMs: Date.UTC(2026, 10, 1, 12, 4), tokens: 38_000, toolCalls: 5 },
    ],
    contextTokens: 142_000,
    contextWindow: null,
    contextModel: "claude-opus-5-5",
    lastReplyMs: 1_000_000,
    cacheTtlSecs: 3600,
    tools: [
      { name: "Read", count: 6 },
      { name: "Edit", count: 3 },
      { name: "Bash", count: 2 },
    ],
    estimateUsd: 3.4219,
    estimatePartial: false,
    skippedLines: 0,
    ...over,
  };
}

describe("number formatting", () => {
  it("formats tokens", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(38_000)).toBe("38k");
    expect(formatTokens(412_345)).toBe("412k");
    expect(formatTokens(999_600)).toBe("1M");
    expect(formatTokens(1_300_000)).toBe("1.3M");
  });

  it("formats dollars to cents under $10 and whole dollars above", () => {
    expect(formatUsd(3.4219)).toBe("$3.42");
    expect(formatUsd(9.994)).toBe("$9.99");
    expect(formatUsd(12.6)).toBe("$13");
    expect(formatUsd(1234.2)).toBe("$1,234");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("under $0.01");
  });

  it("writes tool activity by name, most used first", () => {
    expect(activityLine(snapshot().tools)).toBe("6 reads, 3 edits, 2 commands");
    expect(activityLine([{ name: "Edit", count: 1 }, { name: "MultiEdit", count: 1 }])).toBe("2 edits");
    expect(activityLine([{ name: "TodoWrite", count: 1 }])).toBe("1 TodoWrite call");
    expect(activityLine([])).toBeNull();
  });
});

describe("snapshot to view", () => {
  it("maps totals, cache share, prompts and activity", () => {
    const v = toView(snapshot(), 1_000_000, false);
    expect(v.total).toBe("412k tokens");
    expect(v.breakdown).toBe("in 38k, out 21k, cache 353k");
    expect(v.estimate).toBe("$3.42");
    expect(v.fromCache).toBe(`${Math.round((300_000 / 391_000) * 100)}%`);
    expect(v.prompts.map((p) => p.key)).toEqual([7, 6]);
    expect(v.prompts[0].share).toBe(1);
    expect(v.prompts[0].label).toMatch(/^Prompt 7, .+, 38k tokens, 5 tool calls$/);
    expect(v.activity).toBe("6 reads, 3 edits, 2 commands");
  });

  it("shows 'of' and a percent only when the window is known, Large above 70%", () => {
    expect(toView(snapshot(), 0, false).context).toEqual({ tokens: "142k tokens", of: null, percent: null, large: false });
    const big = toView(snapshot({ contextTokens: 750_000, contextWindow: 1_000_000 }), 0, false).context;
    expect(big).toEqual({ tokens: "750k tokens", of: "of 1M", percent: 75, large: true });
    expect(toView(snapshot({ contextTokens: null }), 0, false).context).toBeNull();
  });

  it("notes a missing or partial estimate", () => {
    expect(toView(snapshot({ estimateUsd: null }), 0, false).estimateNote).toBe("No list price is known for this model.");
    expect(toView(snapshot({ estimatePartial: true }), 0, false).estimateNote).toMatch(/not included/);
  });

  it("announces the finished prompt", () => {
    expect(finishedAnnouncement(snapshot())).toBe("Prompt 7 used 38k tokens");
    expect(finishedAnnouncement(snapshot({ prompts: [] }))).toBeNull();
  });
});

describe("cache line", () => {
  const last = 1_000_000;
  it("shows only after the verified TTL, and never while working", () => {
    expect(ttlLine(snapshot(), last + 59 * 60_000, false)).toBeNull();
    expect(ttlLine(snapshot(), last + 67 * 60_000, false)).toBe(
      "Last reply 67 min ago. The cache may have expired, so the next message can cost more.",
    );
    expect(ttlLine(snapshot(), last + 67 * 60_000, true)).toBeNull();
    expect(ttlLine(snapshot({ cacheTtlSecs: 300 }), last + 7 * 60_000, false)).toMatch(/^Last reply 7 min ago/);
  });

  it("is hidden when the TTL was not seen in the file", () => {
    expect(ttlLine(snapshot({ cacheTtlSecs: null }), last + 10 * 3_600_000, false)).toBeNull();
  });
});

describe("states", () => {
  const render = (props: Partial<Parameters<typeof CreditsView>[0]>) =>
    renderToString(
      createElement(CreditsView, {
        view: null,
        status: "none",
        mode: "tokens",
        onMode: () => {},
        ambiguous: false,
        announce: "",
        ...props,
      }),
    );

  it("empty, error and reading are never blank", () => {
    expect(render({ status: "none" })).toContain("Start Claude in this tab to see usage");
    expect(render({ status: "failed" })).toContain("Rokk could not read Claude&#x27;s session files. Usage is not shown.");
    expect(render({ status: "reading" })).toContain("Reading usage");
  });

  it("shows the footer, the ambiguous note and the estimate label", () => {
    const html = render({ status: "ok", view: toView(snapshot(), 0, false), ambiguous: true, mode: "estimate" });
    expect(html).toContain("Nothing is sent anywhere.");
    expect(html).toContain("Several Claude sessions are active in this folder; showing the newest.");
    expect(html).toContain("Estimate from list prices");
    expect(html).toContain("$3.42");
    expect(html).toContain('aria-live="polite"');
    expect(render({ status: "ok", view: toView(snapshot(), 0, false) })).not.toContain("Several Claude sessions");
  });

  it("uses text labels so color is never the only signal", () => {
    const html = render({ status: "ok", view: toView(snapshot({ contextTokens: 800_000, contextWindow: 1_000_000 }), 0, false) });
    expect(html).toContain("Large");
    expect(html).toContain("of 1M (80%)");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("poller", () => {
  afterEach(() => vi.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("polls every 2 seconds while active, once more after, then stops", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => false);
    const p = createPoller(read);
    p.setActive(true);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(read).toHaveBeenCalledTimes(3);
    p.setActive(false);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(read).toHaveBeenCalledTimes(4);
    p.stop();
  });

  it("reads once when kicked while idle, and catches up right away", async () => {
    vi.useFakeTimers();
    let left = 2;
    const read = vi.fn(async () => left-- > 0);
    const p = createPoller(read);
    p.kick();
    // Catch-up reads are scheduled at 0 ms, well before the 2 second tick.
    await vi.advanceTimersByTimeAsync(50);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(read).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("stop clears its timers", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => false);
    const p = createPoller(read);
    p.setActive(true);
    await flush();
    p.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

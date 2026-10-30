import type { PaneNode } from "@/modules/terminal/lib/panes";
import { describe, expect, it } from "vitest";
import {
  decideGreeting,
  type GreetContext,
  HANDSHAKE_COOLDOWN_MS,
  type HandshakeSignal,
  isClaudeStart,
  isHandshakeDisabled,
  shouldGreet,
  tabIdForLeaf,
} from "./rules";

const CLAUDE: HandshakeSignal = { kind: "started", agent: "claude" };

function ctx(over: Partial<GreetContext> = {}): GreetContext {
  return {
    tabId: 1,
    visibleTabId: 1,
    disabled: false,
    now: 100_000,
    log: new Map(),
    ...over,
  };
}

describe("isClaudeStart", () => {
  it("accepts only a claude start", () => {
    expect(isClaudeStart(CLAUDE)).toBe(true);
  });

  it("ignores other agents", () => {
    for (const agent of ["codex", "gemini", "pi", "opencode", "grok", "terax"]) {
      expect(isClaudeStart({ kind: "started", agent })).toBe(false);
    }
    expect(isClaudeStart({ kind: "started", agent: null })).toBe(false);
    expect(isClaudeStart({ kind: "started" })).toBe(false);
  });

  it("ignores every other signal state", () => {
    for (const kind of ["working", "attention", "finished", "exited", ""]) {
      expect(isClaudeStart({ kind, agent: "claude" })).toBe(false);
    }
  });
});

describe("isHandshakeDisabled", () => {
  it("is on by default and off only for the literal off", () => {
    expect(isHandshakeDisabled(null)).toBe(false);
    expect(isHandshakeDisabled("on")).toBe(false);
    expect(isHandshakeDisabled("")).toBe(false);
    expect(isHandshakeDisabled("OFF")).toBe(false);
    expect(isHandshakeDisabled("off")).toBe(true);
  });
});

describe("tabIdForLeaf", () => {
  const split: PaneNode = {
    kind: "split",
    id: 90,
    dir: "row",
    children: [
      { kind: "leaf", id: 11 },
      { kind: "leaf", id: 12 },
    ],
  };
  const single: PaneNode = { kind: "leaf", id: 10 };
  const tabs = [
    { id: 1, kind: "editor" },
    { id: 2, kind: "terminal", paneTree: single },
    { id: 3, kind: "terminal", paneTree: split },
  ];

  it("finds the tab that holds the leaf, including split panes", () => {
    expect(tabIdForLeaf(tabs, 10)).toBe(2);
    expect(tabIdForLeaf(tabs, 12)).toBe(3);
  });

  it("returns null for an unknown or missing leaf", () => {
    expect(tabIdForLeaf(tabs, 99)).toBeNull();
    expect(tabIdForLeaf(tabs, null)).toBeNull();
  });
});

describe("shouldGreet", () => {
  it("greets a claude start in the visible tab", () => {
    expect(shouldGreet(CLAUDE, ctx())).toBe(true);
  });

  it("skips when disabled", () => {
    expect(shouldGreet(CLAUDE, ctx({ disabled: true }))).toBe(false);
  });

  it("skips a tab that is not the visible tab", () => {
    expect(shouldGreet(CLAUDE, ctx({ tabId: 2, visibleTabId: 1 }))).toBe(false);
  });

  it("skips when the tab is unknown", () => {
    expect(shouldGreet(CLAUDE, ctx({ tabId: null }))).toBe(false);
  });

  it("skips other agents and other states", () => {
    expect(shouldGreet({ kind: "started", agent: "codex" }, ctx())).toBe(false);
    expect(shouldGreet({ kind: "working", agent: "claude" }, ctx())).toBe(
      false,
    );
  });

  it("holds the cooldown at 29 seconds and releases it at 31", () => {
    const log = new Map([[1, 100_000]]);
    expect(shouldGreet(CLAUDE, ctx({ log, now: 100_000 + 29_000 }))).toBe(
      false,
    );
    expect(shouldGreet(CLAUDE, ctx({ log, now: 100_000 + 31_000 }))).toBe(true);
  });

  it("keeps the cooldown per tab", () => {
    const log = new Map([[1, 100_000]]);
    expect(
      shouldGreet(CLAUDE, ctx({ log, tabId: 2, visibleTabId: 2, now: 101_000 })),
    ).toBe(true);
  });
});

describe("decideGreeting", () => {
  it("records the greeting time for the tab", () => {
    const { greet, log } = decideGreeting(CLAUDE, ctx());
    expect(greet).toBe(true);
    expect(log.get(1)).toBe(100_000);
  });

  it("never greets twice for one event delivered twice", () => {
    const first = decideGreeting(CLAUDE, ctx());
    const second = decideGreeting(CLAUDE, ctx({ log: first.log }));
    expect([first.greet, second.greet]).toEqual([true, false]);
  });

  it("does not start a cooldown for a skipped signal", () => {
    const hidden = decideGreeting(CLAUDE, ctx({ tabId: 2, visibleTabId: 1 }));
    expect(hidden.greet).toBe(false);
    expect(hidden.log.size).toBe(0);
    const shown = decideGreeting(
      CLAUDE,
      ctx({ tabId: 2, visibleTabId: 2, log: hidden.log }),
    );
    expect(shown.greet).toBe(true);
  });

  it("drops entries older than the cooldown", () => {
    const log = new Map([
      [7, 100_000 - HANDSHAKE_COOLDOWN_MS],
      [8, 100_000 - 1000],
    ]);
    const next = decideGreeting(CLAUDE, ctx({ log }));
    expect([...next.log.keys()].sort()).toEqual([1, 8]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  agentShortName,
  clearTabFinished,
  firstAgent,
  hasUnseenFinish,
  isClaudeAgent,
  markStateLabel,
  noteTabFinished,
  tabMarkState,
} from "./tabMarkState";

const quiet = { active: false, unseenDone: false };

describe("tabMarkState", () => {
  it("maps each agent state to its mark", () => {
    expect(tabMarkState(null, quiet)).toBe("idle");
    expect(tabMarkState("idle", quiet)).toBe("idle");
    expect(tabMarkState("working", quiet)).toBe("working");
    expect(tabMarkState("attention", quiet)).toBe("attention");
    expect(tabMarkState("finished", quiet)).toBe("done");
  });

  it("keeps an unseen finish until the tab is active", () => {
    expect(tabMarkState("idle", { active: false, unseenDone: true })).toBe(
      "done",
    );
    expect(tabMarkState("idle", { active: true, unseenDone: true })).toBe(
      "idle",
    );
  });

  it("lets live work outrank an old finish", () => {
    const old = { active: false, unseenDone: true };
    expect(tabMarkState("working", old)).toBe("working");
    expect(tabMarkState("attention", old)).toBe("attention");
  });

  it("treats an exited agent (no state) as idle", () => {
    expect(tabMarkState(null, { active: true, unseenDone: false })).toBe(
      "idle",
    );
  });
});

describe("labels", () => {
  it("names Claude Code as Claude and capitalizes others", () => {
    expect(agentShortName("claude")).toBe("Claude");
    expect(agentShortName(null)).toBe("Claude");
    expect(agentShortName("codex")).toBe("Codex");
  });

  it("describes every visible state in words", () => {
    expect(markStateLabel("working", "claude")).toBe("Claude is working");
    expect(markStateLabel("attention", "claude")).toBe("Claude needs you");
    expect(markStateLabel("done", "claude")).toBe("Claude finished");
    expect(markStateLabel("idle", "claude")).toBe("Claude is ready");
  });

  it("finds the first agent among a tab's ptys", () => {
    expect(firstAgent({ 4: "codex", 7: "claude" }, [7, 4])).toBe("claude");
    expect(firstAgent({}, [1])).toBeNull();
  });
});

describe("unseen finish set", () => {
  afterEach(() => clearTabFinished(9));

  it("records a finish only for a background tab", () => {
    noteTabFinished(9, true);
    expect(hasUnseenFinish(9)).toBe(false);
    noteTabFinished(9, false);
    expect(hasUnseenFinish(9)).toBe(true);
    clearTabFinished(9);
    expect(hasUnseenFinish(9)).toBe(false);
  });
});

describe("Claude versus other agents", () => {
  // The store reports "started" as working and an exited agent as no state.
  const STATES = [
    { name: "idle at the prompt", state: "idle", mark: "idle" },
    { name: "started", state: "working", mark: "working" },
    { name: "working", state: "working", mark: "working" },
    { name: "attention", state: "attention", mark: "attention" },
    { name: "finished", state: "finished", mark: "done" },
  ] as const;

  it.each(STATES)("maps $name the same for every agent", ({ state, mark }) => {
    expect(tabMarkState(state, quiet)).toBe(mark);
  });

  it("gives only Claude the spark", () => {
    expect(isClaudeAgent("claude")).toBe(true);
    for (const agent of ["codex", "gemini", "pi", "opencode", null]) {
      expect(isClaudeAgent(agent)).toBe(false);
    }
  });

  it("labels every Claude state, including idle", () => {
    expect(markStateLabel("idle", "claude")).toBe("Claude is ready");
    expect(markStateLabel("working", "claude")).toBe("Claude is working");
    expect(markStateLabel("attention", "claude")).toBe("Claude needs you");
    expect(markStateLabel("done", "claude")).toBe("Claude finished");
  });

  it("keeps other agents silent when idle and named otherwise", () => {
    expect(markStateLabel("idle", "codex")).toBe("");
    expect(markStateLabel("working", "codex")).toBe("Codex is working");
    expect(markStateLabel("attention", "gemini")).toBe("Gemini needs you");
  });

  it("drops an exited agent to the idle mark, even after an unseen finish", () => {
    expect(tabMarkState(null, { active: false, unseenDone: true })).toBe("idle");
    expect(markStateLabel("idle", null)).toBe("");
  });
});

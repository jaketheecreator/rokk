import { describe, expect, it } from "vitest";
import { canInsert, encodeInsert, type PaneState } from "./insert";

const STATES: PaneState[] = [null, "idle", "started", "working", "attention", "finished"];
const AGENTS = [null, "claude", "codex", "gemini"];

describe("canInsert", () => {
  it("allows only a terminal running Claude that is not mid-task", () => {
    for (const isTerminal of [true, false]) {
      for (const agent of AGENTS) {
        for (const state of STATES) {
          const ok =
            isTerminal &&
            agent === "claude" &&
            (state === "idle" || state === "started" || state === "attention" || state === "finished");
          expect(canInsert({ isTerminal, agent, state }).ok, `${isTerminal} ${agent} ${state}`).toBe(ok);
        }
      }
    }
  });

  it("explains why the button is disabled", () => {
    expect(canInsert({ isTerminal: false, agent: null, state: null })).toEqual({
      ok: false,
      reason: "Open a tab where Claude is running",
    });
    expect(canInsert({ isTerminal: true, agent: "claude", state: "working" })).toEqual({
      ok: false,
      reason: "Wait until Claude finishes or asks for you",
    });
  });
});

describe("encodeInsert", () => {
  it("wraps the text in one bracketed paste with no Enter outside it", () => {
    const out = encodeInsert("line one\nline two");
    expect(out.startsWith("\x1b[200~")).toBe(true);
    expect(out.endsWith("\x1b[201~")).toBe(true);
    expect(out.slice("\x1b[200~".length, -"\x1b[201~".length)).toBe("line one\rline two");
  });

  it("cannot be ended early by an escape inside the text", () => {
    const out = encodeInsert("evil\x1b[201~\rrm -rf");
    expect(out.split("\x1b").length - 1).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { buildDraft, clampGoal, type DraftInput, MAX_GOAL, type TaskType } from "./draft";
import { defaultRules, type HouseRules, RULES } from "./rules";

const base: DraftInput = {
  goal: "  Add a toggle to turn the greeting off  ",
  type: "build",
  dontTouch: "",
  checks: ["types", "lint", "tests"],
  reportLines: 12,
};
const ctx = { docs: ["CLAUDE.md", "AGENTS.md"], packageManager: "pnpm" as const };

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("buildDraft", () => {
  it("is stable: same input, same output", () => {
    expect(buildDraft(base, defaultRules(), ctx)).toBe(buildDraft(base, defaultRules(), ctx));
  });

  it("builds every section in order with the trimmed goal", () => {
    const out = buildDraft(base, defaultRules(), ctx);
    expect(out.startsWith("Build task. LIGHT task.\n\nGOAL\nAdd a toggle to turn the greeting off\n\nBEFORE YOU START")).toBe(true);
    const order = ["GOAL", "BEFORE YOU START", "RULES", "CHECKS", "REPORT"].map((h) => out.indexOf(`\n${h}\n`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("Read CLAUDE.md and AGENTS.md in the repo root");
    expect(out).toContain("Report what you find in about 8 lines, then continue.");
    expect(out).toContain("Run type check, lint and tests once each");
    expect(out).toContain("Report in at most 12 lines");
    expect(out).toContain("Use only pnpm as the package manager.");
  });

  it("lists every enabled rule exactly once", () => {
    const rules: HouseRules = { ...defaultRules(), extra: "Keep it short\nKeep it short\n\n" };
    const out = buildDraft({ ...base, dontTouch: "src-tauri" }, rules, ctx);
    expect(count(out, "Do not run git commands.")).toBe(1);
    expect(count(out, "Check `uptime` once")).toBe(1);
    expect(count(out, "- Keep it short")).toBe(1);
    expect(count(out, "- Do not touch: src-tauri")).toBe(1);
  });

  it("adds the edit-nothing line only for read-only types", () => {
    const types: TaskType[] = ["build", "fix", "explore", "review"];
    const hits = types.map((type) =>
      buildDraft({ ...base, type }, defaultRules(), ctx).includes("Edit nothing and run nothing that changes files."),
    );
    expect(hits).toEqual([false, false, true, true]);
    expect(buildDraft({ ...base, type: "explore" }, defaultRules(), ctx).startsWith("Explore (read only) task.")).toBe(true);
  });

  it("drops light, inventory and checks when they are off", () => {
    const rules = defaultRules();
    for (const r of RULES) rules.enabled[r.id] = false;
    const out = buildDraft({ ...base, checks: [] }, rules, { docs: [], packageManager: null });
    expect(out.startsWith("Build task.\n")).toBe(true);
    expect(out).not.toContain("LIGHT task");
    expect(out).not.toContain("about 8 lines");
    expect(out).not.toContain("CHECKS");
    expect(out).not.toContain("\nRULES\n");
    expect(out).toContain("contributor docs in the repo root, if any");
  });

  it("names the package manager only when the lockfile tells", () => {
    expect(buildDraft(base, defaultRules(), { docs: [], packageManager: null })).toContain(
      "Use only the project's package manager.",
    );
  });

  it("caps the goal at 4000 characters", () => {
    const long = "x".repeat(MAX_GOAL + 50);
    expect(clampGoal(long)).toHaveLength(MAX_GOAL);
    const out = buildDraft({ ...base, goal: long }, defaultRules(), ctx);
    expect(out).toContain("x".repeat(MAX_GOAL));
    expect(out).not.toContain("x".repeat(MAX_GOAL + 1));
  });
});

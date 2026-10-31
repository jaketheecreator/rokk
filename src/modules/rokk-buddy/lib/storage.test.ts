import { describe, expect, it } from "vitest";
import { MAX_RECENT, parseDraft, parseRecent, parseRules, pushRecent, recentLabel } from "./storage";

describe("recent drafts", () => {
  it("keeps the last ten, newest first, without duplicates", () => {
    let list: string[] = [];
    for (let i = 0; i < 15; i++) list = pushRecent(list, `draft ${i}`);
    list = pushRecent(list, "draft 10");
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe("draft 10");
    expect(list.filter((x) => x === "draft 10")).toHaveLength(1);
  });

  it("ignores empty drafts and labels with the first 60 characters", () => {
    expect(pushRecent(["a"], "   ")).toEqual(["a"]);
    expect(recentLabel("x".repeat(80))).toBe(`${"x".repeat(60)}...`);
    expect(recentLabel("short\n  text")).toBe("short text");
  });

  it("drops malformed stored data", () => {
    expect(parseRecent("nope")).toEqual([]);
    expect(parseRecent(["a", 3, "b"])).toEqual(["a", "b"]);
  });
});

describe("stored rules and draft", () => {
  it("merges stored rule switches over the defaults", () => {
    const rules = parseRules({ enabled: { noGit: false, bogus: true }, extra: "x" });
    expect(rules.enabled.noGit).toBe(false);
    expect(rules.enabled.light).toBe(true);
    expect(rules.extra).toBe("x");
    expect(parseRules(null).enabled.inventory).toBe(true);
  });

  it("validates a stored draft", () => {
    const d = parseDraft({ goal: "g", type: "hack", checks: ["types", "deploy"], reportLines: 5 });
    expect(d).toMatchObject({ goal: "g", type: "build", checks: ["types"], reportLines: 5 });
    expect(parseDraft(7)).toBeNull();
  });
});

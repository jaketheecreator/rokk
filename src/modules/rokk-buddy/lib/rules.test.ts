import { describe, expect, it } from "vitest";
import { defaultRules, detectPackageManager, extraLines, presentDocs, RULES, ruleLines } from "./rules";

describe("house rules", () => {
  it("turns every rule on by default", () => {
    const rules = defaultRules();
    expect(RULES.every((r) => rules.enabled[r.id])).toBe(true);
  });

  it("writes one line per enabled rule, none for inventory", () => {
    expect(ruleLines(defaultRules(), "pnpm")).toHaveLength(RULES.length - 1);
  });

  it("splits extra rules into unique trimmed lines", () => {
    expect(extraLines(" a \n\nb\na\n")).toEqual(["a", "b"]);
  });
});

describe("repo detection", () => {
  it("names the package manager from the lockfile", () => {
    expect(detectPackageManager(["package.json", "pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
    expect(detectPackageManager(["bun.lock"])).toBe("bun");
    expect(detectPackageManager(["package-lock.json"])).toBe("npm");
    expect(detectPackageManager(["README.md"])).toBeNull();
  });

  it("lists the convention docs that exist, in a fixed order", () => {
    expect(presentDocs(["CONTRIBUTING.md", "README.md", "CLAUDE.md"])).toEqual(["CLAUDE.md", "CONTRIBUTING.md"]);
  });
});

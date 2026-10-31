import { describe, expect, it } from "vitest";
import { analyzeReport, checkYourself, compareFiles, followUpGoal, MAX_UNSURE } from "./review";

const CLEAN = `The toggle is in and works.

- Added src/settings/sections/GeneralSection.tsx switch for the greeting.
- Updated src/modules/rokk-handshake/rules.ts to read the setting.

Checks: pnpm check-types passes, pnpm lint passes, and pnpm test passed all 2,103 tests.`;

const UNSURE = `Settings now has a left nav.

**Checks:** type check and lint pass; all tests passed.

**Unsure:**
- Centering on Linux Wayland, where the window manager may ignore the position.
- The width transition on close.`;

const NOT_RUN = `I changed src-tauri/src/lib.rs to clamp the window size.
I couldn't run cargo, so the Rust tests are unrun. Type check passes.`;

const WAITING = `I stopped before changing the lockfile because it needs your approval.
I'm waiting for your go-ahead to run pnpm install.`;

const NOT_ON_SCREEN = `The Settings layout is a centered page now (src/settings/SettingsApp.tsx, src/settings/SettingsSidebar.tsx).
Lint and tests pass. It hasn't been checked on screen.`;

describe("analyzeReport", () => {
  it("calls a clean report complete and finds runs and files", () => {
    const r = analyzeReport(CLEAN);
    expect(r.verdict).toBe("complete");
    expect(r.unsure).toEqual([]);
    expect(r.runs.map((x) => `${x.id}:${x.status}`)).toEqual(["types:passed", "lint:passed", "tests:passed"]);
    expect(r.paths).toEqual([
      "src/settings/sections/GeneralSection.tsx",
      "src/modules/rokk-handshake/rules.ts",
    ]);
  });

  it("quotes the lines under an Unsure heading", () => {
    const r = analyzeReport(UNSURE);
    expect(r.verdict).toBe("check");
    expect(r.unsure).toContain("Centering on Linux Wayland, where the window manager may ignore the position.");
    expect(r.unsure).toContain("The width transition on close.");
  });

  it("notices tests that were not run", () => {
    const r = analyzeReport(NOT_RUN);
    expect(r.verdict).toBe("check");
    expect(r.runs.find((x) => x.id === "tests")?.status).toBe("not run");
    expect(r.unsure.some((u) => u.includes("couldn't run cargo"))).toBe(true);
    expect(checkYourself(r).some((c) => c.startsWith("Tests was not run"))).toBe(true);
  });

  it("marks a report that stopped for approval as not finished", () => {
    const r = analyzeReport(WAITING);
    expect(r.verdict).toBe("unfinished");
    expect(checkYourself(r)[0]).toBe("Answer Claude's question or approve the step it is waiting for.");
    expect(followUpGoal(r)).toContain("You stopped before finishing.");
  });

  it("suggests looking on screen when it was not checked", () => {
    const r = analyzeReport(NOT_ON_SCREEN);
    expect(r.notOnScreen).toBe(true);
    expect(checkYourself(r)).toContain("Open the settings window and look at the new layout.");
  });

  it("is case-insensitive and caps quoted items", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Item ${i} is PROBABLY fine.`).join("\n");
    expect(analyzeReport(many).unsure).toHaveLength(MAX_UNSURE);
  });

  it("always offers three to six things to check", () => {
    for (const text of [CLEAN, UNSURE, NOT_RUN, WAITING, NOT_ON_SCREEN]) {
      const n = checkYourself(analyzeReport(text)).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

describe("compareFiles", () => {
  it("finds changed files that were not mentioned, and mentions that did not change", () => {
    const r = analyzeReport(NOT_ON_SCREEN);
    const files = compareFiles(r.paths, ["src/settings/SettingsApp.tsx", "src/styles/globals.css"]);
    expect(files.unmentioned).toEqual(["src/styles/globals.css"]);
    expect(files.unchanged).toEqual(["src/settings/SettingsSidebar.tsx"]);
    expect(followUpGoal(r, files)).toContain("src/styles/globals.css changed but your report does not mention it.");
  });

  it("matches a bare file name against its full path", () => {
    expect(compareFiles(["rules.ts"], ["src/modules/rokk-handshake/rules.ts"])).toEqual({
      unmentioned: [],
      unchanged: [],
    });
  });
});

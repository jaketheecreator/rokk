import type { GitChangedFile } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  type Baseline,
  badgeText,
  changesSince,
  type FileState,
  fileStatus,
  MAX_BASELINES,
  MAX_FILES,
  splitPath,
  toFileStates,
  withBaseline,
} from "./changes";

function git(
  path: string,
  index: string,
  worktree: string,
  extra: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    path,
    originalPath: null,
    indexStatus: index,
    worktreeStatus: worktree,
    staged: index !== " " && index !== "?",
    unstaged: worktree !== " " && worktree !== "?",
    untracked: false,
    statusLabel: "",
    ...extra,
  };
}

function baseline(files: GitChangedFile[], takenAt = 1, repoRoot = "/r"): Baseline {
  return { repoRoot, takenAt, files: toFileStates(files) };
}

describe("fileStatus", () => {
  it("maps git codes to M, A and D", () => {
    expect(fileStatus(git("a", " ", "M"))).toBe("M");
    expect(fileStatus(git("a", "A", " "))).toBe("A");
    expect(fileStatus(git("a", "?", "?", { untracked: true }))).toBe("A");
    expect(fileStatus(git("a", " ", "D"))).toBe("D");
    expect(fileStatus(git("a", "D", " "))).toBe("D");
  });
});

describe("changesSince", () => {
  const before = baseline([git("src/old.ts", " ", "M"), git("gone.ts", " ", "M")]);

  it("lists new, modified, deleted and reverted files", () => {
    const now = toFileStates([
      git("src/old.ts", " ", "M"), // unchanged since the baseline
      git("src/new.ts", "?", "?", { untracked: true }),
      git("src/edit.ts", " ", "M"),
      git("src/rm.ts", " ", "D"),
    ]);
    expect(changesSince(before, now).map((c) => `${c.status} ${c.path}`)).toEqual([
      "M src/edit.ts",
      "A src/new.ts",
      "D src/rm.ts",
      "R gone.ts",
    ]);
  });

  it("counts a status change on a file that was already dirty", () => {
    const now = toFileStates([git("src/old.ts", "M", "M"), git("gone.ts", " ", "M")]);
    expect(changesSince(before, now).map((c) => c.path)).toEqual(["src/old.ts"]);
  });

  it("counts changed line counts when both sides have them", () => {
    const withCounts = (added: number): Map<string, FileState> => {
      const m = toFileStates([git("a.ts", " ", "M")]);
      const f = m.get("a.ts");
      if (f) m.set("a.ts", { ...f, added, removed: 1 });
      return m;
    };
    const b: Baseline = { repoRoot: "/r", takenAt: 1, files: withCounts(3) };
    expect(changesSince(b, withCounts(3))).toHaveLength(0);
    const changed = changesSince(b, withCounts(9));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ status: "M", added: 9, removed: 1 });
  });

  it("is empty when nothing moved", () => {
    const now = toFileStates([git("src/old.ts", " ", "M"), git("gone.ts", " ", "M")]);
    expect(changesSince(before, now)).toEqual([]);
  });

  it("sorts by status, then path", () => {
    const now = toFileStates([
      git("z.ts", "?", "?", { untracked: true }),
      git("b.ts", " ", "M"),
      git("a.ts", " ", "M"),
    ]);
    expect(changesSince(baseline([]), now).map((c) => c.path)).toEqual([
      "a.ts",
      "b.ts",
      "z.ts",
    ]);
  });
});

describe("withBaseline", () => {
  it("replaces the baseline of the same repo", () => {
    const one = withBaseline(new Map(), baseline([], 1, "/a"));
    const two = withBaseline(one, baseline([git("x", " ", "M")], 2, "/a"));
    expect(two.size).toBe(1);
    expect(two.get("/a")?.takenAt).toBe(2);
  });

  it("keeps at most MAX_BASELINES repos and drops the oldest", () => {
    let map = new Map<string, Baseline>();
    for (let i = 0; i <= MAX_BASELINES; i++) {
      map = withBaseline(map, baseline([], i, `/repo${i}`));
    }
    expect(map.size).toBe(MAX_BASELINES);
    expect(map.has("/repo0")).toBe(false);
    expect(map.has(`/repo${MAX_BASELINES}`)).toBe(true);
  });

  it("caps the files kept per snapshot", () => {
    const many = Array.from({ length: MAX_FILES + 10 }, (_, i) =>
      git(`f${i}`, " ", "M"),
    );
    expect(toFileStates(many).size).toBe(MAX_FILES);
  });
});

describe("helpers", () => {
  it("shows a badge only above zero and caps it", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(4)).toBe("4");
    expect(badgeText(120)).toBe("99+");
  });

  it("splits a path into name and folder", () => {
    expect(splitPath("src/a/b.ts")).toEqual({ name: "b.ts", folder: "src/a" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
  });
});

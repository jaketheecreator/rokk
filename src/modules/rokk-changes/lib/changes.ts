import type { GitChangedFile } from "@/modules/ai/lib/native";

/** M modified, A added or new, D deleted, R reverted (back to unchanged). */
export type ChangeStatus = "M" | "A" | "D" | "R";

export type FileState = {
  path: string;
  originalPath: string | null;
  status: Exclude<ChangeStatus, "R">;
  /** Raw index and worktree codes; any difference counts as a change. */
  signature: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** Line counts, when the data source has them (git status does not). */
  added?: number;
  removed?: number;
};

export type Baseline = {
  repoRoot: string;
  takenAt: number;
  files: ReadonlyMap<string, FileState>;
};

export type Change = {
  path: string;
  originalPath: string | null;
  status: ChangeStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  added?: number;
  removed?: number;
};

export const MAX_BASELINES = 8;
export const MAX_FILES = 5000;

export function fileStatus(file: GitChangedFile): FileState["status"] {
  if (file.untracked) return "A";
  if (file.indexStatus === "D" || file.worktreeStatus === "D") return "D";
  if (file.indexStatus === "A") return "A";
  return "M";
}

export function toFileStates(
  files: readonly GitChangedFile[],
): Map<string, FileState> {
  const out = new Map<string, FileState>();
  for (const f of files) {
    if (out.size >= MAX_FILES) break;
    out.set(f.path, {
      path: f.path,
      originalPath: f.originalPath,
      status: fileStatus(f),
      signature: `${f.indexStatus}${f.worktreeStatus}${f.untracked ? "?" : ""}`,
      staged: f.staged,
      unstaged: f.unstaged,
      untracked: f.untracked,
    });
  }
  return out;
}

function countsChanged(a: FileState, b: FileState): boolean {
  if (a.added === undefined || b.added === undefined) return false;
  return a.added !== b.added || a.removed !== b.removed;
}

const ORDER: Record<ChangeStatus, number> = { M: 0, A: 1, D: 2, R: 3 };

export function sortChanges(changes: Change[]): Change[] {
  return changes.sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] || a.path.localeCompare(b.path),
  );
}

/** Files that are new, changed status or changed line counts since the
 * baseline, plus files that left the status list (reverted). */
export function changesSince(
  baseline: Baseline,
  current: ReadonlyMap<string, FileState>,
): Change[] {
  const out: Change[] = [];
  for (const file of current.values()) {
    const before = baseline.files.get(file.path);
    if (
      before &&
      before.signature === file.signature &&
      !countsChanged(before, file)
    ) {
      continue;
    }
    const { signature: _signature, ...rest } = file;
    out.push(rest);
  }
  for (const before of baseline.files.values()) {
    if (current.has(before.path)) continue;
    out.push({
      path: before.path,
      originalPath: before.originalPath,
      status: "R",
      staged: false,
      unstaged: false,
      untracked: false,
    });
  }
  return sortChanges(out);
}

/** Keeps the newest baseline per repo and at most MAX_BASELINES repos. */
export function withBaseline(
  baselines: ReadonlyMap<string, Baseline>,
  next: Baseline,
): Map<string, Baseline> {
  const out = new Map(baselines);
  out.delete(next.repoRoot);
  out.set(next.repoRoot, next);
  while (out.size > MAX_BASELINES) {
    let oldest: Baseline | null = null;
    for (const b of out.values()) {
      if (!oldest || b.takenAt < oldest.takenAt) oldest = b;
    }
    if (!oldest) break;
    out.delete(oldest.repoRoot);
  }
  return out;
}

export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export function splitPath(path: string): { name: string; folder: string } {
  const i = path.lastIndexOf("/");
  return i < 0
    ? { name: path, folder: "" }
    : { name: path.slice(i + 1), folder: path.slice(0, i) };
}

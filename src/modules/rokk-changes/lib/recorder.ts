import { native } from "@/modules/ai/lib/native";
import { leafIdForPty, subscribeAgentSignals } from "@/modules/terminal";
import { leafCwd } from "@/modules/terminal/lib/terminalSessionApi";
import {
  type Baseline,
  type Change,
  changesSince,
  toFileStates,
  withBaseline,
} from "./changes";

export type RepoChanges = {
  baseline: Baseline | null;
  changes: Change[];
  refreshedAt: number;
};

// Event driven only: a baseline on "started", a refresh on "finished" and
// "attention", plus whatever the Changes view asks for. Never polls.
let baselines = new Map<string, Baseline>();
const results = new Map<string, RepoChanges>();
const listeners = new Set<() => void>();
let version = 0;
let started = false;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function changesVersion(): number {
  return version;
}

export function repoChanges(repoRoot: string | null): RepoChanges | null {
  if (!repoRoot) return null;
  return results.get(repoRoot) ?? null;
}

export function changeCount(repoRoot: string | null): number {
  return repoChanges(repoRoot)?.changes.length ?? 0;
}

export async function refreshChanges(repoRoot: string): Promise<void> {
  const baseline = baselines.get(repoRoot) ?? null;
  if (!baseline) {
    results.set(repoRoot, { baseline: null, changes: [], refreshedAt: Date.now() });
    emit();
    return;
  }
  const status = await native.gitStatus(repoRoot);
  results.set(repoRoot, {
    baseline,
    changes: changesSince(baseline, toFileStates(status.changedFiles)),
    refreshedAt: Date.now(),
  });
  emit();
}

async function repoForPty(ptyId: number): Promise<string | null> {
  const leaf = leafIdForPty(ptyId);
  const cwd = leaf === null ? null : leafCwd(leaf);
  if (!cwd) return null;
  const repo = await native.gitResolveRepo(cwd);
  return repo?.repoRoot ?? null;
}

async function recordBaseline(ptyId: number): Promise<void> {
  const repoRoot = await repoForPty(ptyId);
  if (!repoRoot) return;
  const status = await native.gitStatus(repoRoot);
  const baseline: Baseline = {
    repoRoot,
    takenAt: Date.now(),
    files: toFileStates(status.changedFiles),
  };
  baselines = withBaseline(baselines, baseline);
  for (const root of results.keys()) {
    if (!baselines.has(root)) results.delete(root);
  }
  results.set(repoRoot, { baseline, changes: [], refreshedAt: baseline.takenAt });
  emit();
}

async function refreshForPty(ptyId: number): Promise<void> {
  const repoRoot = await repoForPty(ptyId);
  if (repoRoot && baselines.has(repoRoot)) await refreshChanges(repoRoot);
}

export function startChangesRecorder(): void {
  if (started) return;
  started = true;
  subscribeAgentSignals((signal) => {
    const run =
      signal.kind === "started" && signal.agent === "claude"
        ? recordBaseline
        : signal.kind === "finished" || signal.kind === "attention"
          ? refreshForPty
          : null;
    if (run) void run(signal.id).catch(() => {});
  });
}

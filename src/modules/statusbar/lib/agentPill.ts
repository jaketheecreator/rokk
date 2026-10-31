import type { MarkState } from "@/modules/tabs/lib/tabMarkState";
import {
  type AgentPhase,
  useAgentActivityStore,
} from "@/modules/terminal/lib/agentActivity";

export const DONE_PILL_MS = 8000;

/** 59s, 1m 05s, 2m 14s; from an hour on, whole minutes (61m). */
export function formatAgentDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) return `${minutes}m`;
  if (minutes === 0) return `${total}s`;
  return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
}

export function pillStyle(
  mark: MarkState,
  agent: string | null = null,
): string | null {
  switch (mark) {
    case "working":
      return agent === "claude"
        ? "bg-[var(--rk-claude-tint)] text-[var(--rk-claude-text)]"
        : "bg-[var(--rk-working-tint)] text-[var(--rk-working)]";
    case "attention":
      return "bg-[var(--rk-attention-tint)] text-[var(--rk-attention)]";
    case "done":
      return "bg-[var(--rk-done-tint)] text-[var(--rk-done)]";
    default:
      return null;
  }
}

/** Keeps a pty's start time while it is working or waiting on the user. */
export function nextWorkingSince(
  since: ReadonlyMap<number, number>,
  phases: Record<number, AgentPhase>,
  now: number,
): Map<number, number> {
  const next = new Map<number, number>();
  for (const [key, phase] of Object.entries(phases)) {
    const id = Number(key);
    if (phase !== "working" && phase !== "attention") continue;
    next.set(id, since.get(id) ?? now);
  }
  return next;
}

/** Earliest start among a tab's ptys, or null when none is working. */
export function tabWorkingSince(
  since: ReadonlyMap<number, number>,
  ptyIds: readonly number[],
): number | null {
  let start: number | null = null;
  for (const id of ptyIds) {
    const at = since.get(id);
    if (at !== undefined && (start === null || at < start)) start = at;
  }
  return start;
}

// The store has no start time, so the first working signal seen per pty is
// recorded here, once, for the lifetime of the window.
let workingSince = new Map<number, number>();
let tracking = false;

export function ensureWorkingTracker(): void {
  if (tracking) return;
  tracking = true;
  const sync = () => {
    const phases = useAgentActivityStore.getState().phases;
    workingSince = nextWorkingSince(workingSince, phases, Date.now());
  };
  sync();
  useAgentActivityStore.subscribe(sync);
}

export function workingSinceFor(ptyIds: readonly number[]): number | null {
  return tabWorkingSince(workingSince, ptyIds);
}

import { leafIdForPty, subscribeAgentSignals } from "@/modules/terminal";
import { appendEvent, isSignalKind, type PaneLog, pruneLogs } from "./rules";

// Per-pane signal history for the session rail, fed only by the shared agent
// signal. Small and capped (see rules.ts); closed panes are dropped.
let logs = new Map<number, PaneLog>();
const listeners = new Set<() => void>();
let version = 0;
let started = false;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeTimeline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function timelineVersion(): number {
  return version;
}

export function paneLog(ptyId: number): PaneLog | undefined {
  return logs.get(ptyId);
}

export function hasAnyRun(): boolean {
  return logs.size > 0;
}

/** Drops logs whose pane is gone. Called on every signal and by the rail. */
export function pruneClosedPanes(): void {
  const next = pruneLogs(logs, (id) => leafIdForPty(id) !== null);
  if (next.size !== logs.size) {
    logs = next;
    emit();
  }
}

export function startTimelineRecorder(): void {
  if (started) return;
  started = true;
  subscribeAgentSignals((signal) => {
    if (!isSignalKind(signal.kind)) return;
    const next = new Map(logs);
    next.set(
      signal.id,
      appendEvent(
        logs.get(signal.id),
        { kind: signal.kind, at: Date.now() },
        signal.agent ?? null,
      ),
    );
    logs = pruneLogs(next, (id) => id === signal.id || leafIdForPty(id) !== null);
    emit();
  });
}

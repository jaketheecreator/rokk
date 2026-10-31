export type SignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited";

export type PaneEvent = { kind: SignalKind; at: number };

export type PaneLog = {
  agent: string | null;
  events: PaneEvent[];
};

export const MAX_EVENTS = 20;
export const MAX_PANES = 32;

const KINDS: ReadonlySet<string> = new Set([
  "started",
  "working",
  "attention",
  "finished",
  "exited",
]);

export function isSignalKind(kind: string): kind is SignalKind {
  return KINDS.has(kind);
}

/** Appends one signal to a pane's log, keeping the last MAX_EVENTS. A new
 * "started" begins a fresh run, so earlier runs do not linger. */
export function appendEvent(
  log: PaneLog | undefined,
  event: PaneEvent,
  agent: string | null = null,
): PaneLog {
  if (event.kind === "started") {
    return { agent: agent ?? log?.agent ?? null, events: [event] };
  }
  const events = [...(log?.events ?? []), event];
  return {
    agent: log?.agent ?? agent,
    events: events.slice(-MAX_EVENTS),
  };
}

/** Drops logs of panes that no longer exist and caps the number of panes. */
export function pruneLogs(
  logs: ReadonlyMap<number, PaneLog>,
  alive: (ptyId: number) => boolean,
): Map<number, PaneLog> {
  const out = new Map<number, PaneLog>();
  for (const [id, log] of logs) if (alive(id)) out.set(id, log);
  while (out.size > MAX_PANES) {
    const first = out.keys().next().value;
    if (first === undefined) break;
    out.delete(first);
  }
  return out;
}

export type EntryKind = "started" | "working" | "needed" | "finished" | "exited";

export type TimelineEntry = {
  kind: EntryKind;
  at: number;
  /** Working: time spent; finished: total run time. */
  duration?: number;
  current: boolean;
};

/** Turns a pane's raw signals into the rail timeline. Only real signals
 * produce entries: a run starts, works, may need the user, finishes, exits. */
export function buildTimeline(
  events: readonly PaneEvent[],
  now: number,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let startedAt: number | null = null;
  const push = (kind: EntryKind, at: number, duration?: number) =>
    out.push({ kind, at, duration, current: false });
  for (const e of events) {
    const last = out[out.length - 1];
    switch (e.kind) {
      case "started":
        startedAt = e.at;
        push("started", e.at);
        push("working", e.at);
        break;
      case "working":
        if (last?.kind !== "working") push("working", e.at);
        break;
      case "attention":
        if (last?.kind !== "needed") push("needed", e.at);
        break;
      case "finished":
        push("finished", e.at, startedAt === null ? undefined : e.at - startedAt);
        break;
      case "exited":
        push("exited", e.at);
        break;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    if (entry.kind === "working") entry.duration = (out[i + 1]?.at ?? now) - entry.at;
  }
  const tail = out[out.length - 1];
  if (tail && tail.kind !== "finished" && tail.kind !== "exited") tail.current = true;
  return out;
}

export type RailState = "idle" | "working" | "attention" | "done";

/** Run time so far (while running) or the total once finished. */
export function runDuration(
  entries: readonly TimelineEntry[],
  now: number,
): number | null {
  const started = entries.find((e) => e.kind === "started");
  if (!started) return null;
  const finished = [...entries].reverse().find((e) => e.kind === "finished");
  if (finished?.duration !== undefined) return finished.duration;
  const ended = entries.some((e) => e.kind === "exited");
  return ended ? null : now - started.at;
}

/** When the current wait for the user began, or null if not waiting. */
export function waitingSince(entries: readonly TimelineEntry[]): number | null {
  const tail = entries[entries.length - 1];
  return tail?.kind === "needed" ? tail.at : null;
}

const RANK: Record<RailState, number> = {
  attention: 0,
  working: 1,
  done: 2,
  idle: 3,
};

/** Needs you first, then working, finished and idle; ties keep tab order. */
export function sortRailTabs<T extends { state: RailState; order: number }>(
  tabs: readonly T[],
): T[] {
  return [...tabs].sort(
    (a, b) => RANK[a.state] - RANK[b.state] || a.order - b.order,
  );
}

export function chipLabel(state: RailState): string {
  switch (state) {
    case "working":
      return "Working";
    case "attention":
      return "Needs you";
    case "done":
      return "Finished";
    default:
      return "Idle";
  }
}

export function entryLabel(kind: EntryKind, agentName: string): string {
  switch (kind) {
    case "started":
      return `${agentName} started`;
    case "working":
      return "Working";
    case "needed":
      return "Needed you";
    case "finished":
      return "Finished";
    default:
      return "Exited";
  }
}

/** Mirrors `Snapshot` in src-tauri/src/modules/rokk_meter/parse.rs. Numbers,
 * times, ids, model names and tool names only. */
export type MeterSnapshot = {
  sessionId: string;
  offset: number;
  reset: boolean;
  caughtUp: boolean;
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    responses: number;
    prompts: number;
  };
  models: {
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    responses: number;
    estimateUsd: number | null;
    unpriced: boolean;
  }[];
  prompts: { index: number; startedMs: number; tokens: number; toolCalls: number }[];
  contextTokens: number | null;
  contextWindow: number | null;
  contextModel: string | null;
  lastReplyMs: number | null;
  cacheTtlSecs: number | null;
  tools: { name: string; count: number }[];
  estimateUsd: number | null;
  estimatePartial: boolean;
  skippedLines: number;
};

export type SessionMatch = { sessionId: string; modifiedMs: number; ambiguous: boolean };

/** 999, 1.2k, 38k, 412k, 1.3M. */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${trim((v / 1000).toFixed(1))}k`;
  const k = Math.round(v / 1000);
  if (k < 1000) return `${k}k`;
  return `${trim((v / 1_000_000).toFixed(1))}M`;
}

function trim(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Cents under $10, whole dollars above. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "under $0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

const TOOL_WORDS: Record<string, [string, string]> = {
  Read: ["read", "reads"],
  Edit: ["edit", "edits"],
  MultiEdit: ["edit", "edits"],
  Write: ["new file", "new files"],
  NotebookEdit: ["edit", "edits"],
  Bash: ["command", "commands"],
  Grep: ["search", "searches"],
  Glob: ["search", "searches"],
  WebFetch: ["web lookup", "web lookups"],
  WebSearch: ["web lookup", "web lookups"],
  Agent: ["sub-agent", "sub-agents"],
  Task: ["sub-agent", "sub-agents"],
};

/** "6 reads, 3 edits, 2 commands", most used first, at most six parts. */
export function activityLine(tools: MeterSnapshot["tools"]): string | null {
  const merged = new Map<string, { count: number; one: string; many: string }>();
  for (const t of tools) {
    const [one, many] = TOOL_WORDS[t.name] ?? [`${t.name} call`, `${t.name} calls`];
    const cur = merged.get(many) ?? { count: 0, one, many };
    cur.count += t.count;
    merged.set(many, cur);
  }
  const parts = [...merged.values()].filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  if (parts.length === 0) return null;
  const shown = parts.slice(0, 6).map((p) => `${p.count} ${p.count === 1 ? p.one : p.many}`);
  const rest = parts.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

export type MeterView = {
  total: string;
  breakdown: string;
  estimate: string | null;
  estimateNote: string | null;
  context: { tokens: string; of: string | null; percent: number | null; large: boolean } | null;
  fromCache: string | null;
  prompts: { key: number; label: string; share: number }[];
  activity: string | null;
  ttlLine: string | null;
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function promptLabel(p: MeterSnapshot["prompts"][number]): string {
  const calls = `${p.toolCalls} tool ${p.toolCalls === 1 ? "call" : "calls"}`;
  return `Prompt ${p.index}, ${clock(p.startedMs)}, ${formatTokens(p.tokens)} tokens, ${calls}`;
}

/** The cache line, only when the TTL was read from the file. */
export function ttlLine(s: MeterSnapshot, now: number, working: boolean): string | null {
  if (working || !s.cacheTtlSecs || !s.lastReplyMs) return null;
  const ago = now - s.lastReplyMs;
  if (ago <= s.cacheTtlSecs * 1000) return null;
  const min = Math.round(ago / 60_000);
  const when = min >= 120 ? `${Math.round(min / 60)} hours` : `${min} min`;
  return `Last reply ${when} ago. The cache may have expired, so the next message can cost more.`;
}

export function toView(s: MeterSnapshot, now: number, working: boolean): MeterView {
  const t = s.totals;
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const inputSide = t.input + t.cacheRead + t.cacheWrite;
  let context: MeterView["context"] = null;
  if (s.contextTokens !== null) {
    const percent = s.contextWindow ? Math.min(100, Math.round((s.contextTokens / s.contextWindow) * 100)) : null;
    context = {
      tokens: `${formatTokens(s.contextTokens)} tokens`,
      of: s.contextWindow ? `of ${formatTokens(s.contextWindow)}` : null,
      percent,
      large: percent !== null && percent > 70,
    };
  }
  const recent = s.prompts.slice(-10).reverse();
  const max = Math.max(1, ...recent.map((p) => p.tokens));
  return {
    total: `${formatTokens(total)} tokens`,
    breakdown: `in ${formatTokens(t.input)}, out ${formatTokens(t.output)}, cache ${formatTokens(t.cacheRead + t.cacheWrite)}`,
    estimate: s.estimateUsd === null ? null : formatUsd(s.estimateUsd),
    estimateNote:
      s.estimateUsd === null
        ? "No list price is known for this model."
        : s.estimatePartial
          ? "Some responses have no list price and are not included."
          : null,
    context,
    fromCache: inputSide > 0 ? `${Math.round((t.cacheRead / inputSide) * 100)}%` : null,
    prompts: recent.map((p) => ({ key: p.index, label: promptLabel(p), share: p.tokens / max })),
    activity: activityLine(s.tools),
    ttlLine: ttlLine(s, now, working),
  };
}

/** "Prompt 7 used 38k tokens", for the live region when a prompt finishes. */
export function finishedAnnouncement(s: MeterSnapshot): string | null {
  const last = s.prompts[s.prompts.length - 1];
  return last ? `Prompt ${last.index} used ${formatTokens(last.tokens)} tokens` : null;
}

export const POLL_MS = 2000;

/**
 * Polls `read` every 2 seconds while active, once more 2 seconds after it
 * stops being active, and then stops. `read` resolves to true when more of
 * the file is waiting, which reads again right away.
 */
export function createPoller(read: () => Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let stopped = false;
  let busy = false;

  const schedule = (ms: number, then: () => void) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      then();
    }, ms);
  };

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    let more = false;
    try {
      more = await read();
    } catch {
      more = false;
    } finally {
      busy = false;
    }
    if (stopped) return;
    if (more) schedule(0, () => void tick());
    else if (active) schedule(POLL_MS, () => void tick());
  };

  return {
    /** Reads now (for example when the tab is first shown). */
    kick() {
      void tick();
    },
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      if (next) void tick();
      else schedule(POLL_MS, () => void tick());
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

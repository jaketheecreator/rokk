import { leafIds, type PaneNode } from "@/modules/terminal/lib/panes";

export const HANDSHAKE_AGENT = "claude";
export const HANDSHAKE_COOLDOWN_MS = 30_000;
export const HANDSHAKE_DURATION_MS = 2600;
export const HANDSHAKE_STORAGE_KEY = "rokk.handshake";

export type HandshakeSignal = { kind: string; agent?: string | null };

type TabLike = { id: number; kind: string; paneTree?: PaneNode };

/** Last greeting time per tab id. */
export type GreetingLog = ReadonlyMap<number, number>;

export type GreetContext = {
  /** Tab holding the pty that sent the signal, or null when unknown. */
  tabId: number | null;
  /** Tab currently on screen. */
  visibleTabId: number;
  disabled: boolean;
  now: number;
  log: GreetingLog;
};

/** Default on; only the literal "off" disables it. */
export function isHandshakeDisabled(stored: string | null): boolean {
  return stored === "off";
}

export function isClaudeStart(signal: HandshakeSignal): boolean {
  return signal.kind === "started" && signal.agent === HANDSHAKE_AGENT;
}

export function tabIdForLeaf(
  tabs: readonly TabLike[],
  leafId: number | null,
): number | null {
  if (leafId === null) return null;
  for (const tab of tabs) {
    if (tab.kind !== "terminal" || !tab.paneTree) continue;
    if (leafIds(tab.paneTree).includes(leafId)) return tab.id;
  }
  return null;
}

export function shouldGreet(
  signal: HandshakeSignal,
  ctx: GreetContext,
): boolean {
  if (ctx.disabled || !isClaudeStart(signal)) return false;
  if (ctx.tabId === null || ctx.tabId !== ctx.visibleTabId) return false;
  const last = ctx.log.get(ctx.tabId);
  return last === undefined || ctx.now - last >= HANDSHAKE_COOLDOWN_MS;
}

/** Decides one signal and returns the log to keep. A skipped signal leaves
 * the log untouched, so it never starts a cooldown. */
export function decideGreeting(
  signal: HandshakeSignal,
  ctx: GreetContext,
): { greet: boolean; log: GreetingLog } {
  if (!shouldGreet(signal, ctx) || ctx.tabId === null) {
    return { greet: false, log: ctx.log };
  }
  // Entries past the cooldown no longer matter; dropping them keeps the log
  // bounded by the tabs greeted in the last 30 seconds.
  const log = new Map<number, number>();
  for (const [tabId, at] of ctx.log) {
    if (ctx.now - at < HANDSHAKE_COOLDOWN_MS) log.set(tabId, at);
  }
  log.set(ctx.tabId, ctx.now);
  return { greet: true, log };
}

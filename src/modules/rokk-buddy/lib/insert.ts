import { encodeTerminalPaste } from "@/modules/terminal/ghostty/input/terminalInputEncoding";

export type PaneState = "idle" | "started" | "working" | "attention" | "finished" | null;

export type InsertContext = {
  isTerminal: boolean;
  agent: string | null;
  state: PaneState;
};

export type InsertDecision = { ok: true } | { ok: false; reason: string };

const READY: ReadonlySet<PaneState> = new Set(["idle", "started", "attention", "finished"]);

/** Paste only into a terminal where Claude runs and is not mid-task. */
export function canInsert(ctx: InsertContext): InsertDecision {
  if (!ctx.isTerminal || ctx.agent !== "claude" || ctx.state === null) {
    return { ok: false, reason: "Open a tab where Claude is running" };
  }
  if (!READY.has(ctx.state)) {
    return { ok: false, reason: "Wait until Claude finishes or asks for you" };
  }
  return { ok: true };
}

/** One bracketed paste (ESC[200~ ... ESC[201~): no Enter outside it, and
 * escape bytes inside are neutralized so the text cannot end the paste. */
export function encodeInsert(text: string): string {
  return encodeTerminalPaste(text, true);
}

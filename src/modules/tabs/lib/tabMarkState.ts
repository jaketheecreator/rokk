import type { AgentTabStatus } from "@/modules/terminal/lib/agentActivity";

export type MarkState = "idle" | "working" | "attention" | "done";

/**
 * Tab mark for an agent status. `unseenDone` keeps the finished badge until
 * the tab is focused, after the store itself has dropped back to idle.
 */
export function tabMarkState(
  state: AgentTabStatus["state"],
  { active, unseenDone }: { active: boolean; unseenDone: boolean },
): MarkState {
  if (state === "attention") return "attention";
  if (state === "working") return "working";
  if (state === "finished") return "done";
  // An exited agent (no state) drops straight back to the idle mark.
  if (state === "idle" && unseenDone && !active) return "done";
  return "idle";
}

/** Claude tabs show the Claude spark; every other agent keeps the Rokk mark. */
export function isClaudeAgent(agent: string | null): boolean {
  return agent === "claude";
}

/** "Claude" for Claude Code, otherwise the agent's display-ready name. */
export function agentShortName(agent: string | null): string {
  if (!agent || agent === "claude") return "Claude";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** Text that keeps the state from being color only. */
export function markStateLabel(mark: MarkState, agent: string | null): string {
  const name = agentShortName(agent);
  switch (mark) {
    case "working":
      return `${name} is working`;
    case "attention":
      return `${name} needs you`;
    case "done":
      return `${name} finished`;
    default:
      return isClaudeAgent(agent) ? `${name} is ready` : "";
  }
}

/** First known agent name among a tab's ptys. */
export function firstAgent(
  agents: Record<number, string>,
  ptyIds: readonly number[],
): string | null {
  for (const id of ptyIds) {
    const agent = agents[id];
    if (agent) return agent;
  }
  return null;
}

// Tabs whose agent finished while they were in the background.
const unseenDoneTabs = new Set<number>();

export function noteTabFinished(tabId: number, active: boolean): void {
  if (!active) unseenDoneTabs.add(tabId);
}

export function clearTabFinished(tabId: number): void {
  unseenDoneTabs.delete(tabId);
}

export function hasUnseenFinish(tabId: number): boolean {
  return unseenDoneTabs.has(tabId);
}

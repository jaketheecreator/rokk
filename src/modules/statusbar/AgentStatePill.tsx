import { RokkStateMark } from "@/components/brand/RokkStateMark";
import { cn } from "@/lib/utils";
import type { Tab } from "@/modules/tabs";
import {
  firstAgent,
  type MarkState,
  markStateLabel,
} from "@/modules/tabs/lib/tabMarkState";
import { leafIds, ptyIdForLeaf, useAgentActivityStore } from "@/modules/terminal";
import { tabAgentStatus } from "@/modules/terminal/lib/agentActivity";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DONE_PILL_MS,
  ensureWorkingTracker,
  formatAgentDuration,
  pillStyle,
  workingSinceFor,
} from "./lib/agentPill";

const NO_PTYS: number[] = [];

function activePtyIds(tab: Tab | undefined): number[] {
  if (tab?.kind !== "terminal") return NO_PTYS;
  const ids: number[] = [];
  for (const leaf of leafIds(tab.paneTree)) {
    const id = ptyIdForLeaf(leaf);
    if (id !== null) ids.push(id);
  }
  return ids;
}

/** Agent state of the active tab: working with a running time, needs you,
 * or finished for eight seconds. Hidden otherwise. */
export function AgentStatePill({ activeTab }: { activeTab: Tab | undefined }) {
  const status = useAgentActivityStore(
    useShallow((s) => {
      const ptyIds = activePtyIds(activeTab);
      const tab = tabAgentStatus(s.phases, s.agents, ptyIds);
      return {
        state: tab.state,
        agent: tab.agent ?? firstAgent(s.agents, ptyIds),
      };
    }),
  );
  const [now, setNow] = useState(() => Date.now());
  const [doneUntil, setDoneUntil] = useState(0);

  useEffect(() => {
    ensureWorkingTracker();
  }, []);

  useEffect(() => {
    if (status.state === "finished") setDoneUntil(Date.now() + DONE_PILL_MS);
    else if (status.state === "working" || status.state === "attention")
      setDoneUntil(0);
  }, [status.state]);

  // Switching tabs drops a finish that belonged to the previous tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on tab change only
  useEffect(() => {
    setDoneUntil(0);
  }, [activeTab?.id]);

  useEffect(() => {
    if (doneUntil === 0) return;
    const t = setTimeout(() => setDoneUntil(0), doneUntil - Date.now());
    return () => clearTimeout(t);
  }, [doneUntil]);

  useEffect(() => {
    if (status.state !== "working") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status.state]);

  const mark: MarkState =
    status.state === "working"
      ? "working"
      : status.state === "attention"
        ? "attention"
        : status.state === "finished" || doneUntil > 0
          ? "done"
          : "idle";
  const style = pillStyle(mark, status.agent);
  if (!style) return null;

  const since =
    mark === "working" ? workingSinceFor(activePtyIds(activeTab)) : null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold",
        style,
      )}
    >
      <RokkStateMark state={mark} agent={status.agent} size={13} />
      <span>{markStateLabel(mark, status.agent)}</span>
      {since !== null ? (
        <span aria-hidden="true" className="tabular-nums">
          · {formatAgentDuration(now - since)}
        </span>
      ) : null}
    </span>
  );
}

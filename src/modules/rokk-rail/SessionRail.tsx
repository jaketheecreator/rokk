import { RokkMark } from "@/components/brand/RokkMark";
import { type RokkMarkState, RokkStateMark } from "@/components/brand/RokkStateMark";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { repoChanges, subscribeChanges, changesVersion } from "@/modules/rokk-changes/lib/recorder";
import { splitPath } from "@/modules/rokk-changes/lib/changes";
import { CreditsSlot } from "@/modules/rokk-meter";
import { formatAgentDuration } from "@/modules/statusbar/lib/agentPill";
import type { Tab } from "@/modules/tabs";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import {
  agentShortName,
  firstAgent,
  markStateLabel,
  tabMarkState,
} from "@/modules/tabs/lib/tabMarkState";
import { leafIds, ptyIdForLeaf, useAgentActivityStore } from "@/modules/terminal";
import { tabAgentStatus } from "@/modules/terminal/lib/agentActivity";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  buildTimeline,
  chipLabel,
  entryLabel,
  type RailState,
  runDuration,
  sortRailTabs,
  type TimelineEntry,
  waitingSince,
} from "./lib/rules";
import {
  paneLog,
  pruneClosedPanes,
  subscribeTimeline,
  timelineVersion,
} from "./lib/timeline";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelectTab: (id: number) => void;
  onShowChanges: () => void;
  repoRoot: string | null;
};

const CHIP: Record<RailState, string> = {
  idle: "bg-[var(--rk-field)] text-[var(--rk-text-2)]",
  working: "bg-[var(--rk-working-tint)] text-[var(--rk-working)]",
  attention: "bg-[var(--rk-attention-tint)] text-[var(--rk-attention)]",
  done: "bg-[var(--rk-done-tint)] text-[var(--rk-done)]",
};

const RING: Record<RailState, string> = {
  idle: "border-[var(--rk-text-2)]",
  working: "border-[var(--rk-working)] bg-[var(--rk-working-tint)]",
  attention: "border-[var(--rk-attention)] bg-[var(--rk-attention-tint)]",
  done: "border-[var(--rk-done)] bg-[var(--rk-done-tint)]",
};

const MAX_FILES = 5;

function ptysOf(tab: Tab): number[] {
  if (tab.kind !== "terminal") return [];
  const ids: number[] = [];
  for (const leaf of leafIds(tab.paneTree)) {
    const id = ptyIdForLeaf(leaf);
    if (id !== null) ids.push(id);
  }
  return ids;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function railState(state: ReturnType<typeof tabAgentStatus>["state"]): RailState {
  return tabMarkState(state, { active: true, unseenDone: false }) as RailState;
}

export function SessionRail({
  tabs,
  activeId,
  onSelectTab,
  onShowChanges,
  repoRoot,
}: Props) {
  useSyncExternalStore(subscribeTimeline, timelineVersion, timelineVersion);
  useSyncExternalStore(subscribeChanges, changesVersion, changesVersion);
  const phases = useAgentActivityStore((s) => s.phases);
  const agents = useAgentActivityStore((s) => s.agents);
  const [now, setNow] = useState(() => Date.now());

  // A changed tab list is when panes close; prune their logs then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs is the trigger
  useEffect(() => {
    pruneClosedPanes();
  }, [tabs]);

  const terminals = tabs.filter((t) => t.kind === "terminal");
  const activeTab = tabs.find((t) => t.id === activeId);
  const activePtys = activeTab ? ptysOf(activeTab) : [];
  const status = tabAgentStatus(phases, agents, activePtys);
  const state = railState(status.state);
  const agent = status.agent ?? firstAgent(agents, activePtys);

  // The active tab's log: the pane with the most recent signal.
  let events = paneLog(activePtys[0] ?? -1)?.events ?? [];
  let logAgent = paneLog(activePtys[0] ?? -1)?.agent ?? null;
  let logPty: number | null = activePtys[0] ?? null;
  for (const id of activePtys) {
    const log = paneLog(id);
    const last = log?.events[log.events.length - 1]?.at ?? 0;
    const best = events[events.length - 1]?.at ?? 0;
    if (log && last >= best) {
      events = log.events;
      logAgent = log.agent;
      logPty = id;
    }
  }
  const name = agentShortName(agent ?? logAgent);
  const entries = buildTimeline(events, now);
  const duration = runDuration(entries, now);
  const waiting = state === "attention" ? waitingSince(entries) : null;

  useEffect(() => {
    if (state !== "working") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  const anyRun = terminals.some((t) => ptysOf(t).some((id) => paneLog(id)));
  const changes = repoChanges(repoRoot);

  const tabRows = sortRailTabs(
    terminals.map((tab, order) => {
      const ptys = ptysOf(tab);
      const tabStatus = tabAgentStatus(phases, agents, ptys);
      const mark = tabMarkState(tabStatus.state, { active: true, unseenDone: false });
      const tabAgent = tabStatus.agent ?? firstAgent(agents, ptys);
      return {
        tab,
        order,
        state: mark as RailState,
        agent: tabAgent,
        text: markStateLabel(mark, tabAgent) || (tabAgent ? "" : "No agent"),
      };
    }),
  );

  return (
    <aside aria-label="Session" className="terax-pane flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[18px]">
      <span role="status" aria-live="polite" className="sr-only">
        {anyRun ? `${name}: ${chipLabel(state)}` : ""}
      </span>

      {!anyRun ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <RokkMark size={28} className="text-[var(--rk-text-2)]" />
          <p className="text-[14.5px] font-semibold text-[var(--rk-text)]">
            No Claude session yet
          </p>
          <p className="text-[12.5px] text-[var(--rk-text-2)]">
            Run claude in a terminal tab to see it here.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14.5px] font-semibold text-[var(--rk-text)]">
                Session
              </h2>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
                  CHIP[state],
                )}
              >
                {chipLabel(state)}
              </span>
            </div>
            {events.length > 0 ? (
              <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--rk-text-2)]">
                {(agent ?? logAgent) === "claude" ? (
                  <RokkStateMark state="idle" agent="claude" size={13} />
                ) : (
                  <AgentIcon agent={agent ?? logAgent ?? "agent"} size={13} />
                )}
                <span>{name}</span>
                {duration !== null ? (
                  <span aria-hidden="true" className="tabular-nums">
                    · {formatAgentDuration(duration)}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-[12.5px] text-[var(--rk-text-2)]">
                No agent in this tab
              </p>
            )}
          </section>

          <CreditsSlot ptyId={logPty} state={state} agent={agent ?? logAgent} />

          {waiting !== null ? (
            <div className="rounded-[var(--rk-radius-sm)] bg-[var(--rk-attention-tint)] px-3 py-2.5">
              <p className="text-[13px] font-semibold text-[var(--rk-attention)]">
                {name} is waiting for you
              </p>
              <p className="text-[12px] text-[var(--rk-text-2)]">
                Since {clock(waiting)}
              </p>
            </div>
          ) : null}

          {entries.length > 0 ? (
            <Timeline entries={entries} state={state} name={name} />
          ) : null}

          <section className="flex flex-col gap-1">
            <h3 className="text-[12.5px] font-semibold text-[var(--rk-text-2)]">
              Tabs
            </h3>
            {tabRows.map((row) => (
              <button
                key={row.tab.id}
                type="button"
                onClick={() => onSelectTab(row.tab.id)}
                className={cn(
                  "flex h-[34px] w-full min-w-0 items-center gap-2 rounded-[8px] px-2 text-left outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] focus-visible:ring-2 focus-visible:ring-ring/50",
                  row.tab.id === activeId && "bg-[var(--rk-active)]",
                )}
              >
                <RokkStateMark state={row.state as RokkMarkState} agent={row.agent} />
                <span className="min-w-0 truncate text-[13px] text-[var(--rk-text)]">
                  {labelFor(row.tab)}
                </span>
                <span className="ml-auto shrink-0 truncate text-[12px] text-[var(--rk-text-2)]">
                  {row.text}
                </span>
              </button>
            ))}
          </section>

          {changes?.baseline ? (
            <section className="mt-auto flex flex-col gap-1.5 border-t border-[var(--rk-edge)] pt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[12.5px] font-semibold text-[var(--rk-text-2)]">
                  Changed so far
                  <span className="ml-1.5 text-[var(--rk-text)]">
                    {changes.changes.length}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={onShowChanges}
                  className="rounded-[8px] px-2 py-0.5 text-[12px] font-medium text-[var(--rk-text-2)] outline-none hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)] focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  See all
                </button>
              </div>
              {changes.changes.slice(0, MAX_FILES).map((c) => (
                <span
                  key={c.path}
                  title={c.path}
                  className="truncate font-mono text-[12px] text-[var(--rk-text)]"
                >
                  {c.status} {splitPath(c.path).name}
                </span>
              ))}
            </section>
          ) : null}
        </>
      )}
      </div>
    </aside>
  );
}

function Timeline({
  entries,
  state,
  name,
}: {
  entries: TimelineEntry[];
  state: RailState;
  name: string;
}) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        const detail =
          entry.kind === "working" || entry.kind === "finished"
            ? entry.duration !== undefined
              ? formatAgentDuration(entry.duration)
              : ""
            : clock(entry.at);
        return (
          <li key={`${entry.kind}-${entry.at}`} className="relative flex gap-3 pb-3">
            {!last ? (
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-0 left-[4.5px] w-px bg-[var(--rk-text-2)] opacity-45"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-1 size-[10px] shrink-0 rounded-full",
                entry.current
                  ? cn("border-2", RING[state])
                  : "bg-[var(--rk-done)]",
              )}
            />
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium text-[var(--rk-text)]">
                {entryLabel(entry.kind, name)}
                {entry.current ? <span className="sr-only"> (current)</span> : null}
              </span>
              {detail ? (
                <span
                  aria-hidden={entry.kind === "working" && entry.current ? "true" : undefined}
                  className="text-[12px] tabular-nums text-[var(--rk-text-2)]"
                >
                  {detail}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

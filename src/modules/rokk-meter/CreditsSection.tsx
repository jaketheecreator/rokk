import { cn } from "@/lib/utils";
import { paneLog } from "@/modules/rokk-rail/lib/timeline";
import type { RailState } from "@/modules/rokk-rail/lib/rules";
import { leafCwd, leafIdForPty } from "@/modules/terminal/lib/terminalSessionApi";
import { useEffect, useRef, useState } from "react";
import { meterFindSession, meterRead } from "./lib/ipc";
import {
  createPoller,
  finishedAnnouncement,
  type MeterSnapshot,
  type MeterView,
  toView,
} from "./lib/meter";

export type CreditsProps = {
  ptyId: number | null;
  state: RailState;
  agent: string | null;
};

type Mode = "tokens" | "estimate";

const LABEL = "text-[12.5px] font-semibold text-[var(--rk-text-2)]";
const NOTE = "text-[12px] text-[var(--rk-text-2)]";

/** When the pane's Claude started, from the rail's signal log. */
function startedAt(ptyId: number | null): number {
  if (ptyId === null) return 0;
  const events = paneLog(ptyId)?.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "started") return events[i].at;
  }
  return 0;
}

export default function CreditsSection({ ptyId, state, agent }: CreditsProps) {
  const working = state === "working";
  const leaf = ptyId === null ? null : leafIdForPty(ptyId);
  const cwd = leaf === null ? null : leafCwd(leaf);
  const since = startedAt(ptyId);
  const claude = agent === "claude";

  const [mode, setMode] = useState<Mode>("tokens");
  const [snap, setSnap] = useState<MeterSnapshot | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [status, setStatus] = useState<"none" | "reading" | "ok" | "failed">("none");
  const [announce, setAnnounce] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const poller = useRef<ReturnType<typeof createPoller> | null>(null);
  const flags = useRef({ refind: false, announce: false, working });
  flags.current.working = working;

  useEffect(() => {
    setSnap(null);
    setAmbiguous(false);
    setStatus("none");
    setAnnounce("");
    if (!claude || !cwd) return;
    let sessionId: string | null = null;
    let offset = 0;
    const read = async (): Promise<boolean> => {
      try {
        if (!sessionId || flags.current.refind) {
          flags.current.refind = false;
          // A little slack for the time between the signal and the file.
          const found = await meterFindSession(cwd, since - 5000);
          if (found && found.sessionId !== sessionId) {
            sessionId = found.sessionId;
            offset = 0;
          }
          setAmbiguous(found?.ambiguous ?? false);
          if (!sessionId) return false;
          setStatus((s) => (s === "ok" ? s : "reading"));
        }
        const s = await meterRead(sessionId, cwd, offset);
        offset = s.offset;
        setSnap(s);
        setStatus("ok");
        if (flags.current.announce && !flags.current.working && s.caughtUp) {
          flags.current.announce = false;
          setAnnounce(finishedAnnouncement(s) ?? "");
        }
        return !s.caughtUp;
      } catch {
        setStatus("failed");
        return false;
      }
    };
    const p = createPoller(read);
    poller.current = p;
    p.kick();
    if (flags.current.working) p.setActive(true);
    return () => {
      p.stop();
      poller.current = null;
    };
  }, [claude, cwd, since]);

  useEffect(() => {
    const p = poller.current;
    if (!p) return;
    if (working) {
      flags.current.refind = true;
      flags.current.announce = true;
    }
    p.setActive(working);
  }, [working]);

  // Keeps "Last reply ... ago" current while idle.
  useEffect(() => {
    if (working || !snap?.cacheTtlSecs) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [working, snap?.cacheTtlSecs]);

  return (
    <CreditsView
      view={snap && status === "ok" ? toView(snap, now, working) : null}
      status={!claude || !cwd ? "none" : status}
      mode={mode}
      onMode={setMode}
      ambiguous={ambiguous}
      announce={announce}
    />
  );
}

export function CreditsView({
  view,
  status,
  mode,
  onMode,
  ambiguous,
  announce,
}: {
  view: MeterView | null;
  status: "none" | "reading" | "ok" | "failed";
  mode: Mode;
  onMode: (m: Mode) => void;
  ambiguous: boolean;
  announce: string;
}) {
  return (
    <section aria-labelledby="rk-credits-title" className="flex flex-col gap-3">
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div className="flex items-center justify-between gap-2">
        <h3 id="rk-credits-title" className={LABEL}>
          Credits
        </h3>
        <fieldset className="flex gap-0.5 rounded-[9px] bg-[var(--rk-field)] p-0.5">
          <legend className="sr-only">Show</legend>
          {(["tokens", "estimate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={cn(
                "h-6 rounded-[7px] px-2 text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                mode === m
                  ? "bg-[var(--rk-active)] font-semibold text-[var(--rk-text)]"
                  : "font-medium text-[var(--rk-text-2)] hover:text-[var(--rk-text)]",
              )}
            >
              {m === "tokens" ? "Tokens" : "Estimate"}
            </button>
          ))}
        </fieldset>
      </div>

      {status === "none" ? (
        <p className={NOTE}>Start Claude in this tab to see usage</p>
      ) : status === "failed" ? (
        <p className={NOTE}>Rokk could not read Claude's session files. Usage is not shown.</p>
      ) : !view ? (
        <p className={NOTE}>Reading usage from Claude's session files.</p>
      ) : (
        <Body view={view} mode={mode} />
      )}

      <p className="text-[11.5px] text-[var(--rk-text-2)]">
        Read from Claude's session files on this Mac. Nothing is sent anywhere.
        {ambiguous ? " Several Claude sessions are active in this folder; showing the newest." : null}
      </p>
    </section>
  );
}

function Bar({ share, tint }: { share: number; tint?: boolean }) {
  return (
    <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-[var(--rk-field)]">
      <span
        className={cn("block h-full rounded-full", tint ? "bg-[var(--rk-attention)]" : "bg-[var(--rk-text-2)]")}
        style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
      />
    </span>
  );
}

function Body({ view, mode }: { view: MeterView; mode: Mode }) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        {mode === "tokens" ? (
          <>
            <p className="text-[20px] font-semibold tabular-nums text-[var(--rk-text)]">{view.total}</p>
            <p className={NOTE}>{view.breakdown}</p>
          </>
        ) : (
          <>
            <p className="text-[20px] font-semibold tabular-nums text-[var(--rk-text)]">{view.estimate ?? "No estimate"}</p>
            <p className={NOTE}>Estimate from list prices</p>
            {view.estimateNote ? <p className={NOTE}>{view.estimateNote}</p> : null}
          </>
        )}
      </div>

      {view.context ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={LABEL}>Context now</span>
            <span className="text-[12.5px] tabular-nums text-[var(--rk-text)]">
              {view.context.tokens}
              {view.context.of ? ` ${view.context.of} (${view.context.percent}%)` : null}
              {view.context.large ? <span className="ml-1.5 font-semibold">Large</span> : null}
            </span>
          </div>
          {view.context.percent !== null ? <Bar share={view.context.percent / 100} tint={view.context.large} /> : null}
        </div>
      ) : null}

      {view.fromCache ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>From cache</span>
          <span className="text-[12.5px] tabular-nums text-[var(--rk-text)]">{view.fromCache} of input</span>
        </div>
      ) : null}

      {view.ttlLine ? <p className={NOTE}>{view.ttlLine}</p> : null}

      {view.prompts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>This session by prompt</span>
          <ul className="flex flex-col gap-1.5">
            {view.prompts.map((p) => (
              <li key={p.key} className="flex flex-col gap-1">
                <span className="text-[12px] tabular-nums text-[var(--rk-text)]">{p.label}</span>
                <Bar share={p.share} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.activity ? (
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>Activity</span>
          <span className="text-[12px] text-[var(--rk-text)]">{view.activity}</span>
        </div>
      ) : null}
    </>
  );
}

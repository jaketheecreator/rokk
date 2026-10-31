import { cn } from "@/lib/utils";
import { ClaudeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId } from "react";
import { BODY_PATH, HOLE_PATH } from "./RokkMark";

export type RokkMarkState = "idle" | "working" | "attention" | "done";

const TONE: Record<RokkMarkState, string> = {
  idle: "text-[var(--rk-text-2)]",
  working: "text-[var(--rk-working)]",
  attention: "text-[var(--rk-attention)]",
  done: "text-[var(--rk-done)]",
};

const DOT: Record<RokkMarkState, string | null> = {
  idle: null,
  working: null,
  attention: "bg-[var(--rk-attention)]",
  done: "bg-[var(--rk-done)]",
};

type Props = {
  state: RokkMarkState;
  /** Detected agent; Claude gets its spark instead of the Rokk mark. */
  agent?: string | null;
  size?: number;
  className?: string;
};

/** The Rokk mark as an agent state: the small square sits bottom left when
 * idle and hops to the top right while working (stepped, see
 * rokk-surfaces.css); attention and done add a dot. */
export function RokkStateMark({ state, agent, size = 15, className }: Props) {
  const maskId = `rk-sm-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dot = DOT[state];
  if (agent === "claude") {
    return (
      <span
        aria-hidden="true"
        data-rk-mark={state}
        className={cn(
          "relative inline-flex shrink-0 text-[var(--rk-claude)]",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <HugeiconsIcon
          icon={ClaudeIcon}
          size={size}
          strokeWidth={2}
          className="rk-spark"
        />
        {dot ? <Dot tone={dot} /> : null}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-rk-mark={state}
      className={cn(
        "relative inline-flex shrink-0",
        TONE[state],
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="#fff" />
            <path className="rk-sm-hole" fill="#000" d={HOLE_PATH} />
          </mask>
        </defs>
        <path fill="currentColor" d={BODY_PATH} mask={`url(#${maskId})`} />
      </svg>
      {dot ? <Dot tone={dot} /> : null}
    </span>
  );
}

function Dot({ tone }: { tone: string }) {
  return (
    <span
      className={cn(
        "absolute -top-0.5 -right-0.5 size-[5px] rounded-full ring-[1.5px] ring-[var(--rk-window)]",
        tone,
      )}
    />
  );
}

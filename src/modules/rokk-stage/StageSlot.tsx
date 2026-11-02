import { type ReactNode, useEffect, useRef } from "react";
import { exitStage, shouldExit, useStage } from "./lib/stage";

/** Mounts the lazy stage layer (children) while stage mode is on, applies
 * the exit rules and announces on and off. */
export function RokkStageSlot({
  terminals,
  zen,
  children,
}: {
  terminals: number;
  zen: boolean;
  children: ReactNode;
}) {
  const { on, announcement } = useStage();
  const prev = useRef({ terminals, zen });
  useEffect(() => {
    const next = { terminals, zen };
    if (on && shouldExit(prev.current, next)) exitStage();
    prev.current = next;
  }, [on, terminals, zen]);
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {on ? children : null}
    </>
  );
}

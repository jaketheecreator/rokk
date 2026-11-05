import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { clampShift } from "./controls";

/** A glass popover above the stage pill: focus moves in on open and back to
 * the trigger on close; Escape (never leaving stage mode) and an outside
 * click close it; it is shifted to stay 16px inside the window. */
export function Popover({
  label,
  trigger,
  onClose,
  children,
}: {
  label: string;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--rk-pop-dx", `${clampShift(r.left, r.right, window.innerWidth)}px`);
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("button,input"))?.focus();
  }, []);
  useEffect(() => {
    const back = trigger.current;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !back?.contains(t)) close.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      back?.focus();
    };
  }, [trigger]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="rk-stage-glass rk-stage-pop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close.current();
        }
      }}
    >
      {children}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getStage } from "../lib/stage";
import {
  begin,
  defaultSize,
  drag,
  type Fractions,
  fractionsOf,
  keyStep,
  readSize,
  type Side,
  type Size,
  sizeOf,
  sizeText,
  top,
  writeSize,
} from "./frame";

// [x side, y side, edge name]: corners first, then the four edges.
const HANDLES: readonly [number, number, Side | null][] = [
  [-1, -1, null],
  [1, -1, null],
  [1, 1, null],
  [-1, 1, null],
  [0, -1, "top"],
  [1, 0, "right"],
  [0, 1, "bottom"],
  [-1, 0, "left"],
];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const refit = () => setTimeout(() => window.dispatchEvent(new Event("resize")), 50);

/** The eight frame resize handles, in the control layer (hidden while
 * recording, never in the frame). Free by default; Shift keeps the shape. */
export function FrameSize() {
  const [win, setWin] = useState(() => ({ W: window.innerWidth, H: window.innerHeight }));
  const [stored, setStored] = useState<Fractions | null>(() => readSize(storage()));
  const [live, setLive] = useState<Size | null>(null);
  const [said, setSaid] = useState("");
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { W, H } = win;
  const size = live ?? sizeOf(stored, W, H);
  const { w, h } = size;

  useEffect(() => {
    const on = () => setWin({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  useLayoutEffect(() => {
    const s = document.documentElement.style;
    s.setProperty("--rk-stage-w", `${w}px`);
    s.setProperty("--rk-stage-h", `${h}px`);
    s.setProperty("--rk-stage-mt", `${top({ w, h }, H)}px`);
  }, [w, h, H]);
  useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
      for (const p of ["w", "h", "mt"]) document.documentElement.style.removeProperty(`--rk-stage-${p}`);
    },
    [],
  );

  const say = (s: Size) => {
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setSaid(sizeText(s)), 500);
  };
  const commit = (s: Size | null) => {
    if (getStage().recording) return;
    const f = s ? fractionsOf(s, W, H) : null;
    setStored(f);
    writeSize(storage(), f);
    say(s ?? defaultSize(W, H));
    refit();
  };

  const down = (e: React.PointerEvent<HTMLElement>, hx: number, hy: number) => {
    const session = begin(getStage().recording, size);
    if (!session || e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const { clientX: x0, clientY: y0 } = e;
    let last = size;
    let raf = 0;
    const move = (ev: PointerEvent) => {
      last = drag(session.cancel(), ev.clientX - x0, ev.clientY - y0, hx, hy, ev.shiftKey, W, H);
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        setLive(last);
      });
    };
    const stop = (keep: boolean) => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setLive(null);
      if (keep) commit(last);
    };
    const up = () => stop(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      stop(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  };

  const onKey = (e: React.KeyboardEvent, side: Side) => {
    if (e.key === "Home") {
      e.preventDefault();
      commit(null);
      return;
    }
    const next = keyStep(size, side, e.key, e.shiftKey, W, H);
    if (next) {
      e.preventDefault();
      commit(next);
    }
  };

  return (
    <>
      <span role="status" className="sr-only">
        {said}
      </span>
      {HANDLES.map(([x, y, side]) =>
        side ? (
          <button
            key={side}
            type="button"
            className="rk-stage-handle"
            data-x={x}
            data-y={y}
            aria-label={`Resize frame, ${side} edge`}
            onPointerDown={(e) => down(e, x, y)}
            onDoubleClick={() => commit(null)}
            onKeyDown={(e) => onKey(e, side)}
          />
        ) : (
          <div
            key={`${x},${y}`}
            aria-hidden="true"
            className="rk-stage-handle"
            data-x={x}
            data-y={y}
            onPointerDown={(e) => down(e, x, y)}
            onDoubleClick={() => commit(null)}
          />
        ),
      )}
    </>
  );
}

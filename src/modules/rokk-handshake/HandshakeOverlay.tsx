import { BODY_PATH, HOLE_PATH } from "@/components/brand/RokkMark";
import type { Tab } from "@/modules/tabs";
import { leafIdForPty, subscribeAgentSignals } from "@/modules/terminal";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  decideGreeting,
  type GreetingLog,
  HANDSHAKE_DURATION_MS,
  HANDSHAKE_STORAGE_KEY,
  isHandshakeDisabled,
  tabIdForLeaf,
} from "./rules";

// One-time hop derived from docs/rokk/brand/rokk-mark-animated.svg: its first
// hop (3.2% to 22% of the 4.8s loop) played twice on a 2.6s timeline, the
// second with the translate reversed. Nothing here repeats.
const HOP_CSS = `.rk-hs-move,.rk-hs-arc,.rk-hs-squash,.rk-hs-body{transform-box:fill-box;transform-origin:50% 50%}
.rk-hs-move{animation:rk-hs-move 2.6s both}
.rk-hs-arc{animation:rk-hs-arc 2.6s both}
.rk-hs-squash{animation:rk-hs-squash 2.6s both}
.rk-hs-body{animation:rk-hs-thump 2.6s both}
.rk-hs-pill{animation:rk-hs-pill 2.6s both}
@keyframes rk-hs-move{0%{transform:translate(0px,0px)}11.54%{transform:translate(0px,0px)}14.86%{transform:translate(0px,0px);animation-timing-function:cubic-bezier(.3,1.35,.45,1)}35.17%{transform:translate(30px,-30px);animation-timing-function:linear}46.25%{transform:translate(30px,-30px)}49.57%{transform:translate(30px,-30px);animation-timing-function:cubic-bezier(.3,1.35,.45,1)}69.88%{transform:translate(0px,0px);animation-timing-function:linear}80.95%{transform:translate(0px,0px)}100%{transform:translate(0px,0px)}}
@keyframes rk-hs-arc{0%{transform:translateY(0px)}11.54%{transform:translateY(0px)}14.86%{transform:translateY(0px);animation-timing-function:cubic-bezier(.2,.7,.4,1)}24%{transform:translateY(-10px);animation-timing-function:cubic-bezier(.6,0,.8,.4)}35.17%{transform:translateY(0px)}46.25%{transform:translateY(0px)}49.57%{transform:translateY(0px);animation-timing-function:cubic-bezier(.2,.7,.4,1)}58.71%{transform:translateY(-10px);animation-timing-function:cubic-bezier(.6,0,.8,.4)}69.88%{transform:translateY(0px)}80.95%{transform:translateY(0px)}100%{transform:translateY(0px)}}
@keyframes rk-hs-squash{0%{transform:scale(1,1)}11.54%{transform:scale(1,1);animation-timing-function:ease-out}14.86%{transform:scale(1.14,.84)}17.82%{transform:scale(.88,1.18)}33.32%{transform:scale(.93,1.07)}35.17%{transform:scale(1.2,.8)}39.6%{transform:scale(.96,1.05)}44.4%{transform:scale(1,1)}46.25%{transform:scale(1,1);animation-timing-function:ease-out}49.57%{transform:scale(1.14,.84)}52.52%{transform:scale(.88,1.18)}68.03%{transform:scale(.93,1.07)}69.88%{transform:scale(1.2,.8)}74.31%{transform:scale(.96,1.05)}79.11%{transform:scale(1,1)}80.95%{transform:scale(1,1)}100%{transform:scale(1,1)}}
@keyframes rk-hs-thump{0%{transform:scale(1,1)}11.54%{transform:scale(1,1)}34.25%{transform:scale(1,1)}35.17%{transform:scale(1.016,.984)}40.71%{transform:scale(.998,1.002)}46.25%{transform:scale(1,1)}68.95%{transform:scale(1,1)}69.88%{transform:scale(1.016,.984)}75.42%{transform:scale(.998,1.002)}80.95%{transform:scale(1,1)}100%{transform:scale(1,1)}}
@keyframes rk-hs-pill{0%{opacity:0;transform:scale(.92);animation-timing-function:ease-out}11.54%{opacity:1;transform:scale(1)}88.46%{opacity:1;transform:scale(1);animation-timing-function:ease-in}100%{opacity:0;transform:scale(1)}}
@keyframes rk-hs-fade{0%{opacity:0}11.54%{opacity:1}88.46%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.rk-hs-move,.rk-hs-arc,.rk-hs-squash,.rk-hs-body{animation:none}.rk-hs-pill{animation-name:rk-hs-fade}}`;

// Safety net when the pill's animationend never fires (paused window).
const FALLBACK_MS = HANDSHAKE_DURATION_MS + 1000;

type Greeting = { tabId: number; key: number };

type Props = { tabs: Tab[]; activeId: number };

declare global {
  interface Window {
    rokkHandshake?: () => void;
  }
}

function readDisabled(): boolean {
  try {
    return isHandshakeDisabled(localStorage.getItem(HANDSHAKE_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function HandshakeOverlay({ tabs, activeId }: Props) {
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeId);
  const logRef = useRef<GreetingLog>(new Map());
  const keyRef = useRef(0);

  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = activeId;
  }, [tabs, activeId]);

  useEffect(
    () =>
      subscribeAgentSignals((signal) => {
        const tabId = tabIdForLeaf(tabsRef.current, leafIdForPty(signal.id));
        const decision = decideGreeting(signal, {
          tabId,
          visibleTabId: activeRef.current,
          disabled: readDisabled(),
          now: Date.now(),
          log: logRef.current,
        });
        logRef.current = decision.log;
        if (!decision.greet || tabId === null) return;
        keyRef.current += 1;
        setGreeting({ tabId, key: keyRef.current });
      }),
    [],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.rokkHandshake = () => {
      keyRef.current += 1;
      setGreeting({ tabId: activeRef.current, key: keyRef.current });
    };
    return () => {
      delete window.rokkHandshake;
    };
  }, []);

  useEffect(() => {
    if (!greeting) return;
    const t = setTimeout(() => setGreeting(null), FALLBACK_MS);
    return () => clearTimeout(t);
  }, [greeting]);

  if (!greeting) return null;
  const host = document.querySelector(
    `[data-terminal-tab="${greeting.tabId}"]`,
  );
  if (!host) return null;

  return createPortal(
    <HandshakePill key={greeting.key} onDone={() => setGreeting(null)} />,
    host,
  );
}

function HandshakePill({ onDone }: { onDone: () => void }) {
  return (
    <div className="pointer-events-none absolute top-3 right-5 z-[6] select-none">
      <style>{HOP_CSS}</style>
      <div
        role="status"
        aria-live="polite"
        className="rk-hs-pill flex items-center gap-2 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] text-foreground shadow-sm"
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onDone();
        }}
      >
        <HopMark />
        <span>Claude started</span>
      </div>
    </div>
  );
}

function HopMark() {
  const maskId = `rk-hs-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" width={22} height={22} aria-hidden="true">
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100"
          height="100"
        >
          <rect width="100" height="100" fill="#fff" />
          <g className="rk-hs-move">
            <g className="rk-hs-arc">
              <g className="rk-hs-squash">
                <path fill="#000" d={HOLE_PATH} />
              </g>
            </g>
          </g>
        </mask>
      </defs>
      <g className="rk-hs-body">
        <path fill="currentColor" d={BODY_PATH} mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}

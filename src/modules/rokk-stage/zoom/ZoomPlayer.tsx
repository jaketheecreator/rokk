import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DWELL_RANGE,
  HOLD_RANGE,
  LEVEL_RANGE,
  phaseAt,
  type ZoomMode,
  type ZoomPlan,
} from "./algo";
import { sampleCameraPath } from "./camera";
import {
  createMediaClock,
  createZoomController,
  DEFAULT_KNOBS,
  DWELL_OFF,
  debugStats,
  EMPTY_NOTE,
  ERROR_TITLE,
  type Frame,
  formatTime,
  HINT,
  type Knobs,
  type Loaded,
  momentsText,
  REDUCED_NOTE,
  readMode,
  readOff,
  release,
  returnFocusTo,
  SAVED_NOTE,
  SCROLL_NOTE,
  SLIDER_HELP,
  seekKey,
  sliderOff,
  spaceToggles,
  TITLE,
  ticks,
  toggleSkip,
  writeMode,
  writeOff,
  zoomsText,
} from "./player";
import "./zoom.css";

// Loaded once the player is open: "Save with zoom" is its own small chunk.
const ExportPanel = lazy(() =>
  import("./ExportPanel").then((m) => ({ default: m.ExportPanel })),
);

type Controller = ReturnType<typeof createZoomController>;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Dev only: the last 300 rendered frames, for window.rokkZoomDebug().
const debugFrames: Frame[] = [];

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Loading, error and empty-plan lines. */
export function Status({
  error,
  loading,
  empty,
  onClose,
}: {
  error: string | null;
  loading: boolean;
  empty: boolean;
  onClose: () => void;
}) {
  "use no memo";
  if (error) {
    return (
      <div className="rk-zoom-error" role="alert">
        <p className="rk-zoom-error-title">{ERROR_TITLE}</p>
        <p>{error}</p>
        <button type="button" className="rk-zoom-btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (loading) return <p className="rk-zoom-note">Loading the recording...</p>;
  return empty ? <p className="rk-zoom-note">{EMPTY_NOTE}</p> : null;
}

/** "Preview zoom": plays a saved recording with the auto-zoom applied. The
 * video and its mouse path file are only read, never changed. */
export default function ZoomPlayer({
  mp4,
  sidecar,
  onClose,
  opener,
}: {
  mp4: string;
  sidecar: string;
  onClose: () => void;
  opener: () => HTMLElement | null;
}) {
  // Not memoized by the compiler: it renders a few times a second at most,
  // and the camera runs outside React; this keeps the lazy chunk small.
  "use no memo";
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const ctl = useRef<Controller | null>(null);
  const [reduced] = useState(reducedMotion);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [seconds, setSeconds] = useState(Number.NaN);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoomOn, setZoomOn] = useState(!reduced);
  const [knobs, setKnobs] = useState<Knobs>(() => ({
    ...DEFAULT_KNOBS,
    mode: readMode(storage()),
  }));
  const firstKnobs = useRef(knobs);
  // Zooms switched off by their ticks, kept per recording (MP4 file name).
  const file = mp4.split("/").pop() ?? mp4;
  const [off, setOff] = useState(() => readOff(storage(), file));
  const firstOff = useRef(off);
  const [plan, setPlan] = useState<ZoomPlan>();
  const [said, setSaid] = useState("");
  // Export: busy while saving, closing while asking to cancel, shown is the
  // saved file when "Play it here" switched the preview to it.
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    const v = video.current;
    let live = true;
    invoke<Loaded>("zoom_read", { path: sidecar }).then(
      (l) => live && setLoaded(l),
      (e) =>
        live &&
        setError(
          typeof e === "string" ? e : "The mouse path file could not be read.",
        ),
    );
    return () => {
      live = false;
      release(v);
    };
  }, [sidecar]);

  useEffect(() => {
    if (!loaded || Number.isNaN(seconds)) return;
    const c = createZoomController(
      loaded,
      seconds,
      reduced,
      (p) => {
        setPlan(p);
        setSaid(momentsText(p.segments.length));
      },
      firstKnobs.current,
      firstOff.current,
    );
    const box = stage.current;
    const ro =
      box && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(([e]) =>
            c.setBox(e.contentRect.width, e.contentRect.height),
          )
        : null;
    if (box) {
      c.setBox(box.clientWidth, box.clientHeight);
      ro?.observe(box);
    }
    ctl.current = c;
    setPlan(c.plan());
    setSaid(momentsText(c.plan().segments.length));
    return () => {
      ro?.disconnect();
      c.dispose();
      ctl.current = null;
    };
  }, [loaded, seconds, reduced]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      rokkZoomDebug?: () => ReturnType<typeof debugStats>;
    };
    w.rokkZoomDebug = () => debugStats(debugFrames);
    return () => {
      delete w.rokkZoomDebug;
    };
  }, []);

  // The camera runs on a smoothed media clock: each decoded frame's media
  // time (requestVideoFrameCallback) or each currentTime change, plus the
  // time since. One transform write per animation frame, no layout reads.
  useEffect(() => {
    const v = video.current;
    const c = ctl.current;
    if (!v || !c || !plan) return;
    c.setZoom(zoomOn && !shown);
    c.frame(v, v.currentTime * 1000, false);
    if (!playing) return;
    const clock = createMediaClock();
    const snap = () => clock.snap(v.currentTime * 1000, performance.now());
    snap();
    let seen = v.currentTime;
    let raf = 0;
    let vfc = 0;
    const rvfc = typeof v.requestVideoFrameCallback === "function";
    const onFrame: VideoFrameRequestCallback = (_, meta) => {
      clock.anchor(meta.mediaTime * 1000, performance.now());
      vfc = v.requestVideoFrameCallback(onFrame);
    };
    if (rvfc) vfc = v.requestVideoFrameCallback(onFrame);
    const tick = () => {
      const now = performance.now();
      const ct = v.currentTime;
      if (ct !== seen) {
        seen = ct;
        clock.anchor(ct * 1000, now);
      }
      const f = c.frame(v, clock.read(now, v.playbackRate), true);
      if (import.meta.env.DEV) {
        debugFrames.push({
          ...f,
          phase: c.zoom() ? phaseAt(c.plan(), f.t) : "idle",
        });
        if (debugFrames.length > 300) debugFrames.shift();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    v.addEventListener("seeked", snap);
    v.addEventListener("ratechange", snap);
    return () => {
      cancelAnimationFrame(raf);
      if (rvfc) v.cancelVideoFrameCallback(vfc);
      v.removeEventListener("seeked", snap);
      v.removeEventListener("ratechange", snap);
    };
  }, [plan, zoomOn, playing, shown]);

  const ready = !!plan && !error;
  const duration = Number.isFinite(seconds)
    ? seconds
    : (loaded?.end.t_ms ?? 0) / 1000;
  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
    ctl.current?.frame(v, t * 1000, false);
  };
  const toggle = () => {
    const v = video.current;
    if (v) void (v.paused ? v.play() : v.pause());
  };
  const knob = (next: Partial<Knobs>) => {
    setKnobs((k) => ({ ...k, ...next }));
    if (next.mode) writeMode(storage(), next.mode);
    ctl.current?.set(next);
  };
  const skip = (next: string[]) => {
    setOff(next);
    writeOff(storage(), file, next);
    ctl.current?.setSkips(next);
  };
  const mode = knobs.mode;
  const sliders = [
    ["level", "Level", LEVEL_RANGE, 0.1],
    ["dwellMs", "Dwell", DWELL_RANGE, 100],
    ["holdMs", "Hold", HOLD_RANGE, 100],
  ] as const;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && (busy ? setClosing(true) : onClose())}
    >
      <DialogContent
        className="rk-zoom-dialog"
        aria-describedby={undefined}
        onCloseAutoFocus={returnFocusTo(opener)}
        onKeyDown={(e) => {
          if (ready && spaceToggles(e.key, e.target as HTMLElement)) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <DialogTitle>{TITLE}</DialogTitle>
        <span role="status" aria-live="polite" className="sr-only">
          {said}
        </span>
        <div
          ref={stage}
          className="rk-zoom-stage"
          hidden={!!error}
          style={
            {
              aspectRatio: loaded
                ? `${loaded.video.width} / ${loaded.video.height}`
                : "16 / 10",
              "--rk-zoom-ar": loaded
                ? loaded.video.width / loaded.video.height
                : 1.6,
            } as CSSProperties
          }
        >
          <video
            ref={video}
            className="rk-zoom-video"
            src={convertFileSrc(shown ?? mp4)}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) =>
              !shown && setSeconds(e.currentTarget.duration)
            }
            onError={() => setError("The video file could not be played.")}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        {shown ? <p className="rk-zoom-note">{SAVED_NOTE}</p> : null}
        <Status
          error={error}
          loading={!ready && !error}
          empty={ready && plan.segments.length === 0}
          onClose={onClose}
        />
        {ready ? (
          <div className="rk-zoom-controls">
            <div className="rk-zoom-row">
              <button
                type="button"
                className="rk-zoom-btn"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <div className="rk-zoom-scrub">
                <input
                  type="range"
                  aria-label="Position"
                  aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
                  min={0}
                  max={duration}
                  step={0.01}
                  value={time}
                  onChange={(e) => seek(Number(e.currentTarget.value))}
                  onKeyDown={(e) => {
                    const t = seekKey(e.key, e.shiftKey, time, duration);
                    if (t !== null) {
                      e.preventDefault();
                      seek(t);
                    }
                  }}
                />
                {ticks(plan, duration * 1000).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="rk-zoom-tick"
                    style={{ left: `${t.left}%` }}
                    aria-pressed={t.on}
                    aria-label={t.label}
                    title={t.title}
                    disabled={busy}
                    onClick={() => skip(toggleSkip(off, t.anchor))}
                  />
                ))}
              </div>
              <span className="rk-zoom-time">
                {formatTime(time)} / {formatTime(duration)}
              </span>
              {zoomsText(plan) ? (
                <span className="rk-zoom-time">{zoomsText(plan)}</span>
              ) : null}
              {plan.anchors.some((a) => !a.enabled) ? (
                <button
                  type="button"
                  className="rk-zoom-link"
                  disabled={busy}
                  onClick={() => skip([])}
                >
                  Turn all on
                </button>
              ) : null}
            </div>
            <div className="rk-zoom-row">
              <button
                type="button"
                role="switch"
                aria-checked={zoomOn}
                disabled={busy || !!shown}
                className="rk-zoom-switch"
                onClick={() => setZoomOn(!zoomOn)}
              >
                <span aria-hidden="true" className="rk-zoom-knob" />
                Zoom
              </button>
              {/* biome-ignore lint/a11y/useSemanticElements: two toggle buttons in one row, not a form fieldset */}
              <div className="rk-zoom-seg" role="group" aria-label="Zoom on">
                <span aria-hidden="true">Zoom on</span>
                {(["clicks", "clicks-pauses"] as ZoomMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    disabled={busy}
                    onClick={() => knob({ mode: m })}
                  >
                    {m === "clicks" ? "Clicks" : "Clicks and pauses"}
                  </button>
                ))}
              </div>
              {sliders.map(([k, label, [min, max], step]) => {
                const v = knobs[k];
                // Dwell only matters for pauses.
                const idle = sliderOff(k, mode);
                const text =
                  k === "level"
                    ? `${v.toFixed(1)}x`
                    : `${(v / 1000).toFixed(1)} s`;
                return (
                  <label
                    key={k}
                    className="rk-zoom-slider"
                    title={idle ? DWELL_OFF : undefined}
                  >
                    {label}
                    <input
                      type="range"
                      disabled={busy || idle}
                      aria-disabled={idle || undefined}
                      min={min}
                      max={max}
                      step={step}
                      value={v}
                      title={SLIDER_HELP[k]}
                      aria-describedby={`rk-zoom-help-${k}`}
                      aria-valuetext={text.replace(" s", " seconds")}
                      onChange={(e) =>
                        knob({ [k]: Number(e.currentTarget.value) })
                      }
                    />
                    <output>{text}</output>
                    <span id={`rk-zoom-help-${k}`} className="sr-only">
                      {SLIDER_HELP[k]}
                    </span>
                  </label>
                );
              })}
              <button
                type="button"
                className="rk-zoom-btn"
                disabled={busy}
                onClick={() => {
                  setKnobs(DEFAULT_KNOBS);
                  writeMode(storage(), DEFAULT_KNOBS.mode);
                  setZoomOn(!reduced);
                  ctl.current?.reset();
                }}
              >
                Reset
              </button>
            </div>
            <p className="rk-zoom-note">{HINT}</p>
            {mode === "clicks-pauses" ? (
              <p className="rk-zoom-note">{SCROLL_NOTE}</p>
            ) : null}
            {reduced && !zoomOn ? (
              <p className="rk-zoom-note">{REDUCED_NOTE}</p>
            ) : null}
            <Suspense fallback={null}>
              <ExportPanel
                mp4={mp4}
                seconds={seconds}
                path={() => {
                  const p = ctl.current?.plan();
                  return p && seconds > 0
                    ? sampleCameraPath(p, seconds * 1000)
                    : null;
                }}
                shown={shown}
                onShow={setShown}
                onBusy={setBusy}
                closing={closing}
                onClosing={(close) => {
                  setClosing(false);
                  if (close) onClose();
                }}
              />
            </Suspense>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

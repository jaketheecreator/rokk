import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import type { CamPoint } from "./camera";
import {
  announcement,
  BAR_LABEL,
  baseName,
  CANCELLED,
  clock,
  type ExportEvent,
  type ExportView,
  IDLE,
  mbText,
  QUALITIES,
  type Quality,
  reduce,
  SAVE,
  SOFT_NOTE,
  sizeText,
  startError,
} from "./export";

/** "Save with zoom" under the player's settings. Hidden where the export is
 * not supported. `closing` asks to confirm cancelling a running export. */
export function ExportPanel({
  mp4,
  seconds,
  path,
  shown,
  onShow,
  onBusy,
  closing,
  onClosing,
}: {
  mp4: string;
  seconds: number;
  /** The camera path from the current plan and settings. */
  path: () => CamPoint[] | null;
  shown: string | null;
  onShow: (path: string | null) => void;
  onBusy: (busy: boolean) => void;
  closing: boolean;
  onClosing: (close: boolean) => void;
}) {
  "use no memo";
  const [supported, setSupported] = useState(false);
  const [quality, setQuality] = useState<Quality>("full");
  const [view, setView] = useState<ExportView>(IDLE);
  const [said, setSaid] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const last = useRef<ExportView>(IDLE);

  const apply = (next: ExportView) => {
    const text = announcement(last.current, next);
    if (text) setSaid(text);
    last.current = next;
    setView(next);
    onBusy(next.kind === "running");
  };
  // The event listener is set up once; it calls the latest apply.
  const applyLatest = useRef(apply);
  applyLatest.current = apply;

  useEffect(() => {
    let live = true;
    invoke<boolean>("zoom_export_supported").then(
      (ok) => live && setSupported(ok),
      () => {},
    );
    const off = listen<ExportEvent>("rokk-zoom-export", (e) => {
      const next = reduce(last.current, e.payload);
      if (live && next !== last.current) applyLatest.current(next);
    });
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, []);

  if (!supported) return null;
  const running = view.kind === "running" ? view : null;
  const cancel = () => {
    if (running?.job != null)
      void invoke("zoom_export_cancel", { job: running.job });
  };
  const start = () => {
    const cameraPath = path();
    if (!cameraPath) return;
    setAskDelete(false);
    onShow(null);
    apply({ kind: "running", job: null, progress: 0, seconds: 0 });
    invoke<number>("zoom_export_start", {
      videoPath: mp4,
      cameraPath,
      quality,
    }).then(
      (job) => {
        const v = last.current;
        if (v.kind === "running" && v.job === null) apply({ ...v, job });
      },
      (e) => apply(startError(e)),
    );
  };
  const remove = (path: string) =>
    invoke("record_delete", { path }).then(
      () => {
        if (shown) onShow(null);
        apply(IDLE);
        setSaid("Zoomed copy deleted");
      },
      (e) => apply(startError(e)),
    );
  const pct = Math.round((running?.progress ?? 0) * 100);

  return (
    <section className="rk-zoom-export" aria-label="Export">
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
      {running ? (
        <div className="rk-zoom-row">
          <div
            className="rk-zoom-bar"
            role="progressbar"
            aria-label={BAR_LABEL}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="rk-zoom-time">
            {pct}% · {clock(running.seconds)}
          </span>
          <button
            type="button"
            className="rk-zoom-btn"
            onClick={cancel}
            disabled={running.job == null}
          >
            Cancel
          </button>
          {closing ? (
            <span className="rk-zoom-confirm" role="alert">
              Cancel saving and close?
              <button
                type="button"
                className="rk-zoom-btn"
                onClick={() => onClosing(false)}
              >
                Keep saving
              </button>
              <button
                type="button"
                className="rk-zoom-btn"
                onClick={() => {
                  cancel();
                  onClosing(true);
                }}
              >
                Cancel and close
              </button>
            </span>
          ) : null}
        </div>
      ) : view.kind === "done" ? (
        <div className="rk-zoom-row">
          <p className="rk-zoom-note">
            Saved {baseName(view.output)}, {mbText(view.size)}
          </p>
          <button
            type="button"
            className="rk-zoom-btn"
            onClick={() => void revealItemInDir(view.output)}
          >
            Show in Finder
          </button>
          <button
            type="button"
            className="rk-zoom-btn"
            onClick={() => onShow(shown ? null : view.output)}
          >
            {shown ? "Back to the preview" : "Play it here"}
          </button>
          {askDelete ? (
            <span className="rk-zoom-confirm">
              Delete the zoomed copy? The original stays.
              <button
                type="button"
                className="rk-zoom-btn"
                onClick={() => void remove(view.output)}
              >
                Delete
              </button>
              <button
                type="button"
                className="rk-zoom-btn"
                onClick={() => setAskDelete(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="rk-zoom-btn"
              onClick={() => setAskDelete(true)}
            >
              Delete zoomed copy
            </button>
          )}
          <button
            type="button"
            className="rk-zoom-btn"
            onClick={() => {
              onShow(null);
              apply(IDLE);
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="rk-zoom-row" role="radiogroup" aria-label="Quality">
            {QUALITIES.map((q) => (
              <label key={q.id} className="rk-zoom-radio">
                <input
                  type="radio"
                  name="rk-zoom-quality"
                  checked={quality === q.id}
                  onChange={() => setQuality(q.id)}
                />
                {q.label}{" "}
                <span className="rk-zoom-time">{sizeText(seconds, q.id)}</span>
              </label>
            ))}
          </div>
          <p className="rk-zoom-note">{SOFT_NOTE}</p>
          {view.kind === "error" ? (
            <p className="rk-zoom-note" role="alert">
              {view.message} ({view.code})
            </p>
          ) : view.kind === "cancelled" ? (
            <p className="rk-zoom-note">{CANCELLED}</p>
          ) : null}
          <div className="rk-zoom-row">
            <button
              type="button"
              className="rk-zoom-btn rk-zoom-primary"
              onClick={start}
              disabled={!(seconds > 0)}
            >
              {view.kind === "error" ? "Try again" : SAVE}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { getStage, registerRecordingStop, setRecording, useStage } from "../lib/stage";
import * as ipc from "./ipc";
import {
  announcementFor,
  asRecordError,
  buttonState,
  cardTitle,
  createStuckWatch,
  eventEffect,
  isStuck,
  type ResultCard,
  CHECKLIST_TEXT,
  DEV_NOTE,
  errorDetail,
  errorLines,
  firstStep,
  PERMISSION_TEXT,
  RECORD_EVENT,
  RESTART_EVENT,
  type RecState,
  type RecordError,
  type RecordEvent,
  type RecordStatus,
  readAck,
  RESTART_NOTE,
  savedToast,
  startAfterOverlay,
  startCountdown,
  TOO_OLD_TIP,
  writeAck,
} from "./record";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function showError(e: RecordError) {
  const { title, detail } = errorLines(e);
  toast.error(title, { description: detail });
}

function showSaved(path: string) {
  const t = savedToast(path);
  toast.success(t.title, {
    action: { label: "Show in Finder", onClick: () => void revealItemInDir(t.path) },
    cancel: { label: "Copy path", onClick: () => void navigator.clipboard.writeText(t.path) },
  });
}

/** The Record pill, its dialogs and the countdown. macOS only. */
export default function RecordControls({ onHover }: { onHover: (inside: boolean) => void }) {
  const { recordRequest, recording } = useStage();
  const [card, setCard] = useState<ResultCard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<RecordStatus | null>(null);
  const [dialog, setDialog] = useState<"permission" | "checklist" | null>(null);
  const [asked, setAsked] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const countdown = useRef<ReturnType<typeof startCountdown> | null>(null);
  const prevState = useRef<RecState | null>(null);
  const requests = useRef(recordRequest);
  const again = useRef<() => void>(() => {});

  const refresh = () => ipc.recordStatus().then(setStatus, () => setStatus(null));

  useEffect(() => {
    // On mount, Rust decides: a stuck attribute from an earlier run is cleared.
    void ipc.recordStatus().then(
      (s) => {
        setStatus(s);
        if (isStuck(getStage().recording, s)) setRecording(false);
      },
      () => setStatus(null),
    );
    const unlisten = listen<RecordEvent>(RECORD_EVENT, ({ payload }) => {
      const said = announcementFor(prevState.current, payload);
      if (said) setLive(said);
      prevState.current = payload.state;
      setStatus((s) => (s ? { ...s, state: payload.state, elapsed: payload.elapsed } : s));
      const effect = eventEffect(payload);
      if (effect.recording !== null) setRecording(effect.recording);
      if (payload.state === "idle") {
        // Terminal: the controls come back with the result card.
        setCard(effect.card);
        if (effect.card?.kind === "saved") showSaved(effect.card.path);
        else if (effect.card?.kind === "error") showError(effect.card.error);
      }
    });
    // Restart in the recording controller: the normal "Record again" flow.
    const unlistenRestart = listen(RESTART_EVENT, () => again.current());
    registerRecordingStop(async () => {
      try {
        await ipc.recordStop();
        toast.success("Recording stopped and saved.");
      } catch (e) {
        showError(asRecordError(e));
      } finally {
        // Leaving stage mode must always work, even if the stop failed.
        setRecording(false);
      }
    });
    return () => {
      void unlisten.then((u) => u());
      void unlistenRestart.then((u) => u());
      registerRecordingStop(null);
      countdown.current?.cancel();
    };
  }, []);

  // Safety net: while the attribute says recording, ask Rust every 2 seconds
  // and on focus, and clear it when nothing is recording.
  useEffect(() => {
    if (!recording) return;
    const watch = createStuckWatch(ipc.recordStatus, () => getStage().recording, () => setRecording(false));
    const onFocus = () => void watch.check();
    window.addEventListener("focus", onFocus);
    return () => {
      watch.stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [recording]);

  const state = buttonState(status, IS_MAC);

  const begin = () => {
    setDialog(null);
    setCard(null);
    countdown.current = startCountdown(setCount, () => {
      countdown.current = null;
      void startAfterOverlay(
        () => setCount(null),
        nextFrame,
        () =>
          ipc.recordStart(getCurrentWebviewWindow().label, getStage().on).catch((e) => {
            const error = asRecordError(e);
            setRecording(false);
            setCard({ kind: "error", error });
          }),
      );
    });
  };

  again.current = begin;

  const onRecord = () => {
    const step = firstStep(state, readAck(storage()));
    if (step === "permission") setDialog("permission");
    else if (step === "checklist") setDialog("checklist");
    else if (step === "countdown") begin();
  };

  // Mod+Alt+R while stage mode is on: start, or stop when recording.
  useEffect(() => {
    if (recordRequest === requests.current) return;
    requests.current = recordRequest;
    if (getStage().recording) void ipc.recordStop().catch((e) => showError(asRecordError(e)));
    else if (count === null && dialog === null) onRecord();
  });

  if (state === "hidden") return null;

  // Outside the controls layer, which hides itself while recording.
  const overlay = createPortal(
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
      {card && count === null && !recording ? (
        <ResultCardView
          card={card}
          onShow={(path) => void revealItemInDir(path)}
          onAgain={() => (card.kind === "error" ? onRecord() : begin())}
          onDelete={() => setConfirmDelete(true)}
          onDone={() => setCard(null)}
        />
      ) : null}
      {count !== null ? (
        <div className="rk-stage-countdown" role="dialog" aria-modal="true" aria-label="Recording starts in">
          <span className="rk-stage-count" aria-live="assertive">
            {count}
          </span>
          <button
            type="button"
            className="rk-stage-glass rk-stage-cancel"
            onClick={() => {
              countdown.current?.cancel();
              countdown.current = null;
              setCount(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </>,
    document.body,
  );

  return (
    <>
      {overlay}
      {state === "tooOld" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button type="button" className="rk-stage-record" disabled aria-disabled="true">
                <span aria-hidden="true" className="rk-stage-dot" />
                Record
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{TOO_OLD_TIP}</TooltipContent>
        </Tooltip>
      ) : (
        <button
          type="button"
          className="rk-stage-record"
          disabled={state === "busy" || count !== null}
          onClick={onRecord}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
        >
          <span aria-hidden="true" className="rk-stage-dot" />
          {state === "needsPermission" ? "Allow screen recording" : "Record"}
        </button>
      )}

      <AlertDialog open={dialog === "permission"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow screen recording</AlertDialogTitle>
            <AlertDialogDescription>{PERMISSION_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          {import.meta.env.DEV ? <p className="text-[12px] text-[var(--rk-text-2)]">{DEV_NOTE}</p> : null}
          {asked ? <p className="text-[12px]">{RESTART_NOTE}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAsked(false)}>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void ipc
                  .recordRequestPermission()
                  .then(() => ipc.recordOpenSettings())
                  .then(() => setAsked(true), () => setAsked(true))
                  .finally(() => void refresh());
              }}
            >
              Open System Settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "checklist"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Before you record</AlertDialogTitle>
            <AlertDialogDescription>{CHECKLIST_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                writeAck(storage());
                begin();
              }}
            >
              Start recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              {card?.kind === "saved" ? card.name : ""} will be deleted from Movies/Rokk. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (card?.kind !== "saved") return;
                void ipc.recordDelete(card.path).then(
                  () => {
                    setCard(null);
                    setLive("Recording deleted");
                    toast.success("Recording deleted.");
                  },
                  (e) => showError(asRecordError(e)),
                );
              }}
            >
              Delete recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Which buttons a result card offers, in order. */
export function cardActions(card: ResultCard): string[] {
  if (card.kind === "saved") return ["Show in Finder", "Record again", "Delete recording", "Done"];
  if (card.kind === "discarded") return ["Record again", "Done"];
  return ["Try again", "Done"];
}

export function ResultCardView({
  card,
  onShow,
  onAgain,
  onDelete,
  onDone,
}: {
  card: ResultCard;
  onShow: (path: string) => void;
  onAgain: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const handlers: Record<string, () => void> = {
    "Show in Finder": () => card.kind === "saved" && onShow(card.path),
    "Record again": onAgain,
    "Try again": onAgain,
    "Delete recording": onDelete,
    Done: onDone,
  };
  return (
    <section aria-label="Recording result" className="rk-stage-glass rk-stage-result">
      <p className="rk-stage-result-title">{cardTitle(card)}</p>
      {card.kind === "saved" ? (
        <p className="rk-stage-result-detail">
          {`${card.name}${card.size ? `, ${card.size}` : ""}${card.warning ? `. ${card.warning.message}` : ""}`}
        </p>
      ) : null}
      {card.kind === "error" ? (
        <p className="rk-stage-result-detail">{errorDetail(card.error.code, card.reason)}</p>
      ) : null}
      <div className="rk-stage-result-actions">
        {cardActions(card).map((label) => (
          <button key={label} type="button" className="rk-stage-record" onClick={handlers[label]}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

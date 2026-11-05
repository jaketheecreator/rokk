// Pure parts of stage recording: the button state, texts, the checklist
// memory, the countdown and error lines. The Rust recorder is the source of
// truth for whether a recording runs.

export type RecState = "idle" | "starting" | "recording" | "stopping";

/** Mirrors `RecordStatus` in src-tauri/src/modules/rokk_record/mod.rs. */
export type RecordStatus = {
  supported: boolean;
  osOk: boolean;
  permission: boolean;
  state: RecState | null;
  elapsed: number;
  /** Why the last recording ended, for example "system". */
  lastReason?: StopReason | null;
  lastErrorCode?: string | null;
};

/** Why a recording ended, as the Rust recorder names it. */
export type StopReason = "tray" | "shortcut" | "discard" | "restart" | "system" | "cap" | "disk" | "window_closed" | "app_exit" | "error";

const REASON_TEXT: Record<StopReason, string> = {
  tray: "stopped from the menu bar",
  shortcut: "stopped from Rokk",
  discard: "stopped and discarded",
  restart: "discarded to record again",
  system: "stopped by macOS",
  cap: "stopped at the 10 minute limit",
  disk: "stopped because disk space ran low",
  window_closed: "stopped because the window closed",
  app_exit: "stopped because Rokk quit",
  error: "stopped by a capture error",
};

/** Plain words for a stop reason; unknown reasons give null. */
export function reasonText(reason: string | null | undefined): string | null {
  return reason && reason in REASON_TEXT ? REASON_TEXT[reason as StopReason] : null;
}

export type RecordError = { code: string; message: string };

/** Payload of the "rokk-record-state" event. The terminal event has state
 * "idle", an outcome, and `finished` (the file) or `error`. */
/** Auto-zoom is always on: the mouse path is saved beside the video, in
 * the hidden ~/Movies/Rokk/.zoom folder. */
export const AUTOZOOM_CHECKLIST =
  "Rokk also saves your mouse path (positions and clicks only) next to the video, so it can be zoomed later. Nothing about your screen is saved.";
const SKIPPED: Record<string, string> = {
  write_failed: "Auto-zoom could not save the mouse path.",
};

/** The extra `record_start` arguments. The stage frame (CSS pixels) is sent
 * only at app zoom 100%, where CSS pixels are points; otherwise it is null. */
export function trackArgs(rect: { x: number; y: number; width: number; height: number } | null, zoom: number) {
  return {
    cursorTrack: true,
    frame: rect && Math.abs(zoom - 1) < 0.001 ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
  };
}

export type RecordEvent = {
  state: RecState;
  elapsed: number;
  finished?: string | null;
  error?: RecordError | null;
  outcome?: "saved" | "discarded" | "error";
  size?: number;
  reason?: StopReason;
  sidecar?: string | null;
  skippedReason?: string | null;
};

export type ResultCard =
  | {
      kind: "saved";
      path: string;
      name: string;
      size: string | null;
      warning: RecordError | null;
      note?: string;
      /** The saved mouse path file, when there is one. */
      sidecar?: string;
    }
  | { kind: "discarded" }
  | { kind: "error"; error: RecordError; reason?: StopReason };

/** The result card for a terminal event, or null for progress events. */
export function resultFor(ev: RecordEvent): ResultCard | null {
  if (ev.state !== "idle") return null;
  // A restart goes straight back to the countdown; no card in between.
  if (ev.reason === "restart" && !ev.error) return null;
  if (ev.finished) {
    return {
      kind: "saved",
      path: ev.finished,
      name: ev.finished.split("/").pop() ?? ev.finished,
      size: typeof ev.size === "number" ? formatBytes(ev.size) : null,
      warning: ev.error ?? null,
      ...(ev.skippedReason && SKIPPED[ev.skippedReason] ? { note: SKIPPED[ev.skippedReason] } : {}),
      ...(ev.sidecar ? { sidecar: ev.sidecar } : {}),
    };
  }
  if (ev.error) return ev.reason ? { kind: "error", error: ev.error, reason: ev.reason } : { kind: "error", error: ev.error };
  return ev.outcome === "discarded" || ev.outcome === undefined ? { kind: "discarded" } : null;
}

/** 5.7 MB, 820 KB, 999 bytes. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} bytes`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${(n / 1_000_000_000).toFixed(1)} GB`;
}

export function cardTitle(card: ResultCard): string {
  return card.kind === "saved" ? "Recording saved" : card.kind === "discarded" ? "Recording discarded" : card.error.message;
}

/** True when the root attribute says recording but Rust says it is not. */
export function isStuck(attributeOn: boolean, status: RecordStatus | null): boolean {
  return attributeOn && (status === null || status.state === "idle" || status.state === null);
}

export const STATUS_CHECK_MS = 2000;

/** What an event does to the page: the recording attribute (null = leave
 * as is) and the result card. Every terminal event clears the attribute. */
export function eventEffect(ev: RecordEvent): {
  recording: boolean | null;
  card: ResultCard | null;
} {
  if (ev.state === "recording") return { recording: true, card: null };
  if (ev.state === "idle") return { recording: false, card: resultFor(ev) };
  return { recording: null, card: null };
}

/** Every 2 seconds and on demand, asks Rust; calls `onStuck` when the page
 * still says recording but Rust does not. A failed check counts as stuck. */
export function createStuckWatch(status: () => Promise<RecordStatus | null>, attributeOn: () => boolean, onStuck: () => void) {
  const check = async () => {
    let s: RecordStatus | null = null;
    try {
      s = await status();
    } catch {
      s = null;
    }
    if (isStuck(attributeOn(), s)) onStuck();
  };
  const timer = setInterval(() => void check(), STATUS_CHECK_MS);
  return {
    check,
    stop() {
      clearInterval(timer);
    },
  };
}

/** Sent by Rust after the controller's Restart discarded the take. */
export const RESTART_EVENT = "rokk-record-restart";
export const RECORD_EVENT = "rokk-record-state";
export const ACK_KEY = "rokk.record.ack";

export type ButtonState = "hidden" | "tooOld" | "needsPermission" | "ready" | "busy";

export function buttonState(status: RecordStatus | null, mac: boolean): ButtonState {
  if (!mac || !status?.supported) return "hidden";
  if (!status.osOk) return "tooOld";
  if (status.state && status.state !== "idle") return "busy";
  return status.permission ? "ready" : "needsPermission";
}

export const TOO_OLD_TIP = "Recording needs macOS 15 or later";

export const PERMISSION_TEXT = "macOS needs your OK to record this window. Rokk records only its own window, never your other apps, and never audio.";
export const DEV_NOTE = "In development, macOS may list the app you started Rokk from (for example Terax) instead of Rokk.";
/** Shown after the settings are opened: macOS may need a restart to apply. */
export const RESTART_NOTE = "Quit and reopen Rokk, then try again.";

export const CHECKLIST_TEXT =
  "Before you record: Rokk records this window only, with no sound. Anything visible in it will be in the video. Check your terminal for API keys, tokens, emails and private file names. Notifications from other apps will not appear, but your cursor will.";

export const PREVIEW_CHECKLIST = "The preview is recorded as it appears, including anything your app shows on screen.";

export const EXTERNAL_CHECKLIST = "The preview shows a website. Anything visible on it, such as a signed-in account, will be in the video.";

/** The first-recording checklist, with one more sentence for the preview,
 * and another when the preview shows a website (not a local server). */
export function checklistFor(base: string, show: string, external = false): string {
  const preview = show === "preview" ? ` ${PREVIEW_CHECKLIST}` : "";
  const site = show === "preview" && external ? ` ${EXTERNAL_CHECKLIST}` : "";
  return `${base}${preview}${site} ${AUTOZOOM_CHECKLIST}`;
}

export type Choice = "permission" | "checklist" | "countdown";

/** What clicking Record opens first. */
export function firstStep(state: ButtonState, acknowledged: boolean): Choice | null {
  if (state === "needsPermission") return "permission";
  if (state !== "ready") return null;
  return acknowledged ? "countdown" : "checklist";
}

export function readAck(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAck(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(ACK_KEY, "1");
  } catch {
    // Without storage the checklist shows again next time; that is safe.
  }
}

/**
 * 3, 2, 1, then `done`. `cancel()` stops it and `done` never runs. The
 * caller removes the overlay and waits a frame before starting the capture.
 */
export function startCountdown(onTick: (n: number) => void, done: () => void, stepMs = 1000) {
  let n = 3;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  onTick(n);
  const next = () => {
    timer = setTimeout(() => {
      if (cancelled) return;
      n -= 1;
      if (n === 0) {
        timer = null;
        done();
        return;
      }
      onTick(n);
      next();
    }, stepMs);
  };
  next();
  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Removes the overlay, waits one frame so it is not painted into the video,
 * then starts the capture. */
export async function startAfterOverlay(removeOverlay: () => void, nextFrame: () => Promise<void>, start: () => Promise<unknown>): Promise<void> {
  removeOverlay();
  await nextFrame();
  await start();
}

export function savedToast(path: string): { title: string; path: string } {
  return { title: "Saved to Movies/Rokk", path };
}

export function asRecordError(e: unknown): RecordError {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const r = e as { code: unknown; message: unknown };
    return { code: String(r.code), message: String(r.message) };
  }
  return {
    code: "unknown",
    message: "Something went wrong with the recording.",
  };
}

/** The main line and the smaller code line of an error toast. */
export function errorLines(e: RecordError): { title: string; detail: string } {
  return { title: e.message, detail: `Error code: ${e.code}` };
}

/** The smaller line of an error card: the code, then why it stopped. */
export function errorDetail(code: string, reason?: string | null): string {
  const why = reasonText(reason);
  return why ? `Error code: ${code}, ${why}` : `Error code: ${code}`;
}

/** The live region text for an event; never the ticking seconds. */
export function announcementFor(prev: RecState | null, ev: RecordEvent): string | null {
  const card = resultFor(ev);
  if (card) return card.kind === "saved" ? `Recording saved, ${card.name}` : cardTitle(card);
  if (ev.error) return ev.error.message;
  if (ev.state === "recording" && prev !== "recording") return "Recording started";
  if (ev.state === "idle" && (prev === "recording" || prev === "stopping")) return "Recording stopped";
  return null;
}

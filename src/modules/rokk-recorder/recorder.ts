// The recording controller page: plain TypeScript, no React. It shows the
// recorder's state and sends one of three commands; Rust stays the source of
// truth. See docs/rokk/RECORD.md.

export const RECORD_EVENT = "rokk-record-state";

export type RecState = "idle" | "starting" | "recording" | "stopping";
export type RecordStateEvent = { state: RecState; elapsed: number };
export type Action = "stop" | "discard" | "restart";
export type Invoke = (command: string) => Promise<unknown>;

export type View = {
  timer: string;
  /** The red dot is lit; it steps once a second, and stays lit with reduced motion. */
  dotOn: boolean;
  /** A command is on its way; the buttons are disabled. */
  busy: boolean;
  /** Text for the live region, or null to leave it as it is. */
  announce: string | null;
};

/** "00:12", "09:59", "10:00". */
export function formatElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The one command each button sends. */
export function send(invoke: Invoke, action: Action): Promise<unknown> {
  switch (action) {
    case "stop":
      return invoke("record_stop");
    case "discard":
      return invoke("record_stop_discard");
    case "restart":
      return invoke("record_restart");
  }
}

export function createRecorder(invoke: Invoke, reducedMotion: () => boolean) {
  let state: RecState = "idle";
  let elapsed = 0;
  let busy = false;
  let announce: string | null = null;
  return {
    onEvent(ev: RecordStateEvent) {
      const prev = state;
      state = ev.state;
      elapsed = ev.elapsed;
      if (state === "recording" && prev !== "recording") {
        busy = false;
        announce = "Recording started";
      } else if (prev === "recording" && state !== "recording") {
        announce = "Recording stopped";
      } else {
        announce = null;
      }
      if (state === "idle") busy = false;
    },
    view(): View {
      return {
        timer: formatElapsed(elapsed),
        dotOn: reducedMotion() || elapsed % 2 === 0,
        busy,
        announce,
      };
    },
    /** One command at a time, only while recording. */
    async press(action: Action): Promise<void> {
      if (busy || state !== "recording") return;
      busy = true;
      try {
        await send(invoke, action);
      } catch {
        busy = false;
      }
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

export function markup(): string {
  return [
    '<div class="rk-rec" role="group" aria-label="Recording controls">',
    '<span class="rk-rec-dot" data-on="true" aria-hidden="true"></span>',
    '<span class="rk-rec-time">00:00</span>',
    '<button type="button" class="rk-rec-btn rk-rec-primary" data-action="stop" aria-label="Stop and save recording">Stop</button>',
    '<button type="button" class="rk-rec-btn" data-action="discard" aria-label="Stop and discard recording">Discard</button>',
    '<button type="button" class="rk-rec-btn" data-action="restart" aria-label="Discard and record again">Restart</button>',
    '<span class="rk-rec-sr" role="status" aria-live="polite"></span>',
    "</div>",
  ].join("");
}

// "Save with zoom": texts, the size estimate, and the export state from the
// "rokk-zoom-export" events (src-tauri/.../rokk_record/zoom_export.rs).

export type Quality = "full" | "small";

export const QUALITIES: readonly {
  id: Quality;
  label: string;
  mbPerMinute: number;
}[] = [
  { id: "full", label: "Full size (best quality)", mbPerMinute: 90 },
  { id: "small", label: "Smaller file (1920 wide)", mbPerMinute: 45 },
];
export const SOFT_NOTE =
  "Zoomed text can look soft, because screen recordings are saved at a low quality. A smaller zoom level looks sharper.";
export const SAVE = "Save with zoom";
export const BAR_LABEL = "Saving the zoomed video";
export const CANCELLED = "Cancelled. Nothing was saved.";

/** "About N MB" for a duration in seconds. */
export function sizeText(seconds: number, q: Quality): string {
  const rate = QUALITIES.find((x) => x.id === q)?.mbPerMinute ?? 90;
  const mb =
    Number.isFinite(seconds) && seconds > 0
      ? Math.max(1, Math.round((seconds / 60) * rate))
      : 1;
  return `About ${mb} MB`;
}

/** Elapsed time as 0:05. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const mbText = (bytes: number) =>
  `${Math.max(1, Math.round(bytes / 1e6))} MB`;
export const baseName = (path: string) => path.split("/").pop() ?? path;

export type ExportEvent = {
  job: number;
  state: "running" | "done" | "error" | "cancelled";
  progress: number;
  output: string | null;
  size: number | null;
  code: string | null;
  message: string | null;
  seconds_elapsed: number;
};

export type ExportView =
  | { kind: "idle" }
  | { kind: "running"; job: number | null; progress: number; seconds: number }
  | { kind: "done"; output: string; size: number }
  | { kind: "error"; code: string; message: string }
  | { kind: "cancelled" };

export const IDLE: ExportView = { kind: "idle" };

/** The view after an event. Events of another job are ignored; while the
 * start call has not returned yet (job null) the first job seen is ours. */
export function reduce(view: ExportView, e: ExportEvent): ExportView {
  if (view.kind !== "running" || (view.job !== null && e.job !== view.job))
    return view;
  switch (e.state) {
    case "running":
      return {
        kind: "running",
        job: e.job,
        progress: Math.min(1, Math.max(0, e.progress)),
        seconds: e.seconds_elapsed,
      };
    case "done":
      return { kind: "done", output: e.output ?? "", size: e.size ?? 0 };
    case "error":
      return {
        kind: "error",
        code: e.code ?? "unknown",
        message: e.message ?? "The zoomed video could not be saved.",
      };
    default:
      return { kind: "cancelled" };
  }
}

/** A refused start call, as a view. */
export function startError(e: unknown): ExportView {
  const o = (typeof e === "object" && e ? e : {}) as {
    code?: unknown;
    message?: unknown;
  };
  return {
    kind: "error",
    code: typeof o.code === "string" ? o.code : "unknown",
    message:
      typeof o.message === "string"
        ? o.message
        : "The zoomed video could not be saved.",
  };
}

/** What to announce politely when the view changes: the start, the half
 * way mark once, and the end. Never every tick. */
export function announcement(
  prev: ExportView,
  next: ExportView,
): string | null {
  if (next.kind === "running") {
    if (prev.kind !== "running") return "Saving the zoomed video started";
    return prev.progress < 0.5 && next.progress >= 0.5
      ? "50 percent saved"
      : null;
  }
  if (prev.kind === next.kind) return null;
  if (next.kind === "done")
    return `Saved ${baseName(next.output)}, ${mbText(next.size)}`;
  if (next.kind === "error") return next.message;
  return next.kind === "cancelled" ? CANCELLED : null;
}

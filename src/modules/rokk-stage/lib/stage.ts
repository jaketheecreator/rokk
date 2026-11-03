import { useSyncExternalStore } from "react";

// Stage mode: a presentation view of the window. The store lives here, in
// the startup chunk, with the toggle; the layer and its CSS load lazily.

export const STAGE_TOGGLE_ID = "rokk-stage-toggle";
const WALLPAPER_KEY = "rokk.stage.wallpaper";
export const CONTROLS_HIDE_MS = 2500;

export type WallpaperId = "horizon" | "embers" | "silk" | "lagoon" | "dusk" | "mist";

export type Wallpaper = {
  id: WallpaperId;
  name: string;
  /** Text color of the mark over this wallpaper. */
  ink: "light" | "dark";
  /** Shown while the image loads, or when the file is missing. */
  fallback: string;
};

export const WALLPAPERS: readonly Wallpaper[] = [
  { id: "horizon", name: "Horizon", ink: "light", fallback: "#2a3442" },
  { id: "embers", name: "Embers", ink: "light", fallback: "#3a2420" },
  { id: "silk", name: "Silk", ink: "dark", fallback: "#d9d3c7" },
  { id: "lagoon", name: "Lagoon", ink: "light", fallback: "#173a40" },
  { id: "dusk", name: "Dusk", ink: "light", fallback: "#2c2338" },
  { id: "mist", name: "Mist", ink: "light", fallback: "#3b4148" },
];

export const DEFAULT_WALLPAPER: WallpaperId = "horizon";

export function wallpaperById(id: string | null | undefined): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export function wallpaperUrl(id: WallpaperId): string {
  return `/stage/${id}.webp`;
}

export function readWallpaper(storage: Pick<Storage, "getItem"> | null = safeStorage()): WallpaperId {
  try {
    return wallpaperById(storage?.getItem(WALLPAPER_KEY)).id;
  } catch {
    return DEFAULT_WALLPAPER;
  }
}

export function writeWallpaper(id: WallpaperId, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(WALLPAPER_KEY, id);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The frame: min(1000px, 82vw) by min(620px, 100vh - 160px). Mirrors stage.css. */
export function frameSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(1000, width * 0.82)),
    height: Math.max(0, Math.min(620, height - 160)),
  };
}

// --- The store ---

export type EnteredBy = "mouse" | "keyboard";

export type StageState = {
  on: boolean;
  wallpaper: WallpaperId;
  controlsVisible: boolean;
  enteredBy: EnteredBy | null;
  /** For the visually hidden live region. */
  announcement: string;
  /** A recording is running (the Rust recorder is the source of truth). */
  recording: boolean;
  /** Bumped by Mod+Alt+R; the lazy record controls act on it. */
  recordRequest: number;
};

let state: StageState = {
  on: false,
  wallpaper: readWallpaper(),
  controlsVisible: true,
  enteredBy: null,
  announcement: "",
  recording: false,
  recordRequest: 0,
};
let stopRecording: (() => Promise<void>) | null = null;
let returnFocus: HTMLElement | null = null;
let warned = false;
const listeners = new Set<() => void>();

function set(next: Partial<StageState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function subscribeStage(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getStage(): StageState {
  return state;
}

export function useStage(): StageState {
  return useSyncExternalStore(subscribeStage, getStage, getStage);
}

/** One refit nudge for layout that moved without resizing. */
function nudgeResize(): void {
  if (typeof window === "undefined") return;
  setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

function enter(by: EnteredBy): void {
  const active = typeof document === "undefined" ? null : document.activeElement;
  const focusable = active && typeof (active as HTMLElement).focus === "function";
  returnFocus = by === "keyboard" && focusable ? (active as HTMLElement) : null;
  root()?.setAttribute("data-rokk-stage", "on");
  set({ on: true, enteredBy: by, controlsVisible: true, announcement: "Stage mode on" });
  nudgeResize();
}

export function exitStage(): void {
  if (!state.on) return;
  const by = state.enteredBy;
  root()?.removeAttribute("data-rokk-stage");
  // Never leave the page thinking it records; the menu bar item stays the
  // way to stop a capture that is still running.
  setRecording(false);
  set({ on: false, enteredBy: null, announcement: "Stage mode off" });
  nudgeResize();
  const target = focusTarget(by, returnFocus);
  returnFocus = null;
  // After the header is shown again.
  if (target) setTimeout(() => target.focus(), 0);
}

/** Where focus goes after leaving: the button for a mouse entry, the
 * element that had focus (the terminal) for a keyboard entry. */
export function focusTarget(by: EnteredBy | null, previous: HTMLElement | null): HTMLElement | null {
  if (by === "mouse") {
    return typeof document === "undefined" ? null : document.getElementById(STAGE_TOGGLE_ID);
  }
  return previous?.isConnected ? previous : null;
}

/** The one toggle path, used by the shortcut and the button. Leaving while
 * recording stops (and saves) the recording first. */
export function toggleStage(by: EnteredBy = "keyboard"): void {
  if (state.on && state.recording && stopRecording) {
    void stopRecording().finally(exitStage);
    return;
  }
  if (state.on) exitStage();
  else enter(by);
}

/** Mod+Alt+R: only does something while stage mode is on. */
export function requestRecordToggle(): boolean {
  if (!state.on) return false;
  set({ recordRequest: state.recordRequest + 1 });
  return true;
}

/** Mirrors the recorder state on the document root. */
export function setRecording(on: boolean): void {
  if (on) root()?.setAttribute("data-rokk-recording", "on");
  else root()?.removeAttribute("data-rokk-recording");
  if (on !== state.recording) set({ recording: on });
}

/** The record controls register how to stop, for leaving stage mode. */
export function registerRecordingStop(fn: (() => Promise<void>) | null): void {
  stopRecording = fn;
}

/** Enters stage mode without moving focus, for a recording found after a reload. */
export function enterForRecovery(): void {
  if (!state.on) enter("keyboard");
}

export function setWallpaper(id: WallpaperId): void {
  writeWallpaper(id);
  set({ wallpaper: id });
}

export function setControlsVisible(visible: boolean): void {
  if (visible !== state.controlsVisible) set({ controlsVisible: visible });
}

/** True the first time in this app session; the safety toast shows once. */
export function takeFirstEntryWarning(): boolean {
  if (warned) return false;
  warned = true;
  return true;
}

/** Exit rules: leaving when the last terminal tab closes or zen mode flips. */
export function shouldExit(
  prev: { terminals: number; zen: boolean },
  next: { terminals: number; zen: boolean },
): boolean {
  return (prev.terminals > 0 && next.terminals === 0) || prev.zen !== next.zen;
}

/** "Cmd+Option+S" on macOS, "Ctrl+Alt+S" elsewhere, from a binding. */
export function shortcutText(
  binding: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } | undefined,
  mac: boolean,
): string {
  if (!binding) return "";
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.meta) parts.push(mac ? "Cmd" : "Win");
  if (binding.alt) parts.push(mac ? "Option" : "Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join("+");
}

// --- Auto-hide for the controls ---

export type AutoHide = {
  move(): void;
  focusIn(): void;
  focusOut(): void;
  hoverIn(): void;
  hoverOut(): void;
  dispose(): void;
};

/** Visible on any movement; hidden after `delay` with no movement, unless
 * focus is inside the controls or the pointer is over them. */
export function createAutoHide(onChange: (visible: boolean) => void, delay = CONTROLS_HIDE_MS): AutoHide {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = false;
  let hovered = false;
  let visible = true;
  const show = (v: boolean) => {
    if (v === visible) return;
    visible = v;
    onChange(v);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    if (focused || hovered) return;
    timer = setTimeout(() => {
      timer = null;
      show(false);
    }, delay);
  };
  arm();
  return {
    move() {
      show(true);
      arm();
    },
    focusIn() {
      focused = true;
      show(true);
      clear();
    },
    focusOut() {
      focused = false;
      arm();
    },
    hoverIn() {
      hovered = true;
      show(true);
      clear();
    },
    hoverOut() {
      hovered = false;
      arm();
    },
    dispose: clear,
  };
}

import { useSyncExternalStore } from "react";

const OPEN_KEY = "rokk.rail";
const WIDTH_KEY = "rokk.rail.width";
export const RAIL_DEFAULT_WIDTH = 288;
export const RAIL_MIN_WIDTH = 240;
export const RAIL_MAX_WIDTH = 360;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the panel still works for this session.
  }
}

let open = read(OPEN_KEY) === "1";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isRailOpen(): boolean {
  return open;
}

export function setRailOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  write(OPEN_KEY, next ? "1" : "0");
  for (const l of listeners) l();
}

export function toggleRail(): void {
  setRailOpen(!open);
}

export function useRailOpen(): boolean {
  return useSyncExternalStore(subscribe, isRailOpen, isRailOpen);
}

export function clampRailWidth(width: number): number {
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width)));
}

export function readRailWidth(): number {
  const stored = Number.parseInt(read(WIDTH_KEY) ?? "", 10);
  return Number.isFinite(stored) ? clampRailWidth(stored) : RAIL_DEFAULT_WIDTH;
}

export function persistRailWidth(width: number): void {
  if (width > 0) write(WIDTH_KEY, String(clampRailWidth(width)));
}

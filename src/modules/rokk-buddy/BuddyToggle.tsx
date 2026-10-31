import { useShortcutLabel } from "@/modules/shortcuts";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useSyncExternalStore } from "react";

// The only startup piece of Prompt buddy: the open state, the top bar button,
// and a gate that mounts the lazy dialog after the first open.
let open = false;
let opened = false;
const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function setBuddyOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  if (next) opened = true;
  for (const l of listeners) l();
}

export const toggleBuddy = (): void => setBuddyOpen(!open);
export const isBuddyOpen = (): boolean => open;
const wasOpened = (): boolean => opened;

export function useBuddyOpen(): boolean {
  return useSyncExternalStore(subscribe, isBuddyOpen, isBuddyOpen);
}

export const BUDDY_TOGGLE_ID = "rokk-buddy-toggle";

export function BuddyGate({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, wasOpened, wasOpened);
  return mounted ? children : null;
}

export function BuddyToggle() {
  const isOpen = useBuddyOpen();
  const shortcut = useShortcutLabel("buddy.toggle");
  return (
    <button
      id={BUDDY_TOGGLE_ID}
      type="button"
      onClick={toggleBuddy}
      aria-label="Prompt buddy"
      aria-pressed={isOpen}
      title={shortcut ? `Prompt buddy (${shortcut})` : "Prompt buddy"}
      className="flex size-[31px] shrink-0 items-center justify-center rounded-[8px] p-[7px] text-[var(--rk-text-2)] outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)] focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-[var(--rk-field)] aria-pressed:text-[var(--rk-text)]"
    >
      <HugeiconsIcon icon={BubbleChatIcon} size={17} strokeWidth={1.75} />
    </button>
  );
}

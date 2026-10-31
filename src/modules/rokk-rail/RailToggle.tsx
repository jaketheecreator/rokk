import { useShortcutLabel } from "@/modules/shortcuts";
import { SidebarRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toggleRail, useRailOpen } from "./lib/railState";

export function RailToggle() {
  const open = useRailOpen();
  const shortcut = useShortcutLabel("rail.toggle");
  return (
    <button
      type="button"
      onClick={toggleRail}
      aria-label="Session panel"
      aria-pressed={open}
      title={shortcut ? `Session panel (${shortcut})` : "Session panel"}
      className="flex size-[31px] shrink-0 items-center justify-center rounded-[8px] p-[7px] text-[var(--rk-text-2)] outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)] focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-[var(--rk-field)] aria-pressed:text-[var(--rk-text)]"
    >
      <HugeiconsIcon icon={SidebarRightIcon} size={17} strokeWidth={1.75} />
    </button>
  );
}

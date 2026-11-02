import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { STAGE_TOGGLE_ID, shortcutText, toggleStage, useStage } from "./lib/stage";

const DEFAULT = SHORTCUTS.find((s) => s.id === "stage.toggle")?.defaultBindings[0];

/** The top-bar button. Same toggle as the shortcut. */
export function StageToggle() {
  const { on } = useStage();
  const user = usePreferencesStore((s) => s.shortcuts["stage.toggle"]?.[0]);
  const keys = shortcutText(user ?? DEFAULT, IS_MAC);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          id={STAGE_TOGGLE_ID}
          type="button"
          onClick={() => toggleStage("mouse")}
          aria-label="Stage mode"
          aria-pressed={on}
          className="flex size-[31px] shrink-0 items-center justify-center rounded-[8px] p-[7px] text-[var(--rk-text-2)] outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)] focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <HugeiconsIcon icon={PlayIcon} size={17} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{keys ? `Stage mode (${keys})` : "Stage mode"}</TooltipContent>
    </Tooltip>
  );
}

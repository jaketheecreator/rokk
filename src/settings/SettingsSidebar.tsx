import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { type KeyboardEvent, useRef, useSyncExternalStore } from "react";
import { isNarrowSettings, nextNavIndex } from "./settingsNav";

export type SettingsNavItem = {
  id: SettingsTab;
  label: string;
  icon: IconSvgElement;
};

type Props = {
  items: readonly SettingsNavItem[];
  active: SettingsTab;
  onSelect: (id: SettingsTab) => void;
  /** Forces the layout; follows the window width when omitted. */
  narrow?: boolean;
};

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useNarrowWindow(): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => isNarrowSettings(window.innerWidth),
    () => false,
  );
}

// Sticky inside the Settings scroller, so it stays in view while the content
// column scrolls past it.
export function SettingsSidebar({ items, active, onSelect, narrow }: Props) {
  const windowNarrow = useNarrowWindow();
  const isNarrow = narrow ?? windowNarrow;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextNavIndex(index, e.key, items.length);
    if (next === null) return;
    e.preventDefault();
    buttons.current[next]?.focus();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Settings sections"
        className={cn(
          "sticky top-6 shrink-0 self-start",
          isNarrow ? "w-12" : "w-50",
        )}
      >
        <ul className="flex flex-col gap-0.5">
          {items.map((item, index) => {
            const current = item.id === active;
            const button = (
              <button
                type="button"
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                aria-current={current ? "page" : undefined}
                aria-label={isNarrow ? item.label : undefined}
                tabIndex={current ? 0 : -1}
                onClick={() => onSelect(item.id)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg text-[12.5px] transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isNarrow ? "w-12 justify-center" : "w-full px-3",
                  current
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={item.icon}
                  size={15}
                  strokeWidth={current ? 2 : 1.75}
                  className="shrink-0"
                />
                {isNarrow ? null : (
                  <span className="truncate">{item.label}</span>
                )}
              </button>
            );
            return (
              <li key={item.id}>
                {isNarrow ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={6}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  button
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </TooltipProvider>
  );
}

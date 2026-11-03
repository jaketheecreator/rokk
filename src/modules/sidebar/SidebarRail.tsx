import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  changeCount,
  startChangesRecorder,
  subscribeChanges,
} from "@/modules/rokk-changes/lib/recorder";
import {
  FileEditIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useSyncExternalStore } from "react";
import { railBadge, railName } from "./railLabels";
import type { SidebarViewId } from "./types";

// 32px segments plus 4px container padding on each side.
const SIDEBAR_RAIL_HEIGHT = 40;

type RailItem = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
  /** Rokk Changes badge style (working tint) instead of the git badge. */
  rokk?: boolean;
};

type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
  /** Current project's repo, for the Changes count. */
  repoRoot?: string | null;
};

export function SidebarRail({
  activeView,
  onSelectView,
  changedCount,
  repoRoot = null,
}: Props) {
  useEffect(() => startChangesRecorder(), []);
  const sinceClaude = useSyncExternalStore(subscribeChanges, () =>
    changeCount(repoRoot),
  );
  const items: RailItem[] = [
    { id: "explorer", label: "Files", icon: FolderTreeIcon },
    {
      id: "changes",
      label: "Changes",
      icon: FileEditIcon,
      badge: sinceClaude,
      rokk: true,
    },
    {
      id: "source-control",
      label: "Git",
      icon: FolderGitTwoIcon,
      badge: changedCount,
    },
  ];

  // Container query on the switch itself, not the window: below 268px
  // (RAIL_LABELS_BREAKPOINT) only the active segment shows its label.
  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="@container mx-2.5 my-2 flex shrink-0 items-stretch gap-1 rounded-[var(--rk-radius-sm)] bg-[var(--rk-field)] p-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeView;
        const badge = railBadge(item.badge);
        const button = (
          <button
            key={item.id}
            type="button"
            aria-label={railName(item.label, item.badge)}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "group relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[8px] px-3 text-[13px] outline-none @min-[268px]:px-2.5",
              "transition-[width,background-color] duration-150 ease-[ease] motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive
                ? "bg-[var(--rk-active)] font-semibold text-[var(--rk-text)]"
                : "min-w-9 font-medium text-[var(--rk-text-2)] hover:bg-[var(--rk-active)]/60 hover:text-[var(--rk-text)]",
            )}
          >
            <span className="relative inline-flex shrink-0">
              <HugeiconsIcon
                icon={item.icon}
                size={16}
                strokeWidth={isActive ? 2 : 1.75}
                className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
              />
              {badge ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
                    item.rokk
                      ? "bg-[var(--rk-working-tint)] text-[var(--rk-working)]"
                      : "border border-[var(--rk-edge)] bg-card text-[var(--rk-text-2)]",
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </span>
            <span className={cn("truncate", !isActive && "hidden @min-[268px]:inline")}>{item.label}</span>
          </button>
        );
        if (isActive) return button;
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

import { cn } from "@/lib/utils";
import { badgeText } from "@/modules/rokk-changes/lib/changes";
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

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="m-2 flex shrink-0 items-stretch gap-1 rounded-[11px] bg-[var(--rk-field)] p-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeView;
        const showBadge = !!item.badge && item.badge > 0;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "group relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] outline-none transition-colors duration-150 ease-[ease]",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive
                ? "bg-[var(--rk-active)] font-semibold text-[var(--rk-text)]"
                : "font-medium text-[var(--rk-text-2)] hover:bg-[var(--rk-active)]/60 hover:text-[var(--rk-text)]",
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={14}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
            />
            <span>{item.label}</span>
            {showBadge && item.rokk ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--rk-working-tint)] px-1 text-[11.5px] font-semibold leading-none tabular-nums text-[var(--rk-working)]">
                {badgeText(item.badge ?? 0)}
              </span>
            ) : showBadge ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
                {item.badge! > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

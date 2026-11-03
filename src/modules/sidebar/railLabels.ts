import { badgeText } from "@/modules/rokk-changes/lib/changes";

/** Below this switch width only the active segment shows its label. Kept in
 * sync with the `@min-[268px]` container variants in SidebarRail.tsx. */
export const RAIL_LABELS_BREAKPOINT = 268;

/** The icon-corner badge text: null at zero, "99+" above 99. */
export function railBadge(count: number | undefined): string | null {
  return badgeText(count ?? 0);
}

/** The segment's accessible name, which carries the count too: "Git, 35 changes". */
export function railName(label: string, count: number | undefined): string {
  const n = count ?? 0;
  if (n <= 0) return label;
  return `${label}, ${n} ${n === 1 ? "change" : "changes"}`;
}

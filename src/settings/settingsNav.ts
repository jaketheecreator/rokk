/** Window widths below this get the icon-only rail. */
export const SETTINGS_NARROW_BELOW = 760;

export function isNarrowSettings(width: number): boolean {
  return width < SETTINGS_NARROW_BELOW;
}

/** Index the focus moves to for a nav key, or null when the key is not ours.
 * Arrows wrap; Home and End jump to the ends. */
export function nextNavIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

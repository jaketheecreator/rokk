// Pure parts of the stage "Show" switch (Terminal | Preview). The switch is
// derived from the real active tab; nothing here keeps its own flag.

export const PORT_KEY = "rokk.stage.port";
export const COMMON_PORTS = [3000, 5173, 8080, 4321, 8000] as const;
export const HINT_MS = 8000;

export type ShowTab = { id: number; kind: string; url?: string };
export type Show = "terminal" | "preview" | "other";

/** A port from user input: digits only (surrounding spaces allowed), 1 to 65535. */
export function parsePort(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** The last used port, or null when none is saved or storage fails. */
export function readPort(store: Store | null): number | null {
  try {
    const v = store?.getItem(PORT_KEY);
    return v ? parsePort(v) : null;
  } catch {
    return null;
  }
}

/** What the switch shows, from the active tab. */
export function showOf(tabs: readonly ShowTab[], activeId: number): Show {
  const kind = tabs.find((t) => t.id === activeId)?.kind;
  return kind === "terminal" ? "terminal" : kind === "preview" ? "preview" : "other";
}

/** Most recent first, without duplicates; `id` moves to the front. */
export function touch(mru: readonly number[], id: number): number[] {
  return [id, ...mru.filter((x) => x !== id)];
}

/** The most recently active tab of `kind`, else the last one of that kind. */
export function pick(tabs: readonly ShowTab[], mru: readonly number[], kind: "terminal" | "preview"): number | null {
  const ofKind = tabs.filter((t) => t.kind === kind);
  for (const id of mru) if (ofKind.some((t) => t.id === id)) return id;
  return ofKind[ofKind.length - 1]?.id ?? null;
}

/** The port of a localhost preview URL, for the hint. */
export function portOf(url: string | undefined): number | null {
  const m = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?/i.exec(url ?? "");
  if (!m) return null;
  return m[1] ? parsePort(m[1]) : null;
}

/**
 * Leaving stage mode: go back to the tab that was active on entry, but only
 * when the active tab is still the one the Show switch chose. If the user
 * chose another tab some other way (a shortcut, a tab menu), keep it.
 */
export function restoreOnExit(p: { entryId: number; activeId: number; lastSwitchId: number | null; exists: (id: number) => boolean }): number | null {
  if (p.lastSwitchId === null || p.activeId !== p.lastSwitchId) return null;
  if (p.activeId === p.entryId || !p.exists(p.entryId)) return null;
  return p.entryId;
}

export function hintText(port: number | null): string {
  const where = port ? `localhost:${port}` : "its port";
  return `If the preview is blank, check that your server is running on ${where}. Some servers block embedding in other apps.`;
}

/** Shows the hint for `HINT_MS`, restarting on each call. */
export function createHint(set: (on: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    show() {
      clear();
      set(true);
      timer = setTimeout(() => {
        timer = null;
        set(false);
      }, HINT_MS);
    },
    hide() {
      clear();
      set(false);
    },
    dispose: clear,
  };
}

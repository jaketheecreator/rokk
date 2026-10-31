import { type HouseRules, defaultRules, RULES } from "./rules";
import { DEFAULT_CHECKS, DEFAULT_REPORT_LINES, type DraftInput, MAX_GOAL } from "./draft";

export const KEY_RULES = "rokk.buddy.rules";
export const KEY_RECENT = "rokk.buddy.recent";
export const KEY_DRAFT = "rokk.buddy.draft";
export const MAX_RECENT = 10;
const MAX_EXTRA = 4000;

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; nothing is lost but persistence.
  }
}

/** Merges stored rules over the defaults, ignoring anything malformed. */
export function parseRules(value: unknown): HouseRules {
  const rules = defaultRules();
  if (!value || typeof value !== "object") return rules;
  const v = value as { enabled?: Record<string, unknown>; extra?: unknown };
  for (const r of RULES) {
    if (typeof v.enabled?.[r.id] === "boolean") rules.enabled[r.id] = v.enabled[r.id] as boolean;
  }
  if (typeof v.extra === "string") rules.extra = v.extra.slice(0, MAX_EXTRA);
  return rules;
}

export function pushRecent(list: readonly string[], text: string): string[] {
  const t = text.trim();
  if (!t) return [...list];
  return [t, ...list.filter((x) => x !== t)].slice(0, MAX_RECENT);
}

export function recentLabel(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 60)}...` : one;
}

export function parseRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT);
}

export function parseDraft(value: unknown): DraftInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DraftInput>;
  return {
    goal: typeof v.goal === "string" ? v.goal.slice(0, MAX_GOAL) : "",
    type: v.type === "fix" || v.type === "explore" || v.type === "review" ? v.type : "build",
    dontTouch: typeof v.dontTouch === "string" ? v.dontTouch : "",
    checks: Array.isArray(v.checks) ? v.checks.filter((c) => ["types", "lint", "tests", "build"].includes(c)) : DEFAULT_CHECKS,
    reportLines: typeof v.reportLines === "number" ? v.reportLines : DEFAULT_REPORT_LINES,
  };
}

export const loadRules = (): HouseRules => parseRules(read(KEY_RULES));
export const saveRules = (rules: HouseRules): void => write(KEY_RULES, rules);
export const loadRecent = (): string[] => parseRecent(read(KEY_RECENT));
export const saveRecent = (list: string[]): void => write(KEY_RECENT, list.slice(0, MAX_RECENT));
export const loadDraft = (): DraftInput | null => parseDraft(read(KEY_DRAFT));
export const saveDraft = (draft: DraftInput): void => write(KEY_DRAFT, draft);

export function clearSavedText(): void {
  for (const key of [KEY_RULES, KEY_RECENT, KEY_DRAFT]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export type Sensitivity = "low" | "medium";
export type Verdict = "specific" | "vague" | "skipped";

/** Mirrors `GuardStatus` in src-tauri/src/modules/rokk_guard/mod.rs. */
export type GuardStatus = {
  supported: boolean;
  /** "Clarify vague prompts" is on. */
  enabled: boolean;
  /** "Ship it checklist" is on. */
  shipItEnabled?: boolean;
  consented: boolean;
  installed: boolean;
  /** Our entry is from an older version (gated on TERAX_TERMINAL). */
  outdated?: boolean;
  filesOk: boolean;
  sensitivity: Sensitivity;
  version: number;
  command: string;
  settingsPath: string;
  backupPath: string;
  files: string[];
  error: string | null;
};

export type GuardScore = {
  verdict: Verdict;
  reasons: string[];
  signals: number;
  words: number;
};

export type WeekStats = {
  checked: number;
  fired: number;
  skipped: number;
  shipItRuns?: number;
  lastFire: number | null;
};

export type PageState = "loading" | "unsupported" | "error" | "off" | "on" | "notInstalled";

export type Feature = "vague" | "shipIt";

/** One hook serves both features; it should be installed while either is on. */
export function hookWanted(status: GuardStatus): boolean {
  return status.enabled || Boolean(status.shipItEnabled);
}

export function pageState(status: GuardStatus | null, feature: Feature = "vague"): PageState {
  if (!status) return "loading";
  if (!status.supported) return "unsupported";
  if (status.error) return "error";
  const on = feature === "vague" ? status.enabled : Boolean(status.shipItEnabled);
  if (!on) return "off";
  return status.installed && status.filesOk && !status.outdated ? "on" : "notInstalled";
}

/** Something on disk disagrees with the switches, so Repair is offered. */
export function needsRepair(status: GuardStatus | null): boolean {
  if (!status?.supported || status.error) return false;
  return hookWanted(status)
    ? !(status.installed && status.filesOk) || Boolean(status.outdated)
    : status.installed;
}

/** Why Repair is offered, in plain language. */
export function repairReason(status: GuardStatus | null): string | null {
  if (!needsRepair(status) || !status) return null;
  if (hookWanted(status) && status.installed && status.outdated)
    return "Rokk updated how the guard recognizes its own terminals.";
  if (!hookWanted(status)) return "The hook is still in Claude Code although both guards are off.";
  return "The hook or its files are missing.";
}

export type ToggleAction = "consent" | "enable" | "disable";

/** What flipping the switch does. The first turn-on asks for consent. */
export function toggleAction(status: GuardStatus, on: boolean): ToggleAction {
  if (!on) return "disable";
  return status.consented ? "enable" : "consent";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The weekly line, or null when there is nothing to show yet. */
export function statsLine(week: WeekStats | null): string | null {
  if (!week || week.checked <= 0) return null;
  return `This week: checked ${plural(week.checked, "prompt", "prompts")}, asked Claude to clarify on ${week.fired}.`;
}

/** The Ship it card's weekly line, or null before the first run. */
export function shipItStatsLine(week: WeekStats | null): string | null {
  const runs = week?.shipItRuns ?? 0;
  if (runs <= 0) return null;
  return `This week: ran ${plural(runs, "time", "times")}`;
}

export const SHIP_IT_CHECKS: readonly string[] = [
  "What would ship: the changed files, in plain language",
  "Whether the project's own checks pass",
  "Secrets: .env files and key-shaped text in the changed files",
  "Loose ends: debug logging, TODOs, skipped tests, very large files",
];

export const VERDICT_LABEL: Record<Verdict, string> = {
  vague: "Would ask Claude to clarify",
  specific: "Specific enough",
  skipped: "Skipped",
};

export const EXAMPLES: readonly { prompt: string; outcome: string }[] = [
  { prompt: "fix it", outcome: "Claude asks first" },
  {
    prompt: "In src/settings/GeneralSection.tsx, add a toggle for the greeting",
    outcome: "Goes straight through",
  },
];

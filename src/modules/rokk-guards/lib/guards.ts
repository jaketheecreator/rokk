export type Sensitivity = "low" | "medium";
export type Verdict = "specific" | "vague" | "skipped";

/** Mirrors `GuardStatus` in src-tauri/src/modules/rokk_guard/mod.rs. */
export type GuardStatus = {
  supported: boolean;
  enabled: boolean;
  consented: boolean;
  installed: boolean;
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
  lastFire: number | null;
};

export type PageState = "loading" | "unsupported" | "error" | "off" | "on" | "notInstalled";

export function pageState(status: GuardStatus | null): PageState {
  if (!status) return "loading";
  if (!status.supported) return "unsupported";
  if (status.error) return "error";
  if (!status.enabled) return "off";
  return status.installed && status.filesOk ? "on" : "notInstalled";
}

/** Something on disk disagrees with the switch, so Repair is offered. */
export function needsRepair(status: GuardStatus | null): boolean {
  if (!status?.supported || status.error) return false;
  return status.enabled ? !(status.installed && status.filesOk) : status.installed;
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

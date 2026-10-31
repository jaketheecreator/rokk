export type RuleId =
  | "light"
  | "devServer"
  | "packageManager"
  | "noGit"
  | "noAttribution"
  | "noEmDash"
  | "smallest"
  | "sayUnclear"
  | "inventory";

export type HouseRules = {
  enabled: Record<RuleId, boolean>;
  extra: string;
};

export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

type RuleDef = {
  id: RuleId;
  label: string;
  description: string;
  /** The line added under RULES; null when the rule shapes another section. */
  text: (pm: PackageManager | null) => string | null;
};

export const RULES: readonly RuleDef[] = [
  {
    id: "light",
    label: "Light task and load rule",
    description: "Marks the task as light and asks Claude to wait when the Mac is busy.",
    text: () =>
      "Check `uptime` once and use only the 1-minute load average; proceed at or below 6, otherwise wait two minutes and retry up to three times.",
  },
  {
    id: "devServer",
    label: "Leave the dev server alone",
    description: "No starting, stopping or restarting it, and no builds unless asked.",
    text: () =>
      "Do not start, stop or restart the dev server, and do not run builds unless asked.",
  },
  {
    id: "packageManager",
    label: "Use the project's package manager",
    description: "Named from the lockfile when there is one.",
    text: (pm) =>
      pm
        ? `Use only ${pm} as the package manager.`
        : "Use only the project's package manager.",
  },
  {
    id: "noGit",
    label: "No git commands",
    description: "Claude reads and edits files but never runs git.",
    text: () => "Do not run git commands.",
  },
  {
    id: "noAttribution",
    label: "No AI attribution",
    description: "No co-author lines or AI credits anywhere.",
    text: () => "No AI attribution.",
  },
  {
    id: "noEmDash",
    label: "No em dashes",
    description: "Keeps visible text free of em dashes.",
    text: () => "No em dashes in visible text.",
  },
  {
    id: "smallest",
    label: "Smallest change",
    description: "Touch only what the task needs.",
    text: () => "Make the smallest change and do not touch anything unrelated.",
  },
  {
    id: "sayUnclear",
    label: "Say when unsure",
    description: "Ask or explain instead of guessing.",
    text: () =>
      "If something is unclear or cannot be done, say so instead of guessing.",
  },
  {
    id: "inventory",
    label: "Inventory first",
    description: "Claude reports what it finds before it changes anything.",
    text: () => null,
  },
];

export function defaultRules(): HouseRules {
  const enabled = {} as Record<RuleId, boolean>;
  for (const r of RULES) enabled[r.id] = true;
  return { enabled, extra: "" };
}

/** Lines for the RULES section, in a fixed order, each exactly once. */
export function ruleLines(rules: HouseRules, pm: PackageManager | null): string[] {
  const out: string[] = [];
  for (const r of RULES) {
    if (!rules.enabled[r.id]) continue;
    const line = r.text(pm);
    if (line) out.push(line);
  }
  return out;
}

/** Non-empty, trimmed lines of a multi-line rule field, without duplicates. */
export function extraLines(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];
}

const LOCKFILES: readonly [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

export function detectPackageManager(files: readonly string[]): PackageManager | null {
  const set = new Set(files);
  for (const [file, pm] of LOCKFILES) if (set.has(file)) return pm;
  return null;
}

export const DOC_FILES = ["CLAUDE.md", "AGENTS.md", "DESIGN_SYSTEM.md", "CONTRIBUTING.md"];

export function presentDocs(files: readonly string[]): string[] {
  const set = new Set(files);
  return DOC_FILES.filter((f) => set.has(f));
}

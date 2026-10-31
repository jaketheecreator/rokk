import { extraLines, type HouseRules, type PackageManager, ruleLines } from "./rules";

export type TaskType = "build" | "fix" | "explore" | "review";
export type CheckId = "types" | "lint" | "tests" | "build";

export type DraftInput = {
  goal: string;
  type: TaskType;
  dontTouch: string;
  checks: CheckId[];
  reportLines: number;
};

export type DraftContext = {
  docs: string[];
  packageManager: PackageManager | null;
};

export const MAX_GOAL = 4000;
export const DEFAULT_REPORT_LINES = 12;
export const DEFAULT_CHECKS: CheckId[] = ["types", "lint", "tests"];

export const TASK_TITLE: Record<TaskType, string> = {
  build: "Build",
  fix: "Fix",
  explore: "Explore (read only)",
  review: "Review (read only)",
};

export const CHECK_LABEL: Record<CheckId, string> = {
  types: "type check",
  lint: "lint",
  tests: "tests",
  build: "build",
};

const CHECK_ORDER: CheckId[] = ["types", "lint", "tests", "build"];

export function isReadOnly(type: TaskType): boolean {
  return type === "explore" || type === "review";
}

export function clampGoal(goal: string): string {
  return goal.slice(0, MAX_GOAL);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Deterministic prompt text for Claude Code: same input, same output. */
export function buildDraft(
  input: DraftInput,
  rules: HouseRules,
  ctx: DraftContext,
): string {
  const light = rules.enabled.light;
  const sections: string[] = [];

  sections.push(`${TASK_TITLE[input.type]} task.${light ? " LIGHT task." : ""}`);
  sections.push(`GOAL\n${clampGoal(input.goal).trim()}`);

  const before: string[] = [];
  before.push(
    ctx.docs.length > 0
      ? `Read ${joinList(ctx.docs)} in the repo root and follow their conventions.`
      : "Read the project's contributor docs in the repo root, if any, and follow their conventions.",
  );
  if (rules.enabled.inventory) {
    before.push("Report what you find in about 8 lines, then continue.");
  }
  sections.push(`BEFORE YOU START\n${before.join("\n")}`);

  const ruleList = [...ruleLines(rules, ctx.packageManager), ...extraLines(rules.extra)];
  const dontTouch = input.dontTouch.trim();
  if (dontTouch) ruleList.push(`Do not touch: ${dontTouch}`);
  if (isReadOnly(input.type)) ruleList.push("Edit nothing and run nothing that changes files.");
  if (ruleList.length > 0) {
    sections.push(`RULES\n${[...new Set(ruleList)].map((l) => `- ${l}`).join("\n")}`);
  }

  const checks = CHECK_ORDER.filter((c) => input.checks.includes(c)).map(
    (c) => CHECK_LABEL[c],
  );
  if (checks.length > 0) {
    sections.push(
      `CHECKS\nRun ${joinList(checks)} once each, report only failures caused by your changes. Find the project's own scripts for them.`,
    );
  }

  const lines = Math.max(1, Math.round(input.reportLines) || DEFAULT_REPORT_LINES);
  sections.push(
    `REPORT\nReport in at most ${lines} lines: what you changed (files), what you ran and the results, and anything you are unsure about. Report only what you measured. Then wait.`,
  );

  return sections.join("\n\n");
}

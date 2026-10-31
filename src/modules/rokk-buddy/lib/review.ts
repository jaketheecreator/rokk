// Transparent pattern matching over a pasted Claude report. Every pattern is
// data in this file; nothing is sent anywhere.

export type Verdict = "complete" | "check" | "unfinished";
export type RunStatus = "passed" | "failed" | "not run" | "mentioned";

export type RunResult = { id: string; label: string; status: RunStatus };

export type Review = {
  verdict: Verdict;
  unsure: string[];
  runs: RunResult[];
  paths: string[];
  notOnScreen: boolean;
  mentionsSettings: boolean;
};

export const MAX_UNSURE = 8;

export const UNSURE_HEADINGS =
  /^\s*(?:#+\s*|[-*]\s*)?\**\s*(unsure|not sure|not confirmed|risks?|caveats?|unverified|gaps?)\b[^:\n]*:?\**\s*(.*)$/i;

export const HEDGES: readonly RegExp[] = [
  /\bI couldn'?t\b/i,
  /\bI could not\b/i,
  /\bI haven'?t\b/i,
  /\bnot sure\b/i,
  /\bunsure\b/i,
  /\bunrun\b/i,
  /\bunverified\b/i,
  /\bdidn'?t confirm\b/i,
  /\bprobably\b/i,
  /\bmight\b/i,
  /\bassumed\b/i,
  /\bskipped\b/i,
  /\bnot checked\b/i,
  /\bhasn'?t been checked on screen\b/i,
];

export const STOPPED: readonly RegExp[] = [
  /\bI stopped\b/i,
  /\bstopped (?:here|before|at)\b/i,
  /\bblocked\b/i,
  /\bwaiting for (?:your )?(?:approval|answer|input|go-ahead|decision)\b/i,
  /\bneed(?:s)? your (?:approval|answer|go-ahead|decision)\b/i,
  /\bdid not finish\b|\bdidn'?t finish\b|\bnot finished\b/i,
];

export const NOT_ON_SCREEN: readonly RegExp[] = [
  /\bnot (?:been )?(?:checked|seen|verified|looked at) on screen\b/i,
  /\bhaven'?t seen it\b/i,
  /\bhasn'?t been checked on screen\b/i,
  /\bcouldn'?t (?:watch|see) it\b/i,
  /\bnot visually\b/i,
];

export const RUNS: readonly { id: string; label: string; re: RegExp }[] = [
  { id: "types", label: "Type check", re: /\btype[- ]?check|\btsc\b|check-types/i },
  { id: "lint", label: "Lint", re: /\blint\b|\bbiome\b|\beslint\b|\bclippy\b/i },
  { id: "tests", label: "Tests", re: /\btests?\b|\bvitest\b|\bjest\b|\bnextest\b/i },
  { id: "build", label: "Build", re: /\bbuild\b/i },
  { id: "size", label: "Size", re: /\bsize-limit\b|\bpnpm size\b|\bsize budget|\bbudgets?\b/i },
];

const NOT_RUN = /\bnot run\b|\bunrun\b|\bhaven'?t run\b|\bdidn'?t run\b|\bdid not run\b|\bno cargo allowed\b|\bcouldn'?t run\b|\bcould not run\b|\bskipped\b/i;
const FAILED = /\bfail(?:ed|s|ing)?\b|\berrors?\b|\bbroke\b/i;
const PASSED = /\bpass(?:ed|es)?\b|\bclean\b|\bgreen\b|\bsucceed(?:ed|s)?\b|\ball \d[\d,]* (?:tests )?passed\b/i;

const PATH =
  /(?:^|[\s`'"(*])((?:\.?\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z]{1,5}|[\w-]+\.(?:tsx?|jsx?|mjs|rs|css|md|json|toml|ya?ml|html))(?=$|[\s`'"),:;*]|\.(?:\s|$))/gm;

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z*`])/))
    .map((s) => s.replace(/^[\s>*-]+|\*+/g, "").trim())
    .filter(Boolean);
}

function unsureItems(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(UNSURE_HEADINGS);
    if (!m) continue;
    if (m[2]?.trim()) out.push(m[2].replace(/\*+/g, "").trim());
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line || /^#+\s|^\*\*[^*]+\*\*:?\s*$/.test(line)) break;
      out.push(line.replace(/^[-*]\s*|\*+/g, "").trim());
    }
  }
  for (const s of sentences(text)) {
    if (HEDGES.some((h) => h.test(s))) out.push(s);
  }
  return [...new Set(out.filter(Boolean))].slice(0, MAX_UNSURE);
}

function runStatus(lines: string[]): RunStatus {
  if (lines.some((l) => NOT_RUN.test(l))) return "not run";
  if (lines.some((l) => FAILED.test(l) && !PASSED.test(l))) return "failed";
  if (lines.some((l) => PASSED.test(l))) return "passed";
  return "mentioned";
}

export function mentionedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH)) out.add(m[1].replace(/^\.\//, ""));
  return [...out];
}

export function analyzeReport(text: string): Review {
  const all = sentences(text);
  const runs: RunResult[] = [];
  for (const r of RUNS) {
    const hits = all.filter((s) => r.re.test(s));
    if (hits.length > 0) runs.push({ id: r.id, label: r.label, status: runStatus(hits) });
  }
  const unsure = unsureItems(text);
  const stopped = STOPPED.some((p) => p.test(text));
  const verdict: Verdict = stopped
    ? "unfinished"
    : unsure.length > 0 || runs.some((r) => r.status === "failed" || r.status === "not run")
      ? "check"
      : "complete";
  return {
    verdict,
    unsure,
    runs,
    paths: mentionedPaths(text),
    notOnScreen: NOT_ON_SCREEN.some((p) => p.test(text)),
    mentionsSettings: /\bsettings\b/i.test(text),
  };
}

function matches(mention: string, changed: string): boolean {
  return changed === mention || changed.endsWith(`/${mention}`);
}

/** Changed files the report never names, and names that did not change. */
export function compareFiles(
  mentioned: readonly string[],
  changed: readonly string[],
): { unmentioned: string[]; unchanged: string[] } {
  return {
    unmentioned: changed.filter((c) => !mentioned.some((m) => matches(m, c))),
    unchanged: mentioned.filter((m) => !changed.some((c) => matches(m, c))),
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  complete: "Looks complete",
  check: "Check a few things",
  unfinished: "Not finished",
};

/** Three to six plain actions for the user, derived from the flags. */
export function checkYourself(
  review: Review,
  files?: { unmentioned: string[]; unchanged: string[] },
): string[] {
  const out: string[] = [];
  if (review.verdict === "unfinished") out.push("Answer Claude's question or approve the step it is waiting for.");
  if (review.notOnScreen) {
    out.push(
      review.mentionsSettings
        ? "Open the settings window and look at the new layout."
        : "Open the app and look at the change yourself.",
    );
  }
  for (const r of review.runs) {
    if (r.status === "not run") out.push(`${r.label} was not run: run it yourself or ask Claude to.`);
    if (r.status === "failed") out.push(`Ask Claude to explain the ${r.label.toLowerCase()} failure.`);
  }
  if (review.unsure.length > 0) out.push("Read what Claude was unsure about and decide if it matters.");
  if (files?.unmentioned.length) out.push("Open the Changes view and look at the files Claude did not mention.");
  if (files?.unchanged.length) out.push("Check whether the files Claude named really changed.");
  const fillers = [
    "Try the change once the way a user would.",
    "Skim the diff in the Changes view.",
    "Make sure nothing unrelated changed.",
  ];
  for (const f of fillers) if (out.length < 3) out.push(f);
  return [...new Set(out)].slice(0, 6);
}

/** Goal text for a follow-up prompt asking Claude to verify each flag. */
export function followUpGoal(
  review: Review,
  files?: { unmentioned: string[]; unchanged: string[] },
): string {
  const items: string[] = [];
  for (const u of review.unsure) items.push(`You were unsure: "${u}". Check it and say what you found.`);
  for (const r of review.runs) {
    if (r.status === "not run") items.push(`${r.label} was not run. Run it if allowed, or explain why not.`);
    if (r.status === "failed") items.push(`${r.label} failed. Find the cause and fix it if it is yours.`);
  }
  if (review.notOnScreen) items.push("You did not check the result on screen. Describe exactly what I should look at.");
  for (const f of files?.unmentioned ?? []) items.push(`${f} changed but your report does not mention it. Explain the change.`);
  for (const f of files?.unchanged ?? []) items.push(`You mentioned ${f}, but it did not change. Confirm whether it should have.`);
  if (review.verdict === "unfinished") items.push("You stopped before finishing. Tell me exactly what you need from me.");
  if (items.length === 0) items.push("Confirm your last report: re-check each result you listed.");
  return `Verify these points from your last report:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

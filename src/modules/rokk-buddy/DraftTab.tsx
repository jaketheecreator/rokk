import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useId, useState } from "react";
import { type Actions, BUTTON, FIELD, HINT, PasteButton, Segmented } from "./parts";
import {
  buildDraft,
  CHECK_LABEL,
  type CheckId,
  clampGoal,
  DEFAULT_CHECKS,
  DEFAULT_REPORT_LINES,
  type DraftContext,
  type DraftInput,
  MAX_GOAL,
  type TaskType,
} from "./lib/draft";
import type { HouseRules } from "./lib/rules";
import { loadDraft, loadRecent, pushRecent, recentLabel, saveDraft, saveRecent } from "./lib/storage";

const TYPES: { id: TaskType; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "fix", label: "Fix" },
  { id: "explore", label: "Explore (read only)" },
  { id: "review", label: "Review (read only)" },
];
const CHECKS: CheckId[] = ["types", "lint", "tests", "build"];

export function DraftTab({ rules, ctx, actions }: { rules: HouseRules; ctx: DraftContext; actions: Actions }) {
  const id = useId();
  const [input, setInput] = useState<DraftInput>(
    () => loadDraft() ?? { goal: "", type: "build", dontTouch: "", checks: DEFAULT_CHECKS, reportLines: DEFAULT_REPORT_LINES },
  );
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const built = buildDraft(input, rules, ctx);
  const [output, setOutput] = useState(built);

  // The prompt follows the fields; edits made in the output stay until a field changes.
  useEffect(() => setOutput(built), [built]);
  useEffect(() => saveDraft(input), [input]);

  const set = (patch: Partial<DraftInput>) => setInput((v) => ({ ...v, ...patch }));
  const toggleCheck = (c: CheckId, on: boolean) =>
    set({ checks: on ? [...input.checks, c] : input.checks.filter((x) => x !== c) });
  const ready = input.goal.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-goal`} className={FIELD}>What should Claude do?</Label>
        <Textarea
          id={`${id}-goal`}
          required
          maxLength={MAX_GOAL}
          value={input.goal}
          onChange={(e) => set({ goal: clampGoal(e.target.value) })}
          className="min-h-24 text-[13px]"
        />
        <span className={HINT} aria-live="polite">{input.goal.length} of {MAX_GOAL} characters</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD}>Type of task</span>
        <Segmented label="Type of task" options={TYPES} value={input.type} onChange={(type) => set({ type })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-dont`} className={FIELD}>Don't touch (optional)</Label>
        <Input id={`${id}-dont`} value={input.dontTouch} onChange={(e) => set({ dontTouch: e.target.value })} className="h-11 text-[13px]" />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={FIELD}>Check its work</legend>
        <div className="flex flex-wrap gap-4">
          {CHECKS.map((c) => (
            <Label key={c} className="flex min-h-11 items-center gap-2 text-[13px] text-[var(--rk-text)]">
              <Checkbox checked={input.checks.includes(c)} onCheckedChange={(v) => toggleCheck(c, v === true)} />
              {CHECK_LABEL[c]}
            </Label>
          ))}
        </div>
        <span className={HINT}>Claude finds the project's own scripts for these.</span>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-lines`} className={FIELD}>Report length (lines)</Label>
        <Input
          id={`${id}-lines`}
          type="number"
          min={1}
          max={60}
          value={input.reportLines}
          onChange={(e) => set({ reportLines: Number(e.target.value) || DEFAULT_REPORT_LINES })}
          className="h-11 w-28 text-[13px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-out`} className={FIELD}>Prompt for Claude (you can edit it)</Label>
        <Textarea
          id={`${id}-out`}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          className="min-h-56 font-mono text-[12px] leading-relaxed"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={!ready} onClick={() => actions.copy(output)}>Copy</button>
        <PasteButton actions={actions} text={ready ? output : ""} />
        <button
          type="button"
          className={BUTTON}
          disabled={!ready}
          onClick={() => {
            const next = pushRecent(recent, output);
            setRecent(next);
            saveRecent(next);
            actions.announce("Saved to recent.");
          }}
        >
          Save to recent
        </button>
      </div>

      {recent.length > 0 ? (
        <section className="flex flex-col gap-1 border-t border-[var(--rk-edge)] pt-3">
          <div className="flex items-center justify-between">
            <h3 className={FIELD}>Recent</h3>
            <button
              type="button"
              className="rounded-[8px] px-2 py-1 text-[12px] text-[var(--rk-text-2)] hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)]"
              onClick={() => {
                setRecent([]);
                saveRecent([]);
              }}
            >
              Clear
            </button>
          </div>
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setOutput(r)}
              className="truncate rounded-[8px] px-2 py-1.5 text-left font-mono text-[12px] text-[var(--rk-text)] hover:bg-[var(--rk-field)]"
            >
              {recentLabel(r)}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { repoChanges } from "@/modules/rokk-changes/lib/recorder";
import { useId, useState } from "react";
import { type Actions, BUTTON, FIELD, HINT, PasteButton } from "./parts";
import { buildDraft, DEFAULT_CHECKS, type DraftContext } from "./lib/draft";
import {
  analyzeReport,
  checkYourself,
  compareFiles,
  followUpGoal,
  type Review,
  VERDICT_LABEL,
} from "./lib/review";
import type { HouseRules } from "./lib/rules";

const VERDICT_TONE = {
  complete: "bg-[var(--rk-done-tint)] text-[var(--rk-done)]",
  check: "bg-[var(--rk-attention-tint)] text-[var(--rk-attention)]",
  unfinished: "bg-[var(--rk-attention-tint)] text-[var(--rk-attention)]",
};

type Props = { rules: HouseRules; ctx: DraftContext; actions: Actions; repoRoot: string | null };

export function ReviewTab({ rules, ctx, actions, repoRoot }: Props) {
  const id = useId();
  // The pasted report lives only in memory; it is never stored.
  const [report, setReport] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const changes = repoChanges(repoRoot);
  const files =
    review && changes?.baseline
      ? compareFiles(review.paths, changes.changes.map((c) => c.path))
      : undefined;

  const analyze = () => {
    if (!report.trim()) return;
    const next = analyzeReport(report);
    setReview(next);
    actions.announce(`Review: ${VERDICT_LABEL[next.verdict]}.`);
  };

  const followUp = review
    ? buildDraft(
        { goal: followUpGoal(review, files), type: "fix", dontTouch: "", checks: DEFAULT_CHECKS, reportLines: 10 },
        rules,
        ctx,
      )
    : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-report`} className={FIELD}>Paste Claude's report</Label>
        <Textarea
          id={`${id}-report`}
          value={report}
          onChange={(e) => setReport(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              analyze();
            }
          }}
          className="min-h-40 font-mono text-[12px]"
        />
        <span className={HINT}>Analyze with the button or Mod+Enter. The report is not saved.</span>
      </div>
      <div>
        <button type="button" className={BUTTON} disabled={!report.trim()} onClick={analyze}>Analyze</button>
      </div>

      {review ? (
        <div className="flex flex-col gap-4 border-t border-[var(--rk-edge)] pt-4">
          <span className={cn("self-start rounded-full px-3 py-1 text-[12.5px] font-semibold", VERDICT_TONE[review.verdict])}>
            {VERDICT_LABEL[review.verdict]}
          </span>

          {review.unsure.length > 0 ? (
            <Block title="Claude was unsure about">
              {review.unsure.map((u) => (
                <li key={u} className="border-l-2 border-[var(--rk-edge)] pl-2 text-[12.5px]">"{u}"</li>
              ))}
            </Block>
          ) : null}

          {review.runs.length > 0 ? (
            <Block title="What was run">
              {review.runs.map((r) => (
                <li key={r.id} className="text-[12.5px]">
                  {r.label}: <span className="font-medium">{r.status}</span>
                </li>
              ))}
            </Block>
          ) : null}

          {files ? (
            <Block title="Files">
              <li className="text-[12.5px]">
                Changed but not mentioned: {files.unmentioned.length ? files.unmentioned.join(", ") : "none"}
              </li>
              <li className="text-[12.5px]">
                Mentioned but not changed: {files.unchanged.length ? files.unchanged.join(", ") : "none"}
              </li>
            </Block>
          ) : null}

          <Block title="Check yourself">
            {checkYourself(review, files).map((c) => (
              <li key={c} className="text-[12.5px]">{c}</li>
            ))}
          </Block>

          <div className="flex flex-col gap-1.5">
            <h3 className={FIELD}>Draft a follow-up</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--rk-radius-sm)] bg-[var(--rk-field)] p-3 font-mono text-[12px]">
              {followUp}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BUTTON} onClick={() => actions.copy(followUp)}>Copy</button>
              <PasteButton actions={actions} text={followUp} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={FIELD}>{title}</h3>
      <ul className="flex flex-col gap-1 text-[var(--rk-text)]">{children}</ul>
    </section>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  EXAMPLES,
  type GuardScore,
  type GuardStatus,
  needsRepair,
  pageState,
  repairReason,
  type Sensitivity,
  statsLine,
  toggleAction,
  VERDICT_LABEL,
  type WeekStats,
} from "@/modules/rokk-guards/lib/guards";
import * as ipc from "@/modules/rokk-guards/lib/ipc";
import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const CARD = "flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 px-3.5 py-3";
const HINT = "text-[11px] leading-relaxed text-[var(--rk-text-2)]";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function GuardsSection() {
  const [status, setStatus] = useState<GuardStatus | null>(null);
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("low");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const apply = useCallback((s: GuardStatus) => {
    setStatus(s);
    setSensitivity(s.sensitivity);
  }, []);

  const run = useCallback(
    async (work: () => Promise<GuardStatus>, done?: string) => {
      setBusy(true);
      setMessage(null);
      setFailure(null);
      try {
        apply(await work());
        if (done) setMessage(done);
      } catch (e) {
        setFailure(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    ipc.guardStatus().then(apply, (e) => setFailure(errorText(e)));
    ipc.guardStats().then(setStats, () => setStats(null));
  }, [apply]);

  const onToggle = (on: boolean) => {
    if (!status) return;
    const action = toggleAction(status, on);
    if (action === "consent") setConsentOpen(true);
    else if (action === "enable") void run(() => ipc.guardEnable(sensitivity), "Turned on.");
    else void run(ipc.guardDisable, "Turned off.");
  };

  const onSensitivity = (value: string) => {
    const next: Sensitivity = value === "medium" ? "medium" : "low";
    setSensitivity(next);
    void run(() => ipc.guardSetSensitivity(next));
  };

  const onRepair = () => {
    if (!status) return;
    void run(status.enabled ? () => ipc.guardEnable(sensitivity) : ipc.guardDisable, "Repaired.");
  };

  return (
    <>
      <GuardsView
        status={status}
        stats={stats}
        sensitivity={sensitivity}
        busy={busy}
        message={message}
        failure={failure}
        onToggle={onToggle}
        onSensitivity={onSensitivity}
        onRepair={onRepair}
        onRemoveAll={() => setRemoveOpen(true)}
      />
      {status ? (
        <AlertDialog open={consentOpen} onOpenChange={setConsentOpen}>
          <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Turn on "Clarify vague prompts"?</AlertDialogTitle>
              <AlertDialogDescription>This is exactly what will change on this Mac.</AlertDialogDescription>
            </AlertDialogHeader>
            <ConsentDetails status={status} />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => ipc.guardEnable(sensitivity), "Turned on.")}>
                Turn on
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove everything?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the hook entry from ~/.claude/settings.json and deletes the guard's files in ~/.rokk,
              including this week's counts. Your settings backup is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setStats(null);
                void run(ipc.guardRemoveAll, "Everything was removed.");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ConsentDetails({ status }: { status: GuardStatus }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-[12px] leading-relaxed">
      <li>
        One hook entry is added to <code className="font-mono">{status.settingsPath}</code>. Its command:
        <code className="mt-1 block rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px] break-all select-text">
          {status.command}
        </code>
      </li>
      <li>
        A one-time backup of that file is saved as <code className="font-mono">{status.backupPath}</code>.
      </li>
      <li>
        These files are written:{" "}
        {status.files.map((f, i) => (
          <span key={f}>
            {i > 0 ? ", " : null}
            <code className="font-mono">{f}</code>
          </span>
        ))}
        .
      </li>
      <li>Only runs in terminals opened in Rokk.</li>
      <li>You can turn it off or remove everything at any time.</li>
    </ul>
  );
}

type ViewProps = {
  status: GuardStatus | null;
  stats: WeekStats | null;
  sensitivity: Sensitivity;
  busy: boolean;
  message: string | null;
  /** The last command's failure, in plain language. */
  failure?: string | null;
  onToggle: (on: boolean) => void;
  onSensitivity: (value: string) => void;
  onRepair: () => void;
  onRemoveAll: () => void;
};

export function GuardsView(props: ViewProps) {
  const { status, stats, sensitivity, busy, message } = props;
  const state = pageState(status);
  const weekLine = statsLine(stats);
  const disabled = busy || state === "loading" || state === "unsupported" || state === "error";

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Guards"
        description="Automatic helpers that watch every prompt. They run on this Mac and cost no credits themselves."
      />

      <section className={CARD} aria-labelledby="guard-clarify-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="guard-clarify-title" className="text-[13px] font-medium">
              Clarify vague prompts
            </h2>
            <p className={HINT}>
              When a prompt is too vague, Rokk asks Claude to ask you a couple of short questions before it builds.
              A wrong guess costs credits; a question does not.
            </p>
          </div>
          <Switch
            aria-labelledby="guard-clarify-title"
            checked={status?.enabled ?? false}
            disabled={disabled}
            onCheckedChange={props.onToggle}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span id="guard-sensitivity" className="text-[12px] font-medium">
            Sensitivity
          </span>
          <Select value={sensitivity} onValueChange={props.onSensitivity} disabled={busy || state === "unsupported"}>
            <SelectTrigger aria-labelledby="guard-sensitivity" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low (recommended)</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className={HINT}>Works in terminals opened in Rokk. Start a new Claude session after turning it on.</p>

        {state === "unsupported" ? (
          <p className="text-[12px]">Guards work on macOS and Linux for now.</p>
        ) : (
          <div className="flex items-center justify-between gap-4 text-[12px]">
            <span>
              Installed in Claude Code: <strong className="font-medium">{status?.installed ? "Yes" : "No"}</strong>
              {repairReason(status) ? <span className={HINT}> {repairReason(status)}</span> : null}
            </span>
            {needsRepair(status) ? (
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" disabled={busy} onClick={props.onRepair}>
                Repair
              </Button>
            ) : null}
          </div>
        )}

        <ProblemAlert status={status} problem={props.failure ?? status?.error ?? null} />

        {weekLine ? <p className="text-[12px]">{weekLine}</p> : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-[var(--rk-text-2)]">Examples</span>
          <ul className="flex flex-col gap-1">
            {EXAMPLES.map((ex) => (
              <li key={ex.prompt} className="flex items-baseline justify-between gap-3 text-[12px]">
                <code className="min-w-0 font-mono text-[11.5px]">"{ex.prompt}"</code>
                <span className="shrink-0 text-[var(--rk-text-2)]">{ex.outcome}</span>
              </li>
            ))}
          </ul>
        </div>

        <TestPrompt sensitivity={sensitivity} />

        <p aria-live="polite" className="min-h-4 text-[11.5px] text-[var(--rk-text-2)]">
          {message}
        </p>

        <div className="flex justify-end border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-[11px] text-destructive hover:text-destructive"
            disabled={busy || state === "unsupported" || state === "loading"}
            onClick={props.onRemoveAll}
          >
            Remove everything
          </Button>
        </div>
      </section>
    </div>
  );
}

function TestPrompt({ sensitivity }: { sensitivity: Sensitivity }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<GuardScore | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const check = () => {
    setFailed(null);
    ipc.guardScore(text, sensitivity).then(setResult, (e) => {
      setResult(null);
      setFailed(errorText(e));
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="guard-test" className="text-[11px] font-medium text-[var(--rk-text-2)]">
        Test a prompt
      </label>
      <Textarea
        id="guard-test"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            check();
          }
        }}
        placeholder="Type a prompt to see what the guard would do"
        className="min-h-16 resize-y bg-card/60 text-[12px]"
      />
      <div className="flex items-center justify-between gap-3">
        <span className={HINT}>Check with the button or Mod+Enter. Nothing is saved or logged.</span>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={check}>
          Check
        </Button>
      </div>
      <div aria-live="polite" className="text-[12px]">
        {failed ? <p>{failed}</p> : null}
        {result ? (
          <>
            <p className="font-medium">{VERDICT_LABEL[result.verdict]}</p>
            <ul className="list-disc pl-5 text-[11.5px] text-[var(--rk-text-2)]">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Text for "Copy details": the message and the guard's state, never file
 * contents or prompt text. */
export function problemDetails(problem: string, status: GuardStatus | null): string {
  const flags = status
    ? `enabled ${status.enabled}, installed ${status.installed}, files ok ${status.filesOk}, consented ${status.consented}, version ${status.version}`
    : "status unknown";
  return `Rokk guard problem: ${problem}\nState: ${pageState(status)}; ${flags}`;
}

function ProblemAlert({ status, problem }: { status: GuardStatus | null; problem: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!problem) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 px-2.5 py-2">
      <p className="min-w-0 text-[12px] text-destructive">Problem: {problem}</p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2.5 text-[11px]"
        onClick={() => {
          void navigator.clipboard
            .writeText(problemDetails(problem, status))
            .then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy details"}
      </Button>
    </div>
  );
}

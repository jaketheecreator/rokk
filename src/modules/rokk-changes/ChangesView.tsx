import { cn } from "@/lib/utils";
import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Change, type ChangeStatus, splitPath } from "./lib/changes";
import {
  changesVersion,
  refreshChanges,
  repoChanges,
  subscribeChanges,
} from "./lib/recorder";

export type OpenDiffInput = {
  path: string;
  repoRoot: string;
  mode: "+" | "-";
  originalPath: string | null;
};

type Props = {
  repoRoot: string | null;
  onOpenDiff: (input: OpenDiffInput) => void;
  onOpenFile: (absolutePath: string) => void;
};

const STATUS_TONE: Record<ChangeStatus, string> = {
  M: "text-[var(--rk-attention)]",
  A: "text-[var(--rk-done)]",
  D: "text-[var(--rk-text-2)]",
  R: "text-[var(--rk-text-2)]",
};

const STATUS_WORD: Record<ChangeStatus, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "reverted",
};

export function ChangesView({ repoRoot, onOpenDiff, onOpenFile }: Props) {
  useSyncExternalStore(subscribeChanges, changesVersion, changesVersion);
  const result = repoChanges(repoRoot);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const lastCount = useRef<number | null>(null);

  const refresh = () => {
    if (!repoRoot) return;
    setBusy(true);
    void refreshChanges(repoRoot)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  // Opening the view refreshes it once; later refreshes come from agent
  // signals or the button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on repo change only
  useEffect(() => {
    lastCount.current = null;
    refresh();
  }, [repoRoot]);

  const count = result?.baseline ? result.changes.length : null;
  useEffect(() => {
    if (count === null) return;
    if (lastCount.current !== null && lastCount.current !== count) {
      setAnnounce(
        count === 1
          ? "1 file changed since Claude started"
          : `${count} files changed since Claude started`,
      );
    }
    lastCount.current = count;
  }, [count]);

  const open = (change: Change) => {
    if (!repoRoot) return;
    if (change.status === "R") {
      onOpenFile(`${repoRoot.replace(/[\\/]+$/, "")}/${change.path}`);
      return;
    }
    onOpenDiff({
      path: change.path,
      repoRoot,
      mode: change.unstaged || change.untracked ? "-" : "+",
      originalPath: change.originalPath,
    });
  };

  const since = result?.baseline
    ? new Date(result.baseline.takenAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-[14px] pt-[14px] pb-[10px]">
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[var(--rk-text)]">
          Since Claude started
          {since ? (
            <span className="ml-1.5 text-[12px] font-normal text-[var(--rk-text-2)]">
              {since}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={!repoRoot || busy}
          title="Refresh"
          aria-label="Refresh changes"
          className="flex size-6 shrink-0 items-center justify-center rounded-[8px] text-[var(--rk-text-2)] outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] hover:text-[var(--rk-text)] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {!repoRoot ? (
          <Empty text="This folder is not a git repository" />
        ) : !result?.baseline ? (
          <Empty text="No Claude session yet. Run claude in a terminal tab." />
        ) : result.changes.length === 0 ? (
          <Empty text="Nothing has changed since Claude started." />
        ) : (
          result.changes.map((change) => (
            <Row key={change.path} change={change} onOpen={open} />
          ))
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="px-2 py-3 text-[12.5px] leading-relaxed text-[var(--rk-text-2)]">
      {text}
    </p>
  );
}

function Row({
  change,
  onOpen,
}: {
  change: Change;
  onOpen: (change: Change) => void;
}) {
  const { name, folder } = splitPath(change.path);
  const gone = change.status === "D";
  return (
    <button
      type="button"
      onClick={() => onOpen(change)}
      title={`${change.path} (${STATUS_WORD[change.status]})`}
      className="flex h-[29px] w-full min-w-0 items-center gap-2 rounded-[8px] px-1.5 text-left outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-field)] focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        className={cn(
          "w-3 shrink-0 text-center font-mono text-[11.5px] font-semibold",
          STATUS_TONE[change.status],
        )}
      >
        {change.status}
        <span className="sr-only"> {STATUS_WORD[change.status]}</span>
      </span>
      <span
        className={cn(
          "shrink-0 truncate text-[13.5px]",
          change.status === "D" || change.status === "R"
            ? "text-[var(--rk-text-2)]"
            : "text-[var(--rk-text)]",
          gone && "line-through",
        )}
      >
        {name}
      </span>
      {folder ? (
        <span className="min-w-0 truncate text-[12px] text-[var(--rk-text-2)]">
          {folder}
        </span>
      ) : null}
      {change.added !== undefined ? (
        <span className="ml-auto shrink-0 font-mono text-[11.5px] text-[var(--rk-text-2)]">
          +{change.added} {"−"}
          {change.removed ?? 0}
        </span>
      ) : null}
    </button>
  );
}

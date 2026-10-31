import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { native } from "@/modules/ai/lib/native";
import { paneLog } from "@/modules/rokk-rail/lib/timeline";
import type { Tab } from "@/modules/tabs";
import { ptyIdForLeaf, useAgentActivityStore, writeToSession } from "@/modules/terminal";
import { focusLeafInput } from "@/modules/terminal/lib/terminalSessionApi";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BUDDY_TOGGLE_ID, setBuddyOpen, useBuddyOpen } from "./BuddyToggle";
import { DraftTab } from "./DraftTab";
import { type Actions, Segmented } from "./parts";
import type { DraftContext } from "./lib/draft";
import { canInsert, encodeInsert, type PaneState } from "./lib/insert";
import { detectPackageManager, type HouseRules, presentDocs } from "./lib/rules";
import { loadRules, saveRules } from "./lib/storage";
import { RulesTab } from "./RulesTab";

type Props = { tabs: Tab[]; activeId: number; repoRoot: string | null };
type View = "draft" | "review" | "rules";

// Review and its pattern tables load only when the tab is first opened.
const ReviewTab = lazy(() => import("./ReviewTab").then((m) => ({ default: m.ReviewTab })));

const VIEWS: { id: View; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "Review" },
  { id: "rules", label: "Rules" },
];

/** The active pane's state, telling "just started" apart from working. */
function useActivePane(tabs: Tab[], activeId: number) {
  const tab = tabs.find((t) => t.id === activeId);
  const leafId = tab?.kind === "terminal" ? tab.activeLeafId : null;
  const ptyId = leafId === null ? null : ptyIdForLeaf(leafId);
  const phase = useAgentActivityStore((s) => (ptyId === null ? undefined : s.phases[ptyId]));
  const agent = useAgentActivityStore((s) => (ptyId === null ? null : (s.agents[ptyId] ?? null)));
  const events = ptyId === null ? [] : (paneLog(ptyId)?.events ?? []);
  const last = events[events.length - 1]?.kind;
  const state: PaneState =
    phase === undefined ? null : phase === "working" && last === "started" ? "started" : phase;
  return { leafId, insert: canInsert({ isTerminal: leafId !== null, agent, state }) };
}

export function BuddyDialog({ tabs, activeId, repoRoot }: Props) {
  const open = useBuddyOpen();
  const [view, setView] = useState<View>("draft");
  const [rules, setRules] = useState<HouseRules>(loadRules);
  const [ctx, setCtx] = useState<DraftContext>({ docs: [], packageManager: null });
  const [message, setMessage] = useState("");
  const pasted = useRef<number | null>(null);
  const { leafId, insert } = useActivePane(tabs, activeId);

  useEffect(() => {
    if (!open || !repoRoot) return;
    let alive = true;
    native
      .readDir(repoRoot)
      .then((entries) => {
        if (!alive) return;
        const names = entries.filter((e) => e.kind === "file").map((e) => e.name);
        setCtx({ docs: presentDocs(names), packageManager: detectPackageManager(names) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, repoRoot]);

  const updateRules = (next: HouseRules) => {
    setRules(next);
    saveRules(next);
  };

  const actions: Actions = {
    insert,
    announce: setMessage,
    copy: (text) => {
      void writeTerminalClipboard(text)
        .then(() => setMessage("Copied to the clipboard."))
        .catch(() => setMessage("Could not copy to the clipboard."));
    },
    paste: (text) => {
      if (!insert.ok || leafId === null) return;
      if (!writeToSession(leafId, encodeInsert(text))) {
        setMessage("Could not write to the terminal. Use Copy instead.");
        return;
      }
      pasted.current = leafId;
      setBuddyOpen(false);
    },
  };

  return (
    <Dialog open={open} onOpenChange={setBuddyOpen}>
      <DialogContent
        showCloseButton
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const target = pasted.current;
          pasted.current = null;
          if (target !== null) focusLeafInput(target);
          else document.getElementById(BUDDY_TOGGLE_ID)?.focus();
        }}
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col gap-4 rounded-[var(--rk-radius)] bg-[var(--rk-panel)] p-6 text-[var(--rk-text)] ring-1 ring-[var(--rk-edge)] sm:max-w-[92vw]"
      >
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-[16px] font-semibold">Prompt buddy</DialogTitle>
          <DialogDescription className="text-[12.5px] text-[var(--rk-text-2)]">
            Helps you ask Claude clearly and check what it says. Everything stays on this Mac.
          </DialogDescription>
        </div>
        <Segmented label="Prompt buddy sections" options={VIEWS} value={view} onChange={setView} />
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {view === "draft" ? (
            <DraftTab rules={rules} ctx={ctx} actions={actions} />
          ) : view === "review" ? (
            <Suspense fallback={null}>
              <ReviewTab rules={rules} ctx={ctx} actions={actions} repoRoot={repoRoot} />
            </Suspense>
          ) : (
            <RulesTab rules={rules} onChange={updateRules} packageManager={ctx.packageManager} actions={actions} />
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {message}
        </p>
      </DialogContent>
    </Dialog>
  );
}

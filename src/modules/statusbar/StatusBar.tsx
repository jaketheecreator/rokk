import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { LspStatusPill } from "@/modules/lsp";
import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { GitBranchIcon, IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentStatePill } from "./AgentStatePill";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Opens the panel, or Settings > Models when no API key is loaded. */
  onOpenAi: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  privateActive: boolean;
  activeTab?: Tab;
  gitBranch?: string | null;
  changedCount?: number;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  onOpenAi,
  hasComposer,
  privateActive,
  activeTab,
  gitBranch,
  changedCount = 0,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);

  return (
    <footer className="flex h-12 shrink-0 items-center justify-between gap-3 px-[18px] text-[11px] text-[var(--rk-text-2)]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        <LspStatusPill filePath={filePath ?? null} />
        <DiagnosticsBadge filePath={filePath ?? null} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <AgentStatusPill onClick={onOpenMini} />
        <AgentStatePill activeTab={activeTab} />
        {gitBranch ? (
          <span className="flex h-7 shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--rk-text-2)]">
            <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.75} />
            <span>
              {gitBranch}
              {changedCount > 0 ? ` · ${changedCount} changed` : ""}
            </span>
          </span>
        ) : null}
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={onOpenAi} />
        )}
      </div>
    </footer>
  );
}

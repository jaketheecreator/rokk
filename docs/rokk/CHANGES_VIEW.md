# Changes view

The left panel's switch is **Files | Changes | Git**. "Changes" lists only the files that changed since Claude started in the current project, so you can answer "what did it change?" without reading git output.

## How the baseline works

- **Recorder** (`src/modules/rokk-changes/lib/recorder.ts`, part of the startup bundle, started by `SidebarRail`): listens to the shared agent signal through `subscribeAgentSignals`. When `started` arrives for `claude`, it goes from the pty to its pane (`leafIdForPty`), the pane's cwd (`leafCwd`) and the repo root (`git_resolve_repo`). It then takes a baseline with the existing `git_status` command.
- **Baseline:** the changed-file list at that moment, per file with its status (M, A, D) and the raw index and worktree codes. Only the newest baseline per repo is kept, at most 8 repos (the oldest is dropped) and 5,000 files per snapshot.
- **Changes since start** (`src/modules/rokk-changes/lib/changes.ts`, pure): a file is listed if it is new in the status, if its index or worktree codes changed, or if its line counts changed (only when both sides have counts). A file that was in the baseline but has left the status is listed as **R, reverted**. The list is sorted by status (M, A, D, R) then path.
- **Refresh:** when the agent reaches `finished` or `attention` (for a repo with a baseline), when the Changes view is opened, and on the Refresh button. Each refresh is one `git_status` call; nothing polls.
- **View** (`src/modules/rokk-changes/ChangesView.tsx`, lazy chunk): the header reads "Since Claude started" with the baseline's clock time. Rows are focusable buttons and always show the status letter. Clicking opens the existing diff tab (`openGitDiffTab`, worktree side for unstaged or untracked files, index side otherwise). A reverted file opens in the editor. A hidden live region announces when the count changes after a refresh.
- **Badge:** the Changes segment shows the count for the current project's repo (`sourceControl.repo.repoRoot`) in the working tint.

## What it cannot know

- **Who made the edit.** Files you edit yourself during a session appear too. Exact attribution needs tool events (see TODO).
- **Line counts.** `git_status` has none, so rows show no `+18 −2`. The code supports counts if a future data source provides them.
- **Further edits to an already dirty file.** If a file was already modified before Claude started, and its index and worktree codes stay the same, a further edit cannot be detected from status alone. Detecting it needs line counts or file stamps.
- **Missing cwd.** Without shell integration (no OSC 7 cwd) the pane's folder is unknown, so no baseline is taken.
- **Restarts.** Baselines live in memory only, so they are gone after a reload or restart. The panel also reopens on Files after a restart, because the stored view only accepts Files and Git.
- **Truncation.** A truncated git status (very large change sets) yields a partial baseline.

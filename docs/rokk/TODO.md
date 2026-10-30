# Rokk TODO: the "rename later" group

These were left as Terax on purpose in phase 1. Each needs a migration or a release decision. See docs/rokk/ARCHITECTURE_MAP.md, section 1.

## Release blocker

- [ ] **Updater URL and public key** (`src-tauri/tauri.conf.json`, `plugins.updater`). They still point at `github.com/crynta/terax-ai/releases` and the Terax minisign key. **These MUST change before any Rokk build ships**, or Rokk will offer and install Terax builds. Also update `src/modules/updater/UpdaterDialog.tsx` at the same time: it says "Terax vX is available" and prints `Terax_*.deb` and `Terax-*.rpm` install commands. Its wording was left unchanged because it describes what the current feed actually delivers. With productName now Rokk, newly built packages will be named `Rokk_*`, so those commands need to match the new feed.

## Needs a data migration

- [ ] **Bundle identifier** `app.crynta.terax`. It decides the app data, config, cache and log directories (Tauri 2 `path` APIs join on `identifier`). Changing it needs a one-time copy of settings, spaces, themes, AI sessions, window state and (on Linux) `secrets.json` from the old directory.
- [ ] **Keychain service** `terax-ai` (`src/modules/ai/config.ts`). Read each key under the old service, write it under the new one, then delete the old entry.
- [ ] **`~/.cache/terax`**: the control descriptor (`src-tauri/src/modules/control.rs`) and shell integration (`src-tauri/src/modules/pty/shell_init.rs`).
- [ ] **Store file names** `terax-*.json` (settings, spaces, custom themes, AI sessions, agents, snippets, todos).

## Needs a compatibility window

- [ ] **`TERAX_*` environment variables**. `TERAX_TERMINAL` gates agent hooks already installed in users' configs, so accept both names before switching.
- [ ] **Hook signal** OSC 777 `notify;Terax;...`. The detector would have to accept both markers first.

## Packaging and tooling

- [ ] **Cargo package and binary name** (`terax`, `terax_lib`, `default-run`). These feed the release workflow.
- [ ] **CLI names**: the `terax-cli` sidecar, the `terax` launcher on PATH inside panes, `TERAX_CLI`, and the `build.rs` sidecar path.

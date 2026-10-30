TERAX.md

## Rokk rules

Rokk is a rebrand of Terax. These rules add to TERAX.md and CONTRIBUTING.md.

Never rename these, even when renaming Terax to Rokk elsewhere:

- The bundle identifier `app.crynta.terax`. It decides the app data, config, cache and log directories, so changing it strands settings, sessions and Linux secrets.
- The keychain service `terax-ai`. Changing it hides every saved API key.
- The updater URL and public key. They change only as a planned release task (see docs/rokk/TODO.md).
- `~/.cache/terax` (control descriptor, shell integration) and the `terax-*.json` store files.
- `TERAX_*` environment variables, especially `TERAX_TERMINAL`, which gates the agent hooks already installed in users' `~/.claude/settings.json` and other agent configs.
- The hook signal name: the OSC 777 `notify;Terax;...` marker read by `pty/agent_detect.rs`. The Rokk handshake depends on this marker and on `TERAX_TERMINAL`; renaming either breaks agent detection for hooks that are already installed.
- CLI names (`terax-cli`, the `terax` launcher), the Cargo package and binary name (`terax`, `terax_lib`).
- Internal event names (for example `terax:agent-signal`), the `terax-pty` URL scheme, CSS classes, the `@terax/ghostty-core` package and the `terax-control-protocol` crate.

How Rokk work is added:

- Rokk features live in new `src/modules/rokk-*` folders and new Rust modules under `src-tauri/src/modules/`.
- Edits to existing files stay minimal. In `src/app/App.tsx` that means mount lines only.
- New UI loads lazily (dynamic import), because `.size-limit.json` and `src/app/eager-budget.test.ts` fail when startup code grows.
- No AI attribution in commits, pull requests, code or docs.

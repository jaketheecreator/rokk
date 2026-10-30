# Rokk changes to Terax

Rokk is based on Terax (Apache License 2.0). This file lists every file Rokk has added, modified or replaced, as Apache-2.0 section 4(b) requires. Phase 1 covers the safe rename group only. Base: Terax at `d0b569c`.

## Added

- `NOTICE`: attribution to Terax and the Cherry Bomb One (SIL OFL 1.1) credit for the wordmark.
- `docs/rokk/ARCHITECTURE_MAP.md`: read-only survey of the codebase for Rokk.
- `docs/rokk/CHANGES.md`: this file.
- `docs/rokk/TODO.md`: the "rename later" group, with the updater marked as a release blocker.
- `docs/rokk/UPSTREAM_README.md`: unchanged copy of the Terax README.
- `docs/rokk/brand/*`: Rokk brand sources supplied by the owner (icon, marks, wordmark, OFL text).
- `public/rokk-mark.svg`: Rokk mark, copied from `docs/rokk/brand/rokk-mark.svg`, used as the favicon.
- `src/components/brand/RokkMark.tsx`: inline SVG mark (static, or animated with `rk-` classes and reduced-motion support), ported from `rokk-mark-animated.svg`.
- `src/components/brand/RokkWordmark.tsx`: inline SVG wordmark using `currentColor`, ported from `rokk-wordmark.svg`.

## Replaced

- `README.md`: new short Rokk README (the original is in `docs/rokk/UPSTREAM_README.md`).
- `public/logo.png`: Rokk 256 px icon (same image as the new `src-tauri/icons/128x128@2x.png`).
- `src-tauri/icons/*` (52 files: desktop png, icns, ico, Square*/StoreLogo, `android/`, `ios/`): regenerated with `pnpm tauri icon docs/rokk/brand/rokk-icon-1024.png`. Same file names, none added or removed.

## Modified

- `CLAUDE.md`: appended a "Rokk rules" section; the existing text is unchanged.
- `index.html`: page title Rokk; favicon now `/rokk-mark.svg`.
- `settings.html`: page title "Rokk Settings"; favicon now `/rokk-mark.svg`.
- `src-tauri/tauri.conf.json`: `productName`, main window title, short and long description, file association name ("Rokk Document").
- `src-tauri/tauri.windows.conf.json`: window title.
- `src-tauri/Cargo.toml`: `description` only.
- `src-tauri/Info.plist`: camera and microphone permission prompts.
- `src/app/components/CloseDialogs.tsx`: "Quit Rokk?".
- `src/modules/agents/components/NotificationBell.tsx`: empty-state text.
- `src/modules/agents/lib/agentIcon.tsx`: built-in agent icon is now `RokkMark` (was `/logo.png`).
- `src/modules/agents/lib/format.ts`: display label for the built-in agent (the `terax` id key is unchanged).
- `src/modules/agents/lib/notify.ts`: test notification title.
- `src/modules/ai/components/AiChat.tsx`: empty-state title.
- `src/modules/ai/components/AiComposerInput.tsx`: placeholder.
- `src/modules/ai/components/AiMiniWindow.tsx`: empty-state logo is now `RokkMark` (static) plus its text.
- `src/modules/ai/components/LocalAgentNotificationsBridge.tsx`: notification titles (the `AGENT` id constant is unchanged).
- `src/modules/ai/components/SelectionAskAi.tsx`: button label.
- `src/modules/ai/config.ts`: the agent's name in both system prompts.
- `src/modules/control/useControlBridge.ts`: error message.
- `src/modules/lsp/components/LspStatusPill.tsx`: message text.
- `src/modules/tabs/lib/useWindowTitle.ts`: window title app name.
- `src/modules/terminal/block/BlockWatermark.tsx`: first-run logo is now `RokkMark` (static).
- `src/settings/components/LspInstallDialog.tsx`: message text.
- `src/settings/sections/AboutSection.tsx`: `RokkMark` logo, default name, tagline, "Based on" and "Terax website" labels.
- `src/settings/sections/AgentsSection.tsx`: placeholder.
- `src/settings/sections/GeneralSection.tsx`: notification and autostart descriptions, error message.
- `src/settings/sections/ModelsSection.tsx`: keychain description.

## Visible strings left as Terax on purpose

- `src/modules/updater/UpdaterDialog.tsx`: "Terax vX is available", "Restart Terax", and the `Terax_*.deb` / `Terax-*.rpm` commands. The updater still serves Terax releases, so this text is accurate until the feed changes (see `docs/rokk/TODO.md`).
- `src/settings/sections/AboutSection.tsx`: Bundle ID row (`app.crynta.terax`, the real value) and the Terax repo and website links (credit).
- `src/modules/ai/lib/agent.ts`: OpenRouter `HTTP-Referer: https://terax.ai` and `X-Title: Terax`. These are request headers sent to a third party, not text shown in the app.
- `src/modules/theme/themes/terax-default.ts`: theme name "Terax Default" (tied to the `terax-default` id).
- `terax-icon.png` (repo root): not referenced by any code; it is outside `public/`, so it was not touched.
- `docs/readme/README.*.md` (translations), `TERAX.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `SECURITY.md`: upstream docs, unchanged.
- WebGPU debug labels, `TeraxLspClient`, `TeraxGhostty*` type names and the "Terax Theme" editor language key: code identifiers, not product text.

## Not yet changed (the "rename later" group)

- Bundle identifier `app.crynta.terax` (data, config, cache and log directories).
- Keychain service `terax-ai`.
- Updater endpoint and public key (release blocker).
- `~/.cache/terax` (control descriptor, shell integration).
- Store files `terax-*.json` and `terax:*` localStorage keys.
- `TERAX_*` environment variables and the OSC 777 `notify;Terax;...` hook marker.
- CLI names (`terax-cli`, the `terax` launcher) and the Cargo package and binary name (`terax`, `terax_lib`).

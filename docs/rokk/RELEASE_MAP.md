# Release map: the first public Rokk build (read only, 2026-11-07)

What stands between today's tree and a first signed, notarized Rokk download on GitHub Releases. Verified items cite a file and line or an official page. Items marked **(guess)** are not verified.

Sources read:
- code and config: `src-tauri/tauri.conf.json`, `src-tauri/entitlements.plist`, `src-tauri/Info.plist`, `src-tauri/build.rs`, `src-tauri/Cargo.toml`, `src-tauri/installer-hooks.nsh`, `src/modules/updater/*`, `src/settings/sections/AboutSection.tsx`, `src/modules/ai/config.ts`, `src-tauri/src/modules/{control.rs,agent.rs}`, `.github/workflows/{release.yml,ci.yml}`, the screencapturekit 11.1.1 `build.rs`, NOTICE and `docs/rokk/*`;
- Tauri docs: v2.tauri.app/distribute/sign/macos, /plugin/updater and /reference/config.

Apple's notarization page did not render for me, so the Apple requirements below are from general knowledge and must be checked against developer.apple.com.

## 1. Updater

### Today (verified)

- **Config:** `src-tauri/tauri.conf.json` lines 117 to 124: `plugins.updater.pubkey` is Terax's minisign key, and `endpoints` is `https://github.com/crynta/terax-ai/releases/latest/download/latest.json`. `bundle.createUpdaterArtifacts` is `true` (line 52).
- **Rust:** `src-tauri/src/lib.rs` line 262 registers `tauri_plugin_updater::Builder::new().build()`, and `src-tauri/capabilities/desktop.json` line 15 grants `updater:default`.
- **UI:** `src/app/App.tsx` line 1667 mounts `<UpdaterDialog />`. It calls `useUpdater()` with `autoCheck` on by default (`src/modules/updater/UpdaterDialog.tsx` line 41, `useUpdater.ts` lines 5 and 69 to 72; throttled to every 30 minutes, key `terax:updater:last-check`).
  - On Linux it also asks `api.github.com/repos/crynta/terax-ai/releases/latest` (`useUpdater.ts` line 10).
  - Settings > About has a manual "Check for updates" (`AboutSection.tsx` line 28).
- **Version:** `tauri.conf.json` line 4 and `package.json` line 4 are both `0.9.0`, the same as Terax.

### Risk today

A Rokk build checks Terax's feed. It would accept any Terax release newer than its own version, because Terax signs it with the very key Rokk trusts, then download it and replace Rokk with Terax. Tauri says signature checks "cannot be disabled", so the pubkey is the only guard, and it is Terax's.

### Options for v0.1

| Option | Changes | Pros | Cons |
|---|---|---|---|
| **A. Updater off (recommended for v0.1)** | Remove `.plugin(tauri_plugin_updater...)` in `lib.rs:262` and `updater:default` in `capabilities/desktop.json:15`. Remove the `plugins.updater` block and set `createUpdaterArtifacts: false` (`tauri.conf.json`). Unmount `<UpdaterDialog />` (`App.tsx:1667`). Replace the About "Check for updates" with a "Releases" link to Rokk's GitHub releases page. Keep the Cargo/npm packages for now (removing them is a later size win). | Nothing can install a foreign build; no key to guard; smallest change | Users update by hand |
| B. Rokk's own feed | Generate a new key (`pnpm tauri signer generate -w ~/.tauri/rokk.key`, from the Tauri docs). Put its public key in `plugins.updater.pubkey` and point `endpoints` at `https://github.com/<owner>/rokk/releases/latest/download/latest.json`. Store `TAURI_SIGNING_PRIVATE_KEY` and its password as secrets. Keep `createUpdaterArtifacts: true`. Fix `UpdaterDialog.tsx` texts (it says "Terax", and prints `Terax_*.deb` commands) and the Linux API URL. | Auto updates from day one | One more secret that must never be lost ("if you lose this key you will NOT be able to publish new updates", Tauri docs); `latest.json` must list every platform it names |
| C. UI off, plugin on | Only unmount the dialog and the About button | Smallest diff | Still trusts Terax's key; a later remount would offer Terax. Not recommended |

**Recommendation:** A for v0.1, then B in a later release with a fresh key. Either way, change the version to `0.1.0` in `tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml` (line 3).

## 2. Identity

### Where it lives and what depends on it (verified unless marked)

| Item | Where | Depends on it | Rename now? |
|---|---|---|---|
| Bundle identifier `app.crynta.terax` | `tauri.conf.json:5`; shown in `AboutSection.tsx:94` | Tauri's app data, config, cache and log folders (`~/Library/Application Support/<id>`, `~/Library/Caches/<id>`, `~/Library/Logs/<id>`). Also the window-state file and the `terax-*.json` stores inside the data folder, the Linux `secrets.json`, the Screen Recording permission (TCC keys it on the identifier and the signature, **(guess)** in detail) and LaunchServices | **Yes, before v0.1.** No Rokk user exists; today Rokk and Terax installed together share all of the above |
| productName `Rokk` | `tauri.conf.json:3` | App name, DMG names `Rokk_<version>_<arch>.dmg` (Tauri naming, **(guess)** exact pattern) | Already Rokk |
| Cargo package and binary `terax`, lib `terax_lib`, `default-run = "terax"` | `src-tauri/Cargo.toml:2,8,27-30` | The executable inside the bundle (`Contents/MacOS/terax`); `release.yml:130,150` (AppImage `usr/bin/terax`); `nix/package.nix:60-62`; `scripts/app-lab/run.py:68,166`; NSIS hooks | Yes with the identifier (TODO.md "Executable rename") |
| `mainBinaryName` | not set in `tauri.conf.json` | Defaults to the Cargo binary name **(guess, Tauri default)** | Set to `rokk` when renaming |
| CLI sidecar `terax-cli`, launcher `terax`, `TERAX_CLI` | `tauri.conf.json:43-45` (`externalBin`), `build.rs` (`binaries/terax-cli-<target>`), `control.rs:741,760,931` | The `terax` command inside panes | Rename to `rokk-cli` / `rokk`, or keep for v0.1 |
| `~/.cache/terax` | `control.rs:572`, `pty/shell_init.rs` | Control descriptor (socket) and shell integration scripts; **shared with Terax** if both run | Rename to `~/.cache/rokk` |
| Store files `terax-settings.json`, `terax-spaces.json`, `terax-custom-themes.json`, `terax-ai-sessions.json`, `terax-ai-agents.json`, `terax-ai-snippets.json`, `terax-ai-todos.json` | frontend stores | Inside the identifier's data folder, so a new identifier already separates them from Terax | Optional; cosmetic once the identifier changes |
| Keychain service `terax-ai` | `src/modules/ai/config.ts:1` | Saved API keys (accounts `openai-api-key`, `anthropic-api-key`, `google-api-key`, ...). **Shared with Terax** whatever the identifier | Rename to `rokk-ai` (or `<identifier>.ai`) |
| `TERAX_TERMINAL`, `TERAX_*` | `pty/shell_init.rs`, `agent.rs:104,114`, `rokk_guard` | Gates the agent hooks in `~/.claude/settings.json` and other agent configs; `ROKK_TERMINAL` already exists beside it | **Keep for v0.1** (CLAUDE.md never-rename list; both apps can share the hooks) |
| Hook markers `notify;Terax;`, `terax;notify`, `__terax_notify` | `agent.rs:92,104,114,123` | Hook ownership and agent detection | **Keep for v0.1** |
| Windows "Open in Terax" registry verbs | `installer-hooks.nsh:1-19` (`$INSTDIR\terax.exe`) | Windows only | Rename with the executable if Windows ships |
| Updater feed and key, `terax:updater:last-check` | section 1 | | Section 1 |
| `REPO_URL`, `WEBSITE` | `AboutSection.tsx:12` and the "Terax website" row | About screen | Keep as the "Based on" credit; add Rokk's own repo |
| Copyright, publisher | `tauri.conf.json:53-55` ("Crynta") | Bundle metadata | Change to the owner (Apache-2.0 keeps Terax's credit in NOTICE and LICENSE) |

### Terax installed beside Rokk today

- **Same identifier:**
  - Both apps share settings, spaces, themes, AI sessions and window state.
  - LaunchServices may open the wrong one for "Open With".
  - The Screen Recording permission is confused between the two **(guess)**.
- **Same keychain service:** both apps share the saved API keys.
- **Same control folder:** the `terax` launcher in panes talks to whichever app wrote `~/.cache/terax` last.
- **Shared hooks:** the same hook entries are in `~/.claude/settings.json`, and both apps set `TERAX_TERMINAL`. Each app detects the other's hooks as its own. Removing hooks in one app removes them for both (same markers). This is acceptable if documented.

### Three identity sets

| Set | Identifier | Data folder | Keychain service | Cache | Binary / CLI | Pros | Cons |
|---|---|---|---|---|---|---|---|
| 1 | `dev.rokk.app` | `~/Library/Application Support/dev.rokk.app` | `rokk-ai` | `~/.cache/rokk` | `rokk` / `rokk-cli` | Short, brand-led | Reverse-DNS implies owning `rokk.dev` **(not checked)**; collision risk with another "Rokk" |
| 2 | `io.github.<user>.rokk` | `.../io.github.<user>.rokk` | `rokk-ai` | `~/.cache/rokk` | `rokk` / `rokk-cli` | Provably owned (the GitHub account); no domain needed | Long; tied to the GitHub user name forever |
| 3 (minimal) | `app.<user>.rokk` | new folder | keep `terax-ai` | keep `~/.cache/terax` | keep `terax` | Fewest edits | Still shares the keychain and the control folder with Terax; renames pile up later, when users exist |

**Owner decides:**
1. The identity set; I suggest set 2, or set 1 if the owner owns a matching domain.
2. Whether the binary and CLI rename in v0.1.
3. Lifting the CLAUDE.md never-rename entries for the identifier, the keychain service and `~/.cache/terax` (the hook markers and `TERAX_TERMINAL` stay).
4. Whether to copy the owner's own dev data from `app.crynta.terax` (nobody else has any).

**Order:** identifier, keychain, cache folder, binary and CLI, then the workflow and packaging references (`release.yml`, `nix`, `app-lab`, NSIS), all in one build, so no build exists with half the names.

## 3. Signing and notarization

### What Tauri 2 uses (verified from v2.tauri.app/distribute/sign/macos and /reference/config)

- **Certificate:** `APPLE_CERTIFICATE` (base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY` (or `bundle.macOS.signingIdentity`). The CI example also uses a `KEYCHAIN_PASSWORD` for a temporary keychain.
- **Notarization with an API key (recommended):** `APPLE_API_ISSUER`, `APPLE_API_KEY` (the key id) and `APPLE_API_KEY_PATH` (the `.p8` file). The alternative is `APPLE_ID`, `APPLE_PASSWORD` (app-specific) and `APPLE_TEAM_ID`.
- **Hardened runtime:** `bundle.macOS.hardenedRuntime` defaults to `true`. `entitlements` points to `./entitlements.plist` (`tauri.conf.json:63`). `providerShortName` is only for accounts in several teams.
- **Docs quotes:** "Notarization is required when using a Developer ID Application certificate." "When using a free Apple Developer account, you will not be able to notarize."

### Apple's requirements (general knowledge, check developer.apple.com)

Developer ID Application signing, hardened runtime, a secure timestamp, no `get-task-allow`, submission with `notarytool`, then stapling.

### Entitlements and Info.plist (verified)

- **Entitlements** (`src-tauri/entitlements.plist`): `com.apple.security.device.camera` and `com.apple.security.device.audio-input`, kept from Terax so programs run inside the terminal can ask for them.
- **Info.plist** (`src-tauri/Info.plist`): `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` and `NSScreenCaptureUsageDescription` ("Rokk records only its own window...").
- **Recorder:** ScreenCaptureKit needs no entitlement; it needs the user's Screen Recording permission (TCC).
- **WebView:** WKWebView's JIT runs in Apple's WebContent process, so no `allow-jit` entitlement **(guess, standard for Tauri apps)**.
- **Private API:** `macOSPrivateApi: true` (`tauri.conf.json:14`) is fine outside the App Store.
- **Shells:** programs started in the PTY are separate binaries with their own signatures **(guess: hardened runtime does not restrict them; test that `DYLD_*`-dependent tools behave)**.

### Route 1: local build on the owner's Mac (recommended for the first build)

- **Setup:** install the friend's `.p12` into the login keychain. Set `APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"`, `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH` in the shell (not in a file in the repo).
- **Build:** run `pnpm tauri build --target aarch64-apple-darwin`; Tauri signs, notarizes and staples.
- **Needs:** the SDK 15.2 or later that the recorder crate requires (`screencapturekit` feature `macos_15_2`, `Cargo.toml`; its `build.rs` refuses older SDKs). The owner's Command Line Tools have `MacOSX15.sdk` (verified folder name; the exact minor version is not checked). `xcrun notarytool` must exist **(guess: it ships with the Command Line Tools on current macOS)**.
- **Pros:** one machine, nothing uploaded. **Cons:** manual, so not reproducible.

### Route 2: GitHub Actions (the existing `release.yml`)

- **Already there:** a matrix of `macos-latest` for `aarch64-apple-darwin` and `x86_64-apple-darwin` (lines 19 to 24) through `tauri-apps/tauri-action@v1` (line 78). It passes `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_API_ISSUER` and `APPLE_API_KEY` (lines 86 to 91), writes the `.p8` from the secret `APPLE_API_KEY_PATH` to `~/private_keys/AuthKey.p8` (lines 67 to 75), and passes `TAURI_SIGNING_PRIVATE_KEY` and its password.
- **To add or check:**
  - **Xcode:** select an Xcode with SDK 15.2+ on the runner **(guess: current `macos-15` images have it; pin it with `xcode-select`)**.
  - **Locked check:** `ci.yml` uses `cargo ... --locked` (lines 108 to 188). `Cargo.lock` must be committed after a local build that added `objc2-av-foundation` and `objc2-core-media`.
  - **Sidecar:** the `terax-cli` sidecar is built per target (`TERAX_CLI_TARGET`, line 81).
  - **Matrix:** drop or fix the Linux and Windows jobs and the updater steps for v0.1.
  - **Owner:** change the repository owner and asset names.
- **Pros:** reproducible, with checksums in CI. **Cons:** the friend's certificate lives in the owner's repository secrets.

### What to ask the friend for

1. A **Developer ID Application** certificate, created in their account (Account Holder, or Admin where allowed), exported as a `.p12` with a strong password. Ideally a certificate made just for Rokk, so it can be revoked alone.
2. An **App Store Connect API key** with the Developer role: the Issuer ID, the Key ID and the `.p8` file (downloadable once).
3. Their **Team ID**.
4. Their consent to the app name showing as signed by their team, and to revocation if they leave.

### Storing them safely

- **On the Mac:** keep the `.p12` and `.p8` outside the repo (for example `~/private_keys`, `chmod 600`). Import the `.p12` into the keychain, then delete the loose file.
- **In CI:** add repository secrets `APPLE_CERTIFICATE` (base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` (the `.p8` contents) and `KEYCHAIN_PASSWORD`, plus `TAURI_SIGNING_PRIVATE_KEY` and its password only for option B.
- **Never** commit or log them. Send them over a channel the friend chooses, not chat in plain text.

## 4. Packaged-build risks

- **Swift runtime:**
  - **rpath:** `build.rs` adds `-Wl,-rpath,/usr/lib/swift`, the OS Swift runtime in the dyld shared cache since macOS 12. It is added first, so it wins.
  - **Deployment target:** the bridge's is `12.3` (screencapturekit `build.rs:70`), and ScreenCaptureKit is weak-linked (`build.rs:184`). So the app should launch on macOS 13 and 14 **(guess until tested on a clean Mac)**.
  - **Recording gate:** recording itself is gated by `SCRecordingOutput::is_available()` (`rokk_record/mac.rs:38`).
  - **Toolchain rpath:** `build.rs` also adds a toolchain rpath when the build Mac has one. It is harmless on users' Macs, where that path is missing **(guess)**.
- **Screen Recording permission:**
  - A signed build is listed as "Rokk" in System Settings, not as the terminal or app that started it (dev builds may show Terax or the launching app; RECORD.md DEV_NOTE).
  - The permission is tied to the identifier and the signature **(guess in detail)**, so changing either after release asks users again.
- **Gatekeeper:** a notarized, stapled DMG opens with the standard "downloaded from the internet" prompt. An unsigned or un-notarized build is blocked and needs right-click Open or System Settings.
- **minimumSystemVersion** `13.0` (`tauri.conf.json:62`). The recorder needs macOS 15, and the zoom export needs macOS 13 (both gated in code).
- **Architecture:**
  - The dev Mac is Apple silicon, and the only sidecar on disk is `binaries/terax-cli-aarch64-apple-darwin`.
  - An Intel build needs the `x86_64-apple-darwin` Rust target, an x86_64 sidecar and the Swift bridge built for x86_64 (the crate's `build.rs` picks the arch).
  - A universal build needs both plus `--target universal-apple-darwin` **(guess: not tried)**.
  - **Suggestion:** arm64 only for v0.1, and say so on the download page.
- **DMG versus app:** ship the DMG, Tauri's default macOS installer target. The `.app.tar.gz` is only an updater artifact (off with option A). Restrict `bundle.targets` to `["app", "dmg"]` on macOS to save build time.

## 5. Licenses in the app

- **Verified present:**
  - `LICENSE` (Apache-2.0).
  - `NOTICE`: Terax credit, Cherry Bomb One OFL, Geist OFL, screencapturekit MIT, objc2 MIT.
  - `docs/rokk/licenses/{screencapturekit,objc2}-LICENSE-MIT.txt`, `docs/rokk/brand/CherryBombOne-OFL.txt` and `public/fonts/geist/OFL.txt`.
  - Bundled into the app: only the four terminal licenses (`tauri.conf.json:46-51`).
- **About screen** (`AboutSection.tsx`): "License: Apache 2.0", "Based on crynta/terax-ai" and the Terax website. It hardcodes "Bundle ID app.crynta.terax" (line 94); read it from the config or update it with the identifier.
- **Gaps:**
  1. Apache-2.0 section 4 asks to ship LICENSE and NOTICE with the work: add both to `bundle.resources`, and an About link "Third-party notices" that opens a bundled notices file.
  2. Inter (`@fontsource-variable/inter`) and JetBrains Mono (`@fontsource/jetbrains-mono`) are bundled (`src/styles/fonts.css`), but they are not in NOTICE; both are OFL **(guess, check their packages)**.
  3. The Hugeicons free icon set (`@hugeicons/core-free-icons`) is not credited; its license must be checked **(not verified)**.
  4. There is no full list of Rust crate and npm package licenses. Generate one at release time (for example with `cargo about` and a JS license tool), and note that this means new dev tools for the owner to approve.
  5. Terax's own third-party notices, if upstream has any, should carry over **(not checked)**.

## 6. Distribution

- **Tags and releases:** tags `v0.1.0`, `v0.1.1`, and so on. A GitHub Release per tag with short notes (what is new, the macOS 13 minimum, recording needs macOS 15, Apple silicon only, the not-affiliated line).
- **Assets:** `Rokk_0.1.0_aarch64.dmg` (Tauri's naming, **(guess)**, check the built file) and `SHA256SUMS.txt` (from `shasum -a 256`).
- **Download page (or README section):** the DMG link, checksum, minimum macOS, chip, what the app asks for (Screen Recording only when you record), how to verify (`spctl -a -vv Rokk.app`), and the Terax credit.
- **Brand:** Rokk shows the Claude spark (Hugeicons `ClaudeIcon`, `RokkStateMark.tsx`; TODO.md line 34). Check Anthropic's brand guidelines before release, or switch to a neutral agent icon. Add "Rokk is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic." and "Based on Terax by Crynta" to the README and the About screen.

## 7. Prioritized checklist

1. **Owner decision:** the updater option (A recommended), the identity set, the binary and CLI rename, Apple silicon only, local or CI signing, and the Claude spark.
2. **Friend's account step:** a Developer ID Application `.p12`, an App Store Connect API key (`.p8`, Issuer ID, Key ID) and the Team ID.
3. **Claude Code task, prompt 1:** updater off (section 1, option A), version `0.1.0`, About screen fixes (bundle ID from config, Rokk repo link, the not-affiliated line, Releases link).
4. **Claude Code task, prompt 2:** the identity rename (identifier, keychain service, `~/.cache/rokk`, binary and CLI, `release.yml`, `nix`, `app-lab`, NSIS), with tests. The owner's own dev data copy is optional.
5. **Claude Code task, prompt 3:** licenses (LICENSE and NOTICE bundled, the fonts and icons added to NOTICE, a third-party notices file and an About link).
6. **Owner manual step:** a local build (`cargo test`, then `pnpm tauri build`), committing `Cargo.lock`, then a signed and notarized build with the friend's credentials (route 1).
7. **Owner manual step:** test on a clean Mac on macOS 13 or 14 (it launches, recording is hidden) and on macOS 15 (the Screen Recording prompt names Rokk, recording works). Check Gatekeeper's first launch.
8. **Claude Code task, prompt 4:** `release.yml` for macOS arm64 only, Xcode pinning, checksums, asset names and the README download section (route 2, optional for v0.1).
9. **Owner manual step:** tag `v0.1.0`, upload the DMG and `SHA256SUMS.txt`, and publish the release.
10. **Claude Code task, prompt 5 (if needed):** fixes found in testing; later, the updater with a new key (option B).

**Estimate:** 4 to 5 Claude Code build prompts, plus the owner's local build and test rounds.

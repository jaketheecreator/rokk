# Stage recording (Stage mode, Phase 2)

Records the Rokk window to an MP4 file while stage mode is on. macOS 15 or later only.

## Safety principles

1. **Fail closed:** nothing is captured unless the menu bar recording indicator exists. The indicator is created first; if that fails, recording does not start.
2. **Only the Rokk window:** no other windows, no notifications, no desktop, no audio, no microphone.
3. **A visible action and a countdown:** recording starts only from the Record button or `Mod+Alt+R` in stage mode, and always after a 3, 2, 1 countdown that can be cancelled.
4. **No silent failures:** every failure shows a plain message with an error code. A file that could not be finalized is deleted, never left half written.
5. **Nothing leaves the Mac:** no network, and nothing on screen is logged.

## How it works

- **Record** is in the bottom pill of the stage controls, right of the wallpaper picker:
  - macOS 15 or later: **Record**.
  - Older macOS: disabled, with the tooltip "Recording needs macOS 15 or later".
  - Permission missing: **Allow screen recording**.
  - Other platforms: hidden.
- **Permission:** a dialog explains it, then "Open System Settings" asks macOS and opens the Screen Recording pane. After that it says "Quit and reopen Rokk, then try again", because macOS may apply the permission only after a restart.
- **First recording:** a one-time checklist (remembered in `localStorage["rokk.record.ack"]`) reminds you that anything visible in the window will be in the video. With Preview selected in the Show switch it adds: "The preview is recorded as it appears, including anything your app shows on screen." When that preview shows a website (not a localhost address, judged by the same address parser), it also adds: "The preview shows a website. Anything visible on it, such as a signed-in account, will be in the video." Starting a recording never changes the active tab, and the preview stays interactive while recording.
- **Countdown:** 3, 2, 1 over a dimmed backdrop, with Cancel. The overlay is removed, one frame passes, and only then does capture start, so the countdown is never in the video.
- **While recording:**
  - All stage controls are hidden (`html[data-rokk-recording="on"]`); only the wallpaper, the frame and the mark remain.
  - The menu bar shows "● 00:12" with a "Stop recording" menu, which works even when Rokk is not focused.
  - `Mod+Alt+R` also stops. `Mod+Alt+S` stops and saves first, then leaves stage mode ("Recording stopped and saved.").
- **After stopping:** a toast "Saved to Movies/Rokk" with "Show in Finder" and "Copy path".
- **Ending:** see "Ending a recording" below.
- **Limits:**
  - Recording stops by itself at 10 minutes.
  - It stops when free disk space drops below 200 MB, and does not start with less than 500 MB.
  - It stops when the Rokk window closes, and finalizes the file when the app quits.
- **Reload:** the Rust recorder is the source of truth. After a reload, Rokk asks it for the state and shows stage mode again if a recording is still running; the menu bar item keeps working throughout.
- **Live region:** it announces "Recording started", "Recording stopped" and errors, never the seconds.

## Ending a recording

- **Menu bar item:** "Stop recording" saves the file. "Stop and discard" stops and deletes it.
- **One terminal event:** every way out (the menu bar, `Mod+Alt+R`, `Mod+Alt+S`, a cancel, the window closing, the 10 minute cap, low disk space, quitting, a capture failure) ends with exactly one `rokk-record-state` event with `state: "idle"`. That event comes after the menu bar item is gone and the file is finalized or deleted. It carries `finished` (the saved path, or null), `error` (code and message, or null), `outcome` (`saved`, `discarded` or `error`) and the file `size`.
- **Watchdog:** if saving the file does not finish within 10 seconds, the recorder gives up. It deletes the partial file and ends with the error `finalize_timeout` ("Saving the recording took too long, so it was stopped and not kept.").
- **Result card:** when a recording ends, the stage controls come back together with a glass card at the bottom center, announced through the live region. The card is never shown while recording, so it is never in a video, and the toast still appears too.
  - **Saved:** "Recording saved", the file name and size, then Show in Finder, Record again (straight to the countdown, no checklist), Delete recording (with a confirm) and Done.
  - **Discarded:** "Recording discarded", then Record again and Done.
  - **Error:** the plain message and its code, then Try again and Done.
- **Delete:** the `record_delete(path)` command re-checks the path with the same rules as the recorder: an app-generated `.mp4` regular file inside `~/Movies/Rokk`, no symlinks and no `..`. It refuses anything else with `not_deletable`.
- **Stuck-state safety net:** the page treats Rust as the source of truth.
  - While `data-rokk-recording` is on, it asks `record_status` every 2 seconds and when the window gains focus. It clears the attribute when nothing is recording, and a failed check also counts as not recording.
  - It checks once when the controls mount.
  - Leaving stage mode always clears the attribute. `Mod+Alt+S` stops a recording first, and still leaves stage mode if the stop call fails.
- **Main thread:** the menu bar item is removed on the main thread, where AppKit expects it.
- **Stop reasons:** every end of a capture goes through the one stop function with a reason, which the terminal event carries as `reason` and `record_status` reports as `lastReason` (with `lastErrorCode`):
  - `tray`: "Stop recording" in the menu bar.
  - `shortcut`: `Mod+Alt+R`, `Mod+Alt+S` or a button in Rokk.
  - `discard`: "Stop and discard", or a cancel.
  - `system`: the stream or the recording output ended by itself, stopped by macOS or by the user from a system control.
  - `cap`, `disk`, `window_closed`, `app_exit`, and `error` for a recording output failure while the stream runs.
- **Idempotent:** the stop function first steps `recording` to `stopping`. A second stop, or a callback that arrives after a stop, finds another state and does nothing.

## System stops

ScreenCaptureKit can end a capture without Rokk asking. The recorder registers every callback the crate offers:

- **Stream delegate:** `stream(_:didStopWithError:)`, `streamDidBecomeInactive` and `streamDidBecomeActive` (macOS 15.2, which is why the crate feature is `macos_15_2`), plus the video effect start and stop callbacks, which are only logged.
- **Recording output delegate:** `recordingOutputDidStartRecording`, `recordingOutput(_:didFailWithError:)` and `recordingOutputDidFinishRecording`.

The callbacks only set flags and log. The one-second tick reads the flags and calls the stop function with `system` (stream stopped, inactive, or output finished) or `error` (output failed). So a callback never blocks the ScreenCaptureKit queue it runs on. The crate has no query for "is the stream still running"; reading these flags every second is that check.

For a `system` stop the output's own callbacks decide:

- **Finished:** the partial file is renamed and reported saved with its size, even when removing the output fails because the stream is already gone.
- **Failed, or not a valid MP4:** the partial file is deleted and the result is reported as discarded.
- **Neither within 10 seconds:** the watchdog ends it with `finalize_timeout`.

Before keeping any file, the recorder checks it is non-empty and starts with an MP4 `ftyp` box. Only its first 12 bytes are read, and they are never logged.

### The red pill at the top left

During a real run on macOS 26.6.2, the only visible control while recording was a red pill where the window's traffic lights are. The owner stopped from it, and the stage stayed frozen. That was because Rokk registered no stream delegate and no "finished" callback, so a stop from outside never reached the recorder.

- **Unknown:** what that pill is exactly could not be established from Apple's documentation or the crate. It is most likely a system capture or sharing control for a window being captured.
- **Most likely callback:** ScreenCaptureKit reports a stop by the user as `stream(_:didStopWithError:)` with code `-3817` (`userStopped`), and a system stop as `-3821` (`systemStoppedStream`). The log line `callback stream_did_stop error=<code>` will show which one arrives.

## Auto-zoom mouse path (Phase A)

While recording, Rokk can save the mouse path next to the video, so a later phase can zoom the finished video where the mouse rests (see ZOOM_MAP.md). Nothing in the video changes and nothing is shown while recording.

- **Always on:** there is no setting. The first-recording checklist always says: "Rokk also saves your mouse path (positions and clicks only) next to the video, so it can be zoomed later. Nothing about your screen is saved."
- **How it is read:** a thread `rokk-cursor` in `rokk_record/cursor.rs` polls 30 times a second.
  - `CGEventGetLocation(CGEventCreate(NULL))` gives global points, top left origin of the main display. `CGEventSourceButtonState` gives the left and right buttons.
  - Neither is an event tap, so no Accessibility or Input Monitoring permission applies (confirm in the manual test).
- **Clock:** time 0 is the moment the recording output reports `recording_did_start`. If that has not arrived within a second, the moment capture started is used.
- **Coordinates:** video pixels. The Rokk window's outer position and size (points) and its scale factor give the mapping; the video is the window's pixel size at start.
  - Positions outside the window are not stored.
  - A click is stored when a button goes down, with its button (0 left, 1 right).
  - A move, resize, scale or display change of the window is stored as an event with its new rectangle, and sampling goes on.
  - At most 40,000 samples (about 22 minutes); then sampling stops.
- **App zoom:** the path does not depend on the app zoom. Positions come only from the global cursor and the Rokk window rectangle. The stage frame rectangle (`frame`) comes from the page in CSS pixels, which match points only at app zoom 100%. It is sent only then and is otherwise written as `"frame": null`, so a later phase zooms within the whole video.
- **The file:** `Rokk-YYYY-MM-DD-HHMMSS.zoom.json`, with the same stem as its MP4, in the hidden folder `~/Movies/Rokk/.zoom` (since 2026-11-05).
  - **Why hidden:** Finder hides folders whose name starts with a dot, so `~/Movies/Rokk` shows only videos: originals, `-zoom` copies, and a temporary `-partial.mp4` while a recording or export runs. Cmd+Shift+. in Finder shows hidden items.
  - **The folder:** `.zoom` is created on demand with default permissions. It must be a real directory: a symlink or a file named `.zoom` is refused, and nothing is written or read then.
  - **Validation:** a sidecar must be a regular file with a generated name for an original recording, directly inside `.zoom` once symlinks are resolved, with no `..`. The old place next to the MP4 is refused (`cursor::check_sidecar`).
  - **Writing:** temp then rename, never overwriting.
  - **Delete together:** `record_delete` of an original removes its sidecar from `.zoom` (and any leftover in the old place); a `-zoom` copy has none.
  - **Orphans:** at the start of each recording, sidecars whose MP4 is gone are deleted, in `.zoom` and in the old place.
  - **Migration (one time):** `cursor::ensure_migrated` runs lazily the first time `record_status`, `zoom_read`, `record_delete`, a recording start or an export touches sidecars.
    - **What it moves:** each regular file named exactly `Rokk-YYYY-MM-DD-HHMMSS.zoom.json` (with counters) moves from `~/Movies/Rokk` into `.zoom`, with a hard link and then removal of the old name, so it never overwrites. On volumes without hard links it renames after checking the target is free.
    - **Conflicts and orphans:** a copy already in `.zoom` wins and the old duplicate is deleted. Old sidecars whose MP4 is gone are deleted.
    - **Safety:** symlinks are never followed and other files are never touched. One failed file does not fail the command.
    - **Done marker:** it writes `.zoom/.migrated-v1` when done and logs `[rokk_record] sidecar migration moved=<n> removed_orphans=<n> skipped=<n>`.
  - It is written only when a recording ends as saved, after the MP4: a fresh temp name, then a rename that never overwrites, inside `~/Movies/Rokk` only, no symlinks.
  - Discard, Restart and errors write nothing and drop the data in memory.
  - `record_delete` deletes the sidecar with its MP4.
  - Each new recording removes sidecars whose MP4 is gone, so a sidecar never stays without its video.
- **Format, version 1:**

```json
{"version":1,"note":"Mouse path only. Contains no screen content.",
 "video":{"width":2554,"height":1616,"scale":2},"frame":{"x":278,"y":160,"w":2000,"h":1240},
 "hz":30,"samples":[[0,1200,900]],"clicks":[[5120,1310,880,0]],
 "events":[{"t_ms":8000,"kind":"move","rect":{"x":100,"y":80,"w":2554,"h":1616}}],
 "end":{"t_ms":10000,"reason":"tray"}}
```

- **Terminal event:** `sidecar` (the saved path or null) and `skippedReason` (`write_failed` or null).
- **Reading it back (Phase B):** `zoom_read(path)` in `rokk_record/zoom.rs` reads a sidecar for the "Preview zoom" player. It writes nothing.
  - The name must be a generated `Rokk-YYYY-MM-DD-HHMMSS.zoom.json` (optionally with `-N`), directly in `~/Movies/Rokk/.zoom` once symlinks and `..` are resolved, not a symlink, with its MP4 present one folder up (`cursor::check_sidecar`, then `logic::check_delete` on the MP4, the same rules as `record_delete`).
  - At most 2 MB, version 1 only, no unknown fields, and only the fixed words; otherwise a short plain error.
  - The result card shows "Preview zoom" only when the terminal event carries a `sidecar` path for the saved MP4.
- **Saving with zoom (Phase C):** `zoom_export_start`, `zoom_export_cancel` and `zoom_export_supported` in `rokk_record/zoom_export.rs` write a NEW `Rokk-...-zoom.mp4` next to the original (see ZOOM_MAP.md section 10). The original and its sidecar are only read.
  - The export refuses while a recording is starting, running or stopping (`is_recording`).
  - `record_delete` now accepts only original recordings (`Rokk-YYYY-MM-DD-HHMMSS.mp4`, with up to two counters) and zoomed copies (`<stem>-zoom.mp4`, `<stem>-zoom-N.mp4`). Deleting an original deletes its sidecar, not its zoomed copy.
- **Privacy:** the file holds only numbers and three kinds of fixed words: the note, the end reason and event kinds (a Rust test checks this). It holds no screen content, keys, text or file names. The log gets one line per recording: `[rokk_record] cursor samples=<n> clicks=<n> events=<n> skipped=<reason or none>`.

## Recording controller

While recording, every stage control inside the Rokk window is hidden, because the capture records that window. The recording controller is a separate small window with the red dot, the timer and three buttons:

- **Stop** (`record_stop`): stops and saves.
- **Discard** (`record_stop_discard`): stops and deletes the take.
- **Restart** (`record_restart`): discards the take (reason `restart`, no result card), then Rust sends `rokk-record-restart` to the Rokk window. That window runs its normal "Record again" flow, the countdown and then `record_start`. The controller is hidden during the countdown.

How it works:

- **Created lazily:** the window `rokk-recorder` (`recorder.html`, a plain TypeScript page, no React) is created hidden at the first recording, so it costs nothing for anyone who never records. It is 380 by 56 points: no decorations, transparent, always on top, not in the Dock or the window list, not resizable, no system shadow (the page draws its own pill).
- **Focus:** it is shown with `orderFrontRegardless` and built with `focused(false)`, so it does not take keyboard focus from the Rokk window. Clicking a button works on the first click (`accept_first_mouse`) and makes the controller the key window until you click back into Rokk.
- **Position:** centered on the Rokk window, 28 points above its bottom edge. The position comes from the window's outer position, size and scale factor, and is kept inside the display the window is on. It follows the window's move, resize and scale changes, at most once per 50 ms with a trailing update.
- **Shown only while recording:** hidden for every other state, and also while the Rokk window is minimized or on another Space (checked every second). The tray item, the red system control and the shortcuts all stay. The controller only adds a way to stop.
- **State:** Rust is the source of truth. The page only listens to `rokk-record-state` and sends one of its three commands.

**Why it stays out of the video.** The capture uses a filter for a single window (`SCContentFilter(desktopIndependentWindow:)`, see `mac.rs` and the crate's `content_filter.rs`), which records only that window's own content, not other windows floating above it. This is based on the screencapturekit crate source, not on Apple's documentation, and the manual test below is the proof.

As an extra layer only, the controller is built with `content_protected(true)`, and its `sharingType` is set to none on the main thread and read back. The result is logged as `[rokk_record] controller sharing_type=<value or error>`. A failure is only logged; it never refuses a recording. Developer reports say ScreenCaptureKit on macOS 15 and later ignores the sharing type, so it is not relied on. Rokk makes no promise about `Cmd+Shift+5` screenshots; record what you observe in the checklist.

**Permissions.** The capability `src-tauri/capabilities/recorder.json` gives the `rokk-recorder` window only `core:event:allow-listen` and `core:event:allow-unlisten`. Rokk's own commands are app commands without an allowlist, so today any window with a capability can call any Rokk command. The controller is a local page shipped with the app, and it calls only `record_stop`, `record_stop_discard` and `record_restart` (a Rust test checks this).

**Limits:**

- It is always on top, so it also floats over other apps' windows while recording.
- There is no hotkey while the controller has focus.
- It is only checked against the active Space once a second.

## Diagnostics

The recorder writes these lines through the app's log plugin, and nothing else: no screen content, file contents or paths.

- `[rokk_record] state <from>-><to>`, with ` reason=<reason>` on stops.
- `[rokk_record] callback <name>`, and `callback stream_did_stop error=<code or none>`.
- `[rokk_record] finalize result=saved size=<bytes>`, `result=discarded` or `result=failed code=<code>`.
- `[rokk_record] watchdog fired`.
- `[rokk_record] controller created ok=<bool>` and `[rokk_record] controller sharing_type=<value or error>`.
- `[rokk_record] tray created ok=<bool> visible=unknown`. AppKit does not say whether a menu bar item is on screen. A notch, or the macOS 26 menu bar settings, can hide it.

## Manual test checklist

Run each in stage mode, with `pnpm tauri dev` and the log open:

- [ ] Record 10 seconds and stop from the menu bar item. A saved card appears, the file is in `~/Movies/Rokk`, and no `-partial.mp4` is left.
- [ ] Record and stop with `Mod+Alt+R`, then again with `Mod+Alt+S`; the second also leaves stage mode.
- [ ] Record and stop from the red system control at the top left. The log shows `callback stream_did_stop` and `reason=system`, the controls come back, and the card says saved or discarded.
- [ ] Close the window while recording. The log shows `reason=window_closed`, and the menu bar item goes away.
- [ ] Recording at the disk threshold (under 200 MB free). This cannot be simulated safely on a normal disk, so it is untested; `reason=disk` is covered by unit tests only.


### Recording controller

- [ ] Record 10 seconds and stop with the controller's Stop. Play the file and confirm the controller is NOT in the video. Write down whether the red system pill is in the video (if it is, say so here).
- [ ] Discard removes the file: nothing new in `~/Movies/Rokk`, no `-partial.mp4` left.
- [ ] Restart goes back to the countdown with no result card, and records a new file.
- [ ] The controller follows the Rokk window when you drag it and when you resize it.
- [ ] It hides when Rokk is minimized, and when you switch to another Space.
- [ ] Observed result, not a promise: is the controller in a `Cmd+Shift+5` screenshot? Record the answer here.
- [ ] Two displays: move the Rokk window to the second display while recording. The controller follows and stays inside that display.
- [ ] The log shows `controller sharing_type=0`, or the error.
- [ ] If the controller appears in the recorded video, remove the controller and keep the tray item and shortcuts only (option 3).


### Auto-zoom mouse path

- [ ] The "Preview zoom" player has its own checklist in ZOOM_MAP.md.
- [ ] Record 10 seconds with Auto-zoom on, clicking the four corners of the stage frame and a button in the page. Open the `.zoom.json` and check that the clicks sit at those places in video pixels. A plain script is fine: `python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['video'],d['frame']);print(d['samples'][:1],d['samples'][-1:]);print(d['clicks'])" FILE`
- [ ] Stop from the menu bar item, then from the controller; a sidecar exists each time.
- [ ] Discard: no sidecar.
- [ ] Delete a recording from the result card: both files are gone.
- [ ] Set the app zoom to 110 percent and record: a sidecar is saved with `"frame": null`, and the positions still match the video.
- [ ] macOS showed no new permission prompt.

## Files

`~/Movies/Rokk/Rokk-YYYY-MM-DD-HHMMSS.mp4`, in local time; the folder is created if missing.

- **Never overwritten:** a taken name gets `-2`, `-3`, and so on.
- **Partial file:** the recording is written to `...-partial.mp4` in the same folder and renamed only after it is finalized.
- **Generated names only:** names never come from user input. Paths are checked to stay inside `~/Movies/Rokk`, with no symlinks and no `..`.
- **Format:** H.264 in MP4 at 30 fps, at the window's pixel size, with the cursor shown.

## Shortcut

`Mod+Alt+R` (Cmd+Option+R, `record.toggle`) starts or stops a recording, only in stage mode. It works with a terminal focused.

## Permission: development versus a packaged app

- **Packaged app:** macOS asks for Rokk.app.
- **Development:** macOS charges the permission to the app that started `pnpm tauri dev`, so it may list that app (for example Terax) instead of Rokk. The dialog says so in development builds. After allowing it, you may need to quit and reopen that app as well.
- **The real test** of the permission flow is a packaged, signed build.

## Not captured

Other apps and windows, notifications, the desktop, system audio and the microphone.

## Known limits

- The macOS traffic lights are part of the window and appear in the video until Phase 3 hides them.
- macOS 15 or later only, and macOS only.
- If the window is resized during recording, the stream keeps its starting size (not verified how macOS scales the content); nothing crashes.
- No audio.
- The countdown digits use Geist, because the Cherry Bomb One font is not bundled as a font file (the wordmark is an SVG path).

## Building

The `screencapturekit` crate compiles a small Swift library during `cargo build`, so macOS builds need Apple's Swift toolchain (Command Line Tools or Xcode). Linux and Windows builds do not use it.

- **Missing libraries:** the crate and its `apple-cf` and `apple-metal` dependencies link Swift's static compatibility libraries (`libswiftCompatibility56.a`, `libswiftCompatibilityConcurrency.a`, `libswiftCompatibilityPacks.a`). They only search the full Xcode layout, `<developer dir>/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx`.
- **With only the Command Line Tools selected** (`xcode-select -p` is `/Library/Developer/CommandLineTools`), the libraries are in `/Library/Developer/CommandLineTools/usr/lib/swift/macosx`, and the link failed with "Could not find or use auto-linked library 'swiftCompatibility56'".
- **The fix:** `src-tauri/build.rs` (`link_swift_compatibility`, macOS targets only) asks `xcrun --find swiftc` for the active toolchain and adds `<toolchain>/usr/lib/swift/macosx` as a link search path when the library is there. Nothing is hardcoded to one machine.
- **Runtime path (rpath):** the binary loads the Swift runtime (`@rpath/libswift_Concurrency.dylib` and others) from the OS. The crates' own `-rpath /usr/lib/swift` link arguments do not reach Rokk's binaries, because link arguments are not passed on to dependents. So `build.rs` adds `-Wl,-rpath,/usr/lib/swift` itself; without it the app and the test binary stopped at launch with "Library not loaded: @rpath/libswift_Concurrency.dylib". It also adds the toolchain's `usr/lib/swift/macosx` as a second rpath, but only when a `libswift_Concurrency.dylib` is there.
- **Scope:** plain `cargo:rustc-link-arg` applies to every linked target of the package (binaries, tests including the lib unit tests, benches, examples, cdylib), so no `-bins` or `-tests` variant is needed.
- **Packaged app:** the Swift runtime is part of macOS (in the dyld shared cache under `/usr/lib/swift`), so the app bundles no Swift libraries. That the runtime, including Swift Concurrency, ships with macOS 12 and later is Apple's documented ABI-stability model, but it was not checked against a fetched Apple page here, and launch is so far verified only on macOS 26.6.
- **macOS 13 and 14:** the app should launch there. ScreenCaptureKit exists since macOS 12.3, the macOS 15 recording classes are reached only after `SCRecordingOutput::is_available()`, and the Record button is disabled. This is not yet tested on those versions (see TODO).
- **Weak linking:** the crate's `-weak_framework ScreenCaptureKit` argument does not reach Rokk either, so the framework is linked normally. That is fine for macOS 13 and later, Rokk's minimum.
- **Alternative:** selecting the full Xcode (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`) also works without the fix.
- **Harmless warnings:**
  - "Could not find or use auto-linked framework 'CoreAudioTypes'".
  - "built for newer macOS (26.5) than being linked (11.0)". The deployment target is left alone: raising it to 15.0 would stop the app from launching on macOS 13 and 14, which it supports without recording (`minimumSystemVersion` 13.0).

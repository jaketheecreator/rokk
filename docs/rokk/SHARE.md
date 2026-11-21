# Share panel (share-assist)

Rokk prepares a recording for posting; the person finishes the post in the browser. Rokk never posts, uploads or signs in to anything. The only thing that leaves the Mac is the platform's own page, opened in the default browser when the person asks for it.

## Where it opens

- **Result card:** a "Share" button after "Show in Finder" on a saved recording. It shares the newest zoomed copy of that recording if one exists (`Rokk-...-zoom.mp4`, `-zoom-2.mp4` and so on, by modification time), otherwise the recording itself (`share_source` in Rust).
- **Save with zoom:** a "Share" button in the finished state, which shares the file just saved. The zoom player passes it up to the result card's controls (`onShare`), so only one place imports the panel and its preload list exists once.
- **The dialog:** a Graphite dialog inside the Rokk window. Escape closes it and focus returns to the Share button that opened it. Closing it cancels a GIF or smaller copy still being made.

## The panel

**Left: the video.**
- A paused preview of the file with a frame scrubber, and its details read from the file by Rust (`share_probe`): duration, width and height, size and codec ("H.264", "HEVC" or the raw FourCC).
- **Save GIF for a README:**
  - "Set start" and "Set end" take the scrubber time, at most 10 seconds apart.
  - The GIF is 960 px wide (never wider than the video), 12 fps and loops forever.
  - It aims for under 10 MB. If the first GIF is larger, Rokk tries 10 fps, then 8 fps, then 800, 640 and 480 px wide, and keeps the first one under 10 MB. If even the last is over, it keeps that one and says so.
  - It is written next to the video as `Rokk-...-readme.gif`.
  - Frames are read by AVFoundation (`AVAssetImageGenerator`, exact frames) and the GIF is written by ImageIO. There is no ffmpeg. ImageIO writes a `GIF87a` header, which browsers and GitHub accept for animated GIFs; the animation and loop extensions are there.
  - **Measured on two real 2448 by 1616 recordings (10 seconds each):** 960 by 633, 12 fps, 3.7 MB and 2.9 MB, each in about 8 seconds, so the first step was enough.
- **Save poster:** a full resolution PNG of the frame at the scrubber time, as `Rokk-...-poster.png`.
- Both show progress or a busy state, then a result row with Show in Finder.

**Right: three tabs, X, LinkedIn and YouTube.** The last tab used is remembered. Each tab has:
- **Checks:** a green tick or an amber triangle with plain text. They are warnings, never blockers. A limit that could not be verified shows no number, only "Check the platform's current limit."
- **Caption editor:** plain text with a live counter that uses the platform's rule. YouTube has a title (100 characters) and a description (5000 bytes). Each caption is remembered.
- **Secrets confirmation:** the checkbox "I checked the video for API keys, tokens and private info." It is unchecked every time the panel opens. "Post now" (or "Upload now"), "Copy file" and the drag handle stay unavailable until it is ticked. "Copy caption", "Show in Finder" and "Make a smaller copy" do not need it. Rokk has no in-app secrets guide to link to; the only existing guidance is the stage mode toast.
- **Actions:** see below.

**Share settings** (at the bottom of the panel):
- **"Link to include":** empty by default; it must be a full `https://` address. It fills the `[link]` placeholder in captions that still have it. When the link is empty, the placeholder line is removed.
- **"Add 'Recorded with Rokk' to captions":** on by default. Switching it adds or removes that line in the captions, and the line can also be edited in the caption itself.

**Templates.** Each platform starts from `[what the clip shows]`, the link and the credit line. The person replaces `[what the clip shows]`.

## Actions

**The main action** is one full-width primary button, the only filled control in the panel. It is 44px high, fully rounded, with a solid fill (the theme's `--primary`, near-white on dark) and dark 15px/600 text, an arrow glyph (U+2197, a character rather than an SVG to save bytes) and a focus ring.
- **Labels:** "Post now" on X and LinkedIn, "Upload now" on YouTube.
- **Before the secrets box is ticked:** the button is always shown, at 45 percent opacity with `aria-disabled`, and "Tick the box above first" appears under it.
- **Helper line:**
  - X: "Opens X with your caption. You press Post there."
  - LinkedIn: "Copies your caption and opens LinkedIn. You press Post there."
  - YouTube: "Opens YouTube Studio. Choose Create, then Upload videos."
- **After the page opens:** the helper turns green ("X opened in your browser.") and is announced politely. Switching tabs brings the helper back.
- **Other actions:** every other button stays outlined.

**The hand-off row:** directly below the main button and its helper line, four outlined buttons share one row of equal columns (8px gap, 40px high, 13px/500): Copy caption, Copy file, Drag the video, Show in Finder.
- **Icons:** the leading copy, file, grip and folder icons are characters added in CSS (`::before`, with empty alt text so screen readers skip them), so they cost no JavaScript. The folder character falls back to whatever system font has it.
- **Labels:** they never wrap or truncate. When the right column is narrower than about 540px (a container query on the column, not the window), the row becomes 2 by 2. The four labels need about 520px, so the switch point is a little above the 480px the request suggested.
- **Gating:** Copy file and Drag the video are `aria-disabled` and dimmed until the secrets box is ticked; "Tick the box above first" shows just above them, under the main button. Copy caption and Show in Finder always work.
- **Copied:** after a copy, the button reads "Copied" for 1.5 seconds. The columns are equal, so its width does not change. On YouTube, Copy caption copies the description; "Copy title" sits under the title field.
- **Make a smaller copy:** it appears on its own line only when the file is over the tab's verified size limit, next to the size warning.

What the main button does on each platform:
- **X, Post now:** `https://x.com/intent/tweet?text=<caption>`, with the caption URL-encoded (newlines, emoji, `&`, quotes and `#` included).
- **LinkedIn, Post now:** LinkedIn's documented share link takes only a URL, not text, so Rokk copies the caption, opens `https://www.linkedin.com/` and says so in the panel.
- **YouTube, Upload now:** opens `https://studio.youtube.com/`. Nothing can be prefilled; the panel says to choose Create, then Upload videos, and paste the title and description.
- **Copy caption** (YouTube: Copy description and Copy title).
- **Copy file:** puts the video on the macOS pasteboard as a file URL (`NSURL` through `writeObjects:`). It can be pasted into Finder, Mail and many browsers.
- **Drag the video:**
  - **How:** pressing the handle and moving 4 px calls `share_drag`. Rust then starts a native AppKit drag session (`beginDraggingSessionWithItems:event:source:`) from the window's content view, with the file URL and the file's Finder icon. The drag source is a small `NSDraggingSource` class (`RokkShareDragSource`) that allows Copy.
  - **When it refuses:** only while the left mouse button is down or dragging. Otherwise it returns `drag_failed` and the panel says to use Copy file or Show in Finder.
  - **Crates:** built with objc2-app-kit, which is already a dependency; no drag crate was added.
  - **Not yet tested:** the drag compiles and its guard is in place, but it has not been tried in the running app. See the checklist.
- **Show in Finder:** selects the file.
- **Make a smaller copy:** a 1080p H.264 copy written next to the original as `<name>-share.mp4`.
  - **How:** it uses the zoom exporter's renderer (`zoom_export::av::render`) with a still camera at 1x, so it is a plain Lanczos scale. Audio is copied if there is any.
  - **Size:** the video fits inside 1920 by 1080 (1080 by 1920 when portrait) and is never enlarged.
  - **Bit rate:** 5 Mbit/s, X's recommended minimum. When the file is over the tab's verified size limit, the rate is chosen so the copy lands 10 percent under it. Below 0.5 Mbit/s the panel says the video is too long to fit.
  - **Safety:** progress and Cancel, never overwrites, the original is never touched.
  - Since 2026-11-21 there is no "Share this copy" button (it was cut to keep the budget); share the copy from its own folder, or drag it from Finder.

## Platform data

One module, `src/modules/rokk-stage/share/platforms.ts`, holds every limit with its check date. `SOURCES` in the same module lists the official pages. It is kept apart so it does not reach the app bundle, and the tests check that every platform has sources.

**Checked on 2026-11-21** with headless Chrome against the official pages:

| | X | LinkedIn | YouTube |
|---|---|---|---|
| Longest video | 20 minutes for standard accounts (125 for Premium) | 15 minutes | 15 minutes for standard accounts (longer once verified) |
| Shortest video | 0.5 s | 3 s from a computer | not stated, so not checked |
| Largest file | 8 GB for standard accounts (16 GB Premium) | 5 GB (smallest 75 KB) | 256 GB |
| Format | H.264 High profile recommended | MP4 accepted | MP4, H.264 recommended |
| Shape | 1:3 to 3:1 | 1:2.4 to 2.4:1 | **unverified**: "16:9 is standard", other ratios adapt; no range stated |
| Resolution | 1280 by 720 recommended (1080p for subscribers) | 256 by 144 to 4096 by 2304 | **unverified**: no number shown |
| Caption | 280, links count 23, emoji and CJK 2, NFC | 3000 characters | description 5000 bytes, title 100 characters |
| Compose | `x.com/intent/tweet?text=` | no text prefill (share link takes a URL only) | no prefill; `studio.youtube.com` |

**Sources:**

- **X:**
  - `docs.x.com/x-api/media/quickstart/best-practices` (size and duration limits, "Post-video caps match the X app", video recommendations)
  - `docs.x.com/resources/fundamentals/counting-characters`
  - `docs.x.com/x-for-websites/post-button/overview` (the `text` parameter of `x.com/intent/tweet`)
  - `help.x.com` was behind a bot check and could not be read.
- **LinkedIn:**
  - Help `a548372` (Video sharing troubleshooting)
  - Help `a528176` (Post and share updates: "up to 3,000 characters")
  - Microsoft Learn "Share Plugin" (the share button takes a URL only)
- **YouTube:**
  - Help `71673` (15 minutes by default, 256 GB or 12 hours)
  - Help `57407` (upload in YouTube Studio, Create, Upload videos)
  - Help `1722171` (MP4, H.264, 16:9)
  - YouTube Data API `videos` (title 100 characters, description 5000 bytes, no `<` or `>`)

**X's counter** follows the counting page: NFC, links 23, emoji 2, and twitter-text's weight-1 ranges (U+0000 to U+10FF, U+2000 to U+200D, U+2010 to U+201F, U+2032 to U+2037). Every other character counts 2. Links are `http(s)://` and `www.` addresses. A bare domain such as `example.com` counts as text here, although X counts it as a 23 character link. The link Rokk adds is always a full https address.

## How to update the data

1. Open each source page above, and check the numbers against the table.
2. Change the numbers in `PLATFORMS`, update `CHECKED_ON`, and update `SOURCES` if a page moved.
3. A limit you cannot confirm on an official page becomes `null`, so the panel shows only "Check the platform's current limit."
4. Use `accountNote: "for standard accounts"` only when the page says the limit depends on the account.
5. Update the table here, and run `pnpm exec vitest run src/modules/rokk-stage/share`.

## Privacy

- **Network:** none, except the compose page opened in the browser. There are no analytics and no API calls.
- **Captions:** they stay in this Mac's local storage (`rokk.share.v1`: last tab, link, credit switch and the captions). They leave only on the clipboard, or in X's link when the person opens it.
- **Log:** one line per job, with no captions and no paths: `[rokk_share] Smaller result=done size=<bytes> seconds=<n>`, `[rokk_share] smaller start out=<w>x<h> rate=<bps>`, `[rokk_share] poster result=done`.
- **Temporary files:** every file is written to `...-partial.<ext>` and renamed when done. Partial files are deleted on error or cancel, a GIF attempt over the cap is deleted before the next try, and partial files left by a crash are removed when the next share job starts.
- **Names:** only generated names in `~/Movies/Rokk`, with no symlinks and no `..`. Sources must be Rokk recordings, zoomed copies or smaller copies there.

## Choosing the browser and Chrome profile

**The problem.** "Post now" used the opener plugin's `openUrl`, so links went to the system default browser. Chrome then opens a link in its last used profile, which for the owner was the profile Claude is connected to. Chrome decides that; nothing in the link can choose a profile.

**The picker** (Share settings, "Open links in"):
- **Choices:** "Default browser", then each detected browser:
  - Google Chrome (Beta, Dev and Canary if present), Brave, Microsoft Edge and Vivaldi;
  - Opera, Arc, Firefox and Safari.
- **Profile:** for Chrome, Brave, Edge and Vivaldi, a second "Profile" select lists the display names, plus "Last used". When two profiles share a name, Rust adds the folder: "Work (Profile 1)".
- **No profile choice for Opera and Arc:** they are Chromium based but do not take `--profile-directory` (Opera has its own profiles, Arc has Spaces).
- **Remembered:** the browser id and the profile folder, in `rokk.share.v1`.
- **Helper line:** the main button's helper becomes "Opens in Google Chrome (Personal). You press Post there."
- **Every opening path:** X, LinkedIn and YouTube Studio all go through `open_share_url`.
- **Gone or failing:** if the saved browser or profile is gone, or the chosen browser fails to open, Rokk uses the default browser. It shows "Your chosen browser profile was not found. Using the default browser." once and clears the choice.

**Rust** (`rokk_record/browsers.rs`):
- **`list_browsers()`:** finds each known bundle id through Launch Services (`NSWorkspace URLForApplicationWithBundleIdentifier`). It keeps only apps in `/Applications`, `~/Applications` or, for Safari, the system location, and returns `{ id, name, app_path, supports_profiles }`.
- **`list_browser_profiles(browser_id)`:**
  - **What it reads:** only `~/Library/Application Support/<browser>/Local State`, at most 1 MB (a larger file counts as unreadable).
  - **What it keeps:** from `profile.info_cache`, only the folder name (letters, digits and spaces, at most 64) and `name`. Emails, gaia names, avatars and every other field are dropped in the parser.
  - **Errors:** an empty list.
- **`open_share_url(url, browser_id?, profile_dir?)`:**
  - **URL:** https only, with a host on the allow-list (x.com, twitter.com, www.linkedin.com, linkedin.com, studio.youtube.com, www.youtube.com, youtube.com; any letter case). It refuses user info, ports, `%` or `\` in the host, whitespace and control characters.
  - **Browser and profile:** the browser must be detected again at call time, and the profile folder must be in that browser's Local State at call time.
  - **Process:** it runs `/usr/bin/open` with an argument array, never a shell. The url is always one argument, the last.
    - default: `open <url>`;
    - a browser: `open -a <app> <url>`;
    - a Chromium profile: `open -na <app> --args --profile-directory=<dir> <url>`. The `-n` is needed because `open -a` ignores `--args` while the browser runs; the new process hands the url to the running Chrome in that profile.
  - **Fallback:** if the chosen browser fails, it opens the default and returns `{ fallback: true }`.
  - **Log:** one line with no names and no paths: `[rokk_share] open chosen=<bool> profile=<bool> fallback=<bool>`.
- **Permissions:** no capability or opener scope changed. These are app commands, and the opener plugin is no longer used for Share links.

**Verified automatically (2026-11-21, this Mac):**
- **Detection:** Google Chrome and Safari were detected, and 3 Chrome profile folders were read.
- **Opening:** `open_share_url` opened `https://www.youtube.com/` once per profile, with exit status 0 each time and no fallback.
- **Not verified:** which window got each tab cannot be seen from the shell. Chrome's AppleScript has no profile property, and asking would have triggered a macOS automation prompt.

**Manual test (the owner):**
1. In Chrome, open one window per profile (click your avatar, then each profile). Note each window's profile badge at the top right.
2. In Rokk, open Share, then Share settings. Choose Google Chrome and a profile. Check that the helper says "Opens in Google Chrome (<that profile>)".
3. Tick the box and press Post now. The X tab must appear in the window of that profile, not the last used one.
4. Repeat for each profile, then once with Chrome quit (it should start in that profile).
5. Choose Safari: the link opens in Safari.
6. Choose "Default browser": the old behavior.
7. Remove a profile in Chrome (or pick one, then delete it): reopening Share shows the not-found notice once, and the choice is back to Default browser.
8. Or from the terminal: `ROKK_OPEN_PROFILES=1 cargo test --lib rokk_record::browsers -- --ignored --nocapture` opens youtube.com once per Chrome profile.

## Commands (Rust, `rokk_record/share.rs`)

- `share_source(path)` and `share_probe(path)`.
- `share_smaller_start(path, bitRate)` and `share_gif_start(path, startMs, endMs)`: these send `rokk-share-job` events (`job`, `kind`, `state`, `progress`, `output`, `size`, `width`, `height`, `fps`, `code`, `message`).
- `share_cancel(job)`.
- `share_poster(path, atMs)`.
- `share_copy_file(path)`.
- `share_drag(path)`.

One share job runs at a time; none runs while a recording is going. Apple frameworks used: AVFoundation, ImageIO, CoreGraphics, CoreMedia and AppKit. The ImageIO, CoreGraphics and CoreMedia calls are direct framework calls, with no new crates. Two existing crates gained features:
- objc2-av-foundation: `AVAssetImageGenerator` and `objc2-core-graphics`;
- objc2-app-kit: the drag and view types.

## Size

The panel is its own lazy chunk (about 7.1 kB gzipped); startup code is unchanged. The total client JS is at 1,574,919 of 1,575,000 bytes, so there is no room left for the next feature without trimming (see TODO.md).

To fit, `SOURCES` stays out of the bundle, small components opt out of the React Compiler (`"use no memo"`), remembered settings use one storage entry, and the panel has a single lazy import.

## Not in this version

Vertical 9:16 export is a later step and is not in the UI.

## Manual checklist

- [ ] Share from the result card of a recording with a zoomed copy: the panel shows the `-zoom` file.
- [ ] Escape closes the panel and focus is back on Share.
- [ ] Open X to post: the browser shows the caption, with emoji and line breaks intact.
- [ ] Open LinkedIn: the caption is on the clipboard and LinkedIn opens.
- [ ] Copy file, then paste in Finder: the MP4 is copied. Paste into an X or LinkedIn composer in Safari and Chrome, and write down what works.
- [ ] Drag the video into a browser composer: the file attaches. If it does not, write down what happens (no drag image, refused), and remove the handle if it cannot be made reliable.
- [ ] Save GIF for 10 seconds: under 10 MB, loops in the browser, and the numbers in the result row match the file.
- [ ] Save poster: the PNG is full size.
- [ ] Make a smaller copy, cancel it halfway (no `-partial` file left), then let it finish and Share this copy.

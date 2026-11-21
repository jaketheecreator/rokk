// The share panel's pure parts: caption templates, remembered settings, the
// secrets gate, the smaller copy's bit rate, the GIF range and the job
// state from "rokk-share-job" events (src-tauri/.../rokk_record/share.rs).
// Captions stay on this Mac: they are only kept in local storage, copied to
// the clipboard, or put in X's compose link when the person opens it.

import { PLATFORM_IDS, type PlatformId } from "./platforms";

export const WHAT = "[what the clip shows]";
export const LINK = "[link]";
export const CREDIT = "Recorded with Rokk";

export const CONFIRM_TEXT =
  "I checked the video for API keys, tokens and private info.";

/** A caption per tab; YouTube also has a title. */
export type CaptionKey = PlatformId | "youtubeTitle";
export type Captions = Record<CaptionKey, string>;

export const TEMPLATES: Captions = {
  x: `${WHAT}\n\n${LINK}`,
  linkedin: `${WHAT}\n\nA short demo. ${LINK}`,
  youtube: `${WHAT}\n\n${LINK}`,
  youtubeTitle: WHAT,
};

export type ShareSettings = { link: string; credit: boolean };

/** Drops the [link] placeholder (and a line left empty by it). */
function dropLink(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(LINK, "").replace(/[ \t]+$/, ""))
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n")
    .trim();
}

/** Adds or removes the credit line at the end. */
export function setCredit(text: string, on: boolean): string {
  const lines = text.split("\n");
  const without = lines
    .filter((l) => l.trim() !== CREDIT)
    .join("\n")
    .trimEnd();
  return on ? `${without}${without ? "\n\n" : ""}${CREDIT}` : without;
}

/** Puts the link where [link] is; an empty link removes the placeholder. */
export function applyLink(text: string, link: string): string {
  if (!text.includes(LINK)) return text;
  return link ? text.split(LINK).join(link) : dropLink(text);
}

/** A template filled with the settings. Titles get no credit line. */
export function fillTemplate(key: CaptionKey, s: ShareSettings): string {
  const linked = applyLink(TEMPLATES[key], s.link);
  return key === "youtubeTitle" ? linked : setCredit(linked, s.credit);
}

export const LINK_ERROR = "Use a full address that starts with https://.";

/** The "Link to include" field: empty, or a normalized https URL. */
export function checkLink(
  input: string,
): { ok: true; link: string } | { ok: false; message: string } {
  const s = input.trim();
  if (!s) return { ok: true, link: "" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, message: LINK_ERROR };
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !u.hostname.includes(".") ||
    /\s/.test(s)
  )
    return { ok: false, message: LINK_ERROR };
  return { ok: true, link: u.href };
}

// Remembered settings (this Mac only): the last tab, the share settings
// and each caption, in one local storage entry.

export const SHARE_KEY = "rokk.share.v1";
export type Remembered = ShareSettings & {
  tab: PlatformId;
  captions: Captions;
  /** The browser (bundle id) and Chromium profile folder for Share
   * links; empty means the default browser. */
  browser: string;
  profile: string;
};

type Store = Pick<Storage, "getItem" | "setItem"> | null;

/** What was remembered; anything missing or odd falls back to the default
 * (X, no link, credit on, the templates). */
export function readRemembered(store: Store): Remembered {
  let v: Record<string, unknown> = {};
  try {
    const o = JSON.parse(store?.getItem(SHARE_KEY) ?? "{}");
    if (o && typeof o === "object" && !Array.isArray(o)) v = o;
  } catch {
    // Use the defaults.
  }
  const link = checkLink(typeof v.link === "string" ? v.link : "");
  const s = { link: link.ok ? link.link : "", credit: v.credit !== false };
  const saved = (v.captions ?? {}) as Record<string, unknown>;
  const captions = {} as Captions;
  for (const k of Object.keys(TEMPLATES) as CaptionKey[]) {
    const c = saved[k];
    captions[k] = typeof c === "string" ? c : fillTemplate(k, s);
  }
  const tab = PLATFORM_IDS.includes(v.tab as PlatformId)
    ? (v.tab as PlatformId)
    : "x";
  // Unknown values are cleared once the browser lists are read, and Rust
  // refuses them anyway.
  const str = (x: unknown) => (typeof x === "string" ? x.slice(0, 64) : "");
  return {
    ...s,
    tab,
    captions,
    browser: str(v.browser),
    profile: str(v.profile),
  };
}

export function writeRemembered(store: Store, r: Remembered): void {
  try {
    store?.setItem(SHARE_KEY, JSON.stringify(r));
  } catch {
    // Remembering is a convenience only.
  }
}

// Where Share links open (src-tauri/.../rokk_record/browsers.rs).

export type Browser = { id: string; name: string; supports_profiles: boolean };
export type Profile = { dir: string; name: string };

export const NOT_FOUND =
  "Your chosen browser profile was not found. Using the default browser.";

/** A saved choice against the detected lists (`profiles` is [] for a
 * browser without profiles): whether it is gone, and the helper line
 * ("Opens in <Browser> (<Profile>)...") or null for the default browser.
 * Profile names come from Rust with the folder added when two repeat. */
export function choice(
  browser: string,
  profile: string,
  browsers: Browser[] | null,
  profiles: Profile[] | null,
): { missing: boolean; where: string | null } {
  const b = browsers?.find((x) => x.id === browser);
  const p = profiles?.find((x) => x.dir === profile);
  return {
    missing: !!browser && !!browsers && (!b || (!!profile && !!profiles && !p)),
    where: b
      ? `Opens in ${b.name}${p ? ` (${p.name})` : ""}. You press Post there.`
      : null,
  };
}

// The secrets gate.

export type Action =
  | "open"
  | "copyFile"
  | "drag"
  | "copyCaption"
  | "showInFinder"
  | "smaller";
const NEEDS_CONFIRM: readonly Action[] = ["open", "copyFile", "drag"];

/** Whether an action may run: the three that hand the video over wait for
 * the secrets checkbox. */
export const allowed = (action: Action, confirmed: boolean) =>
  confirmed || !NEEDS_CONFIRM.includes(action);

// The smaller copy.

export const DEFAULT_RATE = 5_000_000;
export const MIN_RATE = 500_000;
/** The copy aims this far under a size limit (10 percent). */
export const MARGIN = 0.9;

/** The bit rate for a smaller 1080p copy: 5 Mbit/s, or less so the copy
 * lands 10 percent under `limitBytes`. Null when even 0.5 Mbit/s is too
 * much (too long to fit). */
export function smallerRate(
  durationMs: number,
  limitBytes: number | null,
): number | null {
  const secs = durationMs / 1000;
  if (!(secs > 0)) return null;
  const fit =
    limitBytes === null
      ? DEFAULT_RATE
      : Math.floor((limitBytes * MARGIN * 8) / secs);
  const rate = Math.min(DEFAULT_RATE, fit);
  return rate >= MIN_RATE ? rate : null;
}

export const estimateBytes = (rate: number, durationMs: number) =>
  Math.round((rate / 8) * (durationMs / 1000));

// The GIF range.

export const GIF_MAX_MS = 10_000;
export const GIF_MIN_MS = 100;

/** Start and end kept inside the video, end after start, at most 10 s
 * apart. Moving one end past the limit drags the other along. */
export function clampRange(
  start: number,
  end: number,
  durationMs: number,
  moved: "start" | "end",
): [number, number] {
  const d = Math.max(0, durationMs);
  const clip = (v: number) => Math.min(Math.max(0, v), d);
  let s = clip(start);
  let e = clip(end);
  // The end that was not moved follows, within 0.1 to 10 seconds.
  const span = Math.min(GIF_MAX_MS, Math.max(GIF_MIN_MS, e - s));
  if (moved === "start") e = clip(s + span);
  else s = clip(e - span);
  // Near an edge of the video, the moved end gives way.
  if (e - s < GIF_MIN_MS) {
    if (moved === "start") s = clip(e - GIF_MIN_MS);
    else e = clip(s + GIF_MIN_MS);
  }
  return [s, e];
}

// Jobs.

export type ShareEvent = {
  job: number;
  kind: "smaller" | "gif";
  state: "running" | "done" | "error" | "cancelled";
  progress: number;
  output: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  code: string | null;
  message: string | null;
};

export type JobView =
  | { kind: "idle" }
  | {
      kind: "running";
      what: "smaller" | "gif";
      job: number | null;
      progress: number;
    }
  | {
      kind: "done";
      what: "smaller" | "gif";
      output: string;
      size: number;
      width: number;
      height: number;
      fps: number;
    }
  | { kind: "error"; what: "smaller" | "gif"; code: string; message: string }
  | { kind: "cancelled"; what: "smaller" | "gif" };

export const IDLE: JobView = { kind: "idle" };

/** The view after an event; events of another job are ignored. */
export function reduceJob(view: JobView, e: ShareEvent): JobView {
  if (
    view.kind !== "running" ||
    e.kind !== view.what ||
    (view.job !== null && e.job !== view.job)
  )
    return view;
  if (e.state === "running")
    return {
      ...view,
      job: e.job,
      progress: Math.min(1, Math.max(0, e.progress)),
    };
  if (e.state === "done")
    return {
      kind: "done",
      what: view.what,
      output: e.output ?? "",
      size: e.size ?? 0,
      width: e.width ?? 0,
      height: e.height ?? 0,
      fps: e.fps ?? 0,
    };
  if (e.state === "error")
    return {
      kind: "error",
      what: view.what,
      code: e.code ?? "unknown",
      message: e.message ?? "The file could not be made.",
    };
  return { kind: "cancelled", what: view.what };
}

/** A refused command, as code and message. */
export function asError(e: unknown): { code: string; message: string } {
  const o = (typeof e === "object" && e ? e : {}) as {
    code?: unknown;
    message?: unknown;
  };
  return {
    code: typeof o.code === "string" ? o.code : "unknown",
    message: typeof o.message === "string" ? o.message : "That did not work.",
  };
}

export const baseName = (path: string) => path.split("/").pop() ?? path;

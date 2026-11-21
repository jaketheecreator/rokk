// The share panel's platform data: video limits, caption limits, compose
// pages, and where each number comes from. Every number here was read on the
// platform's official help or developer page on CHECKED_ON. A limit that
// could not be verified is null, and the panel then shows no number, only
// UNVERIFIED. How to update: docs/rokk/SHARE.md.

export type PlatformId = "x" | "linkedin" | "youtube";
export const PLATFORM_IDS: readonly PlatformId[] = ["x", "linkedin", "youtube"];

export const CHECKED_ON = "2026-11-21";
export const UNVERIFIED = "Check the platform's current limit.";

export type Source = { label: string; url: string };

export type Platform = {
  id: PlatformId;
  name: string;
  video: {
    /** Longest video in seconds, or null when not verified. */
    maxSeconds: number | null;
    minSeconds: number | null;
    maxBytes: number | null;
    minBytes: number | null;
    /** "for standard accounts" when the official page says the limit
     * depends on the account; otherwise null. */
    accountNote: string | null;
    /** What the page says about MP4 with H.264. */
    formatOk: string;
    /** Allowed width:height range as numbers, or null. */
    aspect: [number, number] | null;
    aspectText: string | null;
    /** Allowed size range (long side by short side), or null. */
    sizeRange: { min: [number, number]; max: [number, number] } | null;
    /** A recommendation (not a limit), or null. */
  };
  caption: {
    limit: number;
    /** "x": X's weighted count with links as 23; "chars": characters;
     * "bytes": UTF-8 bytes. */
    rule: "x" | "chars" | "bytes";
    ruleText: string;
  };
  title: { limit: number; ruleText: string } | null;
  compose: {
    label: string;
    /** Whether the caption can be filled in from the link. */
    prefill: boolean;
    /** The helper line under the main button. */
    note: string;
  };
  checkedOn: string;
};

const GB = 1_000_000_000;

export const PLATFORMS: Record<PlatformId, Platform> = {
  x: {
    id: "x",
    name: "X",
    video: {
      maxSeconds: 20 * 60,
      minSeconds: 0.5,
      maxBytes: 8 * GB,
      minBytes: null,
      accountNote: "for standard accounts",
      formatOk: "MP4 with H.264, which X recommends.",
      aspect: [1 / 3, 3],
      aspectText: "1:3 to 3:1",
      sizeRange: null,
    },
    caption: {
      limit: 280,
      rule: "x",
      ruleText: "Links count as 23 characters, emoji as 2.",
    },
    title: null,
    compose: {
      label: "Post now",
      prefill: true,
      note: "Opens X with your caption. You press Post there.",
    },
    checkedOn: CHECKED_ON,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    video: {
      maxSeconds: 15 * 60,
      minSeconds: 3,
      maxBytes: 5 * GB,
      minBytes: 75_000,
      accountNote: null,
      formatOk: "MP4, which LinkedIn accepts.",
      aspect: [1 / 2.4, 2.4],
      aspectText: "1:2.4 to 2.4:1",
      sizeRange: { min: [256, 144], max: [4096, 2304] },
    },
    caption: { limit: 3000, rule: "chars", ruleText: "Characters." },
    title: null,
    compose: {
      label: "Post now",
      prefill: false,
      note: "Copies your caption and opens LinkedIn. You press Post there.",
    },
    checkedOn: CHECKED_ON,
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    video: {
      maxSeconds: 15 * 60,
      minSeconds: null,
      maxBytes: 256 * GB,
      minBytes: null,
      accountNote: "for standard accounts",
      formatOk: "MP4 with H.264, which YouTube recommends.",
      aspect: null,
      aspectText: null,
      sizeRange: null,
    },
    caption: {
      limit: 5000,
      rule: "bytes",
      ruleText: "Bytes: most letters are 1, accents 2, emoji 4.",
    },
    title: { limit: 100, ruleText: "Characters." },
    compose: {
      label: "Upload now",
      prefill: false,
      note: "Opens YouTube Studio. Choose Create, then Upload videos.",
    },
    checkedOn: CHECKED_ON,
  },
};

/** Recommendations (not limits), verified on CHECKED_ON. Kept out of the
 * panel and its bundle, like SOURCES: X recommends 1280 by 720, 1080p for
 * subscribers. */
export const RECOMMENDED: Partial<Record<PlatformId, string>> = {
  x: "1280 by 720 (1080p for subscribers), H.264 High profile, 30 or 60 fps",
};

/** Where every number above comes from, read on CHECKED_ON. Kept apart
 * from PLATFORMS so the app bundle does not carry it; the tests and
 * docs/rokk/SHARE.md use it. */
export const SOURCES: Record<PlatformId, Source[]> = {
  x: [
    {
      label: "X media best practices (size and duration limits)",
      url: "https://docs.x.com/x-api/media/quickstart/best-practices",
    },
    {
      label: "X counting characters",
      url: "https://docs.x.com/resources/fundamentals/counting-characters",
    },
    {
      label: "X Post button and web intent",
      url: "https://docs.x.com/x-for-websites/post-button/overview",
    },
  ],
  linkedin: [
    {
      label: "LinkedIn Help: Video sharing troubleshooting",
      url: "https://www.linkedin.com/help/linkedin/answer/a548372",
    },
    {
      label: "LinkedIn Help: Post and share updates",
      url: "https://www.linkedin.com/help/linkedin/answer/a528176",
    },
  ],
  youtube: [
    {
      label: "YouTube Help: Upload videos longer than 15 minutes",
      url: "https://support.google.com/youtube/answer/71673",
    },
    {
      label: "YouTube Help: Upload videos",
      url: "https://support.google.com/youtube/answer/57407",
    },
    {
      label: "YouTube Help: Recommended upload encoding settings",
      url: "https://support.google.com/youtube/answer/1722171",
    },
    {
      label: "YouTube Data API: videos (title and description limits)",
      url: "https://developers.google.com/youtube/v3/docs/videos",
    },
  ],
};

/** The page the "Open" button goes to. Only X takes the caption. */
export function composeUrl(id: PlatformId, caption: string): string {
  if (id === "x")
    return `https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`;
  if (id === "linkedin") return "https://www.linkedin.com/";
  return "https://studio.youtube.com/";
}

// Counting.

const TRAILING = /[.,!?;:)\]'"]+$/;
/** http(s) and www. links; a bare domain counts as text (see SHARE.md). */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** The links X would shorten, as they appear in the text. */
export function findLinks(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(TRAILING, ""));
}

/** twitter-text's weight-1 ranges; every other code point weighs 2. */
const LIGHT: [number, number][] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
const light = (cp: number) => LIGHT.some(([a, b]) => cp >= a && cp <= b);
const EMOJI =
  /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}|⃣/u;

/** Grapheme clusters (Intl.Segmenter is in every WebKit Rokk runs on; the
 * project's TypeScript lib does not declare it yet). */
type Segmenter = new (
  locale?: string,
  o?: { granularity: string },
) => { segment(s: string): Iterable<{ segment: string }> };
const graphemes = (s: string) =>
  Array.from(
    new (Intl as unknown as { Segmenter: Segmenter }).Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(s),
    (x) => x.segment,
  );

/** X's weighted length: NFC text, every link 23, every emoji 2, other
 * characters 1 or 2 by range (docs.x.com counting characters). */
export function xLength(text: string): number {
  let rest = text.normalize("NFC");
  let total = 0;
  for (const link of findLinks(rest)) {
    const at = rest.indexOf(link);
    if (at < 0) continue;
    total += 23;
    rest = rest.slice(0, at) + rest.slice(at + link.length);
  }
  for (const g of graphemes(rest)) {
    if (EMOJI.test(g)) total += 2;
    else for (const ch of g) total += light(ch.codePointAt(0) ?? 0) ? 1 : 2;
  }
  return total;
}

export const charLength = (text: string) =>
  Array.from(text.normalize("NFC")).length;
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;

export function captionLength(id: PlatformId, text: string): number {
  const rule = PLATFORMS[id].caption.rule;
  if (rule === "x") return xLength(text);
  return rule === "bytes" ? byteLength(text) : charLength(text);
}

// Checks.

export type Meta = {
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  codec: string;
  name: string;
};

export type Check = { key: string; ok: boolean; text: string };

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${+(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${+(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

const minutes = (s: number) => (s >= 60 ? `${s / 60} minutes` : `${s} seconds`);
const with_ = (text: string, note: string | null) =>
  note ? `${text} ${note}` : text;

/** A length or size check against a verified maximum (and minimum). */
function limitCheck(
  key: string,
  shown: string,
  n: number,
  max: number | null,
  min: number | null,
  fmt: (n: number) => string,
  p: Platform,
  fix = "",
): Check {
  if (max === null) return { key, ok: false, text: `${shown}. ${UNVERIFIED}` };
  if (n > max)
    return {
      key,
      ok: false,
      text: `${shown} is over ${with_(fmt(max), p.video.accountNote)}.${fix}`,
    };
  if (min !== null && n < min)
    return {
      key,
      ok: false,
      text: `${shown} is under ${fmt(min)}, the least ${p.name} takes.`,
    };
  return {
    key,
    ok: true,
    text: `${shown}, within ${with_(fmt(max), p.video.accountNote)}.`,
  };
}

/** The warnings for one platform. Never blockers: ok or not, with plain
 * text, and no number for a limit that is not verified. */
export function checksFor(p: Platform, m: Meta): Check[] {
  const v = p.video;
  const out: Check[] = [
    limitCheck(
      "length",
      `Length ${formatDuration(m.durationMs)}`,
      m.durationMs / 1000,
      v.maxSeconds,
      v.minSeconds,
      minutes,
      p,
    ),
    limitCheck(
      "size",
      `File ${formatBytes(m.bytes)}`,
      m.bytes,
      v.maxBytes,
      v.minBytes,
      formatBytes,
      p,
      " Make a smaller copy.",
    ),
  ];

  const mp4 = m.name.toLowerCase().endsWith(".mp4");
  const h264 = m.codec === "H.264";
  out.push(
    mp4 && h264
      ? { key: "format", ok: true, text: v.formatOk }
      : {
          key: "format",
          ok: false,
          text: `This file is ${mp4 ? "MP4" : "not MP4"} with ${m.codec || "an unknown codec"}. ${UNVERIFIED}`,
        },
  );

  const dims = `${m.width} by ${m.height}`;
  const ratio = m.height > 0 ? m.width / m.height : 0;
  if (v.aspect === null || v.aspectText === null)
    out.push({ key: "shape", ok: false, text: `Shape ${dims}. ${UNVERIFIED}` });
  else if (ratio < v.aspect[0] - 1e-9 || ratio > v.aspect[1] + 1e-9)
    out.push({
      key: "shape",
      ok: false,
      text: `Shape ${dims} is outside ${v.aspectText}.`,
    });
  else
    out.push({
      key: "shape",
      ok: true,
      text: `Shape ${dims}, inside ${v.aspectText}.`,
    });

  const long = Math.max(m.width, m.height);
  const short = Math.min(m.width, m.height);
  if (v.sizeRange) {
    const { min, max } = v.sizeRange;
    const inside =
      long >= min[0] && short >= min[1] && long <= max[0] && short <= max[1];
    out.push({
      key: "resolution",
      ok: inside,
      text: inside
        ? `Resolution inside ${min[0]} by ${min[1]} to ${max[0]} by ${max[1]}.`
        : `Resolution ${dims} is outside ${min[0]} by ${min[1]} to ${max[0]} by ${max[1]}. Make a smaller copy.`,
    });
  }
  return out;
}

/** The verified size limit a smaller copy should fit under, or null. */
export const sizeLimit = (id: PlatformId) => PLATFORMS[id].video.maxBytes;

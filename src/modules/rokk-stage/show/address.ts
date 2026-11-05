// The stage preview's Address box: a port, a localhost address or a full
// http or https address, checked and normalized here (pure), plus the
// recent addresses. See docs/rokk/STAGE.md.

import { hintText, portOf, readPort } from "./show";

export const RECENT_KEY = "rokk.stage.recent";
export const RECENT_CAP = 5;
export const MAX_ADDRESS = 2048;

export const EMPTY = "Type a port or paste an address.";
export const BAD_PORT = "Use a port from 1 to 65535.";
export const BAD_SCHEME = "Only http and https addresses are supported.";
export const CREDENTIALS =
  "Addresses with a username or password are not supported.";
export const NOT_AN_ADDRESS =
  "That does not look like an address. Try 3000, localhost:3000 or https://example.com.";
export const EXTERNAL_HINT =
  "Many sites (Google, GitHub and most banks) refuse to be shown inside another app. If the frame is blank, try your own site or a localhost address.";

export type Parsed =
  | { ok: true; url: string; display: string; isLocal: boolean }
  | { ok: false; message: string };

/** Only these four loopback names count as local; LAN hosts are external. */
const LOCAL = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];
const fail = (message: string): Parsed => ({ ok: false, message });

export function parseAddress(input: string): Parsed {
  const s = input.trim();
  if (!s) return fail(EMPTY);
  if (s.length > MAX_ADDRESS) return fail(NOT_AN_ADDRESS);
  let href = s;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!/^[1-9]\d{0,4}$/.test(s) || n > 65535) return fail(BAD_PORT);
    href = `http://localhost:${n}`;
  } else {
    // The part before the path: user:pass@host:port, after any "scheme://".
    const authority = s
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
      .split(/[/?#]/)[0];
    if (authority.includes("@")) return fail(CREDENTIALS);
    const scheme = /^([a-z][a-z\d+.-]*):(?!\d+(?:[/?#]|$))/i.exec(s);
    if (scheme) {
      if (!/^https?$/i.test(scheme[1])) return fail(BAD_SCHEME);
    } else {
      const host = authority.replace(/:\d+$/, "").toLowerCase();
      if (LOCAL.includes(host)) href = `http://${s}`;
      else if (
        /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]*)+(:\d{1,5})?([/?#]\S*)?$/u.test(s)
      )
        href = `https://${s}`;
      else return fail(NOT_AN_ADDRESS);
    }
  }
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return fail(NOT_AN_ADDRESS);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return fail(BAD_SCHEME);
  if (u.username || u.password) return fail(CREDENTIALS);
  if (!u.hostname || /\s/.test(u.href)) return fail(NOT_AN_ADDRESS);
  const seg = u.pathname.split("/").find(Boolean);
  return {
    ok: true,
    url: u.href,
    display: seg ? `${u.host}/${seg.slice(0, 20)}` : u.host,
    isLocal: LOCAL.includes(u.hostname.toLowerCase()),
  };
}

/** Whether a preview tab's URL is a website rather than a local server. */
export function isExternal(url: string | undefined): boolean {
  const p = parseAddress(url ?? "");
  return p.ok && !p.isLocal;
}

/** The blank-preview hint for the active preview. */
export function hintFor(url: string | undefined): string {
  return isExternal(url) ? EXTERNAL_HINT : hintText(portOf(url));
}

type Store = Pick<Storage, "getItem" | "setItem"> | null;

/** Recent addresses, most recent first: only normalized http(s) URLs. */
export function readRecent(store: Store): string[] {
  let v: unknown;
  try {
    v = JSON.parse(store?.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const p = typeof x === "string" ? parseAddress(x) : null;
    if (p?.ok && p.url === x && !out.includes(x)) out.push(x);
  }
  return out.slice(0, RECENT_CAP);
}

function writeRecent(store: Store, list: readonly string[]): void {
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Remembering addresses is a convenience only.
  }
}

/** Puts `url` first, without duplicates, keeping RECENT_CAP. */
export function addRecent(store: Store, url: string): string[] {
  const list = [url, ...readRecent(store).filter((u) => u !== url)].slice(
    0,
    RECENT_CAP,
  );
  writeRecent(store, list);
  return list;
}

export function clearRecent(store: Store): void {
  writeRecent(store, []);
}

/** The Address box starts with the last address used, else the old
 * remembered port as localhost:PORT, else localhost:3000. */
export function prefill(store: Store): string {
  const last = readRecent(store)[0];
  if (last) return last;
  return `localhost:${readPort(store) ?? 3000}`;
}

/** A port chip fills the box (it does not submit). */
export const chipText = (port: number) => `localhost:${port}`;

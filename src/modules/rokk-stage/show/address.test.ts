import { TooltipProvider } from "@/components/ui/tooltip";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOZOOM_CHECKLIST,
  CHECKLIST_TEXT,
  checklistFor,
  EXTERNAL_CHECKLIST,
  PREVIEW_CHECKLIST,
} from "../record/record";
import {
  addRecent,
  BAD_PORT,
  BAD_SCHEME,
  CREDENTIALS,
  chipText,
  clearRecent,
  EMPTY,
  EXTERNAL_HINT,
  hintFor,
  isExternal,
  NOT_AN_ADDRESS,
  parseAddress,
  prefill,
  RECENT_CAP,
  RECENT_KEY,
  readRecent,
} from "./address";
import { AddressPopover, submitDraft } from "./ShowSwitch";
import { hintText, PORT_KEY } from "./show";

const ok = (input: string, url: string, display: string, isLocal: boolean) =>
  [input, { ok: true, url, display, isLocal }] as const;
const no = (input: string, message: string) =>
  [input, { ok: false, message }] as const;

describe("parseAddress", () => {
  const cases = [
    // Ports, at the bounds and out of range.
    ok("3000", "http://localhost:3000/", "localhost:3000", true),
    ok("1", "http://localhost:1/", "localhost:1", true),
    ok("65535", "http://localhost:65535/", "localhost:65535", true),
    no("0", BAD_PORT),
    no("65536", BAD_PORT),
    no("123456", BAD_PORT),
    no("03000", BAD_PORT),
    no("00", BAD_PORT),
    no("+3000", NOT_AN_ADDRESS),
    no("-1", NOT_AN_ADDRESS),
    // Whitespace and pasted newlines.
    ok("  5173  ", "http://localhost:5173/", "localhost:5173", true),
    ok(
      "\n\thttps://example.com/\n",
      "https://example.com/",
      "example.com",
      false,
    ),
    no("", EMPTY),
    no(" \n ", EMPTY),
    // Loopback names without a scheme get http.
    ok("localhost", "http://localhost/", "localhost", true),
    ok("localhost:3000", "http://localhost:3000/", "localhost:3000", true),
    ok(
      "LOCALHOST:8080/app?x=1#top",
      "http://localhost:8080/app?x=1#top",
      "localhost:8080/app",
      true,
    ),
    ok("127.0.0.1:4321", "http://127.0.0.1:4321/", "127.0.0.1:4321", true),
    ok("0.0.0.0:8000", "http://0.0.0.0:8000/", "0.0.0.0:8000", true),
    ok("[::1]:3000", "http://[::1]:3000/", "[::1]:3000", true),
    ok("http://[::1]/", "http://[::1]/", "[::1]", true),
    // Hostnames without a scheme get https.
    ok("example.com", "https://example.com/", "example.com", false),
    ok(
      "docs.example.com:8443/guide/start",
      "https://docs.example.com:8443/guide/start",
      "docs.example.com:8443/guide",
      false,
    ),
    ok(
      "example.com/a-very-long-first-segment-name/x",
      "https://example.com/a-very-long-first-segment-name/x",
      "example.com/a-very-long-first-se",
      false,
    ),
    ok("bücher.de", "https://xn--bcher-kva.de/", "xn--bcher-kva.de", false),
    ok("example.com.", "https://example.com./", "example.com.", false),
    ok(
      "192.168.1.20:3000",
      "https://192.168.1.20:3000/",
      "192.168.1.20:3000",
      false,
    ),
    // Explicit schemes: http and https only, any case.
    ok(
      "HTTPS://EXAMPLE.COM/Path",
      "https://example.com/Path",
      "example.com/Path",
      false,
    ),
    ok(
      "http://localhost:3000",
      "http://localhost:3000/",
      "localhost:3000",
      true,
    ),
    ok(
      "http://192.168.1.20:5173/",
      "http://192.168.1.20:5173/",
      "192.168.1.20:5173",
      false,
    ),
    ok(
      "https://[2001:db8::1]:8080/",
      "https://[2001:db8::1]:8080/",
      "[2001:db8::1]:8080",
      false,
    ),
    ok("https:////example.com", "https://example.com/", "example.com", false),
    no("javascript:alert(1)", BAD_SCHEME),
    no("JavaScript:void(0)", BAD_SCHEME),
    no("data:text/html,hi", BAD_SCHEME),
    no("file:///etc/hosts", BAD_SCHEME),
    no("about:blank", BAD_SCHEME),
    no("blob:https://example.com/1", BAD_SCHEME),
    no("ftp://example.com", BAD_SCHEME),
    no("ws://localhost:3000", BAD_SCHEME),
    // Credentials.
    no("https://user:pass@example.com", CREDENTIALS),
    no("user:pass@example.com", CREDENTIALS),
    no("https://user@example.com", CREDENTIALS),
    // Not addresses.
    no("hello", NOT_AN_ADDRESS),
    no("my server", NOT_AN_ADDRESS),
    no("exa mple.com", NOT_AN_ADDRESS),
    no("https://exa mple.com", NOT_AN_ADDRESS),
    no("myhost:3000", NOT_AN_ADDRESS),
    no("http://", NOT_AN_ADDRESS),
    no("localhost:99999", NOT_AN_ADDRESS),
    no(`https://example.com/${"a".repeat(2100)}`, NOT_AN_ADDRESS),
  ] as const;

  it(`has ${cases.length} cases`, () =>
    expect(cases.length).toBeGreaterThanOrEqual(40));
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input.slice(0, 50))}`, () =>
      expect(parseAddress(input)).toEqual(want));
  }

  it("mailto and other non-web addresses are refused", () => {
    expect(parseAddress("mailto:me@example.com").ok).toBe(false);
    expect(parseAddress("chrome://settings").ok).toBe(false);
  });
});

const store = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("recent addresses", () => {
  it("adds most recent first, without duplicates, capped at 5", () => {
    const s = store();
    expect(readRecent(s)).toEqual([]);
    for (const u of [
      "http://localhost:1/",
      "http://localhost:2/",
      "http://localhost:3/",
      "http://localhost:4/",
      "http://localhost:5/",
      "http://localhost:6/",
    ])
      addRecent(s, u);
    expect(readRecent(s)).toHaveLength(RECENT_CAP);
    expect(readRecent(s)[0]).toBe("http://localhost:6/");
    expect(readRecent(s)).not.toContain("http://localhost:1/");
    addRecent(s, "http://localhost:3/");
    expect(readRecent(s).slice(0, 2)).toEqual([
      "http://localhost:3/",
      "http://localhost:6/",
    ]);
    expect(new Set(readRecent(s)).size).toBe(readRecent(s).length);
  });

  it("stores only normalized URLs and ignores anything else", () => {
    const s = store();
    s.m.set(
      RECENT_KEY,
      JSON.stringify([
        "https://example.com/",
        "javascript:alert(1)",
        42,
        { u: 1 },
        "example.com",
        "https://example.com/",
      ]),
    );
    expect(readRecent(s)).toEqual(["https://example.com/"]);
    addRecent(s, "https://example.com/docs");
    expect(JSON.parse(s.m.get(RECENT_KEY) ?? "")).toEqual([
      "https://example.com/docs",
      "https://example.com/",
    ]);
    expect([...s.m.keys()]).toEqual([RECENT_KEY]);
  });

  it("clear, corrupt data and storage failures", () => {
    const s = store();
    addRecent(s, "https://example.com/");
    clearRecent(s);
    expect(readRecent(s)).toEqual([]);
    s.m.set(RECENT_KEY, "{not json");
    expect(readRecent(s)).toEqual([]);
    s.m.set(RECENT_KEY, '"just a string"');
    expect(readRecent(s)).toEqual([]);
    expect(readRecent(broken)).toEqual([]);
    expect(() => addRecent(broken, "https://example.com/")).not.toThrow();
    expect(() => clearRecent(broken)).not.toThrow();
    expect(readRecent(null)).toEqual([]);
  });

  it("prefill: the last address, else the old port, else localhost:3000", () => {
    const s = store();
    expect(prefill(s)).toBe("localhost:3000");
    s.m.set(PORT_KEY, "5173");
    expect(prefill(s)).toBe("localhost:5173");
    addRecent(s, "https://example.com/");
    expect(prefill(s)).toBe("https://example.com/");
    expect(s.m.get(PORT_KEY)).toBe("5173");
    expect(prefill(broken)).toBe("localhost:3000");
  });
});

describe("hints and the checklist by locality", () => {
  it("a localhost preview keeps the server hint; a website gets the embedding hint", () => {
    expect(hintFor("http://localhost:3000/")).toBe(hintText(3000));
    expect(hintFor(undefined)).toBe(hintText(null));
    expect(hintFor("https://example.com/")).toBe(EXTERNAL_HINT);
    expect(hintFor("http://192.168.1.20:5173/")).toBe(EXTERNAL_HINT);
    expect(isExternal("http://127.0.0.1:8000/")).toBe(false);
    expect(isExternal("about:blank")).toBe(false);
  });

  it("the website sentence is added only for an external preview", () => {
    expect(checklistFor(CHECKLIST_TEXT, "preview", true)).toBe(
      `${CHECKLIST_TEXT} ${PREVIEW_CHECKLIST} ${EXTERNAL_CHECKLIST} ${AUTOZOOM_CHECKLIST}`,
    );
    expect(checklistFor(CHECKLIST_TEXT, "preview", false)).not.toContain(
      EXTERNAL_CHECKLIST,
    );
    expect(checklistFor(CHECKLIST_TEXT, "terminal", true)).not.toContain(
      EXTERNAL_CHECKLIST,
    );
  });
});

describe("the Address popover", () => {
  let mem: ReturnType<typeof store>;
  beforeEach(() => {
    mem = store();
    vi.stubGlobal("window", { localStorage: mem });
  });
  afterEach(() => vi.unstubAllGlobals());
  const render = () =>
    renderToString(
      createElement(
        TooltipProvider,
        null,
        createElement(AddressPopover, {
          onSubmit: () => {},
          onCancel: () => {},
        }),
      ),
    );

  it("has a labeled URL input, the helper, the chips and no recent list at first", () => {
    const html = render();
    expect(html).toContain('for="rk-stage-address"');
    expect(html).toContain('inputMode="url"');
    expect(html).toContain('autoCapitalize="off"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("A port opens localhost. Or paste a full address.");
    expect(html).toContain('value="localhost:3000"');
    for (const p of ["3000", "5173", "8080", "4321", "8000"])
      expect(html).toContain(`>${p}<`);
    expect(html).not.toContain("Recent");
    expect(html).not.toContain('role="alert"');
  });

  it("lists recent addresses with their full URL as the title, and Clear", () => {
    addRecent(mem, "https://example.com/docs");
    const html = render();
    expect(html).toContain("Recent");
    expect(html).toContain('title="https://example.com/docs"');
    expect(html).toContain(">example.com/docs<");
    expect(html).toContain("Clear");
    expect(html).toContain('value="https://example.com/docs"');
  });

  it("Enter and Show it submit a good address; a bad one gives the error and does not submit", () => {
    const onSubmit = vi.fn();
    expect(submitDraft(" localhost:5173 ", onSubmit)).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith({
      ok: true,
      url: "http://localhost:5173/",
      display: "localhost:5173",
      isLocal: true,
    });
    expect(submitDraft("ftp://x.com", onSubmit)).toBe(BAD_SCHEME);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a chip fills the box with localhost:PORT and does not submit", () => {
    expect(chipText(8080)).toBe("localhost:8080");
  });
});

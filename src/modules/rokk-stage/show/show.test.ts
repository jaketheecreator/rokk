import { TooltipProvider } from "@/components/ui/tooltip";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOZOOM_CHECKLIST, CHECKLIST_TEXT, checklistFor, PREVIEW_CHECKLIST } from "../record/record";
import { createHint, HINT_MS, hintText, parsePort, pick, PORT_KEY, portOf, readPort, restoreOnExit, showOf, touch } from "./show";
import { type ShowApi, ShowSwitch } from "./ShowSwitch";

const T = (id: number, kind: string, url?: string) => ({ id, kind, url });

describe("port input", () => {
  it("accepts 1 to 65535 only", () => {
    expect(parsePort("")).toBeNull();
    expect(parsePort("abc")).toBeNull();
    expect(parsePort("30a0")).toBeNull();
    expect(parsePort("0")).toBeNull();
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("-80")).toBeNull();
    expect(parsePort("3000.5")).toBeNull();
  });

  it("treats leading zeros and whitespace plainly", () => {
    expect(parsePort("03000")).toBe(3000);
    expect(parsePort("000080")).toBeNull();
    expect(parsePort("  5173 ")).toBe(5173);
    expect(parsePort("51 73")).toBeNull();
  });
});

describe("remembered port", () => {
  it("reads the old rokk.stage.port (it is only read now, for the prefill)", () => {
    const m = new Map<string, string>();
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(readPort(store)).toBeNull();
    m.set(PORT_KEY, "5173");
    expect(readPort(store)).toBe(5173);
    m.set(PORT_KEY, "nonsense");
    expect(readPort(store)).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPort(broken)).toBeNull();
    expect(readPort(null)).toBeNull();
  });
});

describe("switch state from the tab store", () => {
  const tabs = [T(1, "terminal"), T(2, "preview", "http://localhost:3000"), T(3, "editor"), T(4, "terminal")];

  it("follows the real active tab", () => {
    expect(showOf(tabs, 1)).toBe("terminal");
    expect(showOf(tabs, 2)).toBe("preview");
    expect(showOf(tabs, 3)).toBe("other");
    expect(showOf(tabs, 99)).toBe("other");
  });

  it("picks the most recent tab of a kind, else the last one", () => {
    expect(pick(tabs, [4, 2, 1], "terminal")).toBe(4);
    expect(pick(tabs, [1, 4], "terminal")).toBe(1);
    expect(pick(tabs, [], "terminal")).toBe(4);
    expect(pick(tabs, [], "preview")).toBe(2);
    expect(pick([T(1, "terminal")], [1], "preview")).toBeNull();
    expect(touch([1, 2, 3], 2)).toEqual([2, 1, 3]);
  });

  it("reads the port of a preview", () => {
    expect(portOf("http://localhost:5173/app")).toBe(5173);
    expect(portOf("http://127.0.0.1:8000")).toBe(8000);
    expect(portOf("https://example.com")).toBeNull();
    expect(portOf(undefined)).toBeNull();
  });
});

describe("restore on exit", () => {
  const exists = (id: number) => id !== 9;

  it("goes back only when the switch made the last choice", () => {
    expect(restoreOnExit({ entryId: 1, activeId: 2, lastSwitchId: 2, exists })).toBe(1);
    // Never used the switch.
    expect(restoreOnExit({ entryId: 1, activeId: 2, lastSwitchId: null, exists })).toBeNull();
    // Chose another tab some other way after the switch.
    expect(restoreOnExit({ entryId: 1, activeId: 3, lastSwitchId: 2, exists })).toBeNull();
    // Already back on the entry tab, or the entry tab was closed.
    expect(restoreOnExit({ entryId: 1, activeId: 1, lastSwitchId: 1, exists })).toBeNull();
    expect(restoreOnExit({ entryId: 9, activeId: 2, lastSwitchId: 2, exists })).toBeNull();
  });
});

describe("blank preview hint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows for 8 seconds and restarts on demand", () => {
    const set = vi.fn();
    const h = createHint(set);
    h.show();
    expect(set).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(set).toHaveBeenCalledTimes(1);
    h.show();
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(set).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1);
    expect(set).toHaveBeenLastCalledWith(false);
    h.show();
    h.hide();
    expect(set).toHaveBeenLastCalledWith(false);
    h.dispose();
  });

  it("names the port", () => {
    expect(hintText(5173)).toBe("If the preview is blank, check that your server is running on localhost:5173. Some servers block embedding in other apps.");
    expect(hintText(null)).not.toContain("—");
  });
});

describe("checklist", () => {
  it("adds the preview sentence only for the preview", () => {
    expect(checklistFor(CHECKLIST_TEXT, "terminal")).toBe(`${CHECKLIST_TEXT} ${AUTOZOOM_CHECKLIST}`);
    expect(checklistFor(CHECKLIST_TEXT, "other")).toBe(`${CHECKLIST_TEXT} ${AUTOZOOM_CHECKLIST}`);
    expect(checklistFor(CHECKLIST_TEXT, "preview")).toBe(`${CHECKLIST_TEXT} ${PREVIEW_CHECKLIST} ${AUTOZOOM_CHECKLIST}`);
  });
});

describe("Show switch rendering", () => {
  const api = (tabs: ReturnType<typeof T>[], activeId: number): ShowApi => ({
    tabs,
    activeId,
    mru: [activeId],
    activate: vi.fn(),
    openPreview: vi.fn(() => 7),
    reload: vi.fn(),
  });
  const render = (a: ShowApi, open = false) =>
    renderToString(
      createElement(
        TooltipProvider,
        null,
        createElement(ShowSwitch, {
          api: a,
          show: showOf(a.tabs, a.activeId),
          onHover: () => {},
          open,
          setOpen: () => {},
        }),
      ),
    );

  it("first use without a preview tab asks for the port", () => {
    const a = api([T(1, "terminal")], 1);
    expect(pick(a.tabs, a.mru, "preview")).toBeNull();
    const html = render(a, true);
    expect(html).toContain(">Address<");
    expect(html).toContain('placeholder="3000 or https://yoursite.com"');
    expect(html).toContain("Show it");
    for (const p of ["3000", "5173", "8080", "4321", "8000"]) expect(html).toContain(`>${p}<`);
  });

  it("with an existing preview tab it activates that tab", () => {
    const a = api([T(1, "terminal"), T(2, "preview", "http://localhost:3000")], 1);
    expect(pick(a.tabs, a.mru, "preview")).toBe(2);
  });

  it("stays on Terminal until a preview is chosen, with no preview tools", () => {
    const html = render(api([T(1, "terminal")], 1));
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)?<span class="rk-seg-label">Terminal/);
    expect(html).not.toContain("Change address");
    expect(html).not.toContain("Reload preview");
    expect(html).not.toContain("Blank?");
  });

  it("shows Change address, Reload and Blank? only in Preview", () => {
    const html = render(api([T(1, "terminal"), T(2, "preview", "http://localhost:3000")], 2));
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)?<span class="rk-seg-label">Preview/);
    expect(html).toContain('aria-label="Change address"');
    expect(html).toContain('aria-label="Reload preview"');
    expect(html).toContain("Blank?");
  });
});

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StageToggle } from "../StageToggle";
import {
  CONTROLS_HIDE_MS,
  createAutoHide,
  DEFAULT_WALLPAPER,
  exitStage,
  focusTarget,
  frameSize,
  getStage,
  readWallpaper,
  STAGE_TOGGLE_ID,
  shortcutText,
  shouldExit,
  takeFirstEntryWarning,
  toggleStage,
  WALLPAPERS,
  wallpaperById,
  writeWallpaper,
} from "./stage";

describe("wallpapers", () => {
  it("has the six ids, with dark text only on silk", () => {
    expect(WALLPAPERS.map((w) => w.id)).toEqual(["horizon", "embers", "silk", "lagoon", "dusk", "mist"]);
    expect(WALLPAPERS.filter((w) => w.ink === "dark").map((w) => w.id)).toEqual(["silk"]);
    expect(WALLPAPERS.every((w) => /^#[0-9a-f]{6}$/.test(w.fallback))).toBe(true);
    expect(wallpaperById("nope").id).toBe(DEFAULT_WALLPAPER);
  });

  it("reads and writes the wallpaper id, surviving storage failures", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readWallpaper(storage)).toBe(DEFAULT_WALLPAPER);
    writeWallpaper("lagoon", storage);
    expect(store.get("rokk.stage.wallpaper")).toBe("lagoon");
    expect(readWallpaper(storage)).toBe("lagoon");
    store.set("rokk.stage.wallpaper", "bogus");
    expect(readWallpaper(storage)).toBe(DEFAULT_WALLPAPER);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readWallpaper(broken)).toBe(DEFAULT_WALLPAPER);
    expect(() => writeWallpaper("dusk", broken)).not.toThrow();
    expect(readWallpaper(null)).toBe(DEFAULT_WALLPAPER);
  });
});

describe("frame size", () => {
  it("clamps to 1000 by 620 and shrinks with small windows", () => {
    expect(frameSize(1280, 800)).toEqual({ width: 1000, height: 620 });
    expect(frameSize(1440, 900)).toEqual({ width: 1000, height: 620 });
    expect(frameSize(1920, 1080)).toEqual({ width: 1000, height: 620 });
    expect(frameSize(1100, 700)).toEqual({ width: 902, height: 540 });
    expect(frameSize(420, 280)).toEqual({ width: 344.4, height: 120 });
    expect(frameSize(100, 100)).toEqual({ width: 82, height: 0 });
  });
});

describe("exit rules", () => {
  it("leaves when the last terminal tab closes or zen mode flips", () => {
    expect(shouldExit({ terminals: 1, zen: false }, { terminals: 0, zen: false })).toBe(true);
    expect(shouldExit({ terminals: 2, zen: false }, { terminals: 1, zen: false })).toBe(false);
    expect(shouldExit({ terminals: 0, zen: false }, { terminals: 0, zen: false })).toBe(false);
    expect(shouldExit({ terminals: 1, zen: false }, { terminals: 1, zen: true })).toBe(true);
    expect(shouldExit({ terminals: 1, zen: true }, { terminals: 1, zen: false })).toBe(true);
  });
});

describe("shortcut text", () => {
  it("uses the platform's words", () => {
    expect(shortcutText({ meta: true, alt: true, key: "s" }, true)).toBe("Cmd+Option+S");
    expect(shortcutText({ ctrl: true, alt: true, key: "s" }, false)).toBe("Ctrl+Alt+S");
    expect(shortcutText(undefined, true)).toBe("");
  });
});

describe("auto-hide", () => {
  afterEach(() => vi.useRealTimers());

  it("hides after 2.5 s without movement and shows again on movement", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const h = createAutoHide((v) => seen.push(v));
    vi.advanceTimersByTime(CONTROLS_HIDE_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([false]);
    h.move();
    expect(seen).toEqual([false, true]);
    vi.advanceTimersByTime(1000);
    h.move();
    vi.advanceTimersByTime(CONTROLS_HIDE_MS - 1);
    expect(seen).toEqual([false, true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([false, true, false]);
    h.dispose();
  });

  it("stays visible while focus or the pointer is on the controls", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const h = createAutoHide((v) => seen.push(v));
    h.focusIn();
    vi.advanceTimersByTime(CONTROLS_HIDE_MS * 4);
    expect(seen).toEqual([]);
    h.focusOut();
    h.hoverIn();
    vi.advanceTimersByTime(CONTROLS_HIDE_MS * 4);
    expect(seen).toEqual([]);
    h.hoverOut();
    vi.advanceTimersByTime(CONTROLS_HIDE_MS);
    expect(seen).toEqual([false]);
    h.focusIn();
    expect(seen).toEqual([false, true]);
    h.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns transitions off for reduced motion in CSS, not in timing", async () => {
    const css = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../stage.css", import.meta.url), "utf8"),
    );
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.rk-stage-controls\s*\{\s*transition: none;/);
  });
});

describe("entering and leaving", () => {
  let attrs: Map<string, string>;
  let focused: string[];
  let button: { isConnected: boolean; focus: () => void };
  let terminal: { isConnected: boolean; focus: () => void };
  let active: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    attrs = new Map();
    focused = [];
    button = { isConnected: true, focus: () => focused.push("button") };
    terminal = { isConnected: true, focus: () => focused.push("terminal") };
    active = terminal;
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      get activeElement() {
        return active;
      },
      getElementById: (id: string) => (id === STAGE_TOGGLE_ID ? button : null),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  afterEach(() => {
    exitStage();
    vi.runAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sets and removes the root attribute and announces it", () => {
    expect(getStage().on).toBe(false);
    toggleStage("keyboard");
    expect(attrs.get("data-rokk-stage")).toBe("on");
    expect(getStage()).toMatchObject({ on: true, enteredBy: "keyboard", announcement: "Stage mode on" });
    toggleStage("keyboard");
    expect(attrs.has("data-rokk-stage")).toBe(false);
    expect(getStage()).toMatchObject({ on: false, enteredBy: null, announcement: "Stage mode off" });
  });

  it("returns focus to the terminal after a keyboard entry", () => {
    toggleStage("keyboard");
    active = null;
    toggleStage("keyboard");
    vi.runAllTimers();
    expect(focused).toEqual(["terminal"]);
  });

  it("returns focus to the button after a mouse entry", () => {
    toggleStage("mouse");
    toggleStage("keyboard");
    vi.runAllTimers();
    expect(focused).toEqual(["button"]);
  });

  it("nudges a window resize once after each change", () => {
    toggleStage("mouse");
    vi.advanceTimersByTime(60);
    toggleStage("mouse");
    vi.advanceTimersByTime(60);
    expect((window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe("focus target", () => {
  it("skips an element that left the page", () => {
    expect(focusTarget("keyboard", { isConnected: false } as unknown as HTMLElement)).toBeNull();
    expect(focusTarget(null, null)).toBeNull();
  });
});

describe("safety toast", () => {
  it("is shown only once per app session", () => {
    const first = takeFirstEntryWarning();
    expect(takeFirstEntryWarning()).toBe(false);
    expect(takeFirstEntryWarning()).toBe(false);
    expect(typeof first).toBe("boolean");
  });
});

describe("the button", () => {
  it("is a labelled toggle with aria-pressed off at rest", () => {
    const html = renderToString(createElement(TooltipProvider, null, createElement(StageToggle)));
    expect(html).toContain('aria-label="Stage mode"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(`id="${STAGE_TOGGLE_ID}"`);
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it("uses the same toggle as the shortcut", async () => {
    const fs = await import("node:fs");
    const app = fs.readFileSync(new URL("../../../app/App.tsx", import.meta.url), "utf8");
    const button = fs.readFileSync(new URL("../StageToggle.tsx", import.meta.url), "utf8");
    expect(app).toContain('"stage.toggle": () => toggleStage("keyboard")');
    expect(button).toContain('onClick={() => toggleStage("mouse")}');
    expect(button.match(/toggleStage\(/g)).toHaveLength(1);
  });
});

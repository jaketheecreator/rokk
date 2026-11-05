import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampShift, gridMove, popover } from "./controls";
import { createAutoHide } from "./lib/stage";
import { WallpaperPicker } from "./WallpaperPicker";

describe("one popover at a time", () => {
  it("opens one, switching closes the other", () => {
    expect(popover(null, { type: "open", id: "port" })).toBe("port");
    expect(popover("port", { type: "open", id: "wallpaper" })).toBe("wallpaper");
    expect(popover("wallpaper", { type: "toggle", id: "wallpaper" })).toBeNull();
    expect(popover(null, { type: "toggle", id: "wallpaper" })).toBe("wallpaper");
  });

  it("Escape and an outside click close it", () => {
    expect(popover("port", { type: "escape" })).toBeNull();
    expect(popover("wallpaper", { type: "outside" })).toBeNull();
    expect(popover("wallpaper", { type: "close" })).toBeNull();
  });

  it("holding the controls stops the auto-hide; letting go restarts it", () => {
    let visible = true;
    const h = createAutoHide((v) => {
      visible = v;
    }, 10);
    h.hoverIn();
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(visible).toBe(true);
        h.hoverOut();
        setTimeout(() => {
          expect(visible).toBe(false);
          h.dispose();
          done();
        }, 30);
      }, 30),
    );
  });
});

describe("wallpaper grid keys", () => {
  it("moves in a 3 by 2 grid and wraps", () => {
    expect(gridMove(0, "ArrowRight", 6, 3)).toBe(1);
    expect(gridMove(2, "ArrowRight", 6, 3)).toBe(3);
    expect(gridMove(5, "ArrowRight", 6, 3)).toBe(0);
    expect(gridMove(0, "ArrowLeft", 6, 3)).toBe(5);
    expect(gridMove(1, "ArrowDown", 6, 3)).toBe(4);
    expect(gridMove(4, "ArrowDown", 6, 3)).toBe(1);
    expect(gridMove(1, "ArrowUp", 6, 3)).toBe(4);
    expect(gridMove(3, "Home", 6, 3)).toBe(0);
    expect(gridMove(0, "End", 6, 3)).toBe(5);
    expect(gridMove(0, "Enter", 6, 3)).toBeNull();
  });
});

describe("popover placement", () => {
  it("stays 16px inside the window", () => {
    expect(clampShift(100, 400, 1280)).toBe(0);
    expect(clampShift(-20, 280, 1280)).toBe(36);
    expect(clampShift(1100, 1300, 1280)).toBe(-36);
  });
});

describe("wallpaper picker", () => {
  it("is one button with the current wallpaper", () => {
    const html = renderToString(createElement(WallpaperPicker, { current: "silk", open: false, setOpen: () => {} }));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Wallpaper: Silk"');
    expect(html).not.toContain('role="radiogroup"');
  });

  it("opens a radio grid with the current one checked", () => {
    const html = renderToString(createElement(WallpaperPicker, { current: "silk", open: true, setOpen: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(6);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Silk/);
    expect(html).toContain('aria-expanded="true"');
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PREPAINT_BG } from "@/modules/theme/vibrancy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "settings.html"), "utf8");
const css = readFileSync(join(root, "src/styles/rokk-surfaces.css"), "utf8");
const rust = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");

function rkWindow(selector: string): string {
  const block = css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
  return /--rk-window:\s*(#[0-9a-f]{6})/i.exec(block)?.[1].toLowerCase() ?? "";
}

const graphite = {
  dark: rkWindow('html.dark[data-rk-surface="graphite"]'),
  light: rkWindow('html[data-rk-surface="graphite"]'),
};

describe("Settings pre-paint", () => {
  it("reads the Graphite window colors from the tokens", () => {
    expect(graphite).toEqual({ dark: "#0f0f0e", light: "#e7e4dd" });
  });

  it("paints Graphite's window color, and the bridge colors for other themes", () => {
    const m = html.match(
      /graphite\s*\?\s*resolved === "dark" \? "(#\w{6})" : "(#\w{6})"\s*:\s*resolved === "dark" \? "(#\w{6})" : "(#\w{6})"/,
    );
    expect(m?.slice(1)).toEqual([graphite.dark, graphite.light, PREPAINT_BG.dark, PREPAINT_BG.light]);
  });

  it("matches the native window color Rust sets at creation", () => {
    const hex = (r: string, g: string, b: string) => `#${[r, g, b].map((c) => c.slice(2)).join("")}`;
    const m = rust.match(
      /fn settings_background[\s\S]*?\((0x\w\w), (0x\w\w), (0x\w\w)\)[\s\S]*?\((0x\w\w), (0x\w\w), (0x\w\w)\)/,
    );
    expect(m).not.toBeNull();
    const [, r1, g1, b1, r2, g2, b2] = m as RegExpMatchArray;
    expect(hex(r1, g1, b1)).toBe(graphite.dark);
    expect(hex(r2, g2, b2)).toBe(graphite.light);
  });
});

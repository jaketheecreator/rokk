import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "./platforms";
import panelSource from "./SharePanel.tsx?raw";
import { PostButton, TICK_FIRST } from "./SharePanel";

const render = (id: PlatformId, confirmed: boolean, opened = false) =>
  renderToString(
    createElement(PostButton, { id, confirmed, opened, onPost: () => {} }),
  );

describe("the main Post now button", () => {
  it("has a label per platform", () => {
    expect(PLATFORMS.x.compose.label).toBe("Post now");
    expect(PLATFORMS.linkedin.compose.label).toBe("Post now");
    expect(PLATFORMS.youtube.compose.label).toBe("Upload now");
    expect(render("youtube", true)).toContain("Upload now");
  });

  it("is always shown: dimmed, aria-disabled and explained until the tick", () => {
    for (const id of PLATFORM_IDS) {
      const html = render(id, false);
      expect(html).toMatch(/<button[^>]*class="rk-share-main"/);
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toMatch(/<button[^>]*\sdisabled/);
      expect(html).toContain(TICK_FIRST);
    }
    const on = render("x", true);
    expect(on).toContain('aria-disabled="false"');
    expect(on).not.toContain(TICK_FIRST);
  });

  it("shows the platform's helper line, then the confirmation", () => {
    expect(render("x", true)).toContain(
      "Opens X with your caption. You press Post there.",
    );
    expect(render("linkedin", true)).toContain(
      "Copies your caption and opens LinkedIn. You press Post there.",
    );
    expect(render("youtube", true)).toContain(
      "Opens YouTube Studio. Choose Create, then Upload videos.",
    );
    const done = render("x", true, true);
    expect(done).toContain("X opened in your browser.");
    expect(done).toContain("data-done");
    expect(done).not.toContain("You press Post there.");
    expect(render("linkedin", true, true)).toContain(
      "LinkedIn opened in your browser.",
    );
  });

  it("is the only filled button in the panel", () => {
    expect(panelSource.match(/rk-share-main/g)).toHaveLength(1);
    expect(panelSource).not.toContain("rk-share-primary");
    // Only the main button has a background fill rule of its own.
    const css = readFileSync(new URL("./share.css", import.meta.url), "utf8");
    const filled = css.match(/background:\s*var\(--primary\)/g) ?? [];
    expect(filled).toHaveLength(1);
  });
});

describe("the four hand-off actions", () => {
  const css = readFileSync(new URL("./share.css", import.meta.url), "utf8");
  const row = panelSource.slice(
    panelSource.indexOf('className="rk-share-four"'),
    panelSource.indexOf("{over ? ("),
  );

  it("sit in one row in the stated order", () => {
    const at = [
      "Copy caption",
      "Copy file",
      "Drag the video",
      "Show in Finder",
    ].map((l) => row.indexOf(l));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(row.match(/<Btn\b/g)).toHaveLength(4);
    expect(css).toMatch(
      /\.rk-share-four \{[^}]*grid-template-columns: repeat\(4, 1fr\)/,
    );
  });

  it("Copy file and Drag wait for the secrets box; the others do not", () => {
    expect(row.match(/aria-disabled=\{!confirmed\}/g)).toHaveLength(2);
    const file = row.slice(
      row.indexOf("Copy caption"),
      row.indexOf("Copy file"),
    );
    expect(file).toContain("aria-disabled={!confirmed}");
    const drag = row.slice(
      row.indexOf("Copy file"),
      row.indexOf("Drag the video"),
    );
    expect(drag).toContain("aria-disabled={!confirmed}");
    expect(row.slice(row.indexOf("Drag the video"))).not.toContain(
      "aria-disabled",
    );
    expect(css).toMatch(
      /\.rk-share-btn\[aria-disabled="true"\] \{\s*opacity: 0\.5/,
    );
  });

  it("falls back to 2 by 2 on a narrow panel (container query)", () => {
    expect(css).toMatch(/\.rk-share-right \{\s*container-type: inline-size/);
    expect(css).toMatch(
      /@container \(max-width: \d+px\) \{\s*\.rk-share-four \{\s*grid-template-columns: repeat\(2, 1fr\)/,
    );
    expect(css).not.toMatch(/@media[^{]*\{\s*\.rk-share-four/);
  });

  it("no action appears twice", () => {
    // Button labels (the drag help text mentions Copy file in words).
    for (const label of ['"Copy caption"', '"Copy file"', "Drag the video\n"])
      expect(panelSource.split(label).length - 1, label).toBe(1);
    // Show in Finder for the shared video exists once; the other one is the
    // result row of a saved GIF or poster (another file).
    expect(panelSource.split("revealItemInDir(file)").length - 1).toBe(1);
    expect(row.split("Show in Finder").length - 1).toBe(1);
  });

  it("copy feedback keeps the width: equal columns, no wrapping or ellipsis", () => {
    expect(row).toContain('copied === "caption" ? "Copied" : "Copy caption"');
    expect(row).toContain('copied === "file" ? "Copied" : "Copy file"');
    expect(css).toMatch(/\.rk-share-btn \{[^}]*white-space: nowrap/);
    expect(css).not.toContain("text-overflow");
  });
});

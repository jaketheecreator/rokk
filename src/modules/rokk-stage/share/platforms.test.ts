import { describe, expect, it } from "vitest";
import {
  CHECKED_ON,
  captionLength,
  checksFor,
  composeUrl,
  findLinks,
  formatBytes,
  type Meta,
  PLATFORM_IDS,
  PLATFORMS,
  RECOMMENDED,
  SOURCES,
  UNVERIFIED,
  xLength,
} from "./platforms";

const recording: Meta = {
  durationMs: 42_000,
  width: 2554,
  height: 1616,
  bytes: 30_000_000,
  codec: "H.264",
  name: "Rokk-2026-11-21-101500.mp4",
};

const byKey = (id: keyof typeof PLATFORMS, m: Meta) =>
  Object.fromEntries(checksFor(PLATFORMS[id], m).map((c) => [c.key, c]));

describe("platform data", () => {
  it("every platform names its official sources and the check date", () => {
    for (const id of PLATFORM_IDS) {
      const p = PLATFORMS[id];
      expect(p.checkedOn).toBe(CHECKED_ON);
      expect(SOURCES[id].length).toBeGreaterThan(0);
      for (const s of SOURCES[id])
        expect(s.url).toMatch(
          /^https:\/\/(docs\.x\.com|www\.linkedin\.com\/help|support\.google\.com|developers\.google\.com)\//,
        );
    }
  });

  it("holds the verified numbers", () => {
    expect(PLATFORMS.x.video.maxSeconds).toBe(1200);
    expect(PLATFORMS.x.video.maxBytes).toBe(8e9);
    expect(PLATFORMS.x.caption.limit).toBe(280);
    expect(PLATFORMS.linkedin.video.maxSeconds).toBe(900);
    expect(PLATFORMS.linkedin.video.maxBytes).toBe(5e9);
    expect(PLATFORMS.linkedin.caption.limit).toBe(3000);
    expect(PLATFORMS.youtube.video.maxSeconds).toBe(900);
    expect(PLATFORMS.youtube.caption.limit).toBe(5000);
    expect(PLATFORMS.youtube.title?.limit).toBe(100);
    // YouTube's shape range could not be verified.
    expect(PLATFORMS.youtube.video.aspect).toBeNull();
  });
});

describe("checks", () => {
  it("a normal recording is fine on length, size and format everywhere", () => {
    for (const id of PLATFORM_IDS) {
      const c = byKey(id, recording);
      expect(c.length.ok).toBe(true);
      expect(c.size.ok).toBe(true);
      expect(c.format.ok).toBe(true);
    }
    const x = byKey("x", recording);
    expect(x.length.text).toBe(
      "Length 0:42, within 20 minutes for standard accounts.",
    );
    expect(x.size.text).toBe("File 30 MB, within 8 GB for standard accounts.");
    expect(byKey("linkedin", recording).length.text).toBe(
      "Length 0:42, within 15 minutes.",
    );
  });

  it("warns, never blocks, when a limit is passed", () => {
    const long = byKey("linkedin", { ...recording, durationMs: 16 * 60_000 });
    expect(long.length).toMatchObject({ ok: false });
    expect(long.length.text).toBe("Length 16:00 is over 15 minutes.");
    const short = byKey("linkedin", { ...recording, durationMs: 2000 });
    expect(short.length.text).toBe(
      "Length 0:02 is under 3 seconds, the least LinkedIn takes.",
    );
    const big = byKey("x", { ...recording, bytes: 9e9 });
    expect(big.size).toMatchObject({ ok: false });
    expect(big.size.text).toContain("Make a smaller copy");
    const tall = byKey("x", { ...recording, width: 300, height: 1200 });
    expect(tall.shape.ok).toBe(false);
    expect(tall.shape.text).toContain("outside 1:3 to 3:1");
    const hevc = byKey("youtube", { ...recording, codec: "HEVC" });
    expect(hevc.format.ok).toBe(false);
  });

  it("recommendations and ranges", () => {
    // X's 1280 by 720 is a recommendation, kept in RECOMMENDED, not a check.
    expect(byKey("x", recording).resolution).toBeUndefined();
    expect(RECOMMENDED.x).toContain("1280 by 720");
    expect(byKey("linkedin", recording).resolution.ok).toBe(true);
    expect(
      byKey("linkedin", { ...recording, width: 5000, height: 2000 }).resolution
        .ok,
    ).toBe(false);
  });

  it("an unverified limit shows no number, only the generic line", () => {
    const shape = byKey("youtube", recording).shape;
    expect(shape.ok).toBe(false);
    expect(shape.text).toBe(`Shape 2554 by 1616. ${UNVERIFIED}`);
    expect(shape.text).not.toMatch(/\d+:\d+|to \d/);
    expect(byKey("youtube", recording).resolution).toBeUndefined();
  });

  it("formats sizes in decimal units", () => {
    expect(formatBytes(8e9)).toBe("8 GB");
    expect(formatBytes(256e9)).toBe("256 GB");
    expect(formatBytes(75_000)).toBe("75 KB");
    expect(formatBytes(3_680_000)).toBe("3.7 MB");
  });
});

describe("X character counting", () => {
  it("counts plain text, links as 23, emoji and CJK as 2", () => {
    expect(xLength("Hello, world!")).toBe(13);
    expect(xLength("Hello, world! \u{1F44B}")).toBe(16);
    expect(xLength("https://example.com/very/long/path")).toBe(23);
    expect(xLength("See https://a.io and www.example.com/x.")).toBe(
      4 + 23 + 5 + 23 + 1,
    );
    // A bare domain counts as text here (twitter-text would count 23).
    expect(xLength("Docs at github.com/rokk")).toBe(23);
    expect(xLength("\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}")).toBe(2);
    expect(xLength("\u{1F64B}\u{1F3FD}")).toBe(2);
    expect(xLength("日本")).toBe(4);
    // NFC: e plus a combining accent counts once.
    expect(xLength("café")).toBe(4);
  });

  it("finds links without trailing punctuation", () => {
    expect(findLinks("Try https://rokk.dev/demo).")).toEqual([
      "https://rokk.dev/demo",
    ]);
  });

  it("each platform uses its own rule", () => {
    const link = "https://example.com/a/very/long/path/that/is/long";
    expect(captionLength("x", link)).toBe(23);
    expect(captionLength("linkedin", link)).toBe(link.length);
    expect(captionLength("youtube", "é\u{1F600}")).toBe(6);
  });
});

describe("compose links", () => {
  it("X takes the caption, encoded", () => {
    const caption = 'New demo \u{1F680}\nTom & Jerry say "hi" #rokk 50% off?';
    const url = composeUrl("x", caption);
    expect(url.startsWith("https://x.com/intent/tweet?text=")).toBe(true);
    const encoded = url.slice("https://x.com/intent/tweet?text=".length);
    expect(encoded).not.toMatch(/[\s&"#?\n]/);
    expect(encoded).toContain("%0A");
    expect(encoded).toContain("%26");
    expect(encoded).toContain("%22");
    expect(encoded).toContain("%F0%9F%9A%80");
    expect(new URL(url).searchParams.get("text")).toBe(caption);
  });

  it("LinkedIn and YouTube open their own pages without the caption", () => {
    expect(composeUrl("linkedin", "secret caption")).toBe(
      "https://www.linkedin.com/",
    );
    expect(composeUrl("youtube", "x")).toBe("https://studio.youtube.com/");
    expect(PLATFORMS.linkedin.compose.prefill).toBe(false);
    expect(PLATFORMS.youtube.compose.prefill).toBe(false);
    expect(PLATFORMS.x.compose.prefill).toBe(true);
  });
});

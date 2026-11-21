import { describe, expect, it } from "vitest";
import {
  allowed,
  type Browser,
  choice,
  NOT_FOUND,
  type Profile,
  applyLink,
  CREDIT,
  checkLink,
  clampRange,
  estimateBytes,
  fillTemplate,
  IDLE,
  type JobView,
  LINK,
  readRemembered,
  reduceJob,
  type ShareEvent,
  setCredit,
  smallerRate,
  WHAT,
  SHARE_KEY,
  writeRemembered,
} from "./share";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
}

describe("caption templates", () => {
  it("fills the link and adds the credit line", () => {
    const s = { link: "https://rokk.dev/", credit: true };
    expect(fillTemplate("x", s)).toBe(
      `${WHAT}\n\nhttps://rokk.dev/\n\n${CREDIT}`,
    );
    expect(fillTemplate("youtubeTitle", s)).toBe(WHAT);
  });

  it("drops an empty link and the credit when switched off", () => {
    const s = { link: "", credit: false };
    expect(fillTemplate("x", s)).toBe(WHAT);
    expect(fillTemplate("linkedin", s)).toBe(`${WHAT}\n\nA short demo.`);
    expect(fillTemplate("youtube", { link: "", credit: true })).toBe(
      `${WHAT}\n\n${CREDIT}`,
    );
  });

  it("the credit switch edits the caption once, either way", () => {
    const text = "My clip";
    const on = setCredit(text, true);
    expect(on).toBe(`My clip\n\n${CREDIT}`);
    expect(setCredit(on, true)).toBe(on);
    expect(setCredit(on, false)).toBe("My clip");
    expect(setCredit("", true)).toBe(CREDIT);
  });

  it("a new link fills only a placeholder still there", () => {
    expect(applyLink(`See ${LINK}`, "https://a.dev/")).toBe(
      "See https://a.dev/",
    );
    expect(applyLink("Edited by hand", "https://a.dev/")).toBe(
      "Edited by hand",
    );
  });

  it("validates the link field", () => {
    expect(checkLink("")).toEqual({ ok: true, link: "" });
    expect(checkLink(" https://rokk.dev ")).toEqual({
      ok: true,
      link: "https://rokk.dev/",
    });
    for (const bad of [
      "http://rokk.dev",
      "rokk.dev",
      "javascript:alert(1)",
      "https://user:pw@rokk.dev",
      "https://localhost",
    ])
      expect(checkLink(bad).ok).toBe(false);
  });
});

describe("remembered settings", () => {
  it("keeps the last tab, each caption and the share settings", () => {
    const store = memory();
    const first = readRemembered(store);
    expect(first.tab).toBe("x");
    expect(first.link).toBe("");
    expect(first.credit).toBe(true);
    expect(first.captions.x).toBe(fillTemplate("x", first));

    writeRemembered(store, {
      ...first,
      tab: "youtube",
      link: "https://a.dev/",
      credit: false,
      captions: { ...first.captions, linkedin: "Mine" },
    });
    const back = readRemembered(store);
    expect(back.tab).toBe("youtube");
    expect(back.link).toBe("https://a.dev/");
    expect(back.credit).toBe(false);
    expect(back.captions.linkedin).toBe("Mine");
    // Only these four things, in one entry.
    expect([...store.m.keys()]).toEqual([SHARE_KEY]);
  });

  it("falls back to the defaults for anything odd", () => {
    const store = memory();
    store.setItem(
      SHARE_KEY,
      JSON.stringify({
        tab: "myspace",
        link: "javascript:alert(1)",
        captions: { x: 5 },
      }),
    );
    const r = readRemembered(store);
    expect(r.tab).toBe("x");
    expect(r.link).toBe("");
    expect(r.captions.x).toBe(fillTemplate("x", r));
    store.setItem(SHARE_KEY, "{not json");
    expect(readRemembered(store).tab).toBe("x");
    expect(readRemembered(null).captions.linkedin).toBe(
      fillTemplate("linkedin", { link: "", credit: true }),
    );
  });
});

describe("secrets confirmation", () => {
  it("open, copy file and drag wait for the checkbox", () => {
    for (const a of ["open", "copyFile", "drag"] as const) {
      expect(allowed(a, false)).toBe(false);
      expect(allowed(a, true)).toBe(true);
    }
    for (const a of ["copyCaption", "showInFinder", "smaller"] as const)
      expect(allowed(a, false)).toBe(true);
  });
});

describe("smaller copy target", () => {
  it("uses 5 Mbit/s unless a limit needs less", () => {
    expect(smallerRate(60_000, null)).toBe(5_000_000);
    expect(smallerRate(60_000, 8e9)).toBe(5_000_000);
    // 100 MB for 10 minutes: 90 MB * 8 / 600 s.
    const r = smallerRate(600_000, 100e6);
    expect(r).toBe(1_200_000);
    expect(estimateBytes(r ?? 0, 600_000)).toBeLessThanOrEqual(100e6 * 0.9);
    // Too long to fit at 0.5 Mbit/s.
    expect(smallerRate(600_000, 10e6)).toBeNull();
    expect(smallerRate(0, null)).toBeNull();
  });
});

describe("GIF range", () => {
  it("stays inside the video and at most 10 seconds", () => {
    expect(clampRange(0, 10_000, 30_000, "start")).toEqual([0, 10_000]);
    expect(clampRange(2_000, 20_000, 30_000, "start")).toEqual([2_000, 12_000]);
    expect(clampRange(2_000, 20_000, 30_000, "end")).toEqual([10_000, 20_000]);
    expect(clampRange(0, 10_000, 4_000, "start")).toEqual([0, 4_000]);
    expect(clampRange(5_000, 5_000, 30_000, "end")).toEqual([4_900, 5_000]);
    expect(clampRange(-5, 50, 30_000, "start")).toEqual([0, 100]);
  });
});

describe("job events", () => {
  const ev = (o: Partial<ShareEvent>): ShareEvent => ({
    job: 7,
    kind: "gif",
    state: "running",
    progress: 0.5,
    output: null,
    size: null,
    width: null,
    height: null,
    fps: null,
    code: null,
    message: null,
    ...o,
  });
  const running: JobView = {
    kind: "running",
    what: "gif",
    job: null,
    progress: 0,
  };

  it("follows its own job to the end", () => {
    const a = reduceJob(running, ev({}));
    expect(a).toEqual({ kind: "running", what: "gif", job: 7, progress: 0.5 });
    expect(reduceJob(a, ev({ job: 8, progress: 0.9 }))).toBe(a);
    expect(reduceJob(a, ev({ kind: "smaller" }))).toBe(a);
    const done = reduceJob(
      a,
      ev({
        state: "done",
        output: "/m/Rokk-x-readme.gif",
        size: 3,
        width: 960,
        height: 608,
        fps: 12,
      }),
    );
    expect(done).toMatchObject({ kind: "done", width: 960, fps: 12 });
    expect(
      reduceJob(a, ev({ state: "error", code: "bad_range", message: "No." })),
    ).toMatchObject({ kind: "error", code: "bad_range" });
    expect(reduceJob(a, ev({ state: "cancelled" }))).toEqual({
      kind: "cancelled",
      what: "gif",
    });
    expect(reduceJob(IDLE, ev({}))).toBe(IDLE);
  });
});

describe("where Share links open", () => {
  const browsers: Browser[] = [
    { id: "com.google.Chrome", name: "Google Chrome", supports_profiles: true },
    { id: "com.apple.Safari", name: "Safari", supports_profiles: false },
  ];
  const profiles: Profile[] = [
    { dir: "Default", name: "Personal" },
    { dir: "Profile 1", name: "Work" },
    { dir: "Profile 2", name: "Work" },
  ];

  it("defaults to the default browser and remembers a choice", () => {
    const store = memory();
    const first = readRemembered(store);
    expect([first.browser, first.profile]).toEqual(["", ""]);
    writeRemembered(store, {
      ...first,
      browser: "com.google.Chrome",
      profile: "Profile 1",
    });
    const back = readRemembered(store);
    expect([back.browser, back.profile]).toEqual([
      "com.google.Chrome",
      "Profile 1",
    ]);
    store.setItem(
      SHARE_KEY,
      JSON.stringify({ browser: "a b;c", profile: "Default; rm -rf" }),
    );
    // Odd values are not trusted: they match no detected browser, so they
    // count as missing and get cleared (and Rust refuses them).
    const odd = readRemembered(store);
    expect(choice(odd.browser, odd.profile, browsers, []).missing).toBe(true);
  });

  it("finds a saved choice that is gone, once the lists are known", () => {
    expect(choice("", "", browsers, profiles).missing).toBe(false);
    expect(choice("com.google.Chrome", "Profile 1", null, null).missing).toBe(
      false,
    );
    expect(
      choice("com.google.Chrome", "Profile 1", browsers, null).missing,
    ).toBe(false);
    expect(
      choice("com.google.Chrome", "Profile 1", browsers, profiles).missing,
    ).toBe(false);
    expect(
      choice("com.google.Chrome", "Profile 9", browsers, profiles).missing,
    ).toBe(true);
    expect(choice("com.brave.Browser", "", browsers, []).missing).toBe(true);
    expect(choice("com.apple.Safari", "Default", browsers, []).missing).toBe(
      true,
    );
    expect(NOT_FOUND).toBe(
      "Your chosen browser profile was not found. Using the default browser.",
    );
  });

  it("the helper line says where the link opens", () => {
    expect(choice("", "", browsers, profiles).where).toBeNull();
    expect(
      choice("com.google.Chrome", "Default", browsers, profiles).where,
    ).toBe("Opens in Google Chrome (Personal). You press Post there.");
    expect(choice("com.apple.Safari", "", browsers, []).where).toBe(
      "Opens in Safari. You press Post there.",
    );
    expect(choice("com.gone", "", browsers, []).where).toBeNull();
  });
});

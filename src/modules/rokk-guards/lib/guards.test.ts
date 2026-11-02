import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentDetails, GuardsView, problemDetails } from "@/settings/sections/GuardsSection";
import {
  type GuardStatus,
  hookWanted,
  needsRepair,
  pageState,
  repairReason,
  shipItStatsLine,
  statsLine,
  toggleAction,
} from "./guards";

function status(over: Partial<GuardStatus> = {}): GuardStatus {
  return {
    supported: true,
    enabled: false,
    consented: false,
    installed: false,
    filesOk: false,
    sensitivity: "low",
    version: 1,
    command: '[ -n "$TERAX_TERMINAL" ] && "$HOME/.rokk/hooks/prompt-guard"; true',
    settingsPath: "~/.claude/settings.json",
    backupPath: "~/.claude/settings.json.rokk-backup",
    files: ["~/.rokk/hooks/prompt-guard", "~/.rokk/app-path"],
    error: null,
    ...over,
  };
}

const ON = status({ enabled: true, consented: true, installed: true, filesOk: true });

function view(
  s: GuardStatus | null,
  stats: Parameters<typeof statsLine>[0] = null,
  failure: string | null = null,
): string {
  return renderToString(
    createElement(GuardsView, {
      status: s,
      stats,
      sensitivity: "low",
      busy: false,
      message: null,
      failure,
      onToggle: () => {},
      onSensitivity: () => {},
      onRepair: () => {},
      onRemoveAll: () => {},
    }),
  );
}

describe("page state", () => {
  it("maps the status to off, on, not installed, error and unsupported", () => {
    expect(pageState(null)).toBe("loading");
    expect(pageState(status())).toBe("off");
    expect(pageState(ON)).toBe("on");
    expect(pageState({ ...ON, installed: false })).toBe("notInstalled");
    expect(pageState({ ...ON, filesOk: false })).toBe("notInstalled");
    expect(pageState(status({ error: "settings.json is not valid JSON" }))).toBe("error");
    expect(pageState(status({ supported: false }))).toBe("unsupported");
  });

  it("offers Repair only when disk and switch disagree", () => {
    expect(needsRepair(ON)).toBe(false);
    expect(needsRepair(status())).toBe(false);
    expect(needsRepair({ ...ON, installed: false })).toBe(true);
    expect(needsRepair(status({ installed: true }))).toBe(true);
    expect(needsRepair(status({ error: "x", installed: true }))).toBe(false);
  });
});

describe("rendered page", () => {
  it("off: switch unchecked, not installed, no Repair", () => {
    const html = view(status());
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Installed in Claude Code: <strong");
    expect(html).toMatch(/<strong[^>]*>No<\/strong>/);
    expect(html).not.toContain("Repair");
  });

  it("on: switch checked and installed", () => {
    const html = view(ON);
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/<strong[^>]*>Yes<\/strong>/);
    expect(html).not.toContain("Repair");
  });

  it("not installed: shows Repair with a text reason", () => {
    const html = view({ ...ON, installed: false });
    expect(html).toContain("Repair");
    expect(html).toContain("The hook or its files are missing.");
  });

  it("error: shows the problem in an alert and disables the switch", () => {
    const html = view(status({ error: "settings.json is not valid JSON" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("settings.json is not valid JSON");
    expect(html).toMatch(/role="switch"[^>]*disabled/);
  });

  it("has the copy, the examples and a polite live region, and lists no future guards", () => {
    const html = view(ON);
    expect(html).toContain("cost no credits themselves");
    expect(html).toContain("Claude asks first");
    expect(html).toContain("Goes straight through");
    expect(html).toContain('aria-live="polite"');
    expect(html.toLowerCase()).not.toContain("coming soon");
  });

  it("shows the stats line only when there are stats", () => {
    expect(view(ON)).not.toContain("This week:");
    expect(view(ON, { checked: 12, fired: 2, skipped: 4, lastFire: 1 })).toContain(
      "This week: checked 12 prompts, asked Claude to clarify on 2.",
    );
  });
});

describe("repair after the ROKK_TERMINAL change", () => {
  it("offers Repair with a plain reason for an old entry", () => {
    const old = { ...ON, outdated: true };
    expect(pageState(old)).toBe("notInstalled");
    expect(needsRepair(old)).toBe(true);
    expect(repairReason(old)).toBe("Rokk updated how the guard recognizes its own terminals.");
    const html = view(old);
    expect(html).toContain("Repair");
    expect(html).toContain("Rokk updated how the guard recognizes its own terminals.");
    expect(repairReason(ON)).toBeNull();
  });
});

describe("consent flow", () => {
  it("asks for consent the first time only", () => {
    expect(toggleAction(status(), true)).toBe("consent");
    expect(toggleAction(status({ consented: true }), true)).toBe("enable");
    expect(toggleAction(ON, false)).toBe("disable");
  });

  it("lists exactly what will change", () => {
    const html = renderToString(createElement(ConsentDetails, { status: status() }));
    expect(html).toContain("~/.claude/settings.json");
    expect(html).toContain("~/.claude/settings.json.rokk-backup");
    expect(html).toContain("~/.rokk/hooks/prompt-guard");
    expect(html).toContain("$HOME/.rokk/hooks/prompt-guard");
    expect(html).toContain("Only runs in terminals opened in Rokk.");
    expect(html).toContain("You can turn it off or remove everything at any time.");
  });
});

describe("stats line", () => {
  it("formats counts and omits an empty week", () => {
    expect(statsLine(null)).toBeNull();
    expect(statsLine({ checked: 0, fired: 0, skipped: 0, lastFire: null })).toBeNull();
    expect(statsLine({ checked: 1, fired: 0, skipped: 0, lastFire: null })).toBe(
      "This week: checked 1 prompt, asked Claude to clarify on 0.",
    );
  });
});

describe("problem alert", () => {
  const problem = "Claude's settings file (~/.claude/settings.json) is a symlink to /x/real.json, so Rokk will not change it.";

  it("shows a failed command as an alert with Copy details", () => {
    const html = view({ ...ON, installed: false }, null, problem);
    expect(html).toContain('role="alert"');
    expect(html).toContain("is a symlink to /x/real.json");
    expect(html).toContain("Copy details");
  });

  it("shows nothing when there is no problem", () => {
    expect(view(ON)).not.toContain('role="alert"');
  });

  it("copies the message and the state, nothing else", () => {
    const text = problemDetails(problem, { ...ON, installed: false });
    expect(text).toBe(
      `Rokk guard problem: ${problem}\nState: notInstalled; enabled true, ship it false, installed false, files ok true, consented true, version 1`,
    );
  });
});

describe("Ship it card", () => {
  const SHIP = status({ shipItEnabled: true, consented: true, installed: true, filesOk: true });

  it("has its own switch, copy, checks and honest note", () => {
    const html = view(status());
    expect(html).toContain("Ship it checklist");
    expect(html).toContain("Type ship it and Claude runs a go or no-go check before anything is pushed.");
    expect(html).toContain("It never commits, pushes or");
    expect(html).toContain("Whether the project&#x27;s own checks pass");
    expect(html).toContain("It checks common mistakes. It does not make your app secure.");
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html.toLowerCase()).not.toContain("coming soon");
  });

  it("maps its own on and off states, sharing the hook status", () => {
    expect(pageState(SHIP, "shipIt")).toBe("on");
    expect(pageState(SHIP, "vague")).toBe("off");
    expect(pageState(ON, "shipIt")).toBe("off");
    expect(pageState({ ...SHIP, installed: false }, "shipIt")).toBe("notInstalled");
    expect(hookWanted(SHIP)).toBe(true);
    expect(hookWanted(status())).toBe(false);
    // Only Ship it on and the hook missing: Repair is offered.
    expect(needsRepair({ ...SHIP, installed: false })).toBe(true);
    expect(needsRepair(SHIP)).toBe(false);
    // Both off but the hook still there.
    expect(repairReason(status({ installed: true }))).toBe(
      "The hook is still in Claude Code although both guards are off.",
    );
  });

  it("renders its switch checked when on", () => {
    const html = view(SHIP);
    expect(html).toMatch(/aria-labelledby="guard-ship-title"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-labelledby="guard-ship-title"/);
    expect(html).toMatch(/aria-checked="false"[^>]*aria-labelledby="guard-clarify-title"|aria-labelledby="guard-clarify-title"[^>]*aria-checked="false"/);
  });

  it("shows ran N times only after a run", () => {
    expect(shipItStatsLine(null)).toBeNull();
    expect(shipItStatsLine({ checked: 4, fired: 1, skipped: 0, shipItRuns: 0, lastFire: null })).toBeNull();
    expect(shipItStatsLine({ checked: 4, fired: 1, skipped: 0, shipItRuns: 1, lastFire: null })).toBe(
      "This week: ran 1 time",
    );
    expect(view(SHIP, { checked: 9, fired: 1, skipped: 0, shipItRuns: 3, lastFire: null })).toContain(
      "This week: ran 3 times",
    );
    expect(view(SHIP)).not.toContain("This week: ran");
  });

  it("the consent text names both guards", () => {
    const html = renderToString(createElement(ConsentDetails, { status: status() }));
    expect(html).toContain("Clarify vague prompts");
    expect(html).toContain("Ship it checklist");
  });
});

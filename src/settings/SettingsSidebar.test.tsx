import { KeyboardIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SettingsNavItem, SettingsSidebar } from "./SettingsSidebar";

const ITEMS: SettingsNavItem[] = [
  { id: "general", label: "General", icon: Settings01Icon },
  { id: "shortcuts", label: "Shortcuts", icon: KeyboardIcon },
];

function render(narrow: boolean): string {
  return renderToString(
    createElement(SettingsSidebar, {
      items: ITEMS,
      active: "shortcuts",
      onSelect: () => {},
      narrow,
    }),
  );
}

describe("SettingsSidebar", () => {
  it("renders a labelled, sticky nav landmark with a plain list", () => {
    const html = render(false);
    expect(html).toContain('<nav aria-label="Settings sections"');
    expect(html).toContain("sticky top-6");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("marks only the active item as the current page", () => {
    const html = render(false);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*tabindex="0"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  it("shows text labels in the wide layout", () => {
    const html = render(false);
    expect(html).toContain(">General</span>");
    expect(html).toContain("w-50");
  });

  it("uses an icon rail with aria-labels when narrow", () => {
    const html = render(true);
    expect(html).toContain("w-12");
    expect(html).toContain('aria-label="General"');
    expect(html).toContain('aria-label="Shortcuts"');
    expect(html).not.toContain(">General</span>");
  });
});

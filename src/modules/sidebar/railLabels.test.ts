import { describe, expect, it } from "vitest";
import { RAIL_LABELS_BREAKPOINT, railBadge, railName } from "./railLabels";

describe("sidebar switch labels", () => {
  it("caps the badge and hides it at zero", () => {
    expect(railBadge(0)).toBeNull();
    expect(railBadge(undefined)).toBeNull();
    expect(railBadge(-1)).toBeNull();
    expect(railBadge(1)).toBe("1");
    expect(railBadge(99)).toBe("99");
    expect(railBadge(100)).toBe("99+");
  });

  it("puts the count in the accessible name", () => {
    expect(railName("Files", undefined)).toBe("Files");
    expect(railName("Git", 0)).toBe("Git");
    expect(railName("Git", 35)).toBe("Git, 35 changes");
    expect(railName("Changes", 1)).toBe("Changes, 1 change");
    // The name keeps the real number even when the badge shows "99+".
    expect(railName("Git", 250)).toBe("Git, 250 changes");
  });

  it("names the breakpoint", () => {
    expect(RAIL_LABELS_BREAKPOINT).toBe(268);
  });
});

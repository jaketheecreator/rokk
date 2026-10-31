import { describe, expect, it } from "vitest";
import { isNarrowSettings, nextNavIndex } from "./settingsNav";

describe("nextNavIndex", () => {
  it("moves down and up one item", () => {
    expect(nextNavIndex(2, "ArrowDown", 7)).toBe(3);
    expect(nextNavIndex(2, "ArrowUp", 7)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(nextNavIndex(6, "ArrowDown", 7)).toBe(0);
    expect(nextNavIndex(0, "ArrowUp", 7)).toBe(6);
  });

  it("jumps to the first and last item", () => {
    expect(nextNavIndex(4, "Home", 7)).toBe(0);
    expect(nextNavIndex(1, "End", 7)).toBe(6);
  });

  it("ignores other keys and an empty list", () => {
    expect(nextNavIndex(1, "ArrowLeft", 7)).toBeNull();
    expect(nextNavIndex(1, "Enter", 7)).toBeNull();
    expect(nextNavIndex(0, "ArrowDown", 0)).toBeNull();
  });
});

describe("isNarrowSettings", () => {
  it("switches to the rail below 760px", () => {
    expect(isNarrowSettings(759)).toBe(true);
    expect(isNarrowSettings(760)).toBe(false);
    expect(isNarrowSettings(1200)).toBe(false);
  });
});

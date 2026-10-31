import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Locks the pnpm override in pnpm-workspace.yaml. Two copies of
// @lezer/highlight leave JS and TS unhighlighted: the parser's tags never
// match the ones the editor themes style.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function packageDir(from: string, name: string): string {
  const req = createRequire(join(from, "package.json"));
  let dir = dirname(req.resolve(name));
  while (!dir.endsWith(join("node_modules", ...name.split("/")))) {
    dir = dirname(dir);
  }
  return realpathSync(dir);
}

describe("@lezer/highlight", () => {
  it("resolves to exactly one version in the lockfile", () => {
    const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    const versions = new Set(
      [...lock.matchAll(/^ {2}'@lezer\/highlight@([^']+)':/gm)].map((m) => m[1]),
    );
    expect([...versions]).toHaveLength(1);
  });

  it("is the same copy for the JS parser and the editor themes", () => {
    const language = packageDir(root, "@codemirror/language");
    const langJs = packageDir(root, "@codemirror/lang-javascript");
    const lezerJs = packageDir(langJs, "@lezer/javascript");
    expect(packageDir(lezerJs, "@lezer/highlight")).toBe(
      packageDir(language, "@lezer/highlight"),
    );
  });
});

/**
 * No SQL the plugin sends to Zotero writes a `LIKE` pattern as a literal
 * (`plan/00` §6 item 398(i), found 2026-11-17 by `P7-T37`'s integration run).
 *
 * Zotero's database connections run on Firefox's `Sqlite.sys.mjs`, whose
 * `execute` and `executeCached` throw "Please enter a LIKE clause with
 * bindings" when `isInvalidBoundLikeQuery` matches: the word `LIKE`, one
 * whitespace character, then anything but a placeholder (`?`, `:name`,
 * `@name`). Node's `node:sqlite`, which the unit tests use, has no such rule,
 * so a literal pattern passes every unit test and fails only in Zotero. This
 * test applies the same expression to every source line under `src` and
 * `addon/content` that is not a comment, with one difference: it matches
 * `LIKE` in capitals only, because the plugin writes its SQL keywords in
 * capitals and its messages use the English word "like" ("looks like a
 * credential"). A lower-case `like` in SQL would not be caught here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * `Sqlite.sys.mjs`'s `likeSqlRegex` as Zotero 10.0.3 ships it
 * (`/\bLIKE\b\s(?![@:?])/i`), without the `i` flag (see the header).
 */
const REFUSED_LIKE = /\bLIKE\b\s(?![@:?])/;

/** Every line of `text` that Zotero's connection would refuse, outside comments. */
function refusedLines(file: string, text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith("*") || code.startsWith("/*") || code.startsWith("//"))
      return;
    if (REFUSED_LIKE.test(code)) found.push(`${file}:${String(index + 1)}`);
  });
  return found;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(?:ts|js|mjs)$/u.test(entry.name)) out.push(path);
  }
  return out;
}

describe("SQL sent to Zotero binds every LIKE pattern (item 398(i))", () => {
  it("finds no literal LIKE pattern in src or addon/content", () => {
    const files = [
      ...sources(join(ROOT, "src")),
      ...sources(join(ROOT, "addon/content")),
    ];
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((path) =>
      refusedLines(
        relative(ROOT, path).replaceAll("\\", "/"),
        readFileSync(path, "utf8"),
      ),
    );
    expect(found).toEqual([]);
  });

  it("refuses what Zotero refuses and passes a bound pattern", () => {
    expect(
      refusedLines("f", `  "AND name NOT LIKE 'sqlite_%' AND x",`),
    ).toEqual(["f:1"]);
    expect(refusedLines("f", "WHERE key LIKE\t'%'")).toEqual(["f:1"]);
    expect(refusedLines("f", '"it looks like a credential"')).toEqual([]);
    expect(refusedLines("f", `  "AND name NOT LIKE ? AND x",`)).toEqual([]);
    expect(refusedLines("f", "WHERE key LIKE :pattern")).toEqual([]);
    expect(refusedLines("f", " * a LIKE 'x' in a comment")).toEqual([]);
  });
});

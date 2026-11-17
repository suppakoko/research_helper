#!/usr/bin/env node
/**
 * Key parity between two locales' Fluent bundles (`plan/10` `P7-T02`; `docs/11`
 * R-22; `FR-55`, part of `NFR-11`).
 *
 * ```
 * node scripts/check-l10n.mjs --base en-US --target ko-KR [--allow <id>]... [--root <dir>]
 * npm run l10n:check
 * ```
 *
 * For every `.ftl` file in `<root>/<base>/`, the file of the same name in
 * `<root>/<target>/` must declare the same messages (and terms), each with the
 * same attributes and a value on the same side, and no value or attribute may
 * be empty on either side. Every difference is printed with its file, and the
 * script exits 1. It exits 0 when the two locales agree, and 2 on a usage
 * error.
 *
 * **What it does not do.** It never compares the text of one locale with the
 * other: whether the Korean says what the English says is `P7-T05`'s human
 * review. And it does not know which ids a surface declares; that is
 * `src/i18n/keys.ts` and `test/unit/i18n/keys.test.ts`. It compares files.
 *
 * **No exception list.** `KO_DELIBERATELY_ABSENT` is empty since `P7-T04`. A
 * hole the owner decides to keep is passed with `--allow <id>`, visibly, in
 * the step that runs this; an allowed id that is not missing is itself an
 * error, so a stale `--allow` cannot linger.
 *
 * **The reader** is a small line-based one, so the check adds no dependency
 * (the card's `Do NOT`). It understands what the plugin's bundles use:
 *
 * - a comment is a line starting with `#` at column 0, and it ends the entry
 *   before it, as in Fluent;
 * - an entry starts at column 0 with `id =` or `-term =`, the rest of the line
 *   being the start of its value;
 * - an indented `.name =` line starts an attribute of the current entry;
 * - any other indented line continues the value or attribute above it, as
 *   does a line starting with `}` (a select expression's closing brace, which
 *   Fluent allows at column 0), and a blank line continues nothing;
 * - any other line at column 0 is reported as unreadable, rather than guessed
 *   at.
 *
 * "Empty" means no text at all after the `=` and on the continuation lines; a
 * placeable such as `{ "" }` is text, so a deliberately blank variant inside a
 * select expression is not empty.
 *
 * Runs on Node with no network and no environment variable; it reads files and
 * writes to standard output and standard error only. Callers: the lint job of
 * `.github/workflows/ci.yml` and `package.json`'s `l10n:check`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_ROOT = join(REPO_ROOT, "addon", "locale");

const ENTRY = /^(-?[A-Za-z][A-Za-z0-9_-]*)[ \t]*=[ \t]?(.*)$/;
const ATTRIBUTE = /^[ \t]+\.([A-Za-z][A-Za-z0-9_-]*)[ \t]*=[ \t]?(.*)$/;

/**
 * Read one `.ftl` text into its entries.
 *
 * @param {string} text
 * @returns {{
 *   entries: Map<string, { value: string, hasValue: boolean, attributes: Map<string, string>, line: number }>,
 *   problems: { line: number, message: string }[],
 * }}
 */
export function parseFtl(text) {
  const entries = new Map();
  const problems = [];
  /** @type {{ value: string, attributes: Map<string, string>, line: number } | undefined} */
  let entry;
  /** @type {string | undefined} */
  let attribute;

  const bom = String.fromCharCode(0xfeff);
  const body = text.startsWith(bom) ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    if (raw.startsWith("#")) {
      entry = undefined;
      attribute = undefined;
      return;
    }
    const start = ENTRY.exec(raw);
    if (start) {
      const [, id, rest] = start;
      if (entries.has(id)) {
        problems.push({ line, message: `${id} is declared twice` });
      }
      entry = { value: rest.trim(), attributes: new Map(), line };
      attribute = undefined;
      entries.set(id, entry);
      return;
    }
    // A select expression's closing brace may sit at column 0: it is inside a
    // placeable, where Fluent allows any whitespace before it.
    if ((/^[ \t]/.test(raw) || raw.startsWith("}")) && entry !== undefined) {
      const attr = ATTRIBUTE.exec(raw);
      if (attr) {
        const [, name, rest] = attr;
        if (entry.attributes.has(name)) {
          problems.push({
            line,
            message: `attribute .${name} is declared twice`,
          });
        }
        attribute = name;
        entry.attributes.set(name, rest.trim());
        return;
      }
      const more = raw.trim();
      if (attribute !== undefined) {
        const before = entry.attributes.get(attribute) ?? "";
        entry.attributes.set(
          attribute,
          before === "" ? more : `${before}\n${more}`,
        );
      } else {
        entry.value = entry.value === "" ? more : `${entry.value}\n${more}`;
      }
      return;
    }
    problems.push({
      line,
      message: `unreadable line: ${JSON.stringify(raw.slice(0, 60))}`,
    });
  });

  for (const value of entries.values()) {
    value.hasValue = value.value !== "";
  }
  return { entries, problems };
}

/**
 * Compare two locales' bundles.
 *
 * @param {{ root: string, base: string, target: string, allow?: readonly string[] }} options
 * @returns {{ defects: string[], allowed: string[], files: number, messages: number }}
 */
export function checkLocales({ root, base, target, allow = [] }) {
  const defects = [];
  const allowed = [];
  const allowSet = new Set(allow);
  const usedAllow = new Set();
  const baseDir = join(root, base);
  const targetDir = join(root, target);
  const show = (path) => relative(process.cwd(), path).split(sep).join("/");

  for (const dir of [baseDir, targetDir]) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new UsageError(`no locale directory ${show(dir)}`);
    }
  }
  const ftlIn = (dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ftl"))
      .sort();
  const baseFiles = ftlIn(baseDir);
  const targetFiles = new Set(ftlIn(targetDir));
  if (baseFiles.length === 0) {
    throw new UsageError(`no .ftl file in ${show(baseDir)}`);
  }

  let messages = 0;
  for (const name of baseFiles) {
    const basePath = join(baseDir, name);
    const targetPath = join(targetDir, name);
    if (!targetFiles.has(name)) {
      defects.push(`${show(targetPath)}: file missing (present in ${base})`);
      continue;
    }
    targetFiles.delete(name);
    const sides = [
      {
        locale: base,
        path: basePath,
        other: target,
        ...parseFtl(readFileSync(basePath, "utf8")),
      },
      {
        locale: target,
        path: targetPath,
        other: base,
        ...parseFtl(readFileSync(targetPath, "utf8")),
      },
    ];
    for (const side of sides) {
      for (const problem of side.problems) {
        defects.push(`${show(side.path)}:${problem.line}: ${problem.message}`);
      }
    }
    const [b, t] = sides;
    messages += b.entries.size;

    for (const [id, entry] of b.entries) {
      if (!t.entries.has(id)) {
        if (allowSet.has(id)) {
          usedAllow.add(id);
          allowed.push(`${show(t.path)}: ${id} missing, allowed by --allow`);
        } else {
          defects.push(
            `${show(t.path)}: missing message ${id} (present in ${base}, line ${entry.line})`,
          );
        }
      }
    }
    for (const [id, entry] of t.entries) {
      if (!b.entries.has(id)) {
        defects.push(
          `${show(t.path)}:${entry.line}: extra message ${id} (absent from ${base})`,
        );
      }
    }

    for (const [id, be] of b.entries) {
      const te = t.entries.get(id);
      if (te === undefined) continue;
      if (be.hasValue !== te.hasValue) {
        const [has, lacks] = be.hasValue ? [b, t] : [t, b];
        defects.push(
          `${show(lacks.path)}:${(lacks === b ? be : te).line}: ${id} has no value, ` +
            `but has one in ${has.locale}`,
        );
      }
      for (const [side, mine, theirs] of [
        [b, be, te],
        [t, te, be],
      ]) {
        for (const attr of mine.attributes.keys()) {
          if (!theirs.attributes.has(attr)) {
            const lacks = side === b ? t : b;
            defects.push(
              `${show(lacks.path)}:${theirs.line}: ${id} lacks attribute .${attr} ` +
                `(present in ${side.locale})`,
            );
          }
        }
      }
    }

    for (const side of sides) {
      for (const [id, entry] of side.entries) {
        if (!entry.hasValue && entry.attributes.size === 0) {
          defects.push(
            `${show(side.path)}:${entry.line}: ${id} is empty (no value, no attribute)`,
          );
        }
        for (const [attr, value] of entry.attributes) {
          if (value === "") {
            defects.push(
              `${show(side.path)}:${entry.line}: ${id}.${attr} is empty`,
            );
          }
        }
      }
    }
  }
  for (const name of [...targetFiles].sort()) {
    defects.push(
      `${show(join(targetDir, name))}: extra file (absent from ${base})`,
    );
  }
  for (const id of allowSet) {
    if (!usedAllow.has(id)) {
      defects.push(
        `--allow ${id}: not missing from ${target}, so the allowance is stale`,
      );
    }
  }
  return { defects, allowed, files: baseFiles.length, messages };
}

class UsageError extends Error {}

/** @param {readonly string[]} argv */
function parseArgs(argv) {
  const out = {
    base: undefined,
    target: undefined,
    root: DEFAULT_ROOT,
    allow: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--base", "--target", "--root", "--allow"].includes(flag)) {
      throw new UsageError(`unknown argument ${flag}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    i += 1;
    if (flag === "--allow") out.allow.push(value);
    else if (flag === "--root") out.root = resolve(value);
    else out[flag.slice(2)] = value;
  }
  if (out.base === undefined || out.target === undefined) {
    throw new UsageError("--base and --target are required");
  }
  if (out.base === out.target) {
    throw new UsageError("--base and --target must differ");
  }
  return out;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const { defects, allowed, files, messages } = checkLocales(options);
    for (const line of allowed) process.stdout.write(`allowed: ${line}\n`);
    if (defects.length > 0) {
      for (const line of defects) process.stderr.write(`check-l10n: ${line}\n`);
      process.stderr.write(
        `check-l10n: ${defects.length} problem(s) between ${options.base} and ` +
          `${options.target} over ${files} file(s)\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `check-l10n: ${options.target} matches ${options.base}: ${files} file(s), ` +
        `${messages} message(s), ${allowed.length} allowed hole(s)\n`,
    );
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(
        `check-l10n: ${error.message}\nusage: node scripts/check-l10n.mjs ` +
          `--base <locale> --target <locale> [--allow <id>]... [--root <dir>]\n`,
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

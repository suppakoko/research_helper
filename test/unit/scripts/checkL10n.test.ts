/**
 * `scripts/check-l10n.mjs` — key parity between two locales' Fluent bundles
 * (`plan/10` `P7-T02`; `docs/11` R-22).
 *
 * The script runs as CI runs it: a child `node` process, on small fixture
 * bundles written into a fresh temporary directory per test (`--root`), with
 * its exit code and its output read back. The card's five fixtures are here —
 * equal, a missing id, a missing attribute, an empty value, an extra Korean id
 * — plus the cases the reader has to get right on the real bundles: a select
 * expression closed at column 0, comments ending an entry, the value present
 * on one side only, `--allow` and a stale `--allow`, a missing file, and the
 * usage errors. One test runs it on the repository's own bundles, which is
 * the `npm run l10n:check` the lint job runs.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no network, no key. The fixture text
 * is made up for these tests and is not the plugin's wording.
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../../scripts/check-l10n.mjs");
const REPO = resolve(__dirname, "../../..");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Write `files` (`<locale>/<name>` → text) under a fresh root. */
function bundles(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rh-check-l10n-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const [locale, name] = path.split("/") as [string, string];
    mkdirSync(join(root, locale), { recursive: true });
    writeFileSync(join(root, locale, name), text, "utf8");
  }
  return root;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], cwd = REPO): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function check(root: string, ...extra: string[]): Run {
  return run([
    "--base",
    "en-US",
    "--target",
    "ko-KR",
    "--root",
    root,
    ...extra,
  ]);
}

/** A two-message bundle: one plain value, one with an attribute. */
const EN_OK = [
  "# A header comment.",
  "",
  "fixture-plain = Plain test text",
  "fixture-menu =",
  "    .label = Menu test text",
  "",
].join("\n");
const KO_OK = [
  "fixture-plain = 테스트 문장",
  "fixture-menu =",
  "    .label = 테스트 메뉴",
  "",
].join("\n");

describe("scripts/check-l10n.mjs (P7-T02)", () => {
  it("exits 0 when the two locales declare the same messages, attributes and values", () => {
    const root = bundles({
      "en-US/fixture.ftl": EN_OK,
      "ko-KR/fixture.ftl": KO_OK,
    });
    const result = check(root);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "ko-KR matches en-US: 1 file(s), 2 message(s), 0 allowed hole(s)",
    );
    expect(result.status).toBe(0);
  });

  it("exits 1 on a message missing from the target, naming the id and the file", () => {
    const root = bundles({
      "en-US/fixture.ftl": `${EN_OK}fixture-new = New test text\n`,
      "ko-KR/fixture.ftl": KO_OK,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /ko-KR\/fixture\.ftl: missing message fixture-new \(present in en-US, line \d+\)/,
    );
    expect(result.stderr).toContain("1 problem(s) between en-US and ko-KR");
  });

  it("exits 1 on an attribute missing from either side", () => {
    const root = bundles({
      "en-US/fixture.ftl": EN_OK.replace(
        "    .label = Menu test text",
        "    .label = Menu test text\n    .accesskey = M",
      ),
      "ko-KR/fixture.ftl": KO_OK,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /ko-KR\/fixture\.ftl:\d+: fixture-menu lacks attribute \.accesskey \(present in en-US\)/,
    );

    const reverse = bundles({
      "en-US/fixture.ftl": EN_OK,
      "ko-KR/fixture.ftl": KO_OK.replace(
        "    .label = 테스트 메뉴",
        "    .label = 테스트 메뉴\n    .tooltiptext = 테스트",
      ),
    });
    const back = check(reverse);
    expect(back.status).toBe(1);
    expect(back.stderr).toMatch(
      /en-US\/fixture\.ftl:\d+: fixture-menu lacks attribute \.tooltiptext \(present in ko-KR\)/,
    );
  });

  it("exits 1 on an empty value or an empty attribute, on either side", () => {
    const emptyAttr = bundles({
      "en-US/fixture.ftl": EN_OK,
      "ko-KR/fixture.ftl": KO_OK.replace(
        "    .label = 테스트 메뉴",
        "    .label =",
      ),
    });
    const a = check(emptyAttr);
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(
      /ko-KR\/fixture\.ftl:\d+: fixture-menu\.label is empty/,
    );

    const emptyMessage = bundles({
      "en-US/fixture.ftl": `${EN_OK}fixture-blank =\n`,
      "ko-KR/fixture.ftl": `${KO_OK}fixture-blank =\n`,
    });
    const m = check(emptyMessage);
    expect(m.status).toBe(1);
    expect(m.stderr).toMatch(
      /en-US\/fixture\.ftl:\d+: fixture-blank is empty \(no value, no attribute\)/,
    );
    expect(m.stderr).toMatch(
      /ko-KR\/fixture\.ftl:\d+: fixture-blank is empty \(no value, no attribute\)/,
    );
  });

  it("exits 1 on an extra Korean id that en-US does not declare", () => {
    const root = bundles({
      "en-US/fixture.ftl": EN_OK,
      "ko-KR/fixture.ftl": `${KO_OK}fixture-only-ko = 테스트\n`,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /ko-KR\/fixture\.ftl:\d+: extra message fixture-only-ko \(absent from en-US\)/,
    );
  });

  it("exits 1 when a value is on one side only", () => {
    const root = bundles({
      "en-US/fixture.ftl": EN_OK,
      "ko-KR/fixture.ftl": KO_OK.replace(
        "fixture-menu =",
        "fixture-menu = 테스트 값",
      ),
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /en-US\/fixture\.ftl:\d+: fixture-menu has no value, but has one in ko-KR/,
    );
  });

  it("reads select expressions, a column-0 closing brace, multiline values and comments as Fluent does", () => {
    const en = [
      "fixture-count = { $count ->",
      "    [one] One test item",
      "   *[other] { $count } test items",
      "}",
      "",
      "# A comment ends the entry above; the next line is a new entry.",
      "fixture-long =",
      "    First test line",
      "",
      "    second test line",
      "fixture-blank-variant = { $flag ->",
      '    [yes] { "" }',
      "   *[no] Test text",
      "}",
      "-fixture-term = Test term",
      "",
    ].join("\n");
    const ko = [
      "fixture-count = { $count ->",
      "   *[other] 테스트 { $count }",
      "}",
      "fixture-long =",
      "    테스트",
      "fixture-blank-variant = { $flag ->",
      '    [yes] { "" }',
      "   *[no] 테스트",
      "}",
      "-fixture-term = 테스트 용어",
      "",
    ].join("\n");
    const root = bundles({ "en-US/a.ftl": en, "ko-KR/a.ftl": ko });
    const result = check(root);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("1 file(s), 4 message(s)");
    expect(result.status).toBe(0);
  });

  it("reports a line it cannot read rather than guessing, and a duplicate id", () => {
    const root = bundles({
      "en-US/fixture.ftl": `${EN_OK}not an entry\nfixture-plain = Again\n`,
      "ko-KR/fixture.ftl": KO_OK,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/en-US\/fixture\.ftl:\d+: unreadable line/);
    expect(result.stderr).toMatch(
      /en-US\/fixture\.ftl:\d+: fixture-plain is declared twice/,
    );
  });

  it("ends an entry at a comment, so an indented line after one is not read into the entry above", () => {
    // In Fluent a comment line ends the entry before it; an attribute after
    // the comment belongs to no message, and attaching it to the one above
    // would hide a broken bundle.
    const orphan = [
      "fixture-plain = Plain test text",
      "fixture-menu = Menu test text",
      "# A comment between a message and an attribute.",
      "    .label = Orphan test text",
      "",
    ].join("\n");
    const ko = [
      "fixture-plain = 테스트 문장",
      "fixture-menu = 테스트 메뉴",
      "    .label = 테스트",
      "",
    ].join("\n");
    const root = bundles({
      "en-US/fixture.ftl": orphan,
      "ko-KR/fixture.ftl": ko,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/en-US\/fixture\.ftl:4: unreadable line/);
    expect(result.stderr).toMatch(
      /en-US\/fixture\.ftl:\d+: fixture-menu lacks attribute \.label \(present in ko-KR\)/,
    );
  });

  it("passes a hole named by --allow, prints it, and fails a stale --allow", () => {
    const root = bundles({
      "en-US/fixture.ftl": `${EN_OK}fixture-new = New test text\n`,
      "ko-KR/fixture.ftl": KO_OK,
    });
    const allowed = check(root, "--allow", "fixture-new");
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("allowed: ");
    expect(allowed.stdout).toContain("fixture-new missing, allowed by --allow");
    expect(allowed.stdout).toContain("1 allowed hole(s)");

    const stale = check(
      root,
      "--allow",
      "fixture-new",
      "--allow",
      "fixture-plain",
    );
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(
      "--allow fixture-plain: not missing from ko-KR, so the allowance is stale",
    );
  });

  it("exits 1 on a file missing from the target or present only there", () => {
    const root = bundles({
      "en-US/a.ftl": EN_OK,
      "en-US/b.ftl": EN_OK,
      "ko-KR/a.ftl": KO_OK,
      "ko-KR/c.ftl": KO_OK,
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /ko-KR\/b\.ftl: file missing \(present in en-US\)/,
    );
    expect(result.stderr).toMatch(
      /ko-KR\/c\.ftl: extra file \(absent from en-US\)/,
    );
  });

  it("exits 2 on a usage error, naming it", () => {
    expect(run(["--base", "en-US"]).status).toBe(2);
    expect(run(["--base", "en-US", "--target", "en-US"]).stderr).toContain(
      "--base and --target must differ",
    );
    expect(
      run(["--base", "en-US", "--target", "ko-KR", "--frob", "x"]).stderr,
    ).toContain("unknown argument --frob");
    const root = bundles({ "en-US/a.ftl": EN_OK });
    const noTarget = check(root);
    expect(noTarget.status).toBe(2);
    expect(noTarget.stderr).toContain("no locale directory");
  });

  it("is a blocking step of ci.yml's lint job: not commented, not continue-on-error", () => {
    const step = ciStep();
    expect(step.job).toBe("lint");
    expect(step.lines.join("\n")).not.toMatch(/continue-on-error/);
    expect(step.run).toMatch(/^npm run l10n:check(?: -- .+)?$/);
    expect(packageScript()).toBe(
      "node scripts/check-l10n.mjs --base en-US --target ko-KR",
    );
  });

  it("exits 0 on the repository's own bundles, with exactly the CI step's arguments", () => {
    // `npm run l10n:check` plus whatever `--allow` the CI step passes, so the
    // two cannot drift apart.
    const extra = ciStep().run.replace(/^npm run l10n:check(?: -- )?/, "");
    const args = extra === "" ? [] : extra.split(/\s+/);
    const result = run(["--base", "en-US", "--target", "ko-KR", ...args]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(
      /ko-KR matches en-US: 3 file\(s\), \d+ message\(s\)/,
    );
    expect(result.status).toBe(0);
  });
});

/** `.github/workflows/ci.yml`'s localization step: its job, its lines, its `run`. */
function ciStep(): { job: string; lines: string[]; run: string } {
  const text = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) =>
    /^ {6}- name: Verify Korean localization completeness\b/.test(line),
  );
  expect(at, "the step is in ci.yml, uncommented").toBeGreaterThan(-1);
  let job = "";
  for (let i = at; i >= 0; i -= 1) {
    const match = /^ {2}([a-z][\w-]*):\s*$/.exec(lines[i] ?? "");
    if (match) {
      job = match[1] ?? "";
      break;
    }
  }
  const body: string[] = [];
  for (let i = at; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (i > at && (/^ {6}- /.test(line) || /^ {0,4}\S/.test(line))) break;
    body.push(line);
  }
  const runLine = body.find((line) => /^ {8}run: /.test(line));
  expect(runLine, "the step has a one-line run").toBeDefined();
  return {
    job,
    lines: body,
    run: (runLine ?? "").replace(/^ {8}run: /, "").trim(),
  };
}

function packageScript(): string | undefined {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts?.["l10n:check"];
}

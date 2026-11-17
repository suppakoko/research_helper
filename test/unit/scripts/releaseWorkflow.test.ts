/**
 * The release and compatibility workflows, read as text (`plan/10` `P7-T21`,
 * `P7-T22`; `docs/09` §6.3 and §7; `docs/13` §5.2, §5.3).
 *
 * GitHub runs these files and nothing here can run them (`G-35`: no tag is
 * pushed, no workflow is triggered). What a unit test can hold is the rules
 * the files must keep:
 *
 * - every `uses:` is pinned to a full 40-hex commit, with its tag as a comment;
 * - no workflow sets `FIXTURE_MODE`, and none reads a secret;
 * - `release.yml` installs with `npm ci`, and runs the unit tests,
 *   `npm run l10n:check` and `npm audit --omit=dev --audit-level=high` before
 *   it builds;
 * - permissions are granted per job, `contents: write` only to the job that
 *   creates the release, `issues: write` only to the compatibility job;
 * - the update hash is generated in the workflow (`plan/00` §6 item 381): the
 *   file computes the XPI's SHA-512 and holds no hash literal;
 * - `compat.yml` runs weekly against the beta downloaded by URL, with no
 *   `ZOTERO_CHANNEL`, no `live-contract` job, and an issue on failure;
 * - `zotero-plugin-toolkit` is pinned exactly, in `package.json` and the
 *   lockfile, to the version installed.
 *
 * The reader is a small line-based one over GitHub's own layout (two-space
 * indentation, `jobs:` at column 0, one step per `- name:`), so the test adds
 * no YAML dependency; the files were also parsed with a full YAML parser when
 * they were written (`plan/reports/P7-T21.md`). Layer 1 (`docs/13` §2.1): no
 * network, no key.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** The workflows held to the pinning rules. */
const PINNED_WORKFLOWS = [
  ".github/workflows/release.yml",
  ".github/workflows/compat.yml",
  // P7-T21's Files row names ci.yml too (actions pinned, the audit step).
  ".github/workflows/ci.yml",
] as const;

/** Lines that are not comments, with their 0-based index. */
function codeLines(text: string): { line: string; at: number }[] {
  return text
    .split(/\r?\n/)
    .map((line, at) => ({ line, at }))
    .filter(({ line }) => !/^\s*#/.test(line));
}

interface Job {
  readonly name: string;
  readonly lines: readonly string[];
}

/** Each job under `jobs:`, with its lines (comments included). */
function jobsOf(text: string): Job[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  expect(start, "a top-level jobs: key").toBeGreaterThan(-1);
  const jobs: { name: string; lines: string[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (head) {
      jobs.push({ name: head[1] ?? "", lines: [] });
      continue;
    }
    jobs.at(-1)?.lines.push(line);
  }
  return jobs;
}

/** A job's `permissions:` block, as `scope: level` pairs. */
function permissionsOf(job: Job): Record<string, string> {
  const at = job.lines.findIndex((line) => /^ {4}permissions:/.test(line));
  if (at === -1) return {};
  const out: Record<string, string> = {};
  for (const line of job.lines.slice(at + 1)) {
    const pair = /^ {6}([a-z-]+):\s*([a-z]+)\s*$/.exec(line);
    if (!pair) break;
    out[pair[1] ?? ""] = pair[2] ?? "";
  }
  return out;
}

/** The `run:` command lines of every step, in order, with their line index. */
function runCommands(text: string): { command: string; at: number }[] {
  const out: { command: string; at: number }[] = [];
  for (const { line, at } of codeLines(text)) {
    const single = /^\s+run:\s+(?!\|)(.+)$/.exec(line);
    if (single) out.push({ command: (single[1] ?? "").trim(), at });
  }
  return out;
}

function indexOfCommand(text: string, pattern: RegExp): number {
  return (
    runCommands(text).find(({ command }) => pattern.test(command))?.at ?? -1
  );
}

describe("the workflow files' pinning rules (P7-T21, P7-T22)", () => {
  for (const path of PINNED_WORKFLOWS) {
    describe(path, () => {
      const text = read(path);

      it("pins every uses: to a full 40-hex commit, with its tag as a comment", () => {
        const uses = codeLines(text)
          .map(({ line }) => /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line)?.[1])
          .filter((value): value is string => value !== undefined);
        expect(uses.length).toBeGreaterThan(0);
        const unpinned = uses.filter(
          (value) =>
            !/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+){0,2}$/.test(
              value.trim(),
            ),
        );
        expect(unpinned, `unpinned uses: in ${path}`).toEqual([]);
      });

      it("sets no FIXTURE_MODE and reads no secret", () => {
        // Comments may name them, to record why they are gone.
        const code = codeLines(text)
          .map(({ line }) => line)
          .join("\n");
        expect(code).not.toMatch(/FIXTURE_MODE/);
        expect(code).not.toMatch(/secrets\./);
      });

      it("grants nothing at the top and names each job's permissions", () => {
        expect(text).toMatch(/^permissions: \{\}\s*$/m);
        for (const job of jobsOf(text)) {
          expect(
            Object.keys(permissionsOf(job)).length,
            `${path}: job ${job.name} names its permissions`,
          ).toBeGreaterThan(0);
        }
      });

      it("never puts a ${{ }} expression inside a multi-line run: script", () => {
        // Values reach the shell through env:, so a dispatched input cannot be
        // spliced into a command.
        const lines = text.split(/\r?\n/);
        const offenders: string[] = [];
        for (let i = 0; i < lines.length; i += 1) {
          const head = /^(\s+)run:\s*\|\s*$/.exec(lines[i] ?? "");
          if (!head) continue;
          const indent = (head[1] ?? "").length;
          for (let j = i + 1; j < lines.length; j += 1) {
            const line = lines[j] ?? "";
            if (line.trim() !== "" && line.search(/\S/) <= indent) break;
            if (line.includes("${{"))
              offenders.push(`${String(j + 1)}: ${line.trim()}`);
          }
        }
        expect(offenders, `${path}: expressions inside run scripts`).toEqual(
          [],
        );
      });
    });
  }
});

describe(".github/workflows/release.yml (P7-T21)", () => {
  const text = read(".github/workflows/release.yml");

  it("installs with npm ci, and runs the tests, the l10n check and the audit before the build", () => {
    const ci = indexOfCommand(text, /^npm ci$/);
    const tests = indexOfCommand(text, /^npm test$/);
    const l10n = indexOfCommand(text, /^npm run l10n:check$/);
    const audit = indexOfCommand(
      text,
      /^npm audit --omit=dev --audit-level=high$/,
    );
    const build = indexOfCommand(text, /^npm run build$/);
    for (const [name, at] of Object.entries({
      ci,
      tests,
      l10n,
      audit,
      build,
    })) {
      expect(at, `release.yml runs ${name}`).toBeGreaterThan(-1);
    }
    expect(ci).toBeLessThan(tests);
    expect(Math.max(tests, l10n, audit)).toBeLessThan(build);
    expect(text).not.toMatch(/npm install\b/);
  });

  it("refuses a tag that disagrees with package.json or with the built manifest", () => {
    expect(text).toMatch(
      /Tag \$RELEASE_TAG does not match package\.json version/,
    );
    expect(text).toContain('".scaffold/build/addon/manifest.json"');
    expect(text).toMatch(/built manifest\.json says .* the tag says/);
  });

  it("holds contents: write in the publishing job alone", () => {
    const jobs = jobsOf(text);
    const writers = jobs.filter(
      (job) => permissionsOf(job).contents === "write",
    );
    expect(writers.map((job) => job.name)).toEqual(["publish"]);
    const publish = writers[0]!;
    expect(publish.lines.join("\n")).toMatch(/softprops\/action-gh-release@/);
    expect(publish.lines.join("\n")).toMatch(/git push origin release/);
    for (const job of jobs) {
      const levels = Object.entries(permissionsOf(job)).filter(
        ([scope, level]) => level === "write" && scope !== "contents",
      );
      expect(levels, `job ${job.name} writes nothing else`).toEqual([]);
    }
    const build = jobs.find((job) => job.name === "build");
    expect(build && permissionsOf(build)).toEqual({ contents: "read" });
    // No test, script or dependency runs in the job that can write.
    expect(publish.lines.join("\n")).not.toMatch(/npm (ci|test|run)/);
  });

  it("generates the update hash in the run and holds none (plan/00 §6 item 381)", () => {
    expect(text).toContain('createHash("sha512")');
    expect(text).toContain("/^sha512:[0-9a-f]{128}$/");
    expect(text).toMatch(/update_hash is not this run's XPI/);
    // No hash literal anywhere: a transcribed hash would be one.
    expect(text).not.toMatch(/sha(?:256|512):[0-9a-f]{32,}/);
    expect(text).not.toMatch(/\b[0-9a-f]{64,}\b/);
  });

  it("is triggered by a version tag or by hand, nothing else", () => {
    const on = text.slice(
      text.indexOf("\non:"),
      text.indexOf("\npermissions:"),
    );
    expect(on).toMatch(/push:\s+tags:\s+- "v\*\.\*\.\*"/);
    expect(on).toMatch(/workflow_dispatch:/);
    expect(on).not.toMatch(/branches:|pull_request|schedule/);
  });
});

describe(".github/workflows/compat.yml (P7-T22)", () => {
  const text = read(".github/workflows/compat.yml");
  const code = codeLines(text)
    .map(({ line }) => line)
    .join("\n");

  it("runs weekly and on demand", () => {
    expect(code).toMatch(/schedule:\s+- cron: "17 4 \* \* 1"/);
    expect(code).toMatch(/workflow_dispatch:/);
    expect(code).not.toMatch(/\bpush:|pull_request/);
  });

  it("downloads the beta by URL from Zotero's beta channel, and does not rely on ZOTERO_CHANNEL", () => {
    expect(code).toContain(
      'ZOTERO_BETA_URL: "https://www.zotero.org/download/client/dl?channel=beta&platform=linux-x86_64"',
    );
    expect(code).toMatch(/ZOTERO_PLUGIN_ZOTERO_BIN_PATH=\$bin/);
    expect(code).not.toMatch(/ZOTERO_CHANNEL/);
    expect(indexOfCommand(text, /^npm ci$/)).toBeGreaterThan(-1);
    expect(
      indexOfCommand(text, /^npm run test:integration -- --exit-on-finish/),
    ).toBeGreaterThan(-1);
  });

  it("has one job, with contents: read and issues: write only, and no live-contract job", () => {
    const jobs = jobsOf(text);
    expect(jobs.map((job) => job.name)).toEqual(["zotero-beta"]);
    expect(permissionsOf(jobs[0]!)).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(code).not.toMatch(/live-contract/);
    expect(code).not.toMatch(/continue-on-error/);
  });

  it("opens or updates one issue with the run link when the run fails", () => {
    const at = text.indexOf("- name: Open or update the compatibility issue");
    expect(at).toBeGreaterThan(-1);
    const step = text.slice(at);
    expect(step).toMatch(/if: failure\(\)/);
    expect(step).toContain("GH_TOKEN: ${{ github.token }}");
    expect(step).toContain("actions/runs/${GITHUB_RUN_ID}");
    expect(step).toMatch(/gh issue comment "\$number"/);
    expect(step).toMatch(/gh issue create/);
    expect(step).not.toMatch(/--label/);
  });
});

describe(".github/workflows/ci.yml (P7-T21)", () => {
  const text = read(".github/workflows/ci.yml");

  it("audits the runtime dependencies in the lint job, and every job reads only", () => {
    const lint = jobsOf(text).find((job) => job.name === "lint");
    expect(lint, "a lint job").toBeDefined();
    expect(
      runCommands(lint?.lines.join("\n") ?? "").map(({ command }) => command),
    ).toContain("npm audit --omit=dev --audit-level=high");
    for (const job of jobsOf(text)) {
      expect(permissionsOf(job), `ci.yml: job ${job.name}`).toEqual({
        contents: "read",
      });
    }
  });
});

describe("the runtime dependency pin (P7-T21, docs/09 §6.3)", () => {
  it("pins zotero-plugin-toolkit exactly, in package.json and the lockfile, to the installed version", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };
    const installed = (
      JSON.parse(read("node_modules/zotero-plugin-toolkit/package.json")) as {
        version: string;
      }
    ).version;
    const declared = pkg.dependencies?.["zotero-plugin-toolkit"];
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    expect(declared).toBe(installed);
    expect(lock.packages[""]?.dependencies?.["zotero-plugin-toolkit"]).toBe(
      declared,
    );
    expect(lock.packages["node_modules/zotero-plugin-toolkit"]?.version).toBe(
      declared,
    );
    // Every runtime dependency is exact, not only this one (docs/09 §6.3).
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      expect(range, `${name} is pinned exactly`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

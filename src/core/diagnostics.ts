/**
 * The diagnostics text (`plan/10` `P7-T13`; `docs/07` §10.4 "As v1.0 ships";
 * `docs/10` FR-54; `docs/09` §7).
 *
 * One UTF-8 plain-text block in six sections, in `docs/07` §10.4's order:
 * environment, settings, recent jobs, the last log lines, recent errors and
 * cache statistics. It carries **no API key and no paper content**, and no
 * user-chosen path or contact address.
 *
 * ## Callers and construction (`plan/README.md` §5 rule 10)
 *
 * - **Caller:** the preferences pane's host, through `diagnosticsText` in
 *   `src/bootstrap/registerUI.ts` (`preferencesDiagnosticsPort`), which reads
 *   the platform and hands this module plain data. Nothing else builds it.
 * - **Pure.** `core/` may import only `model/` and `core/` (`eslint.config.js`),
 *   so every input arrives through {@link DiagnosticsInput}; nothing here names
 *   `Zotero`, the preferences or the job store.
 *
 * ## What keeps a key and a title out
 *
 * 1. **Only fields chosen here are read.** A job contributes its pipeline,
 *    state, counts and error code; never its input, its progress message, its
 *    checkpoint or its error's free-text detail, which is where a query or a
 *    title would be.
 * 2. **A withheld setting is "set" or "not set"**: every `secret` one, and every
 *    one the caller names as withheld (the contact address, a local folder).
 * 3. **Every line passes through `redact`**, the one redactor
 *    (`src/core/errors.ts`), after it is built, as a second gate for anything
 *    key-shaped that reached a log line or an error some other way.
 * 4. **The caller's `withheldValues`** (the contact address, the linked folder)
 *    are replaced wherever they occur, so a value that slipped into a log line
 *    is not copied out with it.
 */

import { redact } from "./errors";
import type { JobRecord } from "./jobQueue/jobRecord";

/** One preference, as the caller read it. */
export interface DiagnosticsSetting {
  readonly name: string;
  readonly value: unknown;
  /** `secret: true` in the schema, or named withheld by the caller. */
  readonly withheld: boolean;
}

/** One job, already narrowed to what the text may show. */
export interface DiagnosticsJob {
  readonly pipelineId: string;
  readonly status: string;
  readonly createdAtEpochMs: number;
  readonly completed: number;
  readonly total: number | undefined;
  readonly attemptCount: number;
  /** The error's `code` only; its `detail` is free text. */
  readonly errorCode: string | undefined;
}

/**
 * Narrow a job record to {@link DiagnosticsJob}: the fields named there and
 * nothing else. Its input (queries, item keys), its progress message (a title
 * may be in it), its checkpoint, its warnings and its error's `detail` are
 * never read.
 *
 * @param record - from the job store
 */
export function diagnosticsJob(record: JobRecord): DiagnosticsJob {
  return {
    pipelineId: record.pipelineId,
    status: record.status,
    createdAtEpochMs: record.createdAtEpochMs,
    completed: record.progress.completed,
    total: record.progress.total,
    attemptCount: record.attemptCount,
    errorCode: record.error?.code,
  };
}

/** Cache counts and sizes only (`CacheStats`, values never). */
export interface DiagnosticsCache {
  readonly entries: number;
  readonly bytes: number;
  readonly byNamespace: Readonly<
    Record<string, { readonly entries: number; readonly bytes: number }>
  >;
}

/** Everything the text is built from. */
export interface DiagnosticsInput {
  readonly generatedAtEpochMs: number;
  readonly pluginVersion: string;
  readonly zoteroVersion: string;
  readonly os: string;
  readonly locale: string;
  readonly settings: readonly DiagnosticsSetting[];
  /** Whether each key is in the keystore, by its secret id. Never the key. */
  readonly keysPresent: Readonly<Record<string, boolean>>;
  readonly jobs: readonly DiagnosticsJob[];
  readonly logLines: readonly string[];
  readonly errors: readonly string[];
  readonly cache: DiagnosticsCache | undefined;
  /**
   * Values that must not appear anywhere in the text (the contact address,
   * the linked folder): each is replaced by {@link WITHHELD_MARK}.
   */
  readonly withheldValues: readonly string[];
  /**
   * `logRequestBodies` is on. The log lines and the errors are then left out
   * whole (the card's **Do NOT**): a body is free text from a request or an
   * answer, and no rule here can tell which part of a line came from one.
   */
  readonly requestBodiesLogged: boolean;
}

/** What stands in for the log lines and the errors while bodies are logged. */
export const BODIES_LEFT_OUT =
  "left out: request bodies are being logged (logRequestBodies is on)";

/** How many jobs the text lists, newest first (`docs/07` §10.4 item 3). */
export const DIAGNOSTICS_JOB_LIMIT = 50;

/** How many recent errors it lists, newest last. */
export const DIAGNOSTICS_ERROR_LIMIT = 100;

/** What a withheld value is replaced by, in the text. */
export const WITHHELD_MARK = "[withheld]";

/** The six section headings, in `docs/07` §10.4's order. */
export const DIAGNOSTICS_SECTIONS = [
  "environment",
  "settings",
  "recent jobs",
  "the last log lines",
  "recent errors",
  "cache statistics",
] as const;

function heading(name: (typeof DIAGNOSTICS_SECTIONS)[number]): string {
  return `== ${name} ==`;
}

function settingValue(setting: DiagnosticsSetting): string {
  if (setting.withheld) {
    const empty =
      setting.value === undefined ||
      setting.value === null ||
      setting.value === "";
    return empty ? "not set" : "set";
  }
  return JSON.stringify(setting.value) ?? "undefined";
}

function jobLine(job: DiagnosticsJob): string {
  const total = job.total === undefined ? "?" : String(job.total);
  return [
    new Date(job.createdAtEpochMs).toISOString(),
    job.pipelineId,
    job.status,
    `${String(job.completed)}/${total}`,
    `attempts ${String(job.attemptCount)}`,
    job.errorCode === undefined ? "" : `error ${job.errorCode}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** Replace every withheld value, longest first, so one inside another goes too. */
function withhold(text: string, values: readonly string[]): string {
  let out = text;
  const sorted = [...values]
    .filter((value) => value.trim().length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const value of sorted) out = out.split(value).join(WITHHELD_MARK);
  return out;
}

/**
 * Build the diagnostics text.
 *
 * @param input - see {@link DiagnosticsInput}
 * @returns the whole text, every line through `redact`
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const lines: string[] = [
    "Research Helper diagnostics",
    `Generated ${new Date(input.generatedAtEpochMs).toISOString()}. ` +
      "No API key and no paper content is included.",
    "",
    heading("environment"),
    `plugin ${input.pluginVersion}`,
    `Zotero ${input.zoteroVersion}`,
    `OS ${input.os}`,
    `locale ${input.locale}`,
    ...Object.entries(input.keysPresent)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, present]) => `key ${id}: ${present ? "set" : "not set"}`),
    "",
    heading("settings"),
    ...[...input.settings]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((setting) => `${setting.name} = ${settingValue(setting)}`),
    "",
    heading("recent jobs"),
    ...[...input.jobs]
      .sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs)
      .slice(0, DIAGNOSTICS_JOB_LIMIT)
      .map(jobLine),
    "",
    heading("the last log lines"),
    ...(input.requestBodiesLogged ? [BODIES_LEFT_OUT] : input.logLines),
    "",
    heading("recent errors"),
    ...(input.requestBodiesLogged
      ? [BODIES_LEFT_OUT]
      : input.errors.slice(-DIAGNOSTICS_ERROR_LIMIT)),
    "",
    heading("cache statistics"),
    ...(input.cache === undefined
      ? ["unavailable"]
      : [
          `total: ${String(input.cache.entries)} entries, ${String(input.cache.bytes)} bytes`,
          ...Object.entries(input.cache.byNamespace)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([namespace, stats]) =>
                `${namespace}: ${String(stats.entries)} entries, ${String(stats.bytes)} bytes`,
            ),
        ]),
    "",
  ];
  return lines
    .map((line) =>
      redact(withhold(line.replace(/[\r\n]+/gu, " "), input.withheldValues)),
    )
    .join("\n");
}

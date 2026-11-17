import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  DIAGNOSTICS_JOB_LIMIT,
  DIAGNOSTICS_SECTIONS,
  WITHHELD_MARK,
  buildDiagnostics,
  diagnosticsJob,
  type DiagnosticsInput,
} from "../../../src/core/diagnostics";
import { createJobRecord } from "../../../src/core/jobQueue/jobRecord";
import {
  LOG_PREFIX,
  createLogRing,
  createLogger,
  withLogRing,
  type LogSink,
} from "../../../src/core/logger";

/**
 * `P7-T13`: the diagnostics text. Plain Node, no Zotero.
 *
 * Every planted value is synthetic and has a provider key's shape, so `redact`
 * has something real to catch; none is a key.
 */

/** SYNTHETIC key shapes, one per provider, plus a 32-character unprefixed one. */
const PLANTED_KEYS = [
  `sk-or-v1-${"a1b2c3d4".repeat(8)}`,
  `sk-proj-${"Q9w8E7r6".repeat(6)}`,
  `sk-ant-api03-${"Zx".repeat(40)}`,
  `AIza${"S".repeat(35)}`,
  "0123456789abcdef0123456789abcdef",
] as const;

/** SYNTHETIC paper title and query. */
const PLANTED_TITLE = "Planted Title Of A Paper That Must Not Leave";
const PLANTED_QUERY = "planted private query about a rare disease";
const PLANTED_EMAIL = "planted.person@example.org";
const PLANTED_FOLDER = "D:\\Planted\\Linked Audio Folder";

function emptyInput(): DiagnosticsInput {
  return {
    generatedAtEpochMs: Date.UTC(2026, 10, 17, 12, 0, 0),
    pluginVersion: "0.0.2",
    zoteroVersion: "10.0.3",
    os: "WINNT",
    locale: "en-US",
    settings: [],
    keysPresent: {},
    jobs: [],
    logLines: [],
    errors: [],
    cache: undefined,
    withheldValues: [],
    requestBodiesLogged: false,
  };
}

/** A log line as the real logger writes it, through the real ring. */
function loggedLines(write: (log: ReturnType<typeof createLogger>) => void) {
  const ring = createLogRing(100);
  const sink: LogSink = { write: () => undefined };
  const log = createLogger({
    sink: withLogRing(sink, ring),
    clock: createManualClock(0),
    level: "debug",
  });
  write(log);
  return ring.lines();
}

function assertNoPlantedValue(text: string): void {
  for (const key of PLANTED_KEYS) {
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(0, 16));
  }
  expect(text).not.toContain(PLANTED_TITLE);
  expect(text).not.toContain(PLANTED_QUERY);
  expect(text).not.toContain(PLANTED_EMAIL);
  expect(text).not.toContain(PLANTED_FOLDER);
}

describe("P7-T13 — buildDiagnostics: the six sections", () => {
  it("prints the six headings in docs/07 §10.4's order and says no key or paper content is included", () => {
    const text = buildDiagnostics(emptyInput());
    const at = DIAGNOSTICS_SECTIONS.map((name) =>
      text.indexOf(`== ${name} ==`),
    );
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain("No API key and no paper content is included.");
  });

  it("prints the environment, each key as set or not set, and the cache counts", () => {
    const text = buildDiagnostics({
      ...emptyInput(),
      keysPresent: { "llm.openrouter": true, "source.ncbi": false },
      cache: {
        entries: 3,
        bytes: 300,
        byNamespace: { summary: { entries: 2, bytes: 200 } },
      },
    });
    expect(text).toContain("plugin 0.0.2");
    expect(text).toContain("Zotero 10.0.3");
    expect(text).toContain("OS WINNT");
    expect(text).toContain("locale en-US");
    expect(text).toContain("key llm.openrouter: set");
    expect(text).toContain("key source.ncbi: not set");
    expect(text).toContain("total: 3 entries, 300 bytes");
    expect(text).toContain("summary: 2 entries, 200 bytes");
  });

  it("says the cache is unavailable when there are no stats", () => {
    expect(buildDiagnostics(emptyInput())).toMatch(
      /== cache statistics ==\nunavailable/u,
    );
  });

  it("lists at most the newest jobs, newest first, with counts and the error code only", () => {
    const jobs = Array.from({ length: DIAGNOSTICS_JOB_LIMIT + 5 }, (_, i) => ({
      pipelineId: "summarize",
      status: i === 0 ? "failed" : "succeeded",
      createdAtEpochMs: Date.UTC(2026, 10, 1) + i * 1000,
      completed: i,
      total: 10,
      attemptCount: 1,
      errorCode: i === DIAGNOSTICS_JOB_LIMIT + 4 ? "OFFLINE" : undefined,
    }));
    const text = buildDiagnostics({ ...emptyInput(), jobs });
    const section = text
      .split("== recent jobs ==\n")[1]!
      .split("\n\n")[0]!
      .split("\n");
    expect(section).toHaveLength(DIAGNOSTICS_JOB_LIMIT);
    expect(section[0]).toContain(`${String(DIAGNOSTICS_JOB_LIMIT + 4)}/10`);
    expect(section[0]).toContain("error OFFLINE");
    // The five oldest (completed 0 to 4) are not listed: the last line is the
    // sixth oldest.
    expect(section[DIAGNOSTICS_JOB_LIMIT - 1]).toContain(" · 5/10 · ");
    for (let i = 0; i < 5; i += 1) {
      expect(
        section.some((line) => line.includes(` · ${String(i)}/10 · `)),
      ).toBe(false);
    }
  });

  it("keeps each line on one line", () => {
    const text = buildDiagnostics({
      ...emptyInput(),
      errors: ["first part\nsecond part"],
    });
    expect(text).toContain("first part second part");
  });
});

describe("P7-T13 — buildDiagnostics: planted values never appear", () => {
  it("withholds a withheld setting's value as set or not set, and prints the others", () => {
    const text = buildDiagnostics({
      ...emptyInput(),
      settings: [
        { name: "contactEmail", value: PLANTED_EMAIL, withheld: true },
        { name: "tts.linkedFileDir", value: "", withheld: true },
        { name: "concurrency", value: 3, withheld: false },
      ],
    });
    expect(text).toContain("contactEmail = set");
    expect(text).toContain("tts.linkedFileDir = not set");
    expect(text).toContain("concurrency = 3");
    assertNoPlantedValue(text);
  });

  it("keeps a planted key out of a log line, a setting, a job error and a header", () => {
    const lines = loggedLines((log) => {
      for (const key of PLANTED_KEYS) {
        log.warn(`request failed with key ${key}`, {
          headers: { Authorization: `Bearer ${key}` },
          apiKey: key,
        });
      }
    });
    const text = buildDiagnostics({
      ...emptyInput(),
      settings: PLANTED_KEYS.map((key, i) => ({
        name: `planted.${String(i)}`,
        value: key,
        withheld: false,
      })),
      logLines: lines,
      errors: PLANTED_KEYS.map(
        (key) => `${LOG_PREFIX} Authorization: Bearer ${key}`,
      ),
      jobs: [
        {
          pipelineId: "summarize",
          status: "failed",
          createdAtEpochMs: 0,
          completed: 0,
          total: 1,
          attemptCount: 1,
          errorCode: `AUTH ${PLANTED_KEYS[0]}`,
        },
      ],
    });
    expect(lines.length).toBe(PLANTED_KEYS.length);
    assertNoPlantedValue(text);
    expect(text).toContain("[redacted:");
  });

  it("keeps a planted paper title and query in a job record out (diagnosticsJob)", () => {
    const base = createJobRecord({
      id: "job-1",
      pipelineId: "summarize",
      input: { query: PLANTED_QUERY, titles: [PLANTED_TITLE] },
      createdAtEpochMs: Date.UTC(2026, 10, 17),
      createdByPluginVersion: "0.0.2",
    });
    const record = {
      ...base,
      status: "failed" as const,
      attemptCount: 2,
      progress: {
        completed: 3,
        total: 4,
        currentStageKey: "llm",
        message: `Summarizing ${PLANTED_TITLE}`,
      },
      checkpoint: { lastTitle: PLANTED_TITLE },
      warnings: [`skipped ${PLANTED_TITLE}`],
      error: {
        code: "PROVIDER",
        messageKey: "rh-error-provider",
        detail: `failed on ${PLANTED_TITLE} for ${PLANTED_QUERY}`,
        retryable: false,
      },
    };
    const job = diagnosticsJob(record);
    expect(job).toEqual({
      pipelineId: "summarize",
      status: "failed",
      createdAtEpochMs: Date.UTC(2026, 10, 17),
      completed: 3,
      total: 4,
      attemptCount: 2,
      errorCode: "PROVIDER",
    });
    const text = buildDiagnostics({ ...emptyInput(), jobs: [job] });
    expect(text).toContain(
      "summarize · failed · 3/4 · attempts 2 · error PROVIDER",
    );
    assertNoPlantedValue(text);
  });

  it("removes a withheld value wherever it occurs", () => {
    const text = buildDiagnostics({
      ...emptyInput(),
      logLines: [`saved to ${PLANTED_FOLDER}\\report.wav by ${PLANTED_EMAIL}`],
      errors: [`could not open ${PLANTED_FOLDER}`],
      withheldValues: [PLANTED_EMAIL, PLANTED_FOLDER],
    });
    assertNoPlantedValue(text);
    expect(text).toContain(WITHHELD_MARK);
  });

  it("leaves the log lines and the errors out while request bodies are logged", () => {
    const text = buildDiagnostics({
      ...emptyInput(),
      logLines: ["a line with a body"],
      errors: ["an error with a body"],
      requestBodiesLogged: true,
    });
    expect(text).not.toContain("a line with a body");
    expect(text).not.toContain("an error with a body");
    expect(text).toContain("left out");
  });
});

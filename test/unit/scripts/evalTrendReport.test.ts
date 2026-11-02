/**
 * `scripts/eval-trend-report.ts` — the evaluation harness's formats and scoring
 * (`P4-T23`; `docs/06` §12.3's notes of 2026-11-02).
 *
 * **Every input is hand-made**, and every theme here is marked as a test
 * string: no expected theme of the owner's and no output of the pipeline is
 * involved. **What this pins above all:** the score comes from the owner's
 * answers alone, so an identical name is not a match and a different name can
 * be; a missing answer is refused rather than counted; a `both` run counts its
 * recall once and never reads `usage`; and the terminal shows figures only.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no network, no key, no model. The
 * database tests write only into fresh temporary directories they remove, on
 * `REPORT_DDL` itself so a change to the table breaks them.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  answerTokensOf,
  answersFromExport,
  buildSheet,
  EVAL_SET_IDS,
  EvalRefusal,
  type EvalRun,
  EXPECTED_THEMES_FORMAT,
  type ExpectedThemes,
  formatMeasurement,
  formatScore,
  groupRuns,
  isInside,
  main,
  measurementOf,
  parseExpectedThemes,
  parseStoredReport,
  pickRun,
  readStoredReports,
  REPO_ROOT,
  scoreRun,
  type StoredReport,
  SYNTHETIC_SET_ID,
  THEME_CLUSTER_ASSUMED_PER_PAPER,
} from "../../../scripts/eval-trend-report";
import { REPORT_DDL } from "../../../src/bootstrap/migrations";

const FIXTURE_DIR = resolve(REPO_ROOT, "test/fixtures/trend-eval");
const SCRIPT = resolve(REPO_ROOT, "scripts/eval-trend-report.ts");

const KEY_A = "AAAAAAA1";
const KEY_B = "AAAAAAA2";
const KEY_C = "AAAAAAA3";
const KEY_D = "AAAAAAA4";

// Text that must never reach the terminal.
const COLLECTION_NAME = "TEST-COLLECTION-NAME";
const EXPECTED_NAME_1 = "TEST-EXPECTED-NAME-ONE";
const EXPECTED_NAME_2 = "TEST-EXPECTED-NAME-TWO";
const EXPECTED_NAME_3 = "TEST-EXPECTED-NAME-THREE";
const EXPECTED_NOTE = "TEST-EXPECTED-NOTE";
const PRODUCED_NAME_1 = "TEST-PRODUCED-NAME-ONE";
const PRODUCED_NAME_2 = "TEST-PRODUCED-NAME-TWO";
const PRODUCED_DEFINITION = "TEST-PRODUCED-DEFINITION";
const REPORT_TEXT = "TEST-REPORT-TEXT";
/** A sentinel figure in a record's `usage`; see "never reads usage". */
const USAGE_COST = 987.654;
const USAGE_TOKENS = 7654321;

function setFile(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: EXPECTED_THEMES_FORMAT,
    setId: "small",
    collectionName: COLLECTION_NAME,
    writtenBy: "owner",
    writtenOn: "2026-11-02",
    itemKeys: [KEY_A, KEY_B, KEY_C],
    themes: [
      { id: "E1", name: EXPECTED_NAME_1, note: EXPECTED_NOTE },
      { id: "E2", name: EXPECTED_NAME_2 },
      { id: "E3", name: EXPECTED_NAME_3 },
    ],
    ...overrides,
  };
}

const SET: ExpectedThemes = parseExpectedThemes(setFile());

/** A hand-made `runMeasurement`: a shared call, then each language's own. */
const MEASUREMENT = {
  calls: [
    {
      promptId: "THEME_CLUSTER",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      reasoningTokens: 50,
      costUsd: 0.001,
      maxOutputTokens: 2400,
      papers: 10,
    },
    {
      promptId: "TREND_REPORT_EN",
      language: "en",
      inputTokens: 200,
      outputTokens: 400,
      totalTokens: 600,
      maxOutputTokens: 8192,
    },
    {
      promptId: "TREND_REPORT_KO",
      language: "ko",
      inputTokens: 300,
      outputTokens: 500,
      totalTokens: 800,
      costUsd: 0.002,
    },
  ],
  themeAnalyses: [
    { tokens: 1000, narrativeTokens: 400, papers: 12 },
    { tokens: 3000, narrativeTokens: 1200, papers: 7 },
  ],
};

/** A stored row's record, `usage` and the rest included, as the store writes it. */
function record(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "report-en",
    libraryID: 1,
    collectionKey: "COLLKEY1",
    collectionName: COLLECTION_NAME,
    language: "en",
    generatedAtEpochMs: 1_000,
    clustering: {
      themes: [
        {
          themeId: "T1",
          name: PRODUCED_NAME_1,
          definition: PRODUCED_DEFINITION,
          itemKeys: [KEY_A, KEY_B],
        },
        {
          themeId: "T2",
          name: PRODUCED_NAME_2,
          definition: PRODUCED_DEFINITION,
          itemKeys: [KEY_C],
        },
      ],
      assignments: [
        { itemKey: KEY_A, primaryThemeId: "T1", fit: "strong" },
        { itemKey: KEY_B, primaryThemeId: "T1", fit: "strong" },
        { itemKey: KEY_C, primaryThemeId: "T2", fit: "weak" },
      ],
    },
    sections: [
      {
        number: 4,
        heading: "4. Major Research Themes",
        markdown: `### ${PRODUCED_NAME_1}\n\n${REPORT_TEXT}\n\n### ${PRODUCED_NAME_2}  \n\n${REPORT_TEXT}`,
        citedItemKeys: [],
      },
    ],
    excluded: [],
    retracted: [],
    qualityProxies: {
      citationDensity: 0.5,
      coverageRatio: 0.75,
      brokenCitationCount: 2,
      meanGroundingScore: 0.25,
      contradictionCount: 3,
      unresolvedHighSeverityCount: 4,
    },
    usage: {
      inputTokens: USAGE_TOKENS,
      outputTokens: USAGE_TOKENS,
      totalTokens: USAGE_TOKENS,
      costUsd: USAGE_COST,
    },
    ...overrides,
  };
}

function stored(overrides: Record<string, unknown> = {}): StoredReport {
  return parseStoredReport(JSON.stringify(record(overrides)));
}

function oneRun(reports: readonly StoredReport[] = [stored()]): EvalRun {
  return groupRuns(reports)[0] as EvalRun;
}

function answers(
  entries: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(Object.entries(entries));
}

function refusal(body: () => unknown): string {
  try {
    body();
  } catch (error) {
    expect(error).toBeInstanceOf(EvalRefusal);
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("expected-themes.json: metadata only, the owner's", () => {
  it("accepts the format", () => {
    expect(SET.themes.map((theme) => theme.id)).toEqual(["E1", "E2", "E3"]);
    expect(SET.themes[0]?.note).toBe(EXPECTED_NOTE);
    expect(SET.themes[1]).not.toHaveProperty("note");
  });

  it("accepts Korean text", () => {
    const set = parseExpectedThemes(
      setFile({ themes: [{ id: "E1", name: "한글로 쓴 시험용 주제 이름" }] }),
    );
    expect(set.themes[0]?.name).toBe("한글로 쓴 시험용 주제 이름");
  });

  it.each([
    ["an unknown member of the file", setFile({ abstracts: ["x"] })],
    [
      "an unknown member of a theme",
      setFile({ themes: [{ id: "E1", name: "x", abstract: "paper text" }] }),
    ],
    ["another format", setFile({ format: "trend-eval-expected-themes/2" })],
    ["an unknown set", setFile({ setId: "huge" })],
    ["no author", setFile({ writtenBy: undefined })],
    ["a model as author", setFile({ writtenBy: "model" })],
    ["a bad date", setFile({ writtenOn: "2 Nov 2026" })],
    ["no collection name", setFile({ collectionName: "" })],
    ["a two-line collection name", setFile({ collectionName: "a\nb" })],
    ["no item keys", setFile({ itemKeys: [] })],
    ["a lower-case key", setFile({ itemKeys: ["aaaaaaa1"] })],
    ["a short key", setFile({ itemKeys: ["AAA"] })],
    ["a repeated key", setFile({ itemKeys: [KEY_A, KEY_A] })],
    ["no themes", setFile({ themes: [] })],
    [
      "a theme id of the model's",
      setFile({ themes: [{ id: "T1", name: "x" }] }),
    ],
    [
      "a repeated theme id",
      setFile({
        themes: [
          { id: "E1", name: "x" },
          { id: "E1", name: "y" },
        ],
      }),
    ],
    ["an empty name", setFile({ themes: [{ id: "E1", name: " " }] })],
    ["a two-line name", setFile({ themes: [{ id: "E1", name: "a\nb" }] })],
    [
      "a name of 121 characters",
      setFile({ themes: [{ id: "E1", name: "x".repeat(121) }] }),
    ],
    [
      "a note of 401 characters",
      setFile({ themes: [{ id: "E1", name: "x", note: "x".repeat(401) }] }),
    ],
    ["not an object", ["x"]],
  ])("refuses %s", (_title, value) => {
    expect(() => parseExpectedThemes(value)).toThrow(EvalRefusal);
  });

  it("takes a name of exactly 120 characters and a note of exactly 400", () => {
    const set = parseExpectedThemes(
      setFile({
        themes: [{ id: "E1", name: "x".repeat(120), note: "x".repeat(400) }],
      }),
    );
    expect(set.themes).toHaveLength(1);
  });

  it("cannot be mistaken for the synthetic example, or the reverse", () => {
    expect(
      refusal(() =>
        parseExpectedThemes(
          setFile({ themes: [{ id: "E1", name: "SYNTHETIC theme" }] }),
        ),
      ),
    ).toContain("may not start");
    expect(
      refusal(() =>
        parseExpectedThemes(
          setFile({
            setId: SYNTHETIC_SET_ID,
            writtenBy: "nobody",
            themes: [{ id: "E1", name: "A theme that reads as real" }],
          }),
        ),
      ),
    ).toContain("starts with SYNTHETIC");
    expect(() =>
      parseExpectedThemes(setFile({ setId: SYNTHETIC_SET_ID })),
    ).toThrow(EvalRefusal);
  });
});

describe("the committed fixtures", () => {
  const json = (path: string): unknown =>
    JSON.parse(readFileSync(join(FIXTURE_DIR, path), "utf8"));

  it("the synthetic example parses and scores", () => {
    const set = parseExpectedThemes(
      json("synthetic-example/expected-themes.json"),
    );
    expect(set.setId).toBe(SYNTHETIC_SET_ID);
    expect(set.themes.every((t) => t.name.startsWith("SYNTHETIC"))).toBe(true);
    const run = oneRun([
      stored({
        id: "SYNTHETIC-RUN",
        collectionName: set.collectionName,
        clustering: {
          themes: [
            { themeId: "T1", name: "n", definition: "d", itemKeys: [] },
            { themeId: "T2", name: "n", definition: "d", itemKeys: [] },
          ],
          assignments: [
            { itemKey: "SYNTH001", primaryThemeId: "T1", fit: "strong" },
          ],
        },
      }),
    ]);
    const score = scoreRun(
      set,
      run,
      answersFromExport(
        json("synthetic-example/matches-export.json"),
        run.runId,
      ),
    );
    expect(score.matchedExpected).toBe(1);
    expect(score.expected).toBe(2);
  });

  it("every real set committed parses, under its own folder (none before G-23)", () => {
    for (const setId of EVAL_SET_IDS) {
      const path = join(setId, "expected-themes.json");
      if (!existsSync(join(FIXTURE_DIR, path))) continue;
      expect(parseExpectedThemes(json(path)).setId).toBe(setId);
    }
  });

  it("the folder holds only the three sets and the example, and only JSON", () => {
    const allowed: readonly string[] = [...EVAL_SET_IDS, SYNTHETIC_SET_ID];
    for (const entry of readdirSync(FIXTURE_DIR)) {
      expect(allowed).toContain(entry);
      expect(statSync(join(FIXTURE_DIR, entry)).isDirectory()).toBe(true);
      for (const file of readdirSync(join(FIXTURE_DIR, entry))) {
        expect(file).toMatch(/\.json$/);
      }
    }
  });
});

describe("theme recall: the owner's judgement, never a comparison", () => {
  it("is the expected themes with a match, over all expected themes", () => {
    const score = scoreRun(
      SET,
      oneRun(),
      answers({ E1: ["T1"], E2: ["T2"], E3: [] }),
    );
    expect(score.matchedExpected).toBe(2);
    expect(score.expected).toBe(3);
    expect(score.themeRecall).toBeCloseTo(2 / 3, 10);
    expect(score.producedThemes).toBe(2);
    expect(score.producedMatched).toBe(2);
  });

  it("an identical name with no answer naming it is not a match", () => {
    const set = parseExpectedThemes(
      setFile({ themes: [{ id: "E1", name: PRODUCED_NAME_1 }] }),
    );
    const score = scoreRun(set, oneRun(), answers({ E1: [] }));
    expect(score.matchedExpected).toBe(0);
    expect(score.themeRecall).toBe(0);
    expect(score.producedMatched).toBe(0);
  });

  it("a wholly different name the owner matched is a match", () => {
    const score = scoreRun(
      parseExpectedThemes(
        setFile({ themes: [{ id: "E1", name: "Nothing alike at all" }] }),
      ),
      oneRun(),
      answers({ E1: ["T2"] }),
    );
    expect(score.themeRecall).toBe(1);
    expect(score.producedMatched).toBe(1);
  });

  it("one expected theme matched by two produced themes counts once", () => {
    const score = scoreRun(
      SET,
      oneRun(),
      answers({ E1: ["T1", "T2"], E2: [], E3: [] }),
    );
    expect(score.matchedExpected).toBe(1);
    expect(score.producedMatched).toBe(2);
  });

  it("one produced theme may serve two expected themes", () => {
    const score = scoreRun(
      SET,
      oneRun(),
      answers({ E1: ["T1"], E2: ["T1"], E3: [] }),
    );
    expect(score.matchedExpected).toBe(2);
    expect(score.producedMatched).toBe(1);
  });

  it("refuses a missing answer rather than counting it as a miss", () => {
    const message = refusal(() =>
      scoreRun(SET, oneRun(), answers({ E1: ["T1"], E3: [] })),
    );
    expect(message).toContain("E2");
    expect(message).toContain("not counted as a miss");
  });

  it("refuses an answer for an expected theme the set does not have", () => {
    expect(
      refusal(() =>
        scoreRun(SET, oneRun(), answers({ E1: [], E2: [], E3: [], E4: [] })),
      ),
    ).toContain("E4");
  });

  it("refuses an answer naming a theme the run did not produce", () => {
    expect(
      refusal(() =>
        scoreRun(SET, oneRun(), answers({ E1: ["T9"], E2: [], E3: [] })),
      ),
    ).toContain("T9");
  });

  it("refuses a run that read a paper the set does not list", () => {
    const run = oneRun([
      stored({
        excluded: [{ itemKey: KEY_D, reason: "retracted" }],
      }),
    ]);
    expect(
      refusal(() => scoreRun(SET, run, answers({ E1: [], E2: [], E3: [] }))),
    ).toContain(KEY_D);
    const retracted = oneRun([
      stored({ retracted: [{ itemKey: KEY_D, text: "t", doi: undefined }] }),
    ]);
    expect(() =>
      scoreRun(SET, retracted, answers({ E1: [], E2: [], E3: [] })),
    ).toThrow(EvalRefusal);
    const unclustered = oneRun([
      stored({
        clustering: {
          themes: [],
          assignments: [],
          unclustered: [{ itemKey: KEY_D, reason: "r" }],
        },
      }),
    ]);
    expect(() =>
      scoreRun(SET, unclustered, answers({ E1: [], E2: [], E3: [] })),
    ).toThrow(EvalRefusal);
  });

  it("counts how many listed papers the run read, every way it can read one", () => {
    const set = parseExpectedThemes(
      setFile({
        itemKeys: [KEY_A, KEY_B, KEY_C, KEY_D, "AAAAAAA5", "AAAAAAA6"],
      }),
    );
    const none = answers({ E1: [], E2: [], E3: [] });
    const run = oneRun([
      stored({
        clustering: {
          themes: [],
          assignments: [{ itemKey: KEY_A, primaryThemeId: "T1", fit: "weak" }],
          unclustered: [{ itemKey: KEY_B, reason: "r" }],
        },
        excluded: [{ itemKey: KEY_C, reason: "r" }],
        retracted: [{ itemKey: KEY_D, text: "t", doi: undefined }],
      }),
    ]);
    const score = scoreRun(set, run, none);
    expect(score.papersRead).toBe(4);
    expect(score.papersListed).toBe(6);
  });
});

describe("a `both` run", () => {
  const en = stored();
  const ko = stored({ id: "report-ko", language: "ko" });

  it("is one run of two reports, English first whatever the row order", () => {
    for (const rows of [
      [en, ko],
      [ko, en],
    ]) {
      const runs = groupRuns(rows);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.runId).toBe("report-en");
      expect(runs[0]?.reports.map((r) => r.language)).toEqual(["en", "ko"]);
    }
  });

  it("another date or another collection is another run, newest first", () => {
    const later = stored({ id: "later", generatedAtEpochMs: 2_000 });
    const elsewhere = stored({ id: "elsewhere", collectionKey: "COLLKEY2" });
    const runs = groupRuns([en, later, elsewhere]);
    expect(runs).toHaveLength(3);
    expect(runs[0]?.runId).toBe("later");
  });

  it("counts recall once and gives proxies per report", () => {
    const score = scoreRun(
      SET,
      oneRun([
        en,
        stored({
          id: "report-ko",
          language: "ko",
          qualityProxies: {
            coverageRatio: 0.125,
            brokenCitationCount: 7,
            contradictionCount: 8,
            unresolvedHighSeverityCount: 9,
          },
        }),
      ]),
      answers({ E1: ["T1"], E2: [], E3: [] }),
    );
    expect(score.expected).toBe(3);
    expect(score.matchedExpected).toBe(1);
    expect(score.producedThemes).toBe(2);
    expect(score.papersRead).toBe(3);
    expect(score.reports.map((r) => [r.language, r.reportId])).toEqual([
      ["en", "report-en"],
      ["ko", "report-ko"],
    ]);
    expect(score.reports[1]?.proxies.brokenCitationCount).toBe(7);
  });

  it("a `both` run that saved only English scores as one report", () => {
    const score = scoreRun(
      SET,
      oneRun([en]),
      answers({ E1: [], E2: [], E3: [] }),
    );
    expect(score.reports).toHaveLength(1);
  });

  it("refuses two rows that disagree on the theme ids", () => {
    const other = stored({
      id: "report-ko",
      language: "ko",
      clustering: {
        themes: [{ themeId: "T9", name: "n", definition: "d", itemKeys: [] }],
        assignments: [],
      },
    });
    expect(
      refusal(() =>
        scoreRun(SET, oneRun([en, other]), answers({ E1: [], E2: [], E3: [] })),
      ),
    ).toContain("disagree");
    expect(() => buildSheet(SET, oneRun([en, other]))).toThrow(EvalRefusal);
  });

  it("never reads usage: a stored report does not carry it", () => {
    expect(en).not.toHaveProperty("usage");
  });
});

describe("what the terminal shows", () => {
  it("prints the figures read from the record, exactly", () => {
    const text = formatScore(
      scoreRun(SET, oneRun(), answers({ E1: ["T1"], E2: [], E3: [] })),
    );
    expect(text).toContain("set small");
    expect(text).toContain("run report-en");
    expect(text).toContain("papers read 3 of 3 listed");
    expect(text).toContain("theme recall 1/3 = 0.333");
    expect(text).toContain("produced themes 2, of which matched 1");
    expect(text).toContain("citation density 0.500");
    expect(text).toContain("coverage ratio 0.750");
    expect(text).toContain("broken citations 2");
    expect(text).toContain("mean grounding score 0.250");
    expect(text).toContain("contradictions 3");
    expect(text).toContain("unresolved high-severity problems 4");
  });

  it('prints "not measured" for a proxy the record lacks, never 0', () => {
    const run = oneRun([
      stored({
        qualityProxies: {
          coverageRatio: 0,
          brokenCitationCount: 0,
          contradictionCount: 0,
          unresolvedHighSeverityCount: 0,
        },
      }),
    ]);
    const text = formatScore(
      scoreRun(SET, run, answers({ E1: [], E2: [], E3: [] })),
    );
    expect(text).toContain("citation density not measured");
    expect(text).toContain("mean grounding score not measured");
    expect(text).toContain("coverage ratio 0.000");
  });

  it("prints no theme text, collection name, report text or usage", () => {
    const text = formatScore(
      scoreRun(
        SET,
        oneRun([stored(), stored({ id: "report-ko", language: "ko" })]),
        answers({ E1: ["T1"], E2: [], E3: [] }),
      ),
    );
    for (const secret of [
      COLLECTION_NAME,
      EXPECTED_NAME_1,
      EXPECTED_NAME_2,
      EXPECTED_NOTE,
      PRODUCED_NAME_1,
      PRODUCED_NAME_2,
      PRODUCED_DEFINITION,
      REPORT_TEXT,
      String(USAGE_COST),
      String(USAGE_TOKENS),
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("no refusal message carries theme text", () => {
    const messages = [
      refusal(() => scoreRun(SET, oneRun(), answers({}))),
      refusal(() =>
        scoreRun(SET, oneRun(), answers({ E1: ["T9"], E2: [], E3: [] })),
      ),
    ];
    for (const message of messages) {
      for (const secret of [
        EXPECTED_NAME_1,
        PRODUCED_NAME_1,
        COLLECTION_NAME,
      ]) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

describe("the owner's answers", () => {
  const run = "report-en";

  it.each([
    [
      "an array of documents",
      [
        { id: `${run}__E1`, themeIds: ["T1"] },
        { id: `${run}__E2`, themeIds: [] },
      ],
    ],
    [
      "an object keyed by document id",
      {
        [`${run}__E1`]: { themeIds: ["T1"] },
        [`${run}__E2`]: { themeIds: [] },
      },
    ],
    [
      "documents with the fields under data, in a rows list",
      {
        rows: [
          { doc_id: `${run}__E1`, data: { themeIds: ["T1"] } },
          { doc_id: `${run}__E2`, data: { themeIds: [] } },
        ],
      },
    ],
  ])("reads %s", (_title, exported) => {
    const read = answersFromExport(exported, run);
    expect(read.get("E1")).toEqual(["T1"]);
    expect(read.get("E2")).toEqual([]);
    expect(read.size).toBe(2);
  });

  it("skips other runs' documents, so one export can hold all three sets", () => {
    const read = answersFromExport(
      [
        { id: `${run}__E1`, themeIds: ["T1"] },
        { id: "report-en-2__E1", themeIds: ["T2"] },
        { id: "other__E2", themeIds: ["T2"] },
      ],
      run,
    );
    expect([...read.keys()]).toEqual(["E1"]);
    expect(read.get("E1")).toEqual(["T1"]);
  });

  it("ignores a page's bookkeeping members", () => {
    const read = answersFromExport(
      [{ id: `${run}__E1`, themeIds: [], updatedAt: "2026-11-02" }],
      run,
    );
    expect(read.get("E1")).toEqual([]);
  });

  it.each([
    ["no list", [{ id: `${run}__E1` }]],
    ["a list of other things", [{ id: `${run}__E1`, themeIds: [1] }]],
    ["a name in place of an id", [{ id: `${run}__E1`, themeIds: ["A name"] }]],
    ["one string", [{ id: `${run}__E1`, themeIds: "T1" }]],
  ])("refuses a document with %s", (_title, exported) => {
    expect(() => answersFromExport(exported, run)).toThrow(EvalRefusal);
  });

  it("refuses an export of no known shape", () => {
    expect(() => answersFromExport(3, run)).toThrow(EvalRefusal);
    expect(() => answersFromExport([{ themeIds: [] }], run)).toThrow(
      EvalRefusal,
    );
  });
});

describe("a stored row", () => {
  it("keeps what the script reads and nothing else", () => {
    expect(Object.keys(stored()).sort()).toEqual(
      [
        "clustering",
        "collectionKey",
        "collectionName",
        "excluded",
        "generatedAtEpochMs",
        "id",
        "language",
        "qualityProxies",
        "retracted",
        "sections",
      ].sort(),
    );
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["no id", JSON.stringify(record({ id: 3 }))],
    [
      "no collection name",
      JSON.stringify(record({ collectionName: undefined })),
    ],
    ["another language", JSON.stringify(record({ language: "de" }))],
    ["no date", JSON.stringify(record({ generatedAtEpochMs: "x" }))],
    ["no clustering", JSON.stringify(record({ clustering: undefined }))],
    [
      "a theme with no name",
      JSON.stringify(
        record({
          clustering: { themes: [{ themeId: "T1" }], assignments: [] },
        }),
      ),
    ],
    [
      "an assignment with no key",
      JSON.stringify(
        record({
          clustering: { themes: [], assignments: [{ primaryThemeId: "T1" }] },
        }),
      ),
    ],
    ["no sections", JSON.stringify(record({ sections: undefined }))],
    ["no exclusions", JSON.stringify(record({ excluded: undefined }))],
    ["no retractions", JSON.stringify(record({ retracted: undefined }))],
    ["no proxies", JSON.stringify(record({ qualityProxies: undefined }))],
    [
      "a required proxy missing",
      JSON.stringify(
        record({
          qualityProxies: {
            brokenCitationCount: 0,
            contradictionCount: 0,
            unresolvedHighSeverityCount: 0,
          },
        }),
      ),
    ],
    [
      "a proxy that is text",
      JSON.stringify(
        record({
          qualityProxies: {
            citationDensity: "high",
            coverageRatio: 0,
            brokenCitationCount: 0,
            contradictionCount: 0,
            unresolvedHighSeverityCount: 0,
          },
        }),
      ),
    ],
  ])("refuses %s", (_title, json) => {
    expect(() => parseStoredReport(json)).toThrow(EvalRefusal);
  });
});

describe("choosing the run", () => {
  it("takes the set's latest run by collection name", () => {
    const runs = groupRuns([
      stored({ id: "old" }),
      stored({ id: "new", generatedAtEpochMs: 2_000 }),
      stored({
        id: "other",
        collectionName: "ANOTHER-NAME",
        collectionKey: "COLLKEY2",
        generatedAtEpochMs: 3_000,
      }),
    ]);
    expect(pickRun(runs, SET).runId).toBe("new");
    expect(pickRun(runs, SET, "old").runId).toBe("old");
  });

  it("finds a `both` run through either report", () => {
    const runs = groupRuns([
      stored(),
      stored({ id: "report-ko", language: "ko" }),
    ]);
    expect(pickRun(runs, SET, "report-ko").runId).toBe("report-en");
  });

  it("refuses when nothing fits, or when two collections share the name", () => {
    expect(() => pickRun([], SET)).toThrow(EvalRefusal);
    const other = groupRuns([
      stored({ id: "other", collectionName: "ANOTHER-NAME" }),
    ]);
    expect(() => pickRun(other, SET)).toThrow(EvalRefusal);
    expect(() => pickRun(other, SET, "other")).toThrow(EvalRefusal);
    const twins = groupRuns([
      stored({ id: "one" }),
      stored({ id: "two", collectionKey: "COLLKEY2" }),
    ]);
    expect(refusal(() => pickRun(twins, SET))).toContain("--report");
    expect(pickRun(twins, SET, "two").runId).toBe("two");
  });
});

describe("the sheet for the review page", () => {
  it("holds both lists and suggests nothing", () => {
    const sheet = buildSheet(
      SET,
      oneRun([stored(), stored({ id: "report-ko", language: "ko" })]),
    );
    expect(sheet.runId).toBe("report-en");
    expect(sheet.expected).toEqual(SET.themes);
    expect(sheet.produced).toEqual([
      {
        themeId: "T1",
        name: PRODUCED_NAME_1,
        definition: PRODUCED_DEFINITION,
        papers: 2,
      },
      {
        themeId: "T2",
        name: PRODUCED_NAME_2,
        definition: PRODUCED_DEFINITION,
        papers: 1,
      },
    ]);
    expect(sheet.reports.map((r) => r.reportId)).toEqual([
      "report-en",
      "report-ko",
    ]);
    expect(sheet.reports[0]?.section4Headings).toEqual([
      PRODUCED_NAME_1,
      PRODUCED_NAME_2,
    ]);
  });

  it("holds no report prose and no usage", () => {
    const text = JSON.stringify(buildSheet(SET, oneRun()));
    expect(text).not.toContain(REPORT_TEXT);
    expect(text).not.toContain(String(USAGE_COST));
  });

  it("tells a repository path from any other", () => {
    expect(isInside(join(REPO_ROOT, "sheet.json"))).toBe(true);
    expect(isInside(join(REPO_ROOT, "docs", "sheet.json"))).toBe(true);
    expect(isInside(REPO_ROOT)).toBe(true);
    expect(isInside(join(REPO_ROOT, "..", "sheet.json"))).toBe(false);
    expect(isInside(join(tmpdir(), "sheet.json"))).toBe(false);
    expect(isInside(`${REPO_ROOT}-sibling/sheet.json`)).toBe(false);
    expect(isInside(join(REPO_ROOT, "..folder", "sheet.json"))).toBe(true);
  });
});

describe("the script's dependencies", () => {
  it("imports no model, no network and no fuzzy matcher", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const imported = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect([...new Set(imported)].sort()).toEqual([
      "../src/model/trend",
      "./build-imrad-fixtures",
      "node:fs/promises",
      "node:path",
      "node:sqlite",
      "node:url",
    ]);
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|process\.env/);
  });
});

describe("reading the plugin's database", () => {
  const dirs: string[] = [];
  const open: DatabaseSync[] = [];

  afterEach(async () => {
    for (const db of open.splice(0)) db.close();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rh-eval-"));
    dirs.push(dir);
    return dir;
  }

  function insert(db: DatabaseSync, row: Record<string, unknown>): void {
    db.prepare(
      "INSERT INTO report (id, library_id, collection_key, json, markdown_path, note_key, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id as string,
      1,
      row.collectionKey as string,
      JSON.stringify(row),
      `reports/${String(row.id)}.md`,
      null,
      row.generatedAtEpochMs as number,
    );
  }

  /** A closed database on the real table, holding `rows`. */
  async function databaseWith(
    rows: readonly Record<string, unknown>[],
  ): Promise<string> {
    const path = join(await tempDir(), "research-helper.sqlite");
    const db = new DatabaseSync(path);
    db.exec(REPORT_DDL);
    for (const row of rows) insert(db, row);
    db.close();
    return path;
  }

  async function setOnDisk(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const path = join(await tempDir(), "expected-themes.json");
    await writeFile(path, JSON.stringify(setFile(overrides)), "utf8");
    return path;
  }

  function capture(): {
    readonly lines: string[];
    readonly errors: string[];
    run(args: readonly string[]): Promise<number>;
  } {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
      lines,
      errors,
      run: (args) =>
        main(
          args,
          (line) => lines.push(line),
          (line) => errors.push(line),
        ),
    };
  }

  it("reads every row of the real table, and leaves the file as it was", async () => {
    const path = await databaseWith([
      record(),
      record({ id: "report-ko", language: "ko" }),
    ]);
    const before = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    expect(
      readStoredReports(path)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["report-en", "report-ko"]);
    const after = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    expect(after).toBe(before);
  });

  it("reads through a write-ahead log left by a Zotero that did not close cleanly", async () => {
    const dir = await tempDir();
    const live = join(dir, "live.sqlite");
    const db = new DatabaseSync(live);
    open.push(db);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA wal_autocheckpoint=0");
    db.exec(REPORT_DDL);
    insert(db, record());
    const copy = join(await tempDir(), "research-helper.sqlite");
    await copyFile(live, copy);
    await copyFile(`${live}-wal`, `${copy}-wal`);
    expect(readStoredReports(copy).map((r) => r.id)).toEqual(["report-en"]);
  });

  it("says to close Zotero when the file is held exclusively, as Zotero holds it", async () => {
    const path = join(await tempDir(), "research-helper.sqlite");
    const db = new DatabaseSync(path);
    open.push(db);
    db.exec("PRAGMA locking_mode=EXCLUSIVE");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec(REPORT_DDL);
    insert(db, record());
    expect(refusal(() => readStoredReports(path))).toContain("close Zotero");
  });

  it("refuses a file with no report table", async () => {
    const path = join(await tempDir(), "other.sqlite");
    new DatabaseSync(path).close();
    expect(refusal(() => readStoredReports(path))).toContain(
      "report table cannot be read",
    );
    expect(() => readStoredReports(join(path, "missing"))).toThrow(EvalRefusal);
  });

  it("sheet, then score, end to end, printing figures only", async () => {
    const database = await databaseWith([
      record(),
      record({ id: "report-ko", language: "ko" }),
      record({ id: "old", generatedAtEpochMs: 500 }),
    ]);
    const set = await setOnDisk();
    const out = join(await tempDir(), "sheet.json");
    const cli = capture();

    expect(
      await cli.run([
        "sheet",
        "--set",
        set,
        "--database",
        database,
        "--out",
        out,
      ]),
    ).toBe(0);
    const sheet = JSON.parse(await readFile(out, "utf8")) as {
      runId: string;
      produced: { themeId: string }[];
    };
    expect(sheet.runId).toBe("report-en");
    expect(sheet.produced.map((t) => t.themeId)).toEqual(["T1", "T2"]);

    const matches = join(await tempDir(), "export.json");
    await writeFile(
      matches,
      JSON.stringify([
        { id: "report-en__E1", themeIds: ["T1"] },
        { id: "report-en__E2", themeIds: ["T2"] },
        { id: "report-en__E3", themeIds: [] },
        { id: "old__E1", themeIds: [] },
      ]),
      "utf8",
    );
    expect(
      await cli.run([
        "score",
        "--set",
        set,
        "--database",
        database,
        "--matches",
        matches,
        "--report",
        "report-en",
      ]),
    ).toBe(0);
    const printed = cli.lines.join("\n");
    expect(printed).toContain("theme recall 2/3 = 0.667");
    expect(printed).toContain("\nen | ");
    expect(printed).toContain("\nko | ");
    for (const secret of [
      COLLECTION_NAME,
      EXPECTED_NAME_1,
      PRODUCED_NAME_1,
      PRODUCED_DEFINITION,
      REPORT_TEXT,
      String(USAGE_COST),
      database,
      out,
    ]) {
      expect(printed).not.toContain(secret);
    }
    expect(cli.errors).toEqual([]);
  });

  it("reads a set saved with a byte order mark", async () => {
    const database = await databaseWith([record()]);
    const set = join(await tempDir(), "expected-themes.json");
    const bom = String.fromCharCode(0xfeff);
    await writeFile(set, `${bom}${JSON.stringify(setFile())}`, "utf8");
    const cli = capture();
    const out = join(await tempDir(), "sheet.json");
    expect(
      await cli.run([
        "sheet",
        "--set",
        set,
        "--database",
        database,
        "--out",
        out,
      ]),
    ).toBe(0);
  });

  it("refuses a sheet inside the repository, before touching anything", async () => {
    const database = await databaseWith([record()]);
    const set = await setOnDisk();
    const cli = capture();
    const inside = join(REPO_ROOT, "must-not-be-written.json");
    expect(
      await cli.run([
        "sheet",
        "--set",
        set,
        "--database",
        database,
        "--out",
        inside,
      ]),
    ).toBe(1);
    expect(cli.errors[0]).toContain("outside the repository");
    expect(existsSync(inside)).toBe(false);
  });

  it("never scores the synthetic example", async () => {
    const database = await databaseWith([record()]);
    const cli = capture();
    const out = join(await tempDir(), "sheet.json");
    expect(
      await cli.run([
        "sheet",
        "--set",
        join(FIXTURE_DIR, "synthetic-example", "expected-themes.json"),
        "--database",
        database,
        "--out",
        out,
      ]),
    ).toBe(1);
    expect(cli.errors[0]).toContain("never scored");
    expect(existsSync(out)).toBe(false);
  });

  it("scores by the run's id only, which the answers name", async () => {
    const database = await databaseWith([
      record(),
      record({ id: "report-ko", language: "ko" }),
    ]);
    const set = await setOnDisk();
    const matches = join(await tempDir(), "export.json");
    await writeFile(matches, "[]", "utf8");
    const cli = capture();
    expect(
      await cli.run([
        "score",
        "--set",
        set,
        "--database",
        database,
        "--matches",
        matches,
        "--report",
        "report-ko",
      ]),
    ).toBe(1);
    expect(cli.errors[0]).toContain("report-en");
  });

  it("refuses an unreadable or malformed file without quoting it", async () => {
    const database = await databaseWith([record()]);
    const bad = join(await tempDir(), "bad.json");
    await writeFile(bad, `{ "name": "${EXPECTED_NAME_1}"`, "utf8");
    const cli = capture();
    const out = join(await tempDir(), "sheet.json");
    expect(
      await cli.run([
        "sheet",
        "--set",
        bad,
        "--database",
        database,
        "--out",
        out,
      ]),
    ).toBe(1);
    expect(
      await cli.run([
        "sheet",
        "--set",
        join(bad, "missing"),
        "--database",
        database,
        "--out",
        out,
      ]),
    ).toBe(1);
    const shown = cli.errors.join("\n");
    expect(shown).not.toContain(EXPECTED_NAME_1);
    expect(shown).not.toContain(bad);
  });

  it("exits 2 with the usage on wrong arguments", async () => {
    const cli = capture();
    expect(await cli.run([])).toBe(2);
    expect(await cli.run(["score", "--set", "x"])).toBe(2);
    expect(await cli.run(["sheet", "--set", "x", "--database", "y"])).toBe(2);
    expect(await cli.run(["measure"])).toBe(2);
    expect(cli.errors[0]).toContain("Usage");
    expect(cli.errors[0]).toContain("measure --database");
  });

  it("measure prints the latest run's numbers, or the run holding --report, and no text", async () => {
    const older = record({
      id: "report-old",
      generatedAtEpochMs: 500,
      runMeasurement: {
        calls: [{ promptId: "THEME_MERGE", inputTokens: 5 }],
        themeAnalyses: [],
      },
    });
    const newer = record({ runMeasurement: MEASUREMENT });
    const database = await databaseWith([older, newer]);
    const cli = capture();
    expect(await cli.run(["measure", "--database", database])).toBe(0);
    const shown = cli.lines.join("\n");
    expect(shown).toContain("run report-en");
    expect(shown).toContain("THEME_CLUSTER");
    expect(shown).not.toContain("THEME_MERGE");
    for (const text of [
      COLLECTION_NAME,
      PRODUCED_NAME_1,
      PRODUCED_DEFINITION,
      REPORT_TEXT,
      database,
    ]) {
      expect(shown).not.toContain(text);
    }

    const picked = capture();
    expect(
      await picked.run([
        "measure",
        "--database",
        database,
        "--report",
        "report-old",
      ]),
    ).toBe(0);
    expect(picked.lines.join("\n")).toContain("THEME_MERGE");
  });

  it("measure says not measured for an old row, and refuses a report it does not hold or an empty table", async () => {
    const database = await databaseWith([record()]);
    const cli = capture();
    expect(await cli.run(["measure", "--database", database])).toBe(0);
    expect(cli.lines.join("\n")).toBe(
      "run report-en | reports en | not measured",
    );

    const missing = capture();
    expect(
      await missing.run([
        "measure",
        "--database",
        database,
        "--report",
        "nope",
      ]),
    ).toBe(1);
    expect(missing.errors.join("\n")).toContain("nope");

    const empty = capture();
    expect(
      await empty.run(["measure", "--database", await databaseWith([])]),
    ).toBe(1);
    expect(empty.errors.join("\n")).toContain("no report is stored");
  });
});

describe("what a run measured (P4-T23 step 4)", () => {
  it("an old record reads as not measured, never 0", () => {
    const old = stored();
    expect(old).not.toHaveProperty("runMeasurement");
    const run = oneRun([old]);
    expect(measurementOf(run)).toBeUndefined();
    const shown = formatMeasurement(run);
    expect(shown).toContain("not measured");
    expect(shown).not.toMatch(/\b0\b/);
  });

  it("a measurement on one row of a both run is the run's; the other row's absence is not a second reading", () => {
    const run = oneRun([
      stored({ runMeasurement: MEASUREMENT }),
      stored({ id: "report-ko", language: "ko" }),
    ]);
    expect(measurementOf(run)?.calls).toHaveLength(3);
    const shown = formatMeasurement(run);
    expect(shown).toContain("reports en, ko");
    expect(shown).toContain("run total | calls 3 | input 600 |");
    expect(shown).toContain("call 1 | THEME_CLUSTER | shared |");
    expect(shown).toContain("call 3 | TREND_REPORT_KO | ko |");
  });

  it("two rows of one run each holding one are refused, not added", () => {
    const run = oneRun([
      stored({ runMeasurement: MEASUREMENT }),
      stored({ id: "report-ko", language: "ko", runMeasurement: MEASUREMENT }),
    ]);
    expect(refusal(() => measurementOf(run))).toContain("not added");
    expect(refusal(() => formatMeasurement(run))).toContain("not added");
  });

  it("the reasoning figure prints as a share of that call's ceiling, and absent as not reported", () => {
    const shown = formatMeasurement(
      oneRun([stored({ runMeasurement: MEASUREMENT })]),
    );
    const lines = shown.split("\n");
    const first = lines.find((l) => l.startsWith("call 1 "));
    const second = lines.find((l) => l.startsWith("call 2 "));
    expect(first).toContain("reasoning 50 ");
    expect(first).toContain("ceiling 2400 ");
    expect(first).toContain("reasoning share of ceiling 0.021 ");
    expect(second).toContain("reasoning not reported ");
    expect(second).toContain("reasoning share of ceiling not reported ");
    expect(second).toContain("cost not reported");
  });

  it("a ceiling of 0 gives no share to print, rather than Infinity", () => {
    const shown = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: {
            calls: [{ promptId: "P", reasoningTokens: 50, maxOutputTokens: 0 }],
            themeAnalyses: [],
          },
        }),
      ]),
    );
    expect(shown).toContain("reasoning share of ceiling not reported ");
    expect(shown).not.toContain("Infinity");
  });

  it("a sum with any part missing is not reported, never a part presented as the whole", () => {
    const shown = formatMeasurement(
      oneRun([stored({ runMeasurement: MEASUREMENT })]),
    );
    expect(shown).toContain(
      "run total | calls 3 | input 600 | output 1100 | reasoning not reported | cost not reported",
    );
    expect(shown).toContain(
      "THEME_CLUSTER | calls 1 | input 100 | output 200 | reasoning 50 | cost 0.001000",
    );
  });

  it("THEME_CLUSTER's answer tokens per paper print against the ceiling's assumption", () => {
    const shown = formatMeasurement(
      oneRun([stored({ runMeasurement: MEASUREMENT })]),
    );
    expect(shown).toContain(
      "THEME_CLUSTER answer tokens per paper 15.00 against the 40 its ceiling assumes",
    );
    const atMost = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: {
            calls: [
              { promptId: "THEME_CLUSTER", outputTokens: 90, papers: 3 },
              { promptId: "THEME_CLUSTER", outputTokens: 30, papers: 1 },
            ],
            themeAnalyses: [],
          },
        }),
      ]),
    );
    expect(atMost).toContain(
      "THEME_CLUSTER answer tokens per paper at most 30.00 against",
    );
    const unknown = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: {
            calls: [{ promptId: "THEME_CLUSTER", papers: 3 }],
            themeAnalyses: [],
          },
        }),
      ]),
    );
    expect(unknown).toContain(
      "THEME_CLUSTER answer tokens per paper not reported",
    );
    const noPapers = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: {
            calls: [{ promptId: "THEME_CLUSTER", outputTokens: 9, papers: 0 }],
            themeAnalyses: [],
          },
        }),
      ]),
    );
    expect(noPapers).toContain(
      "THEME_CLUSTER answer tokens per paper not reported",
    );
    const noCluster = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: {
            calls: [{ promptId: "THEME_MERGE", outputTokens: 9 }],
            themeAnalyses: [],
          },
        }),
      ]),
    );
    expect(noCluster).not.toContain("per paper");
  });

  it("the 40 is what the prompt file sets", () => {
    const prompt = readFileSync(
      resolve(REPO_ROOT, "src/prompts/theme-cluster.v1.0.0.md"),
      "utf8",
    );
    expect(prompt).toContain(
      `maxTokensPerItem: ${String(THEME_CLUSTER_ASSUMED_PER_PAPER)}\n`,
    );
  });

  it("answer tokens: the call's own total says whether reasoning is inside the output", () => {
    const call = (
      members: Partial<Record<string, number>>,
    ): { promptId: string } & Record<string, number | string> =>
      ({ promptId: "P", ...members }) as { promptId: string } & Record<
        string,
        number | string
      >;
    // Inside: 412 + 118 = 530.
    expect(
      answerTokensOf(
        call({
          inputTokens: 412,
          outputTokens: 118,
          totalTokens: 530,
          reasoningTokens: 64,
        }),
      ),
    ).toEqual({ tokens: 54, kind: "exact" });
    // On top: docs/03 §4.4's Gemini sample, 412 + 118 + 44 = 574.
    expect(
      answerTokensOf(
        call({
          inputTokens: 412,
          outputTokens: 118,
          totalTokens: 574,
          reasoningTokens: 44,
        }),
      ),
    ).toEqual({ tokens: 118, kind: "exact" });
    // Fits neither reading, or no total to read: not guessed.
    expect(
      answerTokensOf(
        call({
          inputTokens: 1,
          outputTokens: 118,
          totalTokens: 999,
          reasoningTokens: 44,
        }),
      ),
    ).toBeUndefined();
    expect(
      answerTokensOf(call({ outputTokens: 118, reasoningTokens: 44 })),
    ).toBeUndefined();
    expect(
      answerTokensOf(
        call({ inputTokens: 1, outputTokens: 118, reasoningTokens: 44 }),
      ),
    ).toBeUndefined();
    expect(
      answerTokensOf(
        call({ outputTokens: 118, totalTokens: 118, reasoningTokens: 44 }),
      ),
    ).toBeUndefined();
    // A reported 0 settles it whatever the total says.
    expect(
      answerTokensOf(call({ outputTokens: 118, reasoningTokens: 0 })),
    ).toEqual({ tokens: 118, kind: "exact" });
    // No figure at all: the whole output is an upper bound.
    expect(answerTokensOf(call({ outputTokens: 118 }))).toEqual({
      tokens: 118,
      kind: "at-most",
    });
    expect(answerTokensOf(call({}))).toBeUndefined();
  });

  it("each analysis's size and the narrative share print, and an empty list says so", () => {
    const shown = formatMeasurement(
      oneRun([stored({ runMeasurement: MEASUREMENT })]),
    );
    expect(shown).toContain(
      "theme analyses 2 | largest 3000 | narrative share 0.400",
    );
    expect(shown).toContain(
      "theme analysis 1 | tokens 1000 | narrative 400 | papers 12",
    );
    expect(shown).toContain(
      "theme analysis 2 | tokens 3000 | narrative 1200 | papers 7",
    );
    const none = formatMeasurement(
      oneRun([stored({ runMeasurement: { calls: [], themeAnalyses: [] } })]),
    );
    expect(none).toContain(
      "theme analyses 0 | largest 0 | narrative share not reported",
    );
    expect(none).toContain("run total | calls 0 |");
  });

  it("a resumed run says what it lacks", () => {
    const shown = formatMeasurement(
      oneRun([
        stored({
          runMeasurement: { calls: [], themeAnalyses: [], resumed: true },
        }),
      ]),
    );
    expect(shown).toContain("resumed after a restart");
    expect(
      formatMeasurement(oneRun([stored({ runMeasurement: MEASUREMENT })])),
    ).not.toContain("resumed");
  });

  it.each<[string, unknown]>([
    ["a string", "nothing"],
    ["no calls", { themeAnalyses: [] }],
    ["no sizes", { calls: [] }],
    [
      "an extra member",
      { calls: [], themeAnalyses: [], note: PRODUCED_NAME_1 },
    ],
    ["a resumed word", { calls: [], themeAnalyses: [], resumed: "yes" }],
    [
      "a call with text",
      { calls: [{ promptId: "P", text: "x" }], themeAnalyses: [] },
    ],
    [
      "a number under a name the record does not have",
      { calls: [{ promptId: "P", other: 1 }], themeAnalyses: [] },
    ],
    [
      "a figure as text",
      { calls: [{ promptId: "P", inputTokens: "9" }], themeAnalyses: [] },
    ],
    [
      "a negative figure",
      { calls: [{ promptId: "P", inputTokens: -1 }], themeAnalyses: [] },
    ],
    [
      "a prompt id holding prose",
      {
        calls: [{ promptId: PRODUCED_NAME_1.toLowerCase() }],
        themeAnalyses: [],
      },
    ],
    ["no prompt id", { calls: [{ inputTokens: 1 }], themeAnalyses: [] }],
    [
      "an unknown language",
      { calls: [{ promptId: "P", language: "de" }], themeAnalyses: [] },
    ],
    [
      "a size with a name",
      {
        calls: [],
        themeAnalyses: [
          { tokens: 1, narrativeTokens: 1, papers: 1, name: "x" },
        ],
      },
    ],
    [
      "a size lacking a figure",
      { calls: [], themeAnalyses: [{ tokens: 1, papers: 1 }] },
    ],
  ])(
    "a measurement holding %s is refused, naming nothing it found",
    (_what, value) => {
      const message = refusal(() => stored({ runMeasurement: value }));
      expect(message).toContain("run measurement");
      expect(message).not.toContain(PRODUCED_NAME_1);
      expect(message).not.toContain(PRODUCED_NAME_1.toLowerCase());
    },
  );
});

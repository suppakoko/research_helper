/**
 * `P4-T17` — the synthesis cache keys, `docs/06` §11.2's `tc`, `cr` and `rp`,
 * read as that section's "Decided 2026-10-27" readings and typed by
 * `docs/07` §9.1's block of the same day.
 *
 * The prompt epochs come from the real registry over the shipped prompt
 * files, with PATCH (`1.0.1`, same `cacheEpoch`) and MINOR (`1.1.0`, epoch 2)
 * siblings of each synthesis prompt built from them, so "a PATCH keeps the
 * key" is checked against what `createPromptRegistry` actually accepts. No
 * network, no model, no cache store.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  promptLineTag,
  reportKey,
  sha256Hex,
  stableStringify,
  synthesisTags,
  THEME_ANALYSIS_KEY_PROMPTS,
  THEME_CLUSTERING_KEY_PROMPTS,
  themeAnalysisKey,
  themeClusteringKey,
  type ReportKeyInput,
  type SynthesisInputHash,
  type SynthesisKey,
  type ThemeAnalysisKeyInput,
  type ThemeClusteringKeyInput,
} from "../../../src/core/cache/keys";
import {
  promptVersionTag,
  reconcilePromptVersions,
} from "../../../src/pipeline/summarize/summaryCache";
import {
  createPromptRegistry,
  promptCacheLine,
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
  type PromptId,
  type PromptRegistry,
  type PromptSourceFile,
} from "../../../src/prompts";

// ---------------------------------------------------------------------------
// 1. The registry, with PATCH and MINOR siblings of every synthesis prompt
// ---------------------------------------------------------------------------

const promptsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/prompts",
);

/** The prompts a report run calls (`TrendPromptId`, `src/model/trend.ts`). */
const SYNTHESIS_PROMPTS = [
  "THEME_CLUSTER",
  "THEME_MERGE",
  "CLUSTER_REDUCE",
  "CLUSTER_REDUCE_MERGE",
  "TREND_REPORT_EN",
  "TREND_REPORT_KO",
  "SELF_CRITIQUE",
] as const satisfies readonly PromptId[];

function shippedFiles(): PromptSourceFile[] {
  return PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(resolve(promptsDir, PROMPT_FILE_NAMES[id]), "utf8"),
  }));
}

/** The active version of `id`, as its shipped file name states it. */
function shippedVersion(id: PromptId): string {
  const match = /\.v(\d+\.\d+\.\d+)\.md$/.exec(PROMPT_FILE_NAMES[id]);
  if (match?.[1] === undefined) {
    throw new Error(`${id}: no version in its file name`);
  }
  return match[1];
}

/**
 * The PATCH after `id`'s active version: 1.0.1 for a 1.0.0 file, 1.0.2 for
 * `TREND_REPORT_EN` and `TREND_REPORT_KO`, active at 1.0.1 since 2026-10-30
 * (owner, `plan/00` §6 item 311(c)).
 */
function patchOf(id: PromptId): string {
  const [major, minor, patch] = shippedVersion(id).split(".").map(Number);
  return `${String(major)}.${String(minor)}.${String((patch as number) + 1)}`;
}

/** A sibling of `id`'s shipped file at `version`, with `cacheEpoch` `epoch`. */
function sibling(
  id: PromptId,
  version: string,
  epoch: number,
): PromptSourceFile {
  const shipped = PROMPT_FILE_NAMES[id];
  const active = shippedVersion(id);
  const text = readFileSync(resolve(promptsDir, shipped), "utf8")
    .replace(`\nversion: ${active}\n`, `\nversion: ${version}\n`)
    .replace(/^cacheEpoch: 1$/m, `cacheEpoch: ${String(epoch)}`);
  return { fileName: shipped.replace(`v${active}`, `v${version}`), text };
}

const REGISTRY: PromptRegistry = createPromptRegistry([
  ...shippedFiles(),
  ...SYNTHESIS_PROMPTS.flatMap((id) => [
    sibling(id, patchOf(id), 1),
    sibling(id, "1.1.0", 2),
  ]),
]);

/** The shipped epochs, with `id` read from its file at `version`. */
function epochsWith(
  id?: PromptId,
  version?: string,
): Readonly<Record<string, number>> {
  if (id === undefined || version === undefined) return REGISTRY.cacheEpochs;
  const template = REGISTRY.getVersion(id, version);
  if (template === undefined) throw new Error(`${id}@${version} not built`);
  return { ...REGISTRY.cacheEpochs, [id]: template.cacheEpoch };
}

/** Each prompt's cache line, with `id` at `version`. */
function linesWith(id?: PromptId, version?: string): Record<string, string> {
  const versions: Record<string, string> = { ...REGISTRY.versions };
  if (id !== undefined && version !== undefined) versions[id] = version;
  return Object.fromEntries(
    Object.entries(versions).map(([p, v]) => [p, promptCacheLine(v)]),
  );
}

// ---------------------------------------------------------------------------
// 2. A synthetic corpus: six papers, two themes
// ---------------------------------------------------------------------------

const ITEM_KEYS = [
  "AAAA2222",
  "BBBB3333",
  "CCCC4444",
  "DDDD5555",
  "EEEE6666",
  "FFFF7777",
];
const THEMES: Readonly<Record<string, readonly string[]>> = {
  T1: ["AAAA2222", "BBBB3333", "CCCC4444"],
  T2: ["DDDD5555", "EEEE6666", "FFFF7777"],
};

/** A summary-shaped payload; the keys hash it as sent and never look inside. */
function summary(itemKey: string, revision = 0): Record<string, unknown> {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey,
    keyFindings: [{ statement: `Finding of ${itemKey} r${String(revision)}` }],
  };
}

/** The digest block sent for a summary (`docs/06` §8.2's shape, abridged). */
function digest(itemKey: string, revision = 0): string {
  return `[${itemKey}] 2024 | design: rct\nFindings: Finding of ${itemKey} r${String(revision)}`;
}

/** A corpus state: which revision each item's summary is at. */
type Revisions = Readonly<Record<string, number>>;

function digestHashes(revisions: Revisions = {}): SynthesisInputHash[] {
  return ITEM_KEYS.map((id) => ({
    id,
    hash: sha256Hex(digest(id, revisions[id] ?? 0)),
  }));
}

function summaryHashes(
  itemKeys: readonly string[],
  revisions: Revisions = {},
): SynthesisInputHash[] {
  return itemKeys.map((id) => ({
    id,
    hash: sha256Hex(stableStringify(summary(id, revisions[id] ?? 0))),
  }));
}

const CLUSTER_CALL = {
  modelId: "strong-model-2026-01-01",
  temperature: 0.2,
  effort: "medium",
} as const;
const REDUCE_CALL = { ...CLUSTER_CALL, temperature: 0.3 } as const;
const CRITIQUE_CALL = {
  modelId: "standard-model-2026-01-01",
  temperature: 0,
  effort: "low",
} as const;

function tcInput(
  over: Partial<ThemeClusteringKeyInput> = {},
  revisions: Revisions = {},
): ThemeClusteringKeyInput {
  return {
    members: digestHashes(revisions),
    themeBand: { minThemes: 2, maxThemes: 4, minPapersPerTheme: 2 },
    promptCacheEpochs: epochsWith(),
    providerId: "anthropic",
    call: CLUSTER_CALL,
    stageInputs: {
      USER_TOPIC: "cardiovascular risk",
      N_PAPERS: 6,
      YEAR_MIN: 2024,
      YEAR_MAX: 2024,
    },
    ...over,
  };
}

function crInput(
  themeId: string,
  over: Partial<ThemeAnalysisKeyInput> = {},
  revisions: Revisions = {},
): ThemeAnalysisKeyInput {
  const members = THEMES[themeId] ?? [];
  return {
    themeId,
    themeName: `Theme ${themeId}`,
    themeDefinition: `Papers grouped as ${themeId}.`,
    members: summaryHashes(members, revisions),
    promptCacheEpochs: epochsWith(),
    providerId: "anthropic",
    call: REDUCE_CALL,
    stageInputs: {
      USER_TOPIC: "cardiovascular risk",
      N_PAPERS: members.length,
    },
    ...over,
  };
}

function rpInput(
  over: Partial<ReportKeyInput> = {},
  revisions: Revisions = {},
): ReportKeyInput {
  return {
    language: "en",
    themeAnalyses: [
      { id: "T1", hash: sha256Hex("analysis T1") },
      { id: "T2", hash: sha256Hex("analysis T2") },
    ],
    digests: digestHashes(revisions),
    summaries: summaryHashes(ITEM_KEYS, revisions),
    targetWords: 1500,
    critique: { rounds: 1, call: CRITIQUE_CALL },
    promptCacheEpochs: epochsWith(),
    providerId: "anthropic",
    call: REDUCE_CALL,
    stageInputs: {
      COLLECTION_NAME: "CVD risk",
      USER_TOPIC: "cardiovascular risk",
      N_TOTAL: 6,
      N_ANALYSED: 6,
      SOURCES: "PubMed",
      SEARCH_STRATEGY: "manually curated by the user",
    },
    ...over,
  };
}

const tc = (input: ThemeClusteringKeyInput): string =>
  themeClusteringKey(input).key;
const cr = (input: ThemeAnalysisKeyInput): string =>
  themeAnalysisKey(input).key;
const rp = (input: ReportKeyInput): string => reportKey(input).key;

/** Every key of a run over the corpus, with the given summaries revised. */
function runKeys(
  revisions: Revisions = {},
  epochs: Readonly<Record<string, number>> = epochsWith(),
): Record<string, string> {
  return {
    tc: tc(tcInput({ promptCacheEpochs: epochs }, revisions)),
    crT1: cr(crInput("T1", { promptCacheEpochs: epochs }, revisions)),
    crT2: cr(crInput("T2", { promptCacheEpochs: epochs }, revisions)),
    rpEn: rp(rpInput({ promptCacheEpochs: epochs }, revisions)),
    rpKo: rp(rpInput({ language: "ko", promptCacheEpochs: epochs }, revisions)),
  };
}

// ---------------------------------------------------------------------------
// 3. The card's Done-when rows
// ---------------------------------------------------------------------------

describe("synthesis keys (P4-T17)", () => {
  it("are 64-hex digests, deterministic, distinct per stage and per theme", () => {
    const keys = runKeys();
    for (const key of Object.values(keys))
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(runKeys()).toStrictEqual(keys);
    expect(new Set(Object.values(keys)).size).toBe(5);
  });

  it("changing one member's contentHash changes tc and that theme's cr, and no other cr", () => {
    const before = runKeys();
    const after = runKeys({ CCCC4444: 1 });
    expect(after.tc).not.toBe(before.tc);
    expect(after.crT1).not.toBe(before.crT1);
    expect(after.crT2).toBe(before.crT2);
    // The report is downstream of both: its digests and summaries moved.
    expect(after.rpEn).not.toBe(before.rpEn);
  });

  it("a PATCH-only prompt change keeps all three keys (same cacheEpoch, item 273(a))", () => {
    const before = runKeys();
    for (const id of SYNTHESIS_PROMPTS) {
      expect(runKeys({}, epochsWith(id, patchOf(id))), id).toStrictEqual(
        before,
      );
    }
  });

  it.each([
    ["THEME_CLUSTER", ["tc"]],
    ["THEME_MERGE", ["tc"]],
    ["CLUSTER_REDUCE", ["crT1", "crT2"]],
    ["CLUSTER_REDUCE_MERGE", ["crT1", "crT2"]],
    ["TREND_REPORT_EN", ["rpEn"]],
    ["TREND_REPORT_KO", ["rpKo"]],
    ["SELF_CRITIQUE", ["rpEn", "rpKo"]],
    ["PAPER_SUMMARY_ABSTRACT", []],
    ["RELEVANCE_SCREEN", []],
  ] as const)(
    "a MINOR change to %s moves only its own keys: %j",
    (id, moved) => {
      const before = runKeys();
      const version = (SYNTHESIS_PROMPTS as readonly string[]).includes(id)
        ? "1.1.0"
        : undefined;
      const epochs =
        version === undefined
          ? { ...epochsWith(), [id]: 2 }
          : epochsWith(id, version);
      const after = runKeys({}, epochs);
      for (const name of Object.keys(before)) {
        if ((moved as readonly string[]).includes(name)) {
          expect(after[name], name).not.toBe(before[name]);
        } else {
          expect(after[name], name).toBe(before[name]);
        }
      }
    },
  );

  it("the registry really holds PATCH siblings at the active epoch and MINOR ones above it", () => {
    for (const id of SYNTHESIS_PROMPTS) {
      expect(REGISTRY.getVersion(id, patchOf(id))?.cacheEpoch).toBe(
        REGISTRY.cacheEpochs[id],
      );
      expect(REGISTRY.getVersion(id, "1.1.0")?.cacheEpoch).toBeGreaterThan(
        REGISTRY.cacheEpochs[id],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Every component is load-bearing
// ---------------------------------------------------------------------------

describe("tc components", () => {
  const base = tc(tcInput());
  it.each<[string, Partial<ThemeClusteringKeyInput>]>([
    [
      "a paper added",
      {
        members: [...digestHashes(), { id: "GGGG8888", hash: "f".repeat(64) }],
      },
    ],
    ["a paper removed", { members: digestHashes().slice(1) }],
    [
      "minThemes",
      { themeBand: { minThemes: 3, maxThemes: 4, minPapersPerTheme: 2 } },
    ],
    [
      "maxThemes",
      { themeBand: { minThemes: 2, maxThemes: 5, minPapersPerTheme: 2 } },
    ],
    [
      "minPapersPerTheme",
      { themeBand: { minThemes: 2, maxThemes: 4, minPapersPerTheme: 3 } },
    ],
    ["the provider", { providerId: "openai" }],
    [
      "the model",
      { call: { ...CLUSTER_CALL, modelId: "strong-model-2026-02-01" } },
    ],
    ["the temperature", { call: { ...CLUSTER_CALL, temperature: 0.3 } }],
    ["the effort", { call: { ...CLUSTER_CALL, effort: "high" } }],
    [
      "no effort sent",
      { call: { modelId: CLUSTER_CALL.modelId, temperature: 0.2 } },
    ],
    [
      "the topic",
      { stageInputs: { ...tcInput().stageInputs, USER_TOPIC: "other" } },
    ],
    [
      "the batch size",
      { stageInputs: { ...tcInput().stageInputs, BATCH_SIZE: 40 } },
    ],
  ])("%s moves tc", (_name, over) => {
    expect(tc(tcInput(over))).not.toBe(base);
  });

  it("member order does not move tc", () => {
    expect(tc(tcInput({ members: [...digestHashes()].reverse() }))).toBe(base);
  });
});

describe("cr components", () => {
  const base = cr(crInput("T1"));
  it.each<[string, Partial<ThemeAnalysisKeyInput>]>([
    ["the theme id", { themeId: "T3" }],
    ["the theme name", { themeName: "Renamed" }],
    ["the theme definition", { themeDefinition: "Redefined." }],
    [
      "a member added",
      {
        members: summaryHashes([
          "AAAA2222",
          "BBBB3333",
          "CCCC4444",
          "DDDD5555",
        ]),
      },
    ],
    ["a member removed", { members: summaryHashes(["AAAA2222", "BBBB3333"]) }],
    ["the provider", { providerId: "gemini" }],
    [
      "the model",
      { call: { ...REDUCE_CALL, modelId: "strong-model-2026-02-01" } },
    ],
    ["the temperature", { call: { ...REDUCE_CALL, temperature: 0.2 } }],
    ["the effort", { call: { ...REDUCE_CALL, effort: "low" } }],
    ["the topic", { stageInputs: { USER_TOPIC: "other", N_PAPERS: 3 } }],
  ])("%s moves cr", (_name, over) => {
    expect(cr(crInput("T1", over))).not.toBe(base);
  });

  it("member order does not move cr", () => {
    expect(
      cr(
        crInput("T1", {
          members: [...summaryHashes(THEMES.T1 ?? [])].reverse(),
        }),
      ),
    ).toBe(base);
  });
});

describe("rp components", () => {
  const base = rp(rpInput());
  it.each<[string, Partial<ReportKeyInput>]>([
    ["the language", { language: "ko" }],
    [
      "a theme analysis",
      {
        themeAnalyses: [
          { id: "T1", hash: sha256Hex("analysis T1 v2") },
          { id: "T2", hash: sha256Hex("analysis T2") },
        ],
      },
    ],
    [
      "a theme dropped",
      { themeAnalyses: [{ id: "T1", hash: sha256Hex("analysis T1") }] },
    ],
    ["the digests sent (trimmed)", { digests: digestHashes().slice(0, 4) }],
    [
      "the summaries the critique may see",
      { summaries: summaryHashes(ITEM_KEYS, { AAAA2222: 1 }) },
    ],
    ["the target words", { targetWords: 2500 }],
    ["the critique rounds", { critique: { rounds: 2, call: CRITIQUE_CALL } }],
    ["the critique off", { critique: { rounds: 0, call: CRITIQUE_CALL } }],
    [
      "the critique model",
      {
        critique: {
          rounds: 1,
          call: { ...CRITIQUE_CALL, modelId: "other-2026-01-01" },
        },
      },
    ],
    [
      "the critique temperature",
      { critique: { rounds: 1, call: { ...CRITIQUE_CALL, temperature: 0.1 } } },
    ],
    [
      "the critique effort",
      { critique: { rounds: 1, call: { ...CRITIQUE_CALL, effort: "medium" } } },
    ],
    ["the provider", { providerId: "openrouter" }],
    [
      "the report model",
      { call: { ...REDUCE_CALL, modelId: "strong-model-2026-02-01" } },
    ],
    ["the report temperature", { call: { ...REDUCE_CALL, temperature: 0.2 } }],
    ["the report effort", { call: { ...REDUCE_CALL, effort: "high" } }],
    [
      "the sources line",
      { stageInputs: { ...rpInput().stageInputs, SOURCES: "PubMed, arXiv" } },
    ],
  ])("%s moves rp", (_name, over) => {
    expect(rp(rpInput(over))).not.toBe(base);
  });

  it("with the critique off, its model, its summaries and SELF_CRITIQUE's epoch are not keyed", () => {
    const off = rpInput({ critique: { rounds: 0, call: CRITIQUE_CALL } });
    const offKey = rp(off);
    expect(
      rp({
        ...off,
        critique: { rounds: 0, call: { ...CRITIQUE_CALL, modelId: "x-2026" } },
      }),
    ).toBe(offKey);
    expect(rp({ ...off, summaries: [] })).toBe(offKey);
    expect(
      rp({ ...off, promptCacheEpochs: { ...epochsWith(), SELF_CRITIQUE: 7 } }),
    ).toBe(offKey);
    expect(reportKey(off).promptIds).toStrictEqual(["TREND_REPORT_EN"]);
    expect(reportKey(off).modelIds).toStrictEqual([REDUCE_CALL.modelId]);
  });

  it("theme-analysis, digest and summary order do not move rp", () => {
    const input = rpInput();
    expect(
      rp({
        ...input,
        themeAnalyses: [...input.themeAnalyses].reverse(),
        digests: [...input.digests].reverse(),
        summaries: [...input.summaries].reverse(),
      }),
    ).toBe(base);
  });

  it("names the language's report prompt and the critique, and each model once", () => {
    expect(reportKey(rpInput({ language: "ko" })).promptIds).toStrictEqual([
      "TREND_REPORT_KO",
      "SELF_CRITIQUE",
    ]);
    expect(reportKey(rpInput()).modelIds).toStrictEqual([
      REDUCE_CALL.modelId,
      CRITIQUE_CALL.modelId,
    ]);
    const sameModel = rpInput({
      critique: {
        rounds: 1,
        call: { ...CRITIQUE_CALL, modelId: REDUCE_CALL.modelId },
      },
    });
    expect(reportKey(sameModel).modelIds).toStrictEqual([REDUCE_CALL.modelId]);
  });
});

// ---------------------------------------------------------------------------
// 5. Holes are refused; nothing outside the named fields is key material
// ---------------------------------------------------------------------------

describe("refusals", () => {
  it.each<[string, () => unknown]>([
    ["tc with no members", () => tc(tcInput({ members: [] }))],
    [
      "tc with an id twice",
      () =>
        tc(
          tcInput({
            members: [
              ...digestHashes(),
              { id: "AAAA2222", hash: "e".repeat(64) },
            ],
          }),
        ),
    ],
    [
      "tc with an empty hash",
      () => tc(tcInput({ members: [{ id: "AAAA2222", hash: "" }] })),
    ],
    [
      "tc with an empty id",
      () => tc(tcInput({ members: [{ id: "", hash: "e".repeat(64) }] })),
    ],
    [
      "tc without THEME_MERGE's epoch",
      () => tc(tcInput({ promptCacheEpochs: { THEME_CLUSTER: 1 } })),
    ],
    [
      "tc with a fractional epoch",
      () =>
        tc(
          tcInput({
            promptCacheEpochs: { ...epochsWith(), THEME_CLUSTER: 1.5 },
          }),
        ),
    ],
    [
      "tc with epoch 0",
      () =>
        tc(tcInput({ promptCacheEpochs: { ...epochsWith(), THEME_MERGE: 0 } })),
    ],
    [
      "tc with a NaN band",
      () =>
        tc(
          tcInput({
            themeBand: { minThemes: NaN, maxThemes: 4, minPapersPerTheme: 2 },
          }),
        ),
    ],
    [
      "tc with an infinite maxThemes",
      () =>
        tc(
          tcInput({
            themeBand: {
              minThemes: 2,
              maxThemes: Infinity,
              minPapersPerTheme: 2,
            },
          }),
        ),
    ],
    [
      "tc with a NaN minPapersPerTheme",
      () =>
        tc(
          tcInput({
            themeBand: { minThemes: 2, maxThemes: 4, minPapersPerTheme: NaN },
          }),
        ),
    ],
    [
      "tc with an empty model",
      () => tc(tcInput({ call: { ...CLUSTER_CALL, modelId: "" } })),
    ],
    [
      "tc with a NaN temperature",
      () => tc(tcInput({ call: { ...CLUSTER_CALL, temperature: NaN } })),
    ],
    [
      "tc with an empty provider",
      () => tc(tcInput({ providerId: "" as "anthropic" })),
    ],
    ["cr with no members", () => cr(crInput("T1", { members: [] }))],
    ["cr with an empty theme id", () => cr(crInput("T1", { themeId: "" }))],
    [
      "cr with an empty provider",
      () => cr(crInput("T1", { providerId: "" as "anthropic" })),
    ],
    [
      "cr without CLUSTER_REDUCE_MERGE's epoch",
      () => cr(crInput("T1", { promptCacheEpochs: { CLUSTER_REDUCE: 1 } })),
    ],
    [
      "cr with an empty model",
      () => cr(crInput("T1", { call: { ...REDUCE_CALL, modelId: "" } })),
    ],
    ["rp with no theme analyses", () => rp(rpInput({ themeAnalyses: [] }))],
    [
      "rp with a digest twice",
      () =>
        rp(
          rpInput({
            digests: [...digestHashes(), ...digestHashes().slice(0, 1)],
          }),
        ),
    ],
    [
      "rp with a summary twice",
      () =>
        rp(
          rpInput({
            summaries: [
              ...summaryHashes(ITEM_KEYS),
              ...summaryHashes(["AAAA2222"]),
            ],
          }),
        ),
    ],
    [
      "rp with an unknown language",
      () => rp(rpInput({ language: "de" as "en" })),
    ],
    [
      "rp with an empty provider",
      () => rp(rpInput({ providerId: "" as "anthropic" })),
    ],
    [
      "rp with negative rounds",
      () => rp(rpInput({ critique: { rounds: -1, call: CRITIQUE_CALL } })),
    ],
    [
      "rp with fractional rounds",
      () => rp(rpInput({ critique: { rounds: 0.5, call: CRITIQUE_CALL } })),
    ],
    [
      "rp without the report prompt's epoch",
      () => rp(rpInput({ promptCacheEpochs: { SELF_CRITIQUE: 1 } })),
    ],
    [
      "rp without SELF_CRITIQUE's epoch while critiquing",
      () => rp(rpInput({ promptCacheEpochs: { TREND_REPORT_EN: 1 } })),
    ],
    ["rp with a NaN target", () => rp(rpInput({ targetWords: NaN }))],
    [
      "rp with an empty critique model",
      () =>
        rp(
          rpInput({
            critique: { rounds: 1, call: { ...CRITIQUE_CALL, modelId: "" } },
          }),
        ),
    ],
    [
      "rp with an infinite critique temperature",
      () =>
        rp(
          rpInput({
            critique: {
              rounds: 1,
              call: { ...CRITIQUE_CALL, temperature: Infinity },
            },
          }),
        ),
    ],
    [
      "rp with an empty report model",
      () => rp(rpInput({ call: { ...REDUCE_CALL, modelId: "" } })),
    ],
  ])("%s throws a RangeError", (_name, build) => {
    expect(build).toThrow(RangeError);
  });

  it("a property a caller's call object happens to carry is not key material", () => {
    const leaky = { ...CLUSTER_CALL, apiKey: "sk-not-a-real-key" };
    expect(tc(tcInput({ call: leaky }))).toBe(tc(tcInput()));
    const leakyBand = {
      minThemes: 2,
      maxThemes: 4,
      minPapersPerTheme: 2,
      note: "x",
    };
    expect(tc(tcInput({ themeBand: leakyBand }))).toBe(tc(tcInput()));
    expect(
      rp(
        rpInput({
          critique: {
            rounds: 1,
            call: { ...CRITIQUE_CALL, secret: "s" } as typeof CRITIQUE_CALL,
          },
        }),
      ),
    ).toBe(rp(rpInput()));
  });
});

// ---------------------------------------------------------------------------
// 6. Tags — `docs/06` §11.2 reading 8, and reading 4 of 2026-10-27
// ---------------------------------------------------------------------------

describe("synthesis tags", () => {
  const keys: Record<string, SynthesisKey> = {
    tc: themeClusteringKey(tcInput()),
    cr: themeAnalysisKey(crInput("T1")),
    rp: reportKey(rpInput()),
  };

  it("name each keyed prompt's line, each model once and the provider", () => {
    expect(synthesisTags(keys.tc as SynthesisKey, linesWith())).toStrictEqual([
      "promptVersion:THEME_CLUSTER@1.0",
      "promptVersion:THEME_MERGE@1.0",
      `model:${CLUSTER_CALL.modelId}`,
      "provider:anthropic",
    ]);
    expect(synthesisTags(keys.cr as SynthesisKey, linesWith())).toStrictEqual([
      "promptVersion:CLUSTER_REDUCE@1.0",
      "promptVersion:CLUSTER_REDUCE_MERGE@1.0",
      `model:${REDUCE_CALL.modelId}`,
      "provider:anthropic",
    ]);
    expect(synthesisTags(keys.rp as SynthesisKey, linesWith())).toStrictEqual([
      "promptVersion:TREND_REPORT_EN@1.0",
      "promptVersion:SELF_CRITIQUE@1.0",
      `model:${REDUCE_CALL.modelId}`,
      `model:${CRITIQUE_CALL.modelId}`,
      "provider:anthropic",
    ]);
    expect(THEME_CLUSTERING_KEY_PROMPTS).toStrictEqual([
      "THEME_CLUSTER",
      "THEME_MERGE",
    ]);
    expect(THEME_ANALYSIS_KEY_PROMPTS).toStrictEqual([
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE_MERGE",
    ]);
  });

  it("a PATCH keeps every tag; a MINOR moves only its own prompt's", () => {
    for (const id of SYNTHESIS_PROMPTS) {
      for (const key of Object.values(keys)) {
        expect(synthesisTags(key, linesWith(id, patchOf(id)))).toStrictEqual(
          synthesisTags(key, linesWith()),
        );
        const minor = synthesisTags(key, linesWith(id, "1.1.0"));
        const changed = minor.filter(
          (tag) => !synthesisTags(key, linesWith()).includes(tag),
        );
        expect(changed).toStrictEqual(
          key.promptIds.includes(id) ? [`promptVersion:${id}@1.1`] : [],
        );
      }
    }
  });

  it("write the same prompt tag as the summary cache, so the startup invalidation reaches synthesis entries", async () => {
    for (const id of SYNTHESIS_PROMPTS) {
      for (const version of ["1.0.0", "1.0.1", "1.1.0"]) {
        expect(promptLineTag(id, promptCacheLine(version))).toBe(
          promptVersionTag(id, version),
        );
      }
    }
    // The shipped reconciliation, over a fake store holding a tc entry.
    const entryTags = synthesisTags(keys.tc as SynthesisKey, linesWith());
    const invalidated: string[] = [];
    const lastSeen = { ...REGISTRY.versions };
    await reconcilePromptVersions({
      cache: {
        invalidateByTag: (tag) => {
          invalidated.push(tag);
          return Promise.resolve(entryTags.includes(tag) ? 1 : 0);
        },
      },
      shipped: { ...REGISTRY.versions, THEME_MERGE: "1.1.0" },
      readLastSeen: () => JSON.stringify(lastSeen),
      writeLastSeen: () => undefined,
    });
    expect(invalidated).toStrictEqual(["promptVersion:THEME_MERGE@1.0"]);
    expect(entryTags).toContain(invalidated[0]);
  });

  it("escape a comma or percent in a value, and refuse a missing line", () => {
    const odd = themeClusteringKey(
      tcInput({ call: { ...CLUSTER_CALL, modelId: "vendor/model,50%" } }),
    );
    expect(synthesisTags(odd, linesWith())).toContain(
      "model:vendor/model%2C50%25",
    );
    const { THEME_MERGE: _dropped, ...partial } = linesWith();
    expect(() => synthesisTags(odd, partial)).toThrow(RangeError);
    expect(() => synthesisTags(odd, { ...partial, THEME_MERGE: "" })).toThrow(
      RangeError,
    );
  });
});

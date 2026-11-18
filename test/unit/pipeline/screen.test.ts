/**
 * `P3-T27` steps 1–5 — retracted, non-English and duplicate items handled by
 * policy before they can contribute a finding (`docs/06` §13.2–§13.4).
 *
 * Every item is a synthetic fixture written here; the Korean abstract is
 * `P3-T19`'s synthetic `test/fixtures/fulltext/korean-abstract-synthetic.txt`.
 * No network, no model: the one summary call is `test/helpers/mockLLM.ts`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { completeJSON } from "../../../src/llm/shared/jsonMode";
import {
  parsePromptFile,
  PROMPT_SCHEMAS,
  renderPrompt,
  resolveMaxTokens,
} from "../../../src/prompts";
import {
  createSessionSpendCounter,
  createBudgetGuard,
} from "../../../src/pipeline/shared/budget";
import { detectLanguage } from "../../../src/pipeline/summarize/languageDetect";
import { OperationCancelledError } from "../../../src/core/errors";
import {
  applyNonEnglishPolicy,
  crossrefRetractionKinds,
  findCollectionDuplicates,
  findCollectionDuplicatesAsync,
  pubmedRetractionKinds,
  retractionOf,
  SCREEN_YIELD_EVERY_COMPARISONS,
  screenCandidatePairs,
  screenItems,
  screenItemsAreSameWork,
  screenItemsAsync,
  screeningPolicyFrom,
  sourceLanguageOf,
  type ScreeningPolicy,
  type ScreenItem,
  type SummaryConfidenceFields,
} from "../../../src/pipeline/summarize/screen";
import type { ConfigReader } from "../../../src/pipeline/types";
import { createMemoryPrefStore } from "../../../src/core/config";
import { getPref, setPref, setPrefStore } from "../../../src/prefs";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockSettings,
} from "../../helpers/mockLLM";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

const DEFAULT_POLICY: ScreeningPolicy = {
  retractionPolicy: "exclude_from_synthesis",
  nonEnglishPolicy: "translate_summary",
  dedupe: true,
};

const TOPICS = [
  "Widget counts across coastal regions",
  "Gadget repair times in rural workshops",
  "Sprocket wear under cyclic loading",
  "Lantern brightness after long storage",
  "Kettle boiling curves at altitude",
  "Bicycle chain lubrication intervals",
  "Teapot glaze cracking during firing",
];

let nextId = 1;
function item(overrides: Partial<ScreenItem> = {}): ScreenItem {
  const id = nextId++;
  return {
    key: `ITEM${String(id).padStart(4, "0")}`,
    itemID: id,
    itemType: "journalArticle",
    // Distinct words per item: titles that differ by one digit are one paper
    // to the cascade's fuzzy tier, which is the point of it.
    title: `${TOPICS[id % TOPICS.length] ?? ""} in a synthetic study, fixture ${String(id)}`,
    year: 2025,
    firstAuthorFamily: "Kim",
    abstractLength: 800,
    hasFullText: false,
    dateAdded: "2026-01-01 00:00:00",
    ...overrides,
  };
}

/** `docs/06` §13.3's Wakefield `updated-by`, verbatim (verified live there). */
const WAKEFIELD_UPDATED_BY = [
  {
    DOI: "10.1016/s0140-6736(04)15715-2",
    type: "correction",
    label: "Correction",
    source: "retraction-watch",
    updated: { "date-parts": [[2004, 3, 6]] },
    "record-id": "17269",
  },
  {
    DOI: "10.1016/s0140-6736(10)60175-4",
    type: "retraction",
    label: "Retraction",
    source: "retraction-watch",
    updated: { "date-parts": [[2010, 2, 6]] },
    "record-id": "4036",
  },
];

// ===========================================================================
// 1. Retractions — docs/06 §13.3
// ===========================================================================

describe("retractions (docs/06 §13.3)", () => {
  it("excludes an item Zotero reports retracted from synthesis, keeps it, and counts it (Done-when)", () => {
    const retracted = item({
      retraction: {
        zotero: {
          retracted: true,
          reasons: ["Falsification/Fabrication of Data"],
        },
      },
    });
    const clean = item();
    const report = screenItems([retracted, clean], DEFAULT_POLICY);
    const [decision, other] = report.decisions;

    expect(decision).toMatchObject({
      key: retracted.key,
      synthesize: false,
      summarize: false,
      bibliography: true,
      reason: "retracted",
      retraction: {
        excluded: true,
        layers: ["zotero"],
        reasons: ["Falsification/Fabrication of Data"],
      },
    });
    expect(decision?.annotations).toContain("retracted");
    // Kept: one decision per item, in item order — nothing is dropped.
    expect(report.decisions.map((d) => d.key)).toEqual([
      retracted.key,
      clean.key,
    ]);
    expect(report.counts.retracted).toBe(1);
    expect(other).toMatchObject({
      synthesize: true,
      summarize: true,
      bibliography: true,
    });
    expect(other?.reason).toBeUndefined();
  });

  it("never lets a retracted paper reach synthesis, under every retraction policy", () => {
    const retracted = item({ retraction: { zotero: { retracted: true } } });
    const rows = (
      ["include", "exclude_from_synthesis", "exclude_entirely"] as const
    ).map((retractionPolicy) => {
      const [d] = screenItems([retracted], {
        ...DEFAULT_POLICY,
        retractionPolicy,
      }).decisions;
      return [retractionPolicy, d?.summarize, d?.synthesize, d?.bibliography];
    });
    expect(rows).toEqual([
      ["include", true, false, true],
      ["exclude_from_synthesis", false, false, true],
      ["exclude_entirely", false, false, false],
    ]);
  });

  it("annotates an expression of concern and does not exclude it (Done-when)", () => {
    const concern = item({
      retraction: {
        crossrefUpdatedBy: [
          { type: "expression_of_concern", label: "Expression of concern" },
        ],
      },
    });
    const report = screenItems([concern], DEFAULT_POLICY);
    expect(report.decisions[0]).toMatchObject({
      summarize: true,
      synthesize: true,
      bibliography: true,
      annotations: ["expression_of_concern"],
      retraction: {
        excluded: false,
        kinds: ["expression_of_concern"],
        layers: ["crossref"],
      },
    });
    expect(report.decisions[0]?.reason).toBeUndefined();
    expect(report.counts).toMatchObject({
      retracted: 0,
      expressionsOfConcern: 1,
    });
  });

  it("reads Crossref's updated-by from a response already held: retraction, withdrawal, removal; a correction is nothing", () => {
    expect(crossrefRetractionKinds(WAKEFIELD_UPDATED_BY)).toEqual([
      "retracted",
    ]);
    expect(
      crossrefRetractionKinds([
        { type: "withdrawal" },
        { type: "removal" },
        { type: "correction" },
      ]),
    ).toEqual(["withdrawn", "removed"]);
    for (const junk of [
      undefined,
      null,
      "retraction",
      {},
      [null, 3, { type: 7 }],
    ]) {
      expect(crossrefRetractionKinds(junk)).toEqual([]);
    }
  });

  it("reads PubMed's publication types: the retracted article and the retraction notice", () => {
    expect(
      pubmedRetractionKinds([
        "Journal Article",
        "Research Support, Non-U.S. Gov't",
        "Retracted Publication",
      ]),
    ).toEqual(["retracted"]);
    expect(pubmedRetractionKinds(["retraction of publication"])).toEqual([
      "retraction_notice",
    ]);
    expect(pubmedRetractionKinds(["Journal Article"])).toEqual([]);
    const notice = item({
      retraction: { pubmedPublicationTypes: ["Retraction of Publication"] },
    });
    expect(screenItems([notice], DEFAULT_POLICY).decisions[0]).toMatchObject({
      synthesize: false,
      reason: "retracted",
    });
  });

  it("consults Crossref and PubMed only for an item Zotero did not already flag", () => {
    const finding = retractionOf({
      zotero: { retracted: true },
      crossrefUpdatedBy: [{ type: "expression_of_concern" }],
      pubmedPublicationTypes: ["Retracted Publication"],
    });
    expect(finding).toEqual({
      excluded: true,
      kinds: ["retracted"],
      layers: ["zotero"],
      reasons: [],
    });
    expect(retractionOf({ zotero: { retracted: false } })).toBeUndefined();
    expect(retractionOf(undefined)).toBeUndefined();
  });
});

// ===========================================================================
// 2. Non-English — docs/06 §13.2
// ===========================================================================

const KOREAN = readFileSync(
  resolve(repo, "test/fixtures/fulltext/korean-abstract-synthetic.txt"),
  "utf8",
);

/** An English `PaperSummary` v1 the mock returns, confidence `high`. */
function englishSummary(itemKey: string): Record<string, unknown> {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey,
    sourceTier: "abstract",
    confidence: "high",
    researchQuestion:
      "How did weekly widget counts change across three regions over one year?",
    studyDesign: { label: null, detail: null },
    population: { kind: null, description: null, size: null },
    methods: [],
    keyFindings: [],
    effectSizes: [],
    limitations: [],
    novelty: null,
    keywords: ["widget counts"],
    researchTheme: null,
    citationWorthiness: {
      score: 2,
      reason: "A synthetic fixture with a small effect.",
    },
    notEnoughInformation: ["effectSizes"],
  };
}

describe("non-English items (docs/06 §13.2)", () => {
  it("summarizes a Korean abstract untranslated under translate_summary and returns English with source_language: ko and confidence ≤ medium (Done-when)", async () => {
    const language = detectLanguage(KOREAN);
    expect(language).toMatchObject({
      nonEnglish: true,
      dominantScript: "hangul",
    });
    const korean = item({ key: "KOREAN01", language });
    const [decision] = screenItems([korean], DEFAULT_POLICY).decisions;
    expect(decision).toMatchObject({
      summarize: true,
      synthesize: true,
      nonEnglishPolicy: "translate_summary",
      sourceLanguage: "ko",
      annotations: ["source_language"],
    });
    if (decision === undefined) return;

    // The one summary call, as `P3-T25`'s summarizer will make it: the source
    // text goes in as it is — no translation call first.
    const prompt = parsePromptFile({
      fileName: "paper-summary-abstract.v1.0.0.md",
      text: readFileSync(
        resolve(repo, "src/prompts/paper-summary-abstract.v1.0.0.md"),
        "utf8",
      ),
    });
    const schema = PROMPT_SCHEMAS["paper-summary.v1.json"] ?? {};
    const rendered = renderPrompt(prompt, {
      ITEM_KEY: "KOREAN01",
      TITLE: "위젯 수의 지역별 변화",
      AUTHORS: "Kim",
      YEAR: "2025",
      VENUE: "none",
      ITEM_TYPE: "journalArticle",
      DOI: "none",
      TAGS: "none",
      ABSTRACT: KOREAN,
      JSON_SCHEMA: JSON.stringify(schema),
    });
    const provider = mockLLM([
      chatResponse(JSON.stringify(englishSummary("KOREAN01"))),
    ]);
    const router = mockLLMRouter(
      [provider],
      mockSettings({ keyPresent: { openrouter: true } }),
    );
    const budget = createBudgetGuard({ session: createSessionSpendCounter() });
    const { value } = await completeJSON<
      SummaryConfidenceFields & Record<string, unknown>
    >(
      router,
      {
        model: "summary-model",
        messages: [
          { role: "system", content: rendered.system },
          { role: "user", content: rendered.user },
        ],
        temperature: 0,
        maxOutputTokens: resolveMaxTokens(prompt),
        responseFormat: { kind: "json_schema", name: "PaperSummary", schema },
        traceId: "p3t27-korean",
      },
      { token: createCancellationTokenSource().token, budget },
    );
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.messages[1]?.content).toContain(
      KOREAN.trim().slice(0, 40),
    );

    const summary = applyNonEnglishPolicy(value, decision);
    expect(summary.confidence).toBe("medium");
    expect(summary.notEnoughInformation).toEqual([
      "effectSizes",
      "source_language: ko",
    ]);
    expect(detectLanguage(String(summary["researchQuestion"])).nonEnglish).toBe(
      false,
    );
    // Idempotent, and a summary already at or below medium keeps its value.
    expect(applyNonEnglishPolicy(summary, decision)).toEqual(summary);
    expect(applyNonEnglishPolicy({ confidence: "low" }, decision)).toEqual({
      confidence: "low",
      notEnoughInformation: ["source_language: ko"],
    });
  });

  it("skips a non-English item under skip, and leaves it alone under summarize_in_source_language", () => {
    const language = detectLanguage(KOREAN);
    const skipped = screenItems([item({ language })], {
      ...DEFAULT_POLICY,
      nonEnglishPolicy: "skip",
    });
    expect(skipped.decisions[0]).toMatchObject({
      summarize: false,
      synthesize: false,
      reason: "language_non_english",
    });
    expect(skipped.counts).toMatchObject({
      nonEnglish: 1,
      nonEnglishSkipped: 1,
    });

    const kept = screenItems([item({ language })], {
      ...DEFAULT_POLICY,
      nonEnglishPolicy: "summarize_in_source_language",
    });
    const [decision] = kept.decisions;
    expect(decision).toMatchObject({ summarize: true, synthesize: true });
    if (decision === undefined) return;
    const summary = { confidence: "high" as const, notEnoughInformation: [] };
    expect(applyNonEnglishPolicy(summary, decision)).toBe(summary);
  });

  it("names a language only where the script does", () => {
    expect(sourceLanguageOf("hangul")).toBe("ko");
    expect(sourceLanguageOf("cjk")).toBe("und-Hani");
    expect(sourceLanguageOf("cyrillic")).toBe("und-Cyrl");
    expect(sourceLanguageOf("arabic")).toBe("und-Arab");
    expect(sourceLanguageOf(null)).toBe("und");
  });
});

// ===========================================================================
// 3. Duplicates — docs/06 §13.4
// ===========================================================================

describe("collection-scoped duplicates (docs/06 §13.4)", () => {
  const TITLE =
    "Lipid nanoparticles deliver CRISPR editors to hepatocytes in vivo";

  it("detects a preprint/published pair and keeps the published version (Done-when)", () => {
    const preprint = item({
      key: "PREPRINT",
      itemType: "preprint",
      title: TITLE,
      year: 2025,
      doi: "10.1101/2025.01.01.123456",
      hasFullText: true,
      abstractLength: 2000,
      dateAdded: "2025-01-02 00:00:00",
    });
    const published = item({
      key: "PUBLISHD",
      title: TITLE,
      year: 2026,
      doi: "10.1038/s41587-026-00001-1",
      dateAdded: "2026-03-01 00:00:00",
    });
    expect(findCollectionDuplicates([preprint, published])).toEqual(
      new Map([["PREPRINT", "PUBLISHD"]]),
    );
    const report = screenItems([preprint, published], DEFAULT_POLICY);
    expect(report.decisions[0]).toMatchObject({
      key: "PREPRINT",
      summarize: false,
      synthesize: false,
      bibliography: false,
      reason: "duplicate_of:PUBLISHD",
      duplicateOf: "PUBLISHD",
    });
    expect(report.decisions[1]).toMatchObject({
      key: "PUBLISHD",
      synthesize: true,
    });
    expect(report.counts.duplicates).toBe(1);
  });

  it("finds a preprint pair with no identifiers at all, years within 2, and not one 3 years apart", () => {
    const pre = item({
      key: "PRE00001",
      itemType: "preprint",
      title: TITLE,
      year: 2024,
    });
    const pub = item({ key: "PUB00001", title: TITLE, year: 2026 });
    expect(findCollectionDuplicates([pre, pub]).get("PRE00001")).toBe(
      "PUB00001",
    );
    const far = item({
      key: "PRE00002",
      itemType: "preprint",
      title: TITLE,
      year: 2023,
    });
    expect(findCollectionDuplicates([far, pub]).size).toBe(0);
  });

  it("matches two copies of one article by DOI and resolves by full text, abstract, then dateAdded", () => {
    const doi = "10.1000/synthetic.0001";
    const withPdf = item({
      key: "WITHPDF1",
      doi,
      title: TITLE,
      hasFullText: true,
      abstractLength: 10,
    });
    const longer = item({
      key: "LONGER01",
      doi,
      title: TITLE,
      abstractLength: 5000,
    });
    expect(findCollectionDuplicates([longer, withPdf])).toEqual(
      new Map([["LONGER01", "WITHPDF1"]]),
    );

    const early = item({
      key: "EARLY001",
      doi,
      title: TITLE,
      dateAdded: "2024-01-01 00:00:00",
    });
    const late = item({
      key: "LATE0001",
      doi,
      title: TITLE,
      dateAdded: "2025-01-01 00:00:00",
    });
    expect(findCollectionDuplicates([late, early])).toEqual(
      new Map([["LATE0001", "EARLY001"]]),
    );
    const long = item({
      key: "LONG0001",
      doi,
      title: TITLE,
      abstractLength: 900,
    });
    const short = item({
      key: "SHORT001",
      doi,
      title: TITLE,
      abstractLength: 100,
    });
    expect(findCollectionDuplicates([short, long])).toEqual(
      new Map([["SHORT001", "LONG0001"]]),
    );
  });

  it("groups three copies transitively and keeps one", () => {
    const doi = "10.1000/synthetic.0002";
    const a = item({
      key: "AAAAAAAA",
      doi,
      title: TITLE,
      dateAdded: "2024-01-01 00:00:00",
    });
    const b = item({
      key: "BBBBBBBB",
      doi,
      title: TITLE,
      dateAdded: "2024-02-01 00:00:00",
    });
    const c = item({
      key: "CCCCCCCC",
      doi,
      title: TITLE,
      dateAdded: "2024-03-01 00:00:00",
    });
    expect(findCollectionDuplicates([c, b, a])).toEqual(
      new Map([
        ["CCCCCCCC", "AAAAAAAA"],
        ["BBBBBBBB", "AAAAAAAA"],
      ]),
    );
  });

  it("leaves distinct papers and a merely similar pair alone, and does nothing with screening.dedupe off", () => {
    const one = item({
      title: "Widget counts in coastal regions over one synthetic year",
    });
    const two = item({
      title: "A completely different synthetic topic about gadget repair",
    });
    expect(findCollectionDuplicates([one, two]).size).toBe(0);

    const doi = "10.1000/synthetic.0003";
    const x = item({ doi, title: TITLE });
    const y = item({ doi, title: TITLE });
    expect(
      screenItems([x, y], { ...DEFAULT_POLICY, dedupe: false }).counts
        .duplicates,
    ).toBe(0);
  });
});

// ===========================================================================
// 3a. P7-T41 — the duplicate screen compares only likely pairs, and yields
// ===========================================================================

/**
 * The screen as it was before `P7-T41` (`findCollectionDuplicates` at
 * 2ba93f1), with its pair predicate taken from the module: every pair of the
 * collection, grouped transitively, kept by §13.4's order. Only the loop over
 * pairs differs from the module, so the two must give the same map.
 */
function allPairsDuplicates(
  items: readonly ScreenItem[],
): ReadonlyMap<string, string> {
  const parent = items.map((_item, i) => i);
  const find = (i: number): number => {
    let x = i;
    while ((parent[x] ?? x) !== x) x = parent[x] ?? x;
    return x;
  };
  for (const [i, j] of allSameWorkPairs(items)) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  }
  const keepOrder = (a: ScreenItem, b: ScreenItem): number => {
    const published = (x: ScreenItem): number =>
      x.itemType === "preprint" ? 1 : 0;
    return (
      published(a) - published(b) ||
      Number(b.hasFullText) - Number(a.hasFullText) ||
      b.abstractLength - a.abstractLength ||
      a.dateAdded.localeCompare(b.dateAdded) ||
      a.key.localeCompare(b.key)
    );
  };
  const groups = new Map<number, ScreenItem[]>();
  items.forEach((x, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [x]);
    else group.push(x);
  });
  const dropped = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [kept, ...rest] = [...group].sort(keepOrder);
    if (kept === undefined) continue;
    for (const x of rest) dropped.set(x.key, kept.key);
  }
  return dropped;
}

/** Every pair of `items` the module's predicate calls one paper, as "i:j". */
function allSameWorkPairs(
  items: readonly ScreenItem[],
): (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a !== undefined && b !== undefined && screenItemsAreSameWork(a, b)) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}

/**
 * The P7-T41 proof on one collection: every pair the old all-pairs screen
 * finds is among the pairs the new one compares, and both give the same map.
 * Returns the number of pairs the old screen found.
 */
function expectSameScreen(items: readonly ScreenItem[], what: string): number {
  const compared = new Set(
    screenCandidatePairs(items).map(([i, j]) => `${String(i)}:${String(j)}`),
  );
  const found = allSameWorkPairs(items);
  const missing = found
    .map(([i, j]) => `${String(i)}:${String(j)}`)
    .filter((key) => !compared.has(key));
  expect(missing, `${what}: pairs the old screen finds`).toEqual([]);
  expect(findCollectionDuplicates(items), what).toEqual(
    allPairsDuplicates(items),
  );
  return found.length;
}

interface CorpusRecord {
  readonly recordId: string;
  readonly title: string;
  readonly authors: string;
  readonly year: number | null;
  readonly venue: string | null;
  readonly type: string | null;
  readonly doi: string | null;
  readonly otherIds: Readonly<Record<string, string>>;
  readonly fixtures: readonly string[];
}

interface CorpusPair {
  readonly a: CorpusRecord;
  readonly b: CorpusRecord;
}

/** `test/fixtures/dedup/pairs.jsonl`: the dedup corpus, 552 pairs of real records. */
function corpusPairs(): CorpusPair[] {
  return readFileSync(join(repo, "test/fixtures/dedup/pairs.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CorpusPair);
}

/** A corpus record as the `zotero/` layer would read the item it became. */
function corpusItem(record: CorpusRecord, index: number): ScreenItem {
  const family = record.authors.split(";")[0]?.split(",")[0]?.trim();
  return {
    key: `CORPUS${String(index).padStart(4, "0")}`,
    itemID: 100_000 + index,
    itemType: record.type === "preprint" ? "preprint" : "journalArticle",
    title: record.title,
    year: record.year ?? undefined,
    firstAuthorFamily: family === "" ? undefined : family,
    containerTitle: record.venue ?? undefined,
    doi: record.doi ?? undefined,
    pmid: record.otherIds["pmid"],
    pmcid: record.otherIds["pmcid"],
    arxivId: record.otherIds["arxivId"],
    abstractLength: index % 7,
    hasFullText: index % 3 === 0,
    dateAdded: `2026-01-${String(1 + (index % 28)).padStart(2, "0")} 00:00:00`,
  };
}

/** mulberry32: a small seeded generator, so a failure names its seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "lipid",
  "nanoparticle",
  "delivery",
  "hepatocyte",
  "editing",
  "cohort",
  "randomized",
  "trial",
  "outcome",
  "screening",
  "kinase",
  "inhibitor",
  "receptor",
  "signalling",
  "pathway",
  "mouse",
  "model",
  "variant",
  "association",
  "genome",
  "wide",
  "meta",
  "analysis",
  "review",
];

/**
 * A synthetic collection of near-duplicate families: exact copies, one-letter
 * typos, swapped and dropped words, other numbers, a preprint and its
 * published version, years 0–3 apart, the same or another first author,
 * shared DOIs and PMIDs, short titles. Every kind the cascade decides on.
 */
function randomCollection(seed: number, size: number): ScreenItem[] {
  const rand = seeded(seed);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(rand() * list.length)] as T;
  const items: ScreenItem[] = [];
  let n = 0;
  while (items.length < size) {
    const length = 3 + Math.floor(rand() * 7);
    const words = Array.from({ length }, () => pick(WORDS));
    if (rand() < 0.4) words.push(String(1 + Math.floor(rand() * 3)));
    const base = words.join(" ");
    const year = 2018 + Math.floor(rand() * 6);
    const author = pick(["Kim", "Lee", "Park", "Smith"]);
    const doi = `10.1000/fam.${String(seed)}.${String(n)}`;
    const family = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < family && items.length < size; k += 1) {
      let title = base;
      const variant = rand();
      if (variant < 0.2 && title.length > 4) {
        const at = Math.floor(rand() * title.length);
        title = title.slice(0, at) + "x" + title.slice(at + 1);
      } else if (variant < 0.3 && words.length > 2) {
        const w = [...words];
        [w[0], w[1]] = [w[1] as string, w[0] as string];
        title = w.join(" ");
      } else if (variant < 0.4 && words.length > 5) {
        title = words.slice(0, -1).join(" ");
      } else if (variant < 0.5) {
        title = `${base} ${String(1 + Math.floor(rand() * 3))}`;
      } else if (variant < 0.55) {
        title = `${base}: a synthetic follow up`;
      }
      if (rand() < 0.3) title = title.toUpperCase();
      n += 1;
      items.push({
        key: `R${String(seed)}K${String(n).padStart(4, "0")}`,
        itemID: n,
        itemType: rand() < 0.25 ? "preprint" : "journalArticle",
        title,
        year: rand() < 0.1 ? undefined : year + Math.floor(rand() * 4) - 1,
        firstAuthorFamily: rand() < 0.7 ? author : pick(["Kim", "Cho"]),
        containerTitle: rand() < 0.5 ? pick(["Nature", "Cell"]) : undefined,
        doi: rand() < 0.3 ? doi : rand() < 0.1 ? `${doi}.other` : undefined,
        pmid: rand() < 0.15 ? String(30_000_000 + seed * 1000 + n) : undefined,
        abstractLength: Math.floor(rand() * 3) * 100,
        hasFullText: rand() < 0.3,
        dateAdded: `2025-0${String(1 + Math.floor(rand() * 9))}-01 00:00:00`,
      });
    }
  }
  return items;
}

/** `workloadMemory.spec.ts`'s collection: titles that differ only in a number. */
function workloadCollection(size: number): ScreenItem[] {
  return Array.from({ length: size }, (_, i) =>
    item({
      key: `WORK${String(i).padStart(4, "0")}`,
      title: `p7t15m-1794984398902 full text paper ${String(i + 1)}`,
      year: 2024,
      firstAuthorFamily: undefined,
    }),
  );
}

/** A yield that counts, then hands the event loop back. */
function countingYield(): {
  count: () => number;
  yieldToEventLoop: () => Promise<void>;
} {
  let yields = 0;
  return {
    count: () => yields,
    yieldToEventLoop: () => {
      yields += 1;
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/**
 * 60 titles of one fuzzy group (same numbers, year and author) that are all
 * distinct papers: every pair is compared, and none joins a group.
 */
function oneFuzzyGroupOfSixty(): ScreenItem[] {
  const rand = seeded(41);
  const word = (_i: number): string =>
    Array.from({ length: 10 }, () =>
      String.fromCharCode(97 + Math.floor(rand() * 26)),
    ).join("");
  return Array.from({ length: 60 }, (_, i) =>
    item({
      key: `FUZZ${String(i).padStart(4, "0")}`,
      title: `lipid nanoparticle hepatocyte delivery ${word(i)}`,
      year: 2024,
      firstAuthorFamily: "Kim",
    }),
  );
}

describe("P7-T41: the duplicate screen compares only likely pairs, and yields (owner, plan/00 §6 item 405(a))", () => {
  it(
    "finds every pair the all-pairs screen finds, and the same groups, on the whole dedup corpus as one collection",
    { timeout: 60_000 },
    () => {
      const records = new Map<string, CorpusRecord>();
      for (const pair of corpusPairs()) {
        records.set(pair.a.recordId, pair.a);
        records.set(pair.b.recordId, pair.b);
      }
      const items = [...records.values()].map(corpusItem);
      expect(items.length).toBe(286);
      const found = expectSameScreen(items, "the whole corpus");
      // The corpus holds real duplicates, so the proof is not vacuous.
      expect(found).toBeGreaterThan(20);
      const compared = screenCandidatePairs(items).length;
      expect(compared).toBeLessThan((286 * 285) / 2 / 10);
    },
  );

  it(
    "does the same on each of the corpus's source fixtures as its own collection, and on each corpus pair",
    { timeout: 60_000 },
    () => {
      const byFixture = new Map<string, Map<string, CorpusRecord>>();
      const pairs = corpusPairs();
      for (const pair of pairs) {
        for (const record of [pair.a, pair.b]) {
          for (const fixture of record.fixtures) {
            const set =
              byFixture.get(fixture) ?? new Map<string, CorpusRecord>();
            set.set(record.recordId, record);
            byFixture.set(fixture, set);
          }
        }
      }
      expect(byFixture.size).toBeGreaterThan(50);
      for (const [fixture, set] of byFixture) {
        expectSameScreen([...set.values()].map(corpusItem), fixture);
      }
      let duplicatePairs = 0;
      pairs.forEach((pair, index) => {
        duplicatePairs += expectSameScreen(
          [corpusItem(pair.a, 2 * index), corpusItem(pair.b, 2 * index + 1)],
          `pair ${String(index)}`,
        );
      });
      expect(duplicatePairs).toBeGreaterThan(20);
    },
  );

  it(
    "does the same on 30 seeded collections of near-duplicate families",
    { timeout: 60_000 },
    () => {
      let found = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        found += expectSameScreen(
          randomCollection(seed, 80),
          `seed ${String(seed)}`,
        );
      }
      expect(found).toBeGreaterThan(150);
    },
  );

  it("does the same on this file's own duplicate fixtures together", () => {
    const TITLE =
      "Lipid nanoparticles deliver CRISPR editors to hepatocytes in vivo";
    const doi = "10.1000/synthetic.0001";
    const items = [
      item({
        itemType: "preprint",
        title: TITLE,
        year: 2025,
        doi: "10.1101/2025.01.01.123456",
      }),
      item({ title: TITLE, year: 2026, doi: "10.1038/s41587-026-00001-1" }),
      item({ itemType: "preprint", title: TITLE, year: 2023 }),
      item({ doi, title: TITLE, hasFullText: true }),
      item({ doi, title: TITLE, abstractLength: 5000 }),
      item({
        title: "Widget counts in coastal regions over one synthetic year",
      }),
      item({
        title: "A completely different synthetic topic about gadget repair",
      }),
      item({
        title: "Widget counts in coastal regions over one synthetic yaer",
      }),
    ];
    expect(expectSameScreen(items, "this file's fixtures")).toBeGreaterThan(3);
  });

  it(
    "compares no pair of the 500-item workload's titles, which differ only in their numbers, and finds what the old screen found there",
    { timeout: 60_000 },
    () => {
      const counter = { comparisons: 0 };
      expect(
        findCollectionDuplicates(workloadCollection(500), counter).size,
      ).toBe(0);
      // The old screen compared all 124 750 pairs here (`P7-T15`'s profile).
      expect(counter.comparisons).toBe(0);
      expectSameScreen(workloadCollection(120), "the workload's shape");
    },
  );

  it("does not compare a pair already in one group again", () => {
    const doi = "10.1000/synthetic.0041";
    const copies = Array.from({ length: 10 }, (_, i) =>
      item({ key: `COPY${String(i)}`, doi, title: `Ten copies ${String(i)}` }),
    );
    const counter = { comparisons: 0 };
    const dropped = findCollectionDuplicates(copies, counter);
    expect(dropped.size).toBe(9);
    // The first holder's nine comparisons join every copy; the other 36
    // pairs of the DOI's bucket are already one group.
    expect(counter.comparisons).toBe(9);
  });

  it("compares two bioRxiv DOIs that carry one accession under different prefixes, whatever their titles", () => {
    // `docs/02` §11.2: `10.1101/` and `10.64898/` are both bioRxiv's, so the
    // accession is the secondary key; the titles and authors share nothing, and the
    // titles differ in length enough that the fuzzy group skips the pair.
    const items = [
      item({
        doi: "10.1101/2024.01.02.573001",
        title: "Single cell atlas of the developing zebrafish heart",
        firstAuthorFamily: "Kim",
      }),
      item({
        doi: "10.64898/2024.01.02.573001",
        title: "Chromatin accessibility in regeneration",
        firstAuthorFamily: "Park",
      }),
    ];
    expect(screenCandidatePairs(items)).toEqual([[0, 1]]);
    expect(findCollectionDuplicates(items).size).toBe(1);
    expectSameScreen(items, "one accession, two prefixes");
  });

  it("compares a fuzzy-title pair by different first authors whose titles differ in length by one character", () => {
    // levSim about 0.985: above LEVSIM_DUPLICATE_THRESHOLD, so the length
    // bound must not skip the pair although the authors differ.
    const items = [
      item({
        title:
          "Graph neural networks predict protein stability from sequence alone",
        firstAuthorFamily: "Kim",
      }),
      item({
        title:
          "Graph neural networks predicts protein stability from sequence alone",
        firstAuthorFamily: "Park",
      }),
    ];
    expect(screenCandidatePairs(items)).toEqual([[0, 1]]);
    expect(findCollectionDuplicates(items).size).toBe(1);
    expectSameScreen(items, "one character apart, two authors");
  });

  it("does not compare a near-title pair the fuzzy tier can never match: a preprint against an article, or an item with no year", () => {
    const title =
      "Graph neural networks predict protein stability from sequence alone";
    const near =
      "Graph neural networks predicts protein stability from sequence alone";
    const preprintPair = [
      item({ title, itemType: "preprint", firstAuthorFamily: "Kim" }),
      item({ title: near, firstAuthorFamily: "Kim" }),
    ];
    const noYearPair = [
      item({ title, year: undefined, firstAuthorFamily: "Kim" }),
      item({ title: near, year: undefined, firstAuthorFamily: "Kim" }),
    ];
    for (const [items, label] of [
      [preprintPair, "preprint against article"],
      [noYearPair, "no year"],
    ] as const) {
      expect(screenCandidatePairs(items), label).toEqual([]);
      expectSameScreen(items, label);
    }
  });

  it("yields every SCREEN_YIELD_EVERY_COMPARISONS comparisons and gives the synchronous result", async () => {
    const items = oneFuzzyGroupOfSixty();
    const counting = countingYield();
    const counter = { comparisons: 0 };
    const dropped = await findCollectionDuplicatesAsync(items, {
      counter,
      yieldToEventLoop: counting.yieldToEventLoop,
    });
    expect(dropped).toEqual(findCollectionDuplicates(items));
    expect(counter.comparisons).toBe((60 * 59) / 2);
    expect(counting.count()).toBe(
      Math.floor(counter.comparisons / SCREEN_YIELD_EVERY_COMPARISONS),
    );
    expect(counting.count()).toBeGreaterThan(1);
  });

  it("stops at the next yield once the token is cancelled, with OperationCancelledError", async () => {
    const source = createCancellationTokenSource();
    const counter = { comparisons: 0 };
    let yields = 0;
    await expect(
      findCollectionDuplicatesAsync(oneFuzzyGroupOfSixty(), {
        counter,
        token: source.token,
        yieldToEventLoop: () => {
          yields += 1;
          if (yields === 2) source.cancel({ kind: "user" });
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(yields).toBe(2);
    expect(counter.comparisons).toBe(2 * SCREEN_YIELD_EVERY_COMPARISONS);
  });

  it("screenItemsAsync decides exactly as screenItems, with dedupe on and off", async () => {
    for (const seed of [3, 11, 29]) {
      const items = randomCollection(seed, 60);
      for (const policy of [
        DEFAULT_POLICY,
        { ...DEFAULT_POLICY, dedupe: false },
      ]) {
        expect(
          await screenItemsAsync(items, policy, {
            yieldToEventLoop: () => Promise.resolve(),
          }),
        ).toEqual(screenItems(items, policy));
      }
    }
  });
});

// ===========================================================================
// 4. The policy, read through the job's ConfigReader
// ===========================================================================

describe("screeningPolicyFrom", () => {
  it("reads the three screening preferences through ctx.config, with §8.5's defaults", () => {
    setPrefStore(createMemoryPrefStore());
    const config: ConfigReader = { get: getPref };
    expect(screeningPolicyFrom(config)).toEqual({
      retractionPolicy: "exclude_from_synthesis",
      nonEnglishPolicy: "translate_summary",
      dedupe: true,
    });
    setPref("screeningNonEnglishPolicy", "skip");
    setPref("screeningDedupe", false);
    expect(screeningPolicyFrom(config)).toMatchObject({
      nonEnglishPolicy: "skip",
      dedupe: false,
    });
  });
});

// ===========================================================================
// 5. Zotero.Duplicates is never used (Done-when)
// ===========================================================================

describe("no Zotero.Duplicates", () => {
  it("appears nowhere in src/ outside comments", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|js|mjs)$/.test(name)) files.push(path);
      }
    };
    walk(resolve(repo, "src"));
    walk(resolve(repo, "addon/content"));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((path) => {
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return /Zotero\s*\.\s*Duplicates|\bDuplicates\s*\.\s*(getSearchObject|merge)/.test(
        code,
      );
    });
    expect(offenders).toEqual([]);
  });
});

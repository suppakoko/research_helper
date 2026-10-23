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
import {
  applyNonEnglishPolicy,
  crossrefRetractionKinds,
  findCollectionDuplicates,
  pubmedRetractionKinds,
  retractionOf,
  screenItems,
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

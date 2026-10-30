/**
 * `P3-T24` step 7: the prompt files reach a bundle, and the registry built
 * from the bundled copies loads every prompt (`docs/12` §17.3, decided
 * 2026-10-20, `plan/00` §6 item 237). `P4-T03` added Phase 4's six
 * synthesis prompts and their schemas (2026-10-26).
 *
 * `src/prompts/bundled.ts` imports each prompt file with
 * `with { type: "text" }`. The scaffold builds this spec with its own esbuild
 * settings, separate from the plugin build and with no loader for `.md`, so
 * this spec running at all proves that build inlines the files. It then checks
 * the inlined copies byte for byte and renders every prompt with a fixture.
 *
 * **The wiring module is loaded inside a test, not at the top of the file.**
 * It builds the registry when it is first evaluated, and a bad file throws
 * there. A throw at the top of a spec script happens before Mocha runs, so the
 * spec's tests would never be registered and the run could still pass. A
 * dynamic `import()` — which esbuild inlines into this bundle as a lazy
 * module, with no second file — turns that throw into a failing test.
 *
 * No network, no model call, no Zotero data.
 */

import {
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
  PROMPT_SCHEMAS,
  renderPrompt,
  resolveMaxTokens,
  type PromptId,
} from "../../src/prompts";
import { sha256Hex } from "../support/sha256";

declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  isNull(value: unknown, message?: string): void;
};

type Bundled = typeof import("../../src/prompts/bundled");

function loadBundled(): Promise<Bundled> {
  return import("../../src/prompts/bundled");
}

/**
 * SHA-256 of each released file. A released prompt file is never edited
 * (`docs/12` §17.5), so these never change; a new version adds a line.
 * The unit test separately checks the text against `docs/12` §3–§21.
 * `theme-merge` and `cluster-reduce-merge` are approved as drafted, and
 * `theme-cluster` was regenerated from `docs/12` §8 after its three numbers
 * moved to the user text, still at 1.0.0 (decided 2026-10-26, owner,
 * `plan/00` §6 item 290(a) and (b)). The two 1.0.1 lines are the PATCH that
 * raised `TREND_REPORT_EN`'s and `TREND_REPORT_KO`'s output ceilings only; the
 * 1.0.0 lines are unchanged (owner, `plan/00` §6 item 311(c), 2026-10-30;
 * `docs/12` §17.3).
 */
const RELEASED_FILE_SHA256: Readonly<Record<string, string>> = {
  "relevance-screen.v1.0.0.md":
    "043640d30c4cfdbafb1cf573a8400e913bbfd917866954b9f40d730c1957a08a",
  "paper-summary-abstract.v1.0.0.md":
    "dcab5642e60b2a16ad646afbdc4a778291ad5ac336ba26fa7cd1624cfaedd1a2",
  "paper-summary-fulltext.v1.0.0.md":
    "07dbe67098265d25a2276a5515dd0f3b1bdedc2ab01d1e812c385d0bcf98ee49",
  "chunk-map.v1.0.0.md":
    "e622569a02f47b6460de33bf717cfa461d6803afcd553be2d26b840fa1f75d32",
  "chunk-reduce.v1.0.0.md":
    "11b20b47dd8e262c0b3bbb45961fa655dca18659e095a166183b869e52c4dc3e",
  "theme-cluster.v1.0.0.md":
    "0f39ee1d6fe2336df8bf2d3eae663352371e1b9d1ac8a415217dccb1d31ed599",
  "cluster-reduce.v1.0.0.md":
    "855ee315b10b48c5287edc52361b45784025215aa018b42f2d54b69566e07b37",
  "trend-report-en.v1.0.0.md":
    "924278144417429fd68254b7c6651bde3e282514d854ddd0b556005f5eb173f6",
  "trend-report-ko.v1.0.0.md":
    "7958173be07c29e4fd2501195ccd3bd6b24e8f14f9aa205ae29423fe21a67bae",
  "trend-report-en.v1.0.1.md":
    "6c27e532b931d00faabf27f7ef436256b12312c464e4e7714c9405c2f9201488",
  "trend-report-ko.v1.0.1.md":
    "734b3b38f5ed7b37130e1e25ac68576bbd3b4678967c802862ca7a7985a2af84",
  "self-critique.v1.0.0.md":
    "9086b1efde2465d2c5bae00519ecbbaada19ec4235d0b9d43845b7fc7191f1f7",
  "theme-merge.v1.0.0.md":
    "dac9f1618602ed4561d8faa2a43463ccd606c5dbb7d781a811db355774745578",
  "cluster-reduce-merge.v1.0.0.md":
    "154a2754ebb4780aa0446a26b4b7cf058f0e29ec2bad02ef01cfd3901b0920b4",
};

/** Each prompt's schema file, or `null` (`docs/12` §3–§21). */
const SCHEMA_FILES: Readonly<Record<PromptId, string | null>> = {
  RELEVANCE_SCREEN: null,
  PAPER_SUMMARY_ABSTRACT: "paper-summary.v1.json",
  PAPER_SUMMARY_FULLTEXT: "paper-summary.v1.json",
  CHUNK_MAP: null,
  CHUNK_REDUCE: "paper-summary.v1.json",
  THEME_CLUSTER: "theme-clustering.v1.json",
  CLUSTER_REDUCE: "theme-analysis.v1.json",
  TREND_REPORT_EN: null,
  TREND_REPORT_KO: null,
  SELF_CRITIQUE: "self-critique.v1.json",
  THEME_MERGE: "theme-merge.v1.json",
  CLUSTER_REDUCE_MERGE: "theme-analysis.v1.json",
};

/** Each prompt's temperature (`docs/06` §11.1; `docs/12` §8, §20, §21). */
const TEMPERATURES: Readonly<Record<PromptId, number>> = {
  RELEVANCE_SCREEN: 0,
  PAPER_SUMMARY_ABSTRACT: 0,
  PAPER_SUMMARY_FULLTEXT: 0,
  CHUNK_MAP: 0,
  CHUNK_REDUCE: 0,
  THEME_CLUSTER: 0.2,
  CLUSTER_REDUCE: 0.3,
  TREND_REPORT_EN: 0.3,
  TREND_REPORT_KO: 0.3,
  SELF_CRITIQUE: 0,
  THEME_MERGE: 0.2,
  CLUSTER_REDUCE_MERGE: 0.3,
};

const SCHEMA_FILE = "paper-summary.v1.json";

describe("P3-T24: the bundled prompt registry (docs/12 §17.3)", function () {
  // Changed 2026-10-30: TREND_REPORT_EN and TREND_REPORT_KO are at 1.0.1, a
  // PATCH that kept cacheEpoch 1, with their 1.0.0 files still bundled (owner,
  // plan/00 §6 item 311(c); docs/12 §17.3).
  it("loads every prompt from the bundled files: 1.0.0, the two report prompts 1.0.1, every cacheEpoch 1", async function () {
    const {
      PROMPT_REGISTRY,
      PROMPT_VERSIONS,
      PROMPT_CACHE_EPOCHS,
      PROMPT_SOURCE_FILES,
    } = await loadBundled();

    const patched: readonly PromptId[] = ["TREND_REPORT_EN", "TREND_REPORT_KO"];
    assert.strictEqual(
      PROMPT_SOURCE_FILES.length,
      PROMPT_IDS.length + patched.length,
    );
    assert.strictEqual(PROMPT_IDS.length, 12);
    const expected: Record<string, string> = {};
    // The summary cache keys on these (2026-10-23, plan/00 §6 item 273(a)).
    for (const id of PROMPT_IDS) {
      assert.strictEqual(PROMPT_CACHE_EPOCHS[id], 1, `${id}: cacheEpoch`);
    }
    for (const id of PROMPT_IDS) {
      const version = patched.includes(id) ? "1.0.1" : "1.0.0";
      const template = PROMPT_REGISTRY.get(id);
      assert.strictEqual(template.id, id);
      assert.strictEqual(template.version, version, id);
      assert.strictEqual(template.cacheEpoch, 1, id);
      assert.strictEqual(template.fileName, PROMPT_FILE_NAMES[id], id);
      assert.include(template.system, " ", `${id}: system text present`);
      assert.include(template.user, "{{", `${id}: user text present`);
      expected[id] = version;
    }
    assert.deepEqual({ ...PROMPT_VERSIONS }, expected);
    // The superseded 1.0.0 files are still readable, with the same text.
    for (const id of patched) {
      const old = PROMPT_REGISTRY.getVersion(id, "1.0.0");
      const active = PROMPT_REGISTRY.get(id);
      assert.strictEqual(old?.cacheEpoch, 1, `${id} 1.0.0: cacheEpoch`);
      assert.strictEqual(old?.system, active.system, `${id}: system text`);
      assert.strictEqual(old?.user, active.user, `${id}: user text`);
    }
    assert.strictEqual(
      PROMPT_REGISTRY.get("TREND_REPORT_EN").defaultMaxTokens,
      23000,
    );
    assert.strictEqual(
      PROMPT_REGISTRY.get("TREND_REPORT_KO").defaultMaxTokens,
      26000,
    );
  });

  it("bundles each prompt file byte for byte", async function () {
    const { PROMPT_SOURCE_FILES } = await loadBundled();

    assert.deepEqual(
      PROMPT_SOURCE_FILES.map((f) => f.fileName).sort(),
      Object.keys(RELEASED_FILE_SHA256).sort(),
    );
    for (const file of PROMPT_SOURCE_FILES) {
      assert.strictEqual(typeof file.text, "string", file.fileName);
      assert.strictEqual(
        sha256Hex(file.text),
        RELEASED_FILE_SHA256[file.fileName],
        `${file.fileName}: bundled text differs from the released file`,
      );
    }
  });

  it("renders PAPER_SUMMARY_ABSTRACT with a fixture and leaves no {{", async function () {
    const { PROMPT_REGISTRY } = await loadBundled();
    const abstract = PROMPT_REGISTRY.get("PAPER_SUMMARY_ABSTRACT");
    const schemaJson = JSON.stringify(PROMPT_SCHEMAS[SCHEMA_FILE]);

    const { system, user } = renderPrompt(abstract, {
      ITEM_KEY: "ABCD2345",
      TITLE: "A randomized trial of something",
      AUTHORS: "Kim, J.; Lee, S.",
      YEAR: "2024",
      VENUE: "Journal of Examples",
      ITEM_TYPE: "journalArticle",
      DOI: "10.1000/example",
      TAGS: "none",
      ABSTRACT: "We randomized 120 participants. The effect was 0.42.",
      JSON_SCHEMA: schemaJson,
    });

    assert.notInclude(user, "{{");
    assert.notInclude(system, "{{");
    assert.strictEqual(system, abstract.system);
    assert.include(user, "- Zotero item key: ABCD2345");
    assert.include(user, 'Set "itemKey" to "ABCD2345"');
    assert.include(
      user,
      "<<<SOURCE_TEXT>>>\nWe randomized 120 participants. The effect was 0.42.\n<<<END_SOURCE_TEXT>>>",
    );
    assert.include(user, schemaJson);
  });

  it("renders every prompt with every declared variable, keeping non-ASCII text intact", async function () {
    const { PROMPT_REGISTRY } = await loadBundled();

    for (const id of PROMPT_IDS) {
      const template = PROMPT_REGISTRY.get(id);
      const vars = Object.fromEntries(
        template.variables.map((name) => [name, `[value of ${name}]`]),
      );
      const { system, user } = renderPrompt(template, vars);
      assert.notInclude(user, "{{", id);
      assert.notInclude(system, "{{", `${id}: system text`);
      for (const name of template.variables) {
        assert.include(user, `[value of ${name}]`, `${id}: ${name}`);
      }
    }

    // The bundled text is UTF-8 that survived both the bundler and the
    // script load: CHUNK_MAP's user text and RELEVANCE_SCREEN's system
    // text each hold an em dash.
    const chunkVars: Record<string, string> = {
      TITLE: "T",
      YEAR: "2024",
      CHUNK_INDEX: "2",
      CHUNK_TOTAL: "5",
      SECTION: "Methods",
      CHUNK_TEXT: "text",
    };
    const chunk = renderPrompt(PROMPT_REGISTRY.get("CHUNK_MAP"), chunkVars);
    assert.include(chunk.user, "CHUNK 2 of 5 — section: Methods");
    assert.include(
      PROMPT_REGISTRY.get("RELEVANCE_SCREEN").system,
      "Scoring scale — use the whole range.",
    );
    // And Hangul: TREND_REPORT_KO is docs/12 §11 verbatim, never translated.
    const ko = PROMPT_REGISTRY.get("TREND_REPORT_KO");
    assert.include(ko.user, "## 1. 요약 (Executive Summary)");
    assert.include(ko.system, "절대 규칙:");
    const koRendered = renderPrompt(
      ko,
      Object.fromEntries(ko.variables.map((name) => [name, "값"])),
    );
    assert.include(koRendered.user, "- 컬렉션: 값");

    // THEME_CLUSTER's three numbers sit in the user text, after USER TOPIC
    // (docs/12 §8, decided 2026-10-26, plan/00 §6 item 290(b)).
    const cluster = PROMPT_REGISTRY.get("THEME_CLUSTER");
    const clusterRendered = renderPrompt(cluster, {
      N_PAPERS: "57",
      YEAR_MIN: "2015",
      YEAR_MAX: "2024",
      USER_TOPIC: "topic",
      MIN_THEMES: "4",
      MAX_THEMES: "7",
      MIN_PAPERS_PER_THEME: "3",
      DIGESTS: "digest",
    });
    assert.include(
      clusterRendered.user,
      "USER TOPIC (the reason this collection exists): topic\nTHEMES REQUIRED: between 4 and 7.\nMINIMUM PAPERS PER THEME: 3\n",
    );
    assert.strictEqual(clusterRendered.system, cluster.system);
  });

  it("carries the schema and max_tokens each bundled prompt declares", async function () {
    const { PROMPT_REGISTRY } = await loadBundled();
    for (const id of PROMPT_IDS) {
      const template = PROMPT_REGISTRY.get(id);
      const schemaFile = SCHEMA_FILES[id];
      if (schemaFile !== null) {
        assert.strictEqual(template.schemaFile, schemaFile, id);
        assert.strictEqual(template.schema, PROMPT_SCHEMAS[schemaFile], id);
      } else {
        assert.isNull(template.schema, id);
      }
      assert.strictEqual(template.defaultTemperature, TEMPERATURES[id], id);
    }
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("RELEVANCE_SCREEN"), 10),
      1000,
    );
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("PAPER_SUMMARY_ABSTRACT")),
      1200,
    );
    // 26 000 since 1.0.1 (owner, plan/00 §6 item 311(c), 2026-10-30).
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("TREND_REPORT_KO")),
      26000,
    );
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("THEME_MERGE")),
      4000,
    );
    // THEME_CLUSTER grows with the papers: 2000 + 40 × N (docs/12 §8).
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("THEME_CLUSTER"), 25),
      3000,
    );
  });
});

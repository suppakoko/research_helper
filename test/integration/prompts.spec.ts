/**
 * `P3-T24` step 7: the prompt files reach a bundle, and the registry built
 * from the bundled copies loads all five prompts (`docs/12` §17.3, decided
 * 2026-10-20, `plan/00` §6 item 237).
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
 * The unit test separately checks the text against `docs/12` §3–§7.
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
};

const SCHEMA_FILE = "paper-summary.v1.json";

describe("P3-T24: the bundled prompt registry (docs/12 §17.3)", function () {
  it("loads all five prompts at version 1.0.0 from the bundled files", async function () {
    const {
      PROMPT_REGISTRY,
      PROMPT_VERSIONS,
      PROMPT_CACHE_EPOCHS,
      PROMPT_SOURCE_FILES,
    } = await loadBundled();

    assert.strictEqual(PROMPT_SOURCE_FILES.length, 5);
    const expected: Record<string, string> = {};
    // The summary cache keys on these (2026-10-23, plan/00 §6 item 273(a)).
    for (const id of PROMPT_IDS) {
      assert.strictEqual(PROMPT_CACHE_EPOCHS[id], 1, `${id}: cacheEpoch`);
    }
    for (const id of PROMPT_IDS) {
      const template = PROMPT_REGISTRY.get(id);
      assert.strictEqual(template.id, id);
      assert.strictEqual(template.version, "1.0.0", id);
      assert.strictEqual(template.cacheEpoch, 1, id);
      assert.strictEqual(template.fileName, PROMPT_FILE_NAMES[id], id);
      assert.include(template.system, " ", `${id}: system text present`);
      assert.include(template.user, "{{", `${id}: user text present`);
      expected[id] = "1.0.0";
    }
    assert.deepEqual({ ...PROMPT_VERSIONS }, expected);
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
      const { user } = renderPrompt(template, vars);
      assert.notInclude(user, "{{", id);
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
  });

  it("carries the schema and max_tokens each bundled prompt declares", async function () {
    const { PROMPT_REGISTRY } = await loadBundled();
    const summaryIds: readonly PromptId[] = [
      "PAPER_SUMMARY_ABSTRACT",
      "PAPER_SUMMARY_FULLTEXT",
      "CHUNK_REDUCE",
    ];

    for (const id of PROMPT_IDS) {
      const template = PROMPT_REGISTRY.get(id);
      if (summaryIds.includes(id)) {
        assert.strictEqual(template.schemaFile, SCHEMA_FILE, id);
        assert.strictEqual(template.schema, PROMPT_SCHEMAS[SCHEMA_FILE], id);
      } else {
        assert.isNull(template.schema, id);
      }
      assert.strictEqual(template.defaultTemperature, 0, id);
    }
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("RELEVANCE_SCREEN"), 10),
      1000,
    );
    assert.strictEqual(
      resolveMaxTokens(PROMPT_REGISTRY.get("PAPER_SUMMARY_ABSTRACT")),
      1200,
    );
  });
});

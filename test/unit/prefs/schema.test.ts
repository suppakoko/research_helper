import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  ConfigurationError,
  KEYISH_FIELD,
  redact,
} from "../../../src/core/errors";
import {
  clearPref,
  coerce,
  getPref,
  guardWritable,
  observePref,
  setPref,
  setPrefStore,
  writePref,
} from "../../../src/prefs";
import {
  PREF_BRANCH,
  PREF_BRANCH_ROOT,
  PREF_KEYS,
  qualifiedPrefKey,
} from "../../../src/prefs/keys";
import {
  PREF_NAMES,
  PREFS,
  type PrefDef,
  type PrefName,
} from "../../../src/prefs/schema";

/**
 * `P1-T03`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * Four things are asserted here, matching the card's four non-typecheck
 * criteria:
 *
 * 1. `PREFS` transcribes `docs/07` §8.5 exactly — key, type, default, bounds and
 *    closed value set, one table row per schema row. This is the card's step 1
 *    made mechanical, and it is the assertion that catches a "helpful" default
 *    change, which the card's **Do NOT** forbids outright.
 * 2. Coercion: the `String(value)` foot-gun of §8.5.1, the no-clamping rule of
 *    step 3, and the never-throws rule.
 * 3. **D5** (`docs/09` §1.7, `plan/README.md` §5 rule 5): no entry is secret, no
 *    key is credential-shaped, and the write guard refuses a secret definition.
 * 4. `addon/prefs.js` ↔ `PREFS` consistency, by reading both files.
 */

afterEach(() => {
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// 1. docs/07 §8.5, transcribed independently of src/prefs/schema.ts
// ---------------------------------------------------------------------------

/** One `docs/07` §8.5 row, as this test types it out. */
interface Section85Row {
  readonly name: PrefName;
  readonly key: string;
  readonly type: PrefDef<unknown>["type"];
  readonly default: boolean | number | string;
  readonly min: number | null;
  readonly max: number | null;
  readonly values: readonly (boolean | number | string)[] | null;
}

/**
 * A compact {@link Section85Row}, for the fifty rows `P3-T32` added. The
 * arguments are still typed out from §8.5 by hand: nothing here reads `PREFS`.
 */
function row(
  name: PrefName,
  key: string,
  type: PrefDef<unknown>["type"],
  value: boolean | number | string,
  bounds: {
    readonly min?: number;
    readonly max?: number;
    readonly values?: readonly (boolean | number | string)[];
  } = {},
): Section85Row {
  return {
    name,
    key,
    type,
    default: value,
    min: bounds.min ?? null,
    max: bounds.max ?? null,
    values: bounds.values ?? null,
  };
}

/** §8.5's `<provider>.lastValidationResult` value set, typed out. */
const VALIDATION_RESULTS = ["ok", "rejected", "forbidden", "inconclusive", ""];

/**
 * One row per `docs/07` §8.5 row a shipped phase reads, typed out from that
 * section rather than derived from `PREFS`.
 *
 * Deriving it would assert only that the schema equals itself. `min` / `max` are
 * `null` where §8.5 gives no bound and `values` is `null` where it gives no
 * closed set, so an accidentally-added bound fails rather than passing silently.
 */
const SECTION_8_5: readonly Section85Row[] = [
  // Sources & search
  {
    name: "sources",
    key: "sources",
    type: "string",
    default: "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv",
    min: null,
    max: null,
    values: null,
  },
  {
    name: "searchYears",
    key: "searchYears",
    type: "integer",
    default: 3,
    min: 1,
    max: 20,
    values: null,
  },
  {
    name: "maxResults",
    key: "maxResults",
    type: "integer",
    default: 100,
    min: 10,
    max: 200,
    values: null,
  },
  {
    name: "useTranslators",
    key: "useTranslators",
    type: "boolean",
    default: false,
    min: null,
    max: null,
    values: null,
  },
  {
    name: "hideExisting",
    key: "hideExisting",
    type: "boolean",
    default: true,
    min: null,
    max: null,
    values: null,
  },
  {
    name: "contactEmail",
    key: "contactEmail",
    type: "string",
    default: "",
    min: null,
    max: null,
    values: null,
  },
  // Runtime & concurrency
  {
    name: "timeoutSeconds",
    key: "timeoutSeconds",
    type: "integer",
    default: 60,
    min: 10,
    max: 600,
    values: null,
  },
  {
    name: "prefsSchemaVersion",
    key: "prefsSchemaVersion",
    type: "integer",
    default: 0,
    min: 0,
    max: null,
    values: null,
  },
  // Diagnostics
  {
    name: "logLevel",
    key: "logLevel",
    type: "string",
    default: "warn",
    min: null,
    max: null,
    values: ["error", "warn", "info", "debug"],
  },
  {
    name: "logRequestBodies",
    key: "logRequestBodies",
    type: "boolean",
    default: false,
    min: null,
    max: null,
    values: null,
  },
  // Non-secret key-presence flags
  {
    name: "ncbiKeyPresent",
    key: "ncbi.keyPresent",
    type: "boolean",
    default: false,
    min: null,
    max: null,
    values: null,
  },
  // P2-T05, 2026-10-15: the thirteenth row, §8.5's `semanticscholar.keyPresent`.
  {
    name: "semanticscholarKeyPresent",
    key: "semanticscholar.keyPresent",
    type: "boolean",
    default: false,
    min: null,
    max: null,
    values: null,
  },
  {
    name: "secretBackend",
    key: "secretBackend",
    type: "string",
    default: "",
    min: null,
    max: null,
    // 2026-10-22 (plan/00 §6 item 268): `passphrase` left with tier 3 (G-10).
    values: ["oskeystore", "session", ""],
  },

  // P3-T32, 2026-10-20: the fifty rows Phase 3 reads.
  // LLM providers & models
  row("llmProvider", "llmProvider", "string", "openrouter", {
    values: ["openrouter", "openai", "gemini", "anthropic"],
  }),
  row(
    "openrouterModel",
    "openrouter.model",
    "string",
    "anthropic/claude-sonnet-5",
  ),
  row("openaiModel", "openai.model", "string", "gpt-5.6-terra"),
  row("geminiModel", "gemini.model", "string", "gemini-3.8-flash"),
  row("anthropicModel", "anthropic.model", "string", "claude-sonnet-5"),
  row("openrouterBaseUrl", "openrouter.baseUrl", "string", ""),
  row("openaiBaseUrl", "openai.baseUrl", "string", ""),
  row("geminiBaseUrl", "gemini.baseUrl", "string", ""),
  row("anthropicBaseUrl", "anthropic.baseUrl", "string", ""),
  row("summaryModel", "summaryModel", "string", ""),
  row("reportModel", "reportModel", "string", ""),
  row("screeningModel", "screening.model", "string", ""),
  row("privacyMode", "privacy.mode", "string", "balanced", {
    values: ["strict", "balanced", "full"],
  }),
  row(
    "privacyEgressAcknowledged",
    "privacy.egressAcknowledged",
    "boolean",
    false,
  ),
  // Owner, 2026-10-22 (plan/00 §6 item 269(b)): the sixty-fourth row.
  row("geminiPaidTier", "gemini.paidTier", "boolean", false),
  row(
    "llmTokenEstimateCalibration",
    "llm.tokenEstimateCalibration",
    "string",
    "{}",
  ),
  // Summarization
  row("summaryFullTextMode", "summary.fullTextMode", "string", "auto", {
    values: ["never", "auto", "always"],
  }),
  row(
    "summaryFullTextAutoMaxPapers",
    "summary.fullTextAutoMaxPapers",
    "integer",
    25,
    { min: 1 },
  ),
  row("summaryConfirmAboveCents", "summary.confirmAboveCents", "integer", 200, {
    min: 0,
  }),
  row("summaryMinAbstractChars", "summary.minAbstractChars", "integer", 250, {
    min: 0,
  }),
  row("fullTextPreferJATS", "fullText.preferJATS", "boolean", true),
  row("fullTextHardPageCap", "fullText.hardPageCap", "integer", 60, {
    min: 1,
  }),
  row("autoSummarize", "autoSummarize", "boolean", false),
  row("screeningThreshold", "screening.threshold", "integer", 60, {
    min: 0,
    max: 100,
  }),
  row(
    "screeningRetractionPolicy",
    "screening.retractionPolicy",
    "string",
    "exclude_from_synthesis",
    { values: ["include", "exclude_from_synthesis", "exclude_entirely"] },
  ),
  row(
    "screeningNonEnglishPolicy",
    "screening.nonEnglishPolicy",
    "string",
    "translate_summary",
    { values: ["skip", "translate_summary", "summarize_in_source_language"] },
  ),
  row("screeningDedupe", "screening.dedupe", "boolean", true),
  row("cacheEnabled", "cache.enabled", "boolean", true),
  row("cacheIgnoreModel", "cache.ignoreModel", "boolean", false),
  row(
    "cacheLastSeenPromptVersions",
    "cache.lastSeenPromptVersions",
    "string",
    "{}",
  ),
  row("cacheMaxSizeMB", "cache.maxSizeMB", "integer", 500, {
    min: 100,
    max: 5000,
  }),
  // Report & audio (P3-T32: perPaperNotes; P4-T02, 2026-10-26: the five rows
  // the trend report reads, typed out from §8.5).
  row("reportLanguage", "reportLanguage", "string", "auto", {
    values: ["auto", "en", "ko", "both"],
  }),
  // §8.5: "`0`, or ≥ 400". Only the lower bound is a PrefDef bound; see the
  // reportTargetWords coercion test below for the hole.
  row("reportTargetWords", "report.targetWords", "integer", 0, { min: 0 }),
  row("reportMaxCritiqueRounds", "report.maxCritiqueRounds", "integer", 1, {
    min: 0,
    max: 2,
  }),
  row("reportCritiqueModel", "report.critiqueModel", "string", ""),
  row("reportSaveNote", "report.saveNote", "boolean", true),
  row("reportPerPaperNotes", "report.perPaperNotes", "boolean", false),
  // Runtime & concurrency
  row("concurrency", "concurrency", "integer", 3, { min: 1, max: 8 }),
  row("runMaxSpendCents", "run.maxSpendCents", "integer", 0, { min: 0 }),
  // 500 since the owner answered gate G-20 (2026-10-23, item 271(b)).
  row("runMaxSessionSpendCents", "run.maxSessionSpendCents", "integer", 500, {
    min: 0,
  }),
  // Non-secret key-presence flags
  row("openrouterKeyPresent", "openrouter.keyPresent", "boolean", false),
  row("openaiKeyPresent", "openai.keyPresent", "boolean", false),
  row("geminiKeyPresent", "gemini.keyPresent", "boolean", false),
  row("anthropicKeyPresent", "anthropic.keyPresent", "boolean", false),
  row("openrouterLastValidatedAt", "openrouter.lastValidatedAt", "string", ""),
  row("openaiLastValidatedAt", "openai.lastValidatedAt", "string", ""),
  row("geminiLastValidatedAt", "gemini.lastValidatedAt", "string", ""),
  row("anthropicLastValidatedAt", "anthropic.lastValidatedAt", "string", ""),
  row("ncbiLastValidatedAt", "ncbi.lastValidatedAt", "string", ""),
  row(
    "semanticscholarLastValidatedAt",
    "semanticscholar.lastValidatedAt",
    "string",
    "",
  ),
  row(
    "openrouterLastValidationResult",
    "openrouter.lastValidationResult",
    "string",
    "",
    { values: VALIDATION_RESULTS },
  ),
  row(
    "openaiLastValidationResult",
    "openai.lastValidationResult",
    "string",
    "",
    { values: VALIDATION_RESULTS },
  ),
  row(
    "geminiLastValidationResult",
    "gemini.lastValidationResult",
    "string",
    "",
    { values: VALIDATION_RESULTS },
  ),
  row(
    "anthropicLastValidationResult",
    "anthropic.lastValidationResult",
    "string",
    "",
    { values: VALIDATION_RESULTS },
  ),
  row("ncbiLastValidationResult", "ncbi.lastValidationResult", "string", "", {
    values: VALIDATION_RESULTS,
  }),
  row(
    "semanticscholarLastValidationResult",
    "semanticscholar.lastValidationResult",
    "string",
    "",
    { values: VALIDATION_RESULTS },
  ),
];

/**
 * The §8.5 rows `docs/01` §7.2 gives **no** `pref()` line, typed out from §7.2
 * (`P3-T32` step 2: "rows §7.2 says have no `pref()` line get none"). §7.2's
 * prose names the families and its listing omits these keys; every other row
 * in {@link SECTION_8_5} ships a line.
 */
const NO_PREF_LINE: readonly string[] = [
  "summaryModel",
  "reportModel",
  "screening.model",
  "privacy.egressAcknowledged",
  // Added after §7.2 was written (owner, 2026-10-22, item 269(b)); §8.5's row
  // says it has no `pref()` line.
  "gemini.paidTier",
  "llm.tokenEstimateCalibration",
  "summary.fullTextMode",
  "summary.fullTextAutoMaxPapers",
  "summary.confirmAboveCents",
  "summary.minAbstractChars",
  "fullText.preferJATS",
  "fullText.hardPageCap",
  "screening.threshold",
  "screening.retractionPolicy",
  "screening.nonEnglishPolicy",
  "screening.dedupe",
  "cache.enabled",
  "cache.ignoreModel",
  "cache.lastSeenPromptVersions",
  "report.perPaperNotes",
  // P4-T02 (2026-10-26): §7.2 lists reportLanguage and none of these four.
  "report.targetWords",
  "report.maxCritiqueRounds",
  "report.critiqueModel",
  "report.saveNote",
  "openrouter.lastValidatedAt",
  "openai.lastValidatedAt",
  "gemini.lastValidatedAt",
  "anthropic.lastValidatedAt",
  "ncbi.lastValidatedAt",
  "semanticscholar.lastValidatedAt",
];

/** Read a file under the repository root, resolved from this test's path. */
function readRepoFile(relative: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../..", relative),
    "utf8",
  );
}

/** One `docs/07` §8.5 table row, as the document prints it. */
interface DocRow {
  readonly key: string;
  readonly marked: boolean;
  readonly type: string;
  readonly defaultCell: string;
}

/** The six credential-holding IDs §8.5's `<provider>.*` rows expand to. */
const CREDENTIAL_IDS = [
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
  "ncbi",
  "semanticscholar",
];

/**
 * Every key-bearing table row between `### 8.5 ` and `#### 8.5.1`, read from
 * `docs/07` itself. A `<provider>.x` row expands to one entry per
 * {@link CREDENTIAL_IDS} member, as §8.5 says ("one key per provider ID, same
 * set as `keyPresent`"). Cells split on unescaped pipes only, because value
 * cells write `\|` between alternatives.
 */
function readSection85(): ReadonlyMap<string, DocRow> {
  const lines = readRepoFile("docs/07-architecture-and-data-model.md").split(
    "\n",
  );
  const start = lines.findIndex((l) => l.startsWith("### 8.5 "));
  const end = lines.findIndex((l) => l.startsWith("#### 8.5.1 "));
  if (start < 0 || end <= start) throw new Error("§8.5 not found in docs/07");
  const rows = new Map<string, DocRow>();
  for (const line of lines.slice(start, end)) {
    if (!line.startsWith("| ")) continue;
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.trim());
    const match = /^(⚠ )?`([^`]+)`$/.exec(cells[0] ?? "");
    if (match === null) continue;
    const [, mark, key] = match;
    if (key === undefined) continue;
    const entry = {
      marked: mark !== undefined,
      type: cells[1] ?? "",
      defaultCell: cells[2] ?? "",
    };
    const keys = key.startsWith("<provider>.")
      ? CREDENTIAL_IDS.map((id) => key.replace("<provider>", id))
      : [key];
    for (const k of keys) rows.set(k, { key: k, ...entry });
  }
  return rows;
}

/** The first backtick literal in a §8.5 default cell, parsed as JSON. */
function parseDefaultCell(cell: string): unknown {
  const literal = /`([^`]*)`/.exec(cell)?.[1];
  if (literal === undefined) throw new Error(`no literal in "${cell}"`);
  return JSON.parse(literal);
}

describe("PREFS transcribes docs/07 §8.5", () => {
  it("declares exactly the sixty-nine §8.5 rows that ship — Phase 1's twelve, P2-T05's semanticscholar.keyPresent, P3-T32's fifty, the owner's gemini.paidTier and P4-T02's five — and no others", () => {
    // The card's Do NOT: "do not add a preference that docs/07 §8.5 does not
    // declare". An extra entry fails here, not in review. Phase 1 pinned this
    // at twelve; `P2-T05` grew it by the one row `docs/07` §8.5 and §11.1
    // step 9 give a credential-holding source (2026-10-15); `P3-T32` grew it by
    // the fifty rows Phase 3 reads (2026-10-20); the owner added
    // `gemini.paidTier` (2026-10-22, `plan/00` §6 item 269(b)); `P4-T02` added
    // the five "Report & audio" rows Phase 4 reads (2026-10-26).
    // The owner added the hidden `report.enabled` (2026-10-29, item 307(d));
    // `P4-T20` removed it (2026-11-02), as that decision said it would.
    expect(SECTION_8_5).toHaveLength(69);
    expect(new Set(SECTION_8_5.map((r) => r.name)).size).toBe(69);
    expect([...PREF_NAMES].sort()).toEqual(
      SECTION_8_5.map((row) => row.name).sort(),
    );
  });

  it("names every entry by its key with the dots removed and the next letter capitalised (P3-T32 step 1)", () => {
    for (const r of SECTION_8_5) {
      const derived = r.key.replace(/\.(.)/g, (_, c: string) =>
        c.toUpperCase(),
      );
      expect(r.name, r.key).toBe(derived);
    }
  });

  it("matches every shipped row's type and default to docs/07 §8.5 as the document prints it (P3-T32)", () => {
    // The transcription above is typed by hand; this reads the page, so a
    // default edited in either place without the other fails here.
    const doc = readSection85();
    for (const r of SECTION_8_5) {
      const printed = doc.get(r.key);
      expect(printed, `§8.5 has no ${r.key} row`).toBeDefined();
      if (printed === undefined) continue;
      expect(printed.type.replace(/ \(JSON\)$/, ""), r.key).toBe(r.type);
      expect(parseDefaultCell(printed.defaultCell), r.key).toBe(r.default);
    }
  });

  it("ships no row §8.5 still marks ⚠ except the three Phase 1 already shipped, and none of item 241's three (P3-T32)", () => {
    // `plan/00` §6 item 241 (owner, 2026-10-20): the three names ship as
    // written and §8.5 drops their marks. `prefsSchemaVersion` and
    // `secretBackend` shipped marked in Phase 1 and keep their marks: the
    // second carries a recorded CONFLICT this card does not touch.
    const doc = readSection85();
    for (const key of [
      "privacy.egressAcknowledged",
      "llm.tokenEstimateCalibration",
      "cache.lastSeenPromptVersions",
    ]) {
      expect(doc.get(key)?.marked, `${key} still marked ⚠`).toBe(false);
    }
    const marked = SECTION_8_5.filter((r) => doc.get(r.key)?.marked === true)
      .map((r) => r.key)
      .sort();
    expect(marked).toEqual(["prefsSchemaVersion", "secretBackend"]);
  });

  it("ships the per-run ceiling off at 0 and the session ceiling at 500 cents (gate G-20, owner 2026-10-23, item 271(b))", () => {
    expect(PREFS.runMaxSpendCents.default).toBe(0);
    expect(PREFS.runMaxSessionSpendCents.default).toBe(500);
  });

  it("declares no number row, because Gecko stores no fraction (P3-T39)", () => {
    // `plan/00` §6 item 245: the preference store holds boolean, integer and
    // string values only, so a `number` row could hold a value that does not
    // round-trip. `PrefDef` keeps `"number"` in its union (§8.5.1's interface,
    // verbatim); no shipped row may use it. Money is whole cents.
    const numberRows = PREF_NAMES.filter((name) => {
      const def: PrefDef<unknown> = PREFS[name];
      return def.type === "number";
    });
    expect(numberRows).toEqual([]);
    expect(PREFS.summaryConfirmAboveCents.default).toBe(200);
  });

  it("reads the semanticscholar.keyPresent row back from docs/07 §8.5 itself (P2-T05)", () => {
    // The way `backoff.test.ts` reads §7.3: the document's own table row is
    // the expectation, so the transcription above cannot drift from the page.
    const lines = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../docs/07-architecture-and-data-model.md",
      ),
      "utf8",
    ).split("\n");
    const start = lines.findIndex((l) => l.startsWith("### 8.5 "));
    expect(start).toBeGreaterThan(0);
    const row = lines
      .slice(start)
      .find((l) => l.startsWith("| `semanticscholar.keyPresent` |"));
    if (row === undefined)
      throw new Error("§8.5 has no semanticscholar.keyPresent row");
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    expect(cells[1]).toBe("boolean");
    expect(cells[2]).toBe("`false`");
    const def: PrefDef<unknown> = PREFS.semanticscholarKeyPresent;
    expect(def.key).toBe("semanticscholar.keyPresent");
    expect(def.type).toBe(cells[1]);
    expect(def.default).toBe(false);
    expect(def.secret).toBeUndefined();
  });

  for (const row of SECTION_8_5) {
    it(`${row.name} matches §8.5's row`, () => {
      const def: PrefDef<unknown> = PREFS[row.name];
      expect(def.key).toBe(row.key);
      expect(def.type).toBe(row.type);
      expect(def.default).toBe(row.default);
      expect(def.min ?? null).toBe(row.min);
      expect(def.max ?? null).toBe(row.max);
      expect(def.values ?? null).toEqual(row.values);
    });
  }

  it("types every default consistently with its declared type", () => {
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      const expected =
        def.type === "boolean"
          ? "boolean"
          : def.type === "string"
            ? "string"
            : "number";
      expect(typeof def.default, `${def.key} default`).toBe(expected);
    }
  });

  it("keeps every default inside its own declared bounds and value set", () => {
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      // A default the schema itself would reject makes getPref return a value
      // coerce() disagrees with, which is unfalsifiable at every call site.
      expect(coerce(def, def.default), `${def.key} default`).toBe(def.default);
    }
  });

  it("puts the branch prefixes where docs/07 §8.5.1's two conventions want them", () => {
    expect(PREF_BRANCH).toBe("research-helper.");
    expect(PREF_BRANCH_ROOT).toBe("extensions.zotero.research-helper.");
    expect(qualifiedPrefKey("searchYears")).toBe(
      "extensions.zotero.research-helper.searchYears",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Coercion — docs/07 §8.5.1, and P1-T03 step 3
// ---------------------------------------------------------------------------

describe("getPref coerces and falls back", () => {
  it('returns 100 as a number when maxResults is stored as the string "100"', () => {
    // The card's first criterion, verbatim, and §8.5.1's foot-gun: the pane's
    // `preference=` binding applies String(value) on the way out.
    setPrefStore(createMemoryPrefStore({ maxResults: "100" }));
    const value = getPref("maxResults");
    expect(value).toBe(100);
    expect(typeof value).toBe("number");
  });

  it("reads a stringified number that is NOT the default", () => {
    // The criterion above is unfalsifiable on its own: 100 is also
    // `maxResults`'s schema default, so deleting the Number() coercion
    // entirely still satisfies it (measured — a mutant that dropped
    // `coerceNumeric` passed that test and failed four others). A stored value
    // distinct from the default is what actually proves §8.5.1's
    // `String(value)` path works, which is the bug the whole module exists for.
    setPrefStore(
      createMemoryPrefStore({ maxResults: "150", timeoutSeconds: "120" }),
    );
    expect(getPref("maxResults")).toBe(150);
    expect(getPref("timeoutSeconds")).toBe(120);
    // The point of the coercion, stated as the arithmetic that would otherwise
    // be wrong: "150" + 1 is "1501", 150 + 1 is 151. §8.5.1 calls string
    // arithmetic on maxResults "a classic and very confusing bug".
    expect(getPref("maxResults") + 1).toBe(151);
  });

  it('returns the searchYears default 3 for "abc", 0 and 99', () => {
    // The card's second criterion. 99 is IN-range-shaped but out of 1..20, and
    // §8.5.1's coerce() returns "the schema default when the value is absent,
    // the wrong type, or out of range" — so 99 yields 3, NOT the max of 20.
    for (const stored of ["abc", 0, 99] as const) {
      setPrefStore(createMemoryPrefStore({ searchYears: stored }));
      expect(getPref("searchYears"), `stored ${JSON.stringify(stored)}`).toBe(
        3,
      );
    }
  });

  it("does not clamp at either bound", () => {
    setPrefStore(createMemoryPrefStore({ maxResults: 9 }));
    expect(getPref("maxResults")).toBe(100);
    setPrefStore(createMemoryPrefStore({ maxResults: 201 }));
    expect(getPref("maxResults")).toBe(100);
    setPrefStore(createMemoryPrefStore({ timeoutSeconds: 601 }));
    expect(getPref("timeoutSeconds")).toBe(60);
  });

  it("accepts a legal in-range value at each bound", () => {
    setPrefStore(createMemoryPrefStore({ searchYears: 1, maxResults: "200" }));
    expect(getPref("searchYears")).toBe(1);
    expect(getPref("maxResults")).toBe(200);
  });

  it("rejects a non-integer for an integer pref", () => {
    setPrefStore(createMemoryPrefStore({ searchYears: "3.5" }));
    expect(getPref("searchYears")).toBe(3);
  });

  it("rejects a boolean under a numeric key rather than reading Number(true)", () => {
    setPrefStore(createMemoryPrefStore({ maxResults: true }));
    expect(getPref("maxResults")).toBe(100);
  });

  it("accepts a stringified boolean, which is the same String(value) foot-gun", () => {
    setPrefStore(createMemoryPrefStore({ hideExisting: "false" }));
    expect(getPref("hideExisting")).toBe(false);
    setPrefStore(createMemoryPrefStore({ useTranslators: "true" }));
    expect(getPref("useTranslators")).toBe(true);
  });

  it("rejects a non-string under a string key rather than laundering it", () => {
    setPrefStore(createMemoryPrefStore({ contactEmail: 42 }));
    expect(getPref("contactEmail")).toBe("");
  });

  it("rejects a value outside a closed value set", () => {
    setPrefStore(createMemoryPrefStore({ logLevel: "trace" }));
    expect(getPref("logLevel")).toBe("warn");
    setPrefStore(createMemoryPrefStore({ secretBackend: "plaintext-prefs" }));
    // docs/09 §1.7's tier 4 is not implemented and is not a legal backend.
    expect(getPref("secretBackend")).toBe("");
  });

  it("accepts every member of a closed value set", () => {
    for (const level of ["error", "warn", "info", "debug"] as const) {
      setPrefStore(createMemoryPrefStore({ logLevel: level }));
      expect(getPref("logLevel")).toBe(level);
    }
    for (const backend of ["oskeystore", "session", ""] as const) {
      setPrefStore(createMemoryPrefStore({ secretBackend: backend }));
      expect(getPref("secretBackend")).toBe(backend);
    }
  });

  it("reads a stored passphrase backend as the default: tier 3 does not ship (G-10; plan/00 §6 item 268)", () => {
    setPrefStore(createMemoryPrefStore({ secretBackend: "passphrase" }));
    expect(getPref("secretBackend")).toBe("");
  });

  it("reads gemini.paidTier as false until the user declares the key paid (plan/00 §6 item 269(b))", () => {
    setPrefStore(createMemoryPrefStore({}));
    expect(getPref("geminiPaidTier")).toBe(false);
    setPrefStore(createMemoryPrefStore({ "gemini.paidTier": true }));
    expect(getPref("geminiPaidTier")).toBe(true);
    setPrefStore(createMemoryPrefStore({ "gemini.paidTier": "yes" }));
    expect(getPref("geminiPaidTier")).toBe(false);
  });

  it("reads whole cents for a money row and refuses a fractional amount (P3-T39)", () => {
    // `summary.confirmAboveCents` and the two `run.*` ceilings are §8.5
    // integers holding US cents (`plan/00` §6 item 245), so $2.50 is stored as
    // 250. A stored 2.5 — a dollar figure written into a cents row, or a value
    // Gecko could not hold — is the wrong type and falls back to the default.
    setPrefStore(createMemoryPrefStore({ "summary.confirmAboveCents": 250 }));
    expect(getPref("summaryConfirmAboveCents")).toBe(250);
    // The stringified form is the pane's `String(value)` foot-gun again.
    setPrefStore(createMemoryPrefStore({ "summary.confirmAboveCents": "250" }));
    expect(getPref("summaryConfirmAboveCents")).toBe(250);
    setPrefStore(createMemoryPrefStore({ "summary.confirmAboveCents": 2.5 }));
    expect(getPref("summaryConfirmAboveCents")).toBe(200);
    setPrefStore(
      createMemoryPrefStore({
        "summary.confirmAboveCents": "2.5",
        "run.maxSpendCents": 0.75,
        "run.maxSessionSpendCents": "1.5",
      }),
    );
    expect(getPref("summaryConfirmAboveCents")).toBe(200);
    expect(getPref("runMaxSpendCents")).toBe(0);
    // The session ceiling's default is 500 since 2026-10-23 (item 271(b)).
    expect(getPref("runMaxSessionSpendCents")).toBe(500);
  });

  it("falls back to the default for a negative spend ceiling rather than reading it (P3-T32)", () => {
    setPrefStore(
      createMemoryPrefStore({
        "run.maxSpendCents": -1,
        "run.maxSessionSpendCents": "-5",
      }),
    );
    // 0 (off) for the per-run ceiling; 500 for the session one (item 271(b)).
    expect(getPref("runMaxSpendCents")).toBe(0);
    expect(getPref("runMaxSessionSpendCents")).toBe(500);
  });

  it("holds the two JSON rows as strings and leaves parsing to their readers (P3-T32)", () => {
    // §8.5 types both "string (JSON)"; the schema stores the string. A stored
    // number is the wrong type and falls back to "{}" rather than being
    // stringified (the port carries scalars only, so an object cannot arrive).
    const calibration = '{"anthropic/claude-sonnet-5":1.12}';
    setPrefStore(
      createMemoryPrefStore({
        "llm.tokenEstimateCalibration": calibration,
        "cache.lastSeenPromptVersions": 3,
      }),
    );
    expect(getPref("llmTokenEstimateCalibration")).toBe(calibration);
    expect(getPref("cacheLastSeenPromptVersions")).toBe("{}");
  });

  it("enforces the Phase 3 closed value sets (P3-T32)", () => {
    setPrefStore(
      createMemoryPrefStore({
        llmProvider: "mistral",
        "privacy.mode": "off",
        "summary.fullTextMode": "sometimes",
        "screening.retractionPolicy": "exclude",
        "screening.nonEnglishPolicy": "translate",
        "openai.lastValidationResult": "valid",
      }),
    );
    expect(getPref("llmProvider")).toBe("openrouter");
    expect(getPref("privacyMode")).toBe("balanced");
    expect(getPref("summaryFullTextMode")).toBe("auto");
    expect(getPref("screeningRetractionPolicy")).toBe("exclude_from_synthesis");
    expect(getPref("screeningNonEnglishPolicy")).toBe("translate_summary");
    expect(getPref("openaiLastValidationResult")).toBe("");
    for (const result of VALIDATION_RESULTS) {
      setPrefStore(
        createMemoryPrefStore({ "ncbi.lastValidationResult": result }),
      );
      expect(getPref("ncbiLastValidationResult")).toBe(result);
    }
  });

  it("refuses a screening threshold outside 0–100 and a concurrency outside 1–8 (P3-T32)", () => {
    setPrefStore(
      createMemoryPrefStore({ "screening.threshold": 101, concurrency: 9 }),
    );
    expect(getPref("screeningThreshold")).toBe(60);
    expect(getPref("concurrency")).toBe(3);
    setPrefStore(
      createMemoryPrefStore({ "screening.threshold": "0", concurrency: "8" }),
    );
    expect(getPref("screeningThreshold")).toBe(0);
    expect(getPref("concurrency")).toBe(8);
  });

  // P4-T02 (2026-10-26): the five "Report & audio" rows Phase 4 reads.

  it("reads the five Phase 4 report rows back as their §8.5 defaults on a clean profile (P4-T02)", () => {
    setPrefStore(createMemoryPrefStore({}));
    expect(getPref("reportLanguage")).toBe("auto");
    expect(getPref("reportTargetWords")).toBe(0);
    expect(getPref("reportMaxCritiqueRounds")).toBe(1);
    expect(getPref("reportCritiqueModel")).toBe("");
    expect(getPref("reportSaveNote")).toBe(true);
  });

  it("accepts every reportLanguage §8.5 lists and refuses any other (P4-T02)", () => {
    for (const language of ["auto", "en", "ko", "both"] as const) {
      setPrefStore(createMemoryPrefStore({ reportLanguage: language }));
      expect(getPref("reportLanguage")).toBe(language);
    }
    // A locale tag is not a §8.5 value: `auto` is how the UI locale is followed.
    for (const stored of ["ko-KR", "en-US", "kr", "fr", "", 1]) {
      setPrefStore(createMemoryPrefStore({ reportLanguage: stored }));
      expect(getPref("reportLanguage"), JSON.stringify(stored)).toBe("auto");
    }
  });

  it("reads report.targetWords as a whole number ≥ 0 and refuses a negative, a fraction or a non-number (P4-T02)", () => {
    for (const [stored, read] of [
      [0, 0],
      [400, 400],
      ["1200", 1200],
    ] as const) {
      setPrefStore(createMemoryPrefStore({ "report.targetWords": stored }));
      expect(getPref("reportTargetWords"), String(stored)).toBe(read);
    }
    for (const stored of [-1, "-400", 400.5, "auto", true]) {
      setPrefStore(createMemoryPrefStore({ "report.targetWords": stored }));
      expect(getPref("reportTargetWords"), JSON.stringify(stored)).toBe(0);
    }
  });

  it("reads a report.targetWords in §8.5's 1–399 hole as stored, because PrefDef cannot declare the hole (P4-T02)", () => {
    // §8.5's value set is "`0`, or ≥ 400". PrefDef (§8.5.1, verbatim) has an
    // inclusive min/max and a closed `values` list, so the schema declares
    // `min: 0` only and the reader (P4-T08) owns the hole. Pinned so that
    // closing it in PrefDef is a visible change here, not a silent one.
    setPrefStore(createMemoryPrefStore({ "report.targetWords": 200 }));
    expect(getPref("reportTargetWords")).toBe(200);
  });

  it("reads report.maxCritiqueRounds only inside 0–2 (P4-T02)", () => {
    for (const [stored, read] of [
      [0, 0],
      [2, 2],
      ["2", 2],
    ] as const) {
      setPrefStore(
        createMemoryPrefStore({ "report.maxCritiqueRounds": stored }),
      );
      expect(getPref("reportMaxCritiqueRounds"), String(stored)).toBe(read);
    }
    for (const stored of [3, -1, "1.5", false]) {
      setPrefStore(
        createMemoryPrefStore({ "report.maxCritiqueRounds": stored }),
      );
      expect(getPref("reportMaxCritiqueRounds"), JSON.stringify(stored)).toBe(
        1,
      );
    }
    setPrefStore(createMemoryPrefStore());
    expect(() => setPref("reportMaxCritiqueRounds", 3)).toThrow(
      ConfigurationError,
    );
  });

  it("holds report.critiqueModel as any model ID string and refuses a non-string (P4-T02)", () => {
    setPrefStore(
      createMemoryPrefStore({
        "report.critiqueModel": "anthropic/claude-sonnet-5",
      }),
    );
    expect(getPref("reportCritiqueModel")).toBe("anthropic/claude-sonnet-5");
    setPrefStore(createMemoryPrefStore({ "report.critiqueModel": 5 }));
    expect(getPref("reportCritiqueModel")).toBe("");
  });

  it("reads report.saveNote as a boolean, stringified or not, and nothing else (P4-T02)", () => {
    setPrefStore(createMemoryPrefStore({ "report.saveNote": false }));
    expect(getPref("reportSaveNote")).toBe(false);
    setPrefStore(createMemoryPrefStore({ "report.saveNote": "false" }));
    expect(getPref("reportSaveNote")).toBe(false);
    setPrefStore(createMemoryPrefStore({ "report.saveNote": "no" }));
    expect(getPref("reportSaveNote")).toBe(true);
  });

  it("has no report.enabled: the trend report's hidden switch was removed once a report could be generated (P4-T20; owner, item 307(d))", () => {
    expect(Object.keys(PREFS)).not.toContain("reportEnabled");
    expect(Object.values(PREF_KEYS)).not.toContain("report.enabled");
  });

  it("never throws: no store installed", () => {
    // §8.5.1: "a corrupt pref must not be able to stop a job from starting."
    // This is also what lets a source-adapter unit test read a setting with no
    // fixture at all.
    setPrefStore(undefined);
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(() => getPref(name)).not.toThrow();
      expect(getPref(name)).toBe(def.default);
    }
  });

  it("never throws: the store itself throws on read", () => {
    const store = createMemoryPrefStore();
    setPrefStore({
      ...store,
      get() {
        throw new Error("Services.prefs: NS_ERROR_UNEXPECTED");
      },
    });
    expect(() => getPref("searchYears")).not.toThrow();
    expect(getPref("searchYears")).toBe(3);
  });
});

describe("setPref / clearPref / observePref", () => {
  it("writes a coerced value through the store", () => {
    const store = createMemoryPrefStore();
    setPrefStore(store);
    setPref("searchYears", 7);
    expect(store.values.get("searchYears")).toBe(7);
    expect(getPref("searchYears")).toBe(7);
  });

  it("writes under the schema's key, not the PrefName", () => {
    const store = createMemoryPrefStore();
    setPrefStore(store);
    setPref("ncbiKeyPresent", true);
    expect(store.values.get("ncbi.keyPresent")).toBe(true);
    expect(store.values.has("ncbiKeyPresent")).toBe(false);
  });

  it("throws on an out-of-range or wrong-type write rather than substituting", () => {
    setPrefStore(createMemoryPrefStore());
    expect(() => setPref("searchYears", 99)).toThrow(ConfigurationError);
    expect(() => setPref("logLevel", "trace")).toThrow(ConfigurationError);
  });

  it("names the key but never the value in a rejection", () => {
    setPrefStore(createMemoryPrefStore());
    let message = "";
    try {
      setPref("contactEmail", 99 as unknown as string);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("contactEmail");
    expect(message).not.toContain("99");
  });

  it("throws rather than silently dropping a write when no store is installed", () => {
    setPrefStore(undefined);
    expect(() => setPref("searchYears", 7)).toThrow(ConfigurationError);
    expect(() => clearPref("searchYears")).toThrow(ConfigurationError);
    expect(() => observePref("logLevel", () => undefined)).toThrow(
      ConfigurationError,
    );
  });

  it("clearPref removes the user value so the schema default is read again", () => {
    const store = createMemoryPrefStore({ searchYears: 7 });
    setPrefStore(store);
    expect(getPref("searchYears")).toBe(7);
    clearPref("searchYears");
    expect(store.values.has("searchYears")).toBe(false);
    expect(getPref("searchYears")).toBe(3);
  });

  it("observePref subscribes under the schema's key", () => {
    const store = createMemoryPrefStore();
    setPrefStore(store);
    const seen: unknown[] = [];
    const handle = observePref("logLevel", (value) => seen.push(value));
    store.notify("logLevel", "debug");
    expect(seen).toEqual(["debug"]);
    // The handle is tagged at the port (src/core/config.ts) because the two
    // shipped implementations return semantic opposites and FR-56 makes the
    // Zotero one return a ScopedRegistration rather than a Symbol. The memory
    // store's observer is live the moment `observe` returns, so its tag is
    // `"unsubscribe"` — `P1-T32` item 4 replaced the bare function this used to
    // assert on. Updated rather than deleted: the assertion is still that
    // `observePref` hands back something the caller can undo.
    expect(handle.kind).toBe("unsubscribe");
  });
});

// ---------------------------------------------------------------------------
// 3. D5 — docs/09 §1.7, docs/07 §8.5, plan/README.md §5 rule 5
// ---------------------------------------------------------------------------

describe("D5: no credential can reach a preference", () => {
  it("has no secret: true entry, because every PREFS entry is a writer", () => {
    // docs/07 §8.5: "a unit test asserts that no `secret: true` entry has a
    // Zotero.Prefs writer". Membership in PREFS IS reachability from setPref —
    // setPref accepts any PrefName — so the assertion reduces to this.
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(def.secret, `${def.key} must not be secret`).not.toBe(true);
    }
  });

  it("refuses to write a secret definition", () => {
    // The card's criterion: "the D5 test fails if a `secret: true` entry is
    // added with a writer". A secret entry cannot be added to PREFS without
    // failing the test above, so the guard is proven against a definition
    // constructed here — the shape someone would add if they tried.
    const store = createMemoryPrefStore();
    setPrefStore(store);
    const secretDef: PrefDef<string> = {
      key: "openai.apiKey",
      type: "string",
      default: "",
      secret: true,
    };
    expect(() => writePref(secretDef, "sk-proj-not-a-real-key")).toThrow(
      ConfigurationError,
    );
    expect(() => guardWritable(secretDef)).toThrow(ConfigurationError);
    // Nothing reached the store: the guard runs before coercion and before the
    // store is looked up at all.
    expect(store.values.size).toBe(0);
  });

  it("does not put the value in the D5 rejection", () => {
    const secret = "sk-ant-api03-0000000000000000000000000000";
    let message = "";
    try {
      writePref(
        { key: "anthropic.apiKey", type: "string", default: "", secret: true },
        secret,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("D5 violation");
    expect(message).toContain("anthropic.apiKey");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("sk-ant");
  });

  it("declares no credential-shaped key", () => {
    // The card's step 6, verbatim.
    const CREDENTIAL_SHAPED = /apikey|api_key|\.key$/i;
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(
        CREDENTIAL_SHAPED.test(def.key),
        `${def.key} is credential-shaped`,
      ).toBe(false);
      expect(CREDENTIAL_SHAPED.test(name), `${name} is credential-shaped`).toBe(
        false,
      );
    }
  });

  it("gives Phase 4's five report rows no secret flag, no key-ish name and no credential-shaped default (P4-T02)", () => {
    // The card's step 3: "the D5 block (no credential in any new row)".
    // KEYISH_FIELD is the logger's field-name rule (`docs/09` §2.1); it is
    // applied to these five only, because it also matches the `token` in the
    // shipped `llm.tokenEstimateCalibration`, a token-count correction factor
    // and not a secret.
    const phase4 = [
      "reportLanguage",
      "reportTargetWords",
      "reportMaxCritiqueRounds",
      "reportCritiqueModel",
      "reportSaveNote",
    ] as const;
    for (const name of phase4) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(def.secret, `${def.key} must not be secret`).toBeUndefined();
      expect(KEYISH_FIELD.test(def.key), `${def.key} is key-ish`).toBe(false);
      expect(KEYISH_FIELD.test(name), `${name} is key-ish`).toBe(false);
    }
  });

  it("ships no default that the logger's redaction would treat as a credential", () => {
    // `redact` applies `docs/09` §2.1's KEY_PATTERNS; a default it changes is
    // a credential shipped in source.
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      const text = String(def.default);
      expect(redact(text), `${def.key} default`).toBe(text);
    }
  });

  it("declares no credential-shaped key in addon/prefs.js either", () => {
    const CREDENTIAL_SHAPED = /apikey|api_key|\.key$/i;
    for (const line of readPrefsJs()) {
      expect(
        CREDENTIAL_SHAPED.test(line.key),
        `${line.key} is credential-shaped`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. addon/prefs.js ↔ PREFS — the card's fourth criterion
// ---------------------------------------------------------------------------

/** One `pref("<key>", <value>);` line of `addon/prefs.js`. */
interface PrefsJsLine {
  readonly key: string;
  readonly value: boolean | number | string;
}

/**
 * Parse `addon/prefs.js`.
 *
 * The card's fourth criterion requires "a test that reads both", so this reads
 * the shipped file rather than a transcription of it. Keys are **bare** in
 * source — the scaffold prefixes them at build time from
 * `build.prefs.prefix` (`docs/13` §1.4) — so no prefix is stripped here.
 *
 * `pref()` takes a JSON-shaped literal (`true`, `false`, a number, a
 * double-quoted string) in every line this project ships, so `JSON.parse` is a
 * sufficient and strict value reader: a value it rejects is a value Zotero's own
 * pref parser would also treat differently from what was meant.
 *
 * **The pattern spans newlines deliberately.** Prettier owns this file's layout
 * (`npm run lint:check` runs `prettier --check .`, and `.prettierignore` does not
 * exempt `addon/`), and it wraps a call that exceeds `printWidth` — the `sources`
 * default is 63 characters of source IDs — onto four lines with a trailing comma.
 * A line-anchored pattern silently matches zero of those, which would make every
 * assertion below vacuously true for exactly the longest and most
 * defect-prone row. The "parses every pref() call in the file" guard is what
 * caught it.
 */
function readPrefsJs(): readonly PrefsJsLine[] {
  // `new URL(relative, import.meta.url)` is the idiomatic form and does not
  // typecheck here: `tsconfig.json` extends `zotero-types/entries/sandbox`,
  // whose lib's `URL` is structurally incompatible with `@types/node`'s
  // (`URLSearchParams.entries()` returns different iterator types), so the
  // object cannot be handed to `fileURLToPath`. Resolving from this file's own
  // path as a string avoids both the mismatch and a `process.cwd()` assumption.
  const here = fileURLToPath(import.meta.url);
  const source = readFileSync(
    resolve(dirname(here), "../../../addon/prefs.js"),
    "utf8",
  );
  // Drop whole-line comments so a commented-out pref() is not counted. Only
  // lines that *start* with `//` are dropped: stripping to end-of-line anywhere
  // would mangle a `//` inside a string value.
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
  const pattern = new RegExp(
    String.raw`pref\(\s*(${STRING})\s*,\s*(${STRING}|true|false|-?\d+(?:\.\d+)?)\s*,?\s*\)\s*;`,
    "g",
  );

  const lines: PrefsJsLine[] = [];
  let consumed = 0;
  for (const match of code.matchAll(pattern)) {
    const [, rawKey, rawValue] = match;
    if (rawKey === undefined || rawValue === undefined) {
      continue;
    }
    consumed += 1;
    lines.push({
      key: JSON.parse(rawKey) as string,
      value: JSON.parse(rawValue) as boolean | number | string,
    });
  }

  // A `pref(` the pattern did not consume is a line this test is blind to.
  const calls = (code.match(/\bpref\(/g) ?? []).length;
  if (calls !== consumed) {
    throw new Error(
      `readPrefsJs parsed ${consumed} of ${calls} pref() calls in addon/prefs.js; ` +
        `the unparsed ones would be silently exempt from every assertion below.`,
    );
  }

  return lines;
}

describe("addon/prefs.js agrees with PREFS", () => {
  const lines = readPrefsJs();

  it("parses every pref() call in the file", () => {
    // Guards against a pattern that silently matches nothing — or, as happened
    // once here, matches every line but the one Prettier wrapped — which would
    // make the assertions below vacuously true. readPrefsJs() throws on a
    // shortfall; this asserts the count is also non-zero.
    expect(lines.length).toBeGreaterThan(0);
  });

  it("has no duplicate pref() line", () => {
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  for (const line of lines) {
    it(`pref("${line.key}") has a matching PREFS entry with an identical default`, () => {
      const entry = PREF_NAMES.map(
        (name) => PREFS[name] as PrefDef<unknown>,
      ).find((def) => def.key === line.key);
      expect(
        entry,
        `${line.key} is not declared in src/prefs/schema.ts`,
      ).toBeDefined();
      expect(entry?.default).toBe(line.value);
    });
  }

  it("ships a pref() line for every key except the rows docs/01 §7.2 gives none", () => {
    // P1-T03 step 5 shipped a line for every Phase 1 key. docs/01 §7.2 permits a
    // row with no pane control to be omitted, but lists the argument for
    // including it: a setting the user cannot find in about:config cannot be
    // audited. P3-T32 step 2 transcribes §7.2 instead, so the rows §7.2 gives
    // no line (NO_PREF_LINE) get none — and the Phase 1 lines stay.
    const shipped = new Set(lines.map((line) => line.key));
    const omitted = new Set(NO_PREF_LINE);
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(
        shipped.has(def.key),
        omitted.has(def.key)
          ? `${def.key} has a pref() line docs/01 §7.2 does not give it`
          : `${def.key} has no pref() line`,
      ).toBe(!omitted.has(def.key));
    }
  });

  it("lists only real schema keys as having no pref() line", () => {
    const keys = new Set(SECTION_8_5.map((r) => r.key));
    // 26 since 2026-10-22: `gemini.paidTier` (plan/00 §6 item 269(b)); 30
    // since 2026-10-26: P4-T02's four `report.*` rows; 31 on 2026-10-29: the
    // hidden `report.enabled` (item 307(d)); 30 again since 2026-11-02, when
    // `P4-T20` removed it.
    expect(NO_PREF_LINE).toHaveLength(30);
    for (const key of NO_PREF_LINE) expect(keys.has(key), key).toBe(true);
  });

  it("names a PREF_KEYS entry on every pref() line (P3-T32)", () => {
    const known = new Set<string>(Object.values(PREF_KEYS));
    for (const line of lines) {
      expect(known.has(line.key), `${line.key} is not in PREF_KEYS`).toBe(true);
    }
  });

  it("keeps PREF_KEYS and PREFS one-to-one, under the same names", () => {
    expect(Object.keys(PREF_KEYS).sort()).toEqual([...PREF_NAMES].sort());
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(def.key, name).toBe(PREF_KEYS[name as keyof typeof PREF_KEYS]);
    }
  });

  it("transcribes docs/01 §7.2's pref() line, value included, for every schema key it lists (P3-T32 step 2)", () => {
    // §7.2 writes fully qualified keys in one fenced block; read every
    // `pref("extensions.zotero.research-helper.<key>", <value>);` line there.
    const source = readRepoFile("docs/01-zotero-plugin-platform.md");
    const section = source.slice(
      source.indexOf("### 7.2 "),
      source.indexOf("### 7.3 "),
    );
    const pattern =
      /^pref\("extensions\.zotero\.research-helper\.([^"]+)",\s*("(?:[^"\\]|\\.)*"|true|false|-?\d+(?:\.\d+)?)\);$/gm;
    const listed = new Map<string, unknown>();
    for (const [, key, value] of section.matchAll(pattern)) {
      if (key !== undefined && value !== undefined) {
        listed.set(key, JSON.parse(value));
      }
    }
    expect(listed.size).toBeGreaterThan(0);
    const shipped = new Map(lines.map((line) => [line.key, line.value]));
    const schemaKeys = new Set(SECTION_8_5.map((r) => r.key));
    for (const [key, value] of listed) {
      if (!schemaKeys.has(key)) continue; // a later phase's row
      expect(shipped.has(key), `${key}: §7.2 lists it`).toBe(true);
      expect(shipped.get(key), key).toBe(value);
    }
    for (const key of NO_PREF_LINE) {
      expect(listed.has(key), `${key}: §7.2 does list it`).toBe(false);
    }
  });

  it("writes bare keys, leaving the prefix to the scaffold", () => {
    for (const line of lines) {
      expect(
        line.key.startsWith(PREF_BRANCH_ROOT) ||
          line.key.startsWith(PREF_BRANCH),
        `${line.key} is pre-prefixed; docs/13 §1.4 says the scaffold does that`,
      ).toBe(false);
    }
  });
});

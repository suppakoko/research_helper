import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import { ConfigurationError } from "../../../src/core/errors";
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

/**
 * One row per `docs/07` §8.5 row Phase 1 reads, typed out from that section
 * rather than derived from `PREFS`.
 *
 * Deriving it would assert only that the schema equals itself. `min` / `max` are
 * `null` where §8.5 gives no bound and `values` is `null` where it gives no
 * closed set, so an accidentally-added bound fails rather than passing silently.
 */
const SECTION_8_5: readonly {
  readonly name: PrefName;
  readonly key: string;
  readonly type: PrefDef<unknown>["type"];
  readonly default: boolean | number | string;
  readonly min: number | null;
  readonly max: number | null;
  readonly values: readonly (boolean | number | string)[] | null;
}[] = [
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
  {
    name: "secretBackend",
    key: "secretBackend",
    type: "string",
    default: "",
    min: null,
    max: null,
    values: ["oskeystore", "session", "passphrase", ""],
  },
];

describe("PREFS transcribes docs/07 §8.5", () => {
  it("declares exactly the twelve rows Phase 1 reads, and no others", () => {
    // The card's Do NOT: "do not add a preference that docs/07 §8.5 does not
    // declare". A thirteenth entry fails here, not in review.
    expect([...PREF_NAMES].sort()).toEqual(
      SECTION_8_5.map((row) => row.name).sort(),
    );
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
    for (const backend of [
      "oskeystore",
      "session",
      "passphrase",
      "",
    ] as const) {
      setPrefStore(createMemoryPrefStore({ secretBackend: backend }));
      expect(getPref("secretBackend")).toBe(backend);
    }
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
    // The handle is opaque at the port (src/core/config.ts) because FR-56 makes
    // the Zotero implementation return a ScopedRegistration, not a Symbol.
    expect(handle).toBeTypeOf("function");
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

  it("ships a pref() line for every Phase 1 key", () => {
    // P1-T03 step 5: "for exactly the Phase 1 keys". docs/01 §7.2 permits a row
    // with no pane control to be omitted, but lists the argument for including
    // it: a setting the user cannot find in about:config cannot be audited.
    const shipped = new Set(lines.map((line) => line.key));
    for (const name of PREF_NAMES) {
      const def: PrefDef<unknown> = PREFS[name];
      expect(shipped.has(def.key), `${def.key} has no pref() line`).toBe(true);
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

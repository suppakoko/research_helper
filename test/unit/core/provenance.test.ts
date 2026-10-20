import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  exportJson,
  PROVENANCE_SCHEMA_PATH,
  PROVENANCE_SCHEMA_VERSION,
  redactQueryString,
  redactRecord,
  redactSearchProvenance,
  redactSourceProvenance,
  serializeProvenance,
  type MergeDecision,
  type ProvenanceFileWriter,
  type SearchProvenance,
  type SourceProvenance,
} from "../../../src/core/provenance";
import { KEY_PATTERNS } from "../../../src/core/errors";
import { SOURCE_IDS } from "../../../src/model/ids";
import {
  PROVENANCE_NOTE_TITLE_PREFIX,
  provenanceNoteTitle,
  renderProvenanceNoteHtml,
  writeProvenanceNote,
  type ProvenanceNoteItem,
} from "../../../src/zotero/notes";

// ---------------------------------------------------------------------------
// 0. What this file is, and what each half of it proves
// ---------------------------------------------------------------------------

/*
 * `docs/13` §2.1's "Provenance" row names two tests: "conformance of a
 * `SearchProvenance` object (`07-architecture-and-data-model.md` §5.3) against
 * `schema/provenance.schema.json`, and key redaction in `transmittedUrl`".
 * Both are below, plus the note writer, because `P1-T17`'s `Files` gives this
 * file as the only test for all three artefacts.
 *
 * ## The two kinds of assertion here, kept apart on purpose
 *
 * **Conformance** — asserted against something outside this file: §5.3's field
 * names and field order, FR-8's eight per-source quantities and its literal note
 * title, `docs/01` §5.7's HTML subset, `src/model/ids.ts`'s `SourceId` union,
 * `docs/09` §2.1's redaction rules, and the draft-2020-12 identifier in the
 * shipped schema. These are the assertions that can fail because the code is
 * wrong rather than merely inconsistent. The field-name lists below are typed
 * from §5.3's printed interface, not read out of `src/core/provenance.ts`, so
 * the two can disagree.
 *
 * **Self-consistency** — the schema-to-interface parity checks, which prove the
 * schema and the interface describe the same object without proving either is
 * §5.3's. They are the drift alarm: a field added to the interface and not to
 * the schema fails `schema properties cover every field`.
 *
 * ## Why the validator is written out here
 *
 * The repository declares no JSON Schema validator. `ajv` is present only as a
 * transitive dependency of the lint toolchain, at 6.15.0, which implements
 * draft-07 and not the draft 2020-12 `docs/07` §5.3 requires; adding a
 * dependency is outside `P1-T17`'s `Files` and is `plan/README.md` §5 rule 2.
 * So the validator below implements the subset of draft 2020-12 the shipped
 * schema actually uses — and `every schema keyword is one the validator
 * implements` fails if the schema ever grows a keyword it would silently
 * ignore, which is the failure mode a hand-written validator has and a real one
 * does not.
 */

// ---------------------------------------------------------------------------
// 1. A minimal draft-2020-12 validator, over the keywords this schema uses
// ---------------------------------------------------------------------------

/** Keywords the validator below understands. Anything else is a test failure. */
const IMPLEMENTED_KEYWORDS: readonly string[] = [
  // Assertions.
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "oneOf",
  "minimum",
  "$ref",
  // Core and annotation-only; carry no constraint.
  "$schema",
  "$id",
  "$defs",
  "title",
  "description",
  "format",
];

/**
 * `format` is an *annotation* in draft 2020-12 unless a vocabulary opts in, so
 * the validator does not enforce it and the ISO shape of `startedAt` /
 * `finishedAt` is asserted separately, by `startedAt and finishedAt are ISO 8601`.
 */
const ANNOTATION_ONLY: readonly string[] = ["format"];

type SchemaNode = Readonly<Record<string, unknown>>;

/** Is `value` a JSON object (not an array, not null)? */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values, for `const` and `enum`. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `#/$defs/Name` → the subschema. Only the one `$ref` form this schema uses. */
function resolveRef(root: SchemaNode, ref: string): SchemaNode {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref: ${ref}`);
  const defs = root["$defs"];
  if (!isObject(defs)) throw new Error("schema has no $defs");
  const target = defs[ref.slice(prefix.length)];
  if (!isObject(target)) throw new Error(`unresolvable $ref: ${ref}`);
  return target;
}

/** Does `value` match the `type` keyword's value? */
function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`unsupported type keyword: ${type}`);
  }
}

/**
 * Validate `value` against `schema`, returning one message per violation.
 *
 * An empty array means valid. Messages carry a JSON-pointer-ish path so a
 * failure names the field rather than the document.
 */
function validate(
  schema: SchemaNode,
  value: unknown,
  root: SchemaNode,
  path = "$",
): string[] {
  const errors: string[] = [];

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    errors.push(...validate(resolveRef(root, ref), value, root, path));
  }

  const type = schema["type"];
  if (typeof type === "string" && !matchesType(type, value)) {
    errors.push(`${path}: expected type ${type}, got ${typeof value}`);
    // A wrong type makes every nested assertion noise.
    return errors;
  }

  if ("const" in schema && !jsonEqual(schema["const"], value)) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema["const"])}, got ${JSON.stringify(value)}`,
    );
  }

  const enumeration = schema["enum"];
  if (Array.isArray(enumeration)) {
    if (!enumeration.some((allowed) => jsonEqual(allowed, value))) {
      errors.push(`${path}: ${JSON.stringify(value)} is not in enum`);
    }
  }

  const minimum = schema["minimum"];
  if (typeof minimum === "number" && typeof value === "number") {
    if (value < minimum) errors.push(`${path}: ${value} is below ${minimum}`);
  }

  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const matches = oneOf.filter(
      (branch) =>
        isObject(branch) && validate(branch, value, root, path).length === 0,
    );
    if (matches.length !== 1) {
      errors.push(
        `${path}: matched ${String(matches.length)} oneOf branches, expected 1`,
      );
    }
  }

  const items = schema["items"];
  if (isObject(items) && Array.isArray(value)) {
    value.forEach((element, index) => {
      errors.push(
        ...validate(items, element, root, `${path}[${String(index)}]`),
      );
    });
  }

  if (isObject(value)) {
    const properties = schema["properties"];
    const declared = isObject(properties) ? properties : {};

    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !(name in value)) {
          errors.push(`${path}: missing required property ${name}`);
        }
      }
    }

    for (const [name, element] of Object.entries(value)) {
      const subschema = declared[name];
      if (isObject(subschema)) {
        errors.push(...validate(subschema, element, root, `${path}.${name}`));
        continue;
      }
      const additional = schema["additionalProperties"];
      if (additional === false) {
        errors.push(`${path}: additional property ${name} is not allowed`);
      } else if (isObject(additional)) {
        errors.push(...validate(additional, element, root, `${path}.${name}`));
      }
    }
  }

  return errors;
}

/**
 * Every keyword at every schema position the validator traverses.
 *
 * The traversal mirrors {@link validate}'s own, so a keyword this returns and
 * {@link IMPLEMENTED_KEYWORDS} does not list is a keyword the validator would
 * ignore in place of enforcing.
 */
function schemaKeywords(
  schema: SchemaNode,
  out = new Set<string>(),
): Set<string> {
  for (const key of Object.keys(schema)) out.add(key);
  const descend = (node: unknown): void => {
    if (isObject(node)) schemaKeywords(node, out);
  };
  for (const name of ["properties", "$defs"]) {
    const group = schema[name];
    if (isObject(group)) Object.values(group).forEach(descend);
  }
  descend(schema["items"]);
  descend(schema["additionalProperties"]);
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) oneOf.forEach(descend);
  return out;
}

// ---------------------------------------------------------------------------
// 2. The shipped schema, and the records under test
// ---------------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The shipped artefact, read from disk rather than imported, so the test sees
 * the bytes a consumer would. */
const SCHEMA: SchemaNode = (() => {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(repoRoot, PROVENANCE_SCHEMA_PATH), "utf8"),
  );
  if (!isObject(parsed)) throw new Error("schema is not a JSON object");
  return parsed;
})();

const SOURCE_SCHEMA = resolveRef(SCHEMA, "#/$defs/SourceProvenance");

/** A real NCBI-shaped key: 32 hexadecimal characters, below `KEY_PATTERNS`'
 * 40-character catch-all, which is the whole reason step 5 exists. */
const STUB_KEY = "0123456789abcdef0123456789abcdef";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

/** One source entry with every §5.3 field populated and nothing `undefined`. */
function completeSource(): SourceProvenance {
  return {
    sourceId: "pubmed",
    endpointBaseUrl: ESEARCH,
    transmittedQuery: `db=pubmed&term=crispr&retmax=50&api_key=${STUB_KEY}`,
    transmittedUrl: `${ESEARCH}?db=pubmed&term=crispr&retmax=50&api_key=${STUB_KEY}`,
    dateFilterApplied: "server",
    requestedLimit: 50,
    rawHitCount: 1234,
    recordsRetrieved: 50,
    recordsDeduplicatedAway: 0,
    recordsImported: 48,
    error: {
      code: "SOURCE",
      messageKey: "rh-error-source",
      detail: `efetch failed for ${ESEARCH}?api_key=${STUB_KEY}`,
      retryable: true,
      httpStatus: 500,
      stack: "at efetch (pubmedSource.ts:1)",
    },
    sourceExtras: {
      count: 1234,
      querytranslation: `"crispr"[MeSH Terms] OR crispr[All Fields]`,
      translationset: [{ from: "crispr", to: `"crispr"[MeSH Terms]` }],
    },
  };
}

/** One source entry with every `| undefined` member actually `undefined`. */
function minimalSource(): SourceProvenance {
  return {
    sourceId: "pubmed",
    endpointBaseUrl: ESEARCH,
    transmittedQuery: "db=pubmed&term=crispr",
    transmittedUrl: `${ESEARCH}?db=pubmed&term=crispr`,
    dateFilterApplied: "none",
    requestedLimit: 50,
    rawHitCount: undefined,
    recordsRetrieved: 0,
    recordsDeduplicatedAway: 0,
    recordsImported: 0,
    error: undefined,
    sourceExtras: undefined,
  };
}

/**
 * One FR-50 scenario 2 merge, as `stages.ts`'s `mergeDecisionsOf` builds it
 * from a DOI-tier `"match"` (`P2-T34`).
 */
function doiMerge(): MergeDecision {
  return {
    workKey: "doi:10.1038/s41586-023-06139-9",
    tier: "doi",
    confidence: 1,
    evidence: { doi: "10.1038/s41586-023-06139-9" },
  };
}

/** A fuzzy-title merge, whose evidence mixes numbers, a boolean and a string. */
function fuzzyMerge(): MergeDecision {
  return {
    workKey: "hash:5f2b9c0e8d1a4b7c3e6f9a2d5c8b1e4f7a0d3c6b",
    tier: "title-fuzzy",
    confidence: 0.92,
    evidence: {
      levSim: 0.97,
      jaccard: 0.9,
      yearDelta: 0,
      firstAuthorMatches: true,
      rule: "levenshtein",
    },
  };
}

/** A run with every §5.3 field populated. */
function completeRun(): SearchProvenance {
  return {
    schemaVersion: 1,
    runId: "run-0001",
    pluginVersion: "0.0.2",
    zoteroVersion: "10.0.3",
    startedAt: "2026-10-07T04:00:00.000Z",
    finishedAt: "2026-10-07T04:00:12.500Z",
    userQuery: "single-cell AND (glioma OR glioblastoma)",
    dateFilter: { fromIso: "2024-01-01", toIso: "2026-12-31" },
    targetLibraryId: 1,
    targetCollectionKey: "ABCD2345",
    perSource: [completeSource()],
    totals: { retrieved: 50, deduplicatedAway: 0, imported: 48 },
    mergeDecisions: [doiMerge(), fuzzyMerge()],
  };
}

/** FR-3's "All years" run, with every optional member absent. */
function minimalRun(): SearchProvenance {
  return {
    schemaVersion: 1,
    runId: "run-0002",
    pluginVersion: "0.0.2",
    zoteroVersion: "10.0.3",
    startedAt: "2026-10-07T04:00:00.000Z",
    finishedAt: "2026-10-07T04:00:01.000Z",
    userQuery: "crispr",
    dateFilter: "none",
    targetLibraryId: 1,
    targetCollectionKey: undefined,
    perSource: [minimalSource()],
    totals: { retrieved: 0, deduplicatedAway: 0, imported: 0 },
    mergeDecisions: [],
  };
}

/** The record as the export writes it, parsed back. */
function exported(provenance: SearchProvenance): unknown {
  return JSON.parse(serializeProvenance(provenance));
}

// ---------------------------------------------------------------------------
// 3. The schema artefact itself
// ---------------------------------------------------------------------------

describe("schema/provenance.schema.json", () => {
  it("declares JSON Schema draft 2020-12, as docs/07 §5.3 specifies", () => {
    // Conformance: §5.3 names the dialect, and a consumer dispatches on this.
    expect(SCHEMA["$schema"]).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("is the path docs/07 §2.2 and docs/13 §1.2 declare", () => {
    expect(PROVENANCE_SCHEMA_PATH).toBe("schema/provenance.schema.json");
  });

  it("uses only keywords the validator in this file implements", () => {
    // The guard that keeps a hand-written validator honest: a keyword added to
    // the schema that this validator does not enforce would otherwise make the
    // schema look stricter than it is.
    const unknown = [...schemaKeywords(SCHEMA)].filter(
      (keyword) => !IMPLEMENTED_KEYWORDS.includes(keyword),
    );
    expect(unknown).toEqual([]);
    // And the annotation-only keywords are declared as such, so nobody reads
    // `format: date-time` as a check.
    expect(IMPLEMENTED_KEYWORDS).toEqual(
      expect.arrayContaining([...ANNOTATION_ONLY]),
    );
  });

  it("pins schemaVersion to the literal 1", () => {
    // Criterion 4, first half. §5.3 types the field `1`, not `number`.
    expect(SCHEMA["properties"]).toMatchObject({ schemaVersion: { const: 1 } });
    expect(PROVENANCE_SCHEMA_VERSION).toBe(1);
  });

  it("enumerates exactly src/model/ids.ts's SourceId union, in order", () => {
    // Conformance to model/, not to this file: a ninth source added to the
    // union and not to the schema would make every record from it invalid.
    expect(SOURCE_SCHEMA["properties"]).toMatchObject({
      sourceId: { enum: [...SOURCE_IDS] },
    });
  });

  it("declares docs/07 §5.3's SearchProvenance field names, in §5.3's order", () => {
    // Conformance. This list is typed from §5.3's printed interface — the
    // "reviewed by diff, not by memory" half of criterion 3.
    expect(Object.keys(SCHEMA["properties"] as object)).toEqual([
      "schemaVersion",
      "runId",
      "pluginVersion",
      "zoteroVersion",
      "startedAt",
      "finishedAt",
      "userQuery",
      "dateFilter",
      "targetLibraryId",
      "targetCollectionKey",
      "perSource",
      "totals",
      // `P2-T34`, 2026-10-15: FR-50 scenario 2's field, appended by §5.3.
      "mergeDecisions",
    ]);
  });

  it("declares docs/07 §5.3's MergeDecision field names, in §5.3's order, all required", () => {
    const merge = resolveRef(SCHEMA, "#/$defs/MergeDecision");
    const fields = ["workKey", "tier", "confidence", "evidence"];
    expect(Object.keys(merge["properties"] as object)).toEqual(fields);
    expect(merge["required"]).toEqual(fields);
    expect(merge["additionalProperties"]).toBe(false);
    expect(SCHEMA["properties"]).toMatchObject({
      mergeDecisions: {
        type: "array",
        items: { $ref: "#/$defs/MergeDecision" },
      },
    });
    expect(SCHEMA["required"]).toContain("mergeDecisions");
  });

  it("declares docs/07 §5.3's SourceProvenance field names, in §5.3's order", () => {
    expect(Object.keys(SOURCE_SCHEMA["properties"] as object)).toEqual([
      "sourceId",
      "endpointBaseUrl",
      "transmittedQuery",
      "transmittedUrl",
      "dateFilterApplied",
      "requestedLimit",
      "rawHitCount",
      "recordsRetrieved",
      "recordsDeduplicatedAway",
      "recordsImported",
      "error",
      "sourceExtras",
    ]);
  });

  it("names every FR-8 quantity, including the ones that are 0", () => {
    // Conformance to FR-8's field list: "endpoint base URL, transmitted query
    // string (keys redacted), date filter, requested limit, raw hit count
    // reported by the source, number of records retrieved, number deduplicated
    // away, and number imported", "required even when they are zero".
    const required = SOURCE_SCHEMA["required"];
    expect(required).toEqual([
      "sourceId",
      "endpointBaseUrl",
      "transmittedQuery",
      "transmittedUrl",
      "dateFilterApplied",
      "requestedLimit",
      "recordsRetrieved",
      "recordsDeduplicatedAway",
      "recordsImported",
    ]);
    // `rawHitCount` is FR-8's one quantity §5.3 lets the source omit
    // (`number | undefined`), so it is declared but not required.
    expect(SOURCE_SCHEMA["properties"]).toHaveProperty("rawHitCount");
  });
});

// ---------------------------------------------------------------------------
// 4. Schema ↔ interface parity — the drift alarm (self-consistency)
// ---------------------------------------------------------------------------

describe("schema and src/core/provenance.ts stay in step", () => {
  it("schema properties cover every field a complete record carries", () => {
    const record = exported(completeRun()) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(
      Object.keys(SCHEMA["properties"] as object).sort(),
    );
    const source = (record["perSource"] as Record<string, unknown>[])[0];
    expect(Object.keys(source ?? {}).sort()).toEqual(
      Object.keys(SOURCE_SCHEMA["properties"] as object).sort(),
    );
  });

  it("schema `required` is exactly what survives a minimal record", () => {
    // `JSON.stringify` omits an `undefined`-valued member, so "required in the
    // schema" and "not `| undefined` in the interface" have to be the same set.
    const record = exported(minimalRun()) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(
      [...(SCHEMA["required"] as string[])].sort(),
    );
    const source = (record["perSource"] as Record<string, unknown>[])[0];
    expect(Object.keys(source ?? {}).sort()).toEqual(
      [...(SOURCE_SCHEMA["required"] as string[])].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Conformance of a real record — docs/13 §2.1's first Provenance test
// ---------------------------------------------------------------------------

describe("a SearchProvenance object validates against the shipped schema", () => {
  it("accepts a complete run", () => {
    expect(validate(SCHEMA, exported(completeRun()), SCHEMA)).toEqual([]);
  });

  it("accepts FR-3's All-years run with every optional member absent", () => {
    expect(validate(SCHEMA, exported(minimalRun()), SCHEMA)).toEqual([]);
  });

  it('records dateFilter "none" when the user chose All years (FR-3)', () => {
    // Criterion 6. The `"none"` arm of §5.3's union, through the export.
    const record = exported(minimalRun()) as Record<string, unknown>;
    expect(record["dateFilter"]).toBe("none");
    expect(validate(SCHEMA, record, SCHEMA)).toEqual([]);
  });

  it("carries the literal schemaVersion 1 in the emitted JSON", () => {
    // Criterion 4, second half.
    const record = exported(completeRun()) as Record<string, unknown>;
    expect(record["schemaVersion"]).toBe(1);
  });

  it("records a 0 for deduplicated-away rather than omitting it", () => {
    // Criterion 3's tail, and §5.3's "0, not absent".
    const record = exported(minimalRun()) as Record<string, unknown>;
    expect(record["totals"]).toEqual({
      retrieved: 0,
      deduplicatedAway: 0,
      imported: 0,
    });
    const source = (record["perSource"] as Record<string, unknown>[])[0];
    expect(source?.["recordsDeduplicatedAway"]).toBe(0);
    expect(serializeProvenance(minimalRun())).toContain(
      '"recordsDeduplicatedAway": 0',
    );
  });

  it("P2-T34: carries every merge decision — tier, confidence, evidence — and validates (FR-50 scenario 2)", () => {
    const record = exported(completeRun()) as Record<string, unknown>;
    expect(record["mergeDecisions"]).toEqual([doiMerge(), fuzzyMerge()]);
    expect(validate(SCHEMA, record, SCHEMA)).toEqual([]);
  });

  it("P2-T34: records an empty mergeDecisions, not an absent one, when nothing merged", () => {
    const record = exported(minimalRun()) as Record<string, unknown>;
    expect(record["mergeDecisions"]).toEqual([]);
    expect(serializeProvenance(minimalRun())).toContain('"mergeDecisions": []');
  });

  it("startedAt and finishedAt are ISO 8601", () => {
    // `format` is annotation-only in draft 2020-12, so the shape is asserted
    // here instead of being assumed from the schema.
    const record = exported(completeRun()) as Record<string, string>;
    for (const field of ["startedAt", "finishedAt"]) {
      expect(record[field]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    }
  });
});

describe("the validator rejects what the schema forbids", () => {
  /** A complete export with one surgical change. */
  function broken(mutate: (record: Record<string, unknown>) => void): unknown {
    const record = exported(completeRun()) as Record<string, unknown>;
    mutate(record);
    return record;
  }

  it("rejects a wrong schemaVersion", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => (r["schemaVersion"] = 2)),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("expected const 1");
  });

  it("rejects a missing required count", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        delete (r["perSource"] as Record<string, unknown>[])[0]?.[
          "recordsDeduplicatedAway"
        ];
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain(
      "missing required property recordsDeduplicatedAway",
    );
  });

  it("rejects an unknown source id", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        const source = (r["perSource"] as Record<string, unknown>[])[0];
        if (source !== undefined) source["sourceId"] = "scopus";
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("is not in enum");
  });

  it("rejects a field §5.3 does not declare", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => (r["notes"] = "hello")),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("additional property notes");
  });

  it("rejects a half-built dateFilter", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => (r["dateFilter"] = { fromIso: "2024-01-01" })),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("oneOf");
  });

  it("rejects a non-integer count", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        const source = (r["perSource"] as Record<string, unknown>[])[0];
        if (source !== undefined) source["recordsImported"] = 1.5;
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("expected type integer");
  });

  it("P2-T34: rejects a merge decision with no tier", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        const merge = (r["mergeDecisions"] as Record<string, unknown>[])[0];
        if (merge !== undefined) delete merge["tier"];
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("missing required property tier");
  });

  it("P2-T34: rejects evidence that is not flat", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        const merge = (r["mergeDecisions"] as Record<string, unknown>[])[0];
        if (merge !== undefined) merge["evidence"] = { doi: { nested: 1 } };
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("$.mergeDecisions[0].evidence.doi");
  });

  it("P2-T34: rejects a record with no mergeDecisions at all", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        delete r["mergeDecisions"];
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain(
      "missing required property mergeDecisions",
    );
  });

  it("rejects a negative count", () => {
    const errors = validate(
      SCHEMA,
      broken((r) => {
        const source = (r["perSource"] as Record<string, unknown>[])[0];
        if (source !== undefined) source["recordsImported"] = -1;
      }),
      SCHEMA,
    );
    expect(errors.join("\n")).toContain("is below 0");
  });
});

// ---------------------------------------------------------------------------
// 6. Redaction — docs/13 §2.1's second Provenance test, and NFR-16
// ---------------------------------------------------------------------------

describe("no credential reaches either output", () => {
  it("strips api_key from transmittedUrl", () => {
    // docs/13 §2.1's named test. Conformance to docs/09 §2.1: the parameter is
    // REMOVED, not blanked — "an empty value is the one thing
    // `[redacted:<len>]` cannot express".
    const source = redactSourceProvenance(completeSource());
    expect(source.transmittedUrl).toBe(
      `${ESEARCH}?db=pubmed&term=crispr&retmax=50`,
    );
    expect(source.transmittedUrl).not.toContain(STUB_KEY);
  });

  it("strips api_key from transmittedQuery, which is not a URL", () => {
    // The hole `redactUrl` alone leaves: a bare query string parses as a path,
    // so no named parameter is removed, and a 32-character NCBI key is below
    // `KEY_PATTERNS`' 40-character catch-all.
    const source = redactSourceProvenance(completeSource());
    expect(source.transmittedQuery).toBe("db=pubmed&term=crispr&retmax=50");
    expect(source.transmittedQuery).not.toContain(STUB_KEY);
  });

  it("redactQueryString leaves a key-free query string alone", () => {
    expect(redactQueryString("db=pubmed&term=crispr")).toBe(
      "db=pubmed&term=crispr",
    );
    expect(redactQueryString("?db=pubmed&term=crispr")).toBe(
      "db=pubmed&term=crispr",
    );
    expect(redactQueryString("")).toBe("");
  });

  it("redacts a key pasted into the search box", () => {
    // §5.3 calls `userQuery` "verbatim"; NFR-16 forbids a key in a provenance
    // record without exception. The record is the output of the stricter rule.
    const run = redactSearchProvenance({
      ...completeRun(),
      userQuery: `crispr sk-ant-${"a".repeat(40)}`,
    });
    expect(run.userQuery).not.toContain("sk-ant-aaaa");
    expect(run.userQuery).toContain("[redacted:");
  });

  it("redacts a key echoed back inside sourceExtras, at any depth", () => {
    const source = redactSourceProvenance({
      ...completeSource(),
      sourceExtras: {
        querytranslation: `AIza${"B".repeat(35)}`,
        translationset: [{ from: "x", to: `Bearer ${"c".repeat(30)}` }],
      },
    });
    const dumped = JSON.stringify(source.sourceExtras);
    expect(dumped).not.toContain("AIzaB");
    expect(dumped).not.toContain("Bearer c");
    expect(dumped).toContain("[redacted:");
  });

  it("redacts a URL that leaked into SerializedError.detail", () => {
    // The leak the first draft of src/core/provenance.ts had: `detail` is free
    // text that quotes the failing request, and `redact()` alone cannot see an
    // `api_key` parameter inside it because a 32-character NCBI key is below
    // `KEY_PATTERNS`' 40-character catch-all.
    const source = redactSourceProvenance(completeSource());
    expect(source.error?.detail).not.toContain(STUB_KEY);
    expect(source.error?.detail).toBe(`efetch failed for ${ESEARCH}`);
  });

  it("redacts a URL pasted into the search box", () => {
    const run = redactSearchProvenance({
      ...completeRun(),
      userQuery: `see ${ESEARCH}?db=pubmed&api_key=${STUB_KEY} for details`,
    });
    expect(run.userQuery).not.toContain(STUB_KEY);
    expect(run.userQuery).toBe(`see ${ESEARCH}?db=pubmed for details`);
  });

  it("redacts a URL that leaked into SerializedError.stack", () => {
    const source = redactSourceProvenance({
      ...completeSource(),
      error: {
        code: "SOURCE",
        messageKey: "rh-error-source",
        detail: "boom",
        retryable: false,
        stack: `at request (${ESEARCH}?api_key=${STUB_KEY})`,
      },
    });
    expect(source.error?.stack).not.toContain(STUB_KEY);
  });

  it("P2-T34: redacts a key in a merge decision's evidence, and keeps the hash: work key whole", () => {
    const run = redactSearchProvenance({
      ...completeRun(),
      mergeDecisions: [
        {
          ...fuzzyMerge(),
          evidence: { ...fuzzyMerge().evidence, rule: `x ${STUB_KEY}` },
        },
      ],
    });
    const [merge] = run.mergeDecisions;
    expect(merge?.evidence["rule"]).toBe("x [redacted:32]");
    // Numbers and booleans pass through untouched.
    expect(merge?.evidence["levSim"]).toBe(0.97);
    expect(merge?.evidence["firstAuthorMatches"]).toBe(true);
    // The work key is a SHA-1 of public metadata, 40 hexadecimal characters
    // the hexadecimal rule would otherwise blank — and it names the work.
    expect(merge?.workKey).toBe(fuzzyMerge().workKey);
    expect(merge?.tier).toBe("title-fuzzy");
    expect(serializeProvenance(run)).not.toContain(STUB_KEY);
  });

  it("is idempotent, so the export boundary can redact again for free", () => {
    const once = redactSearchProvenance(completeRun());
    expect(redactSearchProvenance(once)).toEqual(once);
  });

  it("serialises no api_key= anywhere — criterion 5", () => {
    // The criterion's own check, as the grep it describes.
    const text = serializeProvenance(completeRun());
    expect(text.split("api_key=").length - 1).toBe(0);
    expect(text).not.toContain(STUB_KEY);
  });

  it("puts no api_key= in the note either", () => {
    const html = renderProvenanceNoteHtml(
      redactSearchProvenance(completeRun()),
    );
    expect(html.split("api_key=").length - 1).toBe(0);
    expect(html).not.toContain(STUB_KEY);
  });

  it("shows the [redacted:n] marker for a key no parameter name hides", () => {
    // Criterion 5's second half, scoped to what it can mean: `redactUrl`
    // removes a *named* secret parameter outright, so no marker can appear for
    // one. A key-shaped run anywhere else does get the marker.
    const text = serializeProvenance({
      ...completeRun(),
      userQuery: `sk-proj-${"d".repeat(30)}`,
    });
    expect(text).toContain("[redacted:");
  });
});

// ---------------------------------------------------------------------------
// 7. The JSON export — FR-8's third clause
// ---------------------------------------------------------------------------

describe("exportJson", () => {
  /** A `ProvenanceFileWriter` that records instead of writing. */
  function recorder(): ProvenanceFileWriter & {
    readonly calls: { path: string; text: string }[];
  } {
    const calls: { path: string; text: string }[] = [];
    return {
      calls,
      writeTextFile: (path, text) => {
        calls.push({ path, text });
        return Promise.resolve(undefined);
      },
    };
  }

  it("writes the serialised record to the user-chosen path", async () => {
    const files = recorder();
    await exportJson("/tmp/provenance.json", completeRun(), files);
    expect(files.calls).toHaveLength(1);
    expect(files.calls[0]?.path).toBe("/tmp/provenance.json");
    expect(files.calls[0]?.text).toBe(serializeProvenance(completeRun()));
  });

  it("writes pretty-printed, newline-terminated JSON", () => {
    const text = serializeProvenance(completeRun());
    expect(text).toContain('\n  "runId": "run-0001"');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("is a projection of the whole record, not a field list", () => {
    // Self-consistency, but the property that matters: the export is
    // `JSON.stringify` of the object, so a field added to §5.3 needs no change
    // in `serializeProvenance`.
    expect(exported(completeRun())).toEqual(
      JSON.parse(JSON.stringify(redactSearchProvenance(completeRun()))),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. The note — FR-8's title, docs/01 §5.7's HTML
// ---------------------------------------------------------------------------

describe("the provenance note", () => {
  it("is titled exactly as FR-8 requires — criterion 1", () => {
    // Conformance: the card's own regex, unchanged.
    const title = provenanceNoteTitle(completeRun());
    expect(title).toMatch(
      /^Research Helper — search provenance \d{4}-\d{2}-\d{2}T/,
    );
    expect(title).toBe(
      "Research Helper — search provenance 2026-10-07T04:00:12.500Z",
    );
    expect(PROVENANCE_NOTE_TITLE_PREFIX).toBe(
      "Research Helper — search provenance ",
    );
  });

  it("puts the title in the first line, where getNoteTitle() reads it", () => {
    const html = renderProvenanceNoteHtml(completeRun());
    expect(html.startsWith("<h1>Research Helper — search provenance ")).toBe(
      true,
    );
  });

  it("uses only docs/01 §5.7's conservative HTML subset", () => {
    // Conformance to §5.7's printed list. `tr`/`td`/`th` are absent from it,
    // which is why the renderer uses nested lists rather than a table.
    const allowed = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "a",
      "blockquote",
      "pre",
      "code",
      "table",
    ];
    const html = renderProvenanceNoteHtml(completeRun());
    const used = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) =>
      (m[1] ?? "").toLowerCase(),
    );
    expect([...new Set(used)].filter((tag) => !allowed.includes(tag))).toEqual(
      [],
    );
  });

  it("writes no Markdown into the note", () => {
    // docs/01 §5.7: Markdown "will render as literal text".
    const html = renderProvenanceNoteHtml(completeRun());
    expect(html).not.toMatch(/^#{1,6}\s/m);
    expect(html).not.toMatch(/\*\*/);
    expect(html).not.toMatch(/^[-*] /m);
    expect(html).not.toMatch(/`/);
  });

  it("escapes a value that would otherwise close a tag", () => {
    const html = renderProvenanceNoteHtml({
      ...completeRun(),
      userQuery: `<script>alert("x" & 'y')</script>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
  });

  it("renders every FR-8 per-source quantity, zeros included", () => {
    // Conformance to FR-8's enumeration. The note is the surface FR-8's second
    // clause describes ("When it is inspected").
    const html = renderProvenanceNoteHtml(redactSearchProvenance(minimalRun()));
    for (const label of [
      "Endpoint base URL",
      "Transmitted query",
      "Transmitted URL",
      "Date filter applied",
      "Requested limit",
      "Raw hit count",
      "Records retrieved",
      "Records deduplicated away",
      "Records imported",
    ]) {
      expect(html).toContain(`<strong>${label}</strong>`);
    }
    expect(html).toContain("<strong>Records deduplicated away</strong>: 0");
    expect(html).toContain("<strong>Records imported</strong>: 0");
  });

  it("P2-T34: shows every merge decision's work key, tier, confidence and evidence (FR-50 scenario 2)", () => {
    const html = renderProvenanceNoteHtml(
      redactSearchProvenance(completeRun()),
    );
    const section = html.slice(html.indexOf("<h2>Merge decisions</h2>"));
    expect(section).not.toBe(html);
    expect(section).toContain(
      "<li><code>doi:10.1038/s41586-023-06139-9</code><ul>" +
        "<li><strong>Tier</strong>: <code>doi</code></li>" +
        "<li><strong>Confidence</strong>: 1</li>" +
        "<li><strong>Evidence</strong>: " +
        "<code>{&quot;doi&quot;:&quot;10.1038/s41586-023-06139-9&quot;}</code></li>" +
        "</ul></li>",
    );
    expect(section).toContain(
      "<strong>Tier</strong>: <code>title-fuzzy</code>",
    );
    expect(section).toContain("<strong>Confidence</strong>: 0.92");
    expect(section).toContain("&quot;rule&quot;:&quot;levenshtein&quot;");
  });

  it("P2-T34: says none under Merge decisions when nothing merged", () => {
    const html = renderProvenanceNoteHtml(redactSearchProvenance(minimalRun()));
    expect(html).toContain("<h2>Merge decisions</h2><p>none</p>");
  });

  it("shows an em dash, not an empty <code>, for an empty query string", () => {
    // Reachable from a shipped caller: `src/sources/pubmed/query.ts` returns
    // `transmittedQuery: ""` when the redacted URL carries no query string at
    // all, and `<code></code>` renders as nothing in the note editor, which
    // reads as "this field was not recorded" rather than "it was empty".
    // Found by mutation M16, which deleted this branch and broke no assertion.
    const run = minimalRun();
    const html = renderProvenanceNoteHtml({
      ...run,
      perSource: [{ ...minimalSource(), transmittedQuery: "" }],
    });
    expect(html).toContain("<strong>Transmitted query</strong>: —");
    expect(html).not.toContain("<code></code>");
  });

  it("shows an em dash, not a 0, when the source reported no hit count", () => {
    const html = renderProvenanceNoteHtml(minimalRun());
    expect(html).toContain("<strong>Raw hit count</strong>: —");
  });

  it("renders FR-3's All-years window as none", () => {
    expect(renderProvenanceNoteHtml(minimalRun())).toContain(
      "<strong>Date filter</strong>: none (all years)",
    );
  });

  it("surfaces PubMed's translationset expansion (docs/02 §12.4)", () => {
    const html = renderProvenanceNoteHtml(
      redactSearchProvenance(completeRun()),
    );
    expect(html).toContain("<strong>Source extras</strong>");
    expect(html).toContain("<strong>querytranslation</strong>");
    expect(html).toContain("<strong>translationset</strong>");
  });
});

// ---------------------------------------------------------------------------
// 9. Writing the note — docs/01 §5.7's sequence, FR-8's "standalone"
// ---------------------------------------------------------------------------

describe("writeProvenanceNote", () => {
  /** A `Zotero.Item('note')` double that records the calls §5.7 prescribes. */
  function noteDouble(): ProvenanceNoteItem & {
    readonly state: {
      note: string | undefined;
      collections: (string | number)[] | undefined;
      tags: { name: string; type: number | undefined }[];
      saves: number;
    };
  } {
    const state = {
      note: undefined as string | undefined,
      collections: undefined as (string | number)[] | undefined,
      tags: [] as { name: string; type: number | undefined }[],
      saves: 0,
    };
    return {
      state,
      libraryID: 0,
      key: "NOTEKEY1",
      setNote(content) {
        state.note = content;
        return true;
      },
      setCollections(ids) {
        state.collections = [...ids];
      },
      addTag(name, type) {
        state.tags.push({ name, type });
        return true;
      },
      saveTx() {
        state.saves += 1;
        return Promise.resolve(1);
      },
    };
  }

  it("creates a standalone note in the target collection, tagged and saved once", async () => {
    const note = noteDouble();
    const key = await writeProvenanceNote(completeRun(), {
      createNote: () => note,
    });
    expect(note.libraryID).toBe(1);
    expect(note.state.collections).toEqual(["ABCD2345"]);
    // Automatic (orange) — `AUTOMATIC_TAG_TYPE` in src/zotero/itemMapper.ts.
    expect(note.state.tags).toEqual([{ name: "research_helper", type: 1 }]);
    expect(note.state.saves).toBe(1);
    expect(key).toBe("NOTEKEY1");
    expect(note.state.note).toBe(renderProvenanceNoteHtml(completeRun()));
  });

  it("sets no collection when the run targeted none", async () => {
    const note = noteDouble();
    await writeProvenanceNote(minimalRun(), { createNote: () => note });
    expect(note.state.collections).toBeUndefined();
    expect(note.state.saves).toBe(1);
  });

  it("writes the note Zotero will derive FR-8's title from", async () => {
    const note = noteDouble();
    await writeProvenanceNote(completeRun(), { createNote: () => note });
    expect(note.state.note ?? "").toMatch(
      /^<h1>Research Helper — search provenance \d{4}-\d{2}-\d{2}T/,
    );
  });
});

// ---------------------------------------------------------------------------
// 10. The gate for every other persisted record — `P3-T36`
//
// Owner decision 2026-10-20 (`plan/00` §6 item 242): every record Phase 3
// stores passes `redactRecord`, `StoredSummary` content included, and a record
// the gate changed carries the "partly redacted" mark. Every key below is
// synthetic and built at run time.
// ---------------------------------------------------------------------------

describe("redactRecord — one gate for new persisted records (P3-T36)", () => {
  const anthropicKey = (): string => "sk-ant-" + "x".repeat(30);
  /** NCBI's shape: 32 hexadecimal characters, below the 40-character floor. */
  const hexKey = (): string => "0123456789abcdef".repeat(2);
  /** Too short and too plain for any `KEY_PATTERNS` shape. */
  const shortKey = (): string => "k3y-" + "q".repeat(8);
  /** A SHA-256, as `StoredSummary.contentHash` holds it. */
  const sha256 = (): string => "ab".repeat(32);
  /** A `hash:` work key, as `src/model/ids.ts` derives it (SHA-1, 40 hex). */
  const hashWorkKey = (): string => `hash:${"c0ffee".repeat(6)}0123`;

  /**
   * Green fluorescent protein (Aequorea victoria), residues 1-80: the kind of
   * sequence a methods section quotes verbatim.
   */
  const GFP_1_80 =
    "MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQ";
  /** The start of the EGFP coding sequence, 90 nucleotides. */
  const EGFP_CDS_START =
    "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTG";

  /** A `StoredSummary`-shaped row (`docs/07` §5.2), content and envelope. */
  const summaryRow = (verbatimSupport: string, statement = "GFP folds.") => {
    const workKey = hashWorkKey();
    return {
      id: `${workKey}:1.0.0:model-a`,
      workKey,
      content: {
        researchQuestion: "Does the variant fold at 37 °C?",
        keyFindings: [{ statement, verbatimSupport }],
        keywords: ["GFP", "folding"],
        confidence: "medium",
      },
      inputScope: { kind: "abstract+fulltext", charsSent: 18_000, chunks: 2 },
      promptId: "PAPER_SUMMARY_FULLTEXT",
      promptVersion: "1.0.0",
      providerId: "anthropic",
      modelId: "model-a",
      temperature: 0,
      usage: {
        inputTokens: 4_000,
        outputTokens: 600,
        totalTokens: 4_600,
        costUsd: 0.02,
      },
      generatedAtEpochMs: 1_760_000_000_000,
      sourceItemVersion: undefined,
      contentHash: sha256(),
      truncated: false,
      groundingScore: 1,
      warnings: [],
    };
  };
  const SUMMARY_IDS = ["id", "workKey", "contentHash"];

  it("removes a key in a string, in a URL query and under an apiKey field, at any depth", () => {
    const record = {
      input: {
        note: `pasted ${anthropicKey()} by mistake`,
        request: `GET ${ESEARCH}?db=pubmed&term=gfp&api_key=${hexKey()}`,
        auth: { provider: "ncbi", apiKey: shortKey() },
      },
      attemptCount: 1,
    };
    const { record: out, mark } = redactRecord(record);
    const text = JSON.stringify(out);
    expect(text).not.toContain(anthropicKey());
    expect(text).not.toContain(hexKey());
    expect(text).not.toContain(shortKey());
    expect(text).not.toContain("api_key");
    expect(out).toEqual({
      input: {
        note: "pasted [redacted:37] by mistake",
        request: `GET ${ESEARCH}?db=pubmed&term=gfp`,
        auth: { provider: "ncbi" },
      },
      attemptCount: 1,
    });
    expect(mark).toEqual({
      partlyRedacted: true,
      redactedStrings: 2,
      droppedFields: 1,
    });
  });

  it("is idempotent: a second pass returns an equal record and no mark", () => {
    const record = {
      error: {
        code: "BAD_REQUEST",
        messageKey: "research-helper-error-bad-request",
        detail: `efetch failed for ${ESEARCH}?api_key=${hexKey()}`,
        retryable: false,
        stack: `Error: ${anthropicKey()}\n    at run`,
      },
      secret: { value: shortKey() },
      summary: summaryRow(`It reads ${GFP_1_80}.`),
    };
    const once = redactRecord(record, { verbatimKeys: SUMMARY_IDS });
    const twice = redactRecord(once.record, { verbatimKeys: SUMMARY_IDS });
    expect(once.mark.partlyRedacted).toBe(true);
    expect(twice.record).toEqual(once.record);
    expect(twice.mark).toEqual({
      partlyRedacted: false,
      redactedStrings: 0,
      droppedFields: 0,
    });
  });

  it("leaves KEY_PATTERNS at eight entries, the catch-all at 40", () => {
    expect(KEY_PATTERNS).toHaveLength(8);
    expect(KEY_PATTERNS.at(-1)?.source).toBe(
      String.raw`\b[A-Za-z0-9_-]{40,}\b`,
    );
  });

  it("marks a summary whose quoted protein sequence the catch-all altered", () => {
    const row = summaryRow(
      `The construct encoded ${GFP_1_80} (residues 1-80).`,
    );
    const { record: out, mark } = redactRecord(row, {
      verbatimKeys: SUMMARY_IDS,
    });
    // The sequence is gone (the documented cost of the 40-character floor,
    // which the gate does not weaken) and the row says so.
    expect(out.content.keyFindings[0]?.verbatimSupport).toBe(
      "The construct encoded [redacted:80] (residues 1-80).",
    );
    expect(mark).toEqual({
      partlyRedacted: true,
      redactedStrings: 1,
      droppedFields: 0,
    });
    // Nothing else in the row moved: identity, usage, scope.
    expect(out).toEqual({
      ...row,
      content: {
        ...row.content,
        keyFindings: [
          {
            statement: "GFP folds.",
            verbatimSupport:
              "The construct encoded [redacted:80] (residues 1-80).",
          },
        ],
      },
    });
  });

  it("marks a summary whose quoted DNA sequence the catch-all altered", () => {
    const row = summaryRow("Primer-free.", `The CDS opens ${EGFP_CDS_START}.`);
    const { record: out, mark } = redactRecord(row, {
      verbatimKeys: SUMMARY_IDS,
    });
    expect(out.content.keyFindings[0]?.statement).toBe(
      "The CDS opens [redacted:90].",
    );
    expect(mark.partlyRedacted).toBe(true);
    expect(mark.redactedStrings).toBe(1);
  });

  it("returns an equal, unmarked copy of a record with nothing to redact, and leaves the input untouched", () => {
    const row = summaryRow("Fluorescence peaked at 509 nm.");
    const before = structuredClone(row);
    const { record: out, mark } = redactRecord(row, {
      verbatimKeys: SUMMARY_IDS,
    });
    expect(out).toEqual(row);
    expect(out).not.toBe(row);
    expect(row).toEqual(before);
    expect(mark).toEqual({
      partlyRedacted: false,
      redactedStrings: 0,
      droppedFields: 0,
    });
  });

  it("keeps a key-named number, boolean or null, and removes a key-named string, array or object", () => {
    const { record: out, mark } = redactRecord({
      usage: { inputTokens: 12, outputTokens: 3, costUsd: 0.01 },
      models: [{ id: "model-a", contextWindowTokens: 200_000 }],
      tokenRefreshed: false,
      bearer: null,
      token: shortKey(),
      tokens: [shortKey()],
      credentials: { user: "owner", pass: shortKey() },
    });
    expect(out).toEqual({
      usage: { inputTokens: 12, outputTokens: 3, costUsd: 0.01 },
      models: [{ id: "model-a", contextWindowTokens: 200_000 }],
      tokenRefreshed: false,
      bearer: null,
    });
    expect(mark).toEqual({
      partlyRedacted: true,
      redactedStrings: 0,
      droppedFields: 3,
    });
  });

  it("copies the caller's identifier fields unchanged, and loses them without the option", () => {
    const row = summaryRow("Fluorescence peaked at 509 nm.");
    const job = { workKeys: [hashWorkKey(), "doi:10.1000/xyz"], total: 2 };

    const kept = redactRecord(
      { row, job },
      { verbatimKeys: [...SUMMARY_IDS, "workKeys"] },
    );
    expect(kept.record).toEqual({ row, job });
    expect(kept.mark.partlyRedacted).toBe(false);

    // Without the option the hexadecimal rule takes both hashes, and every
    // row would carry the mark: the reason the option exists.
    const lost = redactRecord({ row, job });
    expect(lost.record.row.contentHash).toBe("[redacted:64]");
    expect(lost.record.row.workKey).toBe("hash:[redacted:40]");
    expect(lost.record.job.workKeys[0]).toBe("hash:[redacted:40]");
    expect(lost.mark.partlyRedacted).toBe(true);
  });

  it("copies an identifier field only when it holds a string or an array of strings", () => {
    const { record: out, mark } = redactRecord(
      { contentHash: { note: `see ${anthropicKey()}` } },
      { verbatimKeys: ["contentHash"] },
    );
    expect(JSON.stringify(out)).not.toContain(anthropicKey());
    expect(mark.redactedStrings).toBe(1);
  });

  it("removes a key-named field even when the caller lists it as verbatim", () => {
    const { record: out, mark } = redactRecord(
      { apiKey: shortKey(), workKey: hashWorkKey() },
      { verbatimKeys: ["apiKey", "workKey"] },
    );
    expect(out).toEqual({ workKey: hashWorkKey() });
    expect(mark.droppedFields).toBe(1);
  });

  it("redacts a key used as a property name", () => {
    const { record: out, mark } = redactRecord({
      termWeights: { gfp: 0.4, [anthropicKey()]: 0.1 },
    });
    expect(JSON.stringify(out)).not.toContain(anthropicKey());
    expect(out).toEqual({
      termWeights: { gfp: 0.4, "[redacted:37]": 0.1 },
    });
    expect(mark.redactedStrings).toBe(1);
  });

  it("passes non-string leaves through, and gates a bare string", () => {
    expect(redactRecord(42).record).toBe(42);
    expect(redactRecord(null).record).toBeNull();
    expect(redactRecord(`x ${hexKey()}`)).toEqual({
      record: "x [redacted:32]",
      mark: { partlyRedacted: true, redactedStrings: 1, droppedFields: 0 },
    });
  });
});

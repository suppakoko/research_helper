import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  registerSources,
  type SourceAdapters,
} from "../../../src/bootstrap/registerSources";
import type { SourceId } from "../../../src/model/ids";
import { createSourceRegistry } from "../../../src/sources/registry";
import type {
  LiteratureSource,
  SourceCapabilities,
} from "../../../src/sources/types";

/**
 * `P1-T07`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * Covers `src/sources/registry.ts` and `src/bootstrap/registerSources.ts`. The
 * card's `Files` list names no test for the second file, and the registry is the
 * only thing `registerSources` does anything to, so both live here rather than
 * in a file the card did not ask for.
 *
 * {@link FULL_CAPABILITIES} doubles as a compile-time assertion that every
 * member of docs/07 §4.2's `SourceCapabilities` exists under that exact name:
 * the annotation makes a renamed or dropped field a typecheck failure.
 *
 * `P2-T26` added `replaceForTest`, the one member that is a test seam rather
 * than part of the lookup table. Its `describe` below covers the swap, the
 * order it keeps, the throw that keeps it from registering, and — by reading
 * `src/` — that nothing shipped calls it.
 */

const SRC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src",
);

/** Every `.ts` file under `src/` whose text names `member`, repository-relative. */
function sourceFilesNaming(member: string): string[] {
  return readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((file) => readFileSync(file, "utf8").includes(member))
    .map((file) => relative(SRC_DIR, file).replaceAll("\\", "/"))
    .sort((a, b) => a.localeCompare(b));
}

const FULL_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
  query: {
    or: true,
    not: true,
    phrase: true,
    fields: ["title", "abstract", "author"],
  },
  relatedByWork: false,
  lookupById: ["doi", "pmid"],
  abstractsInSearch: false,
  citationGraph: false,
  dateFilter: true,
  maxPageSize: 200,
  maxTotalResults: 9999,
  benefitsFromApiKey: true,
};

/** Signals a stub member that these tests are not supposed to reach. */
function unreachable(): never {
  throw new Error("stub source member called; no test here exercises it");
}

/**
 * A minimal {@link LiteratureSource}. Every behavioural member throws: the
 * registry is a lookup table and must never call into an adapter except through
 * `isConfigured()`, so a test that trips one of these has found a defect.
 */
function stubSource(id: SourceId, configured = true): LiteratureSource {
  return {
    id,
    displayNameKey: `source-name-${id}`,
    capabilities: FULL_CAPABILITIES,
    rateLimitKey: `${id}.example.test`,
    isConfigured: () => configured,
    healthCheck: unreachable,
    search: unreachable,
    searchAll: unreachable,
    explainQuery: unreachable,
  };
}

describe("createSourceRegistry", () => {
  it("returns the registered adapter from get() and list()", () => {
    const registry = createSourceRegistry();
    const pubmed = stubSource("pubmed");

    registry.register(pubmed);

    expect(registry.get("pubmed")).toBe(pubmed);
    expect(registry.list()).toEqual([pubmed]);
  });

  it("starts empty and reports undefined for an unregistered source", () => {
    const registry = createSourceRegistry();

    expect(registry.list()).toEqual([]);
    expect(registry.listConfigured()).toEqual([]);
    expect(registry.get("crossref")).toBeUndefined();
  });

  it("preserves registration order in list()", () => {
    const registry = createSourceRegistry();
    const arxiv = stubSource("arxiv");
    const pubmed = stubSource("pubmed");

    registry.register(arxiv);
    registry.register(pubmed);

    expect(registry.list().map((source) => source.id)).toEqual([
      "arxiv",
      "pubmed",
    ]);
  });

  it("refuses a second adapter for the same source id", () => {
    const registry = createSourceRegistry();
    registry.register(stubSource("pubmed"));

    expect(() => registry.register(stubSource("pubmed"))).toThrow(
      /already registered for "pubmed"/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("filters listConfigured() by isConfigured()", () => {
    const registry = createSourceRegistry();
    const configured = stubSource("pubmed", true);
    const unconfigured = stubSource("semanticscholar", false);

    registry.register(configured);
    registry.register(unconfigured);

    expect(registry.list()).toHaveLength(2);
    expect(registry.listConfigured()).toEqual([configured]);
  });

  it("re-reads isConfigured() on every call rather than caching it", () => {
    const registry = createSourceRegistry();
    let keyPresent = false;
    registry.register({
      ...stubSource("pubmed"),
      isConfigured: () => keyPresent,
    });

    expect(registry.listConfigured()).toEqual([]);
    keyPresent = true;
    expect(registry.listConfigured()).toHaveLength(1);
  });
});

describe("replaceForTest", () => {
  it("swaps the adapter under an existing id and returns the one it displaced", () => {
    const registry = createSourceRegistry();
    const real = stubSource("pubmed");
    const stub = stubSource("pubmed", false);
    registry.register(real);

    const displaced = registry.replaceForTest(stub);

    expect(displaced).toBe(real);
    expect(registry.get("pubmed")).toBe(stub);
    expect(registry.list()).toEqual([stub]);
    expect(registry.listConfigured()).toEqual([]);
  });

  it("keeps the replaced adapter's slot in registration order", () => {
    const registry = createSourceRegistry();
    registry.register(stubSource("arxiv"));
    registry.register(stubSource("pubmed"));
    registry.register(stubSource("crossref"));
    const stub = stubSource("pubmed");

    registry.replaceForTest(stub);

    expect(registry.list().map((source) => source.id)).toEqual([
      "arxiv",
      "pubmed",
      "crossref",
    ]);
    expect(registry.list()[1]).toBe(stub);
  });

  it("round-trips: putting the displaced adapter back restores get()", () => {
    const registry = createSourceRegistry();
    const real = stubSource("pubmed");
    registry.register(real);

    const displaced = registry.replaceForTest(stubSource("pubmed"));
    const stubAgain = registry.replaceForTest(displaced);

    expect(registry.get("pubmed")).toBe(real);
    expect(stubAgain).not.toBe(real);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws, and registers nothing, when no adapter holds the id", () => {
    const registry = createSourceRegistry();
    registry.register(stubSource("pubmed"));

    expect(() => registry.replaceForTest(stubSource("crossref"))).toThrow(
      /replaceForTest\("crossref"\): no literature source is registered under that id/,
    );
    expect(registry.get("crossref")).toBeUndefined();
    expect(registry.list().map((source) => source.id)).toEqual(["pubmed"]);
  });

  it("opens no second way past the duplicate-id check", () => {
    const registry = createSourceRegistry();
    registry.register(stubSource("pubmed"));
    registry.replaceForTest(stubSource("pubmed"));

    expect(() => registry.register(stubSource("pubmed"))).toThrow(
      /already registered for "pubmed"/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("is named by no file under src/ except the registry itself", () => {
    // The seam is test-only by contract, and a contract nothing checks is a
    // comment. A shipped caller would make the startup path depend on a
    // swap, which is what `P2-T26`'s Do NOT forbids.
    expect(sourceFilesNaming("replaceForTest")).toEqual([
      "sources/registry.ts",
    ]);
  });
});

describe("registerSources", () => {
  it("registers pubmed and nothing else", () => {
    const registry = createSourceRegistry();
    const pubmed = stubSource("pubmed");

    registerSources(registry, { pubmed });

    // The card's criterion: exactly one source, and listConfigured() has it.
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(pubmed);
    expect(registry.listConfigured()).toEqual([pubmed]);
    expect(registry.get("europepmc")).toBeUndefined();
    expect(registry.get("openalex")).toBeUndefined();
  });

  it("rejects an adapter whose own id does not match its key", () => {
    const registry = createSourceRegistry();
    // A mis-wired composition root: the Crossref adapter handed in as pubmed.
    const miswired = {
      pubmed: stubSource("crossref"),
    } satisfies SourceAdapters;

    expect(() => registerSources(registry, miswired)).toThrow(
      /supplied as "pubmed" reports id "crossref"/,
    );
    expect(registry.list()).toEqual([]);
  });

  it("is not idempotent — a second call is a wiring bug, not a no-op", () => {
    const registry = createSourceRegistry();
    const adapters: SourceAdapters = { pubmed: stubSource("pubmed") };

    registerSources(registry, adapters);

    expect(() => registerSources(registry, adapters)).toThrow(
      /already registered for "pubmed"/,
    );
  });
});

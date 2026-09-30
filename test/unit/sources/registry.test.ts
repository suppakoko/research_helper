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
 */

const FULL_CAPABILITIES: SourceCapabilities = {
  keywordSearch: true,
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

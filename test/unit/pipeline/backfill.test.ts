import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { Semaphore } from "../../../src/core/concurrency";
import { OperationCancelledError } from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import {
  createCancellationTokenSource,
  type CancellationTokenSource,
} from "../../../src/core/jobQueue/cancellation";
import { CompositeProgressReporter } from "../../../src/core/jobQueue/progress";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  EBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { normalizeDoi, type Doi, type SourceId } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  ABSTRACT_BACKFILL_LADDER,
  abstractBackfillRequestBound,
  backfillAbstracts,
} from "../../../src/pipeline/searchImport/backfill";
import { createSearchImportPipeline } from "../../../src/pipeline/searchImport/searchImportPipeline";
import { NETWORK_METADATA_POOL_SIZE } from "../../../src/pipeline/searchImport/stages";
import type {
  SearchImportBatchResult,
  SearchImportWriter,
} from "../../../src/pipeline/searchImport/types";
import type { PipelineContext } from "../../../src/pipeline/types";
import { createEuropePmcSource } from "../../../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import { EUROPEPMC_DOI_LOOKUP_BATCH } from "../../../src/sources/europepmc/query";
import { createSourceRegistry } from "../../../src/sources/registry";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import { SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT } from "../../../src/sources/semanticscholar/query";
import { createSemanticScholarSource } from "../../../src/sources/semanticscholar/semanticscholarSource";
import type {
  LiteratureSource,
  SourceCallContext,
} from "../../../src/sources/types";

/**
 * `P2-T12` — `docs/02` §10.4's batched abstract-backfill pass.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, **no network**. The two ladder
 * adapters are the shipped `createEuropePmcSource` and
 * `createSemanticScholarSource` with their shipped mappers, over a **counting
 * fake `HttpClient`** that plays both services: every request is recorded, and
 * each answer is built from a **recorded** response (`test/fixtures/europepmc`
 * `record-rich`, `test/fixtures/semanticscholar` `batch-lookup`) with only the
 * DOI, the ids and the abstract varied — so the mappers read the shapes the
 * services really send.
 */

// ---------------------------------------------------------------------------
// Recorded shapes
// ---------------------------------------------------------------------------

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);

/** The response body of the fixture whose sidecar names `scenario`. */
function recordedBody(source: string, scenario: string): unknown {
  const dir = resolve(FIXTURES, source);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith("_meta.json")) continue;
    const meta = JSON.parse(readFileSync(resolve(dir, name), "utf8")) as {
      scenario?: string;
    };
    if (meta.scenario !== scenario) continue;
    const exchange = JSON.parse(
      readFileSync(resolve(dir, name.replace("_meta.json", ".json")), "utf8"),
    ) as { body: string };
    return JSON.parse(exchange.body) as unknown;
  }
  throw new Error(`no ${source} fixture for scenario "${scenario}"`);
}

const EPMC_TEMPLATE = (
  recordedBody("europepmc", "record-rich") as {
    resultList: { result: Record<string, unknown>[] };
  }
).resultList.result[0] as Record<string, unknown>;

const S2_TEMPLATE = (
  recordedBody("semanticscholar", "batch-lookup") as Record<string, unknown>[]
)[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// The counting fake transport
// ---------------------------------------------------------------------------

/**
 * What each service holds for a DOI: an abstract string, `""` for a record
 * with no abstract, or no entry at all for "not held".
 */
interface Holdings {
  readonly europepmc: ReadonlyMap<string, string>;
  readonly semanticscholar: ReadonlyMap<string, string>;
}

interface Issued {
  readonly host: "europepmc" | "semanticscholar";
  readonly method: HttpMethod;
  readonly url: string;
  /** The DOIs this request asked about, in the order sent. */
  readonly dois: readonly string[];
  readonly resultType: string | null;
}

function response(url: string, body: string): HttpResponse {
  return { status: 200, url, body, rawHeaders: "", header: () => undefined };
}

function createFakeHttp(
  holdings: Holdings,
  hooks: {
    /** Called before Europe PMC answers request `index` (0-based). */
    readonly onEuropePmc?: (index: number) => void;
    /** Replace Europe PMC's body — a malformed one, say. */
    readonly europePmcBody?: string;
  } = {},
): { readonly client: HttpClient; readonly issued: Issued[] } {
  const issued: Issued[] = [];
  let epmcIndex = -1;
  const client: HttpClient = {
    request(method, url, options?: HttpOptions) {
      if (url.includes(EBI_HOST)) {
        epmcIndex += 1;
        const q = url.indexOf("?");
        const params = new URLSearchParams(
          options?.body ?? (q === -1 ? "" : url.slice(q + 1)),
        );
        const dois = [
          ...(params.get("query") ?? "").matchAll(/DOI:"([^"]+)"/gu),
        ].map((m) => m[1] ?? "");
        issued.push({
          host: "europepmc",
          method,
          url,
          dois,
          resultType: params.get("resultType"),
        });
        hooks.onEuropePmc?.(epmcIndex);
        if (hooks.europePmcBody !== undefined) {
          return Promise.resolve(response(url, hooks.europePmcBody));
        }
        const results = dois.flatMap((doi, i) => {
          const abstract = holdings.europepmc.get(doi);
          if (abstract === undefined) return [];
          const id = `9${String(epmcIndex)}${String(i).padStart(3, "0")}`;
          const result: Record<string, unknown> = {
            ...EPMC_TEMPLATE,
            id,
            pmid: id,
            doi,
            title: `Recorded shape, ${doi}`,
            abstractText: abstract,
          };
          delete result.pmcid;
          delete result.fullTextIdList;
          if (abstract === "") delete result.abstractText;
          return [result];
        });
        return Promise.resolve(
          response(
            url,
            JSON.stringify({
              version: "6.9",
              hitCount: results.length,
              resultList: { result: results },
            }),
          ),
        );
      }
      if (url.includes(SEMANTICSCHOLAR_HOST)) {
        const body = JSON.parse(options?.body ?? "{}") as { ids?: string[] };
        const ids = body.ids ?? [];
        const dois = ids.map((id) => id.replace(/^DOI:/u, ""));
        issued.push({
          host: "semanticscholar",
          method,
          url,
          dois,
          resultType: null,
        });
        const answers = dois.map((doi, i) => {
          const abstract = holdings.semanticscholar.get(doi);
          if (abstract === undefined) return null;
          return {
            ...S2_TEMPLATE,
            paperId: `s2-${doi}`,
            corpusId: 100_000 + i,
            externalIds: { DOI: doi },
            title: `Recorded shape, ${doi}`,
            abstract: abstract === "" ? null : abstract,
            // No TL;DR, so an empty abstract really is empty (the mapper
            // falls back to `tldr.text` when it is present, `docs/02` §6.7).
            tldr: null,
          };
        });
        return Promise.resolve(response(url, JSON.stringify(answers)));
      }
      throw new Error(`the fake transport has no service at ${url}`);
    },
  };
  return { client, issued };
}

/** The two shipped ladder adapters over one fake transport, in a registry. */
function ladderRegistry(
  client: HttpClient,
  options: { readonly silentSearch?: boolean } = {},
) {
  const clock = createManualClock(1_000);
  const registry = createSourceRegistry();
  // A run that ticks Europe PMC and Semantic Scholar (item 194) fans out to
  // them; `silentSearch` keeps that fan-out off the fake transport, so every
  // counted request is the backfill's own `lookup`.
  const quiet = <T extends LiteratureSource>(source: T): T =>
    options.silentSearch === true
      ? {
          ...source,
          // eslint-disable-next-line require-yield
          async *searchAll() {
            return;
          },
        }
      : source;
  registry.register(
    quiet(
      createEuropePmcSource({
        http: client,
        clock,
        mapRecords: createEuropePmcRecordMapper({ clock }),
      }),
    ),
  );
  registry.register(
    quiet(
      createSemanticScholarSource({
        http: client,
        clock,
        mapRecords: createSemanticScholarRecordMapper({ clock }),
      }),
    ),
  );
  return registry;
}

// ---------------------------------------------------------------------------
// Synthetic works
// ---------------------------------------------------------------------------

function doiOf(n: number): Doi {
  const doi = normalizeDoi(`10.5555/p2t12-${String(n)}`);
  if (doi === null) throw new Error("not DOI-shaped");
  return doi;
}

/** One merged work as `Merging` hands it over. */
function work(
  n: number,
  options: { readonly abstract?: string; readonly withDoi?: boolean } = {},
): CanonicalWork {
  const doi = doiOf(n);
  return {
    workKey: options.withDoi === false ? `hash:${String(n)}` : `doi:${doi}`,
    ids: options.withDoi === false ? {} : { doi },
    type: "journal-article",
    title: `Work ${String(n)}`,
    authors: [{ family: "Lee", given: "A" }],
    ...(options.abstract !== undefined && { abstract: options.abstract }),
    provenance: {
      recordIds: [`crossref:${String(n)}`],
      fieldOrigin: { title: "crossref" },
      seenIn: ["crossref"],
    },
    normalizedAtEpochMs: 1,
  };
}

/** `count` works; those for which `missing(n)` holds have no abstract. */
function workSet(
  count: number,
  missing: (n: number) => boolean,
): CanonicalWork[] {
  return Array.from({ length: count }, (_, n) =>
    missing(n) ? work(n) : work(n, { abstract: `Own abstract ${String(n)}.` }),
  );
}

const countOf = (issued: readonly Issued[], host: Issued["host"]): number =>
  issued.filter((i) => i.host === host).length;

function tokenSource(): CancellationTokenSource {
  return createCancellationTokenSource();
}

// ===========================================================================
// 1. The budget — criterion 1 and docs/02 §10.4's own figure
// ===========================================================================

describe("backfillAbstracts — batched, never one lookup per record (criterion 1)", () => {
  // 200 works; every one whose index is a multiple of 10, 3 or 7 below 200
  // would be too clever — the 60 missing are simply n < 60.
  const MISSING = 60;
  const isMissing = (n: number): boolean => n < MISSING;

  it("200 works, 60 without an abstract: one Europe PMC request and one S2 batch — within ≤ 2 and ≤ 1", async () => {
    // Europe PMC holds 40 of the 60 with an abstract and 5 without one; S2
    // holds 15 of the remaining 20.
    const europepmc = new Map<string, string>();
    for (let n = 0; n < 40; n += 1)
      europepmc.set(doiOf(n), `EPMC ${String(n)}.`);
    for (let n = 40; n < 45; n += 1) europepmc.set(doiOf(n), "");
    const semanticscholar = new Map<string, string>();
    for (let n = 40; n < 55; n += 1)
      semanticscholar.set(doiOf(n), `S2 ${String(n)}.`);
    const fake = createFakeHttp({ europepmc, semanticscholar });

    const works = workSet(200, isMissing);
    const result = await backfillAbstracts(works, {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });

    expect(countOf(fake.issued, "europepmc")).toBeLessThanOrEqual(2);
    expect(countOf(fake.issued, "semanticscholar")).toBeLessThanOrEqual(1);
    expect(countOf(fake.issued, "europepmc")).toBe(1);
    expect(countOf(fake.issued, "semanticscholar")).toBe(1);
    // Only the 60 were ever asked about: no work with its own abstract leaks.
    expect(fake.issued[0]?.dois).toHaveLength(MISSING);
    expect(fake.issued[0]?.resultType).toBe("core");
    expect(result.report).toMatchObject({
      missing: MISSING,
      withoutDoi: 0,
      backfilled: 55,
    });
    expect(result.works).toHaveLength(200);
    // A work that had an abstract is the very same object.
    expect(result.works[100]).toBe(works[100]);
  });

  it("200 of 200 missing costs docs/02 §10.4's figure: 2 Europe PMC calls and 2 S2 calls, each S2 batch ≤ ~100 ids", async () => {
    const semanticscholar = new Map<string, string>();
    for (let n = 0; n < 200; n += 1)
      semanticscholar.set(doiOf(n), `S2 ${String(n)}.`);
    const fake = createFakeHttp({ europepmc: new Map(), semanticscholar });

    const result = await backfillAbstracts(
      workSet(200, () => true),
      {
        sources: ladderRegistry(fake.client),
        token: tokenSource().token,
      },
    );

    const epmc = fake.issued.filter((i) => i.host === "europepmc");
    const s2 = fake.issued.filter((i) => i.host === "semanticscholar");
    expect(epmc.map((i) => i.dois.length)).toEqual([
      EUROPEPMC_DOI_LOOKUP_BATCH,
      EUROPEPMC_DOI_LOOKUP_BATCH,
    ]);
    expect(s2.map((i) => i.dois.length)).toEqual([100, 100]);
    expect(SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT).toBe(100);
    for (const request of s2) {
      expect(request.dois.length).toBeLessThanOrEqual(
        SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT,
      );
    }
    expect(result.report.backfilled).toBe(200);
  });
});

// ===========================================================================
// 2. The ladder — order, stop at the first hit, provenance
// ===========================================================================

describe("backfillAbstracts — the ladder", () => {
  it("is docs/02 §10.4's order without step 3: Europe PMC, then Semantic Scholar", () => {
    expect(ABSTRACT_BACKFILL_LADDER).toEqual(["europepmc", "semanticscholar"]);
  });

  it("asks Europe PMC first and sends S2 only what Europe PMC did not answer (stop at the first hit)", async () => {
    const europepmc = new Map([
      [doiOf(0), "EPMC zero."],
      [doiOf(1), ""], // found, but with no abstract: stays on the ladder
    ]);
    const semanticscholar = new Map([
      [doiOf(0), "S2 zero — must never be used."],
      [doiOf(1), "S2 one."],
      [doiOf(2), "S2 two."],
    ]);
    const fake = createFakeHttp({ europepmc, semanticscholar });
    const result = await backfillAbstracts([work(0), work(1), work(2)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });

    expect(fake.issued.map((i) => i.host)).toEqual([
      "europepmc",
      "semanticscholar",
    ]);
    expect(fake.issued[1]?.dois).toEqual([doiOf(1), doiOf(2)]);
    expect(result.works.map((w) => w.abstract)).toEqual([
      "EPMC zero.",
      "S2 one.",
      "S2 two.",
    ]);
    expect(result.report.steps).toEqual([
      { sourceId: "europepmc", status: "asked", asked: 3, found: 1 },
      { sourceId: "semanticscholar", status: "asked", asked: 2, found: 2 },
    ]);
  });

  it("asks nothing further once every work is answered", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map([[doiOf(0), "S2 zero."]]),
    });
    await backfillAbstracts([work(0)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });
    expect(countOf(fake.issued, "semanticscholar")).toBe(0);
  });

  it("records the backfilling source in provenance.fieldOrigin.abstract (criterion 2) and keeps the rest of provenance", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map([[doiOf(1), "S2 one."]]),
    });
    const result = await backfillAbstracts([work(0), work(1)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });
    expect(result.works[0]?.provenance.fieldOrigin.abstract).toBe("europepmc");
    expect(result.works[1]?.provenance.fieldOrigin.abstract).toBe(
      "semanticscholar",
    );
    expect(result.works[0]?.provenance).toEqual({
      recordIds: ["crossref:0"],
      fieldOrigin: { title: "crossref", abstract: "europepmc" },
      seenIn: ["crossref"],
    });
  });

  it("does not ask about a work with no DOI, nor one that has an abstract", async () => {
    const fake = createFakeHttp({
      europepmc: new Map(),
      semanticscholar: new Map(),
    });
    const result = await backfillAbstracts(
      [work(0, { withDoi: false }), work(1, { abstract: "Own." }), work(2)],
      { sources: ladderRegistry(fake.client), token: tokenSource().token },
    );
    expect(fake.issued.flatMap((i) => i.dois)).toEqual([doiOf(2), doiOf(2)]);
    expect(result.report).toMatchObject({ missing: 2, withoutDoi: 1 });
  });

  it("makes no request at all when no ladder adapter is registered", async () => {
    const works = [work(0), work(1)];
    const result = await backfillAbstracts(works, {
      sources: createSourceRegistry(),
      token: tokenSource().token,
    });
    expect(result.works).toBe(works);
    expect(result.report.steps.map((s) => s.status)).toEqual([
      "no-adapter",
      "no-adapter",
    ]);
  });
});

// ===========================================================================
// 3. No fabrication, no failed import, cancellation, checkpoints
// ===========================================================================

describe("backfillAbstracts — only ticked databases (owner, 2026-10-15, item 194)", () => {
  it("skips a ladder step whose database the user did not tick, and sends it no DOI", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map([[doiOf(1), "S2 one."]]),
    });
    const works = workSet(3, (n) => n < 2);
    const result = await backfillAbstracts(works, {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
      selected: ["pubmed", "europepmc"],
    });
    expect(countOf(fake.issued, "semanticscholar")).toBe(0);
    expect(countOf(fake.issued, "europepmc")).toBe(1);
    expect(result.report.steps).toEqual([
      { sourceId: "europepmc", status: "asked", asked: 2, found: 1 },
      {
        sourceId: "semanticscholar",
        status: "not-selected",
        asked: 0,
        found: 0,
      },
    ]);
    expect(result.works[1]?.abstract).toBeUndefined();
  });

  it("asks nothing at all when neither ladder database is ticked", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map([[doiOf(0), "S2 zero."]]),
    });
    const result = await backfillAbstracts(
      workSet(2, () => true),
      {
        sources: ladderRegistry(fake.client),
        token: tokenSource().token,
        selected: ["pubmed"],
      },
    );
    expect(fake.issued).toEqual([]);
    expect(result.report.backfilled).toBe(0);
    expect(result.report.steps.map((step) => step.status)).toEqual([
      "not-selected",
      "not-selected",
    ]);
  });
});

describe("abstractBackfillRequestBound — the pass's worst case for the estimate (items 180 and 198)", () => {
  const BOTH: SourceId[] = ["pubmed", "europepmc", "semanticscholar"];

  it("charges one Europe PMC request and one Semantic Scholar request per 100 works", () => {
    const registry = ladderRegistry(
      createFakeHttp({ europepmc: new Map(), semanticscholar: new Map() })
        .client,
    );
    expect(abstractBackfillRequestBound(0, BOTH, registry)).toBe(0);
    expect(abstractBackfillRequestBound(1, BOTH, registry)).toBe(2);
    expect(abstractBackfillRequestBound(100, BOTH, registry)).toBe(2);
    expect(abstractBackfillRequestBound(101, BOTH, registry)).toBe(4);
    expect(abstractBackfillRequestBound(450, BOTH, registry)).toBe(10);
  });

  it("charges nothing for a ladder database the user did not tick (item 194)", () => {
    const registry = ladderRegistry(
      createFakeHttp({ europepmc: new Map(), semanticscholar: new Map() })
        .client,
    );
    expect(
      abstractBackfillRequestBound(200, ["pubmed", "europepmc"], registry),
    ).toBe(2);
    expect(
      abstractBackfillRequestBound(
        200,
        ["pubmed", "semanticscholar"],
        registry,
      ),
    ).toBe(2);
    expect(abstractBackfillRequestBound(200, ["pubmed"], registry)).toBe(0);
  });

  it("charges nothing for a ticked ladder database with no adapter, or one without lookup", () => {
    expect(
      abstractBackfillRequestBound(200, BOTH, createSourceRegistry()),
    ).toBe(0);
    const registry = ladderRegistry(
      createFakeHttp({ europepmc: new Map(), semanticscholar: new Map() })
        .client,
    );
    const noLookup = {
      get: (id: SourceId) => {
        const source = registry.get(id);
        if (source === undefined || id !== "semanticscholar") return source;
        const { lookup: _lookup, ...rest } = source;
        return rest;
      },
    };
    expect(abstractBackfillRequestBound(200, BOTH, noLookup)).toBe(2);
  });

  it("is never below what the pass actually sends, and is an upper bound when some works have abstracts", async () => {
    const all = createFakeHttp({
      europepmc: new Map(),
      semanticscholar: new Map(),
    });
    await backfillAbstracts(
      workSet(200, () => true),
      {
        sources: ladderRegistry(all.client),
        token: tokenSource().token,
        selected: BOTH,
      },
    );
    const bound = abstractBackfillRequestBound(
      200,
      BOTH,
      ladderRegistry(all.client),
    );
    expect(all.issued.length).toBe(4);
    expect(bound).toBe(4);

    const some = createFakeHttp({
      europepmc: new Map(),
      semanticscholar: new Map(),
    });
    await backfillAbstracts(
      workSet(200, (n) => n < 60),
      {
        sources: ladderRegistry(some.client),
        token: tokenSource().token,
        selected: BOTH,
      },
    );
    expect(some.issued.length).toBe(2);
    expect(some.issued.length).toBeLessThan(bound);
  });
});

describe("backfillAbstracts — a backfilled work is restamped (owner, 2026-10-19, item 198)", () => {
  it("stamps docs/07 §5.1's normalizedAtEpochMs on the works it changed, read once after the last step, and on no other", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map(),
    });
    // 0: answered by Europe PMC; 1: asked, not answered; 2: has its own.
    const works = workSet(3, (n) => n < 2);
    let reads = 0;
    const result = await backfillAbstracts(works, {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
      now: () => {
        reads += 1;
        return 5_000 + reads;
      },
    });
    expect(result.works[0]?.abstract).toBe("EPMC zero.");
    expect(result.works[0]?.normalizedAtEpochMs).toBe(5_001);
    expect(reads).toBe(1);
    expect(result.works[1]).toBe(works[1]);
    expect(result.works[1]?.normalizedAtEpochMs).toBe(1);
    expect(result.works[2]).toBe(works[2]);
  });

  it("reads no clock when nothing was backfilled", async () => {
    const fake = createFakeHttp({
      europepmc: new Map(),
      semanticscholar: new Map(),
    });
    let reads = 0;
    const works = workSet(2, () => true);
    const result = await backfillAbstracts(works, {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
      now: () => {
        reads += 1;
        return 9_999;
      },
    });
    expect(reads).toBe(0);
    expect(result.works).toBe(works);
  });
});

describe("backfillAbstracts — what it never does", () => {
  it("never fabricates an abstract: a work no step answers keeps none, and no fieldOrigin.abstract", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), ""]]),
      semanticscholar: new Map([[doiOf(0), ""]]),
    });
    const result = await backfillAbstracts([work(0), work(1)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });
    for (const w of result.works) {
      expect(w.abstract).toBeUndefined();
      expect(w.provenance.fieldOrigin.abstract).toBeUndefined();
    }
    expect(result.report.backfilled).toBe(0);
  });

  it("turns a failed step into a warning and still asks the next step for every work", async () => {
    const fake = createFakeHttp(
      {
        europepmc: new Map([[doiOf(0), "never read"]]),
        semanticscholar: new Map([[doiOf(0), "S2 zero."]]),
      },
      { europePmcBody: "<html>not json" },
    );
    const result = await backfillAbstracts([work(0), work(1)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
    });
    expect(result.warnings).toEqual([
      "europepmc: could not backfill abstracts (PARSE).",
    ]);
    expect(fake.issued[1]?.dois).toEqual([doiOf(0), doiOf(1)]);
    expect(result.works[0]?.abstract).toBe("S2 zero.");
    expect(result.report.steps[0]).toMatchObject({
      sourceId: "europepmc",
      status: "failed",
    });
  });

  it("propagates cancellation between steps, and S2 is never asked", async () => {
    const cts = tokenSource();
    const fake = createFakeHttp(
      {
        europepmc: new Map([[doiOf(0), "EPMC zero."]]),
        semanticscholar: new Map([[doiOf(1), "S2 one."]]),
      },
      { onEuropePmc: () => cts.cancel({ kind: "user" }) },
    );
    const works = [work(0), work(1)];
    await expect(
      backfillAbstracts(works, {
        sources: ladderRegistry(fake.client),
        token: cts.token,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(countOf(fake.issued, "semanticscholar")).toBe(0);
    // The caller's works are untouched: nothing was mutated in place.
    expect(works[0]?.abstract).toBeUndefined();
  });

  it("writes a checkpoint after every step it ran", async () => {
    const fake = createFakeHttp({
      europepmc: new Map(),
      semanticscholar: new Map([[doiOf(0), "S2 zero."]]),
    });
    const checkpoints: unknown[] = [];
    await backfillAbstracts([work(0), work(1)], {
      sources: ladderRegistry(fake.client),
      token: tokenSource().token,
      checkpoint: (state) => {
        checkpoints.push(state);
        return Promise.resolve();
      },
    });
    expect(checkpoints).toEqual([
      { stage: "backfillingAbstracts", step: "europepmc", remaining: 2 },
      { stage: "backfillingAbstracts", step: "semanticscholar", remaining: 1 },
    ]);
  });
});

// ===========================================================================
// 4. Through the pipeline — the stage, the summary, cancellation
// ===========================================================================

/** A source that yields `records` once, for the `Fetching` stage. */
function fetchSource(
  id: SourceId,
  records: readonly SourceRecord[],
): LiteratureSource {
  return {
    id,
    displayNameKey: `research-helper-source-${id}`,
    rateLimitKey: `${id}.example.org`,
    capabilities: {
      keywordSearch: true,
      query: { or: true, not: true, phrase: true, fields: [] },
      relatedByWork: false,
      lookupById: [],
      abstractsInSearch: true,
      citationGraph: false,
      dateFilter: true,
      filters: { languages: false, openAccess: false },
      maxPageSize: 200,
      maxTotalResults: undefined,
      benefitsFromApiKey: false,
    },
    isConfigured: () => true,
    healthCheck: () =>
      Promise.resolve({ ok: true, messageKey: "ok", latencyMs: 0 }),
    search: () =>
      Promise.resolve({
        records: [],
        totalAvailable: undefined,
        nextCursor: undefined,
        warnings: [],
      }),
    async *searchAll(_query, ctx: SourceCallContext) {
      for (const record of records) {
        ctx.token.throwIfCancelled();
        await Promise.resolve();
        yield record;
      }
    },
    explainQuery: () => id,
  };
}

/** A PubMed record per synthetic work: same DOI, title and abstract. */
function recordOf(n: number, withAbstract: boolean): SourceRecord {
  const w = withAbstract
    ? work(n, { abstract: `Own abstract ${String(n)}.` })
    : work(n);
  return {
    id: `pubmed:${String(n)}`,
    sourceId: "pubmed",
    nativeId: String(n),
    work: {
      ids: w.ids,
      type: w.type,
      title: w.title,
      authors: w.authors,
      ...(w.abstract !== undefined && { abstract: w.abstract }),
    },
    retrievedAtEpochMs: 1,
    missingFields: [],
  };
}

/** A writer that counts what it wrote, as the real one does for `R-17`. */
function countingWriter(): {
  readonly writer: SearchImportWriter;
  readonly written: CanonicalWork[];
} {
  const written: CanonicalWork[] = [];
  return {
    written,
    writer: {
      openTarget: () =>
        Promise.resolve({
          libraryId: 1,
          collectionKey: "KEY",
          collectionCreated: true,
          writeBatch: (works): Promise<SearchImportBatchResult> => {
            written.push(...works);
            return Promise.resolve({
              created: works.length,
              linkedExisting: 0,
              skipped: 0,
              failed: 0,
              createdWithAbstract: works.filter(
                (w) => w.abstract !== undefined && w.abstract !== "",
              ).length,
            });
          },
          notePartialImport: () => Promise.resolve(),
        }),
    },
  };
}

function pipelineRun(options: {
  readonly records: readonly SourceRecord[];
  readonly client: HttpClient;
  readonly cts?: CancellationTokenSource;
}) {
  const clock = createManualClock(1_000);
  const cts = options.cts ?? tokenSource();
  const registry = ladderRegistry(options.client, { silentSearch: true });
  registry.register(fetchSource("pubmed", options.records));
  const writer = countingWriter();
  const pipeline = createSearchImportPipeline({
    writer: writer.writer,
    writeBatchSize: 50,
    pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
  });
  const ctx: PipelineContext = {
    jobId: "p2t12",
    token: cts.token,
    progress: new CompositeProgressReporter({
      clock,
      throttleMs: 0,
      token: cts.token,
    }),
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    clock,
    sources: registry,
    cache: undefined,
    budget: undefined,
    llm: undefined,
    tts: undefined,
    zotero: undefined,
    config: undefined,
    privacy: undefined,
    checkpoint: () => Promise.resolve(),
    resumeState: undefined,
  };
  return { pipeline, ctx, writer };
}

describe("the BackfillingAbstracts stage of searchImport (P2-T12)", () => {
  // The two ladder databases are ticked: the pass asks only ticked ones
  // (owner, 2026-10-15, `plan/00` §6 item 194).
  const INPUT = {
    query: "crispr",
    sourceIds: ["pubmed", "europepmc", "semanticscholar"] as SourceId[],
    limit: 200,
    dateFilter: "none" as const,
    target: { collectionName: "P2-T12" },
  };

  it("imports 200 records with 60 missing through ≤ 2 Europe PMC and ≤ 1 S2 requests, and the summary reports the coverage", async () => {
    const europepmc = new Map<string, string>();
    for (let n = 0; n < 40; n += 1)
      europepmc.set(doiOf(n), `EPMC ${String(n)}.`);
    const semanticscholar = new Map<string, string>();
    for (let n = 40; n < 50; n += 1)
      semanticscholar.set(doiOf(n), `S2 ${String(n)}.`);
    const fake = createFakeHttp({ europepmc, semanticscholar });
    const records = Array.from({ length: 200 }, (_, n) => recordOf(n, n >= 60));
    const run = pipelineRun({ records, client: fake.client });

    const out = await run.pipeline.run(INPUT, run.ctx);

    expect(out.outcome).toBe("succeeded");
    expect(countOf(fake.issued, "europepmc")).toBeLessThanOrEqual(2);
    expect(countOf(fake.issued, "semanticscholar")).toBeLessThanOrEqual(1);
    expect(out.works.filter((w) => w.abstract === undefined)).toHaveLength(10);
    const backfilled = out.works.find((w) => w.ids.doi === doiOf(0));
    expect(backfilled?.provenance.fieldOrigin.abstract).toBe("europepmc");
    // R-17: 190 of 200 created items carry an abstract → 95 %.
    expect(out.write?.created).toBe(200);
    expect(out.write?.abstractCoveragePercent).toBe(95);
  });

  it("a cancel during the pass ends Cancelled, not Failed, with the merged works intact and nothing written", async () => {
    const cts = tokenSource();
    const fake = createFakeHttp(
      {
        europepmc: new Map([[doiOf(0), "EPMC zero."]]),
        semanticscholar: new Map([[doiOf(1), "S2 one."]]),
      },
      { onEuropePmc: () => cts.cancel({ kind: "user" }) },
    );
    const run = pipelineRun({
      records: [recordOf(0, false), recordOf(1, false), recordOf(2, true)],
      client: fake.client,
      cts,
    });

    const out = await run.pipeline.run(INPUT, run.ctx);

    expect(out.outcome).toBe("cancelled");
    expect(out.error).toBeUndefined();
    expect(out.stageReached).toBe("backfillingAbstracts");
    expect(out.works.map((w) => w.ids.doi)).toEqual([
      doiOf(0),
      doiOf(1),
      doiOf(2),
    ]);
    expect(out.works.map((w) => w.abstract)).toEqual([
      undefined,
      undefined,
      "Own abstract 2.",
    ]);
    expect(out.write).toBeUndefined();
    expect(run.writer.written).toHaveLength(0);
  });

  it("a failed backfill does not fail the import: the run succeeds, warns, and writes every work", async () => {
    const fake = createFakeHttp(
      { europepmc: new Map(), semanticscholar: new Map() },
      { europePmcBody: "not json" },
    );
    const run = pipelineRun({
      records: [recordOf(0, false), recordOf(1, true)],
      client: fake.client,
    });

    const out = await run.pipeline.run(INPUT, run.ctx);

    expect(out.outcome).toBe("succeeded");
    expect(out.warnings).toContain(
      "europepmc: could not backfill abstracts (PARSE).",
    );
    expect(out.write?.created).toBe(2);
    expect(out.write?.abstractCoveragePercent).toBe(50);
  });

  it("a run that ticks only PubMed sends the backfill ladder nothing (item 194)", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map([[doiOf(0), "S2 zero."]]),
    });
    const run = pipelineRun({
      records: [recordOf(0, false), recordOf(1, true)],
      client: fake.client,
    });
    const out = await run.pipeline.run(
      { ...INPUT, sourceIds: ["pubmed"] as SourceId[] },
      run.ctx,
    );
    expect(out.outcome).toBe("succeeded");
    expect(fake.issued).toEqual([]);
    expect(out.works[0]?.abstract).toBeUndefined();
    expect(out.write?.abstractCoveragePercent).toBe(50);
  });

  it("does not run again on the import of a preview's own works (P2-T31)", async () => {
    const fake = createFakeHttp({
      europepmc: new Map([[doiOf(0), "EPMC zero."]]),
      semanticscholar: new Map(),
    });
    const preview = pipelineRun({
      records: [recordOf(0, false), recordOf(1, false)],
      client: fake.client,
    });
    const { target: _target, ...previewInput } = INPUT;
    const previewed = await preview.pipeline.run(previewInput, preview.ctx);
    const asked = fake.issued.length;
    expect(asked).toBe(2);
    expect(previewed.works[0]?.abstract).toBe("EPMC zero.");

    const imported = await preview.pipeline.run(
      {
        ...INPUT,
        records: previewed.records,
        works: previewed.works,
      },
      preview.ctx,
    );
    expect(imported.outcome).toBe("succeeded");
    expect(fake.issued.length).toBe(asked);
    expect(imported.write?.abstractCoveragePercent).toBe(50);
  });
});

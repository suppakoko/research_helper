import { describe, expect, it } from "vitest";

import { createManualClock, type Clock } from "../../../src/core/clock";
import { createMemoryPrefStore } from "../../../src/core/config";
import {
  OperationCancelledError,
  ParseError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { ProgressReporter } from "../../../src/core/jobQueue/progress";
import type { Logger } from "../../../src/core/logger";
import {
  createHostLimiterRegistry,
  NCBI_HOST,
  NCBI_KEY_PRESENT_PREF,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  buildEfetchRequest,
  createPubmedSource,
  EFETCH_MAX_GET_URL_LENGTH,
  EFETCH_MAX_IDS_PER_CALL,
  NCBI_SECRET_ID,
  parseEsearchBody,
  PUBMED_CAPABILITIES,
  PUBMED_DISPLAY_NAME_KEY,
  PUBMED_EFETCH_BASE_URL,
  PUBMED_MAX_TOTAL_RESULTS,
  PUBMED_RETMAX_MAX,
  PUBMED_RETSTART_MAX,
  PUBMED_TRUNCATION_WARNING,
  type PubmedSource,
  type PubmedSourceDeps,
} from "../../../src/sources/pubmed/pubmedSource";
import {
  explainPubmedQuery,
  PUBMED_ESEARCH_BASE_URL,
  PUBMED_FILTERS,
} from "../../../src/sources/pubmed/query";
import { parseUserQuery } from "../../../src/sources/shared/queryParse";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type {
  SourceCallContext,
  SourceQuery,
} from "../../../src/sources/types";

/**
 * `P1-T09`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network** —
 * every request below is served by a stub transport that records what it was
 * asked for, and nothing in this file issues a live E-utilities call.
 *
 * **What these assertions are written against.** An adapter test is easy to make
 * vacuous by asserting the shape of a request the test itself built, so each
 * section below pins something that would break against the *real* service:
 *
 * - the `esearch` parameter **set and order** `P1-T08` commits to, and that
 *   `tool` / `email` appear exactly once (an "append" implementation would
 *   duplicate them and reorder the rest — the contradiction the card's step 2
 *   records as corrected on 2026-09-30);
 * - that no issued URL ever carries `retstart` above `docs/02` §3.3's measured
 *   9998 ceiling, whatever the caller asked for;
 * - that the PMIDs reaching `efetch` are **the ones `esearch` returned**: the
 *   stub `efetch` echoes the id list it was given and the stub mapper turns that
 *   echo into records, so a hard-coded or reordered list fails;
 * - that a failure in the second step propagates instead of returning the first
 *   step's identifiers dressed as records.
 *
 * **`vitest` globals are not used** — every symbol is imported, which is what
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** One request the adapter issued. */
interface Issued {
  readonly method: HttpMethod;
  readonly url: string;
  readonly options: HttpOptions | undefined;
}

/** A transport that records every call and answers from `handler`. */
function createStubHttp(
  handler: (issued: Issued, index: number) => HttpResponse,
): { readonly client: HttpClient; readonly issued: Issued[] } {
  const issued: Issued[] = [];
  const client: HttpClient = {
    request(method, url, options) {
      const call: Issued = { method, url, options };
      issued.push(call);
      return Promise.resolve(handler(call, issued.length - 1));
    },
  };
  return { client, issued };
}

/** A response with a case-insensitive header lookup, as `P1-T05` returns. */
function response(
  url: string,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status: 200,
    url,
    body,
    rawHeaders: Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n"),
    header: (name) => byName.get(name.toLowerCase()),
  };
}

/** `docs/02` §3.3's real `esearch` envelope, with the parts a test varies. */
function esearchBody(fields: Record<string, unknown>): string {
  return JSON.stringify({
    header: { type: "esearch", version: "0.3" },
    esearchresult: fields,
  });
}

/** `n` distinct 8-digit PMIDs — the width `docs/02` §3.4's examples have. */
function pmids(n: number, base = 42_700_000): readonly string[] {
  return Array.from({ length: n }, (_, i) => String(base + i * 7));
}

/**
 * The stub `efetch` body: the id list it was asked for, echoed.
 *
 * This is what makes "the adapter passes on the identifiers it actually
 * received" testable without a real XML fixture — `P1-T10` owns the XML, and
 * this card owns only the hand-off.
 */
function efetchEcho(issued: Issued): string {
  return `IDS:${idsOf(issued).join(",")}`;
}

/** The `id=` list of an issued `efetch`, from the URL or from the POST body. */
function idsOf(issued: Issued): readonly string[] {
  const raw = paramsOf(issued).get("id");
  return raw === null || raw === "" ? [] : raw.split(",");
}

/** Every parameter of an issued request, wherever it travelled. */
function paramsOf(issued: Issued): URLSearchParams {
  const queryStart = issued.url.indexOf("?");
  const fromUrl = queryStart === -1 ? "" : issued.url.slice(queryStart + 1);
  const body = issued.options?.body;
  return new URLSearchParams(body === undefined ? fromUrl : body);
}

/** The parameter *names*, in the order they were transmitted. */
function paramNames(issued: Issued): readonly string[] {
  return [...paramsOf(issued).keys()];
}

/** The mapper half of `P1-T10`, stubbed: one record per echoed PMID. */
function echoMapper(xml: string): readonly SourceRecord[] {
  const list = xml.startsWith("IDS:") ? xml.slice(4) : "";
  if (list === "") return [];
  return list.split(",").map((pmid) => record(pmid));
}

/** A `SourceRecord` with just enough filled in to be one. */
function record(pmid: string): SourceRecord {
  return {
    id: `pubmed:${pmid}`,
    sourceId: "pubmed",
    nativeId: pmid,
    work: {
      title: `Paper ${pmid}`,
      authors: [],
      ids: {},
      type: "journal-article",
    },
    retrievedAtEpochMs: 1_700_000_000_000,
    missingFields: [],
  };
}

/** A recording logger, so "no line carries the key" is checkable. */
function createSpyLogger(): {
  readonly logger: Logger;
  readonly lines: string[];
} {
  const lines: string[] = [];
  const log =
    (level: string) => (msg: string, ctx?: Record<string, unknown>) => {
      lines.push(`${level} ${msg} ${JSON.stringify(ctx ?? {})}`);
    };
  const logger: Logger = {
    child: () => logger,
    error: log("error"),
    warn: log("warn"),
    info: log("info"),
    debug: log("debug"),
    time: (_msg, fn) => fn(),
  };
  return { logger, lines };
}

/** A progress reporter that records what it was told. */
function createSpyProgress(): {
  readonly progress: ProgressReporter;
  readonly steps: readonly (readonly [number, number | undefined])[];
  readonly warnings: string[];
} {
  const steps: [number, number | undefined][] = [];
  const warnings: string[] = [];
  const progress: ProgressReporter = {
    setMessage: () => undefined,
    setProgress: (completed, total) => steps.push([completed, total]),
    increment: () => undefined,
    child: () => progress,
    warn: (message) => warnings.push(message),
    done: () => undefined,
  };
  return { progress, steps, warnings };
}

/** A `SecretStore` holding one value for `source.ncbi`. */
function createStubSecrets(
  value: string | undefined,
  options: { readonly throws?: boolean } = {},
): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get: (id: SecretId) => {
      if (options.throws === true) return Promise.reject(new Error("locked"));
      return Promise.resolve(id === NCBI_SECRET_ID ? value : undefined);
    },
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: (id) => Promise.resolve(id === NCBI_SECRET_ID && value !== undefined),
    listStoredIds: () => Promise.resolve([NCBI_SECRET_ID]),
  };
}

const CLOCK_2026_09_09: Clock = {
  now: () => new Date(2026, 8, 9, 12, 0, 0).getTime(),
  sleep: () => Promise.resolve(),
};

const WINDOW = recencyWindow(3, CLOCK_2026_09_09);

/** A normalized query with the shipped three-calendar-year window. */
function query(limit: number, cursor?: string): SourceQuery {
  return {
    terms: parseUserQuery("CRISPR base editing"),
    fromDate: WINDOW.fromDate,
    toDate: WINDOW.toDate,
    limit,
    ...(cursor !== undefined && { cursor }),
  };
}

/** A call context with a live token and no progress reporter. */
function context(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

/** Build the adapter over a stub transport. */
function source(
  handler: (issued: Issued, index: number) => HttpResponse,
  extra: Partial<PubmedSourceDeps> = {},
): { readonly pubmed: PubmedSource; readonly issued: Issued[] } {
  const { client, issued } = createStubHttp(handler);
  return {
    pubmed: createPubmedSource({
      http: client,
      clock: CLOCK_2026_09_09,
      mapRecords: echoMapper,
      ...extra,
    }),
    issued,
  };
}

/**
 * The common two-step stub: one `esearch` returning `ids`, then `efetch` echoes.
 *
 * `index === 0` is the `esearch` because `search()` issues it first and the
 * `efetch` batches follow; an implementation that reversed them would read the
 * echo as JSON and fail in `parseEsearchBody`.
 */
function twoStep(
  ids: readonly string[],
  result: Record<string, unknown> = {},
): (issued: Issued, index: number) => HttpResponse {
  return (issued, index) =>
    index === 0
      ? response(
          issued.url,
          esearchBody({
            count: String(ids.length),
            retmax: String(ids.length),
            retstart: "0",
            idlist: [...ids],
            ...result,
          }),
        )
      : response(issued.url, efetchEcho(issued));
}

// ---------------------------------------------------------------------------
// 1. Identity and capabilities — step 1
// ---------------------------------------------------------------------------

describe("PubMed adapter identity", () => {
  it("reports the id, the Fluent name key and the §7.3 limiter host", () => {
    const { pubmed } = source(twoStep([]));

    expect(pubmed.id).toBe("pubmed");
    expect(pubmed.rateLimitKey).toBe(NCBI_HOST);
    expect(pubmed.rateLimitKey).toBe("eutils.ncbi.nlm.nih.gov");
    // The adapter spells the id as a literal because `sources/` importing
    // `i18n/` would invent a layer edge; a test file may compare the copies.
    expect([...MAIN_WINDOW_MESSAGE_IDS]).toContain(PUBMED_DISPLAY_NAME_KEY);
    expect(pubmed.displayNameKey).toBe(PUBMED_DISPLAY_NAME_KEY);
  });

  it("is always configured, because docs/02 §3.1 makes the key optional", () => {
    const { pubmed } = source(twoStep([]));
    expect(pubmed.isConfigured()).toBe(true);
  });

  it("fills capabilities honestly, including the 9999 ceiling", () => {
    expect(PUBMED_CAPABILITIES.maxTotalResults).toBe(9999);
    expect(PUBMED_CAPABILITIES.abstractsInSearch).toBe(false);
    expect(PUBMED_CAPABILITIES.benefitsFromApiKey).toBe(true);
    expect(PUBMED_CAPABILITIES.keywordSearch).toBe(true);
    expect(PUBMED_CAPABILITIES.dateFilter).toBe(true);
    expect(PUBMED_CAPABILITIES.maxPageSize).toBe(PUBMED_RETMAX_MAX);

    // No `elink`, no `esummary`, no PMC ID Converter in this card, so nothing
    // claims relatedness, citations or id lookup.
    expect(PUBMED_CAPABILITIES.relatedByWork).toBe(false);
    expect(PUBMED_CAPABILITIES.citationGraph).toBe(false);
    expect(PUBMED_CAPABILITIES.lookupById).toStrictEqual([]);

    const { pubmed } = source(twoStep([]));
    expect(pubmed.findRelated).toBeUndefined();
    expect(pubmed.lookup).toBeUndefined();
    expect(pubmed.fetchAbstract).toBeUndefined();
  });

  it("P2-T34: capabilities.filters is the renderer's own object, and equals what the renderer does", () => {
    expect(PUBMED_CAPABILITIES.filters).toBe(PUBMED_FILTERS);
    expect(PUBMED_CAPABILITIES.filters).toEqual({
      languages: true,
      openAccess: true,
    });
    const { pubmed } = source(twoStep([]));
    const plain = query(10);
    // Both true → both rendered into the term, so the preview changes.
    const languages = pubmed.explainQuery({ ...plain, languages: ["en"] });
    expect(languages).not.toBe(pubmed.explainQuery(plain));
    expect(languages).toContain("eng[la]");
    const open = pubmed.explainQuery({ ...plain, openAccessOnly: true });
    expect(open).not.toBe(pubmed.explainQuery(plain));
    expect(open).toContain("free full text[sb]");
  });

  it("derives the ceiling from the offset, rather than stating two numbers", () => {
    // `docs/02` §3.3: offsets 0 … 9998 inclusive, so 9999 records.
    expect(PUBMED_MAX_TOTAL_RESULTS).toBe(PUBMED_RETSTART_MAX + 1);
  });

  it("delegates explainQuery to P1-T08", () => {
    const { pubmed } = source(twoStep([]));
    const q = query(10);
    expect(pubmed.explainQuery(q)).toBe(explainPubmedQuery(q));
    expect(pubmed.explainQuery(q)).toContain("[EDAT]");
  });
});

// ---------------------------------------------------------------------------
// 2. The esearch request — step 2, and its 2026-09-30 correction
// ---------------------------------------------------------------------------

describe("the esearch request", () => {
  it("passes its parameters in, keeping P1-T08's whole ordered set", async () => {
    const { pubmed, issued } = source(twoStep(pmids(2)));
    await pubmed.search(query(25), context());

    const esearch = issued[0];
    if (esearch === undefined) throw new Error("no esearch was issued");
    expect(esearch.method).toBe("GET");
    expect(esearch.url.startsWith(`${PUBMED_ESEARCH_BASE_URL}?`)).toBe(true);
    // `P1-T08` step 5 owns the whole ordered string; this card supplies values.
    expect(paramNames(esearch)).toStrictEqual([
      "db",
      "term",
      "retmode",
      "retmax",
      "retstart",
      "datetype",
      "mindate",
      "maxdate",
      "tool",
      "email",
    ]);
    const params = paramsOf(esearch);
    expect(params.get("db")).toBe("pubmed");
    expect(params.get("retmode")).toBe("json");
    expect(params.get("retmax")).toBe("25");
    expect(params.get("retstart")).toBe("0");
    expect(params.get("datetype")).toBe("edat");
  });

  it("does not append a second tool/email pair", async () => {
    // The step-2 correction: appending would put D10's identity pair in the
    // string twice and move it behind the rest.
    const { pubmed, issued } = source(twoStep(pmids(1)));
    await pubmed.search(query(5), context());

    for (const call of issued) {
      expect(paramsOf(call).getAll("tool")).toHaveLength(1);
      expect(paramsOf(call).getAll("email")).toHaveLength(1);
    }
  });

  it("asks for responseType text, because body is empty for any other", async () => {
    const { pubmed, issued } = source(twoStep(pmids(1)));
    await pubmed.search(query(5), context());

    for (const call of issued) {
      expect(call.options?.responseType).toBe("text");
    }
  });

  it("hands the cancellation token to the transport", async () => {
    const source_ = createCancellationTokenSource();
    const { pubmed, issued } = source(twoStep(pmids(1)));
    await pubmed.search(query(5), { token: source_.token });

    for (const call of issued) expect(call.options?.token).toBe(source_.token);
  });
});

// ---------------------------------------------------------------------------
// 3. tool / email on every request — criterion 4
// ---------------------------------------------------------------------------

describe("D10 identification", () => {
  it("carries tool=research_helper and the maintainer email on every request", async () => {
    // 250 PMIDs forces both a GET `esearch` and two `efetch` calls, the second
    // of which is a POST — so this covers both transport shapes.
    const ids = pmids(250);
    const { pubmed, issued } = source(twoStep(ids));
    await pubmed.search(query(250), context());

    expect(issued.length).toBe(3);
    for (const call of issued) {
      const params = paramsOf(call);
      expect(params.get("tool")).toBe("research_helper");
      expect(params.get("email")).toBe("suppakoko@gmail.com");
    }
  });

  it("puts them in the POST body when the URL would exceed ~2000 chars", async () => {
    // Criterion 4 says "every issued URL"; a POST has no parameters in its URL
    // at all, so the obligation `docs/02` §3.1 actually states — "on **every**
    // request" — is what is asserted here. Reported with the card.
    const built = buildEfetchRequest(pmids(EFETCH_MAX_IDS_PER_CALL));
    expect(built.method).toBe("POST");
    expect(built.url).toBe(PUBMED_EFETCH_BASE_URL);
    expect(built.url.includes("tool=")).toBe(false);
    expect(built.body ?? "").toContain("tool=research_helper");
    expect(built.body ?? "").toContain("email=suppakoko%40gmail.com");
  });
});

// ---------------------------------------------------------------------------
// 4. The 9998 ceiling — step 4, criterion 2, and the Do NOT
// ---------------------------------------------------------------------------

describe("the retstart ceiling", () => {
  it("stops a limit of 12 000 at the ceiling and warns that it truncated", async () => {
    const ids = pmids(3);
    const { pubmed, issued } = source(
      twoStep(ids, { count: "12345", retmax: "9999" }),
    );
    const page = await pubmed.search(query(12_000), context());

    const esearch = issued[0];
    if (esearch === undefined) throw new Error("no esearch was issued");
    expect(paramsOf(esearch).get("retmax")).toBe("9999");
    expect(paramsOf(esearch).get("retstart")).toBe("0");
    expect(page.warnings).toContain(PUBMED_TRUNCATION_WARNING);
    // The warning has to say what happened, not merely exist.
    expect(PUBMED_TRUNCATION_WARNING).toMatch(/truncat/iu);
    expect(PUBMED_TRUNCATION_WARNING).toContain("9999");
    expect(PUBMED_TRUNCATION_WARNING).toContain("9998");
    expect(page.records).toHaveLength(3);
  });

  it("clamps a cursor past 9998 and never transmits a larger retstart", async () => {
    const { pubmed, issued } = source(twoStep(pmids(1), { count: "40000" }));
    const page = await pubmed.search(query(100, "12000"), context());

    const esearch = issued[0];
    if (esearch === undefined) throw new Error("no esearch was issued");
    expect(paramsOf(esearch).get("retstart")).toBe(String(PUBMED_RETSTART_MAX));
    // retstart 9998 leaves exactly one reachable record.
    expect(paramsOf(esearch).get("retmax")).toBe("1");
    expect(page.warnings).toContain(PUBMED_TRUNCATION_WARNING);
    expect(page.nextCursor).toBeUndefined();
  });

  it("warns when the result set is larger than PubMed will page through", async () => {
    const { pubmed } = source(twoStep(pmids(5), { count: "10000" }));
    const page = await pubmed.search(query(5), context());

    expect(page.totalAvailable).toBe(10_000);
    expect(page.warnings).toContain(PUBMED_TRUNCATION_WARNING);
  });

  it("does not warn on a result set that fits", async () => {
    const { pubmed } = source(twoStep(pmids(5), { count: "5" }));
    const page = await pubmed.search(query(20), context());

    expect(page.warnings).toStrictEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("takes no more identifiers than it asked for", async () => {
    // A server that over-delivers must not be able to walk the adapter past the
    // ceiling by the back door. Found by the searchAll assertion below.
    const { pubmed } = source(twoStep(pmids(30), { count: "30" }));
    const page = await pubmed.search(query(10), context());

    expect(page.records.map((r) => r.nativeId)).toStrictEqual([
      ...pmids(30).slice(0, 10),
    ]);
    expect(page.nextCursor).toBe("10");
  });

  it("never lets searchAll page past the ceiling", async () => {
    // A 40 000-hit query asked for 12 000 records: every issued `retstart` must
    // stay at or below 9998, and the iteration must end rather than loop.
    const page = pmids(EFETCH_MAX_IDS_PER_CALL);
    const { pubmed, issued } = source((issued_, index) =>
      index % 2 === 0
        ? response(
            issued_.url,
            esearchBody({
              count: "40000",
              idlist: [...page],
              retstart: paramsOf(issued_).get("retstart") ?? "0",
            }),
          )
        : response(issued_.url, efetchEcho(issued_)),
    );

    let seen = 0;
    for await (const _record of pubmed.searchAll(query(12_000), context())) {
      seen += 1;
      if (seen > PUBMED_MAX_TOTAL_RESULTS) throw new Error("ran past ceiling");
    }

    const starts = issued
      .filter((call) => call.url.startsWith(PUBMED_ESEARCH_BASE_URL))
      .map((call) => Number(paramsOf(call).get("retstart")));
    expect(starts.length).toBeGreaterThan(1);
    for (const start of starts) {
      expect(start).toBeLessThanOrEqual(PUBMED_RETSTART_MAX);
    }
    expect(seen).toBe(PUBMED_MAX_TOTAL_RESULTS);
  });
});

// ---------------------------------------------------------------------------
// 5. The esearch → efetch hand-off — step 6, criterion 3
// ---------------------------------------------------------------------------

describe("the efetch batches", () => {
  it("issues exactly two efetch calls for a 250-PMID result set", async () => {
    const ids = pmids(250);
    const { pubmed, issued } = source(twoStep(ids));
    const page = await pubmed.search(query(250), context());

    const efetches = issued.filter((call) =>
      call.url.startsWith(PUBMED_EFETCH_BASE_URL),
    );
    expect(efetches).toHaveLength(2);
    expect(idsOf(must(efetches[0]))).toHaveLength(EFETCH_MAX_IDS_PER_CALL);
    expect(idsOf(must(efetches[1]))).toHaveLength(50);
    expect(page.records).toHaveLength(250);
  });

  it("sends the identifiers esearch returned, in order, and nothing else", async () => {
    const ids = pmids(250, 31_415_926);
    const { pubmed, issued } = source(twoStep(ids));
    const page = await pubmed.search(query(250), context());

    const sent = issued
      .filter((call) => call.url.startsWith(PUBMED_EFETCH_BASE_URL))
      .flatMap((call) => [...idsOf(call)]);
    expect(sent).toStrictEqual([...ids]);
    // And the records came back from those ids rather than from a fixture.
    expect(page.records.map((r) => r.nativeId)).toStrictEqual([...ids]);
  });

  it("asks for retmode=xml and rettype=abstract, never retmode=json", async () => {
    const { pubmed, issued } = source(twoStep(pmids(3)));
    await pubmed.search(query(3), context());

    for (const call of issued.filter((c) =>
      c.url.startsWith(PUBMED_EFETCH_BASE_URL),
    )) {
      expect(paramsOf(call).get("retmode")).toBe("xml");
      expect(paramsOf(call).get("rettype")).toBe("abstract");
    }
  });

  it("issues no efetch at all for an empty result set", async () => {
    const { pubmed, issued } = source(twoStep([], { count: "0" }));
    const page = await pubmed.search(query(20), context());

    expect(issued).toHaveLength(1);
    expect(page.records).toStrictEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
  });

  it("switches to POST only once the GET URL would pass ~2000 characters", () => {
    const small = buildEfetchRequest(pmids(5));
    expect(small.method).toBe("GET");
    expect(small.body).toBeUndefined();
    expect(small.url.length).toBeLessThanOrEqual(EFETCH_MAX_GET_URL_LENGTH);

    const big = buildEfetchRequest(pmids(EFETCH_MAX_IDS_PER_CALL));
    expect(big.method).toBe("POST");
    expect(
      `${PUBMED_EFETCH_BASE_URL}?${big.body ?? ""}`.length,
    ).toBeGreaterThan(EFETCH_MAX_GET_URL_LENGTH);
    expect(
      (new URLSearchParams(big.body ?? "").get("id") ?? "").split(","),
    ).toHaveLength(EFETCH_MAX_IDS_PER_CALL);
  });

  it("sets the form content type on the POST", async () => {
    const { pubmed, issued } = source(twoStep(pmids(250)));
    await pubmed.search(query(250), context());

    const post = issued.find((call) => call.method === "POST");
    if (post === undefined) throw new Error("no POST was issued");
    expect(post.options?.headers?.["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("keeps the efetch parameter order stable, for docs/13 §2.2 fixture keys", () => {
    const keyed = buildEfetchRequest(
      pmids(3),
      "0123456789abcdef0123456789abcdef",
    );
    expect(
      paramNames({ method: "GET", url: keyed.url, options: undefined }),
    ).toStrictEqual([
      "db",
      "id",
      "retmode",
      "rettype",
      "api_key",
      "tool",
      "email",
    ]);
  });

  it("refuses a batch docs/02 §3.4 does not allow", () => {
    expect(() => buildEfetchRequest([])).toThrow(RangeError);
    expect(() => buildEfetchRequest(pmids(201))).toThrow(RangeError);
    expect(() => buildEfetchRequest(pmids(200))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. The errors PubMed hides inside HTTP 200 — step 3, criterion 1
// ---------------------------------------------------------------------------

describe("esearchresult.ERROR", () => {
  const UPSTREAM =
    "Search Backend failed: Exception:\n'retstart' cannot be larger than 9998.";

  it("throws SourceError and never returns an empty page", async () => {
    const { pubmed, issued } = source((issued_) =>
      response(issued_.url, esearchBody({ ERROR: UPSTREAM })),
    );

    await expect(pubmed.search(query(20), context())).rejects.toThrow(
      SourceError,
    );
    // Nothing after the `esearch`: the error is checked before the id list.
    expect(issued).toHaveLength(1);
  });

  it("carries the upstream text on the thrown error", async () => {
    const { pubmed } = source((issued_) =>
      response(issued_.url, esearchBody({ ERROR: UPSTREAM })),
    );

    await expect(pubmed.search(query(20), context())).rejects.toThrow(
      /cannot be larger than 9998/u,
    );
  });

  it("prefers the error to the id list when a body carries both", () => {
    // The order matters: a body with an `ERROR` *and* an `idlist` must fail.
    expect(() =>
      parseEsearchBody(
        esearchBody({ ERROR: UPSTREAM, idlist: ["1", "2"], count: "2" }),
        "https://example.invalid/",
      ),
    ).toThrow(SourceError);
  });

  it("throws ParseError on a body that is not the documented shape", () => {
    expect(() => parseEsearchBody("<html>429</html>", "u")).toThrow(ParseError);
    expect(() => parseEsearchBody("{}", "u")).toThrow(ParseError);
    expect(() => parseEsearchBody('{"esearchresult":[]}', "u")).toThrow(
      ParseError,
    );
  });

  it("reads §3.3's real response, strings and all", () => {
    const parsed = parseEsearchBody(
      esearchBody({
        count: "8863",
        retmax: "5",
        retstart: "0",
        idlist: ["42704951", "42704632"],
        translationset: [{ from: "CRISPR", to: '"crispr"[All Fields]' }],
        querytranslation: "(...) AND 2023/09/09:2026/09/08[Date - Entry]",
      }),
      "u",
    );

    expect(parsed.pmids).toStrictEqual(["42704951", "42704632"]);
    expect(parsed.extras.count).toBe(8863);
    expect(parsed.extras.translationset).toStrictEqual([
      { from: "CRISPR", to: '"crispr"[All Fields]' },
    ]);
    expect(parsed.extras.querytranslation).toContain("Date - Entry");
  });
});

// ---------------------------------------------------------------------------
// 7. A second-step failure is a failure — the vacuity trap
// ---------------------------------------------------------------------------

describe("an efetch failure", () => {
  it("propagates instead of returning the esearch ids as records", async () => {
    const ids = pmids(3);
    const { pubmed, issued } = source((issued_, index) => {
      if (index === 0) {
        return response(
          issued_.url,
          esearchBody({ count: "3", idlist: [...ids] }),
        );
      }
      throw new UpstreamServerError(502, "efetch 502");
    });

    await expect(pubmed.search(query(3), context())).rejects.toThrow(
      UpstreamServerError,
    );
    expect(issued).toHaveLength(2);
  });

  it("fails the whole page when the second batch of two fails", async () => {
    const ids = pmids(250);
    let efetches = 0;
    const { pubmed } = source((issued_, index) => {
      if (index === 0) {
        return response(
          issued_.url,
          esearchBody({ count: "250", idlist: [...ids] }),
        );
      }
      efetches += 1;
      if (efetches === 2) throw new UpstreamServerError(500, "efetch 500");
      return response(issued_.url, efetchEcho(issued_));
    });

    await expect(pubmed.search(query(250), context())).rejects.toThrow(
      UpstreamServerError,
    );
  });

  it("does not wrap a transport class into SourceError", async () => {
    // `P1-T05` owns 429/5xx classification and retry; re-wrapping would discard
    // `retryable`. `docs/07` §4.2's "Throws SourceError subclasses" comment is
    // reported as a corpus contradiction with this card.
    const { pubmed } = source((_issued, index) => {
      if (index === 0) {
        return response("u", esearchBody({ count: "1", idlist: ["1"] }));
      }
      throw new UpstreamServerError(503, "efetch 503");
    });

    await expect(pubmed.search(query(1), context())).rejects.not.toBeInstanceOf(
      SourceError,
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Provenance — step 5
// ---------------------------------------------------------------------------

describe("the page's provenance extras", () => {
  it("captures count, querytranslation and translationset under NCBI's names", async () => {
    const { pubmed } = source(
      twoStep(pmids(2), {
        count: "8863",
        querytranslation:
          '"crispr"[All Fields] AND 2023/09/09:2026/09/08[Date - Entry]',
        translationset: [
          { from: "CRISPR", to: '"crispr"[All Fields]' },
          { from: "base editing", to: '"gene editing"[MeSH Terms]' },
        ],
      }),
    );
    const page = await pubmed.search(query(2), context());

    expect(page.totalAvailable).toBe(8863);
    expect(page.sourceExtras.count).toBe(8863);
    expect(page.sourceExtras.querytranslation).toContain("Date - Entry");
    expect(page.sourceExtras.translationset).toHaveLength(2);
    expect(Object.keys(page.sourceExtras)).toStrictEqual([
      "count",
      "querytranslation",
      "translationset",
    ]);
  });

  it("leaves the extras undefined rather than inventing them", async () => {
    const { pubmed } = source(twoStep(pmids(1), { count: undefined }));
    const page = await pubmed.search(query(1), context());

    expect(page.sourceExtras.count).toBeUndefined();
    expect(page.sourceExtras.querytranslation).toBeUndefined();
    expect(page.sourceExtras.translationset).toStrictEqual([]);
    expect(page.totalAvailable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. searchAll — step 7, criterion 6
// ---------------------------------------------------------------------------

describe("searchAll", () => {
  /** Two pages of 200 and 50, driven by the cursor the previous page returned. */
  function paged(total: number): {
    readonly pubmed: PubmedSource;
    readonly issued: Issued[];
  } {
    const all = pmids(total);
    return source((issued_, _index) => {
      if (issued_.url.startsWith(PUBMED_ESEARCH_BASE_URL)) {
        const start = Number(paramsOf(issued_).get("retstart"));
        const max = Number(paramsOf(issued_).get("retmax"));
        return response(
          issued_.url,
          esearchBody({
            count: String(total),
            retstart: String(start),
            idlist: [...all.slice(start, start + max)],
          }),
        );
      }
      return response(issued_.url, efetchEcho(issued_));
    });
  }

  it("pages until exhaustion and yields every record once, in order", async () => {
    const { pubmed, issued } = paged(250);
    const seen: string[] = [];
    for await (const r of pubmed.searchAll(query(250), context())) {
      seen.push(r.nativeId);
    }

    expect(seen).toStrictEqual([...pmids(250)]);
    // Two pages of 200 and 50: two `esearch` calls and one `efetch` each.
    expect(
      issued.filter((c) => c.url.startsWith(PUBMED_ESEARCH_BASE_URL)),
    ).toHaveLength(2);
    expect(
      issued.filter((c) => c.url.startsWith(PUBMED_EFETCH_BASE_URL)),
    ).toHaveLength(2);
    expect(paramsOf(must(issued[2])).get("retstart")).toBe("200");
  });

  it("stops at limit without asking for a page it will not use", async () => {
    const { pubmed, issued } = paged(1000);
    const seen: string[] = [];
    for await (const r of pubmed.searchAll(query(120), context())) {
      seen.push(r.nativeId);
    }

    expect(seen).toHaveLength(120);
    expect(issued).toHaveLength(2);
    expect(paramsOf(must(issued[0])).get("retmax")).toBe("120");
  });

  it("reports progress and forwards the page warnings", async () => {
    const { progress, steps, warnings } = createSpyProgress();
    const { pubmed } = paged(250);
    const token = createCancellationTokenSource().token;
    for await (const _r of pubmed.searchAll(query(250), { token, progress })) {
      // drained
    }

    expect(steps).toHaveLength(250);
    expect(steps[0]).toStrictEqual([1, 250]);
    expect(steps[249]).toStrictEqual([250, 250]);
    expect(warnings).toStrictEqual([]);

    const noisy = createSpyProgress();
    const big = paged(20_000);
    const noisyPages = big.pubmed.searchAll(query(10), {
      token: createCancellationTokenSource().token,
      progress: noisy.progress,
    });
    const iterator = noisyPages[Symbol.asyncIterator]();
    await iterator.next();
    expect(noisy.warnings).toStrictEqual([PUBMED_TRUNCATION_WARNING]);
  });

  it("stops before the next request when cancelled between pages", async () => {
    const { pubmed, issued } = paged(1000);
    const cancellation = createCancellationTokenSource();
    const pages = pubmed.searchAll(query(1000), { token: cancellation.token });
    const iterator = pages[Symbol.asyncIterator]();

    // Drain the first page: 200 records, then the generator is parked on the
    // yield inside it.
    for (let i = 0; i < EFETCH_MAX_IDS_PER_CALL; i += 1) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
    }
    const issuedAfterFirstPage = issued.length;
    expect(issuedAfterFirstPage).toBe(2);

    cancellation.cancel({ kind: "user" });
    await expect(iterator.next()).rejects.toThrow(OperationCancelledError);
    expect(issued).toHaveLength(issuedAfterFirstPage);
  });

  it("checks the token before the first request too", async () => {
    const { pubmed, issued } = paged(100);
    const cancellation = createCancellationTokenSource();
    cancellation.cancel({ kind: "shutdown" });

    const pages = pubmed.searchAll(query(100), { token: cancellation.token });
    const iterator = pages[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(OperationCancelledError);
    expect(issued).toStrictEqual([]);
  });

  it("stops before an efetch batch when cancelled mid-page", async () => {
    const ids = pmids(250);
    const cancellation = createCancellationTokenSource();
    const { pubmed, issued } = source((issued_, index) => {
      if (index === 0) {
        return response(
          issued_.url,
          esearchBody({ count: "250", idlist: [...ids] }),
        );
      }
      // Cancel while the first batch is in flight; the second must not go out.
      cancellation.cancel({ kind: "user" });
      return response(issued_.url, efetchEcho(issued_));
    });

    await expect(
      pubmed.search(query(250), { token: cancellation.token }),
    ).rejects.toThrow(OperationCancelledError);
    expect(issued).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 10. healthCheck — step 8
// ---------------------------------------------------------------------------

describe("healthCheck", () => {
  it("issues one esearch with retmax=0 and no efetch", async () => {
    const { pubmed, issued } = source((issued_) =>
      response(issued_.url, esearchBody({ count: "38000000", idlist: [] })),
    );
    const health = await pubmed.healthCheck(context());

    expect(health.ok).toBe(true);
    expect(issued).toHaveLength(1);
    expect(paramsOf(must(issued[0])).get("retmax")).toBe("0");
    expect(must(issued[0]).url.startsWith(PUBMED_ESEARCH_BASE_URL)).toBe(true);
    // No user content in a liveness probe.
    expect(paramsOf(must(issued[0])).get("term")).toBe("pubmed[All Fields]");
  });

  it("reads the quota hint from docs/02 §3.1's verified headers", async () => {
    const { pubmed } = source((issued_) =>
      response(issued_.url, esearchBody({ count: "1", idlist: [] }), {
        "X-Ratelimit-Limit": "3",
        "X-Ratelimit-Remaining": "2",
      }),
    );
    const health = await pubmed.healthCheck(context());

    expect(health.quotaHint).toBe("2/3");
  });

  it("measures latency on the injected clock", async () => {
    const clock = createManualClock(1000);
    const { client } = createStubHttp((issued_) => {
      clock.advance(120);
      return response(issued_.url, esearchBody({ count: "1", idlist: [] }));
    });
    const pubmed = createPubmedSource({
      http: client,
      clock,
      mapRecords: echoMapper,
    });

    const health = await pubmed.healthCheck(context());
    expect(health.latencyMs).toBe(120);
  });

  it("reports not-ok rather than throwing when the probe fails", async () => {
    const { pubmed } = source(() => {
      throw new UpstreamServerError(502, "NCBI 502");
    });
    const health = await pubmed.healthCheck(context());

    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe("rh-error-upstream");
  });

  it("reports not-ok for a 200 that carries esearchresult.ERROR", async () => {
    const { pubmed } = source((issued_) =>
      response(issued_.url, esearchBody({ ERROR: "Search Backend failed" })),
    );
    const health = await pubmed.healthCheck(context());

    expect(health.ok).toBe(false);
    expect(health.messageKey).toBe("rh-error-source");
  });

  it("lets cancellation through instead of calling it a health verdict", async () => {
    const cancellation = createCancellationTokenSource();
    cancellation.cancel({ kind: "user" });
    const { pubmed, issued } = source(() => response("u", "{}"));

    await expect(
      pubmed.healthCheck({ token: cancellation.token }),
    ).rejects.toThrow(OperationCancelledError);
    expect(issued).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. The access key — criterion 5
// ---------------------------------------------------------------------------

describe("the NCBI api_key", () => {
  /** A 36-character stub, the shape NCBI issues. Not a real key. */
  const STUB_KEY = "0123456789abcdef0123456789abcdef0123";

  it("sends api_key on every request when the store has one", async () => {
    const { pubmed, issued } = source(twoStep(pmids(250)), {
      secrets: createStubSecrets(STUB_KEY),
    });
    await pubmed.search(query(250), context());

    expect(issued).toHaveLength(3);
    for (const call of issued) {
      expect(paramsOf(call).get("api_key")).toBe(STUB_KEY);
    }
    // And it sits where `P1-T08` puts it: before D10's identity pair.
    const names = paramNames(must(issued[0]));
    expect(names.indexOf("api_key")).toBeLessThan(names.indexOf("tool"));
  });

  it("sends no api_key parameter at all when the store has none", async () => {
    const { pubmed, issued } = source(twoStep(pmids(2)), {
      secrets: createStubSecrets(undefined),
    });
    await pubmed.search(query(2), context());

    for (const call of issued) {
      expect(paramsOf(call).has("api_key")).toBe(false);
    }
  });

  it("goes unkeyed rather than failing when the store throws", async () => {
    const { logger, lines } = createSpyLogger();
    const { pubmed, issued } = source(twoStep(pmids(1)), {
      secrets: createStubSecrets(STUB_KEY, { throws: true }),
      logger,
    });
    const page = await pubmed.search(query(1), context());

    expect(page.records).toHaveLength(1);
    for (const call of issued) {
      expect(paramsOf(call).has("api_key")).toBe(false);
    }
    expect(lines.join("\n")).toContain("could not be read");
  });

  it("never writes the key into a log line", async () => {
    const { logger, lines } = createSpyLogger();
    const { pubmed } = source(twoStep(pmids(250)), {
      secrets: createStubSecrets(STUB_KEY),
      logger,
    });
    await pubmed.search(query(250), context());

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(STUB_KEY);
    // `redact()` alone would not have caught it: an NCBI key is shorter than
    // the 40-character catch-all, which is why the redacted forms are rendered
    // without the parameter rather than pattern-matched.
    expect(STUB_KEY.length).toBeLessThan(40);
  });

  it("keeps the key out of every redacted form of a request", () => {
    const built = buildEfetchRequest(pmids(3), STUB_KEY);
    expect(built.url).toContain("api_key=");
    expect(built.transmittedUrl).not.toContain("api_key");
    expect(built.transmittedUrl).not.toContain(STUB_KEY);

    const posted = buildEfetchRequest(pmids(EFETCH_MAX_IDS_PER_CALL), STUB_KEY);
    expect(posted.body ?? "").toContain("api_key=");
    expect(posted.transmittedBody ?? "").not.toContain("api_key");
    expect(posted.transmittedBody ?? "").not.toContain(STUB_KEY);
    // The redacted body is still the request, minus one parameter.
    expect(posted.transmittedBody ?? "").toContain("tool=research_helper");
  });

  it("puts the with-key budget in force when ncbi.keyPresent is true", () => {
    // The adapter does not reconfigure anything: `docs/07` §7.3's switch is
    // `createHostLimiterRegistry`'s, driven by the preference, and the adapter
    // only names the host through `rateLimitKey`. Both halves are asserted
    // together because criterion 5 states them as one fact.
    const clock = createManualClock();
    const { pubmed } = source(twoStep([]), {
      secrets: createStubSecrets(STUB_KEY),
    });

    const keyed = createHostLimiterRegistry({
      clock,
      prefs: createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: true }),
    }).limiterFor(pubmed.rateLimitKey);
    if (!(keyed instanceof TokenBucket)) throw new Error("not a TokenBucket");

    const unkeyed = createHostLimiterRegistry({ clock }).limiterFor(
      pubmed.rateLimitKey,
    );
    if (!(unkeyed instanceof TokenBucket)) throw new Error("not a TokenBucket");

    expect(keyed.currentConfig.ratePerSecond).toBeGreaterThan(
      unkeyed.currentConfig.ratePerSecond,
    );
    expect(keyed.currentConfig).toStrictEqual(
      must(createHostLimiterRegistry({ clock }).policyFor(pubmed.rateLimitKey))
        .withKey,
    );
  });
});

/** `noUncheckedIndexedAccess` makes every index optional; assert instead. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value, got undefined");
  return value;
}

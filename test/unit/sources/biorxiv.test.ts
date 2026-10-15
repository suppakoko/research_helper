import { readdir, readFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerSources } from "../../../src/bootstrap/registerSources";
import { Semaphore } from "../../../src/core/concurrency";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  ParseError,
  RateLimitError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpMethod,
  type HttpOptions,
  type HttpResponse,
  type HttpTransport,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  type ProgressReporter,
} from "../../../src/core/jobQueue/progress";
import { createLogger, type Logger } from "../../../src/core/logger";
import {
  fanOut,
  NETWORK_METADATA_POOL_SIZE,
} from "../../../src/pipeline/searchImport/stages";
import {
  ARXIV_HOST,
  BIORXIV_HOST,
  createHostLimiterRegistry,
  HOST_POLICIES,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import { SOURCE_IDS, type Doi } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  BIORXIV_CAPABILITIES,
  BIORXIV_DISPLAY_NAME_KEYS,
  BIORXIV_HEALTH_PROBE_DOIS,
  BIORXIV_NOT_FOUND_STATUSES,
  BiorxivEmptyBodyError,
  biorxivKeywordSearchNotice,
  createBiorxivSource,
  parseBiorxivBody,
  type BiorxivSource,
} from "../../../src/sources/biorxiv/biorxivSource";
import {
  BIORXIV_CATEGORY_SCHEMES,
  BIORXIV_MAPPABLE_FIELDS,
  cleanBiorxivAbstract,
  createBiorxivRecordMapper,
  markCorresponding,
  readBiorxivDate,
  readPublishedDoi,
  serverOf,
  splitBiorxivAuthors,
} from "../../../src/sources/biorxiv/mapper";
import {
  BIORXIV_API_BASE_URL,
  BIORXIV_DETAILS_PAGE_SIZE,
  BIORXIV_PREPRINT_SEARCH_ROUTE,
  biorxivLookupDoi,
  buildBiorxivDetailsRequest,
  buildBiorxivPubsRequest,
  explainBiorxivQuery,
  type BiorxivServer,
} from "../../../src/sources/biorxiv/query";
import { explainEuropePmcQuery } from "../../../src/sources/europepmc/query";
import { createSourceRegistry } from "../../../src/sources/registry";
import {
  normalizeForSource,
  parseUserQuery,
} from "../../../src/sources/shared/queryParse";
import type {
  LiteratureSource,
  SourceCallContext,
  SourceQuery,
} from "../../../src/sources/types";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureKey,
  listFixtureMeta,
  META_SUFFIX,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  planFor,
  plannedRequest,
  RECORDABLE_SOURCES,
} from "../../../scripts/record-fixtures";
import {
  BIORXIV_DOI_ABSENT,
  BIORXIV_DOI_CROSS_SERVER,
  BIORXIV_DOI_OLD_STYLE,
  BIORXIV_DOI_RICH,
  BIORXIV_DOI_SPARSE,
  BIORXIV_DOI_SYNTHETIC_429,
  BIORXIV_DOI_SYNTHETIC_500,
  BIORXIV_DOI_SYNTHETIC_EMPTY_BODY,
  BIORXIV_DOI_SYNTHETIC_MALFORMED,
  BIORXIV_DOI_SYNTHETIC_STATUS_ERROR,
  BIORXIV_DOI_UNICODE,
  MEDRXIV_DOI_RICH,
  MEDRXIV_DOI_SPARSE,
  recordedBiorxivRequest,
} from "../../support/biorxivRecordedRequests";

/**
 * `P2-T07`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network**.
 * The card's `Verify with` (`npm run test:unit -- biorxiv`) runs all of it:
 *
 * - **Pure**: the DOI filter and the two request builders, the capabilities
 *   (`keywordSearch: false`), the `api.biorxiv.org` row read back from
 *   `docs/07` §7.3 and paced on the real `TokenBucket`, the mapper over
 *   hand-built entries (server attribution from the `server` field, the
 *   `published` → `relatedVersionIds` signal, licences, versions, abstracts),
 *   the in-200 status check, the delegating `search()`, and `registerSources`
 *   with both slots.
 * - **Replayed**: the shipped `createBiorxivSource` over the shipped
 *   `createHttpClient`, answering from `test/fixtures/biorxiv/` and
 *   `test/fixtures/medrxiv/` — recorded live on 2026-10-15 through the
 *   committed recorder (12 scenario requests, 3 of them re-recorded after a
 *   redaction fix; 10 written). A missing fixture is an error naming the
 *   record command, never a network call.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRS: Readonly<Record<BiorxivServer, string>> = {
  biorxiv: resolve(HERE, "../../fixtures/biorxiv"),
  medrxiv: resolve(HERE, "../../fixtures/medrxiv"),
};
const DOCS_07 = resolve(
  HERE,
  "../../../docs/07-architecture-and-data-model.md",
);
const SRC_DIR = resolve(HERE, "../../../src");

const NOW = 1_700_000_000_000;

function ctx(progress?: ProgressReporter): SourceCallContext {
  return {
    token: createCancellationTokenSource().token,
    ...(progress !== undefined && { progress }),
  };
}

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${what} to be present`);
  }
  return value;
}

interface Issued {
  readonly method: HttpMethod;
  readonly url: string;
  readonly options: HttpOptions | undefined;
}

function createStubHttp(handler: (issued: Issued) => HttpResponse): {
  readonly client: HttpClient;
  readonly issued: Issued[];
} {
  const issued: Issued[] = [];
  const client: HttpClient = {
    request(method, url, options) {
      const call: Issued = { method, url, options };
      issued.push(call);
      return Promise.resolve(handler(call));
    },
  };
  return { client, issued };
}

function response(url: string, body: string, status = 200): HttpResponse {
  return {
    status,
    url,
    body,
    rawHeaders: "",
    header: (name) =>
      name.toLowerCase() === "content-type" ? "application/json" : undefined,
  };
}

/** A `/details/` body around hand-built entries. */
function detailsBody(entries: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    messages: [{ status: "ok", category: "all" }],
    collection: entries,
  });
}

const NOT_FOUND_BODY =
  '{"messages":[{"status":"no posts found"}], "collection":[]}';

/** A `/details/` entry in `docs/02` §8.3's shape. */
function entry(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    title: "A title",
    authors: "Loconsole, M.; Xue, C.; Garcia-Pelegrin, E.",
    author_corresponding: "Maria Loconsole",
    author_corresponding_institution: "University of Padova",
    doi: "10.64898/2026.07.31.741992",
    date: "2026-08-01",
    version: "1",
    type: "new results",
    license: "cc_by_nc_nd",
    category: "animal behavior and cognition",
    jatsxml: "https://www.biorxiv.org/x.source.xml",
    abstract: "Humans reliably associate sounds with shapes.",
    published: "NA",
    server: "bioRxiv",
    ...overrides,
  };
}

function mapper(overrides: { keepRaw?: boolean; logger?: Logger } = {}) {
  return createBiorxivRecordMapper({
    clock: createManualClock(NOW),
    ...overrides,
  });
}

function collectingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const noop = () => undefined;
  const logger = {
    debug: noop,
    info: noop,
    warn: (msg: string) => {
      warnings.push(msg);
    },
    error: noop,
  } as unknown as Logger;
  return { logger, warnings };
}

function createSource(
  server: BiorxivServer,
  client: HttpClient,
): BiorxivSource {
  return createBiorxivSource({
    server,
    http: client,
    clock: createManualClock(NOW),
    mapRecords: mapper(),
  });
}

function progressRecorder(): { reporter: ProgressReporter; warned: string[] } {
  const warned: string[] = [];
  const reporter: ProgressReporter = {
    setMessage: () => undefined,
    setProgress: () => undefined,
    increment: () => undefined,
    child: () => reporter,
    warn: (message) => {
      warned.push(message);
    },
    done: () => undefined,
  };
  return { reporter, warned };
}

const ANY_QUERY: SourceQuery = {
  terms: parseUserQuery('("base editing" OR "prime editing") AND title:CRISPR'),
  limit: 20,
};

/** The recorded exchange of one scenario, straight from disk. */
async function recordedExchange(
  server: BiorxivServer,
  scenario: string,
): Promise<RecordedExchange> {
  const dir = FIXTURE_DIRS[server];
  const loaded = await listFixtureMeta(dir);
  const hit = loaded.find((m) => m.meta.scenario === scenario);
  if (hit === undefined)
    throw new Error(`no ${server} fixture for ${scenario}`);
  const text = await readFile(`${dir}/${hit.key}.json`, "utf8");
  return JSON.parse(text) as RecordedExchange;
}

function only(records: readonly SourceRecord[]): SourceRecord {
  expect(records).toHaveLength(1);
  return must(records[0], "the one record");
}

// ---------------------------------------------------------------------------
// 1. Requests — docs/02 §8.2, §11.2
// ---------------------------------------------------------------------------

describe("biorxivLookupDoi and the request builders", () => {
  it("accepts both registrant prefixes, 10.1101/ and 10.64898/, and nothing else", () => {
    expect(biorxivLookupDoi("10.1101/2025.09.17.676679")).toBe(
      "10.1101/2025.09.17.676679",
    );
    expect(biorxivLookupDoi("10.64898/2026.07.31.741992")).toBe(
      "10.64898/2026.07.31.741992",
    );
    expect(biorxivLookupDoi("10.1101/459891")).toBe("10.1101/459891");
    // Any spelling normalizeDoi accepts.
    expect(biorxivLookupDoi("https://doi.org/10.64898/2026.07.31.741992")).toBe(
      "10.64898/2026.07.31.741992",
    );
    for (const other of [
      "10.48550/arXiv.2106.15928",
      "10.1038/s41586-023-06139-9",
      "10.21203/rs.3.rs-1/v1",
      "10.11011/2025.09.17.676679",
      "not a doi",
      "",
      undefined,
    ]) {
      expect(biorxivLookupDoi(other)).toBeUndefined();
    }
  });

  it("refuses a bioRxiv-prefixed DOI that is not path-safe rather than encoding it", () => {
    expect(biorxivLookupDoi("10.1101/2025.09?x=1")).toBeUndefined();
    expect(biorxivLookupDoi("10.1101/a b")).toBeUndefined();
  });

  it("builds /details/{server}/{DOI}/na/json and /pubs/{server}/{DOI}/na/json exactly", () => {
    const details = buildBiorxivDetailsRequest(
      "medrxiv",
      "10.64898/2026.09.02.26361916",
    );
    expect(details).toEqual({
      method: "GET",
      url: "https://api.biorxiv.org/details/medrxiv/10.64898/2026.09.02.26361916/na/json",
      transmittedUrl:
        "https://api.biorxiv.org/details/medrxiv/10.64898/2026.09.02.26361916/na/json",
      endpointBaseUrl: "https://api.biorxiv.org/details/medrxiv",
      endpoint: "details",
      server: "medrxiv",
      doi: "10.64898/2026.09.02.26361916",
    });
    expect(
      buildBiorxivPubsRequest("biorxiv", "10.1101/2025.09.17.676679").url,
    ).toBe(
      "https://api.biorxiv.org/pubs/biorxiv/10.1101/2025.09.17.676679/na/json",
    );
    expect(BIORXIV_API_BASE_URL).toBe(`https://${BIORXIV_HOST}`);
    expect(details.url).not.toMatch(/mailto|email|api_key|suppakoko/u);
  });

  it("throws RangeError for a DOI this host cannot answer for", () => {
    expect(() =>
      buildBiorxivDetailsRequest("biorxiv", "10.1038/s41586-023-06139-9"),
    ).toThrow(RangeError);
    expect(() => buildBiorxivPubsRequest("medrxiv", "nope")).toThrow(
      /not a bioRxiv\/medRxiv DOI/u,
    );
  });

  it("explainQuery sends nothing and says where preprint search went (docs/02 §12.2)", () => {
    expect(BIORXIV_PREPRINT_SEARCH_ROUTE).toBe("Europe PMC SRC:PPR");
    expect(explainBiorxivQuery("biorxiv")).toBe(
      "(no query sent: bioRxiv has no keyword search — preprint keyword search runs through Europe PMC SRC:PPR)",
    );
    expect(explainBiorxivQuery("medrxiv")).toContain("medRxiv");
  });

  it("src/ never tests the legacy prefix with startsWith (criterion 6)", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) {
          const text = readFileSync(path, "utf8");
          if (/startsWith\(['"]10\.1101/u.test(text)) offenders.push(path);
        }
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Capabilities — docs/07 §4.2, card step 2
// ---------------------------------------------------------------------------

describe("BIORXIV_CAPABILITIES", () => {
  it("declares no keyword search, DOI lookup only, /details/' page size of 30", () => {
    expect(BIORXIV_CAPABILITIES).toEqual({
      keywordSearch: false,
      query: { or: false, not: false, phrase: false, fields: [] },
      relatedByWork: false,
      lookupById: ["doi"],
      abstractsInSearch: false,
      citationGraph: false,
      dateFilter: false,
      maxPageSize: 30,
      maxTotalResults: undefined,
      benefitsFromApiKey: false,
    });
    expect(BIORXIV_DETAILS_PAGE_SIZE).toBe(30);
  });

  it("is keywordSearch: false on both registered sources (criterion 2)", () => {
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    for (const server of ["biorxiv", "medrxiv"] as const) {
      expect(createSource(server, client).capabilities.keywordSearch).toBe(
        false,
      );
    }
  });

  it("makes normalizeForSource report the whole query tree as lost", () => {
    const tree = parseUserQuery("CRISPR AND title:editing");
    expect(normalizeForSource(tree, BIORXIV_CAPABILITIES)).toEqual([tree]);
  });
});

// ---------------------------------------------------------------------------
// 3. The api.biorxiv.org row — docs/07 §7.3
// ---------------------------------------------------------------------------

describe("hostLimiter: the api.biorxiv.org row", () => {
  function section73Row(host: string): Record<string, string> {
    const lines = readFileSync(DOCS_07, "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith("### 7.3 "));
    expect(start).toBeGreaterThan(0);
    const header = lines.findIndex(
      (l, i) => i > start && l.startsWith("| Host |"),
    );
    const cells = (l: string) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
    const columns = cells(lines[header] ?? "");
    const row = lines
      .slice(header + 2)
      .find((l) => l.startsWith(`| \`${host}\``));
    if (row === undefined) throw new Error(`§7.3 has no row for ${host}`);
    const values = cells(row);
    expect(values).toHaveLength(columns.length);
    return Object.fromEntries(columns.map((c, i) => [c, values[i] ?? ""]));
  }

  it("is 1/s, burst 2, max concurrent 2, exactly as §7.3 writes it, with no key mode", () => {
    expect(BIORXIV_HOST).toBe("api.biorxiv.org");
    const row = section73Row(BIORXIV_HOST);
    expect(row["Rate"]).toBe("1/s");
    expect(row["Burst"]).toBe("2");
    expect(row["Max concurrent"]).toBe("2");
    expect(row["Basis"]).toMatch(/self-imposed/u);
    const policy = HOST_POLICIES.find((p) => p.host === BIORXIV_HOST);
    expect(policy?.withoutKey).toEqual({
      ratePerSecond: Number((row["Rate"] ?? "").replace("/s", "")),
      burst: Number(row["Burst"]),
      maxConcurrent: Number(row["Max concurrent"]),
    });
    expect(policy?.withKey).toBeUndefined();
    expect(policy?.keyPresencePref).toBeUndefined();
    expect(policy?.headerDriven).toBeUndefined();
  });

  it("carries the retry budget §7.3's three cells state (1000 ms / 30 000 ms / 3)", () => {
    const row = section73Row(BIORXIV_HOST);
    const ms = (cell: string | undefined): number =>
      Number((cell ?? "").replace(/\s/g, "").replace("ms", ""));
    const retry = HOST_POLICIES.find((p) => p.host === BIORXIV_HOST)?.retry;
    expect(retry).toEqual({
      baseMs: ms(row["Retry base"]),
      capMs: ms(row["Retry cap"]),
      maxAttempts: Number(row["Attempt cap"]),
    });
    expect(retry).toEqual({ baseMs: 1000, capMs: 30_000, maxAttempts: 3 });
  });

  it("is one bucket, served by the registry — and both sources resolve to that same object (criterion 1)", () => {
    const registry = createHostLimiterRegistry({
      clock: createManualClock(NOW),
    });
    // Not a pin on the whole list: `tokenBucket.test.ts` and
    // `container.test.ts` own that and grow by one per adapter card.
    expect(registry.hosts).toContain(BIORXIV_HOST);
    const bucket = registry.limiterFor(BIORXIV_HOST);
    expect(bucket).toBeDefined();
    expect(bucket).not.toBe(registry.limiterFor(ARXIV_HOST));
    expect(bucket).not.toBe(registry.limiterFor(SEMANTICSCHOLAR_HOST));
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    const biorxiv = createSource("biorxiv", client);
    const medrxiv = createSource("medrxiv", client);
    expect(biorxiv.rateLimitKey).toBe(BIORXIV_HOST);
    expect(medrxiv.rateLimitKey).toBe(BIORXIV_HOST);
    expect(registry.limiterFor(biorxiv.rateLimitKey)).toBe(bucket);
    expect(registry.limiterFor(medrxiv.rateLimitKey)).toBe(bucket);
  });
});

// ---------------------------------------------------------------------------
// 4. The mapper — readers and hand-built entries
// ---------------------------------------------------------------------------

describe("mapper readers", () => {
  it("serverOf reads the server field, case-insensitively, and nothing else", () => {
    expect(serverOf("bioRxiv")).toBe("biorxiv");
    expect(serverOf("medRxiv")).toBe("medrxiv");
    expect(serverOf(" MEDRXIV ")).toBe("medrxiv");
    expect(serverOf("arXiv")).toBeUndefined();
    expect(serverOf(undefined)).toBeUndefined();
    expect(serverOf(42)).toBeUndefined();
  });

  it("splits the 'Last, F.; Last, F.' author string (docs/02 §10.2)", () => {
    expect(splitBiorxivAuthors("Ozkaraca, M. I.; Tenesa, A.;")).toEqual([
      { family: "Ozkaraca", given: "M. I.", sequence: 0 },
      { family: "Tenesa", given: "A.", sequence: 1 },
    ]);
    expect(splitBiorxivAuthors("The COVID Consortium; Li, W.")).toEqual([
      { family: "The COVID Consortium", sequence: 0 },
      { family: "Li", given: "W.", sequence: 1 },
    ]);
    expect(splitBiorxivAuthors(" ; ")).toEqual([]);
  });

  it("marks the corresponding author by family name, using the initial only to break a tie", () => {
    const authors = splitBiorxivAuthors(
      "Bendavid, E.; Ling, E.; Ling, X. B.; Li, W.",
    );
    const one = markCorresponding(authors, "Xuefeng B Ling", "Stanford");
    expect(one.filter((a) => a.isCorresponding === true)).toEqual([
      {
        family: "Ling",
        given: "X. B.",
        sequence: 2,
        isCorresponding: true,
        affiliations: ["Stanford"],
      },
    ]);
    const unique = markCorresponding(authors, "Weihan Li", undefined);
    expect(unique.find((a) => a.isCorresponding === true)?.family).toBe("Li");
    expect(
      unique.find((a) => a.isCorresponding === true)?.affiliations,
    ).toBeUndefined();
    // No match, and an unresolvable tie: nothing is marked.
    expect(
      markCorresponding(authors, "Nobody Else", "X").some(
        (a) => a.isCorresponding === true,
      ),
    ).toBe(false);
    expect(
      markCorresponding(
        splitBiorxivAuthors("Ling, E.; Ling, E."),
        "Eve Ling",
        "X",
      ).some((a) => a.isCorresponding === true),
    ).toBe(false);
  });

  it("cleans docs/02 §8.5's flattening tokens and run-in headings, paragraph by paragraph", () => {
    expect(
      cleanBiorxivAbstract(
        "AO_SCPCAPBSTRACTC_SCPCAP  of the work\n\nO_LIfirst itemC_LIO_LIsecond itemC_LI",
      ),
    ).toBe("ABSTRACT of the work\n\nfirst item second item");
    expect(
      cleanBiorxivAbstract(
        "BackgroundAddressing COVID-19.\n\nMethodsOn April 3-4.\n\nDesign, Setting, and ParticipantsRetrospective study.\n\n  ResultsThe raw prevalence  was\n 1.5%.",
      ),
    ).toBe(
      "Background: Addressing COVID-19.\n\nMethods: On April 3-4.\n\nDesign, Setting, and Participants: Retrospective study.\n\nResults: The raw prevalence was 1.5%.",
    );
    // A paragraph that merely begins with a heading word is left alone.
    expect(cleanBiorxivAbstract("Results are shown below.")).toBe(
      "Results are shown below.",
    );
    expect(cleanBiorxivAbstract("Resultsthe lower case")).toBe(
      "Resultsthe lower case",
    );
    expect(cleanBiorxivAbstract("  \n\n ")).toBe("");
  });

  it("reads YYYY-MM-DD dates and the published value", () => {
    expect(readBiorxivDate("2020-04-17")).toEqual({
      year: 2020,
      month: 4,
      day: 17,
      iso: "2020-04-17",
    });
    expect(readBiorxivDate("2020-13-01")).toBeUndefined();
    expect(readBiorxivDate("April 2020")).toBeUndefined();
    expect(readPublishedDoi("NA")).toBeUndefined();
    expect(readPublishedDoi(undefined)).toBeUndefined();
    expect(readPublishedDoi("10.1091/mbc.E25-09-0454")).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
    expect(readPublishedDoi("in press")).toBeNull();
  });
});

describe("mapper: hand-built /details/ and /pubs/ entries", () => {
  const details = { endpoint: "details", requestedServer: "biorxiv" } as const;

  it("takes the SourceId from the server field: one 10.64898/ prefix, two servers (criterion 4)", () => {
    const shared = "10.64898/2026.09.03.26361736";
    const asMed = only(
      mapper()([entry({ doi: shared, server: "medRxiv" })], {
        endpoint: "details",
        requestedServer: "biorxiv",
      }),
    );
    expect(asMed.sourceId).toBe("medrxiv");
    expect(asMed.id).toBe(`medrxiv:${shared}`);
    expect(asMed.work.containerTitle).toBe("medRxiv");
    expect(asMed.work.subjects?.[0]?.scheme).toBe("medrxiv-category");
    const asBio = only(
      mapper()([entry({ doi: shared, server: "bioRxiv" })], {
        endpoint: "details",
        requestedServer: "medrxiv",
      }),
    );
    expect(asBio.sourceId).toBe("biorxiv");
    expect(asBio.work.containerTitle).toBe("bioRxiv");
    expect(asBio.work.ids.doi).toBe(asMed.work.ids.doi);
  });

  it("maps a legacy 10.1101/ record the same way (criterion 5)", () => {
    const record = only(
      mapper()(
        [entry({ doi: "10.1101/2025.09.17.676679", server: "medRxiv" })],
        details,
      ),
    );
    expect(record.sourceId).toBe("medrxiv");
    expect(record.work.ids).toEqual({ doi: "10.1101/2025.09.17.676679" });
    expect(record.work.type).toBe("preprint");
  });

  it("falls back to the server asked, with a warning, when the record names none", () => {
    const { logger, warnings } = collectingLogger();
    const record = only(
      mapper({ logger })([entry({ server: undefined })], {
        endpoint: "details",
        requestedServer: "medrxiv",
      }),
    );
    expect(record.sourceId).toBe("medrxiv");
    expect(warnings).toEqual([
      "biorxiv mapper: record names no known server; using the one asked",
    ]);
  });

  it("turns published != NA into relatedVersionIds without touching ids.doi", () => {
    const record = only(
      mapper()([entry({ published: "10.1091/mbc.E25-09-0454" })], details),
    );
    expect(record.work.relatedVersionIds).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
    expect(record.work.ids.doi).toBe("10.64898/2026.07.31.741992");
    const none = only(mapper()([entry()], details));
    expect(none.work.relatedVersionIds).toBeUndefined();
    expect(none.missingFields).toContain("relatedVersionIds");
    const { logger, warnings } = collectingLogger();
    const odd = only(
      mapper({ logger })([entry({ published: "soon" })], details),
    );
    expect(odd.work.relatedVersionIds).toBeUndefined();
    expect(warnings).toEqual([
      "biorxiv mapper: published value is neither NA nor a DOI",
    ]);
  });

  it("reads the licence per record, verbatim, and never assumes one (docs/09 §5.6)", () => {
    for (const license of ["cc_by", "cc_no", "cc_by_nc_nd", "cc0"]) {
      expect(
        only(mapper()([entry({ license })], details)).work.openAccess,
      ).toEqual({ isOpenAccess: true, license });
    }
    const unlicensed = only(mapper()([entry({ license: undefined })], details));
    expect(unlicensed.work.openAccess).toBeUndefined();
    expect(unlicensed.missingFields).toContain("openAccess");
  });

  it("folds every version of a DOI into one record: latest metadata, earliest date", () => {
    const record = only(
      mapper()(
        [
          entry({ version: "1", date: "2020-04-17", title: "Old title" }),
          entry({ version: "2", date: "2020-04-30", title: "New title" }),
        ],
        details,
      ),
    );
    expect(record.work.title).toBe("New title");
    expect(record.work.publishedDate?.iso).toBe("2020-04-17");
  });

  it("maps every field card step 5 names", () => {
    const record = only(mapper()([entry()], details));
    expect(record).toEqual({
      id: "biorxiv:10.64898/2026.07.31.741992",
      sourceId: "biorxiv",
      nativeId: "10.64898/2026.07.31.741992",
      work: {
        ids: { doi: "10.64898/2026.07.31.741992" },
        type: "preprint",
        title: "A title",
        abstract: "Humans reliably associate sounds with shapes.",
        authors: [
          {
            family: "Loconsole",
            given: "M.",
            sequence: 0,
            isCorresponding: true,
            affiliations: ["University of Padova"],
          },
          { family: "Xue", given: "C.", sequence: 1 },
          { family: "Garcia-Pelegrin", given: "E.", sequence: 2 },
        ],
        containerTitle: "bioRxiv",
        publishedDate: { year: 2026, month: 8, day: 1, iso: "2026-08-01" },
        subjects: [
          {
            term: "animal behavior and cognition",
            scheme: BIORXIV_CATEGORY_SCHEMES.biorxiv,
          },
        ],
        openAccess: { isOpenAccess: true, license: "cc_by_nc_nd" },
      },
      retrievedAtEpochMs: NOW,
      missingFields: ["relatedVersionIds"],
    });
    expect(BIORXIV_MAPPABLE_FIELDS).toContain("relatedVersionIds");
  });

  it("maps /pubs/' preprint_* members, including the cross-walk signal", () => {
    const record = only(
      mapper()(
        [
          {
            preprint_doi: "10.1101/2025.09.17.676679",
            published_doi: "10.1091/mbc.E25-09-0454",
            published_journal: "Molecular Biology of the Cell",
            preprint_platform: "bioRxiv",
            preprint_title: "YeastSAM",
            preprint_authors: "Zhao, Y.; Li, W.",
            preprint_category: "cell biology",
            preprint_date: "2025-09-20",
            published_date: "2026-06-01",
            preprint_abstract: "BackgroundSegmentation is hard.",
            preprint_author_corresponding: "Weihan Li",
            preprint_author_corresponding_institution: "Brown University",
          },
        ],
        { endpoint: "pubs", requestedServer: "medrxiv" },
      ),
    );
    expect(record.sourceId).toBe("biorxiv");
    expect(record.work.ids.doi).toBe("10.1101/2025.09.17.676679");
    expect(record.work.relatedVersionIds).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
    expect(record.work.abstract).toBe("Background: Segmentation is hard.");
    expect(record.work.publishedDate?.iso).toBe("2025-09-20");
    expect(record.work.authors[1]).toEqual({
      family: "Li",
      given: "W.",
      sequence: 1,
      isCorresponding: true,
      affiliations: ["Brown University"],
    });
    expect(record.work.openAccess).toBeUndefined();
  });

  it("drops an entry with no usable DOI, with a warning, and keeps raw only when asked", () => {
    const { logger, warnings } = collectingLogger();
    expect(
      mapper({ logger })([entry({ doi: "NA" }), null, "x"], details),
    ).toEqual([]);
    expect(warnings).toHaveLength(3);
    const kept = only(mapper({ keepRaw: true })([entry()], details));
    expect(kept.raw).toEqual(entry());
    expect(only(mapper()([entry()], details)).raw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. The body — docs/02 §8.5
// ---------------------------------------------------------------------------

describe("parseBiorxivBody", () => {
  const url = "https://api.biorxiv.org/details/biorxiv/10.1101/1/na/json";

  it("returns the collection for status ok", () => {
    const parsed = parseBiorxivBody(detailsBody([entry()]), "biorxiv", url);
    expect(parsed).toEqual({
      status: "ok",
      found: true,
      collection: [entry()],
    });
  });

  it("treats both measured not-found statuses as no records, not as errors", () => {
    expect(BIORXIV_NOT_FOUND_STATUSES).toEqual([
      "no posts found",
      "no articles found",
    ]);
    for (const status of [
      "no posts found",
      "no articles found for published version of ",
      "no articles found for published version of 10.1101/459891",
    ]) {
      expect(
        parseBiorxivBody(
          JSON.stringify({ messages: [{ status }], collection: [] }),
          "biorxiv",
          url,
        ),
      ).toEqual({ status, found: false, collection: [] });
    }
  });

  it("turns an HTTP-200 body with messages[0].status 'error' into a typed SourceError (criterion 7)", () => {
    let caught: unknown;
    try {
      parseBiorxivBody('{"messages":[{"status":"error"}]}', "medrxiv", url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SourceError);
    expect(caught).not.toBeInstanceOf(ParseError);
    const error = caught as SourceError;
    expect(error.sourceId).toBe("medrxiv");
    expect(error.context.upstreamError).toBe("error");
    expect(error.retryable).toBe(false);
  });

  it("treats an empty HTTP 200 body as a retryable failure, never as no results (§8.5)", () => {
    for (const body of ["", "  \n"]) {
      let caught: unknown;
      try {
        parseBiorxivBody(body, "biorxiv", url);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BiorxivEmptyBodyError);
      expect(caught).toBeInstanceOf(SourceError);
      expect((caught as BiorxivEmptyBodyError).retryable).toBe(true);
    }
  });

  it("refuses non-JSON, a missing status and an ok without a collection as ParseError", () => {
    for (const body of [
      "<html>",
      "[]",
      '{"collection":[]}',
      '{"messages":[{}]}',
      '{"messages":[{"status":"ok"}]}',
    ]) {
      expect(() => parseBiorxivBody(body, "biorxiv", url)).toThrow(ParseError);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The adapter
// ---------------------------------------------------------------------------

describe("createBiorxivSource — identity, search and lookup", () => {
  it("is one implementation with two identities on one host", () => {
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    const biorxiv = createSource("biorxiv", client);
    const medrxiv = createSource("medrxiv", client);
    expect([biorxiv.id, medrxiv.id]).toEqual(["biorxiv", "medrxiv"]);
    expect([biorxiv.displayNameKey, medrxiv.displayNameKey]).toEqual([
      "research-helper-source-biorxiv",
      "research-helper-source-medrxiv",
    ]);
    expect(BIORXIV_DISPLAY_NAME_KEYS).toEqual({
      biorxiv: "research-helper-source-biorxiv",
      medrxiv: "research-helper-source-medrxiv",
    });
    expect(biorxiv.capabilities).toBe(BIORXIV_CAPABILITIES);
    expect(medrxiv.capabilities).toBe(BIORXIV_CAPABILITIES);
    expect(biorxiv.isConfigured()).toBe(true);
    expect(biorxiv.explainQuery(ANY_QUERY)).toBe(
      explainBiorxivQuery("biorxiv"),
    );
    expect(medrxiv.explainQuery(ANY_QUERY)).toBe(
      explainBiorxivQuery("medrxiv"),
    );
  });

  it("search() is a delegation: no request, an empty page with no total, and the SRC:PPR notice (card step 3)", async () => {
    const { client, issued } = createStubHttp(() => {
      throw new Error("search must not issue a request");
    });
    for (const server of ["biorxiv", "medrxiv"] as const) {
      const page = await createSource(server, client).search(ANY_QUERY, ctx());
      expect(page).toEqual({
        records: [],
        totalAvailable: undefined,
        nextCursor: undefined,
        warnings: [biorxivKeywordSearchNotice(server)],
      });
      expect(page.warnings[0]).toContain("Europe PMC SRC:PPR");
    }
    expect(issued).toEqual([]);
    expect(biorxivKeywordSearchNotice("medrxiv")).toMatch(/^medRxiv has no/u);
  });

  it("searchAll() yields nothing, issues nothing, and raises the notice once", async () => {
    const { client, issued } = createStubHttp(() => {
      throw new Error("searchAll must not issue a request");
    });
    const { reporter, warned } = progressRecorder();
    const yielded: SourceRecord[] = [];
    for await (const record of createSource("biorxiv", client).searchAll(
      ANY_QUERY,
      ctx(reporter),
    )) {
      yielded.push(record);
    }
    expect(yielded).toEqual([]);
    expect(issued).toEqual([]);
    expect(warned).toEqual([biorxivKeywordSearchNotice("biorxiv")]);
  });

  it("search() honours cancellation", async () => {
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    const source = createSource("biorxiv", client);
    const cts = createCancellationTokenSource();
    cts.cancel({ kind: "user" });
    await expect(
      source.search(ANY_QUERY, { token: cts.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("lookup() sends one /details/ request per distinct bioRxiv-family DOI, and skips the rest", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(
        i.url,
        i.url.includes("2026.07.31.741992")
          ? detailsBody([entry()])
          : NOT_FOUND_BODY,
      ),
    );
    const records = await createSource("biorxiv", client).lookup(
      [
        { doi: "10.64898/2026.07.31.741992" as Doi },
        { doi: "10.64898/2026.07.31.741992" as Doi },
        { doi: "10.1101/2025.01.01.000001" as Doi },
        { doi: "10.48550/arxiv.2106.15928" as Doi },
        { pmid: "123" as never },
      ],
      ctx(),
    );
    expect(issued.map((i) => i.url)).toEqual([
      "https://api.biorxiv.org/details/biorxiv/10.64898/2026.07.31.741992/na/json",
      "https://api.biorxiv.org/details/biorxiv/10.1101/2025.01.01.000001/na/json",
    ]);
    expect(issued.every((i) => i.options?.responseType === "text")).toBe(true);
    expect(records.map((r) => r.id)).toEqual([
      "biorxiv:10.64898/2026.07.31.741992",
    ]);
  });

  it("counts not-found DOIs on the debug channel and maps nothing for them", async () => {
    const debug: { msg: string; ctx: unknown }[] = [];
    const noop = () => undefined;
    const logger = {
      debug: (msg: string, ctx: unknown) => {
        debug.push({ msg, ctx });
      },
      info: noop,
      warn: noop,
      error: noop,
    } as unknown as Logger;
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    const source = createBiorxivSource({
      server: "biorxiv",
      http: client,
      clock: createManualClock(NOW),
      mapRecords: () => {
        throw new Error("a not-found answer must not reach the mapper");
      },
      logger,
    });
    expect(
      await source.lookup(
        [
          { doi: "10.64898/1999.01.01.000000" as Doi },
          { doi: "10.1101/1999.01.01.000001" as Doi },
        ],
        ctx(),
      ),
    ).toEqual([]);
    expect(debug.filter((d) => d.msg === "biorxiv: DOIs not found")).toEqual([
      {
        msg: "biorxiv: DOIs not found",
        ctx: { sourceId: "biorxiv", endpoint: "details", notFound: 2 },
      },
    ]);
  });

  it("resolvePublished() goes to /pubs/ on the adapter's own server", async () => {
    const { client, issued } = createStubHttp((i) =>
      response(i.url, NOT_FOUND_BODY),
    );
    await createSource("medrxiv", client).resolvePublished(
      [{ doi: "10.1101/2020.04.14.20062463" as Doi }],
      ctx(),
    );
    expect(issued.map((i) => i.url)).toEqual([
      "https://api.biorxiv.org/pubs/medrxiv/10.1101/2020.04.14.20062463/na/json",
    ]);
  });

  it("healthCheck looks up a known DOI per server and reports a not-found or error as not ok", async () => {
    const found = createStubHttp((i) =>
      response(i.url, detailsBody([entry()])),
    );
    const ok = await createSource("medrxiv", found.client).healthCheck(ctx());
    expect(ok.ok).toBe(true);
    expect(ok.messageKey).toBe("research-helper-source-medrxiv");
    expect(found.issued[0]?.url).toContain(
      `/details/medrxiv/${BIORXIV_HEALTH_PROBE_DOIS.medrxiv}/na/json`,
    );
    const missing = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    expect(
      (await createSource("biorxiv", missing.client).healthCheck(ctx())).ok,
    ).toBe(false);
    const broken = createStubHttp((i) =>
      response(i.url, '{"messages":[{"status":"error"}]}'),
    );
    const failed = await createSource("biorxiv", broken.client).healthCheck(
      ctx(),
    );
    expect(failed).toMatchObject({ ok: false, messageKey: "rh-error-source" });
  });
});

describe("a free-text search through fanOut: skipped, not failed (P2-T28's keywordSearch: false)", () => {
  it("completes with the other source's records, no error on either preprint row, and the notice on each", async () => {
    const clock = createManualClock(NOW);
    const { client, issued } = createStubHttp(() => {
      throw new Error("a keyword search must not reach api.biorxiv.org");
    });
    const healthyRecord: SourceRecord = {
      id: "europepmc:PPR/PPR1",
      sourceId: "europepmc",
      nativeId: "PPR/PPR1",
      work: { ids: {}, type: "preprint", title: "Healthy", authors: [] },
      retrievedAtEpochMs: NOW,
      missingFields: [],
    };
    const biorxiv = createSource("biorxiv", client);
    const healthy: LiteratureSource = {
      ...biorxiv,
      id: "europepmc",
      displayNameKey: "research-helper-source-europepmc",
      capabilities: { ...BIORXIV_CAPABILITIES, keywordSearch: true },
      rateLimitKey: "www.ebi.ac.uk",
      explainQuery: () => "crispr",
      async *searchAll() {
        yield healthyRecord;
      },
    };
    const cancel = createCancellationTokenSource();
    const root = new CompositeProgressReporter({
      clock,
      sinks: [],
      throttleMs: 0,
      token: cancel.token,
    });
    const result = await fanOut({
      sources: [healthy, biorxiv, createSource("medrxiv", client)],
      input: { query: "crispr base editing", limit: 10, dateFilter: "none" },
      token: cancel.token,
      clock,
      progress: root.child("fetching", 0.05, 0.5),
      logger: createLogger({ sink: { write: () => undefined }, clock }),
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
    });
    expect(issued).toEqual([]);
    expect(result.state).toBe("succeeded");
    expect(result.records.map((r) => r.id)).toEqual(["europepmc:PPR/PPR1"]);
    for (const server of ["biorxiv", "medrxiv"] as const) {
      const row = must(
        result.perSource.find((r) => r.sourceId === server),
        `the ${server} row`,
      );
      expect(row.error).toBeUndefined();
      expect(row.recordsRetrieved).toBe(0);
      expect(row.warnings).toEqual([biorxivKeywordSearchNotice(server)]);
      expect(row.transmittedQuery).toBe(explainBiorxivQuery(server));
    }
  });

  // Owner's decision of 2026-10-15 (`plan/00` §6 item 177): Europe PMC's
  // default search already returns preprints (`docs/02` §4.5, measured from
  // the recorded `paginated-page-1` answer), so enabling bioRxiv or medRxiv
  // must leave the Europe PMC query exactly as it is. `AND SRC:PPR` would
  // narrow it to preprints and drop its journal results.
  it("leaves the Europe PMC query unrestricted when both preprint sources are enabled", async () => {
    const clock = createManualClock(NOW);
    const { client } = createStubHttp(() => {
      throw new Error("a keyword search must not reach api.biorxiv.org");
    });
    const biorxiv = createSource("biorxiv", client);
    const europepmc: LiteratureSource = {
      ...biorxiv,
      id: "europepmc",
      displayNameKey: "research-helper-source-europepmc",
      capabilities: { ...BIORXIV_CAPABILITIES, keywordSearch: true },
      rateLimitKey: "www.ebi.ac.uk",
      // The shipped renderer, so a planner that adds a clause through the
      // query it hands the adapter shows up in the transmitted text.
      explainQuery: explainEuropePmcQuery,
      async *searchAll() {
        // Nothing to yield: the transmitted query is what is under test.
      },
    };
    const cancel = createCancellationTokenSource();
    const root = new CompositeProgressReporter({
      clock,
      sinks: [],
      throttleMs: 0,
      token: cancel.token,
    });
    const query = "crispr base editing";
    const result = await fanOut({
      sources: [europepmc, biorxiv, createSource("medrxiv", client)],
      input: { query, limit: 10, dateFilter: "none" },
      token: cancel.token,
      clock,
      progress: root.child("fetching", 0.05, 0.5),
      logger: createLogger({ sink: { write: () => undefined }, clock }),
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
    });
    const row = must(
      result.perSource.find((r) => r.sourceId === "europepmc"),
      "the europepmc row",
    );
    expect(row.transmittedQuery).toBe(
      explainEuropePmcQuery({ terms: parseUserQuery(query), limit: 10 }),
    );
    expect(row.transmittedQuery).not.toMatch(/\bSRC:/u);
  });
});

// ---------------------------------------------------------------------------
// 7. Pacing through the shipped client on §7.3's bucket
// ---------------------------------------------------------------------------

class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}
class StubTimeoutException extends Error {}
class StubBrowserOfflineException extends Error {}
class StubSecurityException extends Error {}
class StubCancelledException extends Error {}

function cannedTransport(
  clock: ManualClock,
  body: string,
): HttpTransport & { readonly startedAt: number[] } {
  const startedAt: number[] = [];
  return {
    startedAt,
    request() {
      startedAt.push(clock.now());
      return Promise.resolve({
        status: 200,
        responseText: body,
        responseURL: "",
        getAllResponseHeaders: () => "content-type: application/json",
      });
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubTimeoutException,
    BrowserOfflineException: StubBrowserOfflineException,
    SecurityException: StubSecurityException,
    CancelledException: StubCancelledException,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("both sources through createHttpClient on the one api.biorxiv.org bucket", () => {
  it("lets a burst of two through and spaces the third >= 1000 ms later, across both servers", async () => {
    const clock = createManualClock(NOW);
    const policy = must(
      HOST_POLICIES.find((p) => p.host === BIORXIV_HOST),
      "the bioRxiv row",
    );
    const bucket = new TokenBucket(BIORXIV_HOST, policy.withoutKey, clock);
    const transport = cannedTransport(clock, NOT_FOUND_BODY);
    const client = createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
      limiterFor: (host) => (host === BIORXIV_HOST ? bucket : undefined),
    });
    const biorxiv = createSource("biorxiv", client);
    const medrxiv = createSource("medrxiv", client);
    const doi = (n: number) => ({
      doi: `10.64898/2026.01.01.00000${String(n)}` as Doi,
    });
    const calls = [
      biorxiv.lookup([doi(1)], ctx()),
      medrxiv.lookup([doi(2)], ctx()),
      biorxiv.lookup([doi(3)], ctx()),
    ];
    await flush();
    expect(transport.startedAt).toEqual([NOW, NOW]);
    let elapsed = 0;
    while (transport.startedAt.length < 3 && elapsed < 5_000) {
      clock.advance(1);
      elapsed += 1;
      await flush();
    }
    const third = must(transport.startedAt[2], "the third start");
    expect(third - NOW).toBeGreaterThanOrEqual(1000);
    expect(third - NOW).toBeLessThan(1100);
    expect(await Promise.all(calls)).toEqual([[], [], []]);
  });
});

// ---------------------------------------------------------------------------
// 8. Replay: test/fixtures/{biorxiv,medrxiv} through the shipped client
// ---------------------------------------------------------------------------

const BIORXIV_SCENARIOS = [
  "record-rich",
  "record-sparse",
  "record-unicode",
  "record-preprint",
  "pubs-old-style-doi",
  "search-empty",
  "pubs-not-found",
  "lookup-cross-server",
  "error-429",
  "error-500",
  "error-empty-body",
  "error-status",
  "error-malformed",
];
const MEDRXIV_SCENARIOS = [
  "record-rich",
  "record-sparse",
  "record-preprint",
  "search-empty",
  "error-429",
  "error-500",
  "error-empty-body",
  "error-status",
  "error-malformed",
];
const SYNTHETIC = [
  "error-429",
  "error-500",
  "error-empty-body",
  "error-status",
  "error-malformed",
];

function replaySource(server: BiorxivServer) {
  const replay = createReplayHttpClient({
    dir: FIXTURE_DIRS[server],
    host: BIORXIV_HOST,
  });
  const source = createBiorxivSource({
    server,
    http: replay.client,
    clock: replay.clock,
    mapRecords: createBiorxivRecordMapper({ clock: replay.clock }),
  });
  return { ...replay, source };
}

const ids = (doi: string) => [{ doi: doi as Doi }];

describe("replay: the recorded fixture sets", () => {
  for (const [server, expected] of [
    ["biorxiv", BIORXIV_SCENARIOS],
    ["medrxiv", MEDRXIV_SCENARIOS],
  ] as const) {
    it(`${server}: holds exactly its scenarios, each with a sidecar, synthetic where written`, async () => {
      const loaded = await listFixtureMeta(FIXTURE_DIRS[server]);
      expect(loaded.map((m) => m.meta.scenario).sort()).toEqual(
        [...expected].sort(),
      );
      const names = await readdir(FIXTURE_DIRS[server]);
      expect(names).toHaveLength(expected.length * 2);
      for (const { key, meta } of loaded) {
        expect(names).toContain(`${key}.json`);
        expect(names).toContain(`${key}${META_SUFFIX}`);
        expect(meta.method).toBe("GET");
        expect(meta.endpoint).toMatch(
          new RegExp(
            `^https://api\\.biorxiv\\.org/(details|pubs)/${server}$`,
            "u",
          ),
        );
        expect(meta.synthetic).toBe(SYNTHETIC.includes(meta.scenario));
      }
    });

    it(`${server}: carries no contact address in either spelling, no redaction marker, and is fresh`, async () => {
      const names = (await readdir(FIXTURE_DIRS[server])).filter((n) =>
        n.endsWith(".json"),
      );
      for (const name of names) {
        const text = await readFile(`${FIXTURE_DIRS[server]}/${name}`, "utf8");
        expect(text).not.toMatch(/suppakoko(@|%40)gmail/iu);
        expect(text).not.toMatch(/\[redacted:\d+\]/u);
      }
      const report = await assertFixturesFresh(
        FIXTURE_DIRS[server],
        Date.now(),
      );
      expect(report.checked).toBe(expected.length);
    });
  }

  it("bioRxiv record-rich: a legacy 10.1101/ record, published, mapped to biorxiv (criterion 5)", async () => {
    const { source, transport } = replaySource("biorxiv");
    const record = only(await source.lookup(ids(BIORXIV_DOI_RICH), ctx()));
    expect(record.sourceId).toBe("biorxiv");
    expect(record.work.ids.doi).toBe("10.1101/2025.09.17.676679");
    expect(record.work.relatedVersionIds).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
    expect(record.work.openAccess).toEqual({
      isOpenAccess: true,
      license: "cc_by_nc",
    });
    expect(record.work.authors.map((a) => a.family)).toEqual([
      "Zhao",
      "Zhu",
      "Yang",
      "Li",
    ]);
    expect(record.work.authors[3]?.isCorresponding).toBe(true);
    expect(record.work.subjects).toEqual([
      { term: "cell biology", scheme: "biorxiv-category" },
    ]);
    expect(record.missingFields).toEqual([]);
    const call = must(transport.calls[0], "the call");
    expect(call.options.headers?.["User-Agent"]).toMatch(
      /^research_helper\/0\.0\.2 \(https:\/\/github\.com\/suppakoko\/research_helper; mailto:suppakoko@gmail\.com\)$/u,
    );
  });

  it("10.64898/ on both servers: the server field decides (criterion 4, recorded)", async () => {
    const bio = only(
      await replaySource("biorxiv").source.lookup(
        ids(BIORXIV_DOI_SPARSE),
        ctx(),
      ),
    );
    const med = only(
      await replaySource("medrxiv").source.lookup(
        ids(MEDRXIV_DOI_SPARSE),
        ctx(),
      ),
    );
    expect(bio.work.ids.doi?.startsWith("10.64898/")).toBe(true);
    expect(med.work.ids.doi?.startsWith("10.64898/")).toBe(true);
    expect(bio.sourceId).toBe("biorxiv");
    expect(med.sourceId).toBe("medrxiv");
    expect(bio.work.relatedVersionIds).toBeUndefined();
    expect(med.work.openAccess?.license).toBe("cc_no");
    // medRxiv's run-in headings, measured in this very record.
    expect(med.work.abstract).toMatch(/^Importance: Current clinical/u);
    expect(med.work.abstract).toContain(
      "\n\nDesign, Setting, and Participants: Retrospective",
    );
  });

  it("medRxiv record-rich: two versions fold into one record dated by the first", async () => {
    const record = only(
      await replaySource("medrxiv").source.lookup(ids(MEDRXIV_DOI_RICH), ctx()),
    );
    expect(record.sourceId).toBe("medrxiv");
    expect(record.work.publishedDate?.iso).toBe("2020-04-17");
    expect(record.work.relatedVersionIds).toEqual({
      doi: "10.1093/ije/dyab010",
    });
    expect(record.work.authors).toHaveLength(17);
    expect(record.work.authors[0]).toMatchObject({
      family: "Bendavid",
      isCorresponding: true,
      affiliations: ["Stanford University"],
    });
    expect(record.work.abstract).toMatch(/^Background: Addressing COVID-19/u);
  });

  it("bioRxiv record-unicode: the title is kept byte for byte (a combining diaeresis)", async () => {
    const record = only(
      await replaySource("biorxiv").source.lookup(
        ids(BIORXIV_DOI_UNICODE),
        ctx(),
      ),
    );
    expect(record.work.title).toBe(
      "Schrödinger's Cat in Simulations in Genome-wide Association Studies",
    );
    expect(record.work.authors[0]).toEqual({
      family: "Ozkaraca",
      given: "M. I.",
      sequence: 0,
    });
  });

  it("record-preprint (/pubs/) on both servers: the cross-walk carries the published DOI", async () => {
    const bio = only(
      await replaySource("biorxiv").source.resolvePublished(
        ids(BIORXIV_DOI_RICH),
        ctx(),
      ),
    );
    expect(bio.sourceId).toBe("biorxiv");
    expect(bio.work.relatedVersionIds).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
    // The member the first recording scrubbed to "[redacted:41]".
    expect(bio.work.authors[3]?.affiliations?.[0]).toMatch(/^The Department/u);
    const med = only(
      await replaySource("medrxiv").source.resolvePublished(
        ids(MEDRXIV_DOI_RICH),
        ctx(),
      ),
    );
    expect(med.sourceId).toBe("medrxiv");
    expect(med.work.relatedVersionIds).toEqual({ doi: "10.1093/ije/dyab010" });
    expect(med.work.abstract).toMatch(/^Background: Addressing/u);
    expect(med.work.openAccess).toBeUndefined();
  });

  it("not found is no records, never an error: an absent DOI, a cross-server DOI, an unpublished or old-style DOI on /pubs/", async () => {
    const bio = replaySource("biorxiv").source;
    expect(await bio.lookup(ids(BIORXIV_DOI_ABSENT), ctx())).toEqual([]);
    // Measured: the host does not cross servers.
    expect(await bio.lookup(ids(BIORXIV_DOI_CROSS_SERVER), ctx())).toEqual([]);
    expect(await bio.resolvePublished(ids(BIORXIV_DOI_SPARSE), ctx())).toEqual(
      [],
    );
    expect(
      await bio.resolvePublished(ids(BIORXIV_DOI_OLD_STYLE), ctx()),
    ).toEqual([]);
    expect(
      await replaySource("medrxiv").source.lookup(
        ids(BIORXIV_DOI_ABSENT),
        ctx(),
      ),
    ).toEqual([]);
    expect(
      JSON.parse(
        (await recordedExchange("biorxiv", "pubs-not-found")).body,
      ) as unknown,
    ).toEqual({
      messages: [{ status: "no articles found for published version of " }],
      collection: [],
    });
  });

  for (const server of ["biorxiv", "medrxiv"] as const) {
    it(`${server}: the written error fixtures are typed errors`, async () => {
      const source = replaySource(server).source;
      await expect(
        source.lookup(ids(BIORXIV_DOI_SYNTHETIC_STATUS_ERROR), ctx()),
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof SourceError && !(e instanceof ParseError),
      );
      await expect(
        source.lookup(ids(BIORXIV_DOI_SYNTHETIC_EMPTY_BODY), ctx()),
      ).rejects.toBeInstanceOf(BiorxivEmptyBodyError);
      await expect(
        source.lookup(ids(BIORXIV_DOI_SYNTHETIC_MALFORMED), ctx()),
      ).rejects.toBeInstanceOf(ParseError);
      await expect(
        source.lookup(ids(BIORXIV_DOI_SYNTHETIC_429), ctx()),
      ).rejects.toBeInstanceOf(RateLimitError);
      await expect(
        source.lookup(ids(BIORXIV_DOI_SYNTHETIC_500), ctx()),
      ).rejects.toBeInstanceOf(UpstreamServerError);
    });
  }

  it("healthCheck replays against each server's record-sparse DOI", async () => {
    expect(BIORXIV_HEALTH_PROBE_DOIS).toEqual({
      biorxiv: BIORXIV_DOI_SPARSE,
      medrxiv: MEDRXIV_DOI_SPARSE,
    });
    for (const server of ["biorxiv", "medrxiv"] as const) {
      expect((await replaySource(server).source.healthCheck(ctx())).ok).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 9. registerSources — two slots, SOURCE_IDS order
// ---------------------------------------------------------------------------

describe("registerSources with the biorxiv and medrxiv slots", () => {
  const unreachable = () => {
    throw new Error("not called");
  };
  function stub(id: LiteratureSource["id"]): LiteratureSource {
    return {
      id,
      displayNameKey: `x-${id}`,
      capabilities: BIORXIV_CAPABILITIES,
      rateLimitKey: "h",
      isConfigured: () => true,
      healthCheck: unreachable,
      search: unreachable,
      searchAll: unreachable,
      explainQuery: unreachable,
    };
  }

  it("registers both after arxiv, in SOURCE_IDS order, whatever the literal's key order", () => {
    const registry = createSourceRegistry();
    const [pubmed, arxiv, biorxiv, medrxiv] = [
      stub("pubmed"),
      stub("arxiv"),
      stub("biorxiv"),
      stub("medrxiv"),
    ];
    registerSources(registry, { medrxiv, biorxiv, arxiv, pubmed });
    expect(registry.list()).toEqual([pubmed, arxiv, biorxiv, medrxiv]);
    expect(SOURCE_IDS.indexOf("biorxiv")).toBe(SOURCE_IDS.indexOf("arxiv") + 1);
    expect(SOURCE_IDS.indexOf("medrxiv")).toBe(
      SOURCE_IDS.indexOf("biorxiv") + 1,
    );
  });

  it("registers the real adapters under their own ids and rejects a crossed wiring", () => {
    const { client } = createStubHttp((i) => response(i.url, NOT_FOUND_BODY));
    const biorxiv = createSource("biorxiv", client);
    const medrxiv = createSource("medrxiv", client);
    const registry = createSourceRegistry();
    registerSources(registry, { pubmed: stub("pubmed"), biorxiv, medrxiv });
    expect(registry.get("biorxiv")).toBe(biorxiv);
    expect(registry.get("medrxiv")).toBe(medrxiv);
    expect(registry.listConfigured()).toEqual(
      expect.arrayContaining([biorxiv, medrxiv]),
    );
    expect(() =>
      registerSources(createSourceRegistry(), {
        pubmed: stub("pubmed"),
        biorxiv: medrxiv,
      }),
    ).toThrow(/supplied as "biorxiv" reports id "medrxiv"/u);
  });
});

// ---------------------------------------------------------------------------
// 10. The recorder's plans — docs/07 §11.1 step 5, docs/13 §3.2
// ---------------------------------------------------------------------------

describe("scripts/record-fixtures.ts: the bioRxiv and medRxiv plans", () => {
  for (const [server, independent] of [
    ["biorxiv", 8],
    ["medrxiv", 4],
  ] as const) {
    it(`${server}: plans every committed fixture under the key on disk, and nothing else`, async () => {
      const plan = planFor(server);
      expect(RECORDABLE_SOURCES).toContain(server);
      expect(plan.host).toBe(BIORXIV_HOST);
      expect(plan.fixtureDir).toBe(FIXTURE_DIRS[server]);
      expect(await plan.dependent(() => Promise.resolve(undefined))).toEqual(
        [],
      );
      expect(plan.independent()).toHaveLength(independent);
      const planned = [...plan.independent(), ...plan.syntheticRequests()];
      const onDisk = (await readdir(FIXTURE_DIRS[server]))
        .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
        .map((n) => n.replace(/\.json$/u, ""));
      const keys = planned.map((p) =>
        fixtureKey({ method: p.method, url: p.url }),
      );
      expect([...keys].sort()).toEqual([...onDisk].sort());
      for (const p of planned) {
        expect(p.url.startsWith(`https://api.biorxiv.org/`)).toBe(true);
        expect(p.url).toContain(`/${server}/`);
      }
    });
  }

  it("builds each scenario with the shipped builder", () => {
    expect(plannedRequest("record-rich", "biorxiv").url).toBe(
      recordedBiorxivRequest("details", "biorxiv", BIORXIV_DOI_RICH).url,
    );
    expect(plannedRequest("record-preprint", "medrxiv").url).toBe(
      recordedBiorxivRequest("pubs", "medrxiv", MEDRXIV_DOI_RICH).url,
    );
    expect(plannedRequest("lookup-cross-server", "biorxiv").url).toBe(
      "https://api.biorxiv.org/details/biorxiv/10.64898/2026.09.02.26361916/na/json",
    );
  });

  it("exempts exactly the one long member name from redaction, by name", () => {
    const plan = planFor("biorxiv");
    const tokens = must(plan.opaqueTokens, "the opaque-token hook");
    expect(tokens('{"preprint_author_corresponding_institution":"X"}')).toEqual(
      ["preprint_author_corresponding_institution"],
    );
    expect(tokens('{"author_corresponding_institution":"X"}')).toEqual([]);
    expect(tokens("preprint_author_corresponding_institution")).toEqual([]);
    expect(planFor("medrxiv").opaqueTokens).toBe(tokens);
  });
});

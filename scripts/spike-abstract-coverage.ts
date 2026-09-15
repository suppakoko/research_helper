/**
 * P0-T21 — measure abstract availability across the seven v1 sources (V-13).
 *
 * `docs/11` §4.3 `V-13` asks: for one realistic biomedical query, what
 * fraction of records from each source carries an abstract? The answer
 * calibrates R-17's mitigation (source priority, DOI backfill, a coverage
 * percentage in the import summary). This script issues that one query to
 * every source `docs/00` §3 D2 names, counts abstracts, records the shape each
 * source delivers them in, and quantifies the DOI-keyed backfill opportunity.
 *
 * **Every endpoint, parameter and limit below is taken from
 * `docs/02-literature-database-apis.md`; each request cites its section.**
 * Nothing here is composed from memory.
 *
 * Politeness, which the card ranks above completeness:
 *
 * - Requests are strictly sequential (one connection at a time, every host)
 *   and each host has a minimum end-to-start gap at or above `docs/02` §2.4's
 *   budget: NCBI 1 s (budget 2.5/s), Europe PMC 1 s (5/s), Crossref 1 s
 *   (polite pool 3/s), Semantic Scholar 1.2 s (0.9/s), arXiv 3.5 s (ToU: one
 *   request per 3 s), bioRxiv 1 s (§8.1: "treat conservatively: 1 req/s").
 * - Every request carries the D10 `User-Agent` (`docs/00` §3, `docs/02`
 *   §2.2); NCBI gets `tool`/`email` with the maintainer address, Crossref gets
 *   `mailto`, Europe PMC gets `email` (§2.2 "Final assignment"). A script has
 *   no user contact pref, so Crossref's `mailto` is the maintainer's.
 * - Semantic Scholar gets three attempts shaped like `docs/02` §6.4's own
 *   evidence (now, +8 s, +20 s) and nothing more. If all three are 429 the
 *   source is reported as unmeasurable without a key — not as 0 %.
 * - At most 100 records per source; no pagination beyond that.
 *
 * bioRxiv/medRxiv have **no keyword search** (`docs/02` §8.4, §12.2), so the
 * query cannot be sent to them at all. The script says so, and then measures
 * the two things that *are* possible, each labelled for what it is: the
 * abstract rate of their documented DOI lookup for preprint DOIs the query
 * surfaced elsewhere (their v1 role), and the abstract rate of an unfiltered
 * sample of the product's date window (explicitly not the query).
 *
 * XML (PubMed `efetch`, arXiv Atom) is read with narrow regular expressions
 * because this Node script has no `DOMParser`. `docs/02` §3.4 warns that regex
 * parsing is wrong for a *normalizer*; it is adequate for deciding whether an
 * abstract is non-empty and what markup it carries, which is all this
 * measures. Do not copy these extractors into `src/sources/`.
 *
 * Run it with (from the repository root):
 *
 * ```sh
 * npm exec -- tsx scripts/spike-abstract-coverage.ts
 * ```
 *
 * Exit code: 1 if the D10 identification audit finds any request that did
 * not carry the required identification, or if no source could be measured at
 * all; 0 otherwise. A Semantic Scholar 429 is a result, not a failure.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { type Doi, normalizeDoi } from "../src/model/ids";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The one query, fixed for the whole measurement. It is `docs/02`'s own
 * running biomedical example (§3.3, §5.3, §5.4), which makes the Crossref
 * figure directly comparable with §5.4's documented 51 %. It contains no
 * hyphen, so Semantic Scholar's `/paper/search` receives it unchanged
 * (§6.5: "Hyphenated terms yield no matches").
 */
const QUERY_TEXT = "CRISPR base editing";

/** Card `P0-T21` step 2: "fetch up to 100 records". */
const MAX_RECORDS = 100;

/**
 * `docs/02` §2.0: three calendar years, the current year and the two before
 * it (`08-ui-ux-spec.md` §4.2 owns the computation, FR-3 the requirement).
 */
const TO_YEAR = new Date().getUTCFullYear();
const FROM_YEAR = TO_YEAR - 2;

/** Decision D10 (`docs/00` §3): the maintainer address, fixed at build time. */
const MAINTAINER_EMAIL = "suppakoko@gmail.com";

/** `docs/02` §3.1: `tool=research_helper`. */
const NCBI_TOOL = "research_helper";

/** Per-request timeout. bioRxiv's three-year interval listing can be slow. */
const TIMEOUT_MS = 90_000;

/**
 * Minimum gap, in milliseconds, between the end of one response and the start
 * of the next request to the same host. Each value is at or below the rate
 * `docs/02` documents for that host; do not lower any of them.
 */
const HOST_SPACING_MS: Readonly<Record<string, number>> = {
  "eutils.ncbi.nlm.nih.gov": 1_000, // §3.1: 3 req/s without a key; §2.4: 2.5/s
  "www.ebi.ac.uk": 1_000, // §4.1 / §2.4: 5 req/s shipped budget
  "api.crossref.org": 1_000, // §5.1: polite pool, 3 req/s for list queries
  "api.semanticscholar.org": 1_200, // §2.4: 0.9 req/s in both modes
  "export.arxiv.org": 3_500, // §7.1: 1 request per 3 s, hard ToU obligation
  "api.biorxiv.org": 1_000, // §8.1: treat conservatively as 1 req/s
};

/** Retry waits (ms) for 429/503 on ordinary hosts — §2.4: back off, then stop. */
const STANDARD_RETRY: readonly number[] = [10_000];

/** Semantic Scholar: `docs/02` §6.4's evidence shape — now, +8 s, +20 s. */
const S2_RETRY: readonly number[] = [8_000, 20_000];

/**
 * arXiv: one retry, 30 s later. The first run of this script met an
 * undocumented HTTP 429 on its very first arXiv request; a 3 s-rule host is
 * given ten slots of quiet before the single retry, and nothing more.
 */
const ARXIV_RETRY: readonly number[] = [30_000];

/** At most this many preprint DOIs are looked up at bioRxiv/medRxiv. */
const MAX_PREPRINT_LOOKUPS = 20;

/** Europe PMC DOI-backfill batch size (§10.4: "never one lookup per record"). */
const EPMC_BACKFILL_BATCH = 25;

/** Abstracts shorter than this (plain-text characters) are flagged, not dropped. */
const SHORT_ABSTRACT_CHARS = 100;

/** Length of the verbatim abstract example printed per shape. */
const EXAMPLE_CHARS = 80;

// ---------------------------------------------------------------------------
// User-Agent (identical construction to scripts/spike-s2-throttle.ts)
// ---------------------------------------------------------------------------

/** `docs/02` §2.2's exact `User-Agent` form with the D10 maintainer address. */
function buildUserAgent(version: string): string {
  return (
    `research_helper/${version} ` +
    `(https://github.com/suppakoko/research_helper; mailto:${MAINTAINER_EMAIL})`
  );
}

/** Reads `version` out of the repository's `package.json`. */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "..", "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }
  throw new Error("package.json has no string `version` field");
}

const USER_AGENT = buildUserAgent(readPackageVersion());

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function report(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function heading(title: string): void {
  report();
  report("=".repeat(78));
  report(title);
  report("=".repeat(78));
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)} %`;
}

function trimTo(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---------------------------------------------------------------------------
// JSON helpers (responses are `unknown` until proven otherwise)
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function at(v: unknown, ...keys: readonly string[]): unknown {
  let cur = v;
  for (const key of keys) cur = isObj(cur) ? cur[key] : undefined;
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi,
    (whole, ent: string) => {
      const lower = ent.toLowerCase();
      if (lower.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      }
      if (lower.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      }
      return NAMED_ENTITIES[lower] ?? whole;
    },
  );
}

/** Tags stripped, entities decoded, whitespace collapsed. */
function plainText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Classifies how a source delivered its abstract string. */
function genericShape(raw: string): string {
  let shape: string;
  if (/<jats:/i.test(raw)) shape = "JATS XML (jats:-prefixed tags)";
  else if (/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i.test(raw)) {
    shape = "text with inline HTML/XML tags";
  } else if (/\n[ \t]+\S/.test(raw)) {
    shape = "plain text, hard-wrapped (newline + indent)";
  } else shape = "plain text";
  if (/&(?:#\d+|#x[0-9a-f]+|lt|gt|amp|quot|apos);/i.test(raw)) {
    shape += ", with character entities";
  }
  // bioRxiv/medRxiv flatten JATS into marker tokens such as `O_SCPCAP` /
  // `C_SCPCAP` (small caps) and `O_FIG` — observed in `/pubs/` abstracts.
  if (/\b[OC]_[A-Z]{2,}/.test(raw)) {
    shape += ", with O_…/C_… markup-conversion tokens";
  }
  return shape;
}

// ---------------------------------------------------------------------------
// HTTP: one polite, sequential, logged GET
// ---------------------------------------------------------------------------

interface RequestLogEntry {
  readonly seq: number;
  readonly label: string;
  readonly url: string;
  /** Exactly the header object handed to `fetch`. */
  readonly headersSent: Readonly<Record<string, string>>;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly status: number | null;
  /** Selected response headers worth keeping as evidence. */
  readonly evidence: string;
  readonly transportError: string | null;
}

interface HttpResult {
  readonly status: number | null;
  readonly body: string;
  readonly headers: Headers | null;
  readonly error: string | null;
}

const EVIDENCE_HEADERS = [
  "x-ratelimit-limit",
  "x-api-pool",
  "x-rate-limit-limit",
  "x-rate-limit-interval",
  "retry-after",
  "x-amzn-errortype",
];

const RUN_STARTED_AT = Date.now();
const requestLog: RequestLogEntry[] = [];
const lastFinishedAt = new Map<string, number>();

async function politeGet(
  label: string,
  url: string,
  accept: string,
  retryWaitsMs: readonly number[],
): Promise<HttpResult> {
  const host = new URL(url).host;
  const spacing = HOST_SPACING_MS[host] ?? 3_000;
  const headersSent: Readonly<Record<string, string>> = {
    "User-Agent": USER_AGENT,
    Accept: accept,
  };

  let result: HttpResult = {
    status: null,
    body: "",
    headers: null,
    error: "not attempted",
  };
  for (let attempt = 0; attempt <= retryWaitsMs.length; attempt += 1) {
    const previous = lastFinishedAt.get(host);
    if (previous !== undefined) {
      const wait = previous + spacing - Date.now();
      if (wait > 0) await sleep(wait);
    }

    const t0 = Date.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: headersSent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await response.text();
      result = {
        status: response.status,
        body,
        headers: response.headers,
        error: null,
      };
    } catch (error) {
      result = {
        status: null,
        body: "",
        headers: null,
        error: error instanceof Error ? `${error.name}: ${error.message}` : "?",
      };
    }
    lastFinishedAt.set(host, Date.now());

    const evidence = EVIDENCE_HEADERS.flatMap((name) => {
      const value = result.headers?.get(name);
      return value === null || value === undefined ? [] : [`${name}=${value}`];
    }).join(" ");
    const entry: RequestLogEntry = {
      seq: requestLog.length + 1,
      label: attempt === 0 ? label : `${label} [retry ${String(attempt)}]`,
      url,
      headersSent,
      startedAtMs: t0 - RUN_STARTED_AT,
      durationMs: Date.now() - t0,
      status: result.status,
      evidence,
      transportError: result.error,
    };
    requestLog.push(entry);
    report(
      `  #${String(entry.seq).padStart(2)} ${entry.label}: ` +
        (result.status === null
          ? `transport error (${String(result.error)})`
          : `HTTP ${String(result.status)}`) +
        ` in ${String(entry.durationMs)} ms${evidence ? ` [${evidence}]` : ""}`,
    );

    const retryable = result.status === 429 || result.status === 503;
    const nextWait = retryWaitsMs[attempt];
    if (!retryable || nextWait === undefined) return result;
    const retryAfterS = Number(result.headers?.get("retry-after") ?? "");
    const wait =
      Number.isFinite(retryAfterS) && retryAfterS > 0
        ? Math.min(60_000, Math.max(nextWait, retryAfterS * 1_000))
        : nextWait;
    report(`      HTTP ${String(result.status)}; waiting ${String(wait)} ms`);
    await sleep(wait);
  }
  return result;
}

function describeFailure(r: HttpResult): string {
  return r.status === null
    ? `transport error: ${String(r.error)}`
    : `HTTP ${String(r.status)}: ${trimTo(r.body.replace(/\s+/g, " "), 200)}`;
}

// ---------------------------------------------------------------------------
// Records and measurements
// ---------------------------------------------------------------------------

type SourceName =
  | "PubMed"
  | "Europe PMC"
  | "Crossref"
  | "Semantic Scholar"
  | "arXiv"
  | "bioRxiv"
  | "medRxiv";

interface CoverageRecord {
  readonly source: SourceName;
  readonly nativeId: string;
  readonly doi: Doi | null;
  /** The abstract exactly as delivered (PubMed: the joined AbstractText XML). */
  readonly rawAbstract: string | null;
  /** Length of the abstract after tag stripping; 0 means "no abstract". */
  readonly abstractChars: number;
  readonly shape: string | null;
  /** Preprint server when the source states it (`bioRxiv` / `medRxiv`). */
  readonly server: string | null;
  /** Free-form per-source detail, e.g. Europe PMC's corpus code. */
  readonly detail: string;
}

type Outcome = "measured" | "unmeasurable" | "not applicable" | "failed";

interface SourceMeasurement {
  readonly label: string;
  readonly source: SourceName;
  readonly outcome: Outcome;
  readonly reason: string;
  /** The query as rendered for this source, verbatim. */
  readonly rendering: string;
  readonly reportedHits: string;
  readonly records: readonly CoverageRecord[];
  readonly notes: readonly string[];
  /** Whether these records answer the fixed query (and so enter the overlap). */
  readonly queryDerived: boolean;
}

function makeRecord(
  source: SourceName,
  nativeId: string,
  rawDoi: string | null,
  rawAbstract: string | null,
  shapeOverride: string | null,
  server: string | null,
  detail: string,
): CoverageRecord {
  const text = rawAbstract === null ? "" : plainText(rawAbstract);
  const has = text.length > 0 && rawAbstract !== null;
  return {
    source,
    nativeId,
    doi: normalizeDoi(rawDoi),
    rawAbstract,
    abstractChars: text.length,
    shape: has ? (shapeOverride ?? genericShape(rawAbstract)) : null,
    server,
    detail,
  };
}

function hasAbstract(r: CoverageRecord): boolean {
  return r.abstractChars > 0;
}

// ---------------------------------------------------------------------------
// PubMed — docs/02 §3.3 esearch, §3.4 efetch, §12.2 date rendering
// ---------------------------------------------------------------------------

const NCBI_IDENT: Readonly<Record<string, string>> = {
  tool: NCBI_TOOL,
  email: MAINTAINER_EMAIL,
};

function withParams(base: string, params: Readonly<Record<string, string>>) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function parsePubmedXml(xml: string): CoverageRecord[] {
  const out: CoverageRecord[] = [];
  const articleRe = /<(PubmedArticle|PubmedBookArticle)>([\s\S]*?)<\/\1>/g;
  for (const m of xml.matchAll(articleRe)) {
    const kind = m[1] ?? "";
    const body = m[2] ?? "";
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(body)?.[1] ?? "?";
    // The article's own ArticleIdList precedes <ReferenceList>, whose entries
    // carry the *cited* works' DOIs (docs/02 §3.4 parsing note 7).
    const own = body.split("<ReferenceList")[0] ?? body;
    const doi =
      /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/.exec(own)?.[1] ??
      /<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/.exec(own)?.[1] ??
      null;
    // `<Abstract>` only — not `<OtherAbstract>`, and CopyrightInformation is
    // excluded from the text so a copyright line never counts as an abstract.
    const abstractXml =
      /<Abstract(?:\s[^>]*)?>([\s\S]*?)<\/Abstract>/.exec(body)?.[1] ?? null;
    let raw: string | null = null;
    let shape: string | null = null;
    if (abstractXml !== null) {
      const parts = [
        ...abstractXml.matchAll(
          /<AbstractText(\s[^>]*)?>([\s\S]*?)<\/AbstractText>/g,
        ),
      ];
      if (parts.length > 0) {
        // The <AbstractText …> elements themselves, so a structured example
        // shows its Label= attributes; plainText() strips them for counting.
        raw = parts.map((p) => p[0]).join("\n");
        const labelled = parts.filter((p) =>
          /\bLabel="/.test(p[1] ?? ""),
        ).length;
        const inline = parts.some((p) => /<[a-z]/i.test(p[2] ?? ""));
        shape =
          labelled > 0
            ? "PubMed XML: structured (labelled <AbstractText> sections)"
            : parts.length > 1
              ? "PubMed XML: multiple unlabelled <AbstractText>"
              : "PubMed XML: single unlabelled <AbstractText>";
        if (inline) shape += " + inline tags";
      }
    }
    out.push(makeRecord("PubMed", `PMID:${pmid}`, doi, raw, shape, null, kind));
  }
  return out;
}

async function measurePubMed(): Promise<SourceMeasurement> {
  // §12.2 PubMed rendering: `AND ("YYYY/01/01"[EDAT] : "YYYY/12/31"[EDAT])`.
  const term = `(${QUERY_TEXT}) AND ("${String(FROM_YEAR)}/01/01"[EDAT] : "${String(TO_YEAR)}/12/31"[EDAT])`;
  const base = {
    label: "PubMed",
    source: "PubMed" as const,
    rendering: `esearch.fcgi term=${term} sort=relevance retmax=${String(MAX_RECORDS)}; then efetch.fcgi rettype=abstract retmode=xml`,
    queryDerived: true,
  };
  report("PubMed (docs/02 §3.3 esearch → §3.4 efetch)");
  const esearch = await politeGet(
    "PubMed esearch §3.3",
    withParams("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
      db: "pubmed",
      term,
      retmax: String(MAX_RECORDS),
      retmode: "json",
      sort: "relevance",
      ...NCBI_IDENT,
    }),
    "application/json",
    STANDARD_RETRY,
  );
  if (esearch.status !== 200) {
    return failed(base, `esearch ${describeFailure(esearch)}`);
  }
  const json = parseJson(esearch.body);
  const error = str(at(json, "esearchresult", "ERROR"));
  if (error !== null) return failed(base, `esearchresult.ERROR: ${error}`);
  const ids = arr(at(json, "esearchresult", "idlist")).flatMap((v) => {
    const s = str(v);
    return s === null ? [] : [s];
  });
  const count = str(at(json, "esearchresult", "count")) ?? "?";
  const translation = str(at(json, "esearchresult", "querytranslation")) ?? "";
  if (ids.length === 0) {
    return {
      ...base,
      outcome: "measured",
      reason: "",
      reportedHits: count,
      records: [],
      notes: ["esearch returned no PMIDs"],
    };
  }

  const efetch = await politeGet(
    "PubMed efetch §3.4",
    withParams("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", {
      db: "pubmed",
      id: ids.join(","),
      rettype: "abstract",
      retmode: "xml",
      ...NCBI_IDENT,
    }),
    "application/xml",
    STANDARD_RETRY,
  );
  if (efetch.status !== 200) {
    return failed(base, `efetch ${describeFailure(efetch)}`);
  }
  const records = parsePubmedXml(efetch.body);
  const books = records.filter((r) => r.detail === "PubmedBookArticle").length;
  return {
    ...base,
    outcome: "measured",
    reason: "",
    reportedHits: count,
    records,
    notes: [
      `esearch idlist: ${String(ids.length)} PMIDs; efetch parsed: ${String(records.length)} records (${String(books)} PubmedBookArticle)`,
      `querytranslation: ${trimTo(translation, 300)}`,
    ],
  };
}

function failed(
  base: Pick<
    SourceMeasurement,
    "label" | "source" | "rendering" | "queryDerived"
  >,
  reason: string,
): SourceMeasurement {
  return {
    ...base,
    outcome: "failed",
    reason,
    reportedHits: "?",
    records: [],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Europe PMC — docs/02 §4.2 search, §4.4 resultType=core, §12.2 rendering
// ---------------------------------------------------------------------------

const EPMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

function parseEpmcResults(json: unknown): CoverageRecord[] {
  return arr(at(json, "resultList", "result")).map((item) => {
    const corpus = str(at(item, "source")) ?? "?";
    const publisher = str(at(item, "bookOrReportDetails", "publisher"));
    return makeRecord(
      "Europe PMC",
      `${corpus}:${str(at(item, "id")) ?? "?"}`,
      str(at(item, "doi")),
      str(at(item, "abstractText")),
      null,
      publisher,
      corpus,
    );
  });
}

async function measureEuropePmc(): Promise<SourceMeasurement> {
  const query = `(${QUERY_TEXT}) AND (FIRST_PDATE:[${String(FROM_YEAR)}-01-01 TO ${String(TO_YEAR)}-12-31])`;
  const base = {
    label: "Europe PMC",
    source: "Europe PMC" as const,
    rendering: `search query=${query} resultType=core pageSize=${String(MAX_RECORDS)} cursorMark=*`,
    queryDerived: true,
  };
  report("Europe PMC (docs/02 §4.4 search, resultType=core)");
  const res = await politeGet(
    "Europe PMC search §4.4",
    withParams(EPMC_SEARCH, {
      query,
      resultType: "core",
      format: "json",
      pageSize: String(MAX_RECORDS),
      cursorMark: "*",
      email: MAINTAINER_EMAIL,
    }),
    "application/json",
    STANDARD_RETRY,
  );
  if (res.status !== 200) return failed(base, describeFailure(res));
  const json = parseJson(res.body);
  if (at(json, "errCode") !== undefined) {
    return failed(base, `errCode in 200 body (§4.9): ${trimTo(res.body, 200)}`);
  }
  const records = parseEpmcResults(json);
  const byCorpus = new Map<string, { n: number; withAbs: number }>();
  for (const r of records) {
    const slot = byCorpus.get(r.detail) ?? { n: 0, withAbs: 0 };
    slot.n += 1;
    if (hasAbstract(r)) slot.withAbs += 1;
    byCorpus.set(r.detail, slot);
  }
  const corpusLine = [...byCorpus]
    .map(([k, v]) => `${k} ${String(v.withAbs)}/${String(v.n)}`)
    .join(", ");
  return {
    ...base,
    outcome: "measured",
    reason: "",
    reportedHits: String(at(json, "hitCount") ?? "?"),
    records,
    notes: [`with-abstract / returned, by corpus code: ${corpusLine}`],
  };
}

// ---------------------------------------------------------------------------
// Crossref — docs/02 §5.1 polite pool, §5.2 /works, §5.4 abstracts, §12.2
// ---------------------------------------------------------------------------

async function measureCrossref(): Promise<SourceMeasurement> {
  const filter = `from-pub-date:${String(FROM_YEAR)}-01-01,until-pub-date:${String(TO_YEAR)}-12-31,type:journal-article`;
  const base = {
    label: "Crossref",
    source: "Crossref" as const,
    rendering: `/works query.bibliographic=${QUERY_TEXT} filter=${filter} rows=${String(MAX_RECORDS)} select=DOI,title,abstract,type`,
    queryDerived: true,
  };
  report("Crossref (docs/02 §5.2 /works, §5.3 select)");
  const res = await politeGet(
    "Crossref /works §5.2",
    withParams("https://api.crossref.org/works", {
      "query.bibliographic": QUERY_TEXT,
      filter,
      rows: String(MAX_RECORDS),
      select: "DOI,title,abstract,type",
      mailto: MAINTAINER_EMAIL,
    }),
    "application/json",
    STANDARD_RETRY,
  );
  if (res.status !== 200) return failed(base, describeFailure(res));
  const json = parseJson(res.body);
  const items = arr(at(json, "message", "items"));
  const records = items.map((item) =>
    makeRecord(
      "Crossref",
      str(at(item, "DOI")) ?? "?",
      str(at(item, "DOI")),
      str(at(item, "abstract")),
      null,
      null,
      str(at(item, "type")) ?? "?",
    ),
  );
  const total = at(json, "message", "total-results");
  const pool = res.headers?.get("x-api-pool") ?? "(absent)";

  // §5.4 documents 51 % of the *whole* result set having `has-abstract:true`
  // for this query family. One rows=1 request re-measures that denominator
  // ratio so the top-100 number can be read against it.
  const withAbs = await politeGet(
    "Crossref /works has-abstract:true §5.2/§5.4",
    withParams("https://api.crossref.org/works", {
      "query.bibliographic": QUERY_TEXT,
      filter: `${filter},has-abstract:true`,
      rows: "1",
      select: "DOI",
      mailto: MAINTAINER_EMAIL,
    }),
    "application/json",
    STANDARD_RETRY,
  );
  const totalWithAbs =
    withAbs.status === 200
      ? at(parseJson(withAbs.body), "message", "total-results")
      : undefined;
  const totalN = typeof total === "number" ? total : Number.NaN;
  const withN = typeof totalWithAbs === "number" ? totalWithAbs : Number.NaN;
  return {
    ...base,
    outcome: "measured",
    reason: "",
    reportedHits: String(total ?? "?"),
    records,
    notes: [
      `x-api-pool: ${pool} (§5.1: polite-array expected)`,
      `whole result set: total-results ${String(total ?? "?")}; with filter has-abstract:true ${String(totalWithAbs ?? "?")} → ${Number.isFinite(totalN) && Number.isFinite(withN) ? pct(withN, totalN) : "n/a"} (§5.4 documents ~51 % for its 2023– window)`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Semantic Scholar — docs/02 §6.4 limits, §6.5 /paper/search, §12.2
// ---------------------------------------------------------------------------

async function measureSemanticScholar(): Promise<SourceMeasurement> {
  const params: Readonly<Record<string, string>> = {
    query: QUERY_TEXT,
    year: `${String(FROM_YEAR)}-${String(TO_YEAR)}`,
    publicationDateOrYear: `${String(FROM_YEAR)}-01-01:${String(TO_YEAR)}-12-31`,
    limit: String(MAX_RECORDS),
    fields: "title,abstract,externalIds,tldr",
  };
  const base = {
    label: "Semantic Scholar",
    source: "Semantic Scholar" as const,
    rendering: `/paper/search ${Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")} (no x-api-key)`,
    queryDerived: true,
  };
  report("Semantic Scholar (docs/02 §6.5 /paper/search; ≤3 attempts per §6.4)");
  const res = await politeGet(
    "Semantic Scholar /paper/search §6.5",
    withParams("https://api.semanticscholar.org/graph/v1/paper/search", params),
    "application/json",
    S2_RETRY,
  );
  if (res.status === 429) {
    return {
      ...base,
      outcome: "unmeasurable",
      reason: `HTTP 429 on all ${String(S2_RETRY.length + 1)} attempts (now, +8 s, +20 s); no records obtained. Body: ${trimTo(res.body, 200)}`,
      reportedHits: "?",
      records: [],
      notes: [
        "Recorded separately per the card: a 429 is P0-T22's subject, not a coverage finding.",
      ],
    };
  }
  if (res.status !== 200) return failed(base, describeFailure(res));
  const json = parseJson(res.body);
  const records = arr(at(json, "data")).map((item) =>
    makeRecord(
      "Semantic Scholar",
      str(at(item, "paperId")) ?? "?",
      str(at(item, "externalIds", "DOI")),
      str(at(item, "abstract")),
      null,
      null,
      str(at(item, "tldr", "text")) === null ? "no-tldr" : "tldr",
    ),
  );
  const lacking = records.filter((r) => !hasAbstract(r));
  const lackingWithTldr = lacking.filter((r) => r.detail === "tldr").length;
  return {
    ...base,
    outcome: "measured",
    reason: "",
    reportedHits: String(at(json, "total") ?? "?"),
    records,
    notes: [
      `records lacking an abstract that carry a tldr (§6.7 fallback): ${String(lackingWithTldr)}/${String(lacking.length)}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// arXiv — docs/02 §7.1 limits, §7.2 params, §7.3 dates, §7.5 parsing
// ---------------------------------------------------------------------------

async function measureArxiv(): Promise<SourceMeasurement> {
  // §7.2 `all:` prefix per term, `AND`; §7.3 submittedDate range, encoded as
  // §7.3 shows (`[`→%5B, `]`→%5D, space→+). §7.1: https directly.
  const terms = QUERY_TEXT.split(/\s+/)
    .map((t) => `all:${encodeURIComponent(t)}`)
    .join("+AND+");
  const searchQuery = `${terms}+AND+submittedDate:%5B${String(FROM_YEAR)}01010000+TO+${String(TO_YEAR)}12312359%5D`;
  const url =
    `https://export.arxiv.org/api/query?search_query=${searchQuery}` +
    `&start=0&max_results=${String(MAX_RECORDS)}&sortBy=relevance&sortOrder=descending`;
  const base = {
    label: "arXiv",
    source: "arXiv" as const,
    rendering: `search_query=${decodeURIComponent(searchQuery.replace(/\+/g, " "))} max_results=${String(MAX_RECORDS)} sortBy=relevance`,
    queryDerived: true,
  };
  report("arXiv (docs/02 §7.2–§7.3 /api/query)");
  const res = await politeGet(
    "arXiv /api/query §7.2",
    url,
    "application/atom+xml",
    ARXIV_RETRY,
  );
  if (res.status === 429) {
    // docs/02 §7 documents no 429 for this host; record it verbatim.
    return {
      ...base,
      outcome: "unmeasurable",
      reason:
        `HTTP 429 on both attempts (now, +30 s); no records obtained. ` +
        `Body ${JSON.stringify(trimTo(res.body, 100))}; ` +
        `server: ${res.headers?.get("server") ?? "absent"}; ` +
        `retry-after: ${res.headers?.get("retry-after") ?? "absent"}; ` +
        `content-type: ${res.headers?.get("content-type") ?? "absent"}`,
      reportedHits: "?",
      records: [],
      notes: [],
    };
  }
  if (res.status !== 200) return failed(base, describeFailure(res));
  if (res.body.includes("<id>http://arxiv.org/api/errors")) {
    return failed(
      base,
      `Atom error feed (§7.5 note 6): ${trimTo(res.body, 300)}`,
    );
  }
  const total =
    /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/.exec(
      res.body,
    )?.[1] ?? "?";
  let journalDois = 0;
  const records: CoverageRecord[] = [];
  for (const m of res.body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1] ?? "";
    const idUrl = /<id>([^<]+)<\/id>/.exec(entry)?.[1] ?? "";
    const arxivId = /abs\/(.+?)(?:v\d+)?$/.exec(idUrl.trim())?.[1] ?? "?";
    const journalDoi =
      /<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/.exec(entry)?.[1] ?? null;
    if (journalDoi !== null) journalDois += 1;
    // §7.5 note 5: the published DOI when present, else the DataCite DOI.
    const doi = journalDoi ?? `10.48550/arXiv.${arxivId}`;
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(entry)?.[1];
    records.push(
      makeRecord(
        "arXiv",
        `arXiv:${arxivId}`,
        doi,
        summary ?? null,
        null,
        null,
        journalDoi === null ? "datacite-doi" : "journal-doi",
      ),
    );
  }
  return {
    ...base,
    outcome: "measured",
    reason: "",
    reportedHits: total,
    records,
    notes: [
      `entries carrying <arxiv:doi> (published version): ${String(journalDois)}/${String(records.length)}; the rest keyed by constructed 10.48550/arXiv.<id>`,
    ],
  };
}

// ---------------------------------------------------------------------------
// bioRxiv / medRxiv — docs/02 §8.2 endpoints, §8.4 no keyword search
// ---------------------------------------------------------------------------

type Server = "biorxiv" | "medrxiv";

function serverSource(server: string): SourceName {
  return server.toLowerCase() === "medrxiv" ? "medRxiv" : "bioRxiv";
}

/**
 * bioRxiv/medRxiv preprint DOIs as `docs/02` §11.2 describes them: prefix
 * `10.1101/` (legacy) or `10.64898/` (current), with the dated accession
 * suffix. The suffix test matters — `10.1101/` is also Cold Spring Harbor's
 * journal prefix (`10.1101/gr.…`, `10.1101/gad.…`).
 */
function isPreprintServerDoi(doi: string): boolean {
  return /^10\.(1101|64898)\/\d{4}\.\d{2}\.\d{2}\.\d+$/.test(doi);
}

function notApplicable(source: SourceName): SourceMeasurement {
  return {
    label: `${source} — keyword search`,
    source,
    outcome: "not applicable",
    reason:
      "docs/02 §8.4: the API has no keyword search; §12.2: the translator emits no bioRxiv query. No request sent.",
    rendering: "(none — not expressible)",
    reportedHits: "n/a",
    records: [],
    notes: [],
    queryDerived: true,
  };
}

async function measurePreprintLookups(
  queryMeasurements: readonly SourceMeasurement[],
): Promise<SourceMeasurement[]> {
  const candidates = new Map<Doi, Server | null>();
  for (const m of queryMeasurements) {
    for (const r of m.records) {
      if (r.doi === null || !isPreprintServerDoi(r.doi)) continue;
      const hint = r.server?.toLowerCase();
      const server: Server | null =
        hint === "biorxiv" || hint === "medrxiv" ? hint : null;
      if (!candidates.has(r.doi) || server !== null) {
        candidates.set(r.doi, server);
      }
    }
  }
  const chosen = [...candidates].slice(0, MAX_PREPRINT_LOOKUPS);
  report(
    `bioRxiv/medRxiv DOI lookup (docs/02 §8.2 /details/{server}/{DOI}/na/json): ` +
      `${String(candidates.size)} preprint-server DOIs in the query results, looking up ${String(chosen.length)}`,
  );

  const found: CoverageRecord[] = [];
  const outcomes = new Map<string, number>();
  const tally = (key: string): void => {
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  };
  for (const [doi, hint] of chosen) {
    const servers: readonly Server[] =
      hint === "medrxiv"
        ? ["medrxiv"]
        : hint === "biorxiv"
          ? ["biorxiv"]
          : ["biorxiv", "medrxiv"];
    let hit: CoverageRecord | null = null;
    // §8.2 lists both DOI forms; §8.4's table names `/details/…/{DOI}/na/json`
    // for metadata of a known preprint and `/pubs/` for the published link.
    // `/pubs/` is tried only when `/details/` yields nothing, and it can only
    // answer for preprints that have a published version.
    for (const endpoint of ["details", "pubs"] as const) {
      for (const server of servers) {
        const res = await politeGet(
          `${server} /${endpoint} DOI §8.2`,
          `https://api.biorxiv.org/${endpoint}/${server}/${doi}/na/json`,
          "application/json",
          STANDARD_RETRY,
        );
        const env = biorxivEnvelope(res);
        if (!env.ok) {
          tally(`/${endpoint}: ${env.why}`);
          continue;
        }
        const versions = arr(at(env.json, "collection"));
        const latest = versions[versions.length - 1];
        if (latest === undefined) {
          tally(
            `/${endpoint}: envelope ok, empty collection (messages[0].status=${String(env.status)})`,
          );
          continue;
        }
        const serverName =
          str(
            at(latest, endpoint === "details" ? "server" : "preprint_platform"),
          ) ?? server;
        hit = makeRecord(
          serverSource(serverName),
          doi,
          str(at(latest, endpoint === "details" ? "doi" : "preprint_doi")) ??
            doi,
          str(
            at(
              latest,
              endpoint === "details" ? "abstract" : "preprint_abstract",
            ),
          ),
          null,
          serverName,
          `via /${endpoint}`,
        );
        tally(`/${endpoint}: found`);
        break;
      }
      if (hit !== null) break;
    }
    if (hit === null) tally("not found by any endpoint");
    else found.push(hit);
  }

  const outcomeLine = [...outcomes]
    .map(([k, n]) => `${k} ×${String(n)}`)
    .join("; ");
  const out: SourceMeasurement[] = [];
  for (const source of ["bioRxiv", "medRxiv"] as const) {
    const records = found.filter((r) => r.source === source);
    out.push({
      label: `${source} — DOI lookup of query DOIs`,
      source,
      outcome: "measured",
      reason: "",
      rendering: `/details/${source.toLowerCase()}/{DOI}/na/json, then /pubs/${source.toLowerCase()}/{DOI}/na/json (§8.2) for preprint DOIs surfaced by the other sources`,
      reportedHits: `${String(records.length)} found`,
      records,
      notes: [
        `candidates ${String(candidates.size)}, looked up ${String(chosen.length)}, found ${String(found.length)} (both servers together): ` +
          chosen
            .map(([doi, hint]) => `${doi} (hint ${hint ?? "none"})`)
            .join(", "),
        `response outcomes across both servers: ${outcomeLine || "(none)"}`,
      ],
      queryDerived: true,
    });
  }
  return out;
}

type BiorxivEnvelope =
  | { readonly ok: true; readonly json: unknown; readonly status: string }
  | { readonly ok: false; readonly why: string };

/**
 * Reads a bioRxiv API response. §8.5 says errors arrive as a `messages`
 * envelope inside HTTP 200; an HTTP 200 with an *empty* body is reported
 * separately and verbatim, because it is neither.
 */
function biorxivEnvelope(res: HttpResult): BiorxivEnvelope {
  if (res.status !== 200) return { ok: false, why: describeFailure(res) };
  if (res.body.trim() === "") {
    return {
      ok: false,
      why: `HTTP 200 with an empty body (content-length: ${res.headers?.get("content-length") ?? "absent"})`,
    };
  }
  const json = parseJson(res.body);
  const status = str(at(arr(at(json, "messages"))[0], "status"));
  if (status === null) {
    return {
      ok: false,
      why: `no messages[0].status in body: ${trimTo(res.body, 120)}`,
    };
  }
  return { ok: true, json, status };
}

async function measureWindowSample(
  server: Server,
): Promise<SourceMeasurement[]> {
  const source = serverSource(server);
  const interval = `${String(FROM_YEAR)}-01-01/${String(TO_YEAR)}-12-31`;
  const base = {
    label: `${source} — /details window sample (NOT the query)`,
    source,
    rendering: `/details/${server}/${interval}/{cursor}/json, cursors 0,30,60,90`,
    queryDerived: false,
  };
  report(`${source} unfiltered window sample (docs/02 §8.2 /details, 30/page)`);
  const records: CoverageRecord[] = [];
  let total = "?";
  let detailsFailure: string | null = null;
  for (let cursor = 0; records.length < MAX_RECORDS; cursor += 30) {
    const res = await politeGet(
      `${server} /details window cursor=${String(cursor)} §8.2`,
      `https://api.biorxiv.org/details/${server}/${interval}/${String(cursor)}/json`,
      "application/json",
      STANDARD_RETRY,
    );
    const env = biorxivEnvelope(res);
    if (!env.ok || env.status !== "ok") {
      if (records.length === 0) {
        detailsFailure = env.ok ? `messages[0].status=${env.status}` : env.why;
      }
      break;
    }
    total = String(at(arr(at(env.json, "messages"))[0], "total") ?? "?");
    const page = arr(at(env.json, "collection"));
    for (const item of page) {
      if (records.length >= MAX_RECORDS) break;
      records.push(
        makeRecord(
          source,
          str(at(item, "doi")) ?? "?",
          str(at(item, "doi")),
          str(at(item, "abstract")),
          null,
          str(at(item, "server")),
          str(at(item, "date")) ?? "?",
        ),
      );
    }
    if (page.length < 30) break;
  }
  if (detailsFailure === null) {
    const dates = records.map((r) => r.detail).sort();
    return [
      {
        ...base,
        outcome: "measured",
        reason: "",
        reportedHits: total,
        records,
        notes: [
          `record dates span ${dates[0] ?? "?"} … ${dates[dates.length - 1] ?? "?"}`,
        ],
      },
    ];
  }

  // `/details/` produced nothing. §8.3 documents `/pubs/` as the other
  // abstract-bearing endpoint (`preprint_abstract`); one page of it is
  // measured and labelled for exactly what it is.
  const pubsBase = {
    label: `${source} — /pubs window sample (NOT the query)`,
    source,
    rendering: `/pubs/${server}/${interval}/0/json (one page; only preprints that have a published version)`,
    queryDerived: false,
  };
  const res = await politeGet(
    `${server} /pubs window cursor=0 §8.2/§8.3`,
    `https://api.biorxiv.org/pubs/${server}/${interval}/0/json`,
    "application/json",
    STANDARD_RETRY,
  );
  const env = biorxivEnvelope(res);
  const detailsRow = failed(base, detailsFailure);
  if (!env.ok || env.status !== "ok") {
    return [
      detailsRow,
      failed(pubsBase, env.ok ? `messages[0].status=${env.status}` : env.why),
    ];
  }
  const pubs = arr(at(env.json, "collection"))
    .slice(0, MAX_RECORDS)
    .map((item) =>
      makeRecord(
        source,
        str(at(item, "preprint_doi")) ?? "?",
        str(at(item, "preprint_doi")),
        str(at(item, "preprint_abstract")),
        null,
        str(at(item, "preprint_platform")),
        str(at(item, "preprint_date")) ?? "?",
      ),
    );
  const dates = pubs.map((r) => r.detail).sort();
  return [
    detailsRow,
    {
      ...pubsBase,
      outcome: "measured",
      reason: "",
      reportedHits: String(
        at(arr(at(env.json, "messages"))[0], "total") ?? "?",
      ),
      records: pubs,
      notes: [
        `preprint dates span ${dates[0] ?? "?"} … ${dates[dates.length - 1] ?? "?"}`,
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Europe PMC DOI backfill — docs/02 §10.4 backfill pass, step 1
// ---------------------------------------------------------------------------

interface BackfillResult {
  /** DOI → whether Europe PMC returned it with an abstract. */
  readonly seen: Map<Doi, boolean>;
  /** DOIs sent. */
  readonly requested: number;
  /** DOIs whose batch still failed after one halving. */
  readonly unresolved: number;
}

async function europePmcBackfill(
  dois: readonly Doi[],
): Promise<BackfillResult> {
  const seen = new Map<Doi, boolean>();
  let unresolved = 0;
  report(
    `Europe PMC DOI backfill (docs/02 §10.4 step 1, DOI:"…" OR-batches of ${String(EPMC_BACKFILL_BATCH)}): ${String(dois.length)} DOIs`,
  );
  const queue: Doi[][] = [];
  for (let i = 0; i < dois.length; i += EPMC_BACKFILL_BATCH) {
    queue.push(dois.slice(i, i + EPMC_BACKFILL_BATCH));
  }
  // A failed batch (the first run saw an HTTP 504 on a 25-DOI OR query) is
  // halved once and re-queued; halves that fail again are counted, not
  // retried further.
  const halved = new Set<Doi[]>();
  let n = 0;
  for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
    n += 1;
    const res = await politeGet(
      `Europe PMC DOI backfill batch ${String(n)} (${String(batch.length)} DOIs) §10.4`,
      withParams(EPMC_SEARCH, {
        query: batch.map((d) => `DOI:"${d}"`).join(" OR "),
        resultType: "core",
        format: "json",
        pageSize: String(MAX_RECORDS),
        email: MAINTAINER_EMAIL,
      }),
      "application/json",
      STANDARD_RETRY,
    );
    const json = res.status === 200 ? parseJson(res.body) : undefined;
    if (json === undefined || at(json, "errCode") !== undefined) {
      if (!halved.has(batch) && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const left = batch.slice(0, mid);
        const right = batch.slice(mid);
        halved.add(left);
        halved.add(right);
        queue.unshift(left, right);
      } else {
        unresolved += batch.length;
      }
      continue;
    }
    for (const r of parseEpmcResults(json)) {
      if (r.doi === null) continue;
      seen.set(r.doi, (seen.get(r.doi) ?? false) || hasAbstract(r));
    }
  }
  return { seen, requested: dois.length, unresolved };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function row(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .map((c, i) => {
      const w = widths[i] ?? 10;
      return i === 0 ? c.padEnd(w) : c.padStart(w);
    })
    .join(" | ");
}

function reportCoverageTable(all: readonly SourceMeasurement[]): void {
  heading("TABLE 1 — ABSTRACT AVAILABILITY PER SOURCE");
  report(`Query (verbatim): ${JSON.stringify(QUERY_TEXT)}`);
  report(
    `Window: calendar years ${String(FROM_YEAR)}–${String(TO_YEAR)} (docs/02 §2.0), rendered per source as listed below`,
  );
  report();
  const widths = [52, 14, 9, 9, 8];
  report(row(["Source", "Reported hits", "Returned", "Abstract", "%"], widths));
  report("-".repeat(52 + 14 + 9 + 9 + 8 + 12));
  for (const m of all) {
    if (m.outcome !== "measured") {
      report(row([m.label, m.reportedHits, "—", "—", "—"], widths));
      report(`    ${m.outcome.toUpperCase()}: ${m.reason}`);
      continue;
    }
    const withAbs = m.records.filter(hasAbstract).length;
    report(
      row(
        [
          m.label,
          m.reportedHits,
          String(m.records.length),
          String(withAbs),
          pct(withAbs, m.records.length),
        ],
        widths,
      ),
    );
  }

  heading("ABSTRACT FORMAT PER SOURCE (shape tally + one trimmed raw example)");
  for (const m of all) {
    report();
    report(`${m.label}`);
    report(`  rendering: ${m.rendering}`);
    if (m.outcome !== "measured") {
      report(`  ${m.outcome}: no abstracts to classify`);
      continue;
    }
    const withAbs = m.records.filter(hasAbstract);
    const withDoi = m.records.filter((r) => r.doi !== null).length;
    const short = withAbs.filter(
      (r) => r.abstractChars < SHORT_ABSTRACT_CHARS,
    ).length;
    const lengths = withAbs.map((r) => r.abstractChars).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    report(
      `  records with a DOI: ${String(withDoi)}/${String(m.records.length)}; ` +
        `abstracts < ${String(SHORT_ABSTRACT_CHARS)} chars: ${String(short)}; ` +
        `median abstract length: ${median === undefined ? "n/a" : `${String(median)} chars`}`,
    );
    const shapes = new Map<string, CoverageRecord[]>();
    for (const r of withAbs) {
      const key = r.shape ?? "?";
      shapes.set(key, [...(shapes.get(key) ?? []), r]);
    }
    for (const [shape, recs] of [...shapes].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const example = recs[0];
      report(`  - ${shape}: ${String(recs.length)}`);
      if (example !== undefined && example.rawAbstract !== null) {
        report(
          `      e.g. ${example.nativeId}: ${JSON.stringify(exampleSnippet(example.rawAbstract, shape))}`,
        );
      }
    }
    const lacking = m.records.filter((r) => !hasAbstract(r));
    if (lacking.length > 0) {
      report(
        `  lacking an abstract (${String(lacking.length)}): ` +
          lacking
            .slice(0, 12)
            .map((r) => `${r.nativeId}${r.detail ? ` [${r.detail}]` : ""}`)
            .join(", ") +
          (lacking.length > 12 ? ", …" : ""),
      );
    }
    for (const note of m.notes) report(`  note: ${note}`);
  }
}

/**
 * A short verbatim window of a raw abstract, positioned on the markup that
 * earned it its shape (an inline tag, an entity) rather than always on the
 * first characters, which are usually plain prose.
 */
function exampleSnippet(raw: string, shape: string): string {
  const text = raw.trim();
  let index = 0;
  if (shape.includes("tokens")) {
    index = text.search(/\b[OC]_[A-Z]{2,}/);
  } else if (shape.includes("entities")) {
    index = text.search(/&(?:#\d+|#x[0-9a-f]+|lt|gt|amp|quot|apos);/i);
  } else if (shape.includes("inline")) {
    index = text.search(/<(?!\/?(?:AbstractText)\b)\/?[a-z]/i);
  }
  const start = Math.max(0, index - 20);
  return `${start > 0 ? "…" : ""}${trimTo(text.slice(start), EXAMPLE_CHARS)}`;
}

function reportOverlap(
  all: readonly SourceMeasurement[],
  backfill: BackfillResult,
): void {
  const epmc = backfill.seen;
  heading(
    "TABLE 2 — DOI-KEYED BACKFILL OPPORTUNITY (query-derived records only)",
  );
  report(
    "(a) incidental: another source's fetched top-100 has the same DOI with an abstract.",
  );
  report(
    "(b) targeted:   Europe PMC DOI lookup (docs/02 §10.4 step 1) returned it with an abstract.",
  );
  report();

  const query = all.filter((m) => m.queryDerived && m.outcome === "measured");
  const byDoi = new Map<Doi, Map<SourceName, boolean>>();
  for (const m of query) {
    for (const r of m.records) {
      if (r.doi === null) continue;
      const slot = byDoi.get(r.doi) ?? new Map<SourceName, boolean>();
      slot.set(r.source, (slot.get(r.source) ?? false) || hasAbstract(r));
      byDoi.set(r.doi, slot);
    }
  }

  const widths = [34, 8, 8, 8, 13, 13, 8, 16];
  report(
    row(
      [
        "Source",
        "Returned",
        "No abs",
        "+DOI",
        "(a) incident.",
        "(b) EPMC tgt",
        "a ∪ b",
        "coverage →",
      ],
      widths,
    ),
  );
  report("-".repeat(widths.reduce((s, w) => s + w, 0) + 3 * widths.length));
  const donorLines: string[] = [];
  for (const m of query) {
    if (m.records.length === 0) continue;
    const lacking = m.records.filter((r) => !hasAbstract(r));
    const lackingDoi = lacking.filter(
      (r): r is CoverageRecord & { doi: Doi } => r.doi !== null,
    );
    const donors = new Map<SourceName, number>();
    let a = 0;
    let b = 0;
    let union = 0;
    for (const r of lackingDoi) {
      const others = [...(byDoi.get(r.doi) ?? new Map<SourceName, boolean>())]
        .filter(([s, has]) => s !== m.source && has)
        .map(([s]) => s);
      const inA = others.length > 0;
      const inB = m.source !== "Europe PMC" && epmc.get(r.doi) === true;
      if (inA) a += 1;
      if (inB) b += 1;
      if (inA || inB) union += 1;
      for (const s of others) donors.set(s, (donors.get(s) ?? 0) + 1);
    }
    const before = m.records.length - lacking.length;
    report(
      row(
        [
          m.label,
          String(m.records.length),
          String(lacking.length),
          String(lackingDoi.length),
          String(a),
          m.source === "Europe PMC" ? "(self)" : String(b),
          String(union),
          `${pct(before, m.records.length)} → ${pct(before + union, m.records.length)}`,
        ],
        widths,
      ),
    );
    if (donors.size > 0) {
      donorLines.push(
        `  ${m.label}: incidental donors ${[...donors]
          .map(([s, n]) => `${s} ${String(n)}`)
          .join(", ")}`,
      );
    }
  }
  report();
  for (const line of donorLines) report(line);

  const uniqueDois = byDoi.size;
  const anyAbs = [...byDoi.values()].filter((s) =>
    [...s.values()].some(Boolean),
  ).length;
  const anyAbsOrEpmc = [...byDoi].filter(
    ([doi, s]) => [...s.values()].some(Boolean) || epmc.get(doi) === true,
  ).length;
  const multi = [...byDoi.values()].filter((s) => s.size > 1).length;
  report();
  report(
    `Unique DOIs across query-derived records: ${String(uniqueDois)}; seen by ≥2 sources: ${String(multi)}`,
  );
  report(
    `  with an abstract in ≥1 fetched source: ${String(anyAbs)} (${pct(anyAbs, uniqueDois)}); ` +
      `after Europe PMC targeted lookup: ${String(anyAbsOrEpmc)} (${pct(anyAbsOrEpmc, uniqueDois)})`,
  );
  const epmcLooked = [...epmc.values()];
  report(
    `  Europe PMC targeted lookup: ${String(backfill.requested)} DOIs sent; ${String(epmcLooked.length)} found in Europe PMC, ` +
      `${String(epmcLooked.filter(Boolean).length)} of them with an abstract; ${String(backfill.unresolved)} unresolved after batch failures`,
  );
}

function auditIdentification(e: RequestLogEntry): string[] {
  const problems: string[] = [];
  if (e.headersSent["User-Agent"] !== USER_AGENT) {
    problems.push("User-Agent is not the D10 form");
  }
  if (!USER_AGENT.includes(`mailto:${MAINTAINER_EMAIL}`)) {
    problems.push("User-Agent lacks the maintainer mailto");
  }
  const url = new URL(e.url);
  const p = url.searchParams;
  switch (url.host) {
    case "eutils.ncbi.nlm.nih.gov":
      if (p.get("tool") !== NCBI_TOOL) problems.push("NCBI tool missing");
      if (p.get("email") !== MAINTAINER_EMAIL) {
        problems.push("NCBI email is not the maintainer address");
      }
      break;
    case "api.crossref.org":
      if (p.get("mailto") !== MAINTAINER_EMAIL) {
        problems.push("Crossref mailto missing");
      }
      break;
    case "www.ebi.ac.uk":
      if (p.get("email") !== MAINTAINER_EMAIL) {
        problems.push("Europe PMC email missing");
      }
      break;
    default:
      // §2.2 "Final assignment": S2, arXiv, bioRxiv/medRxiv — User-Agent only.
      break;
  }
  return problems;
}

function reportRequests(): boolean {
  heading("REQUEST LOG + D10 IDENTIFICATION AUDIT");
  report(`User-Agent sent on every request: ${USER_AGENT}`);
  report();
  let ok = true;
  for (const e of requestLog) {
    const problems = auditIdentification(e);
    if (problems.length > 0) ok = false;
    const url = new URL(e.url);
    const contact = ["tool", "email", "mailto"]
      .flatMap((k) => {
        const v = url.searchParams.get(k);
        return v === null ? [] : [`${k}=${v}`];
      })
      .join("&");
    report(
      `#${String(e.seq).padStart(2)} t+${String(e.startedAtMs).padStart(6)}ms ` +
        `${url.host.padEnd(24)} ${e.status === null ? "ERR" : String(e.status)} ` +
        `${problems.length === 0 ? "ID-OK" : `ID-FAIL(${problems.join("; ")})`} ` +
        `${contact || "(UA only)"}${e.evidence ? ` [${e.evidence}]` : ""}`,
    );
  }

  report();
  report("Per-host request count and minimum start-to-start gap:");
  const byHost = new Map<string, RequestLogEntry[]>();
  for (const e of requestLog) {
    const host = new URL(e.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), e]);
  }
  for (const [host, entries] of byHost) {
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < entries.length; i += 1) {
      const prev = entries[i - 1];
      const cur = entries[i];
      if (prev !== undefined && cur !== undefined) {
        minGap = Math.min(minGap, cur.startedAtMs - prev.startedAtMs);
      }
    }
    report(
      `  ${host.padEnd(26)} ${String(entries.length).padStart(3)} requests; ` +
        `min gap ${Number.isFinite(minGap) ? `${String(minGap)} ms` : "n/a (single request)"}; ` +
        `configured end-to-start spacing ${String(HOST_SPACING_MS[host] ?? 3_000)} ms`,
    );
  }
  report();
  report(
    `D10 identification audit: ${ok ? "PASS" : "FAIL"} — ${String(requestLog.length)} requests checked`,
  );
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

report("P0-T21 / V-13 — abstract availability across the seven v1 sources");
report(`Started:    ${new Date(RUN_STARTED_AT).toISOString()}`);
report(`Query:      ${JSON.stringify(QUERY_TEXT)}`);
report(`Window:     ${String(FROM_YEAR)}-01-01 … ${String(TO_YEAR)}-12-31`);
report(`User-Agent: ${USER_AGENT}`);
report(
  `Max records per source: ${String(MAX_RECORDS)}; all requests sequential`,
);
report();

const pubmed = await measurePubMed();
const europePmc = await measureEuropePmc();
const crossref = await measureCrossref();
const semanticScholar = await measureSemanticScholar();
const arxiv = await measureArxiv();
const searchable = [pubmed, europePmc, crossref, semanticScholar, arxiv];

const lookups = await measurePreprintLookups(searchable);
const bioSample = await measureWindowSample("biorxiv");
const medSample = await measureWindowSample("medrxiv");

// §10.4 step 1 targets records "still missing an abstract". Europe PMC's own
// abstract-less records are excluded: asking Europe PMC again cannot help.
const epmcFetched = new Set(
  europePmc.records.flatMap((r) => (r.doi === null ? [] : [r.doi])),
);
const backfillTargets = [
  ...new Set(
    [...searchable, ...lookups].flatMap((m) =>
      m.records.flatMap((r) =>
        r.doi !== null && !hasAbstract(r) && !epmcFetched.has(r.doi)
          ? [r.doi]
          : [],
      ),
    ),
  ),
];
const epmcBackfill = await europePmcBackfill(backfillTargets);

const all: SourceMeasurement[] = [
  ...searchable,
  notApplicable("bioRxiv"),
  ...lookups.filter((m) => m.source === "bioRxiv"),
  ...bioSample,
  notApplicable("medRxiv"),
  ...lookups.filter((m) => m.source === "medRxiv"),
  ...medSample,
];

reportCoverageTable(all);
reportOverlap(all, epmcBackfill);
const identificationOk = reportRequests();

heading("SUMMARY");
for (const m of all) {
  const withAbs = m.records.filter(hasAbstract).length;
  report(
    `  ${m.label.padEnd(52)} ${
      m.outcome === "measured"
        ? `${String(withAbs)}/${String(m.records.length)} = ${pct(withAbs, m.records.length)}`
        : m.outcome.toUpperCase()
    }`,
  );
}
report(`Finished: ${new Date().toISOString()}`);

const measuredAny = all.some(
  (m) => m.outcome === "measured" && m.records.length > 0,
);
if (!identificationOk || !measuredAny) {
  report(
    !identificationOk
      ? "FAILED: at least one request lacked D10 identification."
      : "FAILED: no source produced any records; nothing was measured.",
  );
  process.exitCode = 1;
}

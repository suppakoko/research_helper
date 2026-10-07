/**
 * `scripts/record-fixtures.ts` — the recorder behind `npm run fixtures:record`.
 *
 * **Scope.** `P1-T11` steps 2–4. It records the `docs/13` §3.1 inventory for
 * PubMed `esearch` and `efetch` into `test/fixtures/pubmed/`, keyed by
 * `test/contract/_transport.ts`'s {@link fixtureKey} so that
 * `replayTransport` finds what this writes. The scenario list below is fixed and
 * versioned ({@link SCENARIO_VERSION}) so a re-record is reproducible.
 *
 * ## Running it
 *
 * ```sh
 * npm run fixtures:record                      # dry run: prints the plan only
 * FIXTURE_MODE=record npm run fixtures:record  # live: issues the requests
 * FIXTURE_MODE=synthetic npm run fixtures:record   # rewrites the 3 hand-written
 *                                                  # fixtures, no network
 * ```
 *
 * `FIXTURE_MODE` is `docs/13` §2.2's own spelling, and the default being a dry
 * run is deliberate: `npm run fixtures:record` typed by accident must not put
 * thirteen requests on NCBI.
 *
 * On this network Node needs `NODE_USE_SYSTEM_CA=1` — a TLS-inspecting appliance
 * sits in front of everything, and the sanctioned flag is the answer. Disabling
 * certificate verification is never the answer.
 *
 * ## Politeness, which outranks completeness
 *
 * - **No API key, by construction.** `docs/02` §3.1 makes NCBI's key optional and
 *   nothing here reads one. It is also a *correctness* requirement, not only a
 *   deployment one: {@link fixtureKey} hashes the URL, and `api_key=` redacts to
 *   `api_key=REDACTED` rather than vanishing, so a fixture recorded with a key
 *   could never be found by a keyless replay. See the card report.
 * - **Requests are strictly sequential**, one host, one connection, with a
 *   minimum end-to-start gap of {@link ncbiSpacingMs}, read from
 *   `HOST_POLICIES`' unkeyed `ratePerSecond` (2.5/s) rather than written down
 *   here — `plan/README.md` §5 rule 4.
 * - **`tool` and `email` are not this file's to choose.** Every URL comes from
 *   `buildEsearchRequest` / `buildEfetchRequest`, which take them from
 *   `ncbiIdentityParams()` (decision D10). The shipped `createHttpClient` then
 *   refuses any NCBI request carrying anything else, so a mistake here is a
 *   thrown `PolicyViolationError` and not a quiet impoliteness.
 * - **`error-429` and `error-500` are hand-written**, per `P1-T11` step 3:
 *   `docs/02` §3.1 quotes NCBI's "failure to comply with this policy may result
 *   in an IP address being blocked from accessing NCBI", so the rate limit is not
 *   provoked. `error-malformed` is likewise constructed, by truncating the
 *   recorded `record-rich` body. All three carry `"synthetic": true` and a reason
 *   in their `_meta.json`, so nobody mistakes them for evidence about NCBI.
 * - **NCBI asks that large jobs run off-peak** (`docs/02` §3.1). Thirteen
 *   requests is not a large job. Nothing here loops over a result set, and that
 *   is on purpose: this recorder must not be a harvester.
 *
 * ## Redaction, before anything is written
 *
 * `docs/13` §3.2 requires a mandatory pass and that a fixture still matching a
 * secret pattern aborts the run. {@link redactExchange} is that pass and
 * {@link assertClean} is that abort. What it does, and why each part is needed:
 *
 * 1. **The URL is never written.** Not to the fixture, not to the sidecar. The
 *    sidecar records the endpoint base URL only. This is the guarantee that
 *    matters most: `email=` and any `api_key=` live in the URL and nowhere else.
 * 2. `authorization`, `cookie`, `set-cookie`, `x-api-key`, `ncbi-sid` and
 *    `ncbi-phid` response headers are dropped. The first four are §3.2's list;
 *    the last two are NCBI per-request trace identifiers, which are nobody's
 *    business in a committed file.
 * 3. Every remaining header value and the body are passed through
 *    `src/core/errors.ts`'s `redact()` and then through a literal scrub of the
 *    maintainer address and of any key-shaped environment value.
 * 4. **The literal scrub is not optional and `redact()` alone is not enough.**
 *    `redact()`'s catch-all pattern needs a 40-character run; an NCBI key is
 *    shorter than that. So key-shaped values are matched literally, by value,
 *    whatever their length.
 *
 * ## What is *not* read from `.env`, and the contradiction behind that
 *
 * `docs/13` §3.2 says this script "reads real keys from `.env` (never
 * committed)". `.env.example` says, in capitals, "NEVER put an API key here",
 * and decision D5 plus `docs/09` §1.7 put every credential in the OS keystore
 * with no plaintext tier. Those cannot both be followed. This file follows D5:
 * it reads no key from anywhere, and uses the environment only to build the
 * redaction deny-list described above. Reported with the card.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createSystemClock } from "../src/core/clock";
import { KEYISH_FIELD, redact } from "../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportXhr,
} from "../src/core/http/client";
import { buildUserAgent, MAINTAINER_EMAIL } from "../src/core/http/userAgent";
import { HOST_POLICIES, NCBI_HOST } from "../src/core/rateLimit/hostLimiter";
import { createCancellationTokenSource } from "../src/core/jobQueue/cancellation";
import {
  buildEfetchRequest,
  parseEsearchBody,
  PUBMED_EFETCH_BASE_URL,
} from "../src/sources/pubmed/pubmedSource";
import {
  buildEsearchRequest,
  PUBMED_ESEARCH_BASE_URL,
} from "../src/sources/pubmed/query";
import type { SourceQuery } from "../src/sources/types";
import {
  fixtureKey,
  META_SUFFIX,
  type FixtureMeta,
  type RecordedExchange,
} from "../test/contract/_transport";

// ---------------------------------------------------------------------------
// 1. Where things go, and the scenario list's version
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
export const FIXTURE_DIR = resolve(REPO_ROOT, "test/fixtures/pubmed");

/**
 * The scenario list's version. Bump it when a scenario's *request* changes, so
 * that a reviewer reading two sidecars can tell whether they describe the same
 * question asked twice or two different questions.
 */
export const SCENARIO_VERSION = 1;

/** The plugin version the `User-Agent` reports, read from `package.json`. */
async function toolVersion(): Promise<string> {
  const text = await readFile(resolve(REPO_ROOT, "package.json"), "utf8");
  const parsed = JSON.parse(text) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error("package.json has no string version");
  }
  return parsed.version;
}

// ---------------------------------------------------------------------------
// 2. The queries. Fixed, and every date bound is a closed historical window.
// ---------------------------------------------------------------------------

/*
 * Why closed historical windows rather than `reldate`: a rolling window makes
 * the result set drift, so `count` and `idlist` would change on every re-record
 * for reasons that have nothing to do with the service's response *shape*. A
 * closed window past the indexing lag is as stable as PubMed gets. `docs/02`
 * §3.3 gives both mechanisms; the plugin ships `mindate`/`maxdate`, which is
 * what `SourceQuery.fromDate`/`toDate` render to.
 */

/**
 * The `search-typical` / `paginated` query: hundreds of hits in a closed
 * quarter, of which the scenarios take 20, 1 and 3+3.
 *
 * **Two bare terms under an `and`, not one multi-word term.** Measured
 * 2026-10-07: `{ kind: "term", value: "CRISPR base editing" }` renders as
 * `"CRISPR base editing"[All Fields]`, because `renderPubmedTerm` quotes any
 * value that is not a single bare word — and PubMed finds that exact phrase in
 * essentially nothing, so the first recording run came back with an empty
 * `idlist` for a scenario whose whole purpose is "~20 results". Two bare words
 * joined by `AND` render as `(CRISPR[All Fields] AND editing[All Fields])`,
 * which is both a realistic query and one that exercises the Boolean rendering.
 */
export const QUERY_TYPICAL: SourceQuery = {
  terms: {
    kind: "and",
    children: [
      { kind: "term", value: "CRISPR" },
      { kind: "term", value: "editing" },
    ],
  },
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
  limit: 20,
};

/** A term chosen to match nothing at all, for `search-empty`. */
export const QUERY_EMPTY: SourceQuery = {
  terms: { kind: "term", value: "zqxjkwv nonexistent biomedical phrase" },
  fromDate: "2023-01-01",
  toDate: "2023-03-31",
  limit: 20,
};

/** The query the two synthetic transport-error fixtures are keyed under. */
const QUERY_SYNTHETIC_429: SourceQuery = {
  terms: { kind: "term", value: "synthetic rate limit fixture" },
  limit: 20,
};

/** As above, for the 500. A distinct term means a distinct fixture key. */
const QUERY_SYNTHETIC_500: SourceQuery = {
  terms: { kind: "term", value: "synthetic server error fixture" },
  limit: 20,
};

/**
 * The query the `esearchresult.ERROR` fixture is keyed under, and why it is not
 * the `retstart=9999` request.
 *
 * **Measured 2026-10-07: `docs/02` §3.3's "Verified live — `retstart=9999`
 * returns an error inside an HTTP 200" no longer reproduces.** The recorded
 * `search-error-retstart` fixture beside this one is that request's real
 * present-day answer and it carries no `ERROR` at all: `count` `"840"`, `retmax`
 * `"0"`, an empty `idlist`, and `warninglist.outputmessages` of
 * `["Restrictions achieved. start and count adjusted to 9999, 0"]`. NCBI now
 * clamps and warns where it used to fail.
 *
 * So the `ERROR`-inside-200 shape of `docs/02` §3.8 row 2 can no longer be
 * *recorded* from a `retstart` overflow. `P1-T11` step 4 points at the body
 * `docs/02` §3.3 quotes, and that is what this scenario carries:
 * {@link readDocs02ErrorBody} reads it out of the document rather than
 * transcribing it, and `test/contract/pubmed.contract.test.ts` re-reads it and
 * asserts byte equality against the fixture — the pattern `P1-T10` established
 * for the §3.4 sample, so a drift in either artefact fails loudly.
 *
 * `retstart` stays at {@link ERROR_RETSTART} in the URL so the fixture says, in
 * its own request, which call this body used to answer. The *term* is what makes
 * the key distinct from the live recording's.
 */
const QUERY_SYNTHETIC_UPSTREAM_ERROR: SourceQuery = {
  terms: { kind: "term", value: "synthetic esearchresult ERROR fixture" },
  limit: 20,
};

/** The document the `esearchresult.ERROR` body is read out of. */
const DOCS_02_PATH = resolve(REPO_ROOT, "docs/02-literature-database-apis.md");

/** The heading the fenced block follows, in `docs/02` §3.3. */
const DOCS_02_ERROR_HEADING = "#### The 9,999-record ceiling (hard constraint)";

/**
 * Read `docs/02` §3.3's quoted `esearchresult.ERROR` body out of the document.
 *
 * Reading rather than transcribing is `P1-T10`'s pattern: the corpus holds the
 * only captured copy of this response, so the document is the source of truth
 * and a copy in a source file would drift silently.
 *
 * @param path - the document; defaults to `docs/02-literature-database-apis.md`
 * @returns the fenced block's contents, LF-joined, with a trailing newline
 * @throws Error when the heading or the fence cannot be found, or when the block
 *   is not the `ERROR` body — a moved section must fail loudly, not silently
 *   record an empty fixture
 */
export async function readDocs02ErrorBody(
  path: string = DOCS_02_PATH,
): Promise<string> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u);
  const headingAt = lines.indexOf(DOCS_02_ERROR_HEADING);
  if (headingAt === -1) {
    throw new Error(
      `${path} no longer contains the heading "${DOCS_02_ERROR_HEADING}". ` +
        `docs/02 §3.3's esearchresult.ERROR block cannot be located.`,
    );
  }
  const openAt = lines.indexOf("```json", headingAt);
  if (openAt === -1 || openAt - headingAt > 10) {
    throw new Error(
      `No \`\`\`json fence within 10 lines of "${DOCS_02_ERROR_HEADING}" in ${path}.`,
    );
  }
  const closeAt = lines.indexOf("```", openAt + 1);
  if (closeAt === -1) {
    throw new Error(
      `Unterminated \`\`\`json fence at line ${String(openAt + 1)} of ${path}.`,
    );
  }
  const body = `${lines.slice(openAt + 1, closeAt).join("\n")}\n`;
  if (!body.includes('"ERROR"')) {
    throw new Error(
      `The fenced block under "${DOCS_02_ERROR_HEADING}" in ${path} no longer ` +
        `carries an "ERROR" member. docs/02 §3.3 has changed; re-read it before ` +
        `re-recording.`,
    );
  }
  return body;
}

/**
 * The PMIDs each `record-*` scenario fetches, and why each one.
 *
 * Chosen by two throwaway discovery probes (4 live requests, 2026-10-07) over
 * candidate sets, then frozen here so the list is reproducible. What each one
 * demonstrates was read out of the recorded XML, not assumed:
 */
export const RECORD_PMIDS = {
  /**
   * `record-rich`. `docs/02` §3.4's own sample record, the one piece of real
   * captured PubMed text the corpus owns: DOI, PMCID, ISSN, volume, issue,
   * pages, MeSH with qualifiers, ORCID, abstract, `<sup>` markup, Greek β.
   */
  rich: ["37258680"],
  /**
   * `record-sparse`. §3.1 asks for "no abstract, no DOI, incomplete date" and
   * this record is all three: no `<Abstract>`, no `doi` `ArticleId` and no
   * `ELocationID`, `<PubDate>` of `<Year>1976</Year><Month>Jun</Month>` with no
   * day. A bracketed translated title as a bonus.
   */
  sparse: ["60000"],
  /**
   * `record-unicode`. §3.1 asks for one fixture with CJK/Greek/diacritics in
   * title and author names *and* a title carrying subscripts or superscripts. No
   * single PubMed record has all of that, so the scenario is one `efetch` of
   * three records — one response, one fixture:
   *
   * - `38044647` — CJK `<VernacularTitle>` as numeric character references,
   *   Greek `&#x3b2;`, `<b>` in the title, `<sub>` in the abstract, and a
   *   free-text `<MedlineDate>2023 Sept 28</MedlineDate>` (§3.4 note 4).
   * - `38988644` — `VO <sub>2max</sub>` and `<i>Withania somnifera</i>` inside
   *   `<ArticleTitle>`: §3.1's "title with subscripts/superscripts".
   * - `39593466` — Latin-1/Latin-Extended diacritics inside `<LastName>` and
   *   `<ForeName>` (`Arac&#x131;`, `Ay&#xe7;a`, `Ba&#x15f;`).
   */
  unicode: ["38044647", "38988644", "39593466"],
  /**
   * `record-jats-abstract`. Five `<AbstractText>` elements labelled BACKGROUND /
   * METHODS / RESULTS / CONCLUSIONS / REGISTRATION, plus `<i>` and `<sup>`
   * inside them — §3.4 parsing notes 1 and 2 in one record.
   */
  jats: ["39220605"],
  /**
   * `docs/02` §3.8 row 3: "Unknown PMID in efetch → Empty
   * `<PubmedArticleSet/>`, HTTP 200". Nine digits, outside the assigned range.
   */
  unknown: ["999999999"],
  /**
   * The id the synthetic `error-malformed` fixture is keyed under. Never
   * fetched; it exists so the truncated body has a request to belong to.
   */
  malformed: ["37258681"],
} as const;

/** `docs/02` §3.3's verified `retstart` overflow, which returns a 200. */
export const ERROR_RETSTART = 9999;

/** `paginated`: three per page, so two pages cost six records, not four hundred. */
export const PAGE_SIZE = 3;

// ---------------------------------------------------------------------------
// 3. Pacing
// ---------------------------------------------------------------------------

/**
 * The minimum end-to-start gap between NCBI requests, in milliseconds.
 *
 * Derived from `HOST_POLICIES`' unkeyed `ratePerSecond` for
 * `eutils.ncbi.nlm.nih.gov` — 2.5/s, which `docs/07` §7.3 sets below `docs/02`
 * §3.1's unkeyed ceiling of 3/s on purpose. Nothing is written down here;
 * change the policy row and this follows.
 *
 * @returns the gap, or `undefined` if the host has no policy row
 */
export function ncbiSpacingMs(): number {
  const row = HOST_POLICIES.find((p) => p.host === NCBI_HOST);
  if (row === undefined) {
    throw new Error(
      `No HOST_POLICIES row for ${NCBI_HOST}: refusing to guess a rate limit ` +
        `(plan/README.md §5 rule 4).`,
    );
  }
  return Math.ceil(1000 / row.withoutKey.ratePerSecond);
}

// ---------------------------------------------------------------------------
// 4. Redaction
// ---------------------------------------------------------------------------

/** Response headers never written to a fixture. `docs/13` §3.2, plus NCBI's trace ids. */
const HEADER_DENY_LIST: readonly string[] = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "ncbi-sid",
  "ncbi-phid",
];

/**
 * Literal strings scrubbed from every header value and body before writing.
 *
 * The maintainer address is first: `docs/02` §2.2 puts it in every outbound
 * URL by construction, and `P1-T11`'s **Do NOT** requires §3.2's `mailto` strip.
 * Then every environment value whose *variable name* matches
 * `src/core/errors.ts`'s `KEYISH_FIELD` — matched literally, by value, because
 * `redact()`'s catch-all needs a 40-character run and a 32- or 36-character key
 * slips under it.
 *
 * @returns the deny-list, longest first so a longer match wins
 */
export function literalDenyList(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const out = new Set<string>([MAINTAINER_EMAIL]);
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.length < 8) continue;
    if (KEYISH_FIELD.test(name)) out.add(value);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const EMAIL_PLACEHOLDER = "[redacted:maintainer-address]";
const SECRET_PLACEHOLDER = "[redacted:env-secret]";

/** Scrub one string: `redact()` first, then the literal deny-list. */
function scrub(value: string, deny: readonly string[]): string {
  let out = redact(value);
  for (const literal of deny) {
    if (literal === "") continue;
    out = out
      .split(literal)
      .join(
        literal === MAINTAINER_EMAIL ? EMAIL_PLACEHOLDER : SECRET_PLACEHOLDER,
      );
  }
  return out;
}

/** What {@link redactExchange} removed, for the sidecar's `redactions` field. */
interface Redacted {
  readonly exchange: RecordedExchange;
  readonly notes: readonly string[];
}

/**
 * `docs/13` §3.2's mandatory pass.
 *
 * @param raw - the exchange exactly as received
 * @param deny - {@link literalDenyList}'s output
 * @returns the writable exchange and a note per thing removed
 */
export function redactExchange(
  raw: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
  deny: readonly string[],
): Redacted {
  const notes: string[] = [];
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw.headers)) {
    const lower = name.toLowerCase();
    if (HEADER_DENY_LIST.includes(lower)) {
      notes.push(`dropped header ${lower}`);
      continue;
    }
    const scrubbed = scrub(value, deny);
    if (scrubbed !== value) notes.push(`scrubbed header ${lower}`);
    headers[lower] = scrubbed;
  }
  const body = scrub(raw.body, deny);
  if (body !== raw.body) notes.push("scrubbed body");
  // Worded without a literal `api_key=` or `email=`: `assertClean` greps the
  // metadata it is about to write, and prose naming the parameter would trip it.
  notes.push("request URL withheld: it carries the contact and key parameters");
  return {
    exchange: { status: raw.status, headers, body },
    notes,
  };
}

/** Patterns a written fixture must not match, with what each one means. */
const FORBIDDEN: readonly { readonly what: string; readonly re: RegExp }[] = [
  { what: "the maintainer address", re: /suppakoko@gmail\.com/i },
  { what: "an api_key parameter", re: /api[_-]?key\s*=/i },
  { what: "an Authorization header", re: /^authorization\s*:/im },
  { what: "a mailto value", re: /mailto[:=]\s*[^\s"'<>]+@/i },
  { what: "a Set-Cookie header", re: /^set-cookie\s*:/im },
];

/**
 * §3.2's abort: "A fixture that still matches a secret pattern after redaction
 * causes the recorder to abort."
 *
 * @param scenario - the scenario name, for the message
 * @param text - the exact JSON about to be written
 * @param deny - the literal deny-list, re-checked after scrubbing
 * @throws Error naming what matched, without quoting it
 */
export function assertClean(
  scenario: string,
  text: string,
  deny: readonly string[],
): void {
  for (const { what, re } of FORBIDDEN) {
    if (re.test(text)) {
      throw new Error(
        `Refusing to write fixture "${scenario}": it still contains ${what} ` +
          `after redaction (docs/13 §3.2).`,
      );
    }
  }
  for (const literal of deny) {
    if (literal !== "" && text.includes(literal)) {
      throw new Error(
        `Refusing to write fixture "${scenario}": a value from the ` +
          `environment survived redaction (docs/13 §3.2). The value is not ` +
          `printed here.`,
      );
    }
  }
  const stillKeyish = redact(text);
  if (stillKeyish !== text) {
    throw new Error(
      `Refusing to write fixture "${scenario}": it matches a credential ` +
        `pattern from docs/09 §2.1 (docs/13 §3.2).`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Writing
// ---------------------------------------------------------------------------

/** JSON with LF endings, matching `.gitattributes`' `test/fixtures/** text eol=lf`. */
function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(/\r\n/gu, "\n")}\n`;
}

interface WriteRequest {
  readonly scenario: string;
  readonly method: string;
  readonly url: string;
  readonly body?: string;
  readonly endpoint: string;
  readonly exchange: RecordedExchange;
  readonly redactions: readonly string[];
  readonly synthetic: boolean;
  readonly syntheticReason?: string;
  readonly version: string;
  readonly deny: readonly string[];
}

/** Write one `<key>.json` and its `<key>_meta.json`. Returns the key. */
async function writeFixture(req: WriteRequest): Promise<string> {
  const key = fixtureKey({
    method: req.method,
    url: req.url,
    ...(req.body !== undefined && { body: req.body }),
  });
  const fixtureText = toJson(req.exchange);
  assertClean(req.scenario, fixtureText, req.deny);

  const meta: FixtureMeta = {
    scenario: req.scenario,
    scenarioVersion: SCENARIO_VERSION,
    recordedAt: new Date().toISOString(),
    endpoint: req.endpoint,
    method: req.method,
    toolVersion: req.version,
    synthetic: req.synthetic,
    ...(req.syntheticReason !== undefined && {
      syntheticReason: req.syntheticReason,
    }),
    redactions: req.redactions,
  };
  const metaText = toJson(meta);
  assertClean(`${req.scenario} (metadata)`, metaText, req.deny);

  await writeFile(`${FIXTURE_DIR}/${key}.json`, fixtureText, "utf8");
  await writeFile(`${FIXTURE_DIR}/${key}${META_SUFFIX}`, metaText, "utf8");
  return key;
}

// ---------------------------------------------------------------------------
// 6. The live transport
// ---------------------------------------------------------------------------

/** One exchange, as the transport saw it, before redaction. */
interface RawExchange {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

class RecorderUnexpectedStatus extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}
class RecorderTimeout extends Error {}
class RecorderOffline extends Error {}
class RecorderSecurity extends Error {}
class RecorderCancelled extends Error {}

/**
 * A `Zotero.HTTP` stand-in over Node's `fetch`, paced and self-recording.
 *
 * The pacing lives *here* rather than in the caller so that no code path can
 * issue a request without waiting first. {@link createHttpClient} is still the
 * thing on top, which is what enforces the D10 `User-Agent` and refuses an NCBI
 * URL carrying the wrong `tool`/`email`.
 *
 * @param spacingMs - minimum end-to-start gap
 * @param sink - called with every completed exchange, keyed by request
 * @returns the transport
 */
function createFetchTransport(
  spacingMs: number,
  sink: (key: string, exchange: RawExchange) => void,
): HttpTransport {
  let lastFinishedAtMs: number | undefined;

  return {
    async request(method, url, options): Promise<HttpTransportXhr> {
      if (lastFinishedAtMs !== undefined) {
        const wait = lastFinishedAtMs + spacingMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      const startedMs = Date.now();
      let response: Response;
      let text: string;
      try {
        response = await fetch(url, {
          method,
          headers: options.headers ?? {},
          ...(options.body !== undefined && { body: options.body }),
          signal: AbortSignal.timeout(options.timeout ?? 60_000),
        });
        text = await response.text();
      } finally {
        lastFinishedAtMs = Date.now();
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const requestKey = `${method} ${url} ${options.body ?? ""}`;
      sink(requestKey, { status: response.status, headers, body: text });
      process.stderr.write(
        `  ${method} ${new URL(url).pathname} -> ${String(response.status)} ` +
          `${String(text.length)}B in ${String(Date.now() - startedMs)}ms\n`,
      );
      return {
        status: response.status,
        responseText: text,
        responseURL: response.url,
        getAllResponseHeaders: () =>
          Object.entries(headers)
            .map(([n, v]) => `${n}: ${v}`)
            .join("\r\n"),
      };
    },
    UnexpectedStatusException:
      RecorderUnexpectedStatus as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: RecorderTimeout,
    BrowserOfflineException: RecorderOffline,
    SecurityException: RecorderSecurity,
    CancelledException: RecorderCancelled,
  };
}

// ---------------------------------------------------------------------------
// 7. The scenario list, as a plan a dry run can print
// ---------------------------------------------------------------------------

/** One request the recorder will make, or has keyed a synthetic fixture under. */
export interface PlannedRequest {
  readonly scenario: string;
  readonly method: string;
  readonly url: string;
  readonly body?: string;
  readonly endpoint: string;
  readonly purpose: string;
}

/** An `esearch` request for the plan, built by the shipped builder. */
function esearch(
  scenario: string,
  purpose: string,
  query: SourceQuery,
  retmax: number,
  retstart: number,
): PlannedRequest {
  const built = buildEsearchRequest({
    query,
    retmax,
    retstart,
    retmode: "json",
  });
  return {
    scenario,
    purpose,
    method: "GET",
    url: built.url,
    endpoint: PUBMED_ESEARCH_BASE_URL,
  };
}

/** An `efetch` request for the plan, built by the shipped builder. */
function efetch(
  scenario: string,
  purpose: string,
  pmids: readonly string[],
): PlannedRequest {
  const built = buildEfetchRequest(pmids);
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    ...(built.body !== undefined && { body: built.body }),
    endpoint: PUBMED_EFETCH_BASE_URL,
  };
}

/**
 * The scenarios whose request is known before any response arrives.
 *
 * `docs/13` §3.1's PubMed rows, less the three that cannot be provoked politely
 * (§7's synthetic set) and less the two the `P1-T11` card deliberately leaves
 * out of its own inventory — §3.1's `record-preprint` and `dedup-pair-set`,
 * which are a Phase 2 concern because they need a second source.
 */
export function independentPlan(): readonly PlannedRequest[] {
  return [
    esearch(
      "search-typical",
      "§3.1: ~20 results for a stable biomedical query, date filter applied",
      QUERY_TYPICAL,
      20,
      0,
    ),
    esearch("search-empty", "§3.1: zero results", QUERY_EMPTY, 20, 0),
    esearch(
      "search-single",
      "§3.1: one result — off-by-one and not-an-array bugs",
      QUERY_TYPICAL,
      1,
      0,
    ),
    esearch(
      "search-error-retstart",
      "§3.3 / §3.8: esearchresult.ERROR inside an HTTP 200 (retstart=9999)",
      QUERY_TYPICAL,
      20,
      ERROR_RETSTART,
    ),
    esearch(
      "paginated-page-1",
      "§3.1: page 1 of a multi-page result set",
      QUERY_TYPICAL,
      PAGE_SIZE,
      0,
    ),
    esearch(
      "paginated-page-2",
      "§3.1: page 2, reached by following nextCursor",
      QUERY_TYPICAL,
      PAGE_SIZE,
      PAGE_SIZE,
    ),
    efetch(
      "record-rich",
      "§3.1: every optional field populated (docs/02 §3.4's own PMID)",
      RECORD_PMIDS.rich,
    ),
    efetch(
      "record-sparse",
      "§3.1: no abstract, no DOI, incomplete date",
      RECORD_PMIDS.sparse,
    ),
    efetch(
      "record-unicode",
      "§3.1: CJK, Greek, diacritics, and a subscript in a title",
      RECORD_PMIDS.unicode,
    ),
    efetch(
      "record-jats-abstract",
      "§3.1: a structured abstract with inline markup",
      RECORD_PMIDS.jats,
    ),
    efetch(
      "record-unknown-pmid",
      "docs/02 §3.8: unknown PMID yields an empty PubmedArticleSet, HTTP 200",
      RECORD_PMIDS.unknown,
    ),
  ];
}

/** The two `paginated-*-efetch` requests, which depend on the recorded pages. */
function paginatedEfetchPlan(
  pageOneIds: readonly string[],
  pageTwoIds: readonly string[],
): readonly PlannedRequest[] {
  const out: PlannedRequest[] = [];
  if (pageOneIds.length > 0) {
    out.push(
      efetch(
        "paginated-page-1-efetch",
        "§3.1: the records page 1 resolved to",
        pageOneIds,
      ),
    );
  }
  if (pageTwoIds.length > 0) {
    out.push(
      efetch(
        "paginated-page-2-efetch",
        "§3.1: the records page 2 resolved to",
        pageTwoIds,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. The synthetic fixtures
// ---------------------------------------------------------------------------

/**
 * `error-429`'s body.
 *
 * It is a placeholder and says so. `docs/02` §3.8 records only that a 429 comes
 * with "a short HTML/XML body"; the exact bytes were never captured, and
 * provoking one to capture them risks the IP block §3.1 quotes. No assertion in
 * the contract suite reads this body — the fixture exists for its **status and
 * `Retry-After` header**, which is what `src/core/http/client.ts` classifies.
 */
const SYNTHETIC_429_BODY =
  "<!-- synthetic fixture: docs/02 §3.8 records only that an NCBI 429 " +
  "carries a short HTML/XML body. The real bytes are not captured, because " +
  "provoking a rate limit risks the IP block docs/02 §3.1 quotes. -->\n" +
  "<html><body><h1>Too Many Requests</h1></body></html>\n";

/** `error-500`'s body, a placeholder for the same reason. */
const SYNTHETIC_500_BODY =
  "<!-- synthetic fixture: docs/02 §3.8 row 4, 'Server overload: HTTP 500 / " +
  "502; back off'. Not provoked. -->\n" +
  "<html><body><h1>Internal Server Error</h1></body></html>\n";

/** How much of the `record-rich` body `error-malformed` keeps. */
const MALFORMED_PREFIX_BYTES = 1024;

/**
 * Build the three fixtures that are written rather than recorded.
 *
 * @param richBody - the recorded `record-rich` body, truncated for
 *   `error-malformed`. `undefined` when it is not available, in which case
 *   `error-malformed` is skipped and said to be skipped.
 */
function syntheticPlan(
  richBody: string | undefined,
  upstreamErrorBody: string,
): readonly {
  readonly planned: PlannedRequest;
  readonly exchange: RecordedExchange;
  readonly reason: string;
}[] {
  const out: {
    planned: PlannedRequest;
    exchange: RecordedExchange;
    reason: string;
  }[] = [
    {
      planned: esearch(
        "search-error-upstream",
        "docs/02 §3.8 row 2: esearchresult.ERROR inside an HTTP 200",
        QUERY_SYNTHETIC_UPSTREAM_ERROR,
        20,
        ERROR_RETSTART,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: upstreamErrorBody,
      },
      reason:
        "Read verbatim from docs/02 §3.3's fenced block, not recorded: " +
        "measured 2026-10-07, retstart=9999 no longer returns " +
        "esearchresult.ERROR — NCBI clamps and answers with " +
        "warninglist.outputmessages 'Restrictions achieved. start and count " +
        "adjusted to 9999, 0'. The live answer is recorded separately as " +
        "search-error-retstart. The contract test re-reads docs/02 §3.3 and " +
        "asserts this body still matches it byte for byte.",
    },
    {
      planned: esearch(
        "error-429",
        "§3.1: rate-limit response including Retry-After",
        QUERY_SYNTHETIC_429,
        20,
        0,
      ),
      exchange: {
        status: 429,
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "retry-after": "2",
        },
        body: SYNTHETIC_429_BODY,
      },
      reason:
        "Hand-written (P1-T11 step 3). docs/02 §3.1: 'failure to comply with " +
        "this policy may result in an IP address being blocked from accessing " +
        "NCBI', so the limit was not provoked. Status and Retry-After are the " +
        "assertable parts; the body is a placeholder.",
    },
    {
      planned: esearch(
        "error-500",
        "§3.1: server error",
        QUERY_SYNTHETIC_500,
        20,
        0,
      ),
      exchange: {
        status: 500,
        headers: { "content-type": "text/html; charset=UTF-8" },
        body: SYNTHETIC_500_BODY,
      },
      reason:
        "Hand-written (P1-T11 step 3). A 500 cannot be provoked on demand and " +
        "docs/02 §3.8 records only the status. The body is a placeholder.",
    },
  ];

  if (richBody !== undefined) {
    out.push({
      planned: efetch(
        "error-malformed",
        "§3.1: truncated/invalid body",
        RECORD_PMIDS.malformed,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "text/xml; charset=UTF-8" },
        body: richBody.slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body, which cuts inside an element ` +
        `and so is a truncated response rather than an invented one. NCBI has ` +
        `no documented way to ask for a truncated body.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9. main
// ---------------------------------------------------------------------------

/** `FIXTURE_MODE`, as `docs/13` §2.2 spells it. */
type Mode = "record" | "synthetic" | "dry-run";

function readMode(raw: string | undefined): Mode {
  if (raw === "record") return "record";
  if (raw === "synthetic") return "synthetic";
  return "dry-run";
}

/** Look one recorded exchange up by the request that produced it. */
function take(
  captured: ReadonlyMap<string, RawExchange>,
  planned: PlannedRequest,
): RawExchange | undefined {
  return captured.get(`${planned.method} ${planned.url} ${planned.body ?? ""}`);
}

async function main(): Promise<number> {
  const mode = readMode(process.env["FIXTURE_MODE"]);
  const deny = literalDenyList();
  const version = await toolVersion();
  const spacingMs = ncbiSpacingMs();

  const plan = independentPlan();
  if (mode === "dry-run") {
    process.stdout.write(
      `fixtures:record — dry run. Nothing was requested and nothing written.\n` +
        `Scenario list version ${String(SCENARIO_VERSION)}; ` +
        `${String(plan.length)} independent live requests plus up to 2 ` +
        `pagination efetch calls, paced at >= ${String(spacingMs)} ms.\n` +
        `Run it for real with: FIXTURE_MODE=record npm run fixtures:record\n` +
        `Rewrite only the hand-written fixtures with: ` +
        `FIXTURE_MODE=synthetic npm run fixtures:record\n\n`,
    );
    for (const p of plan) {
      process.stdout.write(
        `  ${fixtureKey({ method: p.method, url: p.url, ...(p.body !== undefined && { body: p.body }) })}  ` +
          `${p.scenario}\n      ${p.purpose}\n`,
      );
    }
    return 0;
  }

  await mkdir(FIXTURE_DIR, { recursive: true });

  if (mode === "synthetic") {
    const rich = await readRecordedRichBody();
    let written = 0;
    for (const s of syntheticPlan(rich, await readDocs02ErrorBody())) {
      const key = await writeFixture({
        scenario: s.planned.scenario,
        method: s.planned.method,
        url: s.planned.url,
        ...(s.planned.body !== undefined && { body: s.planned.body }),
        endpoint: s.planned.endpoint,
        exchange: s.exchange,
        redactions: ["synthetic: nothing was received, nothing to redact"],
        synthetic: true,
        syntheticReason: s.reason,
        version,
        deny,
      });
      process.stdout.write(`  ${key}  ${s.planned.scenario} (synthetic)\n`);
      written += 1;
    }
    process.stdout.write(
      `Wrote ${String(written)} synthetic fixtures. Zero live requests.\n`,
    );
    return 0;
  }

  // --- record mode ---------------------------------------------------------
  const captured = new Map<string, RawExchange>();
  const transport = createFetchTransport(spacingMs, (k, e) => {
    captured.set(k, e);
  });
  const client = createHttpClient({
    transport,
    userAgent: buildUserAgent(version),
    clock: createSystemClock(),
  });
  const token = createCancellationTokenSource().token;

  const failures: string[] = [];
  let live = 0;

  /** Issue one planned request, swallowing an upstream error status. */
  const issue = async (p: PlannedRequest): Promise<void> => {
    live += 1;
    try {
      await client.request(p.method as "GET" | "POST", p.url, {
        responseType: "text",
        token,
        ...(p.body !== undefined && {
          body: p.body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
      });
    } catch (error) {
      // A 4xx/5xx is classified into a thrown error by the shipped client. The
      // exchange was still captured by the transport, which is what we want for
      // an error fixture; a transport failure captured nothing and is a real
      // failure.
      if (take(captured, p) === undefined) {
        failures.push(`${p.scenario}: ${describe(error)}`);
      }
    }
  };

  process.stderr.write(
    `Recording ${String(plan.length)} independent requests, >= ` +
      `${String(spacingMs)} ms apart, unkeyed.\n`,
  );
  for (const p of plan) await issue(p);

  // The two pagination `efetch` calls depend on what the two `esearch` pages
  // returned, so they are planned only now. `parseEsearchBody` is the shipped
  // validator; a page that failed simply contributes no efetch.
  const pageIds = (scenario: string): readonly string[] => {
    const planned = plan.find((p) => p.scenario === scenario);
    const got = planned === undefined ? undefined : take(captured, planned);
    if (got === undefined || got.status !== 200) return [];
    try {
      return parseEsearchBody(got.body, planned?.endpoint ?? "").pmids;
    } catch {
      return [];
    }
  };
  const extra = paginatedEfetchPlan(
    pageIds("paginated-page-1"),
    pageIds("paginated-page-2"),
  );
  for (const p of extra) await issue(p);

  // --- write ---------------------------------------------------------------
  let written = 0;
  for (const p of [...plan, ...extra]) {
    const raw = take(captured, p);
    if (raw === undefined) {
      failures.push(`${p.scenario}: nothing was captured`);
      continue;
    }
    const { exchange, notes } = redactExchange(raw, deny);
    const key = await writeFixture({
      scenario: p.scenario,
      method: p.method,
      url: p.url,
      ...(p.body !== undefined && { body: p.body }),
      endpoint: p.endpoint,
      exchange,
      redactions: notes,
      synthetic: false,
      version,
      deny,
    });
    process.stdout.write(
      `  ${key}  ${p.scenario}  status=${String(exchange.status)} ` +
        `${String(exchange.body.length)}B\n`,
    );
    written += 1;
  }

  const richPlanned = plan.find((p) => p.scenario === "record-rich");
  const richRaw =
    richPlanned === undefined ? undefined : take(captured, richPlanned);
  for (const s of syntheticPlan(richRaw?.body, await readDocs02ErrorBody())) {
    const key = await writeFixture({
      scenario: s.planned.scenario,
      method: s.planned.method,
      url: s.planned.url,
      ...(s.planned.body !== undefined && { body: s.planned.body }),
      endpoint: s.planned.endpoint,
      exchange: s.exchange,
      redactions: ["synthetic: nothing was received, nothing to redact"],
      synthetic: true,
      syntheticReason: s.reason,
      version,
      deny,
    });
    process.stdout.write(`  ${key}  ${s.planned.scenario} (synthetic)\n`);
    written += 1;
  }

  process.stdout.write(
    `\n${String(live)} live requests; ${String(written)} fixtures written to ` +
      `test/fixtures/pubmed/.\n`,
  );
  if (failures.length > 0) {
    process.stdout.write(
      `${String(failures.length)} scenario(s) failed:\n  ${failures.join("\n  ")}\n`,
    );
    return 1;
  }
  return 0;
}

/** The recorded `record-rich` body, read back for `FIXTURE_MODE=synthetic`. */
async function readRecordedRichBody(): Promise<string | undefined> {
  const planned = independentPlan().find((p) => p.scenario === "record-rich");
  if (planned === undefined) return undefined;
  const key = fixtureKey({
    method: planned.method,
    url: planned.url,
    ...(planned.body !== undefined && { body: planned.body }),
  });
  try {
    const text = await readFile(`${FIXTURE_DIR}/${key}.json`, "utf8");
    const parsed = JSON.parse(text) as RecordedExchange;
    return parsed.body;
  } catch {
    process.stderr.write(
      `  record-rich is not recorded yet, so error-malformed is skipped ` +
        `(it is a truncation of that body).\n`,
    );
    return undefined;
  }
}

/** A one-line description of a thrown value, with no body and no URL query. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error ? ` [cause: ${error.cause.message}]` : "";
  return `${error.name}: ${redact(error.message)}${cause}`;
}

/**
 * One scenario's planned request, by name.
 *
 * `test/contract/pubmed.contract.test.ts` imports this so that the test and the
 * recorder cannot disagree about what a scenario's request is. That is why the
 * `main()` call below is guarded: importing this module must not record
 * anything.
 *
 * @param scenario - a name from {@link independentPlan} or the synthetic set
 * @returns the planned request
 * @throws Error when no scenario has that name
 */
export function plannedRequest(scenario: string): PlannedRequest {
  const all = [
    ...independentPlan(),
    ...syntheticPlan("", "").map((s) => s.planned),
  ];
  const found = all.find((p) => p.scenario === scenario);
  if (found === undefined) {
    throw new Error(
      `No scenario named "${scenario}". Known: ${all
        .map((p) => p.scenario)
        .join(", ")}`,
    );
  }
  return found;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main();

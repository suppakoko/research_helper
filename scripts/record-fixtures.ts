/**
 * `scripts/record-fixtures.ts` — the recorder behind `npm run fixtures:record`.
 *
 * **Scope.** `P1-T11` steps 2–4 wrote it for PubMed `esearch` and `efetch`
 * into `test/fixtures/pubmed/`; `P2-T33` gave it `docs/07` §11.1 step 5's
 * `--source <id>` flag, so that every `docs/13` §3.1 inventory is recorded by
 * this committed script and not by a scratch one. Each source contributes a
 * {@link SourcePlan}: its fixture directory, its rate-limit host, the requests
 * whose shape is known up front, the ones that depend on an earlier answer
 * (pagination), and the hand-written fixtures. Fixtures are keyed by
 * `test/contract/_transport.ts`'s {@link fixtureKey} so that `replayTransport`
 * finds what this writes. Every scenario list is fixed and versioned
 * ({@link SCENARIO_VERSION}) so a re-record is reproducible.
 *
 * ## Running it
 *
 * ```sh
 * npm run fixtures:record -- --dry-run                       # PubMed: prints the plan only
 * npm run fixtures:record -- --source europepmc --dry-run    # Europe PMC: prints the plan only
 * npm run fixtures:record -- --source crossref --dry-run     # Crossref: prints the plan only
 * FIXTURE_MODE=record npm run fixtures:record -- --source europepmc   # live
 * FIXTURE_MODE=synthetic npm run fixtures:record                      # rewrites the
 *                                                  # hand-written fixtures, no network
 * ```
 *
 * `FIXTURE_MODE` is `docs/13` §2.2's own spelling, and the default being a dry
 * run is deliberate: `npm run fixtures:record` typed by accident must not put
 * requests on anyone's server. `--dry-run` wins over `FIXTURE_MODE`, so a
 * shell that still exports `FIXTURE_MODE=record` cannot record by mistake.
 * `--source` defaults to `pubmed`, which is what the flagless Phase 1 command
 * always meant.
 *
 * On this network Node needs `NODE_USE_SYSTEM_CA=1` — a TLS-inspecting appliance
 * sits in front of everything, and the sanctioned flag is the answer. Disabling
 * certificate verification is never the answer. A dry run needs no network.
 *
 * ## Politeness, which outranks completeness
 *
 * - **No API key, by construction.** `docs/02` §3.1 makes NCBI's key optional and
 *   nothing here reads one. It is also a *correctness* requirement, not only a
 *   deployment one: {@link fixtureKey} hashes the URL, and `api_key=` redacts to
 *   `api_key=REDACTED` rather than vanishing, so a fixture recorded with a key
 *   could never be found by a keyless replay. See the card report.
 * - **Requests are strictly sequential**, one host, one connection, with a
 *   minimum end-to-start gap of {@link spacingMsFor} the plan's host, read from
 *   `HOST_POLICIES`' unkeyed `ratePerSecond` rather than written down here —
 *   `plan/README.md` §5 rule 4.
 * - **`tool` and `email` are not this file's to choose.** Every URL comes from
 *   the shipped builders — `buildEsearchRequest` / `buildEfetchRequest`, which
 *   take them from `ncbiIdentityParams()` (decision D10),
 *   `buildEuropePmcSearchRequest`, which appends `email=`, and
 *   `buildCrossrefWorksRequest`, whose `mailto=` is the maintainer address
 *   here because the recorder has no `contactEmail` preference. The shipped
 *   `createHttpClient` then refuses any NCBI request carrying anything else, so
 *   a mistake here is a thrown `PolicyViolationError` and not a quiet
 *   impoliteness.
 * - **`error-429` and `error-500` are hand-written**, per `P1-T11` step 3:
 *   `docs/02` §3.1 quotes NCBI's "failure to comply with this policy may result
 *   in an IP address being blocked from accessing NCBI", so the rate limit is not
 *   provoked, for any source. `error-malformed` is likewise constructed, by
 *   truncating the recorded `record-rich` body. All three carry
 *   `"synthetic": true` and a reason in their `_meta.json`, so nobody mistakes
 *   them for evidence about the service.
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
 *    maintainer address — **in both its plain and its percent-encoded
 *    spelling** — and of any key-shaped environment value.
 * 4. **The literal scrub is not optional and `redact()` alone is not enough.**
 *    `redact()`'s catch-all pattern needs a 40-character run; an NCBI key is
 *    shorter than that. So key-shaped values are matched literally, by value,
 *    whatever their length.
 * 5. **The percent-encoded spelling is not optional either.** Measured by
 *    `P2-T03` on 2026-10-14: Europe PMC echoes the request's `email=` back in
 *    the body, verbatim in `request.email` and as `suppakoko%40gmail.com` in
 *    `nextPageUrl`. A scrub of the plain spelling alone left the address in six
 *    fixtures. {@link MAINTAINER_ADDRESS_SPELLINGS} carries both, and
 *    {@link assertClean} refuses both.
 * 6. **One class of long opaque run is exempt, per source and by name.**
 *    `redact()`'s 40-character catch-all also matches a pagination cursor, and
 *    a fixture whose cursor reads `[redacted:52]` cannot drive a replayed
 *    paging loop (measured 2026-10-15 on every Crossref page). A plan may name
 *    the tokens its bodies carry that are opaque but not secret
 *    ({@link SourcePlan.opaqueTokens}); {@link scrub} shields exactly those and
 *    {@link assertClean} ignores exactly those. Nothing else is exempt.
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
import {
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
  NCBI_HOST,
} from "../src/core/rateLimit/hostLimiter";
import { createCancellationTokenSource } from "../src/core/jobQueue/cancellation";
import { parseCrossrefWorksBody } from "../src/sources/crossref/crossrefSource";
import { parseEuropePmcSearchBody } from "../src/sources/europepmc/europepmcSource";
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
import {
  CROSSREF_QUERY_DOI_STRING,
  CROSSREF_QUERY_EMPTY,
  CROSSREF_QUERY_JATS,
  CROSSREF_QUERY_PAGINATED,
  CROSSREF_QUERY_PAIR,
  CROSSREF_QUERY_PREPRINT,
  CROSSREF_QUERY_RICH,
  CROSSREF_QUERY_SPARSE,
  CROSSREF_QUERY_SYNTHETIC_400,
  CROSSREF_QUERY_SYNTHETIC_429,
  CROSSREF_QUERY_SYNTHETIC_500,
  CROSSREF_QUERY_SYNTHETIC_MALFORMED,
  CROSSREF_QUERY_TYPICAL,
  CROSSREF_QUERY_UNICODE,
  recordedCrossrefRequest,
} from "../test/support/crossrefRecordedRequests";
import {
  EUROPEPMC_QUERY_CJK,
  EUROPEPMC_QUERY_EMPTY,
  EUROPEPMC_QUERY_ERROR_EMPTY,
  EUROPEPMC_QUERY_JATS,
  EUROPEPMC_QUERY_MANY,
  EUROPEPMC_QUERY_PAGINATED,
  EUROPEPMC_QUERY_PAIR,
  EUROPEPMC_QUERY_POST_LONG,
  EUROPEPMC_QUERY_PREPRINT,
  EUROPEPMC_QUERY_RICH,
  EUROPEPMC_QUERY_SPARSE,
  EUROPEPMC_QUERY_SYNTHETIC_429,
  EUROPEPMC_QUERY_SYNTHETIC_500,
  EUROPEPMC_QUERY_SYNTHETIC_MALFORMED,
  EUROPEPMC_QUERY_TYPICAL,
  EUROPEPMC_QUERY_UNICODE,
  recordedEuropePmcRequest,
} from "../test/support/europepmcRecordedRequests";

// ---------------------------------------------------------------------------
// 0. The command line
// ---------------------------------------------------------------------------

/** The sources this recorder has a plan for. One directory per id (`docs/07` §2.2). */
export const RECORDABLE_SOURCES = ["pubmed", "europepmc", "crossref"] as const;
export type RecordableSourceId = (typeof RECORDABLE_SOURCES)[number];

function isRecordableSource(value: string): value is RecordableSourceId {
  return (RECORDABLE_SOURCES as readonly string[]).includes(value);
}

/** What `--source` and `--dry-run` resolved to. */
export interface CliOptions {
  readonly source: RecordableSourceId;
  /** `--dry-run` was given. Wins over `FIXTURE_MODE`. */
  readonly dryRun: boolean;
}

/** A command-line mistake. Exit code 2, no plan printed. */
export class UsageError extends Error {}

const USAGE =
  "usage: npm run fixtures:record -- [--source <id>] [--dry-run]   " +
  `(sources: ${RECORDABLE_SOURCES.join(", ")})`;

/**
 * Parse the arguments after the script path.
 *
 * `--source <id>` and `--source=<id>` are both accepted; `--dry-run` takes no
 * value. Anything else is a {@link UsageError}: an unknown flag must not be
 * mistaken for "record everything".
 *
 * @param argv - `process.argv.slice(2)`
 * @returns the options, with `pubmed` as the default source
 * @throws UsageError on an unknown argument, a missing value or an unknown source
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let source: RecordableSourceId = "pubmed";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    let value: string | undefined;
    if (arg === "--source") {
      i += 1;
      value = argv[i];
    } else if (arg.startsWith("--source=")) {
      value = arg.slice("--source=".length);
    } else {
      throw new UsageError(`Unknown argument "${arg}".\n${USAGE}`);
    }
    if (value === undefined || value === "") {
      throw new UsageError(`--source needs a value.\n${USAGE}`);
    }
    if (!isRecordableSource(value)) {
      throw new UsageError(
        `No recording plan for source "${value}".\n${USAGE}`,
      );
    }
    source = value;
  }
  return { source, dryRun };
}

// ---------------------------------------------------------------------------
// 1. Where things go, and the scenario list's version
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * `test/fixtures/<source>/` — one directory per `SourceId`, no abbreviations
 * (`docs/07` §2.2, §11.1 step 5).
 *
 * @param source - the source id
 * @returns the absolute directory
 */
export function fixtureDirFor(source: RecordableSourceId): string {
  return resolve(REPO_ROOT, "test/fixtures", source);
}

/** PubMed's directory, kept under its Phase 1 name. */
export const FIXTURE_DIR = fixtureDirFor("pubmed");

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
// 2. The PubMed queries. Fixed, and every date bound is a closed historical window.
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
   * `<ELocationID>`, `<PubDate>` of `<Year>1976</Year><Month>Jun</Month>` with no
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
 * The minimum end-to-start gap between requests to `host`, in milliseconds.
 *
 * Derived from `HOST_POLICIES`' unkeyed `ratePerSecond` for the host — for
 * `eutils.ncbi.nlm.nih.gov` 2.5/s, which `docs/07` §7.3 sets below `docs/02`
 * §3.1's unkeyed ceiling of 3/s on purpose; for `www.ebi.ac.uk` §7.3's 5/s.
 * Nothing is written down here; change the policy row and this follows.
 *
 * @param host - a plan's host
 * @returns the gap
 * @throws Error if the host has no policy row — a rate limit is never guessed
 */
export function spacingMsFor(host: string): number {
  const row = HOST_POLICIES.find((p) => p.host === host);
  if (row === undefined) {
    throw new Error(
      `No HOST_POLICIES row for ${host}: refusing to guess a rate limit ` +
        `(plan/README.md §5 rule 4).`,
    );
  }
  return Math.ceil(1000 / row.withoutKey.ratePerSecond);
}

/** {@link spacingMsFor} NCBI — the Phase 1 name, kept. */
export function ncbiSpacingMs(): number {
  return spacingMsFor(NCBI_HOST);
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
 * The maintainer address in every spelling a service has echoed it in.
 *
 * `docs/02` §2.2 puts the address in every outbound URL by construction. The
 * plain spelling is what PubMed never echoes and Europe PMC echoes in
 * `request.email`; the percent-encoded one (`%40` for `@`) is what Europe PMC
 * writes into `nextPageUrl` (`P2-T03`, contradiction 5, measured 2026-10-14).
 * Both scrub to {@link EMAIL_PLACEHOLDER} and both abort {@link assertClean}.
 */
export const MAINTAINER_ADDRESS_SPELLINGS: readonly string[] = [
  MAINTAINER_EMAIL,
  encodeURIComponent(MAINTAINER_EMAIL),
];

/**
 * Literal strings scrubbed from every header value and body before writing.
 *
 * The maintainer address comes first, in both spellings
 * ({@link MAINTAINER_ADDRESS_SPELLINGS}); `P1-T11`'s **Do NOT** requires §3.2's
 * `mailto` strip. Then every environment value whose *variable name* matches
 * `src/core/errors.ts`'s `KEYISH_FIELD` — matched literally, by value, because
 * `redact()`'s catch-all needs a 40-character run and a 32- or 36-character key
 * slips under it.
 *
 * @returns the deny-list, longest first so a longer match wins
 */
export function literalDenyList(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const out = new Set<string>(MAINTAINER_ADDRESS_SPELLINGS);
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.length < 8) continue;
    if (KEYISH_FIELD.test(name)) out.add(value);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const EMAIL_PLACEHOLDER = "[redacted:maintainer-address]";
const SECRET_PLACEHOLDER = "[redacted:env-secret]";

/** The stand-in an allowed opaque token wears while {@link scrub} runs. */
function allowPlaceholder(index: number): string {
  return `\u0000RH_ALLOW_${String(index)}\u0000`;
}

/**
 * Scrub one string: `redact()` first, then the literal deny-list — with the
 * `allow` tokens shielded. Each allowed token is swapped for a placeholder
 * `redact()` cannot match before the pass and swapped back after it, so a
 * pagination cursor survives the 40-character catch-all that would otherwise
 * replace it (measured 2026-10-15: every Crossref `next-cursor`, 51–68
 * opaque characters, came back `[redacted:NN]` and no page 2 could be replayed).
 */
function scrub(
  value: string,
  deny: readonly string[],
  allow: readonly string[] = [],
): string {
  let working = value;
  const shielded: string[] = [];
  for (const token of allow) {
    if (token === "" || !working.includes(token)) continue;
    working = working.split(token).join(allowPlaceholder(shielded.length));
    shielded.push(token);
  }
  let out = redact(working);
  for (const literal of deny) {
    if (literal === "") continue;
    out = out
      .split(literal)
      .join(
        MAINTAINER_ADDRESS_SPELLINGS.includes(literal)
          ? EMAIL_PLACEHOLDER
          : SECRET_PLACEHOLDER,
      );
  }
  for (const [index, token] of shielded.entries()) {
    out = out.split(allowPlaceholder(index)).join(token);
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
 * @param allow - opaque tokens the source's plan vouches for as non-secret
 *   ({@link SourcePlan.opaqueTokens}); kept verbatim through the pass
 * @returns the writable exchange and a note per thing removed or kept
 */
export function redactExchange(
  raw: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
  deny: readonly string[],
  allow: readonly string[] = [],
): Redacted {
  const notes: string[] = [];
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw.headers)) {
    const lower = name.toLowerCase();
    if (HEADER_DENY_LIST.includes(lower)) {
      notes.push(`dropped header ${lower}`);
      continue;
    }
    const scrubbed = scrub(value, deny, allow);
    if (scrubbed !== value) notes.push(`scrubbed header ${lower}`);
    headers[lower] = scrubbed;
  }
  const body = scrub(raw.body, deny, allow);
  if (body !== raw.body) notes.push("scrubbed body");
  const kept = allow.filter(
    (token) => token !== "" && raw.body.includes(token),
  );
  if (kept.length > 0) {
    notes.push(
      `preserved ${String(kept.length)} opaque pagination token(s) the ` +
        `source plan vouches for; they are not credentials`,
    );
  }
  const encoded = MAINTAINER_ADDRESS_SPELLINGS.find(
    (spelling) => spelling !== MAINTAINER_EMAIL && raw.body.includes(spelling),
  );
  if (encoded !== undefined) {
    notes.push("scrubbed body: percent-encoded contact address");
  }
  // Worded without a literal `api_key=` or `email=`: `assertClean` greps the
  // metadata it is about to write, and prose naming the parameter would trip it.
  notes.push("request URL withheld: it carries the contact and key parameters");
  return {
    exchange: { status: raw.status, headers, body },
    notes,
  };
}

/** `address` as a pattern matching its plain and percent-encoded spellings. */
function addressPattern(address: string): RegExp {
  const escape = (s: string): string =>
    s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const at = address.indexOf("@");
  if (at === -1) return new RegExp(escape(address), "iu");
  return new RegExp(
    `${escape(address.slice(0, at))}(?:@|%40)${escape(address.slice(at + 1))}`,
    "iu",
  );
}

/** Patterns a written fixture must not match, with what each one means. */
const FORBIDDEN: readonly { readonly what: string; readonly re: RegExp }[] = [
  { what: "the maintainer address", re: addressPattern(MAINTAINER_EMAIL) },
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
 * @param allow - the opaque tokens {@link redactExchange} preserved; removed
 *   from `text` before the credential-shape check, nowhere else
 * @throws Error naming what matched, without quoting it
 */
export function assertClean(
  scenario: string,
  text: string,
  deny: readonly string[],
  allow: readonly string[] = [],
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
  const withoutAllowed = allow.reduce(
    (acc, token) => (token === "" ? acc : acc.split(token).join("")),
    text,
  );
  const stillKeyish = redact(withoutAllowed);
  if (stillKeyish !== withoutAllowed) {
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
  /** Opaque tokens preserved by {@link redactExchange}; see {@link SourcePlan.opaqueTokens}. */
  readonly allow?: readonly string[];
}

/** Write one `<key>.json` and its `<key>_meta.json` into `dir`. Returns the key. */
async function writeFixture(dir: string, req: WriteRequest): Promise<string> {
  const key = fixtureKey({
    method: req.method,
    url: req.url,
    ...(req.body !== undefined && { body: req.body }),
  });
  const fixtureText = toJson(req.exchange);
  assertClean(req.scenario, fixtureText, req.deny, req.allow ?? []);

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

  await writeFile(`${dir}/${key}.json`, fixtureText, "utf8");
  await writeFile(`${dir}/${key}${META_SUFFIX}`, metaText, "utf8");
  return key;
}

// ---------------------------------------------------------------------------
// 6. The live transport
// ---------------------------------------------------------------------------

/**
 * One exchange as the transport saw it, before redaction — or as a committed
 * fixture holds it, after. The three members are the same either way, which is
 * what lets a dry run answer a dependent request from disk.
 */
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
// 7. Plans: what one source records, as something a dry run can print
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

/** A fixture that is written rather than recorded, with the reason. */
export interface SyntheticFixture {
  readonly planned: PlannedRequest;
  readonly exchange: RecordedExchange;
  readonly reason: string;
}

/**
 * "What did this request return?" In record mode the answer comes from the
 * live captures; in a dry run and in synthetic mode it comes from the committed
 * fixture with the same key, so that pagination cursors and the `record-rich`
 * body are available without a request. `undefined` means "nothing to answer
 * with", and the dependent request is then skipped and said to be skipped.
 */
export type Answer = (
  planned: PlannedRequest,
) => Promise<RawExchange | undefined>;

/**
 * Everything the recorder needs to know about one source. `docs/07` §11.1
 * step 5: a new adapter adds one of these and nothing else here.
 */
export interface SourcePlan {
  readonly source: RecordableSourceId;
  /** The `HOST_POLICIES` row the pacing is read from. */
  readonly host: string;
  readonly fixtureDir: string;
  /** Requests whose shape is known before any response arrives. */
  readonly independent: () => readonly PlannedRequest[];
  /** Requests that need an earlier answer — pagination cursors, resolved ids. */
  readonly dependent: (answer: Answer) => Promise<readonly PlannedRequest[]>;
  /** The hand-written fixtures' requests, for keys; no body needed. */
  readonly syntheticRequests: () => readonly PlannedRequest[];
  /** The hand-written fixtures with bodies; may read an earlier answer. */
  readonly syntheticFixtures: (
    answer: Answer,
  ) => Promise<readonly SyntheticFixture[]>;
  /**
   * Opaque, non-secret tokens in a live body that the redaction pass must keep
   * verbatim — a pagination cursor, which is exactly the long opaque run
   * `redact()`'s catch-all exists to catch. Absent means nothing is exempt.
   * Added for Crossref (`P2-T04`), whose `message.next-cursor` is 51–68
   * base64 characters; PubMed and Europe PMC have no such token.
   */
  readonly opaqueTokens?: (body: string) => readonly string[];
}

/** The planned request's hash key — what the fixture file is named. */
function keyOf(p: PlannedRequest): string {
  return fixtureKey({
    method: p.method,
    url: p.url,
    ...(p.body !== undefined && { body: p.body }),
  });
}

/** An {@link Answer} that reads committed fixtures from `dir`. */
function committedAnswer(dir: string): Answer {
  return async (planned) => {
    try {
      const text = await readFile(`${dir}/${keyOf(planned)}.json`, "utf8");
      return JSON.parse(text) as RecordedExchange;
    } catch {
      return undefined;
    }
  };
}

// --- 7a. PubMed -------------------------------------------------------------

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
 * PubMed's scenarios whose request is known before any response arrives.
 *
 * `docs/13` §3.1's PubMed rows, less the three that cannot be provoked politely
 * (§8's synthetic set) and less the two the `P1-T11` card deliberately leaves
 * out of its own inventory — §3.1's `record-preprint` and `dedup-pair-set`,
 * which are a Phase 2 concern because they need a second source.
 * `test/contract/replayHarness.test.ts` imports this by name.
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

/** The PMIDs a recorded `esearch` page resolved to; none if it is not usable. */
async function pubmedPageIds(
  answer: Answer,
  scenario: string,
): Promise<readonly string[]> {
  const planned = independentPlan().find((p) => p.scenario === scenario);
  if (planned === undefined) return [];
  const got = await answer(planned);
  if (got === undefined || got.status !== 200) return [];
  try {
    return parseEsearchBody(got.body, planned.endpoint).pmids;
  } catch {
    return [];
  }
}

// --- 7b. Europe PMC ---------------------------------------------------------

/**
 * A Europe PMC `search` request for the plan, exactly as the shipped adapter
 * builds it (`recordedEuropePmcRequest`): clamped `pageSize`, `resultType=core`,
 * `cursorMark` from `cursor` or `*`.
 */
function epmcSearch(
  scenario: string,
  purpose: string,
  query: SourceQuery,
  cursor?: string,
): PlannedRequest {
  const built = recordedEuropePmcRequest(query, cursor);
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    ...(built.body !== undefined && { body: built.body }),
    endpoint: built.endpointBaseUrl,
  };
}

/**
 * Europe PMC's scenarios whose request is known up front: `docs/13` §3.1's
 * thirteen names less the three synthetic ones and pages 2–3, plus the five
 * extras `P2-T03` recorded (`record-many-authors`, `record-unicode-cjk`,
 * `search-error-empty-query`, `search-post-long-query`, and the paginated
 * pages). The queries are `test/support/europepmcRecordedRequests.ts`'s.
 */
export function europepmcIndependentPlan(): readonly PlannedRequest[] {
  return [
    epmcSearch(
      "search-typical",
      "§3.1: ~20 results for a stable biomedical query, date filter applied",
      EUROPEPMC_QUERY_TYPICAL,
    ),
    epmcSearch("search-empty", "§3.1: zero results", EUROPEPMC_QUERY_EMPTY),
    epmcSearch(
      "search-single",
      "§3.1: one result — off-by-one and not-an-array bugs (pageSize 1)",
      { ...EUROPEPMC_QUERY_TYPICAL, limit: 1 },
    ),
    epmcSearch(
      "search-error-empty-query",
      "docs/02 §4.9: errCode 404 inside an HTTP 200, for an empty query=",
      EUROPEPMC_QUERY_ERROR_EMPTY,
    ),
    epmcSearch(
      "record-rich",
      "§3.1: every optional field populated (docs/02 §3.4's paper, by title)",
      EUROPEPMC_QUERY_RICH,
    ),
    epmcSearch(
      "record-sparse",
      "§3.1: no abstract, no DOI (MED/60000)",
      EUROPEPMC_QUERY_SPARSE,
    ),
    epmcSearch(
      "record-unicode",
      "§3.1: diacritics in author names, markup and a VO2max title",
      EUROPEPMC_QUERY_UNICODE,
    ),
    epmcSearch(
      "record-unicode-cjk",
      "§3.1 probe: a CJK title query — the service's title field stays Latin",
      EUROPEPMC_QUERY_CJK,
    ),
    epmcSearch(
      "record-jats-abstract",
      "§3.1: a structured abstract with inline markup",
      EUROPEPMC_QUERY_JATS,
    ),
    epmcSearch(
      "record-many-authors",
      "docs/07 §11.1 step 6: a record with 50+ authors (88)",
      EUROPEPMC_QUERY_MANY,
    ),
    epmcSearch(
      "record-preprint",
      "§3.1: PPR records with a linked published version",
      EUROPEPMC_QUERY_PREPRINT,
    ),
    epmcSearch(
      "dedup-pair-set",
      "§3.1: PubMed's record-rich paper as Europe PMC returns it, by DOI",
      EUROPEPMC_QUERY_PAIR,
    ),
    epmcSearch(
      "paginated-page-1",
      "§3.1: page 1 of a five-hit set at pageSize 3",
      EUROPEPMC_QUERY_PAGINATED,
    ),
    epmcSearch(
      "search-post-long-query",
      "docs/02 §4.2: a query over the design budget travels as POST /searchPOST",
      EUROPEPMC_QUERY_POST_LONG,
    ),
  ];
}

/** The cursor a recorded Europe PMC page offered, or `undefined`. */
async function europepmcCursorAfter(
  answer: Answer,
  planned: PlannedRequest | undefined,
): Promise<string | undefined> {
  if (planned === undefined) return undefined;
  const got = await answer(planned);
  if (got === undefined || got.status !== 200) return undefined;
  try {
    // The raw `nextCursorMark`, not `nextCursorAfter`'s verdict: page 3 was
    // recorded on purpose, past the short-page rule, to prove the rule right.
    return parseEuropePmcSearchBody(got.body, planned.endpoint).nextCursorMark;
  } catch {
    return undefined;
  }
}

/**
 * Pages 2 and 3 of `paginated`, each keyed under the cursor the page before it
 * returned. Measured 2026-10-14: page 2 held 2 of 5 and still offered a cursor;
 * page 3 held nothing and no cursor (`P2-T03`, contradiction 4).
 */
async function europepmcDependentPlan(
  answer: Answer,
): Promise<readonly PlannedRequest[]> {
  const out: PlannedRequest[] = [];
  const page1 = europepmcIndependentPlan().find(
    (p) => p.scenario === "paginated-page-1",
  );
  const cursor2 = await europepmcCursorAfter(answer, page1);
  if (cursor2 === undefined) return out;
  const page2 = epmcSearch(
    "paginated-page-2",
    "§3.1: page 2, under page 1's nextCursorMark — a short page with a cursor",
    EUROPEPMC_QUERY_PAGINATED,
    cursor2,
  );
  out.push(page2);
  const cursor3 = await europepmcCursorAfter(answer, page2);
  if (cursor3 === undefined) return out;
  out.push(
    epmcSearch(
      "paginated-page-3",
      "§3.1: page 3, under page 2's nextCursorMark — empty, no cursor",
      EUROPEPMC_QUERY_PAGINATED,
      cursor3,
    ),
  );
  return out;
}

/** `error-429`'s Europe PMC body: a placeholder that says so. */
const EUROPEPMC_SYNTHETIC_429_BODY =
  "synthetic fixture: Europe PMC publishes no 429 body shape (docs/02 §4.1, " +
  "§4.9); the limit was not provoked. Status and Retry-After are the " +
  "assertable parts.\n";

/** `error-500`'s Europe PMC body: `docs/02` §4.7's measured 503, verbatim. */
const EUROPEPMC_SYNTHETIC_503_BODY =
  "This API is temporarily unavailable due to maintenance.";

/**
 * Europe PMC's three hand-written fixtures. The same three names and reasons
 * `P2-T03` committed; `error-500` is a 503 because that is the 5xx the corpus
 * has actually measured (`docs/02` §4.7).
 *
 * @param richBody - the recorded `record-rich` body, for `error-malformed`;
 *   `undefined` skips that fixture
 */
function europepmcSyntheticPlan(
  richBody: string | undefined,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
    {
      planned: epmcSearch(
        "error-429",
        "§3.1: rate-limit response including Retry-After",
        EUROPEPMC_QUERY_SYNTHETIC_429,
      ),
      exchange: {
        status: 429,
        headers: { "content-type": "text/plain", "retry-after": "2" },
        body: EUROPEPMC_SYNTHETIC_429_BODY,
      },
      reason:
        "Hand-written. Provoking a rate limit on a shared, per-IP budget " +
        "(docs/07 §7.3's unverified note) is not acceptable; status and " +
        "Retry-After are the assertable parts, the body is a placeholder.",
    },
    {
      planned: epmcSearch(
        "error-500",
        "§3.1: server error (docs/02 §4.7's measured text/plain 503)",
        EUROPEPMC_QUERY_SYNTHETIC_500,
      ),
      exchange: {
        status: 503,
        headers: { "content-type": "text/plain" },
        body: EUROPEPMC_SYNTHETIC_503_BODY,
      },
      reason:
        "Hand-written from docs/02 §4.7's measured /references outage: HTTP " +
        "503, Content-Type text/plain, that exact body. A 5xx cannot be " +
        "provoked on demand.",
    },
  ];
  if (richBody !== undefined) {
    out.push({
      planned: epmcSearch(
        "error-malformed",
        "§3.1: truncated/invalid body",
        EUROPEPMC_QUERY_SYNTHETIC_MALFORMED,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json;charset=UTF-8" },
        body: richBody.slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body, cut inside the JSON. Europe ` +
        `PMC has no documented way to ask for a truncated body.`,
    });
  }
  return out;
}

// --- 7c. Crossref -------------------------------------------------------------

/**
 * A Crossref `/works` request for the plan, exactly as the shipped adapter
 * builds it (`recordedCrossrefRequest`): clamped `rows`, the shipped `select`
 * whitelist, `cursor` from `cursor` or `*`, `mailto` the maintainer address
 * (no `contactEmail` preference exists here).
 */
function crossrefWorks(
  scenario: string,
  purpose: string,
  query: SourceQuery,
  cursor?: string,
): PlannedRequest {
  const built = recordedCrossrefRequest(query, cursor);
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    endpoint: built.endpointBaseUrl,
  };
}

/**
 * Crossref's scenarios whose request is known up front: `docs/13` §3.1's
 * thirteen names less the three synthetic ones and page 2, plus one probe
 * (`search-doi-string`). The queries are `test/support/crossrefRecordedRequests.ts`'s.
 * Every request carries the polite-pool `mailto` and the `User-Agent`
 * (`docs/02` §5.1), and the pacing is §7.3's starting rate for the host.
 */
export function crossrefIndependentPlan(): readonly PlannedRequest[] {
  return [
    crossrefWorks(
      "search-typical",
      "§3.1: ~20 results for a stable biomedical query, date filter applied",
      CROSSREF_QUERY_TYPICAL,
    ),
    crossrefWorks(
      "search-empty",
      "§3.1: zero results (one token that matches nothing)",
      CROSSREF_QUERY_EMPTY,
    ),
    crossrefWorks(
      "search-single",
      "§3.1: one result — off-by-one and not-an-array bugs (rows 1)",
      { ...CROSSREF_QUERY_TYPICAL, limit: 1 },
    ),
    crossrefWorks(
      "record-rich",
      "§3.1: every optional field populated (docs/02 §3.4's paper, by title)",
      CROSSREF_QUERY_RICH,
    ),
    crossrefWorks(
      "record-sparse",
      "§3.1: no abstract, coarse date (a 1976 Veterinary Record paper)",
      CROSSREF_QUERY_SPARSE,
    ),
    crossrefWorks(
      "record-unicode",
      "§3.1: diacritics in author names, inline markup and a VO2max title",
      CROSSREF_QUERY_UNICODE,
    ),
    crossrefWorks(
      "record-jats-abstract",
      "§3.1 / docs/02 §5.4: a boxed-text JATS abstract (the document's own example)",
      CROSSREF_QUERY_JATS,
    ),
    crossrefWorks(
      "record-preprint",
      "§3.1: a bioRxiv posted-content with relation.is-preprint-of",
      CROSSREF_QUERY_PREPRINT,
    ),
    crossrefWorks(
      "dedup-pair-set",
      "§3.1: PubMed's record-rich paper as Crossref returns it, by title, 3 rows",
      CROSSREF_QUERY_PAIR,
    ),
    crossrefWorks(
      "search-doi-string",
      "probe: does query.bibliographic resolve a bare DOI string? (for P2-T12)",
      CROSSREF_QUERY_DOI_STRING,
    ),
    crossrefWorks(
      "paginated-page-1",
      "§3.1: page 1 of the typical query at rows 3, cursor=*",
      CROSSREF_QUERY_PAGINATED,
    ),
  ];
}

/**
 * `message.next-cursor`, the one opaque token a Crossref body carries that the
 * redaction pass must keep ({@link SourcePlan.opaqueTokens}). A body that is
 * not a `/works` page vouches for nothing.
 */
function crossrefOpaqueTokens(body: string): readonly string[] {
  try {
    const cursor = parseCrossrefWorksBody(body, "").nextCursor;
    return cursor === undefined ? [] : [cursor];
  } catch {
    return [];
  }
}

/** The cursor a recorded Crossref page offered, or `undefined`. */
async function crossrefCursorAfter(
  answer: Answer,
  planned: PlannedRequest | undefined,
): Promise<string | undefined> {
  if (planned === undefined) return undefined;
  const got = await answer(planned);
  if (got === undefined || got.status !== 200) return undefined;
  try {
    return parseCrossrefWorksBody(got.body, planned.endpoint).nextCursor;
  } catch {
    return undefined;
  }
}

/**
 * Page 2 of `paginated`, keyed under the `next-cursor` page 1 returned
 * (`docs/02` §5.5). One dependent request: the typical query has hundreds of
 * hits, so termination is not recorded here — the empty-`items` rule is
 * exercised on `search-empty` and with stubs in the unit test.
 */
async function crossrefDependentPlan(
  answer: Answer,
): Promise<readonly PlannedRequest[]> {
  const page1 = crossrefIndependentPlan().find(
    (p) => p.scenario === "paginated-page-1",
  );
  const cursor2 = await crossrefCursorAfter(answer, page1);
  if (cursor2 === undefined) return [];
  return [
    crossrefWorks(
      "paginated-page-2",
      "§3.1: page 2, under page 1's next-cursor",
      CROSSREF_QUERY_PAGINATED,
      cursor2,
    ),
  ];
}

/**
 * `error-429`'s Crossref body: a placeholder that says so. The headers are
 * the measured public-pool set of `docs/02` §5.1 plus a `Retry-After`, which
 * §5.6 says to honour ("back off, check `x-rate-limit-*`").
 */
const CROSSREF_SYNTHETIC_429_BODY =
  "synthetic fixture: Crossref publishes no 429 body shape (docs/02 §5.6); " +
  "the limit was not provoked. Status, Retry-After and the x-rate-limit-* " +
  "headers are the assertable parts.\n";

/** `error-500`'s Crossref body: §5.6's 504 "timeout on a heavy query". */
const CROSSREF_SYNTHETIC_504_BODY =
  "<html><body><h1>504 Gateway Time-out</h1></body></html>\n";

/**
 * `error-400`'s body: `docs/02` §5.6's "malformed filter or param — the body
 * names the offending token", **measured 2026-10-14** on eleven live requests
 * whose `select` named `reference-count`, `institution` and `language`. The
 * first of the three `message` entries, verbatim (the other two differ only in
 * `value`); the valid-selects list is the route's own and is why
 * `CROSSREF_SELECT_FIELDS` reads `references-count`.
 */
const CROSSREF_MEASURED_400_BODY =
  '{"status":"failed","message-type":"validation-failure","message":[{"type":' +
  '"select-not-available","value":"reference-count","message":"Select ' +
  "'reference-count' specified but there is no such select for this route. " +
  "Valid selects for this route are: abstract, URL, resource, member, posted, " +
  "score, created, degree, update-policy, short-title, license, ISSN, " +
  "container-title, issued, update-to, issue, prefix, approved, indexed, " +
  "article-number, clinical-trial-number, accepted, author, group-title, DOI, " +
  "is-referenced-by-count, updated-by, event, chair, standards-body, " +
  "original-title, funder, translator, published, archive, published-print, " +
  "alternative-id, subject, subtitle, published-online, publisher-location, " +
  "content-domain, reference, title, link, type, publisher, volume, " +
  "references-count, ISBN, issn-type, assertion, deposited, page, contributor, " +
  'content-created, short-container-title, relation, editor"}]}';

/**
 * Crossref's four written fixtures: `error-400` (measured body, see
 * {@link CROSSREF_MEASURED_400_BODY}), `error-429`, `error-500` — a 504,
 * because that is the 5xx `docs/02` §5.6 documents for this host ("reduce
 * `rows`, add `select`") — and `error-malformed`.
 *
 * @param richBody - the recorded `record-rich` body, for `error-malformed`;
 *   `undefined` skips that fixture
 */
function crossrefSyntheticPlan(
  richBody: string | undefined,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
    {
      planned: crossrefWorks(
        "error-429",
        "§3.1: rate-limit response including Retry-After and x-rate-limit-*",
        CROSSREF_QUERY_SYNTHETIC_429,
      ),
      exchange: {
        status: 429,
        headers: {
          "content-type": "text/plain",
          "retry-after": "2",
          "x-rate-limit-limit": "1",
          "x-rate-limit-interval": "1s",
          "x-concurrency-limit": "1",
          "x-api-pool": "public-array",
        },
        body: CROSSREF_SYNTHETIC_429_BODY,
      },
      reason:
        "Hand-written. Provoking a rate limit on the shared polite pool is " +
        "not acceptable; status, Retry-After and the public-pool headers " +
        "docs/02 §5.1 measured are the assertable parts, the body is a " +
        "placeholder.",
    },
    {
      planned: crossrefWorks(
        "error-400",
        "docs/02 §5.6: 400 validation-failure naming the offending select (measured)",
        CROSSREF_QUERY_SYNTHETIC_400,
      ),
      exchange: {
        status: 400,
        headers: {
          "content-type": "application/json;charset=utf-8",
          "x-api-pool": "polite-array",
          "x-concurrency-limit": "3",
          "x-rate-limit-interval": "1s",
          "x-rate-limit-limit": "3",
        },
        body: CROSSREF_MEASURED_400_BODY,
      },
      reason:
        "Measured live 2026-10-14 (status, the polite-pool headers and the " +
        "first message entry verbatim), then written under a reproducible " +
        "key: the select list that drew it is one the shipped builder no " +
        "longer sends, so the live request cannot be replayed from the " +
        "builder.",
    },
    {
      planned: crossrefWorks(
        "error-500",
        "§3.1: server error (docs/02 §5.6's 504 on a heavy query)",
        CROSSREF_QUERY_SYNTHETIC_500,
      ),
      exchange: {
        status: 504,
        headers: { "content-type": "text/html" },
        body: CROSSREF_SYNTHETIC_504_BODY,
      },
      reason:
        "Hand-written from docs/02 §5.6's error table: 504 'timeout on a " +
        "heavy query'. A 5xx cannot be provoked on demand; the body is a " +
        "placeholder.",
    },
  ];
  if (richBody !== undefined) {
    out.push({
      planned: crossrefWorks(
        "error-malformed",
        "§3.1: truncated/invalid body",
        CROSSREF_QUERY_SYNTHETIC_MALFORMED,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json" },
        // `redact()` first: the live body opens with `next-cursor`, and the
        // truncated fixture is not a page anyone pages from, so the cursor is
        // redacted here rather than exempted (`assertClean` would otherwise
        // refuse the credential-shaped run).
        body: redact(richBody).slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body after redaction, cut inside ` +
        `the JSON. Crossref has no documented way to ask for a truncated body.`,
    });
  }
  return out;
}

// --- 7d. The registry -------------------------------------------------------

/** The `record-rich` body a plan's `error-malformed` is cut from. */
async function recordedRichBody(
  answer: Answer,
  plan: readonly PlannedRequest[],
): Promise<string | undefined> {
  const rich = plan.find((p) => p.scenario === "record-rich");
  if (rich === undefined) return undefined;
  const got = await answer(rich);
  if (got === undefined) {
    process.stderr.write(
      `  record-rich is not available, so error-malformed is skipped ` +
        `(it is a truncation of that body).\n`,
    );
    return undefined;
  }
  return got.body;
}

/**
 * The plan for one source.
 *
 * @param source - a {@link RecordableSourceId}
 * @returns its plan
 */
export function planFor(source: RecordableSourceId): SourcePlan {
  switch (source) {
    case "pubmed":
      return {
        source,
        host: NCBI_HOST,
        fixtureDir: fixtureDirFor("pubmed"),
        independent: independentPlan,
        dependent: async (answer) =>
          paginatedEfetchPlan(
            await pubmedPageIds(answer, "paginated-page-1"),
            await pubmedPageIds(answer, "paginated-page-2"),
          ),
        syntheticRequests: () => syntheticPlan("", "").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          syntheticPlan(
            await recordedRichBody(answer, independentPlan()),
            await readDocs02ErrorBody(),
          ),
      };
    case "europepmc":
      return {
        source,
        host: EBI_HOST,
        fixtureDir: fixtureDirFor("europepmc"),
        independent: europepmcIndependentPlan,
        dependent: europepmcDependentPlan,
        syntheticRequests: () =>
          europepmcSyntheticPlan("").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          europepmcSyntheticPlan(
            await recordedRichBody(answer, europepmcIndependentPlan()),
          ),
      };
    case "crossref":
      return {
        source,
        host: CROSSREF_HOST,
        fixtureDir: fixtureDirFor("crossref"),
        independent: crossrefIndependentPlan,
        dependent: crossrefDependentPlan,
        syntheticRequests: () =>
          crossrefSyntheticPlan("").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          crossrefSyntheticPlan(
            await recordedRichBody(answer, crossrefIndependentPlan()),
          ),
        opaqueTokens: crossrefOpaqueTokens,
      };
  }
}

// ---------------------------------------------------------------------------
// 8. PubMed's synthetic fixtures
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

/** How much of the `record-rich` body `error-malformed` keeps, for every source. */
const MALFORMED_PREFIX_BYTES = 1024;

/**
 * Build PubMed's fixtures that are written rather than recorded.
 *
 * @param richBody - the recorded `record-rich` body, truncated for
 *   `error-malformed`. `undefined` when it is not available, in which case
 *   `error-malformed` is skipped and said to be skipped.
 */
function syntheticPlan(
  richBody: string | undefined,
  upstreamErrorBody: string,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
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

/** Look one live exchange up by the request that produced it. */
function take(
  captured: ReadonlyMap<string, RawExchange>,
  planned: PlannedRequest,
): RawExchange | undefined {
  return captured.get(`${planned.method} ${planned.url} ${planned.body ?? ""}`);
}

/** One `  <key>  <scenario>` line and its purpose, as the dry run prints it. */
function planLine(p: PlannedRequest, suffix = ""): string {
  return `  ${keyOf(p)}  ${p.scenario}${suffix}\n      ${p.purpose}\n`;
}

async function main(argv: readonly string[]): Promise<number> {
  let cli: CliOptions;
  try {
    cli = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`fixtures:record: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const mode: Mode = cli.dryRun
    ? "dry-run"
    : readMode(process.env["FIXTURE_MODE"]);
  const plan = planFor(cli.source);
  const deny = literalDenyList();
  const version = await toolVersion();
  const spacingMs = spacingMsFor(plan.host);
  const fromDisk = committedAnswer(plan.fixtureDir);

  const independent = plan.independent();
  if (mode === "dry-run") {
    // Dependent requests are resolved from the committed fixtures, so a dry
    // run over a recorded source prints every key the directory holds.
    const dependent = await plan.dependent(fromDisk);
    const synthetic = plan.syntheticRequests();
    process.stdout.write(
      `fixtures:record — dry run for ${plan.source}. Nothing was requested ` +
        `and nothing written.\n` +
        `Scenario list version ${String(SCENARIO_VERSION)}; ` +
        `${String(independent.length)} independent live requests, ` +
        `${String(dependent.length)} dependent (resolved from ` +
        `test/fixtures/${plan.source}/ where recorded), ` +
        `${String(synthetic.length)} synthetic; paced at >= ` +
        `${String(spacingMs)} ms on ${plan.host}.\n` +
        `Run it for real with: FIXTURE_MODE=record npm run fixtures:record ` +
        `-- --source ${plan.source}\n` +
        `Rewrite only the hand-written fixtures with: ` +
        `FIXTURE_MODE=synthetic npm run fixtures:record -- --source ` +
        `${plan.source}\n\n`,
    );
    for (const p of independent) process.stdout.write(planLine(p));
    for (const p of dependent)
      process.stdout.write(planLine(p, " (dependent)"));
    for (const p of synthetic)
      process.stdout.write(planLine(p, " (synthetic)"));
    return 0;
  }

  await mkdir(plan.fixtureDir, { recursive: true });

  if (mode === "synthetic") {
    let written = 0;
    for (const s of await plan.syntheticFixtures(fromDisk)) {
      const key = await writeFixture(plan.fixtureDir, {
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
      `Wrote ${String(written)} synthetic fixtures to ` +
        `test/fixtures/${plan.source}/. Zero live requests.\n`,
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
  const fromLive: Answer = (p) => Promise.resolve(take(captured, p));

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
    `Recording ${plan.source}: ${String(independent.length)} independent ` +
      `requests, >= ${String(spacingMs)} ms apart, unkeyed.\n`,
  );
  for (const p of independent) await issue(p);

  // Dependent requests (pagination) are planned only now, from what the live
  // answers hold. A page that failed simply contributes nothing further.
  const extra = await plan.dependent(fromLive);
  for (const p of extra) await issue(p);

  // --- write ---------------------------------------------------------------
  let written = 0;
  for (const p of [...independent, ...extra]) {
    const raw = take(captured, p);
    if (raw === undefined) {
      failures.push(`${p.scenario}: nothing was captured`);
      continue;
    }
    const allow = plan.opaqueTokens?.(raw.body) ?? [];
    const { exchange, notes } = redactExchange(raw, deny, allow);
    const key = await writeFixture(plan.fixtureDir, {
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
      allow,
    });
    process.stdout.write(
      `  ${key}  ${p.scenario}  status=${String(exchange.status)} ` +
        `${String(exchange.body.length)}B\n`,
    );
    written += 1;
  }

  for (const s of await plan.syntheticFixtures(fromLive)) {
    const key = await writeFixture(plan.fixtureDir, {
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
      `test/fixtures/${plan.source}/.\n`,
  );
  if (failures.length > 0) {
    process.stdout.write(
      `${String(failures.length)} scenario(s) failed:\n  ${failures.join("\n  ")}\n`,
    );
    return 1;
  }
  return 0;
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
 * `test/contract/replayHarness.test.ts` imports this so that the test and the
 * recorder cannot disagree about what a scenario's request is. That is why the
 * `main()` call below is guarded: importing this module must not record
 * anything.
 *
 * @param scenario - a name from the source's independent or synthetic set
 * @param source - defaults to `pubmed`, the Phase 1 caller's meaning
 * @returns the planned request
 * @throws Error when no scenario has that name
 */
export function plannedRequest(
  scenario: string,
  source: RecordableSourceId = "pubmed",
): PlannedRequest {
  const plan = planFor(source);
  const all = [...plan.independent(), ...plan.syntheticRequests()];
  const found = all.find((p) => p.scenario === scenario);
  if (found === undefined) {
    throw new Error(
      `No ${source} scenario named "${scenario}". Known: ${all
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

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));

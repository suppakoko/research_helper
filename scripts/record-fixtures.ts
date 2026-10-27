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
 * npm run fixtures:record -- --source arxiv --dry-run        # arXiv: prints the plan only
 * npm run fixtures:record -- --source semanticscholar --dry-run   # Semantic Scholar, unkeyed
 * npm run fixtures:record -- --source biorxiv --dry-run     # bioRxiv: DOI lookups only
 * npm run fixtures:record -- --source medrxiv --dry-run     # medRxiv: DOI lookups only
 * FIXTURE_MODE=record npm run fixtures:record -- --source europepmc   # live
 * FIXTURE_MODE=synthetic npm run fixtures:record                      # rewrites the
 *                                                  # hand-written fixtures, no network
 * npm run fixtures:record -- --source pubmed --rescrub    # re-runs the redaction
 *                                                  # pass over committed fixtures, no network
 * npm run fixtures:record -- --source openai --dry-run     # an LLM provider (P3-T30):
 *                                                  # the scenario list and the stated spend
 * FIXTURE_MODE=synthetic npm run fixtures:record -- --source openai   # its written
 *                                                  # fixtures, no network, no key
 * ```
 *
 * **An LLM provider's live recording is the owner's, never an agent's**
 * (`docs/13` §3.4): it needs `FIXTURE_MODE=record`, `--live`, the key in the
 * environment and `--confirm-spend-usd`; see section 8b, {@link runLlmRecorder}.
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
 * 7. **Every email address goes, not only the maintainer's** (owner decision
 *    of 2026-10-16, `plan/00` §6 item 224). Authors' published contact
 *    addresses sit inside PubMed and Europe PMC affiliation fields; each
 *    becomes `[redacted:email-address]` ({@link stripEmailAddresses}) and
 *    {@link assertClean} refuses one that survives. `--rescrub` runs the same
 *    pass over committed fixtures ({@link rescrubFixtures}).
 *
 * ## What is *not* read from `.env`, and the contradiction behind that
 *
 * `docs/13` §3.2 says this script "reads real keys from `.env` (never
 * committed)". `.env.example` says, in capitals, "NEVER put an API key here",
 * and decision D5 plus `docs/09` §1.7 put every credential in the OS keystore
 * with no plaintext tier. Those cannot both be followed. This file follows D5:
 * it reads no key from anywhere, and uses the environment only to build the
 * redaction deny-list described above. Reported with the card.
 *
 * *Updated 2026-10-27 (`P3-T30`, `plan/00` §6 item 298(b); `docs/13` §3.2's
 * note of that date):* "reads no key from anywhere" now holds for every
 * literature source and has one exception, the LLM providers, which cannot be
 * called unauthenticated. For them a key is read from the **process
 * environment only** ({@link llmKeyFromEnvironment}) — never `.env` or any
 * other file — and only in live mode, behind `--live` and the confirmed spend.
 * (`docs/13` §3.2's `.env` sentence was corrected on 2026-10-15.)
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { type Clock, createSystemClock } from "../src/core/clock";
import { BudgetExceededError, KEYISH_FIELD, redact } from "../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportXhr,
} from "../src/core/http/client";
import { buildUserAgent, MAINTAINER_EMAIL } from "../src/core/http/userAgent";
import {
  ARXIV_HOST,
  BIORXIV_HOST,
  CROSSREF_HOST,
  EBI_HOST,
  HOST_POLICIES,
  LLM_HOSTS,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../src/core/rateLimit/hostLimiter";
import { createCancellationTokenSource } from "../src/core/jobQueue/cancellation";
import type { SecretId, SecretStore } from "../src/core/secretStore";
import {
  ANTHROPIC_SECRET_ID,
  createAnthropicProvider,
} from "../src/llm/anthropic/anthropicProvider";
import {
  chatViaGenerateContent,
  createGeminiProvider,
  GEMINI_SECRET_ID,
} from "../src/llm/gemini/geminiProvider";
import {
  createOpenAiProvider,
  OPENAI_SECRET_ID,
} from "../src/llm/openai/openAiProvider";
import {
  createOpenRouterProvider,
  OPENROUTER_SECRET_ID,
} from "../src/llm/openrouter/openRouterProvider";
import { createBaseUrlResolver } from "../src/llm/shared/baseUrl";
import {
  bundledCatalogue,
  createModelPriceSource,
  type ModelPriceSource,
  modelsFor,
} from "../src/llm/shared/modelCatalogue";
import { costOf, type ModelPrices } from "../src/llm/shared/pricing";
import { estTokens } from "../src/llm/shared/tokenEstimate";
import type {
  ChatRequest,
  ChatResponse,
  LLMCallContext,
  LLMProvider,
  ModelInfo,
  Usage,
} from "../src/llm/types";
import type { ProviderId } from "../src/model/ids";
import {
  type BudgetReservation,
  createBudgetGuard,
  createSessionSpendCounter,
} from "../src/pipeline/shared/budget";
import { withHeadroom } from "../src/pipeline/shared/estimate";
import {
  parsePromptFile,
  PROMPT_FILE_NAMES,
  type PromptTemplate,
  renderPrompt,
  resolveMaxTokens,
} from "../src/prompts/index";
import { parseCrossrefWorksBody } from "../src/sources/crossref/crossrefSource";
import { parseEuropePmcSearchBody } from "../src/sources/europepmc/europepmcSource";
import { parseSearchBody as parseSemanticScholarSearchBody } from "../src/sources/semanticscholar/semanticscholarSource";
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
  llmFixtureKey,
  META_SUFFIX,
  type FixtureMeta,
  type LlmFixtureMeta,
  type LlmFixtureProvider,
  type RecordedExchange,
} from "../test/contract/_transport";
import {
  ARXIV_PAGE_2_START,
  ARXIV_QUERY_EMPTY,
  ARXIV_QUERY_ERROR_FEED,
  ARXIV_QUERY_PAGINATED,
  ARXIV_QUERY_PAIR,
  ARXIV_QUERY_PREPRINT,
  ARXIV_QUERY_RICH,
  ARXIV_QUERY_SPARSE,
  ARXIV_QUERY_SYNTHETIC_429,
  ARXIV_QUERY_SYNTHETIC_500,
  ARXIV_QUERY_SYNTHETIC_MALFORMED,
  ARXIV_QUERY_TYPICAL,
  ARXIV_QUERY_UNICODE,
  ARXIV_QUERY_WRAPPED,
  recordedArxivRequest,
} from "../test/support/arxivRecordedRequests";
import type {
  BiorxivEndpoint,
  BiorxivServer,
} from "../src/sources/biorxiv/query";
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
  BIORXIV_CORPUS_DOIS,
  BIORXIV_DOI_UNICODE,
  corpusLookupScenario,
  MEDRXIV_CORPUS_DOIS,
  MEDRXIV_DOI_RICH,
  MEDRXIV_DOI_SPARSE,
  recordedBiorxivRequest,
} from "../test/support/biorxivRecordedRequests";
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
import {
  DEDUP_CORPUS_SEARCHES,
  dedupCorpusQuery,
  type DedupCorpusSearch,
} from "../test/support/dedupCorpusRecordedRequests";
import {
  PUBMED_TYPICAL_PMIDS,
  PUBMED_WINDOW_MAX_RESULTS,
  pubmedWindowQuery,
} from "../test/support/pubmedRecordedRequests";
import {
  recordedSemanticScholarBatchRequest,
  recordedSemanticScholarBulkRequest,
  recordedSemanticScholarHealthRequest,
  recordedSemanticScholarRelevanceRequest,
  SEMANTICSCHOLAR_BATCH_DATACITE_ID,
  SEMANTICSCHOLAR_CORPUS_BATCH_IDS,
  SEMANTICSCHOLAR_QUERY_EMPTY,
  SEMANTICSCHOLAR_QUERY_PAGINATED,
  SEMANTICSCHOLAR_QUERY_PAIR,
  SEMANTICSCHOLAR_QUERY_PREPRINT,
  SEMANTICSCHOLAR_QUERY_RELEVANCE,
  SEMANTICSCHOLAR_QUERY_RICH,
  SEMANTICSCHOLAR_QUERY_SPARSE,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_400,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_429,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_500,
  SEMANTICSCHOLAR_QUERY_SYNTHETIC_MALFORMED,
  SEMANTICSCHOLAR_QUERY_TYPICAL,
  SEMANTICSCHOLAR_QUERY_UNICODE,
} from "../test/support/semanticscholarRecordedRequests";

// ---------------------------------------------------------------------------
// 0. The command line
// ---------------------------------------------------------------------------

/** The sources this recorder has a plan for. One directory per id (`docs/07` §2.2). */
export const RECORDABLE_SOURCES = [
  "pubmed",
  "europepmc",
  "crossref",
  "arxiv",
  "semanticscholar",
  "biorxiv",
  "medrxiv",
] as const;
export type RecordableSourceId = (typeof RECORDABLE_SOURCES)[number];

function isRecordableSource(value: string): value is RecordableSourceId {
  return (RECORDABLE_SOURCES as readonly string[]).includes(value);
}

/** What `--source` and `--dry-run` resolved to. */
export interface CliOptions {
  /** A literature source, or an LLM provider ({@link LLM_RECORDABLE_PROVIDERS}, `P3-T30`). */
  readonly source: RecordableSourceId | LlmRecordableProvider;
  /** `--dry-run` was given. Wins over `FIXTURE_MODE`. */
  readonly dryRun: boolean;
  /**
   * `--only <scenario,…>`: restrict the *independent* requests to these
   * scenarios (`P2-T05`, 2026-10-15). Added because Semantic Scholar's shared
   * anonymous pool refused 7 of 13 requests on the first run and re-issuing
   * all 13 to recover 7 would have doubled the spend on a pool `docs/02` §6.4
   * says to treat gently. Dependent and synthetic fixtures are planned as
   * usual from whatever this run captured. Absent means every scenario.
   */
  readonly only?: readonly string[];
  /**
   * `--rescrub`: run the redaction pass again over the source's committed
   * fixtures, with no network (owner decision of 2026-10-16, `plan/00` §6 item
   * 224). See {@link rescrubFixtures}. Wins over `FIXTURE_MODE`; `--dry-run`
   * wins over it.
   */
  readonly rescrub?: true;
  /**
   * `--live` (LLM providers only, `P3-T30`): the explicit opt-in that
   * `FIXTURE_MODE=record` needs before an LLM recording sends anything.
   */
  readonly live?: true;
  /**
   * `--confirm-spend-usd <amount>` (LLM providers only): the second
   * confirmation. Live mode prints the stated spend and stops unless this is
   * given and at least that amount; it is then the run's spend ceiling.
   */
  readonly confirmSpendUsd?: number;
  /** `--model <id>` (LLM providers only): record with this priced model. */
  readonly model?: string;
}

/** A command-line mistake. Exit code 2, no plan printed. */
export class UsageError extends Error {}

const USAGE =
  "usage: npm run fixtures:record -- [--source <id>] [--only <scenario,…>] " +
  `[--dry-run] [--rescrub]   (sources: ${RECORDABLE_SOURCES.join(", ")})\n` +
  "       npm run fixtures:record -- --source <llm provider> [--only <scenario,…>] " +
  "[--dry-run] [--model <id>] [--live] [--confirm-spend-usd <amount>]   " +
  "(LLM providers: openrouter, openai, anthropic, gemini; docs/13 §3.4)";

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
  let source: RecordableSourceId | LlmRecordableProvider = "pubmed";
  let dryRun = false;
  let only: string[] | undefined;
  let rescrub = false;
  let live = false;
  let confirmSpendUsd: number | undefined;
  let model: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (
      arg === "--confirm-spend-usd" ||
      arg.startsWith("--confirm-spend-usd=")
    ) {
      if (arg === "--confirm-spend-usd") i += 1;
      const raw = (
        arg === "--confirm-spend-usd"
          ? argv[i]
          : arg.slice("--confirm-spend-usd=".length)
      )
        ?.trim()
        .replace(/^\$/u, "");
      const amount = raw === undefined || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new UsageError(
          `--confirm-spend-usd needs a positive number of US dollars.\n${USAGE}`,
        );
      }
      confirmSpendUsd = amount;
      continue;
    }
    if (arg === "--model" || arg.startsWith("--model=")) {
      if (arg === "--model") i += 1;
      const value = (
        arg === "--model" ? argv[i] : arg.slice("--model=".length)
      )?.trim();
      if (value === undefined || value === "") {
        throw new UsageError(`--model needs a model id.\n${USAGE}`);
      }
      model = value;
      continue;
    }
    if (arg === "--rescrub") {
      rescrub = true;
      continue;
    }
    let value: string | undefined;
    if (arg === "--only") {
      i += 1;
      value = argv[i];
    } else if (arg.startsWith("--only=")) {
      value = arg.slice("--only=".length);
    }
    if (arg === "--only" || arg.startsWith("--only=")) {
      const names = (value ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "");
      if (names.length === 0) {
        throw new UsageError(`--only needs at least one scenario.\n${USAGE}`);
      }
      only = [...(only ?? []), ...names];
      continue;
    }
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
    if (!isRecordableSource(value) && !isLlmRecordableProvider(value)) {
      throw new UsageError(
        `No recording plan for source "${value}".\n${USAGE}`,
      );
    }
    source = value;
  }
  const llmFlags = live || confirmSpendUsd !== undefined || model !== undefined;
  if (llmFlags && !isLlmRecordableProvider(source)) {
    throw new UsageError(
      `--live, --confirm-spend-usd and --model are for an LLM provider only.\n${USAGE}`,
    );
  }
  return {
    source,
    dryRun,
    ...(only !== undefined && { only }),
    ...(rescrub && { rescrub: true as const }),
    ...(live && { live: true as const }),
    ...(confirmSpendUsd !== undefined && { confirmSpendUsd }),
    ...(model !== undefined && { model }),
  };
}

/**
 * The independent requests `--only` keeps, in plan order.
 *
 * @throws UsageError naming a scenario the plan does not have
 */
export function selectScenarios(
  planned: readonly PlannedRequest[],
  only: readonly string[] | undefined,
): readonly PlannedRequest[] {
  if (only === undefined) return planned;
  const known = new Set(planned.map((p) => p.scenario));
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `--only names scenarios this plan does not have: ${unknown.join(", ")}. ` +
        `Known: ${[...known].join(", ")}`,
    );
  }
  return planned.filter((p) => only.includes(p.scenario));
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

/** What every other email address becomes; see {@link EMAIL_ADDRESS_SOURCE}. */
export const ADDRESS_PLACEHOLDER = "[redacted:email-address]";

/**
 * Any email address, plain (`@`) or percent-encoded (`%40`). Owner decision of
 * 2026-10-16 (`plan/00` §6 item 224, `docs/13` §3.2): the recorder strips
 * **every** address from a fixture, not only the maintainer's. Recorded
 * PubMed `<Affiliation>` and Europe PMC `affiliation` fields carry authors'
 * published contact addresses.
 *
 * Three details, each measured on the committed fixtures:
 *
 * - **A match may start right after a JSON escape** (`\n`, `\t`, …) and never
 *   takes the escape's letter with it. A body is scrubbed as received, and a
 *   JSON body writes a newline as `\n`; a pattern that let the local part
 *   begin at that `n` would leave a lone backslash in front of the placeholder
 *   and the body would no longer parse.
 * - **The domain is matched whole.** The last label may not be followed by a
 *   letter, digit, hyphen, or a dot and a letter or digit, so a longer dotted
 *   run is never cut short into an "address".
 * - **The last label is lower case, upper case or Capitalised.** That keeps the
 *   Java object identity strings some medRxiv abstracts carry
 *   (`org.highwire.dtl.DTLVardef@ebf121org.highwire.dtl.DTLVardef`), which are
 *   not addresses: `DTLVardef` is none of the three.
 */
const EMAIL_ADDRESS_SOURCE = [
  String.raw`(?<=^|[^A-Za-z0-9._%+\-\\]|\\[nrtbf"/])`,
  String.raw`[A-Za-z0-9._%+\-]+(?:@|%40)(?:[A-Za-z0-9\-]+\.)+`,
  String.raw`(?:[a-z]{2,24}|[A-Z]{2,24}|[A-Z][a-z]{1,23})`,
  String.raw`(?![A-Za-z0-9\-]|\.[A-Za-z0-9])`,
].join("");

/**
 * Replace every email address in `text` with {@link ADDRESS_PLACEHOLDER}.
 *
 * @param text - a header value or body, after the literal deny-list ran, so
 *   the maintainer address already reads `[redacted:maintainer-address]`
 * @returns the scrubbed text and how many addresses were replaced
 */
export function stripEmailAddresses(text: string): {
  readonly text: string;
  readonly count: number;
} {
  let count = 0;
  const out = text.replace(new RegExp(EMAIL_ADDRESS_SOURCE, "gu"), () => {
    count += 1;
    return ADDRESS_PLACEHOLDER;
  });
  return { text: out, count };
}

/** The stand-in an allowed opaque token wears while {@link scrub} runs. */
function allowPlaceholder(index: number): string {
  return `\u0000RH_ALLOW_${String(index)}\u0000`;
}

/**
 * Scrub one string: `redact()` first, then the literal deny-list, then every
 * remaining email address ({@link stripEmailAddresses}) — with the
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
): { readonly text: string; readonly addresses: number } {
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
  const stripped = stripEmailAddresses(out);
  out = stripped.text;
  for (const [index, token] of shielded.entries()) {
    out = out.split(allowPlaceholder(index)).join(token);
  }
  return { text: out, addresses: stripped.count };
}

/** The sidecar note for `count` email addresses removed from `where`. */
function addressNote(where: string, count: number): string {
  return `scrubbed ${where}: ${String(count)} email address(es)`;
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
    if (scrubbed.text !== value) notes.push(`scrubbed header ${lower}`);
    if (scrubbed.addresses > 0) {
      notes.push(addressNote(`header ${lower}`, scrubbed.addresses));
    }
    headers[lower] = scrubbed.text;
  }
  const scrubbedBody = scrub(raw.body, deny, allow);
  const body = scrubbedBody.text;
  if (body !== raw.body) notes.push("scrubbed body");
  if (scrubbedBody.addresses > 0) {
    notes.push(addressNote("body", scrubbedBody.addresses));
  }
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
  // After the maintainer row on purpose, so that address keeps its own message.
  { what: "an email address", re: new RegExp(EMAIL_ADDRESS_SOURCE, "u") },
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

/** What {@link rescrubFixtures} did to one directory. */
export interface RescrubResult {
  /** Fixture files read (sidecars excluded). */
  readonly read: number;
  /** Keys whose fixture and sidecar were rewritten. */
  readonly changed: readonly string[];
  /** Email addresses replaced, across every changed file. */
  readonly addresses: number;
}

/**
 * Run {@link redactExchange} again over every committed fixture in `dir`, with
 * no network — the owner's decision of 2026-10-16 (`plan/00` §6 item 224) that
 * the fixtures recorded before the address strip are re-scrubbed **by the same
 * pass**, never by hand.
 *
 * What it guarantees:
 *
 * - **Keys do not move.** The file name is the request's key and is reused;
 *   only the body and header values can change.
 * - **Nothing but addresses changes.** A rewrite is refused unless the new
 *   fixture equals the old one with {@link stripEmailAddresses} applied to the
 *   body and each header value. A drift anywhere else in the pass (a new
 *   `redact()` pattern, a lost pagination token) stops the run rather than
 *   rewriting history quietly.
 * - **The sidecar says so.** `recordedAt` and every other field are kept; one
 *   note is appended to `redactions`, naming the date, the decision and the
 *   count, in the same words a recording would use.
 * - **Both files pass {@link assertClean}** before either is written.
 *
 * @param plan - the source's plan, for its directory and opaque tokens
 * @param deny - {@link literalDenyList}'s output
 * @param today - the `YYYY-MM-DD` the note carries
 * @returns what was read and rewritten
 * @throws Error when a re-scrub would change more than addresses
 */
export async function rescrubFixtures(
  plan: Pick<SourcePlan, "fixtureDir" | "opaqueTokens">,
  deny: readonly string[],
  today: string,
): Promise<RescrubResult> {
  const names = (await readdir(plan.fixtureDir))
    .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
    .sort();
  const changed: string[] = [];
  let addresses = 0;
  for (const name of names) {
    const key = name.slice(0, -".json".length);
    const path = `${plan.fixtureDir}/${name}`;
    const before = await readFile(path, "utf8");
    const stored = JSON.parse(before) as RecordedExchange;
    const allow = plan.opaqueTokens?.(stored.body) ?? [];
    const { exchange, notes } = redactExchange(stored, deny, allow);
    const after = toJson({
      ...stored,
      status: exchange.status,
      headers: exchange.headers,
      body: exchange.body,
    });
    if (after === before) continue;

    const expectedHeaders: Record<string, string> = {};
    for (const [n, v] of Object.entries(stored.headers)) {
      expectedHeaders[n] = stripEmailAddresses(v).text;
    }
    const expected = toJson({
      ...stored,
      headers: expectedHeaders,
      body: stripEmailAddresses(stored.body).text,
    });
    if (after !== expected) {
      throw new Error(
        `Refusing to re-scrub ${key}: the pass would change more than email ` +
          `addresses. Re-record it instead (docs/13 §3.3 rule 4).`,
      );
    }
    const addressNotes = notes.filter((n) => / email address\(es\)$/u.test(n));
    const count = addressNotes.reduce(
      (sum, n) => sum + Number(/: (\d+) email/u.exec(n)?.[1] ?? 0),
      0,
    );
    const metaPath = `${plan.fixtureDir}/${key}${META_SUFFIX}`;
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as FixtureMeta;
    const nextMeta: FixtureMeta = {
      ...meta,
      redactions: [
        ...meta.redactions,
        `re-scrubbed ${today} without a request (plan/00 item 224): ` +
          addressNotes.join("; "),
      ],
    };
    const metaText = toJson(nextMeta);
    assertClean(meta.scenario, after, deny, allow);
    assertClean(`${meta.scenario} (metadata)`, metaText, deny);
    await writeFile(path, after, "utf8");
    await writeFile(metaPath, metaText, "utf8");
    changed.push(key);
    addresses += count;
  }
  return { read: names.length, changed, addresses };
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
  /**
   * The body's `Content-Type`, on a POST. Defaults to
   * `application/x-www-form-urlencoded` (Europe PMC's `searchPOST`); Semantic
   * Scholar's `/paper/batch` is `application/json` (`P2-T05`). Not part of the
   * fixture key.
   */
  readonly contentType?: string;
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

/**
 * The search window's request (`P2-T36`): one whole calendar year at
 * `retmax=10`, built from `test/support/pubmedRecordedRequests.ts`'s
 * {@link pubmedWindowQuery} — the module the integration spec imports too, so
 * the recorded request and the window's request have one definition.
 *
 * Kept out of {@link independentPlan} on purpose: that function is the
 * Phase 1 inventory `test/contract/replayHarness.test.ts` imports by name and
 * counts, and these two fixtures are the window's, not `docs/13` §3.1's.
 * `planFor("pubmed")` plans both sets.
 */
export function pubmedWindowPlan(): readonly PlannedRequest[] {
  return [
    esearch(
      "window-esearch",
      "P2-T36: the search window's own request — one closed year, retmax=10 " +
        "(PREFS.maxResults' minimum), so the window replays the real adapter",
      pubmedWindowQuery(),
      PUBMED_WINDOW_MAX_RESULTS,
      0,
    ),
  ];
}

/** The `window-efetch` request, for the ids `window-esearch` resolved to. */
async function pubmedWindowEfetchPlan(
  answer: Answer,
): Promise<readonly PlannedRequest[]> {
  const planned = pubmedWindowPlan()[0];
  if (planned === undefined) return [];
  const got = await answer(planned);
  if (got === undefined || got.status !== 200) return [];
  let pmids: readonly string[];
  try {
    pmids = parseEsearchBody(got.body, planned.endpoint).pmids;
  } catch {
    return [];
  }
  // What the adapter's `search()` takes: never more ids than `retmax`.
  const taken = pmids.slice(0, PUBMED_WINDOW_MAX_RESULTS);
  if (taken.length === 0) return [];
  return [
    efetch(
      "window-efetch",
      "P2-T36: the records window-esearch resolved to, in NCBI's order",
      taken,
    ),
  ];
}

/**
 * The purpose line of a `P2-T13` Part B corpus scenario: the text typed, the
 * closed window and the page size.
 */
function corpusPurpose(search: DedupCorpusSearch, what = "search"): string {
  return (
    `P2-T13 Part B corpus ${what}: "${search.text}", ` +
    `${search.fromDate}..${search.toDate}, limit ${String(search.limit)}`
  );
}

/**
 * PubMed's `P2-T13` Part B corpus requests known up front: one `esearch` per
 * shared corpus search (`test/support/dedupCorpusRecordedRequests.ts`), and
 * one `efetch` of the 20 PMIDs the committed `search-typical` resolved to
 * ({@link PUBMED_TYPICAL_PMIDS}), which Phase 1 never fetched. Kept out of
 * {@link independentPlan} for {@link pubmedWindowPlan}'s reason.
 */
export function pubmedCorpusPlan(): readonly PlannedRequest[] {
  return [
    efetch(
      "search-typical-efetch",
      "P2-T13 Part B corpus: the 20 records the committed search-typical " +
        "resolved to (never fetched in Phase 1)",
      PUBMED_TYPICAL_PMIDS,
    ),
    ...DEDUP_CORPUS_SEARCHES.pubmed.map((search) =>
      esearch(
        `${search.scenario}-esearch`,
        corpusPurpose(search),
        dedupCorpusQuery(search),
        search.limit,
        0,
      ),
    ),
  ];
}

/**
 * One `efetch` per corpus `esearch` that resolved to identifiers, for at most
 * the page size of them — what the adapter's `search()` fetches.
 */
async function pubmedCorpusEfetchPlan(
  answer: Answer,
): Promise<readonly PlannedRequest[]> {
  const out: PlannedRequest[] = [];
  const planned = pubmedCorpusPlan();
  for (const search of DEDUP_CORPUS_SEARCHES.pubmed) {
    const page = planned.find(
      (p) => p.scenario === `${search.scenario}-esearch`,
    );
    if (page === undefined) continue;
    const got = await answer(page);
    if (got === undefined || got.status !== 200) continue;
    let pmids: readonly string[];
    try {
      pmids = parseEsearchBody(got.body, page.endpoint).pmids;
    } catch {
      continue;
    }
    const taken = pmids.slice(0, search.limit);
    if (taken.length === 0) continue;
    out.push(
      efetch(
        `${search.scenario}-efetch`,
        corpusPurpose(search, "records"),
        taken,
      ),
    );
  }
  return out;
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

/**
 * Europe PMC's `P2-T13` Part B corpus searches: the shared queries and two
 * probes (`test/support/dedupCorpusRecordedRequests.ts`), first page only.
 */
export function europepmcCorpusPlan(): readonly PlannedRequest[] {
  return DEDUP_CORPUS_SEARCHES.europepmc.map((search) =>
    epmcSearch(
      search.scenario,
      corpusPurpose(search),
      dedupCorpusQuery(search),
    ),
  );
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
 * Crossref's `P2-T13` Part B corpus searches: the shared queries and three
 * probes (`test/support/dedupCorpusRecordedRequests.ts`), first page only.
 */
export function crossrefCorpusPlan(): readonly PlannedRequest[] {
  return DEDUP_CORPUS_SEARCHES.crossref.map((search) =>
    crossrefWorks(
      search.scenario,
      corpusPurpose(search),
      dedupCorpusQuery(search),
    ),
  );
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

// --- 7d. arXiv ----------------------------------------------------------------

/**
 * An arXiv `/api/query` request for the plan, exactly as the shipped adapter
 * builds it (`recordedArxivRequest`): clamped `max_results`, `start` from the
 * cursor or 0, `sortBy=relevance&sortOrder=descending`. No contact parameter
 * and no key exist for this host (`docs/02` §7.1, §2.2).
 */
function arxivQuery(
  scenario: string,
  purpose: string,
  query: SourceQuery,
  cursor?: string,
): PlannedRequest {
  const built = recordedArxivRequest(query, cursor);
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    endpoint: built.endpointBaseUrl,
  };
}

/**
 * arXiv's scenarios, every one known up front: `docs/13` §3.1's thirteen
 * names less the three synthetic ones, plus `search-error-feed` (the card's
 * "arXiv error-feed scenario", `docs/02` §7.5 note 6). Both paginated pages
 * are independent because `start` is an offset, not a server cursor. The
 * queries are `test/support/arxivRecordedRequests.ts`'s.
 *
 * **Twelve requests at one every three seconds** (`docs/02` §7.1, the ToU) —
 * `spacingMsFor(ARXIV_HOST)` reads §7.3's row and gives 3031 ms. `docs/02`
 * §7.1 also records that this network drew HTTP 429 from arXiv on every one
 * of seven requests on 2026-09-15; a run that meets that again records
 * nothing and says so per scenario.
 */
export function arxivIndependentPlan(): readonly PlannedRequest[] {
  return [
    arxivQuery(
      "search-typical",
      '§3.1: ~20 results for a stable query, date filter applied (all:"deep learning" AND all:protein, Q1 2023)',
      ARXIV_QUERY_TYPICAL,
    ),
    arxivQuery(
      "search-empty",
      "§3.1 / docs/02 §7.5 note 7: zero results — totalResults 0, no entries",
      ARXIV_QUERY_EMPTY,
    ),
    arxivQuery(
      "search-single",
      "§3.1: one result — off-by-one and not-an-array bugs (max_results 1)",
      { ...ARXIV_QUERY_TYPICAL, limit: 1 },
    ),
    arxivQuery(
      "record-rich",
      "§3.1: every optional element populated (SciPy 1.0: arxiv:doi, journal_ref, comment, many authors)",
      ARXIV_QUERY_RICH,
    ),
    arxivQuery(
      "record-sparse",
      "§3.1: nothing beyond the mandatory elements (docs/02 §7.4's own VizIt entry)",
      ARXIV_QUERY_SPARSE,
    ),
    arxivQuery(
      "record-unicode",
      "§3.1: diacritics in titles and author names (Schrödinger cat)",
      ARXIV_QUERY_UNICODE,
    ),
    arxivQuery(
      "record-jats-abstract",
      "§3.1's row, arXiv's analogue: a hard-wrapped <summary> with LaTeX (docs/02 §7.5 note 2)",
      ARXIV_QUERY_WRAPPED,
    ),
    arxivQuery(
      "record-preprint",
      "§3.1: a preprint with a linked published DOI (<arxiv:doi>)",
      ARXIV_QUERY_PREPRINT,
    ),
    arxivQuery(
      "dedup-pair-set",
      "§3.1: a paper also in PubMed, Crossref and Europe PMC (SciPy 1.0, by subtitle)",
      ARXIV_QUERY_PAIR,
    ),
    arxivQuery(
      "paginated-page-1",
      "§3.1: page 1 of the typical query at max_results 3, start 0",
      ARXIV_QUERY_PAGINATED,
    ),
    arxivQuery(
      "paginated-page-2",
      "§3.1: page 2, start 3 — an offset, so independent of page 1's answer",
      ARXIV_QUERY_PAGINATED,
      ARXIV_PAGE_2_START,
    ),
    arxivQuery(
      "search-error-feed",
      "docs/02 §7.5 note 6: the HTTP-200 error feed, provoked by a malformed raw.id_list",
      ARXIV_QUERY_ERROR_FEED,
    ),
  ];
}

/**
 * arXiv's `P2-T13` Part B corpus searches: Q2–Q4 and the series probe
 * (`test/support/dedupCorpusRecordedRequests.ts`), at the host's one request
 * every three seconds.
 */
export function arxivCorpusPlan(): readonly PlannedRequest[] {
  return DEDUP_CORPUS_SEARCHES.arxiv.map((search) =>
    arxivQuery(
      search.scenario,
      corpusPurpose(search),
      dedupCorpusQuery(search),
    ),
  );
}

/**
 * `error-429`'s arXiv body — **the measured shape** (`docs/02` §7.1,
 * `P0-T21`, 2026-09-15): `HTTP/1.1 429 Unknown Error` from `server: Google
 * Frontend`, `content-type: text/html`, a 14-byte body `Rate exceeded.` and
 * **no `Retry-After`**. `docs/13` §3.1's row asks for a 429 "including
 * `Retry-After`"; this host has never been observed to send one, and a
 * fixture that invented the header would test a path arXiv does not take.
 */
const ARXIV_MEASURED_429_BODY = "Rate exceeded.";

/** `error-500`'s arXiv body: a placeholder that says so. */
const ARXIV_SYNTHETIC_500_BODY =
  "<!-- synthetic fixture: docs/02 §7 records no arXiv 5xx body shape; a " +
  "server error cannot be provoked on demand. Status is the assertable " +
  "part. -->\n<html><body><h1>Internal Server Error</h1></body></html>\n";

/**
 * arXiv's three written fixtures: `error-429` (the measured shape, written
 * rather than provoked — the ToU limit is not to be tripped on purpose),
 * `error-500` and `error-malformed`.
 *
 * @param richBody - the recorded `record-rich` body, for `error-malformed`;
 *   `undefined` skips that fixture
 */
function arxivSyntheticPlan(
  richBody: string | undefined,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
    {
      planned: arxivQuery(
        "error-429",
        "§3.1: rate-limit response — arXiv's measured shape: text/html, 'Rate exceeded.', no Retry-After",
        ARXIV_QUERY_SYNTHETIC_429,
      ),
      exchange: {
        status: 429,
        headers: {
          "content-type": "text/html",
          server: "Google Frontend",
        },
        body: ARXIV_MEASURED_429_BODY,
      },
      reason:
        "Written from docs/02 §7.1's measurement of 2026-09-15 (P0-T21): " +
        "every one of seven paced requests answered HTTP 429, " +
        "content-type text/html, body 'Rate exceeded.', no Retry-After. " +
        "Not provoked here — the three-second rule is a ToU obligation, and " +
        "tripping it on purpose is not acceptable.",
    },
    {
      planned: arxivQuery(
        "error-500",
        "§3.1: server error",
        ARXIV_QUERY_SYNTHETIC_500,
      ),
      exchange: {
        status: 500,
        headers: { "content-type": "text/html" },
        body: ARXIV_SYNTHETIC_500_BODY,
      },
      reason:
        "Hand-written. A 5xx cannot be provoked on demand and docs/02 §7 " +
        "records no arXiv 5xx body; the body is a placeholder.",
    },
  ];
  if (richBody !== undefined) {
    out.push({
      planned: arxivQuery(
        "error-malformed",
        "§3.1: truncated/invalid body",
        ARXIV_QUERY_SYNTHETIC_MALFORMED,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/atom+xml; charset=UTF-8" },
        body: richBody.slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body, cut inside the XML. arXiv ` +
        `has no documented way to ask for a truncated body.`,
    });
  }
  return out;
}

// --- 7e. Semantic Scholar ---------------------------------------------------

/** A planned request from one of the shipped Semantic Scholar builders. */
function semanticscholarPlanned(
  scenario: string,
  purpose: string,
  built: {
    readonly method: string;
    readonly url: string;
    readonly endpointBaseUrl: string;
    readonly body?: string;
    readonly contentType?: string;
  },
): PlannedRequest {
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    endpoint: built.endpointBaseUrl,
    ...(built.body !== undefined && { body: built.body }),
    ...(built.contentType !== undefined && { contentType: built.contentType }),
  };
}

/**
 * Semantic Scholar's scenarios known up front: `docs/13` §3.1's thirteen
 * names less the three synthetic ones, plus `relevance-search` (the
 * `/paper/search` rendering), `batch-lookup` (`/paper/batch` with a `null`
 * at index 2) and `health-probe` (`docs/09` §2.3's test call). Page 2 is
 * dependent (a server `token`). Every request is **unauthenticated**: the key
 * is a header this recorder never sends, so the fixtures replay identically
 * for the keyed and the unkeyed adapter. The queries are
 * `test/support/semanticscholarRecordedRequests.ts`'s.
 *
 * **Thirteen requests at ≥ 1112 ms** — `spacingMsFor(SEMANTICSCHOLAR_HOST)`
 * reads §7.3's 0.9/s row. `docs/02` §6.4 measured the shared anonymous pool
 * answering HTTP 429 on every attempt during US business hours; a run that
 * meets that records the 429 under whatever scenario drew it and says so.
 */
export function semanticscholarIndependentPlan(): readonly PlannedRequest[] {
  return [
    semanticscholarPlanned(
      "search-typical",
      "§3.1: ~20 results for docs/02 §12.2's own example on /paper/search/bulk, 2023 window",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_TYPICAL),
    ),
    semanticscholarPlanned(
      "search-empty",
      "§3.1: zero results — total 0, empty data, no token",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_EMPTY),
    ),
    semanticscholarPlanned(
      "search-single",
      "§3.1: one result — off-by-one and not-an-array bugs (limit 1)",
      recordedSemanticScholarBulkRequest({
        ...SEMANTICSCHOLAR_QUERY_TYPICAL,
        limit: 1,
      }),
    ),
    semanticscholarPlanned(
      "record-rich",
      "§3.1: every optional field populated (docs/02 §6.7's Geneformer example: bare PubMedCentral, journal, openAccessPdf.disclaimer)",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_RICH),
    ),
    semanticscholarPlanned(
      "record-sparse",
      "§3.1: a 1965 paper — usually no abstract, no full date (Moore, Electronics)",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_SPARSE),
    ),
    semanticscholarPlanned(
      "record-unicode",
      "§3.1: diacritics in titles and author names (Schrödinger cat)",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_UNICODE),
    ),
    semanticscholarPlanned(
      "record-jats-abstract",
      "§3.1's row has no Semantic Scholar analogue (abstracts are plain text); aimed at a /paper/batch answer with abstract + tldr by DataCite DOI, it measured HTTP 400 'No valid paper ids given' (2026-10-15) and is kept as that endpoint's 400 shape",
      recordedSemanticScholarBatchRequest([SEMANTICSCHOLAR_BATCH_DATACITE_ID]),
    ),
    semanticscholarPlanned(
      "record-preprint",
      "§3.1: a preprint — venue arXiv.org (docs/02 §7.4's VizIt e-print, §10.2's preprint rule)",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_PREPRINT),
    ),
    semanticscholarPlanned(
      "dedup-pair-set",
      "§3.1: a paper also in arXiv's fixtures and in PubMed, Crossref and Europe PMC (SciPy 1.0)",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_PAIR),
    ),
    semanticscholarPlanned(
      "paginated-page-1",
      "§3.1: page 1 of the typical query at limit 3, no token",
      recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_PAGINATED),
    ),
    semanticscholarPlanned(
      "relevance-search",
      "docs/02 §6.5 / §12.2: the example as plain text on /paper/search, NOT dropped, limit 5",
      recordedSemanticScholarRelevanceRequest(SEMANTICSCHOLAR_QUERY_RELEVANCE),
    ),
    semanticscholarPlanned(
      "batch-lookup",
      "docs/02 §6.8: POST /paper/batch, four ids, an unknown one at index 2 → null, positionally aligned",
      recordedSemanticScholarBatchRequest(),
    ),
    semanticscholarPlanned(
      "health-probe",
      "docs/09 §2.3's test call, unkeyed: GET /paper/DOI:…?fields=paperId",
      recordedSemanticScholarHealthRequest(),
    ),
  ];
}

/**
 * Semantic Scholar's `P2-T13` Part B corpus searches: the shared queries and
 * the Korean probe (`test/support/dedupCorpusRecordedRequests.ts`), on
 * **`/paper/search`** (relevance), not the adapter's default bulk endpoint.
 * Measured 2026-10-15: bulk ignores `limit` and answers up to 1000 records
 * (`record-unicode`, 1.98 MB), in no relevance order — five such pages would
 * swamp the corpus with records no other source returned. The relevance
 * endpoint honours `limit` and ranks like the other sources' first pages; it
 * is the adapter's own `searchByRelevance` request.
 *
 * **Recorded 2026-10-16 as two 429s.** The anonymous pool refused all five
 * Semantic Scholar requests of `P2-T13` Part B, so only `corpus-q1` and
 * `corpus-batch` are planned (each committed as its measured 429) and the
 * other searches wait in `DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR`.
 */
export function semanticscholarCorpusPlan(): readonly PlannedRequest[] {
  return [
    ...DEDUP_CORPUS_SEARCHES.semanticscholar.map((search) =>
      semanticscholarPlanned(
        search.scenario,
        corpusPurpose(search, "relevance search"),
        recordedSemanticScholarRelevanceRequest(dedupCorpusQuery(search)),
      ),
    ),
    semanticscholarPlanned(
      "corpus-batch",
      "P2-T13 Part B corpus: POST /paper/batch for the corpus's preprint " +
        "DOIs, their journal versions and two committed 10.64898/ DOIs",
      recordedSemanticScholarBatchRequest(SEMANTICSCHOLAR_CORPUS_BATCH_IDS),
    ),
  ];
}

/**
 * The opaque, non-secret runs a Semantic Scholar body carries that the
 * redaction pass must keep ({@link SourcePlan.opaqueTokens}): every
 * `paperId` — a 40-character hexadecimal SHA (`docs/02` §6.3), exactly the
 * run `redact()`'s hexadecimal pattern catches — and the bulk continuation
 * `token`. Without this every record's identity would come back
 * `[redacted:40]` and no page 2 could be replayed. A paper SHA is a public
 * identifier, not a credential; the plan vouches for it.
 */
function semanticscholarOpaqueTokens(body: string): readonly string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(/\b[0-9a-f]{40}\b/gu)) out.add(match[0]);
  try {
    const token = parseSemanticScholarSearchBody(body, "").token;
    if (token !== undefined) out.add(token);
  } catch {
    // Not a search page (a batch array, a single paper, an error): nothing
    // more to vouch for.
  }
  return [...out];
}

/** The `token` a recorded bulk page offered, or `undefined`. */
async function semanticscholarTokenAfter(
  answer: Answer,
  planned: PlannedRequest | undefined,
): Promise<string | undefined> {
  if (planned === undefined) return undefined;
  const got = await answer(planned);
  if (got === undefined || got.status !== 200) return undefined;
  try {
    return parseSemanticScholarSearchBody(got.body, planned.endpoint).token;
  } catch {
    return undefined;
  }
}

/**
 * Page 2 of `paginated`, keyed under the `token` page 1 returned (`docs/02`
 * §6.6). One dependent request.
 */
async function semanticscholarDependentPlan(
  answer: Answer,
): Promise<readonly PlannedRequest[]> {
  const page1 = semanticscholarIndependentPlan().find(
    (p) => p.scenario === "paginated-page-1",
  );
  const token2 = await semanticscholarTokenAfter(answer, page1);
  if (token2 === undefined) return [];
  return [
    semanticscholarPlanned(
      "paginated-page-2",
      "§3.1: page 2, under page 1's token",
      recordedSemanticScholarBulkRequest(
        SEMANTICSCHOLAR_QUERY_PAGINATED,
        token2,
      ),
    ),
  ];
}

/**
 * `error-429`'s body — **the measured shape**, byte for byte (`docs/02` §6.4,
 * 2026-09-08 and 2026-09-09, `content-length: 174`): JSON with `message` and
 * the *string* `"429"`, `x-amzn-ErrorType: TooManyRequestsException`, **no
 * `Retry-After`**. `docs/13` §3.1's row asks for a 429 "including
 * `Retry-After`"; this host has never been observed to send one.
 */
const SEMANTICSCHOLAR_MEASURED_429_BODY =
  '{"message": "Too Many Requests. Please wait and try again or apply for a ' +
  "key for higher rate limits. " +
  'https://www.semanticscholar.org/product/api#api-key-form", "code": "429"}';

/** `error-400`'s body: `docs/02` §6.10's shape, with the field the live probe drew it for. */
const SEMANTICSCHOLAR_DOCUMENTED_400_BODY =
  '{"error":"Unrecognized or unsupported fields: [tldr]"}';

/** `error-500`'s body: a placeholder that says so. */
const SEMANTICSCHOLAR_SYNTHETIC_500_BODY =
  '{"message": "synthetic fixture: docs/02 §6.10 records no Semantic Scholar ' +
  "5xx body shape; a server error cannot be provoked on demand. Status is " +
  'the assertable part."}';

/**
 * Semantic Scholar's four written fixtures: `error-429` (the measured body,
 * written rather than provoked — the pool is shared with every anonymous
 * caller and tripping it on purpose is not acceptable; a run that meets it
 * anyway records it under the scenario that drew it), `error-400` (the
 * probe's measured body under a reproducible key), `error-500` and
 * `error-malformed`.
 *
 * @param richBody - the recorded `record-rich` body, for `error-malformed`;
 *   `undefined` skips that fixture
 */
function semanticscholarSyntheticPlan(
  richBody: string | undefined,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
    {
      planned: semanticscholarPlanned(
        "error-429",
        '§3.1: rate-limit response — the measured anonymous-pool shape: JSON message, code "429" as a string, no Retry-After',
        recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_SYNTHETIC_429),
      ),
      exchange: {
        status: 429,
        headers: {
          "content-type": "application/json",
          "content-length": "174",
          "x-amzn-errortype": "TooManyRequestsException",
        },
        body: SEMANTICSCHOLAR_MEASURED_429_BODY,
      },
      reason:
        "Written from docs/02 §6.4's two measurements (2026-09-08, " +
        "2026-09-09): HTTP 429 with this exact 174-byte body on every " +
        "unauthenticated attempt, x-amzn-ErrorType TooManyRequestsException, " +
        "no Retry-After. Not provoked here — the anonymous pool is shared " +
        "with every caller on the internet.",
    },
    {
      planned: semanticscholarPlanned(
        "error-400",
        "docs/02 §6.10: 400 naming the unsupported field (measured 2026-10-15 for tldr on the bulk endpoint)",
        recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_SYNTHETIC_400),
      ),
      exchange: {
        status: 400,
        headers: { "content-type": "application/json" },
        body: SEMANTICSCHOLAR_DOCUMENTED_400_BODY,
      },
      reason:
        "Measured live 2026-10-15 (P2-T05's one probe, status and body " +
        "verbatim), then written under a reproducible key: the fields list " +
        "that drew it is one the shipped bulk builder no longer sends.",
    },
    {
      planned: semanticscholarPlanned(
        "error-500",
        "§3.1: server error",
        recordedSemanticScholarBulkRequest(SEMANTICSCHOLAR_QUERY_SYNTHETIC_500),
      ),
      exchange: {
        status: 500,
        headers: { "content-type": "application/json" },
        body: SEMANTICSCHOLAR_SYNTHETIC_500_BODY,
      },
      reason:
        "Hand-written. A 5xx cannot be provoked on demand and docs/02 §6.10 " +
        "records no Semantic Scholar 5xx body; the body is a placeholder.",
    },
  ];
  if (richBody !== undefined) {
    out.push({
      planned: semanticscholarPlanned(
        "error-malformed",
        "§3.1: truncated/invalid body",
        recordedSemanticScholarBulkRequest(
          SEMANTICSCHOLAR_QUERY_SYNTHETIC_MALFORMED,
        ),
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json" },
        // `redact()` first, as Crossref's is: the truncated fixture is not a
        // page anyone pages from or maps, so its paper SHAs and token are
        // redacted rather than exempted.
        body: redact(richBody).slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body after redaction, cut inside ` +
        `the JSON. Semantic Scholar has no documented way to ask for a ` +
        `truncated body.`,
    });
  }
  return out;
}

// --- 7f. bioRxiv and medRxiv ------------------------------------------------

/**
 * A DOI-scoped `api.biorxiv.org` request for the plan, built by the shipped
 * builder (`recordedBiorxivRequest` is `src/sources/biorxiv/query.ts`'s
 * `buildBiorxivDetailsRequest` / `buildBiorxivPubsRequest`). No key and no
 * contact parameter exist for this host (`docs/02` §8.1).
 */
function biorxivPlanned(
  scenario: string,
  purpose: string,
  endpoint: BiorxivEndpoint,
  server: BiorxivServer,
  doi: string,
): PlannedRequest {
  const built = recordedBiorxivRequest(endpoint, server, doi);
  return {
    scenario,
    purpose,
    method: built.method,
    url: built.url,
    endpoint: built.endpointBaseUrl,
  };
}

/**
 * bioRxiv's scenarios (`P2-T07`), every one a DOI known up front, so nothing is
 * dependent. The host has **no keyword search** (`docs/02` §8.4), so
 * `docs/13` §3.1's `search-typical`, `search-single` and `paginated` rows have
 * no request to record, and `dedup-pair-set` is `P2-T08`'s cross-source set
 * (`plan/00` §6 item 168). `search-empty` keeps its name for the lookup that
 * finds nothing. Three scenarios are this host's own: `pubs-not-found`
 * (§8.5's free-text not-found message), `lookup-cross-server` (a medRxiv DOI
 * asked of the bioRxiv server) and `pubs-old-style-doi` (a pre-2019, dateless
 * `10.1101/` DOI on `/pubs/`). **`record-jats-abstract` has no row here**:
 * it was first planned as that `/pubs/` call, which measured "not found" on
 * 2026-10-15, and the host's own markup problem — section headings run into
 * the prose (§8.5) — is carried by medRxiv's `record-rich` and
 * `record-sparse` abstracts instead.
 *
 * **Eight requests at one per second** — `spacingMsFor(BIORXIV_HOST)` reads
 * §7.3's `api.biorxiv.org` row (1/s) and gives 1000 ms.
 */
export function biorxivIndependentPlan(): readonly PlannedRequest[] {
  return [
    biorxivPlanned(
      "record-rich",
      "§3.1: every optional field — legacy 10.1101/ prefix, published != NA (YeastSAM, docs/02 §8.3)",
      "details",
      "biorxiv",
      BIORXIV_DOI_RICH,
    ),
    biorxivPlanned(
      "record-sparse",
      "§3.1: nothing beyond the mandatory fields — current 10.64898/ prefix, published NA (docs/02 §8.3 sample)",
      "details",
      "biorxiv",
      BIORXIV_DOI_SPARSE,
    ),
    biorxivPlanned(
      "record-unicode",
      "§3.1: diacritics and a typographic apostrophe in the title (Schrödinger’s Cat)",
      "details",
      "biorxiv",
      BIORXIV_DOI_UNICODE,
    ),
    biorxivPlanned(
      "record-preprint",
      "§3.1: a preprint with a linked published DOI — the /pubs/ cross-walk (docs/02 §8.3)",
      "pubs",
      "biorxiv",
      BIORXIV_DOI_RICH,
    ),
    biorxivPlanned(
      "pubs-old-style-doi",
      "a pre-2019, dateless 10.1101/ DOI on /pubs/ (LIGER, published in Cell): measured not found 2026-10-15",
      "pubs",
      "biorxiv",
      BIORXIV_DOI_OLD_STYLE,
    ),
    biorxivPlanned(
      "search-empty",
      "§3.1 zero results, as a DOI lookup: a DOI dated 1999 that cannot resolve",
      "details",
      "biorxiv",
      BIORXIV_DOI_ABSENT,
    ),
    biorxivPlanned(
      "pubs-not-found",
      "docs/02 §8.5: /pubs/ for an unpublished preprint — the free-text not-found message",
      "pubs",
      "biorxiv",
      BIORXIV_DOI_SPARSE,
    ),
    biorxivPlanned(
      "lookup-cross-server",
      "card step 6: a medRxiv DOI asked of the bioRxiv server — does the host cross servers?",
      "details",
      "biorxiv",
      BIORXIV_DOI_CROSS_SERVER,
    ),
  ];
}

/**
 * medRxiv's scenarios (`P2-T07`): the same reasoning as
 * {@link biorxivIndependentPlan}, four requests. `record-unicode` and
 * `record-jats-abstract` are bioRxiv's only — the two servers share one
 * mapper, so a second recording would test the same code — and no medRxiv DOI
 * with a non-ASCII title is known without spending a request to find one.
 */
export function medrxivIndependentPlan(): readonly PlannedRequest[] {
  return [
    biorxivPlanned(
      "record-rich",
      "§3.1: every optional field — legacy 10.1101/ prefix, published != NA (Bendavid et al.)",
      "details",
      "medrxiv",
      MEDRXIV_DOI_RICH,
    ),
    biorxivPlanned(
      "record-sparse",
      "§3.1: current 10.64898/ prefix on medRxiv (docs/02 §11.2: the prefix is shared)",
      "details",
      "medrxiv",
      MEDRXIV_DOI_SPARSE,
    ),
    biorxivPlanned(
      "record-preprint",
      "§3.1: a preprint with a linked published DOI — the /pubs/ cross-walk",
      "pubs",
      "medrxiv",
      MEDRXIV_DOI_RICH,
    ),
    biorxivPlanned(
      "search-empty",
      "§3.1 zero results, as a DOI lookup: a DOI dated 1999 that cannot resolve",
      "details",
      "medrxiv",
      BIORXIV_DOI_ABSENT,
    ),
  ];
}

/**
 * The `P2-T13` Part B corpus lookups for one server: one `/details/` call per
 * preprint DOI the corpus searches returned
 * (`test/support/biorxivRecordedRequests.ts`'s `*_CORPUS_DOIS`).
 */
export function biorxivCorpusPlan(
  server: BiorxivServer,
): readonly PlannedRequest[] {
  const dois = server === "biorxiv" ? BIORXIV_CORPUS_DOIS : MEDRXIV_CORPUS_DOIS;
  return dois.map((doi) =>
    biorxivPlanned(
      corpusLookupScenario(doi),
      "P2-T13 Part B corpus: a preprint DOI the corpus searches returned, " +
        "as this server returns it",
      "details",
      server,
      doi,
    ),
  );
}

/**
 * JSON member names in an `api.biorxiv.org` body that `redact()`'s
 * 40-character catch-all mistakes for a credential. Measured 2026-10-15
 * (`P2-T07`): the first recording of both `record-preprint` scenarios wrote
 * `/pubs/`'s `preprint_author_corresponding_institution` (41 characters) as
 * `"[redacted:41]"`, so the fixture no longer described the API. The name is
 * a schema key, not a secret, and is exempted **by name** —
 * `docs/13` §3.2's "by name, per source" rule, the mechanism Crossref's and
 * Semantic Scholar's cursors use. Nothing else in these bodies is exempt.
 */
const BIORXIV_LONG_MEMBER_NAMES: readonly string[] = [
  "preprint_author_corresponding_institution",
];

/** {@link SourcePlan.opaqueTokens} for both servers: the member names above, when present. */
function biorxivOpaqueTokens(body: string): readonly string[] {
  return BIORXIV_LONG_MEMBER_NAMES.filter((name) => body.includes(`"${name}"`));
}

/** `error-429`'s body: a placeholder — no 429 from this host is on record. */
const BIORXIV_SYNTHETIC_429_BODY =
  "<!-- synthetic fixture: docs/02 §8.5 — no rate limit is published and none " +
  "was observed, so no 429 body shape is on record. Not provoked. -->\n" +
  "<html><body><h1>Too Many Requests</h1></body></html>\n";

/** `error-500`'s body: a placeholder. */
const BIORXIV_SYNTHETIC_500_BODY =
  "<!-- synthetic fixture: docs/02 §8 records no 5xx body shape for " +
  "api.biorxiv.org; a server error cannot be provoked on demand. -->\n" +
  "<html><body><h1>Internal Server Error</h1></body></html>\n";

/**
 * `error-status`'s body: `docs/02` §8.5's documented in-200 error,
 * `{"messages":[{"status":"error", …}]}`, with the elided members left out.
 */
const BIORXIV_DOCUMENTED_STATUS_ERROR_BODY =
  '{"messages":[{"status":"error"}],"collection":[]}';

/**
 * One server's written fixtures: `error-429`, `error-500`, `error-empty-body`
 * (§8.5's measured 2026-09-15 outage shape: HTTP 200, `content-length: 0`),
 * `error-status` (§8.5's documented in-200 error) and `error-malformed`.
 *
 * @param server - whose directory the fixtures are keyed for
 * @param richBody - the recorded `record-rich` body, for `error-malformed`;
 *   `undefined` skips that fixture
 */
function biorxivSyntheticPlan(
  server: BiorxivServer,
  richBody: string | undefined,
): readonly SyntheticFixture[] {
  const out: SyntheticFixture[] = [
    {
      planned: biorxivPlanned(
        "error-429",
        "§3.1: rate-limit response — placeholder, no Retry-After (none observed on this host)",
        "details",
        server,
        BIORXIV_DOI_SYNTHETIC_429,
      ),
      exchange: {
        status: 429,
        headers: { "content-type": "text/html" },
        body: BIORXIV_SYNTHETIC_429_BODY,
      },
      reason:
        "Hand-written. docs/02 §8.1/§8.5: no rate limit is published and none " +
        "was observed, so neither the body nor a Retry-After is on record; the " +
        "self-imposed 1/s (docs/07 §7.3) is not tripped on purpose. Status is " +
        "the assertable part.",
    },
    {
      planned: biorxivPlanned(
        "error-500",
        "§3.1: server error",
        "details",
        server,
        BIORXIV_DOI_SYNTHETIC_500,
      ),
      exchange: {
        status: 500,
        headers: { "content-type": "text/html" },
        body: BIORXIV_SYNTHETIC_500_BODY,
      },
      reason:
        "Hand-written. A 5xx cannot be provoked on demand and docs/02 §8 " +
        "records no body; the body is a placeholder.",
    },
    {
      planned: biorxivPlanned(
        "error-empty-body",
        "docs/02 §8.5: HTTP 200 with an empty body — the measured 2026-09-15 /details outage",
        "details",
        server,
        BIORXIV_DOI_SYNTHETIC_EMPTY_BODY,
      ),
      exchange: {
        status: 200,
        headers: { "content-length": "0" },
        body: "",
      },
      reason:
        "Written from docs/02 §8.5's measurement of 2026-09-15 (P0-T21): every " +
        "/details request returned HTTP 200 with content-length 0; re-measured " +
        "working on 2026-09-30, so the shape is transient and cannot be " +
        "provoked on demand.",
    },
    {
      planned: biorxivPlanned(
        "error-status",
        "docs/02 §8.5: an error inside HTTP 200 — messages[0].status 'error'",
        "details",
        server,
        BIORXIV_DOI_SYNTHETIC_STATUS_ERROR,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: BIORXIV_DOCUMENTED_STATUS_ERROR_BODY,
      },
      reason:
        "Written from docs/02 §8.5's documented shape " +
        '{"messages":[{"status":"error", ...}]} inside HTTP 200; the elided ' +
        "members are left out. No request is known that provokes it.",
    },
  ];
  if (richBody !== undefined) {
    out.push({
      planned: biorxivPlanned(
        "error-malformed",
        "§3.1: truncated/invalid body",
        "details",
        server,
        BIORXIV_DOI_SYNTHETIC_MALFORMED,
      ),
      exchange: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: richBody.slice(0, MALFORMED_PREFIX_BYTES),
      },
      reason:
        `Derived, not recorded: the first ${String(MALFORMED_PREFIX_BYTES)} ` +
        `bytes of the recorded record-rich body, cut inside the JSON. The host ` +
        `has no documented way to ask for a truncated body.`,
    });
  }
  return out;
}

// --- 7g. The registry -------------------------------------------------------

/** The `record-rich` body a plan's `error-malformed` is cut from. */
async function recordedRichBody(
  answer: Answer,
  plan: readonly PlannedRequest[],
): Promise<string | undefined> {
  const rich = plan.find((p) => p.scenario === "record-rich");
  if (rich === undefined) return undefined;
  const got = await answer(rich);
  // `status !== 200` added by `P2-T05` (2026-10-15): the shared Semantic
  // Scholar pool answered record-rich with a 429, and the first run cut
  // error-malformed from that 174-byte error body — a fixture that parses as
  // an error envelope, not as a truncated page.
  if (got === undefined || got.status !== 200) {
    process.stderr.write(
      `  record-rich is not available as a 200, so error-malformed is skipped ` +
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
        independent: () => [
          ...independentPlan(),
          ...pubmedWindowPlan(),
          ...pubmedCorpusPlan(),
        ],
        dependent: async (answer) => [
          ...paginatedEfetchPlan(
            await pubmedPageIds(answer, "paginated-page-1"),
            await pubmedPageIds(answer, "paginated-page-2"),
          ),
          ...(await pubmedWindowEfetchPlan(answer)),
          ...(await pubmedCorpusEfetchPlan(answer)),
        ],
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
        independent: () => [
          ...europepmcIndependentPlan(),
          ...europepmcCorpusPlan(),
        ],
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
        independent: () => [
          ...crossrefIndependentPlan(),
          ...crossrefCorpusPlan(),
        ],
        dependent: crossrefDependentPlan,
        syntheticRequests: () =>
          crossrefSyntheticPlan("").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          crossrefSyntheticPlan(
            await recordedRichBody(answer, crossrefIndependentPlan()),
          ),
        opaqueTokens: crossrefOpaqueTokens,
      };
    case "arxiv":
      return {
        source,
        host: ARXIV_HOST,
        fixtureDir: fixtureDirFor("arxiv"),
        independent: () => [...arxivIndependentPlan(), ...arxivCorpusPlan()],
        // `start` is an offset, so page 2 is in the independent plan and
        // nothing here depends on an earlier answer.
        dependent: () => Promise.resolve([]),
        syntheticRequests: () => arxivSyntheticPlan("").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          arxivSyntheticPlan(
            await recordedRichBody(answer, arxivIndependentPlan()),
          ),
      };
    case "semanticscholar":
      return {
        source,
        host: SEMANTICSCHOLAR_HOST,
        fixtureDir: fixtureDirFor("semanticscholar"),
        independent: () => [
          ...semanticscholarIndependentPlan(),
          ...semanticscholarCorpusPlan(),
        ],
        dependent: semanticscholarDependentPlan,
        syntheticRequests: () =>
          semanticscholarSyntheticPlan("").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          semanticscholarSyntheticPlan(
            await recordedRichBody(answer, semanticscholarIndependentPlan()),
          ),
        opaqueTokens: semanticscholarOpaqueTokens,
      };
    case "biorxiv":
    case "medrxiv": {
      // `P2-T07`: two `SourceId`s, one host, one directory each (`docs/07`
      // §2.2). Every scenario is a DOI known up front, so nothing depends on
      // an earlier answer; the one exemption is a member name, not a token.
      const independent =
        source === "biorxiv" ? biorxivIndependentPlan : medrxivIndependentPlan;
      return {
        source,
        host: BIORXIV_HOST,
        fixtureDir: fixtureDirFor(source),
        independent: () => [...independent(), ...biorxivCorpusPlan(source)],
        dependent: () => Promise.resolve([]),
        syntheticRequests: () =>
          biorxivSyntheticPlan(source, "").map((s) => s.planned),
        syntheticFixtures: async (answer) =>
          biorxivSyntheticPlan(
            source,
            await recordedRichBody(answer, independent()),
          ),
        opaqueTokens: biorxivOpaqueTokens,
      };
    }
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
// 8b. LLM providers — `P3-T30`, split by `plan/00` §6 item 298(b)
// ---------------------------------------------------------------------------

/*
 * The agent half of `P3-T30`: the scenario list, the stated spend, the gates
 * and the recording path. **The recording itself is the owner's** (`docs/13`
 * §3.4): it spends money against the owner's keys, so no agent runs it.
 *
 * What is different from the literature sources, and why:
 *
 * - **A key is needed**, so this is the one exception to `docs/13` §3.2's
 *   "scenarios run unauthenticated". The key is read from the process
 *   environment ({@link LLM_KEY_ENV_VARS}) and from nowhere else — never a file
 *   — only in live mode, wrapped at once in a single-id store
 *   ({@link singleKeyStore}) that the shipped adapter reads it from, exactly as
 *   it reads the product keystore. Its value joins the deny-list, so it is
 *   scrubbed literally from every byte that is written or printed.
 * - **Live mode has three locks and a ceiling.** `FIXTURE_MODE=record`, the
 *   `--live` flag and the key; then the run prints the stated spend and stops
 *   with nothing sent ({@link LLM_EXIT_SPEND_GATE}) unless
 *   `--confirm-spend-usd` names at least that amount. The confirmed amount is
 *   then the ceiling of the shipped `createBudgetGuard`, reserved before and
 *   settled after every billed call.
 * - **The stated spend never under-states** ({@link stateLlmSpend}): every
 *   billed call is charged its whole `maxOutputTokens`, and an input of the
 *   larger of the shipped estimate with its headroom and one token per two
 *   characters, plus {@link LLM_ESTIMATE_OVERHEAD_TOKENS}; the prices are the
 *   shipped price source's ({@link llmPriceSource}).
 * - **The model is chosen, not written down** (`plan/README.md` §5 rule 4):
 *   the cheapest model the price source prices for the provider
 *   ({@link chooseLlmModel}), or the owner's `--model`, which must be priced
 *   too. Before any billed call the run lists the provider's models — free —
 *   and stops if the model is not there.
 * - **Fixtures are named by scenario**, not by a request hash (`docs/13` §3.2's
 *   note of 2026-10-27; `llmFixtureKey` in `test/contract/_transport.ts`), and
 *   **only response bodies are written** — the request bodies are snapshotted
 *   from the adapters by `test/contract/llm/`.
 * - **Headers come from an allow-list** ({@link LLM_HEADER_ALLOW}): account
 *   and project identifiers, cookies and request ids never reach a file.
 * - **Nothing is written unless everything is clean.** Every exchange of the
 *   run is redacted and checked by {@link assertClean} first; one failure
 *   writes no file at all.
 */

/** The LLM providers the recorder has a plan for: every `ProviderId`. */
export const LLM_RECORDABLE_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
] as const satisfies readonly (ProviderId & LlmFixtureProvider)[];
export type LlmRecordableProvider = (typeof LLM_RECORDABLE_PROVIDERS)[number];

/** Whether `value` names an LLM provider rather than a literature source. */
export function isLlmRecordableProvider(
  value: string,
): value is LlmRecordableProvider {
  return (LLM_RECORDABLE_PROVIDERS as readonly string[]).includes(value);
}

/** Bump when a scenario's request changes, as {@link SCENARIO_VERSION}. */
export const LLM_SCENARIO_VERSION = 1;

/**
 * `test/fixtures/llm/<provider>/` (`plan/04` card `P3-T30`'s `Files`).
 *
 * @param provider - the provider
 * @returns the absolute directory
 */
export function llmFixtureDirFor(provider: LlmRecordableProvider): string {
  return resolve(REPO_ROOT, "test/fixtures/llm", provider);
}

/**
 * The one place a key is read from: an environment variable, set by the owner
 * in the shell of one recording session (`docs/13` §3.2's note of
 * 2026-10-27). The names are the providers' own conventional ones, which
 * `docs/03` already uses in its `curl` examples, and every one matches
 * `KEYISH_FIELD`, so {@link literalDenyList} scrubs its value anyway.
 */
export const LLM_KEY_ENV_VARS: Readonly<Record<LlmRecordableProvider, string>> =
  Object.freeze({
    openrouter: "OPENROUTER_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  });

/**
 * The provider's key from `env`, and from nothing else: no file, no `.env`, no
 * preference. Called only in live mode, after `--live`.
 *
 * @param provider - the provider
 * @param env - the process environment (a test passes its own record)
 * @returns the trimmed value, or `undefined` when unset or blank
 */
export function llmKeyFromEnvironment(
  provider: LlmRecordableProvider,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const value = env[LLM_KEY_ENV_VARS[provider]]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** Each adapter's keystore id (`docs/09` §1.7), as the adapters export it. */
const LLM_SECRET_IDS: Readonly<Record<LlmRecordableProvider, SecretId>> =
  Object.freeze({
    openrouter: OPENROUTER_SECRET_ID,
    openai: OPENAI_SECRET_ID,
    anthropic: ANTHROPIC_SECRET_ID,
    gemini: GEMINI_SECRET_ID,
  });

/**
 * A read-only `SecretStore` holding one value under the provider's id: how the
 * shipped adapter receives the session's key (or the contract tests' synthetic
 * one) without any change to the adapter.
 *
 * @param provider - whose id the value is stored under
 * @param value - the key
 * @returns the store
 */
export function singleKeyStore(
  provider: LlmRecordableProvider,
  value: string,
): SecretStore {
  const id = LLM_SECRET_IDS[provider];
  const readOnly = (): Promise<never> =>
    Promise.reject(new Error("the recorder's key store is read-only"));
  return {
    backend: "session-only",
    unattended: true,
    get: (asked) => Promise.resolve(asked === id ? value : undefined),
    has: (asked) => Promise.resolve(asked === id),
    set: readOnly,
    clear: readOnly,
    listStoredIds: () => Promise.resolve([id]),
    clearAll: () => Promise.resolve(0),
  };
}

/**
 * The `error-401` scenario's key: shaped like the provider's keys so the host
 * reads it as a wrong key rather than a malformed header, invalid by
 * construction, and assembled at run time so no key-shaped literal sits in the
 * source. It is never the owner's key, and it is on the deny-list too.
 *
 * @param provider - the provider
 * @returns the invalid key
 */
export function invalidLlmKey(provider: LlmRecordableProvider): string {
  const filler = `recorderinvalidkey${"0".repeat(40)}`;
  switch (provider) {
    case "openrouter":
      return ["sk", "or", "v1", filler].join("-");
    case "openai":
      return ["sk", "proj", filler].join("-");
    case "anthropic":
      return ["sk", "ant", "api03", filler].join("-");
    case "gemini":
      return `${"AI"}za${filler.slice(0, 35)}`;
  }
}

/** How one scenario drives the adapter. */
export type LlmScenarioKind =
  "list-models" | "chat" | "chat-stream" | "chat-legacy";

/** One entry of the versioned scenario list. */
export interface LlmScenario {
  readonly scenario: string;
  readonly kind: LlmScenarioKind;
  /** `live`: the owner records it; `synthetic`: written, with a reason. */
  readonly recording: "live" | "synthetic";
  /** Whether a live request is charged for tokens. */
  readonly billed: boolean;
  /** Which key a live request carries. */
  readonly key: "environment" | "synthetic-invalid" | "none";
  readonly purpose: string;
}

/**
 * `docs/13` §3.1's ten LLM rows, with `error-429` twice (card `P3-T30`'s
 * Notes): eleven per provider, forty-four in all. Which are written rather
 * than recorded, and why, is `docs/13` §3.1's note of 2026-10-27.
 */
export const LLM_SCENARIOS: readonly LlmScenario[] = Object.freeze([
  {
    scenario: "models-list",
    kind: "list-models",
    recording: "live",
    billed: false,
    key: "environment",
    purpose:
      "§3.1: the model-listing endpoint, for the model selector. Free; " +
      "always sent first, and the run stops if the chosen model is absent",
  },
  {
    scenario: "chat-nonstream-ok",
    kind: "chat",
    recording: "live",
    billed: true,
    key: "environment",
    purpose: "§3.1: normal completion with a usage block",
  },
  {
    scenario: "chat-stream-ok",
    kind: "chat-stream",
    recording: "live",
    billed: true,
    key: "environment",
    purpose:
      "§3.1: the full SSE chunk sequence, including the terminal event " +
      "(settles Gemini's assumed stream shapes, plan/00 §6 item 268)",
  },
  {
    scenario: "chat-json-ok",
    kind: "chat",
    recording: "live",
    billed: true,
    key: "environment",
    purpose:
      "§3.1: a structured answer — the shipped PAPER_SUMMARY_ABSTRACT prompt " +
      "and its schema, over a short synthetic abstract",
  },
  {
    scenario: "chat-json-malformed",
    kind: "chat",
    recording: "live",
    billed: true,
    key: "environment",
    purpose:
      "§3.1: JSON that nearly matches — inside a code fence, with prose after it",
  },
  {
    scenario: "error-truncated",
    kind: "chat",
    recording: "live",
    billed: true,
    key: "environment",
    purpose: "§3.1: a completion stopped by maxOutputTokens (16)",
  },
  {
    scenario: "error-401",
    kind: "chat",
    recording: "live",
    billed: false,
    key: "synthetic-invalid",
    purpose:
      "§3.1: a bad key — a key-shaped invalid value the recorder builds, " +
      "never the owner's key. Not billed",
  },
  {
    scenario: "error-429",
    kind: "chat",
    recording: "synthetic",
    billed: false,
    key: "none",
    purpose: "§3.1: rate limit, with Retry-After: 2",
  },
  {
    scenario: "error-429-no-retry-after",
    kind: "chat",
    recording: "synthetic",
    billed: false,
    key: "none",
    purpose: "§3.1: rate limit, without Retry-After",
  },
  {
    scenario: "error-context-length",
    kind: "chat",
    recording: "synthetic",
    billed: false,
    key: "none",
    purpose: "§3.1: the provider's over-length error shape (docs/03 §11.5)",
  },
  {
    scenario: "refusal",
    kind: "chat",
    recording: "synthetic",
    billed: false,
    key: "none",
    purpose: "§3.1: a safety refusal on HTTP 200 (docs/03 §11.5 trap 2)",
  },
] satisfies readonly LlmScenario[]);

/**
 * How `scenario` drives `provider`'s adapter: Gemini's `refusal` goes through
 * `chatViaGenerateContent`, the legacy surface whose blocked shape `docs/03`
 * §11.5 documents; every other scenario as listed.
 *
 * @param provider - the provider
 * @param scenario - the scenario
 * @returns the kind
 */
export function llmScenarioKind(
  provider: LlmRecordableProvider,
  scenario: LlmScenario,
): LlmScenarioKind {
  return provider === "gemini" && scenario.scenario === "refusal"
    ? "chat-legacy"
    : scenario.kind;
}

/**
 * The scenarios `--only` keeps, in list order.
 *
 * @param only - the names, or `undefined` for every scenario
 * @returns the scenarios
 * @throws UsageError naming a scenario the list does not have
 */
export function selectLlmScenarios(
  only: readonly string[] | undefined,
): readonly LlmScenario[] {
  if (only === undefined) return LLM_SCENARIOS;
  const known = LLM_SCENARIOS.map((s) => s.scenario);
  const unknown = only.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `--only names scenarios the LLM list does not have: ${unknown.join(", ")}. ` +
        `Known: ${known.join(", ")}`,
    );
  }
  return LLM_SCENARIOS.filter((s) => only.includes(s.scenario));
}

/** The correlation id of every recorded request; never sent upstream (`docs/07` §4.3). */
const LLM_TRACE_ID = "p3-t30-recording";

/** The short system message of the plain scenarios. */
const PLAIN_SYSTEM =
  "You are a terse assistant answering requests that record API test fixtures.";

/**
 * A short abstract written for this fixture, not taken from any paper, so the
 * recorded answer quotes nothing anyone owns.
 */
const SYNTHETIC_ABSTRACT =
  "Background: Coastal tide gauges drift as their benchmarks subside. " +
  "Methods: We compared 12 gauges with co-located GNSS stations over 2015-2024 " +
  "and fitted a linear drift per gauge. Results: Median vertical drift was " +
  "1.8 mm/yr (range 0.4-3.1 mm/yr); correcting it reduced the regional " +
  "sea-level trend from 4.9 to 3.2 mm/yr. Conclusions: Uncorrected gauge " +
  "subsidence inflates local sea-level trends.";

/** The shipped `PAPER_SUMMARY_ABSTRACT` prompt, read from its file as the unit tests read it. */
function paperSummaryTemplate(): PromptTemplate {
  const fileName = PROMPT_FILE_NAMES.PAPER_SUMMARY_ABSTRACT;
  return parsePromptFile({
    fileName,
    text: readFileSync(resolve(REPO_ROOT, "src/prompts", fileName), "utf8"),
  });
}

/** `chat-json-ok`'s request: the product's prompt, schema, temperature and output cap. */
function paperSummaryRequest(model: string): ChatRequest {
  const template = paperSummaryTemplate();
  const schema = template.schema;
  if (schema === null) {
    throw new Error("PAPER_SUMMARY_ABSTRACT declares no schema");
  }
  const rendered = renderPrompt(template, {
    ITEM_KEY: "RHFIXT01",
    TITLE: "Benchmark drift in coastal tide gauges (synthetic test record)",
    AUTHORS: "Test Author",
    YEAR: "2025",
    VENUE: "Synthetic Journal of Fixtures",
    ITEM_TYPE: "journalArticle",
    DOI: "none",
    TAGS: "none",
    ABSTRACT: SYNTHETIC_ABSTRACT,
    JSON_SCHEMA: JSON.stringify(schema, null, 2),
  });
  return {
    model,
    messages: [
      { role: "system", content: rendered.system },
      { role: "user", content: rendered.user },
    ],
    temperature: template.defaultTemperature,
    maxOutputTokens: resolveMaxTokens(template),
    responseFormat: { kind: "json_schema", name: "paper_summary", schema },
    traceId: LLM_TRACE_ID,
  };
}

/** A plain two-message request. */
function plainRequest(
  model: string,
  user: string,
  maxOutputTokens: number,
): ChatRequest {
  return {
    model,
    messages: [
      { role: "system", content: PLAIN_SYSTEM },
      { role: "user", content: user },
    ],
    maxOutputTokens,
    traceId: LLM_TRACE_ID,
  };
}

/**
 * The `ChatRequest` a scenario sends — the recorder's and the contract
 * tests' one source, so the request snapshot is exactly what is recorded
 * with. A synthetic scenario, which sends nothing, drives the adapter with
 * `chat-nonstream-ok`'s request.
 *
 * @param scenario - a name from {@link LLM_SCENARIOS} other than `models-list`
 * @param model - the model
 * @returns the request
 * @throws Error for `models-list` or an unknown name
 */
export function llmScenarioRequest(
  scenario: string,
  model: string,
): ChatRequest {
  switch (scenario) {
    case "chat-nonstream-ok":
    case "error-401":
    case "error-429":
    case "error-429-no-retry-after":
    case "error-context-length":
    case "refusal":
      return plainRequest(model, "Reply with exactly one word: ready", 1024);
    case "chat-stream-ok":
      return plainRequest(
        model,
        "Count from one to twenty in English words, separated by commas, " +
          "and write nothing else.",
        1024,
      );
    case "chat-json-ok":
      return paperSummaryRequest(model);
    case "chat-json-malformed":
      return plainRequest(
        model,
        'Write the JSON object {"ok": true, "n": 3} inside a Markdown code ' +
          "block marked json, then write one short sentence after the code " +
          "block. Write nothing before the code block.",
        1024,
      );
    case "error-truncated":
      return plainRequest(
        model,
        "Write a 300-word paragraph about ocean tides.",
        16,
      );
    default:
      throw new Error(`No LLM request for scenario "${scenario}"`);
  }
}

/** Every adapter's request path, as the snapshot and the sidecar name it. */
const LLM_BASE_URLS = createBaseUrlResolver({ override: () => "" });

/** What {@link createLlmAdapter} needs: the shipped adapters' own dependencies. */
export interface LlmAdapterDeps {
  readonly http: HttpClient;
  readonly secrets: SecretStore;
  readonly clock: Clock;
}

/**
 * The shipped adapter for `provider`, on the documented base URL (no
 * override: a fixture is about the documented API), over the given client and
 * key store. The recorder and the contract tests both build it here.
 *
 * @param provider - the provider
 * @param deps - client, key store, clock
 * @returns the adapter
 */
export function createLlmAdapter(
  provider: LlmRecordableProvider,
  deps: LlmAdapterDeps,
): LLMProvider {
  const shared = {
    http: deps.http,
    secrets: deps.secrets,
    baseUrls: LLM_BASE_URLS,
    clock: deps.clock,
  };
  switch (provider) {
    case "openrouter":
      return createOpenRouterProvider(shared);
    case "openai":
      return createOpenAiProvider(shared);
    case "anthropic":
      return createAnthropicProvider(shared);
    case "gemini":
      return createGeminiProvider(shared);
  }
}

/**
 * Gemini's legacy `generateContent` call (`chat-legacy`), with the same
 * dependencies {@link createLlmAdapter} gives the Gemini adapter.
 *
 * @param deps - client, key store, clock
 * @param request - the request
 * @param ctx - the call context
 * @returns the answer
 */
export function geminiLegacyChat(
  deps: LlmAdapterDeps,
  request: ChatRequest,
  ctx: LLMCallContext,
): Promise<ChatResponse> {
  return chatViaGenerateContent(
    {
      http: deps.http,
      secrets: deps.secrets,
      baseUrls: LLM_BASE_URLS,
      clock: deps.clock,
    },
    request,
    ctx,
  );
}

// --- The stated spend --------------------------------------------------------

/** One token per this many characters: below every script `docs/06` §5.1 prices but Hangul and CJK, which the larger-of rule covers. */
export const LLM_ESTIMATE_CHARS_PER_TOKEN = 2;

/** Added to every billed call's input, for the provider's own framing and schema wrapping. */
export const LLM_ESTIMATE_OVERHEAD_TOKENS = 300;

/**
 * An upper bound on one request's input tokens: the larger of the shipped
 * estimate with its headroom (`estTokens`, `withHeadroom`) and one token per
 * {@link LLM_ESTIMATE_CHARS_PER_TOKEN} characters, over the messages **and**
 * a structured-output schema (which the provider counts as input too), plus
 * {@link LLM_ESTIMATE_OVERHEAD_TOKENS}.
 *
 * @param request - the request
 * @returns the bound
 */
export function llmInputTokenBound(request: ChatRequest): number {
  const parts = request.messages.map((m) => m.content);
  if (request.responseFormat?.kind === "json_schema") {
    parts.push(JSON.stringify(request.responseFormat.schema));
  }
  const text = parts.join("\n");
  return (
    Math.max(
      withHeadroom(estTokens(text)),
      Math.ceil(text.length / LLM_ESTIMATE_CHARS_PER_TOKEN),
    ) + LLM_ESTIMATE_OVERHEAD_TOKENS
  );
}

/** One scenario's share of the stated spend. */
export interface LlmScenarioBound {
  readonly scenario: string;
  readonly recording: "live" | "synthetic";
  readonly billed: boolean;
  /** Requests this scenario sends: 0 synthetic, else 1 (a model list may page). */
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Fractional US dollars, never rounded; 0 when not billed. */
  readonly costUsd: number;
}

/** What the dry run prints and live mode is confirmed against. */
export interface LlmSpendStatement {
  readonly provider: LlmRecordableProvider;
  readonly model: string;
  readonly prices: ModelPrices;
  /** The prices' date, `YYYY-MM-DD`. */
  readonly pricesAsOf: string;
  readonly scenarios: readonly LlmScenarioBound[];
  /** Live requests, counting a model list once. */
  readonly requests: number;
  readonly billedCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The upper bound, fractional US dollars, never rounded. */
  readonly costUsd: number;
}

/**
 * The stated spend: every billed live scenario at its bounds, priced with
 * `costOf` at `atEpochMs` (a promotion's end and a long-context tier both
 * apply), cached tokens assumed none — a cached price is never above the
 * input price, so that can only over-state.
 *
 * @param provider - the provider
 * @param model - the model
 * @param prices - its prices
 * @param scenarios - the selected scenarios
 * @param atEpochMs - now
 * @returns the statement
 * @throws UsageError when a price the bound needs is not published
 */
export function stateLlmSpend(
  provider: LlmRecordableProvider,
  model: string,
  prices: ModelPrices,
  scenarios: readonly LlmScenario[],
  atEpochMs: number,
): LlmSpendStatement {
  const bounds: LlmScenarioBound[] = [];
  for (const s of scenarios) {
    if (s.recording === "synthetic") {
      bounds.push({ ...zeroBound(s), requests: 0 });
      continue;
    }
    if (!s.billed) {
      bounds.push({ ...zeroBound(s), requests: 1 });
      continue;
    }
    const request = llmScenarioRequest(s.scenario, model);
    const inputTokens = llmInputTokenBound(request);
    const outputTokens = request.maxOutputTokens ?? 0;
    const cost = costOf(prices, { inputTokens, outputTokens }, atEpochMs);
    if (cost.costUsd === undefined) {
      throw new UsageError(
        `${provider} model "${model}" has no published price for ` +
          `${s.scenario}'s tokens: refusing to state a spend it cannot bound.`,
      );
    }
    bounds.push({
      scenario: s.scenario,
      recording: s.recording,
      billed: true,
      requests: 1,
      inputTokens,
      outputTokens,
      costUsd: cost.costUsd,
    });
  }
  const sum = (pick: (b: LlmScenarioBound) => number): number =>
    bounds.reduce((acc, b) => acc + pick(b), 0);
  return {
    provider,
    model,
    prices,
    pricesAsOf: new Date(prices.asOfEpochMs).toISOString().slice(0, 10),
    scenarios: bounds,
    requests: sum((b) => b.requests),
    billedCalls: bounds.filter((b) => b.billed).length,
    inputTokens: sum((b) => b.inputTokens),
    outputTokens: sum((b) => b.outputTokens),
    costUsd: sum((b) => b.costUsd),
  };
}

function zeroBound(s: LlmScenario): Omit<LlmScenarioBound, "requests"> {
  return {
    scenario: s.scenario,
    recording: s.recording,
    billed: false,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

/**
 * The shipped price source (`createModelPriceSource`), never refreshed: the
 * recorder sends nothing before the confirmation, so it holds what the
 * product holds before its first refresh — `docs/03` §12.1's table with its
 * date, `stale: true` (`bundledCatalogue`).
 *
 * @returns the source
 */
export function llmPriceSource(): ModelPriceSource {
  return createModelPriceSource({
    catalogue: { get: () => Promise.resolve(bundledCatalogue()) },
    userPriceOverrides: () => [],
  });
}

/**
 * The model to record with: `override` when given — it must be priced — else
 * the model with the lowest stated spend among those the source prices for
 * `provider` with both an input and an output price (ties by id). "Capable"
 * beyond that is the owner's check at `G-18`; the live run also stops when the
 * provider does not list the model.
 *
 * @param provider - the provider
 * @param source - the price source
 * @param atEpochMs - now
 * @param override - `--model`
 * @returns the model and its prices
 * @throws UsageError when the override is unpriced or nothing is priced
 */
export function chooseLlmModel(
  provider: LlmRecordableProvider,
  source: ModelPriceSource,
  atEpochMs: number,
  override?: string,
): { readonly model: string; readonly prices: ModelPrices } {
  const billed = LLM_SCENARIOS.filter((s) => s.billed);
  if (override !== undefined) {
    const prices = source.pricesFor(provider, override);
    if (
      prices?.inputPerMTokUsd === undefined ||
      prices.outputPerMTokUsd === undefined
    ) {
      throw new UsageError(
        `--model "${override}" has no ${provider} price in the price source ` +
          `(docs/03 §12.1's table until it is refreshed): a spend that cannot ` +
          `be bounded is not stated, and not recorded.`,
      );
    }
    return { model: override, prices };
  }
  let best: { model: string; prices: ModelPrices; costUsd: number } | undefined;
  const models = modelsFor(source.current(), provider)
    .map((m) => m.id)
    .sort();
  for (const model of models) {
    const prices = source.pricesFor(provider, model);
    if (
      prices?.inputPerMTokUsd === undefined ||
      prices.outputPerMTokUsd === undefined
    ) {
      continue;
    }
    const { costUsd } = stateLlmSpend(
      provider,
      model,
      prices,
      billed,
      atEpochMs,
    );
    if (best === undefined || costUsd < best.costUsd) {
      best = { model, prices, costUsd };
    }
  }
  if (best === undefined) {
    throw new UsageError(
      `The price source prices no ${provider} model: name one with --model.`,
    );
  }
  return { model: best.model, prices: best.prices };
}

/** A dollar figure rounded **up** to 4 decimals, so a printed bound is never below the bound. */
export function usdUp(usd: number): string {
  return `$${(Math.ceil(usd * 10_000 - 1e-9) / 10_000).toFixed(4)}`;
}

// --- Synthetic fixtures ------------------------------------------------------

const SYNTHETIC_NOTE = "[synthetic fixture, P3-T30; not a recorded answer]";

/** `docs/03` §11.5's shapes, one body per provider and synthetic scenario. */
function syntheticLlmBody(
  provider: LlmRecordableProvider,
  scenario: string,
): { readonly status: number; readonly body: unknown } {
  const rateLimit =
    scenario === "error-429" || scenario === "error-429-no-retry-after";
  switch (provider) {
    case "openai":
      if (rateLimit) {
        return {
          status: 429,
          body: {
            error: {
              message: `Rate limit reached for requests per min. ${SYNTHETIC_NOTE}`,
              type: "requests",
              param: null,
              code: "rate_limit_exceeded",
            },
          },
        };
      }
      if (scenario === "error-context-length") {
        return {
          status: 400,
          body: {
            error: {
              message: `Your input exceeds the context window of this model. ${SYNTHETIC_NOTE}`,
              type: "invalid_request_error",
              param: "input",
              code: "context_length_exceeded",
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          id: "resp_synthetic_refusal",
          object: "response",
          status: "completed",
          model: "synthetic-model",
          output: [
            {
              type: "message",
              id: "msg_synthetic_refusal",
              status: "completed",
              role: "assistant",
              content: [
                {
                  type: "refusal",
                  refusal: `I can't help with that. ${SYNTHETIC_NOTE}`,
                },
              ],
            },
          ],
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        },
      };
    case "anthropic":
      if (rateLimit) {
        return {
          status: 429,
          body: {
            type: "error",
            error: {
              type: "rate_limit_error",
              message: `Number of requests has exceeded your rate limit. ${SYNTHETIC_NOTE}`,
            },
          },
        };
      }
      if (scenario === "error-context-length") {
        return {
          status: 400,
          body: {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `prompt is too long: 210000 tokens > 200000 maximum ${SYNTHETIC_NOTE}`,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          id: "msg_synthetic_refusal",
          type: "message",
          role: "assistant",
          model: "synthetic-model",
          content: [],
          stop_reason: "refusal",
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 0 },
        },
      };
    case "gemini":
      if (rateLimit) {
        return {
          status: 429,
          body: {
            error: {
              code: 429,
              message: `Resource has been exhausted (e.g. check quota). ${SYNTHETIC_NOTE}`,
              status: "RESOURCE_EXHAUSTED",
            },
          },
        };
      }
      if (scenario === "error-context-length") {
        return {
          status: 400,
          body: {
            error: {
              code: 400,
              message:
                "The input token count (1100000) exceeds the maximum number of " +
                `tokens allowed (1048576). ${SYNTHETIC_NOTE}`,
              status: "INVALID_ARGUMENT",
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          candidates: [
            {
              content: { role: "model", parts: [] },
              finishReason: "SAFETY",
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 20, totalTokenCount: 20 },
          modelVersion: "synthetic-model",
        },
      };
    case "openrouter":
      if (rateLimit) {
        return {
          status: 429,
          body: {
            error: {
              message: `Rate limit exceeded. ${SYNTHETIC_NOTE}`,
              code: 429,
            },
          },
        };
      }
      if (scenario === "error-context-length") {
        return {
          status: 400,
          body: {
            error: {
              message:
                "This endpoint's maximum context length is 400000 tokens. " +
                `However, you requested about 410000 tokens. ${SYNTHETIC_NOTE}`,
              code: 400,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          id: "gen-synthetic-refusal",
          object: "chat.completion",
          model: "synthetic-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "" },
              finish_reason: "content_filter",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
        },
      };
  }
}

/** Why each synthetic scenario is written rather than recorded (`docs/13` §3.1's note). */
const SYNTHETIC_LLM_REASONS: Readonly<Record<string, string>> = Object.freeze({
  "error-429":
    "Hand-written from docs/03 §11.5's rate_limit row: provoking a rate limit " +
    "spends money and risks the owner's account. Status and Retry-After: 2 are " +
    "the assertable parts; the body is the documented envelope.",
  "error-429-no-retry-after":
    "As error-429, without Retry-After (card P3-T30's Notes: recorded twice). " +
    "Exercises the client's no-header path for this adapter.",
  "error-context-length":
    "Hand-written from docs/03 §11.5's context_length row: provoking it needs " +
    "a prompt above the model's context window (up to about a million tokens), " +
    "whose window the bundled price table does not state.",
  refusal:
    "Hand-written from docs/03 §11.5's content_filter row: provoking a refusal " +
    "means sending a request the provider's policy forbids, which risks the " +
    "owner's account. Gemini's uses the legacy generateContent shape, because " +
    "the Interactions API's blocked shape is not documented (P3-T05 report).",
});

/** A synthetic scenario's exchange, endpoint and reason. */
export interface SyntheticLlmFixture {
  readonly scenario: string;
  readonly method: string;
  readonly endpoint: string;
  readonly exchange: RecordedExchange;
  readonly reason: string;
}

/**
 * One synthetic LLM fixture, built with no network and no key.
 *
 * @param provider - the provider
 * @param scenario - a synthetic scenario of {@link LLM_SCENARIOS}
 * @returns the fixture
 */
export function syntheticLlmFixture(
  provider: LlmRecordableProvider,
  scenario: LlmScenario,
): SyntheticLlmFixture {
  const reason = SYNTHETIC_LLM_REASONS[scenario.scenario];
  if (scenario.recording !== "synthetic" || reason === undefined) {
    throw new Error(`"${scenario.scenario}" is not a synthetic LLM scenario`);
  }
  const { status, body } = syntheticLlmBody(provider, scenario.scenario);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (scenario.scenario === "error-429") headers["retry-after"] = "2";
  return {
    scenario: scenario.scenario,
    method: "POST",
    endpoint: llmEndpointFor(provider, llmScenarioKind(provider, scenario)),
    exchange: { status, headers, body: `${JSON.stringify(body, null, 2)}\n` },
    reason,
  };
}

/** The documented endpoint a chat scenario is sent to, with no query. */
function llmEndpointFor(
  provider: LlmRecordableProvider,
  kind: LlmScenarioKind,
): string {
  const base = LLM_BASE_URLS.resolveBaseUrl(provider);
  switch (provider) {
    case "openai":
      return `${base}/responses`;
    case "anthropic":
      return `${base}/v1/messages`;
    case "openrouter":
      return `${base}/chat/completions`;
    case "gemini":
      return kind === "chat-legacy"
        ? `${base}/v1beta/models/{model}:generateContent`
        : `${base}/v1beta/interactions`;
  }
}

// --- Redaction, the LLM part -------------------------------------------------

/**
 * Response headers an LLM fixture may keep: what the client and the error map
 * read (`Retry-After`, the rate-limit headers `docs/03` §11 names) and the
 * content type. Everything else is dropped by name — organisation and project
 * identifiers (`openai-organization`, `anthropic-organization-id`), cookies,
 * request and trace ids — because a fixture needs none of them and a
 * committed file should not carry an account's identifiers.
 */
export const LLM_HEADER_ALLOW: readonly RegExp[] = Object.freeze([
  /^content-type$/u,
  /^retry-after(?:-ms)?$/u,
  /^x-ratelimit-[a-z0-9-]+$/u,
  /^anthropic-ratelimit-[a-z0-9-]+$/u,
]);

/** Whether an LLM fixture may keep the (lower-cased) header `name`. */
export function llmHeaderAllowed(name: string): boolean {
  return LLM_HEADER_ALLOW.some((re) => re.test(name.toLowerCase()));
}

/**
 * {@link redactExchange} for an LLM answer: the headers not on
 * {@link LLM_HEADER_ALLOW} are dropped first (and noted by name), then the
 * shared pass scrubs what is left, body included.
 *
 * @param raw - the exchange as received
 * @param deny - the deny-list, the session's key and the invalid key included
 * @returns the writable exchange and its notes
 */
export function redactLlmExchange(
  raw: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
  deny: readonly string[],
): { readonly exchange: RecordedExchange; readonly notes: readonly string[] } {
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(raw.headers)) {
    if (llmHeaderAllowed(name)) kept[name.toLowerCase()] = value;
    else dropped.push(name.toLowerCase());
  }
  const shared = redactExchange(
    { status: raw.status, headers: kept, body: raw.body },
    deny,
  );
  const notes =
    dropped.length === 0
      ? shared.notes
      : [
          `dropped ${String(dropped.length)} header(s) not on the LLM allow-list: ` +
            dropped.sort().join(", "),
          ...shared.notes,
        ];
  return { exchange: shared.exchange, notes };
}

/**
 * {@link assertClean} plus the LLM rule: no header outside
 * {@link LLM_HEADER_ALLOW} may be written.
 *
 * @param scenario - for the message
 * @param exchange - the redacted exchange
 * @param text - its JSON, exactly as it will be written
 * @param deny - the deny-list
 * @throws Error naming what matched, never quoting it
 */
export function assertCleanLlmFixture(
  scenario: string,
  exchange: RecordedExchange,
  text: string,
  deny: readonly string[],
): void {
  const stray = Object.keys(exchange.headers).filter(
    (name) => !llmHeaderAllowed(name),
  );
  if (stray.length > 0) {
    throw new Error(
      `Refusing to write fixture "${scenario}": header(s) ${stray.join(", ")} ` +
        `are not on the LLM allow-list (docs/13 §3.2).`,
    );
  }
  assertClean(scenario, text, deny);
}

/**
 * `text` with every deny-list value and every credential shape removed: what
 * the LLM path prints, so nothing it writes to a terminal can carry a key.
 */
function scrubForPrinting(text: string, deny: readonly string[]): string {
  let out = text;
  for (const literal of deny) {
    if (literal !== "") out = out.split(literal).join(SECRET_PLACEHOLDER);
  }
  return redact(out);
}

// --- The run -----------------------------------------------------------------

/** Exit code: stopped at the spend gate, nothing sent (`docs/13` §3.4). */
export const LLM_EXIT_SPEND_GATE = 3;

/** What {@link runLlmRecorder} reads and writes through; a test passes fakes. */
export interface LlmRunEnvironment {
  /** The process environment; the only place a key is read from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Where fixtures go; {@link llmFixtureDirFor} in the product. */
  readonly fixtureDir: string;
  /**
   * The `Zotero.HTTP` stand-in to send through: `fetch`, paced, in the
   * product; a fake in a test. Called only after every gate has passed.
   */
  readonly transport: () => HttpTransport;
  readonly clock: Clock;
  readonly toolVersion: string;
}

/** One exchange as the capturing transport saw it. */
interface CapturedLlmExchange {
  readonly scenario: string;
  readonly page: number;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A CRLF header block as a lower-cased record. */
function parseHeaderBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    out[name] = name in out ? `${String(out[name])}, ${value}` : value;
  }
  return out;
}

/** `base`, remembering every answer it resolves with. */
function capturingTransport(
  base: HttpTransport,
  onAnswer: (method: string, url: string, xhr: HttpTransportXhr) => void,
): HttpTransport {
  return {
    UnexpectedStatusException: base.UnexpectedStatusException,
    TimeoutException: base.TimeoutException,
    BrowserOfflineException: base.BrowserOfflineException,
    SecurityException: base.SecurityException,
    CancelledException: base.CancelledException,
    async request(method, url, options): Promise<HttpTransportXhr> {
      const xhr = await base.request(method, url, options);
      onAnswer(method, url, xhr);
      return xhr;
    },
  };
}

const NO_USAGE: Usage = Object.freeze({
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
  costUsd: undefined,
});

/** The dry run's and the gate's account of the spend. */
function statementText(
  statement: LlmSpendStatement,
  only: readonly string[] | undefined,
): string {
  const p = statement.prices;
  const rows = statement.scenarios
    .map(
      (b) =>
        `  ${b.scenario.padEnd(26)}${b.recording.padEnd(11)}` +
        `${(b.billed ? "yes" : "no").padEnd(8)}` +
        `${String(b.inputTokens).padStart(7)}  ${String(b.outputTokens).padStart(7)}  ` +
        `${b.billed ? usdUp(b.costUsd) : "$0"}\n`,
    )
    .join("");
  const onlyFlag = only === undefined ? "" : ` --only ${only.join(",")}`;
  return (
    `Model: ${statement.model}, ${statement.provider}'s cheapest priced model ` +
    `unless --model named it.\n` +
    `Prices: $${String(p.inputPerMTokUsd)} in / $${String(p.outputPerMTokUsd)} ` +
    `out per 1M tokens, ${p.source}, as of ${statement.pricesAsOf}. ` +
    `Check them before approving (gate G-18).\n\n` +
    `  ${"scenario".padEnd(26)}${"recording".padEnd(11)}${"billed".padEnd(8)}` +
    `${"input<=".padStart(7)}  ${"output<=".padStart(7)}  cost<=\n` +
    rows +
    `\nStated spend (an upper bound, never an expectation): ` +
    `${String(statement.requests)} live request(s), ` +
    `${String(statement.billedCalls)} billed, at most ` +
    `${String(statement.inputTokens)} input + ${String(statement.outputTokens)} ` +
    `output tokens, at most ${usdUp(statement.costUsd)}.\n` +
    `To record (the owner only, docs/13 §3.4), with ${LLM_KEY_ENV_VARS[statement.provider]} ` +
    `set in this shell for this session only:\n` +
    `  FIXTURE_MODE=record npm run fixtures:record -- --source ${statement.provider}` +
    `${onlyFlag} --live --confirm-spend-usd ${usdUp(statement.costUsd).slice(1)}\n`
  );
}

/**
 * The LLM path of `npm run fixtures:record -- --source <provider>`.
 *
 * - **dry run** (the default): prints the scenario list and the stated spend.
 *   Reads no key and sends nothing.
 * - **synthetic**: writes the four synthetic fixtures. No key, no network.
 * - **record**: refused without `--live` (exit 2) or without the key in the
 *   environment (exit 2); prints the stated spend and stops with nothing sent
 *   without `--confirm-spend-usd` ({@link LLM_EXIT_SPEND_GATE}); refused when
 *   the confirmed amount is below the stated spend (exit 2). Then: the model
 *   list (free) and a stop if the model is absent; each selected live scenario
 *   once, never retried, each billed one reserved against a budget guard
 *   whose ceiling is the confirmed amount; every exchange redacted and checked
 *   before **any** file is written (exit 1 and nothing written on a failure).
 *
 * @param cli - the parsed options; `source` is an LLM provider
 * @param mode - dry run, synthetic or record
 * @param run - the environment, streams, directory, transport and clock
 * @returns the exit code
 */
export async function runLlmRecorder(
  cli: CliOptions & { readonly source: LlmRecordableProvider },
  mode: Mode,
  run: LlmRunEnvironment,
): Promise<number> {
  const provider = cli.source;
  let scenarios: readonly LlmScenario[];
  let statement: LlmSpendStatement;
  try {
    if (cli.rescrub === true) {
      throw new UsageError("--rescrub is for the literature sources only.");
    }
    scenarios = selectLlmScenarios(cli.only);
    const chosen = chooseLlmModel(
      provider,
      llmPriceSource(),
      run.clock.now(),
      cli.model,
    );
    statement = stateLlmSpend(
      provider,
      chosen.model,
      chosen.prices,
      scenarios,
      run.clock.now(),
    );
  } catch (error) {
    if (error instanceof UsageError) {
      run.stderr(`fixtures:record: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (mode === "dry-run") {
    run.stdout(
      `fixtures:record — dry run for ${provider} (LLM). Nothing was ` +
        `requested, no key was read and nothing was written.\n` +
        `LLM scenario list version ${String(LLM_SCENARIO_VERSION)}; ` +
        `${String(scenarios.length)} scenario(s), fixtures in ` +
        `test/fixtures/llm/${provider}/.\n` +
        statementText(statement, cli.only),
    );
    return 0;
  }

  const base = literalDenyList(run.env);

  if (mode === "synthetic") {
    await mkdir(run.fixtureDir, { recursive: true });
    const staged = scenarios
      .filter((s) => s.recording === "synthetic")
      .map((s) => {
        const fixture = syntheticLlmFixture(provider, s);
        const meta: LlmFixtureMeta = {
          scenario: s.scenario,
          scenarioVersion: LLM_SCENARIO_VERSION,
          recordedAt: new Date(run.clock.now()).toISOString(),
          endpoint: fixture.endpoint,
          method: fixture.method,
          toolVersion: run.toolVersion,
          synthetic: true,
          syntheticReason: fixture.reason,
          redactions: ["synthetic: nothing was received, nothing to redact"],
          provider,
          page: 1,
        };
        return stageLlmFixture(s.scenario, fixture.exchange, meta, base);
      });
    for (const file of staged) await writeStaged(run.fixtureDir, file);
    run.stdout(
      staged.map((f) => `  ${f.key}  (synthetic)\n`).join("") +
        `Wrote ${String(staged.length)} synthetic fixtures to ` +
        `test/fixtures/llm/${provider}/. Zero requests, no key read.\n`,
    );
    return 0;
  }

  // --- record: the gates, in order, before anything is sent -----------------
  if (cli.live !== true) {
    run.stderr(
      `fixtures:record: recording ${provider} spends money against a real ` +
        `key, so FIXTURE_MODE=record needs --live as well. Nothing was sent. ` +
        `See docs/13 §3.4.\n`,
    );
    return 2;
  }
  const key = llmKeyFromEnvironment(provider, run.env);
  if (key === undefined) {
    run.stderr(
      `fixtures:record: ${LLM_KEY_ENV_VARS[provider]} is not set in this ` +
        `shell. Set it for this session only; the recorder reads a key from ` +
        `the environment and from nowhere else. Nothing was sent.\n`,
    );
    return 2;
  }
  const invalidKey = invalidLlmKey(provider);
  const deny = [...new Set([...base, key, invalidKey])].sort(
    (a, b) => b.length - a.length,
  );
  const out = (text: string): void => {
    run.stdout(scrubForPrinting(text, deny));
  };
  const err = (text: string): void => {
    run.stderr(scrubForPrinting(text, deny));
  };

  out(
    `fixtures:record — LIVE recording for ${provider}.\n` +
      statementText(statement, cli.only),
  );
  const confirmed = cli.confirmSpendUsd;
  if (confirmed === undefined) {
    out(
      `\nStopped at the spend gate: nothing was sent. To approve the stated ` +
        `spend, run the command above (it adds --confirm-spend-usd).\n`,
    );
    return LLM_EXIT_SPEND_GATE;
  }
  if (!(confirmed >= statement.costUsd)) {
    err(
      `fixtures:record: --confirm-spend-usd ${String(confirmed)} is below the ` +
        `stated spend of ${usdUp(statement.costUsd)}. Nothing was sent.\n`,
    );
    return 2;
  }

  // --- record: sending --------------------------------------------------------
  const captured: CapturedLlmExchange[] = [];
  let current: string | undefined;
  let page = 0;
  const transport = capturingTransport(run.transport(), (method, url, xhr) => {
    if (current === undefined) return;
    page += 1;
    let body: string;
    try {
      body = xhr.responseText ?? "";
    } catch {
      body = ""; // `responseText` throws for a non-text responseType
    }
    captured.push({
      scenario: current,
      page,
      method,
      url,
      status: xhr.status,
      headers: parseHeaderBlock(xhr.getAllResponseHeaders()),
      body,
    });
  });
  const http = createHttpClient({
    transport,
    userAgent: buildUserAgent(run.toolVersion),
    clock: run.clock,
  });
  const valid: LlmAdapterDeps = {
    http,
    secrets: singleKeyStore(provider, key),
    clock: run.clock,
  };
  const invalid: LlmAdapterDeps = {
    http,
    secrets: singleKeyStore(provider, invalidKey),
    clock: run.clock,
  };
  const adapter = createLlmAdapter(provider, valid);
  const wrongKeyAdapter = createLlmAdapter(provider, invalid);
  const guard = createBudgetGuard({
    session: createSessionSpendCounter(),
    limits: { run: () => confirmed * 100, session: () => 0 },
    prices: statement.prices,
    now: () => run.clock.now(),
  });
  const token = createCancellationTokenSource().token;
  const notes: string[] = [];
  const failures: string[] = [];
  const begin = (scenario: string): void => {
    current = scenario;
    page = 0;
  };

  // The model list first, always: it is free, and it is the check that the
  // model the spend was stated for exists before anything is billed.
  begin("models-list");
  let listed: readonly ModelInfo[];
  try {
    listed = await adapter.listModels({ token });
  } catch (error) {
    err(
      `fixtures:record: the model list failed (${describe(error)}). Nothing ` +
        `billed was sent and nothing was written.\n`,
    );
    return 1;
  }
  if (!listed.some((m) => m.id === statement.model)) {
    const priced = listed
      .map((m) => m.id)
      .filter((id) => llmPriceSource().pricesFor(provider, id) !== undefined)
      .sort();
    err(
      `fixtures:record: ${provider} does not list "${statement.model}". ` +
        `Nothing billed was sent and nothing was written. Listed and priced: ` +
        `${priced.length === 0 ? "(none)" : priced.join(", ")}. Re-run the dry ` +
        `run with --model <id> to state the spend for one of them.\n`,
    );
    return 1;
  }

  for (const s of scenarios) {
    if (s.recording !== "live" || s.kind === "list-models") continue;
    const bound = statement.scenarios.find((b) => b.scenario === s.scenario);
    begin(s.scenario);
    let reservation: BudgetReservation | undefined;
    if (s.billed && bound !== undefined) {
      try {
        reservation = guard.reserveCall({
          inputTokens: bound.inputTokens,
          outputTokens: bound.outputTokens,
          costUsd: bound.costUsd,
          prices: statement.prices,
        });
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
        failures.push(
          `${s.scenario}: not sent — the confirmed ceiling of ` +
            `${usdUp(confirmed)} would be passed (spent so far ` +
            `${usdUp(guard.spentUsd)}). Nothing after it was sent.`,
        );
        break;
      }
    }
    const target = s.key === "synthetic-invalid" ? wrongKeyAdapter : adapter;
    const request = llmScenarioRequest(s.scenario, statement.model);
    try {
      if (s.kind === "chat-stream") {
        const stream = target.chatStream?.(request, { token });
        if (stream === undefined)
          throw new Error("the adapter has no chatStream");
        let usage: Usage | undefined;
        for await (const chunk of stream) {
          if (chunk.usage !== undefined) usage = chunk.usage;
        }
        reservation?.settle(usage ?? NO_USAGE);
      } else {
        const answer = await target.chat(request, { token });
        reservation?.settle(answer.usage);
      }
      if (s.scenario === "error-401") {
        failures.push("error-401: the invalid key was accepted");
      }
    } catch (error) {
      // A billed call that failed is counted at its bound, never at zero.
      reservation?.settle(NO_USAGE);
      notes.push(`${s.scenario}: the adapter answered ${describe(error)}`);
    }
    if (!captured.some((c) => c.scenario === s.scenario)) {
      failures.push(`${s.scenario}: nothing was captured`);
    }
  }
  current = undefined;

  // --- record: redact and check everything, then write ----------------------
  const selected = new Set(scenarios.map((s) => s.scenario));
  let staged: StagedLlmFixture[];
  try {
    staged = captured
      .filter((c) => selected.has(c.scenario))
      .map((c) => {
        const { exchange, notes: redactions } = redactLlmExchange(c, deny);
        const u = new URL(c.url);
        const meta: LlmFixtureMeta = {
          scenario: c.scenario,
          scenarioVersion: LLM_SCENARIO_VERSION,
          recordedAt: new Date(run.clock.now()).toISOString(),
          endpoint: `${u.origin}${u.pathname}`,
          method: c.method,
          toolVersion: run.toolVersion,
          synthetic: false,
          redactions,
          provider,
          model: statement.model,
          page: c.page,
        };
        return stageLlmFixture(
          llmFixtureKey(c.scenario, c.page),
          exchange,
          meta,
          deny,
        );
      });
  } catch (error) {
    err(
      `fixtures:record: ${describe(error)}\nNothing was written: one ` +
        `exchange failed the redaction check, so none is kept.\n`,
    );
    return 1;
  }
  await mkdir(run.fixtureDir, { recursive: true });
  for (const file of staged) await writeStaged(run.fixtureDir, file);

  const spent = guard.usage().run;
  out(
    staged
      .map(
        (f) => `  ${f.key}  status=${String(f.status)} ${String(f.bytes)}B\n`,
      )
      .join("") +
      notes.map((n) => `  note: ${n}\n`).join("") +
      `\n${String(captured.length)} request(s) answered; ${String(staged.length)} ` +
      `fixture(s) written to test/fixtures/llm/${provider}/.\n` +
      `Spent, from the tokens the answers reported: ${usdUp(spent.costUsd)} over ` +
      `${String(spent.calls)} billed call(s)` +
      `${spent.estimatedCalls > 0 ? ` (${String(spent.estimatedCalls)} counted at their bound)` : ""}; ` +
      `stated ${usdUp(statement.costUsd)}.\n`,
  );
  if (failures.length > 0) {
    err(
      `${String(failures.length)} scenario(s) failed:\n  ${failures.join("\n  ")}\n`,
    );
    return 1;
  }
  return 0;
}

/** One fixture and its sidecar, checked and serialised, not yet written. */
interface StagedLlmFixture {
  readonly key: string;
  readonly status: number;
  readonly bytes: number;
  readonly fixtureText: string;
  readonly metaText: string;
}

/** Serialise and check one fixture and its sidecar; throws, writing nothing, when either is not clean. */
function stageLlmFixture(
  key: string,
  exchange: RecordedExchange,
  meta: LlmFixtureMeta,
  deny: readonly string[],
): StagedLlmFixture {
  const fixtureText = toJson(exchange);
  assertCleanLlmFixture(meta.scenario, exchange, fixtureText, deny);
  const metaText = toJson(meta);
  assertClean(`${meta.scenario} (metadata)`, metaText, deny);
  return {
    key,
    status: exchange.status,
    bytes: exchange.body.length,
    fixtureText,
    metaText,
  };
}

/** Write one staged fixture and its sidecar. */
async function writeStaged(dir: string, file: StagedLlmFixture): Promise<void> {
  await writeFile(`${dir}/${file.key}.json`, file.fixtureText, "utf8");
  await writeFile(`${dir}/${file.key}${META_SUFFIX}`, file.metaText, "utf8");
}

// ---------------------------------------------------------------------------
// 9. main
// ---------------------------------------------------------------------------

/** `FIXTURE_MODE`, as `docs/13` §2.2 spells it. */
export type Mode = "record" | "synthetic" | "dry-run";

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
  const source = cli.source;
  if (isLlmRecordableProvider(source)) {
    // `P3-T30`: the LLM path, with its own gates (`runLlmRecorder`).
    return runLlmRecorder({ ...cli, source }, mode, {
      env: process.env,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      fixtureDir: llmFixtureDirFor(source),
      transport: () =>
        createFetchTransport(spacingMsFor(LLM_HOSTS[source]), () => undefined),
      clock: createSystemClock(),
      toolVersion: await toolVersion(),
    });
  }
  const plan = planFor(source);
  const deny = literalDenyList();
  const version = await toolVersion();
  const spacingMs = spacingMsFor(plan.host);
  const fromDisk = committedAnswer(plan.fixtureDir);

  let independent: readonly PlannedRequest[];
  try {
    independent = selectScenarios(plan.independent(), cli.only);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`fixtures:record: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  if (cli.only !== undefined) {
    process.stderr.write(
      `--only: ${String(independent.length)} of ` +
        `${String(plan.independent().length)} independent scenarios selected.\n`,
    );
  }
  if (cli.rescrub === true && !cli.dryRun) {
    const result = await rescrubFixtures(
      plan,
      deny,
      new Date().toISOString().slice(0, 10),
    );
    process.stdout.write(
      `fixtures:record — re-scrub of test/fixtures/${plan.source}/. Zero ` +
        `live requests. ${String(result.read)} fixtures read, ` +
        `${String(result.changed.length)} rewritten, ` +
        `${String(result.addresses)} email address(es) replaced.\n` +
        result.changed.map((k) => `  ${k}\n`).join(""),
    );
    return 0;
  }

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
          headers: {
            "Content-Type":
              p.contentType ?? "application/x-www-form-urlencoded",
          },
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

/**
 * `scripts/bench-search.ts` — `docs/10` NFR-2, measured (`P2-T16` step 4).
 *
 * NFR-2: "A 4-source search returning ≤ 100 results per source shall complete
 * in **≤ 30 seconds** wall-clock under normal network conditions, including
 * API latency, with per-source timeouts of 20 s". This script runs the
 * **shipped** search pipeline — `createSearchImportPipeline`, its `fanOut`
 * under the `network-metadata` pool, the four shipped adapters and mappers,
 * the shipped HTTP client with `docs/07` §7.3's retry policy, and §7.3's
 * **real** per-host token buckets on the system clock — over a replay
 * transport that waits a modelled per-host latency before every answer. It
 * prints the wall clock and exits 1 if it exceeds 30 s.
 *
 * ```sh
 * npm run bench:search
 * ```
 *
 * ## No network, by construction
 *
 * Every answer comes from {@link createMultiHostReplayTransport}; no `fetch`,
 * no `Zotero.HTTP`, and the global `fetch` is replaced by a function that
 * throws before anything else runs. A request the model below does not answer
 * fails the run.
 *
 * ## The search
 *
 * `DEDUP_CORPUS_Q3` ("large language model clinical", 2024), the one corpus
 * query recorded with results from all four sources measured here: PubMed,
 * Europe PMC, Crossref and arXiv. Semantic Scholar is not one of the four: its
 * recordings of the corpus queries are 429 answers
 * (`DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR`). arXiv is included on purpose — its
 * three-second minimum spacing and single connection (`docs/07` §7.3) make it
 * the slowest of the four, and the real bucket enforces both.
 *
 * ## The bodies: the recorded answers, widened to 100 records
 *
 * No answer was ever recorded at 100 records a source, and `P2-T16` records
 * nothing. So each 100-record answer is built **in memory** from the committed
 * `corpus-q3` answer of that source: the 25 recorded records, then copies of
 * them renumbered so every record is distinct (a fresh PMID, DOI, arXiv id and
 * a title marked "bench copy N"). Nothing is written to disk. The parsers and
 * mappers therefore read real-shaped records at the real per-record size, four
 * times over. The Europe PMC abstract lookup that the backfill step sends after
 * the merge is answered with an empty result list, so the step costs its round
 * trip and finds nothing.
 *
 * ## The latency model, and where each number comes from
 *
 * **The committed sidecars do not record latency.** A `_meta.json` holds
 * `recordedAt`, written after the whole recording finished — measured
 * 2026-10-20: consecutive sidecars of one host are 0–20 ms apart, whatever the
 * request. What the fixtures do record is each response's `date` header, the
 * server's clock at one-second resolution. The recorder sends one host's
 * requests one after another, so the gap between two consecutive responses of
 * one host bounds the second request's round trip **from above**: it also
 * holds the recorder's own pacing wait and parse time. So, per host:
 *
 *   latency bound = the largest gap between consecutive real recordings of that
 *   host that are at most {@link SESSION_GAP_S} s apart, **plus one second**
 *   for the header's resolution.
 *
 * Measured from the committed fixtures by {@link measureLatencyBounds} each
 * run, and printed. On 2026-10-20 that gave PubMed, Europe PMC and Crossref
 * 3 s and arXiv 8 s (arXiv's `corpus-q3` came 7 s after `corpus-q2`; its
 * `x-timer` header says the server spent 3.6 s on it, so 8 s is pessimistic).
 *
 * Every answer then waits that bound **plus** its body's transfer time at
 * {@link ASSUMED_THROUGHPUT_BYTES_PER_S} — an assumption, not a measurement,
 * and deliberately counted on top of a bound that already includes the
 * recorded transfer. The model is pessimistic in both terms on purpose: a pass
 * under it is a pass under "normal network conditions".
 *
 * ## The bench checks that it measured something
 *
 * A replay that answers instantly proves nothing about a 30-second budget
 * (`P2-T16`'s **Do NOT**). So the run fails — exit 1 — unless every request
 * actually waited at least {@link MIN_MODELLED_WAIT_MS} (the date header's
 * resolution, the smallest bound the model can produce), and unless each of
 * the four sources returned exactly 100 records without an error.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSystemClock, type Clock } from "../src/core/clock";
import { Semaphore } from "../src/core/concurrency";
import { CompositeProgressReporter } from "../src/core/jobQueue/progress";
import { createCancellationTokenSource } from "../src/core/jobQueue/cancellation";
import { createLogger, NULL_LOG_SINK } from "../src/core/logger";
import {
  ARXIV_HOST,
  CROSSREF_HOST,
  createHostLimiterRegistry,
  EBI_HOST,
  NCBI_HOST,
} from "../src/core/rateLimit/hostLimiter";
import type { SourceId } from "../src/model/ids";
import { createSearchImportPipeline } from "../src/pipeline/searchImport/searchImportPipeline";
import {
  NETWORK_METADATA_POOL_SIZE,
  PER_SOURCE_TIMEOUT_MS,
} from "../src/pipeline/searchImport/stages";
import type { SearchImportWriter } from "../src/pipeline/searchImport/types";
import type { PipelineContext } from "../src/pipeline/types";
import { createArxivSource } from "../src/sources/arxiv/arxivSource";
import { createArxivRecordMapper } from "../src/sources/arxiv/mapper";
import { createCrossrefSource } from "../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../src/sources/crossref/mapper";
import { createEuropePmcSource } from "../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../src/sources/europepmc/mapper";
import { createPubmedRecordMapper } from "../src/sources/pubmed/mapper";
import { createPubmedSource } from "../src/sources/pubmed/pubmedSource";
import { createSourceRegistry } from "../src/sources/registry";
import { toPipelineInput } from "../src/ui/viewModels/searchImportViewModel";
import { mockLLMRouter } from "../test/helpers/mockLLM";
import { DEDUP_CORPUS_Q3 } from "../test/support/dedupCorpusRecordedRequests";
import { nodeFixtureIo } from "../test/support/fixtureIoNode";
import {
  createMultiHostReplayHttpClient,
  listFixtureMeta,
  readScenarioExchange,
  type RecordedExchange,
} from "../test/support/fixtureReplay";
import { parseXmlInNode } from "./build-dedup-corpus";

// ---------------------------------------------------------------------------
// 1. The figures
// ---------------------------------------------------------------------------

/** `docs/10` NFR-2's budget. Never relaxed to make the bench pass (rule 6). */
export const NFR2_BUDGET_MS = 30_000;

/** NFR-2's per-source result count and its source count. */
export const RESULTS_PER_SOURCE = 100;
const SOURCES: readonly SourceId[] = [
  "pubmed",
  "europepmc",
  "crossref",
  "arxiv",
];

/** Consecutive same-host recordings further apart than this are two sessions. */
export const SESSION_GAP_S = 15;

/** The `date` header's resolution, added to every measured gap. */
export const DATE_RESOLUTION_MS = 1_000;

/**
 * Assumed transfer rate for the body, on top of the round-trip bound: 2 MB/s
 * (16 Mbit/s). **An assumption** — no committed file records throughput.
 */
export const ASSUMED_THROUGHPUT_BYTES_PER_S = 2_000_000;

/** The least any modelled answer may wait: one `date`-header resolution. */
export const MIN_MODELLED_WAIT_MS = DATE_RESOLUTION_MS;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(ROOT, "test", "fixtures");

/** The four hosts and their fixture directories. */
const HOSTS: readonly { host: string; dir: string; source: SourceId }[] = [
  { host: NCBI_HOST, dir: resolve(FIXTURES, "pubmed"), source: "pubmed" },
  { host: EBI_HOST, dir: resolve(FIXTURES, "europepmc"), source: "europepmc" },
  {
    host: CROSSREF_HOST,
    dir: resolve(FIXTURES, "crossref"),
    source: "crossref",
  },
  { host: ARXIV_HOST, dir: resolve(FIXTURES, "arxiv"), source: "arxiv" },
];

// ---------------------------------------------------------------------------
// 2. The latency model, measured from the committed fixtures
// ---------------------------------------------------------------------------

/** One host's bound, with the evidence it came from. */
export interface LatencyBound {
  readonly host: string;
  readonly boundMs: number;
  /** The two scenarios whose response `date` headers gave the largest gap. */
  readonly evidence: string;
  readonly recordings: number;
}

/**
 * {@link LatencyBound} for each host, from its committed real recordings'
 * response `date` headers; see the file header.
 *
 * @returns one bound per host in {@link HOSTS}
 */
export async function measureLatencyBounds(): Promise<readonly LatencyBound[]> {
  const out: LatencyBound[] = [];
  for (const { host, dir } of HOSTS) {
    const stamped: { scenario: string; at: number }[] = [];
    for (const { key, meta } of await listFixtureMeta(dir, nodeFixtureIo)) {
      if (meta.synthetic) continue;
      const exchange = JSON.parse(
        await readFile(resolve(dir, `${key}.json`), "utf8"),
      ) as RecordedExchange;
      const at = Date.parse(exchange.headers["date"] ?? "");
      if (!Number.isNaN(at)) stamped.push({ scenario: meta.scenario, at });
    }
    stamped.sort((a, b) => a.at - b.at);
    let largest = 0;
    let evidence = "(no consecutive recordings)";
    for (let i = 1; i < stamped.length; i += 1) {
      const before = stamped[i - 1];
      const after = stamped[i];
      if (before === undefined || after === undefined) continue;
      const gap = after.at - before.at;
      if (gap <= SESSION_GAP_S * 1000 && gap >= largest) {
        largest = gap;
        evidence = `${before.scenario} → ${after.scenario}, ${String(gap / 1000)} s`;
      }
    }
    out.push({
      host,
      boundMs: largest + DATE_RESOLUTION_MS,
      evidence,
      recordings: stamped.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. The bodies: the recorded corpus-q3 answers, widened in memory
// ---------------------------------------------------------------------------

/** A fresh, distinct identifier stem for copy `n` of record `i`. */
function copyTag(n: number, i: number): string {
  return `bench${String(n)}x${String(i)}`;
}

/** The recorded `corpus-q3` answers this bench widens. */
interface Templates {
  readonly esearch: RecordedExchange;
  readonly efetchArticles: readonly string[];
  readonly efetchHead: string;
  readonly epmc: RecordedExchange;
  readonly crossref: RecordedExchange;
  readonly arxivHead: string;
  readonly arxivEntries: readonly string[];
  readonly arxiv: RecordedExchange;
}

async function loadTemplates(): Promise<Templates> {
  const dirOf = (source: SourceId): string =>
    HOSTS.find((row) => row.source === source)?.dir ?? "";
  const esearch = await readScenarioExchange(
    dirOf("pubmed"),
    `${DEDUP_CORPUS_Q3.scenario}-esearch`,
    nodeFixtureIo,
  );
  const efetch = await readScenarioExchange(
    dirOf("pubmed"),
    `${DEDUP_CORPUS_Q3.scenario}-efetch`,
    nodeFixtureIo,
  );
  const arxiv = await readScenarioExchange(
    dirOf("arxiv"),
    DEDUP_CORPUS_Q3.scenario,
    nodeFixtureIo,
  );
  const efetchArticles = efetch.body.match(
    /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gu,
  );
  const arxivEntries = arxiv.body.match(/<entry>[\s\S]*?<\/entry>/gu);
  if (efetchArticles === null || arxivEntries === null) {
    throw new Error("the committed corpus-q3 answers hold no records");
  }
  return {
    esearch,
    efetchArticles,
    efetchHead: efetch.body.slice(0, efetch.body.indexOf("<PubmedArticle>")),
    epmc: await readScenarioExchange(
      dirOf("europepmc"),
      DEDUP_CORPUS_Q3.scenario,
      nodeFixtureIo,
    ),
    crossref: await readScenarioExchange(
      dirOf("crossref"),
      DEDUP_CORPUS_Q3.scenario,
      nodeFixtureIo,
    ),
    arxivHead: arxiv.body.slice(0, arxiv.body.indexOf("<entry>")),
    arxivEntries,
    arxiv,
  };
}

/** `count` items from `templates`, copy `n ≥ 1` of each renamed by `rename`. */
function widen<T>(
  templates: readonly T[],
  count: number,
  rename: (template: T, n: number, i: number) => T,
): T[] {
  const out: T[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = k % templates.length;
    const n = Math.floor(k / templates.length);
    const template = templates[i];
    if (template === undefined) throw new Error("no template");
    out.push(n === 0 ? template : rename(template, n, i));
  }
  return out;
}

/** The request's query parameters, from the URL and, on a POST, the body. */
function paramsOf(request: { url: string; body?: string }): URLSearchParams {
  const params = new URL(request.url).searchParams;
  if (request.body !== undefined) {
    for (const [name, value] of new URLSearchParams(request.body)) {
      params.append(name, value);
    }
  }
  return params;
}

function ok(template: RecordedExchange, body: string): RecordedExchange {
  return { status: 200, headers: template.headers, body };
}

/**
 * The 100-record answer to one request, or `undefined` for a request the
 * model does not know — which then fails as a missing fixture.
 */
function widenedAnswer(
  t: Templates,
  host: string,
  request: { url: string; body?: string },
): RecordedExchange | undefined {
  const url = new URL(request.url);
  const params = paramsOf(request);
  if (host === NCBI_HOST && url.pathname.endsWith("esearch.fcgi")) {
    const json = JSON.parse(t.esearch.body) as {
      esearchresult: { idlist: string[]; retmax: string };
    };
    const want = Number(params.get("retmax") ?? RESULTS_PER_SOURCE);
    json.esearchresult.idlist = widen(
      json.esearchresult.idlist,
      want,
      (_id, n, i) => String(90_000_000 + n * 1000 + i),
    );
    json.esearchresult.retmax = String(want);
    return ok(t.esearch, JSON.stringify(json));
  }
  if (host === NCBI_HOST && url.pathname.endsWith("efetch.fcgi")) {
    const ids = (params.get("id") ?? "").split(",").filter((id) => id !== "");
    const articles = ids.map((id, k) => {
      const i = k % t.efetchArticles.length;
      const n = Math.floor(k / t.efetchArticles.length);
      const article = t.efetchArticles[i] ?? "";
      if (n === 0) return article;
      return article
        .replace(
          /<PMID Version="1">\d+<\/PMID>/u,
          `<PMID Version="1">${id}</PMID>`,
        )
        .replace(
          /<ArticleId IdType="pubmed">\d+<\/ArticleId>/u,
          `<ArticleId IdType="pubmed">${id}</ArticleId>`,
        )
        .replace(
          /(<ArticleId IdType="doi">)([^<]+)(<\/ArticleId>)/gu,
          `$1$2.${copyTag(n, i)}$3`,
        )
        .replace(
          /(<ELocationID EIdType="doi"[^>]*>)([^<]+)(<\/ELocationID>)/gu,
          `$1$2.${copyTag(n, i)}$3`,
        )
        .replace(/<ArticleTitle>/u, `<ArticleTitle>(bench copy ${String(n)}) `);
    });
    return ok(
      t.esearch,
      `${t.efetchHead}${articles.join("\n")}\n</PubmedArticleSet>\n`,
    );
  }
  if (host === EBI_HOST) {
    const query = params.get("query") ?? "";
    const json = JSON.parse(t.epmc.body) as {
      hitCount: number;
      resultList: { result: Record<string, unknown>[] };
      nextCursorMark?: string;
    };
    if (query.includes("DOI:")) {
      // The backfill step's batched DOI lookup: a round trip that finds nothing.
      json.hitCount = 0;
      json.resultList.result = [];
      delete json.nextCursorMark;
      return ok(t.epmc, JSON.stringify(json));
    }
    const want = Number(params.get("pageSize") ?? RESULTS_PER_SOURCE);
    json.resultList.result = widen(json.resultList.result, want, (r, n, i) => {
      const copy: Record<string, unknown> = { ...r };
      const id = String(91_000_000 + n * 1000 + i);
      copy["id"] = id;
      copy["pmid"] = id;
      copy["source"] = "MED";
      delete copy["pmcid"];
      delete copy["fullTextIdList"];
      if (typeof r["doi"] === "string")
        copy["doi"] = `${r["doi"]}.${copyTag(n, i)}`;
      copy["title"] = `(bench copy ${String(n)}) ${String(r["title"] ?? "")}`;
      return copy;
    });
    return ok(t.epmc, JSON.stringify(json));
  }
  if (host === CROSSREF_HOST) {
    const json = JSON.parse(t.crossref.body) as {
      message: { items: Record<string, unknown>[]; "items-per-page"?: number };
    };
    const want = Number(params.get("rows") ?? RESULTS_PER_SOURCE);
    json.message.items = widen(json.message.items, want, (item, n, i) => {
      const doi = `${String(item["DOI"] ?? "10.5555/x")}.${copyTag(n, i)}`;
      const titles = Array.isArray(item["title"]) ? item["title"] : [""];
      return {
        ...item,
        DOI: doi,
        URL: `https://doi.org/${doi}`,
        title: [`(bench copy ${String(n)}) ${String(titles[0] ?? "")}`],
      };
    });
    json.message["items-per-page"] = want;
    return ok(t.crossref, JSON.stringify(json));
  }
  if (host === ARXIV_HOST) {
    const want = Number(params.get("max_results") ?? RESULTS_PER_SOURCE);
    const entries = widen(t.arxivEntries, want, (entry, n, i) => {
      const id = `2412.${String(90_000 + n * 100 + i).padStart(5, "0")}`;
      return entry
        .replace(/arxiv\.org\/abs\/[^<"]+/gu, `arxiv.org/abs/${id}v1`)
        .replace(/arxiv\.org\/pdf\/[^<"]+/gu, `arxiv.org/pdf/${id}v1`)
        .replace(
          /(<arxiv:doi>)([^<]+)(<\/arxiv:doi>)/gu,
          `$1$2.${copyTag(n, i)}$3`,
        )
        .replace(/<title>/u, `<title>(bench copy ${String(n)}) `);
    });
    const head = t.arxivHead.replace(
      /<opensearch:itemsPerPage>\d+</u,
      `<opensearch:itemsPerPage>${String(want)}<`,
    );
    return ok(t.arxiv, `${head}${entries.join("\n")}\n</feed>\n`);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 4. The run
// ---------------------------------------------------------------------------

/** One answered request, as the bench saw it. */
interface Timed {
  readonly host: string;
  readonly path: string;
  readonly startMs: number;
  readonly modelledMs: number;
  readonly waitedMs: number;
  readonly bytes: number;
}

async function main(): Promise<number> {
  // No network: anything that reaches for `fetch` fails loudly.
  (globalThis as { fetch?: unknown }).fetch = () => {
    throw new Error("bench-search: a live network request was attempted");
  };

  const bounds = await measureLatencyBounds();
  process.stdout.write(
    `NFR-2 bench — ${String(SOURCES.length)} sources × ${String(RESULTS_PER_SOURCE)} ` +
      `results, budget ${String(NFR2_BUDGET_MS / 1000)} s, per-source deadline ` +
      `${String(PER_SOURCE_TIMEOUT_MS / 1000)} s, query "${DEDUP_CORPUS_Q3.text}" (2024)\n` +
      `Latency model (round-trip bound from committed response date headers, ` +
      `+ body at ${String(ASSUMED_THROUGHPUT_BYTES_PER_S / 1e6)} MB/s):\n`,
  );
  for (const bound of bounds) {
    process.stdout.write(
      `  ${bound.host.padEnd(26)} ${String(bound.boundMs).padStart(5)} ms  ` +
        `(${String(bound.recordings)} recordings; largest gap ${bound.evidence})\n`,
    );
  }
  const boundOf = new Map(bounds.map((b) => [b.host, b.boundMs]));
  const templates = await loadTemplates();

  const clock: Clock = createSystemClock();
  const limiters = createHostLimiterRegistry({ clock });
  const timed: Timed[] = [];
  const answers = new Map<string, RecordedExchange | undefined>();
  const keyOf = (
    host: string,
    r: { method: string; url: string; body?: string },
  ) => `${host} ${r.method} ${r.url} ${r.body ?? ""}`;
  let started = 0;

  const replay = createMultiHostReplayHttpClient({
    routes: HOSTS.map(({ host, dir }) => ({ host, dirs: [dir] })),
    io: nodeFixtureIo,
    clock,
    limiterFor: (host) => limiters.limiterFor(host),
    answerFor: (host, request) => answers.get(keyOf(host, request)),
    latency: async (host, request) => {
      const answer = widenedAnswer(templates, host, request);
      answers.set(keyOf(host, request), answer);
      const bytes = answer?.body.length ?? 0;
      const modelledMs =
        (boundOf.get(host) ?? 0) +
        Math.round((bytes / ASSUMED_THROUGHPUT_BYTES_PER_S) * 1000);
      const before = performance.now();
      await clock.sleep(modelledMs);
      timed.push({
        host,
        path: new URL(request.url).pathname.split("/").pop() ?? "",
        startMs: Math.round(before - started),
        modelledMs,
        waitedMs: Math.round(performance.now() - before),
        bytes,
      });
    },
  });

  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const keepRaw = false;
  const http = replay.client;
  const sources = createSourceRegistry();
  sources.register(
    createPubmedSource({
      http,
      clock,
      mapRecords: createPubmedRecordMapper({
        clock,
        keepRaw,
        logger,
        parseXml: parseXmlInNode,
      }),
      logger,
    }),
  );
  sources.register(
    createEuropePmcSource({
      http,
      clock,
      mapRecords: createEuropePmcRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
  );
  sources.register(
    createCrossrefSource({
      http,
      clock,
      mapRecords: createCrossrefRecordMapper({
        clock,
        keepRaw,
        logger,
        parseXml: parseXmlInNode,
      }),
      userContactEmail: () => undefined,
      logger,
    }),
  );
  sources.register(
    createArxivSource({
      http,
      clock,
      parseXml: parseXmlInNode,
      mapRecords: createArxivRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
  );

  // A preview: no target, so the writer is never opened.
  const writer: SearchImportWriter = {
    openTarget: () => Promise.reject(new Error("a preview writes nothing")),
  };
  const pipeline = createSearchImportPipeline({
    writer,
    writeBatchSize: 50,
    pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
  });
  const token = createCancellationTokenSource().token;
  const ctx: PipelineContext = {
    jobId: "bench-search",
    token,
    progress: new CompositeProgressReporter({ clock, token }),
    logger,
    clock,
    sources,
    cache: undefined,
    budget: undefined,
    llm: mockLLMRouter(),
    tts: undefined,
    zotero: undefined,
    config: undefined,
    privacy: undefined,
    checkpoint: () => Promise.resolve(),
    resumeState: undefined,
  };
  // The input the Search & Import window builds for these controls.
  const input = toPipelineInput(
    {
      mode: "keyword",
      keyword: DEDUP_CORPUS_Q3.text,
      fromYear: 2024,
      toYear: 2024,
      maxResults: RESULTS_PER_SOURCE,
      sources: SOURCES,
      filter: "",
      hideExisting: false,
      duplicates: "link",
      collectionID: "",
    },
    undefined,
    undefined,
  );

  started = performance.now();
  const output = await pipeline.run(input, ctx);
  const elapsedMs = Math.round(performance.now() - started);

  process.stdout.write(
    "\nRequests (start offset, modelled wait, measured wait, bytes):\n",
  );
  for (const t of [...timed].sort((a, b) => a.startMs - b.startMs)) {
    process.stdout.write(
      `  +${String(t.startMs).padStart(6)} ms  ${t.host.padEnd(26)} ${t.path.padEnd(13)} ` +
        `model ${String(t.modelledMs).padStart(5)} ms, waited ${String(t.waitedMs).padStart(5)} ms, ` +
        `${String(t.bytes)} B\n`,
    );
  }
  process.stdout.write("\nPer source:\n");
  for (const report of output.perSource) {
    process.stdout.write(
      `  ${report.sourceId.padEnd(10)} ${String(report.recordsRetrieved).padStart(4)} records` +
        `${report.error === undefined ? "" : `, error ${report.error.code}: ${report.error.detail ?? ""}`}\n`,
    );
  }
  process.stdout.write(
    `\nOutcome ${output.outcome}; ${String(output.works.length)} works after the merge; ` +
      `wall clock ${(elapsedMs / 1000).toFixed(2)} s against ${String(NFR2_BUDGET_MS / 1000)} s.\n`,
  );

  const failures: string[] = [];
  if (timed.length === 0 || replay.transport.calls.length !== timed.length) {
    failures.push(
      `the latency model ran for ${String(timed.length)} of ` +
        `${String(replay.transport.calls.length)} requests — a replay that answers ` +
        `instantly proves nothing about NFR-2`,
    );
  }
  for (const t of timed) {
    if (t.waitedMs < MIN_MODELLED_WAIT_MS - 5) {
      failures.push(
        `${t.host} ${t.path} waited ${String(t.waitedMs)} ms, under the ` +
          `${String(MIN_MODELLED_WAIT_MS)} ms floor — the latency model is not in effect`,
      );
    }
  }
  for (const id of SOURCES) {
    const report = output.perSource.find((r) => r.sourceId === id);
    if (
      report?.recordsRetrieved !== RESULTS_PER_SOURCE ||
      report.error !== undefined
    ) {
      failures.push(
        `${id} returned ${String(report?.recordsRetrieved)} records` +
          `${report?.error === undefined ? "" : ` and failed (${report.error.code})`}; ` +
          `NFR-2 is measured at ${String(RESULTS_PER_SOURCE)} a source`,
      );
    }
  }
  if (output.outcome !== "succeeded") {
    failures.push(`the run ended "${output.outcome}", not "succeeded"`);
  }
  if (elapsedMs > NFR2_BUDGET_MS) {
    failures.push(
      `NFR-2 missed: ${(elapsedMs / 1000).toFixed(2)} s > ${String(NFR2_BUDGET_MS / 1000)} s`,
    );
  }
  if (failures.length > 0) {
    process.stderr.write(`\nFAIL\n  ${failures.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write(
    `PASS: NFR-2 met, ${(elapsedMs / 1000).toFixed(2)} s ≤ ${String(NFR2_BUDGET_MS / 1000)} s.\n`,
  );
  return 0;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main();

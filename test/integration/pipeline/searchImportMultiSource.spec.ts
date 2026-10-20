/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state (items, collections, preferences, the add-on manager); there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P2-T16` Part A — Phase 2's end-to-end run, inside a real Zotero, over
 * replayed fixtures.
 *
 * `docs/11` §1's Phase 2 definition of done, the parts this file can prove:
 *
 * - **Step 2.** A full seven-source search in which known cross-indexed papers
 *   appear **exactly once**, every contributing source in the row's chips and
 *   in the merged work's `provenance.seenIn`.
 * - **Step 3.** One source answering 500 and one answering 429: the others
 *   deliver, the run is §12.1's `PartialFetch`, and both failures are status
 *   rows.
 * - **Step 6 (FR-51).** Re-running the same search creates no item and the
 *   summary reports the linked (plain import) or already-present (FR-12
 *   re-run) count, asserted as the shipped message through the bundle.
 * - **Step 7.** The plugin restarts and searches with `sources` excluding
 *   `semanticscholar`, and nothing asks Semantic Scholar.
 *
 * ## Everything runs through the host the plugin published
 *
 * The composition root's own Search & Import host (`api.searchWindow`), its
 * pipeline, writer, library index, provenance note writer and store — driven
 * the way `test/integration/phase1-dod.spec.ts` drives it, with a recording
 * view and no window. The only substitution is the **seven adapters**: each
 * slot of the shipped registry (`api.services.sources`) is swapped with
 * `replaceForTest` for the same shipped adapter and mapper, built over one
 * replay client ({@link createMultiHostReplayHttpClient}) instead of
 * `Zotero.HTTP`. The displaced adapters are put back in `after()`.
 *
 * ## No network, and no recording
 *
 * The replay client has no transport but the committed fixture directories. A
 * request no fixture holds fails as "Missing fixture … Record it with", which
 * the pipeline records as that source's failure — never a live call
 * (`docs/13` §2.2, §4). Before any search, {@link assertAllSlotsReplayed}
 * fails the test unless all seven slots hold this file's adapters. Strategy B
 * stays off (`useTranslators` is asserted `false`), and the suite-wide guard
 * in `_suite-guards.spec.ts` refuses any real `Zotero.Translate.Search`.
 *
 * ## Which committed queries, and why
 *
 * The searches are `P2-T13`'s corpus queries, recorded across sources with one
 * text each (`DEDUP_CORPUS_SEARCHES`):
 *
 * - **`corpus-q3`** ("large language model clinical", 2024) for steps 2, 6
 *   and 7: PubMed, Europe PMC, Crossref and arXiv each hold a 25-record
 *   answer. Semantic Scholar holds none — its corpus searches after `corpus-q1`
 *   were never sent (`DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR`) — so in step 2
 *   it fails on the missing fixture.
 * - **`corpus-q1`** ("CRISPR base editing", 2023) for step 3: PubMed, Europe
 *   PMC and Crossref answer, Semantic Scholar's committed answer is the
 *   **real** 429 recorded on 2026-10-16, and arXiv is made to answer its own
 *   committed `error-500` exchange for every request
 *   ({@link MultiHostReplayOptions.answerFor}). Q1 has no arXiv recording, so
 *   no recorded answer is hidden by the seam.
 *
 * **Measured 2026-10-20, and the reason step 2's papers have two sources, not
 * three.** No committed query was answered with the same paper by three or
 * more sources. The ≥ 3-source sets of `P2-T13` (DESeq2, Hamilton I/II, UniProt
 * 2023, …) were each recorded with a **different** query per source — word
 * searches on PubMed, one-title searches on Crossref — so no single search
 * replays them. Over `corpus-q3` the shipped pipeline merges two papers from two
 * sources each; those are {@link KNOWN_CROSS_INDEXED}, and the test also
 * re-derives their contributors from each adapter's own answer.
 *
 * ## What is written, and erased
 *
 * Step 6 imports into one new collection in the scaffold's test profile. The
 * items that import created, the provenance notes and the collection are
 * erased in `after()`; an erase failure is logged, never a test failure.
 */

import { config } from "../../../package.json";
import type { PluginApi } from "../../../src/addon";
import { RateLimitError, UpstreamServerError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  ARXIV_HOST,
  BIORXIV_HOST,
  CROSSREF_HOST,
  EBI_HOST,
  NCBI_HOST,
  SEMANTICSCHOLAR_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import { fluentResourceId } from "../../../src/i18n/ftl";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { normalizeDoi, type SourceId } from "../../../src/model/ids";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../../../src/pipeline/searchImport/types";
import type { Pipeline } from "../../../src/pipeline/types";
import { createArxivSource } from "../../../src/sources/arxiv/arxivSource";
import { createArxivRecordMapper } from "../../../src/sources/arxiv/mapper";
import { createBiorxivSource } from "../../../src/sources/biorxiv/biorxivSource";
import { createBiorxivRecordMapper } from "../../../src/sources/biorxiv/mapper";
import { createCrossrefSource } from "../../../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import { createEuropePmcSource } from "../../../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import { createPubmedRecordMapper } from "../../../src/sources/pubmed/mapper";
import { createPubmedSource } from "../../../src/sources/pubmed/pubmedSource";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import { createSemanticScholarSource } from "../../../src/sources/semanticscholar/semanticscholarSource";
import type { LiteratureSource } from "../../../src/sources/types";
import {
  NEW_COLLECTION_VALUE,
  SEARCH_WINDOW_API_PROPERTY,
  type SearchWindowQuery,
} from "../../../src/ui/dialogs/searchDialog";
import type {
  MessageFormatter,
  MessageRef,
  SearchViewState,
  SearchWindowHostApi,
} from "../../../src/ui/viewModels/searchImportViewModel";
import { qualifiedPrefName } from "../../../src/zotero/prefStore";
import {
  DEDUP_CORPUS_Q1,
  DEDUP_CORPUS_Q3,
  dedupCorpusQuery,
  type DedupCorpusSearch,
} from "../../support/dedupCorpusRecordedRequests";
import {
  repositoryFixtureDir,
  zoteroFixtureIo,
} from "../../support/fixtureIo.zotero";
import {
  createMultiHostReplayHttpClient,
  readScenarioExchange,
  type MultiHostReplayHttpClient,
  type RecordedExchange,
  type ReplayRoute,
} from "../../support/fixtureReplay";

interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function before(body: (this: TestContext) => Promise<void>): void;
declare function after(body: (this: TestContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

function log(line: string): void {
  debug(`[P2-T16] ${line}`);
}

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** All seven v1 sources, in `SOURCE_IDS` order — the `sources` default. */
const ALL_SOURCES: readonly SourceId[] = [
  "pubmed",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
  "biorxiv",
  "medrxiv",
];
/** The five that search on a keyword run (item 204); bioRxiv/medRxiv do not. */
const SEARCHING: readonly SourceId[] = [
  "pubmed",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
];

/**
 * The papers the shipped pipeline merges across sources over `corpus-q3`,
 * with the sources whose own answer carries each DOI — measured 2026-10-20 by
 * running the committed answers through the shipped adapters, and re-derived
 * by step 2 itself from those answers.
 */
const KNOWN_CROSS_INDEXED: ReadonlyMap<string, readonly SourceId[]> = new Map([
  // "CD-Tron: Leveraging Large Clinical Language Model for Early Detection …",
  // a medRxiv preprint Europe PMC (PPR) and Crossref both index.
  ["10.1101/2024.10.31.24316386", ["europepmc", "crossref"]],
  // "Large Language Models in Worldwide Medical Exams: Platform Development …"
  ["10.2196/66114", ["pubmed", "europepmc"]],
]);

/** §7.3's attempt cap on every literature host (`docs/07` §7.3). */
const ATTEMPT_CAP = 3;

/**
 * **Why no assertion here reads a failed source's error `code`.** Measured
 * 2026-10-20: this spec is bundled apart from the plugin, so the adapters and
 * the client it builds throw **this bundle's** `RateLimitError` and friends,
 * while the pipeline that catches them is the plugin's and serializes with its
 * own `instanceof ResearchHelperError` (`serialize` in
 * `src/pipeline/searchImport/stages.ts`). Every error crossing that boundary
 * is reported `UNTYPED` (detail "non-Error throw" for a plain `Error`). The
 * product, whose adapters and pipeline share one bundle, does not have this
 * split. So step 3 shows the 429 and the 500 through the transport and asks
 * the classification in this bundle, and the failure rows are asserted as
 * failures, not by their words. `P2-T36`'s real-adapter test in
 * `searchDialog-flow.spec.ts` has the same boundary.
 */
const BUNDLE_BOUNDARY_NOTE = "see the doc comment";
void BUNDLE_BOUNDARY_NOTE;

const SUMMARY_BUNDLES = [
  fluentResourceId("mainWindow"),
  fluentResourceId("searchDialog"),
];

// ---------------------------------------------------------------------------
// 2. The published host and its registry
// ---------------------------------------------------------------------------

type Services = NonNullable<PluginApi["services"]>;

interface PluginInstance {
  readonly api?: PluginApi;
  readonly data: { readonly initialized: boolean };
}

function pluginInstance(): PluginInstance | undefined {
  return (Zotero as unknown as Record<string, PluginInstance | undefined>)[
    config.addonInstance
  ];
}

function publishedApi(): PluginApi {
  const api = pluginInstance()?.api;
  if (!api) assert.fail(`Zotero.${config.addonInstance}.api is absent`);
  return api;
}

function services(): Services {
  const graph = publishedApi().services;
  if (!graph) assert.fail("no ServiceGraph is published at api.services");
  return graph;
}

function publishedHost(): SearchWindowHostApi {
  const host = publishedApi()[SEARCH_WINDOW_API_PROPERTY];
  if (!host)
    assert.fail(`nothing is published at api.${SEARCH_WINDOW_API_PROPERTY}`);
  return host;
}

/** The pipeline object the published view model calls, for a read-only tap. */
function publishedPipeline(): Pipeline<SearchImportInput, SearchImportOutput> {
  const deps = publishedApi().searchWindowDeps;
  if (!deps) assert.fail("no searchWindowDeps are published");
  return deps.pipeline;
}

// ---------------------------------------------------------------------------
// 3. The replay-backed adapters
// ---------------------------------------------------------------------------

/** Every fixture route, as `api.biorxiv.org` shares one host for two servers. */
async function replayRoutes(): Promise<readonly ReplayRoute[]> {
  return [
    { host: NCBI_HOST, dirs: [await repositoryFixtureDir("pubmed")] },
    { host: EBI_HOST, dirs: [await repositoryFixtureDir("europepmc")] },
    { host: CROSSREF_HOST, dirs: [await repositoryFixtureDir("crossref")] },
    {
      host: SEMANTICSCHOLAR_HOST,
      dirs: [await repositoryFixtureDir("semanticscholar")],
    },
    { host: ARXIV_HOST, dirs: [await repositoryFixtureDir("arxiv")] },
    {
      host: BIORXIV_HOST,
      dirs: [
        await repositoryFixtureDir("biorxiv"),
        await repositoryFixtureDir("medrxiv"),
      ],
    },
  ];
}

/**
 * The seven shipped adapters over one replay client — the composition root's
 * construction (`installServices`), with the replay client for `http`, no
 * secret store (so Semantic Scholar is unconfigured and unkeyed) and
 * `keepRaw: false`, the §8.5 default.
 */
function replayAdapters(
  replay: MultiHostReplayHttpClient,
): readonly LiteratureSource[] {
  const http = replay.client;
  const clock = services().clock;
  const logger = services().logger.child({ spec: "P2-T16" });
  const keepRaw = false;
  const biorxivMapRecords = createBiorxivRecordMapper({
    clock,
    keepRaw,
    logger,
  });
  return [
    createPubmedSource({
      http,
      clock,
      mapRecords: createPubmedRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    createEuropePmcSource({
      http,
      clock,
      mapRecords: createEuropePmcRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    createCrossrefSource({
      http,
      clock,
      mapRecords: createCrossrefRecordMapper({ clock, keepRaw, logger }),
      // The recorder sent no `mailto` (`P2-T13`), so neither does this.
      userContactEmail: () => undefined,
      logger,
    }),
    createSemanticScholarSource({
      http,
      clock,
      mapRecords: createSemanticScholarRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    createArxivSource({
      http,
      clock,
      mapRecords: createArxivRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    createBiorxivSource({
      server: "biorxiv",
      http,
      clock,
      mapRecords: biorxivMapRecords,
      logger,
    }),
    createBiorxivSource({
      server: "medrxiv",
      http,
      clock,
      mapRecords: biorxivMapRecords,
      logger,
    }),
  ];
}

/** The adapters this file put in the registry, and the ones it displaced. */
let installed: readonly LiteratureSource[] = [];
let displaced: LiteratureSource[] = [];
let replay: MultiHostReplayHttpClient;
/** What each host answers instead of its fixtures, for the current test. */
const injected = new Map<string, RecordedExchange>();

async function installReplayAdapters(): Promise<void> {
  replay = createMultiHostReplayHttpClient({
    routes: await replayRoutes(),
    io: zoteroFixtureIo,
    answerFor: (host) => injected.get(host),
  });
  installed = replayAdapters(replay);
  displaced = installed.map((adapter) =>
    services().sources.replaceForTest(adapter),
  );
  assertAllSlotsReplayed();
}

function restoreRealAdapters(): void {
  const registry = services().sources;
  for (const real of displaced) {
    // Only undo a swap that is still ours: a restart builds a fresh registry.
    if (installed.includes(registry.get(real.id) as LiteratureSource)) {
      registry.replaceForTest(real);
    }
  }
  displaced = [];
  installed = [];
}

/** Fail unless every one of the seven slots holds this file's adapter. */
function assertAllSlotsReplayed(): void {
  const registry = services().sources;
  for (const id of ALL_SOURCES) {
    const adapter = registry.get(id);
    assert.isTrue(
      adapter !== undefined && installed.includes(adapter),
      `the ${id} slot does not hold a replay adapter, so a search could go live`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Driving the host
// ---------------------------------------------------------------------------

const states: SearchViewState[] = [];
let disconnect: (() => void) | undefined;
/** Every output the published pipeline returned since the tap was set. */
const outputs: SearchImportOutput[] = [];
let untap: (() => void) | undefined;

function connectRecorder(): void {
  disconnect?.();
  disconnect = publishedHost().connect({
    render: (state) => {
      states.push(state);
    },
    // A `Localization` over the plugin's bundles, as the window hands over
    // `document.l10n`; typed by the view model's narrower port.
    formatter: new Localization(SUMMARY_BUNDLES) as unknown as MessageFormatter,
  });
}

/**
 * Record every pipeline output without changing it. The view model keeps the
 * preview's `works` private and `seenIn` lives there; the object it calls is
 * the published `searchWindowDeps.pipeline`, so its `run` is wrapped here and
 * put back in `after()`.
 */
function tapPipeline(): void {
  untap?.();
  const pipeline = publishedPipeline() as {
    run: Pipeline<SearchImportInput, SearchImportOutput>["run"];
  };
  const original = pipeline.run;
  pipeline.run = async (input, ctx) => {
    const output = await original.call(pipeline, input, ctx);
    outputs.push(output);
    return output;
  };
  untap = () => {
    pipeline.run = original;
    untap = undefined;
  };
}

function latest(): SearchViewState {
  const state = states[states.length - 1];
  if (state === undefined) assert.fail("the host published no state");
  return state;
}

/**
 * Run one host action and return the one pipeline output it produced.
 *
 * Fails, naming the cause, when the action ran no pipeline: the view model
 * refuses a run while another is in flight (`runJob`), and an earlier spec
 * that timed out mid-run leaves exactly that state behind.
 */
async function ran(
  action: Promise<void>,
  what: string,
): Promise<SearchImportOutput> {
  const before = outputs.length;
  await action;
  const output = outputs[before];
  if (outputs.length !== before + 1 || output === undefined) {
    assert.fail(
      `${what}: the published host ran ${String(outputs.length - before)} ` +
        `pipeline(s), not 1 — a run was already in flight or the request was refused`,
    );
  }
  return output;
}

/** Wait until the published host reports no run in flight. */
async function hostIdle(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (states.length > 0 && latest().running) {
    if (Date.now() > deadline) {
      assert.fail("the published host still has a run in flight after 60 s");
    }
    await Zotero.Promise.delay(200);
  }
}

/** The window's query for one corpus search, as its controls would build it. */
function queryOf(
  search: DedupCorpusSearch,
  sources: readonly string[],
  extra: Partial<SearchWindowQuery> = {},
): SearchWindowQuery {
  return {
    mode: "keyword",
    keyword: search.text,
    fromYear: Number(search.fromDate.slice(0, 4)),
    toYear: Number(search.toDate.slice(0, 4)),
    maxResults: search.limit,
    sources,
    filter: "",
    hideExisting: false,
    duplicates: "link",
    collectionID: "",
    ...extra,
  };
}

/** Resolve `ref` through the plugin's own bundles in Zotero's UI locale. */
async function resolved(ref: MessageRef): Promise<string> {
  const l10n = new Localization(SUMMARY_BUNDLES);
  const [value] = await l10n.formatValues([
    ref.args === undefined ? { id: ref.id } : { id: ref.id, args: ref.args },
  ]);
  if (typeof value !== "string" || value === "") {
    assert.fail(
      `${ref.id} resolves to no text in ${Services.locale.appLocaleAsBCP47}`,
    );
  }
  return value;
}

function sortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** Regular items in the user library: no notes, attachments or annotations. */
async function regularItemCount(): Promise<number> {
  const count: unknown = await Zotero.DB.valueQueryAsync(
    "SELECT COUNT(*) FROM items JOIN itemTypes USING (itemTypeID) " +
      "WHERE typeName NOT IN ('note', 'attachment', 'annotation')",
  );
  return Number(count);
}

// ---------------------------------------------------------------------------
// 5. The specs
// ---------------------------------------------------------------------------

describe("P2-T16 Part A: Phase 2's end-to-end run over replayed fixtures", () => {
  const collectionName = `RH P2-T16 ${String(Date.now())}`;
  /** Items step 6's first import created, for `after()` to erase. */
  let createdItemIds: number[] = [];
  let savedSourcesPref: unknown;

  before(async function () {
    this.timeout(60_000);
    assert.strictEqual(
      Zotero.Prefs.get(qualifiedPrefName("useTranslators"), true),
      false,
      "Strategy B is off, so no translator lookup can run (docs/07 §8.5)",
    );
    savedSourcesPref = Zotero.Prefs.get(qualifiedPrefName("sources"), true);
    await installReplayAdapters();
    connectRecorder();
    tapPipeline();
    // An earlier spec that timed out mid-run leaves the shared host busy.
    await hostIdle();
    log(
      `seven replay adapters installed; Zotero ${Zotero.version}, UI locale ` +
        `${Services.locale.appLocaleAsBCP47}`,
    );
  });

  after(async function () {
    this.timeout(60_000);
    untap?.();
    disconnect?.();
    disconnect = undefined;
    try {
      restoreRealAdapters();
    } catch (error) {
      log(`restoring the real adapters failed: ${String(error)}`);
    }
    if (typeof savedSourcesPref === "string") {
      Zotero.Prefs.set(qualifiedPrefName("sources"), savedSourcesPref, true);
    } else {
      Zotero.Prefs.clear(qualifiedPrefName("sources"), true);
    }
    try {
      const libraryID = Zotero.Libraries.userLibraryID;
      const collection = Zotero.Collections.getByLibrary(libraryID).find(
        (c: Zotero.Collection) => c.name === collectionName,
      );
      const notes =
        collection === undefined
          ? []
          : collection
              .getChildItems(false)
              .filter((item: Zotero.Item) => item.isNote())
              .map((item: Zotero.Item) => item.id);
      const erase = [...createdItemIds, ...notes];
      if (erase.length > 0) await Zotero.Items.erase(erase);
      await collection?.eraseTx();
      log(`erased ${String(erase.length)} item(s) and the collection`);
    } catch (error) {
      log(`erase failed (not a test failure): ${String(error)}`);
    }
  });

  // =========================================================================
  // Step 2 — one paper, exactly once, every contributing source
  // =========================================================================

  it("step 2: a seven-source search shows each cross-indexed paper exactly once, every contributing source in its chips and in seenIn", async function () {
    this.timeout(120_000);
    assertAllSlotsReplayed();
    injected.clear();

    // The contributors, derived without the pipeline: each searching
    // adapter's own answer to the same query, through a separate client.
    const probe = createMultiHostReplayHttpClient({
      routes: await replayRoutes(),
      io: zoteroFixtureIo,
    });
    const contributors = new Map<string, SourceId[]>();
    for (const adapter of replayAdapters(probe)) {
      if (!SEARCHING.includes(adapter.id)) continue;
      try {
        for await (const record of adapter.searchAll(
          dedupCorpusQuery(DEDUP_CORPUS_Q3),
          { token: createCancellationTokenSource().token },
        )) {
          const doi = record.work.ids.doi;
          if (doi === undefined) continue;
          const key = normalizeDoi(doi) ?? doi;
          contributors.set(key, [...(contributors.get(key) ?? []), adapter.id]);
        }
      } catch (error) {
        log(
          `probe: ${adapter.id} has no answer (${String(error).split("\n")[0]})`,
        );
      }
    }
    for (const [doi, expected] of KNOWN_CROSS_INDEXED) {
      assert.deepEqual(
        sortedIds(contributors.get(doi) ?? []),
        sortedIds(expected),
        `the committed answers carry ${doi} from exactly these sources`,
      );
    }

    const before = replay.transport.calls.length;
    const output = await ran(
      publishedHost().runSearch(queryOf(DEDUP_CORPUS_Q3, ALL_SOURCES)),
      "step 2's search",
    );
    const state = latest();
    const rows = state.records ?? [];
    assert.strictEqual(state.panel, "results");
    assert.isAbove(rows.length, 0, "the table has rows");
    assert.strictEqual(rows.length, output.records.length, "one row per work");
    assert.strictEqual(output.works.length, output.records.length);

    for (const [doi, expected] of KNOWN_CROSS_INDEXED) {
      const at = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => normalizeDoi(row.doi) === doi);
      assert.strictEqual(at.length, 1, `${doi} is exactly one row`);
      const only = at[0];
      if (only === undefined) assert.fail("unreachable");
      assert.deepEqual(
        sortedIds(only.row.sourceIds),
        sortedIds(expected),
        `${doi}: every contributing source is a chip`,
      );
      assert.strictEqual(
        only.row.sourceLabels.length,
        only.row.sourceIds.length,
        "one label per chip",
      );
      // The chips' words are not asserted. Measured 2026-10-20: the published
      // view model resolves the display names once, on its first run, and
      // keeps them; `phase1-dod.spec.ts` drives the same host earlier in the
      // run with no formatter, so the names latched as ids before this file
      // connected one. The window always connects with `document.l10n`.
      const work: CanonicalWork | undefined = output.works[only.index];
      assert.deepEqual(
        sortedIds(work?.provenance.seenIn ?? []),
        sortedIds(expected),
        `${doi}: provenance.seenIn names every contributing source`,
      );
      log(
        `${doi}: one row, chips ${only.row.sourceLabels.join(" + ")}, seenIn ` +
          `${(work?.provenance.seenIn ?? []).join(",")}`,
      );
    }
    // No DOI is on two rows (FR-50): the whole table, not only the two papers.
    const dois = rows
      .map((row) => normalizeDoi(row.doi))
      .filter((doi): doi is NonNullable<typeof doi> => doi !== undefined);
    assert.strictEqual(new Set(dois).size, dois.length, "no DOI on two rows");

    // What ran: four sources answered from fixtures, Semantic Scholar's
    // corpus-q3 was never recorded and is refused by the harness, and the
    // two lookup-only servers sent nothing.
    const calls = replay.transport.calls.slice(before);
    for (const report of output.perSource) {
      log(
        `  ${report.sourceId}: ${String(report.recordsRetrieved)} record(s)` +
          `${report.error === undefined ? "" : `, ${report.error.code}`}`,
      );
    }
    for (const id of ["pubmed", "europepmc", "crossref", "arxiv"] as const) {
      const report = output.perSource.find((r) => r.sourceId === id);
      assert.strictEqual(report?.error, undefined, `${id} answered`);
      assert.strictEqual(report?.recordsRetrieved, DEDUP_CORPUS_Q3.limit);
    }
    // Semantic Scholar's unrecorded search is refused by the harness, never
    // sent: every one of its requests found no fixture. (Its report's error is
    // `UNTYPED` — see {@link BUNDLE_BOUNDARY_NOTE}.)
    const s2 = output.perSource.find((r) => r.sourceId === "semanticscholar");
    assert.isTrue(s2?.error !== undefined, "Semantic Scholar failed");
    const s2Calls = calls.filter((c) => c.host === SEMANTICSCHOLAR_HOST);
    assert.isAbove(s2Calls.length, 0, "Semantic Scholar was asked");
    assert.isTrue(
      s2Calls.every((c) => c.status === undefined),
      "every Semantic Scholar request was refused as unrecorded",
    );
    assert.strictEqual(
      calls.filter((call) => call.host === BIORXIV_HOST).length,
      0,
      "bioRxiv and medRxiv send nothing on a keyword run",
    );
    assert.strictEqual(output.outcome, "partial");
    log(
      `step 2: ${String(rows.length)} rows from ${String(calls.length)} requests ` +
        `(${String(calls.filter((c) => c.status === undefined).length)} refused as unrecorded)`,
    );
  });

  // =========================================================================
  // Step 3 — a 500 and a 429; the others deliver; PartialFetch
  // =========================================================================

  it("step 3: with arXiv at 500 and Semantic Scholar at its recorded 429, the others deliver, the run is PartialFetch, and both failures are status rows", async function () {
    this.timeout(120_000);
    assertAllSlotsReplayed();
    injected.clear();
    const arxiv500 = await readScenarioExchange(
      await repositoryFixtureDir("arxiv"),
      "error-500",
      zoteroFixtureIo,
    );
    assert.strictEqual(arxiv500.status, 500, "arXiv's committed error-500");
    injected.set(ARXIV_HOST, arxiv500);
    // Semantic Scholar's committed `corpus-q1` is a real 429, but it was
    // recorded on `/paper/search` (relevance; `semanticscholarCorpusPlan` in
    // `scripts/record-fixtures.ts`), while a pipeline search asks
    // `/paper/search/bulk` — measured 2026-10-20, the pipeline's request
    // names no committed fixture. So the recorded 429 is answered for every
    // Semantic Scholar request instead, through the same seam as the 500.
    const s2Recorded = await readScenarioExchange(
      await repositoryFixtureDir("semanticscholar"),
      DEDUP_CORPUS_Q1.scenario,
      zoteroFixtureIo,
    );
    assert.strictEqual(s2Recorded.status, 429, "corpus-q1 is a recorded 429");
    injected.set(SEMANTICSCHOLAR_HOST, s2Recorded);

    const before = replay.transport.calls.length;
    let output: SearchImportOutput;
    try {
      output = await ran(
        publishedHost().runSearch(queryOf(DEDUP_CORPUS_Q1, ALL_SOURCES)),
        "step 3's search",
      );
    } finally {
      injected.clear();
    }
    const state = latest();
    const calls = replay.transport.calls.slice(before);

    // §12.1: `Fetching --> PartialFetch : some sources failed, some
    // succeeded`, carried to the end as "partial", then on to Merging.
    assert.strictEqual(output.outcome, "partial", "the run is PartialFetch");
    assert.isTrue(
      output.stageReached !== "planning" && output.stageReached !== "fetching",
      `PartialFetch continued past Fetching (reached ${output.stageReached})`,
    );

    // Both failures are status rows, resolved through the bundle; the three
    // that deliver count results; the two lookup-only servers draw their ⊕
    // role row. Checked first: it is the window's own account of the run.
    const delivering: readonly SourceId[] = ["pubmed", "europepmc", "crossref"];
    const lineOf = (id: string) => state.sources.find((l) => l.sourceId === id);
    for (const id of ["semanticscholar", "arxiv"]) {
      const line = lineOf(id);
      assert.strictEqual(
        line?.outcome,
        "failed",
        `${id} has a failed status row`,
      );
      if (line !== undefined) {
        const text = await resolved(line.detail);
        log(`  ${id} status row: ${line.detail.id} → "${text}"`);
      }
    }
    for (const id of delivering) {
      assert.strictEqual(lineOf(id)?.outcome, "succeeded", `${id} row`);
    }
    for (const id of ["biorxiv", "medrxiv"]) {
      assert.strictEqual(lineOf(id)?.outcome, "role", `${id} role row`);
    }
    assert.strictEqual(
      state.sources.length,
      ALL_SOURCES.length,
      "seven status rows",
    );

    const reportOf = (id: SourceId) =>
      output.perSource.find((r) => r.sourceId === id);
    // Both reports carry an error. Its `code` is not asserted: see
    // {@link BUNDLE_BOUNDARY_NOTE}. The transport below is what shows a 429
    // and a 500 were answered, retried to the cap, and given up on.
    assert.isTrue(reportOf("semanticscholar")?.error !== undefined);
    assert.isTrue(reportOf("arxiv")?.error !== undefined);
    // The search's own requests: the abstract backfill's `/paper/batch`
    // lookup, later in the run, gets the same 429 and is counted apart.
    const s2Search = calls.filter(
      (c) =>
        c.host === SEMANTICSCHOLAR_HOST &&
        new URL(c.url).pathname.includes("/paper/search"),
    );
    assert.isTrue(
      s2Search.every((c) => c.status === 429),
      "every Semantic Scholar search answer was the recorded 429",
    );
    const arxivCalls = calls.filter((c) => c.host === ARXIV_HOST);
    assert.strictEqual(
      s2Search.length,
      ATTEMPT_CAP,
      "the 429 was retried to §7.3's cap",
    );
    assert.strictEqual(
      arxivCalls.length,
      ATTEMPT_CAP,
      "the 500 was retried to §7.3's cap",
    );
    assert.isTrue(
      arxivCalls.every((c) => c.status === 500),
      "every arXiv answer was the injected 500",
    );

    // The classification, asked in the bundle that built the client (see
    // BUNDLE_BOUNDARY_NOTE): the same two adapters over the same two answers
    // throw the shipped client's RateLimitError and UpstreamServerError.
    const classify = createMultiHostReplayHttpClient({
      routes: await replayRoutes(),
      io: zoteroFixtureIo,
      answerFor: (host) =>
        host === SEMANTICSCHOLAR_HOST
          ? s2Recorded
          : host === ARXIV_HOST
            ? arxiv500
            : undefined,
    });
    const expectedClass = new Map<
      SourceId,
      abstract new (...a: never[]) => Error
    >([
      ["semanticscholar", RateLimitError],
      ["arxiv", UpstreamServerError],
    ]);
    for (const adapter of replayAdapters(classify)) {
      const cls = expectedClass.get(adapter.id);
      if (cls === undefined) continue;
      let thrown: unknown;
      try {
        for await (const record of adapter.searchAll(
          dedupCorpusQuery(DEDUP_CORPUS_Q1),
          { token: createCancellationTokenSource().token },
        )) {
          void record;
        }
      } catch (error) {
        thrown = error;
      }
      assert.isTrue(
        thrown instanceof cls,
        `${adapter.id} throws ${cls.name}, not ${String(thrown)}`,
      );
    }

    // The others deliver: every source that searches and was not failed.
    for (const id of delivering) {
      assert.strictEqual(reportOf(id)?.error, undefined, `${id} delivered`);
      assert.strictEqual(reportOf(id)?.recordsRetrieved, DEDUP_CORPUS_Q1.limit);
    }
    const rows = state.records ?? [];
    assert.isAbove(rows.length, 0, "results are shown");
    assert.isTrue(
      rows.every((row) =>
        row.sourceIds.every((id) => delivering.includes(id as SourceId)),
      ),
      "every row comes from a delivering source",
    );

    log(
      `step 3: outcome ${output.outcome}, reached ${output.stageReached}, ` +
        `${String(rows.length)} rows; S2 ${String(s2Search.length)}×429, ` +
        `arXiv ${String(arxivCalls.length)}×500`,
    );
  });

  // =========================================================================
  // Step 6 — FR-51: a re-run links, creates nothing, and says so
  // =========================================================================

  it("step 6 (FR-51): re-running the same search creates zero new items and reports the linked and already-present counts in the shipped wording", async function () {
    this.timeout(180_000);
    assertAllSlotsReplayed();
    injected.clear();
    const libraryID = Zotero.Libraries.userLibraryID;
    const query = queryOf(DEDUP_CORPUS_Q3, ALL_SOURCES);
    const target = `${NEW_COLLECTION_VALUE}:${collectionName}`;

    // First run: search, then import every row into a new collection.
    const idsBefore = new Set<number>(
      (await Zotero.Items.getAll(libraryID, false, true, true)) as number[],
    );
    await ran(publishedHost().runSearch(query), "step 6's first search");
    const firstRows = latest().records ?? [];
    assert.isAbove(firstRows.length, 0);
    const first = (
      await ran(
        publishedHost().runImport({
          ...query,
          collectionID: target,
          records: firstRows,
        }),
        "step 6's first import",
      )
    ).write;
    if (first === undefined) assert.fail("the first import wrote nothing");
    const collection = Zotero.Collections.getByLibrary(libraryID).find(
      (c: Zotero.Collection) => c.name === collectionName,
    );
    if (collection === undefined)
      assert.fail("the import created no collection");
    createdItemIds = collection
      .getChildItems(true)
      .filter((id: number) => !idsBefore.has(id));
    assert.strictEqual(
      first.created + first.linkedExisting + first.skipped,
      firstRows.length,
      "the first import accounts for every row",
    );
    log(
      `first import: created ${String(first.created)}, linked ` +
        `${String(first.linkedExisting)}, skipped ${String(first.skipped)}`,
    );

    // Second run, the same search: nothing new, every row linked.
    const itemsBefore = await regularItemCount();
    const mark = states.length;
    await ran(publishedHost().runSearch(query), "step 6's second search");
    const secondRows = latest().records ?? [];
    assert.strictEqual(secondRows.length, firstRows.length, "the same rows");
    const unmarked = secondRows.filter((row) => !row.existing);
    for (const row of unmarked) {
      log(
        `  not marked present: ${row.sourceIds.join("+")} doi="${row.doi}" ` +
          `key=${row.key} "${row.title.slice(0, 60)}"`,
      );
    }
    const second = (
      await ran(
        publishedHost().runImport({
          ...query,
          collectionID: target,
          records: secondRows,
        }),
        "step 6's second import",
      )
    ).write;
    if (second === undefined) assert.fail("the second import wrote nothing");
    // FR-51's verdicts are collected and asserted at the end, so the summary
    // wording and the re-run below are measured even when one fails.
    const problems: string[] = [];
    const grewBy = (await regularItemCount()) - itemsBefore;
    createdItemIds = collection
      .getChildItems(true)
      .filter((id: number) => !idsBefore.has(id));
    if (second.created !== 0 || grewBy !== 0) {
      problems.push(
        `the repeated search's import created ${String(second.created)} ` +
          `item(s) and the library grew by ${String(grewBy)}`,
      );
    }
    if (second.linkedExisting + second.skipped !== secondRows.length) {
      problems.push(
        `${String(second.linkedExisting + second.skipped)} of ` +
          `${String(secondRows.length)} rows were linked or skipped`,
      );
    }
    log(
      `second import: created ${String(second.created)}, linked ` +
        `${String(second.linkedExisting)}, skipped ${String(second.skipped)}`,
    );
    const linkedSummary = states
      .slice(mark)
      .map((s) => s.status)
      .filter((ref): ref is MessageRef => ref !== undefined)
      .pop();
    if (linkedSummary === undefined) assert.fail("no summary was published");
    assert.strictEqual(linkedSummary.id, "research-helper-import-summary");
    assert.deepEqual(
      linkedSummary.args,
      {
        imported: second.created,
        linked: second.linkedExisting,
        skipped: second.skipped,
        failed: second.failed,
      },
      "FR-51: created and linked-existing are reported separately",
    );
    const linkedText = await resolved(linkedSummary);
    assert.include(linkedText, String(second.linkedExisting));
    log(`second import (plain): "${linkedText}"`);

    // Third run through FR-12's re-run seed: the stored record's own search.
    const seed = await publishedHost().loadRerun(collection.id);
    if (seed === undefined)
      assert.fail("the collection has no stored search to re-run");
    assert.strictEqual(seed.asRecorded.userQuery, DEDUP_CORPUS_Q3.text);
    const dateWindow = seed.asRecorded.dateWindow;
    const rerun: SearchWindowQuery = {
      ...query,
      mode: "rerun",
      keyword: seed.asRecorded.userQuery,
      sources: seed.asRecorded.sourceIds,
      maxResults: seed.asRecorded.requestedLimit ?? query.maxResults,
      dateWindow,
    };
    const itemsBeforeRerun = await regularItemCount();
    const rerunMark = states.length;
    await ran(publishedHost().runSearch(rerun), "step 6's re-run search");
    const rerunRows = latest().records ?? [];
    assert.strictEqual(
      rerunRows.length,
      firstRows.length,
      "the re-run finds the same rows",
    );
    const third = (
      await ran(
        publishedHost().runImport({
          ...rerun,
          collectionID: target,
          records: rerunRows,
        }),
        "step 6's re-run import",
      )
    ).write;
    if (third === undefined) assert.fail("the re-run import wrote nothing");
    const rerunGrewBy = (await regularItemCount()) - itemsBeforeRerun;
    createdItemIds = collection
      .getChildItems(true)
      .filter((id: number) => !idsBefore.has(id));
    if (third.created !== 0 || rerunGrewBy !== 0) {
      problems.push(
        `the FR-12 re-run's import created ${String(third.created)} item(s) ` +
          `and the library grew by ${String(rerunGrewBy)}`,
      );
    }
    log(
      `third import (re-run): created ${String(third.created)}, linked ` +
        `${String(third.linkedExisting)}, skipped ${String(third.skipped)}`,
    );
    const presentSummary = states
      .slice(rerunMark)
      .map((s) => s.status)
      .filter((ref): ref is MessageRef => ref !== undefined)
      .pop();
    if (presentSummary === undefined)
      assert.fail("no re-run summary was published");
    assert.strictEqual(
      presentSummary.id,
      "research-helper-search-import-summary-rerun",
    );
    assert.deepEqual(presentSummary.args, {
      imported: third.created,
      present: third.linkedExisting + third.skipped,
      failed: third.failed,
    });
    const presentText = await resolved(presentSummary);
    assert.include(presentText, String(third.linkedExisting + third.skipped));
    log(`third import (re-run): "${presentText}"`);

    // The window's "already in library" marker on the second search's rows
    // (docs/08 §4.3).
    if (unmarked.length > 0) {
      problems.push(
        `${String(unmarked.length)} of ${String(secondRows.length)} rows of ` +
          `the repeated search are not marked as already in the library`,
      );
    }
    assert.deepEqual(problems, [], "FR-51: a re-run creates nothing");
  });

  // =========================================================================
  // Step 7 — installs and works with `sources` excluding semanticscholar
  // =========================================================================

  it("step 7: the plugin restarts with sources excluding semanticscholar and searches without asking it", async function () {
    this.timeout(180_000);
    const without = ALL_SOURCES.filter((id) => id !== "semanticscholar");
    // Put the real adapters back before the restart; the restart builds a new
    // registry and this file swaps into that one.
    untap?.();
    disconnect?.();
    disconnect = undefined;
    restoreRealAdapters();
    Zotero.Prefs.set(qualifiedPrefName("sources"), without.join(","), true);

    await restartPlugin();
    await installReplayAdapters();
    connectRecorder();
    tapPipeline();
    const prefs = publishedHost().getPrefs();
    assert.strictEqual(
      prefs["sources"],
      without.join(","),
      "the restarted plugin reads the list",
    );

    const fromPrefs = String(prefs["sources"]).split(",");
    const before = replay.transport.calls.length;
    const output = await ran(
      publishedHost().runSearch(queryOf(DEDUP_CORPUS_Q3, fromPrefs)),
      "step 7's search",
    );
    const calls = replay.transport.calls.slice(before);
    assert.strictEqual(
      calls.filter((c) => c.host === SEMANTICSCHOLAR_HOST).length,
      0,
      "nothing asked Semantic Scholar, not even the abstract backfill",
    );
    assert.strictEqual(
      output.perSource.some((r) => r.sourceId === "semanticscholar"),
      false,
      "Semantic Scholar is not in the run",
    );
    assert.strictEqual(
      output.outcome,
      "succeeded",
      "every asked source answered",
    );
    assert.isAbove((latest().records ?? []).length, 0, "results are shown");
    log(
      `step 7: sources=${String(prefs["sources"])}; ${String(calls.length)} ` +
        `requests, none to ${SEMANTICSCHOLAR_HOST}; outcome ${output.outcome}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Restarting the plugin (step 7)
// ---------------------------------------------------------------------------

interface AddonWrapper {
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

/**
 * Disable and enable the plugin through the add-on manager, waiting for each
 * bootstrap call to finish — `test/integration/lifecycle.spec.ts`'s cycle.
 */
async function restartPlugin(): Promise<void> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) assert.fail(`AddonManager does not know ${config.addonID}`);
  await afterBootstrapCall("shutdown", () => wrapper.disable());
  await afterBootstrapCall("startup", () => wrapper.enable());
  const deadline = Date.now() + 30_000;
  while (pluginInstance()?.data.initialized !== true) {
    if (Date.now() > deadline)
      assert.fail("the plugin did not initialize after enable()");
    await Zotero.Promise.delay(100);
  }
}

function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) return;
        clearTimeout(timer);
        Zotero.Plugins.removeObserver(observer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      Zotero.Plugins.removeObserver(observer);
      reject(new Error(`timed out waiting for bootstrap ${method}`));
    }, 30_000);
    Zotero.Plugins.addObserver(observer);
    action().catch((error: unknown) => {
      clearTimeout(timer);
      Zotero.Plugins.removeObserver(observer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

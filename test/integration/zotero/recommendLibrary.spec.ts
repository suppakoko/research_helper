/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T18`: the recommend profile's reads, against a real Zotero library.
 *
 * What a fake could not prove, so the library is really written and searched:
 *
 * - `getTags()` really reports a user's tag as manual and a translator's as
 *   automatic, so `topicTagNames` keeps the second and not the first;
 * - `item.dateAdded` and `item.dateModified` have the shape `membershipHash` and
 *   `zoteroDateToEpochMs` expect;
 * - a trashed item, a note and an attachment are left out of both reads;
 * - `readLibraryTermSources` issues one search, not one per item;
 * - saving an item changes `membershipHash`, and reading it again does not;
 * - `libraryItems` (`P5-T25`) holds a saved item and not a trashed one;
 * - a real start's `graph.pipelines` holds `recommend`, whose refusal, cancel and
 *   `reject` run against this Zotero and its plugin database. None of those send a
 *   request, so this spec needs no key and no network.
 *
 * Every fixture carries {@link FIXTURE_TAG} and is tracked by id; `after()` erases
 * them and the collection.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import {
  buildPipelineSet,
  createZoteroRecommendLibrary,
  createZoteroSearchImportWriter,
  type RecommendConstructionDeps,
} from "../../../src/bootstrap/registerPipelines";
import { NO_CACHE } from "../../../src/core/cache/cache";
import { NetworkError } from "../../../src/core/errors";
import {
  createCancellationTokenSource,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import type { JobRecord } from "../../../src/core/jobQueue/jobRecord";
import type { Logger } from "../../../src/core/logger";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { SourceId } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  membershipHash,
  type RecommendLibrary,
  zoteroDateToEpochMs,
} from "../../../src/pipeline/recommend/profile";
import type {
  RecommendFailed,
  RecommendInput,
  RecommendOutput,
  RecommendPipeline,
  RecommendProfileResult,
  RecommendRows,
} from "../../../src/pipeline/recommend/types";
import {
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import type { SemanticScholarSource } from "../../../src/sources/semanticscholar/semanticscholarSource";
import type { LiteratureSource } from "../../../src/sources/types";
import { createJobStore } from "../../../src/zotero/db";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
} from "../../helpers/mockLLM";

interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function before(body: (this: MochaContext) => Promise<void>): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  fail(message?: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P5-T18]";
const FIXTURE_TAG = "rh-test-recommendLibrary-spec";
const TEST_TIMEOUT_MS = 60_000;
const MANUAL = 0;
const AUTOMATIC = 1;

const TAGGED_TITLE = "P5-T18 tagged article for the recommend profile";
const TRASHED_TITLE = "P5-T18 trashed article for the recommend profile";
const USER_TAG = "rh-p5t18 to read on the train";
const TRANSLATOR_TAG = "rh-p5t18 translator keyword";

type SearchRunner = (asTempTable?: boolean) => Promise<number[] | string>;

describe("recommend profile reads (P5-T18)", () => {
  const itemIDs: number[] = [];
  let collection: Zotero.Collection | undefined;
  let taggedItem: Zotero.Item | undefined;

  async function makeArticle(
    title: string,
    tags: readonly (readonly [string, number])[],
    collectionID: number,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", title);
    item.addTag(FIXTURE_TAG, AUTOMATIC);
    for (const [tag, type] of tags) item.addTag(tag, type);
    item.addToCollection(collectionID);
    await item.saveTx();
    itemIDs.push(item.id);
    return item;
  }

  async function fixtureCollection(): Promise<Zotero.Collection> {
    if (collection !== undefined) return collection;
    await Zotero.Schema.schemaUpdatePromise;
    const made = new Zotero.Collection({
      name: `Research Helper profile (P5-T18) ${String(Date.now())}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await made.saveTx();
    collection = made;

    taggedItem = await makeArticle(
      TAGGED_TITLE,
      [
        [USER_TAG, MANUAL],
        [TRANSLATOR_TAG, AUTOMATIC],
        ["MeSH*: Gene Editing", MANUAL],
        ["arXiv: cs.LG", AUTOMATIC],
      ],
      made.id,
    );

    const trashed = await makeArticle(TRASHED_TITLE, [], made.id);
    trashed.deleted = true;
    await trashed.saveTx();

    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote("P5-T18 note in the collection");
    note.addTag(FIXTURE_TAG, AUTOMATIC);
    note.addToCollection(made.id);
    await note.saveTx();
    itemIDs.push(note.id);

    return made;
  }

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    if (collection !== undefined) await collection.eraseTx();
    debug(`${LOG_PREFIX} erased ${String(itemIDs.length)} items`);
  });

  it("a collection read keeps regular items, a translator's tag and a subject tag, and not a user's tag", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const read = await createZoteroRecommendLibrary().readCollection(
      made.libraryID,
      made.key,
    );

    assert.strictEqual(read.name, made.name);
    assert.deepEqual(
      read.items.map(({ work }) => work.title),
      [TAGGED_TITLE],
      "the trashed article and the note are left out",
    );
    const [only] = read.items;
    if (only === undefined) throw new Error("no item read");
    assert.isTrue(
      (only.work.keywords ?? []).includes(TRANSLATOR_TAG),
      "an automatic tag is a keyword",
    );
    assert.isFalse(
      (only.work.keywords ?? []).includes(USER_TAG),
      "a tag the user typed is not",
    );
    assert.deepEqual(
      // In term order: `getTags()` gives its own (measured, sorted by name).
      (only.work.subjects ?? [])
        .map(({ term, scheme, isMajor }) => [term, scheme, isMajor])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ["cs.LG", "arxiv-category", undefined],
        ["Gene Editing", "mesh", true],
      ],
      "a manual tag spelled as a subject still counts",
    );
    debug(
      `${LOG_PREFIX} keywords ${JSON.stringify(only.work.keywords)} subjects ${JSON.stringify(only.work.subjects)}`,
    );
  });

  it("the dates of a saved item have the shape the profile reads", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const read = await createZoteroRecommendLibrary().readCollection(
      made.libraryID,
      made.key,
    );
    const [only] = read.items;
    if (only === undefined) throw new Error("no item read");
    debug(
      `${LOG_PREFIX} dateAdded ${String(only.dateAdded)} dateModified ${only.dateModified}`,
    );

    const addedAt = zoteroDateToEpochMs(only.dateAdded ?? "");
    assert.isTrue(addedAt !== undefined, "dateAdded parses");
    assert.isTrue(
      Math.abs((addedAt ?? 0) - Date.now()) < 3_600_000,
      "dateAdded is this run, read as UTC",
    );
    assert.strictEqual(
      "dateAdded" in only.work,
      false,
      "dateAdded stays off the work",
    );
  });

  it("the hash is stable across reads and changes when an item is saved with a change", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const library = createZoteroRecommendLibrary();
    const first = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    const again = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.strictEqual(first, again, "reading changes nothing");

    // `dateModified` has one-second resolution, so the change needs a later second.
    await Zotero.Promise.delay(1_100);
    if (taggedItem === undefined) throw new Error("no fixture item");
    taggedItem.setField("abstractNote", "P5-T18 modified");
    await taggedItem.saveTx();
    const modified = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.notStrictEqual(first, modified, "a saved change moves the hash");

    const added = await makeArticle("P5-T18 added article", [], made.id);
    const withAdded = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.notStrictEqual(modified, withAdded, "an added item moves the hash");
    added.removeFromCollection(made.id);
    await added.saveTx();
    const withoutAdded = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.strictEqual(modified, withoutAdded, "removing it moves it back");
  });

  it("the library read is one search and leaves out the trash, notes and typed tags", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const proto = Zotero.Search.prototype as unknown as {
      search: SearchRunner;
    };
    const original: SearchRunner = proto.search;
    let searches = 0;
    proto.search = function (this: unknown, asTempTable?: boolean) {
      searches += 1;
      return original.call(this, asTempTable);
    } as SearchRunner;
    let sources;
    const started = Date.now();
    try {
      sources = await createZoteroRecommendLibrary().libraryTermSources(
        made.libraryID,
      );
    } finally {
      proto.search = original;
    }
    debug(
      `${LOG_PREFIX} library read: ${String(sources.length)} rows, ${String(searches)} search, ${String(Date.now() - started)} ms`,
    );
    assert.strictEqual(searches, 1, "one search");

    const titles = sources.map(({ title }) => title);
    assert.isTrue(titles.includes(TAGGED_TITLE), "the regular item is there");
    assert.isFalse(titles.includes(TRASHED_TITLE), "the trashed one is not");
    assert.isFalse(titles.includes(""), "a note has no row");
    const tagged = sources.find(({ title }) => title === TAGGED_TITLE);
    assert.isFalse(
      (tagged?.keywords ?? []).includes(USER_TAG),
      "a tag the user typed is not counted",
    );
  });

  it("a key that names no collection is refused", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    let refused = false;
    try {
      await createZoteroRecommendLibrary().readCollection(
        Zotero.Libraries.userLibraryID,
        "ZZZZZZZZ",
      );
    } catch {
      refused = true;
    }
    assert.isTrue(refused, "readCollectionWorks throws");
  });

  it("libraryItems holds a saved item and not a trashed one (P5-T25)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await fixtureCollection();
    const fields = [
      ...(await createZoteroRecommendLibrary().libraryItems(
        Zotero.Libraries.userLibraryID,
      )),
    ];
    debug(`${LOG_PREFIX} libraryItems: ${String(fields.length)} items`);
    const saved = fields.find(({ title }) => title === TAGGED_TITLE);
    assert.strictEqual(saved?.itemID, taggedItem?.id, "the saved item, by id");
    assert.strictEqual(saved?.deleted, false);
    assert.isFalse(
      fields.some(({ title }) => title === TRASHED_TITLE),
      "the trash is left out",
    );
  });

  /** The real start's pipeline, and one job's context on it. */
  async function withRealPipeline(
    body: (
      pipeline: RecommendPipeline,
      open: (input: RecommendInput) => Promise<RecommendOutput>,
    ) => Promise<void>,
  ): Promise<void> {
    const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
      config.addonInstance
    ];
    const graph = instance?.api.services;
    if (!graph) assert.fail("no ServiceGraph is published at api.services");
    const pipeline = graph.pipelines.get("recommend");
    if (!pipeline) assert.fail("graph.pipelines holds no recommend pipeline");
    assert.strictEqual(pipeline.id, "recommend");
    assert.strictEqual(pipeline.resumable, false);
    const typed = pipeline as unknown as RecommendPipeline;
    await body(typed, async (input) => {
      const source = createCancellationTokenSource();
      const job = await graph.pipelineContext.openJob({
        pipelineId: "recommend",
        token: source.token,
      });
      try {
        return await typed.run(input, job.context);
      } finally {
        job.dispose();
        source.dispose();
      }
    });
  }

  it("a real start's graph holds the recommend pipeline, and it refuses a small collection", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    await withRealPipeline(async (_pipeline, open) => {
      const output = (await open({
        libraryID: Zotero.Libraries.userLibraryID,
        collectionKey: made.key,
        mode: "profile-only",
      })) as RecommendFailed;
      debug(
        `${LOG_PREFIX} small collection: ${JSON.stringify(output.tooFewItems)}`,
      );
      assert.strictEqual(output.outcome, "failed");
      assert.strictEqual(
        output.error.messageKey,
        "rh-error-recommend-too-few-items",
      );
      assert.strictEqual(output.tooFewItems?.minimum, 5);
      assert.strictEqual(output.stageReached, "ProfileCheck");
    });
  });

  it("reject answers false on the real store for a row never stored", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    await withRealPipeline(async (pipeline) => {
      assert.isFalse(
        await pipeline.reject(
          "rh-test-recommendLibrary-spec:no-profile",
          "doi:10.0000/rh-test-no-row",
        ),
      );
    });
  });
});

/**
 * `P5-T25`'s four proofs that need a run, written in the integration round of
 * 2026-11-05.
 *
 * **The pipeline is built in this bundle.** A spec is its own bundle, so
 * `createCancellationTokenSource` here throws a different `OperationCancelledError`
 * from the plugin's, and the plugin's `instanceof` reads it as a failure. So this builds
 * the pipeline through the real `buildPipelineSet`, over the real Semantic Scholar
 * adapter with no key, the real library reads, the real plugin database and the real job
 * queue. Doubled: the model, which `mockLLMRouter` scripts, and the sources that have a
 * keyword search, which sit in the real registry's slots. No key is stored: the
 * credentials port says yes, and the router's settings say so too.
 */
describe("P5-T25: a run in this Zotero, with the model and the sources doubled", () => {
  const STAMP = String(Date.now());
  const MODEL = "rh-spec-model";
  const PRICES: ModelPrices = {
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 2,
    cachedInputPerMTokUsd: undefined,
    tiers: [],
    asOfEpochMs: 1,
    source: "documented-table",
  };
  const GOOD_ANSWER = JSON.stringify({
    focusStatement: "Lipid nanoparticle delivery of messenger RNA.",
    coherence: "Close.",
    coherenceScore: 80,
    coreTopics: [{ topic: "lipid nanoparticle", weight: 1 }],
    inclusionSignals: ["a delivery study"],
    exclusionSignals: [],
    suggestedQueryTerms: ["ionizable lipid", "messenger delivery"],
  });
  const MEMBER_TITLE = `P5-T25 member ${STAMP} of the lipid nanoparticle collection`;
  const THIS_YEAR = new Date().getFullYear();
  const CANDIDATES = 40;
  const REQUEST_MS = 200;
  const WORDS = [
    "Hepatic",
    "Pulmonary",
    "Vaccine",
    "Cationic",
    "Stability",
    "Endosomal",
    "Clinical",
    "Formulation",
    "Toxicity",
    "Targeting",
    "Immune",
    "Kinetics",
    "Protein",
  ];

  type Graph = NonNullable<Addon["api"]["services"]>;
  interface RecordedRequest {
    readonly source: string;
  }

  const itemIDs: number[] = [];
  const collections: Zotero.Collection[] = [];
  const displaced: LiteratureSource[] = [];
  /** What the source doubles were asked, and the hook each request runs. */
  const asked: RecordedRequest[] = [];
  let onRequest: (() => void) | undefined;
  let graph: Graph | undefined;
  /** Every URL `Zotero.HTTP.request` saw while this block ran. */
  const httpUrls: string[] = [];
  let restoreHttp: (() => void) | undefined;

  function candidate(sourceId: SourceId, n: number): SourceRecord {
    // Words that differ, or the title match merges them into a few works.
    const title = `${WORDS[n % WORDS.length] ?? ""} ${WORDS[(n * 3 + 1) % WORDS.length] ?? ""} ${WORDS[(n * 7 + 2) % WORDS.length] ?? ""} and lipid nanoparticle delivery ${String(n)}`;
    return {
      id: `${sourceId}:p5t25-${String(n)}`,
      sourceId,
      nativeId: `p5t25-${String(n)}`,
      work: {
        ids: {
          doi: `10.5555/p5t25.${STAMP}.${String(n)}`,
        } as CanonicalWork["ids"],
        type: "journal-article",
        title,
        abstract: `An abstract on ionizable lipid delivery, number ${String(n)}.`,
        authors: [{ family: `Author${String(n)}` }],
        containerTitle: "Journal of Fixtures",
        publishedDate: { year: THIS_YEAR, iso: String(THIS_YEAR) },
      },
      retrievedAtEpochMs: Date.now(),
      missingFields: [],
    };
  }

  /** A real adapter's slot, with its requests answered here. */
  function doubled(real: LiteratureSource): LiteratureSource {
    const note = (): void => {
      asked.push({ source: real.id });
      onRequest?.();
    };
    return Object.assign(Object.create(real) as LiteratureSource, {
      isConfigured: () => true,
      findRelated: () => {
        note();
        return Promise.resolve({
          records: [],
          edges: [],
          totalAvailable: 0,
          nextCursor: undefined,
          warnings: [],
        });
      },
      lookup: () => {
        note();
        return Promise.resolve([]);
      },
      searchAll: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<SourceRecord> {
          note();
          // A request takes time when a test is watching what a cancel stops.
          await Zotero.Promise.delay(onRequest === undefined ? 0 : REQUEST_MS);
          if (real.id !== "europepmc") return;
          for (let n = 0; n < CANDIDATES; n += 1) {
            yield candidate(real.id, n);
          }
        },
      }),
    });
  }

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
      config.addonInstance
    ];
    const services = instance?.api.services;
    if (!services) assert.fail("no ServiceGraph is published at api.services");
    graph = services;
    const scholar = services.sources.get("semanticscholar") as unknown as
      { hasUsableApiKey(): Promise<boolean> } | undefined;
    assert.isFalse(
      (await scholar?.hasUsableApiKey()) === true,
      "a Semantic Scholar key is present, so this run would ask the real service",
    );
    for (const source of services.sources.list()) {
      if (source.id === "semanticscholar") continue;
      displaced.push(services.sources.replaceForTest(doubled(source)));
    }
    const http = Zotero.HTTP as unknown as {
      request: (method: string, url: string, ...rest: unknown[]) => unknown;
    };
    const realRequest = http.request;
    http.request = (method, url, ...rest) => {
      httpUrls.push(String(url));
      return realRequest.call(http, method, url, ...rest);
    };
    restoreHttp = () => {
      http.request = realRequest;
    };
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    restoreHttp?.();
    for (const source of displaced.splice(0)) {
      graph?.sources.replaceForTest(source);
    }
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs.splice(0));
    for (const collection of collections.splice(0)) {
      await collection.eraseTx();
    }
  });

  /** A collection the profile's five-item minimum lets through. */
  async function memberCollection(): Promise<Zotero.Collection> {
    const made = new Zotero.Collection({
      name: `Research Helper run (P5-T25) ${String(Date.now())}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await made.saveTx();
    collections.push(made);
    for (let n = 0; n < 6; n += 1) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", `${MEMBER_TITLE} ${String(n)}`);
      item.setField("abstractNote", `Delivery of messenger RNA, ${String(n)}.`);
      item.setField("date", String(THIS_YEAR - 1));
      item.setField("DOI", `10.5555/p5t25.member.${STAMP}.${String(n)}`);
      item.addTag(FIXTURE_TAG, AUTOMATIC);
      item.addToCollection(made.id);
      await item.saveTx();
      itemIDs.push(item.id);
    }
    return made;
  }

  /** The real pipeline, built here, with what it read counted. */
  function pipelineHere(): {
    readonly pipeline: RecommendPipeline;
    readonly reads: { count: number };
  } {
    const services = graph as Graph;
    const reads = { count: 0 };
    const library = createZoteroRecommendLibrary();
    const counted: RecommendLibrary = {
      ...library,
      readCollection: (libraryID, collectionKey) => {
        reads.count += 1;
        return library.readCollection(libraryID, collectionKey);
      },
    };
    const set = buildPipelineSet({
      writer: createZoteroSearchImportWriter(),
      recommend: {
        library: counted,
        semanticscholar: services.sources.get(
          "semanticscholar",
        ) as unknown as SemanticScholarSource,
        pubmed: {
          rateLimitKey: "pubmed.invalid",
          findSimilarForSeeds: () => {
            asked.push({ source: "pubmed-similar" });
            onRequest?.();
            return Promise.resolve([]);
          },
        } as unknown as RecommendConstructionDeps["pubmed"],
        profiles: () => services.database.collectionProfiles(),
        recommendations: () => services.database.recommendations(),
        embeddings: () => services.database.embeddings(),
        clock: services.clock,
        jobs: () => services.jobs,
        profileCall: {
          prices: () => PRICES,
          baseUrls: { effectiveHost: () => "model.invalid" },
          modelInfo: (_provider, id) =>
            mockModel(id, {
              contextWindowTokens: 200_000,
              maxOutputTokens: 64_000,
              dataPolicy: {
                trainsOnInputByDefault: "no",
                retention: { days: "zero", note: "" },
              },
            }),
          credentials: { hasKey: () => Promise.resolve(true) },
          egressAcknowledged: () => true,
        },
      },
    });
    if (!set.recommend) assert.fail("buildPipelineSet built no recommend");
    return { pipeline: set.recommend as unknown as RecommendPipeline, reads };
  }

  /** One job on the real context factory, with the model scripted. */
  async function runOn(
    pipeline: RecommendPipeline,
    input: RecommendInput,
    token: CancellationToken,
    script: Parameters<typeof mockLLM>[0],
    lines: { readonly name: string; readonly meta: unknown }[] = [],
  ): Promise<{
    readonly output: RecommendOutput;
    readonly modelCalls: number;
  }> {
    const services = graph as Graph;
    const provider = mockLLM(script, {
      id: "openrouter",
      models: [mockModel(MODEL)],
    });
    const job = await services.pipelineContext.openJob({
      pipelineId: "recommend",
      token,
    });
    const logger = Object.assign(Object.create(job.context.logger) as Logger, {
      info: (name: string, meta?: Record<string, unknown>) => {
        lines.push({ name, meta });
        job.context.logger.info(name, meta);
      },
    });
    try {
      const output = await pipeline.execute(
        input,
        {
          ...job.context,
          logger,
          // The cache is the profile's: a list the last test fetched would send nothing.
          cache: NO_CACHE,
          budget: createBudgetGuard({
            session: createSessionSpendCounter(),
            limits: { run: () => 0, session: () => 0 },
          }),
          llm: withBudget(
            mockLLMRouter(
              [provider],
              mockSettings({
                activeProvider: "openrouter",
                reportModel: MODEL,
                keyPresent: { openrouter: true },
              }),
            ),
            { pricesFor: () => PRICES, now: () => Date.now() },
          ),
        },
        {
          confirm: () =>
            Promise.resolve({
              kind: "run",
              raise: undefined,
              dontAskAgain: false,
            }),
          ask: () => Promise.resolve("cancel"),
        },
      );
      return { output, modelCalls: provider.calls.length };
    } finally {
      job.dispose();
    }
  }

  /** The job records this collection's egress log wrote through the real queue. */
  async function egressRecords(
    collectionKey: string,
  ): Promise<readonly JobRecord[]> {
    const all = await (graph as Graph).jobs.list();
    return all.filter((record) => {
      const input = record.input as {
        collectionKey?: string;
        egress?: unknown;
      };
      return (
        record.pipelineId === "recommend" &&
        input.collectionKey === collectionKey &&
        input.egress !== undefined
      );
    });
  }

  it("a cancelled job on the real pipeline reads nothing and ends Cancelled", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await memberCollection();
    const { pipeline, reads } = pipelineHere();
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const { output, modelCalls } = await runOn(
      pipeline,
      {
        libraryID: made.libraryID,
        collectionKey: made.key,
        mode: "profile-only",
      },
      source.token,
      [chatResponse(GOOD_ANSWER)],
    );
    source.dispose();
    assert.strictEqual(output.outcome, "cancelled");
    assert.strictEqual(output.stageReached, "ProfileCheck");
    assert.strictEqual(reads.count, 0, "nothing was read");
    assert.strictEqual(modelCalls, 0, "nothing was sent");
  });

  it("writes the egress record through the real queue, for a transport failure and an answer", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await memberCollection();
    const { pipeline } = pipelineHere();
    const input: RecommendInput = {
      libraryID: made.libraryID,
      collectionKey: made.key,
      mode: "profile-only",
    };
    const failed = createCancellationTokenSource();
    const first = await runOn(pipeline, input, failed.token, [
      new NetworkError("connection reset"),
    ]);
    failed.dispose();
    assert.strictEqual(first.output.outcome, "failed");
    assert.strictEqual(first.modelCalls, 1, "the request went");
    const afterFailure = await egressRecords(made.key);
    assert.strictEqual(
      afterFailure.length,
      1,
      "a transport failure leaves one",
    );
    const record = afterFailure[0] as JobRecord;
    const held = JSON.stringify(record.input);
    debug(
      `${LOG_PREFIX} egress record: status ${record.status}, input keys ` +
        `${JSON.stringify(Object.keys(record.input as object).sort())}, egress keys ` +
        JSON.stringify(
          Object.keys((record.input as { egress: object }).egress).sort(),
        ),
    );
    assert.strictEqual(record.status, "succeeded", "a finished record");
    assert.strictEqual(
      (record.input as { egress: { host: string } }).egress.host,
      "model.invalid",
    );
    assert.isFalse(held.includes(MEMBER_TITLE), "and no paper's text");

    const asked = createCancellationTokenSource();
    const second = await runOn(pipeline, input, asked.token, [
      chatResponse(GOOD_ANSWER),
    ]);
    asked.dispose();
    assert.strictEqual(second.output.outcome, "succeeded");
    assert.strictEqual(second.modelCalls, 1);
    assert.strictEqual(
      (await egressRecords(made.key)).length,
      2,
      "and an answer leaves one more",
    );
  });

  it("a real failure of the egress log stops the request and fails the run with no egress (plan/00 item 351(b))", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await memberCollection();
    const { pipeline } = pipelineHere();
    const services = graph as Graph;
    const open = await services.database.ready;
    if (open === undefined) assert.fail("the plugin database did not open");
    httpUrls.length = 0;
    const cancel = createCancellationTokenSource();
    // The real queue with no store: its own ConfigurationError is the failure.
    services.jobs.detachStore();
    let outcome: Awaited<ReturnType<typeof runOn>>;
    try {
      outcome = await runOn(
        pipeline,
        {
          libraryID: made.libraryID,
          collectionKey: made.key,
          mode: "profile-only",
        },
        cancel.token,
        [new NetworkError("this request must not go")],
      );
    } finally {
      services.jobs.attachStore(createJobStore(open.connection));
      cancel.dispose();
    }
    const { output, modelCalls } = outcome;
    debug(
      `${LOG_PREFIX} the egress log refused: outcome ${output.outcome}, ` +
        `${String(modelCalls)} model calls, egress ${String(output.egress)}, ` +
        `${JSON.stringify(httpUrls.filter((url) => !url.startsWith("http://localhost")))}`,
    );
    assert.strictEqual(output.outcome, "failed");
    assert.strictEqual(modelCalls, 0, "the request did not go");
    assert.strictEqual(output.egress, undefined, "no egress on the output");
    assert.strictEqual((await egressRecords(made.key)).length, 0, "no record");
    assert.deepEqual(
      httpUrls.filter((url) => !url.startsWith("http://localhost")),
      [],
      "nothing went out on the transport",
    );
  });

  it("a keyless run gets rows and sends nothing to Semantic Scholar, and logs scoreMs", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await memberCollection();
    const { pipeline } = pipelineHere();
    const target = { libraryID: made.libraryID, collectionKey: made.key };
    const profiling = createCancellationTokenSource();
    const built = await runOn(
      pipeline,
      { ...target, mode: "profile-only" },
      profiling.token,
      [chatResponse(GOOD_ANSWER)],
    );
    profiling.dispose();
    const profile = built.output as RecommendProfileResult;
    assert.strictEqual(profile.ending, "profile");

    httpUrls.length = 0;
    asked.length = 0;
    const lines: { readonly name: string; readonly meta: unknown }[] = [];
    const running = createCancellationTokenSource();
    const { output } = await runOn(
      pipeline,
      {
        ...target,
        mode: "edited-profile",
        profile: profile.profile,
        edits: { removedTerms: [], addedTerms: [] },
        showDismissed: false,
        peerReviewedOnly: false,
        exploration: 0.25,
      },
      running.token,
      [chatResponse(GOOD_ANSWER)],
      lines,
    );
    running.dispose();
    if (output.outcome === "failed") {
      assert.fail(`the run failed: ${JSON.stringify(output.error)}`);
    }
    const rows = output as RecommendRows;
    const scored = lines.find(({ name }) => name === "recommend: scored");
    debug(
      `${LOG_PREFIX} keyless run: ${String(rows.rows.length)} rows, keyNotice ` +
        `${String(rows.keyNotice)}, space ${rows.similarity.space}, ` +
        `${String(asked.length)} double requests, HTTP URLs ` +
        `${JSON.stringify(httpUrls.map((url) => url.split("?")[0]))}, scored ` +
        JSON.stringify(scored?.meta),
    );
    assert.strictEqual(rows.ending, "rows");
    assert.isTrue(rows.rows.length > 0, "the doubles' candidates became rows");
    assert.isTrue(rows.keyNotice, "the run says it had no key");
    assert.deepEqual(
      httpUrls.filter((url) => url.includes("semanticscholar")),
      [],
      "nothing went to api.semanticscholar.org",
    );
    assert.deepEqual(
      httpUrls.filter((url) => !url.startsWith("http://localhost")),
      [],
      "and nothing went anywhere but the test runner's own log",
    );
    assert.strictEqual(
      typeof (scored?.meta as { scoreMs?: unknown } | undefined)?.scoreMs,
      "number",
      "scoreMs, which holds lexicalSpace's build on the word space",
    );
  });

  it("a cancel stops the run within one request", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await memberCollection();
    const { pipeline } = pipelineHere();
    const target = { libraryID: made.libraryID, collectionKey: made.key };
    const profiling = createCancellationTokenSource();
    const built = await runOn(
      pipeline,
      { ...target, mode: "profile-only" },
      profiling.token,
      [chatResponse(GOOD_ANSWER)],
    );
    profiling.dispose();
    const profile = built.output as RecommendProfileResult;

    const source = createCancellationTokenSource();
    asked.length = 0;
    // The cancel comes a turn later, as a click does, with the first requests in flight.
    let atCancel = -1;
    let cancelledAt = 0;
    onRequest = () => {
      onRequest = () => undefined;
      void Zotero.Promise.delay(REQUEST_MS / 4).then(() => {
        atCancel = asked.length;
        cancelledAt = Date.now();
        source.cancel({ kind: "user" });
      });
    };
    try {
      const { output } = await runOn(
        pipeline,
        {
          ...target,
          mode: "edited-profile",
          profile: profile.profile,
          edits: { removedTerms: [], addedTerms: [] },
          showDismissed: false,
          peerReviewedOnly: false,
          exploration: 0.25,
        },
        source.token,
        [chatResponse(GOOD_ANSWER)],
      );
      const tookMs = Date.now() - cancelledAt;
      debug(
        `${LOG_PREFIX} cancel: outcome ${output.outcome}, ended at ` +
          `${output.stageReached}, ${String(tookMs)} ms after the cancel; ` +
          `${String(atCancel)} requests in flight at the cancel, ` +
          `${String(asked.length - atCancel)} started after it, of ` +
          `${JSON.stringify(asked.map(({ source: id }) => id))}`,
      );
      assert.strictEqual(output.outcome, "cancelled");
      assert.isTrue(atCancel > 0, "the cancel came with requests in flight");
      assert.strictEqual(
        asked.length,
        atCancel,
        "no request started after the cancel",
      );
      assert.isTrue(
        tookMs < REQUEST_MS * 3,
        `the run ended within one request of the cancel, not ${String(tookMs)} ms`,
      );
    } finally {
      onRequest = undefined;
      source.dispose();
    }
  });
});

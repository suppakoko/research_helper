/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T28`: the no-key path, end to end. With no Semantic Scholar key, a real related
 * window and a real recommend window run the real pipelines through the real adapters,
 * return rows from the other sources and the word-space floor, send nothing to
 * `api.semanticscholar.org`, and say what a key would add. Nothing is stubbed behind
 * `Zotero.HTTP.request`.
 *
 * **Not evidence about any service.** `Zotero.HTTP.request` is doubled by
 * `../support/noKeyTransport.ts`, which answers from committed bodies, almost all of
 * them for a request they were not recorded for, and from two hand-written answers
 * labelled there. A pass says what the pipelines and the windows do with such answers.
 * "Useful" is `P5-T30`'s, on the live services.
 */

import { config } from "../../../package.json";
import type { PluginApi } from "../../../src/addon";
import { PREF_KEYS } from "../../../src/prefs/keys";
import { SEMANTICSCHOLAR_KEY_REQUEST_URL } from "../../../src/sources/semanticscholar/semanticscholarSource";
import { openSearchWindow } from "../../../src/ui/dialogs/searchDialog";
import { qualifiedPrefName } from "../../../src/zotero/prefStore";
import {
  repositoryFixtureDir,
  zoteroFixtureIo,
} from "../../support/fixtureIo.zotero";
import { isLiveRequest } from "../support/liveRequestGuard";
import {
  createNoKeyDouble,
  loadNoKeyRecordings,
  NO_KEY_FORBIDDEN_HOST,
  NO_KEY_SEED,
  NO_KEY_SEED_DOI,
  NO_KEY_SEED_PMID,
  noKeyPaper,
  titleKey,
  type NoKeyDouble,
  type NoKeyRecordings,
  type NoKeyRoute,
} from "../support/noKeyTransport";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "../support/uiLocale";

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
  isFalse(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[no-key]";
const COLLECTION_SIZE = 30;
/** `docs/07` §8.5's default, written out: "every selected source" is the card's. */
const EVERY_SELECTED_SOURCE =
  "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv";
/** The widest `searchYears`, so the recorded 2021–2025 rows stay in the window. */
const WIDEST_WINDOW_YEARS = 20;
const NO_KEY_DETAIL = "research-helper-search-related-source-no-key";
const ANSWERED_DETAIL = "research-helper-search-source-results";
const BASIC_SIMILARITY_CHIP =
  "research-helper-search-related-chip-basic-similarity";

/** The slice of `RHSearchWindow` this spec reads and drives. */
interface NoKeyController {
  readonly state: {
    readonly initialized: boolean;
    readonly running: boolean;
    readonly panel: string;
    readonly appliedRecordsRevision: number;
    readonly rows: readonly {
      readonly key: string;
      readonly title: string;
      readonly related?: {
        readonly chips: readonly { readonly ref: { readonly id: string } }[];
      };
    }[];
  };
}
type NoKeyWindow = Window & { readonly RHSearchWindow?: NoKeyController };

function publishedApi(): PluginApi {
  const instance = (Zotero as unknown as Record<string, unknown>)[
    config.addonInstance
  ] as { api?: PluginApi } | undefined;
  if (!instance?.api) {
    assert.fail(`Zotero.${config.addonInstance}.api is absent`);
  }
  return instance.api;
}

async function waitUntil(
  predicate: () => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(25);
  }
}

/** Letters only, to keep the run's DOIs apart from any earlier run's. */
function runToken(): string {
  return `qz${Date.now()
    .toString(36)
    .replace(/[0-9]/g, (digit) => "abcdefghij".charAt(Number(digit)))}`;
}

/** Fluent wraps an argument in isolation marks; a test reads the words. */
function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/[⁨⁩]/gu, "");
}

/** The `Zotero.HTTP.request` response shape `createZoteroHttpTransport` hands on. */
function responseOf(
  url: string,
  answer: ReturnType<NoKeyDouble["answer"]>,
): unknown {
  return {
    status: answer.status,
    responseText: answer.body,
    responseURL: url,
    getAllResponseHeaders: () => `content-type: ${answer.contentType}\r\n`,
  };
}

/**
 * Put the double behind the one seam the whole real graph sends through. A request the
 * double refuses rejects, so the run reports a failed list and the spec fails on
 * `refused`. Only a request that is not the plugin's goes on to the real method:
 * Zotero's own timers do not stop for a test, and the suite's guard already lets those
 * through.
 */
function doubleTheTransport(double: NoKeyDouble): () => void {
  const http = Zotero.HTTP as unknown as {
    request: (
      method: string,
      url: string,
      options?: {
        readonly body?: string;
        readonly headers?: Readonly<Record<string, string>>;
      },
    ) => unknown;
  };
  const real = http.request;
  http.request = (method, url, options) => {
    const userAgent = options?.headers?.["User-Agent"];
    if (!isLiveRequest({ url, userAgent })) {
      return real.call(http, method, url, options);
    }
    try {
      return Promise.resolve(
        responseOf(
          url,
          double.answer({
            method,
            url,
            ...(options?.body !== undefined && { body: options.body }),
          }),
        ),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  };
  return () => {
    http.request = real;
  };
}

describe("P5-T28: no Semantic Scholar key, end to end on doubled answers", () => {
  const made: Zotero.Item[] = [];
  const PREFS_SET: readonly (readonly [string, string | boolean | number])[] = [
    [qualifiedPrefName(PREF_KEYS.recommendEnabled), true],
    [qualifiedPrefName(PREF_KEYS.sources), EVERY_SELECTED_SOURCE],
    [qualifiedPrefName(PREF_KEYS.searchYears), WIDEST_WINDOW_YEARS],
  ];
  const prefsBefore = new Map<string, unknown>();
  const token = runToken();
  let recordings: NoKeyRecordings | undefined;
  let double: NoKeyDouble | undefined;
  let restoreTransport: (() => void) | undefined;
  let collection: Zotero.Collection | undefined;
  let win: NoKeyWindow | undefined;
  let localeBefore: UILocaleSnapshot | undefined;

  before(async function () {
    this.timeout(180_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    // Reading the committed files sends nothing. Then the double goes in first, so no
    // step below can reach the suite's live request guard.
    const [pubmed, europepmc, crossref, arxiv] = await Promise.all(
      ["pubmed", "europepmc", "crossref", "arxiv"].map((source) =>
        repositoryFixtureDir(source),
      ),
    );
    if (
      pubmed === undefined ||
      europepmc === undefined ||
      crossref === undefined ||
      arxiv === undefined
    ) {
      assert.fail("a fixture directory is missing");
    }
    recordings = await loadNoKeyRecordings(
      {
        pubmed,
        europepmc,
        europepmcRelated: PathUtils.join(europepmc, "related"),
        crossref,
        crossrefRelated: PathUtils.join(crossref, "related"),
        arxiv,
      },
      zoteroFixtureIo,
    );
    double = createNoKeyDouble(recordings);
    restoreTransport = doubleTheTransport(double);

    const scholar = publishedApi().services?.sources.get(
      "semanticscholar",
    ) as unknown as { hasUsableApiKey(): Promise<boolean> } | undefined;
    assert.isFalse(
      await scholar?.hasUsableApiKey(),
      "a Semantic Scholar key is present, so this run would not be the keyless path",
    );
    for (const [name, value] of PREFS_SET) {
      prefsBefore.set(name, Zotero.Prefs.get(name, true));
      Zotero.Prefs.set(name, value, true);
    }

    collection = new Zotero.Collection({
      name: `P5-T28 ${token}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await collection.saveTx();
    for (let at = 0; at < COLLECTION_SIZE; at += 1) {
      const paper = noKeyPaper(at, token);
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", paper.title);
      item.setField("abstractNote", paper.abstract);
      item.setField("date", String(paper.year));
      item.setField("DOI", paper.doi);
      // The ecosystem's `PMID:` line, which the item reader takes on every schema.
      item.setField("extra", `PMID: ${paper.pmid}`);
      item.setCreators(
        paper.creators.map((creator) => ({
          ...creator,
          creatorType: "author" as const,
        })),
      );
      item.addToCollection(collection.id);
      await item.saveTx();
      made.push(item);
    }
  });

  after(async function () {
    this.timeout(120_000);
    win?.close();
    win = undefined;
    await Zotero.Promise.delay(250);
    for (const item of made.splice(0)) {
      await item.eraseTx();
    }
    await collection?.eraseTx();
    collection = undefined;
    for (const [name, value] of prefsBefore) {
      if (value === undefined) {
        Zotero.Prefs.clear(name, true);
      } else {
        Zotero.Prefs.set(name, value as string | boolean | number, true);
      }
    }
    prefsBefore.clear();
    restoreTransport?.();
    restoreTransport = undefined;
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  /** A XUL element, as a press reaches it. */
  function xul(id: string): Element & {
    disabled?: boolean;
    hidden?: boolean;
    doCommand(): void;
  } {
    const element = win?.document.getElementById(id);
    if (!element) assert.fail(`no element #${id}`);
    return element as never;
  }

  function doubleOf(): NoKeyDouble {
    if (!double) assert.fail("the transport was not doubled");
    return double;
  }

  function recordingsOf(): NoKeyRecordings {
    if (!recordings) assert.fail("the recordings were not read");
    return recordings;
  }

  /** The card's one absolute: zero requests to Semantic Scholar, and nothing unplanned. */
  function assertNothingForbidden(): void {
    const { calls, refused } = doubleOf();
    assert.deepEqual(
      refused,
      [],
      "the double refused a request; the first refusal says what",
    );
    assert.isFalse(
      calls.some((call) =>
        call.url.toLowerCase().includes(NO_KEY_FORBIDDEN_HOST),
      ),
      `a keyless run must send nothing to ${NO_KEY_FORBIDDEN_HOST}`,
    );
  }

  function assertAsked(routes: readonly NoKeyRoute[]): void {
    const asked = new Set(doubleOf().calls.map((call) => call.route));
    for (const route of routes) {
      assert.isTrue(asked.has(route), `nothing went to ${route}`);
    }
  }

  function logTheRun(feature: string, rows: number): void {
    const counts = new Map<string, number>();
    for (const { route, origin } of doubleOf().calls) {
      const key = `${route}/${origin}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    debug(
      `${LOG_PREFIX} ${feature}: ${String(rows)} rows; ` +
        [...counts].map(([key, n]) => `${key}=${String(n)}`).join(" "),
    );
  }

  function controllerOf(): NoKeyController {
    const controller = win?.RHSearchWindow;
    if (!controller) assert.fail("the window has no RHSearchWindow");
    return controller;
  }

  /** How many of the window's rows have a title in `titles`. */
  function rowsFrom(titles: ReadonlySet<string>): number {
    return controllerOf().state.rows.filter((row) =>
      titles.has(titleKey(row.title)),
    ).length;
  }

  /** The Fluent id of one status row's state. */
  function statusDetail(host: string, generator: string): string | null {
    const row = win?.document.getElementById(`${host}-${generator}`);
    if (!row) assert.fail(`no status row #${host}-${generator}`);
    return row.lastElementChild?.getAttribute("data-l10n-id") ?? null;
  }

  async function assertKeyNoticeSays(
    noticeId: string,
    linkId: string,
    words: string,
  ): Promise<void> {
    assert.strictEqual(xul(noticeId).hidden, false, `#${noticeId} is hidden`);
    assert.strictEqual(
      xul(linkId).getAttribute("href"),
      SEMANTICSCHOLAR_KEY_REQUEST_URL,
      `#${linkId} does not lead to the key request form`,
    );
    await waitUntil(
      () => plain(xul(noticeId).textContent).includes(words),
      `#${noticeId} to say "${words}"`,
    );
  }

  it("a DOI seed with a PMID has related rows from PubMed, Europe PMC and Crossref, and the window says what a key adds", async function () {
    this.timeout(180_000);
    const seed = new Zotero.Item("journalArticle");
    seed.libraryID = Zotero.Libraries.userLibraryID;
    seed.setField("title", NO_KEY_SEED.title);
    seed.setField("abstractNote", NO_KEY_SEED.abstract);
    seed.setField("date", String(NO_KEY_SEED.year));
    seed.setField("DOI", NO_KEY_SEED_DOI);
    seed.setField("extra", `PMID: ${NO_KEY_SEED_PMID}`);
    seed.setCreators([
      { lastName: "Seed", firstName: "Ann", creatorType: "author" },
    ]);
    await seed.saveTx();
    made.push(seed);
    doubleOf().clearCalls();

    // A real related window starts its own run, which is why the double went in first.
    win = openSearchWindow(Zotero.getMainWindow(), {
      mode: "related",
      seedItemID: seed.id,
    }) as NoKeyWindow;
    await waitUntil(
      () => win?.RHSearchWindow?.state.initialized === true,
      "the related window to open",
    );
    const controller = controllerOf();
    await waitUntil(
      () => !controller.state.running && controller.state.panel !== "initial",
      "the related run to finish",
      120_000,
    );
    logTheRun("related", controller.state.rows.length);

    assertNothingForbidden();
    assert.strictEqual(controller.state.panel, "results");
    assertAsked([
      "pubmed-elink",
      "pubmed-efetch-similar",
      "europepmc-citations",
      "europepmc-references",
      "crossref-work",
      "crossref-doi-lookup",
    ]);

    // One recorded body per list, so a row says which list found it.
    const { titles } = recordingsOf();
    assert.isAbove(rowsFrom(titles.pmra), 0, "no row from PubMed's similar");
    assert.isAbove(
      rowsFrom(titles.epmcCitations),
      0,
      "no row from Europe PMC's citations",
    );
    assert.isAbove(
      rowsFrom(titles.epmcReferences),
      0,
      "no row from Europe PMC's references",
    );
    assert.isAbove(
      rowsFrom(titles.crossrefReferences),
      0,
      "no row from Crossref's references",
    );
    assert.isTrue(
      controller.state.rows.some((row) =>
        row.related?.chips.some(
          (chip) => chip.ref.id === BASIC_SIMILARITY_CHIP,
        ),
      ),
      "no row carries the word-space floor's similarity chip",
    );

    // What a key adds: the three lists it would open read "no key", and the notice says so.
    const HOST = "rh-related-status";
    for (const generator of [
      "s2-recommendations",
      "s2-citations",
      "s2-references",
    ]) {
      assert.strictEqual(statusDetail(HOST, generator), NO_KEY_DETAIL);
    }
    for (const generator of [
      "pmra",
      "europepmc-citations",
      "europepmc-references",
      "crossref-references",
    ]) {
      assert.strictEqual(statusDetail(HOST, generator), ANSWERED_DETAIL);
    }
    await assertKeyNoticeSays(
      "rh-related-key-notice",
      "rh-related-key-request",
      "Related papers work better with a Semantic Scholar key.",
    );

    win.close();
    win = undefined;
    await Zotero.Promise.delay(250);
  });

  it("a 30-item collection has recommendations from PubMed, the keyword queries and the author watch, with the abstract fill-in running, and the window says what a key adds", async function () {
    this.timeout(240_000);
    const source = collection;
    if (!source) assert.fail("the collection was not made");
    doubleOf().clearCalls();

    publishedApi().recommendWindow?.open(Zotero.getMainWindow(), source.id);
    await waitUntil(() => {
      const windows = Services.wm.getEnumerator(null as unknown as string);
      while (windows.hasMoreElements()) {
        const candidate = windows.getNext() as unknown as NoKeyWindow;
        if (
          !candidate.closed &&
          candidate.RHSearchWindow?.state.initialized === true
        ) {
          win = candidate;
          return true;
        }
      }
      return false;
    }, "the recommend window to open");
    const controller = controllerOf();

    xul("rh-recommend-build").doCommand();
    await waitUntil(
      () => xul("rh-recommend-profile").hidden === false,
      "the profile panel",
      120_000,
    );
    assert.strictEqual(
      xul("rh-recommend-heuristic").hidden,
      false,
      "with no provider the profile is the heuristic one",
    );

    const before = controller.state.appliedRecordsRevision;
    await waitUntil(
      () => xul("rh-recommend-find").disabled === false,
      "Find papers to be on offer",
    );
    xul("rh-recommend-find").doCommand();
    await waitUntil(
      () =>
        controller.state.appliedRecordsRevision > before &&
        !controller.state.running &&
        xul("rh-recommend-find").disabled === false,
      "a list to land",
      180_000,
    );
    logTheRun("recommend", controller.state.rows.length);

    assertNothingForbidden();
    assert.isAbove(controller.state.rows.length, 0, "no recommendation");
    // bioRxiv and medRxiv have no keyword search, and send nothing: `refused` above
    // would hold them. Semantic Scholar is dropped from the list without a key.
    assertAsked([
      "pubmed-elink",
      "pubmed-efetch-similar",
      "pubmed-esearch",
      "pubmed-efetch-keyword",
      "europepmc-keyword",
      "crossref-keyword",
      "arxiv-keyword",
      "europepmc-author-watch",
      "europepmc-doi-lookup",
    ]);

    const { titles, withoutAbstract } = recordingsOf();
    assert.isAbove(rowsFrom(titles.pmra), 0, "no row from PubMed's similar");
    assert.isAbove(
      rowsFrom(titles.epmcKeyword),
      0,
      "no row from the keyword queries",
    );
    assert.isAbove(
      rowsFrom(titles.epmcAuthorWatch),
      0,
      "no row from the author watch",
    );

    // A recorded Crossref row with no abstract is dropped by `contentFilters` unless the
    // fill-in finds one, so a row here can only be there through the fill-in. The
    // abstract it found is hand-written, in `noKeyTransport.ts`.
    const shown = new Set(
      controller.state.rows.map((row) => titleKey(row.title)),
    );
    assert.isTrue(
      withoutAbstract.some(
        (work) =>
          doubleOf().filledIn(work.doi) && shown.has(titleKey(work.title)),
      ),
      "no row is there through the abstract fill-in",
    );

    const HOST = "rh-recommend-status";
    assert.strictEqual(xul(HOST).hidden, false, "no status row is drawn");
    assert.strictEqual(statusDetail(HOST, "recommendations"), NO_KEY_DETAIL);
    for (const generator of ["similar", "keyword-search", "author-watch"]) {
      assert.strictEqual(statusDetail(HOST, generator), ANSWERED_DETAIL);
    }
    await assertKeyNoticeSays(
      "rh-recommend-key-notice",
      "rh-recommend-key-request",
      "Recommendations work better with a Semantic Scholar key.",
    );
  });
});

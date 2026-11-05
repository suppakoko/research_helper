/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T16` and `P5-T17`: what only a real related window on the real published host
 * can say, written in the integration round of 2026-11-05 (`plan/00` §6 item 347(d)).
 * `searchDialog-flow.spec.ts` has the populated table; this file has three things that
 * needed fixtures of their own.
 *
 * 1. **Markup in source text.** A source's title, an author's name and a citation
 *    context are data. The window puts some of them in a Fluent argument, and
 *    `DOMLocalization` parses a message's value for safe-listed markup, so this reads
 *    what a real window draws for each of them.
 * 2. **A run's end.** A second seed cancels the first run with no toast, and closing
 *    the window cancels.
 * 3. **The wiring no unit reaches.** The seed-link preference is read (`wire-pref`),
 *    and the seed's own library receives the import (`wire-library`), which needs a
 *    real group.
 *
 * Every source the related pipeline asks is a stub in the real registry's slot, and
 * Semantic Scholar has no key, so its lists read "no key" and send nothing. The suite's
 * live request guard (`./support/liveRequestGuard.ts`) cancels and fails anything else.
 */

import { config } from "../../package.json";
import type { PluginApi } from "../../src/addon";
import type { CanonicalWork } from "../../src/model/canonicalWork";
import type { SourceId } from "../../src/model/ids";
import type { SourceRecord } from "../../src/model/sourceRecord";
import { PREF_KEYS } from "../../src/prefs/keys";
import type {
  LiteratureSource,
  RelatedPage,
  SourceCallContext,
} from "../../src/sources/types";
import type { SourceRegistry } from "../../src/sources/registry";
import { openSearchWindow } from "../../src/ui/dialogs/searchDialog";
import { qualifiedPrefName } from "../../src/zotero/prefStore";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

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

const LOG_PREFIX = "[related-window]";
const STUBBED: readonly SourceId[] = ["pubmed", "europepmc", "crossref"];
const THIS_YEAR = new Date().getFullYear();

/** The fragments the coordinator named, and the two a real title can hold. */
const IMG = "<img src=x onerror=y>";
const LINK = '<a href="https://example.invalid">x</a>';
const EM = "<em>x</em>";
const ENTITY = "A &amp; B &lt;c&gt;";
const LESS_THAN = "p < 0.05 & q > 1";

interface RelatedController {
  readonly state: {
    readonly initialized: boolean;
    readonly running: boolean;
    readonly panel: string;
    readonly rows: readonly {
      readonly key: string;
      readonly title: string;
    }[];
    readonly selection: string[];
    readonly selectedCount: number;
  };
  import(): void;
}
type RelatedWindow = Window & {
  readonly RHSearchWindow?: RelatedController;
};

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
  timeoutMs = 25_000,
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

function emptyPage(): RelatedPage {
  return {
    records: [],
    edges: [],
    totalAvailable: 0,
    nextCursor: undefined,
    warnings: [],
  };
}

function record(
  sourceId: SourceId,
  native: string,
  title: string,
  doi: string,
  authors: CanonicalWork["authors"],
): SourceRecord {
  return {
    id: `${sourceId}:${native}`,
    sourceId,
    nativeId: native,
    work: {
      ids: { doi } as CanonicalWork["ids"],
      type: "journal-article",
      title,
      authors,
      publishedDate: { year: THIS_YEAR, iso: String(THIS_YEAR) },
    },
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
  };
}

/** A source with only what the related pipeline reads of it. */
function relatedStub(
  id: SourceId,
  slot: LiteratureSource | undefined,
  findRelated: LiteratureSource["findRelated"],
  lookup: LiteratureSource["lookup"],
): LiteratureSource {
  return {
    id,
    displayNameKey: slot?.displayNameKey ?? "",
    rateLimitKey: `${id}.invalid`,
    capabilities: {
      keywordSearch: true,
      query: { or: true, not: true, phrase: true, fields: ["title"] },
      relatedByWork: false,
      lookupById: ["doi"],
      abstractsInSearch: true,
      citationGraph: false,
      dateFilter: false,
      filters: { languages: false, openAccess: false },
      maxPageSize: 100,
      maxTotalResults: undefined,
      benefitsFromApiKey: false,
    },
    isConfigured: () => true,
    healthCheck: () =>
      Promise.resolve({
        ok: true,
        messageKey: "rh-error-source",
        latencyMs: 0,
      }),
    search: () => assert.fail("the related pipeline does not search"),
    searchAll: () => assert.fail("the related pipeline does not search"),
    explainQuery: () => "related stub",
    ...(findRelated !== undefined && { findRelated }),
    ...(lookup !== undefined && { lookup }),
  };
}

/** Put stubs in the real registry's slots, and hand back how to undo it. */
async function withStubs(
  make: (id: SourceId, slot: LiteratureSource | undefined) => LiteratureSource,
): Promise<() => void> {
  const services = publishedApi().services;
  if (!services) {
    assert.fail("registerUI() published no ServiceGraph at api.services");
  }
  const scholar = services.sources.get("semanticscholar") as unknown as
    { hasUsableApiKey(): Promise<boolean> } | undefined;
  assert.isFalse(
    await scholar?.hasUsableApiKey(),
    "a Semantic Scholar key is present, so a run here would ask the real service",
  );
  const registry: SourceRegistry = services.sources;
  const displaced: LiteratureSource[] = [];
  for (const id of STUBBED) {
    const stub = make(id, registry.get(id));
    displaced.push(registry.replaceForTest(stub));
    assert.strictEqual(
      registry.get(id),
      stub,
      `the stub is not in ${id}'s slot`,
    );
  }
  return () => {
    for (const adapter of displaced) {
      registry.replaceForTest(adapter);
    }
  };
}

async function savedArticle(
  title: string,
  doi: string,
  libraryID: number = Zotero.Libraries.userLibraryID,
  creators: readonly { lastName: string; firstName: string }[] = [],
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = libraryID;
  item.setField("title", title);
  item.setField("date", String(THIS_YEAR));
  item.setField("DOI", doi);
  if (creators.length > 0) {
    item.setCreators(
      creators.map((creator) => ({ ...creator, creatorType: "author" })),
    );
  }
  await item.saveTx();
  return item;
}

function openRelated(seedItemID: number): RelatedWindow {
  return openSearchWindow(Zotero.getMainWindow(), {
    mode: "related",
    seedItemID,
  }) as RelatedWindow;
}

async function initialized(win: RelatedWindow): Promise<RelatedController> {
  await waitUntil(
    () => win.RHSearchWindow?.state.initialized === true,
    "RHSearchWindow.init() to have run",
    30_000,
  );
  const controller = win.RHSearchWindow;
  if (!controller) {
    assert.fail("the window loaded without RHSearchWindow");
  }
  return controller;
}

async function finished(win: RelatedWindow): Promise<RelatedController> {
  const controller = await initialized(win);
  await waitUntil(
    () => !controller.state.running && controller.state.panel !== "initial",
    "the related run to finish, which it starts by itself",
    60_000,
  );
  return controller;
}

/** Every element under `root`, by name, with the attributes that could do harm. */
function elementsUnder(root: Element): string[] {
  return (Array.from(root.querySelectorAll("*")) as Element[]).map((node) => {
    const attributes = (Array.from(node.attributes) as Attr[])
      .filter((attribute) => !attribute.name.startsWith("data-l10n"))
      .map((attribute) => `${attribute.name}=${attribute.value}`);
    return [node.localName, ...attributes].join(" ");
  });
}

/** Text without Fluent's isolation marks, which are not the source's. */
function plain(text: string | null): string {
  return (text ?? "").replace(/[⁨⁩]/gu, "");
}

describe("Related window: markup in a source's text is drawn as text (plan/00 item 347(d))", () => {
  const STAMP = String(Date.now());
  const TITLES: Readonly<Record<string, string>> = {
    img: `P350 img ${IMG} end`,
    link: `P350 link ${LINK} end`,
    em: `P350 em ${EM} end`,
    entity: `P350 entity ${ENTITY} end`,
    lessThan: `P350 less ${LESS_THAN} end`,
  };
  const CONTEXT = `P350 context ${IMG} ${LINK} ${EM} end`;
  const SEED_TITLE = `P350 seed ${EM} end`;
  const MARKED_AUTHORS: CanonicalWork["authors"] = [
    { family: `Ana${IMG}` },
    { family: `Bo${LINK}` },
    { family: `Cy${EM}` },
    { family: "Di" },
    { family: "Ed" },
  ];
  const seedDoi = `10.5555/p350.seed.${STAMP}`;
  const doiOf = (name: string): string => `10.5555/p350.${name}.${STAMP}`;

  let undo: (() => void) | undefined;
  let localeBefore: UILocaleSnapshot | undefined;
  let win: RelatedWindow | undefined;
  let seed: Zotero.Item | undefined;
  const owned: Zotero.Item[] = [];

  function page(id: SourceId, strategy: unknown): RelatedPage {
    if (id !== "europepmc" || strategy !== "citations") return emptyPage();
    const records = [
      ...Object.entries(TITLES).map(([name, title]) =>
        record(id, `p350-${name}`, title, doiOf(name), [{ family: "Plain" }]),
      ),
      // Not in the library, so its authors take the overflow message on their own.
      record(
        id,
        "p350-authors",
        "P350 a paper with marked authors",
        doiOf("authors"),
        MARKED_AUTHORS,
      ),
    ];
    return {
      ...emptyPage(),
      records,
      totalAvailable: records.length,
      edges: records.map((_, at) => ({
        kind: "citation" as const,
        rank: at + 1,
        ...(at === 0 ? { contexts: [CONTEXT] } : {}),
      })),
    };
  }

  before(async function () {
    this.timeout(120_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    undo = await withStubs((id, slot) =>
      relatedStub(
        id,
        slot,
        (query) => Promise.resolve(page(id, query.strategy)),
        () => {
          const base = record(id, "seed", SEED_TITLE, seedDoi, []);
          return Promise.resolve([
            {
              ...base,
              work: {
                ...base.work,
                ids: { doi: seedDoi, pmid: "39000350" } as CanonicalWork["ids"],
              },
            },
          ]);
        },
      ),
    );
    seed = await savedArticle(
      SEED_TITLE,
      seedDoi,
      Zotero.Libraries.userLibraryID,
      MARKED_AUTHORS.map((author, at) => ({
        lastName: author.family ?? `Author${String(at)}`,
        firstName: "",
      })),
    );
    for (const [name, title] of Object.entries(TITLES)) {
      owned.push(await savedArticle(title, doiOf(name)));
    }
    win = openRelated(seed.id);
    const controller = await finished(win);
    assert.strictEqual(controller.state.panel, "results");
  });

  after(async function () {
    this.timeout(60_000);
    win?.close();
    win = undefined;
    await Zotero.Promise.delay(250);
    undo?.();
    undo = undefined;
    for (const item of owned.splice(0)) {
      await item.eraseTx();
    }
    await seed?.eraseTx();
    seed = undefined;
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  function rowElement(title: string): Element {
    const opened = win as RelatedWindow;
    const key = opened.RHSearchWindow?.state.rows.find(
      (row) => row.title === title,
    )?.key;
    if (key === undefined) {
      assert.fail(`no row holds the title ${title}`);
    }
    const found = Array.from(
      opened.document.getElementById("rh-results-body")?.children ?? [],
    ).find((tr) => tr.getAttribute("data-rh-row-key") === key);
    if (!found) {
      assert.fail(`the row titled ${title} is not drawn`);
    }
    return found;
  }

  /** The span the in-library message landed on, once Fluent has written it. */
  async function existingLine(title: string): Promise<Element> {
    const row = rowElement(title);
    const line = row.querySelector(
      '[data-l10n-id="research-helper-search-row-existing"]',
    );
    if (!line) {
      assert.fail(`the row titled ${title} has no in-library line`);
    }
    await waitUntil(
      () => plain(line.textContent).startsWith("Already in library"),
      `the in-library words for ${title}`,
    );
    return line;
  }

  for (const [name, title] of Object.entries(TITLES)) {
    it(`draws an in-library title holding ${name} as the words it holds, with no element`, async () => {
      const line = await existingLine(title);
      debug(
        `${LOG_PREFIX} in-library ${name}: innerHTML ${line.innerHTML} | text ` +
          `${plain(line.textContent)} | elements ` +
          JSON.stringify(elementsUnder(line)),
      );
      assert.deepEqual(
        elementsUnder(line),
        [],
        "no element is made of a title",
      );
      assert.strictEqual(
        plain(line.textContent),
        `Already in library: ${title}`,
        "and every word of it is drawn, as written",
      );
    });
  }

  it("draws a marked author's name as text, in the row and on the seed's chip", async () => {
    const row = rowElement("P350 a paper with marked authors");
    const cell = row.querySelector(".rh-col-authors");
    const opened = win as RelatedWindow;
    const chip = opened.document.getElementById("rh-related-seed-authors");
    if (!cell || !chip) {
      assert.fail("no authors cell, or no authors on the seed");
    }
    await waitUntil(
      () => /\+2$/u.test(plain(cell.textContent)),
      "the row's overflow message",
    );
    await waitUntil(
      () => /\+2$/u.test(plain(chip.textContent)),
      "the seed's overflow message",
    );
    debug(
      `${LOG_PREFIX} authors cell: innerHTML ${cell.innerHTML} | elements ` +
        `${JSON.stringify(elementsUnder(cell))}`,
    );
    debug(
      `${LOG_PREFIX} seed authors: innerHTML ${chip.innerHTML} | elements ` +
        `${JSON.stringify(elementsUnder(chip))}`,
    );
    assert.deepEqual(elementsUnder(cell), [], "the row's authors");
    assert.deepEqual(elementsUnder(chip), [], "the seed's authors");
    for (const fragment of [IMG, LINK, EM]) {
      assert.include(
        plain(cell.textContent),
        fragment,
        "the row keeps the words",
      );
      assert.include(
        plain(chip.textContent),
        fragment,
        "the seed keeps the words",
      );
    }
  });

  it("draws a citation context holding markup as text, with no element", async () => {
    const title = TITLES["img"] ?? "";
    const row = rowElement(title);
    const line = row.querySelector(".rh-related-context");
    if (!line) {
      assert.fail("the row has no context line");
    }
    await waitUntil(
      () => plain(line.textContent).includes(CONTEXT),
      "the context",
    );
    debug(
      `${LOG_PREFIX} context: innerHTML ${line.innerHTML} | title attribute ` +
        `${line.getAttribute("title") ?? ""} | elements ` +
        JSON.stringify(elementsUnder(line)),
    );
    const words = line.lastElementChild;
    if (!words) {
      assert.fail("the context line has no words");
    }
    assert.deepEqual(
      (Array.from(line.children) as Element[]).map((node) => node.localName),
      ["span", "span"],
      "the label and the words, which the window built",
    );
    assert.deepEqual(
      elementsUnder(words),
      [],
      "no element is made of a context",
    );
    assert.strictEqual(
      plain(words.textContent),
      CONTEXT,
      "the words as written",
    );
    assert.strictEqual(line.getAttribute("title"), CONTEXT, "the tooltip");
  });

  it("draws the seed's own title as text, in the header and on the mode chip", async () => {
    const opened = win as RelatedWindow;
    const header = opened.document.getElementById("rh-related-seed-title");
    const chip = opened.document.getElementById("rh-search-mode");
    if (!header || !chip) {
      assert.fail("the seed header or the mode chip is missing");
    }
    await waitUntil(
      () => plain(chip.getAttribute("value")).startsWith("Related to:"),
      "the chip's words",
    );
    debug(
      `${LOG_PREFIX} seed title: innerHTML ${header.innerHTML} | chip value ` +
        `${plain(chip.getAttribute("value"))} | chip children ` +
        JSON.stringify(elementsUnder(chip)),
    );
    assert.deepEqual(elementsUnder(header), []);
    assert.deepEqual(elementsUnder(chip), []);
    assert.include(plain(header.textContent), EM);
    assert.include(plain(chip.getAttribute("value")), EM);
  });
});

describe("Related window: a run's end (P5-T16 line 12)", () => {
  const STAMP = String(Date.now());
  let undo: (() => void) | undefined;
  const made: Zotero.Item[] = [];
  /** How many lists are in flight, and how many ended on a cancel. */
  const lists = { started: 0, cancelled: 0 };
  /** How many toasts a window raised. */
  let toasts = 0;
  let restoreToasts: (() => void) | undefined;

  /** A list that holds until its token is cancelled. */
  async function hanging(ctx: SourceCallContext): Promise<RelatedPage> {
    lists.started += 1;
    for (;;) {
      if (ctx.token.isCancellationRequested) {
        lists.cancelled += 1;
        ctx.token.throwIfCancelled();
      }
      await Zotero.Promise.delay(25);
    }
  }

  before(async function () {
    this.timeout(90_000);
    undo = await withStubs((id, slot) =>
      relatedStub(
        id,
        slot,
        (_query, ctx) => hanging(ctx),
        () => {
          const doi = `10.5555/p350.hang.${STAMP}`;
          const base = record(id, "hang-seed", "P350 hanging seed", doi, []);
          return Promise.resolve([
            {
              ...base,
              work: {
                ...base.work,
                ids: { doi, pmid: "39000351" } as CanonicalWork["ids"],
              },
            },
          ]);
        },
      ),
    );
    made.push(
      await savedArticle("P350 first seed", `10.5555/p350.first.${STAMP}`),
      await savedArticle("P350 second seed", `10.5555/p350.second.${STAMP}`),
    );
    const platform = Zotero as unknown as {
      ProgressWindow: new (...args: unknown[]) => unknown;
    };
    const Real = platform.ProgressWindow;
    platform.ProgressWindow = new Proxy(Real, {
      construct(target, args, newTarget) {
        toasts += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    restoreToasts = () => {
      platform.ProgressWindow = Real;
    };
  });

  after(async function () {
    this.timeout(60_000);
    restoreToasts?.();
    undo?.();
    undo = undefined;
    for (const item of made.splice(0)) {
      await item.eraseTx();
    }
  });

  it("re-opening on a second seed cancels the first run with no toast, and closing cancels", async function () {
    this.timeout(90_000);
    const [first, second] = made;
    if (!first || !second) {
      assert.fail("the seeds were not made");
    }
    const jobs = publishedApi().services?.jobs;
    const opened = openRelated(first.id);
    let closed = false;
    try {
      const controller = await initialized(opened);
      await waitUntil(
        () => lists.started > 0,
        "the first run's lists to start",
      );
      assert.isTrue(controller.state.running, "the first run is going");
      const startedByFirst = lists.started;
      const toastsBefore = toasts;

      // The same window name: the window reloads on the second seed.
      const again = openRelated(second.id);
      await waitUntil(
        () => lists.cancelled >= startedByFirst,
        "every list of the first run to see the cancel",
      );
      await waitUntil(
        () => lists.started > startedByFirst,
        "the second run's lists to start",
      );
      await waitUntil(
        () =>
          again.document.getElementById("rh-related-seed-title")
            ?.textContent === "P350 second seed",
        "the second seed's title",
      );
      assert.strictEqual(
        again.RHSearchWindow?.state.running,
        true,
        "the second run is going",
      );
      // A toast would come at once, from the cancel: this is more than long enough.
      await Zotero.Promise.delay(250);
      debug(
        `${LOG_PREFIX} re-open: first run's ${String(startedByFirst)} lists all ` +
          `cancelled, ${String(toasts - toastsBefore)} toasts`,
      );
      assert.strictEqual(toasts, toastsBefore, "a left run raises no toast");

      const startedBySecond = lists.started;
      again.close();
      closed = true;
      await waitUntil(
        () => lists.cancelled >= startedBySecond,
        "closing the window to cancel the run",
      );
      await Zotero.Promise.delay(250);
      debug(
        `${LOG_PREFIX} close: ${String(lists.cancelled)} of ` +
          `${String(startedBySecond)} lists cancelled, ` +
          `${String(toasts - toastsBefore)} toasts`,
      );
      assert.strictEqual(
        toasts,
        toastsBefore,
        "closing raises no toast either",
      );
    } finally {
      if (!closed) {
        opened.close();
        await Zotero.Promise.delay(250);
      }
    }
    if (jobs) {
      const left = (await jobs.list()).filter(
        (job) => job.pipelineId === "related" && job.status === "running",
      );
      assert.strictEqual(left.length, 0, "no related job is left running");
    }
  });
});

describe("Related window: the import's wiring (P5-T17's wire-pref and wire-library)", () => {
  const STAMP = String(Date.now());
  const TITLE_A = "P350 group import A";
  const TITLE_B = "P350 group import B";
  const SEED_TITLE = "P350 group seed";
  const seedDoi = `10.5555/p350.group.${STAMP}`;
  const PREF = qualifiedPrefName(PREF_KEYS.relatedLinkToSeed);

  interface FixtureGroup {
    id: number;
    name: string;
    description: string;
    editable: boolean;
    filesEditable: boolean;
    version: number;
    readonly libraryID: number;
    saveTx(): Promise<unknown>;
    eraseTx(): Promise<unknown>;
  }

  let undo: (() => void) | undefined;
  let group: FixtureGroup | undefined;
  let seed: Zotero.Item | undefined;
  let localeBefore: UILocaleSnapshot | undefined;

  before(async function () {
    this.timeout(90_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    undo = await withStubs((id, slot) =>
      relatedStub(
        id,
        slot,
        (query) => {
          if (id !== "europepmc" || query.strategy !== "citations") {
            return Promise.resolve(emptyPage());
          }
          const records = [
            record(id, "group-a", TITLE_A, `10.5555/p350.a.${STAMP}`, []),
            record(id, "group-b", TITLE_B, `10.5555/p350.b.${STAMP}`, []),
          ];
          return Promise.resolve({
            ...emptyPage(),
            records,
            totalAvailable: 2,
            edges: records.map((_, at) => ({
              kind: "citation" as const,
              rank: at + 1,
            })),
          });
        },
        () => {
          const base = record(id, "group-seed", SEED_TITLE, seedDoi, []);
          return Promise.resolve([
            {
              ...base,
              work: {
                ...base.work,
                ids: { doi: seedDoi, pmid: "39000352" } as CanonicalWork["ids"],
              },
            },
          ]);
        },
      ),
    );
    const made = new (
      Zotero as unknown as { Group: new () => FixtureGroup }
    ).Group();
    made.id = 91_000_000 + (Date.now() % 1_000_000);
    made.name = `Research Helper related window ${STAMP}`;
    made.description = "";
    made.editable = true;
    made.filesEditable = true;
    made.version = 1;
    await made.saveTx();
    group = made;
    seed = await savedArticle(SEED_TITLE, seedDoi, made.libraryID);
  });

  after(async function () {
    this.timeout(60_000);
    undo?.();
    undo = undefined;
    await group?.eraseTx();
    group = undefined;
    seed = undefined;
    Services.prefs.clearUserPref(PREF);
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  it("starts the link box from the preference (wire-pref)", async function () {
    this.timeout(90_000);
    if (!seed) {
      assert.fail("no seed");
    }
    Zotero.Prefs.set(PREF, false, true);
    const opened = openRelated(seed.id);
    try {
      await finished(opened);
      const box = opened.document.getElementById(
        "rh-related-link-seed",
      ) as unknown as { checked: boolean };
      assert.isFalse(box.checked, "the preference says off, so the box is off");
    } finally {
      opened.close();
      await Zotero.Promise.delay(250);
      Services.prefs.clearUserPref(PREF);
    }
  });

  it("imports into the seed's own library, a group here, related both ways (wire-library)", async function () {
    this.timeout(90_000);
    if (!seed || !group) {
      assert.fail("no seed or no group");
    }
    assert.isTrue(
      group.libraryID !== Zotero.Libraries.userLibraryID,
      "a group has a library of its own",
    );
    const opened = openRelated(seed.id);
    try {
      const controller = await finished(opened);
      assert.isAbove(controller.state.selectedCount, 0, "rows are ticked");
      controller.import();
      const notices = (): string =>
        opened.document.getElementById("rh-search-notices")?.textContent ?? "";
      await waitUntil(
        () => !controller.state.running && notices() !== "",
        "the import to be drawn",
        45_000,
      );
      const collection = Zotero.Collections.getByLibrary(group.libraryID).find(
        (one) => one.name === `Related to “${SEED_TITLE}”`,
      );
      if (!collection) {
        assert.fail("the seed's collection is not in the seed's library");
      }
      const written = (await Zotero.Items.getAsync(
        collection.getChildItems(true),
      )) as Zotero.Item[];
      debug(
        `${LOG_PREFIX} group import: ${String(written.length)} items in library ` +
          `${String(group.libraryID)}`,
      );
      assert.deepEqual(written.map((item) => item.getField("title")).sort(), [
        TITLE_A,
        TITLE_B,
      ]);
      for (const item of written) {
        assert.strictEqual(item.libraryID, group.libraryID, "in the group");
        assert.isTrue(
          item.relatedItems.includes(seed.key),
          "the item names the seed",
        );
        assert.isTrue(
          seed.relatedItems.includes(item.key),
          "the seed names it",
        );
      }
      assert.isFalse(
        Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID).some(
          (one) => one.name === `Related to “${SEED_TITLE}”`,
        ),
        "nothing landed in the user's library",
      );
    } finally {
      opened.close();
      await Zotero.Promise.delay(250);
    }
  });
});

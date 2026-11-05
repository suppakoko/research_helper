/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T27`: the card's flow in a real window on the real published host. Build the
 * profile, edit it, find papers, dismiss one, import 5 into the dated subcollection,
 * then find again: 5 items present, and the dismissed paper absent until it is asked for.
 *
 * **Not evidence about any service.** `Zotero.HTTP.request` is doubled before anything
 * runs, and Europe PMC is answered from one hand-written page in `recommendPage.ts`. Every URL is
 * recorded, nothing goes out, and there is no Semantic Scholar key, so the run is the
 * keyless path: a word-space list with no group headings. Headings are `test/unit`'s.
 *
 * `recommendWindow.spec.ts` holds what the window has to say beyond this flow.
 */

import { config } from "../../../package.json";
import type { PluginApi } from "../../../src/addon";
import { PREF_KEYS } from "../../../src/prefs/keys";
import { qualifiedPrefName } from "../../../src/zotero/prefStore";
import {
  doubleTheTransport,
  EUROPE_PMC_SEARCH,
  runToken,
} from "../support/recommendPage";
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
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[recommend-flow]";
const SEMANTIC_SCHOLAR_HOST = "api.semanticscholar.org";
const THIS_YEAR = new Date().getFullYear();
const ROWS_ON_THE_PAGE = 8;
const ITEMS_TO_IMPORT = 5;
const SAVED_ITEMS = 6;

/** The slice of `RHSearchWindow` this spec reads and drives. */
interface FlowController {
  readonly state: {
    readonly initialized: boolean;
    readonly running: boolean;
    readonly appliedRecordsRevision: number;
    readonly rows: readonly { readonly key: string; readonly title: string }[];
    readonly visible: readonly {
      readonly key: string;
      readonly title: string;
    }[];
    readonly selection: readonly string[];
    readonly selectedCount: number;
  };
  readonly spec: { readonly row: { readonly keyAttribute: string } };
  import(): void;
}
type FlowWindow = Window & { readonly RHSearchWindow?: FlowController };

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
  timeoutMs = 45_000,
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

describe("P5-T27: recommendations, end to end on a doubled transport", () => {
  const made: Zotero.Item[] = [];
  const RECOMMEND_PREF = qualifiedPrefName(PREF_KEYS.recommendEnabled);
  const SOURCES_PREF = qualifiedPrefName(PREF_KEYS.sources);
  const token = runToken();
  let recommendBefore: unknown;
  let sourcesBefore: unknown;
  let source: Zotero.Collection | undefined;
  let transport: ReturnType<typeof doubleTheTransport> | undefined;
  let win: FlowWindow | undefined;
  let localeBefore: UILocaleSnapshot | undefined;

  before(async function () {
    this.timeout(120_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    // First, so no step below can reach the suite's live request guard.
    transport = doubleTheTransport(token, { rows: ROWS_ON_THE_PAGE });
    const scholar = publishedApi().services?.sources.get(
      "semanticscholar",
    ) as unknown as { hasUsableApiKey(): Promise<boolean> } | undefined;
    assert.isFalse(
      await scholar?.hasUsableApiKey(),
      "a Semantic Scholar key is present, so this run would not be the keyless path",
    );
    recommendBefore = Zotero.Prefs.get(RECOMMEND_PREF, true);
    sourcesBefore = Zotero.Prefs.get(SOURCES_PREF, true);
    Zotero.Prefs.set(RECOMMEND_PREF, true, true);
    Zotero.Prefs.set(SOURCES_PREF, "europepmc", true);

    source = new Zotero.Collection({
      name: `P5-T27 ${token}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await source.saveTx();
    for (let at = 0; at < SAVED_ITEMS; at += 1) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField(
        "title",
        `Saved paper ${String(at)} on hepatocyte lipid nanoparticle ${token}`,
      );
      item.setField("abstractNote", "A saved abstract on lipid nanoparticles.");
      item.setField("date", String(THIS_YEAR - 1));
      item.setField("DOI", `10.5556/${token}.${String(at)}`);
      item.setCreators([
        { lastName: "Saved", firstName: "Author", creatorType: "author" },
      ]);
      item.addToCollection(source.id);
      await item.saveTx();
      made.push(item);
    }
  });

  after(async function () {
    this.timeout(120_000);
    win?.close();
    win = undefined;
    await Zotero.Promise.delay(250);
    for (const child of source
      ? Zotero.Collections.getByParent(source.id)
      : []) {
      for (const item of child.getChildItems(false)) {
        await item.eraseTx();
      }
      await child.eraseTx();
    }
    for (const item of made.splice(0)) {
      await item.eraseTx();
    }
    await source?.eraseTx();
    source = undefined;
    for (const [name, value] of [
      [RECOMMEND_PREF, recommendBefore],
      [SOURCES_PREF, sourcesBefore],
    ] as const) {
      if (value === undefined) {
        Zotero.Prefs.clear(name, true);
      } else {
        Zotero.Prefs.set(name, value as string | boolean, true);
      }
    }
    transport?.restore();
    transport = undefined;
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  /** A XUL button or checkbox, as a press reaches it. */
  function xul(id: string): Element & {
    disabled?: boolean;
    hidden?: boolean;
    checked?: boolean;
    value?: string;
    doCommand(): void;
  } {
    const element = win?.document.getElementById(id);
    if (!element) assert.fail(`no element #${id}`);
    return element as never;
  }

  function controllerOf(): FlowController {
    const controller = win?.RHSearchWindow;
    if (!controller) assert.fail("the window has no RHSearchWindow");
    return controller;
  }

  function rowElement(key: string): Element {
    const attribute = controllerOf().spec.row.keyAttribute;
    const body = win?.document.getElementById("rh-results-body");
    const found = [...(body?.children ?? [])].find(
      (tr) => tr.getAttribute(attribute) === key,
    );
    if (!found) assert.fail(`no row for ${key}`);
    return found;
  }

  /** Press Find papers and wait for the new list to land. */
  async function findPapers(): Promise<void> {
    const controller = controllerOf();
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
    );
  }

  it("builds, edits, finds, dismisses, imports 5 into the dated subcollection, and finds again", async function () {
    this.timeout(240_000);
    const collection = source;
    if (!collection) assert.fail("the collection was not made");
    publishedApi().recommendWindow?.open(Zotero.getMainWindow(), collection.id);
    await waitUntil(() => {
      const windows = Services.wm.getEnumerator(null as unknown as string);
      while (windows.hasMoreElements()) {
        const candidate = windows.getNext() as unknown as FlowWindow;
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

    // Nothing is sent before a button is pressed (docs/08 §5.4).
    assert.strictEqual(xul("rh-recommend-find").disabled, true);
    assert.deepEqual(transport?.urls, [], "the window sent nothing by itself");
    assert.strictEqual(
      xul("rh-recommend-slider").value,
      "25",
      "the slider starts at 25",
    );

    // Build, and edit: one term out.
    xul("rh-recommend-build").doCommand();
    await waitUntil(
      () => xul("rh-recommend-profile").hidden === false,
      "the profile panel",
    );
    assert.strictEqual(
      xul("rh-recommend-heuristic").hidden,
      false,
      "with no provider the profile is the heuristic one",
    );
    const chips = win?.document.getElementById("rh-recommend-terms");
    const remove = chips?.querySelector("button");
    if (!remove) assert.fail("the profile has no term to remove");
    (remove as unknown as { click(): void }).click();
    await waitUntil(
      () =>
        (win?.document.getElementById("rh-recommend-removed")?.children
          .length ?? 0) === 1,
      "the removed term to move to its own row",
    );

    // Find.
    await findPapers();
    assert.strictEqual(
      controller.state.rows.length,
      ROWS_ON_THE_PAGE,
      "every record on the page is a row",
    );
    assert.isTrue(
      transport?.urls.some((url) => url.startsWith(EUROPE_PMC_SEARCH)),
      "Europe PMC was asked",
    );
    assert.isFalse(
      transport?.urls.some((url) => url.includes(SEMANTIC_SCHOLAR_HOST)),
      "a keyless run must not ask Semantic Scholar",
    );

    // Dismiss one. The other ticks stand.
    const [dismissed, ...others] = controller.state.rows;
    if (!dismissed) assert.fail("no rows");
    const startingSelection = controller.state.selectedCount;
    const button = rowElement(dismissed.key).lastElementChild
      ?.firstElementChild as unknown as { click(): void } | null;
    if (!button) assert.fail("the row has no Not interested button");
    button.click();
    await waitUntil(
      () => !controller.state.visible.some((row) => row.key === dismissed.key),
      "the dismissed row to go",
    );
    assert.strictEqual(
      controller.state.selectedCount,
      startingSelection - 1,
      "only the dismissed row lost its tick",
    );

    // Leave exactly five ticked: an unticked row must not be imported.
    for (const row of others.slice(ITEMS_TO_IMPORT)) {
      const box = rowElement(row.key).firstElementChild
        ?.firstElementChild as unknown as { click(): void } | null;
      box?.click();
    }
    assert.strictEqual(controller.state.selectedCount, ITEMS_TO_IMPORT);
    const imported = others.slice(0, ITEMS_TO_IMPORT);

    // The picker's start, and the import.
    const now = new Date();
    const pad = (part: number) => String(part).padStart(2, "0");
    const day = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const datedName = `${collection.name} — recommended ${day}`;
    await waitUntil(
      () => xul("rh-search-target").value === `new:${datedName}`,
      "the picker to start on the dated default",
    );
    controller.import();
    await waitUntil(() => {
      const [child] = Zotero.Collections.getByParent(collection.id);
      return child?.getChildItems(true).length === ITEMS_TO_IMPORT;
    }, "five items in the subcollection");
    await waitUntil(() => !controller.state.running, "the import to end");

    const children = Zotero.Collections.getByParent(collection.id);
    assert.strictEqual(children.length, 1, "one subcollection");
    const [child] = children;
    if (!child) assert.fail("no subcollection");
    assert.strictEqual(child.name, datedName);
    const titles = child
      .getChildItems(false)
      .map((item) => String(item.getField("title")))
      .sort();
    assert.deepEqual(
      titles,
      imported.map((row) => row.title).sort(),
      "exactly the ticked rows were written",
    );

    // Nothing about the dismissal is in the item data.
    const search = new Zotero.Search();
    (search as unknown as { libraryID: number }).libraryID =
      Zotero.Libraries.userLibraryID;
    search.addCondition("title", "contains", dismissed.title);
    assert.deepEqual(
      await search.search(),
      [],
      "the dismissed paper is not an item",
    );

    // Find again: absent, then present when asked for, and marked.
    await findPapers();
    assert.isFalse(
      controller.state.rows.some((row) => row.title === dismissed.title),
      "a dismissed paper stays out of the next run",
    );
    assert.isAbove(controller.state.rows.length, 0, "the rest still come back");

    const show = xul("rh-recommend-show-dismissed");
    show.checked = true;
    show.doCommand();
    await findPapers();
    const shown = controller.state.rows.find(
      (row) => row.title === dismissed.title,
    );
    if (!shown) assert.fail("Show dismissed did not bring the paper back");
    const marker = rowElement(shown.key).lastElementChild?.firstElementChild;
    assert.strictEqual(
      marker?.getAttribute("data-l10n-id"),
      "research-helper-search-recommend-row-dismissed",
    );
    assert.isFalse(
      controller.state.selection.includes(shown.key),
      "a dismissed row starts unticked",
    );
    assert.isFalse(
      transport?.urls.some((url) => url.includes(SEMANTIC_SCHOLAR_HOST)),
      "nor did the later runs ask Semantic Scholar",
    );
  });
});

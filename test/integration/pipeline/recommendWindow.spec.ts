/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T26` and `P5-T27`: what only a real recommend window can say, written in the
 * integration round of 2026-11-06 from those two reports' lists.
 *
 * 1. **The controls and the layout.** Fluent's attributes on HTML and XUL elements, the
 *    chips, the slider, Enter, the focus after a dismissal, the table below the taller
 *    header, a heading row in a real table.
 * 2. **The import.** A title-matched item is linked, and a second import on one day
 *    reuses the subcollection.
 * 3. **A left run.** Re-opening and closing raise no toast.
 * 4. **The model's half.** The cost dialog comes before any model call, and a real
 *    failure of the egress log stops the request (`plan/00` §6 item 351(b)).
 *
 * **Not evidence about any service.** `Zotero.HTTP.request` is doubled before anything
 * runs (`../support/recommendPage.ts`), the provider is a fake in the real registry's
 * slot, and no key exists anywhere: `secrets.has` answers for the active provider and
 * nothing is written. The suite's live request guard fails anything that gets past them.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import type { LLMProvider } from "../../../src/llm/types";
import { PREF_KEYS } from "../../../src/prefs/keys";
import { SEMANTICSCHOLAR_KEY_REQUEST_URL } from "../../../src/sources/semanticscholar/semanticscholarSource";
import { COST_DIALOG_URL } from "../../../src/ui/dialogs/costConfirmDialog";
import { createJobStore } from "../../../src/zotero/db";
import { qualifiedPrefName } from "../../../src/zotero/prefStore";
import { chatResponse, mockModel } from "../../helpers/mockLLM";
import {
  cutAtEdge,
  drawnBox,
  drawnUnderButtons,
  hiddenButDrawn,
} from "../support/drawnGeometry";
import {
  doubleTheTransport,
  pageTitle,
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
  isAtMost(value: number, ceiling: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[recommend-window]";
const THIS_YEAR = new Date().getFullYear();
const SAVED_ITEMS = 6;
const ROWS_ON_THE_PAGE = 24;
const OWNED_AT = 2;
const NOT_INTERESTED = "research-helper-search-recommend-not-interested";
const WORDS = [
  "hepatocyte lipid nanoparticle messenger delivery",
  "ionizable cationic endosomal escape formulation",
  "pulmonary vaccine immune response kinetics",
  "stability storage toxicity clinical dosing",
  "targeting ligand antibody spleen tropism",
  "protein expression translation durability cohort",
];

/** The slice of `RHSearchWindow` this spec reads and drives. */
interface WindowController {
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
  recommendControls(): { readonly slider: number };
  applyFilter(): unknown;
  render(state: unknown): void;
}
type RecommendWindow = Window & {
  readonly RHSearchWindow?: WindowController;
};

/** A XUL button or checkbox, or an HTML input, as a press reaches it. */
type Control = HTMLElement & {
  disabled?: boolean;
  hidden: boolean;
  checked?: boolean;
  value?: string;
  label?: string;
  doCommand(): void;
};

function pluginInstance(): Addon {
  const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
  if (!instance?.api) {
    assert.fail(`Zotero.${config.addonInstance}.api is absent`);
  }
  return instance;
}

function services(): NonNullable<Addon["api"]["services"]> {
  const graph = pluginInstance().api.services;
  if (!graph) assert.fail("no ServiceGraph is published at api.services");
  return graph;
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

/** A real key press, through the widget's own path, as `EventUtils.synthesizeKey` does it. */
function pressKey(win: Window, key: string, keyCode: number): void {
  const processor = (
    Components.classes as unknown as Record<
      string,
      { createInstance(iid: unknown): unknown }
    >
  )["@mozilla.org/text-input-processor;1"]?.createInstance(
    (Components.interfaces as unknown as Record<string, unknown>)
      .nsITextInputProcessor,
  ) as {
    beginInputTransactionForTests(win: Window): boolean;
    keydown(event: KeyboardEvent): number;
    keyup(event: KeyboardEvent): boolean;
  };
  assert.isTrue(
    processor.beginInputTransactionForTests(win),
    "the key processor took the window",
  );
  const event = new (win as unknown as typeof globalThis).KeyboardEvent("", {
    key,
    code: key,
    keyCode,
  });
  processor.keydown(event);
  processor.keyup(event);
}

const ENTER = 13;
const ARROW_RIGHT = 39;
const ARROW_LEFT = 37;

/** Count the toasts the platform is asked for, and hand back how to stop. */
function countToasts(): {
  readonly count: () => number;
  readonly words: string[];
  stop(): void;
} {
  interface ToastHandle {
    ItemProgress: new (...args: unknown[]) => { setText(text: string): void };
  }
  const platform = Zotero as unknown as {
    ProgressWindow: new (...args: unknown[]) => ToastHandle;
  };
  const Real = platform.ProgressWindow;
  let toasts = 0;
  const words: string[] = [];
  platform.ProgressWindow = new Proxy(Real, {
    construct(target, args, newTarget) {
      toasts += 1;
      const made = Reflect.construct(target, args, newTarget) as ToastHandle;
      made.ItemProgress = new Proxy(made.ItemProgress, {
        construct(line, lineArgs, lineTarget) {
          words.push(String(lineArgs[1]));
          return Reflect.construct(line, lineArgs, lineTarget) as object;
        },
      });
      return made;
    },
  });
  return {
    count: () => toasts,
    words,
    stop: () => {
      platform.ProgressWindow = Real;
    },
  };
}

async function makeCollection(
  token: string,
  label: string,
): Promise<{ collection: Zotero.Collection; items: Zotero.Item[] }> {
  const collection = new Zotero.Collection({
    name: `${label} ${token}`,
    libraryID: Zotero.Libraries.userLibraryID,
  });
  await collection.saveTx();
  const items: Zotero.Item[] = [];
  for (let at = 0; at < SAVED_ITEMS; at += 1) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField(
      "title",
      `Saved paper ${String(at)} on hepatocyte lipid nanoparticle ${token}`,
    );
    item.setField("abstractNote", `A saved abstract: ${WORDS.join(" ")}.`);
    item.setField("date", String(THIS_YEAR - 1));
    item.setField("DOI", `10.5556/${token}.${label.length}.${String(at)}`);
    item.setCreators([
      { lastName: `Saved${token}`, firstName: "Author", creatorType: "author" },
    ]);
    // A title gives few terms. An item's tags are its keywords, and each one is a chip.
    // With the token, and the author's name too: a list is cached by its query, and a
    // list another spec cached would add rows of its own to this one's.
    for (const word of WORDS.flatMap((phrase) => phrase.split(" "))) {
      item.addTag(`${word} ${token}`, 1);
    }
    item.addToCollection(collection.id);
    await item.saveTx();
    items.push(item);
  }
  return { collection, items };
}

async function eraseMade(
  collection: Zotero.Collection | undefined,
  items: readonly Zotero.Item[],
): Promise<void> {
  for (const child of collection
    ? Zotero.Collections.getByParent(collection.id)
    : []) {
    for (const item of child.getChildItems(false)) {
      if (!items.includes(item)) await item.eraseTx();
    }
    await child.eraseTx();
  }
  for (const item of items) {
    await item.eraseTx();
  }
  await collection?.eraseTx();
}

function restorePref(name: string, value: unknown): void {
  if (value === undefined) {
    Zotero.Prefs.clear(name, true);
  } else {
    Zotero.Prefs.set(name, value as string | boolean, true);
  }
}

/** Every open window, the search window among them. */
function openWindows(): RecommendWindow[] {
  const open: RecommendWindow[] = [];
  const windows = Services.wm.getEnumerator(null as unknown as string);
  while (windows.hasMoreElements()) {
    const candidate = windows.getNext() as unknown as RecommendWindow;
    if (!candidate.closed) open.push(candidate);
  }
  return open;
}

/**
 * The search window itself, once its controller has run `init()`. Opening over an open
 * search window reloads that window, whose old document still answers for a moment,
 * so only a document that was not there before the call counts.
 */
async function recommendWindowOn(
  collectionID: number,
): Promise<RecommendWindow> {
  const earlier = new Set(openWindows().map((one) => one.document));
  pluginInstance().api.recommendWindow?.open(
    Zotero.getMainWindow(),
    collectionID,
  );
  let found: RecommendWindow | undefined;
  await waitUntil(() => {
    for (const candidate of openWindows()) {
      if (
        !earlier.has(candidate.document) &&
        candidate.RHSearchWindow?.state.initialized === true &&
        (
          candidate.document.getElementById(
            "rh-recommend-header",
          ) as unknown as { hidden?: boolean } | null
        )?.hidden === false
      ) {
        found = candidate;
        return true;
      }
    }
    return false;
  }, "the recommend window to open");
  return found as RecommendWindow;
}

describe("P5-T26, P5-T27: a real recommend window's controls, layout and import", () => {
  const made: Zotero.Item[] = [];
  const RECOMMEND_PREF = qualifiedPrefName(PREF_KEYS.recommendEnabled);
  const SOURCES_PREF = qualifiedPrefName(PREF_KEYS.sources);
  const token = runToken();
  let recommendBefore: unknown;
  let sourcesBefore: unknown;
  let source: Zotero.Collection | undefined;
  let owned: Zotero.Item | undefined;
  let transport: ReturnType<typeof doubleTheTransport> | undefined;
  let win: RecommendWindow | undefined;
  let localeBefore: UILocaleSnapshot | undefined;
  /** Every `dialogaccept` the window raised. The listener stops it reaching an import. */
  let accepted = 0;
  /** The picker's value while its row is hidden, which must survive that. */
  let pickerWhileHidden = "";

  before(async function () {
    this.timeout(120_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    // First, so no step below can reach the suite's live request guard.
    transport = doubleTheTransport(token, { rows: ROWS_ON_THE_PAGE });
    recommendBefore = Zotero.Prefs.get(RECOMMEND_PREF, true);
    sourcesBefore = Zotero.Prefs.get(SOURCES_PREF, true);
    Zotero.Prefs.set(RECOMMEND_PREF, true, true);
    Zotero.Prefs.set(SOURCES_PREF, "europepmc", true);

    const { collection, items } = await makeCollection(token, "P5-T27 window");
    source = collection;
    made.push(...items);
    // In the library and not in the collection, with the title of one row and no DOI.
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", pageTitle(token, OWNED_AT));
    item.setField("date", String(THIS_YEAR));
    await item.saveTx();
    owned = item;
    made.push(item);

    win = await recommendWindowOn(collection.id);
    (win.document as unknown as EventTarget).addEventListener(
      "dialogaccept",
      (event: Event) => {
        accepted += 1;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    win.focus();
  });

  after(async function () {
    this.timeout(120_000);
    win?.close();
    win = undefined;
    await Zotero.Promise.delay(250);
    await eraseMade(source, made.splice(0));
    source = undefined;
    restorePref(RECOMMEND_PREF, recommendBefore);
    restorePref(SOURCES_PREF, sourcesBefore);
    transport?.restore();
    transport = undefined;
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  function opened(): RecommendWindow {
    if (!win) assert.fail("the window did not open");
    return win;
  }

  function control(id: string): Control {
    const element = opened().document.getElementById(id);
    if (!element) assert.fail(`no element #${id}`);
    return element as unknown as Control;
  }

  function controllerOf(): WindowController {
    const controller = opened().RHSearchWindow;
    if (!controller) assert.fail("the window has no RHSearchWindow");
    return controller;
  }

  /**
   * The Semantic Scholar key notice asked to hide: no room, no box, and its link not
   * drawn either, read from layout and not from the property (docs/08 §5.4, 2026-11-06).
   */
  function assertKeyNoticeUndrawn(when: string): void {
    const seen = drawnBox(opened(), control("rh-recommend-key-notice"));
    debug(`${LOG_PREFIX} key notice ${when}: ${JSON.stringify(seen)}`);
    assert.strictEqual(
      seen.hidden,
      true,
      `${when}: the notice is asked to hide`,
    );
    assert.strictEqual(seen.display, "none", `${when}: the notice's display`);
    assert.strictEqual(seen.height, 0, `${when}: the notice takes no room`);
    assert.strictEqual(seen.boxes, 0, `${when}: the notice is not drawn`);
    assert.strictEqual(seen.linkBoxes, 0, `${when}: its link is not drawn`);
    assert.deepEqual(
      hiddenButDrawn(opened()),
      [],
      `${when}: nothing asked to hide is drawn`,
    );
  }

  /** The notice asked to show: it takes room, and its link is drawn and leads to the form. */
  async function assertKeyNoticeDrawn(when: string): Promise<void> {
    const link = control("rh-recommend-key-request");
    await waitUntil(
      () => (link.textContent ?? "") === "Request a free API key",
      "the key link's words",
    );
    const seen = drawnBox(opened(), control("rh-recommend-key-notice"));
    debug(`${LOG_PREFIX} key notice ${when}: ${JSON.stringify(seen)}`);
    assert.strictEqual(
      seen.hidden,
      false,
      `${when}: the notice is asked to show`,
    );
    assert.isTrue(seen.display !== "none", `${when}: the notice has a display`);
    assert.isAbove(seen.height, 0, `${when}: the notice takes room`);
    assert.isAbove(seen.linkHeight, 0, `${when}: its link is drawn`);
    assert.isAbove(seen.linkWidth, 0, `${when}: its link is drawn`);
    assert.strictEqual(
      link.getAttribute("href"),
      SEMANTICSCHOLAR_KEY_REQUEST_URL,
      `${when}: the link leads to the key request form`,
    );
    assert.deepEqual(
      hiddenButDrawn(opened()),
      [],
      `${when}: nothing asked to hide is drawn`,
    );
  }

  function rowElement(key: string): Element {
    const attribute = controllerOf().spec.row.keyAttribute;
    const found = [...control("rh-results-body").children].find(
      (tr) => tr.getAttribute(attribute) === key,
    );
    if (!found) assert.fail(`no row for ${key}`);
    return found;
  }

  function rowTitled(title: string): { readonly key: string } {
    const row = controllerOf().state.rows.find((one) => one.title === title);
    if (!row) assert.fail(`no row titled ${title}`);
    return row;
  }

  /** Leave exactly these rows ticked, by clicking their boxes. */
  function tickOnly(keys: readonly string[]): void {
    const wanted = new Set(keys);
    const { selection, visible } = controllerOf().state;
    const ticked = new Set(selection);
    for (const { key } of visible) {
      if (wanted.has(key) !== ticked.has(key)) {
        (
          rowElement(key).firstElementChild?.firstElementChild as unknown as {
            click(): void;
          }
        ).click();
      }
    }
    assert.strictEqual(controllerOf().state.selectedCount, keys.length);
  }

  it("draws Fluent's attributes on its HTML and XUL elements, and sends nothing on opening", async function () {
    this.timeout(30_000);
    assert.deepEqual(transport?.urls, [], "the window sent nothing by itself");
    assert.strictEqual(control("rh-recommend-find").disabled, true);
    await waitUntil(
      () => control("rh-recommend-slider").getAttribute("aria-label") !== null,
      "the slider's label",
    );
    assert.strictEqual(
      control("rh-recommend-slider").getAttribute("aria-label"),
      "How far from this collection to look, from familiar to exploratory",
    );
    assert.strictEqual(control("rh-recommend-slider").value, "25");
    const peer = control("rh-recommend-peer-reviewed");
    const dismissed = control("rh-recommend-show-dismissed");
    assert.strictEqual(peer.getAttribute("label"), "Peer-reviewed only");
    assert.strictEqual(dismissed.getAttribute("label"), "Show dismissed");
    const ends = [
      ...opened().document.querySelectorAll(".rh-recommend-slider-end"),
    ];
    assert.deepEqual(
      ends.map((end) => end.textContent),
      ["Familiar", "Exploratory"],
    );
    for (const element of [peer, dismissed, ...ends]) {
      const { width, height } = element.getBoundingClientRect();
      assert.isAbove(width, 10, "the control has been laid out");
      assert.isAbove(height, 5, "the control has been laid out");
    }
    const box = control("rh-recommend-slider").getBoundingClientRect();
    debug(
      `${LOG_PREFIX} slider ${String(Math.round(box.width))} x ` +
        `${String(Math.round(box.height))}; window ` +
        `${String(opened().innerWidth)} x ${String(opened().innerHeight)}`,
    );
  });

  it("asks the Semantic Scholar key notice to hide before any run, and then it takes no room and is not drawn", async function () {
    this.timeout(30_000);
    await Zotero.Promise.delay(0);
    assertKeyNoticeUndrawn("before any run");
  });

  it("builds a profile whose chips wrap, with Fluent's attributes on their buttons", async function () {
    this.timeout(60_000);
    control("rh-recommend-build").doCommand();
    await waitUntil(
      () => control("rh-recommend-profile").hidden === false,
      "the profile panel",
    );
    const input = control("rh-recommend-term-input");
    await waitUntil(
      () => input.getAttribute("placeholder") === "Add a term",
      "the term box's placeholder",
    );
    assert.strictEqual(input.getAttribute("aria-label"), "Add a term");
    const chips = control("rh-recommend-terms");
    const boxes = [...chips.children];
    assert.isAbove(boxes.length, 10, "enough chips to wrap");
    const button = boxes[0]?.querySelector("button");
    const term = boxes[0]?.firstElementChild?.textContent ?? "";
    await waitUntil(
      () => button?.getAttribute("title") === `Remove “${term}”`,
      "the chip's tooltip",
    );
    const words = (button?.getAttribute("aria-label") ?? "").replace(
      /[⁨⁩]/gu,
      "",
    );
    assert.strictEqual(words, `Remove “${term}”`);
    assert.strictEqual(button?.textContent, "×");
    const tops = new Set(
      boxes.map((box) => Math.round(box.getBoundingClientRect().top)),
    );
    const right = Math.max(
      ...boxes.map((box) => box.getBoundingClientRect().right),
    );
    debug(
      `${LOG_PREFIX} ${String(boxes.length)} chips on ${String(tops.size)} lines; ` +
        `furthest right ${String(Math.round(right))} of ` +
        `${String(opened().innerWidth)}`,
    );
    assert.isAbove(tops.size, 1, "the chips wrap");
    assert.isAtMost(right, opened().innerWidth, "and stay inside the window");
  });

  it("adds a term on Enter in the term box, and the dialog does not accept", async function () {
    this.timeout(30_000);
    const input = control("rh-recommend-term-input") as unknown as Control & {
      focus(): void;
    };
    input.value = "zebrafish";
    input.focus();
    assert.strictEqual(opened().document.activeElement, input);
    pressKey(opened(), "Enter", ENTER);
    await waitUntil(
      () =>
        [...control("rh-recommend-terms").children].some(
          (box) => box.firstElementChild?.textContent === "zebrafish",
        ),
      "the term to become a chip",
    );
    await Zotero.Promise.delay(100);
    assert.strictEqual(input.value, "", "the box is emptied");
    assert.strictEqual(accepted, 0, "Enter did not reach the dialog's accept");
    assert.strictEqual(opened().document.activeElement, input, "focus stays");
    assert.isFalse(opened().closed, "the window stays");
  });

  it("moves the slider with the keyboard, reads it at Find, and Enter on it does nothing", async function () {
    this.timeout(30_000);
    const slider = control("rh-recommend-slider") as unknown as Control & {
      focus(): void;
    };
    slider.focus();
    assert.strictEqual(opened().document.activeElement, slider);
    pressKey(opened(), "ArrowRight", ARROW_RIGHT);
    await waitUntil(() => slider.value === "30", "the slider to move one step");
    assert.strictEqual(controllerOf().recommendControls().slider, 30);
    pressKey(opened(), "Enter", ENTER);
    await Zotero.Promise.delay(100);
    assert.strictEqual(accepted, 0, "Enter did not reach the dialog's accept");
    assert.isFalse(controllerOf().state.running, "and started nothing");
    assert.strictEqual(slider.value, "30");
    pressKey(opened(), "ArrowLeft", ARROW_LEFT);
    await waitUntil(() => slider.value === "25", "the slider to move back");
  });

  it("gives the profile the room while no table shows: at 1019 x 600 the notice, its queries and the buttons are in view", async function () {
    this.timeout(30_000);
    const view = opened();
    const { outerWidth: widthBefore, outerHeight: heightBefore } = view;
    // The content's 1019 by 600: `resizeTo` sizes the window with its frame.
    view.resizeTo(
      1019 + view.outerWidth - view.innerWidth,
      600 + view.outerHeight - view.innerHeight,
    );
    await Zotero.Promise.delay(250);
    assert.strictEqual(view.innerWidth, 1019);
    assert.strictEqual(view.innerHeight, 600);

    const notice = [...control("rh-recommend-egress").children];
    const queries = [...control("rh-recommend-queries").children];
    await waitUntil(
      () => notice.every((line) => (line.textContent ?? "") !== ""),
      "the notice's words",
    );
    assert.strictEqual(notice.length, 2, "the notice's two paragraphs");
    assert.isAbove(queries.length, 0, "a search query to read");
    assert.include(notice[0]?.textContent ?? "", "the search queries below");

    // No scrolling: the header has not moved, and everything ends above its edge.
    const header = control("rh-recommend-header");
    assert.strictEqual(header.scrollTop, 0);
    const edge = header.getBoundingClientRect().top + header.clientHeight;
    const dialog = control("rh-search-dialog") as unknown as {
      getButton(name: string): Element;
    };
    const ok = dialog.getButton("accept").getBoundingClientRect();
    const cancel = dialog.getButton("cancel").getBoundingClientRect();
    const inView = (element: Element, what: string): void => {
      const box = element.getBoundingClientRect();
      assert.isAbove(box.height, 0, `${what} is drawn`);
      assert.isAtMost(box.bottom, edge + 0.5, `${what} is above the edge`);
      assert.isAtMost(box.bottom, ok.top, `${what} is above OK`);
    };
    inView(control("rh-recommend-find"), "Find papers");
    notice.forEach((line, at) => {
      inView(line, `the notice's paragraph ${String(at + 1)}`);
    });
    queries.forEach((line, at) => {
      inView(line, `search query ${String(at + 1)}`);
    });
    assert.isAtMost(ok.bottom, view.innerHeight, "OK is in the window");
    assert.isAtMost(cancel.bottom, view.innerHeight, "Cancel is in the window");
    debug(
      `${LOG_PREFIX} the profile's room at 1019 x 600: ` +
        `${String(control("rh-recommend-terms").children.length)} terms, header ` +
        `${String(header.clientHeight)} px holding ${String(header.scrollHeight)}, edge ` +
        `${String(Math.round(edge))}, last query ends ` +
        `${String(Math.round(queries.at(-1)?.getBoundingClientRect().bottom ?? 0))}, ` +
        `OK ${String(Math.round(ok.top))} to ${String(Math.round(ok.bottom))}`,
    );

    // What gave the room takes none, by its box rather than by a flag.
    for (const id of [
      "rh-search-filter-row",
      "rh-results-area",
      "rh-search-target-row",
      "rh-search-preprint-policy",
    ]) {
      assert.strictEqual(
        control(id).getBoundingClientRect().height,
        0,
        `#${id} takes no room`,
      );
    }

    // Before any "Find papers", the key notice is asked to hide, and it is not drawn.
    assertKeyNoticeUndrawn("with a profile, before Find papers");

    // For the next test, which reads them once a table has brought the rows back.
    pickerWhileHidden = String(control("rh-search-target").value ?? "");
    assert.isAbove(pickerWhileHidden.length, 0, "the picker holds its default");
    control("rh-search-filter").value = "hepatocyte";

    view.resizeTo(widthBefore, heightBefore);
    await Zotero.Promise.delay(250);
  });

  it("keeps the table usable below the taller header at the window's size", async function () {
    this.timeout(60_000);
    const controller = controllerOf();
    const before = controller.state.appliedRecordsRevision;
    await waitUntil(
      () => control("rh-recommend-find").disabled === false,
      "Find papers to be on offer",
    );
    control("rh-recommend-find").doCommand();
    await waitUntil(
      () =>
        controller.state.appliedRecordsRevision > before &&
        !controller.state.running &&
        control("rh-recommend-find").disabled === false,
      "a list to land",
    );
    await Zotero.Promise.delay(250);
    assert.strictEqual(controller.state.rows.length, ROWS_ON_THE_PAGE);

    // A table brings back what gave the profile the room, with its values. Every row
    // here has the word in its title, so the filter typed above hides none of them.
    for (const id of [
      "rh-search-filter-row",
      "rh-results-area",
      "rh-search-target-row",
      "rh-search-preprint-policy",
    ]) {
      assert.isAbove(
        control(id).getBoundingClientRect().height,
        0,
        `#${id} is back`,
      );
    }
    assert.strictEqual(control("rh-search-filter").value, "hepatocyte");
    assert.strictEqual(control("rh-search-target").value, pickerWhileHidden);
    assert.strictEqual(controller.state.visible.length, ROWS_ON_THE_PAGE);
    // The run had no Semantic Scholar key, so it asks for the notice, which is drawn.
    await assertKeyNoticeDrawn("after a keyless run");
    control("rh-search-filter").value = "";
    controller.applyFilter();

    const measure = (): {
      readonly window: string;
      readonly height: number;
      readonly header: number;
      readonly table: number;
      readonly rowsSeen: number;
      readonly accept: number;
      readonly acceptTop: number;
      readonly selection: number;
      readonly scrollable: number;
    } => {
      const view = opened();
      const rect = (id: string): DOMRect => control(id).getBoundingClientRect();
      const container = rect("rh-results-scroll");
      const seen = [...control("rh-results-body").children].filter((row) => {
        const { top, bottom } = row.getBoundingClientRect();
        return (
          top >= container.top &&
          bottom <= Math.min(container.bottom, view.innerHeight)
        );
      }).length;
      return {
        window: `${String(view.innerWidth)} x ${String(view.innerHeight)}`,
        height: view.innerHeight,
        header: Math.round(rect("rh-recommend-header").height),
        table: Math.round(
          Math.min(container.bottom, view.innerHeight) -
            Math.max(container.top, 0),
        ),
        rowsSeen: seen,
        accept: Math.round(
          (
            control("rh-search-dialog") as unknown as {
              getButton(name: string): Element;
            }
          )
            .getButton("accept")
            .getBoundingClientRect().bottom,
        ),
        acceptTop: Math.round(
          (
            control("rh-search-dialog") as unknown as {
              getButton(name: string): Element;
            }
          )
            .getButton("accept")
            .getBoundingClientRect().top,
        ),
        selection: Math.round(rect("rh-results-selection-row").bottom),
        scrollable:
          control("rh-results-scroll").scrollHeight -
          control("rh-results-scroll").clientHeight,
      };
    };
    const check = (when: string): void => {
      const seen = measure();
      debug(`${LOG_PREFIX} ${when}: ${JSON.stringify(seen)}`);
      assert.isAtMost(seen.accept, seen.height, `${when}: OK is in the window`);
      assert.isAtMost(
        seen.selection,
        seen.height,
        `${when}: the selection row is in the window`,
      );
      assert.isAtMost(
        Math.round(
          control("rh-search-target-row").getBoundingClientRect().bottom,
        ),
        seen.acceptTop,
        `${when}: the import row ends above OK`,
      );
      assert.isAbove(
        seen.scrollable,
        0,
        `${when}: the table scrolls in its box`,
      );
      assert.isAbove(seen.rowsSeen, 2, `${when}: more than two rows show`);
      // plan/00 §6 item 359(c), 2026-11-06: the header ends under its controls, not
      // through its chips, and no row of the window is drawn under the buttons.
      assert.deepEqual(
        cutAtEdge(control("rh-recommend-header")),
        [],
        `${when}: the header's edge cuts no line`,
      );
      assert.deepEqual(
        drawnUnderButtons(control("rh-search-dialog")),
        [],
        `${when}: nothing is drawn under OK and Cancel`,
      );
    };
    check("at its opening size");
    // The content's 1019 by 600: `resizeTo` sizes the window with its frame.
    const view = opened();
    view.resizeTo(
      1019 + view.outerWidth - view.innerWidth,
      600 + view.outerHeight - view.innerHeight,
    );
    await Zotero.Promise.delay(250);
    check("at 1019 x 600");
    const header = control("rh-recommend-header");
    debug(
      `${LOG_PREFIX} the header holds ${String(header.scrollHeight)} px in ` +
        `${String(header.clientHeight)} px`,
    );
    assert.isAtMost(
      control("rh-recommend-find").getBoundingClientRect().bottom,
      header.getBoundingClientRect().bottom,
      "Find papers shows without scrolling the header",
    );
    assert.isAtMost(
      control("rh-recommend-controls").getBoundingClientRect().bottom,
      header.getBoundingClientRect().top + header.clientHeight + 0.5,
      "the slider and its two boxes show without scrolling the header",
    );
  });

  it("links a title-matched item into the subcollection instead of writing a second", async function () {
    this.timeout(60_000);
    const collection = source;
    if (!collection || !owned) assert.fail("no collection or no owned item");
    const controller = controllerOf();
    const match = rowTitled(pageTitle(token, OWNED_AT));
    assert.isFalse(
      controller.state.selection.includes(match.key),
      "a row the library holds starts unticked",
    );
    const other = rowTitled(pageTitle(token, 3));
    tickOnly([match.key, other.key]);

    const day = new Date();
    const pad = (part: number) => String(part).padStart(2, "0");
    const name = `${collection.name} — recommended ${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    await waitUntil(
      () => control("rh-search-target").value === `new:${name}`,
      "the picker to start on the dated default",
    );
    controller.import();
    await waitUntil(() => {
      const [child] = Zotero.Collections.getByParent(collection.id);
      return child?.getChildItems(true).length === 2;
    }, "two items in the subcollection");
    await waitUntil(() => !controller.state.running, "the import to end");

    const [child] = Zotero.Collections.getByParent(collection.id);
    if (!child) assert.fail("no subcollection");
    assert.strictEqual(child.name, name);
    assert.isTrue(
      child.getChildItems(true).includes(owned.id),
      "the item the library held is in the subcollection",
    );
    const search = new Zotero.Search();
    (search as unknown as { libraryID: number }).libraryID =
      Zotero.Libraries.userLibraryID;
    search.addCondition("title", "is", pageTitle(token, OWNED_AT));
    const holders = await search.search();
    debug(
      `${LOG_PREFIX} title match: ${String(holders.length)} item holds the title; ` +
        `the owned item's id is ${owned.id === holders[0] ? "kept" : "not kept"}`,
    );
    assert.deepEqual(holders, [owned.id], "no second item holds the title");
  });

  it("reuses the dated subcollection for a second import on the same day", async function () {
    this.timeout(60_000);
    const collection = source;
    if (!collection) assert.fail("no collection");
    const controller = controllerOf();
    const [first] = Zotero.Collections.getByParent(collection.id);
    if (!first) assert.fail("no subcollection from the first import");
    const held = first.getChildItems(true).length;
    const rows = [4, 5].map((at) => rowTitled(pageTitle(token, at)).key);
    tickOnly(rows);
    debug(
      `${LOG_PREFIX} second import, the picker reads ` +
        `${control("rh-search-target").value ?? ""}`,
    );
    controller.import();
    await waitUntil(
      () => first.getChildItems(true).length === held + rows.length,
      "two more items in the same subcollection",
    );
    await waitUntil(() => !controller.state.running, "the import to end");
    const children = Zotero.Collections.getByParent(collection.id);
    assert.deepEqual(
      children.map((child) => child.id),
      [first.id],
      "still one subcollection",
    );
    assert.strictEqual(
      first.parentID,
      collection.id,
      "nested under the source",
    );
  });

  it("dismisses on Enter once, moves the focus to the next button, and the dialog does not accept", async function () {
    this.timeout(30_000);
    const controller = controllerOf();
    const before = controller.state.visible.length;
    const buttons = (): HTMLButtonElement[] =>
      [
        ...control("rh-results-body").querySelectorAll(
          `button[data-l10n-id="${NOT_INTERESTED}"]`,
        ),
      ] as HTMLButtonElement[];
    const [first, second] = buttons();
    if (!first || !second) assert.fail("fewer than two buttons");
    const secondKey = second.getAttribute(controller.spec.row.keyAttribute);
    first.focus();
    assert.strictEqual(opened().document.activeElement, first);
    pressKey(opened(), "Enter", ENTER);
    await waitUntil(
      () => controller.state.visible.length === before - 1,
      "the row to go",
    );
    await Zotero.Promise.delay(250);
    assert.strictEqual(
      controller.state.visible.length,
      before - 1,
      "one press dismisses one row",
    );
    assert.strictEqual(accepted, 0, "Enter did not reach the dialog's accept");
    const active = opened().document.activeElement;
    debug(
      `${LOG_PREFIX} focus after a dismissal: ${active?.localName ?? "none"}, on the next ` +
        `row ${String(active?.getAttribute(controller.spec.row.keyAttribute) === secondKey)}`,
    );
    assert.strictEqual(
      active?.getAttribute(controller.spec.row.keyAttribute),
      secondKey,
      "the focus moved to the button that took its place",
    );
  });

  it("control: Enter on a field that does not stop it does reach the dialog's accept", async function () {
    this.timeout(30_000);
    const filter = control("rh-search-filter") as unknown as Control & {
      focus(): void;
    };
    assert.isAbove(controllerOf().state.selectedCount, 0, "Import is on offer");
    filter.focus();
    pressKey(opened(), "Enter", ENTER);
    await waitUntil(() => accepted === 1, "the dialog's accept", 5_000);
    accepted = 0;
  });

  it("lines a heading row up with the hidden columns in a real table (a list drawn by hand)", async function () {
    this.timeout(30_000);
    const controller = controllerOf();
    const groups = [
      { key: "0", label: "lipid nanoparticle delivery" },
      { key: "1", ref: { id: "research-helper-search-recommend-group-none" } },
    ];
    const reasons = [{ id: "research-helper-search-recommend-reason-found" }];
    const records = [0, 1, 2].map((at) => ({
      key: `doi:10.5555/heading.${String(at)}`,
      title: `A row under a heading ${String(at)}`,
      authors: [{ family: "Heading" }],
      year: THIS_YEAR,
      recommended: true,
      reasons,
      group: groups[at === 2 ? 1 : 0],
    }));
    controller.render({
      panel: "results",
      running: false,
      records,
      recordsRevision: controller.state.appliedRecordsRevision + 1,
    });
    const body = control("rh-results-body");
    await waitUntil(
      () => body.querySelectorAll("th").length === 2,
      "two heading rows",
    );
    const heading = body.querySelector("th") as HTMLTableCellElement;
    const dataRow = heading.parentElement?.nextElementSibling;
    if (!dataRow) assert.fail("no row under the heading");
    const shown = (cell: Element): boolean =>
      cell.getBoundingClientRect().width > 0;
    const headCells = [...control("rh-results-head-row").children].filter(
      shown,
    );
    const rowCells = [...dataRow.children].filter(shown);
    const box = heading.getBoundingClientRect();
    const rowBox = dataRow.getBoundingClientRect();
    debug(
      `${LOG_PREFIX} heading: colSpan ${String(heading.colSpan)}, columns shown ` +
        `${String(headCells.length)} in the head and ${String(rowCells.length)} in the ` +
        `row; left ${String(Math.round(box.left))} and ${String(Math.round(rowBox.left))}, ` +
        `right ${String(Math.round(box.right))} and ${String(Math.round(rowBox.right))}; ` +
        `text ${heading.textContent ?? ""}`,
    );
    assert.strictEqual(heading.colSpan, headCells.length, "spans the columns");
    assert.strictEqual(rowCells.length, headCells.length);
    assert.isAtMost(
      Math.abs(box.left - rowBox.left),
      1,
      "the left edges agree",
    );
    assert.isAtMost(
      Math.abs(box.right - rowBox.right),
      1,
      "the right edges agree",
    );
    assert.strictEqual(heading.textContent, "lipid nanoparticle delivery");
    await waitUntil(
      () => (body.querySelectorAll("th")[1]?.textContent ?? "") !== "",
      "the second heading's words",
    );
    assert.strictEqual(
      body.querySelectorAll("th")[1]?.textContent,
      "Not placed in a topic",
    );
  });
});

describe("P5-T26: leaving a recommend run", () => {
  const RECOMMEND_PREF = qualifiedPrefName(PREF_KEYS.recommendEnabled);
  const SOURCES_PREF = qualifiedPrefName(PREF_KEYS.sources);
  const token = runToken();
  let recommendBefore: unknown;
  let sourcesBefore: unknown;
  let source: Zotero.Collection | undefined;
  const made: Zotero.Item[] = [];
  let transport: ReturnType<typeof doubleTheTransport> | undefined;
  let toasts: ReturnType<typeof countToasts> | undefined;
  let localeBefore: UILocaleSnapshot | undefined;

  before(async function () {
    this.timeout(120_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    // Every answer takes a while, so the run is still going when the test leaves it.
    transport = doubleTheTransport(token, { rows: 8, delayMs: 500 });
    recommendBefore = Zotero.Prefs.get(RECOMMEND_PREF, true);
    sourcesBefore = Zotero.Prefs.get(SOURCES_PREF, true);
    Zotero.Prefs.set(RECOMMEND_PREF, true, true);
    Zotero.Prefs.set(SOURCES_PREF, "europepmc", true);
    const { collection, items } = await makeCollection(token, "P5-T26 leaving");
    source = collection;
    made.push(...items);
    toasts = countToasts();
  });

  after(async function () {
    this.timeout(120_000);
    // A test that fails part way leaves its window open for the next describe to find.
    for (const left of openWindows()) {
      if (left.RHSearchWindow !== undefined) left.close();
    }
    await Zotero.Promise.delay(250);
    toasts?.stop();
    await eraseMade(source, made.splice(0));
    source = undefined;
    restorePref(RECOMMEND_PREF, recommendBefore);
    restorePref(SOURCES_PREF, sourcesBefore);
    // Answers still on their way see the double, not the network.
    await Zotero.Promise.delay(1_000);
    transport?.restore();
    transport = undefined;
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  /** Open, build, and start finding, so a run is going. */
  async function aRunGoing(): Promise<RecommendWindow> {
    const collection = source;
    if (!collection) assert.fail("no collection");
    const win = await recommendWindowOn(collection.id);
    const button = (id: string): Control =>
      win.document.getElementById(id) as unknown as Control;
    await waitUntil(
      () => button("rh-recommend-build").disabled === false,
      "Build to be on offer",
    );
    button("rh-recommend-build").doCommand();
    await waitUntil(
      () => button("rh-recommend-find").disabled === false,
      "Find papers to be on offer",
    );
    const asked = transport?.urls.length ?? 0;
    button("rh-recommend-find").doCommand();
    await waitUntil(
      () => (transport?.urls.length ?? 0) > asked,
      "the run's first request",
    );
    assert.isTrue(win.RHSearchWindow?.state.running, "the run is going");
    return win;
  }

  it("re-opening cancels the run with no toast, and closing does too", async function () {
    this.timeout(120_000);
    const collection = source;
    if (!collection) assert.fail("no collection");
    await aRunGoing();
    const before = toasts?.count() ?? 0;
    const again = await recommendWindowOn(collection.id);
    await Zotero.Promise.delay(1_500);
    assert.strictEqual(toasts?.count(), before, "re-opening raises no toast");
    assert.isFalse(
      again.RHSearchWindow?.state.running,
      "the new window has no run of the old one",
    );
    const third = await aRunGoing();
    const beforeClose = toasts?.count() ?? 0;
    third.close();
    await Zotero.Promise.delay(1_500);
    debug(
      `${LOG_PREFIX} leaving: ${String((toasts?.count() ?? 0) - before)} toasts ` +
        `after re-opening and closing`,
    );
    assert.strictEqual(toasts?.count(), beforeClose, "closing raises no toast");
  });

  it("the Cancel button raises its toast", async function () {
    this.timeout(120_000);
    const win = await aRunGoing();
    const before = toasts?.count() ?? 0;
    const said = toasts?.words.length ?? 0;
    (win.RHSearchWindow as unknown as { cancel(): void }).cancel();
    await waitUntil(() => (toasts?.count() ?? 0) > before, "the Cancel toast");
    await Zotero.Promise.delay(500);
    debug(
      `${LOG_PREFIX} Cancel: ${String((toasts?.count() ?? 0) - before)} toast, ` +
        `words ${JSON.stringify(toasts?.words.slice(said))}`,
    );
    assert.strictEqual(toasts?.count(), before + 1);
    assert.deepEqual(toasts?.words.slice(said), ["Cancelled."]);
    win.close();
    await Zotero.Promise.delay(250);
  });
});

describe("P5-T26: the model's half of Build profile, on a fake provider", () => {
  const RECOMMEND_PREF = qualifiedPrefName(PREF_KEYS.recommendEnabled);
  const SOURCES_PREF = qualifiedPrefName(PREF_KEYS.sources);
  const ACKNOWLEDGED = qualifiedPrefName(PREF_KEYS.privacyEgressAcknowledged);
  const GOOD_ANSWER = JSON.stringify({
    focusStatement: "Lipid nanoparticle delivery of messenger RNA.",
    coherence: "Close.",
    coherenceScore: 80,
    coreTopics: [{ topic: "lipid nanoparticle", weight: 1 }],
    inclusionSignals: ["a delivery study"],
    exclusionSignals: [],
    suggestedQueryTerms: ["ionizable lipid", "messenger delivery"],
  });
  const token = runToken();
  const restores: (() => void)[] = [];
  const made: Zotero.Item[] = [];
  const collections: Zotero.Collection[] = [];
  let transport: ReturnType<typeof doubleTheTransport> | undefined;
  let win: RecommendWindow | undefined;
  let localeBefore: UILocaleSnapshot | undefined;
  /** How many times the fake provider was asked. */
  let modelCalls = 0;

  type Mutable<T> = { -readonly [K in keyof T]: T[K] };

  before(async function () {
    this.timeout(120_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    transport = doubleTheTransport(token, { rows: 8 });
    const graph = services();
    await graph.database.ready;
    const registry = graph.llm.registry as Mutable<typeof graph.llm.registry>;
    const active = registry.activeProviderId();
    const realGet = registry.get;
    const real = realGet.call(registry, active);
    if (!real) assert.fail(`no adapter is registered for ${active}`);
    const fake: LLMProvider = {
      id: real.id,
      displayNameKey: real.displayNameKey,
      rateLimitKey: real.rateLimitKey,
      isConfigured: () => true,
      validateCredentials: () => Promise.reject(new Error("not in this spec")),
      listModels: () => Promise.resolve([]),
      getModel: (modelId) =>
        mockModel(modelId, {
          contextWindowTokens: 200_000,
          maxOutputTokens: 64_000,
          dataPolicy: {
            trainsOnInputByDefault: "no",
            retention: { days: "zero", note: "SYNTHETIC" },
          },
        }),
      chat: () => {
        modelCalls += 1;
        return Promise.resolve(chatResponse(GOOD_ANSWER));
      },
      chatStream: () => {
        assert.fail("the profile call does not stream");
      },
      countTokens: (text) => Math.ceil(text.length / 4),
    };
    registry.get = (id) => (id === active ? fake : realGet.call(registry, id));
    restores.push(() => {
      registry.get = realGet;
    });
    const secrets = graph.secrets as
      Mutable<NonNullable<typeof graph.secrets>> | undefined;
    const realHas = secrets?.has;
    if (secrets === undefined || realHas === undefined) {
      assert.fail("no secret store in this profile");
    }
    secrets.has = (id) =>
      id === `llm.${active}`
        ? Promise.resolve(true)
        : realHas.call(secrets, id);
    restores.push(() => {
      secrets.has = realHas;
    });
    for (const [name, value] of [
      [`${config.prefsPrefix}.${active}.keyPresent`, true],
      [`${config.prefsPrefix}.reportModel`, "rh-window-report-model"],
      [`${config.prefsPrefix}.summaryModel`, "rh-window-summary-model"],
      [RECOMMEND_PREF, true],
      [SOURCES_PREF, "europepmc"],
    ] as const) {
      const saved = Zotero.Prefs.get(name, true) as unknown;
      Zotero.Prefs.set(name, value, true);
      restores.push(() => {
        restorePref(name, saved);
      });
    }
    const savedAcknowledged = Zotero.Prefs.get(ACKNOWLEDGED, true) as unknown;
    restores.push(() => {
      restorePref(ACKNOWLEDGED, savedAcknowledged);
    });
  });

  after(async function () {
    this.timeout(120_000);
    win?.close();
    win = undefined;
    for (const dialog of costDialogs()) dialog.close();
    await Zotero.Promise.delay(250);
    for (const restore of restores.splice(0).reverse()) restore();
    transport?.restore();
    transport = undefined;
    for (const item of made.splice(0)) await item.eraseTx();
    for (const collection of collections.splice(0)) await collection.eraseTx();
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  interface CostDialogWindow extends Window {
    RHCostDialog?: {
      state: { initialized: boolean; reported: boolean };
      updateAccept(): void;
    };
  }

  function costDialogs(): CostDialogWindow[] {
    const open: CostDialogWindow[] = [];
    const windows = Services.wm.getEnumerator(
      null as unknown as string,
    ) as unknown as Iterable<CostDialogWindow>;
    for (const candidate of windows) {
      if (!candidate.closed && candidate.location.href === COST_DIALOG_URL) {
        open.push(candidate);
      }
    }
    return open;
  }

  /** The dialog a run raised, once it can be answered. */
  async function theDialog(): Promise<CostDialogWindow> {
    let shown: CostDialogWindow | undefined;
    await waitUntil(() => {
      shown = costDialogs().find(
        (candidate) =>
          candidate.RHCostDialog?.state.initialized === true &&
          !candidate.RHCostDialog.state.reported,
      );
      return shown !== undefined;
    }, "the cost dialog to open");
    return shown as CostDialogWindow;
  }

  async function accept(shown: CostDialogWindow): Promise<void> {
    const doc = shown.document;
    const acknowledge = doc.getElementById("rh-cost-acknowledge") as {
      hidden: boolean;
      checked: boolean;
    } | null;
    if (acknowledge !== null && !acknowledge.hidden) {
      acknowledge.checked = true;
      shown.RHCostDialog?.updateAccept();
    }
    (
      doc.getElementById("rh-cost-dialog") as unknown as {
        acceptDialog(): void;
      }
    ).acceptDialog();
    await waitUntil(
      () => shown.closed || shown.RHCostDialog?.state.reported === true,
      "the cost dialog to report its answer",
    );
  }

  /** A fresh collection and window, with the acknowledgement cleared so the dialog opens. */
  async function freshWindow(label: string): Promise<{
    readonly collection: Zotero.Collection;
    readonly button: (id: string) => Control;
    readonly opened: RecommendWindow;
  }> {
    win?.close();
    await Zotero.Promise.delay(250);
    const { collection, items } = await makeCollection(token, label);
    made.push(...items);
    collections.push(collection);
    Zotero.Prefs.clear(ACKNOWLEDGED, true);
    const opened = await recommendWindowOn(collection.id);
    win = opened;
    const button = (id: string): Control =>
      opened.document.getElementById(id) as unknown as Control;
    await waitUntil(
      () => button("rh-recommend-build").disabled === false,
      "Build to be on offer",
    );
    return { collection, button, opened };
  }

  async function egressRecords(collectionKey: string): Promise<number> {
    return (await services().jobs.list()).filter((record) => {
      const input = record.input as {
        collectionKey?: string;
        egress?: unknown;
      };
      return (
        record.pipelineId === "recommend" &&
        input.collectionKey === collectionKey &&
        input.egress !== undefined
      );
    }).length;
  }

  it("Build profile asks the cost dialog before any model call, and then writes one egress record", async function () {
    this.timeout(120_000);
    const { collection, button } = await freshWindow("P5-T26 cost");
    modelCalls = 0;
    button("rh-recommend-build").doCommand();
    const shown = await theDialog();
    assert.strictEqual(modelCalls, 0, "no model call before the answer");
    assert.strictEqual(await egressRecords(collection.key), 0, "and no record");
    await accept(shown);
    await waitUntil(
      () => button("rh-recommend-profile").hidden === false,
      "the model's profile",
    );
    debug(
      `${LOG_PREFIX} cost dialog first: ${String(modelCalls)} model call after it, ` +
        `${String(await egressRecords(collection.key))} egress record, focus ` +
        `${button("rh-recommend-focus").textContent ?? ""}`,
    );
    assert.strictEqual(modelCalls, 1, "the answer let one request go");
    assert.strictEqual(button("rh-recommend-heuristic").hidden, true);
    assert.strictEqual(await egressRecords(collection.key), 1);
    assert.deepEqual(
      transport?.urls.filter((url) => !url.startsWith("http://localhost")),
      [],
      "nothing went out on the transport for a profile",
    );
  });

  it("a real failure of the egress log stops the request and fails the run (plan/00 item 351(b))", async function () {
    this.timeout(120_000);
    const { collection, button, opened } = await freshWindow("P5-T26 refused");
    const graph = services();
    const open = await graph.database.ready;
    if (open === undefined) assert.fail("the plugin database did not open");
    modelCalls = 0;
    button("rh-recommend-build").doCommand();
    const shown = await theDialog();
    // The real queue, with no store: its own `ConfigurationError` is the failure.
    graph.jobs.detachStore();
    try {
      await accept(shown);
      await waitUntil(
        () => opened.RHSearchWindow?.state.running === false,
        "the run to end",
      );
      await waitUntil(
        () => button("rh-state-error").hidden === false,
        "the error panel",
      );
    } finally {
      graph.jobs.attachStore(createJobStore(open.connection));
    }
    debug(
      `${LOG_PREFIX} egress log refused: ${String(modelCalls)} model calls, ` +
        `${String(await egressRecords(collection.key))} records; panel says ` +
        `${button("rh-state-error").textContent?.trim() ?? ""}`,
    );
    assert.strictEqual(modelCalls, 0, "the request did not go");
    assert.strictEqual(await egressRecords(collection.key), 0, "no record");
    assert.strictEqual(
      button("rh-recommend-profile").hidden,
      true,
      "no profile",
    );
  });
});

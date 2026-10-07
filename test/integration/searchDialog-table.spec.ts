/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T21` — the result table, its selection model and its filter, **in the
 * window Zotero actually opens**.
 *
 * ## Why this has to be an integration spec
 *
 * `tsconfig.json` excludes `addon`, so none of the three files this card edits
 * is typechecked at all, and `test/unit/ui/searchDialog.test.ts` reaches the
 * controller only by evaluating it against a hand-built fake document. Four
 * things that fake cannot answer, and that `P1-T20` learned the hard way are
 * exactly where the defects are:
 *
 * 1. **Whether a Fluent message of the wrong *kind* renders anything.** `P1-T20`
 *    shipped a `<label>` whose message was a bare value and it drew nothing at
 *    all. Every column caption here is read back as rendered text, from the real
 *    bundle through the real `document.l10n`.
 * 2. **Whether a number grows a thousands separator on the way through Fluent.**
 *    `P1-T20` measured `2,024 – 2,026` in a year label. The counts in this
 *    window are quantities, where grouping is correct — so what is asserted is
 *    that the *year column* never groups and the *counts* render as counts.
 * 3. **Whether `<html:table>` really becomes a table.** In a XUL document
 *    `document.createElement("tr")` yields a XUL element named `tr`, which lays
 *    out as nothing. The rows are checked for their namespace and for a non-zero
 *    laid-out height.
 * 4. **Whether the stylesheet's variables exist.** `--accent-red` and
 *    `--material-sidepane` are read back as computed colours, which is better
 *    evidence than a screenshot, and is how NFR-13's "colour is never the sole
 *    carrier of meaning" is checked alongside the ⚠ glyph and the words.
 *
 * ## What it does not check, stated rather than implied
 *
 * - **Nobody looked at this window.** Light and dark are not compared here;
 *   `P1-T20` did that by forcing the theme preference in a throwaway profile and
 *   that is not repeated per card.
 * - **`Space` on a row checkbox is not simulated.** A synthetic key event is
 *   untrusted and Gecko will not let it toggle a native checkbox, so what is
 *   asserted is that the checkbox is focusable and native — i.e. that `Space` is
 *   the platform's job and not ours. `ArrowUp`/`ArrowDown` and `Ctrl`+`A` go
 *   through this window's own handler, so those are driven for real.
 * - **FR-5's "creates exactly 35 items" cannot be reached from this card.**
 *   Nothing imports yet (`P1-T22`). What is asserted is the window's half: the
 *   request handed to `runImport` carries exactly 35 records, and which 35.
 *
 * ## The host
 *
 * Nothing publishes `Zotero.<addonInstance>.api.searchWindow` at runtime yet, so
 * these tests install a recording host before opening the window and restore
 * whatever was there afterwards. With no host at all — today's state — the
 * Databases row renders zero checkboxes, Search is disabled, and `setResults()`
 * is simply never called; the "zero results" test below is that state.
 */

import { config } from "../../package.json";
import { createScope } from "../../src/bootstrap/container";
import { SEARCH_DIALOG_MESSAGE_IDS } from "../../src/i18n/keys";
import { notifierRegistration } from "../../src/zotero/registrations";
import {
  SEARCH_WINDOW_URL,
  openSearchWindow,
  type SearchWindowHandle,
} from "../../src/ui/dialogs/searchDialog";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface TestContext {
  timeout(ms: number): void;
  skip(): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function before(body: (this: TestContext) => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T21]";

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

// ---------------------------------------------------------------------------
// The window, and the controller inside it
// ---------------------------------------------------------------------------

/** One record in the shape the view model hands the window (`P1-T22` builds it). */
interface TableRecord {
  key: string;
  title: string;
  authors: { family: string }[];
  year: number;
  sourceLabels: string[];
  typeLabel: string;
  doi: string;
  existing?: boolean;
}

/** The slice of `RHSearchWindow` this spec drives. */
interface TableController {
  readonly state: {
    initialized?: boolean;
    panel: string;
    selection: string[];
    selectedCount: number;
    rows: { key: string }[];
    visible: { key: string }[];
  };
  readonly spec: {
    row: { titleIdPrefix: string; keyAttribute: string };
    rowClass: {
      row: string;
      existingRow: string;
      select: string;
      badge: string;
      sourceLine: string;
    };
  };
  readonly logic: {
    columns: { id: string; messageId: string; captioned: boolean }[];
  };
  setResults(records: TableRecord[]): number;
  applyFilter(): { total: number; new: number; selected: number };
  selectVisible(command: "all" | "none" | "invert"): unknown;
  refreshSelection(): { total: number; new: number; selected: number };
  collectImportRequest(): { records: TableRecord[] };
  pickedRows(): TableRecord[];
  rowCheckboxes(): HTMLInputElement[];
  cancel(): void;
}

/** The opened chrome window, with the two members `SearchWindowHandle` omits. */
interface TableWindow extends SearchWindowHandle {
  readonly document: Document;
  readonly RHSearchWindow?: TableController;
  close(): void;
  getComputedStyle(element: Element, pseudo?: string): CSSStyleDeclaration;
  Event: typeof Event;
  KeyboardEvent: typeof KeyboardEvent;
}

/** What the window asked the host to do, in order. */
interface RecordingHost {
  readonly searches: unknown[];
  readonly imports: { records: TableRecord[] }[];
  readonly cancels: number[];
}

let host: RecordingHost;
let win: TableWindow | undefined;
let doc: Document;
let controller: TableController;
/** Whatever `api.searchWindow` held before this file touched it. */
let savedApi: unknown;

function pluginApi(): Record<string, unknown> {
  const instance = (Zotero as unknown as Record<string, unknown>)[
    config.addonInstance
  ] as { api?: Record<string, unknown> } | undefined;
  if (!instance) {
    assert.fail(`Zotero.${config.addonInstance} is not installed`);
  }
  instance.api ??= {};
  return instance.api;
}

async function waitUntil(
  predicate: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(50);
  }
}

/** The bytes `chrome://` serves for a URL, or undefined if it serves nothing. */
async function chromeBytes(url: string): Promise<number | undefined> {
  try {
    const text = await Zotero.File.getContentsFromURLAsync(url);
    return typeof text === "string" ? text.length : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function record(n: number, existing = false): TableRecord {
  const base: TableRecord = {
    key: `10.5555/rh-p1t21.${String(n)}`,
    title: `Hepatocyte delivery via ionizable LNPs, part ${String(n)}`,
    authors: [{ family: `Kim${String(n)}` }, { family: "Park" }],
    year: 2024 + (n % 3),
    sourceLabels: ["PubMed"],
    typeLabel: "journal-article",
    doi: `10.5555/rh-p1t21.${String(n)}`,
  };
  return existing ? { ...base, existing: true } : base;
}

/** FR-5's 40 results. `existingAt` of them are already in the library. */
function fortyResults(existingAt: readonly number[] = []): TableRecord[] {
  return Array.from({ length: 40 }, (_unused, n) =>
    record(n, existingAt.includes(n)),
  );
}

/** A record whose author list overflows §4.5's "Kim, Park, Novak +5" form. */
function manyAuthors(): TableRecord {
  return {
    ...record(99),
    title: "Scalable manufacturing for nucleic-acid therapeutics",
    authors: [
      { family: "Kim" },
      { family: "Park" },
      { family: "Novak" },
      { family: "Rossi" },
      { family: "Weber" },
      { family: "Chen" },
      { family: "Ito" },
      { family: "Adeyemi" },
    ],
  };
}

// ---------------------------------------------------------------------------

function el(id: string): Element {
  const found = doc.getElementById(id);
  if (!found) {
    assert.fail(`#${id} is not in the search window`);
  }
  return found;
}

function rows(): Element[] {
  return Array.from(el("rh-results-body").children);
}

function cell(row: Element, at: number): Element {
  const found = row.children[at];
  if (!found) {
    assert.fail(`row has no cell ${String(at)}`);
  }
  return found;
}

/** Wait for Fluent to have translated `element`, i.e. for text to appear. */
async function translated(element: Element, what: string): Promise<string> {
  await waitUntil(
    () => (element.textContent ?? "").trim().length > 0,
    `Fluent to render ${what}`,
  );
  return (element.textContent ?? "").trim();
}

/**
 * Wait for Fluent to have **re-**translated `element` to contain `needle`.
 *
 * Needed wherever an element is re-localized rather than localized once: Fluent
 * re-translates from a mutation observer, so the previous test's text is still
 * standing for a tick or two. Waiting for non-empty text would pass on the stale
 * value — which it did, reading "35 selected" where 40 were selected.
 */
async function retranslated(
  element: Element,
  needle: string,
  what: string,
): Promise<string> {
  await waitUntil(
    () => (element.textContent ?? "").includes(needle),
    `Fluent to re-render ${what} with "${needle}" (it reads "${
      element.textContent ?? ""
    }")`,
  );
  return (element.textContent ?? "").trim();
}

/** Every attribute value and every text node under the results container. */
function tableStrings(): string[] {
  const out: string[] = [];
  const walk = (element: Element): void => {
    for (const attribute of Array.from(element.attributes)) {
      out.push(attribute.value);
    }
    if (element.children.length === 0) {
      out.push(element.textContent ?? "");
    }
    for (const child of Array.from(element.children)) {
      walk(child);
    }
  };
  walk(el("rh-results-container"));
  return out;
}

describe("P1-T21: the result table in a live Search & Import window", () => {
  before(async function () {
    this.timeout(60_000);

    const bytes = await chromeBytes(SEARCH_WINDOW_URL);
    if (bytes === undefined || bytes === 0) {
      // Not a silent skip. `zotero-plugin.config.ts`'s asset list must carry
      // `.xhtml` and `.css` or the document is served as an EMPTY response
      // rather than an error (P1-T18), and then nothing below means anything.
      log(
        `the document is not in the build (${
          bytes === undefined ? "no response" : "0 bytes"
        }); every assertion in this file would be vacuous`,
      );
      assert.fail(
        `${SEARCH_WINDOW_URL} serves nothing — check build.assets in ` +
          `zotero-plugin.config.ts`,
      );
    }
    log(`document served: ${String(bytes)} byte(s)`);

    host = { searches: [], imports: [], cancels: [] };
    const api = pluginApi();
    savedApi = api.searchWindow;
    api.searchWindow = {
      // One registered source, so the Databases row has a checkbox and the
      // FR-2 gate is open. The ids are this spec's, not a real adapter's; the
      // real registry is Phase 2's (`docs/07` §11.1 step 11).
      listSources: () => [
        { id: "pubmed", displayNameKey: "research-helper-source-pubmed" },
      ],
      listCollections: () => [],
      runSearch: (query: unknown) => {
        host.searches.push(query);
      },
      runImport: (request: { records: TableRecord[] }) => {
        host.imports.push(request);
      },
      cancel: () => {
        host.cancels.push(Date.now());
      },
    };

    const opened = openSearchWindow(Zotero.getMainWindow(), {
      mode: "keyword",
    }) as TableWindow;
    win = opened;
    await waitUntil(
      () => opened.RHSearchWindow?.state.initialized === true,
      "RHSearchWindow.init() to have run",
      20_000,
    );
    doc = opened.document;
    const found = opened.RHSearchWindow;
    if (!found) {
      assert.fail("the window loaded without RHSearchWindow");
    }
    controller = found;
  });

  after(async () => {
    win?.close();
    const api = pluginApi();
    if (savedApi === undefined) {
      delete api.searchWindow;
    } else {
      api.searchWindow = savedApi;
    }
    await Zotero.Promise.delay(100);
  });

  // =========================================================================
  // 1. The table is a table, and its captions render
  // =========================================================================

  it("renders docs/08 §4.2's seven columns as a real XHTML table", async function () {
    const table = el("rh-results-table");
    assert.strictEqual(table.namespaceURI, "http://www.w3.org/1999/xhtml");
    assert.strictEqual(table.localName, "table");

    const head = el("rh-results-head-row");
    assert.deepEqual(
      Array.from(head.children).map((th) => th.id),
      controller.logic.columns.map((column) => column.id),
      "the <th> order is docs/08 §4.2's column order",
    );
    for (const th of Array.from(head.children)) {
      assert.strictEqual(th.localName, "th", `${th.id} is an <html:th>`);
    }

    // §4.3's decision for v1 is a plain table, so nothing here mounted Zotero's
    // CJS `VirtualizedTable` or a React root.
    //
    // **`require` IS defined in this window, and that is not this card's doing.**
    // Measured here on 2026-10-07, after an earlier version of this assertion
    // claimed the opposite and failed: `searchDialog.xhtml` loads
    // `chrome://zotero/content/include.js` (P1-T20's markup, from docs/08
    // §4.1.1's own sample), and that is what installs Zotero's CJS loader. So
    // the right assertion is that this card does not *use* it — there is no
    // React root and no virtualized table in the document — which is also why
    // §4.3's "load include.js inside the same window that hosts the table"
    // hazard is already satisfied for whoever adopts that component later.
    assert.isTrue(
      "require" in (win as unknown as Record<string, unknown>),
      "include.js installs require(); see the comment above",
    );
    assert.strictEqual(
      doc.getElementsByClassName("virtualized-table").length,
      0,
      "no VirtualizedTable was mounted (§4.3's v1 decision)",
    );
    assert.strictEqual(
      doc.getElementById("rh-results-container")?.children.length,
      2,
      "the container holds the scroll box and §4.5's selection row, nothing else",
    );
  });

  it("draws every column caption as visible text, not as a dead attribute", async function () {
    // The defect class: `research-helper-search-col-title` is a `.label`, which
    // an <html:th> does not render, so the captions are resolved in script.
    // This reads them back out of the live document.
    const captioned = controller.logic.columns.filter(
      (column) => column.captioned,
    );
    assert.strictEqual(captioned.length, 6);
    const drawn: string[] = [];
    for (const column of captioned) {
      const text = await translated(el(column.id), column.id);
      assert.isAbove(text.length, 0, `${column.id} renders nothing`);
      assert.notInclude(text, "research-helper-", `${column.id} shows its id`);
      assert.notInclude(
        text,
        "{",
        `${column.id} shows an unresolved placeable`,
      );
      drawn.push(text);
      assert.isTrue(
        (SEARCH_DIALOG_MESSAGE_IDS as readonly string[]).includes(
          column.messageId,
        ),
        `${column.messageId} is declared for this surface`,
      );
    }
    log(`column captions: ${drawn.join(" | ")}`);

    // The ☑ column's own message is an `.aria-label` on the header checkbox, so
    // it has no caption and must have a name.
    const box = el("rh-results-select-all-box");
    await waitUntil(
      () => (box.getAttribute("aria-label") ?? "").length > 0,
      "the select-all checkbox's accessible name",
    );
    log(`select-all aria-label: ${box.getAttribute("aria-label") ?? ""}`);
  });

  // =========================================================================
  // 2. FR-5's arithmetic
  // =========================================================================

  it("arrives with 40 results and all 40 checked (FR-5)", async function () {
    assert.strictEqual(controller.setResults(fortyResults()), 40);
    assert.strictEqual(rows().length, 40);
    assert.strictEqual(controller.state.selection.length, 40);
    assert.strictEqual(controller.state.selectedCount, 40);
    assert.isTrue(
      controller.rowCheckboxes().every((box) => box.checked),
      "every row checkbox is checked",
    );
    assert.strictEqual(controller.state.panel, "results");
    assert.isFalse(
      (el("rh-results-container") as unknown as { hidden: boolean }).hidden,
    );

    // A real table lays out: a XUL element named `tr` would have no height.
    const first = rows()[0];
    if (!first) {
      assert.fail("no first row");
    }
    const height = (first as HTMLElement).getBoundingClientRect().height;
    assert.isAbove(height, 0, "the first row has a laid-out height");
    log(`first row height: ${height.toFixed(1)} px`);

    // §4.2's cells, read out of the document.
    assert.strictEqual(cell(first, 3).textContent, "2024");
    assert.strictEqual(cell(first, 4).textContent, "PubMed");
    assert.strictEqual(cell(first, 6).textContent, "10.5555/rh-p1t21.0");
    // A year is written straight into textContent, so no Intl.NumberFormat can
    // group it — the `2,024` defect P1-T20 measured cannot recur.
    for (const row of rows()) {
      assert.notInclude(
        cell(row, 3).textContent ?? "",
        ",",
        "no year carries a thousands separator",
      );
    }
  });

  it("hands Import exactly 35 records when 5 are unchecked (FR-5)", async function () {
    controller.setResults(fortyResults());
    const boxes = controller.rowCheckboxes();
    for (const box of boxes.slice(0, 5)) {
      box.checked = false;
      box.dispatchEvent(new (win as TableWindow).Event("change"));
    }
    assert.strictEqual(controller.state.selectedCount, 35);

    const before = host.imports.length;
    const request = controller.collectImportRequest();
    assert.strictEqual(request.records.length, 35);
    assert.strictEqual(request.records[0]?.key, "10.5555/rh-p1t21.5");
    assert.strictEqual(host.imports.length, before, "nothing was sent yet");

    // The live count reaches the accept button's label — §4.5's
    // "[ Import 28 items ]".
    // `formatMessages` is asynchronous, so the label catches up a tick later.
    // This is the assertion that found the stale-label defect: before
    // `refreshImportLabel()` guarded against out-of-order resolution it settled
    // on "Import 40 items" and stayed there.
    const dialog = el("rh-search-dialog");
    await waitUntil(
      () => (dialog.getAttribute("buttonlabelaccept") ?? "").includes("35"),
      "the Import label to state 35",
    );
    const label = dialog.getAttribute("buttonlabelaccept") ?? "";
    assert.include(label, "35", `the Import label states the count: ${label}`);
    log(`import button label at 35 selected: ${label}`);
  });

  it("states both of §4.5's counts as rendered text", async function () {
    controller.setResults(fortyResults([0, 1]));
    (el("rh-search-hide-existing") as unknown as { checked: boolean }).checked =
      false;
    controller.applyFilter();

    // The arguments are exact and synchronous; only the rendering lags.
    assert.strictEqual(
      el("rh-results-selected-count").getAttribute("data-l10n-args"),
      '{"count":40}',
    );
    assert.strictEqual(
      el("rh-search-result-count").getAttribute("data-l10n-args"),
      '{"total":40,"new":38}',
    );

    const selected = await retranslated(
      el("rh-results-selected-count"),
      "40",
      "the selected count",
    );
    assert.include(selected, "40", `selected count reads: ${selected}`);
    const total = await retranslated(
      el("rh-search-result-count"),
      "38",
      "the result count",
    );
    assert.include(total, "40", `result count reads: ${total}`);
    assert.include(total, "38", "and 38 of the 40 are new");
    // A count is a quantity: grouping would be correct here and simply does not
    // arise at 40. What must never group is the year, asserted above.
    assert.notInclude(selected, "{", "the placeable resolved");
    log(`counts: "${total}" / "${selected}"`);
  });

  // =========================================================================
  // 3. The filter, and the selection across it
  // =========================================================================

  it("narrows rows as the filter is typed, issuing no request", async function () {
    controller.setResults([
      { ...record(1), title: "Ionizable lipid design rules" },
      { ...record(2), title: "Hepatocyte editing in vivo" },
      { ...record(3), title: "Scalable LNP manufacturing" },
    ]);
    const searchesBefore = host.searches.length;

    const filter = el("rh-search-filter") as HTMLInputElement;
    filter.value = "hepatocyte";
    filter.dispatchEvent(
      new (win as TableWindow).Event("input", { bubbles: true }),
    );

    assert.strictEqual(rows().length, 1);
    assert.strictEqual(
      cell(rows()[0] as Element, 1).textContent,
      "Hepatocyte editing in vivo",
    );
    // §4.2 and this card's Do NOT: the filter is client-side over results that
    // have already been fetched.
    assert.strictEqual(host.searches.length, searchesBefore);
    assert.strictEqual(controller.state.rows.length, 3, "nothing was dropped");

    filter.value = "";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
    assert.strictEqual(rows().length, 3);
  });

  it("keeps a selection keyed on the row, so a filter cannot change it", async function () {
    // The defect this card exists to avoid: the user filters, clicks a
    // selection command, and gets rows they cannot see.
    controller.setResults(fortyResults());
    const filter = el("rh-search-filter") as HTMLInputElement;

    // Uncheck the LAST five — "part 35" … "part 39" — because the filter below
    // is "part 1", which matches "part 1" and "part 10"–"part 19". Choosing the
    // first five instead made this test expect 35 where 36 was right: "part 1"
    // was both unchecked and visible, so "select all" over that view correctly
    // re-selected it. The two sets have to be disjoint for the assertion to be
    // about the selection model rather than about the fixture's titles.
    for (const box of controller.rowCheckboxes().slice(-5)) {
      box.checked = false;
      box.dispatchEvent(new (win as TableWindow).Event("change"));
    }
    assert.strictEqual(controller.state.selectedCount, 35);
    const keptOut = controller.state.rows
      .slice(-5)
      .map((row) => row.key)
      .join(",");

    // Filter to the rows whose title ends "part 1", then clear every one of
    // them.
    filter.value = "part 1";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
    const narrowed = controller.state.visible.length;
    assert.isAbove(narrowed, 0);
    assert.isAbove(40, narrowed);
    const narrowedKeys = controller.state.visible.map((row) => row.key);
    controller.selectVisible("none");
    assert.strictEqual(controller.state.selectedCount, 0, "the visible ones");

    // Then "select all" over the same narrow view. If selection were held as
    // indices into the visible list, or if a command reached the whole set, the
    // number after clearing the filter would not be 35.
    controller.selectVisible("all");
    filter.value = "";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
    assert.strictEqual(rows().length, 40);
    assert.strictEqual(
      controller.state.selectedCount,
      35,
      "the five the user unchecked are STILL unchecked after filtering",
    );
    const selected = new Set(controller.state.selection);
    for (const key of keptOut.split(",")) {
      assert.isFalse(selected.has(key), `${key} stayed unchecked`);
    }
    for (const key of narrowedKeys) {
      assert.isTrue(selected.has(key), `${key} was re-selected while visible`);
    }

    // And the other direction: a hidden row is never imported.
    filter.value = "part 1";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
    controller.selectVisible("all");
    const picked = controller.collectImportRequest().records;
    assert.strictEqual(picked.length, controller.state.visible.length);
    assert.isTrue(
      picked.every((row) => narrowedKeys.includes(row.key)),
      "Import received only rows the table was showing",
    );
    filter.value = "";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
  });

  it("hides and restores the already-present rows (docs/07 §8.5)", async function () {
    const checkbox = el("rh-search-hide-existing") as unknown as {
      checked: boolean;
      dispatchEvent(event: Event): boolean;
    };
    checkbox.checked = true;
    controller.setResults(fortyResults([0, 1, 2, 3, 4]));
    assert.strictEqual(rows().length, 35, "the five start hidden");
    assert.strictEqual(
      controller.state.selection.length,
      40,
      "but all 40 are selected — FR-5 checks every row",
    );

    checkbox.checked = false;
    controller.applyFilter();
    assert.strictEqual(rows().length, 40, "and come back unchanged");
    assert.strictEqual(controller.state.selectedCount, 40);

    checkbox.checked = true;
    controller.applyFilter();
    assert.strictEqual(rows().length, 35);
  });

  // =========================================================================
  // 4. NFR-13 — the marker, the names, the keyboard
  // =========================================================================

  it("marks an existing row with a glyph, a colour AND the words (NFR-13)", async function () {
    const checkbox = el("rh-search-hide-existing") as unknown as {
      checked: boolean;
    };
    checkbox.checked = false;
    controller.setResults(fortyResults([0]));
    controller.applyFilter();

    const marked = rows()[0];
    const plain = rows()[1];
    if (!marked || !plain) {
      assert.fail("expected at least two rows");
    }
    assert.include(
      marked.getAttribute("class") ?? "",
      controller.spec.rowClass.existingRow,
    );

    // (a) the words, from the bundle, through the real document.l10n
    const title = cell(marked, 1);
    const text = await translated(title, "the already-in-library marker");
    assert.include(text, "Hepatocyte delivery via ionizable LNPs, part 0");
    assert.notInclude(text, "{", "the title placeable resolved");
    assert.isAbove(
      text.length,
      (cell(plain, 1).textContent ?? "").length,
      "the marked row says more than the plain one",
    );
    log(`marked row reads: ${text}`);

    // (b) the glyph, from the stylesheet's ::before
    const badge = title.getElementsByClassName(
      controller.spec.rowClass.badge,
    )[0];
    if (!badge) {
      assert.fail("the marked row has no badge element");
    }
    const before = (win as TableWindow).getComputedStyle(badge, "::before");
    assert.include(before.content, "⚠", "the ⚠ glyph is drawn");

    // (c) the colour — read back as a computed value, which is what proves the
    // Zotero variable resolves rather than silently falling through.
    const badgeColour = (win as TableWindow).getComputedStyle(badge).color;
    const plainColour = (win as TableWindow).getComputedStyle(
      cell(plain, 1),
    ).color;
    assert.isAbove(badgeColour.length, 0);
    assert.notStrictEqual(
      badgeColour,
      plainColour,
      "the badge's colour differs from body text",
    );
    log(`badge colour ${badgeColour} vs body ${plainColour}`);

    // (c2) and the row's border, the at-a-glance marker. Deliberately a border
    // rather than a tint of the row's own text: NFR-13 also requires body text
    // to meet 4.5:1 in both themes, and dimming a data row to a secondary-text
    // token would put that row's contrast at risk for the sake of decoration.
    const markedBorder = (win as TableWindow).getComputedStyle(
      cell(marked, 0),
    ).borderInlineStartWidth;
    const plainBorder = (win as TableWindow).getComputedStyle(
      cell(plain, 0),
    ).borderInlineStartWidth;
    assert.strictEqual(markedBorder, "3px");
    assert.notStrictEqual(plainBorder, "3px");
    assert.strictEqual(
      (win as TableWindow).getComputedStyle(cell(marked, 1)).color,
      plainColour,
      "the marked row's own text is NOT dimmed (NFR-13's contrast clause)",
    );
    log(`marked row border ${markedBorder} vs plain ${plainBorder}`);

    // (d) and the badge still carries its own accessible name.
    await waitUntil(
      () => (badge.getAttribute("aria-label") ?? "").length > 0,
      "the badge's accessible name",
    );
    log(`badge aria-label: ${badge.getAttribute("aria-label") ?? ""}`);
  });

  it("names every row and keeps the header visible while scrolling (§4.3, §9)", async function () {
    controller.setResults(fortyResults([0]));
    (el("rh-search-hide-existing") as unknown as { checked: boolean }).checked =
      false;
    controller.applyFilter();

    rows().forEach((row, at) => {
      const titleId = `${controller.spec.row.titleIdPrefix}${String(at)}`;
      assert.strictEqual(row.getAttribute("aria-labelledby"), titleId);
      assert.strictEqual(cell(row, 1).id, titleId);
      const box = cell(row, 0).children[0];
      assert.strictEqual(box?.getAttribute("aria-labelledby"), titleId);
      // A native checkbox, so Space is the platform's and needs no handler of
      // ours — and no tabindex, so Tab order is document order (§4.5, §9).
      assert.strictEqual(box?.localName, "input");
      assert.strictEqual(box?.getAttribute("type"), "checkbox");
      assert.isFalse(box?.hasAttribute("tabindex"));
    });

    const headerStyle = (win as TableWindow).getComputedStyle(
      el("rh-results-col-title"),
    );
    assert.strictEqual(headerStyle.position, "sticky");
    const scroll = (win as TableWindow).getComputedStyle(
      el("rh-results-scroll"),
    );
    assert.strictEqual(
      scroll.overflowY,
      "auto",
      "the table scrolls (Do step 1)",
    );
  });

  it("moves between rows and selects all from the keyboard (docs/08 §9)", async function () {
    controller.setResults(fortyResults());
    const boxes = controller.rowCheckboxes();
    const first = boxes[0];
    const second = boxes[1];
    if (!first || !second) {
      assert.fail("expected at least two row checkboxes");
    }

    first.focus();
    assert.strictEqual(doc.activeElement, first, "a row checkbox takes focus");

    const key = (name: string, extra: KeyboardEventInit = {}): KeyboardEvent =>
      new (win as TableWindow).KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        ...extra,
      });

    first.dispatchEvent(key("ArrowDown"));
    assert.strictEqual(doc.activeElement, second, "ArrowDown moves down a row");
    second.dispatchEvent(key("ArrowUp"));
    assert.strictEqual(doc.activeElement, first, "ArrowUp moves back");

    controller.selectVisible("none");
    assert.strictEqual(controller.state.selectedCount, 0);
    first.dispatchEvent(key("a", { ctrlKey: true }));
    assert.strictEqual(
      controller.state.selectedCount,
      40,
      "Ctrl+A selects every visible row",
    );
  });

  it("renders §4.5's author overflow as one message", async function () {
    controller.setResults([manyAuthors()]);
    const authors = cell(rows()[0] as Element, 2);
    const text = await translated(authors, "the author overflow");
    // Three names and the five that did not fit, in one Fluent message so a
    // translation can move the `+{ $count }` (NFR-11 forbids concatenation).
    assert.include(text, "Kim, Park, Novak");
    assert.include(text, "5");
    assert.notInclude(text, "{");
    log(`authors cell reads: ${text}`);
  });

  // =========================================================================
  // 5. The states this card leaves, and the two absolute rules
  // =========================================================================

  it("renders zero results without claiming a panel of its own", async function () {
    assert.strictEqual(controller.setResults([]), 0);
    assert.strictEqual(rows().length, 0, "an empty body, not an error");
    assert.strictEqual(controller.state.selection.length, 0);
    assert.strictEqual(controller.state.selectedCount, 0);
    assert.isFalse(
      (el("rh-results-select-all-box") as unknown as { checked: boolean })
        .checked,
      "the header checkbox is not ticked over nothing",
    );
    assert.strictEqual(
      el("rh-search-dialog").getAttribute("buttondisabledaccept"),
      "true",
      "Import is disabled (docs/08 §4.2)",
    );
    assert.isTrue(
      (el("rh-search-result-count") as unknown as { hidden: boolean }).hidden,
      "and no count is shown",
    );
    assert.deepEqual(controller.collectImportRequest().records, []);
    // docs/08 §4.6's EMPTY panel takes `{ $query }` and the year span, which
    // only a finished run knows, so this card does not switch to it.
    log(`panel after zero results: ${controller.state.panel}`);
  });

  it("performs zero database writes, start to finish (FR-5)", async function () {
    // FR-5: "the user clicks Cancel → zero Zotero items are created and zero
    // database writes occur." A notifier spy over the whole table session.
    const events: string[] = [];
    // FR-56 and `docs/01` §12 gotcha 10: the observer goes through
    // `notifierRegistration()` into a scope, so its teardown is the same
    // statement as its registration and a failed assertion cannot leak it.
    const scope = createScope({
      description: "P1-T21 notifier spy",
      onError: (message, error) => {
        log(`spy teardown error: ${message} ${String(error)}`);
      },
      strict: true,
    });
    await notifierRegistration("P1-T21 table write spy", {
      notify: (event, type) => {
        events.push(`${type}.${event}`);
      },
      types: ["item", "collection", "collection-item"],
      id: "rh-p1t21-table",
    })(scope);
    try {
      controller.setResults(fortyResults([0, 1, 2]));
      const filter = el("rh-search-filter") as HTMLInputElement;
      filter.value = "part 1";
      filter.dispatchEvent(new (win as TableWindow).Event("input"));
      controller.selectVisible("invert");
      controller.selectVisible("all");
      filter.value = "";
      filter.dispatchEvent(new (win as TableWindow).Event("input"));
      controller.cancel();
      await Zotero.Promise.delay(300);
      assert.deepEqual(
        events,
        [],
        `the table wrote to the database: ${events.join(", ")}`,
      );
      assert.strictEqual(host.cancels.length, 1, "Cancel reached the host");
    } finally {
      await scope.unregisterAll();
    }
    assert.deepEqual(scope.liveHandles(), [], "the spy was torn down");
    log("zero item/collection notifications across a full table session");
  });

  it("lets no pasted key reach a row, a tooltip or a title", async function () {
    // P1-T17 measured that a 32-character key is below the free-text redactor's
    // 40-character threshold, so the only safe property is that the query never
    // reaches the table at all. A row is built from the host's record and from
    // nothing else, and no row carries a `title` or `tooltiptext`.
    const key = "sk-0123456789abcdef0123456789abcd";
    controller.setResults(fortyResults());
    const keyword = el("rh-search-keyword") as HTMLInputElement;
    const filter = el("rh-search-filter") as HTMLInputElement;
    keyword.value = key;
    filter.value = key;
    filter.dispatchEvent(new (win as TableWindow).Event("input"));

    for (const text of tableStrings()) {
      assert.notInclude(text, key, "no table string carries the pasted key");
    }
    assert.notInclude(doc.title, key, "and neither does the window title");
    for (const row of rows()) {
      assert.isFalse(row.hasAttribute("title"));
      assert.isFalse(row.hasAttribute("tooltiptext"));
    }
    filter.value = "";
    keyword.value = "";
    filter.dispatchEvent(new (win as TableWindow).Event("input"));
    log("a pasted key reaches no row, no attribute and no title");
  });
});

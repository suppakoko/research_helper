import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { config } from "../../../package.json";
import { SEARCH_DIALOG_MESSAGE_IDS } from "../../../src/i18n/keys";
import { PREF_KEYS } from "../../../src/prefs/keys";
import { PREFS } from "../../../src/prefs/schema";
import {
  SEARCH_WINDOW_FEATURES,
  SEARCH_WINDOW_KEYWORD_ID,
  SEARCH_WINDOW_MIN_SIZE,
  SEARCH_WINDOW_ROOT_ID,
} from "../../../src/ui/dialogs/searchDialog";

/**
 * `P1-T20` — the Search & Import window's markup and controls.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network. `vitest` globals
 * are not used, matching every other unit spec in the tree.
 *
 * **This file is not in `P1-T20`'s `Files` list, and that is reported with the
 * card.** `plan/README.md` §6 requires tests to ship with the task and §4's
 * `Files` rule requires a reason in `Notes` when a card has no test file;
 * `P1-T20` has neither. Everything here is an assertion about the three files
 * the card does create, so the gap is in the list rather than in the work.
 *
 * ## Why it reads the shipped files instead of importing a module
 *
 * `addon/content/searchDialog.js` is a **classic chrome script**: the document
 * loads it by `<script src="chrome://…">` and names `RHSearchWindow` in its
 * `onload`, so it has no exports and cannot be `import`ed. `tsconfig.json` also
 * `exclude`s `addon`, so nothing in that directory is typechecked. Reading the
 * file and evaluating it is therefore the only way to assert anything about its
 * behaviour — and it has the useful property that the *shipped* bytes are what
 * is asserted, the same reason `test/unit/prefs/schema.test.ts` reads
 * `addon/prefs.js` off disk rather than a transcription of it.
 *
 * ## What is asserted mechanically here, and what is not
 *
 * Asserted: the date computation (against an injected clock, at the card's own
 * 2026-09-09 **and** at a date past it, so the criterion does not quietly
 * become an accident of the year the card ran), FR-2's Search gate in both of
 * its forms, `Zotero.UIProperties.registerRoot` actually being called against
 * the dialog root, the seeded defaults and their ranges against `docs/07` §8.5
 * *and* against that section's own table row, the four §4.6 panels, and the
 * markup rules — no `width`/`height` on `<window>`, the `<tooltip>` element,
 * the `<linkset>`, no inline script, no remote resource, no literal
 * human-readable string, every `data-l10n-id` declared by `P1-T18`'s bundle.
 *
 * Not asserted, and not assertable from Node: that the window *renders*
 * correctly in light and dark themes, and that Tab reaches every control in a
 * sensible order. The first needs a human looking at two themes; the second is
 * approximated below by asserting document order against `docs/08` §4.5's
 * layout, which is what Tab follows in the absence of a `tabindex`, plus the
 * absence of any `tabindex` attribute.
 */

const here = fileURLToPath(import.meta.url);
const addon = resolve(dirname(here), "../../../addon");
const docsDir = resolve(dirname(here), "../../../docs");

const XHTML = readFileSync(
  resolve(addon, "content/searchDialog.xhtml"),
  "utf8",
);
const SCRIPT = readFileSync(resolve(addon, "content/searchDialog.js"), "utf8");
const CSS = readFileSync(
  resolve(addon, "content/style/searchDialog.css"),
  "utf8",
);

/**
 * `package.json`'s `config.addonRef`, the chrome package name.
 *
 * The shipped files write `__addonRef__` and the scaffold substitutes it at
 * build time from `build.define` (`zotero-plugin.config.ts`). The controller is
 * evaluated below against the **substituted** text, so what is asserted is what
 * runs; the placeholder itself is asserted separately, because hard-coding the
 * package name is how `docs/08` §4.1 ended up with a chrome URL that resolves
 * to nothing (`P1-T19`, measured).
 */
const ADDON_REF = config.addonRef;
const SCRIPT_BUILT = SCRIPT.replaceAll("__addonRef__", ADDON_REF);

/**
 * The same text with every comment removed.
 *
 * Every file here documents the trap it avoids, and the words of the trap —
 * "`fetch()` from a document", "No fixed height" — are exactly what a naive
 * grep for the trap matches. Stripping the commentary is what keeps these
 * assertions about the code rather than about its prose.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SCRIPT_CODE = withoutComments(SCRIPT);
const CSS_CODE = withoutComments(CSS);

// ===========================================================================
// 1. A very small XML reader
//
// There is no DOM or XML parser in `node_modules`, and adding a dependency for
// one test would be scope `plan/README.md` §5 rule 2 forbids. The document is
// well-formed XML this project authors, with no CDATA and no entity other than
// the XML five, so a tag scanner is enough — and `assertEveryTagConsumed`
// below is what stops a scanner that silently matches nothing from making
// every assertion vacuous (the failure mode `readPrefsJs` in
// `test/unit/prefs/schema.test.ts` had to learn the hard way).
// ===========================================================================

interface Node {
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly children: Node[];
  readonly text: string[];
  parent: Node | undefined;
}

function makeNode(name: string, attrs: Map<string, string>): Node {
  return { name, attrs, children: [], text: [], parent: undefined };
}

/** Everything outside the root element: processing instructions and comments. */
function stripProlog(source: string): string {
  return source.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

function parse(source: string): Node {
  const body = stripProlog(source);
  const root = makeNode("#document", new Map());
  let current = root;
  let consumed = 0;

  const tag =
    /<\/?([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let cursor = 0;
  for (const match of body.matchAll(tag)) {
    const [whole, name, rawAttrs, selfClosing] = match;
    if (name === undefined) continue;
    consumed += 1;

    const between = body.slice(cursor, match.index).trim();
    if (between.length > 0) current.text.push(between);
    cursor = (match.index ?? 0) + whole.length;

    if (whole.startsWith("</")) {
      current = current.parent ?? root;
      continue;
    }

    const attrs = new Map<string, string>();
    for (const attr of (rawAttrs ?? "").matchAll(
      /([\w:.-]+)\s*=\s*"([^"]*)"/g,
    )) {
      const [, key, value] = attr;
      if (key !== undefined && value !== undefined) attrs.set(key, value);
    }
    const node = makeNode(name, attrs);
    node.parent = current;
    current.children.push(node);
    if (selfClosing !== "/") current = node;
  }

  const trailing = body.slice(cursor).trim();
  if (trailing.length > 0) current.text.push(trailing);

  const opens = (body.match(/<[A-Za-z]/g) ?? []).length;
  const closes = (body.match(/<\//g) ?? []).length;
  if (consumed !== opens + closes) {
    throw new Error(
      `the tag scanner consumed ${consumed} of ${opens + closes} tags in ` +
        `searchDialog.xhtml; the rest would be silently exempt from every ` +
        `markup assertion below.`,
    );
  }
  return root;
}

const DOCUMENT = parse(XHTML);

function descendants(node: Node): Node[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

const ELEMENTS = descendants(DOCUMENT);

function firstNamed(name: string): Node | undefined {
  return ELEMENTS.find((element) => element.name === name);
}

function byId(id: string): Node | undefined {
  return ELEMENTS.find((element) => element.attrs.get("id") === id);
}

// ===========================================================================
// 2. A fake XUL document, enough to run init()
// ===========================================================================

interface FakeL10nMessage {
  readonly value: string | null;
  readonly attributes: readonly { name: string; value: string }[];
}

class FakeElement {
  public children: FakeElement[] = [];
  public readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  public hidden: boolean;
  public checked: boolean;
  public disabled = false;
  public value: string | undefined;
  public className = "";
  public focused = false;
  /** The namespace `createElementNS` was called with, or undefined. */
  public namespace: string | undefined;
  /**
   * Backing store for {@link textContent}.
   *
   * `P1-T21` needs it: the result table writes a paper's title, year, source
   * and DOI straight into `textContent` because they are data rather than
   * translatable strings, and a plain property would have let a typo in the
   * *name* `textContent` pass unnoticed — exactly the failure class a file
   * nothing typechecks is exposed to.
   */
  private ownText = "";

  public constructor(
    public readonly name: string,
    private readonly attrs: Map<string, string>,
  ) {
    this.hidden = attrs.get("hidden") === "true";
    this.checked = attrs.get("checked") === "true";
    this.value = attrs.get("value");
  }

  /** Setting it replaces the children, as the DOM's does. */
  public get textContent(): string {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this.ownText;
  }

  public set textContent(value: string) {
    this.children = [];
    this.ownText = String(value);
  }

  public get id(): string {
    return this.attrs.get("id") ?? "";
  }

  public set id(value: string) {
    this.attrs.set("id", value);
  }

  public getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  public get firstElementChild(): FakeElement | undefined {
    return this.children[0];
  }

  public get firstChild(): FakeElement | undefined {
    return this.children[0];
  }

  public appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  public removeChild(child: FakeElement): void {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
  }

  public addEventListener(type: string, handler: (event: unknown) => void) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  public dispatch(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  public focus(): void {
    this.focused = true;
  }
}

interface ControllerSpec {
  root: string;
  keyword: string;
  prefKeys: Record<string, string>;
  prefBounds: Record<string, Record<string, number | boolean>>;
  duplicatesDefault: string;
  row: { titleIdPrefix: string; keyAttribute: string };
  rowClass: Record<string, string>;
  authorNamesShown: number;
  [key: string]: unknown;
}

/** The shape `setResults` takes; the host builds it (`P1-T22`). */
interface TableRecord {
  key?: string;
  title?: string;
  authors?: ({ family?: string; given?: string; literal?: string } | string)[];
  year?: number | string;
  sourceLabels?: string[];
  typeLabel?: string;
  doi?: string;
  existing?: boolean;
}

interface DisplayRow {
  key: string;
  title: string;
  authorNames: string;
  authorOverflow: number;
  year: string;
  sourceLabels: string[];
  typeLabel: string;
  doi: string;
  existing: boolean;
  filterText: string;
}

interface ControllerLogic {
  yearRange: (
    nowEpochMs: number,
    years: number,
  ) => { from: number; to: number; years: number };
  yearOptions: (toYear: number, maxYears: number) => number[];
  searchGate: (sources: { available: string[]; selected: string[] }) => {
    enabled: boolean;
    messageId: string | null;
  };
  importEnabled: (count: number) => boolean;
  panels: Record<string, string>;
  parseSourceIds: (raw: unknown) => string[];
  coerceInteger: (
    raw: unknown,
    bounds: { min: number; max: number; default: number },
  ) => number;
  coerceBoolean: (raw: unknown, fallback: boolean) => boolean;
  initialSelection: (registered: string[], enabled: string[]) => string[];

  // P1-T21's half.
  columns: { id: string; messageId: string; captioned: boolean }[];
  authorName: (author: unknown) => string;
  authorSummary: (
    authors: unknown[],
    shown: number,
  ) => { names: string; overflow: number };
  yearText: (year: unknown) => string;
  rowKey: (record: unknown, index: number) => string;
  rowsFromRecords: (
    records: TableRecord[],
    authorNamesShown: number,
  ) => DisplayRow[];
  filterText: (row: DisplayRow) => string;
  matchesFilter: (row: DisplayRow, needle: string) => boolean;
  visibleRows: (
    rows: DisplayRow[],
    view: { filter: string; hideExisting: boolean },
  ) => DisplayRow[];
  selectionAfterResults: (rows: DisplayRow[]) => string[];
  applySelection: (
    selectedKeys: string[],
    visibleKeys: string[],
    command: "all" | "none" | "invert",
  ) => string[];
  pickedKeys: (visibleRows: DisplayRow[], selectedKeys: string[]) => string[];
  visibleCounts: (
    visibleRows: DisplayRow[],
    selectedKeys: string[],
  ) => { total: number; new: number; selected: number };
  allVisibleSelected: (
    visibleRows: DisplayRow[],
    selectedKeys: string[],
  ) => boolean;
}

interface Controller {
  spec: ControllerSpec;
  l10n: Record<string, string>;
  logic: ControllerLogic;
  clock: { now: () => number };
  state: {
    running: boolean;
    selectedCount: number;
    panel: string;
    results: TableRecord[];
    rows: DisplayRow[];
    visible: DisplayRow[];
    selection: string[];
    view: { filter: string; hideExisting: boolean };
  };
  host: Record<string, unknown>;
  io: Record<string, unknown>;
  init: () => void;
  applyChromeStrings: () => Promise<void> | undefined;
  applyColumnLabels: () => Promise<void> | undefined;
  refreshSearchGate: () => { enabled: boolean; messageId: string | null };
  refreshImportGate: () => boolean;
  showPanel: (name: string) => void;
  collectQuery: () => Record<string, unknown>;
  collectImportRequest: () => Record<string, unknown>;
  search: () => void;
  setResults: (records: TableRecord[]) => number;
  applyFilter: () => { total: number; new: number; selected: number };
  selectVisible: (command: "all" | "none" | "invert") => {
    total: number;
    new: number;
    selected: number;
  };
  toggleRow: (key: string, checked: boolean) => unknown;
  refreshSelection: () => { total: number; new: number; selected: number };
  refreshImportLabel: (count: number) => Promise<void> | undefined;
  onTableKeydown: (event: unknown) => void;
  pickedRows: () => TableRecord[];
  rowCheckboxes: () => FakeElement[];
  [key: string]: unknown;
}

interface Harness {
  readonly controller: Controller;
  readonly byId: (id: string) => FakeElement | undefined;
  readonly registerRootCalls: FakeElement[];
  readonly prefReads: string[];
  readonly doc: {
    title: string;
    listeners: Map<string, ((event: unknown) => void)[]>;
    dispatch: (type: string, event?: unknown) => void;
  };
}

interface HarnessOptions {
  readonly nowEpochMs?: number;
  readonly prefs?: Record<string, unknown>;
  readonly host?: Record<string, unknown>;
  readonly args?: Record<string, unknown>;
  readonly l10n?: readonly FakeL10nMessage[];
  readonly omitUIProperties?: boolean;
  /**
   * Replace `document.l10n.formatMessages` outright.
   *
   * `P1-T21` needs it to resolve two requests **out of order**, which is the
   * defect a live window actually produced: the Import button's label is
   * formatted asynchronously on every selection change, and the earlier request
   * resolving last left the button reading `Import 40 items` with 35 selected.
   */
  readonly formatMessages?: (
    requests: readonly { id: string; args?: Record<string, unknown> }[],
  ) => Promise<readonly FakeL10nMessage[]>;
}

/** Mirror the parsed markup into {@link FakeElement}s. */
function instantiate(node: Node, index: Map<string, FakeElement>): FakeElement {
  const element = new FakeElement(node.name, new Map(node.attrs));
  const id = node.attrs.get("id");
  if (id !== undefined) index.set(id, element);
  for (const child of node.children) {
    element.appendChild(instantiate(child, index));
  }
  return element;
}

/**
 * Evaluate the shipped `addon/content/searchDialog.js` against a fake document.
 *
 * `new Function` rather than `import`: the file is a classic script with no
 * exports (see this spec's header), and `Zotero`, `window` and `document` are
 * the three globals it names, so they become the factory's parameters.
 */
function harness(options: HarnessOptions = {}): Harness {
  const index = new Map<string, FakeElement>();
  instantiate(DOCUMENT, index);

  const registerRootCalls: FakeElement[] = [];
  const prefReads: string[] = [];
  const docListeners = new Map<string, ((event: unknown) => void)[]>();

  const doc = {
    title: "",
    listeners: docListeners,
    getElementById: (id: string): FakeElement | null => index.get(id) ?? null,
    createXULElement: (name: string): FakeElement =>
      new FakeElement(name, new Map()),
    createElement: (name: string): FakeElement =>
      new FakeElement(name, new Map()),
    // `createElementNS` and not `createElement`: in a XUL document the latter
    // yields a XUL element named `tr`, which is not a table row. The namespace
    // is recorded so the spec can assert the table is really XHTML.
    createElementNS: (namespace: string, name: string): FakeElement => {
      const element = new FakeElement(name, new Map());
      element.namespace = namespace;
      return element;
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const bucket = docListeners.get(type) ?? [];
      bucket.push(handler);
      docListeners.set(type, bucket);
    },
    dispatch: (type: string, event: unknown = {}) => {
      for (const handler of docListeners.get(type) ?? []) handler(event);
    },
    l10n: {
      formatMessages:
        options.formatMessages ??
        ((
          requests: readonly { id: string }[],
        ): Promise<readonly FakeL10nMessage[]> =>
          Promise.resolve(
            options.l10n ??
              requests.map((request) => ({
                value: `value:${request.id}`,
                attributes: [{ name: "label", value: `label:${request.id}` }],
              })),
          )),
    },
  };

  const prefs = options.prefs ?? {};
  const zotero = {
    UIProperties: options.omitUIProperties
      ? undefined
      : {
          registerRoot: (element: FakeElement) => {
            registerRootCalls.push(element);
          },
        },
    Prefs: {
      get: (key: string): unknown => {
        prefReads.push(key);
        const bare = key.slice(key.indexOf(".") + 1);
        return prefs[bare];
      },
    },
    __addonInstance__: options.host
      ? { api: { searchWindow: options.host } }
      : undefined,
  };

  const win = {
    arguments: [options.args ?? { mode: "keyword" }],
    addEventListener: () => undefined,
  };

  // `new Function` rather than an import: the file under test is a classic
  // chrome script with no exports; see this spec's header.
  const factory = new Function(
    "Zotero",
    "window",
    "document",
    `${SCRIPT_BUILT}\nreturn RHSearchWindow;`,
  ) as (zotero: unknown, win: unknown, document: unknown) => Controller;

  const controller = factory(zotero, win, doc);
  if (options.nowEpochMs !== undefined) {
    const at = options.nowEpochMs;
    controller.clock = { now: () => at };
  }
  return {
    controller,
    byId: (id) => index.get(id),
    registerRootCalls,
    prefReads,
    doc,
  };
}

/** `Date.UTC` in the local zone would drift the year at a boundary. */
function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

const PUBMED = {
  id: "pubmed",
  displayNameKey: "research-helper-source-pubmed",
};
const CROSSREF = {
  id: "crossref",
  displayNameKey: "research-helper-source-crossref",
};

// ===========================================================================
// 3. docs/08 §4.2's date default — the card's "Done when" item 2
// ===========================================================================

describe("the year range is computed at window open (docs/08 §4.2)", () => {
  const { controller } = harness();

  it("reads 2024 – 2026 with today at the card's 2026-09-09", () => {
    expect(
      controller.logic.yearRange(localMidnight(2026, 9, 9), 3),
    ).toStrictEqual({ from: 2024, to: 2026, years: 3 });
  });

  it("still means something in 2027, which a fixed year pair would not", () => {
    // The card pins its criterion to a past date, and `currentYear - 2` happens
    // to give the same pair on the day it ran. These two assertions are what
    // make the criterion a statement about the computation rather than about
    // the calendar.
    expect(
      controller.logic.yearRange(localMidnight(2027, 1, 1), 3),
    ).toStrictEqual({ from: 2025, to: 2027, years: 3 });
    expect(
      controller.logic.yearRange(localMidnight(2031, 12, 31), 3),
    ).toStrictEqual({ from: 2029, to: 2031, years: 3 });
  });

  it("follows searchYears across docs/07 §8.5's whole 1–20 range", () => {
    const now = localMidnight(2026, 9, 9);
    const min = PREFS.searchYears.min;
    const max = PREFS.searchYears.max;
    expect(controller.logic.yearRange(now, min)).toStrictEqual({
      from: 2026,
      to: 2026,
      years: 1,
    });
    expect(controller.logic.yearRange(now, max)).toStrictEqual({
      from: 2007,
      to: 2026,
      years: 20,
    });
  });

  it("offers every span the preference permits in each menulist", () => {
    const options = controller.logic.yearOptions(2026, PREFS.searchYears.max);
    expect(options).toHaveLength(PREFS.searchYears.max);
    expect(options[0]).toBe(2026);
    expect(options.at(-1)).toBe(2007);
  });

  it("states the span in the label, from the shipped en-US bundle", () => {
    // §4.2: "Expose the exact semantics in the UI label (`2024 – 2026`) so the
    // user is never guessing". The label is one Fluent message, so this
    // substitutes into the real bundle rather than re-stating the format.
    const bundle = readFileSync(
      resolve(addon, "locale/en-US/research-helper-searchDialog.ftl"),
      "utf8",
    );
    const variant = bundle
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("*[other]"));
    expect(variant).toBeDefined();
    const range = controller.logic.yearRange(localMidnight(2026, 9, 9), 3);
    const rendered = (variant ?? "")
      .replace("*[other]", "")
      .replace("{ $from }", String(range.from))
      .replace("{ $to }", String(range.to))
      .replace("{ $years }", String(range.years))
      .trim();
    expect(rendered).toBe("2024 – 2026 (last 3 calendar years)");
  });
});

// ===========================================================================
// 4. FR-2's Search gate — the card's "Done when" item 4
// ===========================================================================

describe("FR-2's Search gate (docs/08 §4.2)", () => {
  const { controller } = harness();

  it("disables Search when the user unchecks every source", () => {
    const gate = controller.logic.searchGate({
      available: ["pubmed", "crossref"],
      selected: [],
    });
    expect(gate.enabled).toBe(false);
    expect(gate.messageId).toBe(controller.l10n.databasesNone);
  });

  it("disables Search when no source is registered at all", () => {
    // The state the plugin is actually in on 2026-10-06: `registerSources()`
    // is called from no startup path, so the registry is empty and the row
    // renders nothing. A window whose Search button looked enabled and did
    // nothing would be worse than one that says why.
    const gate = controller.logic.searchGate({ available: [], selected: [] });
    expect(gate.enabled).toBe(false);
    expect(gate.messageId).toBe(controller.l10n.databasesNone);
  });

  it("enables Search with at least one source selected", () => {
    const gate = controller.logic.searchGate({
      available: ["pubmed"],
      selected: ["pubmed"],
    });
    expect(gate.enabled).toBe(true);
    expect(gate.messageId).toBeNull();
  });

  it("uses a message id the shipped bundle declares", () => {
    expect(SEARCH_DIALOG_MESSAGE_IDS).toContain(controller.l10n.databasesNone);
  });

  it("disables Import until a row is selected (docs/08 §4.2)", () => {
    expect(controller.logic.importEnabled(0)).toBe(false);
    expect(controller.logic.importEnabled(1)).toBe(true);
    expect(controller.logic.importEnabled(40)).toBe(true);
  });
});

// ===========================================================================
// 5. init() against the real markup
// ===========================================================================

describe("init() wires the real document", () => {
  it("calls Zotero.UIProperties.registerRoot on the dialog root", () => {
    // docs/08 §4.1.1 requirement 2 and §9 both call omitting this call "a real
    // accessibility defect": without it the dialog ignores the font size,
    // density and RTL setting the user chose for Zotero.
    const h = harness();
    h.controller.init();
    expect(h.registerRootCalls).toHaveLength(1);
    expect(h.registerRootCalls[0]?.id).toBe(SEARCH_WINDOW_ROOT_ID);
    expect(h.registerRootCalls[0]?.name).toBe("dialog");
  });

  it("renders zero database checkboxes when nothing is registered", () => {
    const h = harness();
    h.controller.init();
    const row = h.byId("rh-search-databases");
    expect(row?.children).toHaveLength(0);
    expect(h.byId("rh-search-run")?.disabled).toBe(true);
    const message = h.byId("rh-search-databases-none");
    expect(message?.hidden).toBe(false);
    expect(message?.getAttribute("data-l10n-id")).toBe(
      h.controller.l10n.databasesNone,
    );
  });

  it("renders one checkbox per registered source, in registration order", () => {
    const h = harness({ host: { listSources: () => [PUBMED, CROSSREF] } });
    h.controller.init();
    const row = h.byId("rh-search-databases");
    expect(row?.children.map((box) => box.getAttribute("value"))).toStrictEqual(
      ["pubmed", "crossref"],
    );
    expect(
      row?.children.map((box) => box.getAttribute("data-l10n-id")),
    ).toStrictEqual([PUBMED.displayNameKey, CROSSREF.displayNameKey]);
    expect(h.byId("rh-search-run")?.disabled).toBe(false);
    expect(h.byId("rh-search-databases-none")?.hidden).toBe(true);
  });

  it("falls back to the gate when the user unchecks the registered ones", () => {
    const h = harness({ host: { listSources: () => [PUBMED, CROSSREF] } });
    h.controller.init();
    const row = h.byId("rh-search-databases");
    for (const box of row?.children ?? []) box.checked = false;
    const gate = h.controller.refreshSearchGate();
    expect(gate.enabled).toBe(false);
    expect(h.byId("rh-search-run")?.disabled).toBe(true);
    expect(h.byId("rh-search-databases-none")?.hidden).toBe(false);
  });

  it("seeds every default from docs/07 §8.5 and never from a literal", () => {
    const h = harness({ nowEpochMs: localMidnight(2026, 9, 9) });
    h.controller.init();

    expect(h.byId("rh-search-years-from")?.value).toBe("2024");
    expect(h.byId("rh-search-years-to")?.value).toBe("2026");

    const max = h.byId("rh-search-max-results");
    expect(max?.value).toBe(String(PREFS.maxResults.default));
    expect(max?.getAttribute("min")).toBe(String(PREFS.maxResults.min));
    expect(max?.getAttribute("max")).toBe(String(PREFS.maxResults.max));
    expect(max?.getAttribute("step")).toBe("10");

    expect(h.byId("rh-search-hide-existing")?.checked).toBe(
      PREFS.hideExisting.default,
    );
    expect(h.byId("rh-search-duplicates")?.value).toBe(
      h.controller.spec.duplicatesDefault,
    );
  });

  it("reads its seeds off the plugin's own preference branch", () => {
    const h = harness({ prefs: { maxResults: "200", searchYears: 5 } });
    h.controller.init();
    // The pane's `preference=` binding stringifies on the way out (docs/08
    // §7.2), so a touched maxResults arrives as a string; docs/07 §8.5.1 calls
    // string arithmetic on it "a classic and very confusing bug".
    expect(h.byId("rh-search-max-results")?.value).toBe("200");
    expect(h.prefReads).toContain(`${ADDON_REF}.${PREF_KEYS.maxResults}`);
    expect(h.prefReads).toContain(`${ADDON_REF}.${PREF_KEYS.searchYears}`);
    expect(h.prefReads).toContain(`${ADDON_REF}.${PREF_KEYS.hideExisting}`);
    expect(h.prefReads).toContain(`${ADDON_REF}.${PREF_KEYS.sources}`);
    // The branch prefix is `src/prefs/keys.ts`'s `PREF_BRANCH`, derived from
    // the build placeholder rather than typed out.
    expect(SCRIPT).toContain('"__addonRef__." + key');
  });

  it("prefers the host's typed accessor over the branch when one is attached", () => {
    const h = harness({
      prefs: { maxResults: 10 },
      host: { getPrefs: () => ({ maxResults: 150, hideExisting: false }) },
    });
    h.controller.init();
    expect(h.byId("rh-search-max-results")?.value).toBe("150");
    expect(h.byId("rh-search-hide-existing")?.checked).toBe(false);
    expect(h.prefReads).toStrictEqual([]);
  });

  it("falls back to §8.5's default for an out-of-range stored value", () => {
    // src/prefs/index.ts's rule, and its reason: clamping would silently keep
    // a corrupt value in play.
    const h = harness({ prefs: { maxResults: 9999 } });
    h.controller.init();
    expect(h.byId("rh-search-max-results")?.value).toBe(
      String(PREFS.maxResults.default),
    );
  });

  it("passes the years as strings, so no year grows a thousands separator", () => {
    // Measured in a live Zotero window: with `{ $from }` bound to a *number*
    // Fluent formats it through `Intl.NumberFormat` and the label reads
    // `2,024 – 2,026`. docs/08 §4.2 requires `2024 – 2026`, so the arguments
    // are strings and `$years` — which selects the plural variant — is not.
    const h = harness({ nowEpochMs: localMidnight(2026, 9, 9) });
    h.controller.init();
    const span = h.byId("rh-search-years-span");
    expect(span?.getAttribute("data-l10n-id")).toBe(
      h.controller.l10n.yearsSpan,
    );
    const args: unknown = JSON.parse(
      span?.getAttribute("data-l10n-args") ?? "",
    );
    expect(args).toStrictEqual({ from: "2024", to: "2026", years: 3 });

    const prose = h.byId("rh-state-initial-prose");
    expect(prose?.getAttribute("data-l10n-id")).toBe(
      h.controller.l10n.stateInitial,
    );
    expect(
      JSON.parse(prose?.getAttribute("data-l10n-args") ?? ""),
    ).toStrictEqual({ years: 3 });
  });

  it("focuses the keyword field on open (docs/08 §4.2)", () => {
    const h = harness();
    h.controller.init();
    expect(h.byId(SEARCH_WINDOW_KEYWORD_ID)?.focused).toBe(true);
  });

  it("shows docs/08 §4.6's INITIAL panel and hides the other three", () => {
    const h = harness();
    h.controller.init();
    expect(h.byId("rh-state-initial")?.hidden).toBe(false);
    for (const id of [
      "rh-state-searching",
      "rh-state-empty",
      "rh-state-error",
      "rh-results-container",
    ]) {
      expect(h.byId(id)?.hidden).toBe(true);
    }
  });

  it("swaps between all four of the card's §4.6 states", () => {
    const h = harness();
    h.controller.init();
    for (const state of ["searching", "empty", "error", "results"]) {
      h.controller.showPanel(state);
      const shown = h.controller.logic.panels[state];
      expect(shown).toBeDefined();
      expect(h.byId(shown ?? "")?.hidden).toBe(false);
      expect(h.byId("rh-state-initial")?.hidden).toBe(true);
    }
  });

  it("starts with Import disabled and enables it on a selection", () => {
    const h = harness();
    h.controller.init();
    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttondisabledaccept"),
    ).toBe("true");
    h.controller.state.selectedCount = 3;
    expect(h.controller.refreshImportGate()).toBe(true);
    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttondisabledaccept"),
    ).toBe("false");
  });

  it("makes Enter in the keyword field start a search (NFR-13)", () => {
    const started: unknown[] = [];
    const h = harness({
      host: {
        listSources: () => [PUBMED],
        runSearch: (query: unknown) => {
          started.push(query);
        },
      },
    });
    h.controller.init();
    let prevented = false;
    h.byId(SEARCH_WINDOW_KEYWORD_ID)?.dispatch("keydown", {
      key: "Enter",
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(started).toHaveLength(1);
  });

  it("opens no search when the gate is closed", () => {
    const started: unknown[] = [];
    const h = harness({
      host: {
        runSearch: () => {
          started.push(1);
        },
      },
    });
    h.controller.init();
    h.controller.search();
    expect(started).toHaveLength(0);
  });

  it("lets Escape close when nothing is running, and cancels first when it is", () => {
    // docs/08 §9: "`Escape` closes the window (and cancels a running job
    // first, with the second `Escape` closing)."
    let cancels = 0;
    const h = harness({
      host: {
        cancel: () => {
          cancels += 1;
        },
      },
    });
    h.controller.init();

    let prevented = false;
    const preventDefault = () => {
      prevented = true;
    };

    h.doc.dispatch("dialogcancel", { preventDefault });
    expect(prevented).toBe(false);
    expect(cancels).toBe(0);

    h.controller.state.running = true;
    h.doc.dispatch("dialogcancel", { preventDefault });
    expect(prevented).toBe(true);
    expect(cancels).toBe(1);
  });

  it("keeps the accept button from closing the window (docs/08 §4.1.1)", () => {
    const imports: unknown[] = [];
    const h = harness({
      host: {
        runImport: () => {
          imports.push(1);
        },
      },
    });
    h.controller.init();
    h.controller.state.selectedCount = 2;
    let prevented = false;
    h.doc.dispatch("dialogaccept", {
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(imports).toHaveLength(1);
  });

  it("is idempotent, so the onload attribute and the load listener agree", () => {
    const h = harness();
    h.controller.init();
    h.controller.init();
    expect(h.registerRootCalls).toHaveLength(1);
  });

  it("sets the window title and both button labels from Fluent", async () => {
    const h = harness();
    h.controller.init();
    await h.controller.applyChromeStrings();
    expect(h.doc.title).toBe(`value:${h.controller.l10n.windowTitle}`);
    const dialog = h.byId(SEARCH_WINDOW_ROOT_ID);
    expect(dialog?.getAttribute("buttonlabelcancel")).toBe(
      `label:${h.controller.l10n.close}`,
    );
    expect(dialog?.getAttribute("buttonlabelaccept")).toBe(
      `label:${h.controller.l10n.import}`,
    );
  });
});

// ===========================================================================
// 6. The markup rules of docs/08 §4.1.1 and P1-T20's Do NOT list
// ===========================================================================

describe("searchDialog.xhtml follows docs/08 §4.1.1", () => {
  const windowEl = firstNamed("window");
  const dialogEl = firstNamed("dialog");

  it("is <window> outside <dialog>, as Zotero 7+ requires", () => {
    expect(windowEl).toBeDefined();
    expect(dialogEl?.parent?.name).toBe("window");
    expect(dialogEl?.attrs.get("id")).toBe(SEARCH_WINDOW_ROOT_ID);
  });

  it("sets no width or height attribute on <window> (requirement 1)", () => {
    // Not recognised since Firefox 115. Size is CSS's, and the assertion below
    // ties the CSS to SEARCH_WINDOW_MIN_SIZE.
    expect(windowEl?.attrs.has("width")).toBe(false);
    expect(windowEl?.attrs.has("height")).toBe(false);
    for (const element of ELEMENTS) {
      expect(element.attrs.has("width")).toBe(false);
      expect(element.attrs.has("height")).toBe(false);
    }
  });

  it("ships the XUL <tooltip> element plus tooltip= (requirement 3)", () => {
    // In a *new* window `tooltiptext` alone shows nothing at all.
    expect(windowEl?.attrs.get("tooltip")).toBe("html-tooltip");
    const tooltip = byId("html-tooltip");
    expect(tooltip?.name).toBe("tooltip");
    expect(tooltip?.attrs.get("page")).toBe("true");
    expect(tooltip?.parent?.name).toBe("window");
  });

  it("links the searchDialog bundle through a <linkset>", () => {
    const linkset = firstNamed("linkset");
    expect(linkset).toBeDefined();
    const link = linkset?.children[0];
    expect(link?.attrs.get("rel")).toBe("localization");
    // src/bootstrap/registerUI.ts builds the mainWindow resource id the same
    // way: `${config.addonRef}-<surface>.ftl`, flat and prefixed, because
    // Zotero 10's registerLocales() drops directory entries (docs/01 §9.1).
    expect(link?.attrs.get("href")).toBe("__addonRef__-searchDialog.ftl");
  });

  it("names RHSearchWindow.init() on load (requirement 2's call site)", () => {
    expect(windowEl?.attrs.get("onload")).toBe("RHSearchWindow.init()");
  });

  it("has no inline script and no remote resource (docs/01 §8.3)", () => {
    const scripts = ELEMENTS.filter((element) => element.name === "script");
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.attrs.has("src")).toBe(true);
      expect(script.text).toStrictEqual([]);
    }
    // Only a *resource* reference may not be remote. The two `http://…`
    // strings in the document are the XUL and XHTML namespace URIs, which name
    // a namespace and fetch nothing.
    for (const element of ELEMENTS) {
      for (const attribute of ["src", "href", "style"]) {
        expect(
          element.attrs.get(attribute) ?? "",
          `<${element.name} ${attribute}>`,
        ).not.toMatch(/https?:\/\//);
      }
    }
    expect(stripProlog(XHTML)).not.toMatch(/url\(\s*['"]?https?:/);
    // Every chrome URL in the document derives the package name from
    // `__addonRef__` rather than spelling it: docs/08 §4.1 carried the
    // unhyphenated spelling until 2026-10-05 and P1-T19 measured that the
    // wrong one resolves to nothing at all.
    for (const url of XHTML.match(/chrome:\/\/[^"'\s)]+/g) ?? []) {
      expect(
        url.startsWith("chrome://__addonRef__/") ||
          url.startsWith("chrome://global/") ||
          url.startsWith("chrome://zotero/") ||
          url.startsWith("chrome://zotero-platform/"),
      ).toBe(true);
    }
  });

  it("declares every data-l10n-id in P1-T18's searchDialog bundle", () => {
    const ids = ELEMENTS.map((element) =>
      element.attrs.get("data-l10n-id"),
    ).filter((id): id is string => id !== undefined);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      expect(SEARCH_DIALOG_MESSAGE_IDS).toContain(id);
    }
  });

  it("survives a grep for a literal human-readable string", () => {
    // P1-T20's last "Done when" item, made mechanical: no text node, and no
    // attribute XUL renders as a visible string.
    const RENDERED = [
      "label",
      "value",
      "title",
      "tooltiptext",
      "placeholder",
      "accesskey",
      "buttonlabelaccept",
      "buttonlabelcancel",
      "buttonlabelextra1",
      "buttonlabelextra2",
    ];
    for (const element of ELEMENTS) {
      expect(element.text, `text in <${element.name}>`).toStrictEqual([]);
      for (const attribute of RENDERED) {
        const held = element.attrs.get(attribute);
        // `value` on a <radio>, a <menuitem> or a <checkbox> is the datum the
        // control reports, not a caption, so a machine-readable one is allowed
        // and a human-readable one is not.
        const machineReadable =
          attribute === "value" && /^[a-z0-9_-]+$/.test(held ?? "");
        expect(
          held === undefined || machineReadable,
          `<${element.name} ${attribute}="${held ?? ""}">`,
        ).toBe(true);
      }
    }
  });

  it("registers no tabindex, so Tab follows docs/08 §4.5's layout order", () => {
    for (const element of ELEMENTS) {
      expect(element.attrs.has("tabindex")).toBe(false);
    }
  });

  it("lays the rows out in docs/08 §4.5's order", () => {
    const rows = (dialogEl?.children ?? [])
      .map((child) => child.attrs.get("id"))
      .filter((id): id is string => id !== undefined);
    expect(rows).toStrictEqual([
      "rh-search-query-row",
      "rh-search-scope-row",
      "rh-search-databases-group",
      "rh-search-filter-row",
      "rh-results-area",
      "rh-search-target-row",
      "rh-search-duplicates-group",
      "rh-search-status-bar",
    ]);
  });

  it("labels every input and every groupbox (docs/08 §9)", () => {
    for (const element of ELEMENTS) {
      if (element.name === "groupbox") {
        const labelledBy = element.attrs.get("aria-labelledby");
        expect(
          labelledBy,
          `<groupbox id=${element.attrs.get("id")}>`,
        ).toBeDefined();
        expect(byId(labelledBy ?? "")).toBeDefined();
      }
    }
    // Each `<label control="…">` must point at an element that exists; XUL's
    // `control` is the equivalent of HTML `for` (§9).
    const controls = ELEMENTS.map((element) =>
      element.attrs.get("control"),
    ).filter((id): id is string => id !== undefined);
    expect(controls.length).toBeGreaterThan(3);
    for (const id of controls) {
      expect(byId(id), `control="${id}"`).toBeDefined();
    }
  });

  it("gives every id the controller names an element in the document", () => {
    const { controller } = harness();
    const ids = Object.entries(controller.spec)
      .filter(([, value]) => typeof value === "string")
      .filter(([key]) => key !== "duplicatesDefault")
      .map(([, value]) => value as string);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      expect(byId(id), `spec id "${id}"`).toBeDefined();
    }
    for (const panel of Object.values(controller.logic.panels)) {
      expect(byId(panel), `panel "${panel}"`).toBeDefined();
    }
  });
});

// ===========================================================================
// 7. The stylesheet, and the one number it shares with src/
// ===========================================================================

describe("searchDialog.css sizes the window the only way that works", () => {
  it("carries SEARCH_WINDOW_MIN_SIZE, matching the feature string", () => {
    expect(CSS).toContain(`min-width: ${SEARCH_WINDOW_MIN_SIZE.width}px`);
    expect(CSS).toContain(`min-height: ${SEARCH_WINDOW_MIN_SIZE.height}px`);
    expect(SEARCH_WINDOW_FEATURES).toContain(
      `minwidth=${SEARCH_WINDOW_MIN_SIZE.width}`,
    );
    expect(SEARCH_WINDOW_FEATURES).toContain(
      `minheight=${SEARCH_WINDOW_MIN_SIZE.height}`,
    );
  });

  it("fixes no width on a label or a button (docs/08 §10.3)", () => {
    // Korean menu labels are longer than their English counterparts and a
    // fixed width truncates them, so only `min-*` bounds are allowed.
    expect(CSS_CODE).not.toMatch(/(^|[\s;{])width\s*:/);
    expect(CSS_CODE).not.toMatch(/(^|[\s;{])height\s*:/);
  });

  it("sets no pixel font size, so Zotero's scaling still applies (§9)", () => {
    expect(CSS_CODE).not.toMatch(/font-size\s*:\s*\d+px/);
  });

  it("takes every colour from a Zotero variable (§9)", () => {
    const colours = CSS_CODE.match(
      /(?:^|[\s;{])(?:color|background)\s*:[^;]+;/gm,
    );
    for (const declaration of colours ?? []) {
      expect(declaration, declaration).toMatch(/var\(--|inherit/);
    }
  });
});

// ===========================================================================
// 8. The controller's constants against their authorities
// ===========================================================================

describe("the controller's constants come from docs/07 §8.5", () => {
  const { controller } = harness();

  it("names only preference keys src/prefs/keys.ts declares", () => {
    const declared = Object.values(PREF_KEYS) as string[];
    for (const key of Object.values(controller.spec.prefKeys)) {
      expect(declared, `pref key "${key}"`).toContain(key);
    }
  });

  it("transcribes §8.5's ranges and defaults for the two it seeds", () => {
    expect(controller.spec.prefBounds.searchYears).toStrictEqual({
      min: PREFS.searchYears.min,
      max: PREFS.searchYears.max,
      default: PREFS.searchYears.default,
    });
    expect(controller.spec.prefBounds.maxResults).toStrictEqual({
      min: PREFS.maxResults.min,
      max: PREFS.maxResults.max,
      step: 10,
      default: PREFS.maxResults.default,
    });
    expect(controller.spec.prefBounds.hideExisting).toStrictEqual({
      default: PREFS.hideExisting.default,
    });
  });

  it("agrees with the §8.5 table row itself, not only with src/prefs", () => {
    // plan/README.md §5 rule 8: cite what the grep returned. docs/07 §8.5 is
    // the sole authority for a preference's default and allowed values, and it
    // states outright that a disagreeing restatement elsewhere is the defect —
    // so the row is read here rather than trusted through one transcription.
    const doc07 = readFileSync(
      resolve(docsDir, "07-architecture-and-data-model.md"),
      "utf8",
    );
    const row = (key: string): string[] => {
      const line = doc07
        .split("\n")
        .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
      if (line === undefined) throw new Error(`docs/07 §8.5 has no ${key} row`);
      return line.split("|").map((cell) => cell.trim());
    };

    const maxResults = row("maxResults");
    expect(maxResults[3]).toBe("`100`");
    expect(maxResults[4]).toBe("10–200, step 10");

    const searchYears = row("searchYears");
    expect(searchYears[3]).toBe("`3`");
    expect(searchYears[4]).toBe("1–20");

    // And the controller agrees with what was just read, not with a copy.
    expect(controller.spec.prefBounds.maxResults).toStrictEqual({
      min: 10,
      max: 200,
      step: 10,
      default: 100,
    });
    expect(controller.spec.prefBounds.searchYears).toStrictEqual({
      min: 1,
      max: 20,
      default: 3,
    });

    // The stale figure docs/08 §4.2 used to carry. If it ever reappears in the
    // controller, this is what catches it.
    expect(SCRIPT).not.toMatch(/\b50\b/);
  });

  it("declares every Fluent id it sets from script", () => {
    for (const id of Object.values(controller.l10n)) {
      expect(SEARCH_DIALOG_MESSAGE_IDS, id).toContain(id);
    }
  });

  it("coerces a preference the way src/prefs/index.ts does", () => {
    const bounds = { min: 10, max: 200, default: 100 };
    expect(controller.logic.coerceInteger("55", bounds)).toBe(55);
    expect(controller.logic.coerceInteger(55, bounds)).toBe(55);
    expect(controller.logic.coerceInteger("", bounds)).toBe(100);
    expect(controller.logic.coerceInteger(true, bounds)).toBe(100);
    expect(controller.logic.coerceInteger(9, bounds)).toBe(100);
    expect(controller.logic.coerceInteger(201, bounds)).toBe(100);
    expect(controller.logic.coerceInteger("3.5", bounds)).toBe(100);
    expect(controller.logic.coerceBoolean("false", true)).toBe(false);
    expect(controller.logic.coerceBoolean("true", false)).toBe(true);
    expect(controller.logic.coerceBoolean(undefined, true)).toBe(true);
  });

  it("treats the sources preference as a membership set (docs/07 §8.5)", () => {
    expect(controller.logic.parseSourceIds("pubmed, crossref ,")).toStrictEqual(
      ["pubmed", "crossref"],
    );
    expect(controller.logic.parseSourceIds(undefined)).toStrictEqual([]);
    expect(
      controller.logic.initialSelection(["pubmed", "crossref"], ["crossref"]),
    ).toStrictEqual(["crossref"]);
    expect(controller.logic.initialSelection(["pubmed"], [])).toStrictEqual([
      "pubmed",
    ]);
    expect(controller.logic.initialSelection([], ["pubmed"])).toStrictEqual([]);
  });

  it("names no literature source of its own (P1-T20 Do NOT)", () => {
    // "Do not fake the other six — a checkbox that searches nothing is worse
    // than an absent one, and Phase 2 adds them by registration alone."
    for (const id of [
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
      "biorxiv",
      "medrxiv",
    ]) {
      expect(XHTML, `${id} in the markup`).not.toContain(id);
    }
  });

  it("makes no network call from the document (docs/01 §8.3)", () => {
    expect(SCRIPT_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(SCRIPT_CODE).not.toMatch(/XMLHttpRequest/);
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.HTTP/);
    expect(XHTML).not.toMatch(/\bfetch\s*\(/);
  });
});

// ===========================================================================
// 9. P1-T21 — the result table, its selection model and its filter
//
// `docs/08` §4.2's columns, §4.3's plain-table decision, §4.5's wireframe, §9's
// keyboard and naming rules, FR-5's arithmetic, NFR-13's "colour is never the
// sole carrier of meaning", and `docs/07` §8.5's `hideExisting`.
//
// **This block is in `test/unit/ui/searchDialog.test.ts` and `P1-T21`'s `Files`
// list names only `test/integration/searchDialog-table.spec.ts`, which is
// reported with the card** — the same gap `P1-T20` reported for this file's
// existence. The integration spec it does name opens a real window; what cannot
// be reached from there is the pure selection model with every count readable in
// isolation, which is precisely where a filter-versus-selection defect hides.
// ===========================================================================

/** One record in the shape the host hands {@link Controller.setResults}. */
function record(n: number, overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: `10.1000/rh.${String(n)}`,
    title: `Hepatocyte delivery study ${String(n)}`,
    authors: [{ family: `Kim${String(n)}` }],
    year: 2024 + (n % 3),
    sourceLabels: ["PubMed"],
    typeLabel: "journal-article",
    doi: `10.1000/rh.${String(n)}`,
    ...overrides,
  };
}

/** 40 results, `existingAt` of them already in the library. */
function fortyResults(existingAt: readonly number[] = []): TableRecord[] {
  return Array.from({ length: 40 }, (_unused, n) =>
    existingAt.includes(n) ? record(n, { existing: true }) : record(n),
  );
}

describe("P1-T21 — the result table's pure model", () => {
  const { controller } = harness();
  const logic = controller.logic;

  it("takes docs/08 §4.2's seven columns, in §4.2's order", () => {
    expect(logic.columns.map((column) => column.messageId)).toStrictEqual([
      "research-helper-search-col-select",
      "research-helper-search-col-title",
      "research-helper-search-col-authors",
      "research-helper-search-col-year",
      "research-helper-search-col-source",
      "research-helper-search-col-type",
      "research-helper-search-col-doi",
    ]);
    for (const column of logic.columns) {
      expect(SEARCH_DIALOG_MESSAGE_IDS, column.messageId).toContain(
        column.messageId,
      );
      expect(byId(column.id), `column <th id="${column.id}">`).toBeDefined();
      expect(byId(column.id)?.name).toBe("html:th");
    }
    // The document's `<th>`s are in the same order as the model's columns, so a
    // reordered header cannot silently caption the wrong column.
    const head = byId("rh-results-head-row");
    expect(head?.children.map((cell) => cell.attrs.get("id"))).toStrictEqual(
      logic.columns.map((column) => column.id),
    );
  });

  it("captions six columns and leaves the ☑ header to its checkbox", () => {
    // `research-helper-search-col-select` is an `.aria-label`, declared on the
    // select-all checkbox in the markup; the other six are `.label` entries,
    // which an <html:th> does not render, so they are resolved in script.
    expect(logic.columns.filter((column) => column.captioned)).toHaveLength(6);
    expect(logic.columns[0]?.captioned).toBe(false);
    const box = byId("rh-results-select-all-box");
    expect(box?.attrs.get("data-l10n-id")).toBe(
      "research-helper-search-col-select",
    );
    expect(box?.attrs.get("type")).toBe("checkbox");
  });

  it("renders §4.5's authors cell as names plus an overflow count", () => {
    const five = [
      { family: "Kim" },
      { family: "Park" },
      { family: "Novak" },
      { family: "Chen" },
      { family: "Ito" },
    ];
    expect(logic.authorSummary(five, 3)).toStrictEqual({
      names: "Kim, Park, Novak",
      overflow: 2,
    });
    expect(logic.authorSummary(five.slice(0, 2), 3)).toStrictEqual({
      names: "Kim, Park",
      overflow: 0,
    });
    expect(logic.authorSummary([], 3)).toStrictEqual({
      names: "",
      overflow: 0,
    });
    // A literal-only name and a bare string both render; a nameless author is
    // dropped rather than drawn as an empty slot in the list.
    expect(logic.authorName({ literal: "WHO Expert Committee" })).toBe(
      "WHO Expert Committee",
    );
    expect(logic.authorName("Adeyemi")).toBe("Adeyemi");
    expect(logic.authorName({ given: "Jane" })).toBe("");
    expect(logic.authorSummary([{ given: "Jane" }, "Rossi"], 3)).toStrictEqual({
      names: "Rossi",
      overflow: 0,
    });
  });

  it("writes a year as digits, never through a number formatter", () => {
    // The `2,024` defect P1-T20 measured cannot recur here: the year goes into
    // textContent, so no Fluent and no Intl.NumberFormat is involved.
    expect(logic.yearText(2026)).toBe("2026");
    expect(logic.yearText("2026")).toBe("2026");
    expect(logic.yearText(undefined)).toBe("");
    expect(logic.yearText("")).toBe("");
    expect(logic.yearText(2026.7)).toBe("2026");
  });

  it("keys a row on the host's key, and never on two rows at once", () => {
    const rows = logic.rowsFromRecords(
      [
        { key: "10.1/a", title: "A" },
        { key: "10.1/a", title: "B" },
        { title: "C" },
      ],
      3,
    );
    expect(rows.map((row) => row.key)).toStrictEqual([
      "10.1/a",
      "rh-row-1",
      "rh-row-2",
    ]);
    // Two rows sharing a key would share a checkbox, and FR-5's "exactly 35"
    // would quietly become 34.
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("filters client-side over every column the table shows", () => {
    const rows = logic.rowsFromRecords(
      [
        {
          key: "a",
          title: "Ionizable lipid design",
          authors: [{ family: "Chen" }],
          year: 2025,
          sourceLabels: ["bioRxiv"],
          typeLabel: "preprint",
          doi: "10.1101/abc",
        },
      ],
      3,
    );
    const row = rows[0] as DisplayRow;
    for (const needle of [
      "ionizable",
      "IONIZABLE",
      "chen",
      "2025",
      "biorxiv",
      "preprint",
      "10.1101",
    ]) {
      expect(logic.matchesFilter(row, needle), needle).toBe(true);
    }
    expect(logic.matchesFilter(row, "hepatocyte")).toBe(false);
    // An empty or whitespace-only filter hides nothing.
    expect(logic.matchesFilter(row, "")).toBe(true);
    expect(logic.matchesFilter(row, "   ")).toBe(true);
  });

  it("hides existing rows without removing them (reversible, docs/07 §8.5)", () => {
    const rows = logic.rowsFromRecords(fortyResults([0, 1, 2, 3, 4]), 3);
    expect(rows).toHaveLength(40);
    const hidden = logic.visibleRows(rows, { filter: "", hideExisting: true });
    expect(hidden).toHaveLength(35);
    // The same `rows` array answers the other way round, which is what makes
    // unticking the checkbox restore the five without re-running the search.
    expect(
      logic.visibleRows(rows, { filter: "", hideExisting: false }),
    ).toHaveLength(40);
  });

  // --- the invariant this card exists to get right -------------------------

  it("keeps the selection keyed on the row, so a filter never changes it", () => {
    const rows = logic.rowsFromRecords(fortyResults(), 3);
    let selection = logic.selectionAfterResults(rows);
    expect(selection).toHaveLength(40);

    // The user unchecks five.
    const unchecked = rows.slice(0, 5).map((row) => row.key);
    selection = logic.applySelection(selection, unchecked, "none");
    expect(selection).toHaveLength(35);

    // Then filters down to three rows and clicks "select none".
    const narrow = rows.slice(10, 13);
    const narrowKeys = narrow.map((row) => row.key);
    selection = logic.applySelection(selection, narrowKeys, "none");

    // 35 − 3 = 32, which is only true if the command touched the visible rows
    // and nothing else: a selection held as *indices into the visible list*
    // would have deselected rows 10–12 of the filtered view, i.e. three
    // different rows, and a command applied to the whole set would have left 0.
    expect(selection).toHaveLength(32);

    // Clearing the filter brings every row back with its own state.
    const restored = logic.visibleRows(rows, {
      filter: "",
      hideExisting: false,
    });
    expect(restored).toHaveLength(40);
    const selected = new Set(selection);
    expect(restored.slice(0, 5).every((row) => selected.has(row.key))).toBe(
      false,
    );
    expect(narrow.every((row) => selected.has(row.key))).toBe(false);
    expect(restored.slice(5, 10).every((row) => selected.has(row.key))).toBe(
      true,
    );
    expect(restored.slice(13).every((row) => selected.has(row.key))).toBe(true);
  });

  it("never lets select-all reach a row the filter is hiding", () => {
    const rows = logic.rowsFromRecords(fortyResults(), 3);
    const visible = rows.slice(0, 4);
    const selection = logic.applySelection(
      [],
      visible.map((row) => row.key),
      "all",
    );
    expect(selection).toHaveLength(4);
    expect(selection).toStrictEqual(visible.map((row) => row.key));
    // And in the other direction: what Import receives is the intersection, so
    // a hidden row cannot be imported either.
    expect(
      logic.pickedKeys(visible, [...selection, "rh-row-99"]),
    ).toStrictEqual(visible.map((row) => row.key));
  });

  it("inverts only the visible rows", () => {
    const rows = logic.rowsFromRecords(fortyResults(), 3);
    const visible = rows.slice(0, 4);
    const hiddenKey = rows[20]?.key as string;
    const before = [visible[0]?.key as string, hiddenKey];
    const after = logic.applySelection(
      before,
      visible.map((row) => row.key),
      "invert",
    );
    expect(new Set(after)).toStrictEqual(
      new Set([
        hiddenKey,
        visible[1]?.key as string,
        visible[2]?.key as string,
        visible[3]?.key as string,
      ]),
    );
  });

  it("counts only the visible rows, and only the new ones as new", () => {
    const rows = logic.rowsFromRecords(fortyResults([0, 1]), 3);
    const visible = logic.visibleRows(rows, {
      filter: "",
      hideExisting: false,
    });
    const selection = logic
      .selectionAfterResults(rows)
      .filter((key) => key !== rows[5]?.key);
    expect(logic.visibleCounts(visible, selection)).toStrictEqual({
      total: 40,
      new: 38,
      selected: 39,
    });
    expect(logic.allVisibleSelected(visible, selection)).toBe(false);
    expect(
      logic.allVisibleSelected(visible, logic.selectionAfterResults(rows)),
    ).toBe(true);
    // An empty table is not "all selected" — otherwise the header checkbox
    // would draw ticked over nothing.
    expect(logic.allVisibleSelected([], [])).toBe(false);
  });
});

describe("P1-T21 — the result table against the real document", () => {
  /** The `<tr>`s currently drawn, in drawn order. */
  function drawnRows(h: Harness): FakeElement[] {
    return h.byId("rh-results-body")?.children ?? [];
  }

  function cell(row: FakeElement, at: number): FakeElement {
    return row.children[at] as FakeElement;
  }

  /** Every attribute value and every text node under the table. */
  function tableStrings(h: Harness): string[] {
    const out: string[] = [];
    const walk = (element: FakeElement): void => {
      out.push(element.textContent);
      for (const name of [
        "aria-label",
        "aria-labelledby",
        "title",
        "tooltiptext",
        "data-l10n-args",
        "data-rh-row-key",
        "value",
      ]) {
        const held = element.getAttribute(name);
        if (held !== null) out.push(held);
      }
      for (const child of element.children) walk(child);
    };
    const container = h.byId("rh-results-container");
    if (container) walk(container);
    return out;
  }

  function withResults(
    records: TableRecord[],
    options: HarnessOptions = {},
  ): Harness {
    const h = harness(options);
    h.controller.init();
    h.controller.setResults(records);
    return h;
  }

  it("draws one XHTML row per result, with all 40 checked (FR-5)", () => {
    // FR-5: "each row shows title, first author, year, venue, source(s),
    // DOI/PMID/arXiv ID, and a checkbox, and all rows are checked by default."
    const h = withResults(fortyResults());
    const rows = drawnRows(h);
    expect(rows).toHaveLength(40);
    expect(h.controller.state.selection).toHaveLength(40);
    expect(h.controller.state.selectedCount).toBe(40);
    expect(h.controller.rowCheckboxes().every((box) => box.checked)).toBe(true);
    expect(h.byId("rh-results-select-all-box")?.checked).toBe(true);

    // Real HTML elements. `document.createElement("tr")` in a XUL document
    // yields a XUL element named `tr`, which lays out as nothing at all.
    const first = rows[0] as FakeElement;
    expect(first.name).toBe("tr");
    expect(first.namespace).toBe("http://www.w3.org/1999/xhtml");
    expect(first.children.map((td) => td.name)).toStrictEqual([
      "td",
      "td",
      "td",
      "td",
      "td",
      "td",
      "td",
    ]);
    // §4.2's seven columns, in order, carrying the record's own data.
    expect(cell(first, 0).children[0]?.getAttribute("type")).toBe("checkbox");
    expect(cell(first, 1).textContent).toBe("Hepatocyte delivery study 0");
    expect(cell(first, 2).textContent).toBe("Kim0");
    expect(cell(first, 3).textContent).toBe("2024");
    expect(cell(first, 4).textContent).toBe("PubMed");
    expect(cell(first, 5).textContent).toBe("journal-article");
    expect(cell(first, 6).textContent).toBe("10.1000/rh.0");
  });

  it("hands Import exactly 35 records after five are unchecked (FR-5)", () => {
    const h = withResults(fortyResults());
    for (const box of h.controller.rowCheckboxes().slice(0, 5)) {
      box.checked = false;
      box.dispatch("change");
    }
    expect(h.controller.state.selectedCount).toBe(35);
    const request = h.controller.collectImportRequest();
    expect((request.records as TableRecord[]).length).toBe(35);
    expect((request.records as TableRecord[])[0]?.key).toBe("10.1000/rh.5");
    // And the gate agrees, so the button the user presses is the one that
    // carries the 35.
    expect(h.controller.refreshImportGate()).toBe(true);
  });

  it("narrows rows as the filter is typed, and issues no request", () => {
    let searches = 0;
    const h = withResults(
      [
        record(1, { title: "Ionizable lipid design rules" }),
        record(2, { title: "Hepatocyte editing in vivo" }),
        record(3, { title: "Scalable LNP manufacturing" }),
      ],
      {
        host: {
          listSources: () => [PUBMED],
          runSearch: () => {
            searches += 1;
          },
        },
      },
    );
    expect(drawnRows(h)).toHaveLength(3);

    const filter = h.byId("rh-search-filter") as FakeElement;
    filter.value = "hepatocyte";
    filter.dispatch("input");

    expect(drawnRows(h)).toHaveLength(1);
    expect(cell(drawnRows(h)[0] as FakeElement, 1).textContent).toBe(
      "Hepatocyte editing in vivo",
    );
    // §4.2 and this card's Do NOT: the filter is client-side over the
    // already-fetched results. Nothing was re-requested.
    expect(searches).toBe(0);
    // The whole fetched set is still there, and so is the whole selection.
    expect(h.controller.state.rows).toHaveLength(3);
    expect(h.controller.state.selection).toHaveLength(3);

    // A filter that matches nothing leaves an empty body rather than an error.
    filter.value = "zzzz-no-such-paper";
    filter.dispatch("input");
    expect(drawnRows(h)).toHaveLength(0);
    expect(h.controller.state.selectedCount).toBe(0);
    expect(h.byId("rh-results-select-all-box")?.checked).toBe(false);
    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttondisabledaccept"),
    ).toBe("true");

    // Clearing it restores all three, still selected.
    filter.value = "";
    filter.dispatch("input");
    expect(drawnRows(h)).toHaveLength(3);
    expect(h.controller.state.selectedCount).toBe(3);
  });

  it("hides and restores the marked rows with the checkbox (docs/07 §8.5)", () => {
    const h = withResults(fortyResults([0, 1, 2, 3, 4]));
    const checkbox = h.byId("rh-search-hide-existing") as FakeElement;
    // §8.5 ships `hideExisting` true and the checkbox mirrors it, so the five
    // start hidden.
    expect(checkbox.checked).toBe(true);
    expect(drawnRows(h)).toHaveLength(35);
    expect(h.controller.state.selectedCount).toBe(35);
    // All 40 are selected even so — FR-5 checks every row, and the duplicate
    // policy decides what happens to an already-present one.
    expect(h.controller.state.selection).toHaveLength(40);

    checkbox.checked = false;
    checkbox.dispatch("command");
    expect(drawnRows(h)).toHaveLength(40);
    expect(h.controller.state.selectedCount).toBe(40);

    checkbox.checked = true;
    checkbox.dispatch("command");
    expect(drawnRows(h)).toHaveLength(35);
  });

  it("marks an existing row in words as well as colour (NFR-13)", () => {
    const h = withResults(fortyResults([0]));
    const checkbox = h.byId("rh-search-hide-existing") as FakeElement;
    checkbox.checked = false;
    checkbox.dispatch("command");

    const row = drawnRows(h)[0] as FakeElement;
    expect(row.className).toContain(h.controller.spec.rowClass.existingRow);
    const title = cell(row, 1);
    const [badge, text] = title.children;
    // The glyph and the colour are the stylesheet's; the WORDS are a Fluent
    // message, so the meaning survives a monochrome or high-contrast display.
    expect(badge?.className).toBe(h.controller.spec.rowClass.badge);
    expect(text?.className).toBe("");
    expect(badge?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-row-existing-badge",
    );
    expect(badge?.getAttribute("role")).toBe("img");
    expect(text?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-row-existing",
    );
    expect(
      JSON.parse(text?.getAttribute("data-l10n-args") ?? ""),
    ).toStrictEqual({ title: "Hepatocyte delivery study 0" });
    // The message is on a CHILD of the cell, not on the cell: Fluent assigns a
    // value-only message to `textContent`, which would remove the badge.
    expect(title.getAttribute("data-l10n-id")).toBeNull();
    // A row that is not already present carries neither.
    expect((drawnRows(h)[1] as FakeElement).className).not.toContain(
      h.controller.spec.rowClass.existingRow,
    );
  });

  it("gives every row and every row checkbox an accessible name (§4.3, §9)", () => {
    const h = withResults(fortyResults([0]));
    const checkbox = h.byId("rh-search-hide-existing") as FakeElement;
    checkbox.checked = false;
    checkbox.dispatch("command");

    drawnRows(h).forEach((row, at) => {
      const titleId = `${h.controller.spec.row.titleIdPrefix}${String(at)}`;
      expect(row.getAttribute("aria-labelledby")).toBe(titleId);
      expect(cell(row, 1).id).toBe(titleId);
      // The checkbox borrows the same name, so a screen reader says which row
      // it toggles instead of saying "Select" forty times.
      expect(cell(row, 0).children[0]?.getAttribute("aria-labelledby")).toBe(
        titleId,
      );
    });
    // Pointing at the title cell rather than copying the title in means the
    // already-present row's name is the localized "Already in library: …".
    expect(
      cell(drawnRows(h)[0] as FakeElement, 1).children[1]?.getAttribute(
        "data-l10n-id",
      ),
    ).toBe("research-helper-search-row-existing");
  });

  it("drives the three §4.5 buttons and the header checkbox", () => {
    const h = withResults(fortyResults());
    h.byId("rh-results-select-none")?.dispatch("command");
    expect(h.controller.state.selectedCount).toBe(0);
    expect(h.controller.rowCheckboxes().some((box) => box.checked)).toBe(false);
    expect(h.byId("rh-results-select-all-box")?.checked).toBe(false);

    h.byId("rh-results-select-invert")?.dispatch("command");
    expect(h.controller.state.selectedCount).toBe(40);
    expect(h.controller.rowCheckboxes().every((box) => box.checked)).toBe(true);

    h.byId("rh-results-select-all")?.dispatch("command");
    expect(h.controller.state.selectedCount).toBe(40);

    // The header checkbox is §4.2's "Select all / none — checkbox in header".
    const header = h.byId("rh-results-select-all-box") as FakeElement;
    header.checked = false;
    header.dispatch("change");
    expect(h.controller.state.selectedCount).toBe(0);
    header.checked = true;
    header.dispatch("change");
    expect(h.controller.state.selectedCount).toBe(40);
  });

  it("scopes every selection command to the rows the filter is showing", () => {
    // **The two mutants that survived the first sweep were here**, not in the
    // pure model: `selectVisible()` and the Ctrl+A handler were both mutated to
    // pass the whole fetched set instead of the visible one, and nothing caught
    // it — because a command that over-reaches leaves the *visible* count
    // exactly right. It is only visible after the filter is cleared, which is
    // what this test does. The pure-logic assertions above cannot catch it at
    // all: they call `applySelection` with explicit keys, so a wrong argument at
    // the call site is invisible to them.
    const h = withResults(fortyResults());
    const filter = h.byId("rh-search-filter") as FakeElement;

    // Deselect everything, then narrow and select all.
    h.byId("rh-results-select-none")?.dispatch("command");
    expect(h.controller.state.selection).toStrictEqual([]);

    filter.value = "study 1";
    filter.dispatch("input");
    const narrowed = h.controller.state.visible.map((row) => row.key);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(40);

    h.byId("rh-results-select-all")?.dispatch("command");
    filter.value = "";
    filter.dispatch("input");
    // Exactly the rows that were visible, and not one more.
    expect(new Set(h.controller.state.selection)).toStrictEqual(
      new Set(narrowed),
    );
    expect(h.controller.state.selectedCount).toBe(narrowed.length);

    // The same for invert, and the same for Ctrl+A.
    h.byId("rh-results-select-none")?.dispatch("command");
    filter.value = "study 1";
    filter.dispatch("input");
    h.byId("rh-results-select-invert")?.dispatch("command");
    filter.value = "";
    filter.dispatch("input");
    expect(new Set(h.controller.state.selection)).toStrictEqual(
      new Set(narrowed),
    );

    h.byId("rh-results-select-none")?.dispatch("command");
    filter.value = "study 1";
    filter.dispatch("input");
    (h.byId("rh-results-body") as FakeElement).dispatch("keydown", {
      key: "a",
      ctrlKey: true,
      target: h.controller.rowCheckboxes()[0],
      preventDefault: () => undefined,
    });
    filter.value = "";
    filter.dispatch("input");
    expect(new Set(h.controller.state.selection)).toStrictEqual(
      new Set(narrowed),
    );
  });

  it("states the two counts §4.5 draws, as numbers", () => {
    const h = withResults(fortyResults([0, 1]));
    const checkbox = h.byId("rh-search-hide-existing") as FakeElement;
    checkbox.checked = false;
    checkbox.dispatch("command");

    const selected = h.byId("rh-results-selected-count");
    expect(selected?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-selected-count",
    );
    expect(
      JSON.parse(selected?.getAttribute("data-l10n-args") ?? ""),
    ).toStrictEqual({ count: 40 });

    const total = h.byId("rh-search-result-count");
    expect(total?.hidden).toBe(false);
    expect(total?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-result-count",
    );
    expect(
      JSON.parse(total?.getAttribute("data-l10n-args") ?? ""),
    ).toStrictEqual({ total: 40, new: 38 });

    // A count is a quantity, so it goes through Fluent as a number: grouping is
    // correct here ("1,400 results" at seven databases × maxResults) and was
    // wrong only for a year. Two of these messages also select a plural on it,
    // which a string argument would defeat.
    const args: unknown = JSON.parse(
      selected?.getAttribute("data-l10n-args") ?? "",
    );
    expect(typeof (args as { count: unknown }).count).toBe("number");
  });

  it("feeds the live selected count into the Import button label", async () => {
    const h = withResults(fortyResults());
    await h.controller.refreshImportLabel(40);
    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttonlabelaccept"),
    ).toBe(`label:${h.controller.l10n.import}`);
  });

  it("never lets a stale Import label overwrite a newer count", async () => {
    // **Measured in a live Zotero window on 2026-10-07, before this guard
    // existed**: with 40 rows selected and then 5 unchecked the button read
    // `Import 40 items` while 35 were selected, because `formatMessages` is
    // asynchronous and the first request resolved last. Here the two resolve in
    // reverse order deliberately.
    const pending: {
      count: unknown;
      resolve: (value: readonly FakeL10nMessage[]) => void;
    }[] = [];
    const h = harness({
      formatMessages: (requests) =>
        new Promise((resolve) => {
          pending.push({ count: requests[0]?.args?.count, resolve });
        }),
    });
    h.controller.init();

    const first = h.controller.refreshImportLabel(40);
    const second = h.controller.refreshImportLabel(35);
    // The newest request first, the stale one afterwards.
    const [stale, fresh] = [pending.at(-2), pending.at(-1)];
    expect(stale?.count).toBe(40);
    expect(fresh?.count).toBe(35);
    fresh?.resolve([
      { value: null, attributes: [{ name: "label", value: "35" }] },
    ]);
    stale?.resolve([
      { value: null, attributes: [{ name: "label", value: "40" }] },
    ]);
    await Promise.all([first, second]);

    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttonlabelaccept"),
    ).toBe("35");
  });

  it("resolves the six column captions from the bundle, not the markup", async () => {
    const h = harness();
    h.controller.init();
    await h.controller.applyColumnLabels();
    for (const column of h.controller.logic.columns) {
      const cellEl = h.byId(column.id);
      if (column.captioned) {
        expect(cellEl?.textContent, column.id).toBe(
          `label:${column.messageId}`,
        );
        // And no `data-l10n-id`, which would set an attribute an <html:th>
        // does not render.
        expect(cellEl?.getAttribute("data-l10n-id")).toBeNull();
      } else {
        expect(cellEl?.textContent).toBe("");
      }
    }
  });

  it("behaves with zero results, which is today's normal case", () => {
    // Nothing registers a source at runtime, so Search is disabled and
    // setResults is never reached — the window stays on the INITIAL panel with
    // an empty table. These are the states it passes through if it is.
    const h = harness();
    h.controller.init();
    expect(drawnRows(h)).toHaveLength(0);
    expect(h.byId("rh-search-result-count")?.hidden).toBe(true);
    expect(h.controller.state.panel).toBe("initial");

    expect(h.controller.setResults([])).toBe(0);
    expect(drawnRows(h)).toHaveLength(0);
    expect(h.controller.state.selection).toStrictEqual([]);
    expect(h.controller.state.selectedCount).toBe(0);
    expect(h.byId("rh-results-select-all-box")?.checked).toBe(false);
    expect(h.byId("rh-search-result-count")?.hidden).toBe(true);
    expect(
      h.byId(SEARCH_WINDOW_ROOT_ID)?.getAttribute("buttondisabledaccept"),
    ).toBe("true");
    // docs/08 §4.6's EMPTY panel takes `{ $query }` and the year span, which
    // only a finished run knows, so the panel is left to the caller rather than
    // switched to a panel with no arguments.
    expect(h.controller.state.panel).toBe("initial");
    expect(h.controller.collectImportRequest().records).toStrictEqual([]);

    // And one result does switch to the table.
    h.controller.setResults([record(1)]);
    expect(h.controller.state.panel).toBe("results");
    expect(h.byId("rh-results-container")?.hidden).toBe(false);
  });

  it("writes no database and makes no request from the table (FR-5)", () => {
    // FR-5: "the user clicks Cancel → zero Zotero items are created and zero
    // database writes occur". The window cannot write: it has no Zotero.DB and
    // no Zotero.Items reference at all, and every privileged capability is a
    // host callback it only ever calls by name.
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.DB/);
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.Items/);
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.Collections/);
    expect(SCRIPT_CODE).not.toMatch(/executeTransaction/);
    expect(SCRIPT_CODE).not.toMatch(/saveTx/);
  });

  it("lets no keyword or filter text reach a row, a title or a tooltip", () => {
    // A 32-character key is below the free-text redactor's threshold (P1-T17),
    // so the only safe property is that the query never reaches the table at
    // all. It does not: a row is built from the host's record and from nothing
    // else, and no row carries a `title` or `tooltiptext` attribute.
    const key = "sk-0123456789abcdef0123456789abcd";
    const h = withResults(fortyResults());
    const keyword = h.byId("rh-search-keyword") as FakeElement;
    const filter = h.byId("rh-search-filter") as FakeElement;
    keyword.value = key;
    filter.value = key;
    filter.dispatch("input");

    for (const text of tableStrings(h)) {
      expect(text, text).not.toContain(key);
    }
    // Belt and braces: the table-building code never reads either control.
    const builder = SCRIPT_CODE.slice(
      SCRIPT_CODE.indexOf("buildRow(row, index)"),
      SCRIPT_CODE.indexOf("selectVisible(command)"),
    );
    expect(builder.length).toBeGreaterThan(500);
    expect(builder).not.toContain("spec.keyword");
    expect(builder).not.toContain("spec.filter");
    for (const element of ELEMENTS) {
      expect(element.attrs.has("tooltiptext")).toBe(false);
    }
  });

  it("moves between rows and selects all from the keyboard (docs/08 §9)", () => {
    const h = withResults(fortyResults());
    const boxes = h.controller.rowCheckboxes();
    let prevented = 0;
    const event = (
      extra: Record<string, unknown>,
    ): Record<string, unknown> => ({
      preventDefault: () => {
        prevented += 1;
      },
      ...extra,
    });

    const body = h.byId("rh-results-body") as FakeElement;
    body.dispatch("keydown", event({ key: "ArrowDown", target: boxes[0] }));
    expect(boxes[1]?.focused).toBe(true);
    body.dispatch("keydown", event({ key: "ArrowUp", target: boxes[1] }));
    expect(boxes[0]?.focused).toBe(true);
    expect(prevented).toBe(2);

    // At the ends nothing moves and nothing is swallowed.
    body.dispatch("keydown", event({ key: "ArrowUp", target: boxes[0] }));
    expect(prevented).toBe(2);

    h.byId("rh-results-select-none")?.dispatch("command");
    expect(h.controller.state.selectedCount).toBe(0);
    body.dispatch(
      "keydown",
      event({ key: "a", ctrlKey: true, target: boxes[0] }),
    );
    expect(h.controller.state.selectedCount).toBe(40);
    body.dispatch(
      "keydown",
      event({ key: "A", metaKey: true, target: boxes[0] }),
    );
    expect(h.controller.state.selectedCount).toBe(40);
    // Ctrl/Cmd+A over a filtered table still cannot reach a hidden row.
    const filter = h.byId("rh-search-filter") as FakeElement;
    filter.value = "study 1";
    filter.dispatch("input");
    h.byId("rh-results-select-none")?.dispatch("command");
    const narrowed = h.controller.state.visible.length;
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(40);
    body.dispatch(
      "keydown",
      event({
        key: "a",
        ctrlKey: true,
        target: h.controller.rowCheckboxes()[0],
      }),
    );
    expect(h.controller.state.selectedCount).toBe(narrowed);
  });

  it("declares every row class the stylesheet styles", () => {
    // Nothing typechecks either file, so a typo here is a silently unstyled
    // table. P1-T20 found the same class of defect twice by running the window.
    //
    // **A selector-boundary match, not a substring one.** A first version used
    // `toContain(".rh-row-existing")`, and a deliberately broken rule renamed to
    // `.rh-row-existing-typo` passed it, because the typo *contains* the right
    // name. `(?![\w-])` is what makes the assertion about a selector. Tightening
    // it immediately found a real one: `.rh-row` was in `spec.rowClass` with no
    // rule behind it at all.
    const styles = (name: string): boolean =>
      new RegExp(`\\.${name}(?![\\w-])`).test(CSS_CODE);

    const { controller } = harness();
    const classes = Object.values(controller.spec.rowClass);
    expect(classes.length).toBeGreaterThan(4);
    for (const name of classes) {
      expect(styles(name), `.${name} has no rule`).toBe(true);
    }
    // And the row class every built row carries, plus §4.2's six column classes.
    for (const name of [
      "rh-col-select",
      "rh-col-title",
      "rh-col-authors",
      "rh-col-year",
      "rh-col-source",
      "rh-col-type",
      "rh-col-doi",
    ]) {
      expect(styles(name), `.${name} has no rule`).toBe(true);
      expect(XHTML, `.${name} in the markup`).toContain(name);
    }
  });

  it("mounts the table inside an overflow container (§4.3, Do step 1)", () => {
    const scroll = byId("rh-results-scroll");
    expect(scroll?.name).toBe("html:div");
    expect(scroll?.attrs.get("class")).toBe("rh-table-scroll");
    expect(byId("rh-results-table")?.parent?.attrs.get("id")).toBe(
      "rh-results-scroll",
    );
    expect(CSS_CODE).toMatch(/\.rh-table-scroll\s*\{[^}]*overflow:\s*auto/);
    // §4.3's decision for v1: a plain table, so no React and no CJS loader.
    expect(SCRIPT_CODE).not.toMatch(/require\s*\(/);
    expect(SCRIPT_CODE).not.toMatch(/VirtualizedTable/);
    expect(SCRIPT_CODE).not.toMatch(/setLocale/);
    expect(SCRIPT_CODE).not.toMatch(/createRoot/);
    // And it is a real <html:table>, with the accessible name §4.3 requires.
    expect(byId("rh-results-table")?.name).toBe("html:table");
    expect(byId("rh-results-table")?.attrs.get("data-l10n-id")).toBe(
      "research-helper-search-table",
    );
  });
});

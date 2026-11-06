import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "../../../package.json";
import { createMemoryPrefStore } from "../../../src/core/config";
import { SOURCE_IDS } from "../../../src/model/ids";
import { getPref, setPref, setPrefStore } from "../../../src/prefs";
import { SEARCH_DIALOG_MESSAGE_IDS } from "../../../src/i18n/keys";
import { PREF_KEYS } from "../../../src/prefs/keys";
import { PREFS } from "../../../src/prefs/schema";
import {
  SEARCH_WINDOW_FEATURES,
  SEARCH_WINDOW_KEYWORD_ID,
  SEARCH_WINDOW_MIN_SIZE,
  SEARCH_WINDOW_RELATIONS,
  SEARCH_WINDOW_ROOT_ID,
  relatedSeedHeader,
} from "../../../src/ui/dialogs/searchDialog";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { PREFERENCES_PANE_ID } from "../../../src/ui/prefs/preferencesPane";
import { RECOMMEND_DEFAULT_SLIDER } from "../../../src/ui/viewModels/recommendViewModel";

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

  /**
   * Added by `P1-T45`, and its absence is why nothing before this card drove
   * {@link Controller.render} end to end from this spec: `clearRef()` removes
   * `data-l10n-id` and `data-l10n-args` on every render that has no message
   * for an element, and a fake without this method threw `TypeError:
   * element.removeAttribute is not a function` inside `renderEmptyPanel`.
   */
  public removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  public get firstElementChild(): FakeElement | undefined {
    return this.children[0];
  }

  public get firstChild(): FakeElement | undefined {
    return this.children[0];
  }

  public appendChild(child: FakeElement): void {
    this.children.push(child);
    child.parentNode = this;
  }

  /**
   * `P2-T14`: the controller inserts the all-failed panel's per-source lines
   * before `#rh-state-error-detail` with `parentNode.insertBefore`, so the
   * fake needs both for those lines to exist at all.
   */
  public parentNode: FakeElement | undefined;

  public insertBefore(child: FakeElement, before: FakeElement | null): void {
    const at = before === null ? -1 : this.children.indexOf(before);
    if (at < 0) {
      this.children.push(child);
    } else {
      this.children.splice(at, 0, child);
    }
    child.parentNode = this;
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
  // P2-T14: the view model's `SearchResultRow` additions.
  sourceIds?: string[];
  duplicate?: { withKeys: string[]; ref: { id: string; args?: unknown } };
  linked?: { withKeys: string[]; ref: { id: string; args?: unknown } };
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
  initialSelection: (
    registered: string[],
    enabled: string[] | null,
  ) => string[];
  normalizePrefs: (
    raw: unknown,
    bounds: unknown,
  ) => { sources: string[] | null };

  // P1-T21's half.
  columns: { id: string; messageId: string; captioned: boolean }[];
  authorName: (author: unknown) => string;
  fluentText: (text: unknown) => string;
  emptyHeadlineRef: (ref: {
    id: string;
    args?: Record<string, unknown>;
  }) => unknown;
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

  // P1-T45's half.
  exportAvailable: (state: unknown) => boolean;
  exportFileName: (nowEpochMs: number) => string;

  // P5-T16's half.
  matchesRelatedFilter: (row: unknown, view: unknown) => boolean;
  matchesRecommendFilter: (row: unknown, view: unknown) => boolean;
  reasonRef: (ref: { id: string; args?: unknown }) => unknown;
  isoDay: (epochMs: number) => string;
  dotsText: (dots?: number) => string;
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
    // P1-T45. Neither ever holds the chosen path; see the card's security note.
    exportAvailable: boolean;
    exportMessage: string | null;
    // P5-T16: the title-match list's choice.
    relatedPick: string | null;
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
  // P1-T45.
  render: (state: unknown) => void;
  exportProvenance: () => Promise<string>;
  pickExportPath: () => Promise<string>;
  showExportOutcome: (outcome: string) => void;
  filePickerModule: string;
  // P1-T44: the Open Preferences action now has a target.
  preferencesPaneId: string;
  openPreferences: () => void;
  // P5-T16.
  runRelated: () => Promise<void> | undefined;
  cancel: () => void;
  disconnectHost: () => void;
  import: () => void;
  // Item 358(b): the modal's seam, replaced in tests so no modal opens.
  promptForCollectionName: () => string;
  [key: string]: unknown;
}

interface Harness {
  readonly controller: Controller;
  readonly byId: (id: string) => FakeElement | undefined;
  readonly registerRootCalls: FakeElement[];
  readonly prefReads: string[];
  /**
   * Every string the controller passed to `Zotero.debug`, in order.
   *
   * Added by `P1-T45`: `docs/09` §2.2 forbids a user-chosen file-system path
   * reaching the log at any level, and this document has exactly one log
   * channel — `Zotero.debug`, through `settle()` and `openPreferences()`. A
   * rule with no recorder behind it is a rule nothing checks.
   */
  readonly debugLines: string[];
  /**
   * Every argument list the controller passed to
   * `Zotero.Utilities.Internal.openPreferences`, in order (`P1-T44`).
   */
  readonly openPreferencesCalls: unknown[][];
  /** Every URL the controller handed `Zotero.launchURL` (`P2-T14`). */
  readonly launched: string[];
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

/** Depth-first search of the live tree, for an element built after parsing. */
function findBuilt(node: FakeElement, id: string): FakeElement | undefined {
  for (const child of node.children) {
    if (child.id === id) return child;
    const found = findBuilt(child, id);
    if (found) return found;
  }
  return undefined;
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
  const root = instantiate(DOCUMENT, index);

  const registerRootCalls: FakeElement[] = [];
  const prefReads: string[] = [];
  const debugLines: string[] = [];
  const docListeners = new Map<string, ((event: unknown) => void)[]>();

  const doc = {
    title: "",
    listeners: docListeners,
    // `P2-T14`: elements the controller *builds* (the error lines, the notice
    // area) are not in the parsed markup's index, so they are found by walking
    // the live tree, as a real `getElementById` would.
    getElementById: (id: string): FakeElement | null =>
      index.get(id) ?? findBuilt(root, id) ?? null,
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
  const openPreferencesCalls: unknown[][] = [];
  const launched: string[] = [];
  const zotero = {
    // `P2-T14`: FR-2's key-request link opens through this, recorded.
    launchURL: (url: string) => {
      launched.push(url);
    },
    // `P1-T45`: the document's only log channel, recorded so an assertion can
    // be made about what never reaches it.
    debug: (line: unknown) => {
      debugLines.push(String(line));
    },
    // `P1-T44`: the Open Preferences action's target, recorded.
    Utilities: {
      Internal: {
        openPreferences: (...args: unknown[]) => {
          openPreferencesCalls.push(args);
          return null;
        },
      },
    },
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
    byId: (id) => index.get(id) ?? findBuilt(root, id),
    registerRootCalls,
    prefReads,
    debugLines,
    openPreferencesCalls,
    launched,
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

  it("renders one checkbox per registered source, in registration order", async () => {
    const h = harness({ host: { listSources: () => [PUBMED, CROSSREF] } });
    h.controller.init();
    const row = h.byId("rh-search-databases");
    expect(row?.children.map((box) => box.getAttribute("value"))).toStrictEqual(
      ["pubmed", "crossref"],
    );
    // Corrected by `P2-T14` (owner's review row 142): the name is resolved
    // from the source's own `displayNameKey` and painted as the checkbox's
    // `label`. A `data-l10n-id` on the checkbox made Fluent write the bare
    // value into `textContent`, which a XUL checkbox does not paint as its
    // label — measured in Zotero 10.0.3, where every label read empty.
    await Promise.resolve();
    await Promise.resolve();
    expect(row?.children.map((box) => box.getAttribute("label"))).toStrictEqual(
      [`value:${PUBMED.displayNameKey}`, `value:${CROSSREF.displayNameKey}`],
    );
    expect(
      row?.children.every((box) => box.getAttribute("data-l10n-id") === null),
    ).toBe(true);
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
    // Item 358(b), 2026-11-06: on bare "New collection…" Import now asks for a
    // name first, so this test names the target and keeps to its own claim.
    const target = h.byId("rh-search-target");
    if (target) target.value = "new:Target";
    let prevented = false;
    h.doc.dispatch("dialogaccept", {
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(imports).toHaveLength(1);
  });

  describe("Import on bare “New collection…” (items 348(e), 358(b))", () => {
    function pressing(answer: string) {
      const imports: unknown[] = [];
      const h = harness({
        host: {
          runImport: (request: unknown) => {
            imports.push(request);
          },
        },
      });
      h.controller.init();
      h.controller.state.selectedCount = 2;
      let prompts = 0;
      h.controller.promptForCollectionName = () => {
        prompts += 1;
        return answer;
      };
      return { h, imports, prompts: () => prompts };
    }
    const target = (h: Harness) => h.byId("rh-search-target");

    it("opens on bare “New collection…” with Import on, as docs/08 §4.2 says", () => {
      const { h } = pressing("");
      expect(target(h)?.value).toBe("new");
      expect(h.controller.refreshImportGate()).toBe(true);
    });

    it("asks for the name, and imports nothing when the prompt is dismissed", () => {
      const { h, imports, prompts } = pressing("");
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      expect(prompts()).toBe(1);
      expect(imports).toStrictEqual([]);
      expect(target(h)?.value).toBe("new");
    });

    it("imports into the collection the prompt named, and lists it", () => {
      const { h, imports, prompts } = pressing("My set");
      h.controller.import();
      expect(prompts()).toBe(1);
      expect(target(h)?.value).toBe("new:My set");
      expect(
        (imports[0] as { collectionID: unknown } | undefined)?.collectionID,
      ).toBe("new:My set");
      const labels = (h.byId("rh-search-target-popup")?.children ?? []).map(
        (item) => item.getAttribute("label"),
      );
      expect(labels).toContain("My set");
    });

    it("asks nothing when the picker already names a collection", () => {
      const { h, imports, prompts } = pressing("Never asked");
      const list = target(h);
      if (list) list.value = "new:Chosen";
      h.controller.import();
      expect(prompts()).toBe(0);
      expect(imports).toHaveLength(1);
    });

    it("asks nothing with no row ticked, because the gate refuses first", () => {
      const { h, imports, prompts } = pressing("Never asked");
      h.controller.state.selectedCount = 0;
      h.controller.import();
      expect(prompts()).toBe(0);
      expect(imports).toStrictEqual([]);
    });
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
      // P5-T15: hidden outside the related mode (docs/08 §5.2).
      "rh-related-header",
      // P5-T26: hidden outside the recommend mode (docs/08 §5.4).
      "rh-recommend-header",
      "rh-search-scope-row",
      "rh-search-databases-group",
      "rh-search-filter-row",
      // P3-T27: docs/08 §4.2 draws the relevance threshold above the table.
      "rh-search-screening-row",
      "rh-results-area",
      "rh-search-target-row",
      // P5-T17: hidden outside the related mode (docs/08 §5.2).
      "rh-related-link-seed",
      "rh-search-duplicates-group",
      "rh-search-status-bar",
    ]);
  });

  it("words the link box from the bundle, and starts it hidden (P5-T17)", () => {
    const box = byId("rh-related-link-seed");
    expect(box?.attrs.get("data-l10n-id")).toBe(
      "research-helper-search-related-link-to-seed",
    );
    expect(box?.attrs.get("hidden")).toBe("true");
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
      .filter(([key]) => key !== "duplicatesDefault" && key !== "yearAny")
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

  it("holds a long list inside the window (docs/08 §4.3)", () => {
    // The dialog's content box is a flex item: with its automatic minimum, a long
    // table stretched it past the window and took OK and Cancel with it.
    const block = (selector: string): string =>
      CSS_CODE.split(selector)[1]?.split("}")[0] ?? "";
    expect(block("#rh-search-dialog::part(content-box)")).toContain(
      "min-height: 0",
    );
    expect(block("#rh-results-container {")).toContain("min-height: 0");
    expect(block("#rh-recommend-header {")).toContain("overflow-y: auto");
    // Changed 2026-11-06 (plan/00 §6 item 359(c)): no floor for the table. While a
    // table shows, a mode's header keeps its controls and holds the rest at no
    // height, so it gives the table the room itself. The geometry is asserted in
    // the real window (relatedWindow.spec.ts, recommendWindow.spec.ts); this only
    // keeps the floor, which put the related window's note under OK, from coming
    // back, and the keyword window free of both rules.
    expect(CSS_CODE).not.toContain("45vh");
    expect(CSS_CODE).toMatch(
      /> #rh-related-header\s*> #rh-related-header-more,[\s\S]*> #rh-recommend-header\s*> #rh-recommend-header-more \{\s*max-height: 0;/,
    );
    expect(CSS_CODE).not.toMatch(/\n#rh-results-area:has/);
  });

  it("fixes no width on a label or a button (docs/08 §10.3)", () => {
    // Korean menu labels are longer than their English counterparts and a
    // fixed width truncates them, so only `min-*` bounds are allowed.
    expect(CSS_CODE).not.toMatch(/(^|[\s;{])width\s*:/);
    expect(CSS_CODE).not.toMatch(/(^|[\s;{])height\s*:/);
  });

  it("hides every element asked to hide, whatever display a rule gives it (docs/08 §5.4, 2026-11-06)", () => {
    // `.rh-wrap`'s `display: flex` beat the platform's rule for `hidden`, so both key
    // notices read hidden and were drawn. One rule, and no other `display` declaration
    // that could outrank it: only an `!important` one could.
    expect(CSS_CODE).toMatch(
      /(^|\n)\[hidden\] \{\s*display: none !important;\s*\}/,
    );
    const important = CSS_CODE.match(/display\s*:[^;}]*!important/g) ?? [];
    expect(important).toStrictEqual(["display: none !important"]);
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
    // Item 207 (owner, 2026-10-19): an empty list is an empty selection;
    // only `null` — nothing readable — means §8.5's all-ticked default.
    expect(controller.logic.initialSelection(["pubmed"], [])).toStrictEqual([]);
    expect(controller.logic.initialSelection(["pubmed"], null)).toStrictEqual([
      "pubmed",
    ]);
    expect(controller.logic.initialSelection([], ["pubmed"])).toStrictEqual([]);
  });

  it("keeps a stored empty sources string apart from an unreadable one (item 207)", () => {
    const bounds = controller.spec.prefBounds;
    expect(
      controller.logic.normalizePrefs({ sources: "" }, bounds).sources,
    ).toStrictEqual([]);
    expect(
      controller.logic.normalizePrefs({ sources: " , " }, bounds).sources,
    ).toStrictEqual([]);
    expect(controller.logic.normalizePrefs({}, bounds).sources).toBeNull();
    expect(
      controller.logic.normalizePrefs({ sources: 7 }, bounds).sources,
    ).toBeNull();
    expect(
      controller.logic.normalizePrefs(undefined, bounds).sources,
    ).toBeNull();
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

describe("fluentText: a source's text in a Fluent argument (plan/00 item 347(d))", () => {
  const logic = harness().controller.logic;
  it("escapes what makes DOMLocalization parse, and nothing else", () => {
    expect(logic.fluentText("<img src=x onerror=y>")).toBe(
      "&lt;img src=x onerror=y>",
    );
    expect(logic.fluentText('<a href="https://example.invalid">x</a>')).toBe(
      '&lt;a href="https://example.invalid">x&lt;/a>',
    );
    expect(logic.fluentText("<em>x</em>")).toBe("&lt;em>x&lt;/em>");
    expect(logic.fluentText("A &amp; B")).toBe("A &amp;amp; B");
    expect(logic.fluentText("p < 0.05 & q > 1")).toBe(
      "p &lt; 0.05 &amp; q > 1",
    );
    expect(logic.fluentText('A plain title: 50% ("quoted")')).toBe(
      'A plain title: 50% ("quoted")',
    );
  });

  it("is safe on what a row can hold", () => {
    expect(logic.fluentText(undefined)).toBe("");
    expect(logic.fluentText(null)).toBe("");
    expect(logic.fluentText("")).toBe("");
  });

  it("goes round every argument the window draws as text from a source", () => {
    expect(SCRIPT).toContain("title: this.logic.fluentText(row.title)");
    expect(SCRIPT).toContain("names: this.logic.fluentText(row.authorNames)");
    expect(SCRIPT).toContain("names: this.logic.fluentText(summary.names)");
  });
});

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

// ===========================================================================
// 9. P1-T45 — FR-8's export control, its three strings and its file chooser
//
// Layer 1, so the chooser itself is not here: `ChromeUtils` does not exist in
// Node, and `pickExportPath()` is written to return "" when it is absent. That
// is what makes these tests about the surface — the visibility rule, the two
// sentences, the five outcomes and the path's lifetime — and leaves the chooser
// to the integration spec, which has a real window with a real
// `BrowsingContext`.
// ===========================================================================

/** One published view state, with only the members this block reads set. */
function exportState(
  notices: readonly { id: string }[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    panel: "results",
    running: false,
    sources: [],
    records: undefined,
    recordsRevision: 0,
    emptyHeadline: undefined,
    error: undefined,
    warnings: [],
    notices,
    status: undefined,
    databaseProgress: undefined,
    progressPercent: undefined,
    cancelVisible: false,
    ...extra,
  };
}

const SUMMARY = [{ id: "research-helper-import-summary" }];

/**
 * A path shaped like the one a user would really choose.
 *
 * The account name is the point: `docs/09` §2.2's reason for keeping a chosen
 * path out of the log is that a path carries one, so a test asserting the rule
 * has to use a path that would prove the leak if it happened. Synthetic.
 */
const CHOSEN_PATH = "/Users/a-real-person/Desktop/rh-provenance.json";

describe("P1-T45 — the three export strings are registered, not invented", () => {
  const { controller } = harness();

  it("declares all three ids in P1-T18's searchDialog bundle", () => {
    // The compile-time gate (`UndeclaredBundleMessageId`) proves a bundle
    // message has *a* surface; it cannot prove the surface is this one. This
    // does.
    for (const id of [
      controller.l10n.exportProvenance,
      controller.l10n.exportWritten,
      controller.l10n.exportFailed,
    ]) {
      expect(SEARCH_DIALOG_MESSAGE_IDS, `l10n id "${id ?? ""}"`).toContain(id);
    }
  });

  it("names three distinct ids, so no outcome shares the control's label", () => {
    const ids = [
      controller.l10n.exportProvenance,
      controller.l10n.exportWritten,
      controller.l10n.exportFailed,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it("puts the control and its message in the status bar, before Cancel", () => {
    const bar = byId("rh-search-status-bar");
    const ids = (bar?.children ?? []).map((child) => child.attrs.get("id"));
    expect(ids).toContain("rh-search-export");
    expect(ids).toContain("rh-search-export-status");
    // Reading order: the sentence sits beside the control it describes, and the
    // window's own Cancel stays last in the row.
    expect(ids.indexOf("rh-search-export-status")).toBeLessThan(
      ids.indexOf("rh-search-export"),
    );
    expect(ids.indexOf("rh-search-export")).toBeLessThan(
      ids.indexOf("rh-search-cancel"),
    );
  });

  it("ships both new elements hidden, the way Cancel is", () => {
    // `docs/08` §4.6's idiom and `P1-T45` step 3: hidden in the markup,
    // revealed from state. A control that is visible before the first render
    // would be pressable with nothing to export.
    expect(byId("rh-search-export")?.attrs.get("hidden")).toBe("true");
    expect(byId("rh-search-export-status")?.attrs.get("hidden")).toBe("true");
    expect(byId("rh-search-cancel")?.attrs.get("hidden")).toBe("true");
  });

  it("carries no literal label on either element (docs/08 §10.3)", () => {
    const button = byId("rh-search-export");
    expect(button?.attrs.get("label")).toBeUndefined();
    expect(button?.attrs.get("data-l10n-id")).toBe(
      "research-helper-search-export",
    );
    // The message element is pointed at an id by script, never in the markup:
    // it has two of them and the markup cannot know which.
    expect(byId("rh-search-export-status")?.attrs.get("data-l10n-id")).toBe(
      undefined,
    );
  });

  it("reads Zotero's own file-picker module, at the URL Zotero 10 serves", () => {
    // Verified against the shipped binary rather than a document: Zotero's
    // `app/omni.ja` holds the module at `chrome/content/zotero/modules/` and
    // that archive's `chrome.manifest` maps `content zotero
    // chrome/content/zotero/`.
    expect(controller.filePickerModule).toBe(
      "chrome://zotero/content/modules/filePicker.mjs",
    );
    // And the toolkit is not reached for: this file is copied as a build asset,
    // never bundled, so it cannot import from `node_modules` at all.
    expect(SCRIPT_CODE).not.toContain("zotero-plugin-toolkit");
    expect(SCRIPT_CODE).not.toContain("FilePickerHelper");
  });
});

describe("P1-T45 — a record exists, derived from one published state", () => {
  const { controller } = harness();

  it("is false before any import and true once a summary is published", () => {
    expect(controller.logic.exportAvailable(exportState([]))).toBe(false);
    expect(controller.logic.exportAvailable(exportState(SUMMARY))).toBe(true);
  });

  it("tolerates a state with no notices member at all", () => {
    // A host older than `P1-T22` publishes states this document has to survive.
    expect(controller.logic.exportAvailable(undefined)).toBe(false);
    expect(controller.logic.exportAvailable({})).toBe(false);
    expect(controller.logic.exportAvailable({ notices: null })).toBe(false);
  });
});

describe("P1-T45 — the suggested filename carries no user data", () => {
  const { controller } = harness();

  it("is built from the date and nothing else", () => {
    const name = controller.logic.exportFileName(
      Date.UTC(2026, 9, 8, 13, 45, 12),
    );
    expect(name).toBe("research-helper-provenance-2026-10-08.json");
  });

  it("moves with the clock, so it is not a constant", () => {
    expect(controller.logic.exportFileName(Date.UTC(2027, 0, 1))).toBe(
      "research-helper-provenance-2027-01-01.json",
    );
  });

  it("uses only characters legal in a filename on all three OSes", () => {
    // `toISOString()`'s time half carries colons, which Windows rejects — the
    // reason the date half is sliced off rather than the whole string used.
    const name = controller.logic.exportFileName(Date.UTC(2026, 9, 8, 23, 59));
    expect(name).not.toContain(":");
    expect(/^[a-z0-9.-]+$/.test(name)).toBe(true);
    expect(name.endsWith(".json")).toBe(true);
  });
});

describe("P1-T45 — the control is revealed and hidden from view state", () => {
  it("stays hidden while the run on screen has no record", () => {
    const h = harness();
    h.controller.render(exportState([]));
    expect(h.byId("rh-search-export")?.hidden).toBe(true);
    expect(h.byId("rh-search-export-status")?.hidden).toBe(true);
  });

  it("appears once an import has published its summary", () => {
    const h = harness();
    h.controller.render(exportState(SUMMARY));
    expect(h.byId("rh-search-export")?.hidden).toBe(false);
    // The sentence does **not** appear with the control: nothing has been
    // exported yet, and `P1-T45` step 5 forbids an element that is revealed
    // empty.
    expect(h.byId("rh-search-export-status")?.hidden).toBe(true);
  });

  it("hides the control again when the next run clears the record", () => {
    const h = harness();
    h.controller.render(exportState(SUMMARY));
    h.controller.showExportOutcome("written");
    expect(h.byId("rh-search-export-status")?.hidden).toBe(false);

    h.controller.render(exportState([]));
    const message = h.byId("rh-search-export-status");
    expect(h.byId("rh-search-export")?.hidden).toBe(true);
    expect(message?.hidden).toBe(true);
    // `clearRef`, not just `hidden`: `DOMLocalization` does not undo its own
    // writes, so the previous sentence would otherwise still be in the element
    // for the next reveal to show.
    expect(message?.getAttribute("data-l10n-id")).toBeNull();
    expect(message?.textContent).toBe("");
    expect(h.controller.state.exportMessage).toBeNull();
  });
});

describe("P1-T45 — all five outcomes render a sentence, and only one is success", () => {
  it("renders the written sentence for `written`", () => {
    const h = harness();
    h.controller.render(exportState(SUMMARY));
    h.controller.showExportOutcome("written");
    const message = h.byId("rh-search-export-status");
    expect(message?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-export-written",
    );
    expect(message?.hidden).toBe(false);
  });

  it("renders the failure sentence for every other value, never an empty element", () => {
    // `P1-T22` measured that an unresolvable id leaves an element's text alone,
    // which is how seven surfaces once rendered blank. `no-record`, `no-writer`
    // and `no-path` are the three a visible control is not supposed to be able
    // to produce, and they are the ones a blank element would hide.
    for (const outcome of ["failed", "no-record", "no-writer", "no-path"]) {
      const h = harness();
      h.controller.render(exportState(SUMMARY));
      h.controller.showExportOutcome(outcome);
      const message = h.byId("rh-search-export-status");
      expect(
        message?.getAttribute("data-l10n-id"),
        `outcome "${outcome}"`,
      ).toBe("research-helper-search-export-failed");
      expect(message?.hidden, `outcome "${outcome}"`).toBe(false);
    }
  });

  it("sets no data-l10n-args, because neither sentence takes an argument", () => {
    // The enforcement is in `src/i18n/keys.ts`'s `FluentMessageArgsMap`, which
    // declares neither id — see `L10N_EXPORT_TAKES_NO_PATH`. This is the same
    // rule read off the element: an argument object is where a `{ $path }`
    // would have to travel.
    const h = harness();
    h.controller.render(exportState(SUMMARY));
    h.controller.showExportOutcome("written");
    expect(
      h.byId("rh-search-export-status")?.getAttribute("data-l10n-args"),
    ).toBeNull();
  });
});

describe("P1-T45 — pressing the control hands the path inward, once", () => {
  /** A host that records every path it was handed. */
  function recordingHost(outcome: string): {
    host: Record<string, unknown>;
    paths: string[];
  } {
    const paths: string[] = [];
    return {
      paths,
      host: {
        exportProvenance: (path: string): Promise<string> => {
          paths.push(path);
          return Promise.resolve(outcome);
        },
      },
    };
  }

  it("passes exactly the chosen path and renders the written sentence", async () => {
    const { host, paths } = recordingHost("written");
    const h = harness({ host });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);

    expect(await h.controller.exportProvenance()).toBe("written");
    expect(paths).toStrictEqual([CHOSEN_PATH]);
    expect(
      h.byId("rh-search-export-status")?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-export-written");
  });

  it("writes nothing and shows nothing when the chooser is dismissed", async () => {
    // `P1-T45` step 4: the one outcome with no message. A user who cancelled a
    // save dialog knows they did, and the host is never called, so there is no
    // outcome value for this document to render.
    const { host, paths } = recordingHost("written");
    const h = harness({ host });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> => Promise.resolve("");

    expect(await h.controller.exportProvenance()).toBe("");
    expect(paths).toStrictEqual([]);
    const message = h.byId("rh-search-export-status");
    expect(message?.hidden).toBe(true);
    expect(message?.getAttribute("data-l10n-id")).toBeNull();
    expect(h.controller.state.exportMessage).toBeNull();
  });

  it("refuses before the control is visible, so no host call is made", async () => {
    const { host, paths } = recordingHost("written");
    const h = harness({ host });
    h.controller.init();
    h.controller.render(exportState([]));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);

    expect(await h.controller.exportProvenance()).toBe("");
    expect(paths).toStrictEqual([]);
  });

  it("renders the failure sentence when the host rejects", async () => {
    const h = harness({
      host: {
        exportProvenance: (): Promise<string> =>
          Promise.reject(new Error("putContentsAsync failed")),
      },
    });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);

    expect(await h.controller.exportProvenance()).toBe("failed");
    expect(
      h.byId("rh-search-export-status")?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-export-failed");
  });

  it("does nothing at all against a host with no export method", async () => {
    const h = harness({ host: {} });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);
    expect(await h.controller.exportProvenance()).toBe("");
    expect(h.byId("rh-search-export-status")?.hidden).toBe(true);
  });

  it("returns an empty path when no file-picker module can be reached", async () => {
    // `ChromeUtils` does not exist in Node, which is this layer's version of a
    // build where the module has moved. A missing chooser must read as a
    // dismissal — no sentence — rather than as a write that did not happen.
    const { host, paths } = recordingHost("written");
    const h = harness({ host });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    expect(await h.controller.pickExportPath()).toBe("");
    expect(await h.controller.exportProvenance()).toBe("");
    expect(paths).toStrictEqual([]);
  });
});

describe("P1-T45 — the chosen path leaves no trace in the window", () => {
  it("is in no log line, no state field and no element", async () => {
    // `docs/09` §2.2, 2026-10-08: a user-chosen path is not logged at any
    // level, because a path carries an account name. This is the assertion
    // `P1-T45` forbids weakening now that a real chooser supplies real paths.
    const h = harness({
      host: {
        exportProvenance: (): Promise<string> => Promise.resolve("written"),
      },
    });
    h.controller.init();
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);
    await h.controller.exportProvenance();

    for (const line of h.debugLines) {
      expect(line, "a log line").not.toContain(CHOSEN_PATH);
      expect(line, "a log line").not.toContain("a-real-person");
    }
    // Not retained anywhere on the document's own state either: the path is a
    // local `const` for the length of one call.
    const retained = JSON.stringify(h.controller.state);
    expect(retained).not.toContain("a-real-person");
    // And not written into the status bar beside the sentence.
    const strings: string[] = [];
    const walk = (element: FakeElement | undefined): void => {
      if (!element) return;
      strings.push(element.textContent);
      for (const name of ["data-l10n-id", "data-l10n-args", "label", "value"]) {
        strings.push(element.getAttribute(name) ?? "");
      }
      for (const child of element.children) walk(child);
    };
    walk(h.byId("rh-search-status-bar"));
    expect(strings.length).toBeGreaterThan(4);
    for (const text of strings) {
      expect(text).not.toContain("a-real-person");
    }
  });

  it("names no path-bearing placeable anywhere in the shipped script", () => {
    // The structural half: a `{ $path }` would have to travel as a Fluent
    // argument, and the only way to send one is `data-l10n-args`. The export
    // sentences are applied through `applyRef` with an `{ id }` and no `args`.
    expect(SCRIPT_CODE).not.toContain("$path");
    expect(SCRIPT_CODE).not.toMatch(/exportMessage[^\n]*args/);
  });

  it("logs nothing from the chooser or the export path at all", async () => {
    const h = harness({
      host: {
        exportProvenance: (): Promise<string> => Promise.reject(new Error("x")),
      },
    });
    h.controller.init();
    const before = h.debugLines.length;
    h.controller.render(exportState(SUMMARY));
    h.controller.pickExportPath = (): Promise<string> =>
      Promise.resolve(CHOSEN_PATH);
    await h.controller.exportProvenance();
    // A rejected host call is rendered, not logged: the error's own message
    // could quote the path the user typed. `settle()` is what logs a rejection,
    // and `exportProvenance()` resolves rather than rejecting.
    expect(h.debugLines.length).toBe(before);
  });
});

// ===========================================================================
// P1-T44 — the Open Preferences action selects this plugin's pane
// ===========================================================================

describe("P1-T44 — the Open Preferences action has a target", () => {
  it("carries the pane id P1-T44 registers, as the same literal", () => {
    // The script cannot import the constant; the two strings are asserted
    // equal so a rename of either fails here rather than opening the wrong pane.
    const h = harness();
    expect(h.controller.preferencesPaneId).toBe(PREFERENCES_PANE_ID);
  });

  it("passes exactly that pane id to Zotero.Utilities.Internal.openPreferences", () => {
    const h = harness();
    h.controller.init();
    h.controller.openPreferences();
    expect(h.openPreferencesCalls).toEqual([[PREFERENCES_PANE_ID]]);
  });

  it("names the pane in the shipped source, not only on the evaluated object", () => {
    // Belt and braces: `openPreferences(` is called with the property, and the
    // zero-argument form the file carried until 2026-10-13 is gone.
    expect(SCRIPT_CODE).toMatch(/openPreferences\(this\.preferencesPaneId\)/);
    expect(SCRIPT_CODE).not.toMatch(/openPreferences\(\)\s*;/);
  });
});

// ===========================================================================
// P2-T14 — the window's half of chips, badges, per-source status, the role
// row and FR-2's notice. The view model's half is
// `test/unit/ui/searchImportViewModel.test.ts`.
// ===========================================================================

/**
 * `docs/10` FR-2's seven, in registry order. `SOURCE_IDS` also carries
 * `openalex`, which no adapter registers (`docs/02` §9.3), so the list is
 * written out and tied to §8.5's shipped default by the first test below.
 */
const SEVEN_IDS = [
  "pubmed",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
  "biorxiv",
  "medrxiv",
] as const;

/** The seven registered sources as the host lists them, with the capability. */
const SEVEN = SEVEN_IDS.map((id) => ({
  id,
  displayNameKey: `research-helper-source-${id}`,
  keywordSearch: id !== "biorxiv" && id !== "medrxiv",
  keyNotice: false,
  keyRequestUrl: undefined as string | undefined,
}));

const REQUEST_URL = "https://example.invalid/request-a-key";

/** The seven, with Semantic Scholar carrying FR-2's notice. */
const SEVEN_UNKEYED = SEVEN.map((source) =>
  source.id === "semanticscholar"
    ? { ...source, keyNotice: true, keyRequestUrl: REQUEST_URL }
    : source,
);

describe("P2-T14 — the Databases row on a clean profile", () => {
  afterEach(() => {
    setPrefStore(undefined);
  });

  it("renders all seven checkboxes checked, from docs/07 §8.5's sources default through a fake PrefStore", () => {
    // A clean profile: the store holds nothing, so `getPref` answers §8.5's
    // shipped default — the composition root's `getPrefs` binding, verbatim.
    setPrefStore(createMemoryPrefStore({}));
    expect(getPref("sources").split(",")).toStrictEqual([...SEVEN_IDS]);
    expect(SEVEN_IDS.every((id) => SOURCE_IDS.includes(id))).toBe(true);
    const h = harness({
      host: {
        listSources: () => SEVEN,
        getPrefs: () => ({
          sources: getPref("sources"),
          searchYears: getPref("searchYears"),
          maxResults: getPref("maxResults"),
          hideExisting: getPref("hideExisting"),
        }),
      },
    });
    h.controller.init();
    const boxes = h.byId("rh-search-databases")?.children ?? [];
    expect(boxes.map((box) => box.getAttribute("value"))).toStrictEqual([
      ...SEVEN_IDS,
    ]);
    expect(boxes).toHaveLength(7);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(h.byId("rh-search-run")?.disabled).toBe(false);
  });

  it("follows the stored preference when it is not the default — the boxes read the pref", () => {
    setPrefStore(createMemoryPrefStore({ sources: "pubmed,biorxiv" }));
    const h = harness({
      host: {
        listSources: () => SEVEN,
        getPrefs: () => ({ sources: getPref("sources") }),
      },
    });
    h.controller.init();
    const ticked = (h.byId("rh-search-databases")?.children ?? [])
      .filter((box) => box.checked)
      .map((box) => box.getAttribute("value"));
    expect(ticked).toStrictEqual(["pubmed", "biorxiv"]);
  });

  it("disables Search and shows the inline message with every source unchecked (FR-2 scenario 2)", () => {
    const h = harness({ host: { listSources: () => SEVEN } });
    h.controller.init();
    for (const box of h.byId("rh-search-databases")?.children ?? []) {
      box.checked = false;
      box.dispatch("command");
    }
    expect(h.byId("rh-search-run")?.disabled).toBe(true);
    const none = h.byId("rh-search-databases-none");
    expect(none?.hidden).toBe(false);
    expect(none?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-databases-none",
    );
  });
});

describe("P2-T14 — FR-2's Semantic Scholar no-key notice (scenario 3)", () => {
  function box(h: Harness, id: string): FakeElement {
    const found = h
      .byId("rh-search-databases")
      ?.children.find((item) => item.getAttribute("value") === id);
    if (!found) throw new Error(`no checkbox for ${id}`);
    return found;
  }

  it("shows the notice and its link while Semantic Scholar is ticked and unkeyed", () => {
    const h = harness({ host: { listSources: () => SEVEN_UNKEYED } });
    h.controller.init();
    expect(h.byId("rh-search-s2-notice")?.hidden).toBe(false);
    expect(
      h.byId("rh-search-s2-notice-text")?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-s2-no-key");
    const link = h.byId("rh-search-s2-request");
    expect(link?.hidden).toBe(false);
    expect(link?.getAttribute("href")).toBe(REQUEST_URL);

    // Unticking Semantic Scholar takes the notice away; ticking brings it back.
    const s2 = box(h, "semanticscholar");
    s2.checked = false;
    s2.dispatch("command");
    expect(h.byId("rh-search-s2-notice")?.hidden).toBe(true);
    expect(h.byId("rh-search-s2-request")?.getAttribute("href")).toBeNull();
    s2.checked = true;
    s2.dispatch("command");
    expect(h.byId("rh-search-s2-notice")?.hidden).toBe(false);
  });

  it("opens the key-request page through Zotero.launchURL, never by navigating", () => {
    const h = harness({ host: { listSources: () => SEVEN_UNKEYED } });
    h.controller.init();
    let prevented = false;
    h.byId("rh-search-s2-request")?.dispatch("click", {
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(h.launched).toStrictEqual([REQUEST_URL]);
  });

  it("shows nothing when a key is present", () => {
    const h = harness({ host: { listSources: () => SEVEN } });
    h.controller.init();
    expect(h.byId("rh-search-s2-notice")?.hidden).toBe(true);
    expect(h.byId("rh-search-s2-request")?.hidden).toBe(true);
  });

  it("names no URL in the markup: the link's target arrives from the host", () => {
    expect(byId("rh-search-s2-request")?.attrs.has("href")).toBe(false);
    expect(byId("rh-search-s2-notice")?.attrs.get("hidden")).toBe("true");
  });
});

describe("P2-T14 — the status block's rows", () => {
  function statusState(lines: unknown[]): unknown {
    return {
      panel: "searching",
      running: true,
      sources: lines,
      records: undefined,
      recordsRevision: 0,
      warnings: [],
      notices: [],
      cancelVisible: true,
    };
  }

  const roleLine = {
    sourceId: "biorxiv",
    nameId: "research-helper-source-biorxiv",
    outcome: "role",
    detail: { id: "research-helper-search-source-role" },
  };

  it("draws one row per line, and the ⊕ role row as an XHTML span on its own class", () => {
    const h = harness({ host: { listSources: () => SEVEN } });
    h.controller.init();
    h.controller.render(
      statusState([
        {
          sourceId: "pubmed",
          nameId: "research-helper-source-pubmed",
          outcome: "succeeded",
          detail: {
            id: "research-helper-search-source-results",
            args: { count: 43 },
          },
        },
        {
          sourceId: "europepmc",
          nameId: "research-helper-source-europepmc",
          outcome: "searching",
          detail: { id: "research-helper-search-source-searching" },
        },
        roleLine,
        {
          sourceId: "medrxiv",
          nameId: "research-helper-source-medrxiv",
          outcome: "failed",
          detail: {
            id: "rh-error-upstream",
            args: { database: "medRxiv", status: 503 },
          },
        },
      ]),
    );
    const rows = h.byId("rh-search-source-status")?.children ?? [];
    expect(
      rows.map((row) => row.getAttribute("data-rh-outcome")),
    ).toStrictEqual(["succeeded", "searching", "role", "failed"]);
    const role = rows[2]?.children[1];
    expect(role?.name).toBe("span");
    expect(role?.namespace).toBe("http://www.w3.org/1999/xhtml");
    expect(role?.className).toBe("rh-source-role");
    expect(role?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-source-role",
    );
    // A real failure on a lookup-only server is drawn as an error, never ⊕.
    expect(rows[3]?.children[1]?.className).toBe("rh-inline-warning");
    expect(rows[0]?.children[1]?.className).toBe("rh-hint");
  });

  it("reserves the ⊕ glyph to the role row's class, and keeps it out of every bundle", () => {
    const rules = CSS_CODE.match(/[^{}]+\{[^{}]*\\2295[^{}]*\}/g) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.trim().startsWith(".rh-source-role::before")).toBe(true);
    for (const locale of ["en-US", "ko-KR"]) {
      const bundle = readFileSync(
        resolve(addon, `locale/${locale}/research-helper-searchDialog.ftl`),
        "utf8",
      );
      const messages = bundle
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .join("\n");
      expect(messages, locale).not.toContain("⊕");
    }
  });

  it("names the database on every line of the all-failed panel", () => {
    const h = harness({ host: { listSources: () => SEVEN } });
    h.controller.init();
    h.controller.render({
      panel: "error",
      running: false,
      sources: [],
      records: [],
      recordsRevision: 1,
      warnings: [],
      notices: [],
      cancelVisible: false,
      error: {
        headline: { id: "research-helper-search-state-error" },
        lines: [
          {
            sourceId: "pubmed",
            nameId: "research-helper-source-pubmed",
            outcome: "failed",
            detail: { id: "rh-error-offline" },
          },
          {
            sourceId: "semanticscholar",
            nameId: "research-helper-source-semanticscholar",
            outcome: "failed",
            detail: {
              id: "rh-error-forbidden",
              args: { provider: "Semantic Scholar", status: 403 },
            },
          },
        ],
        details: ["OFFLINE", "AUTHORIZATION", "403"],
        retry: true,
        openPreferences: true,
      },
    });
    const lines = h.byId("rh-state-error-lines");
    expect(lines?.hidden).toBe(false);
    expect(
      lines?.children.map((row) =>
        row.children[0]?.getAttribute("data-l10n-id"),
      ),
    ).toStrictEqual([
      "research-helper-source-pubmed",
      "research-helper-source-semanticscholar",
    ]);
    expect(
      lines?.children.map((row) =>
        row.children[1]?.getAttribute("data-l10n-id"),
      ),
    ).toStrictEqual(["rh-error-offline", "rh-error-forbidden"]);
    expect(h.byId("rh-state-error-open-preferences")?.hidden).toBe(false);
    expect(h.byId("rh-state-error-retry")?.hidden).toBe(false);
  });
});

describe("P2-T14 — chips and the duplicate badge in the table", () => {
  const dupRef = {
    id: "research-helper-search-row-duplicate",
    args: { tier: "title-fuzzy", score: 87 },
  };

  function flaggedPair(): TableRecord[] {
    return [
      {
        key: "pubmed:1",
        title: "Lipid A",
        sourceLabels: ["PubMed", "Crossref", "Europe PMC"],
        sourceIds: ["pubmed", "crossref", "europepmc"],
        duplicate: { withKeys: ["crossref:2"], ref: dupRef },
      },
      {
        key: "crossref:2",
        title: "Lipid A.",
        sourceLabels: ["Crossref"],
        sourceIds: ["crossref"],
        duplicate: { withKeys: ["pubmed:1"], ref: dupRef },
      },
      {
        key: "arxiv:3",
        title: "Other",
        sourceLabels: ["arXiv"],
        sourceIds: ["arxiv"],
      },
    ];
  }

  it("draws one chip per contributing source, tagged with its id", () => {
    const h = harness();
    h.controller.init();
    h.controller.setResults(flaggedPair());
    const first = h.byId("rh-results-body")?.children[0];
    const chips = first?.children[4]?.children ?? [];
    expect(chips.map((chip) => chip.textContent)).toStrictEqual([
      "PubMed",
      "Crossref",
      "Europe PMC",
    ]);
    expect(
      chips.map((chip) => chip.getAttribute("data-rh-source")),
    ).toStrictEqual(["pubmed", "crossref", "europepmc"]);
    expect(chips.every((chip) => chip.className === "rh-source-line")).toBe(
      true,
    );
  });

  it("badges both flagged rows, distinct from the already-in-library marker, and keeps the title", () => {
    const h = harness();
    h.controller.init();
    h.controller.setResults(flaggedPair());
    const rows = h.byId("rh-results-body")?.children ?? [];
    for (const row of rows.slice(0, 2)) {
      expect(row.className).toBe("rh-row rh-row-duplicate");
      const title = row.children[1];
      const badge = title?.children[0];
      expect(badge?.className).toBe("rh-duplicate-badge");
      expect(badge?.getAttribute("data-l10n-id")).toBe(
        "research-helper-search-row-duplicate",
      );
      expect(
        JSON.parse(badge?.getAttribute("data-l10n-args") ?? "{}"),
      ).toStrictEqual({ tier: "title-fuzzy", score: 87 });
    }
    expect(rows[0]?.children[1]?.textContent).toBe("Lipid A");
    expect(rows[2]?.className).toBe("rh-row");
    expect(rows[2]?.children[1]?.textContent).toBe("Other");
    expect(h.controller.spec.rowClass.duplicateBadge).not.toBe(
      h.controller.spec.rowClass.badge,
    );
  });

  it("keeps both rows of a flagged pair independently selectable, and merges nothing", () => {
    const h = harness();
    h.controller.init();
    h.controller.setResults(flaggedPair());
    expect(h.controller.state.selection).toStrictEqual([
      "pubmed:1",
      "crossref:2",
      "arxiv:3",
    ]);
    const [first, second] = h.controller.rowCheckboxes();
    if (!first || !second) throw new Error("rows not drawn");
    first.checked = false;
    first.dispatch("change");
    expect(second.checked).toBe(true);
    const picked = (h.controller.collectImportRequest().records ??
      []) as TableRecord[];
    expect(picked.map((record) => record.key)).toStrictEqual([
      "crossref:2",
      "arxiv:3",
    ]);
    second.checked = false;
    second.dispatch("change");
    first.checked = true;
    first.dispatch("change");
    expect(
      (
        (h.controller.collectImportRequest().records ?? []) as TableRecord[]
      ).map((record) => record.key),
    ).toStrictEqual(["pubmed:1", "arxiv:3"]);
  });

  it("draws the linked badge for a linked pair", () => {
    const h = harness();
    h.controller.init();
    h.controller.setResults([
      {
        key: "pubmed:1",
        title: "Published",
        linked: {
          withKeys: ["biorxiv:2"],
          ref: { id: "research-helper-search-row-linked" },
        },
      },
    ]);
    const badge =
      h.byId("rh-results-body")?.children[0]?.children[1]?.children[0];
    expect(badge?.className).toBe("rh-linked-badge");
    expect(badge?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-row-linked",
    );
  });
});

describe("P2-T14 — gate G-16's preprint policy in the duplicate-handling area", () => {
  it("places P2-T11's policy string inside the duplicates group, after the three radios", () => {
    const group = byId("rh-search-duplicates-group");
    const children = group?.children ?? [];
    const policy = children.find(
      (child) => child.attrs.get("id") === "rh-search-preprint-policy",
    );
    expect(policy?.attrs.get("data-l10n-id")).toBe(
      "research-helper-search-preprint-policy",
    );
    expect(SEARCH_DIALOG_MESSAGE_IDS).toContain(
      "research-helper-search-preprint-policy",
    );
    const at = (id: string): number =>
      children.findIndex((child) => child.attrs.get("id") === id);
    expect(at("rh-search-preprint-policy")).toBeGreaterThan(
      at("rh-search-duplicates"),
    );
    // Plain text, always shown: nothing hides it and nothing passes arguments.
    expect(policy?.attrs.has("hidden")).toBe(false);
    expect(policy?.attrs.has("data-l10n-args")).toBe(false);
  });
});

describe("P2-T14 — the Databases row paints names as labels (review row 142)", () => {
  it("falls back to the source id, never an empty checkbox, when a name does not resolve", async () => {
    const h = harness({
      host: { listSources: () => [PUBMED, CROSSREF] },
      formatMessages: (requests) =>
        Promise.resolve(
          requests.map((request) => ({
            value: request.id === PUBMED.displayNameKey ? "PubMed" : null,
            attributes: [],
          })),
        ),
    });
    h.controller.init();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      h
        .byId("rh-search-databases")
        ?.children.map((box) => box.getAttribute("label")),
    ).toStrictEqual(["PubMed", "crossref"]);
  });
});

describe("P2-T14 — the Databases row writes the sources preference (step 1)", () => {
  it("hands the host the ticked set on a user's toggle, and writes nothing on open", () => {
    const writes: string[][] = [];
    const h = harness({
      host: {
        listSources: () => [PUBMED, CROSSREF],
        saveSources: (ids: string[]) => {
          writes.push([...ids]);
        },
      },
    });
    h.controller.init();
    expect(writes).toStrictEqual([]);
    const crossref = h.byId("rh-search-databases")?.children[1];
    if (!crossref) throw new Error("no Crossref checkbox");
    crossref.checked = false;
    crossref.dispatch("command");
    expect(writes).toStrictEqual([["pubmed"]]);
  });

  it("an empty selection survives a reopen as empty, so Search stays disabled with FR-2's message (item 207)", () => {
    // The composition root's two bindings, verbatim (`registerUI.ts`).
    setPrefStore(createMemoryPrefStore({}));
    try {
      const host = {
        listSources: () => SEVEN,
        getPrefs: () => ({ sources: getPref("sources") }),
        saveSources: (ids: string[]) => {
          setPref("sources", ids.join(","));
        },
      };
      const first = harness({ host });
      first.controller.init();
      for (const box of first.byId("rh-search-databases")?.children ?? []) {
        box.checked = false;
        box.dispatch("command");
      }
      expect(getPref("sources")).toBe("");

      const again = harness({ host });
      again.controller.init();
      const boxes = again.byId("rh-search-databases")?.children ?? [];
      expect(boxes).toHaveLength(7);
      expect(boxes.filter((box) => box.checked)).toStrictEqual([]);
      expect(again.byId("rh-search-run")?.disabled).toBe(true);
      const none = again.byId("rh-search-databases-none");
      expect(none?.hidden).toBe(false);
      expect(none?.getAttribute("data-l10n-id")).toBe(
        "research-helper-search-databases-none",
      );
    } finally {
      setPrefStore(undefined);
    }
  });
});

// ===========================================================================
// P2-T17 — FR-12's Re-run (pre-filled from provenance) state, docs/08 §4.6
// ===========================================================================

/** The host's `loadRerun()` answer, as the view model builds it. */
const RERUN_SEED = {
  collectionID: 4242,
  collectionName: "CRISPR delivery / 2026 screen",
  recordedAt: "2026-03-14T09:00:30.000Z",
  databases: 2,
  retrieved: 142,
  imported: 37,
  asRecorded: {
    userQuery: "lipid nanoparticle CRISPR delivery",
    sourceIds: ["crossref"],
    requestedLimit: 40,
    dateWindow: { fromIso: "2019-01-01", toIso: "2021-12-31" },
  },
  advanced: {
    userQuery: "lipid nanoparticle CRISPR delivery",
    sourceIds: ["crossref"],
    requestedLimit: 40,
    dateWindow: { fromIso: "2019-01-01", toIso: "2026-10-15" },
  },
};

/** Let the controller's `loadRerun()` promise and its continuation run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Open the window the way the menu entry does, and wait for the seed. */
async function openRerun(
  options: {
    readonly seed?: unknown;
    readonly mode?: string;
  } = {},
): Promise<{ h: Harness; asked: number[] }> {
  const asked: number[] = [];
  const seed = "seed" in options ? options.seed : RERUN_SEED;
  const h = harness({
    nowEpochMs: localMidnight(2026, 10, 15),
    args: { mode: options.mode ?? "rerun", collectionID: 4242 },
    host: {
      listSources: () => [PUBMED, CROSSREF],
      listCollections: () => [{ id: 4242, name: RERUN_SEED.collectionName }],
      loadRerun: (id: number) => {
        asked.push(id);
        return Promise.resolve(seed);
      },
    },
  });
  h.controller.init();
  await flush();
  return { h, asked };
}

function argsOf(element: FakeElement | undefined): unknown {
  const raw = element?.getAttribute("data-l10n-args");
  return raw === null || raw === undefined ? undefined : JSON.parse(raw);
}

describe('P2-T17 — the window opened with mode: "rerun" (steps 6–7)', () => {
  it("asks the host for the invoked collection's record, once", async () => {
    const { asked } = await openRerun();
    expect(asked).toStrictEqual([4242]);
  });

  it("shows the Re-run chip, the §4.6 banner and the re-run panel in place of INITIAL", async () => {
    const { h } = await openRerun();
    const chip = h.byId("rh-search-mode");
    expect(chip?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-mode-rerun",
    );
    expect(argsOf(chip)).toStrictEqual({
      collection: "CRISPR delivery / 2026 screen",
    });
    const heading = h.byId("rh-rerun-heading");
    expect(heading?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-rerun-heading",
    );
    expect(argsOf(heading)).toStrictEqual({
      collection: "CRISPR delivery / 2026 screen",
    });
    expect(argsOf(h.byId("rh-rerun-recorded"))).toStrictEqual({
      date: "2026-03-14",
      databases: 2,
      retrieved: 142,
      imported: 37,
    });
    expect(h.byId("rh-state-rerun")?.hidden).toBe(false);
    expect(h.byId("rh-state-initial")?.hidden).toBe(true);
  });

  it('selects "as recorded" and seeds every control from the record', async () => {
    const { h } = await openRerun();
    expect(h.byId("rh-rerun-dates")?.value).toBe("recorded");
    expect(h.byId("rh-search-keyword")?.value).toBe(
      "lipid nanoparticle CRISPR delivery",
    );
    expect(
      h
        .byId("rh-search-databases")
        ?.children.map((box) => [box.getAttribute("value"), box.checked]),
    ).toStrictEqual([
      ["pubmed", false],
      ["crossref", true],
    ]);
    expect(h.byId("rh-search-max-results")?.value).toBe("40");
    // 2019 is outside the 20 years the menulists normally offer from 2026, and
    // is offered anyway so the record can be shown as recorded.
    expect(h.byId("rh-search-years-from")?.value).toBe("2019");
    expect(h.byId("rh-search-years-to")?.value).toBe("2021");
    // docs/08 §4.6 rule 3: the invoked collection, "New collection…" still there.
    expect(h.byId("rh-search-target")?.value).toBe("4242");
    expect(h.byId("rh-search-target-new-item")).toBeDefined();
  });

  it("leaves every seeded control editable (§4.6 rule 1)", async () => {
    const { h } = await openRerun();
    const seeded = [
      h.byId("rh-search-keyword"),
      h.byId("rh-search-max-results"),
      h.byId("rh-search-years-from"),
      h.byId("rh-search-years-to"),
      h.byId("rh-rerun-dates"),
      h.byId("rh-search-target"),
      h.byId("rh-search-target-new"),
      ...(h.byId("rh-search-databases")?.children ?? []),
    ];
    expect(seeded.every((element) => element !== undefined)).toBe(true);
    for (const element of seeded) {
      expect(element?.disabled, element?.id).toBe(false);
      expect(element?.getAttribute("readonly"), element?.id).toBeNull();
      expect(element?.getAttribute("disabled"), element?.id).toBeNull();
    }
    expect(h.byId("rh-search-run")?.disabled).toBe(false);
  });

  it('sends the recorded window exactly, and moves only the upper bound on "advance to today"', async () => {
    const { h } = await openRerun();
    expect(h.controller.collectQuery()).toMatchObject({
      mode: "rerun",
      keyword: "lipid nanoparticle CRISPR delivery",
      sources: ["crossref"],
      maxResults: 40,
      dateWindow: { fromIso: "2019-01-01", toIso: "2021-12-31" },
    });

    const dates = h.byId("rh-rerun-dates");
    if (!dates) throw new Error("no radio pair");
    dates.value = "advance";
    dates.dispatch("command");
    expect(h.controller.collectQuery()["dateWindow"]).toStrictEqual({
      fromIso: "2019-01-01",
      toIso: "2026-10-15",
    });
    expect(h.byId("rh-search-years-from")?.value).toBe("2019");
    expect(h.byId("rh-search-years-to")?.value).toBe("2026");

    dates.value = "recorded";
    dates.dispatch("command");
    expect(h.controller.collectQuery()["dateWindow"]).toStrictEqual(
      RERUN_SEED.asRecorded.dateWindow,
    );
  });

  it("drops the recorded window once the user picks a year: an adjusted re-run is a normal run", async () => {
    const { h } = await openRerun();
    const from = h.byId("rh-search-years-from");
    if (!from) throw new Error("no from-year menulist");
    from.value = "2020";
    from.dispatch("command");
    const query = h.controller.collectQuery();
    expect(query["dateWindow"]).toBeUndefined();
    expect(query["fromYear"]).toBe(2020);
  });

  it("shows and sends a recorded All years (FR-3's dateFilter: none)", async () => {
    const allYears = {
      ...RERUN_SEED,
      asRecorded: { ...RERUN_SEED.asRecorded, dateWindow: "all-years" },
      advanced: { ...RERUN_SEED.advanced, dateWindow: "all-years" },
    };
    const { h } = await openRerun({ seed: allYears });
    const span = h.byId("rh-search-years-span");
    expect(span?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-rerun-all-years",
    );
    expect(span?.getAttribute("data-l10n-args")).toBeNull();
    expect(h.controller.collectQuery()["dateWindow"]).toBe("all-years");
  });

  it("opens as a keyword search when the collection has no record", async () => {
    const { h } = await openRerun({ seed: undefined });
    expect(h.byId("rh-search-mode")?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-mode-keyword",
    );
    expect(h.byId("rh-state-initial")?.hidden).toBe(false);
    expect(h.byId("rh-state-rerun")?.hidden).toBe(true);
    expect(h.controller.collectQuery()["dateWindow"]).toBeUndefined();
  });

  it("never asks for a record in keyword mode, so a keyword query is unchanged", async () => {
    const { h, asked } = await openRerun({ mode: "keyword" });
    expect(asked).toStrictEqual([]);
    expect("dateWindow" in h.controller.collectQuery()).toBe(false);
  });

  it("draws the view model's INITIAL as the re-run panel, and every other state as itself", async () => {
    const { h } = await openRerun();
    h.controller.render(exportState([], { panel: "initial" }));
    expect(h.byId("rh-state-rerun")?.hidden).toBe(false);
    expect(h.byId("rh-state-initial")?.hidden).toBe(true);
    h.controller.render(exportState([], { panel: "searching" }));
    expect(h.byId("rh-state-searching")?.hidden).toBe(false);
    expect(h.byId("rh-state-rerun")?.hidden).toBe(true);
  });

  it("ships the panel hidden, its radio pair labelled by Years, with machine values", () => {
    const panel = byId("rh-state-rerun");
    expect(panel?.attrs.get("hidden")).toBe("true");
    expect(panel?.parent?.attrs.get("id")).toBe("rh-results-area");
    const group = byId("rh-rerun-dates");
    expect(group?.name).toBe("radiogroup");
    expect(group?.attrs.get("aria-labelledby")).toBe("rh-search-years-label");
    expect(
      group?.children.map((radio) => [
        radio.name,
        radio.attrs.get("value"),
        radio.attrs.get("data-l10n-id"),
      ]),
    ).toStrictEqual([
      ["radio", "recorded", "research-helper-search-rerun-as-recorded"],
      ["radio", "advance", "research-helper-search-rerun-advance"],
    ]);
  });
});

// ===========================================================================
// P3-T27 — the relevance-screening row (docs/08 §4.2's threshold row)
// ===========================================================================

describe("P3-T27 — the relevance-screening row", () => {
  const SCREENING_HOST = {
    getPrefs: () => ({ screeningThreshold: 45, screeningAvailable: true }),
  };

  function scoredRecords(): TableRecord[] {
    const ref = (score: number) => ({
      score,
      ref: { id: "research-helper-search-row-relevance", args: { score } },
    });
    return [
      { ...record(1), relevance: ref(90) },
      { ...record(2), relevance: ref(20) },
      record(3),
    ] as TableRecord[];
  }

  function screenedState(records: TableRecord[]): Record<string, unknown> {
    return {
      panel: "results",
      running: false,
      sources: [],
      records,
      recordsRevision: 1,
      warnings: [],
      notices: [],
      cancelVisible: false,
      screening: { threshold: 60, scored: 2, unscored: 1 },
    };
  }

  it("opens at the host's screening.threshold, unticked, with the number hidden (Done-when)", () => {
    const h = harness({ host: SCREENING_HOST });
    h.controller.init();
    expect(h.byId("rh-search-screening-row")?.hidden).toBe(false);
    expect(h.byId("rh-search-screening")?.checked).toBe(false);
    expect(h.byId("rh-search-screening-controls")?.hidden).toBe(true);
    expect(h.byId("rh-search-screening-threshold")?.value).toBe("45");
    expect(h.controller.collectQuery()["screening"]).toStrictEqual({
      enabled: false,
      threshold: 45,
    });
    expect(h.prefReads).toStrictEqual([]);
  });

  it("is not offered when the host says screening cannot run, or gives no threshold", () => {
    for (const getPrefs of [
      () => ({ screeningThreshold: 45, screeningAvailable: false }),
      () => ({ screeningAvailable: true }),
      () => ({}),
    ]) {
      const h = harness({ host: { getPrefs } });
      h.controller.init();
      expect(h.byId("rh-search-screening-row")?.hidden).toBe(true);
      const box = h.byId("rh-search-screening");
      if (box) box.checked = true;
      expect(h.controller.collectQuery()["screening"]).toMatchObject({
        enabled: false,
      });
    }
  });

  it("sends a per-run number when ticked, and nothing writes it back (Done-when)", () => {
    const h = harness({ host: SCREENING_HOST });
    h.controller.init();
    const box = h.byId("rh-search-screening");
    if (box) box.checked = true;
    box?.dispatch("command");
    expect(h.byId("rh-search-screening-controls")?.hidden).toBe(false);
    const number = h.byId("rh-search-screening-threshold");
    if (number) number.value = "70";
    number?.dispatch("input");
    expect(h.controller.collectQuery()["screening"]).toStrictEqual({
      enabled: true,
      threshold: 70,
    });
    // The fake Zotero has no Prefs.set and the host no setter: the only way
    // the preference could change is a call that does not exist.
    expect(SCREENING_HOST.getPrefs().screeningThreshold).toBe(45);
    expect(h.prefReads).toStrictEqual([]);
  });

  it("hides a scored row below the threshold until Show excluded, never an unscored row, with the count beside it", () => {
    const h = harness({ host: SCREENING_HOST });
    h.controller.init();
    const box = h.byId("rh-search-screening");
    if (box) box.checked = true;
    box?.dispatch("command");
    const number = h.byId("rh-search-screening-threshold");
    if (number) number.value = "60";
    h.controller.render(screenedState(scoredRecords()));
    const visible = (): string[] =>
      h.controller.state.visible.map((row) => row.key);
    expect(visible()).toStrictEqual(["10.1000/rh.1", "10.1000/rh.3"]);
    const count = h.byId("rh-search-screening-count");
    expect(count?.hidden).toBe(false);
    expect(count?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-screening-count",
    );
    expect(
      JSON.parse(count?.getAttribute("data-l10n-args") ?? "{}"),
    ).toStrictEqual({ total: 3, kept: 2, excluded: 1 });

    const show = h.byId("rh-search-screening-show-excluded");
    if (show) show.checked = true;
    show?.dispatch("command");
    expect(visible()).toHaveLength(3);

    // Threshold 0 hides nothing; unticking the box shows every row too.
    if (show) show.checked = false;
    if (number) number.value = "0";
    number?.dispatch("input");
    expect(visible()).toHaveLength(3);
    if (number) number.value = "60";
    if (box) box.checked = false;
    box?.dispatch("command");
    expect(visible()).toHaveLength(3);
    expect(count?.hidden).toBe(true);
  });
});

// ===========================================================================
// Item 281(b) — the estimated cost beside the screening checkbox (owner,
// 2026-10-24; docs/08 §4.2's note of that date)
// ===========================================================================

describe("item 281(b) — the screening cost line", () => {
  const tick = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  /** A host that answers each cost request when the test says so. */
  function costHost(available = true) {
    const asked: Record<string, unknown>[] = [];
    const answers: ((ref: unknown) => void)[] = [];
    const host = {
      listSources: () => [PUBMED, CROSSREF],
      getPrefs: () => ({
        screeningThreshold: 45,
        screeningAvailable: available,
      }),
      screeningCost: (query: Record<string, unknown>) => {
        asked.push(query);
        return new Promise((resolve) => answers.push(resolve));
      },
    };
    return { host, asked, answers };
  }

  const line = (cost: string, count: number) => ({
    id: "research-helper-search-screening-cost",
    args: { cost, count },
  });

  it("shows the host's estimate beside the checkbox once the window opens", async () => {
    const { host, asked, answers } = costHost();
    const h = harness({ host });
    h.controller.init();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      sources: ["pubmed", "crossref"],
      maxResults: PREFS.maxResults.default,
    });
    const cost = h.byId("rh-search-screening-cost");
    expect(cost?.hidden).toBe(true);
    answers[0]?.(line("$0.42", 200));
    await tick();
    expect(cost?.hidden).toBe(false);
    expect(cost?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-screening-cost",
    );
    expect(JSON.parse(cost?.getAttribute("data-l10n-args") ?? "{}")).toEqual({
      cost: "$0.42",
      count: 200,
    });
  });

  it("asks again when a database, the maximum or the keyword changes, and drops an overtaken answer", async () => {
    const { host, asked, answers } = costHost();
    const h = harness({ host });
    h.controller.init();
    const box = h.byId("rh-search-databases")?.children[1];
    if (box) box.checked = false;
    box?.dispatch("command");
    expect(asked[1]).toMatchObject({ sources: ["pubmed"] });
    const max = h.byId("rh-search-max-results");
    if (max) max.value = "50";
    max?.dispatch("input");
    expect(asked[2]).toMatchObject({ maxResults: 50 });
    const keyword = h.byId("rh-search-keyword");
    if (keyword) keyword.value = "lipid";
    keyword?.dispatch("input");
    expect(asked[3]).toMatchObject({ keyword: "lipid", maxResults: 50 });
    // The latest answer lands first; the older ones are dropped when they come.
    answers[3]?.(line("$0.05", 50));
    await tick();
    answers[0]?.(line("$9.99", 200));
    answers[1]?.(line("$9.99", 100));
    await tick();
    expect(
      JSON.parse(
        h.byId("rh-search-screening-cost")?.getAttribute("data-l10n-args") ??
          "{}",
      ),
    ).toEqual({ cost: "$0.05", count: 50 });
  });

  it("says when the price is unknown, and hides the line when there is nothing to price", async () => {
    const { host, answers } = costHost();
    const h = harness({ host });
    h.controller.init();
    answers[0]?.({
      id: "research-helper-search-screening-cost-unpriced",
      args: { model: "screen-model" },
    });
    await tick();
    const cost = h.byId("rh-search-screening-cost");
    expect(cost?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-screening-cost-unpriced",
    );
    expect(cost?.hidden).toBe(false);
    const keyword = h.byId("rh-search-keyword");
    keyword?.dispatch("input");
    answers[1]?.(undefined);
    await tick();
    expect(cost?.hidden).toBe(true);
  });

  it("asks nothing and shows nothing when screening is not offered, or the host has no estimate", () => {
    const off = costHost(false);
    const h = harness({ host: off.host });
    h.controller.init();
    expect(off.asked).toHaveLength(0);
    expect(h.byId("rh-search-screening-cost")?.hidden).toBe(true);
    const bare = harness({
      host: {
        getPrefs: () => ({ screeningThreshold: 45, screeningAvailable: true }),
      },
    });
    bare.controller.init();
    expect(bare.byId("rh-search-screening-cost")?.hidden).toBe(true);
  });
});

// ===========================================================================
// P5-T15 — the window opened with mode: "related" (docs/08 §5.2's notes of
// 2026-11-02). The real window is test/integration/menus.spec.ts's.
// ===========================================================================

describe('P5-T15 — the window opened with mode: "related"', () => {
  const SEED = {
    title: "Lipid nanoparticles for CRISPR delivery",
    authors: [
      { family: "Lovelace", given: "Ada" },
      { family: "Turing", given: "Alan" },
    ],
    venue: "Nature",
    year: 2021,
    doi: "10.1000/seed",
  };

  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  /** Open the window on a seed and let its asynchronous read land. */
  async function openRelated(
    seed: unknown = SEED,
    extraHost: Record<string, unknown> = {},
  ) {
    const asked: unknown[] = [];
    let connects = 0;
    const h = harness({
      args: { mode: "related", seedItemID: 77 },
      host: {
        listSources: () => [PUBMED, CROSSREF],
        connect: () => {
          connects += 1;
        },
        loadRelatedSeed: (id: unknown) => {
          asked.push(id);
          return seed instanceof Error
            ? Promise.reject(seed)
            : Promise.resolve(seed);
        },
        ...extraHost,
      },
    });
    h.controller.init();
    await flush();
    return { h, asked, connects: () => connects };
  }

  it("asks the host for that seed, once, and draws its lines as data", async () => {
    const { h, asked } = await openRelated();
    expect(asked).toStrictEqual([77]);
    expect(h.byId("rh-related-header")?.hidden).toBe(false);
    expect(h.byId("rh-related-seed-title")?.textContent).toBe(SEED.title);
    expect(h.byId("rh-related-seed-title")?.hidden).toBe(false);
    expect(h.byId("rh-related-seed-authors")?.textContent).toContain("Turing");
    expect(h.byId("rh-related-seed-details")?.textContent).toBe(
      "· Nature · 2021 · 10.1000/seed",
    );
    expect(h.byId("rh-related-seed-missing")?.hidden).toBe(true);
  });

  it("leaves out what the seed does not have, and keeps a long author list to the overflow message", async () => {
    const bare = await openRelated({ title: "T", authors: [] });
    expect(bare.h.byId("rh-related-seed-authors")?.textContent).toBe("");
    expect(bare.h.byId("rh-related-seed-details")?.textContent).toBe("");

    const many = await openRelated({
      title: "T",
      authors: Array.from({ length: 12 }, (_, at) => ({ family: `N${at}` })),
    });
    const authors = many.h.byId("rh-related-seed-authors");
    expect(authors?.getAttribute("data-l10n-id")).toBe(
      many.h.controller.l10n["authorsOverflow"],
    );
    expect(argsOf(authors)).toMatchObject({
      count: 12 - many.h.controller.spec.authorNamesShown,
    });
  });

  it("hides what has no meaning for a seed and shows the Include row ticked", async () => {
    const { h } = await openRelated();
    for (const id of [
      "rh-search-keyword-label",
      h.controller.spec.keyword,
      h.controller.spec["run"] as string,
      h.controller.spec["yearsSpan"] as string,
      "rh-search-max-results-label",
      h.controller.spec["maxResults"] as string,
      "rh-search-databases-group",
      h.controller.spec["screeningRow"] as string,
    ]) {
      expect(h.byId(id), id).toBeDefined();
      expect(h.byId(id)?.hidden, id).toBe(true);
    }
    for (const relation of SEARCH_WINDOW_RELATIONS) {
      const box = h.byId(`rh-related-include-${relation}`);
      expect(box?.checked, relation).toBe(true);
      expect(box?.getAttribute("value"), relation).toBe(relation);
    }
  });

  it("offers one box for each relation the code knows, in the wireframe's order", () => {
    const boxes = (harness().byId("rh-related-include")?.children ?? []).filter(
      (child) => child.name === "checkbox",
    );
    expect(boxes.map((box) => box.getAttribute("value"))).toStrictEqual([
      ...SEARCH_WINDOW_RELATIONS,
    ]);
  });

  it("names the seed in a chip cut at 60 code points, and never says Keyword first", async () => {
    let answer: (seed: unknown) => void = () => undefined;
    const h = harness({
      args: { mode: "related", seedItemID: 77 },
      host: {
        loadRelatedSeed: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    h.controller.init();
    await flush();
    const chip = h.byId(h.controller.spec["mode"] as string);
    expect(chip?.hidden).toBe(true);

    // A 61-code-point title made of surrogate pairs: a cut by UTF-16 unit would
    // leave half a pair behind.
    const title = "😀".repeat(61);
    answer({ title, authors: [] });
    await flush();
    expect(chip?.hidden).toBe(false);
    expect(chip?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-mode-related",
    );
    expect(argsOf(chip)).toStrictEqual({ title: `${"😀".repeat(60)}…` });
    expect(h.byId("rh-related-seed-title")?.textContent).toBe(title);
  });

  it("does not cut a title of exactly 60 code points", async () => {
    const title = "x".repeat(60);
    const { h } = await openRelated({ title, authors: [] });
    expect(argsOf(h.byId(h.controller.spec["mode"] as string))).toStrictEqual({
      title,
    });
  });

  it("shows the missing line when the host has no reader, no answer, or a failed read", async () => {
    const noReader = await openRelated(SEED, { loadRelatedSeed: undefined });
    const noAnswer = await openRelated(SEED, {
      loadRelatedSeed: () => Promise.resolve(undefined),
    });
    const rejected = await openRelated(new Error("read failed"));
    for (const { h } of [noReader, noAnswer, rejected]) {
      expect(h.byId("rh-related-seed-missing")?.hidden).toBe(false);
      expect(h.byId("rh-related-seed-title")?.hidden).toBe(true);
      expect(h.byId("rh-related-seed-meta")?.hidden).toBe(true);
      expect(h.byId(h.controller.spec["mode"] as string)?.hidden).toBe(true);
    }
    // The log carries the failure's name and never its message (settle()).
    expect(rejected.h.debugLines.join("\n")).toContain("host call rejected");
    expect(rejected.h.debugLines.join("\n")).not.toContain("read failed");
  });

  it("asks for no seed without a whole-number seed id", async () => {
    const asked: unknown[] = [];
    const h = harness({
      args: { mode: "related" },
      host: {
        loadRelatedSeed: (id: unknown) => {
          asked.push(id);
          return Promise.resolve(SEED);
        },
      },
    });
    h.controller.init();
    await flush();
    expect(asked).toStrictEqual([]);
    expect(h.byId("rh-related-seed-missing")?.hidden).toBe(false);
  });

  it("does not connect the keyword view model, and search() starts nothing", async () => {
    const searches: unknown[] = [];
    const { h, connects } = await openRelated(SEED, {
      runSearch: (query: unknown) => {
        searches.push(query);
        return Promise.resolve();
      },
    });
    expect(connects()).toBe(0);
    // The keyword gate would open: only the mode stops this run.
    const keyword = h.byId(h.controller.spec.keyword);
    if (!keyword) throw new Error("no keyword field");
    keyword.value = "a leftover keyword";
    expect(h.controller.refreshSearchGate().enabled).toBe(true);
    h.controller.search();
    expect(searches).toStrictEqual([]);
    expect(h.controller.state.running).toBe(false);
  });

  it("puts both year lists on Any, first, and reads Any as no bound", async () => {
    const { h } = await openRelated();
    for (const id of ["rh-search-years-from", "rh-search-years-to"]) {
      const list = h.byId(id);
      expect(list?.value, id).toBe("any");
      const items = list?.firstElementChild?.children ?? [];
      expect(items[0]?.getAttribute("value"), id).toBe("any");
      expect(items[0]?.getAttribute("data-l10n-id"), id).toBe(
        "research-helper-search-years-any",
      );
      expect(items.length, id).toBeGreaterThan(1);
    }
    const query = h.controller.collectQuery();
    expect(query["fromYear"]).toBeNaN();
    expect(query["toYear"]).toBeNaN();
  });

  it("does not repaint the keyword panel when a year list changes", async () => {
    const { h } = await openRelated();
    const list = h.byId("rh-search-years-from");
    if (!list) throw new Error("no year list");
    const span = h.byId(h.controller.spec["yearsSpan"] as string);
    const before = span?.getAttribute("data-l10n-args");
    const to = h.byId("rh-search-years-to");
    if (!to) throw new Error("no year list");
    // Both lists on a year, or the keyword path would return for its own reason.
    list.value = "2001";
    to.value = "2010";
    list.dispatch("command");
    expect(span?.getAttribute("data-l10n-args")).toBe(before);
    expect(h.controller.collectQuery()["fromYear"]).toBe(2001);
    expect(h.controller.collectQuery()["toYear"]).toBe(2010);
  });

  it("hides the screening row even when screening is on offer", async () => {
    const getPrefs = () => ({
      screeningThreshold: 45,
      screeningAvailable: true,
    });
    const { h } = await openRelated(SEED, { getPrefs });
    const row = h.controller.spec["screeningRow"] as string;
    expect(h.byId(row)?.hidden).toBe(true);

    const keyword = harness({
      host: { listSources: () => [PUBMED], getPrefs },
    });
    keyword.controller.init();
    expect(keyword.byId(row)?.hidden).toBe(false);
  });

  it("carries the seed and the ticked relations in the query, and only in this mode", async () => {
    const { h } = await openRelated();
    expect(h.controller.collectQuery()["related"]).toStrictEqual({
      seedItemID: 77,
      relations: [...SEARCH_WINDOW_RELATIONS],
    });
    const citation = h.byId("rh-related-include-citation");
    if (!citation) throw new Error("no citation box");
    citation.checked = false;
    expect(h.controller.collectQuery()["related"]).toStrictEqual({
      seedItemID: 77,
      relations: ["reference", "recommendation", "similar"],
    });

    const keyword = harness({ host: { listSources: () => [PUBMED] } });
    keyword.controller.init();
    expect(keyword.controller.collectQuery()).not.toHaveProperty("related");
  });

  it("titles the window for the mode, focuses the first Include box, and words the panel", async () => {
    const { h } = await openRelated();
    expect(h.doc.title).toBe(
      "value:research-helper-search-window-title-related",
    );
    expect(h.byId("rh-related-include-reference")?.focused).toBe(true);
    expect(h.byId(h.controller.spec.keyword)?.focused).not.toBe(true);
    expect(
      h
        .byId(h.controller.spec["initialProse"] as string)
        ?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-state-initial-related");
  });

  it("leaves the keyword mode as it was", async () => {
    const asked: unknown[] = [];
    let connects = 0;
    const h = harness({
      // A seed id in another mode's arguments is not a reason to read a seed.
      args: { mode: "keyword", seedItemID: 77 },
      host: {
        listSources: () => [PUBMED],
        connect: () => {
          connects += 1;
        },
        loadRelatedSeed: (id: unknown) => {
          asked.push(id);
          return Promise.resolve(SEED);
        },
      },
    });
    h.controller.init();
    await flush();
    expect(asked).toStrictEqual([]);
    expect(connects).toBe(1);
    expect(h.byId("rh-related-header")?.hidden).toBe(true);
    expect(h.byId(h.controller.spec.keyword)?.hidden).not.toBe(true);
    expect(h.byId(h.controller.spec.keyword)?.focused).toBe(true);
    expect(
      h.byId(h.controller.spec["mode"] as string)?.getAttribute("data-l10n-id"),
    ).toBe(h.controller.l10n["modeKeyword"]);
    expect(h.doc.title).toBe("value:research-helper-search-window-title");
    for (const id of ["rh-search-years-from", "rh-search-years-to"]) {
      const items = h.byId(id)?.firstElementChild?.children ?? [];
      expect(items.map((item) => item.getAttribute("value"))).not.toContain(
        "any",
      );
    }
  });
});

// ===========================================================================
// P5-T16 — related results (docs/08 §5.2's note of 2026-11-05)
//
// A fake `host.related` publishes hand-written states, so this block says what the
// document does with a state. `test/unit/ui/relatedViewModel.test.ts` is the other
// half.
// ===========================================================================

describe("P5-T16 — related results in the window", () => {
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  const ref = (id: string, args?: Record<string, unknown>) => ({ id, args });
  const CHIP_CITED = ref("research-helper-search-related-chip-cited-by-seed");

  /** A related row as the view model publishes it. */
  const record = (n: number, extra: Record<string, unknown> = {}) => ({
    key: `key-${String(n)}`,
    title: `Paper ${String(n)}`,
    authors: [{ family: `Author${String(n)}` }],
    year: 2020 + n,
    sourceLabels: [],
    typeLabel: "",
    doi: "",
    existing: false,
    startsTicked: true,
    related: {
      kinds: ["reference"],
      chips: [{ ref: CHIP_CITED }],
      dots: 3,
      scoreRef: ref("research-helper-search-related-score", { dots: 3 }),
      outsideWindow: false,
    },
    ...extra,
  });

  const LABELS = {
    reference: ref("research-helper-search-related-include-reference-count", {
      count: 37,
    }),
    citation: ref("research-helper-search-related-include-citation-count", {
      count: 58,
    }),
    recommendation: ref(
      "research-helper-search-related-include-recommendation-count",
      { count: 20 },
    ),
    similar: ref("research-helper-search-related-include-similar-count", {
      count: 25,
    }),
  };

  /** A whole state, with what the case under test overrides. */
  const stateOf = (extra: Record<string, unknown> = {}) => ({
    panel: "results",
    running: false,
    sources: [],
    records: [],
    recordsRevision: 1,
    emptyHeadline: undefined,
    error: undefined,
    warnings: [],
    notices: [],
    status: undefined,
    databaseProgress: undefined,
    progressPercent: undefined,
    cancelVisible: false,
    screening: undefined,
    ...extra,
    related: {
      candidates: [],
      keyRequestUrl: undefined,
      includeLabels: LABELS,
      ...(extra.related as object | undefined),
    },
  });

  /** Open the window in the related mode on a fake related host. */
  function open(related: Record<string, unknown> = {}) {
    const views: { render: (state: unknown) => void }[] = [];
    const calls = {
      run: [] as unknown[],
      pick: [] as unknown[],
      retry: 0,
      cancel: 0,
      detach: 0,
      keywordConnects: 0,
    };
    const h = harness({
      args: { mode: "related", seedItemID: 77 },
      prefs: { hideExisting: true },
      host: {
        listSources: () => [PUBMED, CROSSREF],
        connect: () => {
          calls.keywordConnects += 1;
        },
        loadRelatedSeed: () => Promise.resolve(undefined),
        related: {
          connect: (view: { render: (state: unknown) => void }) => {
            views.push(view);
            return () => {
              calls.detach += 1;
            };
          },
          run: (id: unknown) => {
            calls.run.push(id);
            return Promise.resolve();
          },
          pick: (key: unknown) => {
            calls.pick.push(key);
            return Promise.resolve();
          },
          retry: () => {
            calls.retry += 1;
            return Promise.resolve();
          },
          cancel: () => {
            calls.cancel += 1;
          },
          ...related,
        },
      },
    });
    h.controller.init();
    return {
      h,
      calls,
      publish: (state: unknown) => views[0]?.render(state),
      views,
    };
  }

  /** Open the window and draw these rows. */
  function drawn(records: unknown[], extra: Record<string, unknown> = {}) {
    const opened = open();
    opened.publish(stateOf({ records, ...extra }));
    const body = opened.h.byId("rh-results-body");
    const rows = body?.children ?? [];
    return { ...opened, rows };
  }

  /** The ticks on the drawn rows. */
  const ticks = (rows: readonly FakeElement[]) =>
    rows.map((row) => row.children[0]?.children[0]?.checked);

  it("connects the related model, never the keyword one, and starts the run by itself", async () => {
    const { calls, views } = open();
    await flush();
    expect(calls.keywordConnects).toBe(0);
    expect(views).toHaveLength(1);
    expect(calls.run).toStrictEqual([77]);
  });

  it("does nothing with no related host, and stays on the first panel", async () => {
    const h = harness({
      args: { mode: "related", seedItemID: 77 },
      host: {
        listSources: () => [PUBMED],
        loadRelatedSeed: () => Promise.resolve(undefined),
      },
    });
    h.controller.init();
    await flush();
    expect(h.controller.state.panel).toBe("initial");
    expect(h.controller.runRelated()).toBeUndefined();
    h.controller.search();
    h.controller.cancel();
    expect(h.controller.state.panel).toBe("initial");
  });

  it("does not run a related run in another mode", async () => {
    let runs = 0;
    const h = harness({
      args: { mode: "keyword" },
      host: {
        listSources: () => [PUBMED],
        connect: () => undefined,
        related: {
          connect: () => {
            throw new Error("not this one");
          },
          run: () => {
            runs += 1;
            return Promise.resolve();
          },
        },
      },
    });
    h.controller.init();
    await flush();
    expect(runs).toBe(0);
  });

  it("releases the related model when the window closes", () => {
    const { h, calls } = open();
    h.controller.disconnectHost();
    expect(calls.detach).toBe(1);
  });

  it("swaps Source, Type and DOI for Relation and Score, in the header", async () => {
    const { h } = open();
    for (const id of [
      "rh-results-col-source",
      "rh-results-col-type",
      "rh-results-col-doi",
    ]) {
      expect(h.byId(id)?.hidden, id).toBe(true);
    }
    const relation = h.byId("rh-results-col-relation");
    const score = h.byId("rh-results-col-score");
    expect(relation?.name).toBe("th");
    expect(relation?.getAttribute("scope")).toBe("col");
    expect(relation?.className).toBe("rh-col-relation");
    expect(score?.className).toBe("rh-col-score");
    await h.controller.applyColumnLabels();
    expect(relation?.textContent).toBe(
      "label:research-helper-search-related-col-relation",
    );
    expect(score?.textContent).toBe(
      "label:research-helper-search-related-col-score",
    );
  });

  it("leaves every other mode's header as the markup's seven", async () => {
    const h = harness({ args: { mode: "keyword" } });
    h.controller.init();
    await h.controller.applyColumnLabels();
    expect(h.byId("rh-results-col-relation")).toBeUndefined();
    expect(h.byId("rh-results-col-source")?.hidden).toBe(false);
  });

  it("draws chips in the Relation cell and dots in the Score cell, in place of the last three", () => {
    const { rows } = drawn([
      record(1, {
        related: {
          kinds: ["reference", "citation"],
          chips: [
            { ref: ref("research-helper-search-related-chip-cites-seed") },
            {
              ref: ref("research-helper-search-related-chip-similar", {
                value: "0.81",
              }),
            },
          ],
          dots: 4,
          scoreRef: ref("research-helper-search-related-score", { dots: 4 }),
          outsideWindow: false,
        },
      }),
    ]);
    const cells = rows[0]?.children ?? [];
    expect(cells.map((cell) => cell.className)).toStrictEqual([
      "rh-col-select",
      "rh-col-title",
      "rh-col-authors",
      "rh-col-year",
      "rh-col-relation",
      "rh-col-score",
    ]);
    const chips = cells[4]?.children ?? [];
    expect(
      chips.map((chip) => chip.getAttribute("data-l10n-id")),
    ).toStrictEqual([
      "research-helper-search-related-chip-cites-seed",
      "research-helper-search-related-chip-similar",
    ]);
    expect(chips[0]?.className).toBe("rh-source-line");
    expect(chips[0]?.getAttribute("data-l10n-args")).toBeNull();
    expect(chips[1]?.getAttribute("data-l10n-args")).toBe('{"value":"0.81"}');

    const dots = cells[5]?.children[0];
    expect(dots?.textContent).toBe("\u25cf\u25cf\u25cf\u25cf\u25cb");
    expect(dots?.getAttribute("role")).toBe("img");
    expect(dots?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-related-score",
    );
    expect(dots?.getAttribute("data-l10n-args")).toBe('{"dots":4}');
  });

  it("draws no dots for a row with no reason to show", () => {
    const { rows } = drawn([
      record(1, {
        related: {
          kinds: ["reference"],
          chips: [],
          dots: 0,
          scoreRef: undefined,
          outsideWindow: false,
        },
      }),
    ]);
    expect(rows[0]?.children[5]?.children).toHaveLength(0);
    expect(rows[0]?.children[5]?.textContent).toBe("");
  });

  it("writes a citation context as plain text, never as a message argument or as markup", () => {
    const context = 'as shown <img src="x" onerror="alert(1)"> &amp; here';
    const { rows } = drawn([
      record(1, {
        related: {
          kinds: ["citation"],
          chips: [
            {
              ref: ref("research-helper-search-related-chip-context-label"),
              text: context,
            },
          ],
          dots: 1,
          scoreRef: ref("research-helper-search-related-score", { dots: 1 }),
          outsideWindow: false,
        },
      }),
    ]);
    const line = rows[0]?.children[4]?.children[0];
    expect(line?.className).toBe("rh-related-context");
    const [label, text] = line?.children ?? [];
    // The label is a message with no argument at all.
    expect(label?.className).toBe("rh-related-context-label");
    expect(label?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-related-chip-context-label",
    );
    expect(label?.getAttribute("data-l10n-args")).toBeNull();
    // The words are plain text: no message, no argument, no child element.
    expect(text?.textContent).toBe(context);
    expect(text?.children).toHaveLength(0);
    expect(text?.getAttribute("data-l10n-id")).toBeNull();
    expect(text?.getAttribute("data-l10n-args")).toBeNull();
    // And the whole of it in the tooltip, as an attribute's value.
    expect(line?.getAttribute("title")).toBe(context);
    expect(line?.getAttribute("data-l10n-args")).toBeNull();
  });

  it("starts each row's tick from startsTicked", () => {
    const { rows, h } = drawn([
      record(1),
      record(2, { startsTicked: false, existing: true }),
      record(3, { startsTicked: false }),
    ]);
    expect(ticks(rows)).toStrictEqual([true, false, false]);
    expect(h.controller.state.selection).toStrictEqual(["key-1"]);
  });

  it("marks a library row with the same words as a keyword search's", () => {
    const { rows } = drawn([
      record(1, { startsTicked: false, existing: true }),
    ]);
    expect(rows[0]?.className).toContain("rh-row-existing");
    const title = rows[0]?.children[1];
    expect(title?.children[1]?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-row-existing",
    );
  });

  it("greys an out-of-window row and leaves every other row alone", () => {
    const { rows } = drawn([
      record(1),
      record(2, {
        startsTicked: false,
        related: {
          kinds: ["reference"],
          chips: [
            { ref: CHIP_CITED },
            { ref: ref("research-helper-search-related-chip-outside-window") },
          ],
          dots: 1,
          scoreRef: ref("research-helper-search-related-score", { dots: 1 }),
          outsideWindow: true,
        },
      }),
    ]);
    expect(rows[0]?.className).not.toContain("rh-row-outside-window");
    expect(rows[1]?.className).toContain("rh-row-outside-window");
    // In words as well as in grey (NFR-13).
    expect(
      rows[1]?.children[4]?.children[1]?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-related-chip-outside-window");
  });

  it("starts the hide-existing box off, whatever the preference says, and writes nothing", () => {
    const { rows, h } = drawn([record(1, { existing: true })]);
    expect(h.byId("rh-search-hide-existing")?.checked).toBe(false);
    expect(rows).toHaveLength(1);
    const hide = h.byId("rh-search-hide-existing");
    if (hide) hide.checked = true;
    expect(h.controller.applyFilter().total).toBe(0);
  });

  describe("P5-T17 — importing from the window", () => {
    /** The window with rows drawn and a recording import. */
    function importing(records: unknown[] = [record(1), record(2)]) {
      const asked: unknown[] = [];
      const keyword: unknown[] = [];
      const opened = open({
        importRows: (request: unknown) => {
          asked.push(request);
          return Promise.resolve();
        },
      });
      (opened.h.controller.host as Record<string, unknown>).runImport = (
        request: unknown,
      ) => keyword.push(request);
      opened.publish(stateOf({ records }));
      return { ...opened, asked, keyword };
    }
    const target = (h: Harness, value: string) => {
      const list = h.byId("rh-search-target");
      if (list) list.value = value;
    };

    it("turns the button on once a row is ticked, and off with none", () => {
      const { h } = importing();
      expect(h.controller.state.selectedCount).toBe(2);
      expect(h.controller.refreshImportGate()).toBe(true);
      expect(
        h.byId("rh-search-dialog")?.getAttribute("buttondisabledaccept"),
      ).toBe("false");
      const none = importing([record(1, { startsTicked: false })]);
      expect(none.h.controller.refreshImportGate()).toBe(false);
      none.h.controller.import();
      expect(none.asked).toStrictEqual([]);
    });

    it("hands the model the ticked rows by key, the picker and the box, never the keyword road", () => {
      const { h, asked, keyword } = importing([
        record(1),
        record(2, { startsTicked: false }),
        record(3),
      ]);
      target(h, "new:Target");
      const box = h.byId("rh-related-link-seed");
      if (box) box.checked = true;
      h.controller.import();
      expect(asked).toStrictEqual([
        {
          keys: ["key-1", "key-3"],
          collectionID: "new:Target",
          linkToSeed: true,
        },
      ]);
      expect(keyword).toStrictEqual([]);
    });

    it("reads the box as it is now", () => {
      const { h, asked } = importing();
      target(h, "12");
      const box = h.byId("rh-related-link-seed");
      if (box) box.checked = false;
      h.controller.import();
      expect(asked).toStrictEqual([
        { keys: ["key-1", "key-2"], collectionID: "12", linkToSeed: false },
      ]);
    });

    it("takes only the visible rows", () => {
      const { h, asked } = importing([
        record(1, {
          related: { ...record(1).related, kinds: ["reference"] },
        }),
        record(2, {
          related: { ...record(2).related, kinds: ["citation"] },
        }),
      ]);
      const include = h.byId("rh-related-include-citation");
      if (include) include.checked = false;
      h.controller.applyFilter();
      target(h, "12");
      h.controller.import();
      expect((asked[0] as { keys: string[] }).keys).toStrictEqual(["key-1"]);
    });

    it("imports on Enter, as the button does", () => {
      const { h, asked } = importing();
      target(h, "12");
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      expect(asked).toHaveLength(1);
    });

    it("asks for a name on bare “New collection…”, and sends nothing when dismissed (item 358(b))", () => {
      const { h, asked } = importing();
      target(h, "new");
      let prompts = 0;
      h.controller.promptForCollectionName = () => {
        prompts += 1;
        return prompts === 1 ? "" : "Named here";
      };
      h.controller.import();
      expect(prompts).toBe(1);
      expect(asked).toStrictEqual([]);
      h.controller.import();
      expect(prompts).toBe(2);
      expect(
        (asked[0] as { collectionID: unknown } | undefined)?.collectionID,
      ).toBe("new:Named here");
    });

    it("reaches no import with no related host", () => {
      const { h, publish } = open({});
      publish(stateOf({ records: [record(1)] }));
      delete (h.controller.host as Record<string, unknown>).related;
      expect(() => {
        h.controller.import();
      }).not.toThrow();
    });

    it("offers no Export after a related import, whose summary is in the notices", () => {
      const { h, publish } = importing();
      publish(
        stateOf({
          records: [record(1)],
          notices: [ref("research-helper-import-summary")],
        }),
      );
      expect(h.byId("rh-search-export")?.hidden).toBe(true);
      expect(h.controller.state.exportAvailable).toBe(false);
    });

    it("hides the radios and keeps the sentence about a preprint", () => {
      const { h } = importing();
      expect(h.byId("rh-search-duplicates")?.hidden).toBe(true);
      expect(h.byId("rh-search-duplicates-label")?.hidden).toBe(true);
      expect(h.byId("rh-search-preprint-policy")?.hidden).not.toBe(true);
    });

    it("starts the box from the preference and writes nothing back", () => {
      const seen = (value: boolean) => {
        let reads = 0;
        const { h } = (() => {
          const made = open({
            linkToSeedDefault: () => {
              reads += 1;
              return value;
            },
          });
          return made;
        })();
        return { h, reads };
      };
      const on = seen(true);
      expect(on.h.byId("rh-related-link-seed")?.hidden).toBe(false);
      expect(on.h.byId("rh-related-link-seed")?.checked).toBe(true);
      expect(on.reads).toBe(1);
      const off = seen(false);
      expect(off.h.byId("rh-related-link-seed")?.checked).toBe(false);
      expect(off.h.byId("rh-related-link-seed")?.hidden).toBe(false);
    });

    it("leaves the box unticked with no related host to ask", () => {
      const h = harness({
        args: { mode: "related", seedItemID: 77 },
        host: { listSources: () => [PUBMED] },
      });
      h.controller.init();
      expect(h.byId("rh-related-link-seed")?.checked).toBe(false);
    });

    it("keeps the box hidden and the radios on in the keyword window", () => {
      const h = harness({ host: { listSources: () => [PUBMED] } });
      h.controller.init();
      expect(h.byId("rh-related-link-seed")?.hidden).toBe(true);
      expect(h.byId("rh-search-duplicates")?.hidden).not.toBe(true);
    });

    describe("the default target", () => {
      const SEED = { title: "A seed", authors: [] };
      async function opened(
        seed: unknown,
        options: Parameters<typeof harness>[0] = {},
      ) {
        const asked: unknown[] = [];
        const h = harness({
          args: { mode: "related", seedItemID: 77 },
          formatMessages: (requests) => {
            asked.push(...requests);
            return Promise.resolve(
              requests.map((request) => ({
                value:
                  request.id === "research-helper-search-related-target-default"
                    ? "Related to “\u2068A seed\u2069”"
                    : `value:${request.id}`,
                attributes: [],
              })),
            );
          },
          ...options,
          host: {
            listSources: () => [PUBMED],
            loadRelatedSeed: () => Promise.resolve(seed),
          },
        });
        h.controller.init();
        await flush();
        await flush();
        return { h, asked };
      }

      it("names a new collection after the seed, without Fluent's isolation marks", async () => {
        const { h, asked } = await opened(SEED);
        expect(h.byId("rh-search-target")?.value).toBe(
          "new:Related to “A seed”",
        );
        expect(asked).toContainEqual({
          id: "research-helper-search-related-target-default",
          args: { title: "A seed" },
        });
      });

      it("cuts a long title as the chip cuts it", async () => {
        const long = "t".repeat(90);
        const { asked } = await opened({ ...SEED, title: long });
        const request = (
          asked as { id: string; args?: { title: string } }[]
        ).find(
          (one) => one.id === "research-helper-search-related-target-default",
        );
        expect(request?.args?.title).toBe(`${"t".repeat(60)}…`);
      });

      it("stays on bare New collection with no seed to name it after", async () => {
        const { h } = await opened(undefined);
        expect(h.byId("rh-search-target")?.value).toBe("new");
      });

      it("stays on bare New collection for a seed with no title", async () => {
        const { h, asked } = await opened({ ...SEED, title: "" });
        expect(h.byId("rh-search-target")?.value).toBe("new");
        expect(asked).not.toContainEqual(
          expect.objectContaining({
            id: "research-helper-search-related-target-default",
          }),
        );
      });

      it("leaves a collection already chosen alone", async () => {
        let answer: (value: unknown) => void = () => undefined;
        const h = harness({
          args: { mode: "related", seedItemID: 77 },
          host: {
            listSources: () => [PUBMED],
            loadRelatedSeed: () =>
              new Promise((resolve) => {
                answer = resolve;
              }),
          },
        });
        h.controller.init();
        const list = h.byId("rh-search-target");
        if (list) list.value = "12";
        answer(SEED);
        await flush();
        await flush();
        expect(list?.value).toBe("12");
      });

      it("leaves a name the user gave while the bundle was answering alone", async () => {
        let word: (value: FakeL10nMessage[]) => void = () => undefined;
        const h = harness({
          args: { mode: "related", seedItemID: 77 },
          formatMessages: (requests) =>
            requests.some(
              (one) =>
                one.id === "research-helper-search-related-target-default",
            )
              ? new Promise<readonly FakeL10nMessage[]>((resolve) => {
                  word = resolve;
                })
              : Promise.resolve(
                  requests.map(() => ({ value: "x", attributes: [] })),
                ),
          host: {
            listSources: () => [PUBMED],
            loadRelatedSeed: () => Promise.resolve(SEED),
          },
        });
        h.controller.init();
        await flush();
        await flush();
        const list = h.byId("rh-search-target");
        if (list) list.value = "new:Mine";
        word([{ value: "Related to “A seed”", attributes: [] }]);
        await flush();
        expect(list?.value).toBe("new:Mine");
      });
    });
  });

  describe("the Include boxes and the year lists filter the rows already fetched", () => {
    const FOUR = () => [
      record(1, {
        year: 2010,
        related: { ...record(1).related, kinds: ["reference"] },
      }),
      record(2, {
        year: 2020,
        related: { ...record(2).related, kinds: ["citation", "similar"] },
      }),
      record(3, {
        year: 2024,
        related: { ...record(3).related, kinds: ["recommendation"] },
      }),
      (() => {
        const { year: _year, ...undated } = record(4, {
          related: { ...record(4).related, kinds: ["similar"] },
        });
        return undated;
      })(),
    ];
    const shown = (h: Harness) =>
      h.controller.state.visible.map((row: { key: string }) => row.key);

    it("shows every row with all boxes ticked and both lists on Any", () => {
      const { h } = drawn(FOUR());
      expect(shown(h)).toHaveLength(4);
    });

    it("hides a row only when none of its kinds is ticked, and runs nothing", async () => {
      const { h, calls } = drawn(FOUR());
      await flush();
      const box = h.byId("rh-related-include-citation");
      if (!box) throw new Error("no box");
      box.checked = false;
      box.dispatch("command");
      expect(shown(h)).toStrictEqual(["key-1", "key-2", "key-3", "key-4"]);
      const similar = h.byId("rh-related-include-similar");
      if (!similar) throw new Error("no box");
      similar.checked = false;
      similar.dispatch("command");
      expect(shown(h)).toStrictEqual(["key-1", "key-3"]);
      expect(calls.run).toHaveLength(1);
      expect(calls.retry).toBe(0);
    });

    it("binds all four boxes", () => {
      const { h } = drawn(FOUR());
      for (const [id, key] of [
        ["rh-related-include-reference", "key-1"],
        ["rh-related-include-recommendation", "key-3"],
      ] as const) {
        const box = h.byId(id);
        if (!box) throw new Error(id);
        box.checked = false;
        box.dispatch("command");
        expect(shown(h)).not.toContain(key);
      }
    });

    it("keeps a filtered row's tick", () => {
      const { h } = drawn(FOUR());
      const box = h.byId("rh-related-include-reference");
      if (!box) throw new Error("no box");
      box.checked = false;
      box.dispatch("command");
      expect(h.controller.state.selection).toContain("key-1");
      box.checked = true;
      box.dispatch("command");
      expect(shown(h)).toContain("key-1");
    });

    it("applies a year bound to a row with a year, and keeps an undated row", () => {
      const { h } = drawn(FOUR());
      const from = h.byId("rh-search-years-from");
      const to = h.byId("rh-search-years-to");
      if (!from || !to) throw new Error("no lists");
      from.value = "2015";
      from.dispatch("command");
      expect(shown(h)).toStrictEqual(["key-2", "key-3", "key-4"]);
      to.value = "2020";
      to.dispatch("command");
      expect(shown(h)).toStrictEqual(["key-2", "key-4"]);
      from.value = "any";
      from.dispatch("command");
      expect(shown(h)).toStrictEqual(["key-1", "key-2", "key-4"]);
      to.value = "any";
      to.dispatch("command");
      expect(shown(h)).toHaveLength(4);
    });

    it("includes a row exactly on either bound", () => {
      const { h } = drawn(FOUR());
      const from = h.byId("rh-search-years-from");
      const to = h.byId("rh-search-years-to");
      if (!from || !to) throw new Error("no lists");
      from.value = "2020";
      to.value = "2020";
      from.dispatch("command");
      expect(shown(h)).toContain("key-2");
    });

    it("leaves a row of another mode alone", () => {
      const { controller } = harness();
      const logic = controller.logic;
      expect(
        logic.matchesRelatedFilter(
          { year: "2020" },
          { relations: [], fromYear: 2030, toYear: 2031 },
        ),
      ).toBe(true);
      expect(
        logic.matchesRelatedFilter(
          { year: "2020", related: { kinds: [] } },
          {},
        ),
      ).toBe(true);
    });
  });

  it("labels the Include boxes from the state, id and count together", () => {
    const { h, publish } = open();
    publish(stateOf({ records: [] }));
    const expected = {
      "rh-related-include-reference": LABELS.reference,
      "rh-related-include-citation": LABELS.citation,
      "rh-related-include-recommendation": LABELS.recommendation,
      "rh-related-include-similar": LABELS.similar,
    };
    for (const [id, label] of Object.entries(expected)) {
      const box = h.byId(id);
      expect(box?.getAttribute("data-l10n-id"), id).toBe(label.id);
      expect(box?.getAttribute("data-l10n-args"), id).toBe(
        JSON.stringify(label.args),
      );
    }
  });

  it("goes back to the bare labels with no stale count", () => {
    const { h, publish } = open();
    publish(stateOf());
    publish(
      stateOf({
        related: {
          includeLabels: {
            ...LABELS,
            reference: ref("research-helper-search-related-include-reference"),
          },
        },
      }),
    );
    const box = h.byId("rh-related-include-reference");
    expect(box?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-related-include-reference",
    );
    expect(box?.getAttribute("data-l10n-args")).toBeNull();
  });

  it("does not touch the Include boxes in a state with no related part", () => {
    const { h, publish } = open();
    const box = h.byId("rh-related-include-reference");
    const before = box?.getAttribute("data-l10n-id");
    publish({ panel: "initial", sources: [], warnings: [], notices: [] });
    expect(box?.getAttribute("data-l10n-id")).toBe(before);
  });

  describe("the run's key notice", () => {
    it("is hidden until the run says so, with no address in it", () => {
      const { h, publish } = open();
      publish(stateOf());
      expect(h.byId("rh-related-key-notice")?.hidden).toBe(true);
      expect(h.byId("rh-related-key-request")?.getAttribute("href")).toBeNull();
    });

    it("shows the link the run gave, and opens it outside the window", () => {
      const { h, publish } = open();
      publish(stateOf({ related: { keyRequestUrl: "https://example.org/k" } }));
      expect(h.byId("rh-related-key-notice")?.hidden).toBe(false);
      const link = h.byId("rh-related-key-request");
      expect(link?.getAttribute("href")).toBe("https://example.org/k");
      const prevented = vi.fn();
      link?.dispatch("click", { preventDefault: prevented });
      expect(prevented).toHaveBeenCalledOnce();
      expect(h.launched).toStrictEqual(["https://example.org/k"]);
    });

    it("hides again when a later run had a key", () => {
      const { h, publish } = open();
      publish(stateOf({ related: { keyRequestUrl: "https://example.org/k" } }));
      publish(stateOf());
      expect(h.byId("rh-related-key-notice")?.hidden).toBe(true);
      expect(h.byId("rh-related-key-request")?.getAttribute("href")).toBeNull();
    });
  });

  describe("per-list status rows", () => {
    const LINES = [
      {
        sourceId: "s2-citations",
        nameId: "research-helper-search-related-generator-s2-citations",
        outcome: "succeeded",
        detail: ref("research-helper-search-related-source-no-key"),
      },
      {
        sourceId: "pmra",
        nameId: "research-helper-search-related-generator-pmra",
        outcome: "failed",
        detail: ref("research-helper-search-related-source-failed", {
          code: "PARSE",
        }),
      },
    ];

    it("draws one row per list in the header, not in the hidden panel", () => {
      const { h, publish } = open();
      expect(h.byId("rh-related-status")?.hidden).toBe(true);
      publish(stateOf({ sources: LINES }));
      const host = h.byId("rh-related-status");
      expect(host?.hidden).toBe(false);
      expect(host?.children.map((row) => row.id)).toStrictEqual([
        "rh-related-status-s2-citations",
        "rh-related-status-pmra",
      ]);
      expect(host?.children[0]?.children[0]?.getAttribute("data-l10n-id")).toBe(
        LINES[0]?.nameId,
      );
      expect(host?.children[1]?.children[1]?.className).toBe(
        "rh-inline-warning",
      );
      expect(h.byId("rh-search-source-status")?.children).toHaveLength(0);
    });

    it("clears them for a new run", () => {
      const { h, publish } = open();
      publish(stateOf({ sources: LINES }));
      publish(stateOf({ sources: [] }));
      expect(h.byId("rh-related-status")?.hidden).toBe(true);
      expect(h.byId("rh-related-status")?.children).toHaveLength(0);
    });
  });

  it("hides the keyword panel's advice, and shows its own empty line", () => {
    const { h, publish } = open();
    expect(h.byId("rh-state-empty-suggestions")?.hidden).toBe(true);
    publish(
      stateOf({
        panel: "empty",
        emptyHeadline: ref("research-helper-search-related-state-empty"),
      }),
    );
    expect(h.controller.state.panel).toBe("empty");
    expect(
      h.byId("rh-state-empty-headline")?.getAttribute("data-l10n-id"),
    ).toBe("research-helper-search-related-state-empty");
  });

  it("keeps the keyword panel's advice in every other mode", () => {
    const h = harness({ args: { mode: "keyword" } });
    h.controller.init();
    expect(h.byId("rh-state-empty-suggestions")?.hidden).toBe(false);
  });

  it("shows no export control for a related run", () => {
    const { h, publish } = open();
    publish(stateOf({ records: [record(1)] }));
    expect(h.byId("rh-search-export")?.hidden).toBe(true);
  });

  describe("Retry and Cancel", () => {
    it("Retry repeats the related run and never a keyword search", () => {
      const searches: unknown[] = [];
      const { h, calls, publish } = open();
      (h.controller.host as Record<string, unknown>).runSearch = (
        q: unknown,
      ) => {
        searches.push(q);
        return Promise.resolve();
      };
      publish(
        stateOf({
          panel: "error",
          error: {
            headline: ref("research-helper-search-state-error"),
            lines: [],
            details: [],
            retry: true,
            openPreferences: false,
          },
        }),
      );
      h.byId("rh-state-error-retry")?.dispatch("command");
      expect(calls.retry).toBe(1);
      expect(searches).toStrictEqual([]);
    });

    it("Cancel and the first Escape reach the related model", () => {
      const { h, calls, publish } = open();
      publish(stateOf({ running: true, cancelVisible: true }));
      h.byId("rh-search-cancel")?.dispatch("command");
      expect(calls.cancel).toBe(1);
      publish(stateOf({ running: true, cancelVisible: true }));
      const preventDefault = vi.fn();
      h.doc.dispatch("dialogcancel", { preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(calls.cancel).toBe(2);
    });
  });

  describe("FR-14's title-match list", () => {
    const CANDIDATES = [
      {
        key: "key-a",
        title: "A <b>bold</b> title",
        authors: [{ family: "Ito" }],
        venue: "Nature",
        year: 2021,
        doi: "10.1/a",
      },
      { key: "key-b", title: "Another", authors: [] },
    ];
    const asking = () =>
      stateOf({ panel: "choose", related: { candidates: CANDIDATES } });

    it("shows the panel with nothing chosen and the button off", () => {
      const { h, publish } = open();
      publish(asking());
      expect(h.controller.state.panel).toBe("choose");
      expect(h.byId("rh-state-related-choose")?.hidden).toBe(false);
      expect(h.byId("rh-results-container")?.hidden).toBe(true);
      const list = h.byId("rh-related-picker-list");
      expect(list?.children).toHaveLength(2);
      const radio = list?.children[0]?.children[0];
      expect(radio?.getAttribute("type")).toBe("radio");
      expect(radio?.getAttribute("value")).toBe("key-a");
      expect(radio?.checked).toBeFalsy();
      // One name across the list is what makes the browser keep one choice.
      expect(radio?.getAttribute("name")).toBe("rh-related-picker-list");
      expect(list?.children[1]?.children[0]?.getAttribute("name")).toBe(
        "rh-related-picker-list",
      );
      expect(h.byId("rh-related-picker-use")?.disabled).toBe(true);
    });

    it("draws a candidate's words as data", () => {
      const { h, publish } = open();
      publish(asking());
      const [first, second] = h.byId("rh-related-picker-list")?.children ?? [];
      const title = first?.children[1];
      expect(title?.textContent).toBe("A <b>bold</b> title");
      expect(title?.children).toHaveLength(0);
      expect(title?.getAttribute("data-l10n-id")).toBeNull();
      expect(first?.children[2]?.textContent).toBe(
        "Ito · Nature · 2021 · 10.1/a",
      );
      expect(second?.children[2]?.textContent).toBe("");
    });

    it("sends nothing until one is chosen, then sends that one", () => {
      const { h, calls, publish } = open();
      publish(asking());
      const use = h.byId("rh-related-picker-use");
      use?.dispatch("command");
      expect(calls.pick).toStrictEqual([]);

      h.byId("rh-related-picker-list")?.children[1]?.children[0]?.dispatch(
        "change",
      );
      expect(use?.disabled).toBe(false);
      use?.dispatch("command");
      expect(calls.pick).toStrictEqual(["key-b"]);
    });

    it("keeps the choice through a redraw of the same list", () => {
      const { h, publish } = open();
      const state = asking();
      publish(state);
      const list = h.byId("rh-related-picker-list");
      const radio = list?.children[0]?.children[0];
      radio?.dispatch("change");
      publish(state);
      expect(list?.children[0]?.children[0]).toBe(radio);
      expect(h.byId("rh-related-picker-use")?.disabled).toBe(false);
    });

    it("empties the list and turns the button off when the run moves on", () => {
      const { h, publish } = open();
      publish(asking());
      h.byId("rh-related-picker-list")?.children[0]?.children[0]?.dispatch(
        "change",
      );
      publish(stateOf());
      expect(h.byId("rh-related-picker-list")?.children).toHaveLength(0);
      expect(h.byId("rh-related-picker-use")?.disabled).toBe(true);
      expect(h.controller.state.relatedPick).toBeNull();
    });
  });

  it("draws the dots with bounds, for any count the document is given", () => {
    const { logic } = harness().controller;
    expect(logic.dotsText(0)).toBe("\u25cb\u25cb\u25cb\u25cb\u25cb");
    expect(logic.dotsText(5)).toBe("\u25cf\u25cf\u25cf\u25cf\u25cf");
    expect(logic.dotsText(9)).toBe("\u25cf\u25cf\u25cf\u25cf\u25cf");
    expect(logic.dotsText(-1)).toBe("\u25cb\u25cb\u25cb\u25cb\u25cb");
    expect(logic.dotsText(undefined)).toBe("\u25cb\u25cb\u25cb\u25cb\u25cb");
  });

  it("keeps a keyword row's shape and ticks", () => {
    const { logic } = harness().controller;
    const rows = logic.rowsFromRecords([{ key: "k", title: "T" }], 3);
    expect(rows[0]).not.toHaveProperty("related");
    expect(rows[0]).not.toHaveProperty("startsTicked");
    expect(logic.selectionAfterResults(rows)).toStrictEqual(["k"]);
  });
});

describe("P5-T15 — relatedSeedHeader", () => {
  const WORK = {
    title: "A seed",
    authors: [
      { family: "Lovelace", given: "Ada", affiliation: "not for the window" },
      { family: "", literal: "The CRISPR Consortium" },
    ],
    containerTitle: "Nature",
    publishedDate: { year: 2021, month: 3 },
    ids: { doi: "10.1000/seed", pmid: "123" },
    abstract: "not for the window",
  } as unknown as CanonicalWork;

  it("carries the title, the authors' names, the venue, the year and the DOI, and only those", () => {
    expect(relatedSeedHeader(WORK)).toStrictEqual({
      title: "A seed",
      authors: [
        { family: "Lovelace", given: "Ada" },
        { family: "", literal: "The CRISPR Consortium" },
      ],
      venue: "Nature",
      year: 2021,
      doi: "10.1000/seed",
    });
  });

  it("leaves a missing venue, year and DOI out rather than undefined", () => {
    const bare = {
      title: "Bare",
      authors: [],
      ids: {},
    } as unknown as CanonicalWork;
    expect(Object.keys(relatedSeedHeader(bare))).toStrictEqual([
      "title",
      "authors",
    ]);
  });
});

describe('P5-T26: the window opened with mode: "recommend-from-collection"', () => {
  const ref = (id: string, args?: Record<string, unknown>) => ({ id, args });
  const HOSTILE = '<img src=x onerror="y">';

  const PROFILE = {
    focus: `Focus ${HOSTILE}`,
    terms: [
      {
        term: `term ${HOSTILE}`,
        added: false,
        removeRef: ref("research-helper-search-recommend-term-remove", {
          term: `term ${HOSTILE}`,
        }),
      },
    ],
    removed: [
      {
        term: "liver",
        restoreRef: ref("research-helper-search-recommend-term-restore", {
          term: "liver",
        }),
      },
    ],
    authors: [`Author ${HOSTILE} (2)`, "Cullis (1)"],
    venues: ["Nature (4)"],
    heuristic: ref("research-helper-search-recommend-heuristic"),
    egress: [
      ref("research-helper-search-recommend-egress-notice", {
        papers: 15,
        dismissed: 10,
        authors: 5,
      }),
      ref("research-helper-search-recommend-egress-sources"),
    ],
    queries: [`"query" ${HOSTILE}`],
  };

  const stateOf = (extra: Record<string, unknown> = {}) => ({
    panel: "initial",
    running: false,
    sources: [],
    records: undefined,
    recordsRevision: 0,
    emptyHeadline: undefined,
    error: undefined,
    warnings: [],
    notices: [],
    status: undefined,
    databaseProgress: undefined,
    progressPercent: undefined,
    cancelVisible: false,
    screening: undefined,
    recommend: {
      collectionName: "mRNA LNP",
      profile: undefined,
      canBuild: true,
      canFind: false,
      keyRequestUrl: undefined,
    },
    ...extra,
  });
  const withProfile = (profile: unknown = PROFILE) =>
    stateOf({
      recommend: {
        collectionName: "mRNA LNP",
        profile,
        canBuild: true,
        canFind: true,
        keyRequestUrl: undefined,
      },
    });

  function open(
    extraHost: Record<string, unknown> = {},
    options: Partial<HarnessOptions> = {},
  ) {
    const calls: unknown[][] = [];
    let view: { render(state: unknown): void } | undefined;
    const note =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        return Promise.resolve();
      };
    const recommend = {
      connect: (given: { render(state: unknown): void }) => {
        view = given;
        return () => {
          calls.push(["detach"]);
        };
      },
      open: (id: unknown) => {
        calls.push(["open", id]);
      },
      build: note("build"),
      find: note("find"),
      retry: note("retry"),
      removeTerm: note("removeTerm"),
      addTerm: note("addTerm"),
      restoreTerm: note("restoreTerm"),
      cancel: note("cancel"),
      dismiss: note("dismiss"),
      importRows: note("importRows"),
    };
    const keywordRuns: unknown[] = [];
    const h = harness({
      ...options,
      args: { mode: "recommend-from-collection", collectionID: 77 },
      host: {
        listSources: () => [PUBMED, CROSSREF],
        connect: () => {
          throw new Error("the keyword view model must not attach here");
        },
        runSearch: (query: unknown) => {
          keywordRuns.push(query);
          return Promise.resolve();
        },
        recommend,
        ...extraHost,
      },
    });
    h.controller.init();
    return {
      h,
      calls,
      keywordRuns,
      publish: (state: unknown) => {
        view?.render(state);
      },
    };
  }

  it("says which collection it is on and starts no run by itself", () => {
    const { calls, keywordRuns } = open();
    expect(calls).toStrictEqual([["open", 77]]);
    expect(keywordRuns).toStrictEqual([]);
  });

  it("is titled for this mode", async () => {
    const { h } = open();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.doc.title).toBe(
      "value:research-helper-search-window-title-recommend",
    );
  });

  it("shows its panel, and hides what a recommend run does not read", () => {
    const { h } = open();
    expect(h.byId("rh-recommend-header")?.hidden).toBe(false);
    for (const id of [
      "rh-search-keyword-label",
      SEARCH_WINDOW_KEYWORD_ID,
      "rh-search-run",
      "rh-search-scope-row",
      "rh-search-databases-group",
      "rh-state-empty-suggestions",
      "rh-search-duplicates-label",
      "rh-results-col-source",
      "rh-results-col-type",
      "rh-results-col-doi",
    ]) {
      expect(h.byId(id)?.hidden, id).toBe(true);
    }
    expect(h.byId("rh-search-mode")?.hidden).toBe(true);
    expect(h.byId("rh-search-filter")?.hidden).toBeFalsy();
    expect(h.byId("rh-related-header")?.hidden).toBe(true);
    expect(h.byId("rh-state-initial-prose")?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-state-initial-recommend",
    );
  });

  describe("the room while a profile shows and no table does (docs/08 §5.4, 2026-11-06)", () => {
    const ROWS = [
      "rh-search-filter-row",
      "rh-search-target-row",
      "rh-search-duplicates-group",
    ];
    const AREA = "rh-results-area";
    const RECORD = {
      key: "key-1",
      title: "Paper 1",
      authors: [{ family: "Author1" }],
      year: 2024,
      sourceLabels: [],
      typeLabel: "",
      doi: "",
      existing: false,
      startsTicked: true,
      recommended: true,
    };
    const withProfileOn = (extra: Record<string, unknown>) => ({
      ...withProfile(),
      ...extra,
    });
    const hiddenOf = (h: Harness, ids: readonly string[]) =>
      ids.map((id) => Boolean(h.byId(id)?.hidden));

    it("keeps everything in the opening state, with no profile yet", () => {
      const { h, publish } = open();
      publish(stateOf());
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        false,
        false,
        false,
        false,
      ]);
      expect(h.byId("rh-state-initial")?.hidden).toBe(false);
    });

    it("hides the rows and the placeholder once a profile shows, and keeps each value", () => {
      const { h, publish } = open();
      const filter = h.byId("rh-search-filter");
      const hide = h.byId("rh-search-hide-existing");
      const target = h.byId("rh-search-target");
      if (!filter || !hide || !target) throw new Error("no controls");
      filter.value = "lipid";
      hide.checked = true;
      target.value = "chosen";
      publish(withProfile());
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(filter.value).toBe("lipid");
      expect(hide.checked).toBe(true);
      expect(target.value).toBe("chosen");
      // Build profile again, and Find papers until a list answers: still no table.
      publish(withProfileOn({ running: true }));
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        true,
        true,
        true,
        true,
      ]);
    });

    it("brings them back as soon as a table shows, and gives the room again when it goes", () => {
      const { h, publish } = open();
      publish(withProfile());
      publish(
        withProfileOn({
          panel: "results",
          records: [RECORD],
          recordsRevision: 1,
        }),
      );
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        false,
        false,
        false,
        false,
      ]);
      expect(h.byId("rh-results-container")?.hidden).toBe(false);
      publish(withProfileOn({ records: [], recordsRevision: 2 }));
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        true,
        true,
        true,
        true,
      ]);
    });

    it("brings them back when the profile goes", () => {
      const { h, publish } = open();
      publish(withProfile());
      publish(stateOf());
      expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
        false,
        false,
        false,
        false,
      ]);
    });

    it.each(["empty", "error"])(
      "keeps the area for the %s panel, which has something to say",
      (panel) => {
        const { h, publish } = open();
        publish(withProfile());
        publish(withProfileOn({ panel }));
        expect(hiddenOf(h, ROWS)).toStrictEqual([true, true, true]);
        expect(h.byId(AREA)?.hidden).toBe(false);
        expect(h.byId(`rh-state-${panel}`)?.hidden).toBe(false);
      },
    );

    it("does nothing in the other modes", () => {
      for (const args of [{}, { mode: "related", seedItemID: 77 }]) {
        const h = harness({ args, host: { listSources: () => [PUBMED] } });
        h.controller.init();
        h.controller.render(withProfile());
        expect(hiddenOf(h, [...ROWS, AREA])).toStrictEqual([
          false,
          false,
          false,
          false,
        ]);
      }
    });

    it("takes the rule above each row away with the row, only when it is hidden", () => {
      expect(CSS_CODE).toMatch(
        /separator:has\(\+ #rh-search-filter-row\[hidden\]\),\s*separator:has\(\+ #rh-search-target-row\[hidden\]\) \{\s*display: none/,
      );
    });
  });

  it("starts the already-in-library box off, whatever the preference says", () => {
    const h = harness({
      args: { mode: "recommend-from-collection", collectionID: 77 },
      prefs: { hideExisting: true },
    });
    h.controller.init();
    expect(h.byId("rh-search-hide-existing")?.checked).toBe(false);
  });

  it("keeps its panel hidden in every other mode", () => {
    const h = harness({ args: { mode: "keyword" } });
    h.controller.init();
    expect(h.byId("rh-recommend-header")?.hidden).toBe(true);
    expect(h.byId(SEARCH_WINDOW_KEYWORD_ID)?.hidden).toBeFalsy();
  });

  it("focuses Build profile on open", () => {
    const { h } = open();
    expect(h.byId("rh-recommend-build")?.focused).toBe(true);
  });

  it("puts the name in the chip's attribute raw, since attributes are not parsed", () => {
    const { h, publish } = open();
    publish(
      stateOf({
        recommend: {
          collectionName: "A & <B>",
          profile: undefined,
          canBuild: true,
          canFind: false,
          keyRequestUrl: undefined,
        },
      }),
    );
    const chip = h.byId("rh-search-mode");
    expect(chip?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-mode-recommend",
    );
    expect(argsOf(chip)).toStrictEqual({ collection: "A & <B>" });
    expect(chip?.hidden).toBe(false);
  });

  it("hides the chip when the collection is not known", () => {
    const { h, publish } = open();
    publish(
      stateOf({
        recommend: {
          collectionName: undefined,
          profile: undefined,
          canBuild: false,
          canFind: false,
          keyRequestUrl: undefined,
        },
      }),
    );
    expect(h.byId("rh-search-mode")?.hidden).toBe(true);
  });

  it("keeps Find papers disabled and the panel hidden until a profile is shown", () => {
    const { h, publish } = open();
    publish(stateOf());
    expect(h.byId("rh-recommend-build")?.disabled).toBe(false);
    expect(h.byId("rh-recommend-find")?.disabled).toBe(true);
    expect(h.byId("rh-recommend-profile")?.hidden).toBe(true);

    publish(withProfile());
    expect(h.byId("rh-recommend-find")?.disabled).toBe(false);
    expect(h.byId("rh-recommend-profile")?.hidden).toBe(false);
  });

  it("does not trust canFind without a profile", () => {
    const { h, publish } = open();
    publish(
      stateOf({
        recommend: {
          collectionName: "x",
          profile: undefined,
          canBuild: true,
          canFind: true,
          keyRequestUrl: undefined,
        },
      }),
    );
    expect(h.byId("rh-recommend-find")?.disabled).toBe(true);
  });

  it("disables both buttons while a run goes, and Build starts it", () => {
    const { h, calls, publish } = open();
    h.byId("rh-recommend-build")?.dispatch("command");
    expect(calls).toContainEqual(["build"]);
    publish(
      stateOf({
        running: true,
        recommend: {
          collectionName: "x",
          profile: PROFILE,
          canBuild: false,
          canFind: false,
          keyRequestUrl: undefined,
        },
      }),
    );
    expect(h.byId("rh-recommend-build")?.disabled).toBe(true);
    expect(h.byId("rh-recommend-find")?.disabled).toBe(true);
  });

  it("Find papers starts the run, with the notice already on screen", () => {
    const { h, calls, publish } = open();
    publish(withProfile());
    const notice = h.byId("rh-recommend-egress");
    expect(notice?.hidden).toBe(false);
    expect(
      notice?.children.map((line) => line.getAttribute("data-l10n-id")),
    ).toStrictEqual([
      "research-helper-search-recommend-egress-notice",
      "research-helper-search-recommend-egress-sources",
    ]);
    expect(argsOf(notice?.children[0])).toStrictEqual({
      papers: 15,
      dismissed: 10,
      authors: 5,
    });
    expect(calls.map(([name]) => name)).not.toContain("find");
    h.byId("rh-recommend-find")?.dispatch("command");
    expect(calls.map(([name]) => name)).toContain("find");
  });

  it("writes the profile's words as text, in no Fluent argument", () => {
    const { h, publish } = open();
    publish(withProfile());
    expect(h.byId("rh-recommend-focus")?.textContent).toBe(PROFILE.focus);
    expect(h.byId("rh-recommend-authors")?.textContent).toBe(
      `Author ${HOSTILE} (2) · Cullis (1)`,
    );
    expect(h.byId("rh-recommend-venues")?.textContent).toBe("Nature (4)");
    const [query] = h.byId("rh-recommend-queries")?.children ?? [];
    expect(query?.textContent).toBe(PROFILE.queries[0]);
    expect(query?.getAttribute("data-l10n-args")).toBeNull();
    const [chip] = h.byId("rh-recommend-terms")?.children ?? [];
    expect(chip?.className).toBe("rh-recommend-chip");
    expect(chip?.children[0]?.textContent).toBe(PROFILE.terms[0]?.term);
    expect(chip?.children[0]?.getAttribute("data-l10n-id")).toBeNull();
  });

  it("gives a chip's button the term in its message's raw arguments, and removes by term", () => {
    const { h, calls, publish } = open();
    publish(withProfile());
    const [chip] = h.byId("rh-recommend-terms")?.children ?? [];
    const button = chip?.children[1];
    expect(button?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-recommend-term-remove",
    );
    expect(argsOf(button)).toStrictEqual({ term: PROFILE.terms[0]?.term });
    button?.dispatch("click");
    expect(calls).toContainEqual(["removeTerm", PROFILE.terms[0]?.term]);
    expect(h.byId("rh-recommend-term-input")?.focused).toBe(true);
  });

  it("draws the Removed line only with something on it, and puts back by term", () => {
    const { h, calls, publish } = open();
    publish(withProfile());
    expect(h.byId("rh-recommend-removed-row")?.hidden).toBe(false);
    const [chip] = h.byId("rh-recommend-removed")?.children ?? [];
    expect(chip?.children[0]?.textContent).toBe("liver");
    chip?.children[1]?.dispatch("click");
    expect(calls).toContainEqual(["restoreTerm", "liver"]);

    publish(withProfile({ ...PROFILE, removed: [] }));
    expect(h.byId("rh-recommend-removed-row")?.hidden).toBe(true);
    expect(h.byId("rh-recommend-removed")?.children).toHaveLength(0);
  });

  it("leaves out a focus, authors or venues the profile does not have, and the heuristic line of a model's", () => {
    const { h, publish } = open();
    publish(
      withProfile({
        ...PROFILE,
        focus: undefined,
        authors: [],
        venues: [],
        heuristic: undefined,
      }),
    );
    expect(h.byId("rh-recommend-focus-row")?.hidden).toBe(true);
    expect(h.byId("rh-recommend-authors-row")?.hidden).toBe(true);
    expect(h.byId("rh-recommend-venues-row")?.hidden).toBe(true);
    expect(h.byId("rh-recommend-heuristic")?.hidden).toBe(true);
  });

  it("shows the heuristic notice", () => {
    const { h, publish } = open();
    publish(withProfile());
    const line = h.byId("rh-recommend-heuristic");
    expect(line?.hidden).toBe(false);
    expect(line?.getAttribute("data-l10n-id")).toBe(
      "research-helper-search-recommend-heuristic",
    );
  });

  it("says so when every query is gone", () => {
    const { h, publish } = open();
    publish(withProfile());
    expect(h.byId("rh-recommend-queries-none")?.hidden).toBe(true);
    publish(withProfile({ ...PROFILE, queries: [] }));
    expect(h.byId("rh-recommend-queries-none")?.hidden).toBe(false);
    expect(h.byId("rh-recommend-queries")?.children).toHaveLength(0);
  });

  it("does not rebuild the chips for a state with the same profile", () => {
    const { h, publish } = open();
    publish(withProfile());
    const before = h.byId("rh-recommend-terms")?.children[0];
    publish(withProfile());
    expect(h.byId("rh-recommend-terms")?.children[0]).toBe(before);
  });

  it("adds a typed term on Add and on Enter, empties the box, and keeps Enter from the dialog", () => {
    const { h, calls, publish } = open();
    publish(withProfile());
    const input = h.byId("rh-recommend-term-input");
    if (input === undefined) throw new Error("no term box");
    input.value = "delta";
    h.byId("rh-recommend-term-add")?.dispatch("command");
    expect(calls).toContainEqual(["addTerm", "delta"]);
    expect(input.value).toBe("");

    input.value = "epsilon";
    const prevented = vi.fn();
    input.dispatch("keydown", { key: "Enter", preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    expect(calls).toContainEqual(["addTerm", "epsilon"]);

    input.value = "zeta";
    input.dispatch("keydown", { key: "a", preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    expect(calls).not.toContainEqual(["addTerm", "zeta"]);
  });

  it("draws the run's status rows in its header", () => {
    const { h, publish } = open();
    expect(h.byId("rh-recommend-status")?.hidden).toBe(true);
    publish(
      stateOf({
        sources: [
          {
            sourceId: "similar",
            nameId: "research-helper-search-recommend-generator-similar",
            outcome: "succeeded",
            detail: ref("research-helper-search-recommend-source-partial"),
          },
        ],
      }),
    );
    const host = h.byId("rh-recommend-status");
    expect(host?.hidden).toBe(false);
    expect(host?.children[0]?.id).toBe("rh-recommend-status-similar");
    expect(h.byId("rh-search-source-status")?.children).toHaveLength(0);
  });

  it("shows the run's key notice, and opens its link outside the window", () => {
    const { h, publish } = open();
    publish(
      stateOf({
        recommend: {
          collectionName: "x",
          profile: undefined,
          canBuild: true,
          canFind: false,
          keyRequestUrl: "https://example.org/k",
        },
      }),
    );
    expect(h.byId("rh-recommend-key-notice")?.hidden).toBe(false);
    const link = h.byId("rh-recommend-key-request");
    expect(link?.getAttribute("href")).toBe("https://example.org/k");
    link?.dispatch("click", { preventDefault: vi.fn() });
    expect(h.launched).toStrictEqual(["https://example.org/k"]);

    publish(stateOf());
    expect(h.byId("rh-recommend-key-notice")?.hidden).toBe(true);
    expect(link?.getAttribute("href")).toBeNull();
  });

  it("draws a row's columns, ticked as the pipeline said, with Import on", () => {
    const { h, publish } = open();
    const row = (n: number, startsTicked: boolean) => ({
      key: `key-${String(n)}`,
      title: `Paper ${String(n)}`,
      authors: [{ family: `Author${String(n)}` }],
      year: 2024,
      sourceLabels: [],
      typeLabel: "",
      doi: "",
      existing: !startsTicked,
      startsTicked,
      recommended: true,
    });
    publish(
      stateOf({
        panel: "results",
        records: [row(1, true), row(2, false)],
        recordsRevision: 1,
      }),
    );
    const rows = h.byId("rh-results-body")?.children ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.children.map((cell) => cell.className)).toStrictEqual([
      "rh-col-select",
      "rh-col-title",
      "rh-col-authors",
      "rh-col-year",
      "rh-col-reason",
      "rh-col-dismiss",
    ]);
    expect(h.controller.state.selection).toStrictEqual(["key-1"]);
    expect(h.controller.state.selectedCount).toBe(1);
    expect(
      h.byId("rh-search-dialog")?.getAttribute("buttondisabledaccept"),
    ).toBe("false");
    expect(h.byId("rh-search-export")?.hidden).toBe(true);
  });

  it("offers no provenance export over a cost notice, since this mode writes no record", () => {
    const { h, publish } = open();
    publish(
      stateOf({ notices: [ref("research-helper-search-recommend-heuristic")] }),
    );
    expect(h.byId("rh-search-export")?.hidden).toBe(true);
  });

  it("escapes a query in the empty panel's headline", () => {
    const { h, publish } = open();
    publish(
      stateOf({
        panel: "empty",
        emptyHeadline: ref("research-helper-search-state-empty", {
          query: "<b>x</b>",
          from: 2020,
          to: 2021,
        }),
      }),
    );
    expect(argsOf(h.byId("rh-state-empty-headline"))).toStrictEqual({
      query: "&lt;b>x&lt;/b>",
      from: 2020,
      to: 2021,
    });
  });

  it("Retry repeats this mode's last button, and Cancel goes to this mode's host", () => {
    const { h, calls, keywordRuns } = open();
    h.byId("rh-state-error-retry")?.dispatch("command");
    expect(calls).toContainEqual(["retry"]);
    expect(keywordRuns).toStrictEqual([]);
    h.byId("rh-search-cancel")?.dispatch("command");
    expect(calls).toContainEqual(["cancel"]);
  });

  it("stays usable with no recommend host", () => {
    const h = harness({
      args: { mode: "recommend-from-collection", collectionID: 77 },
      host: { listSources: () => [PUBMED] },
    });
    h.controller.init();
    h.byId("rh-recommend-build")?.dispatch("command");
    h.byId("rh-recommend-term-add")?.dispatch("command");
    expect(h.byId("rh-recommend-build")?.getAttribute("disabled")).toBe("true");
  });

  describe("P5-T27: the results", () => {
    const P = "research-helper-search-recommend-";
    const row = (n: number, extra: Record<string, unknown> = {}) => ({
      key: `key-${String(n)}`,
      title: `Paper ${String(n)}`,
      authors: [{ family: `Author${String(n)}` }],
      year: 2024,
      sourceLabels: [],
      typeLabel: "",
      doi: "",
      existing: false,
      startsTicked: true,
      recommended: true,
      reasons: [ref(`${P}reason-recency`)],
      preprint: false,
      ...extra,
    });
    const listState = (
      records: readonly unknown[],
      recommend: Record<string, unknown> = {},
      extra: Record<string, unknown> = {},
    ) =>
      stateOf({
        panel: "results",
        records,
        recordsRevision: 1,
        recommend: {
          collectionName: "mRNA LNP",
          profile: undefined,
          canBuild: true,
          canFind: true,
          keyRequestUrl: undefined,
          dismissedKeys: [],
          dismissedAsked: false,
          listNote: undefined,
          ...recommend,
        },
        ...extra,
      });
    const bodyRows = (h: ReturnType<typeof open>["h"]) =>
      h.byId("rh-results-body")?.children ?? [];
    const buttonOf = (tr: FakeElement | undefined) =>
      tr?.children.at(-1)?.children[0];
    const flush = async () => {
      for (let at = 0; at < 4; at += 1) await Promise.resolve();
    };

    it("draws Why and Dismiss in place of Source, Type and DOI", () => {
      const { h, publish } = open();
      publish(listState([row(1)]));
      expect(
        bodyRows(h)[0]?.children.map((cell) => cell.className),
      ).toStrictEqual([
        "rh-col-select",
        "rh-col-title",
        "rh-col-authors",
        "rh-col-year",
        "rh-col-reason",
        "rh-col-dismiss",
      ]);
      expect(h.byId("rh-results-col-reason")?.getAttribute("scope")).toBe(
        "col",
      );
      expect(h.byId("rh-results-col-dismiss")?.getAttribute("scope")).toBe(
        "col",
      );
      expect(h.byId("rh-results-col-source")?.hidden).toBe(true);
      expect(h.byId("rh-results-col-doi")?.hidden).toBe(true);
    });

    it("captions the two columns from the bundle's labels", async () => {
      const { h } = open();
      await flush();
      expect(h.byId("rh-results-col-reason")?.textContent).toBe(
        `label:${P}col-reason`,
      );
      expect(h.byId("rh-results-col-dismiss")?.textContent).toBe(
        `label:${P}col-dismiss`,
      );
    });

    it("gives each reason its own message and line, with a source's names escaped", () => {
      const { h, publish } = open();
      publish(
        listState([
          row(1, {
            reasons: [
              ref(`${P}reason-recency`),
              ref(`${P}reason-author`, { names: HOSTILE, count: 1 }),
              ref(`${P}reason-cites`, { count: 3 }),
            ],
          }),
        ]),
      );
      const lines = bodyRows(h)[0]?.children[4]?.children ?? [];
      expect(
        lines.map((line) => line.getAttribute("data-l10n-id")),
      ).toStrictEqual([
        `${P}reason-recency`,
        `${P}reason-author`,
        `${P}reason-cites`,
      ]);
      expect(argsOf(lines[0])).toBeUndefined();
      expect(argsOf(lines[1])).toStrictEqual({
        names: '&lt;img src=x onerror="y">',
        count: 1,
      });
      expect(argsOf(lines[2])).toStrictEqual({ count: 3 });
    });

    it("draws no heading on a list with no groups", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2)]));
      expect(bodyRows(h)).toHaveLength(2);
    });

    it("draws one heading per group, spanning the columns on show", () => {
      const { h, publish } = open();
      const lipid = { key: "1", label: `lipid ${HOSTILE}` };
      const numbered = {
        key: "0",
        ref: ref(`${P}group-numbered`, { number: 1 }),
      };
      publish(
        listState([
          row(1, { group: lipid }),
          row(2, { group: lipid }),
          row(3, { group: numbered }),
        ]),
      );
      const rows = bodyRows(h);
      expect(rows).toHaveLength(5);
      const heading = rows[0]?.children[0];
      expect(heading?.name).toBe("th");
      expect(heading?.className).toBe("rh-recommend-group");
      expect(heading?.getAttribute("scope")).toBe("colgroup");
      expect(heading?.getAttribute("colspan")).toBe(
        String(rows[1]?.children.length),
      );
      // The library's or a model's words: as text, and in no Fluent argument.
      expect(heading?.textContent).toBe(`lipid ${HOSTILE}`);
      expect(heading?.getAttribute("data-l10n-id")).toBeNull();
      expect(rows[3]?.children[0]?.getAttribute("data-l10n-id")).toBe(
        `${P}group-numbered`,
      );
      expect(argsOf(rows[3]?.children[0])).toStrictEqual({ number: 1 });
    });

    it("gives a heading no key and no checkbox, so the counts and arrow keys pass it", () => {
      const { h, publish } = open();
      const group = { key: "0", label: "lipid" };
      publish(listState([row(1, { group }), row(2, { group })]));
      const rows = bodyRows(h);
      expect(
        rows[0]?.getAttribute(h.controller.spec.row.keyAttribute),
      ).toBeNull();
      expect(rows[0]?.children[0]?.children).toHaveLength(0);
      expect(h.controller.state.selectedCount).toBe(2);
      expect(h.controller.rowCheckboxes()).toHaveLength(2);
    });

    it("does not draw a heading whose rows are all filtered away", () => {
      const { h, publish } = open();
      const lipid = { key: "1", label: "lipid" };
      const liver = { key: "0", label: "liver" };
      publish(
        listState([
          row(1, { group: lipid, title: "Alpha" }),
          row(2, { group: liver, title: "Beta" }),
        ]),
      );
      const filter = h.byId("rh-search-filter");
      if (filter) filter.value = "beta";
      h.controller.applyFilter();
      const rows = bodyRows(h);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.children[0]?.textContent).toBe("liver");
    });

    it("says a preprint in words, beside the title, and keeps the title as text", () => {
      const { h, publish } = open();
      publish(listState([row(1, { preprint: true, title: `T ${HOSTILE}` })]));
      const cell = bodyRows(h)[0]?.children[1];
      expect(cell?.children[0]?.className).toBe("rh-preprint-badge");
      expect(cell?.children[0]?.getAttribute("data-l10n-id")).toBe(
        `${P}preprint`,
      );
      expect(cell?.children[1]?.textContent).toBe(`T ${HOSTILE}`);
      expect(cell?.children[1]?.getAttribute("data-l10n-id")).toBeNull();
    });

    it("keeps the in-library marker and the badge together, unticked", () => {
      const { h, publish } = open();
      publish(
        listState([
          row(1, { preprint: true, existing: true, startsTicked: false }),
        ]),
      );
      const cell = bodyRows(h)[0]?.children[1];
      expect(
        cell?.children.map((child) => child.getAttribute("data-l10n-id")),
      ).toContain(`${P}preprint`);
      expect(
        cell?.children.map((child) => child.getAttribute("data-l10n-id")),
      ).toContain("research-helper-search-row-existing");
      expect(h.controller.state.selection).toStrictEqual([]);
    });

    it("Not interested calls the host with the row's key, and draws nothing until it answers", () => {
      const { h, calls, publish } = open();
      publish(listState([row(1), row(2)]));
      const button = buttonOf(bodyRows(h)[1]);
      expect(button?.name).toBe("button");
      expect(button?.getAttribute("type")).toBe("button");
      expect(button?.getAttribute("data-l10n-id")).toBe(`${P}not-interested`);
      button?.dispatch("click");
      expect(calls).toContainEqual(["dismiss", "key-2"]);
      expect(bodyRows(h)).toHaveLength(2);
    });

    it("stops Enter on the button at keydown, so it cannot reach the dialog's accept", () => {
      const { h, calls, publish } = open();
      publish(listState([row(1)]));
      const prevented = vi.fn();
      buttonOf(bodyRows(h)[0])?.dispatch("keydown", {
        key: "Enter",
        preventDefault: prevented,
      });
      expect(prevented).toHaveBeenCalledTimes(1);
      expect(calls).toContainEqual(["dismiss", "key-1"]);
    });

    it("leaves any other key on the button alone", () => {
      const { h, calls, publish } = open();
      publish(listState([row(1)]));
      const prevented = vi.fn();
      buttonOf(bodyRows(h)[0])?.dispatch("keydown", {
        key: "Tab",
        preventDefault: prevented,
      });
      expect(prevented).not.toHaveBeenCalled();
      expect(calls).not.toContainEqual(["dismiss", "key-1"]);
    });

    it("removes a dismissed row without touching any other row's tick", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2), row(3)]));
      h.controller.toggleRow("key-3", false);
      publish(
        listState([row(1), row(2), row(3)], { dismissedKeys: ["key-2"] }),
      );
      expect(
        bodyRows(h).map((tr) =>
          tr.getAttribute(h.controller.spec.row.keyAttribute),
        ),
      ).toStrictEqual(["key-1", "key-3"]);
      expect(h.controller.state.selection).toStrictEqual(["key-1"]);
      expect(h.controller.state.selectedCount).toBe(1);
    });

    it("moves the focus to the button that took the pressed one's place", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2), row(3)]));
      buttonOf(bodyRows(h)[1])?.dispatch("click");
      publish(
        listState([row(1), row(2), row(3)], { dismissedKeys: ["key-2"] }),
      );
      expect(buttonOf(bodyRows(h)[1])?.focused).toBe(true);
      expect(buttonOf(bodyRows(h)[0])?.focused).toBe(false);
    });

    it("moves the focus to the last button when the last row went", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2)]));
      buttonOf(bodyRows(h)[1])?.dispatch("click");
      publish(listState([row(1), row(2)], { dismissedKeys: ["key-2"] }));
      expect(buttonOf(bodyRows(h)[0])?.focused).toBe(true);
    });

    it("does not rebuild the table for a state with the same dismissed keys", () => {
      const { h, publish } = open();
      const dismissedKeys = ["key-2"];
      publish(listState([row(1), row(2)], { dismissedKeys }));
      const [first] = bodyRows(h);
      publish(listState([row(1), row(2)], { dismissedKeys }));
      expect(bodyRows(h)[0]).toBe(first);
    });

    it("moves the focus once for one press", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2), row(3)]));
      buttonOf(bodyRows(h)[0])?.dispatch("click");
      publish(
        listState([row(1), row(2), row(3)], { dismissedKeys: ["key-1"] }),
      );
      publish(
        listState([row(1), row(2), row(3)], {
          dismissedKeys: ["key-1", "key-2"],
        }),
      );
      expect(buttonOf(bodyRows(h)[0])?.focused).toBe(false);
    });

    it("moves no focus on a list that was not its doing", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2)]));
      publish(listState([row(1), row(2)], { dismissedKeys: ["key-1"] }));
      expect(buttonOf(bodyRows(h)[0])?.focused).toBe(false);
    });

    it("Show dismissed shows them marked, sends nothing, and hides them again", () => {
      const { h, calls, publish } = open();
      publish(listState([row(1), row(2)], { dismissedKeys: ["key-2"] }));
      expect(bodyRows(h)).toHaveLength(1);
      const before = calls.length;
      const box = h.byId("rh-recommend-show-dismissed");
      if (box) box.checked = true;
      box?.dispatch("command");
      expect(calls).toHaveLength(before);
      const rows = bodyRows(h);
      expect(rows).toHaveLength(2);
      const marker = buttonOf(rows[1]);
      expect(marker?.name).toBe("span");
      expect(marker?.className).toBe("rh-row-dismissed-text");
      expect(marker?.getAttribute("data-l10n-id")).toBe(`${P}row-dismissed`);
      if (box) box.checked = false;
      box?.dispatch("command");
      expect(bodyRows(h)).toHaveLength(1);
    });

    it("leaves a dismissed row unticked when shown, and lets a hand tick it", () => {
      const { h, publish } = open();
      publish(listState([row(1), row(2)]));
      publish(listState([row(1), row(2)], { dismissedKeys: ["key-2"] }));
      const box = h.byId("rh-recommend-show-dismissed");
      if (box) box.checked = true;
      box?.dispatch("command");
      expect(h.controller.state.selection).toStrictEqual(["key-1"]);
      h.controller.toggleRow("key-2", true);
      // A later dismissal of another row does not take that tick back.
      publish(
        listState([row(1), row(2)], { dismissedKeys: ["key-2", "key-1"] }),
      );
      expect(h.controller.state.selection).toStrictEqual(["key-2"]);
    });

    it("says rows from an earlier run are not on hand only while that is so", () => {
      const { h, publish } = open();
      const hint = () => h.byId("rh-recommend-dismissed-hint")?.hidden;
      publish(listState([row(1)]));
      expect(hint()).toBe(true);
      const box = h.byId("rh-recommend-show-dismissed");
      if (box) box.checked = true;
      box?.dispatch("command");
      expect(hint()).toBe(false);
      publish(listState([row(1)], { dismissedAsked: true }));
      expect(hint()).toBe(true);
    });

    it("says nothing of the hint with no list", () => {
      const { h, publish } = open();
      const box = h.byId("rh-recommend-show-dismissed");
      if (box) box.checked = true;
      publish(listState([], {}, { panel: "initial" }));
      expect(h.byId("rh-recommend-dismissed-hint")?.hidden).toBe(true);
    });

    it("draws the list's note, and takes it away", () => {
      const { h, publish } = open();
      const note = () => h.byId("rh-recommend-list-note");
      expect(note()?.hidden).toBe(true);
      publish(listState([row(1)], { listNote: ref(`${P}novelty-note`) }));
      expect(note()?.hidden).toBe(false);
      expect(note()?.getAttribute("data-l10n-id")).toBe(`${P}novelty-note`);
      publish(listState([row(1)]));
      expect(note()?.hidden).toBe(true);
      expect(note()?.getAttribute("data-l10n-id")).toBeNull();
    });

    it("Find papers carries the three controls, and starts on the decided values", () => {
      const { h, calls, publish } = open();
      publish(withProfile());
      h.byId("rh-recommend-find")?.dispatch("command");
      expect(calls).toContainEqual([
        "find",
        {
          slider: RECOMMEND_DEFAULT_SLIDER,
          peerReviewedOnly: false,
          showDismissed: false,
        },
      ]);
    });

    it("reads the controls when pressed, not before", () => {
      const { h, calls, publish } = open();
      publish(withProfile());
      const slider = h.byId("rh-recommend-slider");
      if (slider) slider.value = "70";
      const peer = h.byId("rh-recommend-peer-reviewed");
      if (peer) peer.checked = true;
      const dismissed = h.byId("rh-recommend-show-dismissed");
      if (dismissed) dismissed.checked = true;
      expect(calls.some(([name]) => name === "find")).toBe(false);
      h.byId("rh-recommend-find")?.dispatch("command");
      expect(calls).toContainEqual([
        "find",
        { slider: 70, peerReviewedOnly: true, showDismissed: true },
      ]);
    });

    it("the slider's markup is the decided control, and writes no preference", () => {
      const slider = h0().byId("rh-recommend-slider");
      expect(slider?.name).toBe("html:input");
      expect(slider?.getAttribute("type")).toBe("range");
      expect(slider?.getAttribute("min")).toBe("0");
      expect(slider?.getAttribute("max")).toBe("100");
      expect(slider?.getAttribute("step")).toBe("5");
      expect(slider?.getAttribute("value")).toBe(
        String(RECOMMEND_DEFAULT_SLIDER),
      );
      expect(slider?.getAttribute("data-l10n-id")).toBe(`${P}slider`);
      expect(h0().byId("rh-recommend-peer-reviewed")?.checked).toBe(false);
      expect(h0().byId("rh-recommend-show-dismissed")?.checked).toBe(false);
      expect(SCRIPT).not.toMatch(/setPref[^\n]*recommend/i);
    });

    it("stops Enter on the slider at keydown", () => {
      const { h } = open();
      const prevented = vi.fn();
      h.byId("rh-recommend-slider")?.dispatch("keydown", {
        key: "Enter",
        preventDefault: prevented,
      });
      expect(prevented).toHaveBeenCalledTimes(1);
      const other = vi.fn();
      h.byId("rh-recommend-slider")?.dispatch("keydown", {
        key: "ArrowLeft",
        preventDefault: other,
      });
      expect(other).not.toHaveBeenCalled();
    });

    it("turns Import on with a tick, and off with none", () => {
      const { h, publish } = open();
      publish(listState([row(1)]));
      expect(
        h.byId("rh-search-dialog")?.getAttribute("buttondisabledaccept"),
      ).toBe("false");
      h.controller.toggleRow("key-1", false);
      expect(
        h.byId("rh-search-dialog")?.getAttribute("buttondisabledaccept"),
      ).toBe("true");
    });

    /** A window whose bundle answers the dated default as Fluent does. */
    function dated(asked: unknown[] = []) {
      const opened = open(
        {},
        {
          formatMessages: (
            requests: readonly { id: string; args?: unknown }[],
          ) => {
            asked.push(...requests);
            return Promise.resolve(
              requests.map((request) => ({
                value:
                  request.id === `${P}target-default`
                    ? "⁨mRNA LNP⁩ — recommended ⁨2026-11-05⁩"
                    : `value:${request.id}`,
                attributes: [],
              })),
            );
          },
        },
      );
      return opened;
    }
    const DATED = "new:mRNA LNP — recommended 2026-11-05";

    it("starts the picker on the dated default, without Fluent's marks, on the local day", async () => {
      const asked: unknown[] = [];
      const { h, publish } = dated(asked);
      h.controller.clock = {
        now: () => new Date(2026, 10, 5, 23, 30).getTime(),
      };
      publish(listState([row(1)]));
      await flush();
      expect(h.byId("rh-search-target")?.value).toBe(DATED);
      expect(asked).toContainEqual({
        id: `${P}target-default`,
        args: { collection: "mRNA LNP", date: "2026-11-05" },
      });
    });

    it("pads the month and the day", () => {
      const { h } = open();
      expect(
        h.controller.logic.isoDay(new Date(2026, 0, 3, 0, 5).getTime()),
      ).toBe("2026-01-03");
    });

    it("asks for that name once, so a later state cannot take back a choice", async () => {
      const asked: { id: string }[] = [];
      const { h, publish } = dated(asked);
      publish(listState([row(1)]));
      await flush();
      const target = h.byId("rh-search-target");
      if (target) target.value = "9";
      publish(listState([row(1)]));
      await flush();
      expect(
        asked.filter(({ id }) => id === `${P}target-default`),
      ).toHaveLength(1);
      expect(target?.value).toBe("9");
    });

    it("leaves alone a choice made while the bundle was answering", async () => {
      const { h, publish } = dated();
      publish(listState([row(1)]));
      const target = h.byId("rh-search-target");
      if (target) target.value = "9";
      await flush();
      expect(target?.value).toBe("9");
    });

    it("Import hands over the ticked visible rows and nests only the dated default", async () => {
      const { h, calls, publish } = dated();
      publish(listState([row(1), row(2), row(3)]));
      await flush();
      h.controller.toggleRow("key-2", false);
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      expect(calls).toContainEqual([
        "importRows",
        {
          keys: ["key-1", "key-3"],
          collectionID: DATED,
          parentIsSource: true,
        },
      ]);
      const target = h.byId("rh-search-target");
      if (target) target.value = "9";
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      expect(calls).toContainEqual([
        "importRows",
        {
          keys: ["key-1", "key-3"],
          collectionID: "9",
          parentIsSource: false,
        },
      ]);
    });

    it("imports no row filtered out of view, and calls nothing with no tick", async () => {
      const { h, calls, publish } = open();
      publish(listState([row(1), row(2)], { dismissedKeys: ["key-2"] }));
      // Item 358(b), 2026-11-06: the dated default must land before Import, or
      // the picker is still on bare "New collection…" and Import asks first.
      await flush();
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      const request = calls.find(([name]) => name === "importRows")?.[1] as {
        keys: string[];
      };
      expect(request.keys).toStrictEqual(["key-1"]);
      h.controller.toggleRow("key-1", false);
      calls.length = 0;
      h.doc.dispatch("dialogaccept", { preventDefault: () => undefined });
      expect(calls).toStrictEqual([]);
    });

    it("draws a row's filter text from its title, authors and year only", () => {
      const { h, publish } = open();
      publish(listState([row(1, { title: "Alpha" })]));
      const filter = h.byId("rh-search-filter");
      if (filter) filter.value = `${P}reason-recency`;
      h.controller.applyFilter();
      expect(bodyRows(h)).toHaveLength(0);
      if (filter) filter.value = "author1";
      h.controller.applyFilter();
      expect(bodyRows(h)).toHaveLength(1);
    });

    it("filters only this mode's rows on dismissal", () => {
      const { logic } = open().h.controller;
      expect(
        logic.matchesRecommendFilter({ key: "a" }, { dismissedKeys: ["a"] }),
      ).toBe(true);
      expect(
        logic.matchesRecommendFilter(
          { key: "a", recommended: true },
          undefined,
        ),
      ).toBe(true);
      expect(
        logic.matchesRecommendFilter({ key: "a", recommended: true }, {}),
      ).toBe(true);
      expect(
        logic.matchesRecommendFilter(
          { key: "a", recommended: true },
          { dismissedKeys: ["a"] },
        ),
      ).toBe(false);
      expect(
        logic.matchesRecommendFilter(
          { key: "a", recommended: true },
          { dismissedKeys: ["a"], showDismissed: true },
        ),
      ).toBe(true);
    });

    it("escapes only names in a reason, and leaves one with none as it was", () => {
      const { logic } = open().h.controller;
      const plain = ref(`${P}reason-recency`);
      expect(logic.reasonRef(plain)).toBe(plain);
      const counted = ref(`${P}reason-cites`, { count: 2 });
      expect(logic.reasonRef(counted)).toBe(counted);
    });

    /** The markup with the window opened, once per call. */
    function h0() {
      return open().h;
    }
  });
});

describe("P5-T26: the two Fluent arguments of plan/reports/integration-round-350.md", () => {
  it("escapes a re-run heading's collection name and leaves the chip's attribute raw", async () => {
    const name = "<img src=x onerror=y> & co";
    const h = harness({
      args: { mode: "rerun", collectionID: 4242 },
      host: {
        listSources: () => [PUBMED],
        loadRerun: () =>
          Promise.resolve({ ...RERUN_SEED, collectionName: name }),
      },
    });
    h.controller.init();
    await flush();
    expect(argsOf(h.byId("rh-rerun-heading"))).toStrictEqual({
      collection: "&lt;img src=x onerror=y> &amp; co",
    });
    expect(argsOf(h.byId("rh-search-mode"))).toStrictEqual({
      collection: name,
    });
  });

  it("escapes an empty headline's query and passes every other headline through", () => {
    const logic = harness().controller.logic;
    expect(
      logic.emptyHeadlineRef({
        id: "research-helper-search-state-empty",
        args: { query: "<b>x</b> & y", from: 2020, to: 2021 },
      }),
    ).toStrictEqual({
      id: "research-helper-search-state-empty",
      args: { query: "&lt;b>x&lt;/b> &amp; y", from: 2020, to: 2021 },
    });
    const bare = { id: "research-helper-search-related-state-empty" };
    expect(logic.emptyHeadlineRef(bare)).toBe(bare);
    const other = { id: "x", args: { count: 1 } };
    expect(logic.emptyHeadlineRef(other)).toBe(other);
  });
});

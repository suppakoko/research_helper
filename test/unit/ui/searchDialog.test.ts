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
  public readonly children: FakeElement[] = [];
  public readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  public hidden: boolean;
  public checked: boolean;
  public disabled = false;
  public value: string | undefined;
  public className = "";
  public focused = false;

  public constructor(
    public readonly name: string,
    private readonly attrs: Map<string, string>,
  ) {
    this.hidden = attrs.get("hidden") === "true";
    this.checked = attrs.get("checked") === "true";
    this.value = attrs.get("value");
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
  [key: string]: unknown;
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
}

interface Controller {
  spec: ControllerSpec;
  l10n: Record<string, string>;
  logic: ControllerLogic;
  clock: { now: () => number };
  state: { running: boolean; selectedCount: number; panel: string };
  host: Record<string, unknown>;
  io: Record<string, unknown>;
  init: () => void;
  applyChromeStrings: () => Promise<void> | undefined;
  refreshSearchGate: () => { enabled: boolean; messageId: string | null };
  refreshImportGate: () => boolean;
  showPanel: (name: string) => void;
  collectQuery: () => Record<string, unknown>;
  search: () => void;
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
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const bucket = docListeners.get(type) ?? [];
      bucket.push(handler);
      docListeners.set(type, bucket);
    },
    dispatch: (type: string, event: unknown = {}) => {
      for (const handler of docListeners.get(type) ?? []) handler(event);
    },
    l10n: {
      formatMessages: (
        requests: readonly { id: string }[],
      ): Promise<readonly FakeL10nMessage[]> =>
        Promise.resolve(
          options.l10n ??
            requests.map((request) => ({
              value: `value:${request.id}`,
              attributes: [{ name: "label", value: `label:${request.id}` }],
            })),
        ),
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

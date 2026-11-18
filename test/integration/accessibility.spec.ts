/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P7-T06` — keyboard, focus, accessible names and contrast (`NFR-13`;
 * `docs/08` §9; `docs/13` §8.7).
 *
 * **What each window test asserts**, on the window as the plugin opens it:
 *
 * 1. **Tab order.** Pressing Tab from the start of the window (the focus
 *    manager's own forward move, `FLAG_BYKEY`) visits every enabled, shown
 *    control once before it comes round again, and each one it lands on
 *    matches `:focus-visible`, so the platform draws its focus ring there.
 *    A radio group is one stop, as the platform makes it.
 * 2. **Accessible names.** Every enabled, shown control has a non-empty name,
 *    computed by the subset of the accessible-name rules this plugin's markup
 *    uses: `aria-labelledby`, `aria-label`, a XUL `<label control>` or an HTML
 *    `<label for>`, the XUL `label` attribute, the element's own text, then
 *    `title`/`tooltiptext`. The name is read from the DOM, **not** from the
 *    platform's accessibility tree, and nothing here says what a screen reader
 *    announces: that is `P7-T07`'s NVDA run (`G-33`).
 * 3. **`Escape` cancels or closes**, and **`Enter` activates the default**, by
 *    real key presses through `nsITextInputProcessor` (as
 *    `pipeline/recommendWindow.spec.ts` does). Where the default would start a
 *    paid or networked run, the window's own `start`/`search` is replaced by a
 *    recorder for that one press, so the press is measured and nothing runs.
 *
 * **Contrast** (`P7-T06` step 3): every text colour the plugin's own CSS sets
 * (`addon/content/style/searchDialog.css`, the report window's inline style,
 * the preferences pane's two badge colours) is drawn on a probe in the window
 * that uses it, in Zotero's light and dark appearance
 * (`browser.theme.toolbar-theme` 1 and 0, the Settings → General → Appearance
 * control), and its ratio is computed from the computed colours, alpha
 * composed over the nearest opaque background (WCAG 2.1's relative
 * luminance). Each ratio is logged with the `[P7-T06]` prefix for
 * `docs/spikes/phase-7-accessibility.md`, and each must be at least 4.5:1.
 * Forced-colours mode is then observed, not asserted
 * (`ui.useAccessibilityTheme`), as `docs/08` §9's marker asks.
 *
 * **Not exercised here** (`plan/reports/P7-T06.md` records each): the related
 * and recommend modes of the search window, which start a run by themselves;
 * the cost dialog's pre-flight moment (its ceiling moment is here); and
 * Zotero's own Settings window chrome around the plugin's pane.
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import { ZERO_SPEND } from "../../src/pipeline/shared/budget";
import {
  COST_DIALOG_FEATURES,
  COST_DIALOG_URL,
  buildCostDialogModel,
  openCostConfirmDialog,
  type CostDialogOutcome,
} from "../../src/ui/dialogs/costConfirmDialog";
import { openSearchWindow } from "../../src/ui/dialogs/searchDialog";
import {
  SECRET_BACKEND_DIALOG_URL,
  openSecretBackendDialog,
} from "../../src/ui/dialogs/secretBackendDialog";
import {
  PREFERENCES_PANE_ID,
  PREFERENCES_ROOT_ID,
} from "../../src/ui/prefs/preferencesPane";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

/** The slice of Mocha's test context this file uses. */
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
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isAtLeast(value: number, floor: number, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 30_000;
const TAG = `p7t06-${String(Date.now())}`;
/** WCAG 2.1 AA for body text. */
const AA_RATIO = 4.5;
/** Zotero's Settings → General → Appearance preference and its values. */
const THEME_PREF = "browser.theme.toolbar-theme";
const THEME_LIGHT = 1;
const THEME_DARK = 0;
/**
 * The two ways Gecko can be put into forced colours from a preference: the
 * look-and-feel override and "Override the colours specified by the page:
 * Always". Each is set alone, observed, and cleared.
 */
const FORCED_COLORS_PREFS = [
  { name: "ui.useAccessibilityTheme", value: 1 },
  { name: "browser.display.document_color_use", value: 2 },
] as const;

const ESCAPE = 27;
const ENTER = 13;

function log(line: string): void {
  debug(`[P7-T06] ${line}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await delay(25);
  }
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

/* ------------------------------------------------------- keyboard */

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

interface FocusManager {
  readonly MOVEFOCUS_FORWARD: number;
  readonly FLAG_BYKEY: number;
  moveFocus(
    win: Window,
    start: Element | null,
    type: number,
    flags: number,
  ): Element | null;
  clearFocus(win: Window): void;
  setFocus(element: Element, flags: number): void;
  readonly focusedElement: Element | null;
}

function focusManager(): FocusManager {
  return (Services as unknown as { focus: FocusManager }).focus;
}

/** Bring `win` to the front, so its focus is the one keys go to. */
async function activate(win: Window): Promise<void> {
  win.focus();
  await waitUntil(
    () =>
      (Services as unknown as { focus: { activeWindow: Window | null } }).focus
        .activeWindow === win,
    "the window to be the active one",
    10_000,
  ).catch(() => log("the window did not become the active one"));
}

/** The element a control's focus stop is: a radio counts as its group. */
function stopOf(element: Element): Element {
  if (element.localName === "radio") {
    const group = element.closest("radiogroup");
    if (group !== null) return group;
  }
  return element;
}

/**
 * Press Tab from the start of the window until the focus comes round again,
 * and return each stop in order.
 */
function tabStops(win: Window, limit = 400): Element[] {
  const fm = focusManager();
  fm.clearFocus(win);
  const stops: Element[] = [];
  const seen = new Set<Element>();
  let previous: Element | null = null;
  for (let i = 0; i < limit; i += 1) {
    const moved = fm.moveFocus(win, null, fm.MOVEFOCUS_FORWARD, fm.FLAG_BYKEY);
    if (moved === null || moved === previous) {
      if (stops.length > 0 && moved === null) break;
      continue;
    }
    previous = moved;
    const stop = stopOf(moved);
    if (seen.has(stop)) break;
    seen.add(stop);
    stops.push(stop);
  }
  return stops;
}

/* ------------------------------------------------------- the controls */

const CONTROL_SELECTOR = [
  "button",
  "checkbox",
  "menulist",
  "radiogroup",
  "input",
  "textarea",
  "select",
  "a[href]",
  "toolbarbutton",
].join(", ");

function isShown(element: Element): boolean {
  const check = (element as { checkVisibility?: () => boolean })
    .checkVisibility;
  if (typeof check === "function" && !check.call(element)) return false;
  const box = (element as HTMLElement).getBoundingClientRect?.();
  return box === undefined || box.width > 0 || box.height > 0;
}

function isEnabled(element: Element): boolean {
  if ((element as { disabled?: boolean }).disabled === true) return false;
  if (element.getAttribute("disabled") === "true") return false;
  return element.getAttribute("tabindex") !== "-1";
}

/** Every enabled, shown control under `root`, the dialog's own buttons with it. */
function controlsUnder(root: Element): Element[] {
  const found = [...root.querySelectorAll(CONTROL_SELECTOR)].filter(
    (element) =>
      // A radio is reached through its group; an input's own parts are its.
      element.localName !== "radio" &&
      !(element.localName === "input" && element.closest("menulist") !== null),
  );
  const dialogs = [
    ...(root.localName === "dialog" ? [root] : []),
    ...root.querySelectorAll("dialog"),
  ] as (Element & { getButton?(name: string): Element | null })[];
  for (const dialog of dialogs) {
    for (const name of ["accept", "cancel", "extra1", "extra2"]) {
      const button = dialog.getButton?.(name);
      if (button) found.push(button);
    }
  }
  return found.filter((element) => isShown(element) && isEnabled(element));
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/gu, " ").trim();
}

/** A label element's text: XUL `value`, else its text. */
function labelText(element: Element): string {
  return clean(element.getAttribute("value")) || clean(element.textContent);
}

/**
 * The accessible name, by the rules this plugin's markup uses (header comment,
 * item 2). Returns `""` for a control none of them names.
 */
function accessibleName(element: Element): string {
  const doc = element.ownerDocument as Document;
  const root = element.getRootNode() as Document | ShadowRoot;
  const byId = (id: string): Element | null =>
    (root as { getElementById?(id: string): Element | null }).getElementById?.(
      id,
    ) ?? doc.getElementById(id);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = clean(
      labelledBy
        .split(/\s+/u)
        .map((id) => {
          const target = byId(id);
          return target ? labelText(target) : "";
        })
        .join(" "),
    );
    if (text) return text;
  }
  const ariaLabel = clean(element.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;
  if (element.id) {
    for (const label of doc.querySelectorAll(
      `label[control="${element.id}"], label[for="${element.id}"]`,
    )) {
      const text = labelText(label);
      if (text) return text;
    }
  }
  const xulLabel = clean(element.getAttribute("label"));
  if (xulLabel) return xulLabel;
  if (["a", "button"].includes(element.localName)) {
    const text = clean(element.textContent);
    if (text) return text;
  }
  // HTML-AAM's last source for a text field: its placeholder. Firefox names
  // the field from it; that it is the only label is recorded separately
  // (`plan/reports/P7-T06.md`, the price form).
  return (
    clean(element.getAttribute("title")) ||
    clean(element.getAttribute("tooltiptext")) ||
    (element.localName === "input" || element.localName === "textarea"
      ? clean(element.getAttribute("placeholder"))
      : "")
  );
}

function describeControl(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const type = element.getAttribute("type");
  return `${element.localName}${id}${type ? `[${type}]` : ""}`;
}

/**
 * Assert the card's first two lines on one window: Tab visits each control
 * once, with a focus ring, and each control has a name.
 */
function assertKeyboardAndNames(
  win: Window,
  root: Element,
  where: string,
): void {
  const expected = controlsUnder(root);
  const stops = tabStops(win);
  const fm = focusManager();
  const unnamed = expected.filter((element) => accessibleName(element) === "");
  const notVisited = expected.filter((element) => !stops.includes(element));
  const ringless: string[] = [];
  for (const stop of stops.filter((element) => expected.includes(element))) {
    fm.setFocus(stop, fm.FLAG_BYKEY);
    const focused = fm.focusedElement;
    const target = focused !== null && stop.contains(focused) ? focused : stop;
    if (!target.matches(":focus-visible") && !stop.matches(":focus-within")) {
      ringless.push(describeControl(stop));
    }
  }
  log(
    `${where}: ${String(expected.length)} controls; Tab order: ` +
      stops
        .map((s) =>
          expected.includes(s)
            ? `${describeControl(s)} "${accessibleName(s)}"`
            : `(${describeControl(s)}, not a control)`,
        )
        .join(" → "),
  );
  assert.deepEqual(
    notVisited.map(describeControl),
    [],
    `${where}: every enabled, shown control is reached by Tab`,
  );
  assert.deepEqual(
    unnamed.map(describeControl),
    [],
    `${where}: every enabled, shown control has an accessible name`,
  );
  assert.deepEqual(
    ringless,
    [],
    `${where}: every control Tab reaches matches :focus-visible`,
  );
}

/* ------------------------------------------------------- contrast */

type Rgba = readonly [number, number, number, number];

/** A computed colour: `rgb()`/`rgba()`, or `color(srgb …)`, which is how Gecko serialises a `color-mix(in srgb, …)`. */
function parseColor(value: string): Rgba | undefined {
  const srgb =
    /color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\s*\)/u.exec(
      value,
    );
  if (srgb !== null) {
    const a =
      srgb[4] === undefined
        ? 1
        : srgb[4].endsWith("%")
          ? Number(srgb[4].slice(0, -1)) / 100
          : Number(srgb[4]);
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
      a,
    ];
  }
  const match =
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/u.exec(
      value,
    );
  if (match === null) return undefined;
  const alpha =
    match[4] === undefined
      ? 1
      : match[4].endsWith("%")
        ? Number(match[4].slice(0, -1)) / 100
        : Number(match[4]);
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance(color: Rgba): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color[0]) +
    0.7152 * channel(color[1]) +
    0.0722 * channel(color[2])
  );
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** The window's canvas colour: the system `Canvas`, as the theme sets it. */
function canvasOf(win: Window): Rgba {
  const doc = win.document;
  const probe = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  probe.style.backgroundColor = "Canvas";
  (doc.documentElement as Element).appendChild(probe);
  const color = parseColor(win.getComputedStyle(probe)?.backgroundColor ?? "");
  probe.remove();
  return color ?? [255, 255, 255, 1];
}

/** The colour behind `element`: each background up the tree, composed. */
function backgroundOf(win: Window, element: Element): Rgba {
  const layers: Rgba[] = [];
  let opaque = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parseColor(win.getComputedStyle(node)?.backgroundColor ?? "");
    if (color !== undefined && color[3] > 0) {
      layers.push(color);
      if (color[3] >= 1) {
        opaque = true;
        break;
      }
    }
  }
  // Under every layer, the window's canvas, unless a layer covered it.
  let result: Rgba = opaque ? [255, 255, 255, 1] : canvasOf(win);
  for (const layer of layers.reverse()) result = over(layer, result);
  return result;
}

/**
 * One plugin text colour, drawn where and how the plugin draws it: by one of
 * its own classes, by an attribute its own selector matches, or by a function
 * of its own that paints the element.
 */
interface Probe {
  readonly name: string;
  /** The plugin's class for the text, which its stylesheet colours. */
  readonly className?: string;
  /** Attributes the plugin's selector matches (the report's stage rows). */
  readonly attributes?: Readonly<Record<string, string>>;
  /** The element the text sits in, when the selector needs one. */
  readonly parentId?: string;
  /** The plugin's own painter, given the probe element. */
  readonly paint?: (win: Window, element: HTMLElement) => void;
  /** A background a plugin rule puts behind the text, if any. */
  readonly background?: string;
}

interface Measured {
  name: string;
  ratio: number;
  fg: string;
  bg: string;
}

/** The ratio of each probe, drawn under `parent` in `win`. */
function measure(
  win: Window,
  parent: Element,
  probes: readonly Probe[],
): Measured[] {
  const doc = win.document;
  const HTML = "http://www.w3.org/1999/xhtml";
  const results: Measured[] = [];
  for (const probe of probes) {
    const host =
      (probe.parentId === undefined
        ? null
        : doc.getElementById(probe.parentId)) ?? parent;
    const box = doc.createElementNS(HTML, "div") as HTMLElement;
    if (probe.background !== undefined) {
      box.style.background = probe.background;
    }
    const text = doc.createElementNS(
      HTML,
      probe.attributes === undefined ? "span" : "p",
    ) as HTMLElement;
    text.textContent = "Aa";
    if (probe.className !== undefined) text.className = probe.className;
    for (const [name, value] of Object.entries(probe.attributes ?? {})) {
      text.setAttribute(name, value);
    }
    box.appendChild(text);
    host.appendChild(box);
    probe.paint?.(win, text);
    const style = win.getComputedStyle(text);
    const fg = parseColor(style?.color ?? "");
    const opacity = Number(style?.opacity ?? "1");
    const bg = backgroundOf(win, text);
    box.remove();
    if (fg === undefined) assert.fail(`${probe.name}: no computed colour`);
    const shown: Rgba = [fg[0], fg[1], fg[2], fg[3] * opacity];
    const value = ratio(over(shown, bg), bg);
    results.push({
      name: probe.name,
      ratio: Math.round(value * 100) / 100,
      fg: `rgba(${shown.map((c, i) => (i === 3 ? c.toFixed(3) : Math.round(c))).join(", ")})`,
      bg: `rgb(${bg
        .slice(0, 3)
        .map((c) => Math.round(c))
        .join(", ")})`,
    });
  }
  return results;
}

/** Set Zotero's appearance and wait for `win` to follow it. */
async function setTheme(win: Window, value: number): Promise<void> {
  Services.prefs.setIntPref(THEME_PREF, value);
  const dark = value === THEME_DARK;
  await waitUntil(
    () => win.matchMedia("(prefers-color-scheme: dark)")?.matches === dark,
    `the window to follow appearance ${String(value)}`,
  );
  await delay(100);
}

/** `--fill-quinary`: the background of a chip and of a hovered row. */
const HOVER = "var(--fill-quinary)";

/** The text classes `addon/content/style/searchDialog.css` colours. */
const SEARCH_PROBES: readonly Probe[] = [
  { name: "body text" },
  { name: "body text on a chip or a hovered row", background: HOVER },
  {
    name: "table header text (--material-sidepane)",
    background: "var(--material-sidepane)",
  },
  ...(
    [
      ["hint (.rh-hint)", "rh-hint"],
      ["relevance badge (.rh-relevance-badge)", "rh-relevance-badge"],
      ["source role (.rh-source-role)", "rh-source-role"],
      ["inline warning (.rh-inline-warning)", "rh-inline-warning"],
      ["in-library badge (.rh-existing-badge)", "rh-existing-badge"],
      ["possible-duplicate badge (.rh-duplicate-badge)", "rh-duplicate-badge"],
      ["linked badge (.rh-linked-badge)", "rh-linked-badge"],
    ] as const
  ).flatMap(([name, className]): Probe[] => [
    { name, className },
    { name: `${name} on a hovered row`, className, background: HOVER },
  ]),
];

/** `reportWindow.xhtml`'s own style: its stage rows. */
const REPORT_PROBES: readonly Probe[] = [
  { name: "body text" },
  {
    name: 'pending stage row ([data-status="pending"])',
    parentId: "rh-report-rows",
    attributes: { "data-status": "pending" },
  },
];

interface PrefsWindowWithController extends Window {
  Zotero_Preferences?: {
    getScope(paneID: string): Record<string, unknown> | null;
  };
}

interface BadgePainter {
  paintBadge(el: Element, badge: { messageId: string; warning: boolean }): void;
}

/**
 * `RHPreferences.paintBadge`, called on the probe as the pane calls it. The
 * controller lives in the pane's own scope, not on the window
 * (`preferences.spec.ts` asserts that).
 */
function badgeProbe(name: string, warning: boolean): Probe {
  return {
    name,
    paint(win, element) {
      const scope = (
        win as PrefsWindowWithController
      ).Zotero_Preferences?.getScope(PREFERENCES_PANE_ID);
      const controller = scope?.["RHPreferences"] as BadgePainter | undefined;
      if (!controller) assert.fail("no RHPreferences in the pane's scope");
      controller.paintBadge(element, {
        messageId: "research-helper-prefs-price-model",
        warning,
      });
    },
  };
}

const PREFS_PROBES: readonly Probe[] = [
  { name: "body text" },
  badgeProbe("key badge, warning (paintBadge)", true),
  badgeProbe("key badge, valid (paintBadge)", false),
];

/* ------------------------------------------------------- the windows */

interface SearchWindow extends Window {
  RHSearchWindow?: {
    state: { initialized: boolean; running: boolean };
    search(): void;
  };
}

interface SummarizeWindow extends Window {
  RHSummarizeWindow?: {
    state: { initialized: boolean; running: boolean };
    start(): void;
    cancel(): void;
  };
}

interface ReportWindow extends Window {
  RHReportWindow?: {
    state: { initialized: boolean; running: boolean; audioRunning: boolean };
    ready?: Promise<void>;
    start(): void;
    cancel(): void;
    cancelAudio(): void;
  };
}

interface PrefsWindow extends Window {
  Zotero_Preferences?: { panes: Map<string, { loaded?: boolean }> };
}

async function openSearch(): Promise<SearchWindow> {
  const win = openSearchWindow(Zotero.getMainWindow(), {
    mode: "keyword",
  }) as unknown as SearchWindow;
  await waitUntil(
    () => win.RHSearchWindow?.state.initialized === true,
    "RHSearchWindow.init() to have run",
  );
  await (win.document as unknown as { l10n?: { ready?: Promise<void> } }).l10n
    ?.ready;
  await delay(250);
  return win;
}

async function openSummarize(collectionID: number): Promise<SummarizeWindow> {
  const commands = pluginInstance()?.api.summarizeWindow;
  if (!commands) assert.fail("registerUI() published no api.summarizeWindow");
  const win = commands.open(
    Zotero.getMainWindow(),
    collectionID,
  ) as unknown as SummarizeWindow;
  await waitUntil(
    () =>
      win.document?.readyState === "complete" &&
      win.RHSummarizeWindow?.state.initialized === true,
    "the summarize window to initialize",
  );
  await waitUntil(
    () =>
      clean(win.document.getElementById("rh-summarize-header")?.textContent)
        .length > 0,
    "the summarize window's header",
  );
  return win;
}

async function openReport(collectionID: number): Promise<ReportWindow> {
  const commands = pluginInstance()?.api.reportWindow;
  if (!commands) assert.fail("registerUI() published no api.reportWindow");
  const win = commands.open(
    Zotero.getMainWindow(),
    collectionID,
  ) as unknown as ReportWindow;
  await waitUntil(
    () =>
      win.document?.readyState === "complete" &&
      win.RHReportWindow?.state.initialized === true,
    "the report window to initialize",
  );
  await win.RHReportWindow?.ready;
  await delay(250);
  return win;
}

async function openPreferencesPane(): Promise<Window> {
  const opened = Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
  if (opened === null) assert.fail("openPreferences returned no window");
  await waitUntil(
    () =>
      (opened as PrefsWindow).Zotero_Preferences?.panes?.get(
        PREFERENCES_PANE_ID,
      )?.loaded === true,
    "the pane to finish loading",
  );
  const root = opened.document.getElementById(PREFERENCES_ROOT_ID);
  await waitUntil(
    () => root?.getAttribute("data-rh-initialized") === "true",
    "the pane's controller to initialise",
  );
  await delay(250);
  return opened;
}

async function closed(win: Window, what: string): Promise<void> {
  await waitUntil(() => win.closed, `${what} to close`);
  await delay(150);
}

/** Every open window whose document is `url`. */
function windowsAt(url: string): Window[] {
  const open: Window[] = [];
  const windows = Services.wm.getEnumerator(
    null as unknown as string,
  ) as unknown as Iterable<Window>;
  for (const candidate of windows) {
    if (!candidate.closed && candidate.location.href === url) {
      open.push(candidate);
    }
  }
  return open;
}

/** The host `open*Dialog` is given: the main window, with the window it opened kept. */
function recordingHost(): {
  host: {
    openDialog(
      url?: string,
      name?: string,
      features?: string,
      ...extra: unknown[]
    ): unknown;
  };
  opened: () => Window | undefined;
} {
  let opened: Window | undefined;
  const main = Zotero.getMainWindow();
  return {
    host: {
      openDialog(url, name, features, ...extra) {
        opened = main.openDialog(url, name, features, ...extra) as Window;
        return opened;
      },
    },
    opened: () => opened,
  };
}

async function loaded(win: Window, global: string): Promise<void> {
  await waitUntil(
    () =>
      win.document?.readyState === "complete" &&
      (win as unknown as Record<string, { state?: { initialized?: boolean } }>)[
        global
      ]?.state?.initialized === true,
    `${global}.init() to have run`,
  );
  await (win.document as unknown as { l10n?: { ready?: Promise<void> } }).l10n
    ?.ready;
  await delay(250);
}

/**
 * A `<dialog>`'s buttons show, and are named by, the labels its script set
 * from Fluent in `buttonlabelaccept` / `buttonlabelcancel`, not the
 * platform's "OK" and "Cancel".
 */
async function assertButtonLabels(
  win: Window,
  where: string,
  names: readonly string[] = ["accept", "cancel"],
): Promise<void> {
  const dialog = win.document.querySelector("dialog") as
    (Element & { getButton(name: string): Element | null }) | null;
  if (dialog === null) assert.fail(`${where}: no <dialog>`);
  await waitUntil(
    () =>
      names.every(
        (name) => (dialog.getAttribute(`buttonlabel${name}`) ?? "") !== "",
      ),
    `${where}: the script to set its button labels`,
  );
  await delay(100);
  for (const name of names) {
    const wanted = dialog.getAttribute(`buttonlabel${name}`) ?? "";
    const button = dialog.getButton(name);
    const shown = button === null ? "" : accessibleName(button);
    log(`${where}: ${name} button "${shown}", set from Fluent "${wanted}"`);
    assert.strictEqual(
      shown,
      wanted,
      `${where}: the ${name} button carries the label its script set`,
    );
  }
}

/* ------------------------------------------------------- the spec */

describe("P7-T06: keyboard, focus, accessible names and contrast (NFR-13)", function () {
  let locale: UILocaleSnapshot | undefined;
  let collection: Zotero.Collection | undefined;
  let item: Zotero.Item | undefined;
  let themeBefore: number | undefined;

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    locale = await pinUILocale(["en-US"], log);
    themeBefore = Services.prefs.prefHasUserValue(THEME_PREF)
      ? Services.prefs.getIntPref(THEME_PREF)
      : undefined;
    collection = new Zotero.Collection({
      libraryID: Zotero.Libraries.userLibraryID,
      name: `${TAG} accessibility`,
    });
    await collection.saveTx();
    item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", `${TAG} paper`);
    item.setField("abstractNote", `${TAG} synthetic abstract.`);
    item.setField("date", "2024");
    item.setCollections([collection.id]);
    await item.saveTx();
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (themeBefore === undefined) {
      Services.prefs.clearUserPref(THEME_PREF);
    } else {
      Services.prefs.setIntPref(THEME_PREF, themeBefore);
    }
    for (const pref of FORCED_COLORS_PREFS) {
      if (Services.prefs.prefHasUserValue(pref.name)) {
        Services.prefs.clearUserPref(pref.name);
      }
    }
    for (const url of [COST_DIALOG_URL, SECRET_BACKEND_DIALOG_URL]) {
      for (const win of windowsAt(url)) win.close();
    }
    await item?.eraseTx();
    await collection?.eraseTx();
    if (locale !== undefined) await restoreUILocale(locale, log);
  });

  it("Search & Import: Tab reaches every control with a name and a ring; Enter in the keyword field searches; Escape closes", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const win = await openSearch();
    await activate(win);
    const root = win.document.documentElement as Element;
    await assertButtonLabels(win, "Search & Import");
    assertKeyboardAndNames(win, root, "Search & Import (keyword)");

    const controller = win.RHSearchWindow;
    if (!controller) assert.fail("no RHSearchWindow");
    const keyword = win.document.getElementById("rh-search-keyword");
    if (keyword === null) assert.fail("no keyword field");
    let searches = 0;
    const search = controller.search;
    controller.search = () => {
      searches += 1;
    };
    try {
      focusManager().setFocus(keyword, focusManager().FLAG_BYKEY);
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(searches, 1, "Enter in the keyword field searches");
    } finally {
      controller.search = search;
    }
    pressKey(win, "Escape", ESCAPE);
    await closed(win, "the search window");
    log("Search & Import: Enter searched once; Escape closed the idle window");
  });

  it("Summarize: Tab reaches every control with a name and a ring; Enter starts; Escape cancels a run, then closes", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (collection === undefined) assert.fail("no collection");
    const win = await openSummarize(collection.id);
    await activate(win);
    assertKeyboardAndNames(
      win,
      win.document.documentElement as Element,
      "Summarize",
    );
    const controller = win.RHSummarizeWindow;
    if (!controller) assert.fail("no RHSummarizeWindow");
    const resummarize = win.document.getElementById("rh-summarize-resummarize");
    if (resummarize === null) assert.fail("no re-summarize box");

    const start = controller.start;
    const cancel = controller.cancel;
    let starts = 0;
    let cancels = 0;
    controller.start = () => {
      starts += 1;
    };
    controller.cancel = () => {
      cancels += 1;
      controller.state.running = false;
    };
    try {
      focusManager().setFocus(resummarize, focusManager().FLAG_BYKEY);
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 1, "Enter on a box starts the run");

      // A run going: Enter does not start a second; Escape cancels it and
      // the window stays.
      controller.state.running = true;
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 1, "Enter while a run goes starts nothing");
      pressKey(win, "Escape", ESCAPE);
      await delay(150);
      assert.strictEqual(cancels, 1, "Escape cancels the running job");
      assert.isFalse(win.closed, "the first Escape leaves the window open");
    } finally {
      controller.start = start;
      controller.cancel = cancel;
      controller.state.running = false;
    }
    pressKey(win, "Escape", ESCAPE);
    await closed(win, "the summarize window");

    // Enter on a button is the button's own: on Close, it closes the window
    // and starts nothing.
    const again = await openSummarize(collection.id);
    await activate(again);
    const second = again.RHSummarizeWindow;
    if (!second) assert.fail("no RHSummarizeWindow");
    const secondStart = second.start;
    let secondStarts = 0;
    second.start = () => {
      secondStarts += 1;
    };
    const close = again.document.getElementById("rh-summarize-close");
    if (close === null) assert.fail("no Close button");
    focusManager().setFocus(close, focusManager().FLAG_BYKEY);
    pressKey(again, "Enter", ENTER);
    await closed(again, "the summarize window, by Enter on Close");
    assert.strictEqual(secondStarts, 0, "Enter on Close starts nothing");
    second.start = secondStart;
    log("Summarize: Enter started once; Escape cancelled, then closed");
  });

  it("Report: Tab reaches every control with a name and a ring; Enter generates; Escape cancels a run, then closes", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (collection === undefined) assert.fail("no collection");
    const win = await openReport(collection.id);
    await activate(win);
    await assertButtonLabels(win, "Report", ["cancel"]);
    assertKeyboardAndNames(
      win,
      win.document.documentElement as Element,
      "Report",
    );
    const controller = win.RHReportWindow;
    if (!controller) assert.fail("no RHReportWindow");
    const language = win.document.getElementById("rh-report-language");
    const generate = win.document.getElementById("rh-report-generate") as
      (Element & { disabled: boolean }) | null;
    if (language === null || generate === null) assert.fail("no controls");

    const start = controller.start;
    const cancel = controller.cancel;
    const wasDisabled = generate.disabled;
    let starts = 0;
    let cancels = 0;
    controller.start = () => {
      starts += 1;
    };
    controller.cancel = () => {
      cancels += 1;
      controller.state.running = false;
    };
    const cancelAudio = controller.cancelAudio;
    let audioCancels = 0;
    controller.cancelAudio = () => {
      audioCancels += 1;
      controller.state.audioRunning = false;
    };
    try {
      // Generate's state is the host's (a configured provider); the key
      // press is measured on both.
      generate.disabled = true;
      focusManager().setFocus(generate, focusManager().FLAG_BYKEY);
      const body = win.document.getElementById("rh-report-model");
      focusManager().clearFocus(win);
      if (body !== null) (body as HTMLElement).focus?.();
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 0, "Enter does nothing while Generate is off");
      generate.disabled = false;
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 1, "Enter is Generate when it is on");
      focusManager().setFocus(language, focusManager().FLAG_BYKEY);
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 1, "Enter on the list is the list's own");

      controller.state.running = true;
      focusManager().clearFocus(win);
      pressKey(win, "Enter", ENTER);
      await delay(100);
      assert.strictEqual(starts, 1, "Enter while a report runs starts nothing");
      pressKey(win, "Escape", ESCAPE);
      await delay(150);
      assert.strictEqual(cancels, 1, "Escape cancels the running report");
      assert.isFalse(win.closed, "the first Escape leaves the window open");

      // Audio being made (P6): Escape stops the audio, and the window stays.
      controller.state.audioRunning = true;
      pressKey(win, "Escape", ESCAPE);
      await delay(150);
      assert.strictEqual(audioCancels, 1, "Escape cancels the audio run");
      assert.strictEqual(cancels, 1, "and not the report");
      assert.isFalse(win.closed, "the window stays while audio is stopped");
    } finally {
      controller.start = start;
      controller.cancel = cancel;
      controller.cancelAudio = cancelAudio;
      controller.state.audioRunning = false;
      controller.state.running = false;
      generate.disabled = wasDisabled;
    }
    pressKey(win, "Escape", ESCAPE);
    await closed(win, "the report window");
    log("Report: Enter generated once; Escape cancelled, then closed");
  });

  it("the cost dialog (ceiling moment): Tab reaches its controls with names; Enter and Escape both stop", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const model = buildCostDialogModel(
      {
        mode: "ceiling",
        stop: {
          ceiling: "run",
          limitUsd: 0.01,
          spentUsd: 0.01,
          projectedUsd: 0.12,
          runSpentUsd: 0.01,
        },
        remainingUsd: 0.1,
        raiseToUsd: 0.25,
        usage: { run: ZERO_SPEND, session: ZERO_SPEND },
      },
      "en-US",
    );
    log(`cost dialog features: ${COST_DIALOG_FEATURES}`);
    for (const [key, code] of [
      ["Enter", ENTER],
      ["Escape", ESCAPE],
    ] as const) {
      const recording = recordingHost();
      const outcome: Promise<CostDialogOutcome> = openCostConfirmDialog(
        recording.host,
        model,
      );
      const win = recording.opened();
      if (win === undefined) assert.fail("no cost dialog");
      await loaded(win, "RHCostDialog");
      await activate(win);
      if (key === "Enter") {
        await assertButtonLabels(win, "cost dialog (ceiling)");
        assertKeyboardAndNames(
          win,
          win.document.documentElement as Element,
          "cost dialog (ceiling)",
        );
      }
      focusManager().clearFocus(win);
      pressKey(win, key, code);
      const answer = await outcome;
      log(`cost dialog: ${key} → ${JSON.stringify(answer)}`);
      assert.strictEqual(
        answer.kind,
        "stop",
        `${key} on the untouched dialog stops the run (defaultButton="cancel")`,
      );
      await closed(win, "the cost dialog");
    }
  });

  it("the key-storage dialog: Tab reaches its buttons with names; Enter and Escape both store nothing", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    for (const [key, code] of [
      ["Enter", ENTER],
      ["Escape", ESCAPE],
    ] as const) {
      const recording = recordingHost();
      const choice = openSecretBackendDialog(recording.host);
      const win = recording.opened();
      if (win === undefined) assert.fail("no key-storage dialog");
      await loaded(win, "RHSecretBackendDialog");
      await activate(win);
      if (key === "Enter") {
        await assertButtonLabels(win, "key-storage dialog");
        assertKeyboardAndNames(
          win,
          win.document.documentElement as Element,
          "key-storage dialog",
        );
      }
      focusManager().clearFocus(win);
      pressKey(win, key, code);
      assert.strictEqual(await choice, "none", `${key} stores nothing`);
      await closed(win, "the key-storage dialog");
    }
  });

  it("the preferences pane: Tab reaches every control of the plugin's pane, each with a name and a ring", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const win = await openPreferencesPane();
    try {
      await activate(win);
      const root = win.document.getElementById(PREFERENCES_ROOT_ID);
      if (root === null) assert.fail("no pane root");
      assertKeyboardAndNames(win, root, "preferences pane");
      for (const box of root.querySelectorAll("groupbox")) {
        assert.isTrue(
          accessibleName(box) !== "",
          `groupbox #${box.id} is named by its heading`,
        );
      }
    } finally {
      win.close();
      await closed(win, "the preferences window");
    }
  });

  it("the item pane's section: its header has a name, and every shown button in it too", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (item === undefined) assert.fail("no item");
    const main = Zotero.getMainWindow();
    const pane = main.ZoteroPane as unknown as {
      selectItem(id: number, inLibraryRoot?: boolean): Promise<unknown>;
    };
    await pane.selectItem(item.id, true);
    const paneID = (
      main as unknown as { CSS: { escape(s: string): string } }
    ).CSS.escape(`${config.addonID}-rh-itempane-summary`);
    let section: Element | undefined;
    await waitUntil(() => {
      section = [
        ...main.document.querySelectorAll("item-pane-custom-section"),
      ].find(
        (element) =>
          (element as HTMLElement).dataset.pane === paneID &&
          !(element as HTMLElement).hidden,
      );
      return section !== undefined;
    }, "the summary section to be drawn");
    const head = section?.querySelector("collapsible-section .head");
    const name = head ? accessibleName(head) : "";
    log(`item pane section header: "${name}"`);
    assert.isTrue(name !== "", "the section header has an accessible name");
    const buttons = [...(section?.querySelectorAll("button") ?? [])].filter(
      (button) => isShown(button),
    );
    for (const button of buttons) {
      assert.isTrue(
        accessibleName(button) !== "",
        `${describeControl(button)} in the section has a name`,
      );
    }
    log(
      `item pane section: ${String(buttons.length)} shown buttons, each named: ` +
        buttons
          .map((b) => `${describeControl(b)} "${accessibleName(b)}"`)
          .join(", "),
    );
  });

  it("contrast: every text colour the plugin sets is at least 4.5:1 in Zotero's light and dark appearance", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (collection === undefined) assert.fail("no collection");
    const search = await openSearch();
    const report = await openReport(collection.id);
    const prefs = await openPreferencesPane();
    const failures: string[] = [];
    try {
      const prefsRoot = prefs.document.getElementById(PREFERENCES_ROOT_ID);
      if (prefsRoot === null) assert.fail("no pane root");
      for (const [theme, value] of [
        ["light", THEME_LIGHT],
        ["dark", THEME_DARK],
      ] as const) {
        await setTheme(search, value);
        await setTheme(report, value);
        await setTheme(prefs, value);
        for (const [where, win, parent, probes] of [
          [
            "Search & Import",
            search,
            search.document.getElementById("rh-search-dialog"),
            SEARCH_PROBES,
          ],
          [
            "Report",
            report,
            report.document.getElementById("rh-report-dialog"),
            REPORT_PROBES,
          ],
          ["Preferences", prefs, prefsRoot, PREFS_PROBES],
        ] as const) {
          if (parent === null) assert.fail(`${where}: no probe parent`);
          const rootStyle = win.getComputedStyle(
            win.document.documentElement as Element,
          );
          const canvas = canvasOf(win);
          log(
            `appearance ${theme} | ${where} | prefers-color-scheme dark ` +
              `${String(win.matchMedia("(prefers-color-scheme: dark)")?.matches === true)}; ` +
              `root color-scheme "${rootStyle?.getPropertyValue("color-scheme") ?? ""}", ` +
              `root text ${rootStyle?.color ?? "?"}, root background ` +
              `${rootStyle?.backgroundColor ?? "?"}, Canvas rgb(${canvas
                .slice(0, 3)
                .map((c) => Math.round(c))
                .join(", ")})`,
          );
          for (const result of measure(win, parent, probes)) {
            log(
              `contrast ${theme} | ${where} | ${result.name} | ${result.fg} on ${result.bg} | ${result.ratio.toFixed(2)}:1`,
            );
            if (result.ratio < AA_RATIO) {
              failures.push(
                `${theme} ${where} ${result.name} ${result.ratio.toFixed(2)}`,
              );
            }
          }
        }
      }

      // docs/08 §9's marker: does forced-colours mode reach the plugin's
      // windows? Observed, not asserted.
      for (const pref of FORCED_COLORS_PREFS) {
        Services.prefs.setIntPref(pref.name, pref.value);
        await delay(500);
        const forced =
          search.matchMedia("(forced-colors: active)")?.matches === true;
        const badge = measure(
          search,
          search.document.getElementById("rh-search-dialog") as Element,
          [{ name: "in-library badge", className: "rh-existing-badge" }],
        )[0];
        log(
          `forced colours (${pref.name}=${String(pref.value)}): ` +
            `(forced-colors: active) ${String(forced)} in the search window; ` +
            `in-library badge text ${badge?.fg ?? "?"} on ${badge?.bg ?? "?"}`,
        );
        Services.prefs.clearUserPref(pref.name);
        await delay(250);
      }
    } finally {
      for (const pref of FORCED_COLORS_PREFS) {
        if (Services.prefs.prefHasUserValue(pref.name)) {
          Services.prefs.clearUserPref(pref.name);
        }
      }
      if (themeBefore === undefined) {
        Services.prefs.clearUserPref(THEME_PREF);
      } else {
        Services.prefs.setIntPref(THEME_PREF, themeBefore);
      }
      search.close();
      report.close();
      prefs.close();
      await closed(search, "the search window");
      await closed(report, "the report window");
      await closed(prefs, "the preferences window");
    }
    assert.deepEqual(
      failures,
      [],
      "every plugin text colour is at least 4.5:1",
    );
  });
});

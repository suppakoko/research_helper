/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P3-T28`: the item pane's AI summary section, inside a real Zotero.
 *
 * What it asserts, against the card's `Done when`:
 *
 * 1. One section is registered, under the plugin id, with Zotero's
 *    namespaced pane id, and both its observer and the section are in the
 *    plugin's scope.
 * 2. An attachment hides the section; a note does not show it; a regular
 *    item shows it. (An annotation is not exercised: it needs a PDF.)
 * 3. An item with a stored summary renders its fields, model and time, and
 *    the collapsed header carries the derived gist — and markup in the
 *    stored summary shows as text: no element is created from it.
 * 4. With no key, Generate is shown disabled, the Preferences button is
 *    present, and the plugin sends zero requests.
 * 5. Twenty selections with `autoSummarize` off call Generate zero times and
 *    send zero plugin requests.
 * 6. Generate, Cancel-free failure and Retry, through the product's own
 *    binding (owner, `plan/00` §6 item 303(a)) with a fake provider: the
 *    loading state, the cost dialog (accepted here, with no "don't ask again"
 *    box), the redacted error, and the stored summary after success — and no
 *    request leaves Zotero.
 * 7. Trashing an item invalidates its `work:<workKey>` cache tag.
 * 8. Five disable/enable cycles leave no registered section and no live
 *    observer: after each disable nothing is registered and the scope is
 *    empty, and after the fifth enable a trash reaches the current graph
 *    only — never a torn-down one.
 *
 * Step 5 puts a counting fake on the published host (`api.summarySection`,
 * which the section reads on every use) and restores it. Step 6 keeps the
 * host's real `generate` — `publishSummarySection`'s one-item run of the
 * summarize pipeline — behind a spy, and fakes only the active provider's
 * adapter (`registry.get`) and the key check (`secrets.has`), both restored.
 * No model is called, and no key is read or written: "no key" is the host's
 * `isConfigured` answering `false`, and "a key" is `has` answering `true`.
 *
 * **Corrected 2026-10-29 (item 303).** Step 6 failed 3 of 3 runs on "the
 * redaction mark is shown": its fake rejected with an `Error` made in this
 * spec's global, which fails the plugin's `instanceof Error`, so
 * `failureText` showed nothing. `failureText` now reads any error-shaped
 * object's message. Item B also gains an abstract: through the real binding,
 * an item with no text is skipped with no call (FR-21), which a fake
 * `generate` never noticed.
 *
 * **Changed 2026-11-17 (owner, `plan/00` §6 items 389(f), 392(a);
 * `P7-T03` step 5).** The banner no longer draws the failure's text, even
 * redacted: step 6 now asserts that neither the planted key, the provider's
 * text nor a redaction mark is drawn, and that the code line holds machine
 * values only.
 *
 * **Unmeasured platform behaviour this spec relies on** (first run: the
 * build/Zotero owner's): `ZoteroPane.selectItem` driving the library item
 * pane; the item pane not being collapsed in the runner's profile;
 * `item-details.scrollToPane` bringing the section into view so that
 * `onAsyncRender` runs; `Zotero.ItemPaneManager.customSectionData`; and the
 * section element being removed when a registration is withdrawn while an
 * item is selected. Each wait fails with a message naming what it waited for.
 *
 * Asserts on `data-l10n-id`s and classes, never on English text, so the
 * runner's `ko-KR` default needs no locale pin.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import { encodeTagValue } from "../../../src/core/cache/keys";
import type { ChatResponse, LLMProvider } from "../../../src/llm/types";
import {
  deriveTldr,
  PAPER_SUMMARY_SCHEMA_VERSION,
  type PaperSummary,
  type StoredSummary,
} from "../../../src/model/summary";
import { COST_DIALOG_URL } from "../../../src/ui/dialogs/costConfirmDialog";
import {
  REGENERATE_BUTTON,
  SUMMARY_NOTIFIER_DESCRIPTION,
  SUMMARY_PANE_ID,
  SUMMARY_SECTION_DESCRIPTION,
  SUMMARY_SECTION_L10N,
  SUMMARY_SECTION_PARTS,
  failureText,
  truncateGist,
  type SummaryGenerateRun,
  type SummarySectionHost,
} from "../../../src/ui/panes/summarySection";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { createSummaryStore } from "../../../src/zotero/db";
import { collectionsOfItem } from "../../../src/zotero/notes";
import { chatResponse, mockModel } from "../../helpers/mockLLM";
import { PLUGIN_USER_AGENT_PREFIX } from "../support/startupRequests";

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
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 20_000;
const CYCLES = 5;
const TAG = `p3t28-${String(Date.now())}`;
const KEY_A = `test:${TAG}-a`;
const KEY_B = `test:${TAG}-b`;
const KEY_C = `test:${TAG}-c`;
/** SYNTHETIC: key-shaped so `redact` must remove it; no real key. */
const PLANTED = `sk-or-v1-${"0".repeat(40)}`;
const MARKUP = '<img src="x" onerror="void 0"><b>bold</b>';

function log(line: string): void {
  debug(`[P3-T28] ${line}`);
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
    await delay(50);
  }
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

async function initializedInstance(): Promise<Addon> {
  await waitUntil(
    () => pluginInstance()?.data.initialized === true,
    `Zotero.${config.addonInstance}.data.initialized`,
  );
  return pluginInstance()!;
}

/* ------------------------------------------------------------ platform */

interface SectionOption {
  readonly paneID: string;
  readonly pluginID: string;
}

/** This plugin's registered sections, as Zotero holds them. */
function registeredSections(): SectionOption[] {
  const data = (
    Zotero.ItemPaneManager as unknown as {
      customSectionData: { options: SectionOption[] };
    }
  ).customSectionData;
  return data.options.filter((option) => option.pluginID === config.addonID);
}

function mainWindow(): _ZoteroTypes.MainWindow {
  const win = Zotero.getMainWindow();
  if (!win) assert.fail("no main window");
  return win;
}

/** `CSS.escape(pluginID + "-" + paneID)`, Zotero's namespacing. */
function namespacedPaneID(win: _ZoteroTypes.MainWindow): string {
  return (win as unknown as { CSS: { escape(s: string): string } }).CSS.escape(
    `${config.addonID}-${SUMMARY_PANE_ID}`,
  );
}

interface ItemDetails extends HTMLElement {
  scrollToPane?(paneID: string, behavior?: string): Promise<unknown>;
  _collapsed?: boolean;
}

function itemDetails(win: _ZoteroTypes.MainWindow): ItemDetails {
  const details = win.document.getElementById("zotero-item-details");
  if (!details) assert.fail("#zotero-item-details not found");
  return details as ItemDetails;
}

/** The section in the library item pane, or `null` while it is not drawn. */
function librarySection(win: _ZoteroTypes.MainWindow): HTMLElement | null {
  const paneID = namespacedPaneID(win);
  const details = itemDetails(win);
  for (const element of win.document.querySelectorAll(
    "item-pane-custom-section",
  )) {
    const html = element as HTMLElement;
    if (html.dataset.pane === paneID && details.contains(html)) return html;
  }
  return null;
}

function sectionPart(
  section: HTMLElement,
  name: keyof typeof SUMMARY_SECTION_PARTS,
): HTMLElement | null {
  return section.querySelector<HTMLElement>(`.${SUMMARY_SECTION_PARTS[name]}`);
}

function isShown(element: HTMLElement | null): boolean {
  if (!element || element.hidden) return false;
  const check = (element as { checkVisibility?: () => boolean })
    .checkVisibility;
  return typeof check === "function" ? check.call(element) : true;
}

/** Select an item in the library and bring the section into view. */
async function select(
  win: _ZoteroTypes.MainWindow,
  itemID: number,
): Promise<void> {
  const pane = win.ZoteroPane as unknown as {
    selectItem(id: number, inLibraryRoot?: boolean): Promise<unknown>;
  };
  await pane.selectItem(itemID, true);
  const details = itemDetails(win);
  await waitUntil(
    () => (details as unknown as { item?: { id: number } }).item?.id === itemID,
    `the item pane to show item ${String(itemID)}`,
  );
  const section = librarySection(win);
  if (
    section &&
    !section.hidden &&
    typeof details.scrollToPane === "function"
  ) {
    await details.scrollToPane(namespacedPaneID(win), "instant");
  }
}

/* -------------------------------------------------------------- requests */

const observerService = Services.obs as unknown as {
  addObserver(observer: unknown, topic: string): void;
  removeObserver(observer: unknown, topic: string): void;
};

interface ObservedChannel {
  readonly URI?: { readonly spec?: string };
  getRequestHeader?(name: string): string;
}

function httpChannel(subject: unknown): ObservedChannel {
  const queryInterface = (subject as { QueryInterface?: unknown })
    .QueryInterface;
  if (typeof queryInterface !== "function") return subject as ObservedChannel;
  try {
    return (queryInterface as (iid: unknown) => unknown).call(
      subject,
      Components.interfaces.nsIHttpChannel,
    ) as ObservedChannel;
  } catch {
    return subject as ObservedChannel;
  }
}

/** The plugin's own requests (its `User-Agent`, D10) while `body` runs. */
async function pluginRequestsDuring(
  body: () => Promise<void>,
): Promise<string[]> {
  const seen: string[] = [];
  const observer = {
    observe(subject: unknown): void {
      try {
        const channel = httpChannel(subject);
        let agent = "";
        try {
          agent = channel.getRequestHeader?.("User-Agent") ?? "";
        } catch {
          agent = "";
        }
        if (agent.startsWith(PLUGIN_USER_AGENT_PREFIX)) {
          seen.push(channel.URI?.spec ?? "(no url)");
        }
      } catch {
        // An observer that throws must not fail the measurement it serves.
      }
    },
  };
  observerService.addObserver(observer, "http-on-modify-request");
  try {
    await body();
    await delay(250);
    return seen;
  } finally {
    observerService.removeObserver(observer, "http-on-modify-request");
  }
}

/* -------------------------------------------------------------- fixtures */

/** SYNTHETIC: the sentence the fake model quotes, so its finding is grounded. */
const QUOTE =
  "The synthetic intervention reduced the synthetic outcome by 42 percent.";
/**
 * SYNTHETIC: item B's abstract, longer than `summary.minAbstractChars` (250)
 * so acquisition keeps it; a shorter one is Tier 4 and is skipped with no call.
 */
const SYNTHETIC_ABSTRACT =
  "Background: this is a synthetic study written for an integration test, " +
  "with no real participants, data or findings. Methods: a made-up " +
  "intervention was compared with a made-up control over a made-up period, " +
  `using made-up instruments at every visit. Results: ${QUOTE} ` +
  "Conclusion: nothing here describes a real study.";

async function regularItem(
  title: string,
  workKey: string,
  abstract?: string,
): Promise<number> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setField("extra", `rh-work-key: ${workKey}`);
  if (abstract !== undefined) item.setField("abstractNote", abstract);
  await item.saveTx();
  return item.id;
}

/** The fake model's answer: a valid `PaperSummary`, SYNTHETIC. */
function summaryJson(question: string): string {
  const summary: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey: "SYNTHETI",
    sourceTier: "abstract",
    confidence: "medium",
    researchQuestion: question,
    studyDesign: { label: "other", detail: null },
    population: { kind: "not_applicable", description: null, size: null },
    methods: ["synthetic method"],
    keyFindings: [
      {
        statement: "The synthetic intervention reduced the synthetic outcome.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: QUOTE,
      },
    ],
    effectSizes: [],
    limitations: ["Synthetic data."],
    novelty: null,
    keywords: ["synthetic"],
    researchTheme: null,
    citationWorthiness: { score: 10, reason: "Synthetic." },
  };
  return JSON.stringify(summary);
}

/** Put a preference back as it was (cleared when it had no user value). */
function restorePref(name: string, before: unknown): void {
  if (before === undefined) {
    Zotero.Prefs.clear(name, true);
  } else {
    Zotero.Prefs.set(name, before as string | number | boolean, true);
  }
}

interface CostDialogWindow extends Window {
  RHCostDialog?: {
    state: { initialized: boolean; reported: boolean };
    updateAccept(): void;
  };
}

/** `P3-T16`'s cost dialogs that are open now. */
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

/**
 * Accept the cost dialog the run raised, as a user would: tick the second
 * acknowledgement when the dialog asks for it, then Run. Asserts that a run
 * over no collection offers no "don't ask again" box (item 303(a)).
 */
async function acceptCostDialog(): Promise<void> {
  let dialogWindow: CostDialogWindow | undefined;
  await waitUntil(() => {
    dialogWindow = costDialogs().find(
      (candidate) =>
        candidate.RHCostDialog?.state.initialized === true &&
        !candidate.RHCostDialog.state.reported,
    );
    return dialogWindow !== undefined;
  }, "the cost dialog to open").catch((error: unknown) => {
    // What was open instead, for the log: window documents only, no content.
    const hrefs: string[] = [];
    const windows = Services.wm.getEnumerator(
      null as unknown as string,
    ) as unknown as Iterable<Window>;
    for (const candidate of windows) hrefs.push(candidate.location.href);
    log(`no cost dialog; open windows: ${hrefs.join(" | ")}`);
    throw error;
  });
  const shown = dialogWindow!;
  const doc = shown.document;
  const dontAsk = doc.getElementById("rh-cost-dont-ask") as {
    hidden: boolean;
  } | null;
  assert.isTrue(
    dontAsk === null || dontAsk.hidden,
    "no 'don't ask again' box for a run over no collection",
  );
  const acknowledge = doc.getElementById("rh-cost-acknowledge") as {
    hidden: boolean;
    checked: boolean;
  } | null;
  if (acknowledge !== null && !acknowledge.hidden) {
    acknowledge.checked = true;
    shown.RHCostDialog?.updateAccept();
  }
  log(
    `cost dialog: acknowledgement ${acknowledge?.hidden === false ? "asked" : "not asked"}`,
  );
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

function storedRow(workKey: string, question: string): StoredSummary {
  return {
    id: `${workKey}:1.0.0:synthetic/model-x`,
    workKey,
    content: {
      schemaVersion: "paper-summary-v1",
      itemKey: "SYNTHETIC",
      sourceTier: "abstract",
      confidence: "medium",
      researchQuestion: question,
      studyDesign: { label: "other", detail: null },
      population: { kind: "not_applicable", description: null, size: null },
      methods: [],
      keyFindings: [
        {
          statement: `Synthetic finding ${MARKUP}`,
          direction: "descriptive",
          evidenceStrength: "unclear",
          verbatimSupport: null,
        },
      ],
      effectSizes: [],
      limitations: ["A synthetic limitation."],
      novelty: null,
      keywords: [],
      researchTheme: null,
      citationWorthiness: { score: 0.1, reason: "synthetic" },
    },
    inputScope: { kind: "abstract" },
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptVersion: "1.0.0",
    providerId: "openrouter",
    modelId: "synthetic/model-x",
    temperature: 0,
    usage: undefined,
    generatedAtEpochMs: Date.now(),
    sourceItemVersion: undefined,
    contentHash: "0".repeat(64),
    truncated: false,
    groundingScore: undefined,
    warnings: [],
    redaction: { partlyRedacted: false, redactedStrings: 0, droppedFields: 0 },
  };
}

/** A host member swapped for one test, and put back. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* --------------------------------------------------------------- the spec */

describe("P3-T28 item-pane AI summary section", function () {
  let instance: Addon;
  let win: _ZoteroTypes.MainWindow;
  let database: {
    queryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  };
  const created: number[] = [];
  let itemA = 0;
  let itemB = 0;
  let itemC = 0;
  let attachment = 0;
  let note = 0;

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    instance = await initializedInstance();
    win = mainWindow();
    await waitUntil(
      () => instance.api.provenance !== undefined,
      "api.provenance (the plugin database)",
    );
    database = instance.api.provenance!.database as unknown as typeof database;

    itemA = await regularItem(`RH ${TAG} A`, KEY_A);
    itemB = await regularItem(`RH ${TAG} B`, KEY_B, SYNTHETIC_ABSTRACT);
    itemC = await regularItem(`RH ${TAG} C`, KEY_C);
    created.push(itemA, itemB, itemC);

    const child = new Zotero.Item("note");
    child.libraryID = Zotero.Libraries.userLibraryID;
    child.parentID = itemA;
    child.setNote(`<p>RH ${TAG} note</p>`);
    await child.saveTx();
    note = child.id;
    created.push(note);

    const linked = await Zotero.Attachments.linkFromURL({
      url: "https://example.invalid/p3t28",
      parentItemID: itemA,
      title: `RH ${TAG} attachment`,
    });
    attachment = linked.id;
    created.push(attachment);

    const store = createSummaryStore(
      instance.api.provenance!.database as Parameters<
        typeof createSummaryStore
      >[0],
    );
    await store.put(storedRow(KEY_A, `Question A ${MARKUP}`));
    log(`fixtures: A=${String(itemA)} B=${String(itemB)} C=${String(itemC)}`);
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    try {
      const live = pluginInstance()?.api.provenance?.database as
        typeof database | undefined;
      await (live ?? database)?.queryAsync(
        "DELETE FROM summary WHERE work_key LIKE ?",
        [`test:${TAG}%`],
      );
    } catch (error) {
      log(`cleanup of summary rows failed: ${String(error)}`);
    }
    try {
      await (
        pluginInstance()?.api.services?.cache as
          { invalidateByTag(tag: string): Promise<number> } | undefined
      )?.invalidateByTag(`work:${encodeTagValue(KEY_B)}`);
    } catch (error) {
      log(`cleanup of B's cached answers failed: ${String(error)}`);
    }
    const ids = created.filter((id) => Zotero.Items.get(id));
    if (ids.length > 0) await Zotero.Items.erase(ids);
  });

  it("registers one section under the plugin id, with its observer, in the plugin's scope", async function () {
    const sections = registeredSections();
    assert.strictEqual(sections.length, 1, "exactly one section registered");
    assert.strictEqual(
      sections[0]?.paneID,
      namespacedPaneID(win),
      "Zotero namespaces the pane id as CSS.escape(pluginID-paneID)",
    );
    const live = instance.scope.liveHandles();
    assert.isTrue(
      live.includes(SUMMARY_SECTION_DESCRIPTION),
      `the section is in the scope (${live.join(" | ")})`,
    );
    assert.isTrue(
      live.includes(SUMMARY_NOTIFIER_DESCRIPTION),
      "the delete/trash observer is in the scope",
    );
  });

  it("shows for a regular item, hides for an attachment, and is not shown for a note", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await select(win, itemB);
    await waitUntil(
      () => librarySection(win)?.hidden === false,
      "the section to be drawn and enabled for a regular item",
    );
    log(`item pane collapsed: ${String(itemDetails(win)._collapsed)}`);

    await select(win, attachment);
    await waitUntil(
      () => librarySection(win)?.hidden === true,
      "setEnabled(false) to hide the section for an attachment",
    );

    const pane = win.ZoteroPane as unknown as {
      selectItem(id: number, inLibraryRoot?: boolean): Promise<unknown>;
    };
    await pane.selectItem(note, true);
    await delay(500);
    assert.isFalse(
      isShown(librarySection(win)),
      "a note shows the note editor, never the section",
    );
  });

  it("renders a stored summary's fields, model and time, the gist, and markup as text", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await select(win, itemA);
    let section: HTMLElement | null = null;
    await waitUntil(() => {
      section = librarySection(win);
      return section !== null && isShown(sectionPart(section, "content"));
    }, "the stored summary to render");
    const shown = section as unknown as HTMLElement;
    const content = sectionPart(shown, "content")!;
    const text = content.textContent ?? "";
    assert.isTrue(
      text.includes(`Question A ${MARKUP}`),
      "the research question, verbatim",
    );
    assert.isTrue(
      text.includes(`Synthetic finding ${MARKUP}`),
      "the key finding, verbatim",
    );
    assert.isTrue(text.includes("A synthetic limitation."), "the limitation");
    assert.strictEqual(
      content.querySelectorAll("img, b, script").length,
      0,
      "no element was created from model output",
    );
    const meta = sectionPart(shown, "meta");
    assert.isTrue(
      (meta?.textContent ?? "").startsWith("synthetic/model-x · "),
      "the model and the time",
    );
    for (const id of [
      SUMMARY_SECTION_L10N.researchQuestion,
      SUMMARY_SECTION_L10N.keyFindings,
      SUMMARY_SECTION_L10N.limitations,
    ]) {
      assert.strictEqual(
        content.querySelectorAll(`[data-l10n-id="${id}"]`).length,
        1,
        `the ${id} heading`,
      );
    }
    const header = shown.querySelector("collapsible-section");
    const expected = truncateGist(
      deriveTldr(storedRow(KEY_A, `Question A ${MARKUP}`).content),
    );
    assert.strictEqual(
      header?.getAttribute("summary"),
      expected,
      "the collapsed header carries the derived gist",
    );
  });

  it("with no key: Generate disabled, the Preferences button present, zero requests", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const host = instance.api.summarySection as Mutable<SummarySectionHost>;
    const original = host.isConfigured;
    host.isConfigured = () => false;
    try {
      const requests = await pluginRequestsDuring(async () => {
        await select(win, itemB);
        await waitUntil(() => {
          const section = librarySection(win);
          return section !== null && isShown(sectionPart(section, "noKey"));
        }, "the no-key state");
      });
      const section = librarySection(win)!;
      const generate = sectionPart(section, "generate") as HTMLButtonElement;
      assert.isTrue(generate.hidden === false, "Generate is shown");
      assert.isTrue(generate.disabled, "Generate is disabled");
      const prefs = sectionPart(section, "openPreferences");
      assert.strictEqual(
        prefs?.getAttribute("data-l10n-id"),
        SUMMARY_SECTION_L10N.openPreferences,
        "the Preferences button is present",
      );
      assert.isTrue(isShown(prefs), "the Preferences button is shown");
      assert.deepEqual(requests, [], "the plugin sent no request");
    } finally {
      host.isConfigured = original;
    }
  });

  it("issues zero Generate calls and zero requests across twenty selections with autoSummarize off", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    assert.strictEqual(
      Zotero.Prefs.get(`${config.prefsPrefix}.autoSummarize`, true),
      false,
      "autoSummarize ships off",
    );
    const host = instance.api.summarySection as Mutable<SummarySectionHost>;
    const originalGenerate = host.generate;
    const originalConfigured = host.isConfigured;
    let calls = 0;
    host.isConfigured = () => true;
    host.generate = (): SummaryGenerateRun => {
      calls += 1;
      return {
        done: new Promise<void>(() => undefined),
        cancel: () => undefined,
      };
    };
    try {
      const requests = await pluginRequestsDuring(async () => {
        for (let i = 0; i < 20; i += 1) {
          await select(win, i % 2 === 0 ? itemB : itemC);
          await delay(50);
        }
        await delay(1_000);
      });
      assert.strictEqual(calls, 0, "Generate was never called");
      assert.deepEqual(requests, [], "the plugin sent no request");
    } finally {
      host.generate = originalGenerate;
      host.isConfigured = originalConfigured;
    }
  });

  it("Generate shows loading, a failure shows the redacted message and Retry, success shows the summary", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // Through the real binding (owner, plan/00 §6 item 303(a)): the host's own
    // `generate` runs the summarize pipeline for item B, with its cost dialog,
    // job record and `llm` pool. Only the provider is fake — the active
    // adapter's `chat` answers from this spec, so no request leaves Zotero —
    // and the key check sees a key that exists nowhere: `has` answers yes for
    // the active provider, and nothing is written to any keystore.
    const host = instance.api.summarySection as Mutable<SummarySectionHost>;
    const graph = instance.api.services!;
    const realGenerate = host.generate;
    if (realGenerate === undefined) {
      assert.fail("the product binds no Generate (item 303(a))");
    }
    const registry = graph.llm.registry as Mutable<typeof graph.llm.registry>;
    const active = registry.activeProviderId();
    const realGet = registry.get;
    const real = realGet.call(registry, active);
    if (!real) assert.fail(`no adapter is registered for ${active}`);
    const secrets = graph.secrets as
      Mutable<NonNullable<typeof graph.secrets>> | undefined;
    const realHas = secrets?.has;
    const keyPresentPref = `${config.prefsPrefix}.${active}.keyPresent`;
    const acknowledgedPref = `${config.prefsPrefix}.privacy.egressAcknowledged`;
    const keyPresentBefore = Zotero.Prefs.get(keyPresentPref, true) as unknown;
    const acknowledgedBefore = Zotero.Prefs.get(
      acknowledgedPref,
      true,
    ) as unknown;

    let answer: ((ok: boolean) => void) | undefined;
    let calls = 0;
    const fake: LLMProvider = {
      id: real.id,
      displayNameKey: real.displayNameKey,
      rateLimitKey: real.rateLimitKey,
      isConfigured: () => true,
      validateCredentials: () => Promise.reject(new Error("not in this spec")),
      listModels: () => Promise.resolve([]),
      getModel: (modelId) =>
        mockModel(modelId, {
          dataPolicy: {
            trainsOnInputByDefault: "no",
            retention: { days: "zero", note: "SYNTHETIC" },
          },
        }),
      chat: () => {
        calls += 1;
        return new Promise<ChatResponse>((resolve, reject) => {
          answer = (ok) => {
            if (!ok) {
              reject(new Error(`HTTP 429 from provider ${PLANTED}`));
              return;
            }
            resolve(chatResponse(summaryJson("Question B")));
          };
        });
      },
      countTokens: (text) => Math.ceil(text.length / 4),
    };
    const regenerates: boolean[] = [];
    // Regenerate's bypass (plan/00 §6 item 305(c)): never Generate's or Retry's.
    const bypasses: (boolean | undefined)[] = [];
    // The host's caught failures, for the log (redacted, as the banner is).
    const realOnError = host.onError;
    host.onError = (message, error) => {
      log(`host.onError: ${message}: ${failureText(error)}`);
      realOnError(message, error);
    };
    host.generate = (item, options) => {
      regenerates.push(options.regenerate);
      bypasses.push(options.bypassCache);
      return realGenerate(item, options);
    };
    registry.get = (id) => (id === active ? fake : realGet.call(registry, id));
    if (secrets !== undefined && realHas !== undefined) {
      secrets.has = (id) =>
        id === `llm.${active}`
          ? Promise.resolve(true)
          : realHas.call(secrets, id);
    }
    Zotero.Prefs.set(keyPresentPref, true, true);

    // Measured, not assumed: whether an Error made here is an `Object` of the
    // plugin's global (the host is a plugin-made object literal).
    const pluginObject = (
      Object.getPrototypeOf(host) as { constructor: ObjectConstructor }
    ).constructor;
    log(
      `an Error from this spec is instanceof the plugin's Object: ${String(
        new Error("probe") instanceof pluginObject,
      )}`,
    );

    try {
      const requests = await pluginRequestsDuring(async () => {
        await select(win, itemB);
        let section: HTMLElement | null = null;
        await waitUntil(() => {
          section = librarySection(win);
          return section !== null && isShown(sectionPart(section, "generate"));
        }, "Generate in the empty state");
        const shown = section as unknown as HTMLElement;
        assert.isTrue(isShown(sectionPart(shown, "empty")), "the empty line");
        sectionPart(shown, "generate")!.click();
        await waitUntil(
          () => isShown(sectionPart(shown, "loading")),
          "the loading state",
        );
        const regenerate = shown.querySelector<HTMLButtonElement>(
          `.${REGENERATE_BUTTON}`,
        );
        assert.isTrue(
          regenerate?.disabled ?? false,
          "Regenerate disabled while running",
        );

        // The cost confirmation applies, as for a collection run.
        await acceptCostDialog();
        await waitUntil(() => calls === 1, "the first (fake) model call");
        assert.isTrue(
          isShown(sectionPart(shown, "loading")),
          "still loading while the call is out",
        );
        answer?.(false);
        await waitUntil(
          () => isShown(sectionPart(shown, "error")),
          "the error state",
        );
        // Machine values only (owner, items 389(f), 392(a); P7-T03 step 5):
        // neither the provider's text nor its redacted form is drawn.
        const banner = sectionPart(shown, "error")?.textContent ?? "";
        const code = sectionPart(shown, "errorCode")?.textContent ?? "";
        log(
          `failure banner: code line "${code}", text id ${String(
            sectionPart(shown, "errorText")?.getAttribute("data-l10n-id"),
          )}`,
        );
        assert.isFalse(banner.includes(PLANTED), "the key is not drawn");
        assert.isFalse(
          banner.includes("from provider"),
          "the provider's text is not drawn",
        );
        assert.isFalse(
          banner.includes("[redacted:"),
          "no redacted free text is drawn",
        );
        assert.isTrue(
          /^(?:[A-Z][A-Z0-9_]*(?: · HTTP \d{3})?)?$/u.test(code),
          "the code line holds machine values only",
        );
        assert.isTrue(isShown(sectionPart(shown, "retry")), "Retry is offered");

        sectionPart(shown, "retry")!.click();
        await waitUntil(
          () => isShown(sectionPart(shown, "loading")),
          "the loading state again",
        );
        await acceptCostDialog();
        await waitUntil(() => calls === 2, "the second (fake) model call");
        answer?.(true);
        await waitUntil(
          () =>
            (sectionPart(shown, "content")?.textContent ?? "").includes(
              "Question B",
            ),
          "the new summary to render",
        );
      });
      assert.deepEqual(regenerates, [false, true], "Generate, then Retry");
      assert.deepEqual(
        bypasses,
        [undefined, undefined],
        "neither Generate nor Retry bypasses the stored result",
      );
      assert.strictEqual(calls, 2, "one model call per run");
      assert.deepEqual(requests, [], "the plugin sent no request");
    } finally {
      host.generate = realGenerate;
      host.onError = realOnError;
      registry.get = realGet;
      if (secrets !== undefined && realHas !== undefined) secrets.has = realHas;
      restorePref(keyPresentPref, keyPresentBefore);
      restorePref(acknowledgedPref, acknowledgedBefore);
      for (const dialog of costDialogs()) dialog.close();
    }
  });

  it("reads an item's collections, and a one-item job over them takes the strictest privacy mode (plan/00 §6 item 305(a))", async function () {
    this.timeout(30000);
    const instance = await initializedInstance();
    const graph = instance.api.services!;
    await graph.database.ready;
    const libraryID = Zotero.Libraries.userLibraryID;
    const modePref = `${config.prefsPrefix}.privacy.mode`;
    const modeBefore = Zotero.Prefs.get(modePref, true) as unknown;
    const strict = new Zotero.Collection({
      libraryID,
      name: "RH 305(a) strict (SYNTHETIC)",
    });
    await strict.saveTx();
    const plain = new Zotero.Collection({
      libraryID,
      name: "RH 305(a) plain (SYNTHETIC)",
    });
    await plain.saveTx();
    const itemID = await regularItem("RH 305(a) item", "rh:305a");
    const item = Zotero.Items.get(itemID) as Zotero.Item;
    const source = createCancellationTokenSource();
    try {
      item.addToCollection(strict.id);
      item.addToCollection(plain.id);
      await item.saveTx();
      const refs = collectionsOfItem(libraryID, item.key);
      assert.deepEqual(
        refs.map((ref) => ref.collectionKey).sort(),
        [strict.key, plain.key].sort(),
        "collectionsOfItem names both collections",
      );
      assert.isTrue(
        refs.every((ref) => ref.libraryID === libraryID),
        "in the item's library",
      );
      Zotero.Prefs.set(modePref, "balanced", true);
      await graph.collectionSettings.put(libraryID, strict.key, {
        privacyMode: "strict",
      });
      const modeOf = async (
        itemCollections: readonly {
          libraryID: number;
          collectionKey: string;
        }[],
      ): Promise<string> => {
        const job = await graph.pipelineContext.openJob({
          pipelineId: "summarize",
          token: source.token,
          itemCollections,
        });
        job.dispose();
        return job.context.privacy.mode;
      };
      assert.strictEqual(await modeOf(refs), "strict", "both: the stricter");
      assert.strictEqual(
        await modeOf(refs.filter((ref) => ref.collectionKey === plain.key)),
        "balanced",
        "the plain collection alone: the global mode",
      );
      assert.strictEqual(await modeOf([]), "balanced", "none: the global mode");
    } finally {
      source.dispose();
      await graph.collectionSettings.delete(libraryID, strict.key);
      restorePref(modePref, modeBefore);
      await item.eraseTx();
      await strict.eraseTx();
      await plain.eraseTx();
    }
  });

  it("invalidates a trashed item's work:<workKey> cache tag", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const cache = instance.api.services!.cache as {
      invalidateByTag(tag: string): Promise<number>;
    };
    const original = cache.invalidateByTag;
    const tags: string[] = [];
    cache.invalidateByTag = (tag: string) => {
      tags.push(tag);
      return Promise.resolve(0);
    };
    try {
      await Zotero.Items.trashTx([itemC]);
      const wanted = `work:${encodeTagValue(KEY_C)}`;
      await waitUntil(
        () => tags.includes(wanted),
        `invalidateByTag("${wanted}")`,
      );
      assert.strictEqual(
        tags.filter((tag) => tag === wanted).length,
        1,
        "invalidated once",
      );
    } finally {
      cache.invalidateByTag = original;
    }
  });

  it("five disable/enable cycles leave no section and no live observer", async function () {
    this.timeout(TEST_TIMEOUT_MS * 2);
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs",
    );
    const wrapper = (await AddonManager.getAddonByID(config.addonID)) as {
      isActive: boolean;
      disable(): Promise<unknown>;
      enable(): Promise<unknown>;
    } | null;
    if (!wrapper) assert.fail(`AddonManager does not know ${config.addonID}`);

    const afterBootstrap = (
      method: "startup" | "shutdown",
      action: () => Promise<unknown>,
    ): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const observer: _ZoteroTypes.Plugins.observer = {
          [method]: (params: { id: string }) => {
            if (params.id !== config.addonID) return;
            clearTimeout(timer);
            Zotero.Plugins.removeObserver(observer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          Zotero.Plugins.removeObserver(observer);
          reject(new Error(`timed out waiting for bootstrap ${method}`));
        }, STEP_TIMEOUT_MS);
        Zotero.Plugins.addObserver(observer);
        action().catch((error: unknown) => {
          clearTimeout(timer);
          Zotero.Plugins.removeObserver(observer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

    // Every graph this test sees, each with its cache's invalidation counted:
    // a torn-down graph's observer that survived would still be called.
    const counts: number[] = [];
    type Invalidating = { invalidateByTag(tag: string): Promise<number> };
    let restore: (() => void) | undefined;
    const watch = (graph: Addon["api"]["services"]): void => {
      if (!graph) assert.fail("api.services is missing");
      const index = counts.length;
      counts.push(0);
      const cache = graph.cache as Invalidating;
      const original = cache.invalidateByTag;
      cache.invalidateByTag = () => {
        counts[index] = (counts[index] ?? 0) + 1;
        return Promise.resolve(0);
      };
      // Only the live graph's cache is put back; a torn-down one is inert.
      restore = () => {
        cache.invalidateByTag = original;
      };
    };

    try {
      await select(win, itemA);
      watch((await initializedInstance()).api.services);
      for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
        const before = await initializedInstance();
        await afterBootstrap("shutdown", () => wrapper.disable());
        await waitUntil(
          () => pluginInstance() === undefined,
          "the instance to be removed by onShutdown",
        );
        assert.deepEqual(
          before.scope.liveHandles(),
          [],
          `cycle ${String(cycle)}: no live handle`,
        );
        assert.strictEqual(
          registeredSections().length,
          0,
          `cycle ${String(cycle)}: no section registered after disable`,
        );
        await waitUntil(
          () => librarySection(win) === null,
          `cycle ${String(cycle)}: the drawn section to be removed`,
        );

        await afterBootstrap("startup", () => wrapper.enable());
        const fresh = await initializedInstance();
        assert.strictEqual(
          registeredSections().length,
          1,
          `cycle ${String(cycle)}: exactly one section after enable`,
        );
        watch(fresh.api.services);
      }

      // One trash after the fifth enable: only the current graph hears it.
      const extra = await regularItem(`RH ${TAG} D`, `test:${TAG}-d`);
      created.push(extra);
      await Zotero.Items.trashTx([extra]);
      const current = counts.length - 1;
      await waitUntil(
        () => (counts[current] ?? 0) > 0,
        "the current graph's observer to invalidate",
      );
      await delay(500);
      assert.deepEqual(
        counts.slice(0, current),
        new Array<number>(current).fill(0),
        "no torn-down observer was called",
      );
      assert.strictEqual(counts[current], 1, "the live observer, once");
    } finally {
      restore?.();
      if (!wrapper.isActive) {
        await afterBootstrap("startup", () => wrapper.enable());
      }
      await initializedInstance();
    }
  });
});

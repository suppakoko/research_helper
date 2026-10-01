/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * Localization of plugin strings on Zotero 10 (`FR-55`, `NFR-11`, spike `V-17`,
 * `docs/13` §2.3's L10n row).
 *
 * `P0-T24` wrote the first three layers of this file against the one bundle the
 * spike shipped. `P1-T18` keeps them and adds the four that turn a spike into a
 * shipped vocabulary: the two Phase 1 bundles are diffed against
 * `src/i18n/keys.ts`, the `ko-KR` review gap is asserted to be *exactly* the
 * documented one, every `messageKey` in `src/core/errors.ts` is checked to have
 * a message, and any Phase 1 markup that exists is scraped for `data-l10n-id`s
 * that no bundle declares.
 *
 * The plugin under test is the real, built one. Its bundles are
 * `locale/{en-US,ko-KR}/research-helper-{mainWindow,searchDialog}.ftl`.
 *
 * ## The layers, and why they are separate `it` blocks
 *
 * They fail independently, and a combined assertion would hide which one broke.
 *
 * 1. **The vocabulary.** `src/i18n/keys.ts` against itself and against the two
 *    prefixes `docs/01` §9.3 and `docs/07` §10.1 disagree about (§"prefix
 *    conflict" below). No platform involved.
 *
 *    **`P1-T30` moved most of this layer into the compiler.** `FluentMessageId`
 *    is now re-exported from `typings/i10n.d.ts`, which the scaffold generates
 *    from the built bundles, so "an id in `keys.ts` that no bundle declares"
 *    and "an id in a bundle that `keys.ts` assigns to no surface" are both
 *    `tsc` errors rather than things a spec could discover. What is left here
 *    is what a type cannot say: that the derivation is still in place
 *    ({@link UnionIsGenerated}, which fails to *compile* if `keys.ts` goes back
 *    to a hand-written union), that the surface partition is a partition, and
 *    that the hand-written argument map — the one part of `keys.ts` the
 *    generator does not produce — names only real messages.
 * 2. **Registration, per file per locale.** Zotero's `registerLocales()`
 *    (`plugins.js`) contributes one file per Zotero locale to the shared
 *    `zotero-plugins` source, picking exact → same language → `en-US` → first
 *    available. Read here through `L10nRegistry.generateBundles([locale], …)`
 *    and `FluentBundle.hasMessage()`, which answers "is this id *in this
 *    locale's file*" without the per-message fallback of layer 3 muddying it —
 *    the only way to state the `ko-KR` gap precisely.
 * 3. **Fallback, per message.** Pinned to `["ko-KR", "en-US"]`, Gecko's
 *    `Localization` walks the chain message by message, so a message missing
 *    from the Korean file resolves from the English one. This is what the
 *    `ko-KR` bundles currently depend on for 79 of their 84 strings.
 * 4. **The error contract.** Every `ResearchHelperError` subclass's
 *    `messageKey` either has a message in `en-US` or is on
 *    `DEFERRED_ERROR_MESSAGE_IDS`. A `messageKey` with no message is a blank
 *    label at runtime, not a compile error.
 * 5. **The real UI locale.** `Services.locale.requestedLocales` is switched to
 *    `en-US` and then to `ko-KR` in the runner's own profile
 *    (`.scaffold/test/profile`, never the dev profile or the user's Zotero),
 *    and the Tools menu, the main window's `document.l10n` and an unpinned
 *    `new Localization([...])` — the form the plugin sandbox uses — are read
 *    under each. The pref is restored in `after`, whatever failed.
 * 6. **Phase 1 markup.** `P1-T18`'s first criterion: scrape the XHTML and diff
 *    its `data-l10n-id`s against the declared ids. Phase 1's only markup
 *    surface is `searchDialog.xhtml`, which `P1-T20` creates; until then the
 *    scrape reports that it found no document and asserts nothing about one.
 *    See that test's own comment — it is the one criterion this card cannot
 *    fully discharge, and it is written so that it starts biting the moment
 *    the markup lands rather than being added later.
 *
 * ## The prefix conflict, stated once
 *
 * `docs/01` §9.3 requires every Fluent id to start with `research-helper-`,
 * "No exceptions". `docs/07` §10.1 fixes sixteen Phase 1 ids as `rh-error-*`
 * in `src/core/errors.ts`, asserted there by `P1-T02`. Both cannot hold.
 * `P1-T18` transcribed the code's keys (a mismatch there is an invisible blank
 * label) and reported the conflict; the test below states the split in numbers
 * rather than asserting the card's fourth criterion as written, because that
 * criterion cannot pass while the conflict stands.
 *
 * Every measured value is written to the runner's terminal, prefixed
 * `[P1-T18]`, before it is asserted. Sandbox caveats (`docs/01` §2.3): no
 * `console`, no `performance`.
 */

import { config } from "../../package.json";
import {
  ConfigurationError,
  MissingCredentialError,
  NetworkError,
  OfflineError,
  TimeoutError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  QuotaExceededError,
  UpstreamServerError,
  BadRequestError,
  SourceError,
  ParseError,
  LLMError,
  ContextLengthExceededError,
  ContentFilterError,
  StructuredOutputError,
  TTSError,
  ZoteroApiError,
  StorageError,
  OperationCancelledError,
  BudgetExceededError,
  PolicyViolationError,
  type ResearchHelperError,
} from "../../src/core/errors";
import {
  FLUENT_PREFIX,
  MESSAGE_ID_PREFIXES,
  MESSAGE_PREFIX_MATCHES_ADDON_REF,
  fluentResourceId,
  formatAttribute,
  isPluginMessageId,
  type FluentFormatter,
} from "../../src/i18n/ftl";
import {
  ARGUMENT_MESSAGE_IDS,
  DEFERRED_ERROR_MESSAGE_IDS,
  ERROR_MESSAGE_IDS,
  ERROR_MESSAGE_PREFIX,
  KO_DELIBERATELY_ABSENT,
  KO_PENDING_REVIEW,
  KO_PRESENT,
  MAIN_WINDOW_MESSAGE_IDS,
  MESSAGE_IDS_BY_SURFACE,
  MESSAGE_PREFIX,
  SEARCH_DIALOG_MESSAGE_IDS,
  SHIPPED_SURFACES,
  surfaceOfMessage,
  type FluentMessageId,
  type ShippedSurface,
} from "../../src/i18n/keys";
import {
  L10N_MENU_ROOT,
  L10N_MENU_SPIKE_CREATE_ITEM,
} from "../../src/ui/menus/toolsMenu";
import type { FluentMessageId as GeneratedMessageId } from "../../typings/i10n";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void>): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isAtLeast(value: number, floor: number, message?: string): void;
  include(haystack: readonly string[], needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

/* --------------------------------------- P1-T30: the derivation, as a type */

/** `true` only when `A` and `B` are the same type, in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * `P1-T30`'s single source of truth, asserted where it can be asserted: in the
 * compiler.
 *
 * `src/i18n/keys.ts` must not merely *agree* with `typings/i10n.d.ts`, it must
 * **be** it. If someone replaces the re-export with a hand-written union again
 * — which is the two-sources-of-truth state this card removed — this alias
 * stops being `true` and `npm run typecheck` fails here, in the spec that
 * covers the vocabulary, naming the reason.
 *
 * Mutual assignability rather than identity, because a narrowing of the
 * generated union would be a legitimate shape for `keys.ts` to take and would
 * still be a single source of truth — but it would have to be an *equal*
 * narrowing, since every message the bundles ship is a message some surface
 * must declare.
 */
type UnionIsGenerated = Exact<FluentMessageId, GeneratedMessageId>;

/** The witness that instantiates {@link UnionIsGenerated}. */
const UNION_IS_GENERATED: UnionIsGenerated = true;

const LOG_PREFIX = "[P1-T18]";
const PLUGIN_L10N_SOURCE = "zotero-plugins";
const LOCALE_PREF = "intl.locale.requested";
const TOOLS_POPUP_ID = "menu_ToolsPopup";
const TOOLS_TARGET = "main/menubar/tools";
const STEP_TIMEOUT_MS = 20_000;

/**
 * Phase 1's markup surfaces, by the chrome URL `addon/bootstrap.js` registers
 * (`["content", "<addonRef>", rootURI + "content/"]`). Only `searchDialog` is
 * Phase 1's, and `P1-T20` creates it; a URL that does not resolve is reported,
 * not failed. `locale/` is *not* under the chrome mapping, which is why the
 * bundles themselves are read through `L10nRegistry` instead.
 */
const MARKUP_URLS = [
  `chrome://${config.addonRef}/content/searchDialog.xhtml`,
] as const;

/** The expected menu labels, copied from the two `.ftl` files by hand. */
const EN = {
  root: "Research Helper",
  spike: "Create spike item (P0-T10)",
} as const;
const KO = { root: "리서치 헬퍼" } as const;

interface MenuLabels {
  readonly root: string | undefined;
  readonly spike: string | undefined;
}

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      assert.fail(`timed out after ${STEP_TIMEOUT_MS} ms waiting for ${what}`);
    }
    await delay(100);
  }
}

function pluginInitialized(): boolean {
  const instance = (
    Zotero as unknown as Record<
      string,
      { data?: { initialized?: boolean } } | undefined
    >
  )[config.addonInstance];
  return instance?.data?.initialized === true;
}

/** A `Localization` over one surface's bundle, pinned to `locales`. */
function pinnedLocalization(
  surface: ShippedSurface,
  locales: string[],
): Localization {
  return new Localization(
    [fluentResourceId(surface)],
    false,
    L10nRegistry.getInstance(),
    locales,
  );
}

/**
 * The `FluentBundle` Zotero's plugin source yields for one surface in one
 * locale, or `undefined` if it yields none.
 *
 * This is the file-level read layer 2 needs: `hasMessage()` is true only for a
 * message in *this locale's chosen file*, with no per-message fallback.
 */
async function bundleFor(
  surface: ShippedSurface,
  locale: string,
): Promise<FluentBundle | undefined> {
  const iterator = L10nRegistry.getInstance().generateBundles(
    [locale],
    [fluentResourceId(surface)],
  );
  const first = await iterator.next();
  return first.done ? undefined : (first.value ?? undefined);
}

/** The declared ids of `surface` that are present in `locale`'s own file. */
async function declaredIdsPresentIn(
  surface: ShippedSurface,
  locale: string,
): Promise<{ present: string[]; absent: string[] }> {
  const bundle = await bundleFor(surface, locale);
  if (!bundle) {
    assert.fail(
      `L10nRegistry yielded no bundle for ${fluentResourceId(surface)} in ` +
        `${locale} — the file is not registered at all`,
    );
  }
  const present: string[] = [];
  const absent: string[] = [];
  for (const id of MESSAGE_IDS_BY_SURFACE[surface]) {
    (bundle.hasMessage(id) ? present : absent).push(id);
  }
  return { present, absent };
}

/**
 * Which of `ids` a `Localization` resolves to a message at all.
 *
 * Deliberately untyped in `ids`: `formatMessage()` in `src/i18n/ftl.ts` is
 * generic over one id so that its argument object is checked, and spreading a
 * union of argument tuples across a loop is not expressible. Presence — a
 * non-`null` `L10nMessage` — is what this layer tests, and a message whose
 * arguments were not supplied is still present, so the bulk read goes straight
 * to the platform method both helpers wrap.
 */
async function resolvable(
  l10n: Localization,
  ids: readonly string[],
): Promise<{ resolved: string[]; unresolved: string[] }> {
  const messages = await l10n.formatMessages(ids.map((id) => ({ id })));
  const resolved: string[] = [];
  const unresolved: string[] = [];
  ids.forEach((id, i) => {
    (messages[i] ? resolved : unresolved).push(id);
  });
  return { resolved, unresolved };
}

/** Both menu labels through `formatter`, via `src/i18n/ftl.ts`. */
async function labelsFrom(formatter: FluentFormatter): Promise<MenuLabels> {
  return {
    root: await formatAttribute(formatter, L10N_MENU_ROOT, "label"),
    spike: await formatAttribute(
      formatter,
      L10N_MENU_SPIKE_CREATE_ITEM,
      "label",
    ),
  };
}

function show(labels: MenuLabels): string {
  return JSON.stringify(labels);
}

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

/**
 * The labels the Tools menu actually carries, built the way Zotero builds it
 * on `popupshowing` (`lifecycle.spec.ts` explains the event pairing and the
 * idle wait), after asking the window's own `document.l10n` to translate the
 * two elements so the read does not race the async DOM localization.
 */
async function toolsMenuLabels(
  win: _ZoteroTypes.MainWindow,
): Promise<MenuLabels> {
  const doc = win.document;
  const popup = doc.getElementById(TOOLS_POPUP_ID) as XULPopupElement | null;
  if (!popup) {
    assert.fail(`#${TOOLS_POPUP_ID} not found in the main window`);
  }
  Zotero.MenuManager.updateMenuPopup(popup, TOOLS_TARGET, {
    tabType: "library",
  });
  const menu = Array.from(popup.children).find(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  if (!menu) {
    popup.dispatchEvent(new win.Event("popuphidden"));
    assert.fail("the Research Helper submenu is not in the Tools popup");
  }
  const submenu = menu.querySelector(":scope > menupopup");
  submenu?.dispatchEvent(new win.Event("popupshowing"));
  const item = submenu
    ? Array.from(submenu.children).find(
        (el) => el.getAttribute("data-l10n-id") === L10N_MENU_SPIKE_CREATE_ITEM,
      )
    : undefined;

  const l10n = doc.l10n;
  if (!l10n) {
    assert.fail("the main window has no document.l10n");
  }
  await l10n.translateElements(item ? [menu, item] : [menu]);
  const labels: MenuLabels = {
    root: menu.getAttribute("label") ?? undefined,
    spike: item?.getAttribute("label") ?? undefined,
  };

  submenu?.dispatchEvent(new win.Event("popuphidden"));
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);
  return labels;
}

/**
 * Request `locales` as the UI locale and wait until the negotiated app locale
 * chain leads with the first of them.
 */
async function requestUILocale(locales: string[]): Promise<void> {
  Services.locale.requestedLocales = locales;
  await waitUntil(
    () => Services.locale.appLocalesAsBCP47[0] === locales[0],
    `app locales to lead with ${locales[0]}`,
  );
  // The windows' DOM localizations re-translate on intl:app-locales-changed;
  // let that settle before anything is read.
  await idle(Zotero.getMainWindow());
  log(
    `requested ${JSON.stringify(Services.locale.requestedLocales)} -> app ` +
      `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
  );
}

/** Every read a Korean or English UI must agree on, in one place. */
async function readUnderCurrentLocale(): Promise<{
  unpinned: MenuLabels;
  document: MenuLabels;
  menu: MenuLabels;
}> {
  const win = Zotero.getMainWindow();
  const docL10n = win.document.l10n;
  if (!docL10n) {
    assert.fail("the main window has no document.l10n");
  }
  const result = {
    // What the plugin sandbox writes: no registry, no locale list.
    unpinned: await labelsFrom(
      new Localization([fluentResourceId("mainWindow")]),
    ),
    document: await labelsFrom(docL10n),
    menu: await toolsMenuLabels(win),
  };
  log(
    `unpinned Localization ${show(result.unpinned)}; document.l10n ` +
      `${show(result.document)}; Tools menu ${show(result.menu)}`,
  );
  return result;
}

/**
 * One instance of every concrete `ResearchHelperError` in `docs/07` §10.1, so
 * the spec reads each `messageKey` off the class rather than restating it.
 *
 * The constructor arguments are the ones each class declares; nothing here is
 * thrown, logged or serialized, so the messages are placeholders. `docs/09`
 * §2.1's redaction rules are `P1-T02`'s unit-test territory, not this file's.
 */
function everyErrorInstance(): ResearchHelperError[] {
  return [
    new ConfigurationError("x"),
    new MissingCredentialError("openai"),
    new NetworkError("x"),
    new OfflineError("x"),
    new TimeoutError(1, "https://example.invalid/"),
    new AuthenticationError(401, "x"),
    new AuthorizationError(403, "x"),
    new RateLimitError(429, 1_000, "eutils.ncbi.nlm.nih.gov"),
    new QuotaExceededError(402, "x"),
    new UpstreamServerError(503, "x"),
    new BadRequestError(400, "x"),
    new SourceError("pubmed", "x"),
    new ParseError("pubmed", "x"),
    new LLMError("openai", "gpt-4o-mini", "x"),
    new ContextLengthExceededError("openai", "gpt-4o-mini", "x"),
    new ContentFilterError("openai", "gpt-4o-mini", "x"),
    new StructuredOutputError("openai", "gpt-4o-mini", "x"),
    new TTSError("x"),
    new ZoteroApiError("x"),
    new StorageError("x"),
    new OperationCancelledError({ kind: "user" }),
    new BudgetExceededError("x"),
    new PolicyViolationError("x"),
  ];
}

describe("localization (FR-55, NFR-11, V-17, P1-T18)", function () {
  const original = {
    hadUserValue: false,
    requested: "",
    appLocales: [] as string[],
  };

  before(async function () {
    await waitUntil(
      pluginInitialized,
      `Zotero.${config.addonInstance}.data.initialized`,
    );
    original.hadUserValue = Services.prefs.prefHasUserValue(LOCALE_PREF);
    original.requested = Services.prefs.getCharPref(LOCALE_PREF, "");
    original.appLocales = [...Services.locale.appLocalesAsBCP47];
    log(
      `Zotero ${Zotero.version}, Gecko ${Services.appinfo.platformVersion}, ` +
        `Zotero.locale ${Zotero.locale}; ${LOCALE_PREF} ` +
        `${original.hadUserValue ? JSON.stringify(original.requested) : "(default)"}; ` +
        `app locales ${JSON.stringify(original.appLocales)}; ` +
        `ko-KR available ${String(Services.locale.availableLocales.includes("ko-KR"))}`,
    );
  });

  after(async function () {
    // Put the runner profile's UI locale back exactly as it was.
    if (original.hadUserValue) {
      Services.prefs.setCharPref(LOCALE_PREF, original.requested);
    } else {
      Services.prefs.clearUserPref(LOCALE_PREF);
    }
    await waitUntil(
      () =>
        JSON.stringify(Services.locale.appLocalesAsBCP47) ===
        JSON.stringify(original.appLocales),
      "app locales to return to their original value",
    );
    log(
      `restored ${LOCALE_PREF} (user value ` +
        `${String(Services.prefs.prefHasUserValue(LOCALE_PREF))}); app ` +
        `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
    );
  });

  /* ---------------------------------------------- layer 1: the vocabulary */

  it("declares one id set, with no duplicate across the two surfaces", async function () {
    const all = [...MAIN_WINDOW_MESSAGE_IDS, ...SEARCH_DIALOG_MESSAGE_IDS];
    log(
      `declared ids: mainWindow ${MAIN_WINDOW_MESSAGE_IDS.length}, ` +
        `searchDialog ${SEARCH_DIALOG_MESSAGE_IDS.length}, total ${all.length}`,
    );
    assert.strictEqual(
      new Set(all).size,
      all.length,
      "an id declared in two surfaces would be declared in two files, and " +
        "Fluent ids share one namespace per document (docs/01 §9.3)",
    );
    assert.deepEqual(sorted(SHIPPED_SURFACES), ["mainWindow", "searchDialog"]);
    assert.strictEqual(FLUENT_PREFIX, "research-helper-");
    assert.strictEqual(MESSAGE_PREFIX, FLUENT_PREFIX);
    assert.isTrue(
      MESSAGE_PREFIX_MATCHES_ADDON_REF,
      "package.json's addonRef and keys.ts's MESSAGE_PREFIX agree",
    );
    assert.strictEqual(
      fluentResourceId("mainWindow"),
      "research-helper-mainWindow.ftl",
    );
    assert.strictEqual(
      fluentResourceId("searchDialog"),
      "research-helper-searchDialog.ftl",
    );
    // The two constants src/ui/menus/toolsMenu.ts declares for itself must be
    // the same strings keys.ts declares; that file predates keys.ts and is not
    // in P1-T18's Files list, so this is the only thing holding them together.
    assert.strictEqual(L10N_MENU_ROOT, "research-helper-menu-root");
    assert.strictEqual(
      L10N_MENU_SPIKE_CREATE_ITEM,
      "research-helper-menu-spike-create-item",
    );
    assert.include(MAIN_WINDOW_MESSAGE_IDS, L10N_MENU_ROOT);
    assert.include(MAIN_WINDOW_MESSAGE_IDS, L10N_MENU_SPIKE_CREATE_ITEM);
  });

  it("splits every id across exactly the two prefixes the corpus disagrees about", async function () {
    // P1-T18's fourth criterion asks that no id lack the `research-helper-`
    // prefix. Sixteen do, because docs/07 §10.1 fixes them in
    // src/core/errors.ts as `rh-error-*` and P1-T02 asserts them there. The
    // criterion cannot pass while that conflict stands; this test states the
    // split exactly, so the day the conflict is resolved one side of it goes
    // to zero and this assertion is what fails.
    const all = [...MAIN_WINDOW_MESSAGE_IDS, ...SEARCH_DIALOG_MESSAGE_IDS];
    const pluginPrefixed = all.filter((id) => id.startsWith(MESSAGE_PREFIX));
    const errorPrefixed = all.filter((id) =>
      id.startsWith(ERROR_MESSAGE_PREFIX),
    );
    log(
      `prefixes: "${MESSAGE_PREFIX}" ${pluginPrefixed.length}, ` +
        `"${ERROR_MESSAGE_PREFIX}" ${errorPrefixed.length} ` +
        `(docs/01 §9.3 wants the second to be 0; docs/07 §10.1 fixes it at ` +
        `${ERROR_MESSAGE_IDS.length})`,
    );
    assert.strictEqual(
      pluginPrefixed.length + errorPrefixed.length,
      all.length,
      "every declared id carries one of the two known prefixes",
    );
    assert.deepEqual(
      sorted(errorPrefixed),
      sorted(ERROR_MESSAGE_IDS),
      "the only ids outside the plugin prefix are docs/07 §10.1's messageKeys",
    );
    for (const id of all) {
      assert.isTrue(isPluginMessageId(id), `${id} is a plugin message id`);
    }
    assert.deepEqual(sorted(MESSAGE_ID_PREFIXES), [
      "research-helper-",
      "rh-error-",
    ]);
  });

  it("derives its id union from the generated one, and keeps the argument map inside it", async function () {
    // P1-T30. The two halves of "one source of truth":
    //
    // 1. `keys.ts`'s `FluentMessageId` IS `typings/i10n.d.ts`'s. That is a
    //    compile-time fact, and `UNION_IS_GENERATED` above is where it is
    //    stated; reading it here is what keeps the constant from being dead
    //    code a cleanup would delete, and makes the claim appear in the
    //    runner's output next to the rest of layer 1.
    // 2. The hand-written per-surface lists are a *partition* of that union.
    //    `satisfies readonly FluentMessageId[]` in `keys.ts` gives one
    //    inclusion, `UndeclaredBundleMessageId` the other, and the
    //    no-duplicate assertion in the test above makes the two surfaces
    //    disjoint. All three are compile-time or pure; what this block adds is
    //    the one thing neither expresses, that `surfaceOfMessage()` — the
    //    runtime side of the partition — answers for every declared id.
    assert.isTrue(
      UNION_IS_GENERATED,
      "keys.ts's FluentMessageId is typings/i10n.d.ts's generated union " +
        "(P1-T30); if this file stopped compiling, keys.ts restated the union",
    );
    const all: readonly FluentMessageId[] = [
      ...MAIN_WINDOW_MESSAGE_IDS,
      ...SEARCH_DIALOG_MESSAGE_IDS,
    ];
    const unassigned = all.filter((id) => surfaceOfMessage(id) === undefined);
    log(`ids with no surface per surfaceOfMessage(): ${unassigned.length}`);
    assert.deepEqual(
      unassigned,
      [],
      "every declared id is assigned to a surface at runtime too",
    );

    // The argument map is the one part of keys.ts the generator does not and
    // cannot produce (it reads ids, never placeables), so it stays hand-written
    // — and therefore stays checked. Its keys being real message ids is a
    // compile error now (`UndeclaredArgumentMessageId`); this is the
    // enumerable half.
    log(
      `argument map: ${ARGUMENT_MESSAGE_IDS.length} of ${all.length} messages ` +
        `take arguments`,
    );
    assert.strictEqual(
      new Set<string>(ARGUMENT_MESSAGE_IDS).size,
      ARGUMENT_MESSAGE_IDS.length,
      "no id is listed twice in ARGUMENT_MESSAGE_IDS",
    );
    const argsWithoutSurface = ARGUMENT_MESSAGE_IDS.filter(
      (id) => surfaceOfMessage(id) === undefined,
    );
    assert.deepEqual(
      argsWithoutSurface,
      [],
      "every message with arguments is declared by a surface",
    );
  });

  /* -------------------------------- layer 2: registration, per file per locale */

  it("registers both bundles in Zotero's shared plugin source, for en-US and ko-KR", async function () {
    assert.include(
      Services.locale.availableLocales,
      "ko-KR",
      "Zotero ships ko-KR as a UI locale",
    );
    assert.isTrue(
      L10nRegistry.getInstance().hasSource(PLUGIN_L10N_SOURCE),
      `L10nRegistry has the "${PLUGIN_L10N_SOURCE}" source`,
    );
    for (const surface of SHIPPED_SURFACES) {
      for (const locale of ["en-US", "ko-KR"]) {
        const bundle = await bundleFor(surface, locale);
        log(
          `${fluentResourceId(surface)} in ${locale}: ` +
            `${bundle ? `bundle locales ${JSON.stringify(bundle.locales)}` : "NO BUNDLE"}`,
        );
        assert.isTrue(
          bundle !== undefined,
          `${fluentResourceId(surface)} is registered for ${locale}`,
        );
      }
    }
  });

  it("declares every id in the en-US file of its own surface, and nowhere else", async function () {
    for (const surface of SHIPPED_SURFACES) {
      const { present, absent } = await declaredIdsPresentIn(surface, "en-US");
      log(
        `en-US ${fluentResourceId(surface)}: ${present.length} present, ` +
          `${absent.length} absent ${JSON.stringify(absent)}`,
      );
      assert.deepEqual(
        absent,
        [],
        `every id keys.ts assigns to ${surface} is in its en-US bundle`,
      );
    }
    // And no id leaks across: an id declared for one surface must not also be
    // in the other file, or the two would collide in any document that
    // inserts both.
    for (const surface of SHIPPED_SURFACES) {
      const other: ShippedSurface =
        surface === "mainWindow" ? "searchDialog" : "mainWindow";
      const bundle = await bundleFor(other, "en-US");
      if (!bundle) {
        assert.fail(`no en-US bundle for ${other}`);
      }
      const leaked = MESSAGE_IDS_BY_SURFACE[surface].filter((id) =>
        bundle.hasMessage(id),
      );
      log(
        `ids of ${surface} also present in ${other}: ${JSON.stringify(leaked)}`,
      );
      assert.deepEqual(leaked, [], `${surface}'s ids are not also in ${other}`);
    }
  });

  it("gives every message in the argument map a real message in its own surface's en-US bundle", async function () {
    // P1-T30 step 3: "keep the test that asserts every id in [the argument
    // map] exists in a bundle". There was none to keep — P1-T18 shipped the
    // map with no check at all, and an `interface` accepts any string key — so
    // this is it. The compile-time half is `UndeclaredArgumentMessageId` in
    // keys.ts; this is the live read, and it is not redundant with the
    // declared-ids test above: it checks the map against the *bundle of the
    // surface keys.ts assigns the id to*, which is what a caller's
    // `formatMessage` will actually resolve against.
    const missing: string[] = [];
    for (const surface of SHIPPED_SURFACES) {
      const bundle = await bundleFor(surface, "en-US");
      if (!bundle) {
        assert.fail(`no en-US bundle for ${surface}`);
      }
      const mine = ARGUMENT_MESSAGE_IDS.filter(
        (id) => surfaceOfMessage(id) === surface,
      );
      const absent = mine.filter((id) => !bundle.hasMessage(id));
      log(
        `argument map ∩ ${fluentResourceId(surface)}: ${mine.length} ids, ` +
          `${absent.length} absent ${JSON.stringify(absent)}`,
      );
      missing.push(...absent);
    }
    assert.deepEqual(
      missing,
      [],
      "every id in FluentMessageArgsMap has a message in its surface's en-US bundle",
    );
  });

  it("resolves every declared id from a Localization pinned to en-US", async function () {
    for (const surface of SHIPPED_SURFACES) {
      const { resolved, unresolved } = await resolvable(
        pinnedLocalization(surface, ["en-US"]),
        MESSAGE_IDS_BY_SURFACE[surface],
      );
      log(
        `pinned ["en-US"] ${fluentResourceId(surface)}: ${resolved.length} ` +
          `resolved, ${unresolved.length} unresolved ${JSON.stringify(unresolved)}`,
      );
      assert.deepEqual(unresolved, [], `every ${surface} id resolves in en-US`);
    }
  });

  it("carries exactly the reviewed Korean strings, and exactly the documented gap", async function () {
    // The human gate, as an assertion. KO_PRESENT is what an owner supplied
    // (docs/08 §10.2) plus what docs/08 §10.3 forbids translating;
    // KO_PENDING_REVIEW is what a native speaker still has to write;
    // KO_DELIBERATELY_ABSENT is the one key that must stay missing so FR-55's
    // fallback stays observable.
    const presentActual: string[] = [];
    const absentActual: string[] = [];
    for (const surface of SHIPPED_SURFACES) {
      const { present, absent } = await declaredIdsPresentIn(surface, "ko-KR");
      log(
        `ko-KR ${fluentResourceId(surface)}: ${present.length} translated ` +
          `${JSON.stringify(present)}, ${absent.length} awaiting review`,
      );
      presentActual.push(...present);
      absentActual.push(...absent);
    }
    log(
      `ko-KR totals: ${presentActual.length} present, ` +
        `${absentActual.length} absent; expected ${KO_PRESENT.length} / ` +
        `${KO_PENDING_REVIEW.length + KO_DELIBERATELY_ABSENT.length}`,
    );
    assert.deepEqual(
      sorted(presentActual),
      sorted(KO_PRESENT),
      "the ko-KR bundles carry exactly the strings that are reviewed or exempt",
    );
    assert.deepEqual(
      sorted(absentActual),
      sorted([...KO_PENDING_REVIEW, ...KO_DELIBERATELY_ABSENT]),
      "the ko-KR gap is exactly KO_PENDING_REVIEW plus the one deliberate hole",
    );
    // The two lists must not overlap: a key cannot both await translation and
    // be required to stay missing.
    const pending = new Set<string>(KO_PENDING_REVIEW);
    for (const id of KO_DELIBERATELY_ABSENT) {
      assert.isTrue(
        !pending.has(id),
        `${id} is deliberately absent and must not also be on the review list`,
      );
    }
    assert.include(
      KO_DELIBERATELY_ABSENT,
      L10N_MENU_SPIKE_CREATE_ITEM,
      "P0-T24's fallback fixture is still the deliberately absent key",
    );
    // P0-T24's measured value, still measured rather than assumed.
    const koOnly = await labelsFrom(
      pinnedLocalization("mainWindow", ["ko-KR"]),
    );
    log(`pinned ["ko-KR"] menu labels ${show(koOnly)}`);
    assert.deepEqual(
      koOnly,
      { root: KO.root, spike: undefined },
      "ko-KR alone: Korean root, and the spike key really is absent",
    );
  });

  /* ------------------------------------------- layer 3: per-message fallback */

  it("falls back to English per message along a ko-KR, en-US chain", async function () {
    const chain = await labelsFrom(
      pinnedLocalization("mainWindow", ["ko-KR", "en-US"]),
    );
    log(`pinned ["ko-KR","en-US"] menu labels ${show(chain)}`);
    assert.deepEqual(chain, { root: KO.root, spike: EN.spike });
    assert.notStrictEqual(chain.spike, L10N_MENU_SPIKE_CREATE_ITEM);

    // The whole ko-KR review gap rests on this layer, so assert it for every
    // untranslated id, not just the one fixture key.
    for (const surface of SHIPPED_SURFACES) {
      const { unresolved } = await resolvable(
        pinnedLocalization(surface, ["ko-KR", "en-US"]),
        MESSAGE_IDS_BY_SURFACE[surface],
      );
      log(
        `pinned ["ko-KR","en-US"] ${fluentResourceId(surface)}: ` +
          `${unresolved.length} unresolved ${JSON.stringify(unresolved)}`,
      );
      assert.deepEqual(
        unresolved,
        [],
        `every ${surface} id resolves along a ko-KR → en-US chain`,
      );
    }
  });

  /* ------------------------------------------- layer 4: the error contract */

  it("gives every messageKey src/core/errors.ts can throw a message, or defers it explicitly", async function () {
    const instances = everyErrorInstance();
    const keys = instances.map((e) => e.messageKey);
    log(`error classes instantiated: ${instances.length}; keys ${keys.length}`);
    assert.strictEqual(
      new Set(keys).size,
      keys.length,
      "docs/07 §10.1 gives every class its own messageKey",
    );
    assert.deepEqual(
      sorted(keys),
      sorted([...ERROR_MESSAGE_IDS, ...DEFERRED_ERROR_MESSAGE_IDS]),
      "every messageKey is either shipped by Phase 1 or on the deferred list",
    );
    for (const key of keys) {
      assert.isTrue(
        key.startsWith(ERROR_MESSAGE_PREFIX),
        `${key} matches docs/07 §10.1's rh-error- shape`,
      );
    }
    // The shipped sixteen must actually resolve; the deferred seven must not
    // be in the bundle, or the deferral is a lie.
    const bundle = await bundleFor("mainWindow", "en-US");
    if (!bundle) {
      assert.fail("no en-US mainWindow bundle");
    }
    const missing = ERROR_MESSAGE_IDS.filter((id) => !bundle.hasMessage(id));
    const unexpected = DEFERRED_ERROR_MESSAGE_IDS.filter((id) =>
      bundle.hasMessage(id),
    );
    log(
      `error messages: ${ERROR_MESSAGE_IDS.length} shipped, missing ` +
        `${JSON.stringify(missing)}; deferred present ${JSON.stringify(unexpected)}`,
    );
    assert.deepEqual(missing, [], "every Phase 1 messageKey has a message");
    assert.deepEqual(
      unexpected,
      [],
      "a deferred messageKey has no message yet, by design",
    );
  });

  /* ---------------------------------------------- layer 5: the real UI locale */

  it("renders the Tools menu from Fluent with the UI locale set to en-US", async function () {
    await requestUILocale(["en-US"]);
    const read = await readUnderCurrentLocale();
    const expected = { root: EN.root, spike: EN.spike };
    assert.deepEqual(read.menu, expected, "Tools menu labels");
    assert.deepEqual(read.document, expected, "main window document.l10n");
    assert.deepEqual(read.unpinned, expected, "unpinned Localization");
  });

  it("renders Korean, with English for the missing key, with the UI locale set to ko-KR", async function () {
    await requestUILocale(["ko-KR"]);
    assert.deepEqual(
      [...Services.locale.appLocalesAsBCP47].slice(-1),
      ["en-US"],
      "Gecko keeps en-US as the last fallback of a Korean UI",
    );
    const read = await readUnderCurrentLocale();
    const expected = { root: KO.root, spike: EN.spike };
    assert.deepEqual(read.menu, expected, "Tools menu labels");
    assert.deepEqual(read.document, expected, "main window document.l10n");
    assert.deepEqual(read.unpinned, expected, "unpinned Localization");
    for (const label of Object.values(read.menu)) {
      assert.notStrictEqual(label, L10N_MENU_ROOT, "not a raw identifier");
      assert.notStrictEqual(
        label,
        L10N_MENU_SPIKE_CREATE_ITEM,
        "not a raw identifier",
      );
    }
    // NFR-11 / FR-55: under a Korean UI nothing in either bundle renders as an
    // identifier, whether it is translated or falling back.
    for (const surface of SHIPPED_SURFACES) {
      const l10n = new Localization([fluentResourceId(surface)]);
      const { unresolved } = await resolvable(
        l10n,
        MESSAGE_IDS_BY_SURFACE[surface],
      );
      log(
        `ko-KR UI, unpinned ${fluentResourceId(surface)}: ` +
          `${unresolved.length} unresolved ${JSON.stringify(unresolved)}`,
      );
      assert.deepEqual(
        unresolved,
        [],
        `under a Korean UI every ${surface} id still resolves to a message`,
      );
    }
  });

  /* ------------------------------------------- layer 6: Phase 1 markup scrape */

  it("uses no data-l10n-id in Phase 1 markup that no bundle declares", async function () {
    // P1-T18's first criterion: "every `data-l10n-id` used in Phase 1 markup
    // resolves in en-US, asserted by a test that scrapes the XHTML and diffs
    // against the FTL keys". Phase 1's only markup surface is
    // `searchDialog.xhtml`, and `P1-T20` creates it — this card ships the
    // strings it will name. So the criterion is **vacuous today**, and the log
    // line at the end says so rather than letting an empty diff read as a pass.
    //
    // What is deliberately *not* asserted here is that the document exists and
    // carries at least one `data-l10n-id`. That is `P1-T20`'s criterion ("no
    // literal survives a grep of the XHTML"), and asserting it from `P1-T18`
    // would both widen this card's scope (`plan/README.md` §5 rule 2) and leave
    // the integration suite red for every card between the two — including
    // `P1-T19`, which depends on this one. Measured here: a `chrome://` URL for
    // a file that does not exist does **not** reject through
    // `Zotero.File.getContentsFromURLAsync` — it comes back as the empty
    // string — so absence is detected on the content, not on a throw.
    const declared = new Set<string>([
      ...MAIN_WINDOW_MESSAGE_IDS,
      ...SEARCH_DIALOG_MESSAGE_IDS,
    ]);
    let documentsFound = 0;
    for (const url of MARKUP_URLS) {
      let source: string;
      try {
        source = await Zotero.File.getContentsFromURLAsync(url);
      } catch (e) {
        log(`markup ${url}: not present yet (threw: ${String(e)})`);
        continue;
      }
      if (source.trim() === "") {
        log(`markup ${url}: not present yet (empty response)`);
        continue;
      }
      documentsFound += 1;
      const used = [...source.matchAll(/data-l10n-id\s*=\s*["']([^"']+)["']/g)]
        .map((m) => m[1])
        .filter((id): id is string => id !== undefined);
      const unique = sorted(new Set(used));
      const undeclared = unique.filter((id) => !declared.has(id));
      log(
        `markup ${url}: ${unique.length} distinct data-l10n-id, ` +
          `${undeclared.length} undeclared ${JSON.stringify(undeclared)}`,
      );
      assert.deepEqual(
        undeclared,
        [],
        `every data-l10n-id in ${url} is declared in src/i18n/keys.ts`,
      );
      if (unique.length === 0) {
        // Not a failure of this card, but it is P1-T20's criterion failing, so
        // it is said out loud rather than passed over.
        log(
          `markup ${url}: WARNING — the document exists and localizes nothing. ` +
            `P1-T20 requires every visible string to be a data-l10n-id.`,
        );
      }
    }
    log(
      `markup scrape: ${documentsFound} of ${MARKUP_URLS.length} Phase 1 ` +
        `documents present. 0 means P1-T20 has not run yet and P1-T18's first ` +
        `criterion is satisfied only vacuously — reported, not papered over.`,
    );
  });
});

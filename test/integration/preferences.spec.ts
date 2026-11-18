/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T44` — the preference pane, its two literature-source credential blocks
 * and the negative assertion, inside a real Zotero.
 *
 * ## No real key is ever used, and nothing pre-existing is touched
 *
 * Every value stored here is `rhsyn-<hex>`: key-shaped, obviously fake, unique
 * per run. The spec **refuses to run its storage sections** if a login for
 * either `source.ncbi` or `source.semanticscholar` already exists under this
 * plugin's origin and realm — if the owner has stored a real key, this file must
 * not overwrite it, decrypt it, or measure it. It restores the `ncbi.keyPresent`
 * user value as it found it. (`test/integration/zotero/keychain.spec.ts` set
 * this discipline; it is copied, not relaxed.)
 *
 * ## What is asserted where
 *
 * 1. **Registration and teardown** — the pane is in
 *    `Zotero.PreferencePanes.pluginPanes` under this plugin's ID with the fixed
 *    id, the host is published at `api.preferences`, and a plain disable
 *    removes both with zero live handles; enable brings both back.
 * 2. **The live pane** — opened through
 *    `Zotero.Utilities.Internal.openPreferences(paneID)`, which is exactly the
 *    call the search window's **Open Preferences** action now makes, so this is
 *    also criterion 6. The window's own navigation value is read back, the
 *    fragment's controls are inspected as DOM, and the five `docs/09` §1.8
 *    paragraphs are compared against what the window's Fluent resolves for the
 *    same ids. (The word-for-word comparison against `docs/09` itself is
 *    `test/unit/ui/preferencesPane.test.ts`'s, which can read the file.)
 * 3. **The shipped host** — store, presence, digest, replace, clear and
 *    remove-all through `api.preferences`, verified by reading the keystore
 *    back through the shipped store. Its Test call is **not** driven: it would
 *    reach the network, and a live request is the owner's (`G-18`).
 * 4. **The negative assertion** — a second host, built by this spec over the
 *    *same* login manager with a stubbed `request`, is driven through a
 *    succeeding and a failing Test call whose transport deliberately echoes the
 *    key (in the body on success, in the error message and URL on failure).
 *    Then Debug Output, both console channels, every preference in the profile
 *    that has a user value, `Zotero.getErrors()` and every note in the library
 *    are swept for the key, its digest and its last sixteen characters. The
 *    sweep is proven non-vacuous: the host logged something, the request that
 *    went out did carry the key, and a user-set control preference is found.
 *    *Changed 2026-11-18 (owner, `plan/00` §6 item 403(c)):* shipped defaults
 *    are no longer searched, and the four-character tail became sixteen.
 *
 * ## The UI locale is pinned to `en-US` (2026-10-26)
 *
 * Section 2 asserts one English sentence on screen ("including any other
 * Zotero plugin"). The test Zotero starts in the machine's locale, `ko-KR` on
 * the machine this suite is run on, and since the owner approved the pending
 * Korean strings (`plan/00` §6 item 284(a)) the pane renders that paragraph in
 * Korean there. So the block pins `en-US` in its `before()`, before any
 * preferences window opens, and puts the locale back as it found it in its
 * `after()`, as soon as the window is closed (`support/uiLocale.ts`). The
 * other paragraph checks compare against what the window's own Fluent
 * resolves, so they hold in any locale.
 *
 * Sandbox caveats (`docs/01` §2.3): no `console`, no `performance`.
 */

import type Addon from "../../src/addon";
import { config } from "../../package.json";
import { createSystemClock } from "../../src/core/clock";
import { UpstreamServerError } from "../../src/core/errors";
import type { HttpRequest, HttpResponse } from "../../src/core/http/client";
import { DIAGNOSTICS_SECTIONS } from "../../src/core/diagnostics";
import { LOG_PREFIX, createLogger } from "../../src/core/logger";
import type { ServiceGraph } from "../../src/bootstrap/container";
import type { SecretId } from "../../src/core/secretStore";
import type { ProviderId } from "../../src/model/ids";
import { PREF_KEYS, setPrefStore } from "../../src/prefs";
import { qualifiedPrefKey } from "../../src/prefs/keys";
import {
  LLM_CREDENTIALS,
  PANE_BOUND_SETTINGS,
  PANE_CREDENTIALS,
  PREFERENCES_API_PROPERTY,
  PREFERENCES_L10N,
  PREFERENCES_PANE_ID,
  PREFERENCES_ROOT_ID,
  SOURCE_CREDENTIALS,
  createPreferencesHost,
  keyDigest,
  type PreferencesHostApi,
  type ProviderPrefsPort,
  type TestReport,
} from "../../src/ui/prefs/preferencesPane";
import { createKeychainSecretStore } from "../../src/zotero/keychain";
import {
  POLICY_NOTES,
  POLICY_NOTES_AS_OF,
} from "../../src/llm/shared/policyNotes";
import { pluginDatabasePath } from "../../src/zotero/db";
import {
  clearPref as clearRawPref,
  createZoteroPrefStore,
  findBranchPrefsContaining,
  getPref as getRawPref,
  listBranchPrefs,
  prefHasUserValue,
  setPref as setRawPref,
  type PrefScalar,
} from "../../src/zotero/prefStore";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  isNotNull(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const STEP_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 90_000;

function log(line: string): void {
  debug(`[P1-T44] ${line}`);
}

/* ------------------------------------------------------- platform helpers */

interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
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
      assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await delay(100);
  }
}

async function initializedInstance(): Promise<Addon> {
  await waitUntil(
    () => pluginInstance()?.data.initialized === true,
    `Zotero.${config.addonInstance}.data.initialized`,
  );
  return pluginInstance()!;
}

async function researchHelperAddon(): Promise<AddonWrapper> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) {
    assert.fail(`AddonManager does not know ${config.addonID}`);
  }
  return wrapper;
}

/** Resolve after Zotero has *finished* the plugin's bootstrap `method`. */
function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) {
          return;
        }
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
}

function ourPanes(): _ZoteroTypes._PreferencePaneOption[] {
  return Zotero.PreferencePanes.pluginPanes.filter(
    (pane) => pane.pluginID === config.addonID,
  );
}

function publishedHost(instance: Addon): PreferencesHostApi | undefined {
  return (instance.api as Record<string, unknown>)[PREFERENCES_API_PROPERTY] as
    PreferencesHostApi | undefined;
}

/* ----------------------------------------------------- synthetic fixtures */

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Key-shaped, obviously fake, unique per run. Never a real key. */
function syntheticKey(): string {
  return `rhsyn-${randomHex(15)}`;
}

const PANE_IDS: readonly SecretId[] = SOURCE_CREDENTIALS.map(
  (entry) => entry.id,
);

/** The four LLM ids (`P3-T04`). */
const LLM_IDS: readonly SecretId[] = LLM_CREDENTIALS.map((entry) => entry.id);

/** Each LLM id's `<provider>.keyPresent` row, branch-relative. */
const LLM_FLAG: Readonly<Record<ProviderId, string>> = {
  openrouter: PREF_KEYS.openrouterKeyPresent,
  openai: PREF_KEYS.openaiKeyPresent,
  gemini: PREF_KEYS.geminiKeyPresent,
  anthropic: PREF_KEYS.anthropicKeyPresent,
};

/** A port that writes nowhere, for a second host that never sets a base URL. */
const INERT_PROVIDER_PREFS: ProviderPrefsPort = {
  getActiveProvider: () => "openrouter",
  getBaseUrl: () => "",
  setBaseUrl: () => {
    throw new Error("this spec's second host never writes a base URL");
  },
};

/**
 * The profile's `prefs.js` after a forced flush (`zotero/secrets.spec.ts`'s method).
 *
 * *Added 2026-10-23 (wave 7's combined run):* the read is retried, up to five
 * times 200 ms apart, while Windows reports the file locked. Run 1 of three
 * failed the P3-T04 test with `NS_ERROR_FILE_IS_LOCKED` from `readUTF8`, and
 * runs 2 and 3 passed. The likely cause, not measured: the pref service's own
 * background save of `prefs.js` still holding the file just after this forced
 * one — and since `P3-T14` every key stored or cleared also writes the two
 * validation rows, so it saves more often. A lock is not a verdict on the
 * file's content; any other error, or a lock that outlasts the retries,
 * still fails the test.
 */
async function flushedPrefsFile(): Promise<string> {
  // `null` means "the profile's prefs.js" (nsIPrefService); the binding omits it.
  Services.prefs.savePrefFile(null as unknown as nsIFile);
  const path = PathUtils.join(PathUtils.profileDir, "prefs.js");
  for (let attempt = 1; ; attempt += 1) {
    try {
      return (await IOUtils.exists(path)) ? await IOUtils.readUTF8(path) : "";
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("NS_ERROR_FILE_IS_LOCKED")) {
        throw error;
      }
      log(`prefs.js was locked on read ${attempt}; reading again`);
      await delay(200);
    }
  }
}

/* -------------------------------------------------------- the sweep tools */

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle.length > 0 && text.includes(needle));
}

/**
 * The tail of a synthetic key the sweeps search for besides the whole key and
 * its digest: long enough that a chance match is negligible.
 *
 * > **DECIDED 2026-11-18 (owner, plan/00 §6 item 403(c)): "기본값 설정은 건너뜀".**
 * > The tail was four characters (`key.slice(-4)`, random hex). In batch F's
 * > recorded run 1 the whole-profile sweep matched it inside a shipped default,
 * > `browser.contentblocking.report.mobile-ios.url`, an App Store URL ending in
 * > digits. Sixteen hex characters are 64 random bits, so a chance match in the
 * > profile's text is negligible. *Coordinator, under item 313:* the length.
 */
const KEY_TAIL_NEEDLE_LENGTH = 16;

/** {@link KEY_TAIL_NEEDLE_LENGTH} characters from the end of `key`. */
function keyTail(key: string): string {
  return key.slice(-KEY_TAIL_NEEDLE_LENGTH);
}

/**
 * Every string-valued preference in the whole profile **that has a user
 * value** and holds a needle.
 *
 * A preference with no user value holds only its shipped default, which no
 * key typed in this session can be in, so it is skipped (owner, `plan/00` §6
 * item 403(c)). A user value that equals its default still counts as one and is
 * searched; every user-set preference is searched.
 */
function allPrefsContaining(needles: readonly string[]): {
  scanned: number;
  userSet: number;
  hits: string[];
} {
  const branch = Services.prefs.getBranch("");
  const names = branch.getChildList("");
  const hits: string[] = [];
  let userSet = 0;
  for (const name of names) {
    if (branch.getPrefType(name) !== Services.prefs.PREF_STRING) continue;
    if (!branch.prefHasUserValue(name)) continue;
    userSet += 1;
    let value: string;
    try {
      value = branch.getStringPref(name);
    } catch {
      continue;
    }
    if (containsAny(value, needles)) hits.push(name);
  }
  return { scanned: names.length, userSet, hits };
}

/**
 * The sweep cannot be blind to user values: a user-set control preference
 * holding a marker is found, and is cleared again.
 */
function assertSweepSeesUserValues(): void {
  const marker = `rhsweep-${randomHex(16)}`;
  const name = `extensions.zotero.rh-sweep-control-${randomHex(4)}`;
  Services.prefs.setStringPref(name, marker);
  try {
    assert.deepEqual(
      allPrefsContaining([marker]).hits,
      [name],
      "the whole-profile sweep finds a user-set preference holding a needle",
    );
  } finally {
    Services.prefs.clearUserPref(name);
  }
}

/** How many notes in the user library contain any needle. */
async function notesContaining(needles: readonly string[]): Promise<number> {
  let total = 0;
  for (const needle of needles) {
    // `libraryID` is read-only on the typed object; Zotero's own code passes it
    // to the constructor (`search.js`: `new Zotero.Search({ libraryID })`).
    const search = new Zotero.Search({
      libraryID: Zotero.Libraries.userLibraryID,
    } as unknown as ConstructorParameters<typeof Zotero.Search>[0]);
    search.addCondition("note", "contains", needle);
    const ids = await search.search();
    total += ids.length;
  }
  return total;
}

interface Sweep {
  readonly debugOutput: string;
  readonly consoleMessages: string[];
  readonly branchHits: string[];
  readonly allPrefs: { scanned: number; userSet: number; hits: string[] };
  readonly errors: string[];
  readonly notes: number;
}

async function sweep(needles: readonly string[]): Promise<Sweep> {
  const debugOutput = String(await Zotero.Debug.get());
  const consoleMessages = Services.console
    .getMessageArray()
    .map((message) => String(message.message));
  return {
    debugOutput,
    consoleMessages,
    branchHits: findBranchPrefsContaining(needles),
    allPrefs: allPrefsContaining(needles),
    errors: Zotero.getErrors(true),
    notes: await notesContaining(needles),
  };
}

function assertClean(result: Sweep, needles: readonly string[], when: string) {
  assert.isFalse(
    containsAny(result.debugOutput, needles),
    `${when}: Debug Output does not contain the key or its digest`,
  );
  assert.deepEqual(
    result.consoleMessages.filter((text) => containsAny(text, needles)),
    [],
    `${when}: no console message contains the key or its digest`,
  );
  assert.deepEqual(
    result.branchHits,
    [],
    `${when}: no preference under the plugin branch holds the key or its digest`,
  );
  assert.deepEqual(
    result.allPrefs.hits,
    [],
    `${when}: no preference anywhere in the profile holds the key or its digest`,
  );
  assert.deepEqual(
    result.errors.filter((text) => containsAny(text, needles)),
    [],
    `${when}: no Zotero.getErrors() entry contains the key or its digest`,
  );
  assert.strictEqual(
    result.notes,
    0,
    `${when}: no note in the library contains the key or its digest`,
  );
}

/* ------------------------------------------------------------- the specs */

describe("P1-T44 — the preference pane", function () {
  /** The `ncbi.keyPresent` user value as found, restored at the end. */
  let flagBefore: PrefScalar | undefined;
  let flagHadUserValue = false;
  /** The preferences window this spec opened, if any. */
  let prefsWindow: Window | null = null;
  /** The ids this spec stored and must remove again. */
  const stored = new Set<SecretId>();
  /** The UI locale as found, put back in `after()`. */
  let localeBefore: UILocaleSnapshot | undefined;

  // See "The UI locale is pinned to `en-US`" in this file's header.
  before(async function () {
    localeBefore = await pinUILocale(["en-US"], log);
  });

  // This spec is bundled separately from the plugin and so has its own copy of
  // `src/prefs`' module state. The shipped store's `set`/`clear` re-derive
  // `ncbi.keyPresent` through `setPref`, which throws `ConfigurationError`
  // without an installed `PrefStore` — measured on run 1 of this spec
  // (2026-10-13). `keychain.spec.ts` installs one the same way.
  setPrefStore(createZoteroPrefStore());

  after(async function () {
    const store = createKeychainSecretStore();
    for (const id of stored) {
      try {
        await store.clear(id);
      } catch (error) {
        log(`cleanup: could not clear ${id}: ${String(error)}`);
      }
    }
    if (flagHadUserValue && flagBefore !== undefined) {
      setRawPref(PREF_KEYS.ncbiKeyPresent, flagBefore);
    } else {
      clearRawPref(PREF_KEYS.ncbiKeyPresent);
    }
    if (prefsWindow && !prefsWindow.closed) {
      prefsWindow.close();
    }
    // Once no preferences window is open, and before anything below can throw.
    if (localeBefore) {
      await restoreUILocale(localeBefore, log);
      localeBefore = undefined;
    }
    const wrapper = await researchHelperAddon();
    if (!wrapper.isActive) {
      await afterBootstrapCall("startup", () => wrapper.enable());
    }
    await initializedInstance();
    setPrefStore(undefined);
  });

  it("registers one pane under this plugin's ID with the fixed id, and publishes the host", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const panes = ourPanes();
    log(
      `pluginPanes for ${config.addonID}: ${panes.length} ` +
        `(${panes.map((pane) => pane.id).join(", ")})`,
    );
    assert.strictEqual(panes.length, 1, "exactly one pane of ours");
    assert.strictEqual(panes[0]!.id, PREFERENCES_PANE_ID, "the fixed pane id");
    assert.include(panes[0]!.src, "content/preferences.xhtml", "the fragment");
    assert.strictEqual(
      panes[0]!.scripts?.length,
      1,
      "exactly one controller script",
    );
    assert.include(panes[0]!.scripts![0]!, "content/preferences.js");

    const host = publishedHost(instance);
    assert.isTrue(
      host !== undefined,
      `api.${PREFERENCES_API_PROPERTY} published`,
    );
    assert.strictEqual(host!.paneId, PREFERENCES_PANE_ID);
    for (const method of [
      "readState",
      "storeKey",
      "clearKey",
      "clearAllKeys",
      "testKey",
      "setBaseUrl",
    ] as const) {
      assert.strictEqual(
        typeof host![method],
        "function",
        `host.${method} is a function`,
      );
    }
    const state = await host!.readState();
    log(
      `host state: backendPref="${state.backendPref}", storeAvailable=${String(state.storeAvailable)}, ` +
        `credentials ${state.credentials.map((c) => `${c.id}:${String(c.present)}`).join(" ")}`,
    );
    assert.deepEqual(
      state.credentials.map((c) => c.id),
      PANE_CREDENTIALS.map((c) => c.id),
      "the two literature-source credentials and the four LLM ones (P3-T04), and no other",
    );
  });

  it("disappears on a plain disable with zero live handles, and comes back on enable", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const wrapper = await researchHelperAddon();
    const before = await initializedInstance();

    await afterBootstrapCall("shutdown", () => wrapper.disable());
    await waitUntil(
      () => pluginInstance() === undefined,
      `Zotero.${config.addonInstance} to be removed by onShutdown`,
    );
    assert.deepEqual(
      before.scope.liveHandles(),
      [],
      "registry reports zero live handles after unregisterAll()",
    );
    assert.deepEqual(
      ourPanes().map((pane) => pane.id),
      [],
      "no pane of ours survives the disable",
    );
    assert.isUndefined(
      publishedHost(before),
      "the host is removed from the dead instance's api",
    );

    await afterBootstrapCall("startup", () => wrapper.enable());
    const fresh = await initializedInstance();
    assert.notStrictEqual(fresh, before, "enable builds a fresh instance");
    assert.deepEqual(
      ourPanes().map((pane) => pane.id),
      [PREFERENCES_PANE_ID],
      "the pane is registered again",
    );
    assert.isTrue(
      publishedHost(fresh) !== undefined,
      "the host is published again",
    );
  });

  it("is selected by Zotero.Utilities.Internal.openPreferences(paneID) — the Open Preferences action — and renders the rules", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await initializedInstance();

    const win = Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
    assert.isNotNull(win, "openPreferences returned a window");
    prefsWindow = win;

    interface PrefsWindow extends Window {
      Zotero_Preferences?: {
        navigation: { value: string };
        panes: Map<string, { loaded?: boolean; container: Element }>;
        getScope(paneID: string): Record<string, unknown> | null;
      };
    }
    const prefs = win as PrefsWindow;
    await waitUntil(
      () =>
        prefs.Zotero_Preferences?.panes?.get(PREFERENCES_PANE_ID)?.loaded ===
        true,
      "the pane to finish loading",
    );
    assert.strictEqual(
      prefs.Zotero_Preferences!.navigation.value,
      PREFERENCES_PANE_ID,
      "the window's navigation selected our pane",
    );
    const doc = win!.document;
    const root = doc.getElementById(PREFERENCES_ROOT_ID);
    assert.isNotNull(root, "the fragment root is in the document");
    await waitUntil(
      () => root!.getAttribute("data-rh-initialized") === "true",
      "the controller to initialise",
    );
    const scope = prefs.Zotero_Preferences!.getScope(PREFERENCES_PANE_ID);
    assert.isTrue(
      scope !== null && typeof scope["RHPreferences"] === "object",
      "the controller lives in the pane's isolated scope",
    );

    // Rules 1 and 9 as rendered — all six key fields (P3-T04 added four).
    for (const { elementPrefix } of PANE_CREDENTIALS) {
      const input = doc.getElementById(
        `${elementPrefix}-key`,
      ) as HTMLInputElement | null;
      assert.isNotNull(input, `${elementPrefix}-key exists`);
      assert.strictEqual(
        input!.type,
        "password",
        `${elementPrefix}-key is masked`,
      );
      assert.isFalse(
        input!.hasAttribute("preference"),
        `${elementPrefix}-key has no preference attribute`,
      );
      assert.strictEqual(input!.value, "", `${elementPrefix}-key is empty`);
      for (const control of ["reveal", "test", "clear", "status", "backend"]) {
        assert.isNotNull(
          doc.getElementById(`${elementPrefix}-${control}`),
          `${elementPrefix}-${control} exists`,
        );
      }
    }
    // P3-T04: the only bound elements are docs/07 §8.5's non-secret rows —
    // llmProvider, the four <provider>.model fields and gemini.paidTier, and
    // since 2026-11-17 P7-T08's ten and P7-T09's three (PANE_BOUND_SETTINGS) — and no key field
    // or base-URL field is among them.
    const bound = [
      ...doc.querySelectorAll(`#${PREFERENCES_ROOT_ID} [preference]`),
    ];
    const allowed = new Set(
      [
        PREF_KEYS.llmProvider,
        PREF_KEYS.openrouterModel,
        PREF_KEYS.openaiModel,
        PREF_KEYS.geminiModel,
        PREF_KEYS.anthropicModel,
        PREF_KEYS.geminiPaidTier,
        ...Object.values(PANE_BOUND_SETTINGS).flat(),
      ].map((key) => qualifiedPrefKey(key)),
    );
    assert.strictEqual(bound.length, allowed.size, "nineteen bound elements");
    for (const element of bound) {
      const name = element.getAttribute("preference") ?? "";
      assert.isTrue(allowed.has(name), `${name} is an allowed binding`);
      assert.isFalse(
        element.classList.contains("rh-key") ||
          element.classList.contains("rh-base-url"),
        `${element.id} is neither a key field nor a base-URL field`,
      );
    }
    // Rule 4: one provider block is shown, the others hidden but present.
    const shownBlocks = LLM_CREDENTIALS.filter(
      ({ provider }) =>
        !(
          doc.getElementById(`rh-provider-${provider}`) as
            (Element & { hidden?: boolean }) | null
        )?.hidden,
    );
    assert.strictEqual(
      shownBlocks.length,
      1,
      "exactly one provider block shown",
    );
    log(`shown provider block: ${shownBlocks[0]?.provider ?? "none"}`);

    // Rule 3: the badge says something, in the window's own language.
    const badge = doc.getElementById("rh-prefs-backend");
    assert.isNotNull(badge, "the badge exists");
    const badgeText = (badge!.textContent ?? "").trim();
    log(
      `badge: l10n=${badge!.getAttribute("data-l10n-id")} text="${badgeText}"`,
    );
    assert.isAbove(badgeText.length, 0, "the badge is not blank");

    // Rule 4: the five paragraphs are rendered and visible, and each equals
    // what Fluent resolves for its id in this window.
    const riskIds = [
      PREFERENCES_L10N.risk1,
      PREFERENCES_L10N.risk2,
      PREFERENCES_L10N.risk3,
      PREFERENCES_L10N.risk4,
      PREFERENCES_L10N.risk5,
    ];
    const l10n = (doc as unknown as { l10n: Localization }).l10n;
    for (const id of riskIds) {
      const paragraph = doc.querySelector(`[data-l10n-id="${id}"]`);
      assert.isNotNull(paragraph, `${id} is in the pane`);
      const expected = await l10n.formatValue(id);
      assert.isTrue(
        typeof expected === "string" && expected.length > 0,
        `${id} resolves in this window`,
      );
      assert.strictEqual(
        (paragraph!.textContent ?? "").trim(),
        expected!.trim(),
        `${id} is rendered as the bundle has it`,
      );
      const style = win!.getComputedStyle(paragraph!);
      assert.notStrictEqual(style?.display, "none", `${id} is not hidden`);
      assert.isFalse(paragraph!.hasAttribute("hidden"), `${id} is not hidden`);
    }
    const fourth = doc.querySelector(
      `[data-l10n-id="${PREFERENCES_L10N.risk4}"]`,
    )!;
    assert.include(
      fourth.textContent ?? "",
      "including any other Zotero plugin",
      "the sentence about other Zotero plugins is on screen",
    );
    assert.isNotNull(
      doc.getElementById("rh-prefs-remove-all"),
      "Remove all stored keys is present",
    );
    // Narrowed 2026-11-17 (P7-T13; coordinator, under plan/00 §6 item 313), as
    // the unit test "rule 8: no copy affordance in the markup or the script"
    // is: the diagnostics "Copy diagnostics" button is the one copy
    // affordance, and it copies the diagnostics text, never a key field.
    assert.deepEqual(
      [...doc.querySelectorAll(`#${PREFERENCES_ROOT_ID} [id*="copy" i]`)]
        .map((element) => element.id)
        .filter((id) => id !== "rh-diagnostics-copy"),
      [],
      "no copy affordance other than Copy diagnostics",
    );

    // Calling the action again with the window open navigates rather than
    // opening a second window.
    const again =
      Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
    assert.strictEqual(again, win, "a second call reuses the open window");

    win!.close();
    prefsWindow = null;
  });

  it("stores, shows presence and digest, replaces and clears a synthetic key through the shipped host", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;
    const store = createKeychainSecretStore();

    const initial = await host.readState();
    if (!initial.storeAvailable) {
      log(
        "SKIPPED: no secret backend is live on this machine, so storage " +
          "cannot be exercised; the badge must say so (asserted above).",
      );
      assert.strictEqual(initial.backendPref, "", "unavailable means unprobed");
      return;
    }
    for (const id of PANE_IDS) {
      if (await store.has(id)) {
        log(
          `SKIPPED: a login for ${id} already exists under this plugin's ` +
            `origin; this spec never overwrites, decrypts or measures it.`,
        );
        return;
      }
    }

    flagHadUserValue = prefHasUserValue(PREF_KEYS.ncbiKeyPresent);
    flagBefore = getRawPref(PREF_KEYS.ncbiKeyPresent);

    const first = syntheticKey();
    const result = await host.storeKey("source.ncbi", `Bearer ${first} `);
    stored.add("source.ncbi");
    assert.deepEqual(
      result,
      { stored: true, digest: keyDigest(first) },
      "stored, with the digest of the normalised value",
    );
    assert.isTrue(await store.has("source.ncbi"), "the keystore has it");
    assert.strictEqual(
      await store.get("source.ncbi"),
      first,
      "what the keystore holds is the trimmed key without the scheme word",
    );
    assert.strictEqual(
      getRawPref(PREF_KEYS.ncbiKeyPresent),
      true,
      "ncbi.keyPresent was re-derived to true by the shipped store",
    );
    let state = await host.readState();
    assert.deepEqual(
      state.credentials.find((c) => c.id === "source.ncbi")?.present,
      true,
    );

    const second = syntheticKey();
    const replaced = await host.storeKey("source.ncbi", second);
    assert.deepEqual(replaced, { stored: true, digest: keyDigest(second) });
    assert.strictEqual(await store.get("source.ncbi"), second, "replaced");

    assert.isTrue(await host.clearKey("source.ncbi"), "something was removed");
    assert.isFalse(await store.has("source.ncbi"), "the keystore is empty");
    assert.strictEqual(
      getRawPref(PREF_KEYS.ncbiKeyPresent),
      false,
      "ncbi.keyPresent was re-derived to false",
    );
    assert.isFalse(await host.clearKey("source.ncbi"), "nothing left");

    // Remove all, over exactly the ids this spec put there.
    const others = (await store.listStoredIds()).filter(
      (id) => !PANE_IDS.includes(id),
    );
    if (others.length > 0) {
      log(
        `remove-all count not asserted: ${others.length} other id(s) are ` +
          `stored on this machine and this spec will not remove them.`,
      );
      return;
    }
    await host.storeKey("source.ncbi", syntheticKey());
    await host.storeKey("source.semanticscholar", syntheticKey());
    stored.add("source.semanticscholar");
    const removed = await host.clearAllKeys();
    assert.strictEqual(removed, 2, "Remove all reports how many it removed");
    assert.deepEqual(await store.listStoredIds(), [], "the store is empty");
    state = await host.readState();
    assert.isTrue(state.credentials.every((c) => !c.present));
  });

  it("the key reaches no log line, no preference, no error and no note — on a succeeding and on a failing Test call", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const shipped = publishedHost(instance)!;
    const store = createKeychainSecretStore();
    if (!(await shipped.readState()).storeAvailable) {
      log("SKIPPED: no secret backend is live; see the previous section.");
      return;
    }
    if (await store.has("source.ncbi")) {
      log("SKIPPED: a login for source.ncbi already exists; not touched.");
      return;
    }

    // A second host over the SAME login manager, with a transport that
    // deliberately echoes the key — in the body on success, in the error's
    // message and context on failure — because that is the worst case the
    // host has to stay silent through.
    const requests: HttpRequest[] = [];
    let mode: "ok" | "fail" = "ok";
    const key = syntheticKey();
    const request = (req: HttpRequest): Promise<HttpResponse> => {
      requests.push(req);
      if (mode === "fail") {
        return Promise.reject(
          new UpstreamServerError(500, `request to ${req.url} failed`, {
            url: req.url,
          }),
        );
      }
      const headers = new Map([["x-ratelimit-limit", "10"]]);
      return Promise.resolve({
        status: 200,
        url: req.url,
        body: JSON.stringify({ echo: key }),
        rawHeaders: "X-Ratelimit-Limit: 10",
        header: (name: string) => headers.get(name.toLowerCase()),
      });
    };
    const clock = createSystemClock();
    const host = createPreferencesHost({
      secrets: store,
      request,
      getBackendPref: () => "oskeystore",
      providerPrefs: INERT_PROVIDER_PREFS,
      clock,
      logger: createLogger({
        clock,
        level: "debug",
        sink: {
          write: (line) => Zotero.debug(line),
          reportError: (line) => Zotero.logError(new Error(line)),
        },
      }),
    });

    const debugWasStoring = Boolean(Zotero.Debug.storing);
    if (!debugWasStoring) Zotero.Debug.setStore(true);
    const debugLinesBefore = Number(Zotero.Debug.count());
    const errorsBefore = Zotero.getErrors(true).length;

    try {
      const storeResult = await host.storeKey("source.ncbi", key);
      stored.add("source.ncbi");
      if (!storeResult.stored) assert.fail("fixture: store refused");
      const digest = storeResult.digest;
      const needles = [key, digest, keyTail(key)];

      const reports: TestReport[] = [];
      mode = "ok";
      reports.push(await host.testKey("source.ncbi"));
      mode = "fail";
      reports.push(await host.testKey("source.ncbi"));

      assert.strictEqual(requests.length, 2, "two requests went out");
      assert.isTrue(
        requests.every((req) => req.url.includes(key)),
        "the request really carried the key (so the sweep is not vacuous)",
      );
      assert.deepEqual(
        reports.map((r) => (r.kind === "tested" ? r.outcome : r.kind)),
        ["ok", "inconclusive"],
        "success then failure",
      );

      const result = await sweep(needles);
      const newLines = Number(Zotero.Debug.count()) - debugLinesBefore;
      log(
        `sweep: Debug Output ${result.debugOutput.length} chars, ${newLines} new line(s), ` +
          `storing was ${String(debugWasStoring)}; console ${result.consoleMessages.length} msgs; ` +
          `plugin-branch hits ${result.branchHits.length}; all prefs listed ${result.allPrefs.scanned}, ` +
          `string prefs with a user value searched ${result.allPrefs.userSet}, ` +
          `hits ${result.allPrefs.hits.length}; errors ${result.errors.length} ` +
          `(${result.errors.length - errorsBefore} new); notes containing ${result.notes}`,
      );
      assert.isAbove(
        newLines,
        0,
        "the host logged something, so the sweep reads real lines",
      );
      assertClean(result, needles, "after a succeeding and a failing Test");
      assert.isAbove(
        result.allPrefs.userSet,
        0,
        "the whole-profile sweep searched user-set preferences",
      );
      assertSweepSeesUserValues();

      // The reports and the state the pane would paint carry none of it either.
      const painted = JSON.stringify([reports, await host.readState()]);
      assert.isFalse(
        containsAny(painted, needles),
        "nothing the pane receives carries the key",
      );
    } finally {
      await store.clear("source.ncbi");
      stored.delete("source.ncbi");
      if (!debugWasStoring) Zotero.Debug.setStore(false);
    }
  });

  it("P3-T04: each LLM block stores, masks and clears a synthetic key through the shipped host, its keyPresent flag follows, and prefs.js never holds it", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;
    const store = createKeychainSecretStore();
    if (!(await host.readState()).storeAvailable) {
      log("SKIPPED: no secret backend is live; see the storage section.");
      return;
    }
    // Never touch a real key: refuse if any LLM id — or tts.gemini, which
    // shares gemini.keyPresent — already holds a login.
    for (const id of [...LLM_IDS, "tts.gemini" as const]) {
      if (await store.has(id)) {
        log(
          `SKIPPED: a login for ${id} already exists under this plugin's ` +
            `origin; this spec never overwrites, decrypts or measures it.`,
        );
        return;
      }
    }
    const flagsBefore = new Map<
      string,
      { had: boolean; value: PrefScalar | undefined }
    >();
    for (const flag of Object.values(LLM_FLAG)) {
      flagsBefore.set(flag, {
        had: prefHasUserValue(flag),
        value: getRawPref(flag),
      });
    }
    const needles: string[] = [];
    try {
      for (const { id, provider } of LLM_CREDENTIALS) {
        const key = `sk-rhsyn-${randomHex(20)}`;
        const result = await host.storeKey(id, `Bearer ${key} `);
        stored.add(id);
        assert.deepEqual(
          result,
          { stored: true, digest: keyDigest(key) },
          `${id}: stored, with the digest of the normalised value`,
        );
        needles.push(key, keyDigest(key));
        assert.strictEqual(
          await store.get(id),
          key,
          `${id}: the keystore holds the trimmed key without the scheme word`,
        );
        assert.strictEqual(
          getRawPref(LLM_FLAG[provider]),
          true,
          `${provider}.keyPresent was re-derived to true`,
        );
        const state = await host.readState();
        assert.isTrue(
          state.credentials.find((c) => c.id === id)?.present === true,
          `${id}: the pane reads it as present`,
        );
        const prefsFile = await flushedPrefsFile();
        assert.isFalse(
          containsAny(prefsFile, [key, keyDigest(key)]),
          `${id}: the profile's prefs.js holds neither the key nor its digest`,
        );
        assert.isTrue(await host.clearKey(id), `${id}: something was removed`);
        stored.delete(id);
        assert.isFalse(await store.has(id), `${id}: the keystore is empty`);
        assert.strictEqual(
          getRawPref(LLM_FLAG[provider]),
          false,
          `${provider}.keyPresent was re-derived to false`,
        );
      }
      assert.deepEqual(
        allPrefsContaining(needles).hits,
        [],
        "no preference anywhere in the profile holds any of the four keys or digests",
      );
      assertSweepSeesUserValues();
      assert.isFalse(
        containsAny(await flushedPrefsFile(), needles),
        "prefs.js holds none of them after the four clears either",
      );
    } finally {
      for (const id of LLM_IDS) {
        if (!stored.has(id)) continue;
        try {
          await store.clear(id);
        } catch (error) {
          log(`cleanup: could not clear ${id}: ${String(error)}`);
        }
        stored.delete(id);
      }
      for (const [flag, before] of flagsBefore) {
        if (before.had && before.value !== undefined) {
          setRawPref(flag, before.value);
        } else {
          clearRawPref(flag);
        }
      }
    }
  });

  it("P3-T04: the live pane refuses http:// and a trailing slash with a message, and stores and reads back https://proxy.example/v1", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;
    const prefKey = PREF_KEYS.openaiBaseUrl;
    const had = prefHasUserValue(prefKey);
    const before = getRawPref(prefKey);

    const win = Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
    assert.isNotNull(win, "openPreferences returned a window");
    prefsWindow = win;
    interface PrefsWindow extends Window {
      Zotero_Preferences?: {
        panes: Map<string, { loaded?: boolean }>;
      };
    }
    await waitUntil(
      () =>
        (win as PrefsWindow).Zotero_Preferences?.panes?.get(PREFERENCES_PANE_ID)
          ?.loaded === true,
      "the pane to finish loading",
    );
    const doc = win!.document;
    const root = doc.getElementById(PREFERENCES_ROOT_ID);
    await waitUntil(
      () => root?.getAttribute("data-rh-initialized") === "true",
      "the controller to initialise",
    );
    const input = doc.getElementById(
      "rh-openai-base-url",
    ) as HTMLInputElement | null;
    const status = doc.getElementById("rh-openai-base-url-status");
    assert.isNotNull(input, "the OpenAI base-URL field exists");
    assert.isNotNull(status, "its status element exists");
    assert.isFalse(input!.hasAttribute("preference"), "the field is not bound");
    assert.strictEqual(
      input!.getAttribute("placeholder"),
      "https://api.openai.com/v1",
      "the placeholder is docs/03 §2.1's documented base URL",
    );
    const l10n = (doc as unknown as { l10n: Localization }).l10n;

    async function typeAndCommit(value: string, expectedId: string) {
      status!.removeAttribute("data-l10n-id");
      input!.value = value;
      input!.dispatchEvent(new win!.Event("change"));
      await waitUntil(
        () => status!.getAttribute("data-l10n-id") === expectedId,
        `"${value}" to be answered with ${expectedId}`,
      );
      const text = await l10n.formatValue(expectedId);
      assert.isTrue(
        typeof text === "string" && text.length > 0,
        `${expectedId} resolves to a message in this window`,
      );
    }

    try {
      const start = getRawPref(prefKey);
      await typeAndCommit(
        "http://proxy.example/v1",
        PREFERENCES_L10N.baseUrlNotHttps,
      );
      assert.strictEqual(getRawPref(prefKey), start, "http:// was not stored");
      assert.strictEqual(
        input!.value,
        "http://proxy.example/v1",
        "the refused value stays in the field as typed",
      );
      await typeAndCommit(
        "https://proxy.example/v1/",
        PREFERENCES_L10N.baseUrlTrailingSlash,
      );
      assert.strictEqual(
        getRawPref(prefKey),
        start,
        "a trailing slash was not stored, nor stripped and stored",
      );
      await typeAndCommit(
        "https://proxy.example/v1",
        PREFERENCES_L10N.baseUrlSaved,
      );
      assert.strictEqual(
        getRawPref(prefKey),
        "https://proxy.example/v1",
        "stored in openai.baseUrl",
      );
      const state = await host.readState();
      assert.strictEqual(
        state.providers.find((p) => p.provider === "openai")?.baseUrl,
        "https://proxy.example/v1",
        "read back through the host",
      );
    } finally {
      if (had && before !== undefined) {
        setRawPref(prefKey, before);
      } else {
        clearRawPref(prefKey);
      }
      win!.close();
      prefsWindow = null;
    }
  });

  it("P7-T08 and P7-T09: each Search, Report & audio, Privacy and Advanced control persists across a pane reopen; the folder row and the verbose-logging checkbox go through the host", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;

    interface PrefsWindow extends Window {
      Zotero_Preferences?: { panes: Map<string, { loaded?: boolean }> };
    }
    async function openPane(): Promise<Window> {
      const opened =
        Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
      assert.isNotNull(opened, "openPreferences returned a window");
      prefsWindow = opened;
      await waitUntil(
        () =>
          (opened as PrefsWindow).Zotero_Preferences?.panes?.get(
            PREFERENCES_PANE_ID,
          )?.loaded === true,
        "the pane to finish loading",
      );
      const root = opened!.document.getElementById(PREFERENCES_ROOT_ID);
      await waitUntil(
        () => root?.getAttribute("data-rh-initialized") === "true",
        "the controller to initialise",
      );
      return opened!;
    }
    /**
     * Close the window and wait until the window mediator no longer lists it.
     * `win.closed` turns true at once, but `openPreferences` focuses any
     * `zotero:pref` window the mediator still lists, so a reopen straight
     * after it returned the closing window, painted before the folder was
     * stored (measured 2026-11-17: its one paint was 56 ms before the store).
     */
    async function closePane(win: Window): Promise<void> {
      win.close();
      prefsWindow = null;
      await waitUntil(() => win.closed, "the preferences window to close");
      await waitUntil(
        () => !Services.wm.getEnumerator("zotero:pref").hasMoreElements(),
        "the window mediator to drop the preferences window",
      );
    }

    type Control = {
      readonly key: string;
      readonly id: string;
      readonly kind: "number" | "checkbox" | "menulist";
      readonly choices: readonly (string | number | boolean)[];
    };
    const controls: readonly Control[] = [
      { key: "searchYears", id: "rh-years", kind: "number", choices: [7, 8] },
      { key: "maxResults", id: "rh-max", kind: "number", choices: [50, 60] },
      {
        key: "useTranslators",
        id: "rh-use-translators",
        kind: "checkbox",
        choices: [true, false],
      },
      {
        key: "hideExisting",
        id: "rh-hide-existing",
        kind: "checkbox",
        choices: [false, true],
      },
      {
        key: "reportLanguage",
        id: "rh-lang",
        kind: "menulist",
        choices: ["ko", "en"],
      },
      {
        key: "tts.language",
        id: "rh-tts-lang",
        kind: "menulist",
        choices: ["en", "ko"],
      },
      {
        key: "tts.voice",
        id: "rh-voice",
        kind: "menulist",
        choices: ["Kore", "Puck"],
      },
      {
        key: "tts.targetMinutes",
        id: "rh-tts-minutes",
        kind: "number",
        choices: [12, 13],
      },
      {
        key: "privacy.mode",
        id: "rh-privacy",
        kind: "menulist",
        choices: ["strict", "full"],
      },
      {
        key: "summary.fullTextMode",
        id: "rh-fulltext",
        kind: "menulist",
        choices: ["never", "always"],
      },
      // P7-T09 (2026-11-17): the Advanced section's three number fields.
      { key: "concurrency", id: "rh-conc", kind: "number", choices: [4, 5] },
      {
        key: "timeoutSeconds",
        id: "rh-timeout",
        kind: "number",
        choices: [70, 80],
      },
      {
        key: "cache.maxSizeMB",
        id: "rh-cache-size",
        kind: "number",
        choices: [600, 700],
      },
    ];
    // Every PANE_BOUND_SETTINGS row is exercised, and nothing else.
    assert.deepEqual(
      controls.map((c) => c.key).sort(),
      [...Object.values(PANE_BOUND_SETTINGS).flat()].sort(),
      "the controls are PANE_BOUND_SETTINGS",
    );
    const touched = [
      ...controls.map((c) => c.key),
      PREF_KEYS.audioEnabled,
      PREF_KEYS.ttsLinkedFileDir,
      PREF_KEYS.logLevel,
      PREF_KEYS.logRequestBodies,
    ];
    const saved = touched.map((key) => ({
      key,
      had: prefHasUserValue(key),
      value: getRawPref(key),
    }));

    const read = (doc: Document, control: Control): string => {
      const element = doc.getElementById(control.id) as
        (Element & { value?: string; checked?: boolean }) | null;
      assert.isNotNull(element, `${control.id} exists`);
      return control.kind === "checkbox"
        ? String(element!.checked === true)
        : String(element!.value ?? "");
    };

    let win: Window | undefined;
    try {
      // The audio rows are shown only while audio.enabled is on.
      setRawPref(PREF_KEYS.audioEnabled, true);
      // P7-T09: the verbose-logging checkbox starts from `warn`.
      setRawPref(PREF_KEYS.logLevel, "warn");
      const bodiesBefore = getRawPref(PREF_KEYS.logRequestBodies);
      const noDebugRow = (): boolean =>
        getRawPref("debug") === undefined && !prefHasUserValue("debug");
      assert.isTrue(noDebugRow(), "no debug preference before the toggle");
      win = await openPane();
      let doc = win.document;
      const audio = doc.getElementById("rh-prefs-audio") as
        (Element & { hidden: boolean }) | null;
      assert.isFalse(audio!.hidden, "the audio rows are shown");
      const voices = doc.querySelectorAll("#rh-voice-popup menuitem");
      log(`voice list: ${voices.length} documented voices`);
      assert.isAbove(voices.length, 29, "the 30 documented voices");
      const explain = doc.getElementById("rh-privacy-explain");
      await waitUntil(
        () => (explain?.textContent ?? "").trim().length > 0,
        "the privacy line to be painted",
      );
      // P7-T17: the dated provider-policy lines, a heading and one per row of
      // POLICY_NOTES, each translated and ending in its verification date.
      const retention = doc.getElementById("rh-prefs-retention") as
        (Element & { hidden: boolean }) | null;
      assert.isFalse(retention!.hidden, "the provider-policy lines are shown");
      const policyLinesShown = [...retention!.children];
      assert.strictEqual(
        policyLinesShown.length,
        POLICY_NOTES.length + 1,
        "a heading and one line per POLICY_NOTES row",
      );
      await waitUntil(
        () =>
          policyLinesShown
            .slice(1)
            .every((p) => (p.textContent ?? "").includes(POLICY_NOTES_AS_OF)),
        "each provider-policy line to show its verification date",
      );

      const chosen = new Map<string, string>();
      for (const control of controls) {
        const current = read(doc, control);
        const target =
          control.choices.map(String).find((value) => value !== current) ??
          String(control.choices[0]);
        chosen.set(control.key, target);
        const element = doc.getElementById(control.id) as Element & {
          value: string;
          checked: boolean;
        };
        if (control.kind === "checkbox") {
          element.checked = target === "true";
          element.dispatchEvent(new win.Event("command"));
        } else if (control.kind === "menulist") {
          element.value = target;
          element.dispatchEvent(new win.Event("command"));
        } else {
          element.value = target;
          element.dispatchEvent(new win.Event("input"));
          element.dispatchEvent(new win.Event("change"));
        }
        await waitUntil(
          () => String(getRawPref(control.key)) === target,
          `${control.key} to be written by the binding`,
        );
      }

      // P7-T09: the verbose-logging checkbox writes logLevel through the host,
      // and nothing else; no `debug` preference appears.
      type CheckboxElement = Element & { checked: boolean; disabled: boolean };
      const verbose = doc.getElementById(
        "rh-verbose-logging",
      ) as CheckboxElement | null;
      assert.isNotNull(verbose, "the verbose-logging checkbox exists");
      assert.isFalse(verbose!.checked, "unchecked while logLevel is warn");
      assert.isFalse(verbose!.disabled, "the host can write logLevel");
      verbose!.checked = true;
      verbose!.dispatchEvent(new win.Event("command"));
      await waitUntil(
        () => getRawPref(PREF_KEYS.logLevel) === "debug",
        "the checkbox to write logLevel debug",
      );
      assert.strictEqual(
        getRawPref(PREF_KEYS.logRequestBodies),
        bodiesBefore,
        "logRequestBodies is unchanged",
      );
      assert.isTrue(noDebugRow(), "no debug preference after checking");
      // The cache lines: the total first. The plugin database is open in
      // the test profile, so the unavailable line would be a failure.
      const cacheLines = [
        ...(doc.getElementById("rh-cache-breakdown")?.children ?? []),
      ];
      assert.isAbove(cacheLines.length, 0, "the cache usage is painted");
      assert.strictEqual(
        cacheLines[0]!.getAttribute("data-l10n-id"),
        "research-helper-prefs-cache-usage-total",
        "the first cache line is the total",
      );
      log(`cache lines: ${String(cacheLines.length)}`);
      // The data location: the plugin database's file, shown, never printed.
      const location = doc.getElementById("rh-data-location");
      assert.strictEqual(
        location?.getAttribute("data-l10n-id"),
        "research-helper-prefs-data-location",
        "the data location line is painted",
      );
      const locationArgs = JSON.parse(
        location!.getAttribute("data-l10n-args") ?? "{}",
      ) as { path?: unknown };
      assert.isTrue(
        locationArgs.path === pluginDatabasePath(),
        "the data location is the plugin database's file",
      );
      assert.isFalse(
        (doc.getElementById("rh-data-location-show") as CheckboxElement)
          .disabled,
        "Show in folder is enabled",
      );

      // The folder: a temporary one is refused and nothing is written; the
      // profile folder is stored. Neither path is logged here.
      const refused = await host.setLinkedFolder(PathUtils.tempDir);
      assert.deepEqual(
        refused,
        { stored: false, reason: "unusable" },
        "a temporary folder is refused",
      );
      assert.strictEqual(
        getRawPref(PREF_KEYS.ttsLinkedFileDir) ?? "",
        saved.find((s) => s.key === PREF_KEYS.ttsLinkedFileDir)?.value ?? "",
        "the refusal wrote nothing",
      );
      const folder = PathUtils.profileDir;
      assert.deepEqual(
        await host.setLinkedFolder(folder),
        { stored: true, cleared: false },
        "the profile folder is stored",
      );

      await closePane(win);
      win = await openPane();
      doc = win.document;
      for (const control of controls) {
        assert.strictEqual(
          read(doc, control),
          chosen.get(control.key),
          `${control.key} reads back after a reopen`,
        );
      }
      const field = doc.getElementById("rh-tts-folder") as
        (Element & { value: string }) | null;
      assert.isTrue(field!.value === folder, "the folder reads back");
      // P7-T09: the checkbox renders from the stored logLevel on reopen, and
      // unchecking writes warn — again touching nothing else.
      const verboseAgain = doc.getElementById(
        "rh-verbose-logging",
      ) as CheckboxElement | null;
      assert.isTrue(verboseAgain!.checked, "checked after a reopen at debug");
      verboseAgain!.checked = false;
      verboseAgain!.dispatchEvent(new win.Event("command"));
      await waitUntil(
        () => getRawPref(PREF_KEYS.logLevel) === "warn",
        "the checkbox to write logLevel warn",
      );
      assert.strictEqual(
        getRawPref(PREF_KEYS.logRequestBodies),
        bodiesBefore,
        "logRequestBodies is still unchanged",
      );
      assert.isTrue(noDebugRow(), "no debug preference after unchecking");
      assert.strictEqual(
        doc.querySelectorAll("#rh-prefs-search [preference]").length,
        PANE_BOUND_SETTINGS.search.length,
        "Search binds its four rows",
      );
      // No autoSummarize control (owner, item 381).
      assert.strictEqual(
        doc.querySelectorAll(
          `[preference="${qualifiedPrefKey(PREF_KEYS.autoSummarize)}"]`,
        ).length,
        0,
        "no element is bound to autoSummarize",
      );
      // Forget clears the folder through the host.
      (doc.getElementById("rh-tts-folder-clear") as Element).dispatchEvent(
        new win.Event("command"),
      );
      await waitUntil(
        () => (getRawPref(PREF_KEYS.ttsLinkedFileDir) ?? "") === "",
        "Forget to clear tts.linkedFileDir",
      );
      await closePane(win);
      win = undefined;

      // With audio.enabled off, the audio rows are hidden again.
      setRawPref(PREF_KEYS.audioEnabled, false);
      win = await openPane();
      const hidden = win.document.getElementById("rh-prefs-audio") as
        (Element & { hidden: boolean }) | null;
      assert.isTrue(hidden!.hidden, "the audio rows are hidden");
      assert.isNotNull(
        win.document.getElementById("rh-lang"),
        "the report language is still shown",
      );
    } finally {
      for (const { key, had, value } of saved) {
        if (had && value !== undefined) setRawPref(key, value);
        else clearRawPref(key);
      }
      if (win !== undefined && !win.closed) win.close();
      prefsWindow = null;
    }
  });
});

/* ---------------------------------------------- P7-T13: the diagnostics */

describe("P7-T13 — the diagnostics text, from the live plugin", function () {
  /** SYNTHETIC values: none is a real key, address or folder. */
  const PLANTED_KEY = `sk-or-v1-${randomHex(32)}`;
  const PLANTED_EMAIL = `planted.${randomHex(4)}@example.org`;
  const PLANTED_FOLDER = `C:\\Planted${randomHex(4)}\\Linked Audio`;
  const MARKER = `p7t13-${randomHex(4)}`;
  let emailBefore: PrefScalar | undefined;
  let folderBefore: PrefScalar | undefined;
  let win: Window | undefined;

  before(async function () {
    emailBefore = getRawPref(PREF_KEYS.contactEmail);
    folderBefore = getRawPref(PREF_KEYS.ttsLinkedFileDir);
  });

  after(async function () {
    if (win !== undefined && !win.closed) win.close();
    if (emailBefore === undefined) clearRawPref(PREF_KEYS.contactEmail);
    else setRawPref(PREF_KEYS.contactEmail, emailBefore);
    if (folderBefore === undefined) clearRawPref(PREF_KEYS.ttsLinkedFileDir);
    else setRawPref(PREF_KEYS.ttsLinkedFileDir, folderBefore);
  });

  it("holds the six sections and the ring's lines, withholds the address, the folder and the data directory, and redacts a logged key; Show fills the pane's box", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;
    const graph = (instance.api as { services?: ServiceGraph }).services!;
    setRawPref(PREF_KEYS.contactEmail, PLANTED_EMAIL);
    setRawPref(PREF_KEYS.ttsLinkedFileDir, PLANTED_FOLDER);
    // Logged through the plugin's own logger, so the ring holds the line the
    // sink received. `warn` passes the default level.
    graph.logger.warn(`${MARKER} request failed with ${PLANTED_KEY}`, {
      apiKey: PLANTED_KEY,
      folder: PLANTED_FOLDER,
    });

    const text = await host.diagnosticsText();
    const lines = text.split("\n");
    log(
      `[P7-T13] diagnostics: ${String(lines.length)} lines, ${String(text.length)} characters`,
    );
    let at = -1;
    for (const name of DIAGNOSTICS_SECTIONS) {
      const next = text.indexOf(`== ${name} ==`);
      assert.isAbove(next, at, `section "${name}" in order`);
      at = next;
    }
    assert.include(text, "No API key and no paper content is included.");
    assert.include(text, `Zotero ${String(Zotero.version)}`);
    assert.include(text, `${PREF_KEYS.contactEmail} = set`);
    assert.include(text, `${PREF_KEYS.ttsLinkedFileDir} = set`);
    const planted = lines.filter((line) => line.includes(MARKER));
    assert.strictEqual(
      planted.length,
      1,
      "the ring holds the planted line once",
    );
    assert.include(planted[0] ?? "", LOG_PREFIX);
    assert.notInclude(text, PLANTED_KEY);
    assert.notInclude(text, PLANTED_KEY.slice(0, 16));
    assert.notInclude(text, PLANTED_EMAIL);
    assert.notInclude(text, PLANTED_FOLDER);
    assert.notInclude(text, String(Zotero.DataDirectory.dir));

    // The pane: Show fills the read-only box, and only then are Save and
    // Copy enabled. Neither is pressed: no file and no clipboard is touched.
    const opened =
      Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
    assert.isNotNull(opened, "openPreferences returned a window");
    win = opened!;
    // As the P7-T08 test opens it: the pane loads after the window does, so
    // the document is read only once the pane says it is loaded.
    const prefs = win as Window & {
      Zotero_Preferences?: { panes: Map<string, { loaded?: boolean }> };
    };
    await waitUntil(
      () =>
        prefs.Zotero_Preferences?.panes?.get(PREFERENCES_PANE_ID)?.loaded ===
        true,
      "the pane to finish loading",
    );
    const doc = win.document;
    await waitUntil(
      () =>
        doc
          .getElementById(PREFERENCES_ROOT_ID)
          ?.getAttribute("data-rh-initialized") === "true",
      "the controller to initialise",
    );
    const save = doc.getElementById("rh-diagnostics-save") as
      (Element & { disabled: boolean }) | null;
    const copy = doc.getElementById("rh-diagnostics-copy") as
      (Element & { disabled: boolean }) | null;
    const box = doc.getElementById("rh-diagnostics-text") as
      (HTMLTextAreaElement & { hidden: boolean }) | null;
    assert.isTrue(save!.disabled, "Save disabled before Show");
    assert.isTrue(copy!.disabled, "Copy disabled before Show");
    assert.isTrue(box!.hidden, "the box hidden before Show");
    (doc.getElementById("rh-diagnostics-preview") as Element).dispatchEvent(
      new win.Event("command"),
    );
    await waitUntil(() => box!.value !== "", "Show to fill the box");
    assert.isTrue(box!.readOnly, "the box is read-only");
    assert.isFalse(box!.hidden, "the box is shown");
    assert.isFalse(save!.disabled, "Save enabled after Show");
    assert.isFalse(copy!.disabled, "Copy enabled after Show");
    assert.include(box!.value, "== cache statistics ==");
    assert.notInclude(box!.value, PLANTED_KEY);
    assert.notInclude(box!.value, PLANTED_EMAIL);
    win.close();
    await waitUntil(() => win!.closed, "the preferences window to close");
    await waitUntil(
      () => !Services.wm.getEnumerator("zotero:pref").hasMoreElements(),
      "the window mediator to drop the preferences window",
    );
  });
});

describe("P7-T10 — the stored-data actions, from the live plugin", function () {
  const MARK = `p7t10-${randomHex(4)}`;
  /** Every user value under the branch, put back after the reset. */
  let snapshot: Map<string, PrefScalar> | undefined;

  interface CommonDialog {
    cancelDialog(): void;
    acceptDialog(): void;
  }
  const observerService = Services.obs as unknown as {
    addObserver(observer: unknown, topic: string): void;
    removeObserver(observer: unknown, topic: string): void;
  };

  /**
   * Run `action` while Zotero's confirmation is answered `accept` from its own
   * window, as `searchDialog-flow.spec.ts` answers its prompt; resolves to the
   * texts drawn. A guard cancels any dialog still open after ten seconds.
   */
  async function answering<T>(
    accept: boolean,
    action: () => Promise<T>,
  ): Promise<{ result: T; drawn: string[] }> {
    const drawn: string[] = [];
    const observer = {
      observe(subject: unknown): void {
        const dialog = subject as Window;
        drawn.push(
          (
            dialog.document.getElementById("infoBody")?.textContent ?? ""
          ).trim(),
        );
        dialog.setTimeout(() => {
          const root = dialog.document.getElementById(
            "commonDialog",
          ) as unknown as CommonDialog;
          if (accept) root.acceptDialog();
          else root.cancelDialog();
        }, 0);
      },
    };
    observerService.addObserver(observer, "common-dialog-loaded");
    const guard = setTimeout(() => {
      const windows = (
        Services.wm as unknown as {
          getEnumerator(type: null): {
            hasMoreElements(): boolean;
            getNext(): Window;
          };
        }
      ).getEnumerator(null);
      while (windows.hasMoreElements()) {
        const root = windows
          .getNext()
          .document?.getElementById(
            "commonDialog",
          ) as unknown as CommonDialog | null;
        root?.cancelDialog();
      }
    }, 10_000);
    try {
      return { result: await action(), drawn };
    } finally {
      clearTimeout(guard);
      observerService.removeObserver(observer, "common-dialog-loaded");
    }
  }

  /**
   * The UI locale as found, put back in `after()`. The block asserts one
   * English sentence of the confirmation; since the owner adopted its Korean on
   * 2026-11-17 (`plan/00` §6 item 397), a `ko-KR` machine draws it in Korean,
   * so the block pins `en-US` as "P1-T44 — the preference pane" does.
   */
  let localeBefore: UILocaleSnapshot | undefined;

  before(async function () {
    localeBefore = await pinUILocale(["en-US"], log);
    snapshot = new Map();
    for (const key of listBranchPrefs()) {
      if (prefHasUserValue(key)) {
        const value = getRawPref(key);
        if (value !== undefined) snapshot.set(key, value);
      }
    }
  });

  after(async function () {
    if (localeBefore) {
      await restoreUILocale(localeBefore, log);
      localeBefore = undefined;
    }
    if (snapshot === undefined) return;
    for (const key of listBranchPrefs()) {
      const value = snapshot.get(key);
      if (value === undefined) {
        if (prefHasUserValue(key)) clearRawPref(key);
      } else {
        setRawPref(key, value);
      }
    }
  });

  it("each clear asks with its count, removes only its kind after a yes and nothing after a no; reset restores the defaults and keeps the key rows", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = await initializedInstance();
    const host = publishedHost(instance)!;
    const graph = (instance.api as { services?: ServiceGraph }).services!;
    const open = await graph.database.ready;
    assert.isTrue(open !== undefined, "the plugin database is open");
    const db = open!.connection;
    const count = async (sql: string, params: string[]): Promise<number> =>
      Number(await db.valueQueryAsync(sql, params));
    const parent = Zotero.getMainWindow();

    // Synthetic rows: two summaries, an ended and a running job, one cached
    // response. None is a real paper, key or answer.
    for (const n of [1, 2]) {
      await db.queryAsync(
        "INSERT INTO summary (id, work_key, prompt_version, provider_id, model_id, input_scope, json, generated_at) VALUES (?, ?, 'v', 'p', 'm', 'abstract', '{}', 1)",
        [`${MARK}-s${String(n)}`, `${MARK}-w${String(n)}`],
      );
    }
    for (const status of ["succeeded", "running"]) {
      await db.queryAsync(
        "INSERT INTO job (id, pipeline_id, status, priority, input_json, input_version, progress_json, usage_json, plugin_version, created_at, warnings_json, redaction_json) VALUES (?, 'summarize', ?, 'normal', '{}', 1, '{}', '{}', '0.0.0', 1, '[]', '{}')",
        [`${MARK}-${status}`, status],
      );
    }
    await graph.cache.set("source-response", `${MARK}-response`, "synthetic");
    const mine = (table: string, column = "id") =>
      count(`SELECT COUNT(*) FROM ${table} WHERE ${column} LIKE ?`, [
        `${MARK}%`,
      ]);
    assert.strictEqual(await mine("summary"), 2);
    // `docs/09` §1.9 item 8's restore notice reads this. Its query bound no
    // LIKE pattern before 2026-11-17, Zotero's connection refused it, and the
    // pane read the refusal as "no data" (`plan/00` §6 item 398(i)).
    assert.isTrue(
      (await host.readState()).pluginDataPresent,
      "the pane sees that the plugin database holds rows",
    );

    // Summaries: a no removes nothing; a yes removes the rows; the prompt
    // names the count and says the notes stay.
    const declined = await answering(false, () =>
      host.clearData("summaries", parent),
    );
    assert.strictEqual(declined.result.outcome, "declined");
    assert.strictEqual(declined.drawn.length, 1, "one confirmation drawn");
    assert.include(
      declined.drawn[0] ?? "",
      "The notes in your Zotero library stay.",
    );
    assert.strictEqual(await mine("summary"), 2, "a no removes nothing");
    const cleared = await answering(true, () =>
      host.clearData("summaries", parent),
    );
    log(
      `[P7-T10] summaries: "${cleared.drawn[0] ?? ""}" -> ${JSON.stringify(cleared.result)}`,
    );
    assert.strictEqual(cleared.result.outcome, "cleared");
    // The status reports the count the confirmation named (2026-11-17: before
    // `removedCount`, "Remove 12 stored summaries" was followed by "Removed 32").
    const namedAndRemoved = (run: {
      drawn: string[];
      result: { status?: { args?: Record<string, unknown> } };
    }): [number, unknown] => [
      Number(/\d+/.exec(run.drawn[0] ?? "")?.[0]),
      run.result.status?.args?.removed,
    ];
    const [namedSummaries, removedSummaries] = namedAndRemoved(cleared);
    assert.strictEqual(removedSummaries, namedSummaries, "summaries");
    assert.strictEqual(await mine("summary"), 0);
    assert.strictEqual(await mine("job"), 2, "the jobs are not touched");

    // Job history: the ended job goes, the running one stays.
    const jobs = await answering(true, () =>
      host.clearData("job-history", parent),
    );
    log(
      `[P7-T10] jobs: "${jobs.drawn[0] ?? ""}" -> ${JSON.stringify(jobs.result)}`,
    );
    assert.strictEqual(jobs.result.outcome, "cleared");
    const [namedJobs, removedJobs] = namedAndRemoved(jobs);
    assert.strictEqual(removedJobs, namedJobs, "job history");
    assert.strictEqual(
      await count("SELECT COUNT(*) FROM job WHERE id = ?", [
        `${MARK}-succeeded`,
      ]),
      0,
    );
    assert.strictEqual(
      await count("SELECT COUNT(*) FROM job WHERE id = ?", [`${MARK}-running`]),
      1,
      "a running job's row stays",
    );
    await db.queryAsync("DELETE FROM job WHERE id = ?", [`${MARK}-running`]);

    // Cached responses: the entry goes.
    const responses = await answering(true, () =>
      host.clearData("cached-responses", parent),
    );
    log(
      `[P7-T10] responses: "${responses.drawn[0] ?? ""}" -> ${JSON.stringify(responses.result)}`,
    );
    assert.strictEqual(responses.result.outcome, "cleared");
    const [namedResponses, removedResponses] = namedAndRemoved(responses);
    assert.strictEqual(removedResponses, namedResponses, "cached responses");
    assert.isUndefined(
      await graph.cache.get("source-response", `${MARK}-response`),
    );

    // Reset: a changed setting returns to its default; the key store row and a
    // key row stay as they were.
    const backend = getRawPref(PREF_KEYS.secretBackend);
    const ncbiPresent = getRawPref(PREF_KEYS.ncbiKeyPresent);
    setRawPref(PREF_KEYS.concurrency, 7);
    const reset = await answering(true, () => host.resetToDefaults(parent));
    log(
      `[P7-T10] reset: "${reset.drawn[0] ?? ""}" -> ${JSON.stringify(reset.result)}`,
    );
    assert.strictEqual(reset.result.outcome, "reset");
    assert.isFalse(
      prefHasUserValue(PREF_KEYS.concurrency),
      "concurrency is back to its default",
    );
    assert.strictEqual(getRawPref(PREF_KEYS.secretBackend), backend);
    assert.strictEqual(getRawPref(PREF_KEYS.ncbiKeyPresent), ncbiPresent);
  });
});

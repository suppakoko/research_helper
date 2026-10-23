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
 *    Then Debug Output, both console channels, every preference in the profile,
 *    `Zotero.getErrors()` and every note in the library are swept for the key
 *    and for its digest. The sweep is proven non-vacuous: the host logged
 *    something, and the request that went out did carry the key.
 *
 * Sandbox caveats (`docs/01` §2.3): no `console`, no `performance`.
 */

import type Addon from "../../src/addon";
import { config } from "../../package.json";
import { createSystemClock } from "../../src/core/clock";
import { UpstreamServerError } from "../../src/core/errors";
import type { HttpRequest, HttpResponse } from "../../src/core/http/client";
import { createLogger } from "../../src/core/logger";
import type { SecretId } from "../../src/core/secretStore";
import type { ProviderId } from "../../src/model/ids";
import { PREF_KEYS, setPrefStore } from "../../src/prefs";
import { qualifiedPrefKey } from "../../src/prefs/keys";
import {
  LLM_CREDENTIALS,
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
  clearPref as clearRawPref,
  createZoteroPrefStore,
  findBranchPrefsContaining,
  getPref as getRawPref,
  prefHasUserValue,
  setPref as setRawPref,
  type PrefScalar,
} from "../../src/zotero/prefStore";

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

/** The profile's `prefs.js` after a forced flush (`zotero/secrets.spec.ts`'s method). */
async function flushedPrefsFile(): Promise<string> {
  // `null` means "the profile's prefs.js" (nsIPrefService); the binding omits it.
  Services.prefs.savePrefFile(null as unknown as nsIFile);
  const path = PathUtils.join(PathUtils.profileDir, "prefs.js");
  return (await IOUtils.exists(path)) ? IOUtils.readUTF8(path) : "";
}

/* -------------------------------------------------------- the sweep tools */

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle.length > 0 && text.includes(needle));
}

/** Every string-valued preference in the whole profile that holds a needle. */
function allPrefsContaining(needles: readonly string[]): {
  scanned: number;
  hits: string[];
} {
  const branch = Services.prefs.getBranch("");
  const names = branch.getChildList("");
  const hits: string[] = [];
  for (const name of names) {
    if (branch.getPrefType(name) !== Services.prefs.PREF_STRING) continue;
    let value: string;
    try {
      value = branch.getStringPref(name);
    } catch {
      continue;
    }
    if (containsAny(value, needles)) hits.push(name);
  }
  return { scanned: names.length, hits };
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
  readonly allPrefs: { scanned: number; hits: string[] };
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
    // llmProvider, the four <provider>.model fields and gemini.paidTier — and
    // no key field or base-URL field is among them.
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
      ].map((key) => qualifiedPrefKey(key)),
    );
    assert.strictEqual(bound.length, allowed.size, "six bound elements");
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
    assert.strictEqual(
      doc.querySelectorAll(`#${PREFERENCES_ROOT_ID} [id*="copy" i]`).length,
      0,
      "no copy affordance",
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
      const needles = [key, digest, key.slice(-4)];

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
          `plugin-branch hits ${result.branchHits.length}; all prefs scanned ${result.allPrefs.scanned}, ` +
          `hits ${result.allPrefs.hits.length}; errors ${result.errors.length} ` +
          `(${result.errors.length - errorsBefore} new); notes containing ${result.notes}`,
      );
      assert.isAbove(
        newLines,
        0,
        "the host logged something, so the sweep reads real lines",
      );
      assertClean(result, needles, "after a succeeding and a failing Test");

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
});

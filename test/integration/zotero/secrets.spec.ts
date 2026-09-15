/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `V-16` / `P0-T23`: the OS-keystore round trip and the preference round trip.
 *
 * **No real secret is ever used.** The value stored is
 * `sk-rh-p0t23-dummy-<timestamp>-<random hex>`: key-shaped, so the mechanism is
 * exercised with the characters a real key has, and obviously fake. It is
 * never logged, encrypted or decrypted — only lengths, counts and verdicts are.
 *
 * **Nothing pre-existing is touched.** The spec only ever searches
 * `Services.logins` under this plugin's own origin and realm, refuses to run if
 * a login for the test `SecretId` already exists there, and removes exactly the
 * login it created, proving afterwards that the store and `logins.json` no
 * longer contain it. It never calls `getAllLogins()`.
 *
 * **What "no pref holds the value" is checked against.** Three layers, all
 * while the secret is stored: every pref under
 * `extensions.zotero.research-helper.` (the card's criterion), every pref in
 * the profile, and `prefs.js` on disk after a forced flush. The needles are the
 * plaintext, the `oskv1:` ciphertext and the ciphertext without its prefix.
 *
 * **Debug Output.** With `signon.debug` and `toolkit.osKeyStore.loglevel`
 * turned up to their most verbose for the duration, the spec checks Zotero's
 * stored Debug Output and the Console API event store for the same needles, so
 * "the platform does not log the value" is measured rather than assumed.
 *
 * The runner's profile and data directory are `.scaffold/test/`, never the
 * user's; `Zotero.OSKeyStore`'s underlying secret, however, is per OS user,
 * not per profile (Mozilla's `OSKeyStore.sys.mjs` labels it
 * `"<app basename> Encrypted Storage"`), which is why the spec records whether
 * that secret existed before its first `encrypt()`.
 *
 * Output goes to the runner's terminal through the scaffold's `window.debug()`,
 * prefixed `[P0-T23]`. Sandbox caveats (`docs/01` §2.3): no `performance`, no
 * `console`, so `Date.now()` is the clock.
 */

import {
  LOGIN_ORIGIN,
  LOGIN_REALM,
  clearSecret,
  getSecret,
  hasSecret,
  listStoredIds,
  loginRemovalMethod,
  probeKeystore,
  setSecret,
  type SecretId,
} from "../../../src/zotero/keychain";
import {
  PREF_BRANCH_ROOT,
  clearPref,
  findBranchPrefsContaining,
  getPref,
  listBranchPrefs,
  prefHasUserValue,
  qualifiedPrefName,
  setPref,
  type PrefScalar,
} from "../../../src/zotero/prefStore";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P0-T23]";
const TEST_TIMEOUT_MS = 60_000;

/** The `SecretId` the round trip borrows. Refused if already present. */
const TEST_ID: SecretId = "llm.openrouter";

/** Mozilla `OSKeyStore.sys.mjs`: `AppConstants.MOZ_APP_BASENAME + " Encrypted Storage"`. */
const OS_KEYSTORE_LABEL = "Zotero Encrypted Storage";

/** Hot-loop size and repetitions for the pref read cost. */
const READS = 100_000;
const READ_RUNS = 3;

/** `docs/07` §8.5 rows used for the round trip. Their defaults are not restated. */
const INT_PREF_KEY = "concurrency";
const BOOL_PREF_KEY = "openrouter.keyPresent";
/** Shipped by `addon/prefs.js`, so it reads from the default branch. */
const DEFAULT_ONLY_PREF_KEY = "enable";
/** A key no one writes, for the cost of a miss. */
const ABSENT_PREF_KEY = "p0t23.absent";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Logins under this plugin's origin/realm for `id`. Nothing else is searched. */
async function ownLoginsFor(id: SecretId): Promise<nsILoginInfo[]> {
  const logins = (await Services.logins.searchLoginsAsync({
    origin: LOGIN_ORIGIN,
    httpRealm: LOGIN_REALM,
  })) as nsILoginInfo[];
  return logins.filter((login) => login.username === id);
}

/** Names on the XPCOM-wrapped login manager, i.e. what callers can reach. */
function loginManagerMembers(): string[] {
  const names: string[] = [];
  for (const name in Services.logins) {
    names.push(name);
  }
  return names.sort();
}

/** A temporary user value on an arbitrary pref, restored exactly. */
interface PrefOverride {
  restore(): void;
}

function overrideStringPref(name: string, value: string): PrefOverride {
  const hadUserValue = Services.prefs.prefHasUserValue(name);
  const previous = hadUserValue ? Services.prefs.getStringPref(name) : "";
  Services.prefs.setStringPref(name, value);
  return {
    restore() {
      if (hadUserValue) {
        Services.prefs.setStringPref(name, previous);
      } else {
        Services.prefs.clearUserPref(name);
      }
    },
  };
}

function overrideBoolPref(name: string, value: boolean): PrefOverride {
  const hadUserValue = Services.prefs.prefHasUserValue(name);
  const previous = hadUserValue ? Services.prefs.getBoolPref(name) : false;
  Services.prefs.setBoolPref(name, value);
  return {
    restore() {
      if (hadUserValue) {
        Services.prefs.setBoolPref(name, previous);
      } else {
        Services.prefs.clearUserPref(name);
      }
    },
  };
}

/** Every pref in the profile, not only the plugin's branch, containing a needle. */
function allPrefsContaining(needles: readonly string[]): {
  scanned: number;
  hits: string[];
} {
  const root = Services.prefs.getBranch("");
  const names = root.getChildList("");
  const hits = names.filter((name) => {
    let value = "";
    switch (root.getPrefType(name)) {
      case root.PREF_STRING:
        value = root.getStringPref(name);
        break;
      case root.PREF_INT:
        value = String(root.getIntPref(name));
        break;
      case root.PREF_BOOL:
        value = String(root.getBoolPref(name));
        break;
    }
    return needles.some((needle) => value.includes(needle));
  });
  return { scanned: names.length, hits };
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/** Text of every Console API event recorded so far, one string per event. */
/**
 * `Components.classes[contractID].getService(iid)`. `zotero-types` keys
 * `Components.classes` on a closed set of contract IDs that lacks the two this
 * spec needs, so the lookup is typed here once.
 */
function xpcomService<T>(contractID: string, iid: T): nsQIResult<T> {
  const classes = Components.classes as unknown as Record<
    string,
    { getService<U>(aID: U): nsQIResult<U> } | undefined
  >;
  const service = classes[contractID];
  if (!service) {
    assert.fail(`no XPCOM class ${contractID}`);
  }
  return service.getService(iid);
}

function consoleApiEventTexts(): string[] {
  const storage = xpcomService(
    "@mozilla.org/consoleAPI-storage;1",
    Components.interfaces.nsIConsoleAPIStorage,
  );
  const events = storage.getEvents() as { arguments?: unknown[] }[];
  return events.map((event) =>
    (event.arguments ?? []).map((argument) => String(argument)).join(" "),
  );
}

async function readProfileFile(name: string): Promise<string | undefined> {
  const path = PathUtils.join(PathUtils.profileDir, name);
  return (await IOUtils.exists(path)) ? IOUtils.readUTF8(path) : undefined;
}

/** Poll `logins.json` until `predicate` holds (the store saves on a timer). */
async function waitForLoginsFile(
  predicate: (text: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const text = (await readProfileFile("logins.json")) ?? "";
    if (predicate(text)) {
      return text;
    }
    if (Date.now() > deadline) {
      assert.fail(`logins.json never ${what}`);
    }
    await delay(250);
  }
}

/** Cost of `READS` calls to `read`, in nanoseconds per read, per run. */
function measureReads(read: () => unknown): number[] {
  const results: number[] = [];
  for (let run = 0; run < READ_RUNS; run++) {
    let sink: unknown;
    const t0 = Date.now();
    for (let i = 0; i < READS; i++) {
      sink = read();
    }
    const elapsed = Date.now() - t0;
    void sink;
    results.push(Math.round((elapsed * 1_000_000) / READS));
  }
  return results;
}

describe("OS keystore and preference round trip (P0-T23, V-16)", function () {
  it("exposes the login-manager methods tier 1 needs, and says which removal exists", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Services.logins.initializationPromise;

    const members = loginManagerMembers();
    const loginish = members.filter((name) => /login/i.test(name));
    debug(
      `${LOG_PREFIX} Zotero ${Zotero.version}, Gecko ${Services.appinfo.platformVersion}, ` +
        `${Services.appinfo.OS}`,
    );
    debug(`${LOG_PREFIX} Services.logins members: ${members.join(", ")}`);
    debug(
      `${LOG_PREFIX} async members: ${members.filter((name) => /Async$/.test(name)).join(", ")}; ` +
        `login-named members: ${loginish.join(", ")}`,
    );
    const logins = Services.logins as unknown as Record<string, unknown>;
    for (const name of [
      "addLoginAsync",
      "searchLoginsAsync",
      "removeLoginAsync",
      "removeLogin",
      "modifyLoginAsync",
      "modifyLogin",
      "getAllLogins",
      "findLogins",
      "countLogins",
      "searchLogins",
    ]) {
      debug(
        `${LOG_PREFIX} typeof Services.logins.${name} = ${typeof logins[name]}`,
      );
    }
    debug(
      `${LOG_PREFIX} keychain.removeLogin() will use: ${loginRemovalMethod()}`,
    );

    assert.strictEqual(typeof logins["addLoginAsync"], "function");
    assert.strictEqual(typeof logins["searchLoginsAsync"], "function");
    assert.notStrictEqual(
      loginRemovalMethod(),
      "none",
      "a removal method exists",
    );
  });

  it("runs the startup probe as a real round trip and returns a tier verdict", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const nativeStore = xpcomService(
      "@mozilla.org/security/oskeystore;1",
      Components.interfaces.nsIOSKeyStore,
    );
    const secretExistedBefore =
      await nativeStore.asyncSecretAvailable(OS_KEYSTORE_LABEL);
    debug(
      `${LOG_PREFIX} Zotero.OSKeyStore.available = ${String(Zotero.OSKeyStore.available)}; ` +
        `native OS key store secret "${OS_KEYSTORE_LABEL}" existed before this run's first ` +
        `encrypt(): ${String(secretExistedBefore)}`,
    );

    const keyStore = Zotero.OSKeyStore as unknown as {
      encrypt: (value: string) => Promise<string>;
      decrypt: (value: string) => Promise<string>;
    };
    const realEncrypt = keyStore.encrypt;
    const realDecrypt = keyStore.decrypt;
    let encrypts = 0;
    let decrypts = 0;
    keyStore.encrypt = function (value: string) {
      encrypts++;
      return realEncrypt.call(Zotero.OSKeyStore, value);
    };
    keyStore.decrypt = function (value: string) {
      decrypts++;
      return realDecrypt.call(Zotero.OSKeyStore, value);
    };

    try {
      const verdict = await probeKeystore();
      debug(
        `${LOG_PREFIX} probe verdict: ${JSON.stringify(verdict)}; encrypt() calls ${encrypts}, ` +
          `decrypt() calls ${decrypts}`,
      );
      assert.strictEqual(
        verdict.backend,
        "os-keychain",
        "tier 1 on this machine",
      );
      assert.strictEqual(encrypts, 1, "the probe really encrypts");
      assert.strictEqual(decrypts, 1, "the probe really decrypts");

      const warm = await probeKeystore();
      debug(`${LOG_PREFIX} second probe verdict: ${JSON.stringify(warm)}`);
      assert.strictEqual(warm.backend, "os-keychain");

      // SIMULATED, not measured: the real store cannot be made unavailable on
      // Windows from inside Zotero. This checks only that the probe turns a
      // throwing encrypt() into a verdict instead of an exception.
      keyStore.encrypt = () =>
        Promise.reject(new Error("simulated keystore failure (P0-T23)"));
      const simulated = await probeKeystore();
      debug(
        `${LOG_PREFIX} SIMULATED unavailable keystore -> verdict: ${JSON.stringify(simulated)}`,
      );
      assert.strictEqual(simulated.backend, "unavailable");
      if (simulated.backend === "unavailable") {
        assert.strictEqual(simulated.failure, "encrypt-threw");
      }
    } finally {
      keyStore.encrypt = realEncrypt;
      keyStore.decrypt = realDecrypt;
    }
  });

  it("round-trips a key-shaped string through encrypt -> store -> search -> decrypt, and no pref or log holds it", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Services.logins.initializationPromise;

    const preexisting = await ownLoginsFor(TEST_ID);
    if (preexisting.length > 0) {
      assert.fail(
        `refusing to run: ${preexisting.length} login(s) for "${TEST_ID}" already exist ` +
          `under ${LOGIN_ORIGIN}; this spec never overwrites a stored secret`,
      );
    }

    const plaintext = `sk-rh-p0t23-dummy-${Date.now()}-${randomHex(16)}`;
    const verbose = [
      overrideBoolPref("signon.debug", true),
      overrideStringPref("toolkit.osKeyStore.loglevel", "All"),
    ];
    const debugWasStoring = Boolean(Zotero.Debug.storing);
    if (!debugWasStoring) {
      Zotero.Debug.setStore(true);
    }
    const debugLinesBefore = Number(Zotero.Debug.count());

    let created = false;
    try {
      // ---- encrypt -> store ----
      const tSet = Date.now();
      await setSecret(TEST_ID, plaintext);
      created = true;
      const setMs = Date.now() - tSet;

      // ---- search ----
      const stored = await ownLoginsFor(TEST_ID);
      assert.strictEqual(stored.length, 1, "exactly one login for the id");
      const ciphertext = stored[0]!.password;
      const ciphertextBody = ciphertext.slice("oskv1:".length);
      const needles = [plaintext, ciphertext, ciphertextBody];
      assert.isTrue(
        Zotero.OSKeyStore.isEncrypted(ciphertext),
        "stored value is oskv1:",
      );
      assert.isFalse(
        ciphertext.includes(plaintext),
        "ciphertext does not contain plaintext",
      );
      assert.include(
        await listStoredIds(),
        TEST_ID,
        "listStoredIds() finds it",
      );
      debug(
        `${LOG_PREFIX} stored: setSecret() ${setMs} ms; logins for "${TEST_ID}": ${stored.length}; ` +
          `origin=${stored[0]!.origin} realm=${stored[0]!.httpRealm}; ` +
          `password isEncrypted=${String(Zotero.OSKeyStore.isEncrypted(ciphertext))}, ` +
          `length ${ciphertext.length} (plaintext length ${plaintext.length})`,
      );

      // ---- has() without decrypting ----
      const keyStore = Zotero.OSKeyStore as unknown as {
        decrypt: (value: string) => Promise<string>;
      };
      const realDecrypt = keyStore.decrypt;
      let decryptsDuringHas = 0;
      keyStore.decrypt = function (value: string) {
        decryptsDuringHas++;
        return realDecrypt.call(Zotero.OSKeyStore, value);
      };
      let has: boolean;
      const tHas = Date.now();
      try {
        has = await hasSecret(TEST_ID);
      } finally {
        keyStore.decrypt = realDecrypt;
      }
      const hasMs = Date.now() - tHas;
      debug(
        `${LOG_PREFIX} hasSecret() = ${String(has)} in ${hasMs} ms with ` +
          `${decryptsDuringHas} OSKeyStore.decrypt() call(s)`,
      );
      assert.isTrue(has, "has() is true");
      assert.strictEqual(decryptsDuringHas, 0, "has() never decrypts");

      // ---- decrypt ----
      const tGet = Date.now();
      const roundTripped = await getSecret(TEST_ID);
      const getMs = Date.now() - tGet;
      const equal = roundTripped === plaintext;
      debug(
        `${LOG_PREFIX} getSecret() ${getMs} ms; decrypted value === original: ${String(equal)}`,
      );
      assert.isTrue(equal, "decrypt(store(encrypt(x))) === x");

      // ---- no pref holds it: the plugin branch (the criterion) ----
      const branchNames = listBranchPrefs();
      const branchHits = findBranchPrefsContaining(needles);
      debug(
        `${LOG_PREFIX} prefs under ${PREF_BRANCH_ROOT}: ${branchNames.length} ` +
          `(${branchNames.join(", ")}); holding the test value or its ciphertext: ${branchHits.length}`,
      );
      assert.deepEqual(
        branchHits,
        [],
        "no pref under the plugin branch holds the value",
      );

      // ---- every pref in the profile, and prefs.js on disk ----
      const everywhere = allPrefsContaining(needles);
      // `null` means "the profile's prefs.js" (nsIPrefService); the binding omits it.
      Services.prefs.savePrefFile(null as unknown as nsIFile);
      const prefsFile = (await readProfileFile("prefs.js")) ?? "";
      debug(
        `${LOG_PREFIX} all prefs scanned: ${everywhere.scanned}, hits: ${everywhere.hits.length}; ` +
          `prefs.js (${prefsFile.length} chars) contains it: ${String(containsAny(prefsFile, needles))}`,
      );
      assert.deepEqual(everywhere.hits, [], "no pref anywhere holds the value");
      assert.isFalse(
        containsAny(prefsFile, needles),
        "prefs.js does not contain the value",
      );

      // ---- logins.json holds neither form in the clear ----
      const loginsFile = await waitForLoginsFile(
        (text) => text.includes(LOGIN_ORIGIN),
        "recorded the login",
      );
      debug(
        `${LOG_PREFIX} logins.json (${loginsFile.length} chars) has our origin: true; ` +
          `contains plaintext or oskv1 ciphertext in the clear: ${String(containsAny(loginsFile, needles))}`,
      );
      assert.isFalse(
        containsAny(loginsFile, needles),
        "logins.json holds only NSS-encrypted fields",
      );

      // ---- nothing reached Debug Output or the console ----
      const debugOutput = String(await Zotero.Debug.get());
      const consoleTexts = consoleApiEventTexts();
      const consoleServiceTexts = Services.console
        .getMessageArray()
        .map((message) => message.message);
      debug(
        `${LOG_PREFIX} Debug Output: storing was ${String(debugWasStoring)}, ` +
          `${Number(Zotero.Debug.count()) - debugLinesBefore} new line(s), ` +
          `${debugOutput.length} chars, contains the value: ${String(containsAny(debugOutput, needles))}; ` +
          `Console API events: ${consoleTexts.length}, containing it: ` +
          `${consoleTexts.filter((text) => containsAny(text, needles)).length}; ` +
          `console service messages: ${consoleServiceTexts.length}, containing it: ` +
          `${consoleServiceTexts.filter((text) => containsAny(text, needles)).length}`,
      );
      assert.isFalse(
        containsAny(debugOutput, needles),
        "Debug Output never sees the value",
      );
      assert.strictEqual(
        consoleTexts.filter((text) => containsAny(text, needles)).length,
        0,
        "Console API events never see the value",
      );
      assert.strictEqual(
        consoleServiceTexts.filter((text) => containsAny(text, needles)).length,
        0,
        "the console service never sees the value",
      );
    } finally {
      if (created || (await ownLoginsFor(TEST_ID)).length > 0) {
        const removed = await clearSecret(TEST_ID);
        const remaining = await ownLoginsFor(TEST_ID);
        const stillHas = await hasSecret(TEST_ID);
        const listed = await listStoredIds();
        debug(
          `${LOG_PREFIX} cleanup via ${loginRemovalMethod()}: removed ${removed}; ` +
            `searchLoginsAsync now finds ${remaining.length} for "${TEST_ID}"; hasSecret() = ` +
            `${String(stillHas)}; listStoredIds() = [${listed.join(", ")}]`,
        );
        const loginsFile = await waitForLoginsFile(
          (text) => !text.includes(LOGIN_ORIGIN),
          "dropped the login",
        );
        debug(
          `${LOG_PREFIX} logins.json after cleanup (${loginsFile.length} chars) ` +
            `mentions ${LOGIN_ORIGIN}: false`,
        );
        assert.strictEqual(remaining.length, 0, "the test login is gone");
        assert.isFalse(stillHas, "has() is false after cleanup");
      }
      if (!debugWasStoring) {
        Zotero.Debug.setStore(false);
      }
      for (const override of verbose) {
        override.restore();
      }
    }
  });

  it("round-trips non-secret prefs under the plugin branch and records the hot-loop read cost", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    interface Saved {
      readonly key: string;
      readonly hadUserValue: boolean;
      readonly value: PrefScalar | undefined;
    }
    const saved: Saved[] = [INT_PREF_KEY, BOOL_PREF_KEY].map((key) => ({
      key,
      hadUserValue: prefHasUserValue(key),
      value: getPref(key),
    }));

    try {
      const intValue = (() => {
        const current = getPref(INT_PREF_KEY);
        return current === 2 ? 4 : 2;
      })();
      const boolValue = getPref(BOOL_PREF_KEY) !== true;

      setPref(INT_PREF_KEY, intValue);
      setPref(BOOL_PREF_KEY, boolValue);
      const readInt = getPref(INT_PREF_KEY);
      const readBool = getPref(BOOL_PREF_KEY);
      const rawInt = Services.prefs.getIntPref(qualifiedPrefName(INT_PREF_KEY));
      const rawBool = Services.prefs.getBoolPref(
        qualifiedPrefName(BOOL_PREF_KEY),
      );
      debug(
        `${LOG_PREFIX} pref round trip: ${qualifiedPrefName(INT_PREF_KEY)} set ${intValue} -> ` +
          `Zotero.Prefs ${JSON.stringify(readInt)} (${typeof readInt}), Services.prefs ${rawInt}; ` +
          `${qualifiedPrefName(BOOL_PREF_KEY)} set ${String(boolValue)} -> ` +
          `Zotero.Prefs ${JSON.stringify(readBool)} (${typeof readBool}), Services.prefs ${String(rawBool)}`,
      );
      assert.strictEqual(
        readInt,
        intValue,
        "integer pref round-trips as a number",
      );
      assert.strictEqual(
        readBool,
        boolValue,
        "boolean pref round-trips as a boolean",
      );
      assert.strictEqual(
        rawInt,
        intValue,
        "written under extensions.zotero.research-helper.",
      );
      assert.strictEqual(
        rawBool,
        boolValue,
        "written under extensions.zotero.research-helper.",
      );

      const userSet = measureReads(() => getPref(INT_PREF_KEY));
      const defaultOnly = measureReads(() => getPref(DEFAULT_ONLY_PREF_KEY));
      const absent = measureReads(() => getPref(ABSENT_PREF_KEY));
      debug(
        `${LOG_PREFIX} hot-loop read cost, ${READS} reads x ${READ_RUNS} runs, ns/read: ` +
          `user value (${INT_PREF_KEY}) ${userSet.join(", ")}; ` +
          `default-branch only (${DEFAULT_ONLY_PREF_KEY} = ${JSON.stringify(getPref(DEFAULT_ONLY_PREF_KEY))}) ` +
          `${defaultOnly.join(", ")}; absent (${ABSENT_PREF_KEY}) ${absent.join(", ")}`,
      );
      assert.strictEqual(
        getPref(ABSENT_PREF_KEY),
        undefined,
        "an absent pref reads undefined",
      );
    } finally {
      for (const entry of saved) {
        if (entry.hadUserValue && entry.value !== undefined) {
          setPref(entry.key, entry.value);
        } else {
          clearPref(entry.key);
        }
      }
      debug(
        `${LOG_PREFIX} prefs restored: ` +
          saved
            .map(
              (entry) =>
                `${entry.key} hasUserValue=${String(prefHasUserValue(entry.key))} ` +
                `value=${JSON.stringify(getPref(entry.key))}`,
            )
            .join("; "),
      );
    }
    for (const entry of saved) {
      assert.strictEqual(
        prefHasUserValue(entry.key),
        entry.hadUserValue,
        `${entry.key} restored`,
      );
    }
  });
});

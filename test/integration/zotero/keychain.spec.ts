/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T06`: the tier-1 `SecretStore` for `source.ncbi`, its `ncbi.keyPresent`
 * flag, and the startup backend probe — inside a real Zotero.
 *
 * **No real NCBI key is ever used, and none is needed for anything here.** The
 * value stored is `rh-p1t06-dummy-<timestamp>-<hex>`: key-shaped, so the
 * mechanism is exercised with the characters a real key has, and obviously fake.
 * `P1-T06`'s Human gate is a human supplying a *real* key to verify the
 * with-key path end to end against E-utilities; that is one live-request
 * verification and it is not what this file does. An agent neither obtains nor
 * embeds a key (`plan/README.md` §5 rule 7).
 *
 * **Nothing pre-existing is touched.** The spec refuses to run if a login for
 * `source.ncbi` already exists under this plugin's origin and realm — if the
 * owner has stored a real key, this file must not overwrite it, decrypt it or
 * even measure its length. It restores the `ncbi.keyPresent` and `secretBackend`
 * user values exactly as it found them.
 *
 * **Why this file exists beside `secrets.spec.ts`.** `P0-T23`'s
 * `test/integration/zotero/secrets.spec.ts` measures the *platform*: which
 * `Services.logins` methods Zotero 10 has, that the keystore round-trips, and
 * that neither a preference, nor `prefs.js`, nor `logins.json`, nor Zotero's
 * Debug Output, nor either console channel ever sees a stored value. It borrows
 * `llm.openrouter` and knows nothing about `source.ncbi` or the key-presence
 * flag. This file measures the *product surface* `P1-T06` ships — the
 * `SecretStore` object, the `source.ncbi` id, the flag, the backend preference,
 * and the rate-limit budget the flag selects. The deep leak sweep is not
 * repeated; the branch enumeration `P1-T06`'s criterion names is, against this
 * card's own id. `P3-T02`'s `Files` list names this path as a `modify`.
 *
 * Output goes to the runner's terminal through the scaffold's `window.debug()`,
 * prefixed `[P1-T06]`. Sandbox caveats (`docs/01` §2.3): no `performance`, no
 * `console`, so `Date.now()` is the clock.
 */

import { createSystemClock } from "../../../src/core/clock";
import {
  NCBI_HOST,
  NCBI_KEY_PRESENT_PREF,
  createHostLimiterRegistry,
} from "../../../src/core/rateLimit/hostLimiter";
import { PREF_KEYS, getPref, setPrefStore } from "../../../src/prefs";
import { PREFS } from "../../../src/prefs/schema";
import {
  LOGIN_ORIGIN,
  LOGIN_REALM,
  SECRET_BACKEND_UNAVAILABLE,
  createKeychainSecretStore,
  keyPresencePrefFor,
  probeAndRecordBackend,
  refreshKeyPresence,
  secretBackendPrefValue,
  type SecretId,
} from "../../../src/zotero/keychain";
import {
  PREF_BRANCH_ROOT,
  clearPref as clearRawPref,
  createZoteroPrefStore,
  findBranchPrefsContaining,
  getPref as getRawPref,
  listBranchPrefs,
  prefHasUserValue,
  setPref as setRawPref,
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
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  notInclude<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T06]";
const TEST_TIMEOUT_MS = 60_000;

/** The one `SecretId` Phase 1 stores (`docs/11` §1, `P1-T06`'s **Do NOT**). */
const NCBI_ID: SecretId = "source.ncbi";

/** The two `docs/07` §8.5 rows this module is allowed to write. */
const FLAG_PREF_KEY = PREF_KEYS.ncbiKeyPresent;
const BACKEND_PREF_KEY = PREF_KEYS.secretBackend;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Key-shaped, obviously fake, unique per run. Never a real key. */
function dummyKeyShapedValue(): string {
  return `rh-p1t06-dummy-${Date.now()}-${randomHex(16)}`;
}

/** Logins under this plugin's origin/realm for `id`. Nothing else is searched. */
async function ownLoginsFor(id: SecretId): Promise<nsILoginInfo[]> {
  await Services.logins.initializationPromise;
  const logins = (await Services.logins.searchLoginsAsync({
    origin: LOGIN_ORIGIN,
    httpRealm: LOGIN_REALM,
  })) as nsILoginInfo[];
  return logins.filter((login) => login.username === id);
}

/**
 * Refuse to run when a login for `id` already exists.
 *
 * The owner may have stored a real NCBI key by the time this runs. Overwriting
 * it would destroy a credential; reading it would be a decrypt this file has no
 * business performing.
 */
async function refuseIfStored(id: SecretId): Promise<void> {
  const existing = await ownLoginsFor(id);
  if (existing.length > 0) {
    assert.fail(
      `refusing to run: ${existing.length} login(s) for "${id}" already exist ` +
        `under ${LOGIN_ORIGIN}; this spec never overwrites or reads a stored secret`,
    );
  }
}

/** A user value on one branch-relative pref, restored exactly as found. */
interface SavedPref {
  readonly key: string;
  readonly hadUserValue: boolean;
  readonly value: PrefScalar | undefined;
}

function savePrefs(keys: readonly string[]): SavedPref[] {
  return keys.map((key) => ({
    key,
    hadUserValue: prefHasUserValue(key),
    value: getRawPref(key),
  }));
}

function restorePrefs(saved: readonly SavedPref[]): void {
  for (const entry of saved) {
    if (entry.hadUserValue && entry.value !== undefined) {
      setRawPref(entry.key, entry.value);
    } else {
      clearRawPref(entry.key);
    }
  }
}

/**
 * Install the `PrefStore` the typed accessor writes through, and return the
 * teardown.
 *
 * The plugin's own bundle installs one at startup (`src/bootstrap/container.ts`
 * step 1), but a spec is a separate esbuild bundle with its own module
 * instances, so `src/prefs/index.ts`'s module-scoped store is empty here until
 * this runs. The handles `createZoteroPrefStore().observe` returns are inert
 * `ScopedRegistration`s (FR-56) and nothing runs them, so no observer is
 * registered and none leaks.
 */
function installPrefStore(): () => void {
  setPrefStore(createZoteroPrefStore());
  return () => {
    setPrefStore(undefined);
  };
}

describe("tier-1 SecretStore for the NCBI key (P1-T06)", function () {
  it("round-trips the NCBI key, sets ncbi.keyPresent, and leaves no preference holding it", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await refuseIfStored(NCBI_ID);

    const detachPrefs = installPrefStore();
    const saved = savePrefs([FLAG_PREF_KEY]);
    const store = createKeychainSecretStore();
    const plaintext = dummyKeyShapedValue();
    let created = false;

    debug(
      `${LOG_PREFIX} Zotero ${Zotero.version}, Gecko ${Services.appinfo.platformVersion}, ` +
        `${Services.appinfo.OS}; store.backend=${store.backend} ` +
        `unattended=${String(store.unattended)}; ` +
        `keyPresencePrefFor("${NCBI_ID}")=${String(keyPresencePrefFor(NCBI_ID))}`,
    );

    try {
      // Criterion 1 — set() then get() returns the value, in a real Zotero.
      await store.set(NCBI_ID, plaintext);
      created = true;
      const roundTripped = await store.get(NCBI_ID);
      assert.strictEqual(
        roundTripped,
        plaintext,
        "get() returns exactly what set() stored",
      );
      assert.isTrue(await store.has(NCBI_ID), "has() is true once stored");

      // Criterion 2a — the flag is true. Read through the typed accessor, which
      // is what `docs/07` §8.5.1 says every reader uses, and again through the
      // raw branch so a coercion in the typed layer cannot manufacture a pass.
      assert.isTrue(
        getPref("ncbiKeyPresent"),
        "ncbi.keyPresent is true after set()",
      );
      assert.strictEqual(
        getRawPref(FLAG_PREF_KEY),
        true,
        "and it is a real boolean under the branch, not a coerced string",
      );

      // Criterion 2b — nothing under the plugin branch holds the value, in
      // either form, asserted by enumerating the branch.
      const stored = await ownLoginsFor(NCBI_ID);
      assert.strictEqual(stored.length, 1, "exactly one login for the id");
      const ciphertext = stored[0]!.password;
      const needles = [
        plaintext,
        ciphertext,
        ciphertext.slice("oskv1:".length),
      ];
      assert.isTrue(
        Zotero.OSKeyStore.isEncrypted(ciphertext),
        "the stored password is oskv1:-prefixed ciphertext",
      );
      const branchNames = listBranchPrefs();
      const branchHits = findBranchPrefsContaining(needles);
      debug(
        `${LOG_PREFIX} prefs under ${PREF_BRANCH_ROOT}: ${branchNames.length} ` +
          `(${branchNames.join(", ")}); holding the dummy value or its ciphertext: ` +
          `${branchHits.length}; ${FLAG_PREF_KEY}=${String(getRawPref(FLAG_PREF_KEY))}`,
      );
      assert.deepEqual(
        branchHits,
        [],
        "no pref under the plugin branch holds the value or its ciphertext",
      );

      // Criterion 3 — clear() removes the login entry and flips the flag.
      await store.clear(NCBI_ID);
      created = false;
      const afterClear = await ownLoginsFor(NCBI_ID);
      debug(
        `${LOG_PREFIX} after clear(): logins for "${NCBI_ID}" ${afterClear.length}; ` +
          `${FLAG_PREF_KEY}=${String(getRawPref(FLAG_PREF_KEY))}`,
      );
      assert.strictEqual(afterClear.length, 0, "the login entry is gone");
      assert.isFalse(await store.has(NCBI_ID), "has() is false after clear()");
      assert.isFalse(
        getPref("ncbiKeyPresent"),
        "ncbi.keyPresent is false after clear()",
      );
      assert.notInclude(
        await store.listStoredIds(),
        NCBI_ID,
        "listStoredIds() no longer reports it",
      );
    } finally {
      if (created || (await ownLoginsFor(NCBI_ID)).length > 0) {
        await store.clear(NCBI_ID);
      }
      restorePrefs(saved);
      detachPrefs();
    }

    for (const entry of saved) {
      assert.strictEqual(
        prefHasUserValue(entry.key),
        entry.hadUserValue,
        `${entry.key} restored`,
      );
    }
  });

  // Added 2026-10-15 (`plan/00` §6 item 169): `P2-T05` shipped the
  // `semanticscholar.keyPresent` row without a `KEY_PRESENCE_PREFS` entry, so a
  // stored Semantic Scholar key left the pane's flag at `false`. A dummy
  // key-shaped value only — never a real key; refused if one is stored.
  it("sets and clears semanticscholar.keyPresent with the Semantic Scholar key", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const S2_ID: SecretId = "source.semanticscholar";
    // `PREF_KEYS` has no entry for it (`P2-T05` spelled the key in the schema
    // row because `src/prefs/keys.ts` was outside its list); read it from there.
    const S2_FLAG_KEY = PREFS.semanticscholarKeyPresent.key;
    await refuseIfStored(S2_ID);

    const detachPrefs = installPrefStore();
    const saved = savePrefs([S2_FLAG_KEY]);
    const store = createKeychainSecretStore();
    let created = false;
    try {
      assert.strictEqual(
        keyPresencePrefFor(S2_ID),
        "semanticscholarKeyPresent",
        "the Semantic Scholar key maps to its §8.5 flag",
      );
      await store.set(S2_ID, dummyKeyShapedValue());
      created = true;
      assert.isTrue(
        getPref("semanticscholarKeyPresent"),
        "semanticscholar.keyPresent is true after set()",
      );
      assert.strictEqual(
        getRawPref(S2_FLAG_KEY),
        true,
        "and it is a real boolean under the branch",
      );
      await store.clear(S2_ID);
      created = false;
      assert.isFalse(
        getPref("semanticscholarKeyPresent"),
        "semanticscholar.keyPresent is false after clear()",
      );
      debug(
        `${LOG_PREFIX} item 169: ${S2_FLAG_KEY} round-trip true -> false via ` +
          `keyPresencePrefFor("${S2_ID}")=${String(keyPresencePrefFor(S2_ID))}`,
      );
    } finally {
      if (created || (await ownLoginsFor(S2_ID)).length > 0) {
        await store.clear(S2_ID);
      }
      restorePrefs(saved);
      detachPrefs();
    }
    for (const entry of saved) {
      assert.strictEqual(
        prefHasUserValue(entry.key),
        entry.hadUserValue,
        `${entry.key} restored`,
      );
    }
  });

  it("resolves undefined and throws nothing when no key is stored", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await refuseIfStored(NCBI_ID);

    const detachPrefs = installPrefStore();
    const saved = savePrefs([FLAG_PREF_KEY]);
    const store = createKeychainSecretStore();
    try {
      // Criterion 4. `getSecret` throws on an unprefixed stored value and on a
      // failed decrypt; "nothing stored" must be neither of those.
      const value = await store.get(NCBI_ID);
      const has = await store.has(NCBI_ID);
      const ids = await store.listStoredIds();
      const flag = await refreshKeyPresence(NCBI_ID);
      debug(
        `${LOG_PREFIX} with nothing stored: get()=${JSON.stringify(value)}, ` +
          `has()=${String(has)}, listStoredIds()=[${ids.join(", ")}], ` +
          `refreshKeyPresence() wrote ${String(flag)}`,
      );
      assert.isUndefined(value, "get() resolves undefined, it does not throw");
      assert.isFalse(has, "has() is false");
      assert.notInclude(ids, NCBI_ID, "listStoredIds() omits it");
      assert.strictEqual(flag, false, "the flag is derived as false");
      assert.isFalse(
        getPref("ncbiKeyPresent"),
        "ncbi.keyPresent reads false with no key stored",
      );
    } finally {
      restorePrefs(saved);
      detachPrefs();
    }
  });

  it("moves the NCBI rate-limit budget: the flag this module writes is what the limiter registry reads", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await refuseIfStored(NCBI_ID);

    const detachPrefs = installPrefStore();
    const saved = savePrefs([FLAG_PREF_KEY]);
    const store = createKeychainSecretStore();
    const plaintext = dummyKeyShapedValue();
    let created = false;

    try {
      // Start from the §8.5 default, so the registry is built on `withoutKey`.
      clearRawPref(FLAG_PREF_KEY);
      const registry = createHostLimiterRegistry({
        clock: createSystemClock(),
        prefs: createZoteroPrefStore(),
      });
      const policy = registry.policyFor(NCBI_HOST);
      if (policy === undefined) {
        assert.fail(`no rate-limit policy row for ${NCBI_HOST}`);
      }
      assert.strictEqual(
        policy.keyPresencePref,
        NCBI_KEY_PRESENT_PREF,
        "the row is driven by the key-presence flag",
      );
      // Built with the flag at its default, so nothing has changed yet.
      assert.deepEqual(
        registry.refresh(),
        [],
        "the registry starts on the no-key budget",
      );

      // The only thing that happens between the two refreshes is a stored
      // secret. If `setSecret` stopped writing the flag, this reads [] and the
      // host would keep pacing at the unkeyed 2.5 req/s with a key in hand.
      await store.set(NCBI_ID, plaintext);
      created = true;
      const raised = registry.refresh();
      debug(
        `${LOG_PREFIX} after set(): ${FLAG_PREF_KEY}=${String(getRawPref(FLAG_PREF_KEY))}; ` +
          `registry.refresh() reconfigured [${raised.join(", ")}]; ` +
          `withoutKey ${policy.withoutKey.ratePerSecond}/s -> withKey ` +
          `${String(policy.withKey?.ratePerSecond)}/s`,
      );
      assert.deepEqual(
        raised,
        [NCBI_HOST],
        "storing the key moved NCBI onto the with-key budget",
      );
      assert.deepEqual(
        registry.refresh(),
        [],
        "and refresh() is idempotent once applied",
      );

      await store.clear(NCBI_ID);
      created = false;
      const lowered = registry.refresh();
      debug(
        `${LOG_PREFIX} after clear(): ${FLAG_PREF_KEY}=${String(getRawPref(FLAG_PREF_KEY))}; ` +
          `registry.refresh() reconfigured [${lowered.join(", ")}]`,
      );
      assert.deepEqual(
        lowered,
        [NCBI_HOST],
        "clearing the key moved NCBI back onto the no-key budget",
      );
    } finally {
      if (created || (await ownLoginsFor(NCBI_ID)).length > 0) {
        await store.clear(NCBI_ID);
      }
      restorePrefs(saved);
      detachPrefs();
    }
  });

  it("records the startup probe's verdict in the secretBackend preference", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const detachPrefs = installPrefStore();
    const saved = savePrefs([BACKEND_PREF_KEY]);
    const warnings: {
      msg: string;
      ctx: Record<string, unknown> | undefined;
    }[] = [];
    try {
      clearRawPref(BACKEND_PREF_KEY);
      const verdict = await probeAndRecordBackend({
        logger: {
          warn(msg: string, ctx?: Record<string, unknown>): void {
            warnings.push({ msg, ctx });
          },
        },
      });
      debug(
        `${LOG_PREFIX} probe verdict ${JSON.stringify(verdict)}; ` +
          `${BACKEND_PREF_KEY}=${JSON.stringify(getRawPref(BACKEND_PREF_KEY))}; ` +
          `warnings ${warnings.length}`,
      );
      assert.strictEqual(
        verdict.backend,
        "os-keychain",
        "tier 1 on this machine",
      );
      // `docs/07` §8.5's spelling, not `docs/09` §1.7's — §8.5 is the authority
      // for a preference's allowed values and records the conflict itself.
      assert.strictEqual(
        getPref("secretBackend"),
        "oskeystore",
        "a tier-1 verdict writes §8.5's oskeystore",
      );
      assert.strictEqual(
        getRawPref(BACKEND_PREF_KEY),
        "oskeystore",
        "under the branch, not only through the typed reader",
      );
      assert.strictEqual(warnings.length, 0, "a tier-1 verdict warns nothing");

      // The failure arm's pref value, without faking a keystore failure: the
      // mapping is the part §8.5 says bites, and `""` is its "unprobed" member.
      assert.strictEqual(
        secretBackendPrefValue({
          backend: "unavailable",
          failure: "encrypt-threw",
          detail: "Error: checked without touching the real keystore",
          elapsedMs: 0,
        }),
        SECRET_BACKEND_UNAVAILABLE,
        "an unavailable verdict maps to §8.5's empty string",
      );
    } finally {
      restorePrefs(saved);
      detachPrefs();
    }
  });
});

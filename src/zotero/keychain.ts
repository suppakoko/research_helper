/**
 * Tier 1 of `docs/09` §1.7's secret storage: `Zotero.OSKeyStore` wrapped in
 * `Services.logins` (`P0-T23`, `V-16`).
 *
 * Decision D5 (`docs/00` §3): an API key goes here and nowhere else. There is
 * no preference fallback and there never will be — tier 4 of `docs/09` §1.7 is
 * "Not implemented" on purpose.
 *
 * ### Why `P1-T06` extended this file instead of replacing it
 *
 * `plan/README.md` §4 lists this path among the sixteen a Phase 1 card `create`s
 * over a Phase 0 spike, and its 2026-09-30 correction says to grep for importers
 * before replacing one. Measured: `test/integration/zotero/secrets.spec.ts` —
 * `P0-T23`'s shipped measurement, and **not** in `P1-T06`'s `Files` list —
 * imports ten symbols from this module by name (`LOGIN_ORIGIN`, `LOGIN_REALM`,
 * `clearSecret`, `getSecret`, `hasSecret`, `listStoredIds`,
 * `loginRemovalMethod`, `probeKeystore`, `setSecret` and the type `SecretId`).
 * Rewriting the
 * file wholesale would break a file this card may not touch, so the tier-1
 * mechanism below is kept as `P0-T23` left it and `P1-T06` adds three things on
 * top of it:
 *
 * 1. {@link createKeychainSecretStore} — `docs/09` §1.7's `SecretStore` object,
 *    whose port now lives in `src/core/secretStore.ts` and whose three types are
 *    re-exported from here so this module's surface is unchanged.
 * 2. {@link refreshKeyPresence} — the `*.keyPresent` flag of `docs/07` §8.5,
 *    maintained from `hasSecret()` and written by nothing else in the product.
 * 3. {@link probeAndRecordBackend} — the startup probe's verdict recorded in the
 *    `secretBackend` preference.
 *
 * Tiers 2 and 3, the passphrase file, the degradation dialog, the backend badge
 * and the other six `SecretId`s are Phase 3's (`P3-T02`, `P3-T03`, `P3-T04`).
 *
 * **Never log a value from this module**, plaintext or `oskv1:` ciphertext
 * (`docs/09` §2.1, `docs/01` §12 gotcha 15). Nothing below does; ids, counts
 * and verdicts only.
 *
 * ### Runtime facts this module is written against (Zotero 10.0.2, Gecko 140.15.0 ESR)
 *
 * Measured by `P0-T23` on 2026-09-15; the evidence is in the card's Findings.
 *
 * - **`Services.logins.removeLoginAsync` does not exist.** `docs/09` §1.2 and
 *   §1.7 were written against an `esr153` `nsILoginManager.idl`; the Gecko
 *   Zotero 10.0.2 actually ships is 140, where removal is the synchronous
 *   `removeLogin()`, and Zotero's own `syncLocal.js` and `webdav.js` call that
 *   synchronous form. {@link removeLogin} prefers `removeLoginAsync` when the
 *   platform has it and falls back to `removeLogin` otherwise, so the same code
 *   is correct on both sides of the ESR bump. Both are `await`ed.
 * - **`Zotero.OSKeyStore.decrypt()` returns its input unchanged when the input
 *   lacks the `oskv1:` prefix** (legacy plaintext support in `osKeyStore.js`).
 *   Calling it on an unprefixed login would silently hand back whatever was
 *   stored. {@link getSecret} therefore refuses an unprefixed value instead of
 *   decrypting it: this plugin never writes one, so finding one is an error.
 * - **`Zotero.OSKeyStore.available` only reports that Mozilla's
 *   `OSKeyStore.sys.mjs` imported.** It says nothing about whether the native
 *   store works, which is why {@link probeKeystore} is a real round trip
 *   (`docs/09` §1.3's implementer note).
 */

import type { Logger } from "../core/logger";
import {
  SECRET_IDS,
  isSecretId,
  type SecretBackend,
  type SecretId,
  type SecretStore,
} from "../core/secretStore";
import { setPref, type PrefName } from "../prefs";

// `docs/09` §1.7 prints `SecretBackend`, `SecretId` and `SecretStore` under a
// `// src/zotero/keychain.ts` comment and `P0-T23` declared the first two here.
// `P1-T06` step 1 moves the declarations to the port in `src/core/secretStore.ts`
// — `docs/07` §2.3's rule for a platform capability — and re-exports them, so
// every existing importer of this module, and §1.7's own reading of where these
// names live, both still hold.
export { SECRET_IDS };
export type { SecretBackend, SecretId, SecretStore };

/** `docs/09` §1.7 / `docs/07` §8.4. Never change: stored logins are keyed on it. */
export const LOGIN_ORIGIN = "chrome://research-helper";
/** `docs/09` §1.7 / `docs/07` §8.4. Never change: stored logins are keyed on it. */
export const LOGIN_REALM = "research_helper API Keys (encrypted)";

/**
 * `nsILoginManager` as the running Gecko may expose it. `zotero-types@4.1.3`'s
 * generated binding has no `removeLoginAsync`, and on Gecko 140 the platform
 * has none either; on a later ESR the synchronous form is removed. Both are
 * optional here so the call site has to check.
 */
interface LoginRemoval {
  removeLoginAsync?: (login: nsILoginInfo) => Promise<void>;
  removeLogin?: (login: nsILoginInfo) => void;
}

const LoginInfo = Components.Constructor(
  "@mozilla.org/login-manager/loginInfo;1",
  Components.interfaces.nsILoginInfo,
  "init",
);

/** Every login under this plugin's origin and realm. Never decrypts with OSKeyStore. */
async function searchOwnLogins(): Promise<nsILoginInfo[]> {
  await Services.logins.initializationPromise;
  const logins = (await Services.logins.searchLoginsAsync({
    origin: LOGIN_ORIGIN,
    httpRealm: LOGIN_REALM,
  })) as nsILoginInfo[];
  return logins;
}

async function loginsFor(id: SecretId): Promise<nsILoginInfo[]> {
  return (await searchOwnLogins()).filter((login) => login.username === id);
}

/**
 * Remove one login, with whichever removal method this Gecko has.
 *
 * Exported so `P0-T23`'s spec can clean up exactly the logins it created.
 */
export async function removeLogin(login: nsILoginInfo): Promise<void> {
  const manager = Services.logins as unknown as LoginRemoval;
  if (typeof manager.removeLoginAsync === "function") {
    await manager.removeLoginAsync(login);
    return;
  }
  if (typeof manager.removeLogin === "function") {
    manager.removeLogin(login);
    return;
  }
  throw new Error(
    "[research-helper] Services.logins has neither removeLoginAsync nor removeLogin",
  );
}

/**
 * Which removal method {@link removeLogin} will use on this Gecko. Diagnostic
 * only — it is what `P0-T23` reports.
 */
export function loginRemovalMethod():
  "removeLoginAsync" | "removeLogin" | "none" {
  const manager = Services.logins as unknown as LoginRemoval;
  if (typeof manager.removeLoginAsync === "function") {
    return "removeLoginAsync";
  }
  if (typeof manager.removeLogin === "function") {
    return "removeLogin";
  }
  return "none";
}

// ---------------------------------------------------------------------------
// The non-secret key-presence flags — docs/07 §8.5, P1-T06 step 4
// ---------------------------------------------------------------------------

/**
 * The `*.keyPresent` preference each `SecretId` maintains, where one exists.
 *
 * `docs/07` §8.5, "Non-secret key-presence flags": these booleans exist "so the
 * prefs pane can render a per-provider status row without a keychain round-trip
 * on every paint. They are written by the `SecretStore` and read by the pane;
 * **nothing else may write them**." This table is that sentence's other half —
 * the only mapping from a credential to its flag in the product.
 *
 * **One row, because §8.5 only has one row this phase can write.** `docs/11` §1
 * scopes Phase 1 to "Tier-1 `SecretStore` for `source.ncbi` only" and `P1-T06`'s
 * **Do NOT** forbids storing any other secret here, so the other six `SecretId`s
 * map to nothing and {@link refreshKeyPresence} is a no-op for them. `P3-T02`
 * step 4 adds the remaining five flags — `tts.gemini` shares `gemini.keyPresent`
 * with `llm.gemini`, which is why §8.5 lists six flags for seven ids and why
 * this is a table rather than a string transformation.
 *
 * **It never holds a key.** Decision D5 and `plan/README.md` §5 rule 5: the
 * value written is the boolean {@link hasSecret} returned, and
 * `src/prefs/index.ts`'s `guardWritable` refuses a write to any `secret: true`
 * definition before the value is coerced at all.
 */
export const KEY_PRESENCE_PREFS: Readonly<Partial<Record<SecretId, PrefName>>> =
  {
    "source.ncbi": "ncbiKeyPresent",
  };

/** The `*.keyPresent` preference for `id`, or `undefined` if it has none yet. */
export function keyPresencePrefFor(id: SecretId): PrefName | undefined {
  return KEY_PRESENCE_PREFS[id];
}

/**
 * Re-derive `id`'s `*.keyPresent` flag from {@link hasSecret} and write it.
 *
 * `P1-T06` step 4: "Maintain `ncbi.keyPresent` from `has("source.ncbi")`". The
 * flag is **derived, never asserted** — it is read back out of the login manager
 * rather than inferred from what the caller just asked for, so a `set` whose
 * login the platform silently refused cannot leave the flag claiming a key is
 * there. A key wrongly believed present paces NCBI at 8 req/s against its
 * unkeyed 3 req/s ceiling and earns an IP block (`docs/02` §3.1), so the cheap
 * direction of that error is the only acceptable one.
 *
 * Called by {@link setSecret} and {@link clearSecret}, which makes those two the
 * only writers, and exported so a composition root can reconcile a flag left
 * stale by a keystore entry removed outside Zotero.
 *
 * **Who reads it.** `src/core/rateLimit/hostLimiter.ts`'s registry, at
 * construction and again from the preference observer
 * `src/bootstrap/container.ts` adopts: `NCBI_KEY_PRESENT_PREF` selects between
 * §7.3's 2.5 req/s `withoutKey` row and its 8 req/s `withKey` row. A write here
 * is what moves that bucket.
 *
 * Needs an installed `PrefStore` (`src/bootstrap/container.ts` installs it
 * first, before the limiter registry that reads the flag); without one
 * `src/prefs/index.ts` throws `ConfigurationError`, which is deliberate — a
 * stored key whose flag was silently dropped is the failure this function
 * exists to prevent.
 *
 * @param id - the credential whose flag to re-derive
 * @returns the boolean written, or `undefined` when `id` has no flag
 */
export async function refreshKeyPresence(
  id: SecretId,
): Promise<boolean | undefined> {
  const pref = keyPresencePrefFor(id);
  if (pref === undefined) {
    return undefined;
  }
  const present = await hasSecret(id);
  setPref(pref, present);
  return present;
}

/**
 * Store `value` for `id`: `docs/09` §1.7's `setTier1`, with the removal made
 * version-proof.
 *
 * Encrypts first, so a keystore failure throws before any existing login is
 * touched. **May throw** (`docs/09` §1.3) — callers must not assume success.
 *
 * Ends by re-deriving `id`'s `*.keyPresent` flag ({@link refreshKeyPresence}).
 * That is here rather than only in {@link createKeychainSecretStore} so that the
 * flag cannot go stale through the lower-level entry point: one writer, no
 * second path.
 */
export async function setSecret(id: SecretId, value: string): Promise<void> {
  const encrypted = await Zotero.OSKeyStore.encrypt(value);
  if (!Zotero.OSKeyStore.isEncrypted(encrypted)) {
    // `encrypt()` always prefixes; anything else would be plaintext in the store.
    throw new Error(
      "[research-helper] OSKeyStore.encrypt returned an unprefixed value; refusing to store it",
    );
  }
  for (const login of await loginsFor(id)) {
    await removeLogin(login);
  }
  await Services.logins.addLoginAsync(
    new LoginInfo(LOGIN_ORIGIN, null, LOGIN_REALM, id, encrypted, "", ""),
  );
  await refreshKeyPresence(id);
}

/**
 * Read and decrypt the value for `id`, or `undefined` when none is stored.
 *
 * Throws when the stored value is not `oskv1:`-prefixed (see the module
 * comment) and when `OSKeyStore.decrypt()` fails — a locked keychain, a
 * profile copied to another OS user, corrupt ciphertext.
 */
export async function getSecret(id: SecretId): Promise<string | undefined> {
  const [login] = await loginsFor(id);
  if (!login) {
    return undefined;
  }
  if (!Zotero.OSKeyStore.isEncrypted(login.password)) {
    throw new Error(
      `[research-helper] stored secret "${id}" is not OSKeyStore-encrypted; refusing to read it`,
    );
  }
  return Zotero.OSKeyStore.decrypt(login.password);
}

/**
 * Cheap existence check that never decrypts (`docs/09` §1.7). Drives the prefs
 * pane. True only for a login that carries an `oskv1:` value — the only kind
 * {@link getSecret} will read.
 */
export async function hasSecret(id: SecretId): Promise<boolean> {
  return (await loginsFor(id)).some((login) =>
    Zotero.OSKeyStore.isEncrypted(login.password),
  );
}

/**
 * Remove every login stored for `id`. Resolves to the number removed.
 *
 * Ends by re-deriving `id`'s `*.keyPresent` flag, for the reason
 * {@link setSecret} gives: one writer, no second path.
 */
export async function clearSecret(id: SecretId): Promise<number> {
  const logins = await loginsFor(id);
  for (const login of logins) {
    await removeLogin(login);
  }
  await refreshKeyPresence(id);
  return logins.length;
}

/** The `SecretId`s that currently have a login. Never decrypts. */
export async function listStoredIds(): Promise<readonly SecretId[]> {
  const ids = new Set<SecretId>();
  for (const login of await searchOwnLogins()) {
    if (isSecretId(login.username)) {
      ids.add(login.username);
    }
  }
  return [...ids];
}

/** Why the startup probe did not reach tier 1. */
export type KeystoreProbeFailure =
  "encrypt-threw" | "not-prefixed" | "decrypt-threw" | "mismatch";

/**
 * The startup probe's verdict. `"os-keychain"` is tier 1. Anything else sends
 * the plugin to `docs/09` §1.7's tier-2/3 decision, which is Phase 3's to build
 * and must be taken **with a dialog**, never silently.
 */
export type KeystoreProbeVerdict =
  | {
      readonly backend: "os-keychain";
      readonly elapsedMs: number;
    }
  | {
      readonly backend: "unavailable";
      readonly failure: KeystoreProbeFailure;
      /** The error's name, or its string form. Never a value. */
      readonly detail: string;
      readonly elapsedMs: number;
    };

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function throwawayProbeValue(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `rh-keystore-probe-${Date.now()}-${hex}`;
}

/**
 * A real `encrypt` → `decrypt` round trip of a throwaway value, not a read of
 * `Zotero.OSKeyStore.available` (`docs/09` §1.3). Stores nothing; never
 * throws.
 */
export async function probeKeystore(): Promise<KeystoreProbeVerdict> {
  const started = Date.now();
  const plaintext = throwawayProbeValue();
  const fail = (
    failure: KeystoreProbeFailure,
    detail: string,
  ): KeystoreProbeVerdict => ({
    backend: "unavailable",
    failure,
    detail,
    elapsedMs: Date.now() - started,
  });

  let encrypted: string;
  try {
    encrypted = await Zotero.OSKeyStore.encrypt(plaintext);
  } catch (error) {
    return fail("encrypt-threw", describeError(error));
  }
  if (!Zotero.OSKeyStore.isEncrypted(encrypted)) {
    return fail(
      "not-prefixed",
      "encrypt() returned a value without the oskv1: prefix",
    );
  }

  let decrypted: string;
  try {
    decrypted = await Zotero.OSKeyStore.decrypt(encrypted);
  } catch (error) {
    return fail("decrypt-threw", describeError(error));
  }
  if (decrypted !== plaintext) {
    return fail("mismatch", "decrypt(encrypt(x)) !== x");
  }
  return { backend: "os-keychain", elapsedMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Recording the probe's verdict — docs/07 §8.5, P1-T06 step 3
// ---------------------------------------------------------------------------

/**
 * The `secretBackend` preference's value for "not probed yet, or no backend".
 *
 * `docs/07` §8.5 gives the row's value set as
 * `oskeystore | session | passphrase | ""` and `""` as its default, documented
 * there as "(unprobed)". `P1-T06` step 3 writes it on probe failure as well, so
 * the pane's badge says nothing rather than naming a tier that is not there.
 */
export const SECRET_BACKEND_UNAVAILABLE = "";

/**
 * The `secretBackend` preference value a probe verdict maps to.
 *
 * **This function exists only because the two documents disagree, and `docs/07`
 * §8.5 records the disagreement itself.** §8.5's row spells the values
 * `oskeystore | session | passphrase | ""`; `docs/09` §1.7's {@link SecretBackend}
 * type spells them `os-keychain | session-only | passphrase` and has no unprobed
 * member. §8.5's note — "§8.5 is the sole authority for a preference's allowed
 * values, so these spellings ship; one of the two documents must be corrected"
 * — decides it, and `plan/README.md` §5 rule 3 says the same. So the *type* keeps
 * §1.7's spellings, the *preference* gets §8.5's, and this is the single place
 * the two vocabularies meet. §8.5 predicted the mismatch would bite at
 * `P3-T02`'s probe; it bites here, one phase earlier.
 *
 * `src/prefs/schema.ts` declares the row's closed value set, so a wrong spelling
 * returned from here is a `ConfigurationError` on the write rather than a badge
 * that silently reads empty.
 *
 * @param verdict - what {@link probeKeystore} returned
 * @returns a member of §8.5's value set
 */
export function secretBackendPrefValue(verdict: KeystoreProbeVerdict): string {
  return verdict.backend === "os-keychain"
    ? "oskeystore"
    : SECRET_BACKEND_UNAVAILABLE;
}

/** What {@link probeAndRecordBackend} needs from outside this module. */
export interface ProbeAndRecordOptions {
  /**
   * Where the failure warning goes. `src/core/logger.ts`'s logger, which
   * redacts (`P1-T02`); omitted in a context that has no logger yet, and then
   * the verdict is the only report.
   *
   * **Never pass anything that writes a value.** `docs/09` §2.1 / NFR-16: the
   * probe's plaintext is a throwaway, but `detail` below is a platform error
   * string and nothing about a credential may ever reach a log, a note, an
   * export or the clipboard.
   */
  readonly logger?: Pick<Logger, "warn">;
}

/**
 * Run the startup probe and record its verdict in the `secretBackend`
 * preference. `P1-T06` step 3: "on success write `secretBackend = "oskeystore"`;
 * on failure write `""` and log a warning. Phase 1 stops there."
 *
 * **Phase 1 stops there — deliberately.** `docs/09` §1.7 escalates a failed probe
 * to the tier-2/tier-3 decision "**with a dialog**, never silently"; that dialog,
 * those tiers and the pane badge are `P3-T03`'s and `P3-T04`'s, and `P1-T06`'s
 * **Do NOT** says a half-built ladder is worse than one rung. So on failure this
 * writes `""`, warns, and returns the verdict for its caller to act on.
 *
 * **Nothing calls this at startup yet.** `src/bootstrap/container.ts` is outside
 * `P1-T06`'s `Files` list, so the probe ships unwired and `secretBackend` stays
 * `""` in a running plugin until a card wires it. Reported with `P1-T06` rather
 * than widened into (`plan/README.md` §5 rule 2).
 *
 * Never throws for a keystore failure — {@link probeKeystore} turns those into
 * verdicts. It *does* propagate a preference-write failure, for the reason
 * {@link refreshKeyPresence} gives.
 *
 * @param options - see {@link ProbeAndRecordOptions}
 * @returns the verdict that was recorded
 */
export async function probeAndRecordBackend(
  options: ProbeAndRecordOptions = {},
): Promise<KeystoreProbeVerdict> {
  const verdict = await probeKeystore();
  setPref("secretBackend", secretBackendPrefValue(verdict));
  if (verdict.backend !== "os-keychain") {
    // ids, counts and verdicts only — never a value (`docs/09` §2.1).
    options.logger?.warn(
      "OS keystore probe failed; no secret backend is live",
      {
        failure: verdict.failure,
        detail: verdict.detail,
        elapsedMs: verdict.elapsedMs,
      },
    );
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// The SecretStore — docs/09 §1.7, tier 1 only
// ---------------------------------------------------------------------------

/**
 * `docs/09` §1.7's `SecretStore`, tier 1.
 *
 * A plain delegation to the functions above, which is the point: the mechanism
 * has one implementation and the object is the port's shape over it, so there is
 * no second code path a secret could take. `set` and `clear` maintain the
 * `*.keyPresent` flag because {@link setSecret} and {@link clearSecret} do.
 *
 * - `backend` is `"os-keychain"`. It is **not** probed here: a constructor that
 *   round-tripped the keystore would be an async constructor, and `docs/09` §1.7
 *   puts the probe at startup instead. Call {@link probeAndRecordBackend} and
 *   build this store only on a tier-1 verdict; on any other verdict Phase 1 has
 *   no store to offer, which is `docs/11` §1's scope and not an oversight.
 * - `unattended` is `true`: Windows DPAPI, the macOS Keychain and libsecret all
 *   decrypt for the running user without a prompt, which is what lets a
 *   background job resume. `docs/09` §1.7 contrasts this with tier 2, whose cost
 *   is "losing unattended resume".
 *
 * @returns the tier-1 {@link SecretStore}
 */
export function createKeychainSecretStore(): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get: getSecret,
    set: setSecret,
    clear: async (id: SecretId): Promise<void> => {
      await clearSecret(id);
    },
    has: hasSecret,
    listStoredIds,
  };
}

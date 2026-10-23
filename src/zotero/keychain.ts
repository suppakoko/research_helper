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
 * `P3-T02` added the LLM and TTS presence flags, the startup reconciliation of
 * every flag ({@link reconcileKeyPresence}) and the uninstall sweep
 * ({@link clearAllSecrets}, {@link clearAllSecretsOnUninstall}). `P3-T03`
 * added tier 2, the session-only store ({@link createSessionSecretStore}), at
 * the end of this file; the dialog that offers it is
 * `src/ui/dialogs/secretBackendDialog.ts`, and `installSecretStore` in
 * `src/bootstrap/container.ts` opens it on a failed probe. **Tier 3, the
 * passphrase file, does not ship in v1** (gate `G-10`, decided 2026-10-08;
 * `docs/09` §1.7 corrected 2026-10-21), so nothing here derives a key from a
 * passphrase or writes a secrets file.
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
  clearEveryStoredId,
  isSecretId,
  type SecretBackend,
  type SecretId,
  type SecretStore,
} from "../core/secretStore";
import { getPrefStore, setPref, setPrefStore, type PrefName } from "../prefs";
import { createZoteroPrefStore } from "./prefStore";

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
 * **Seven rows, six flags.** Phase 1 had one row — `docs/11` §1 scoped it to
 * "Tier-1 `SecretStore` for `source.ncbi` only". Phase 2's Semantic Scholar
 * adapter (`P2-T05`) added the second on 2026-10-15. `P3-T02` step 1 added the
 * five LLM and TTS rows; their schema rows came from `P3-T32`. `tts.gemini`
 * shares `gemini.keyPresent` with `llm.gemini`. That is why §8.5 lists six flags
 * for seven ids, and why this is a table rather than a string transformation.
 *
 * **A shared flag means "either key is stored".** {@link refreshKeyPresence}
 * derives a flag from every id that feeds it ({@link secretIdsForFlag}), never
 * from the one id just written. Otherwise clearing `tts.gemini` would write
 * `gemini.keyPresent = false` while an `llm.gemini` key is still stored.
 *
 * **It never holds a key.** Decision D5 and `plan/README.md` §5 rule 5: the
 * value written is the boolean {@link hasSecret} returned, and
 * `src/prefs/index.ts`'s `guardWritable` refuses a write to any `secret: true`
 * definition before the value is coerced at all.
 */
export const KEY_PRESENCE_PREFS: Readonly<Partial<Record<SecretId, PrefName>>> =
  {
    "source.ncbi": "ncbiKeyPresent",
    // Added 2026-10-15 (`plan/00` §6 item 169): `P2-T05` shipped the
    // `semanticscholar.keyPresent` row and the adapter, but without this entry
    // `setSecret`/`deleteSecret` re-derived nothing for `source.semanticscholar`
    // and the pane's badge stayed at the default `false` with a key stored.
    "source.semanticscholar": "semanticscholarKeyPresent",
    // `P3-T02` step 1: the four LLM credentials, and the TTS credential that
    // shares Gemini's flag (`docs/07` §8.5 lists six flags for seven ids).
    "llm.openrouter": "openrouterKeyPresent",
    "llm.openai": "openaiKeyPresent",
    "llm.gemini": "geminiKeyPresent",
    "llm.anthropic": "anthropicKeyPresent",
    "tts.gemini": "geminiKeyPresent",
  };

/** The `*.keyPresent` preference for `id`, or `undefined` if it has none. */
export function keyPresencePrefFor(id: SecretId): PrefName | undefined {
  return KEY_PRESENCE_PREFS[id];
}

/**
 * Every `SecretId` whose stored key sets `flag`, in {@link SECRET_IDS} order.
 * One id for most flags; two (`llm.gemini`, `tts.gemini`) for
 * `geminiKeyPresent`.
 */
export function secretIdsForFlag(flag: PrefName): readonly SecretId[] {
  return SECRET_IDS.filter((id) => KEY_PRESENCE_PREFS[id] === flag);
}

/** Every distinct `*.keyPresent` flag in {@link KEY_PRESENCE_PREFS}, in order. */
export function keyPresenceFlags(): readonly PrefName[] {
  const flags = new Set<PrefName>();
  for (const id of SECRET_IDS) {
    const flag = KEY_PRESENCE_PREFS[id];
    if (flag !== undefined) flags.add(flag);
  }
  return [...flags];
}

/**
 * What `flag` should read: `true` when any id that feeds it has a stored key.
 *
 * Takes the existence check as a parameter so the rule can be tested without a
 * keystore. The product passes {@link hasSecret}, which never decrypts.
 *
 * @param flag - a `*.keyPresent` preference
 * @param has - the existence check for one id
 * @returns the derived flag value
 */
export async function deriveKeyPresence(
  flag: PrefName,
  has: (id: SecretId) => Promise<boolean>,
): Promise<boolean> {
  for (const id of secretIdsForFlag(flag)) {
    if (await has(id)) return true;
  }
  return false;
}

/**
 * Every flag's derived value, without writing anything. `P3-T02` step 2's
 * startup reconciliation is this followed by one write per flag
 * ({@link reconcileKeyPresence}).
 *
 * @param has - the existence check for one id
 * @returns each distinct flag with the value it should hold
 */
export async function deriveAllKeyPresence(
  has: (id: SecretId) => Promise<boolean>,
): Promise<ReadonlyMap<PrefName, boolean>> {
  const values = new Map<PrefName, boolean>();
  for (const flag of keyPresenceFlags()) {
    values.set(flag, await deriveKeyPresence(flag, has));
  }
  return values;
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
 * **A shared flag is derived from every id that feeds it** (`P3-T02`), so the
 * value written for `tts.gemini` is "a `tts.gemini` or an `llm.gemini` key is
 * stored" ({@link deriveKeyPresence}).
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
  const present = await deriveKeyPresence(pref, hasSecret);
  setPref(pref, present);
  return present;
}

/**
 * Re-derive and write **every** `*.keyPresent` flag from the keystore.
 * `P3-T02` step 2. Called once at startup by `installSecretStore` in
 * `src/bootstrap/container.ts`, before the limiter registry reads
 * `ncbi.keyPresent`.
 *
 * Every value is derived first and only then written. So a login-manager
 * failure part-way through leaves every flag as it was, rather than leaving
 * some reconciled and some not. A preference-write failure propagates, for the
 * reason {@link refreshKeyPresence} gives.
 *
 * @returns each flag with the value written
 */
export async function reconcileKeyPresence(): Promise<
  ReadonlyMap<PrefName, boolean>
> {
  const values = await deriveAllKeyPresence(hasSecret);
  for (const [flag, present] of values) {
    setPref(flag, present);
  }
  return values;
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

/**
 * Remove every stored `SecretId`: `docs/09` §2.5's uninstall sweep, through
 * the port's one sweep ({@link clearEveryStoredId}) over {@link listStoredIds}
 * and {@link clearSecret}. Each `clearSecret` re-derives its flag, so every
 * flag reads `false` afterwards.
 *
 * Needs an installed `PrefStore`, as {@link clearSecret} does. The uninstall
 * path has none, so it goes through {@link clearAllSecretsOnUninstall}.
 *
 * @returns the number of ids cleared
 */
export async function clearAllSecrets(): Promise<number> {
  return clearEveryStoredId({
    listStoredIds,
    clear: async (id: SecretId): Promise<void> => {
      await clearSecret(id);
    },
  });
}

/**
 * {@link clearAllSecrets} for `uninstall()` in `addon/bootstrap.js`, reached
 * through `onUninstall` in `src/hooks.ts`.
 *
 * **Why it may install a `PrefStore`.** `shutdown()` runs before `uninstall()`,
 * and its teardown detaches the `PrefStore` (step 1 of `installServices` in
 * `src/bootstrap/container.ts`). If `uninstall()` instead loaded a fresh copy
 * of the bundle, that copy never had one. Without a store, the first
 * `clearSecret` removes its login and then throws on the flag write. So, when
 * none is installed, this installs `createZoteroPrefStore()` for the sweep and
 * detaches it afterwards. That factory registers nothing when it is built.
 * A store that is already installed is used and left in place.
 *
 * @returns the number of ids cleared
 */
export async function clearAllSecretsOnUninstall(): Promise<number> {
  const borrowed = getPrefStore() === undefined;
  if (borrowed) setPrefStore(createZoteroPrefStore());
  try {
    return await clearAllSecrets();
  } finally {
    if (borrowed) setPrefStore(undefined);
  }
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
 * `docs/07` §8.5 gives the row's value set as `oskeystore | session | ""` and
 * `""` as its default. `P1-T06` step 3 writes it on probe failure as well, so
 * the pane's badge says nothing rather than naming a tier that is not there;
 * since `P3-T03` it is also what a declined degradation dialog leaves behind.
 */
export const SECRET_BACKEND_UNAVAILABLE = "";

/**
 * `docs/07` §8.5's value set for the `secretBackend` preference, as settled on
 * 2026-10-21 (owner, `plan/00` §6 item 267). There is no `passphrase` value:
 * tier 3 does not ship in v1 (`G-10`).
 */
export type SecretBackendPrefValue =
  "oskeystore" | "session" | typeof SECRET_BACKEND_UNAVAILABLE;

/**
 * The preference value for each {@link SecretBackend}, written once. A record
 * over the union, so a backend added to the port without a preference
 * spelling does not compile.
 */
export const SECRET_BACKEND_PREF_VALUES: Readonly<
  Record<SecretBackend, SecretBackendPrefValue>
> = {
  "os-keychain": "oskeystore",
  "session-only": "session",
};

/**
 * The `secretBackend` preference value for a backend, a probe verdict, or no
 * store at all.
 *
 * **The single place the two vocabularies meet.** `docs/07` §8.5 is the sole
 * authority for a preference's allowed values and spells them
 * `oskeystore | session | ""`; `docs/09` §1.7's {@link SecretBackend} port type
 * spells its members `os-keychain | session-only` and has no "no store" member.
 * The CONFLICT §8.5 recorded on 2026-09-30 was resolved on 2026-10-21 in
 * favour of §8.5's spellings (owner, `plan/00` §6 item 267): the *type* keeps
 * §1.7's spellings, the *preference* gets §8.5's, and this maps one onto the
 * other.
 *
 * - a {@link SecretBackend} → {@link SECRET_BACKEND_PREF_VALUES}'s entry;
 * - `undefined` (no store installed) → {@link SECRET_BACKEND_UNAVAILABLE};
 * - a probe verdict → `oskeystore` for tier 1, `""` otherwise. A failed probe
 *   is not tier 2: tier 2 exists only once the user chooses it in the dialog.
 *
 * **Gecko's `NSSKeyStore` fallback maps to `oskeystore`.** It is not a value
 * this function sees: {@link probeKeystore} succeeds on that backend and
 * returns `"os-keychain"`, because a round trip cannot tell it from a system
 * keyring (`P1-T41`). `P3-T37` owns detecting it.
 *
 * `src/prefs/schema.ts` declares the row's closed value set, so a wrong
 * spelling returned from here is a `ConfigurationError` on the write rather
 * than a badge that silently reads empty.
 *
 * @param source - a backend, what {@link probeKeystore} returned, or
 *   `undefined` for "no store"
 * @returns a member of §8.5's value set
 */
export function secretBackendPrefValue(
  source: SecretBackend | KeystoreProbeVerdict | undefined,
): SecretBackendPrefValue {
  if (source === undefined) return SECRET_BACKEND_UNAVAILABLE;
  if (typeof source === "string") return SECRET_BACKEND_PREF_VALUES[source];
  return source.backend === "os-keychain"
    ? SECRET_BACKEND_PREF_VALUES["os-keychain"]
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
 * **This function stops there — deliberately.** `docs/09` §1.7 escalates a
 * failed probe to the degradation dialog, "never silently". On failure this
 * writes `""`, warns, and returns the verdict; its caller, `installSecretStore`
 * in `src/bootstrap/container.ts`, opens the dialog and, only if the user
 * chooses tier 2, calls {@link adoptSessionSecretStore}, which writes
 * `session`.
 *
 * *Updated 2026-10-21 (`P3-T03`):* this comment said nothing called the probe
 * at startup. `installSecretStore` has called it since the composition root
 * was wired.
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
 *   build this store only on a tier-1 verdict; on any other verdict the only
 *   other store is tier 2 ({@link createSessionSecretStore}), and only after
 *   the user chooses it in the degradation dialog.
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
    clearAll: clearAllSecrets,
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — session-only (docs/09 §1.7, P3-T03)
// ---------------------------------------------------------------------------

/**
 * Tier 2's storage: one module-scoped map, and nothing else.
 *
 * `docs/09` §1.7: "Keys live in a module-scoped variable, cleared on
 * shutdown." **No value in this map is ever written anywhere** — not to a
 * preference, a file, the database, a log or the login manager. Only
 * {@link createSessionSecretStore}'s methods read or write it, and
 * {@link clearSessionSecrets} empties it at shutdown.
 */
const sessionSecrets = new Map<SecretId, string>();

/** Tier 2's existence check, over the map. Never reads a value out. */
function sessionHas(id: SecretId): Promise<boolean> {
  return Promise.resolve(sessionSecrets.has(id));
}

/**
 * Re-derive `id`'s `*.keyPresent` flag from the session map and write it: the
 * tier-2 counterpart of {@link refreshKeyPresence}, under the same rule (a
 * shared flag means "either key is stored", {@link deriveKeyPresence}). The
 * value written is a boolean, never the key.
 */
async function refreshSessionKeyPresence(id: SecretId): Promise<void> {
  const pref = keyPresencePrefFor(id);
  if (pref === undefined) return;
  setPref(pref, await deriveKeyPresence(pref, sessionHas));
}

/**
 * Write every `*.keyPresent` flag from the session map. At startup the map is
 * empty, so every flag becomes `false`.
 *
 * `installSecretStore` calls this on **every** failed probe, before the dialog,
 * whatever the user then chooses. A flag is a stored preference and outlives
 * the session: without this, a `true` written while a session key was held
 * (or while tier 1 last worked) would still claim a key after restart. A stale
 * `ncbi.keyPresent = true` paces NCBI at the keyed budget with no key sent,
 * which `docs/02` §3.1 says earns an IP block.
 *
 * @returns each flag with the value written
 */
export async function reconcileSessionKeyPresence(): Promise<
  ReadonlyMap<PrefName, boolean>
> {
  const values = await deriveAllKeyPresence(sessionHas);
  for (const [flag, present] of values) {
    setPref(flag, present);
  }
  return values;
}

/**
 * Empty the session map. `installServices` in `src/bootstrap/container.ts`
 * defers this into the root scope when tier 2 is installed, so it runs from
 * `shutdown()`. Never writes a preference: teardown detaches the `PrefStore`,
 * and the next startup's {@link reconcileSessionKeyPresence} resets the flags.
 *
 * @returns how many keys were dropped
 */
export function clearSessionSecrets(): number {
  const dropped = sessionSecrets.size;
  sessionSecrets.clear();
  return dropped;
}

/**
 * `docs/09` §1.7's tier 2: keys held in memory for this session and **written
 * nowhere**.
 *
 * - `backend` is `"session-only"`, recorded in the preference as `session`
 *   ({@link secretBackendPrefValue}).
 * - `unattended` is **`false`** (`P3-T03` step 4): after a restart no key is
 *   held, so a job that needs one cannot resume on its own. The summarize
 *   pipeline (`P3-T29`) reads this to pause such a job with reason
 *   `credential-required` (`docs/07` §7.5) instead of failing it.
 * - `set` and `clear` maintain the `*.keyPresent` flags, as tier 1's do,
 *   because `docs/07` §8.5 says the `SecretStore` writes them and nothing else.
 *   The flag holds a boolean; the value stays in the map.
 * - `clearAll` is the port's one sweep ({@link clearEveryStoredId}).
 *
 * Every store this returns shares the one map, so a second call does not
 * start a second, empty session.
 *
 * @returns the tier-2 {@link SecretStore}
 */
export function createSessionSecretStore(): SecretStore {
  const store: SecretStore = {
    backend: "session-only",
    unattended: false,
    get: (id: SecretId): Promise<string | undefined> =>
      Promise.resolve(sessionSecrets.get(id)),
    set: async (id: SecretId, value: string): Promise<void> => {
      sessionSecrets.set(id, value);
      await refreshSessionKeyPresence(id);
    },
    clear: async (id: SecretId): Promise<void> => {
      sessionSecrets.delete(id);
      await refreshSessionKeyPresence(id);
    },
    has: sessionHas,
    listStoredIds: (): Promise<readonly SecretId[]> =>
      Promise.resolve(SECRET_IDS.filter((id) => sessionSecrets.has(id))),
    clearAll: (): Promise<number> => clearEveryStoredId(store),
  };
  return store;
}

/**
 * The user chose tier 2 in the degradation dialog: record the choice in the
 * `secretBackend` preference (`session`, `P3-T03` step 3) and return the
 * store.
 *
 * Called by `installSecretStore` in `src/bootstrap/container.ts`, **only**
 * after the dialog returned that choice. Nothing calls it on a failed probe by
 * itself: `docs/09` §1.7 forbids falling from tier 1 to tier 2 without the
 * dialog.
 *
 * @returns the tier-2 {@link SecretStore}
 */
export function adoptSessionSecretStore(): SecretStore {
  const store = createSessionSecretStore();
  setPref("secretBackend", secretBackendPrefValue(store.backend));
  return store;
}

/**
 * Tier 1 of `docs/09` §1.7's secret storage: `Zotero.OSKeyStore` wrapped in
 * `Services.logins` (`P0-T23`, `V-16`).
 *
 * Decision D5 (`docs/00` §3): an API key goes here and nowhere else. There is
 * no preference fallback and there never will be — tier 4 of `docs/09` §1.7 is
 * "Not implemented" on purpose. This spike version builds only what `P0-T23`
 * asks for: the tier-1 read/write path, `has()`, and the startup probe. Tiers 2
 * and 3, the `SecretStore` object, the backend badge and the `*.keyPresent`
 * flags ship in Phase 3, whose card `create`s this file again
 * (`plan/README.md` §4).
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

/**
 * The three backends of `docs/09` §1.7. No plaintext-prefs member exists,
 * deliberately. Only `"os-keychain"` is implemented in Phase 0.
 */
export type SecretBackend = "os-keychain" | "session-only" | "passphrase";

/** Every credential the plugin stores, `docs/09` §1.7. */
export const SECRET_IDS = [
  "llm.openrouter",
  "llm.openai",
  "llm.gemini",
  "llm.anthropic",
  "tts.gemini",
  "source.ncbi",
  "source.semanticscholar",
] as const;

export type SecretId = (typeof SECRET_IDS)[number];

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

function isSecretId(value: string): value is SecretId {
  return (SECRET_IDS as readonly string[]).includes(value);
}

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

/**
 * Store `value` for `id`: `docs/09` §1.7's `setTier1`, with the removal made
 * version-proof.
 *
 * Encrypts first, so a keystore failure throws before any existing login is
 * touched. **May throw** (`docs/09` §1.3) — callers must not assume success.
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

/** Remove every login stored for `id`. Resolves to the number removed. */
export async function clearSecret(id: SecretId): Promise<number> {
  const logins = await loginsFor(id);
  for (const login of logins) {
    await removeLogin(login);
  }
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

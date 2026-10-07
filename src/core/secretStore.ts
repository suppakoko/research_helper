/**
 * The `SecretStore` port — `docs/09` §1.7's interface, declared where `core/`
 * can name it (`P1-T06` step 1).
 *
 * Decision **D5** (`docs/00` §3): a credential lives in the OS keystore and
 * nowhere else. There is no plaintext tier and there never will be — `docs/09`
 * §1.7's tier 4 is "**Not implemented**" on purpose, and D5 says that adding it
 * is what would turn a decision back into a preference. Nothing in this file
 * reads or writes a preference, a file or a log: it is types plus one frozen
 * list of identifiers.
 *
 * ## Why the port is here and the implementation is in `src/zotero/`
 *
 * `docs/09` §1.7 prints this interface under a `// src/zotero/keychain.ts`
 * comment, which would put it in the adapter directory. `docs/07` §2.3 is the
 * authority on placement — "where `core/` needs a platform capability (prefs,
 * files, HTTP, clock) it declares a *port* interface and receives an
 * implementation via the container" — and `P1-T06` step 1 names this path
 * explicitly. The one tier-1 implementation is
 * `src/zotero/keychain.ts`'s `createKeychainSecretStore`, which re-exports every
 * type below so that §1.7's own reading of the module surface still holds.
 *
 * **`plan/04-phase-3-llm-summaries.md`'s `P3-T02` step 1 says the opposite** —
 * "Declare `SecretBackend`, `SecretId` and the `SecretStore` interface in
 * `src/zotero/keychain.ts`". Two cards cannot both be right about one
 * declaration site. `P1-T06` ships first and §2.3 backs it, so the declaration
 * is here; the re-exports mean `P3-T02` can widen the implementation without
 * moving anything. Reported with `P1-T06`.
 *
 * ## What is deliberately absent
 *
 * - **No `"plaintext-prefs"` member of {@link SecretBackend}.** §1.7's own
 *   comment on that type says so, and it is the type-level half of D5.
 * - **No `clearAll()`.** §1.7's interface has seven members and `P1-T06` step 1
 *   lists exactly those seven. `docs/09` §2.5's `uninstall()` sweep is
 *   `P3-T02` step 7's; adding the method now would be a half-built surface with
 *   no caller.
 * - **No key-entry or passphrase surface.** Tiers 2 and 3 are `P3-T03`'s.
 */

/**
 * Every credential the plugin can store, `docs/09` §1.7's `SecretId` union in
 * declaration order.
 *
 * Frozen as a list as well as a union because the union alone cannot be
 * iterated, and {@link isSecretId} has to decide whether a `username` read back
 * out of the login manager is one of ours.
 *
 * **Do not widen this.** `P1-T06`'s **Do NOT** forbids adding a member, and
 * every id here other than `source.ncbi` is unreachable in Phase 1: `docs/11`
 * §1 ships no key-entry surface until Phase 3, so no user can supply a value
 * for any of them.
 */
export const SECRET_IDS = [
  "llm.openrouter",
  "llm.openai",
  "llm.gemini",
  "llm.anthropic",
  "tts.gemini",
  "source.ncbi",
  "source.semanticscholar",
] as const;

/** One of {@link SECRET_IDS}. */
export type SecretId = (typeof SECRET_IDS)[number];

/** Whether an arbitrary string is one of {@link SECRET_IDS}. */
export function isSecretId(value: string): value is SecretId {
  return (SECRET_IDS as readonly string[]).includes(value);
}

/**
 * The three backends of `docs/09` §1.7's ladder. **No `"plaintext-prefs"`
 * member exists, deliberately** — §1.7's own comment, and decision D5.
 *
 * Only `"os-keychain"` is implemented: `P1-T06`'s **Do NOT** keeps tiers 2 and 3
 * out of Phase 1 ("a half-built ladder is worse than one rung") and `P3-T03`
 * ships them.
 *
 * **These are not the `secretBackend` *preference*'s values.** `docs/07` §8.5
 * declares that row as `oskeystore | session | passphrase | ""` and is the sole
 * authority for a preference's allowed values; §8.5 records the conflict
 * outright. `src/zotero/keychain.ts`'s `secretBackendPrefValue` is the one
 * mapping between the two vocabularies.
 */
export type SecretBackend = "os-keychain" | "session-only" | "passphrase";

/**
 * `docs/09` §1.7's `SecretStore`, member for member.
 *
 * Every method is asynchronous because the platform is: `Zotero.OSKeyStore`'s
 * `encrypt`/`decrypt` return promises (`docs/09` §1.3) and the login-manager
 * search does too (§1.2).
 */
export interface SecretStore {
  /** Which tier is actually in force. */
  readonly backend: SecretBackend;
  /** True if this backend can serve reads without user interaction (background jobs). */
  readonly unattended: boolean;
  get(id: SecretId): Promise<string | undefined>;
  set(id: SecretId, value: string): Promise<void>;
  clear(id: SecretId): Promise<void>;
  /** Cheap existence check that never decrypts. Drives the prefs pane. */
  has(id: SecretId): Promise<boolean>;
  listStoredIds(): Promise<readonly SecretId[]>;
}

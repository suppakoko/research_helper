/**
 * The `SecretStore` port — `docs/09` §1.7's interface, declared where `core/`
 * can name it (`P1-T06` step 1).
 *
 * Decision **D5** (`docs/00` §3): a credential lives in the OS keystore and
 * nowhere else. There is no plaintext tier and there never will be — `docs/09`
 * §1.7's tier 4 is "**Not implemented**" on purpose, and D5 says that adding it
 * is what would turn a decision back into a preference. Nothing in this file
 * reads or writes a preference, a file or a log: it is types, one frozen list
 * of identifiers, and the port-only sweep {@link clearEveryStoredId}.
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
 * - **No key-entry or passphrase surface.** Tier 2 is `P3-T03`'s, in
 *   `src/zotero/keychain.ts`; tier 3 does not ship in v1 (`G-10`).
 *
 * ## `clearAll()` — the eighth member (`P3-T02`)
 *
 * §1.7's interface has seven members and `P1-T06` shipped exactly those.
 * `P3-T02` step 3 adds `clearAll()` for `docs/09` §2.5's `uninstall()` sweep,
 * whose caller is `onUninstall` in `src/hooks.ts`, reached from `uninstall()`
 * in `addon/bootstrap.js`. {@link clearEveryStoredId} is the one sweep every
 * tier shares, so a tier cannot leave an id behind by writing its own loop.
 *
 * Besides the port, this file now holds that one function. It is written
 * against the port alone, so it still reads and writes no preference, file or
 * log.
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
  // Unused: Gemini TTS reads the chat key, `llm.gemini` (`GEMINI_SECRET_ID`),
  // and nothing reads or writes this id (`docs/09` §3.3; owner, `plan/00` §6
  // item 379; `plan/09` `P6-T16` step 2). Kept so the union stays §1.7's.
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
 * The two backends of `docs/09` §1.7's ladder. **No `"plaintext-prefs"`
 * member exists, deliberately** — §1.7's own comment, and decision D5.
 *
 * `"os-keychain"` is tier 1 (`createKeychainSecretStore`); `"session-only"` is
 * tier 2 (`createSessionSecretStore`, `P3-T03`), offered only through the
 * degradation dialog. **There is no `"passphrase"` member since 2026-10-21**:
 * gate `G-10` (decided 2026-10-08) keeps tier 3 out of v1, and `docs/09` §1.7
 * dropped it from this type the same day (owner, `plan/00` §6 item 267).
 *
 * **These are not the `secretBackend` *preference*'s values.** `docs/07` §8.5
 * declares that row as `oskeystore | session | ""` and is the sole authority
 * for a preference's allowed values. `src/zotero/keychain.ts`'s
 * `secretBackendPrefValue` is the one mapping between the two vocabularies.
 */
export type SecretBackend = "os-keychain" | "session-only";

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
  /**
   * Clear every id {@link SecretStore.listStoredIds} returns, through
   * {@link SecretStore.clear}. Resolves to the number of ids cleared.
   * `docs/09` §2.5: called from `uninstall()`, **never** from `shutdown()`.
   * Implementations delegate to {@link clearEveryStoredId}.
   */
  clearAll(): Promise<number>;
}

/**
 * The one `clearAll()` sweep: clear every id `store.listStoredIds()` returns,
 * through `store.clear()`, and resolve to how many were cleared.
 *
 * **One failure does not stop the sweep.** A credential left behind after
 * removal is the bug `docs/09` §2.5 names, so every remaining id is still
 * tried. If any id failed, the function throws afterwards. The error names the
 * failed ids and their count, and carries the first failure as `cause`. An id
 * is never secret; a value is never read.
 *
 * @param store - the tier whose ids to clear
 * @returns the number of ids cleared
 * @throws Error when at least one `clear()` rejected
 */
export async function clearEveryStoredId(
  store: Pick<SecretStore, "listStoredIds" | "clear">,
): Promise<number> {
  const ids = await store.listStoredIds();
  const failed: SecretId[] = [];
  let firstFailure: unknown;
  let cleared = 0;
  for (const id of ids) {
    try {
      await store.clear(id);
      cleared += 1;
    } catch (error) {
      if (failed.length === 0) firstFailure = error;
      failed.push(id);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `[research-helper] clearAll() could not clear ${failed.length} of ` +
        `${ids.length} stored secret(s): ${failed.join(", ")}`,
      { cause: firstFailure },
    );
  }
  return cleared;
}

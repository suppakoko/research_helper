# 09 — Security, Privacy, and API Keys

**Document owner:** security & privacy design
**Scope:** threat model, credential storage, data egress, third-party policy compliance, supply chain
**Target platform:** Zotero 10.x, bootstrapped plugin, privileged JS context, fully client-side (no backend)
**Status:** design specification (pre-implementation)
**Last policy verification:** 2026-09-08

Related documents: `07-architecture-and-data-model.md` (storage layers, error hierarchy, logging), `03-llm-provider-integration.md` (per-provider request formats), `02-literature-database-apis.md` (endpoints), `08-ui-ux-spec.md` (screen layouts for the dialogs specified here).

---

## 0. Threat model in one page

**What the plugin holds that is worth stealing:** four LLM provider API keys, each of which is a bearer credential attached to a funded billing account. An attacker with an OpenAI or Anthropic key can spend the researcher's money, and — depending on the provider and account — read usage history. Optionally also an NCBI key and a Semantic Scholar key (low value, rate-limit tokens).

**What the plugin holds that is worth reading:** the user's library metadata, abstracts, possibly full text of PDFs, possibly the user's own notes and annotations, generated summaries, and search queries. For a researcher this can include unpublished work, manuscripts under review, grant material, and — in clinical fields — text that may contain participant information.

**Adversaries, in rough order of realism:**

| # | Adversary | Capability | What this document does about it |
|---|---|---|---|
| A1 | Another user account on a shared machine, or anyone with filesystem read access (lab workstation, cloud-synced home directory, unencrypted laptop backup) | Read files in the user's profile and data directory | §1 — keys go in the OS keychain, not plaintext `prefs.js` |
| A2 | Malware / infostealer running **as the user** | Everything the user can do | §1.5 — largely unmitigable; be honest about it |
| A3 | Another Zotero plugin | Full privileged access to the same process, including `Services.logins` and `Zotero.Prefs` | §1.5, §6.4 — unmitigable within the Zotero plugin model; state it plainly |
| A4 | A collaborator the user hands a Zotero data-directory backup to | Read the plugin database | §1.6 — no secrets in the DB; §3 — summaries and cached abstracts *are* in there |
| A5 | The LLM/TTS provider itself | Sees every prompt | §3, §4 — egress control, privacy modes, retention table |
| A6 | A network attacker | MITM | §6 — TLS everywhere, HTTPS `update_url`, no plaintext endpoints |
| A7 | A malicious or compromised plugin update | Arbitrary code as the user, with the keys | §6 — supply chain, `update_hash`, dependency pinning |
| A8 | The user themselves, accidentally | Pastes a key into a bug report; sends confidential text to a training-enabled endpoint | §2 (redaction), §3–§4 (privacy modes, warnings) |

**Explicit non-goals.** This plugin cannot defend against A2 or A3. Anything running as the user, in the user's Zotero process, defeats every measure here. The purpose of §1 is to raise the bar from *"a text file anyone can `cat`"* to *"requires code execution as the logged-in user"* — a real and worthwhile improvement, and no more than that. Claiming more would be dishonest, and the UI must not claim more (§1.7).

---

## 1. API key storage

### 1.1 What `Zotero.Prefs` actually does

`Zotero.Prefs` is a thin wrapper. From [`prefs.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prefs.js), the whole of the key-namespacing logic is:

```js
pref = global ? pref : ZOTERO_CONFIG.PREF_BRANCH + pref;
```

with `PREF_BRANCH` being `extensions.zotero.`. Storage delegates directly to `Services.prefs.getBranch("")` and `setBoolPref` / `setStringPref` / `setIntPref`. **Zotero applies no encryption, no obfuscation, and no access control.**

Gecko serializes user-set preferences to **`prefs.js` in the profile directory**, as plaintext lines:

```
# ILLUSTRATION ONLY — this is what the naive design would produce, and precisely
# why D5 forbids it. No pref named `apiKey.*` exists in this project's schema.
user_pref("extensions.zotero.research-helper.apiKey.openai", "sk-proj-REDACTED...");
```

Zotero staff confirm the location directly: *"It's set in prefs.js in the [Zotero profile directory]"* ([forums.zotero.org/discussion/117354](https://forums.zotero.org/discussion/117354/pres-js-location)).

Profile directory locations ([Zotero: Profile Directory](https://www.zotero.org/support/kb/profile_directory)):

| OS | Path |
|---|---|
| Windows | `C:\Users\<User>\AppData\Roaming\Zotero\Zotero\Profiles\<random>` |
| macOS | `~/Library/Application Support/Zotero/Profiles/<random>` |
| Linux | `~/.zotero/zotero/<random>` |

> **Correction to a widely-read source:** [windingwind's plugin development docs](https://windingwind.github.io/doc-for-zotero-plugin-dev/main/preferences.html) state that `prefs.js` is in the *data* directory. That is wrong; it is in the *profile* directory. The distinction matters here because users back up and share the **data** directory, not the profile directory — see §1.6.

**What this means.** A key in `Zotero.Prefs` is readable by:

- any process running as the user (A2, A3);
- **any other user on the machine whose account can read the user's `AppData\Roaming` / `~/Library`** — on Windows, another *administrator* trivially; on a misconfigured shared or lab machine, potentially anyone;
- anyone with the disk, if full-disk encryption is off;
- anyone with a filesystem backup of the profile;
- any support helper the user pastes a `prefs.js` dump to, which happens in Zotero forum threads.

Storing an LLM billing credential this way is the default that most existing Zotero AI plugins have taken, and it is the wrong default.

### 1.2 `nsILoginManager` / `Services.logins` — available, and Zotero uses it

**This is the central finding of this document, and it is not speculative: Zotero stores its own zotero.org API key in the Firefox login manager, encrypted with the OS keystore.**

From [`syncLocal.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/sync/syncLocal.js):

```js
_loginManagerHost: 'chrome://zotero',
_loginManagerRealm: 'Zotero Web API (encrypted)',
_loginManagerRealmLegacy: 'Zotero Web API',

_getAPIKeyLoginInfo: async function () {
    var logins = await Services.logins.searchLoginsAsync({
        origin: this._loginManagerHost,
        httpRealm: this._loginManagerRealm
    });
    return logins.length ? logins[0] : false;
}
```

and, for writing:

```js
var nsLoginInfo = new Components.Constructor(
    "@mozilla.org/login-manager/loginInfo;1",
    Components.interfaces.nsILoginInfo, "init");
var loginInfo = new nsLoginInfo(
    this._loginManagerHost, null, this._loginManagerRealm,
    'API Key', storedValue, '', ''
);
await Services.logins.addLoginAsync(loginInfo);
```

with `Services.logins.removeLoginAsync(...)` used to clear — **on Zotero's `main` branch only; see the correction below.**

Three conclusions follow:

1. **The login manager component is present in the Zotero build.** Zotero strips some Firefox components; this is not one of them. Corroborating evidence: [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) lists an `nsILoginManager::findLogins()` signature change among the Firefox 60→102 migration items, and Zotero staff routinely give users `Services.logins` snippets to paste into **Tools → Developer → Run JavaScript**, including a Zotero-7-specific async form ([forums.zotero.org/discussion/82574](https://forums.zotero.org/discussion/82574/proxy-requesting-username-and-password)):

   ```js
   let logins = (await Services.logins.getAllLogins())
       .filter(x => x.hostname.startsWith('moz-proxy://'));
   for (let loginInfo of logins) { Services.logins.removeLogin(loginInfo); }
   ```

   > **That snippet is stale — do not copy it.** Verified against Zotero's Gecko base
   > (`app/config.sh` pins **Firefox 153.1.0 ESR**) and `nsILoginManager.idl` on `esr153`:
   > `nsILoginManager` is now **fully asynchronous**. `addLogin`, `removeLogin`,
   > `modifyLogin`, `removeAllLogins`, `searchLogins` and `countLogins` have been
   > **removed** in favour of their `…Async` counterparts; `getAllLogins()` still exists
   > but returns a Promise (so the `await` above is right, the `removeLogin` on the next
   > line is not); and `findLogins()` is retained only as a throwing stub —
   > *"LoginManager.findLogins() was removed. Use searchLoginsAsync() instead."*
   > (`NS_ERROR_NOT_IMPLEMENTED`). The forum post remains valid evidence that
   > `Services.logins` is *reachable*, which is all it is cited for here.
   >
   > **This does not change the design.** §1.7's `setTier1` and Zotero's own `syncLocal.js`
   > already use only `searchLoginsAsync` / `addLoginAsync` / `removeLoginAsync` /
   > `modifyLoginAsync`. The rule for implementers is simply: **every `Services.logins`
   > call in this plugin is `await`ed and uses the `Async` name.** Note the corollary for
   > `uninstall()` (§2.5) — clearing secrets is asynchronous, so it must not be written as
   > a fire-and-forget synchronous loop.

   > **Correction, measured 2026-09-15 (`P0-T23`): the quote above describes Zotero's `main`
   > branch, not the shipping release.** `main` is already Zotero 11 on Firefox 153 ESR
   > (`docs/01` §12 gotcha 32). On **Zotero 10.0.2 / Gecko 140.15.0**, read at runtime from the
   > plugin sandbox: `removeLoginAsync` and `modifyLoginAsync` are **`undefined`**; the only
   > `…Async` members are `addLoginAsync` and `searchLoginsAsync`; and the synchronous
   > `removeLogin`, `modifyLogin`, `findLogins` (working, not a throwing stub), `countLogins`,
   > `searchLogins` and `addLogin` all still exist. The shipped `omni.ja`'s own `syncLocal.js`
   > calls `findLogins` / `removeLogin` / `modifyLogin` / `removeAllLogins`. **As written,
   > `setTier1` would throw a `TypeError` on 10.x the second time a key is saved for the same
   > id.** The rule is therefore not "use the `Async` name" but **feature-detect**: prefer the
   > `…Async` member when it exists (Gecko 153+) and fall back to the synchronous one, awaiting
   > either. `src/zotero/keychain.ts` does exactly that and reports which it chose.

2. **It is reachable from plugin code**, which runs in the same privileged context as the Run JavaScript console.

3. **The login manager alone is not the security boundary.** Firefox's login store (`logins.json` + `key4.db`) is encrypted with NSS 3DES-CBC, but **without a Primary Password the decryption key sits in `key4.db` next to the ciphertext** — copying both files to another profile is enough to read every password ([Mozilla Support: Use a Primary Password](https://support.mozilla.org/en-US/kb/use-primary-password-protect-stored-logins), [Mozilla Support forum](https://support.mozilla.org/en-US/questions/1210914)). Zotero does not expose a Primary Password UI. So the login manager on its own would only be obfuscation.

### 1.3 `Zotero.OSKeyStore` — the actual protection

This is why Zotero **double-wraps**. Before writing to the login manager, `syncLocal.js` encrypts the value; on read:

```js
if (Zotero.OSKeyStore.isEncrypted(login.password)) {
    return Zotero.OSKeyStore.decrypt(login.password);
}
```

[`osKeyStore.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/osKeyStore.js) wraps Gecko's `resource://gre/modules/OSKeyStore.sys.mjs`, which is backed by the platform credential store:

| Platform | Backing store |
|---|---|
| Windows | **DPAPI** (`CryptProtectData`) — key derived from the user's login credentials |
| macOS | **Keychain** |
| Linux | **libsecret** (GNOME Keyring / KWallet) |

Zotero's wrapper exposes `encrypt()`, `decrypt()`, `isEncrypted()`, `confirmUnencryptedFallback()`, an `available` getter, and `alertMigrateFailed()`, with an `oskv1:` prefix marking encrypted values (`_prefix: 'oskv1:'`; `isEncrypted()` is literally `value.startsWith(this._prefix)`). **`encrypt()` and `decrypt()` are both `async`** — they return Promises and must be awaited.

Zotero uses this in **two** places, not one: `syncLocal.js` for the zotero.org API key and `storage/webdav.js` for the user's WebDAV password (`await Zotero.OSKeyStore.encrypt(password)`), the latter mirroring the whole pattern including `isEncrypted` / `decrypt` / `alertMigrateFailed` / `confirmUnencryptedFallback`. Two independent credential types in Zotero's own code use this path; it is the house pattern, not a one-off.

This is the layer that actually raises the bar. Under DPAPI, ciphertext copied to another machine or another user account is useless without that user's Windows login secret. It does **not** stop code running as the same user in the same session (A2/A3) — DPAPI will happily decrypt for them — but it defeats A1 and A4 entirely.

> **Note for the implementer:** Zotero's wrapper does **not** re-export `ensureLoggedIn()` or `hasCredentials()` from the underlying Mozilla module (verified: zero occurrences in `osKeyStore.js`; the `hasCredentials()` that does exist belongs to `Zotero.Sync.Data.Local` and is unrelated). Its `available` getter is the closest thing to a capability check, but §1.7's startup probe should still be a real `encrypt`/`decrypt` round-trip rather than a flag read. The presence of `confirmUnencryptedFallback()` implies there is a path where the OS keystore is unavailable (a headless Linux box with no libsecret provider is the realistic case). §1.7 specifies what the plugin does in that situation. **Do not assume `encrypt()` always succeeds.**

### 1.4 Alternatives considered and rejected

**Windows Credential Manager / DPAPI directly via `js-ctypes`.** Technically reachable — `ctypes` is available in the privileged Gecko context, and `CryptProtectData`/`CryptUnprotectData` are documented Win32 entry points ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)). **Rejected**, decisively:

- It reimplements exactly what `Zotero.OSKeyStore` already does, with worse portability (Windows only, so macOS and Linux need separate code paths anyway).
- Hand-rolled FFI in a plugin is a memory-safety and crash risk in a process holding the user's entire library.
- Gecko's `ctypes` module moved from `ctypes.jsm` to `ctypes.sys.mjs` in the ESM migration, and Zotero 8 converted all JSMs to ESMs — so this is also a maintenance liability across Zotero's 6–10 week major cadence.
- Zotero's own maintainers chose `OSKeyStore`. Diverging from the host application's own credential pattern, in the host application's own process, has no upside.

> **Unverified:** we did not confirm whether `ctypes` is reachable in the Zotero 10 runtime specifically. It does not matter — the option is rejected on design grounds regardless.

**Encryption at rest with a user passphrase.** Derive a key with PBKDF2/Argon2 from a passphrase the user types, encrypt the API keys with AES-GCM, store the ciphertext in `Zotero.Prefs` or the plugin database. **Rejected as the primary mechanism**, for reasons that are about behaviour rather than cryptography:

- The plugin runs *background* jobs. A summarize job that resumes on startup, or a scheduled recommendation refresh, needs the key without a human present. Either the passphrase is cached in memory across the session — in which case A2/A3 read it out of the process just as easily as they read the keychain — or the plugin prompts mid-job, which is unusable.
- Users will pick weak passphrases, or reuse their Zotero password, or write it down.
- It adds a recovery problem: forget the passphrase, lose the keys, with no reset path.
- It provides *no additional protection against the adversaries that matter*. Against A1/A4 the OS keystore already suffices; against A2/A3 nothing suffices.

It remains worth offering as an **optional hardening layer** for users on machines where the OS keystore is unavailable (§1.7, tier 3) — there, a passphrase is strictly better than plaintext.

**A plugin-managed encryption key stored beside the ciphertext.** This is what "encrypting" with a hard-coded or derived-from-machine-ID key amounts to. **Rejected.** It is obfuscation presented as encryption, which is worse than plaintext because it misleads the user about their exposure.

**Not storing keys at all — prompt every session.** Rejected for the same background-job reason, but offered as an opt-in mode (§1.7, "session-only") for users handling sensitive material who accept the friction.

### 1.5 What none of this fixes

Stated plainly, because the UI must not overclaim:

- **Any other Zotero plugin can read the key.** Plugins share one privileged JavaScript context with no isolation. A malicious plugin can call `Services.logins.searchLoginsAsync()` and `Zotero.OSKeyStore.decrypt()` exactly as we do, or simply monkey-patch our HTTP client and read the `Authorization` header. There is no plugin-level sandbox in Zotero (§6.4). This is a property of the platform, not of our design.
- **Malware running as the user can read the key.** DPAPI decrypts for the logged-in user; that is its entire security model.
- **A user who runs a malicious plugin update of *this* plugin has lost.** See §6.
- **The key is in process memory whenever a request is made.** Memory dumps, core files, and debuggers see it.

The honest summary: **the OS keychain moves the attack from "read a file" to "execute code as this user."** That is the whole of the improvement, and it is worth having.

### 1.6 Why the storage split matters for backups

From `07-architecture-and-data-model.md` §8.4: `prefs.js` lives in the **profile** directory; the plugin's SQLite database lives in the **data** directory. Users routinely back up, sync, and hand around the data directory — it is what Zotero calls "your Zotero data."

Consequences that drive design rules:

- **A secret in the plugin database would travel with every backup and every shared library folder.** Rule: **no credential ever enters SQLite**, not even encrypted, not even transiently.
- Conversely, **cached abstracts, generated summaries, prompts, and job history *are* in the data directory** and therefore *do* travel in backups. That is acceptable — it is the user's own library content — but it must be disclosed (§3.6) and the cache must be clearable (§3.7).
- A user who moves machines by copying their data directory will find their **library intact but their API keys gone**. This is correct behaviour and must be explained in the UI, not treated as a bug.

### 1.7 Recommendation

**Three-tier storage, degrading explicitly and visibly.**

```ts
// src/zotero/keychain.ts

/** No "plaintext-prefs" member exists, deliberately — see tier 4 below. */
export type SecretBackend = "os-keychain" | "session-only" | "passphrase";

export interface SecretStore {
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

export type SecretId =
  | "llm.openrouter" | "llm.openai" | "llm.gemini" | "llm.anthropic"
  | "tts.gemini" | "source.ncbi" | "source.semanticscholar";

const LOGIN_ORIGIN = "chrome://research-helper";
const LOGIN_REALM  = "research_helper API Keys (encrypted)";
```

**Tier 1 — OS keychain (default, and the only tier that ships enabled).**
Mirror Zotero's own pattern exactly: `Zotero.OSKeyStore.encrypt(value)` → store the `oskv1:`-prefixed string as the `password` of an `nsILoginInfo` under origin `chrome://research-helper`, realm `research_helper API Keys (encrypted)`, with the `SecretId` as the username so one login entry exists per provider.

```ts
async function setTier1(id: SecretId, value: string): Promise<void> {
  const encrypted = await Zotero.OSKeyStore.encrypt(value);   // may throw
  const nsLoginInfo = new Components.Constructor(
    "@mozilla.org/login-manager/loginInfo;1",
    Components.interfaces.nsILoginInfo, "init");
  const existing = await Services.logins.searchLoginsAsync({
    origin: LOGIN_ORIGIN, httpRealm: LOGIN_REALM,
  });
  for (const login of existing) {
    // removeLoginAsync exists only on Gecko 153+; Zotero 10.x (Gecko 140) has only the
    // synchronous removeLogin (measured, P0-T23). Feature-detect, await either.
    if (login.username !== id) continue;
    if (typeof Services.logins.removeLoginAsync === "function") {
      await Services.logins.removeLoginAsync(login);
    } else {
      Services.logins.removeLogin(login);
    }
  }
  await Services.logins.addLoginAsync(
    new nsLoginInfo(LOGIN_ORIGIN, null, LOGIN_REALM, id, encrypted, "", ""));
}
```

At startup the plugin probes the backend by round-tripping a throwaway value through `encrypt`/`decrypt`. Success → tier 1. Failure → escalate to the tier-2/3 decision **with a dialog**, never silently.

**Tier 2 — session-only (offered on probe failure, and available as an opt-in for sensitive users).** Keys live in a module-scoped variable, cleared on shutdown. Background jobs that need a key while it is absent transition to `paused` with reason `credential-required` rather than failing. Honest and safe; the cost is re-entering keys each session and losing unattended resume.

**Tier 3 — passphrase-encrypted, stored in the plugin's own file (NOT prefs, NOT the database — a file under the data directory is still wrong for a secret, so: a file in the *profile* directory, `research-helper/secrets.enc`).** AES-GCM with a key from PBKDF2-HMAC-SHA256 at ≥600,000 iterations, or Argon2id if a vetted implementation is available. Passphrase held in memory for the session after one prompt. Offered only when tier 1 is unavailable and the user wants unattended operation.

**Tier 4 — plaintext `Zotero.Prefs`.** **Not implemented.** There is no code path that writes an API key to a preference. If tiers 1–3 all fail, the plugin operates without LLM features and says so. This is a deliberate refusal: implementing it as a fallback guarantees it becomes the common case.

**What *does* go in `Zotero.Prefs`:** presence booleans (`research-helper.openai.keyPresent`), last-validation timestamps and results, the selected backend, and every non-secret setting. The pref schema in `src/prefs/schema.ts` carries a `secret: true` flag, and there is a unit test asserting that no `secret: true` entry has a `Zotero.Prefs` writer.

### 1.8 Residual risk statement

> **Residual risk (to be reproduced verbatim in the preferences pane, not paraphrased):**
> Your API keys are encrypted using your operating system's credential store (Windows Data Protection API, macOS Keychain, or your Linux keyring) and stored in Zotero's login manager. This protects them from being read out of a file backup, from another user account on this computer, and from anyone who obtains a copy of your Zotero folder.
>
> **It does not protect them from software running under your own user account.** Any program you run — including any other Zotero plugin — can decrypt them, because your operating system will decrypt them for anything running as you. Zotero does not isolate plugins from each other.
>
> Treat these keys as you would a password saved in your browser. Set spending limits with your provider, and rotate any key you think may have been exposed.

### 1.9 How the UI communicates this

Requirements for `08-ui-ux-spec.md`:

1. **The key field is never a plain text input.** Masked, with a deliberate reveal (hold-to-show, not a sticky toggle), and the value is never selected-on-focus in a way that invites accidental copy into a screenshot.
2. **Once stored, the key is never re-displayed** — the field shows `sk-…••••••••1a2b` (first 3 and last 4 characters only), matching how the providers' own dashboards do it. `SecretStore.get()` is never called to populate a UI field.
3. **A storage-backend badge** sits next to the key fields: *"Protected by Windows Credential Manager"* / *"macOS Keychain"* / *"System keyring"* — or, in degraded tiers, a warning-coloured *"Not saved between sessions"* / *"Protected by your passphrase"*.
4. **The residual-risk text of §1.8 is visible, not behind a "Learn more" link.** A collapsed disclosure is acceptable for the second paragraph only if the first is always shown.
5. **A per-provider status row**: key present / absent, last validated when and with what result, and a "Test" button (§2.3). **One for each of the six credentials**, not only the LLM providers — the NCBI and Semantic Scholar fields get the same status element, backend badge and "Test" button, because §2.3 explains that those two are precisely the keys whose failure is otherwise invisible.
6. **A "Remove all stored keys" button** that clears every `SecretId` and reports how many were removed.
7. **No key is ever placed on the clipboard by the plugin**, and no "copy key" affordance exists.
8. **On a fresh install where a data-directory restore has brought the library but not the keys**, the empty-key state explains *why*: "API keys are stored in this computer's credential store and do not travel with your Zotero data folder."

---

## 2. Key hygiene

### 2.1 Never log a key

Enforced at three levels, because a call-site discipline rule alone will eventually fail.

**Level 1 — types.** The secret value is carried in a wrapper that has no useful string conversion:

```ts
// src/prefs/secrets.ts

/** A credential. Deliberately awkward to stringify. */
export class Secret {
  readonly #value: string;
  constructor(value: string) { this.#value = value; }
  /** The ONLY way to read it. Grep for this call site in review. */
  expose(): string { return this.#value; }
  toString(): string { return "[Secret]"; }
  toJSON(): string { return "[Secret]"; }
  get [Symbol.toStringTag](): string { return "Secret"; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return "[Secret]"; }
}
```

Template-interpolating a `Secret` yields `[Secret]`. `JSON.stringify` on any object containing one yields `"[Secret]"`. The only leak path is an explicit `.expose()`, which is greppable and reviewable — there should be exactly one call site per provider, inside the header-building function.

**Level 2 — the logger redacts unconditionally.** `src/core/logger.ts` runs `redact()` over every message and every context value before emission, regardless of level — and regardless of `logRequestBodies`. **No preference relaxes this.** `logRequestBodies` (`07-architecture-and-data-model.md` §8.5) widens what *content* may be logged — abstracts, prompts — and never what *credentials* may be; the same is true of raising `logLevel` to `debug` from the pane's "Verbose debug logging" checkbox. There is no diagnostic setting, and must never be one, whose effect is to put a key in the log.

```ts
const KEYISH_FIELD = /api[-_]?key|token|secret|authoriz|password|bearer|credential/i;

const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,          // Anthropic
  /\bsk-or-v1-[A-Za-z0-9]{32,}/g,          // OpenRouter
  /\bsk-proj-[A-Za-z0-9_-]{20,}/g,         // OpenAI project keys
  /\bsk-[A-Za-z0-9]{32,}/g,                // OpenAI legacy
  /\bAIza[A-Za-z0-9_-]{35}/g,              // Google API keys
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, // any bearer token
  /\b[A-Za-z0-9_-]{40,}\b/g,               // long opaque run — last-resort net
];

export function redact(input: string): string {
  let out = input;
  for (const re of KEY_PATTERNS) out = out.replace(re, m => `[redacted:${m.length}]`);
  return out;
}
```

The final catch-all pattern will occasionally redact a legitimate long token (a base64 chunk, a hash). That is the correct trade: a false-positive redaction costs a debugging inconvenience; a false negative publishes a billing credential to a GitHub issue.

**Level 3 — headers are structurally excluded.** The HTTP client logs a *derived* header summary, never the header object:

```ts
function loggableHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = KEYISH_FIELD.test(k) ? `[redacted:${v.length}]` : redact(v);
  }
  return out;
}
```

`Zotero.HTTP.request` has its own `debug: true` option that logs response text, and `logBodyLength` (default 1024). **The plugin must never pass `debug: true`** — request/response bodies for LLM calls contain the user's paper content, and error bodies from some providers echo request metadata. A lint rule forbids it.

**URLs.** Google's Gemini API accepts the key as a `key` query parameter as well as an `x-goog-api-key` header. **Always use the header.** Query-string keys end up in proxy logs, in `Zotero.HTTP` error messages, in `Zotero.getErrors()` output, and in bug reports. `redactUrl()` strips `key`, `api_key`, `apikey`, `token`, and `access_token` parameters as a backstop, but the primary rule is to never put a credential in a URL.

### 2.2 Redaction in the debug bundle

Per `07-architecture-and-data-model.md` §10.4, the debug bundle is assembled from the pref schema mechanically: any entry flagged `secret: true` is emitted as `"[present]"` or `"[absent]"`, never its value. Since §1.7 forbids keys in prefs entirely, the bundle cannot contain one even if the flag were wrong — defence in depth.

The bundle's confirmation dialog must state exactly what is included, offer a preview before saving, and state plainly that **no API keys and no paper content are included**. The bundle is written to a user-chosen file; **nothing is uploaded anywhere by the plugin**.

The plugin's own 5000-line ring buffer is redacted **at write time**, not at export time, so a key never sits in memory as log text.

### 2.3 Per-provider key validation ("Test key")

**Six credentials are validated here, not four.** The `SecretId` set in §1.7 has one entry per credential the user can supply, and `07-architecture-and-data-model.md` §8.5 carries a `keyPresent` / `lastValidatedAt` / `lastValidationResult` trio for each of the six IDs `openrouter`, `openai`, `gemini`, `anthropic`, `ncbi` and `semanticscholar`. Every one of them needs a test call, because a *wrong* key is not the same failure as an *absent* one and only two of the six announce themselves:

- The four LLM providers reject a bad key with an HTTP status, so the failure is loud.
- **NCBI does not fail at all.** A wrong or expired `api_key` costs the user the keyed budget and nothing else: 10 requests/second becomes the unkeyed 3 (`02-literature-database-apis.md` §3.1). Searches keep working, slowly, forever, with no error anywhere.
- **Semantic Scholar is worse.** The keyed limit is 1 req/s; the unauthenticated pool is shared across every anonymous caller on the internet and `02-literature-database-apis.md` §6.4 measured it returning HTTP 429 on three consecutive attempts during business hours. A key that is not being honoured therefore does not slow **feature 2 (find related)** and **feature 6 (recommend)** down — it makes them unreliable, and the user has no way to tell that from the API being down.

Every `LLMProvider` implements `validateCredentials()` (`07-architecture-and-data-model.md` §4.3). Rules:

- **Use the cheapest authenticated endpoint**, ideally a model-list call, never a completion. Nobody should be billed for pressing "Test".
- **Never send user content.** If a provider has no list endpoint and a minimal completion is unavoidable, send a fixed non-sensitive token like `"ping"` with `max_tokens: 1`.
- **Report specifically**: distinguish `401` (key rejected), `403` (key valid but lacks permission / region blocked), `429` (key valid, rate-limited — this counts as a *pass*), network failure (inconclusive — do not mark the key bad), and success.
- **Store only the outcome**, timestamp, and — where the provider returns it — the account/organization label and available model list, so the model picker can populate immediately.
- **Never store or display any part of the key** in the validation result.

Suggested endpoints (confirm LLM details in `03-llm-provider-integration.md`; the two source rows are derived from `02-literature-database-apis.md` and are cited inline):

| Credential | Test call |
|---|---|
| OpenAI | `GET /v1/models` |
| Anthropic | `GET /v1/models` |
| Google Gemini | `GET /v1beta/models` with `x-goog-api-key` |
| OpenRouter | `GET /api/v1/key` (returns key metadata and limits) or `GET /api/v1/models` |
| NCBI (`source.ncbi`) | `GET esummary.fcgi?db=pubmed&id=37258680&retmode=json&api_key=<key>` plus `tool=` / `email=` — the worked example in `02-literature-database-apis.md` §3.5 with the key appended. **The verdict is read from the response headers, not the body:** `02-…` §3.1 records `X-Ratelimit-Limit` as live-verified, and `02-…` §3.1's auth table gives the two values it can take — `3` unkeyed, `10` keyed. One fixed public PMID, no user content, no abstract, and `02-…` §3.5 names `esummary` as the cheap existence/metadata check. |
| Semantic Scholar (`source.semanticscholar`) | `GET /graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=paperId` with the `x-api-key: <key>` header (`02-literature-database-apis.md` §6.4). One fixed public paper, from `02-…` §6.7's worked example; `fields=paperId` is the smallest response the API will return (`02-…` §6.5: `paperId` is always returned). Uses the `/graph/v1` base URL of `02-…` §6.1, not `/paper/search`, so the call does not compete with search traffic. |

**Outcome → `<provider>.lastValidationResult`.** The four LLM providers follow the status rules in the third bullet above. The two source credentials do not return a clean 401 on a bad key in anything `02-literature-database-apis.md` documents, so they get their own mapping, and it is deliberately cautious:

| Credential | Observed | → enum | Why |
|---|---|---|---|
| NCBI | HTTP 200 and `X-Ratelimit-Limit: 10` | `ok` | `02-…` §3.1: the keyed budget. The key was accepted and is being honoured. |
| NCBI | HTTP 200 and `X-Ratelimit-Limit: 3` | `inconclusive` | `02-…` §3.1's unkeyed budget. This is the *no key* reading, and nothing in doc 02 says a rejected key does not also produce it — see the callout below. Never `rejected`. |
| NCBI | HTTP 200 with no `X-Ratelimit-Limit` header | `inconclusive` | The header is verified present today but is not a documented contract; its absence proves nothing about the key. |
| NCBI | HTTP 429 | `inconclusive` | `02-…` §3.8: rate exceeded. The third bullet's "429 counts as a pass" rule is about a *per-key* quota; NCBI's limit is **per IP** (`02-…` §3.1), so a 429 here says the machine is busy and says nothing about the key. |
| NCBI | HTTP 500 / 502, timeout, or any network failure | `inconclusive` | `02-…` §3.8: server overload. Not a credential fact. |
| NCBI | Any other status, or HTTP 200 with `esearchresult.ERROR` in the body | `inconclusive` | `02-…` §3.8 requires checking the body on a 200, but attributes `ERROR` to a bad *query*, not a bad key. Do not read a query error as a credential verdict. |
| Semantic Scholar | HTTP 200 with a `paperId` | `ok` | `02-…` §6.10: 200 is the success case. The key was accepted. |
| Semantic Scholar | HTTP 429 | `inconclusive` | `02-…` §6.4: **429 is exactly the symptom of the key not being honoured** — it is what the anonymous pool returns — and it is also what a keyed caller sees when it exceeds 1 req/s. The two are indistinguishable from one response, so this is the one place where this section's general "429 counts as a pass" rule must **not** be applied. Retry once after a delay before recording; if it 429s again, record `inconclusive` and say so in the UI wording. |
| Semantic Scholar | HTTP 401 | `rejected` | The general rule in the third bullet. `02-…` §6.10's status table does not list 401 — see the callout below. |
| Semantic Scholar | HTTP 403 | `forbidden` | The general rule in the third bullet. `02-…` §6.10's status table does not list 403 — see the callout below. |
| Semantic Scholar | HTTP 400 / 404, or any network failure | `inconclusive` | `02-…` §6.10 attributes 400 to bad `fields` and 404 to a missing paper — both are bugs in *our* test call, not credential facts. |

> **Unverified:** `02-literature-database-apis.md` **does not establish what either source API returns for an invalid key.** Its §3.8 NCBI error table covers rate limits, bad queries, unknown PMIDs and server overload, and says nothing about a rejected `api_key`; its §6.10 Semantic Scholar status table lists 200, 400, 404 and 429 and lists neither 401 nor 403. Both mappings above therefore resolve **every** non-success outcome to `inconclusive` rather than guess at `rejected`, and the two Semantic Scholar rows that do name `rejected` and `forbidden` are this section's *general* rule applied speculatively to statuses doc 02 never records that API returning. A wrongly-red key status is worse than an honest "could not tell": it invites the user to delete a key that works.
>
> One entry above is an inference even on the success side. Doc 02 §3.1 records `X-Ratelimit-Limit` as live-verified reading `3` on an **unkeyed** request, and separately documents the keyed rate as 10 req/s — but no observation of that header reading `10` on a **keyed** request appears anywhere in the corpus. The `ok` row for NCBI assumes the header tracks the documented rate, and the whole NCBI mapping rests on that one assumption.
>
> Settling all of this costs three requests: one keyed, one unkeyed, one with a deliberately corrupted key, against each API. Both are free. It belongs in the Phase 0 spike report (`docs/spikes/phase-0.md`; `11-implementation-roadmap.md` §4). When it is done, replace the rows this callout covers, and delete the callout.

> **Unverified:** the exact test endpoints for the four LLM providers are the conventional ones but were not re-verified against current provider documentation for this document. Confirm each in `03-llm-provider-integration.md` before implementing.

**Where the two source checks live.** `validateCredentials()` is a member of `LLMProvider` (`07-architecture-and-data-model.md` §4.3); `LiteratureSource` (§4.2) declares no equivalent, so the NCBI and Semantic Scholar checks are implemented in their adapters under `src/sources/` and invoked directly by `preferences.js` behind the "Test" buttons in `08-ui-ux-spec.md` §7.3. Whether `LiteratureSource` should grow a `validateCredentials?()` member so both paths share one shape is an open interface question for the owner (§8); it does not change anything in this section.

### 2.4 What to do on a 401

A 401 mid-job is not a transient error and must not be retried.

1. **Do not retry.** `AuthenticationError` is `retryable: false` (`07-architecture-and-data-model.md` §10.1). Retrying a rejected key wastes time and can trip provider abuse heuristics.
2. **Fail the whole job for that provider immediately**, rather than letting 200 items each produce their own 401. The job transitions to `paused` with reason `credential-required` — *paused*, not *failed*, so that fixing the key and resuming does not lose the work already done.
3. **Mark the key invalid in prefs**: set `<provider>.lastValidationResult = "rejected"` and stamp `<provider>.lastValidatedAt` with the current ISO 8601 time. Both are declared in `07-architecture-and-data-model.md` §8.5 (key, type, default and the full value list `ok | rejected | forbidden | inconclusive`); this section owns the semantics — which outcome §2.3's status mapping produces — and defers to §8.5 for the schema. The prefs pane shows a red state on that provider.
4. **Do not delete the stored key.** The user may have hit a temporary provider-side issue, or revoked and re-created a key elsewhere; silently discarding their credential is hostile. Offer "Remove key" as a button.
5. **Surface one actionable notification**, not one per item: *"Your OpenAI API key was rejected. The summarize job is paused. Open settings to update it."*
6. **Offer provider fallback only if the user configured one.** Never silently reroute a job to a different provider — that changes the data-egress destination, which is a privacy decision the user must make (§3).
7. **Log the failure without the key**, including the provider, the model, the HTTP status, and the provider's error `type`/`code` field if present (these are safe; the message body may not be, so redact it).

### 2.5 Key rotation

- **Replacing a key is a first-class action**, not delete-then-add. `SecretStore.set()` overwrites atomically (remove-then-add inside one operation), and the validation state resets to "not yet tested".
- **In-flight jobs pick up the new key on their next request** because `expose()` is called per-request, never cached at job start. This is worth stating explicitly: do not hoist the key into a job-scoped variable, or a rotation mid-job will keep using the dead credential.
- **Rotation prompt.** If a key has been stored for more than 365 days, the prefs pane shows a non-blocking suggestion to rotate. No nagging, no blocking, no automatic action.
- **On uninstall**, `bootstrap.js`'s `uninstall()` clears every `SecretId` from the login manager and every plugin pref. A plugin that leaves credentials behind after removal is a bug. (`shutdown()` must *not* do this — it runs on every app close.)
- **Provider-side guidance in the UI**: link to each provider's key-management page, and recommend creating a **dedicated key for this plugin** with a spending limit, so that revoking it does not disturb the user's other tools. This is the single most effective mitigation available to the user, and the UI should say so.

---

## 3. Data egress and privacy

### 3.1 The core question

Every feature must answer: *what bytes of the user's material leave this machine, to whom, and what may they do with them?* This section is the authoritative answer. Any change to it is a privacy-affecting change and needs a release-note entry.

### 3.2 Per-feature egress table

| Feature | Destination | What is sent | What is **never** sent |
|---|---|---|---|
| **1. Keyword search → import** | PubMed/NCBI, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv/medRxiv | The user's **search query terms**, date range, and pagination cursors. Plus mandatory identification: `tool` + developer `email` (NCBI), `mailto` (Crossref polite pool). | Nothing from the user's library. No item content, no notes, no identity. |
| **2. Find related** | Same literature APIs | The seed paper's **public identifiers** (DOI/PMID/arXiv ID), or — only if no identifier exists — its **title**. | The user's own abstract edits, notes, tags, annotations, or the rest of their library. |
| **3a. Summarize** | The selected **LLM provider only** | Per paper: title, authors, venue, year, **abstract**. Plus, unless the collection's privacy mode forbids it, **extracted full text** from the PDF attachment — decision **D7** ships `summary.fullTextMode: auto`, so full text is used whenever it exists and materially exceeds the abstract, gated by the pre-run cost confirmation. Plus the prompt template. | User notes, annotations, tags, collection names, other papers' content, file paths, anything about the user. |
| **3b. Trend report** | Same LLM provider | The **generated summaries** (not the source papers again), titles, years, venues, and cluster statistics. | Raw full text; user notes; anything not already sent in 3a. |
| **4. LLM access** | OpenRouter / OpenAI / Gemini / Anthropic | Only what 3a/3b/5/6 specify, plus the API key as an auth header. | Telemetry. The plugin sends **no** analytics of any kind, to anyone. |
| **5. Audio report** | **Google Gemini TTS** | The **report script** — a flattened, speakable version of the trend report text. | Everything else. Note this is a *second* provider seeing report content even if summarization used a different one — see §3.4. |
| **6. Recommend** | LLM provider (for query generation and rationales) + literature APIs (for the searches) | To the LLM: the collection **profile** — top terms, subjects, venues, years, and optionally a sample of titles. To the literature APIs: the **generated queries**. | Full abstracts of the whole collection, unless the user runs recommendation in a mode that builds the profile with an LLM over abstracts — which must be a distinct, labelled choice. |
| **Anything else** | — | — | **The plugin has no telemetry, no crash reporting, no update ping beyond fetching `update.json`, and no analytics endpoint.** Nothing about the user's usage reaches the plugin's authors. |

Two design rules follow:

- **Collection names, tag names, and folder structure are user-authored metadata and are not sent** unless the user explicitly asks for them to be (e.g. "use my collection name as context"). They frequently contain project codenames, grant numbers, and collaborator names.
- **Zotero notes and PDF annotations are never sent by default**, in any feature. They are the user's own unpublished thinking. Sending them requires a separate, explicitly labelled opt-in (§3.5), and is off in every privacy mode except the most permissive.

### 3.3 Per-provider data-usage and retention

Verified 2026-09-08 against each provider's own documentation.

| Provider / tier | Trains on API data by default? | Retention of inputs & outputs | ZDR available? |
|---|---|---|---|
| **OpenAI API** | **No** | Up to **30 days** abuse-monitoring logs; some endpoints (Assistants, Threads, Conversations, Vector Stores) retain application state **until deleted** | **Yes** — prior approval by OpenAI + additional terms; via sales |
| **Anthropic API** (commercial) | **No** | **30 days** default; **2 years** if flagged as a Usage Policy violation; **7 years** for trust-&-safety classification scores; feedback **5 years** | **Yes** — negotiated agreement, no self-serve toggle |
| **Google Gemini API — PAID** | **No** | **55 days** for Prohibited Use Policy detection; configurable to 7/14/28/55 days in AI Studio | **Yes** — per-project approval, **paid tier only** |
| **Google Gemini API — FREE / AI Studio** | **YES** | 55 days logging **plus** use for product improvement; **human reviewers read and annotate** | **No** |
| **Gemini TTS** | **Same as the Gemini tier above** | Same | Same |
| **Vertex AI (Gemini via GCP)** | No | 30 days abuse monitoring; cached content ~24 h | Yes — abuse-monitoring exception form |
| **OpenRouter (the router itself)** | **No** | Does **not** store inputs by default (metadata only); opt-in logging retained **≥3 months** | **Yes** — `zdr` flag + account setting |
| **OpenRouter upstream providers** | **VARIES — many free endpoints train on, or publish, prompts** | Varies per provider | Via ZDR / `data_collection` filtering |

**OpenAI.** [developers.openai.com/api/docs/guides/your-data](https://developers.openai.com/api/docs/guides/your-data) states that *"data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)"*, in effect since 1 March 2023, and that abuse-monitoring logs are *"retained for up to 30 days, unless longer retention is required by law."* Zero Data Retention exists but is gated: *"Currently, these controls are subject to prior approval by OpenAI and acceptance of additional requirements."* ZDR-eligible endpoints include `/v1/embeddings` and `/v1/audio/*` outright, and `/v1/chat/completions` and `/v1/responses` as *"Yes, with limitations"* — the two endpoints the plugin actually uses are therefore conditionally eligible, not unconditionally. Ineligible: Assistants, Threads, Conversations, Vector Stores, and `/v1/chatkit/threads`.

> **Partially verified:** OpenAI's August 2026 [Private Safety Processing announcement](https://openai.com/index/offering-zero-data-retention-for-frontier-models/) describes transmitting only a safety signal (type and severity) rather than content, preserving ZDR while retaining abuse detection, with a persisting CSAM exception under which flagged images are retained for manual review and legal reporting. That page returned HTTP 403 to direct fetching; the content was confirmed only via search excerpts of the official page. The core ZDR and 30-day facts above come from the directly-fetched developer documentation and are solid.

**Anthropic.** [privacy.claude.com](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training): *"By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models."* This is contractually binding — the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) state *"Anthropic may not train models on Customer Content from Services"*, with the customer retaining rights to inputs and owning outputs. Retention: *"we automatically delete inputs and outputs on our backend within 30 days of receipt or generation"*, extending to *"up to 2 years"* for Usage Policy violations and *"up to 7 years"* for trust-and-safety classification scores ([retention article](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data)). Submitting explicit thumbs-up/down feedback is the one carve-out — so **the plugin must not send feedback signals to Anthropic**, and should have no such feature.

**Important clarification, because it is widely misreported:** Anthropic's August 2025 consumer terms change — which introduced opt-in training on Claude.ai chats with 5-year retention — **does not apply to the API.** Anthropic states the updates *"do not apply to services under our Commercial Terms, including Claude for Work, Claude for Government, Claude for Education, or API use, including via third parties such as Amazon Bedrock and Google Cloud's Vertex AI"* ([Updates to our consumer terms](https://www.anthropic.com/news/updates-to-our-consumer-terms)). A user who has read headlines about that change may believe their API traffic is being trained on; the UI should not repeat that error.

**Google Gemini — the paid/unpaid split is the sharpest edge in this entire document.** From [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms):

> *"When you use Unpaid Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services."*

and

> *"To help with quality and improve our products, human reviewers may read, annotate, and process your API input and output."*

with the explicit instruction: *"Do not submit sensitive, confidential, or personal information to the Unpaid Services."*

For paid: *"When you use Paid Services… Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products"*, and *"For Paid Services, Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy."*

**The trigger for "paid" is the detail everyone misses:** *"Your access to Gemini API is a 'Paid Service' only when accessing the API through a Cloud Project associated with an active billing account."* Having a billing account on the Google account is **not** sufficient — the *project* the API key belongs to must be billing-linked.

Retention is **55 days** by default, configurable to 7/14/28/55 in AI Studio ([logs policy](https://ai.google.dev/gemini-api/docs/logs-policy)), with *"Authorized Google employees may assess the flagged content"* under [abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies). [ZDR](https://ai.google.dev/gemini-api/docs/zdr) is **Paid Services only**, per-project approval, and is broken by several features the plugin must therefore avoid on ZDR projects: Context Caching (`cached_content`), un-deleted File API uploads, the Interactions API unless `store` is explicitly set to `false`, and Grounding with Google Search or Maps (which **cannot** achieve ZDR — 30-day retention with no disable). The `store: false` requirement matters directly: Gemini TTS (Feature 5) is served over `/v1beta/interactions`.

**This has a direct product consequence.** The plugin's audio report feature (Feature 5) uses Gemini TTS, and TTS uses the same API key, same endpoint, and same terms. **A user on the Gemini free tier who generates an audio report has sent their trend report to Google for product improvement, with human reviewers able to read it.** The UI must warn about this specifically (§3.6).

> **Unverified:** the Vertex AI figures (30-day abuse-monitoring retention, ~24-hour cache, exception-form ZDR) could not be fetched directly — `cloud.google.com` was blocked by an intercepting proxy on the research network. They come from search excerpts of the official [data governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance), [abuse monitoring](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring), and [ZDR](https://cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) pages. Re-verify before documenting Vertex support. Vertex is not in the v1 scope.

**OpenRouter — where the routing matters more than the router.** OpenRouter's own posture is good: its [privacy policy](https://openrouter.ai/privacy) states *"OpenRouter does not use your Inputs or Outputs for model training"*, and its [terms](https://openrouter.ai/terms) §6.5 state *"Unless explicitly opted in to prompt logging, we do not store your Inputs after categorizing them and do not associate the categorized Inputs with any specific user or organizational accounts."* §6.1 adds *"Where possible, OpenRouter has opted out of model training with the Models it uses."*

But the [privacy-and-logging docs](https://openrouter.ai/docs/features/privacy-and-logging) are equally explicit that this says nothing about the destination:

> *"Each provider on OpenRouter has its own data handling policies. We reflect those policies in structured data on each AI endpoint that we offer."*

and, crucially:

> *"This setting has no bearing on OpenRouter's own policies and what we do with your prompts."*

**Default routing is permissive.** Per [provider routing](https://openrouter.ai/docs/features/provider-routing), `provider.data_collection` defaults to `"allow"`, which permits providers that *"store user data non-transiently and may train on it"*. Setting it to `"deny"` routes *"only to providers which do not collect user data."* Separately, `provider.zdr: true` means *"the request will only be routed to endpoints that have a Zero Data Retention policy"*, and combines with account-level ZDR settings as an OR — if any is enabled, ZDR is enforced. `provider.only` / `provider.ignore` give explicit allow/deny lists by provider slug, with account-wide settings acting as a ceiling on per-request ones.

**Two independent logging concepts are frequently confused and the UI must not conflate them:**

- **Input & Output Logging** ([docs](https://openrouter.ai/docs/guides/features/input-output-logging)) is *private* debugging storage for the account holder. *"OpenRouter does not access or use your prompt and response data logged with this feature for model training, analytics, or any other purpose."* Retained *"for a minimum of 3 months, and may be retained beyond 3 months at OpenRouter's discretion unless you request deletion."*
- **"OpenRouter Use of Inputs/Outputs"** — the account setting that grants OpenRouter product-improvement use of prompts and completions in exchange for a **1% discount on all model usage** ([data-collection docs](https://openrouter.ai/docs/guides/privacy/data-collection)). This is a different setting entirely, and the UI must not call it "logging". (An earlier draft of this document named it "Data Discount Logging"; that is not OpenRouter's term.)

Uploaded files are *"retained by us until you delete them or close your account"*; images, audio, and video are not persisted beyond routing except for abuse, security, billing, or legal purposes.

> **Partially verified:** the exact five-item toggle list in OpenRouter's account privacy settings (paid endpoints that may train; free endpoints that may train; free endpoints that may publish prompts; 1% data-sharing discount; ZDR-endpoints-only) comes from search excerpts — OpenRouter's Zendesk help article returned HTTP 403 to direct fetching. The *concepts* — separate paid and free training settings, and ZDR filtering — are confirmed in the directly-fetched developer docs, as is the label of the discount toggle, **"OpenRouter Use of Inputs/Outputs"** ([data-collection docs](https://openrouter.ai/docs/guides/privacy/data-collection)). Verify the remaining labels before writing UI copy that names them.

**A practical trap:** turning the permissive settings off breaks free models. Most free endpoints train on, or may publish, the prompts they receive, so with those data permissions off OpenRouter has nothing left to route a free request to, and the request 404s.

> **Unverified:** the exact error string `404: No endpoints available matching your guardrail restrictions and data policy` and the sentence quoted above come from an OpenRouter help-centre article that returns HTTP 403 to direct fetching; they were seen only in search excerpts, and `openrouter.ai/docs/guides/privacy/free-models` is a 404. The *behaviour* (guardrails can leave a free model unroutable) follows from the directly-fetched provider-routing docs. Confirm the literal string before matching on it in code — §3.4 rule 2 must key off the status plus the error body's structured fields, not a substring match on this sentence.

### 3.4 What the plugin does about all this

**Rule 1 — the plugin sets restrictive routing by default, not permissive.** Every OpenRouter request carries:

```jsonc
{
  "provider": {
    "data_collection": "deny",   // never route to providers that may train on it
    "zdr": true                  // only ZDR endpoints, when privacy mode is strict
  }
}
```

`data_collection: "deny"` is the default in **every** privacy mode. `zdr: true` is added in strict mode. This inverts OpenRouter's own default, deliberately: a literature tool should not silently ship a researcher's unpublished abstract to whichever free endpoint is cheapest.

**Rule 2 — a 404 from guardrail restrictions gets a real explanation.** The `OpenRouterProvider` maps that specific error to a message naming the cause and the two ways out (choose a different model, or relax the setting in preferences with a stated consequence), never a bare "request failed".

**Rule 3 — model choice surfaces the policy.** `ModelInfo.dataPolicy` (`07-architecture-and-data-model.md` §4.3) carries `trainsOnInputByDefault`, `retention`, `upstreamProvider`, and `policyUrl` for every model in the picker. Models with `"unknown"` policy are shown with a warning icon and are **refused outright in strict privacy mode**. We do not guess a policy in order to fill a field.

**Rule 4 — Gemini tier detection.** Before the first Gemini call in a session, and whenever the key changes, the plugin attempts to determine whether the key's project is billing-linked. If it cannot determine this, it **assumes free tier** and shows the free-tier warning. Assuming paid would be assuming the safer-sounding answer without evidence.

> **Unverified:** whether the Gemini API exposes a reliable programmatic signal for "this project has an active billing account". If no such signal exists, the plugin must ask the user to confirm their tier, defaulting the answer to "free/unsure", and must re-show the warning whenever the answer is not an affirmative "paid".

**Rule 5 — a second provider is a second disclosure.** Because audio uses Gemini even when summarization used Anthropic or OpenAI, the audio feature shows its own destination confirmation the first time it is used with a given key, rather than inheriting consent from the summarization step.

### 3.5 Privacy modes

Three modes, selectable globally and overridable per collection. The global default is the `privacy.mode` preference (key, type, default and value set: `07-architecture-and-data-model.md` §8.5), set from the Privacy groupbox in `08-ui-ux-spec.md` §7.3. The per-collection override is **not** a preference — it lives in the `collection_settings` table (`07-architecture-and-data-model.md` §8.3), because per-collection settings are unbounded in number — and it **always wins over the global setting when it is more restrictive**; a per-collection setting can never loosen a stricter global one.

| | **Strict** | **Balanced** (default) | **Full** |
|---|---|---|---|
| Metadata (title, authors, venue, year) sent | Yes | Yes | Yes |
| **Abstract** sent | Yes | Yes | Yes |
| **PDF full text** sent | **Never** (`fullTextMode` forced to `never` — the enum is `never` \| `auto` \| `always`, `06-summarization-and-trend-report.md` §5.4) | Yes — D7's `fullTextMode: auto` default, gated by the pre-run cost confirmation and the first-use licence warning | Yes |
| **User notes** sent | Never | Never | Only with a separate explicit opt-in |
| **PDF annotations / highlights** sent | Never | Never | Only with a separate explicit opt-in |
| **Collection & tag names** sent | Never | Never | Only with a separate explicit opt-in |
| Models with `dataPolicy: "unknown"` | **Refused** | Warned | Allowed |
| Models that may train on input | **Refused** | **Refused** | Warned, requires confirmation |
| OpenRouter routing | `data_collection: "deny"` + `zdr: true` | `data_collection: "deny"` | `data_collection: "deny"` (still) |
| Gemini free tier | **Refused** | Warned every session | Warned once |
| Cached prompts/responses stored locally | Metadata only | Yes | Yes |

**"Abstract-only" is the floor, not an option.** Even strict mode sends abstracts, because a summarization tool that sends no content is not a summarization tool. What strict mode guarantees is: *nothing beyond the published bibliographic record leaves your machine, and it only goes to endpoints that contractually do not train on it and do not retain it.* That is a defensible, explainable line.

**Local-only mode.** A fourth state exists implicitly: with no API key configured, features 1, 2 and 6's search half work entirely offline-capable (they hit only the literature APIs, which receive only query terms). Summarization, trend reports and audio are simply unavailable. The UI should present this as a legitimate way to use the plugin, not as a broken state. If a future version adds a local model backend (llama.cpp, Ollama), it slots in as an `LLMProvider` with `dataPolicy` describing zero egress — the architecture already supports it.

**Per-collection opt-in.** The intended workflow: a researcher keeps a "Manuscripts under review" or "Confidential — collaborator drafts" collection set to **strict** or to local-only, while their general reading collection runs **balanced**. The collection's privacy state must be visible in the collection context menu and in the pre-flight confirmation dialog for every job, so it is never a surprise.

### 3.6 Disclosure at the point of action

Consent obtained once at install time is not meaningful consent for an action taken three months later. The plugin discloses at the moment of egress:

**Before any of that, once: the first-job acknowledgement.** The first time the user confirms a job that sends content, the pre-flight dialog carries an additional, explicit notice — what a "fully client-side, bring your own key" plugin does and does not protect them from, and that content leaves their machine for a third-party provider they chose. The acknowledgement is recorded in the **`privacy.egressAcknowledged`** preference (key, type and default: `07-architecture-and-data-model.md` §8.5), which is written only by this dialog and read only to decide whether to show the notice again. This is `10-requirements-and-user-stories.md` FR-36's second clause, and it is where that requirement's "recorded in prefs" lands.

It is an *acknowledgement*, not consent-in-advance, and it suppresses nothing. Item 1 below still runs on every job, and items 2 and 3 are unaffected by it — which is the whole point of the paragraph that opens this section.

1. **Pre-flight dialog for every job that sends content**, showing: the destination provider and model, the number of items, what will be sent (metadata / +abstract / +full text) in plain words, the estimated cost, and the current privacy mode. This dialog already exists for cost reasons (`Pipeline.estimate()`); privacy information goes in the same dialog rather than a second one. **When a `<provider>.baseUrl` override is in effect (`03-llm-provider-integration.md` §14.4) the dialog names the effective host**, not the provider's default one — the destination is what the user is being asked about.
2. **A "don't ask again for this collection" checkbox** — but it suppresses only the *routine* confirmation. It never suppresses: a change of provider, a change of privacy mode, the first use of full-text sending, or the Gemini free-tier warning.
3. **The Gemini free-tier warning is not suppressible** while the tier is free or unknown: *"This Google API key appears to be on the free tier. Google's terms state that content you send on the unpaid tier is used to improve Google products, and that human reviewers may read it. Do not use the free tier for unpublished or confidential material."*
4. **An egress log.** The plugin's own job records log, per job, exactly which provider received how many items and what scope of content. `StoredSummary.inputScope` (`07-architecture-and-data-model.md` §5.2) already captures this per summary. A researcher asked by their IRB "what did you send where" must be able to answer from the plugin's own records. This log is local only. **What v1 does not ship is a window for browsing it:** the Job Center, which would have carried that view, is deferred to v1.1 (`10-requirements-and-user-stories.md` §4 item 18; `07-architecture-and-data-model.md` §7.7.1), so in v1 the log is read out of the job records themselves and through the debug bundle (`07-architecture-and-data-model.md` §10.4, which includes recent jobs). The recording obligation above is unaffected by that deferral.

### 3.7 Local data the user should be able to clear

Because the plugin database sits in the backed-up data directory (§1.6), the preferences pane needs, at minimum:

- **Clear cached API responses** (with a size figure).
- **Clear generated summaries** — with a clear statement of whether this also removes the Zotero notes (it must **not**; notes are user data, deleted only through Zotero's own UI).
- **Clear job history**.
- **Clear embeddings**.
- **Delete all plugin data**, offered in `uninstall()` as well as on demand.
- A visible statement of where the database lives, so a user preparing a shared backup knows what is in it.

---

## 4. Institutional, IRB, and licensing considerations

### 4.1 Why this section exists in a technical document

The plugin's core action — take a researcher's paper and send it to a commercial LLM — has a legal and institutional dimension that a purely technical design will get wrong. The plugin cannot give legal advice, and must not pretend to. What it can do is (a) not make the risky thing the default, (b) make the risky thing visible when it happens, and (c) give the user the record they will need if asked.

### 4.2 Unpublished and confidential material

Three specific situations where sending content to a third-party LLM is a real problem:

**Peer review.** Manuscripts under review are confidential to the review process. [Elsevier's reviewer policy](https://www.elsevier.com/about/policies-and-standards/publishing-ethics) states that reviewers must not upload a submitted manuscript into a generative AI tool, because doing so *"can infringe the authors' confidentiality and intellectual property rights and may breach data privacy"*. The **US NIH prohibits its scientific peer reviewers from using generative AI to analyse and formulate critiques of grant applications and contract proposals** ([NOT-OD-23-149](https://grants.nih.gov/grants/guide/notice-files/NOT-OD-23-149.html)). [Wiley's AI guidelines](https://www.wiley.com/en-us/publish/article/ai-guidelines/) carry equivalent restrictions.

This matters concretely: a Zotero user *will* have a collection of manuscripts they are reviewing, and "summarize this collection" will be exactly one click away.

**Human-subjects data.** Institutional guidance is consistent that this requires prior consultation. [UCSF's HRPP guidance on ChatGPT/LLMs](https://irb.ucsf.edu/chatgpt-large-language-models-llm-artificial-intelligence-ai) directs researchers to determine whether using AI technologies with participant data requires additional IRB approval, and to check whether the original consent forms cover sharing data with third-party services. Institutions commonly also require a security risk assessment and a data transfer or processing agreement before data goes to a non-institutional vendor.

**A researcher's own unpublished work.** Prior disclosure can affect patentability, and some funders and collaborators impose confidentiality obligations. The retention windows in §3.3 (30 days at OpenAI and Anthropic; 55 days at Google; longer if flagged) are the relevant facts.

### 4.3 What the plugin does about it

The plugin does **not** attempt to detect confidential content — heuristics here would be both unreliable and paternalistic. Instead:

1. **Nothing is sent automatically, ever.** No background summarization on import, no "smart" pre-fetching, no idle-time processing. Every egress is a user action. This is a hard architectural rule, not a default setting.
2. **Per-collection privacy modes** (§3.5) are the mechanism by which a user marks a collection as off-limits, and they are visible at the point of action.
3. **A first-run notice**, shown once, in plain language:

   > **Before you use AI features.** This plugin sends paper content to the AI provider you choose. Do not use it on manuscripts you are peer-reviewing, on unpublished work covered by a confidentiality agreement, or on any material containing participant data, without checking your institution's rules first. Providers retain content for a period (typically 30–55 days) even when they do not train on it. You can set any collection to a stricter privacy mode, or use the plugin without AI features at all.

4. **The egress log** (§3.6) exists precisely so a researcher can answer an institutional question after the fact.
5. **Documentation, not advice.** The plugin's docs state what is sent and cite the providers' own retention terms. They do not tell the user whether their IRB will permit it.

> **Unverified:** the NIH notice number `NOT-OD-23-149` and the exact Elsevier policy URL above were not re-fetched for this document; the substance (NIH prohibits generative AI in peer review of applications; Elsevier prohibits uploading manuscripts to generative AI tools) is confirmed, but verify the citations before publishing them in user-facing text.

### 4.4 Licensing and redistribution of publisher content

The plugin retrieves metadata and, potentially, full text. Different things carry different rights.

| Content | Typical licence | What the plugin may do |
|---|---|---|
| **Crossref metadata** | Openly available via the REST API; facts, not creative works | Store, index, display, send to an LLM |
| **arXiv descriptive metadata** | Explicitly **CC0 1.0** — *"You are free to use descriptive metadata about arXiv e-prints under the terms of the Creative Commons Universal (CC0 1.0) Public Domain Declaration"* ([arXiv API TOU](https://info.arxiv.org/help/api/tou.html)) | Anything |
| **PubMed abstracts** | Records are NLM-provided; abstracts remain under publisher copyright in many cases | Store locally and display to the user who retrieved them. **Do not redistribute in bulk.** |
| **Europe PMC OA subset** (see the note below the table for current counts) | **CC-BY, CC-BY-NC, or CC0**, varying per article | Text-mine and process. Redistribution depends on the specific licence — check the per-article field. |
| **Europe PMC non-OA full text** | Publisher copyright | Metadata and abstract only. Europe PMC is explicit: *"It is not permissible to use any kind of automated process to bulk download other content from Europe PMC"* ([Europe PMC developers](https://europepmc.org/developers)) |
| **PMC OA Subset** | Split into a `comm` subset (commercial + non-commercial use permitted) and a `non-comm` subset (non-commercial only, including data mining) | Respect the split if the plugin ever ingests the bulk subsets |
| **Semantic Scholar data** | Mixed — the [API licence](https://www.semanticscholar.org/product/api/license) covers *"third party content and materials, such as open access works… works under a public use license (e.g., Creative Commons), and works licensed by AI2 from others"*, with **CC BY-NC** and **ODC-BY** both appearing | Attribute "Semantic Scholar"; cite *The Semantic Scholar Open Data Platform* in publications. **Do not** *"repackage, sell, rent, lease, lend, distribute, or sublicense the API."* CC BY-NC on part of the corpus means blanket commercial reuse is unsafe. |
| **bioRxiv / medRxiv preprints** | **Author-selected, per preprint**: CC BY, CC BY-NC, CC BY-ND, CC BY-NC-ND, or "no reuse without permission" | Read the licence field of each record. Link back to bioRxiv rather than re-hosting full text. |
| **PDFs already in the user's Zotero library** | Whatever the user's institutional subscription or the publisher permits | The plugin sends them to an LLM only on explicit instruction; see below |

> **On the Europe PMC OA subset size:** an earlier draft of this document cited "~6.5M of ~10.2M full-text articles". Those figures are stale and, worse, mixed two different definitions. Counted through the Europe PMC search API on 2026-09-08: `HAS_FT:Y` → **12,220,779**; `HAS_FT:Y AND OPEN_ACCESS:Y` → **8,153,192**. The *bulk-downloadable* subsets advertised on the developers page are narrower again (~3.2M OA articles, ~6.4M full-text articles). Whenever this number is quoted, state which definition is meant and the date it was taken — the ratio is what the design depends on, not the absolute figure.

**The sharpest question: is sending a subscription PDF's text to OpenAI a TDM licence violation?** Honestly: **it depends on the publisher's terms and the user's institutional agreement, and the plugin cannot know.** Many publisher TDM clauses restrict mining to specified platforms, require a separate TDM licence, or prohibit transferring content to third parties. Some institutional agreements explicitly permit TDM; some explicitly forbid onward transmission.

The design consequences:

1. **Strict mode is the abstract-only path**, and any collection holding material of this kind should be set to it (§3.5). In balanced and full modes decision **D7** applies: `summary.fullTextMode` ships as `auto`, so full text *is* sent when it exists — which is exactly why point 2 below is a first-use warning rather than a footnote, and why §4.3's first-run notice (item 3) must land before the first summarize job.
2. **The first full-text send shows a specific warning** naming the issue: *"Full text may be subject to your publisher or institutional licence terms, which may restrict sending it to third-party services. Check with your library if you are unsure."*
3. **The plugin stores licence information where the source provides it** (`CanonicalWork.openAccess.license`, `07-architecture-and-data-model.md` §5.1) and can therefore show, per item, whether it is open access — useful signal for the user's own judgment.
4. **The plugin never redistributes anything.** Content stays in the user's library and cache. There is no sharing feature, no upload, no server. This removes the largest category of licensing risk by construction.
5. **Generated summaries are derivative of the source.** The plugin stores them locally and attributes them to the source item. It offers no export-and-publish path that would make redistribution easy to do accidentally.

---

## 5. Terms-of-service compliance for the literature APIs

The enforcement mechanism for everything in this section is the per-host rate limiter and the identification headers described in `07-architecture-and-data-model.md` §7.3. This section is the *policy*; that section is the *implementation*.

### 5.1 NCBI / NLM E-utilities

Source: [A General Introduction to the E-utilities (NBK25497)](https://www.ncbi.nlm.nih.gov/books/NBK25497/).

**Must do:**

- **Rate limit.** *"Post no more than three URL requests per second"* without an API key. *"By including an API key, a site can post up to 10 requests per second by default. Higher rates are available by request."* The plugin runs at 2.5/s and 8/s respectively.
- **Identify the tool and a contact address — and register them.** The `tool` parameter uniquely identifies the software (no internal spaces) and `email` must be *"a complete and valid e-mail address of the software developer and not that of a third-party end user."* Note the precise obligation: NCBI does not state that the two parameters are required on every request, but it does state that *"merely providing values for tool and email in requests is not sufficient to comply with this policy; these values must be registered with NCBI"*, and that unregistered IPs violating the usage policy may be blocked. **Registering the values is therefore a release task, not just a code task** (§8, item 5). The plugin sends them on every request regardless. Read literally, that wording means NCBI's `email` parameter carries the maintainer's address and not the researcher's, which also has a privacy upside: using the plugin would not disclose the user's identity to NLM. **`02-literature-database-apis.md` §2.2 owns the contact-address policy** and defines a two-slot scheme — maintainer address in the `User-Agent` on every request, user address (optional, from prefs) in the `mailto`/`email` query parameter — and, precisely because of the wording quoted above, it records NCBI as the **explicit exception**: NCBI's `tool`/`email` always carry the maintainer address, whatever the user has configured. That is decision **D10** (`00-overview.md` §3, 2026-09-09), so implement NCBI as the maintainer-only case described here.
- **Support an API key.** Offer an optional NCBI API key field, obtained from [NCBI account settings](https://www.ncbi.nlm.nih.gov/account/) and passed as `&api_key=...`. When present, raise the limiter.
- **Schedule large jobs off-peak.** NCBI asks that large jobs run on weekends or between 21:00 and 05:00 US Eastern on weekdays. For a 200-item import this is unlikely to bind, but the plugin should (a) not encourage bulk harvesting and (b) mention the guidance if a job would issue more than a few hundred E-utility requests.

**Must not do:** exceed the limits, omit `tool`/`email`, or attempt to parallelize across IPs. Non-compliance can result in NCBI blocking the IP until the developer registers.

### 5.2 Crossref

Source: [Access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/).

Three pools:

| Pool | How | Limit |
|---|---|---|
| Public | no auth | 5 requests/interval, 1 concurrent |
| **Polite** | *"Include your email address in the `mailto` parameter or `agent` header"* | 10 requests/interval, 3 concurrent |
| Plus | `Crossref-Plus-API-Token: Bearer <key>` | 150 requests/interval |

**Must do:** join the polite pool. Send a descriptive `User-Agent` containing a contact address, e.g.

```
research_helper/<version> (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)
```

Again: the `User-Agent` slot carries **the maintainer's address, not the user's** (`02-literature-database-apis.md` §2.2). Crossref's `mailto` **parameter** is the other slot, and §2.2 assigns it the user's address when the pref is set — either slot alone promotes the request to the polite pool, so a user who leaves the pref empty is unaffected. Read `x-rate-limit-limit`, `x-rate-limit-interval` and `x-concurrency-limit` from every response and reconfigure the limiter — the interval is **not** fixed at one second, which is why a hard-coded "50 requests per second" is wrong.

> **Important:** the table above is the *headline* figure, and it applies to single-record lookups. Crossref revised the limits effective **2025-12-01** so that **list endpoints** (`/works` and friends — which is what the plugin's searches actually hit) get **1 request/second in the public pool and 3 in the polite pool**. A live probe of `GET /works` returns `x-rate-limit-limit: 1` anonymous and `3` with `mailto`, with `x-api-pool: public-array` / `polite-array`. Never derive the limiter from the published table alone; the headers are the accurate source. See `07-architecture-and-data-model.md` §7.3.

> **Note:** the frequently-cited "Crossref allows 50 requests/second" figure appears only in the GitHub `rest-api-doc` README, which Crossref itself marks *"This documentation is deprecated."* It is on no current crossref.org page. Do not cite it.

**Must not do:** exceed the limits (which yields a 429 — *"wait a short while and try your request again at a lower rate or with fewer simultaneous requests"*), or claim the polite pool without a working contact address.

### 5.3 Semantic Scholar

Source: [Semantic Scholar API](https://www.semanticscholar.org/product/api), [API License Agreement](https://www.semanticscholar.org/product/api/license).

**The rate structure is counter-intuitive.** Unauthenticated requests draw on a *shared* pool of *"1000 requests per second shared among all unauthenticated users"* — high on paper, unpredictable in practice, and subject to throttling. An introductory API key grants *"1 RPS on all endpoints"* — numerically lower but **guaranteed**; *"in some cases, users may be granted a slightly higher rate following a review."*

**Must do:** stay under 1/s in either mode; offer an optional API key field; attribute Semantic Scholar and cite *The Semantic Scholar Open Data Platform* where the plugin's output is used in publications (worth a line in the plugin's README and in generated report footers).

**Must not do:** *"repackage, sell, rent, lease, lend, distribute, or sublicense the API."* Also — and this is the relevant one for us — do not treat the API as a bulk channel. S2's own guidance: *"When you need a request rate that is higher than the rate provided by API keys, you can download Semantic Scholar's datasets and run queries locally."* A plugin that tried to mirror the corpus through the API would be abusing it.

**Licence caution:** parts of the corpus are **CC BY-NC**, parts **ODC-BY**. Blanket commercial reuse of retrieved data is not safe, and the applicable licence depends on the subset. For our use — a researcher retrieving records into their own library — this is fine; for any future feature that redistributes S2-derived data, it is not.

### 5.4 arXiv

Source: [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html), [bulk data](https://info.arxiv.org/help/bulk_data/index.html).

**Must do:** *"When using the legacy APIs (including OAI-PMH, RSS, and the arXiv API), make no more than one request every three seconds, and limit requests to a single connection at a time."* The "legacy APIs" scoping is part of the sentence and is often dropped when this clause is quoted — it is nevertheless the clause that binds us, because the arXiv API *is* one of the legacy APIs. Explicitly aggregated across *"all of the machines under your control as a whole"* — an anti-circumvention clause. Enforced with `minIntervalMs: 3000` and `maxConcurrent: 1`.

**Notable difference from NCBI and Crossref:** arXiv's TOU imposes **no** User-Agent or contact-identification requirement. The plugin sends one anyway as good practice, but it must not be documented as a compliance obligation, and no user email is involved.

**Must not do:** use the API as a bulk channel. arXiv directs bulk users to AWS S3 (PDF and LaTeX source), Kaggle, or OAI-PMH. Do not re-host e-print content — link to the arXiv abstract page. Metadata is CC0 and may be used freely; the e-prints themselves are not.

### 5.5 Europe PMC

Source: [Europe PMC developers](https://europepmc.org/developers), [RESTful Web Service](https://europepmc.org/RestfulWebService), [OA subset](https://europepmc.org/downloads/openaccess).

**Must do:** accept the Privacy Notice (*"By using our public API you agree to accept the terms of the Privacy Notice"*). Restrict automated full-text retrieval to the **open-access subset**, and respect the per-article licence (CC-BY / CC-BY-NC / CC0 — *"the license terms are not identical for all articles in this subset"*).

**Must not do — this is the explicit prohibition:** *"It is not permissible to use any kind of automated process to bulk download other content from Europe PMC."* Everything outside the OA subset is abstract-and-metadata-only for automated use. The plugin therefore never attempts programmatic full-text retrieval for non-OA articles; where a user has a PDF, it came from their own subscribed access, not from us.

> **Unverified:** Europe PMC publishes **no rate limits** on its developer pages. The commonly cited "10 requests/second (500/minute), per IP" originates in a user's question on the [EBI epmc-webservices group](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/cZLnV1JhCj8); the Europe PMC team confirmed the *per-IP scoping* in that thread but not the figure. The plugin defaults to half of it (5/s). Contact the Europe PMC team to confirm before raising it.

There is no API key mechanism.

### 5.6 bioRxiv / medRxiv

Source: [api.biorxiv.org](https://api.biorxiv.org/).

> **Unverified — genuine documentation gap:** bioRxiv/medRxiv publish **no API key mechanism, no rate limits, and no API-specific terms of use.** This is not a search failure; the API page does not contain them. The plugin self-imposes 1 request/second with a maximum of 2 concurrent.

Endpoints return 30 records per call for `/details/`, 100 for `/pubs/`. Formats: JSON, XML (OAI-PMH), HTML, CSV.

**Licensing is per-preprint and author-selected** — CC BY, CC BY-NC, CC BY-ND, CC BY-NC-ND, or "no reuse without permission". Redistribution rights therefore vary article by article and the plugin must read the licence field of each record rather than assuming. Guidance for full-text tooling is to **link back to bioRxiv rather than re-host**.

### 5.7 Rules that apply to all of them

**Must do:**

- One shared rate limiter per host across all jobs (`07-architecture-and-data-model.md` §7.3) — two concurrent jobs must not each get a full budget.
- Honour `Retry-After` on 429/503, and back off with jitter.
- Cache aggressively. The most compliant request is the one you do not make (`07-architecture-and-data-model.md` §9).
- Send a descriptive `User-Agent` identifying the plugin, its version, and a maintainer contact.

**Must not do:**

- **Bulk scraping.** No feature harvests a corpus. Every request serves a specific user action with a bounded result set. The `SourceQuery.limit` is capped in the UI, and `searchAll` is bounded by that limit — there is no "download everything" path.
- **Scraping publisher websites.** The plugin talks to documented APIs only. It does not fetch article landing pages, does not parse HTML from publisher domains, and does not use `Zotero.HTTP.newCookieContext()` to carry a user's session onto a publisher site. (Zotero's translators do that; that is Zotero's business, with Zotero's terms, not ours.)
- **Redistributing full text.** No sharing, no export of retrieved full text, no server.
- **Circumventing paywalls.** No Sci-Hub, no LibGen, no proxy tricks, no institutional-credential replay. Full text is used only when the user already has it in their own library, or when it is open access.
- **Sending the user's email anywhere it was not asked for.** The `User-Agent` identification header carries the maintainer's address on every host, never the user's. The `mailto`/`email` **query parameter** is the one place a user address may appear, only where the source's own terms allow it and only when the user has filled in the pref — the slot assignment is owned by `02-literature-database-apis.md` §2.2, which limits it to Crossref's `mailto` and excludes NCBI outright (decision D10). No user address is sent to an LLM or TTS provider under any circumstance.

---

## 6. Supply chain and distribution security

### 6.1 The stakes

A Zotero plugin runs privileged, with *"full access to platform internals (XPCOM, file access, etc.)"* ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)). A compromised update to `research_helper` would run as the user, with access to `Services.logins`, `Zotero.OSKeyStore`, the entire Zotero library, and the filesystem. **The update channel is the highest-value attack surface this project has** — higher than the key storage, because compromising the update channel defeats the key storage.

### 6.2 The update manifest

Zotero 7+ uses a Mozilla-style JSON update manifest with an integrity hash ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)):

```json
{
  "addons": {
    "research-helper@suppakoko.github.io": {
      "updates": [{
        "version": "1.2.0",
        "update_link": "https://github.com/suppakoko/research_helper/releases/download/v1.2.0/research-helper-1.2.0.xpi",
        "update_hash": "sha256:4a6dd04c197629a02a9c6beaa9ebd52a69bb683f8400243bcdf95847f0ee254a",
        "applications": { "zotero": { "strict_min_version": "10.0", "strict_max_version": "10.0.*" } }
      }]
    }
  }
}
```

**Requirements:**

1. **`update_url` must be HTTPS**, with a certificate that actually validates. An HTTP update URL, or one on a domain that could lapse, is a direct code-execution channel.
2. **`update_hash` must be present and must be `sha256:`** on every entry. It is the only integrity check in the chain.
3. **The manifest and the XPI should be served from infrastructure with different compromise profiles** where practical (e.g. manifest from GitHub Pages, XPI from GitHub Releases). Not a strong guarantee, but it means a single misconfigured bucket is not sufficient.
4. **Never point `update_link` at a mutable URL** such as `releases/latest/download/...`. Pin the version in the path so the hash and the artefact cannot drift apart.
5. **Domain hygiene**: whatever domain hosts `update_url` must be registrar-locked with auto-renew, and its DNS must be under the same control as the release process. A lapsed domain is a handover of the update channel.

> **Verified (2026-09-09): Zotero enforces no XPI signature requirement.** Zotero's own shipped defaults set both checks off, in [`app/assets/prefs.js`](https://raw.githubusercontent.com/zotero/zotero/main/app/assets/prefs.js):
>
> ```js
> pref("xpinstall.signatures.required", false);
> pref("xpinstall.whitelist.required", false);
> ```
>
> So `update_hash` over HTTPS **is** the entire integrity story, and the trust model is purely reputational — there is no signing authority, no review, and (per `13-testing-build-and-release.md` §7) no official plugin directory to be delisted from. The practical consequences for this project are in [01-zotero-plugin-platform.md](01-zotero-plugin-platform.md) §11.5: publish SHA-256 hashes alongside each release, serve `update.json` only over HTTPS, and enumerate for users every endpoint the plugin contacts.

### 6.3 Build and dependency hygiene

**Dependency pinning.**

- Commit the lockfile (`package-lock.json` / `pnpm-lock.yaml`) and build releases with `npm ci`, never `npm install`.
- **Pin exact versions** in `package.json` for anything that ends up in the shipped bundle — no `^`, no `~`. A caret on a build-time dependency is a standing invitation for a compromised patch release to be bundled into an XPI signed with nothing.
- Enable `npm audit` in CI and treat a new high-severity advisory in a bundled dependency as a release blocker.
- **Minimize the dependency surface.** This plugin genuinely needs very little at runtime: HTTP goes through `Zotero.HTTP`, storage through SQLite, crypto through the platform. Every added runtime dependency is code running privileged in the user's Zotero. Prefer writing 40 lines to adding a package.
- **Vendor and review anything small and critical.** A hand-reviewed 60-line SSE parser in `src/llm/shared/sse.ts` is safer than an npm package with a transitive tree.
- **No postinstall scripts** from dependencies where avoidable; audit any that remain.

**Reproducibility and release integrity.**

- Build XPIs in **CI from a tagged commit**, never from a maintainer's laptop. Attach the SHA-256 to the release notes and to `update.json` in the same automated step, so a human never transcribes a hash.
- Restrict who can push tags and publish releases. Require review on the release workflow file itself — a PR that edits `.github/workflows/release.yml` is a supply-chain event.
- Prefer OIDC / short-lived credentials over long-lived tokens in CI. Any long-lived publish token is a second key worth stealing.
- Publish a `SECURITY.md` with a contact address and a stated response expectation.

**The XPI is a ZIP.** Anyone can open it and read the source; there is no obfuscation and none should be attempted. Treat the shipped bundle as public. It follows that **no secret may ever be embedded in the plugin** — no default API key, no analytics token, no signing key. There is nothing in the plugin worth extracting, by design.

### 6.4 The malicious-plugin threat model

Worth stating explicitly because it constrains what §1 can promise.

**If `research_helper` itself is malicious or compromised**, it can read every stored key, exfiltrate the user's entire library, and do so while displaying a normal UI — because it holds the keys and makes outbound network requests as part of normal operation, so exfiltration is indistinguishable from a summarize job at the network layer. There is no mitigation inside the plugin. The mitigations are all *around* it: the update channel (§6.2), the build pipeline (§6.3), and the fact that the source is public and the XPI is inspectable.

**If a *different* plugin is malicious**, it can read our stored keys. Zotero plugins share one privileged JavaScript context. `Services.logins` is global. `Zotero.OSKeyStore.decrypt()` is global. Another plugin can also monkey-patch `Zotero.HTTP.request` and read every `Authorization` header from every plugin in the process. **No storage scheme available to us changes this** — which is precisely why §1.8 says so plainly rather than implying the keychain is a boundary against other plugins.

The practical user-facing advice, which belongs in the README and in the preferences pane:

- Install plugins only from their official sources.
- Prefer plugins whose source is public.
- Create a **dedicated API key for this plugin with a spending limit**, so a compromise is bounded and revocable without disturbing anything else.
- Review installed plugins periodically.

**Post-compromise response plan** (write it before you need it): if a malicious release is discovered, the maintainers publish an advisory naming the affected versions, ship a fixed version through the same update channel, and — critically — tell users to **rotate every API key that was configured**, because a compromised release had access to all of them. Key rotation is the only effective remediation, so §2.5 must make rotation easy.

---

## 7. Implementer's security checklist

Verify each before release. Items marked **[BLOCKER]** must not ship unresolved.

### Credential storage

- [ ] **[BLOCKER]** No code path writes an API key to `Zotero.Prefs`. A unit test asserts that every `secret: true` pref entry has no writer.
- [ ] **[BLOCKER]** No API key is written to the plugin SQLite database, in any form, encrypted or not.
- [ ] Keys are stored via `Zotero.OSKeyStore.encrypt()` → `Services.logins`, under origin `chrome://research-helper` and a dedicated realm.
- [ ] The OS keystore is **probed at startup** with an encrypt/decrypt round-trip; failure escalates to a visible tier decision, never a silent fallback.
- [ ] There is **no** plaintext fallback tier.
- [ ] `uninstall()` clears every stored secret and every plugin pref. `shutdown()` does not.
- [ ] A restored data-directory backup produces an explanatory empty-key state, not an error.

### Key hygiene

- [ ] **[BLOCKER]** No key appears in `Zotero.debug` output at any log level. Verified by running a full summarize job with `debug.level` at maximum and grepping the debug output for known key prefixes.
- [ ] `Secret` wrapper is used; `.expose()` has exactly one call site per provider and each is reviewed.
- [ ] Logger redaction runs unconditionally on every message and context value, before emission.
- [ ] `Authorization`, `x-api-key`, and `x-goog-api-key` headers are never logged.
- [ ] Gemini uses the `x-goog-api-key` **header**, never the `key` query parameter.
- [ ] `Zotero.HTTP.request` is never called with `debug: true`. Enforced by lint.
- [ ] The debug bundle contains no key and no paper content; its confirmation dialog says so and offers a preview.
- [ ] 401 pauses the job (does not fail it), does not retry, does not delete the key, and surfaces one notification.
- [ ] The key is read per-request, not cached at job start, so rotation takes effect immediately.
- [ ] "Test key" uses a non-billing endpoint and sends no user content.
- [ ] Stored keys are never re-displayed; the UI shows a masked fingerprint only.

### Data egress

- [ ] **[BLOCKER]** No content is sent to any provider without an explicit user action. No background, idle-time, or on-import processing.
- [ ] **[BLOCKER]** User notes and PDF annotations are not sent in any default configuration.
- [ ] Collection and tag names are not sent by default.
- [ ] The pre-flight dialog states destination, model, item count, content scope, privacy mode, and cost.
- [ ] Per-collection privacy overrides exist, are visible at the point of action, and can only tighten a global setting.
- [ ] OpenRouter requests set `provider.data_collection: "deny"` in every mode, and `zdr: true` in strict mode.
- [ ] A guardrail-restriction 404 from OpenRouter produces an explanatory message, not a generic failure.
- [ ] Models with `dataPolicy.trainsOnInputByDefault === "unknown"` are refused in strict mode and warned elsewhere.
- [ ] Gemini free-tier detection defaults to **assuming free** when uncertain, and the free-tier warning is not suppressible.
- [ ] The audio (TTS) feature discloses Google as a destination independently of the summarization provider.
- [ ] An egress log records provider, item count, and content scope per job, locally.
- [ ] The plugin sends **no** telemetry, analytics, or crash reports.
- [ ] Cache, summaries, job history, and embeddings are individually clearable; clearing summaries does not delete the user's Zotero notes.

### API terms compliance

- [ ] One shared rate limiter per host, across all jobs.
- [ ] NCBI: ≤3/s without a key, ≤10/s with one; `tool` and `email` always sent; `email` is the **maintainer's** unless the project owner records the alternative in `02-literature-database-apis.md` §2.2; **the `tool`/`email` pair is registered with NCBI** (sending them is not by itself compliance).
- [ ] Crossref: polite pool via `mailto` and a contact-bearing `User-Agent`; limiter reconfigured from `x-rate-limit-*` and `x-concurrency-limit` response headers, never from the published table alone (list endpoints are limited far below the headline figure).
- [ ] Semantic Scholar: ≤1/s; attribution present in the README and in generated reports.
- [ ] arXiv: ≥3 s between requests, exactly one concurrent connection.
- [ ] Europe PMC: automated full-text retrieval restricted to the OA subset; no bulk download of anything else.
- [ ] bioRxiv/medRxiv: conservative self-imposed limit; per-record licence field respected.
- [ ] `Retry-After` honoured on 429/503, with jittered backoff and a per-host attempt cap.
- [ ] No feature harvests a corpus; every request serves a bounded user action.
- [ ] No publisher-website scraping, no paywall circumvention, no cookie/session reuse against publisher domains.
- [ ] Contact addresses follow the two-slot scheme in `02-literature-database-apis.md` §2.2: the `User-Agent` carries the maintainer's address on every host; a user address appears only in **Crossref's `mailto` parameter**, and only when the user filled in the `contactEmail` pref. NCBI's `tool`/`email` always carry the maintainer address (decision D10). No user address reaches an LLM or TTS provider.

### Supply chain and distribution

- [ ] **[BLOCKER]** `update_url` is HTTPS with a validating certificate.
- [ ] **[BLOCKER]** Every `update.json` entry has a `sha256:` `update_hash`, generated in CI, never transcribed by hand.
- [ ] `update_link` pins an exact version path; no `latest` redirect.
- [ ] Lockfile committed; releases built with `npm ci`; runtime dependencies pinned to exact versions.
- [ ] `npm audit` runs in CI; new high-severity advisories block release.
- [ ] Releases are built in CI from a tagged commit, with restricted tag/release permissions and review required on the release workflow.
- [ ] **[BLOCKER]** No secret of any kind is embedded in the XPI — no default API key, no analytics token, no signing key.
- [ ] `SECURITY.md` exists with a contact address.
- [ ] A post-compromise plan exists and includes "rotate all configured API keys" as the first user instruction.

### Documentation and honesty

- [ ] **[BLOCKER]** The residual-risk statement (§1.8) appears in the preferences pane, unabbreviated, including the sentence that other plugins can read the keys.
- [ ] The first-run notice about peer review, confidential material, and participant data is shown once and is not skippable by default.
- [ ] The plugin claims **no** protection it does not provide. No "military-grade encryption", no "your data is safe", no "we never see your data" phrasing that implies more than it means.
- [ ] Provider retention figures in the UI cite the provider's own page and carry the date they were verified.
- [ ] Every policy claim in user-facing text is traceable to a source in this document's §8.

---

## 8. Open decisions for the human

1. **The OS-keystore-unavailable path.** `Zotero.OSKeyStore` exposes `confirmUnencryptedFallback()`, implying Gecko offers an unencrypted route when no platform keystore exists (realistically: Linux without libsecret). §1.7 proposes refusing plaintext and offering session-only or passphrase instead. Confirm this is the desired behaviour — it means some Linux users cannot run unattended background jobs.
2. **Whether to ship the passphrase tier at all in v1.** It is real work and serves a small population. Shipping only tiers 1 and 2 is defensible.
3. **Gemini tier detection.** If no programmatic billing signal exists, the fallback is asking the user and defaulting to "free/unsure". Confirm that repeatedly warning a paid-tier user who has not answered is acceptable — the alternative is under-warning a free-tier user, which is worse.
4. ~~Whether full-text sending ships in v1 at all.~~ **Settled by decision D7** (`00-overview.md` §3): full text ships and is preferred whenever available, cost-gated. What remains for this document is only that the publisher-TDM exposure (§4.4) is now on the default path, so the first-use warning and the strict-mode escape hatch are load-bearing rather than optional.
5. ~~**The maintainer contact address.**~~ **Settled 2026-09-09: `suppakoko@gmail.com`** (decision D10, `00-overview.md` §3). It ships in the `User-Agent` on every host and in NCBI's `tool`/`email` parameters, is published inside the XPI, and will receive real mail from these services — it must be monitored. Crossref's `mailto` parameter is the one slot that carries the *user's* address instead, when they set the `contactEmail` pref; see `02-literature-database-apis.md` §2.2 for the per-host table.
6. **Re-verify the items still flagged `Unverified` / `Partially verified` inline** before any of them reaches user-facing text: OpenAI's Private Safety Processing page (403 to direct fetch), OpenRouter's remaining privacy-toggle labels and the literal free-model guardrail 404 string (help-centre article 403s), the Vertex AI figures (`cloud.google.com` unreachable from the research network — the ~24 h cache figure is not corroborated even in excerpts), the Europe PMC rate limit, the NIH and Elsevier peer-review citations, and the provider "test key" endpoints. Note that as of the 2026-09-08 pass the OpenAI, Anthropic, Google Gemini and OpenRouter *policy* claims in §3.3 were re-fetched from the providers' live pages and hold.
7. **Set a policy-review cadence.** Every figure in §3.3 is dated 2026-09-08. Provider retention terms change. Recommend re-verifying at each minor release and stamping the verification date in the UI next to the retention information.
8. **Where the two source-credential checks hang off the interfaces.** §2.3 now defines a test call for all six credentials, but `validateCredentials()` is a member of `LLMProvider` only (`07-architecture-and-data-model.md` §4.3); `LiteratureSource` (§4.2) has no equivalent. Either the NCBI and Semantic Scholar checks stay adapter-local functions that `preferences.js` calls directly (what §2.3 assumes today, and what needs no interface change), or `LiteratureSource` grows an optional `validateCredentials?()` so both paths return the same `CredentialCheckResult`. The second is tidier and is an interface change to doc 07 §4.2, so it is the owner's call, not this document's.
9. **Confirm the invalid-key behaviour of the NCBI and Semantic Scholar APIs.** §2.3's two `> **Unverified:**` callouts record that `02-literature-database-apis.md` documents neither, so every non-success outcome for those two credentials currently resolves to `inconclusive`. One request each with a deliberately corrupted key settles it. Until it is settled, the prefs pane can tell the user "we could not verify this key" but never "this key is wrong".

---

## Sources

### Zotero platform

- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) — privileged plugin context ("full access to platform internals (XPCOM, file access, etc.)"), update manifest with `update_hash`, `nsILoginManager::findLogins()` signature change among platform migration items.
- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero: Profile Directory](https://www.zotero.org/support/kb/profile_directory)
- [Zotero: Zotero Data](https://www.zotero.org/support/zotero_data)
- [`chrome/content/zotero/xpcom/prefs.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prefs.js) — `PREF_BRANCH` prefixing, delegation to `Services.prefs`, absence of any encryption layer.
- [`chrome/content/zotero/xpcom/sync/syncLocal.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/sync/syncLocal.js) — Zotero's own API key stored in `Services.logins` under `chrome://zotero` / `Zotero Web API (encrypted)`, via `searchLoginsAsync` / `addLoginAsync` / `removeLoginAsync`.
- [`chrome/content/zotero/xpcom/osKeyStore.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/osKeyStore.js) — `Zotero.OSKeyStore` wrapping Gecko's `OSKeyStore.sys.mjs`; `encrypt()`, `decrypt()`, `isEncrypted()`, `confirmUnencryptedFallback()`, `oskv1:` prefix.
- [`chrome/content/zotero/xpcom/http.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/http.js) — `debug` and `logBodyLength` options.
- [Zotero forums: prefs.js location](https://forums.zotero.org/discussion/117354/pres-js-location) — Zotero staff confirming the profile directory.
- [Zotero forums: proxy requesting username and password](https://forums.zotero.org/discussion/82574/proxy-requesting-username-and-password) — Zotero staff using `Services.logins` from Run JavaScript, including the Zotero 7+ async form.
- [windingwind: Zotero plugin dev docs — preferences](https://windingwind.github.io/doc-for-zotero-plugin-dev/main/preferences.html) — cited as a source containing an error about the `prefs.js` location.

### Gecko / OS credential storage

- [Mozilla Support: Use a Primary Password to protect stored logins and passwords](https://support.mozilla.org/en-US/kb/use-primary-password-protect-stored-logins)
- [Mozilla Support: What is the default protection of saved logins in Firefox?](https://support.mozilla.org/en-US/questions/1210914) — without a Primary Password, `logins.json` + `key4.db` together are sufficient to recover stored credentials.
- [Microsoft Learn: CryptProtectData (dpapi.h)](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) — DPAPI's per-user protection model.

### LLM provider data policies (verified 2026-09-08)

- [OpenAI: Your data (API)](https://developers.openai.com/api/docs/guides/your-data) — no training on API data by default since 2023-03-01; up to 30-day abuse-monitoring retention; ZDR by prior approval; ZDR-eligible and ineligible endpoints.
- [OpenAI: Offering zero data retention for frontier models](https://openai.com/index/offering-zero-data-retention-for-frontier-models/) — Private Safety Processing (August 2026). *Partially verified — page returned 403 to direct fetch.*
- [Anthropic Privacy Center: Is my data used for model training?](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) — commercial products, including the API, are not used for training by default.
- [Anthropic Privacy Center: How long do you store personal data?](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data) — 30 days default; 2 years for Usage Policy violations; 7 years for T&S scores; 5 years for feedback.
- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) — *"Anthropic may not train models on Customer Content from Services."*
- [Anthropic: Updates to our consumer terms](https://www.anthropic.com/news/updates-to-our-consumer-terms) — the 2025 consumer training change does **not** apply to the API or other Commercial Terms services.
- [Google: Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) — the Paid/Unpaid split; human reviewers on unpaid; the Cloud-project-with-active-billing definition of "Paid Service".
- [Google: Gemini API logs policy](https://ai.google.dev/gemini-api/docs/logs-policy) — 55-day default retention, configurable 7/14/28/55.
- [Google: Gemini API abuse monitoring / usage policies](https://ai.google.dev/gemini-api/docs/usage-policies)
- [Google: Gemini API Zero Data Retention](https://ai.google.dev/gemini-api/docs/zdr) — paid-only, per-project approval, feature caveats.
- [Google: Speech generation (TTS)](https://ai.google.dev/gemini-api/docs/speech-generation) — same key, same endpoint, same terms; Korean supported.
- [Google Cloud: Vertex AI data governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance) — *unverified; not directly fetchable from the research network.*
- [Google Cloud: Vertex AI abuse monitoring](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring) — *unverified.*
- [Google Cloud: Vertex AI zero data retention](https://cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) — *unverified.*
- [OpenRouter: Privacy and Logging](https://openrouter.ai/docs/features/privacy-and-logging) — upstream provider policies vary; the account setting "has no bearing on OpenRouter's own policies".
- [OpenRouter: Provider Routing](https://openrouter.ai/docs/features/provider-routing) — `data_collection` (default `"allow"`), `zdr`, `only`/`ignore`.
- [OpenRouter: Input & Output Logging](https://openrouter.ai/docs/guides/features/input-output-logging) — private debugging storage, ≥3-month retention, not used for training.
- [OpenRouter: Data collection settings](https://openrouter.ai/docs/guides/privacy/data-collection) — the "OpenRouter Use of Inputs/Outputs" toggle and its 1% usage discount, distinct from Input & Output Logging.
- [OpenRouter: Terms of Service](https://openrouter.ai/terms) — §6.1 and §6.5 on training opt-out and non-storage of inputs.
- [OpenRouter: Privacy Policy](https://openrouter.ai/privacy)

### Literature API terms

- [NCBI: A General Introduction to the E-utilities (NBK25497)](https://www.ncbi.nlm.nih.gov/books/NBK25497/) — 3/s without a key, 10/s with; `tool` and `email` requirements; off-peak guidance.
- [NCBI account settings](https://www.ncbi.nlm.nih.gov/account/) — API key issuance.
- [Crossref: REST API access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) — public / polite / Plus pools; `mailto`; `x-rate-limit-limit`, `x-rate-limit-interval` and `x-concurrency-limit` headers; `Crossref-Plus-API-Token: Bearer <key>`.
- [Crossref: Announcing changes to REST API rate limits](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/) — effective 2025-12-01; separate, lower limits for *list* endpoints (1/s public, 3/s polite).
- [CrossRef/rest-api-doc README](https://github.com/CrossRef/rest-api-doc/blob/master/README.md) — the origin of the stale "50 requests/second" figure; the document itself states *"This documentation is deprecated."*
- [Semantic Scholar API](https://www.semanticscholar.org/product/api) — shared unauthenticated pool vs. 1 RPS with a key; datasets for bulk.
- [Semantic Scholar API License Agreement](https://www.semanticscholar.org/product/api/license) — mixed CC BY-NC / ODC-BY; attribution; no repackaging or sublicensing.
- [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html) — 1 request/3 s, single connection, aggregated across machines; metadata under CC0.
- [arXiv bulk data](https://info.arxiv.org/help/bulk_data/index.html) — S3 / Kaggle / OAI-PMH as the bulk channels.
- [Europe PMC Developers](https://europepmc.org/developers) — Privacy Notice acceptance; prohibition on automated bulk download of non-OA content.
- [Europe PMC RESTful Web Service](https://europepmc.org/RestfulWebService)
- [Europe PMC Open Access subset](https://europepmc.org/downloads/openaccess) — CC-BY / CC-BY-NC / CC0, licence terms not identical across articles.
- [EBI epmc-webservices group: rate limits](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/cZLnV1JhCj8) — the origin of the widely quoted 10/s figure; per-IP scoping confirmed by the team, the number itself not.
- [bioRxiv API](https://api.biorxiv.org/) — endpoints; no published key mechanism, rate limits, or API terms.
- [PubMed Central Open Access Subset](https://www.ncbi.nlm.nih.gov/pmc/tools/openftlist/) — `comm` vs. `non-comm` split.

### Institutional and publisher policy

- [UCSF HRPP: ChatGPT / Large Language Models / Artificial Intelligence](https://irb.ucsf.edu/chatgpt-large-language-models-llm-artificial-intelligence-ai) — IRB consultation, consent-form scope, third-party vendor assessment.
- [Wiley: AI guidelines for researchers](https://www.wiley.com/en-us/publish/article/ai-guidelines/)
- [Elsevier: Publishing ethics — reviewer responsibilities](https://www.elsevier.com/about/policies-and-standards/publishing-ethics) — reviewers must not upload submitted manuscripts to generative AI tools. *Citation not re-fetched; verify before user-facing use.*
- [NIH Guide Notice NOT-OD-23-149: The Use of Generative AI Technologies is Prohibited for the NIH Peer Review Process](https://grants.nih.gov/grants/guide/notice-files/NOT-OD-23-149.html) — *Citation not re-fetched; verify before user-facing use.*

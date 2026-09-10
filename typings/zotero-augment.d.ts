/**
 * Local augmentation of `zotero-types` for the Zotero 10 API surface that
 * `research_helper` depends on.
 *
 * Written 2026-09-10 for task `P0-T06` (spike `V-6`) against
 * **`zotero-types@4.1.3`**.
 *
 * Rules this file follows, and that any edit to it must keep following:
 *
 * 1. **Only what is genuinely missing or genuinely `any`.** Re-declaring
 *    something `zotero-types` already gets right silently diverges from
 *    upstream the day upstream changes. Every block below was proven missing
 *    by `scripts/probe-types.ts` before it was written.
 * 2. **No invented signatures.** Every declaration cites the design-corpus
 *    section that fixes its shape, and through it the
 *    `chrome/content/zotero/xpcom/...` file that is the real source of truth.
 *    Where the corpus does not fix a return type, the member is *not* declared
 *    and is listed in the "Known holes" block at the end of this file instead.
 * 3. **No `any`.** `V-6` exists to surface breakage; `any` re-hides it.
 * 4. **Delete a block when upstream ships it.** Re-run `P0-T06`'s probe after
 *    every `zotero-types` bump.
 */

// ---------------------------------------------------------------------------
// 1. `saveTx()` / `save()` undo options — Zotero 10
//
// Source: docs/01 §3.4(d) (Zotero 10 "Undo/redo — NEW, and we should use it")
// and docs/01 §5.2, whose item-creation shape passes `undoAction` to
// `saveTx()`. Runtime source of truth:
// chrome/content/zotero/xpcom/data/dataObject.js.
//
// `zotero-types@4.1.3` models `Zotero.DataObject.SaveOptions` as the pre-10
// option set, so an object literal carrying `undoAction` is rejected by
// excess-property checking. Bulk imports are the whole point of this plugin
// and a single Ctrl+Z escape hatch is a stated UX requirement, so this is on
// the critical path, not a nicety.
// ---------------------------------------------------------------------------

declare namespace Zotero {
  namespace DataObject {
    interface SaveOptions {
      /**
       * Fluent id of the "Undo …" label for this operation, e.g.
       * `"undo-action-edit-metadata"` (the one identifier docs/01 §3.4(d)
       * quotes verbatim).
       *
       * Typed as `string` deliberately: docs/01 §3.4(d) and §5.2 both carry a
       * `> **Unverified:**` note that the complete list of valid identifiers
       * is not documented. Narrowing this to a union would be an invention.
       */
      undoAction?: string;

      /**
       * Arguments substituted into the undo label, e.g. `{ count: 1 }`
       * (docs/01 §3.4(d)). The full argument schema is not documented, so the
       * value type is left open rather than guessed.
       */
      undoActionArgs?: Readonly<Record<string, unknown>>;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. `Zotero.HTTP.request` options and exception classes
//
// Source: docs/01 §8.1 (the full option table and the exception-class list)
// and docs/07 §7.4 (the exact option set `src/core/http/client.ts` passes).
// Runtime source of truth: chrome/content/zotero/xpcom/http.js.
//
// Two gaps, both compile-time blockers for `src/core/http/client.ts`:
//
//   (a) the option object in `zotero-types@4.1.3` omits `anon` and
//       `noRetryOnThrottle`. docs/01 §8.1 requires `anon: true` on every
//       literature-API and LLM call, and docs/07 §7.4 requires
//       `noRetryOnThrottle: true` so the plugin's own per-host token bucket
//       owns all 429/5xx handling. The option type is a closed object literal,
//       so excess-property checking rejects both.
//   (b) the five exception classes are absent entirely, so the `instanceof`
//       mapping in docs/01 §8.2 does not compile.
//
// (a) is closed with an overload rather than by re-declaring the existing
// members, so upstream's own option documentation stays authoritative; the
// overload repeats the pre-existing options only because TypeScript has no way
// to extend an anonymous inline parameter type.
// ---------------------------------------------------------------------------

declare namespace _ZoteroTypes {
  /**
   * `Zotero.HTTP.UnexpectedStatusException` instance shape.
   *
   * Members are exactly the ones docs/01 §8.1 lists — `.status`, `.xmlhttp`,
   * `.url`, `.is4xx()`, `.is5xx()` — and nothing else. The class's prototype
   * is `Object.create(Error.prototype)` in http.js, hence `extends Error`.
   */
  interface HTTPUnexpectedStatusException extends Error {
    readonly status: number;
    readonly xmlhttp: XMLHttpRequest;
    readonly url: string;
    is4xx(): boolean;
    is5xx(): boolean;
  }

  /**
   * The four remaining `Zotero.HTTP` exception classes. docs/01 §8.1 names
   * them but documents no instance member beyond what `Error` provides, so
   * none is invented here: each instance type is exactly `Error`. They exist
   * so the `instanceof` chain of docs/01 §8.2 compiles.
   */
  type HTTPTimeoutException = Error;
  type HTTPBrowserOfflineException = Error;
  type HTTPSecurityException = Error;
  type HTTPCancelledException = Error;

  /**
   * Constructor-side type of a `Zotero.HTTP` exception class.
   *
   * The constructor parameter lists are *not* documented in the corpus, so no
   * `new (...)` signature is declared: plugin code catches these, it never
   * constructs them. Only `prototype` is declared, which is all `instanceof`
   * needs in order to narrow.
   */
  interface HTTPExceptionClass<T> extends Function {
    readonly prototype: T;
  }

  interface HTTP {
    /**
     * Zotero 10 option set, per docs/01 §8.1's table. Adds `anon` and
     * `noRetryOnThrottle` to the options `zotero-types@4.1.3` already knows.
     *
     * `userContextId` is included because docs/01 §3.4(e) makes it the
     * Zotero 10 replacement for `Zotero.CookieSandbox`; this plugin does not
     * use it (it sends `anon: true` instead) but a call site that does must
     * not have to reach for a cast.
     */
    request(
      method: string,
      url: string,
      options: {
        body?: string | Uint8Array;
        headers?: Record<string, string> | Headers;
        responseType?: string;
        responseCharset?: string;
        successCodes?: number[] | false;
        timeout?: number;
        errorDelayIntervals?: number[];
        errorDelayMax?: number;
        /** Throw on 429/503 instead of running Zotero's own retry loop. */
        noRetryOnThrottle?: boolean;
        /** Anonymous request: no ambient cookies. docs/01 §8.1. */
        anon?: boolean;
        /** Cookie-isolation context id. docs/01 §3.4(e). */
        userContextId?: number;
        followRedirects?: boolean;
        noCache?: boolean;
        foreground?: boolean;
        debug?: boolean;
        logBodyLength?: number;
        requestObserver?: (xmlhttp: XMLHttpRequest) => void;
        cancellerReceiver?: (cancel: () => void) => void;
      },
    ): Promise<XMLHttpRequest>;

    readonly UnexpectedStatusException: HTTPExceptionClass<HTTPUnexpectedStatusException>;
    readonly TimeoutException: HTTPExceptionClass<HTTPTimeoutException>;
    readonly BrowserOfflineException: HTTPExceptionClass<HTTPBrowserOfflineException>;
    readonly SecurityException: HTTPExceptionClass<HTTPSecurityException>;
    readonly CancelledException: HTTPExceptionClass<HTTPCancelledException>;
  }
}

// ---------------------------------------------------------------------------
// 3. `Zotero.OSKeyStore` — absent from zotero-types@4.1.3 entirely
//
// Source: docs/09 §1.3, which reads the wrapper's surface off
// chrome/content/zotero/xpcom/osKeyStore.js, and docs/09 §1.7, which is the
// storage design `src/zotero/keychain.ts` implements. Decision D5 makes this
// the *only* place an API key may go, so a missing declaration here is a
// Phase 3 blocker, not a convenience.
//
// `confirmUnencryptedFallback()` and `alertMigrateFailed()` are deliberately
// NOT declared: docs/09 §1.3 names them but documents neither their parameters
// nor their return types, and doc 09 §1.7 tier 4 means this plugin never calls
// the unencrypted-fallback path.
// ---------------------------------------------------------------------------

declare namespace Zotero {
  namespace OSKeyStore {
    /**
     * Encrypt a value with the platform credential store (Windows DPAPI,
     * macOS Keychain, libsecret). Returns the `oskv1:`-prefixed ciphertext.
     *
     * Async, and **may throw** when the OS keystore is unavailable — docs/09
     * §1.3, "Do not assume `encrypt()` always succeeds."
     */
    function encrypt(value: string): Promise<string>;

    /** Decrypt a value produced by {@link encrypt}. Async. docs/09 §1.3. */
    function decrypt(value: string): Promise<string>;

    /**
     * Whether a stored value is one of ours: literally
     * `value.startsWith('oskv1:')` in osKeyStore.js (docs/09 §1.3).
     */
    function isEncrypted(value: string): boolean;

    /**
     * Capability getter. docs/09 §1.3 warns that the startup probe should be a
     * real `encrypt`/`decrypt` round trip rather than a read of this flag.
     */
    const available: boolean;
  }
}

// ---------------------------------------------------------------------------
// 4. `Zotero.Retractions` — absent from zotero-types@4.1.3 entirely
//
// Source: docs/06 §13.3, verified there against
// chrome/content/zotero/xpcom/retractions.js. Only `isRetracted` is declared:
// §13.3 states its synchronous boolean contract explicitly ("line 118,
// synchronous boolean") and makes it mandatory on every item, whereas it gives
// only the names and line numbers of `getData`, `getReasonDescription`,
// `shouldShowCitationWarning` and `libraryHasRetractedItems` — not their
// parameter or return types. Declaring those would be invention; see "Known
// holes" below.
// ---------------------------------------------------------------------------

declare namespace Zotero {
  namespace Retractions {
    /**
     * Synchronous, free, and required on every item before it may contribute
     * a finding to a trend report (docs/06 §13.3).
     * retractions.js line 118.
     */
    function isRetracted(item: Zotero.Item): boolean;
  }
}

// ---------------------------------------------------------------------------
// 5. Zotero 10 plural selection getters
//
// Source: docs/01 §3.4(a)'s replacement table, and docs/01 §12 gotcha 3.
//
// `zotero-types@4.1.3` declares `_ZoteroTypes.ZoteroPane` with an
// `[attr: string]: any` index signature, so *every* member access on a pane
// compiles — including the singular getters that THROW on Zotero 10, and
// including typos. The plural forms therefore appear to "typecheck" today
// while actually resolving to `any`. Declaring them as real members is what
// buys back the checking.
//
// The singular getters are deliberately not touched: they are already declared
// upstream, and docs/01 §12 gotcha 3 forbids modelling them.
// ---------------------------------------------------------------------------

declare namespace _ZoteroTypes {
  interface ZoteroPane {
    /** Zotero 10 replacement for `getSelectedCollection()`. */
    getSelectedCollections(): Zotero.Collection[];
    /** Zotero 10 replacement for `getCollectionTreeRow()`. */
    getCollectionTreeRows(): Zotero.CollectionTreeRow[];
    /** Zotero 10 replacement for `getSelectedLibraryID()`. */
    getSelectedLibraryIDs(): number[];
    /** Zotero 10 replacement for `getSelectedSavedSearch()`. */
    getSelectedSavedSearches(): Zotero.Search[];
  }
}

// ---------------------------------------------------------------------------
// Known holes — deliberately NOT augmented
//
// These are recorded here rather than declared, because closing them would
// mean inventing a signature. Each is a real compile-time or safety gap that a
// later card has to deal with.
//
// (a) `Zotero.PDFWorker` is declared upstream as `let PDFWorker: any;`
//     (zotero-types/types/zotero.d.ts, "Below are not implemented types").
//     It therefore *compiles* but gives no checking at all, and it cannot be
//     augmented: a namespace or a second `let` for the same name is a
//     duplicate-identifier error. docs/06 §3.3.5 fixes the real contract —
//     `getFullText(itemID, maxPages, isPriority?, password?)` resolving to
//     `{ text, extractedPages, totalPages }`. Closing this needs an upstream
//     change to zotero-types, or a local wrapper in `src/zotero/fulltext.ts`
//     that states the return type once. The same applies to the other members
//     of that upstream `any` block: `API`, `Cite`, `Debug`, `Integration`,
//     `ItemFields`, `QuickCopy`, `Schema`, `SearchConditions`, `Styles`,
//     `Sync`, `Translate`, `Translators`.
//
// (b) `libraryID` is `readonly` on `Zotero.Collection`, MUTABLE on
//     `Zotero.Item`. This entry originally claimed both were readonly and
//     predicted a TS2540 in `itemMapper.ts`; `P0-T10` measured it on
//     2026-09-10 and that prediction was wrong. `zotero-types@4.1.3`
//     re-declares `libraryID: number` on `Zotero.Item`, shadowing
//     `Zotero.DataObject`'s `readonly`, so `item.libraryID = libraryID` —
//     exactly the shape docs/01 §5.2 writes — compiles with no cast and no
//     augmentation. On `Zotero.Collection` it is TS2540, so a collection
//     takes its library through the constructor:
//     `new Zotero.Collection({ name, libraryID })`. Nothing to augment;
//     kept here so nobody re-derives the wrong conclusion from
//     `DataObject`'s declaration alone.
//
// (c) `Services.logins.removeLoginAsync()` — docs/09 §1.7's tier-1 code path
//     awaits it, but `nsILoginManager` in zotero-types' generated Gecko
//     bindings declares only the synchronous `removeLogin()`. Whether the
//     async form exists on Firefox 140 ESR could not be determined from the
//     corpus or from the installed `.d.ts`, so nothing is declared. `P0-T23`
//     ("OS keystore and preference round-trip") is where this gets settled at
//     runtime.
//
// (d) `Zotero.Search.addCondition()` is still modelled with the pre-10
//     `required` fourth parameter, which docs/01 §3.4(b) says **throws** on
//     Zotero 10, and `_ZoteroTypes.Search.Conditions` still lists the removed
//     `fulltextWord` while lacking Zotero 10's `groupStart` / `groupEnd`.
//     Nothing here can fix a signature that is wrong rather than missing — an
//     added overload only widens what compiles. `research_helper` does not
//     build saved searches in v1; if that changes, this is a trap.
//
// (e) `Zotero.HTTP.newCookieContext()` and the Zotero 10 fetch-style
//     `Zotero.HTTP.download()` return type are both absent. Neither is used:
//     docs/01 §3.4(e) says this plugin wants `anon: true`, not cookies, and it
//     streams nothing to disk in v1. Declared only if a later card needs them.
//
// (f) `Zotero.Fulltext.getPages()` is declared
//     `(itemID: number) => Promise<false | { total: number }>`, but docs/06
//     §3.3.3 (design decision D-06-3, verified against fulltext.js:2799) needs
//     `indexedPages` from that same object to decide whether a cached
//     full text was truncated. Reading `.indexedPages` is TS2339 today. It is
//     not augmentable: an added overload with the identical parameter list is
//     never reached, because upstream's declaration is resolved first (proven
//     by the overload ordering in the `Zotero.HTTP.request` probe). This needs
//     an upstream fix or a local wrapper in `src/zotero/fulltext.ts`.
//
// (g) `Zotero.DB.executeTransaction`'s second parameter is declared with every
//     member REQUIRED (`{ disbledForeignKeys: boolean; timeout: number;
//     vacuumOnCommit: boolean; inBackup: boolean; onCommit: ...;
//     onRollback: ... }`) and with `disableForeignKeys` misspelled. Passing any
//     subset of options therefore does not compile. `research_helper` calls
//     `executeTransaction(fn)` with no options, so this is currently harmless;
//     it is recorded so nobody wastes time on it later.
//
// This file is a GLOBAL declaration file on purpose: it must contain no
// top-level `import` or `export`, or every `declare namespace` above would
// become module-local and augment nothing.
// ---------------------------------------------------------------------------

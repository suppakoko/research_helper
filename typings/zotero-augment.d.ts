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
 * 5. **Nothing in this file is type-checked. Put assertions in a `.ts` file.**
 *    Measured 2026-10-06 (`P2-T22`): `tsconfig.json` extends
 *    `zotero-types/entries/sandbox/`, which inherits `skipLibCheck: true` from
 *    `entries/base`, and that switch skips type checking of **every** `.d.ts`
 *    in the program — this one included. Appending
 *    `declare const x: ThisTypeDoesNotExistAnywhere;` here leaves
 *    `npm run typecheck` at exit 0; the same line in a `.ts` file under
 *    `typings/` is TS2304. So a declaration below can be internally incoherent
 *    and still "pass", and the only thing that validates any of it is a `.ts`
 *    file that uses it. `scripts/probe-types.ts` is that file, and
 *    `tsconfig.json`'s `include` does cover `scripts` — despite that file's
 *    own header, which says it does not and is stale.
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
// 6. Menu context — the plural collection rows, and the singular one the
//    corpus forbids
//
// Source: docs/08 §2.2's context table (lines 190-191), which lists
// `collectionTreeRows` for `main/library/item` and `main/library/collection`
// and marks `collectionTreeRow` deprecated, and §2.2 line 215, which says in
// as many words: "Never read `context.collectionTreeRow`. Always
// `context.collectionTreeRows`." §2.4's handler block reads the plural at
// lines 340 and 351.
//
// Runtime source of truth, read on 2026-10-06 out of the INSTALLED Zotero's
// own source (`chrome/content/zotero/...` extracted from
// `C:\Program Files\Zotero\app\omni.ja`, application.ini Version 10.0.3,
// BuildID 20260917164924), not inferred from the member's name:
//
//   * `zoteroPane.js` is where the member comes from, not `menuManager.js`.
//     `menuManager.js` builds only the default context — `menuElem`,
//     `setL10nArgs`, `setEnabled`, `setVisible`, `setIcon` (lines 600-634) —
//     and then copies the target's own property DESCRIPTORS over it
//     (`wrappedGetContext`, lines 638-645). Its comment there names this very
//     member as the reason descriptors are copied rather than values: "ZoteroPane's
//     menu contexts define a collectionTreeRow property that throws when read".
//   * `zoteroPane.js`'s `getContext` for `main/library/collection`
//     (lines 4138-4151, inside `buildCollectionContextMenu`) and for
//     `main/library/item` (lines 4689-4703, inside `buildItemContextMenu`)
//     each put `collectionTreeRows` there verbatim — the array returned by
//     `ZoteroPane.getCollectionTreeRows()` (line 2207, JSDoc
//     `@return {CollectionTreeRow[]}`, implemented as
//     `[...selection.selected].sort().map((i) => collectionsView.getRow(i))`,
//     and `getRow()` is declared `Zotero.CollectionTreeRow` upstream in
//     `types/collectionTree.d.ts:12`). Hence `Zotero.CollectionTreeRow[]`,
//     which is also exactly what §5 above declares for the pane getter that
//     produces it.
//   * the same two `getContext`s define the singular `collectionTreeRow` as a
//     getter that **throws** `"collectionTreeRow was removed -- use
//     collectionTreeRows"` when more than one row is selected, and otherwise
//     calls `Zotero.Plugins.warnRemovedAPICall`. Confirmed verbatim; docs/08
//     §2.2's quoted block is accurate.
//
// Why this is a gap and not a nicety: `zotero-types@4.1.3`
// (`types/xpcom/pluginAPI/menuManager.d.ts:112`) declares ONLY the singular
// `collectionTreeRow?: _ZoteroTypes.CollectionTree` and no plural at all, so
// the corpus forbids the one member the compiler offers, and TypeScript's own
// "Did you mean 'collectionTreeRow'?" fix-it steers a reader straight into the
// throwing getter.
//
// **Optional, not required, and that is a deliberate limit.**
// `TargetToContextMap` maps all four library targets — `item`, `collection`,
// `addAttachment`, `addNote` — onto this one `LibraryMenuContext`, and
// `zoteroPane.js`'s `getContext`s for `addAttachment` (line 2302) and
// `addNote` (line 2329) put `items`/`tabType`/`tabSubType`/`tabID` there and
// **no** `collectionTreeRows`. Declaring it required would therefore promise a
// member that is genuinely `undefined` on half the targets that share the
// interface, and `TargetToContextMap` is a `type` alias, so it cannot be
// augmented to split them. Upstream treats the sibling `items?` and
// `collectionTreeRow?` as optional for the same reason. A reader needs
// `?? []`, `?.[0]` or a length check — which is what docs/08 §2.4 line 340
// already does, though its lines 351 onward do not. Note that §2.4's
// unguarded `context.collectionTreeRows[0].ref.id` could not compile in this
// repository under ANY augmentation, optional or required: `tsconfig.json`
// sets `noUncheckedIndexedAccess`, so `rows[0]` is
// `Zotero.CollectionTreeRow | undefined` whatever the member's optionality.
// The form that compiles, measured 2026-10-06, is
// `context.collectionTreeRows?.[0]?.ref.id`.
//
// **Where the assertion for this block lives, and why not here.** `P2-T22`
// `Do` step 3 asks for an assertion that the augmentation compiles. It cannot
// be in this file: rule 5 in the header above. It cannot be in `P2-T22`'s other
// `Files` entry either — that row guesses at a unit spec serving as this
// repository's typings compile-fixture and no unit spec does
// (`test/unit/prefs/schema.test.ts` is `P1-T03`'s preference-schema test).
// `scripts/probe-types.ts` is the repository's typings compile-fixture, it is
// covered by `npm run typecheck`, and it is **not** in `P2-T22`'s `Files`, so
// nothing was added to it. The assertion `P2-T22` measured by hand, and the
// one a follow-up card should park there, is a `main/library/collection`
// handler whose `onCommand` reads `context.collectionTreeRows?.[0]?.ref.id`.
//
// The singular member is re-declared below with its type byte-identical to
// upstream's, purely to attach `@deprecated`. That is the only compiler-visible
// counterpart §2.2's "Never read" can have: `tsc --noEmit` does not fail on a
// deprecated read (it is a suggestion-level diagnostic), so this buys an IDE
// strike-through and a language-service warning, not an error. There is no
// `@typescript-eslint/no-deprecated` in `eslint.config.js` that would promote
// it; adding one is a separate card.
// ---------------------------------------------------------------------------

declare namespace _ZoteroTypes {
  namespace MenuManager {
    interface LibraryMenuContext {
      /**
       * The selected collection-tree rows, in collections-list order.
       *
       * Present on `main/library/item` and `main/library/collection` only
       * (docs/08 §2.2); absent on `main/library/addAttachment` and
       * `main/library/addNote`, which is why it is optional.
       *
       * This is the member to read. The singular `collectionTreeRow` throws
       * when more than one row is selected (docs/08 §2.2 line 215).
       */
      collectionTreeRows?: Zotero.CollectionTreeRow[];

      /**
       * @deprecated docs/08 §2.2 line 215: **never read this.** Zotero 10's
       * `zoteroPane.js` defines it as a getter that throws
       * `"collectionTreeRow was removed -- use collectionTreeRows"` when more
       * than one collection row is selected, and calls
       * `Zotero.Plugins.warnRemovedAPICall` when it does return. Use
       * {@link LibraryMenuContext.collectionTreeRows} instead.
       *
       * Type repeated from `zotero-types@4.1.3`
       * `types/xpcom/pluginAPI/menuManager.d.ts:112` byte-for-byte, because
       * interface merging requires it; see "Known holes" (h) for why that type
       * is itself wrong.
       */
      collectionTreeRow?: _ZoteroTypes.CollectionTree;
    }
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
// (c) SETTLED 2026-09-15 (`P0-T23`): `Services.logins.removeLoginAsync()` does
//     NOT exist on Zotero 10.0.2 / Gecko 140.15.0 — `typeof` is `undefined` in
//     the plugin sandbox, as is `modifyLoginAsync`. zotero-types' generated
//     binding, which declares only the synchronous `removeLogin()`, is
//     therefore correct for 140 and nothing is added here. The async form is
//     expected on Gecko 153+ (Zotero 11); `src/zotero/keychain.ts`
//     feature-detects it at runtime rather than relying on a declaration.
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
// (h) `_ZoteroTypes.MenuManager.LibraryMenuContext.collectionTreeRow` is typed
//     `_ZoteroTypes.CollectionTree` (menuManager.d.ts:112), and
//     `_ZoteroTypes.ZoteroPane.getCollectionTreeRow()` is typed
//     `undefined | CollectionTree` (zoteroPane.d.ts:40). Both are the wrong
//     type, not merely a deprecated one: `zoteroPane.js`'s getter returns
//     `collectionTreeRows[0]`, i.e. a `Zotero.CollectionTreeRow` (the row), not
//     the `CollectionTree` (the tree widget). Because `CollectionTree` carries
//     `[attr: string]: any` (collectionTree.d.ts:6), reading
//     `context.collectionTreeRow.ref.id` compiles **as `any`** — so the member
//     docs/08 §2.2 line 215 forbids is not only the only one upstream offered,
//     it was also unchecked. Not fixable here: interface merging requires the
//     repeated member's type to be identical, so §6 above can attach
//     `@deprecated` to it but cannot correct it. An upstream fix or a local
//     wrapper is the only way out, and `P1-T30` settled that filing the
//     upstream issue is not an agent's call.
//
// (i) `_ZoteroTypes.MenuManager.BaseMenuContext.menuElem` is declared
//     `readonly menuElem: XULElement` — REQUIRED — while docs/08 §2.2 and
//     Zotero 10.0.3's `menuManager.js` (lines 601-603: a `WeakRef` deref,
//     which returns `undefined` once the element is collected) make it
//     optional. `P2-T22` `Do` step 2 asked whether an augmentation can express
//     that. **It can** — TypeScript accepts
//     `interface BaseMenuContext { readonly menuElem?: XULElement }` as a merge
//     and the member becomes optional, measured 2026-10-06 — but doing it
//     breaks `test/integration/menus.spec.ts:432` with TS2375:
//     `menubarContext()` destructures `menuElem` out of a `LibraryMenuContext`
//     and passes it along explicitly, and under
//     `exactOptionalPropertyTypes: true` an explicit `XULElement | undefined`
//     may not be assigned to an optional `menuElem?: XULElement`. That file is
//     outside `P2-T22`'s `Files`, so the merge is NOT applied and
//     `src/ui/menus/registerMenus.ts`'s local `MenuElementContext` narrowing
//     stays as `P1-T19` wrote it. Closing this is its own card: the
//     augmentation, the two-line fix to `menubarContext()`, and then the
//     deletion of that local type.
//
// This file is a GLOBAL declaration file on purpose: it must contain no
// top-level `import` or `export`, or every `declare namespace` above would
// become module-local and augment nothing.
// ---------------------------------------------------------------------------

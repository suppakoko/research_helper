/**
 * The `PrefStore` port — how `core/` reaches preferences without naming
 * `Zotero` (`P1-T03` step 4).
 *
 * **Scope.** `P1-T03`. `docs/07` §2.2 describes this file as the "typed config
 * reader over prefs (no Zotero import; takes a `PrefStore` port)" and §8.5.1
 * closes with the reason it exists: "`core/config.ts` consumes this module
 * through a `PrefStore` port so that `core/` keeps its no-Zotero-globals rule
 * (§2.3)."
 *
 * **The port only, in this card.** `P1-T03` step 4 says "declare the `PrefStore`
 * port in `src/core/config.ts` and implement it in `src/zotero/prefStore.ts`",
 * and no step asks for a config *reader*. The typed reader is
 * `src/prefs/index.ts` (§8.5.1's `getPref` / `setPref` / `clearPref` /
 * `observePref`), which takes this port; a second reader here would be two
 * accessors over one schema, which is the drift §8.5 exists to prevent.
 * `plan/README.md` §5 rule 2 forbids inventing one.
 *
 * ## Why `core/` cannot simply call the wrapper
 *
 * `docs/07` §2.3: "`core/` imports `model/` only. **No Zotero globals.** Where
 * `core/` needs a platform capability (prefs, files, HTTP, clock) it declares a
 * *port* interface and receives an implementation via the container."
 * `eslint.config.js`'s `research-helper/layering/core` override makes the import
 * half mechanical and its `research-helper/zotero-global` override makes the
 * global half mechanical, so this is enforced rather than remembered.
 *
 * The port is deliberately **string-keyed and untyped in its values**. All the
 * typing — the key, the declared type, the default, the bounds, the closed value
 * set, the D5 `secret` flag — lives in `src/prefs/schema.ts`, one layer up. A
 * port that knew about `PrefName` would make every implementation and every test
 * double a second place the schema is restated.
 */

/**
 * The three value types a Mozilla preference can hold.
 *
 * `docs/07` §8.5's `PrefDef.type` has four members, not three: `integer` and
 * `number` are both stored as… numbers, and the distinction exists so
 * {@link ../prefs/index.coerce} can reject `3.5` for an integer pref. Nothing at
 * this layer needs to know which of the two a key is.
 */
export type PrefScalar = boolean | number | string;

/**
 * A handle whose observer is **not installed yet**: running it installs it.
 *
 * This is what `src/zotero/prefStore.ts` returns. `FR-56` and
 * `eslint.config.js`'s `research-helper/scoped-registration` rule make
 * `Zotero.Prefs.registerObserver` callable from `src/zotero/registrations.ts`
 * and nowhere else, precisely so that no registration can exist without the
 * teardown that undoes it (`docs/01` §12 gotcha 10) — and that module's
 * factories return a `ScopedRegistration`, which is **inert until a `Scope`
 * runs it**. So the correct thing for the composition root to do with this
 * variant is *run* it.
 */
export interface ScopedPrefObserverHandle {
  readonly kind: "scoped-registration";
  /**
   * Install the observer and record its teardown, in one statement.
   *
   * Typed as a one-argument function of an **unsatisfiable** parameter because
   * `core/` may not name `src/bootstrap/container.ts`'s `Scope` (`docs/07`
   * §2.3). `src/bootstrap/container.ts`'s `ScopedRegistration` is assignable to
   * this signature without a cast — parameters are contravariant and `never` is
   * assignable to `Scope` — so the implementation side needs none; the
   * composition root, which may name `Scope`, narrows it back once.
   */
  readonly register: (scope: never) => void | Promise<void>;
}

/**
 * A handle whose observer **is already installed**: calling it removes it.
 *
 * This is what {@link createMemoryPrefStore} returns, and the method name is
 * the whole point of `P1-T32` item 4 — see {@link PrefObserverHandle}.
 */
export interface UnsubscribePrefObserverHandle {
  readonly kind: "unsubscribe";
  /** Detach the handler. Idempotent in both shipped implementations. */
  unsubscribe(): void;
}

/**
 * Whatever the platform needs in order to keep one preference observer alive and
 * to undo it later — **discriminated by `kind`** since `P1-T32`.
 *
 * **Why a tag and not a bare `object`, which is what `P1-T03` shipped.** The
 * two implementations return handles that are *semantic opposites*: the Zotero
 * store's call **registers** the observer, the in-memory store's
 * **unregisters** it. Both were functions, both satisfied the old `object`, and
 * `typeof` could not tell them apart — so `src/bootstrap/container.ts`
 * discriminated on **arity**, the only property that separated them, and the
 * cost of guessing wrong was not a type error but the silent removal of the
 * observer that had just been installed: `ncbi.keyPresent` would stop raising
 * the NCBI budget with nothing anywhere to see. `P1-T25` shipped the arity
 * check and reported it as needing a card; this is that card.
 *
 * A tag also closes the hole the arity check left open. Arity is a property of
 * *every* function, so a third implementation returning a one-argument thunk
 * would have been bound as a registration and never undone. `kind` cannot be
 * produced by accident: a handle without it fails to typecheck at the
 * `observe()` return, which is the site that knows which semantic it meant.
 *
 * **This is still a deliberate divergence from `docs/07` §8.5.1**, which
 * sketches `observePref` as returning `Zotero.Prefs.registerObserver`'s
 * `Symbol`. `P1-T03` measured that as unreachable and the reason has not
 * changed; what changed is that the port no longer describes the two reachable
 * shapes as one opaque type.
 */
export type PrefObserverHandle =
  ScopedPrefObserverHandle | UnsubscribePrefObserverHandle;

/**
 * Raw, string-keyed preference storage, as `core/` and `src/prefs/` see it.
 *
 * Keys are **branch-relative** (`src/prefs/keys.ts`'s `PREF_BRANCH` form, with
 * the branch prefix left to the implementation): `"searchYears"`,
 * `"ncbi.keyPresent"`. The implementation adds the branch, so no caller has to
 * remember which of `docs/07` §8.5.1's two conventions it is in.
 *
 * **No credential may pass through this interface.** Decision D5 (`docs/00` §3),
 * `docs/09` §1.7's refusal of tier 4, and `plan/README.md` §5 rule 5. The guard
 * is one layer up, in `src/prefs/index.ts`, where the `secret` flag lives and
 * where every write is schema-checked; this interface is the thing that guard
 * protects.
 */
export interface PrefStore {
  /**
   * The current value of `key`, from the user branch or the shipped default, or
   * `undefined` if neither exists.
   *
   * May return a value of the wrong type — the pane's `preference=` binding
   * stringifies numbers on the way out (`docs/07` §8.5.1, `docs/08` §7.2), so a
   * `maxResults` a user has touched reads back as `"100"`. Coercion is the
   * caller's job and `src/prefs/index.ts` does it.
   */
  get(key: string): PrefScalar | undefined;

  /** Write `key`. Throws if the platform refuses the value's type. */
  set(key: string, value: PrefScalar): void;

  /** Remove the user value, restoring the shipped default if there is one. */
  clear(key: string): void;

  /**
   * Watch `key` for changes.
   *
   * Used only where a change must repaint live UI (`docs/07` §8.5.1: "the
   * provider picker's dependent blocks, and the storage-backend badge"), because
   * everything else is read on demand and so picks up a change on the next run
   * without a restart.
   *
   * The returned {@link PrefObserverHandle} says, in its `kind`, whether the
   * observer is already installed. An implementation must tag the handle with
   * the semantic it actually has; see that type's own comment for what the
   * untagged version cost.
   */
  observe(key: string, handler: (value: unknown) => void): PrefObserverHandle;
}

/**
 * A {@link PrefStore} backed by a `Map`, for tests and for the no-platform case.
 *
 * It ships from the production module rather than from `test/helpers/` for the
 * same two reasons `src/core/clock.ts`'s `createManualClock` does: a double that
 * lives beside its interface cannot drift from it, and more than one later card
 * needs this exact one — `plan/03-phase-2-multi-source-dedup.md` and
 * `plan/04-phase-3-llm-summaries.md` between them call for a "fake `PrefStore`"
 * or a "spying `PrefStore`" in four separate criteria.
 *
 * `observe` records the handler and returns an {@link
 * UnsubscribePrefObserverHandle}, so a test can drive a notification without a
 * platform observer.
 *
 * @param initial - seed entries, branch-relative keys
 */
export function createMemoryPrefStore(
  initial: Readonly<Record<string, PrefScalar>> = {},
): PrefStore & {
  /** The live backing map, for assertions. */
  readonly values: Map<string, PrefScalar>;
  /** Fire every handler registered for `key` with `value`. */
  notify(key: string, value: unknown): void;
} {
  const values = new Map<string, PrefScalar>(Object.entries(initial));
  const watchers = new Map<string, Set<(value: unknown) => void>>();

  return {
    values,
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      values.set(key, value);
    },
    clear(key) {
      values.delete(key);
    },
    observe(key, handler) {
      const set = watchers.get(key) ?? new Set();
      set.add(handler);
      watchers.set(key, set);
      // Tagged `"unsubscribe"`, because the handler is live the moment this
      // returns: there is nothing left to register and the only thing a
      // caller may do with the handle is undo it. The tag is what stops the
      // composition root from *running* it as though it were a registration,
      // which would detach the handler it just attached.
      return {
        kind: "unsubscribe",
        unsubscribe(): void {
          set.delete(handler);
        },
      };
    },
    notify(key, value) {
      for (const handler of watchers.get(key) ?? []) {
        handler(value);
      }
    },
  };
}

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
 * Whatever the platform needs in order to keep one preference observer alive and
 * to undo it later.
 *
 * **Opaque on purpose, and this is a deliberate divergence from `docs/07`
 * §8.5.1.** That section sketches `observePref` as returning the `Symbol` from
 * `Zotero.Prefs.registerObserver` — but `FR-56` and `eslint.config.js`'s
 * `research-helper/scoped-registration` rule make
 * `Zotero.Prefs.registerObserver` callable from `src/zotero/registrations.ts`
 * and nowhere else, precisely so that no registration can exist without the
 * teardown that undoes it (`docs/01` §12 gotcha 10). The Zotero implementation
 * therefore returns `registrations.ts`'s `ScopedRegistration`, which a `Scope`
 * executes and tears down — a *function*, not a `Symbol`.
 *
 * `core/` may not name `src/bootstrap/container.ts`'s types (§2.3), so the port
 * declares the handle as `object`: enough to pass through, not enough to unwrap.
 * The composition root, which may name both, is where it is consumed.
 */
export type PrefObserverHandle = object;

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
 * `observe` records the handler and returns the unsubscribe function as its
 * handle, so a test can drive a notification without a platform observer.
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
      return () => {
        set.delete(handler);
      };
    },
    notify(key, value) {
      for (const handler of watchers.get(key) ?? []) {
        handler(value);
      }
    },
  };
}

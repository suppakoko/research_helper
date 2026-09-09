/**
 * Composition-root lifetime management — the teardown registry (`P0-T07`).
 *
 * `FR-56` says that disabling the plugin must leave no menu item, no observer,
 * no timer and no error in the debug log. A registry that merely *exists* does
 * not achieve that: what achieves it is making the un-torn-down path
 * impossible to express. Three properties do that here.
 *
 * 1. **A registration cannot be described without its teardown.**
 *    `Registration<THandle>` requires `unregister`. There is no overload, no
 *    optional property and no default. Omitting it is a compile error at the
 *    definition site, not a leak discovered by a human clicking
 *    disable/enable five times (`P0-T11`).
 *
 * 2. **Registering and recording the teardown are one operation.**
 *    `Scope.use()` calls `register()` and pushes the matching `unregister()`
 *    in the same statement. There is no window in which a live handle exists
 *    but is unrecorded, so there is nothing to forget between the two.
 *
 * 3. **Nothing outside this file may call a `Zotero.*` register API anyway.**
 *    `eslint.config.js`'s `research-helper/zotero-global` rule confines the
 *    `Zotero` global to `src/zotero/**` plus the three lifecycle entry files.
 *    So a later card's registration has to be built as a `Registration` in
 *    `src/zotero/`, handed to `src/bootstrap/registerUI.ts`, and executed by a
 *    `Scope` — which is why this file names no Zotero API at all and takes its
 *    error reporter as an injected callback instead.
 *
 * That is also why the registry lives in `container.ts` rather than a file of
 * its own: `docs/07` §2.2 fixes the contents of `src/bootstrap/`, and a scope
 * that owns every disposable the composition root creates *is* the lifetime
 * half of the DI container that section names. The service-locator half is not
 * written yet — Phase 1 `create`s this path again (`plan/README.md` §4's
 * sixteen-path list) and adds it there, against real services. Standing up an
 * empty locator now would be dead code with no consumer.
 */

/** A function that undoes exactly one registration. */
export type Teardown = () => void | Promise<void>;

/**
 * One registration and the teardown that undoes it, described together.
 *
 * `THandle` is whatever the platform API hands back — a menu ID string, a
 * notifier observer ID, a pref-observer `Symbol`, a timer ID. It is threaded
 * through so `unregister` receives exactly what `register` produced.
 */
export interface Registration<THandle> {
  /**
   * Human-readable, stable, and unique within its scope. It is what
   * `liveHandles()` reports when teardown does not reach zero, so it should
   * name the thing ("Tools menu item"), not the call ("registerMenu").
   */
  readonly description: string;
  register(): THandle | Promise<THandle>;
  unregister(handle: THandle): void | Promise<void>;
}

/**
 * A `Registration` with its handle type erased, so heterogeneous
 * registrations can sit in one array. Build one with `registration()`.
 */
export type ScopedRegistration = (scope: Scope) => Promise<void>;

/**
 * Erase a `Registration`'s handle type by closing over it.
 *
 * Written as a closure rather than as `Registration<unknown>` on purpose: a
 * method-position `unregister(handle: T)` would be bivariant and would accept
 * a `Registration<string>` where a `Registration<unknown>` is expected,
 * silently widening the handle type the teardown believes it has.
 */
export function registration<THandle>(
  spec: Registration<THandle>,
): ScopedRegistration {
  return async (scope) => {
    await scope.use(spec);
  };
}

/** Identifies a child scope. Window scopes key on the window object itself. */
export type ScopeKey = string | object;

/**
 * A lifetime. Everything registered in a scope is undone, last-registered
 * first, by one `unregisterAll()`.
 *
 * Two scopes exist in this plugin, and `docs/01` §2.4 is the reason: the root
 * scope holds application-scoped registrations made in `startup`, and one
 * child scope per main window holds window-scoped registrations made in
 * `onMainWindowLoad`. Putting a window-scoped thing in the root scope leaks a
 * window per close; the split is structural rather than remembered because
 * `hooks.onMainWindowLoad` is handed the child scope and nothing else.
 */
export interface Scope {
  readonly description: string;

  /** Live handles in this scope and, recursively, in its children. */
  readonly size: number;

  /**
   * Perform a registration and record its teardown in one step.
   *
   * Throws if the scope has already been torn down. If the scope is torn down
   * *while* an async `register()` is in flight, the handle it produced is
   * unregistered immediately and the call throws — a registration that lost
   * the race with shutdown must not survive it.
   */
  use<THandle>(spec: Registration<THandle>): Promise<THandle>;

  /**
   * Record a teardown for something this scope did not register itself —
   * a helper instance to shut down, a listener attached elsewhere.
   *
   * Prefer `use()`. `defer()` exists because not every disposable has a
   * handle-returning registration call, and it is the one place where the
   * "registration and teardown are the same statement" property is the
   * caller's responsibility rather than the type's.
   */
  defer(description: string, teardown: Teardown): void;

  /**
   * Open (or re-open) a nested lifetime under `key`.
   *
   * If a scope already exists for `key` it is torn down first. That is what
   * makes a duplicated `onMainWindowLoad` for one window structurally unable
   * to produce a duplicated menu item — the failure mode `P0-T11` cycles
   * disable/enable five times looking for.
   */
  child(key: ScopeKey, description: string): Promise<Scope>;

  /** Tear down the child at `key`. Returns false if there was none. */
  disposeChild(key: ScopeKey): Promise<boolean>;

  /**
   * Descriptions of everything still live, children included, most recently
   * registered first. `P0-T11` asserts this is empty after `unregisterAll()`.
   */
  liveHandles(): string[];

  /**
   * The single teardown call site. Children first, then this scope's own
   * entries in reverse registration order.
   *
   * Every teardown runs inside its own try/catch: one that throws is reported
   * through `onError` and the rest still run, because a half-torn-down plugin
   * is worse than a noisy one. A failed teardown's entry is dropped rather
   * than retried — there is nothing useful to retry with — so `size` reaches
   * zero either way and `onError` is the only signal that it did not go
   * cleanly.
   */
  unregisterAll(): Promise<void>;
}

export interface ScopeOptions {
  readonly description: string;
  /**
   * Where teardown failures and registry misuse go. Injected because this
   * file may not name `Zotero.debug` (see the header); `src/addon.ts` supplies
   * the real reporter.
   */
  readonly onError: (message: string, error: unknown) => void;
  /**
   * Enables the assertions that only pay for themselves during development:
   * duplicate-description detection inside one scope. `src/addon.ts` passes
   * `__env__ === "development"`.
   */
  readonly strict: boolean;
}

/** Create a root scope. Child scopes come from `Scope.child()`. */
export function createScope(options: ScopeOptions): Scope {
  return new ScopeImpl(options.description, options);
}

interface Entry {
  readonly description: string;
  readonly teardown: Teardown;
}

class ScopeImpl implements Scope {
  private readonly entries: Entry[] = [];
  private readonly children = new Map<ScopeKey, ScopeImpl>();
  private disposed = false;

  constructor(
    public readonly description: string,
    private readonly options: Omit<ScopeOptions, "description">,
  ) {}

  get size(): number {
    let total = this.entries.length;
    for (const child of this.children.values()) {
      total += child.size;
    }
    return total;
  }

  async use<THandle>(spec: Registration<THandle>): Promise<THandle> {
    this.assertLive(`register "${spec.description}"`);

    if (
      this.options.strict &&
      this.entries.some((entry) => entry.description === spec.description)
    ) {
      throw new Error(
        `[research-helper] "${spec.description}" is already registered in scope "${this.description}". ` +
          `Two registrations sharing a description mean one of them will not be reported by liveHandles(), ` +
          `and usually mean a startup path ran twice.`,
      );
    }

    const handle = await spec.register();

    if (this.disposed) {
      // Lost the race with shutdown: undo it rather than leak it.
      await this.runTeardown(spec.description, () => spec.unregister(handle));
      throw new Error(
        `[research-helper] scope "${this.description}" was torn down while registering ` +
          `"${spec.description}"; the registration was undone.`,
      );
    }

    this.entries.push({
      description: spec.description,
      teardown: () => spec.unregister(handle),
    });
    return handle;
  }

  defer(description: string, teardown: Teardown): void {
    this.assertLive(`defer "${description}"`);
    this.entries.push({ description, teardown });
  }

  async child(key: ScopeKey, description: string): Promise<Scope> {
    this.assertLive(`open child scope "${description}"`);
    await this.disposeChild(key);
    const child = new ScopeImpl(description, this.options);
    this.children.set(key, child);
    return child;
  }

  async disposeChild(key: ScopeKey): Promise<boolean> {
    const child = this.children.get(key);
    if (!child) {
      return false;
    }
    this.children.delete(key);
    await child.unregisterAll();
    return true;
  }

  liveHandles(): string[] {
    const own = this.entries.map((entry) => entry.description).reverse();
    const inherited: string[] = [];
    for (const child of this.children.values()) {
      for (const handle of child.liveHandles()) {
        inherited.push(`${child.description} / ${handle}`);
      }
    }
    return [...inherited, ...own];
  }

  async unregisterAll(): Promise<void> {
    this.disposed = true;

    for (const key of [...this.children.keys()].reverse()) {
      const child = this.children.get(key);
      this.children.delete(key);
      if (child) {
        await child.unregisterAll();
      }
    }

    // Splice out one entry at a time so an entry is never run twice, even if a
    // teardown re-enters this method.
    while (this.entries.length > 0) {
      const entry = this.entries.pop();
      if (entry) {
        await this.runTeardown(entry.description, entry.teardown);
      }
    }
  }

  private assertLive(action: string): void {
    if (this.disposed) {
      throw new Error(
        `[research-helper] cannot ${action}: scope "${this.description}" has already been torn down.`,
      );
    }
  }

  private async runTeardown(
    description: string,
    teardown: Teardown,
  ): Promise<void> {
    try {
      await teardown();
    } catch (error) {
      this.options.onError(
        `teardown of "${description}" in scope "${this.description}" threw`,
        error,
      );
    }
  }
}

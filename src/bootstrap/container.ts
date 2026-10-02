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
 * half of the DI container that section names.
 *
 * ## Section 2 — the object graph (`P1-T25`)
 *
 * `P0-T07` left this file saying "the service-locator half is not written yet",
 * because standing up an empty locator would have been dead code. Phase 1
 * built four seams and nothing on the other side of any of them: `P1-T05`
 * reported "nothing yet calls `setHttpClient`", `P1-T04` that `reconfigure()`
 * is in place and "the caller is missing", `P1-T15` that "nobody constructs
 * the sink". {@link installServices} is that caller — the one place that
 * constructs the `HttpClient`, the per-host limiter registry and the progress
 * surfaces, registers every one of their teardowns with a {@link Scope}, and
 * hands `observePref`'s opaque handle back to the scope that can undo it.
 *
 * **This file was extended, not replaced** (`plan/README.md` §4, corrected
 * 2026-09-30). `plan/README.md` lists this path among the sixteen a later card
 * may `create` over a Phase 0 spike, and `P1-T25`'s `Files` row says `modify`
 * for exactly the reason the correction gives: `src/addon.ts` imports
 * `createScope` / `Scope` and `src/zotero/registrations.ts` imports
 * `registration` / `ScopedRegistration`, and **neither file is in `P1-T25`'s
 * `Files` list**. Everything above the section marker is `P0-T07`'s, unchanged.
 *
 * **Why `src/zotero/` is imported here and nowhere lower.** `docs/07` §2.3
 * ranks `zotero/` *above* `core/`, so no `core/` module may name it; the
 * composition root is explicitly "the one place allowed to know all of it".
 * `src/zotero/prefStore.ts` is nonetheless **not** imported — it imports
 * `src/zotero/registrations.ts`, which imports this file, and the cycle would
 * be real even though ESM tolerates it. The `PrefStore` arrives as an argument
 * instead, typed from `src/core/config.ts`.
 *
 * ## Section 3 — one reporter per job (`P1-T31`)
 *
 * `P1-T25` constructed **one** `CompositeProgressReporter` at the root and
 * recorded two consequences in {@link ServiceGraph} itself: §4.1's `done()` is
 * terminal, so that instance reported exactly one job per enabled lifetime of
 * the plugin and silently ignored every later one; and its `dispose()` disposes
 * the sinks it was given, so a per-job tree newed up over the *root's* sinks
 * would have let the first job to finish close the application's progress
 * surfaces out from under every other job. A second search showed a bar that
 * never moved, with no error anywhere.
 *
 * **The shape chosen is per-job sinks behind a factory** —
 * {@link JobProgressFactory.forJob}, which builds a fresh
 * {@link ObservableProgressSink}, a fresh `ZoteroProgressWindowSink` and a
 * fresh tree over them, as one {@link JobProgress} the caller owns. The graph
 * owns only the factory and the registry of jobs still open, so the trap
 * disappears structurally rather than behind a flag: every reporter disposes
 * exactly the sinks that belong to its own job, and `reporter.dispose()` stays
 * the plain thing it reads as.
 *
 * **The alternative was a factory over sinks it does not own** — one popup and
 * one observable stream for the whole plugin, with the application keeping the
 * sinks' lifetime. It was rejected on three measured counts, and the corpus is
 * against it on all three:
 *
 * 1. **`docs/07` §7.7 says "One window per job".** App-scoped sinks give one
 *    window per *plugin*: job 2's completion toast would repaint job 1's line,
 *    and the `openOn`/close-timer state inside `ZoteroProgressWindowSink` is
 *    per-instance, so two jobs would share one close deadline.
 * 2. **`docs/07` §4.5's `subscribe` is `JobHandle.subscribe` — per job.** One
 *    app-scoped {@link ObservableProgressSink} carries no job identity, so two
 *    concurrent jobs interleave on it and a status bar cannot tell which
 *    snapshot is its own. Per-job sinks make `JobProgress.events` the thing
 *    Phase 3's `JobHandle.subscribe` can be implemented over unchanged.
 * 3. **`openOn` is per-pipeline** (`docs/07` §7.7's "Choice per pipeline":
 *    `searchImport` wants `docs/08` §4.4's completion-only toast, `related` and
 *    `audioReport` want §7.7's progress popup) **and it is a constructor
 *    option of `ZoteroProgressWindowSink`.** One shared sink fixes it for the
 *    whole plugin. Making it per-job over shared sinks would mean carrying
 *    `openOn` on every `ProgressSink.update()` — widening the port and editing
 *    `src/zotero/progressWindow.ts`, which is **not in `P1-T31`'s `Files`
 *    list**. Per-job sinks reach the same criterion by construction and touch
 *    neither.
 *
 * What the chosen shape costs: a popup per concurrent job rather than one, and
 * a `JobProgress` whose `dispose()` the caller must run — which is why the
 * factory keeps a registry and the `Scope` disposes whatever is still open at
 * teardown, so `FR-56` does not depend on a pipeline's `finally` block.
 *
 * **`P1-T25`'s "do not construct a second set of sinks at the root" holds
 * exactly as written:** the root now constructs *no* sinks at all, and
 * `installServices` still refuses a second graph.
 */

import { createSystemClock, type Clock } from "../core/clock";
import type { PrefObserverHandle, PrefStore } from "../core/config";
import { ConfigurationError } from "../core/errors";
import {
  createHttpClient,
  getHttpClient,
  setHttpClient,
  type HttpClient,
  type HttpTransport,
} from "../core/http/client";
import { buildUserAgent } from "../core/http/userAgent";
import type { CancellationToken } from "../core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  createObservableProgressSink,
  type ObservableProgressSink,
  type ProgressSink,
} from "../core/jobQueue/progress";
import {
  createLogger,
  DEFAULT_LOG_LEVEL,
  NULL_LOG_SINK,
  type Logger,
  type LogLevel,
  type LogSink,
} from "../core/logger";
import {
  createHostLimiterRegistry,
  installHostLimiters,
  peekHostLimiters,
  resetHostLimiters,
  type HostLimiterRegistry,
} from "../core/rateLimit/hostLimiter";
import { getPref, setPrefStore } from "../prefs";
import {
  ZoteroProgressWindowSink,
  type ProgressWindowHandle,
} from "../zotero/progressWindow";

// ===========================================================================
// 1. The teardown registry — `P0-T07`
// ===========================================================================

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

// ===========================================================================
// 2. The object graph — `P1-T25`
//
// Everything above this marker is `P0-T07`'s teardown registry and is
// unchanged. Everything below constructs the services Phase 1 built and binds
// their lifetimes to a `Scope`.
// ===========================================================================

/**
 * The platform halves the graph cannot build for itself.
 *
 * Every member is a port implementation or a build constant, never a Zotero
 * global: this file is outside `eslint.config.js`'s
 * `research-helper/zotero-global` exemption list, so the `Zotero.*` calls stay
 * in `src/zotero/` and `src/bootstrap/registerUI.ts` passes the results in.
 * That is also what lets `test/unit/bootstrap/container.test.ts` build the
 * whole graph over fakes **at the root**, rather than by patching a module.
 */
export interface ServiceGraphOptions {
  /** `Zotero.HTTP`, from `src/zotero/zoteroApi.ts`'s `createZoteroHttpTransport()`. */
  readonly transport: HttpTransport;
  /**
   * Raw preference access, from `src/zotero/prefStore.ts`'s
   * `createZoteroPrefStore()`. Installed into `src/prefs/index.ts` by
   * {@link installServices}, so every typed `getPref` above this layer works
   * from that moment on.
   */
  readonly prefs: PrefStore;
  /**
   * The plugin version, for the D10 `User-Agent`. `package.json`'s `version`.
   * `buildUserAgent()` rejects anything that is not semver-shaped, so an
   * unsubstituted placeholder fails here rather than on the wire (`docs/02`
   * §2.2).
   */
  readonly version: string;
  /**
   * The progress popup's headline, **already localized**.
   *
   * `ZoteroProgressWindowSink` requires a resolved string — `Zotero.getString()`
   * throws on a plugin key (`docs/08` §8.2.1) and Fluent is async — and no
   * message id for one exists anywhere in `src/i18n/keys.ts`. See the `P1-T25`
   * report: the missing id needs a card, and it is `P1-T32` item 3.
   *
   * Application-scoped on purpose, even though the popup it headlines is now
   * per job (`P1-T31`): it is the product's name for the surface, not the
   * job's. A per-job headline would be the per-job `message`, which the
   * reporter already carries.
   */
  readonly progressHeadline: string;
  /**
   * Where the logger's lines go — `Zotero.debug` behind a `src/zotero/`
   * adapter. Defaults to `NULL_LOG_SINK`, which is correct only for a test.
   */
  readonly logSink?: LogSink;
  /** Defaults to {@link createSystemClock}. A test passes `createManualClock()`. */
  readonly clock?: Clock;
  /**
   * Test seam for the one platform call `ZoteroProgressWindowSink` makes.
   * Omitted in the product, where the sink opens a real
   * `Zotero.ProgressWindow`.
   *
   * Called **once per job** since `P1-T31`, because the popup is per job
   * (`docs/07` §7.7). A test that wants to watch two jobs' windows separately
   * returns a fresh fake from each call.
   */
  readonly openProgressWindow?: () => ProgressWindowHandle;
}

/**
 * What one job's progress needs that the application cannot decide for it.
 *
 * `openOn` moved here from {@link ServiceGraphOptions} in `P1-T31`: `docs/07`
 * §7.7's "Choice per pipeline" makes it a property of the pipeline, and the
 * application-scoped default `"completion"` was correct only while
 * `searchImport` was Phase 1's only pipeline.
 */
export interface JobProgressOptions {
  /**
   * When the popup is raised, per `docs/07` §7.7 vs `docs/08` §4.4.
   *
   * - `"completion"` — §4.4's import behaviour: nothing is drawn until
   *   `done()`, because progress lives in the search window's status bar where
   *   the Cancel button is. `searchImport` passes this.
   * - `"progress"` — §7.7's behaviour for the short pipelines (`related`,
   *   `audioReport`) that have no window of their own.
   *
   * Omitted falls through to `ZoteroProgressWindowSink`'s own default, which
   * is §7.7's `"progress"`. There is deliberately no default *here*: a default
   * at the composition root is how the `"completion"` choice of one pipeline
   * became every pipeline's.
   */
  readonly openOn?: "progress" | "completion";
  /**
   * The job's cancellation token. The reporter goes terminal with
   * `done("cancelled")` when it fires, so every one of this job's surfaces
   * stops without the pipeline having to say so (FR-53).
   */
  readonly token?: CancellationToken;
  /** The job's initial message, already localized. */
  readonly message?: string;
}

/**
 * One job's reporter and the surfaces that belong to it.
 *
 * The caller `dispose()`s it when the job ends — in a `finally`, next to the
 * `done()`. Forgetting to is not a leak the user can see, because the factory's
 * registry is bound to the `Scope` and plugin teardown disposes whatever is
 * still open; it does mean one popup lingering until then.
 */
export interface JobProgress {
  /** What {@link JobProgressFactory.forJob} was called with, for diagnostics. */
  readonly label: string;
  /**
   * `docs/07` §4.1's reporter for this job, and the root of its tree. Children
   * come from `reporter.child(...)` as before.
   */
  readonly reporter: CompositeProgressReporter;
  /**
   * This job's observable stream — `docs/08` §4.4's status bar subscribes to
   * it, and it is the shape `docs/07` §4.5's `JobHandle.subscribe` promises.
   * Per job, which is what §4.5 declares it as.
   */
  readonly events: ObservableProgressSink;
  /** This job's sinks, in fan-out order: the stream, then §7.7's popup. */
  readonly sinks: readonly ProgressSink[];
  /**
   * Close this job's surfaces and latch its tree. Idempotent, and it touches
   * **no other job** — that is the whole point of the per-job shape.
   */
  dispose(): void;
}

/**
 * {@link ServiceGraph.progress} — the thing a pipeline asks for a reporter.
 *
 * It replaces `P1-T25`'s single app-scoped `CompositeProgressReporter`, which
 * could report exactly one job per plugin lifetime. See §3 of this file's
 * header for why the sinks are per job rather than shared.
 */
export interface JobProgressFactory {
  /**
   * Build one job's reporter and surfaces.
   *
   * @param label - the job's name, for diagnostics. It is **not** a
   *   `currentStageKey`: stage keys come from `reporter.child(label, …)`.
   */
  forJob(label: string, options?: JobProgressOptions): JobProgress;
  /** How many jobs have surfaces open. Zero after plugin teardown. */
  readonly openJobs: number;
}

/**
 * The constructed services.
 *
 * Three of them are *also* reachable through the process-wide accessors their
 * own modules already export — `getHttpClient()`, `getHostLimiters()`,
 * `getPrefStore()` — because `docs/13` §2.2 fixes `httpRequest()` as a free
 * function and §7.3 requires one bucket per host for the whole process. They
 * are returned here as well so a caller can be handed them as a parameter,
 * which is what `P1-T25`'s **Do NOT** requires of anything that needs one:
 * two graphs would mean two rate limiters and a host paced twice as fast as
 * its policy allows.
 */
export interface ServiceGraph {
  readonly clock: Clock;
  readonly logger: Logger;
  /** The same store that is now installed in `src/prefs/index.ts`. */
  readonly prefs: PrefStore;
  /** `docs/07` §7.3's one-bucket-per-host registry, already installed. */
  readonly limiters: HostLimiterRegistry;
  /** The client `httpRequest()` now delegates to. */
  readonly http: HttpClient;
  /**
   * Where a pipeline gets a reporter — **one per job** (`P1-T31`).
   *
   * `P1-T25` exposed a single `CompositeProgressReporter` here. §4.1's `done()`
   * is terminal, so that instance served exactly one job per enabled lifetime
   * of the plugin and silently ignored every later one; §3 of this file's
   * header records the measurement and why the sinks are now per job. There
   * are deliberately **no app-scoped `progressSinks` / `progressEvents`
   * members any more**: an app-scoped observable stream carries no job
   * identity, and `docs/07` §4.5 declares `subscribe` on `JobHandle`.
   *
   * ```ts
   * const job = graph.progress.forJob("searchImport", { openOn: "completion" });
   * try {
   *   job.reporter.child("fetch", 0, 0.6).setProgress(1, 2);
   *   job.reporter.done("succeeded");
   * } finally {
   *   job.dispose();
   * }
   * ```
   */
  readonly progress: JobProgressFactory;
}

/** The four `logLevel` values of `docs/07` §8.5, as a type guard. */
function isLogLevel(value: string): value is LogLevel {
  return (
    value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug"
  );
}

/**
 * Run one `observePref` handle into `scope` — the typed-away seam, made real.
 *
 * `docs/07` §8.5.1 sketches `observePref` as returning
 * `Zotero.Prefs.registerObserver`'s `Symbol`. `P1-T03` measured that as
 * unreachable: `FR-56` and `eslint.config.js`'s
 * `research-helper/scoped-registration` rule confine that API to
 * `src/zotero/registrations.ts`, whose factory returns a
 * {@link ScopedRegistration} — a *function*, not a `Symbol` — and `core/` may
 * not name this file's types, so `src/core/config.ts` declares the handle as
 * the opaque `object` of {@link PrefObserverHandle}. The composition root may
 * name both, so this is where it is unwrapped.
 *
 * **Two shapes reach here and they are opposites, which is a port defect
 * rather than a convenience.** Both are functions and both satisfy `object`:
 *
 * | implementation | handle | calling it |
 * |---|---|---|
 * | `createZoteroPrefStore()` | `prefObserverRegistration(...)`, a `ScopedRegistration` | **registers** the observer |
 * | `createMemoryPrefStore()` | the unsubscribe thunk | **unregisters** it |
 *
 * So `typeof handle === "function"` cannot tell "register me" from "undo me",
 * and guessing wrong silently removes the observer that was just installed —
 * `ncbi.keyPresent` would stop raising the NCBI budget, with nothing to see.
 * They are discriminated on **arity**, which is the only property that
 * distinguishes them: a `ScopedRegistration` takes the scope, an unsubscribe
 * thunk takes nothing. Both branches are asserted in
 * `test/unit/bootstrap/container.test.ts`. The real fix is a discriminated
 * return type on `PrefStore.observe`, which touches `src/core/config.ts` —
 * outside `P1-T25`'s `Files` list — and is reported as needing a card.
 *
 * @param scope - the lifetime the observer is bound to
 * @param handle - whatever `PrefStore.observe` returned
 * @param description - what `liveHandles()` reports for the thunk shape; the
 *   `ScopedRegistration` shape carries its own
 * @throws ConfigurationError if the handle is not callable at all, which means
 *   a third `PrefStore` implementation has appeared with a third convention
 */
export async function adoptPrefObserverHandle(
  scope: Scope,
  handle: PrefObserverHandle,
  description: string,
): Promise<void> {
  const callable: unknown = handle;
  if (typeof callable !== "function") {
    throw new ConfigurationError(
      `[research-helper] the PrefStore returned a ${typeof callable} as the ` +
        `observer handle for "${description}". src/core/config.ts's ` +
        `PrefObserverHandle is opaque, and the only shapes the composition ` +
        `root can bind to a Scope are a ScopedRegistration (arity 1) and an ` +
        `unsubscribe thunk (arity 0).`,
      { description },
    );
  }
  if (callable.length >= 1) {
    // The Zotero shape: inert until a Scope runs it, which performs
    // `Zotero.Prefs.registerObserver` and records `unregisterObserver` in one
    // statement.
    await (callable as ScopedRegistration)(scope);
    return;
  }
  // The in-memory shape: already registered, so only the undo is left. This is
  // the one place the "registration and teardown are the same statement"
  // property is the caller's responsibility, which is what `defer` is for.
  scope.defer(description, callable as Teardown);
}

/** What {@link createJobProgressFactory} closes over. */
interface JobProgressFactoryDeps {
  readonly clock: Clock;
  /** {@link ServiceGraphOptions.progressHeadline}. */
  readonly headline: string;
  /** {@link ServiceGraphOptions.openProgressWindow}, if a test supplied one. */
  readonly openWindow?: (() => ProgressWindowHandle) | undefined;
}

/**
 * The factory and the one teardown that covers every job it has handed out.
 *
 * Returned as a pair so `disposeAll` stays off {@link JobProgressFactory}: the
 * only caller that should be able to close *other* jobs' surfaces is the
 * `Scope`, and a pipeline holding the factory must not be able to.
 */
interface JobProgressFactoryBundle {
  readonly factory: JobProgressFactory;
  /** Dispose every job still open, most recent first. Idempotent. */
  disposeAll(): void;
}

/**
 * Build {@link ServiceGraph.progress}.
 *
 * Each `forJob` call constructs the job's own sinks and its own tree over
 * them, so that:
 *
 *  - `docs/07` §7.7's "One window per job" is what actually happens, including
 *    the per-instance close deadline and `openOn` the popup carries;
 *  - `docs/08` §4.4's status bar subscribes to *its* job's stream, which is
 *    `docs/07` §4.5's per-job `JobHandle.subscribe` shape;
 *  - `reporter.dispose()` releases exactly one job's surfaces, so the first
 *    job to finish cannot close a second job's popup — the trap that makes the
 *    obvious per-job-tree-over-shared-sinks fix wrong.
 *
 * The registry is what makes `FR-56` independent of a pipeline remembering its
 * `finally`: plugin teardown disposes whatever is still open.
 */
function createJobProgressFactory(
  deps: JobProgressFactoryDeps,
): JobProgressFactoryBundle {
  // Insertion-ordered, so `disposeAll` can run newest-first and match the
  // scope's own last-in-first-out discipline.
  const open = new Set<CompositeProgressReporter>();

  const factory: JobProgressFactory = {
    get openJobs(): number {
      return open.size;
    },
    forJob(label: string, options: JobProgressOptions = {}): JobProgress {
      // The dialog sink first — `docs/08` §4.4's status bar is where the Cancel
      // button lives — then §7.7's transient popup.
      const events = createObservableProgressSink();
      const popup = new ZoteroProgressWindowSink({
        clock: deps.clock,
        headline: deps.headline,
        // Spread rather than `openOn: options.openOn`: `tsconfig.json`'s
        // `exactOptionalPropertyTypes` rejects an explicit `undefined`, and
        // omitting it is what lets the sink's own §7.7 default stand.
        ...(options.openOn !== undefined && { openOn: options.openOn }),
        ...(deps.openWindow !== undefined && { openWindow: deps.openWindow }),
      });
      const sinks: readonly ProgressSink[] = [events, popup];
      const reporter = new CompositeProgressReporter({
        clock: deps.clock,
        sinks,
        ...(options.token !== undefined && { token: options.token }),
        ...(options.message !== undefined && { message: options.message }),
      });
      open.add(reporter);
      return {
        label,
        reporter,
        events,
        sinks,
        dispose(): void {
          // Dropped from the registry first, so a teardown running
          // concurrently cannot dispose it twice — `dispose()` is idempotent
          // either way, and this keeps `openJobs` honest.
          open.delete(reporter);
          reporter.dispose();
        },
      };
    },
  };

  return {
    factory,
    disposeAll(): void {
      for (const reporter of [...open].reverse()) {
        open.delete(reporter);
        // `CompositeProgressReporter.dispose()` swallows a sink that throws,
        // so one bad surface cannot stop the rest from closing.
        reporter.dispose();
      }
    },
  };
}

/**
 * Build the object graph once and bind every disposable to `scope`.
 *
 * Construction order is `P1-T25` step 1's, and it is a dependency order rather
 * than a preference: the `PrefStore` has to be installed before the limiter
 * registry reads `ncbi.keyPresent`, and the registry has to exist before the
 * `HttpClient` can be given its `limiterFor`.
 *
 * 1. Install the `PrefStore` into `src/prefs/index.ts`, so the typed
 *    accessors work for everything built after that line.
 * 2. Build the per-host limiter registry (`docs/07` §7.3) and install it
 *    process-wide, then run its `ncbi.keyPresent` observer handles into the
 *    scope — see {@link adoptPrefObserverHandle}.
 * 3. Build the `HttpClient` over the injected transport, the D10 `User-Agent`,
 *    a **timeout getter** reading `timeoutSeconds` (`core/` may not import
 *    `src/prefs/`, so the pref is read here and passed as a function, which is
 *    also what makes a live pref change take effect without a restart), the
 *    registry's `limiterFor`, the clock and the logger. Install it with
 *    `setHttpClient()` so `docs/13` §2.2's `httpRequest()` has something to
 *    delegate to.
 * 4. Build the per-job progress factory and bind the jobs it hands out to the
 *    scope. **No sink is constructed at this level** — see §3 of this file's
 *    header.
 *
 * `retryFor` is deliberately **not** supplied: `docs/07` §7.3 names a per-host
 * attempt cap and publishes no number, `P1-T04` and `P1-T05` both refused to
 * invent one, and `P1-T28` owns it behind a human gate. Absent a policy the
 * client makes exactly one attempt, which is the documented behaviour and not
 * a silent default.
 *
 * Teardown is registered in construction order and runs last-in-first-out, so
 * the graph comes apart in the reverse of the order it went together: the
 * surfaces close, the client is uninstalled, the registry is detached, the
 * pref observers are unregistered, and the `PrefStore` is detached last. After
 * `scope.unregisterAll()` the process-wide holders are all empty again, which
 * is what makes a disable/enable cycle construct a clean graph rather than
 * fail on `installHostLimiters`' second-install guard (`P0-T11`'s five-cycle
 * discipline, at the composition root rather than per registration).
 *
 * @param scope - the root scope `src/addon.ts` owns
 * @param options - the platform halves; see {@link ServiceGraphOptions}
 * @returns the graph, for a caller that must be handed a service as a parameter
 * @throws ConfigurationError if a graph is already standing — two graphs mean
 *   two rate limiters and a host paced at twice its policy, which is a
 *   correctness bug and not untidiness (`P1-T25` **Do NOT**)
 */
export async function installServices(
  scope: Scope,
  options: ServiceGraphOptions,
): Promise<ServiceGraph> {
  // Checked before anything is mutated, so a double call leaves the standing
  // graph intact instead of half-replacing it.
  if (peekHostLimiters() !== undefined || getHttpClient() !== undefined) {
    throw new ConfigurationError(
      "[research-helper] a service graph is already installed. docs/07 §7.3 " +
        "requires one TokenBucket per host for the whole process and docs/13 " +
        "§2.2 one outbound choke point; a second graph would pace the same " +
        "host twice as fast as its policy allows. Tear the first one down " +
        "through its Scope.",
    );
  }

  const clock = options.clock ?? createSystemClock();

  // 1. Preferences first: everything below reads one.
  setPrefStore(options.prefs);
  scope.defer("PrefStore (src/prefs)", () => {
    setPrefStore(undefined);
  });

  const logger = createLogger({
    sink: options.logSink ?? NULL_LOG_SINK,
    clock,
    // A getter, not a value: `docs/08` §7.3's "Verbose debug logging" checkbox
    // writes `logLevel` live. `getPref` already falls back to §8.5's default
    // for an absent or out-of-set value; `isLogLevel` only narrows `string` to
    // `LogLevel` without a cast.
    //
    // The try/catch is for exactly one case: a line logged *after* teardown
    // has detached the `PrefStore`, when `getPref` throws
    // `ConfigurationError`. A logger that threw while something was shutting
    // down would put an error in the debug log, which is the thing `FR-56`
    // says must not be there.
    level: () => {
      try {
        const raw = getPref("logLevel");
        return isLogLevel(raw) ? raw : DEFAULT_LOG_LEVEL;
      } catch {
        return DEFAULT_LOG_LEVEL;
      }
    },
  });

  // 2. The per-host buckets, and the observer that raises NCBI's budget when a
  //    key is entered while Zotero is running.
  const limiters = createHostLimiterRegistry({ clock, prefs: options.prefs });
  installHostLimiters(limiters);
  scope.defer("per-host rate limiters (docs/07 §7.3)", () => {
    resetHostLimiters();
  });
  for (const [index, handle] of limiters.observers.entries()) {
    await adoptPrefObserverHandle(
      scope,
      handle,
      `rate-limit key-presence observer ${index + 1}`,
    );
  }

  // 3. The one outbound choke point.
  const http = createHttpClient({
    transport: options.transport,
    userAgent: buildUserAgent(options.version),
    // `docs/07` §8.5: `timeoutSeconds` × 1000. Read through a function on every
    // request, because `core/` may not import `src/prefs/` (§2.3) and because a
    // pref change must not need a restart.
    timeoutMs: () => getPref("timeoutSeconds") * 1000,
    limiterFor: (host) => limiters.limiterFor(host),
    clock,
    logger,
  });
  setHttpClient(http);
  scope.defer("HttpClient (docs/13 §2.2)", () => {
    setHttpClient(undefined);
  });

  // 4. The per-job progress factory. No sink is constructed here: a job's
  //    surfaces are built by `forJob`, so one job's completion cannot close
  //    another's popup and `openOn` is the pipeline's choice (`P1-T31`; §3 of
  //    this file's header has the reasoning and the rejected alternative).
  const progress = createJobProgressFactory({
    clock,
    headline: options.progressHeadline,
    openWindow: options.openProgressWindow,
  });
  // Every reporter still open is disposed here, which releases its token
  // subscription, latches its tree and calls `dispose()` on its sinks. That is
  // what stops a `Zotero.ProgressWindow` outliving the plugin that opened it
  // (`docs/01` §12 gotcha 10) even for a pipeline that never reached its
  // `finally`.
  scope.defer("job progress reporters and their surfaces", () => {
    progress.disposeAll();
  });

  logger.info("services installed", {
    hosts: limiters.hosts.length,
    observers: limiters.observers.length,
  });

  return {
    clock,
    logger,
    prefs: options.prefs,
    limiters,
    http,
    progress: progress.factory,
  };
}

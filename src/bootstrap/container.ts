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
 * `src/zotero/progressWindow.ts` and `src/zotero/zoteroApi.ts` are imported —
 * the second since `P1-T32`, for the two log facades
 * {@link createZoteroLogSink} composes — and neither imports
 * `src/zotero/registrations.ts`, so neither closes a cycle.
 * `src/zotero/prefStore.ts` is nonetheless **not** imported: it *does* import
 * `src/zotero/registrations.ts`, which imports this file, and the cycle would
 * be real even though ESM tolerates it. The `PrefStore` arrives as an argument
 * instead, typed from `src/core/config.ts`.
 *
 * ## Section 2b — the four platform seams (`P1-T32`)
 *
 * `P1-T25` had to bind four seams from inside its own two files because no
 * card's `Files` named the other side, and recorded each one at its call site:
 * the log sink dropped `Zotero.debug`'s level, had no `reportError` channel at
 * all, and added a second log prefix one character from `core/`'s; and
 * `observePref`'s handle had to be discriminated on **arity** because the port
 * typed two semantic opposites as one opaque `object`. `P1-T32` closes all
 * four. The level and the error console arrive through
 * {@link createZoteroLogSink} over the two facades `src/zotero/zoteroApi.ts`
 * now exports; the handle arrives tagged, and
 * {@link adoptPrefObserverHandle} reads the tag; and the progress headline
 * arrives as a {@link ProgressHeadlineSource} that this file awaits once,
 * instead of as the brand name `P1-T25` passed with a comment.
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
 *
 * ## Section 4 — the adapters, the pipelines and the key store (`P1-T16`)
 *
 * **Four cards in a row shipped working, fully tested modules the installer did
 * not contain, because nothing constructed them.** Measured each time: the
 * installer stayed byte-identical and the bundled script held **zero**
 * occurrences of their key symbols. The four were `P1-T06`'s key store,
 * `P1-T09`'s PubMed adapter, `P1-T10`'s record mapper and `P1-T17`'s provenance
 * record and note writer. `P1-T16` step 7 is where the first three stop being
 * unreachable: {@link installServices} now also
 *
 * 1. runs `docs/09` §1.7's **startup keystore probe** and, on a tier-1 verdict
 *    only, builds the `SecretStore` — `src/zotero/keychain.ts` says in as many
 *    words that "nothing calls this at startup yet. `src/bootstrap/container.ts`
 *    is outside `P1-T06`'s `Files` list, so the probe ships unwired";
 * 2. reconciles `ncbi.keyPresent` from the keystore **before** the limiter
 *    registry reads it, because that flag is what selects between `docs/07`
 *    §7.3's unkeyed and keyed NCBI budgets and a flag left stale by a key
 *    removed outside Zotero would pace NCBI at 8 req/s against a 3 req/s
 *    ceiling (`docs/02` §3.1);
 * 3. builds `P1-T10`'s record mapper with `keepRaw` wired from the
 *    `logRequestBodies` preference — `sources/` may not read a preference, so
 *    the composition root is the only place that value can come from;
 * 4. builds `P1-T09`'s adapter over the client, the clock, that mapper and the
 *    key store, and hands it to `registerSources()`, which until now was called
 *    from nowhere;
 * 5. builds `P1-T16`'s pipeline registry and the per-job
 *    {@link PipelineContext} factory, which is the thing `P1-T22` will ask for.
 *
 * **What is still unreachable after this card, and why.** `P1-T17`'s
 * `src/core/provenance.ts` and `src/zotero/notes.ts` have no construction site
 * here: assembling the record needs the import's own counts (FR-8, and
 * `P1-T22`'s `Do NOT`: "do not write the provenance note before the import
 * finishes"), and neither path is in `P1-T16`'s `Files` list. `P1-T17`'s own
 * report puts the site in "the card this one blocks", which is `P1-T22`.
 *
 * **Why the key store is built here and not in `registerUI.ts`.** `registerUI.ts`
 * chooses the platform *implementations* and is not in `P1-T16`'s `Files` list;
 * more to the point, `createKeychainSecretStore()` takes no arguments and
 * `probeAndRecordBackend()` needs the `PrefStore` already installed — both are
 * facts about construction order inside this function, which is the thing this
 * file owns. No new {@link ServiceGraphOptions} member was needed, so
 * `registerUI.ts` compiles unchanged.
 */

import type { Cache } from "../core/cache/cache";
import { createSystemClock, type Clock } from "../core/clock";
import type { PrefObserverHandle, PrefStore } from "../core/config";
import { ConfigurationError, StorageError } from "../core/errors";
import {
  createHttpClient,
  getHttpClient,
  setHttpClient,
  type HttpClient,
  type HttpTransport,
} from "../core/http/client";
import { retryPolicyFromBudget, type RetryPolicy } from "../core/http/retry";
import { buildUserAgent } from "../core/http/userAgent";
import {
  createCancellationTokenSource,
  type CancellationToken,
  type CancellationTokenSource,
} from "../core/jobQueue/cancellation";
import type { JobRecord } from "../core/jobQueue/jobRecord";
import {
  createJobQueue,
  createRunningWork,
  type JobQueue,
  type ResumeGuards,
} from "../core/jobQueue/queue";
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
  CROSSREF_HOST,
  installHostLimiters,
  peekHostLimiters,
  resetHostLimiters,
  type HostLimiterRegistry,
} from "../core/rateLimit/hostLimiter";
import type { SecretStore } from "../core/secretStore";
import type { SecretBackendChoice } from "../ui/dialogs/secretBackendDialog";
import type { PipelineRegistry } from "../pipeline/registry";
import type { OpenRouterProvider } from "../llm/openrouter/openRouterProvider";
import {
  createModelCatalogue,
  createModelPriceSource,
  type ModelPriceSource,
} from "../llm/shared/modelCatalogue";
import {
  createPrivacyPolicy,
  isPrivacyMode,
  loadStrictestPrivacyPolicy,
  readCollectionPrivacySettings,
  writeCollectionPrivacySettings,
  type CollectionRef,
  type LoadPrivacyPolicyDeps,
  type PrivacyMode,
  type PrivacyPolicy,
} from "../pipeline/shared/privacyPolicy";
import {
  createBudgetGuard,
  createCeilingsResumeGuard,
  createConfirmResumeGuard,
  createSessionSpendCounter,
  withBudget,
  type ResumeGuardDeps,
  type RunBudgetGuard,
  type SessionSpendCounter,
} from "../pipeline/shared/budget";
import {
  createCheckpointWriter,
  type CheckpointWriter,
} from "../pipeline/shared/checkpoint";
import { createEgressResumeGuard } from "../pipeline/shared/egressDisclosure";
import {
  createSkipCachedGuard,
  reconcilePromptVersions,
} from "../pipeline/summarize/summaryCache";
import {
  createJobNoticeRouter,
  type JobNoticeRouter,
} from "../pipeline/summarize/summarizePipeline";
import {
  createDeferredTrendReportSurface,
  remainingFromCheckpoint,
  type DeferredTrendReportSurface,
  type TrendReportOutput,
} from "../pipeline/trendReport/trendReportPipeline";
import type {
  ConfigReader,
  LLMRouter,
  Pipeline,
  PipelineContext,
  PipelineId,
} from "../pipeline/types";
import { getPref, setPrefStore } from "../prefs";
import { createArxivSource } from "../sources/arxiv/arxivSource";
import { createArxivRecordMapper } from "../sources/arxiv/mapper";
import { createBiorxivSource } from "../sources/biorxiv/biorxivSource";
import { createBiorxivRecordMapper } from "../sources/biorxiv/mapper";
import { createCrossrefSource } from "../sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../sources/crossref/mapper";
import { createEuropePmcSource } from "../sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../sources/europepmc/mapper";
import { createPubmedRecordMapper } from "../sources/pubmed/mapper";
import { recommendRoutineStore } from "../pipeline/recommend/profileCall";
import { createPubmedSource } from "../sources/pubmed/pubmedSource";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry";
import { createSemanticScholarRecordMapper } from "../sources/semanticscholar/mapper";
import { createSemanticScholarSource } from "../sources/semanticscholar/semanticscholarSource";
// `src/zotero/keychain.ts` is **not** imported statically. See
// `installSecretStore`: it runs `Components.Constructor(...)` in its module
// body, which is a `ReferenceError` in plain Node and would take down every
// layer-1 test whose module graph reaches this file.
import {
  createCollectionSettingsStore,
  type CollectionSettingsStore,
} from "../zotero/db";
import {
  ZoteroProgressWindowSink,
  type ProgressWindowHandle,
} from "../zotero/progressWindow";
import {
  debug as zoteroDebug,
  logError as zoteroLogError,
} from "../zotero/zoteroApi";
import {
  createZoteroSearchImportWriter,
  registerPipelines,
} from "./registerPipelines";
import {
  installPluginDatabase,
  type PluginDatabase,
  type PluginDatabaseSource,
} from "./pluginDatabase";
import { registerProviders, type LLMServices } from "./registerProviders";
import { registerSources, type ShippedSourceAdapters } from "./registerSources";

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
 * `core/`'s {@link LogSink} over Help → Debug Output Logging and the Mozilla
 * error console — the real sink, and `P1-T32` items 1, 2 and 5 together.
 *
 * It composes the two facades of `src/zotero/zoteroApi.ts` and adds nothing:
 *
 * - **`write` forwards the level.** `docs/07` §10.3 documents the second
 *   argument as passed "straight through as `Zotero.debug`'s second argument",
 *   which was impossible until `P1-T32` gave the facade one. Before that every
 *   line of ours landed at Zotero's default 3, so `docs/08` §7.3's log-level
 *   control had nothing to act on *on the Zotero side*.
 * - **`reportError` is implemented at all.** §10.3's "`Logger.error()`
 *   additionally calls `Zotero.logError()`" had no implementation anywhere:
 *   `Zotero.logError` was named nowhere in `src/zotero/`, and
 *   `src/core/logger.ts`'s `sink.reportError?.(line)` is an optional call, so
 *   the gap was silent. An error a bug report asks the user to paste was not in
 *   `Zotero.getErrors()`.
 * - **One prefix.** The line arrives carrying `src/core/logger.ts`'s
 *   `LOG_PREFIX` and the facade no longer adds a second, differently spelled
 *   one of its own.
 *
 * **Built here rather than in `src/zotero/`** for the reason the composition
 * root exists: a `LogSink` is not a platform capability, it is the *wiring* of
 * two of them onto a `core/` port, and `P1-T32`'s `Do NOT` closes
 * `zoteroApi.ts` to anything beyond its two facades. It also moves the sink
 * from `src/bootstrap/registerUI.ts`, where `P1-T25` had to put the lossy
 * version, into the file whose unit test can import it.
 *
 * @returns a sink whose two channels are `Zotero.debug` and `Zotero.logError`
 */
export function createZoteroLogSink(): LogSink {
  return {
    write(line: string, zoteroLevel: 1 | 2 | 3 | 4): void {
      zoteroDebug(line, zoteroLevel);
    },
    reportError(line: string): void {
      zoteroLogError(line);
    },
  };
}

/**
 * Where the progress popup's headline comes from, when it is a Fluent message
 * rather than a literal.
 *
 * **Why this is a resolver and not a string.** `ZoteroProgressWindowSink`
 * requires an already-localized headline — `Zotero.getString()` *throws* on a
 * plugin key (`docs/08` §8.2.1), because a plugin's `.ftl` lives in
 * `L10nRegistry` and not in that synchronous bundle — and Fluent's own API is
 * `async`. {@link installServices} is `async` too, so the resolution happens
 * exactly once, at startup, and the per-job factory (which is **not** async,
 * `docs/07` §7.7's one popup per job) is handed the resolved string.
 *
 * **What the resolver may not do is fail quietly.** `P1-T25` passed
 * `config.addonName` with a comment, so a Korean UI got the English brand name
 * with nothing in the log to say the string had never been looked up.
 * {@link fallback} is still used when {@link resolve} yields nothing, because a
 * popup with no headline is worse than an English one, but
 * {@link installServices} logs the substitution at `warn` with the message id —
 * so the gap is in the debug log a bug report carries rather than in a comment.
 */
export interface ProgressHeadlineSource {
  /**
   * The Fluent id, for the `warn` line when resolution yields nothing.
   *
   * The product passes exactly one value — `research-helper-progress-headline`,
   * the popup surface's only headline id since `P1-T33`, from
   * `src/i18n/keys.ts`'s `L10N_PROGRESS_HEADLINE` by way of
   * `src/bootstrap/registerUI.ts`. The type stays `string` rather than
   * `FluentMessageId`, which would make a retired id a compile error here too —
   * `P1-T33` found no record of a decision either way and tightening it is
   * outside that card's `Files`, so it is reported rather than done.
   */
  readonly messageId: string;
  /**
   * Resolve the headline. `undefined` means it resolved in **no** locale of
   * the formatter's chain — `src/i18n/ftl.ts` never returns an identifier as a
   * stand-in for a string (`FR-55`), so this is the only failure shape.
   */
  resolve(): Promise<string | undefined>;
  /** What the popup carries if {@link resolve} yields nothing. */
  readonly fallback: string;
}

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
   * The progress popup's headline — a literal, or a
   * {@link ProgressHeadlineSource} that resolves one from Fluent.
   *
   * `ZoteroProgressWindowSink` requires a resolved string: `Zotero.getString()`
   * throws on a plugin key (`docs/08` §8.2.1) and Fluent is async. `P1-T32`
   * item 3 added the message id `research-helper-progress-headline`, so the
   * product now passes a source and {@link installServices} awaits it once at
   * startup; a plain string stays accepted because a unit test has no Fluent.
   *
   * Application-scoped on purpose, even though the popup it headlines is now
   * per job (`P1-T31`): it is the product's name for the surface, not the
   * job's. A per-job headline would be the per-job `message`, which the
   * reporter already carries.
   *
   * **One surface, therefore one id (`P1-T33`).** The surface is `docs/07`
   * §7.7's first one — the `Zotero.ProgressWindow`, one per job — and `docs/08`
   * §4.4's "completion toast" is that same window, not a second surface with a
   * header of its own: §8.2.2 found no toast mechanism anywhere in Zotero 7–10,
   * so the only thing §4.4 adds is *when* the window opens, which is
   * {@link JobProgressOptions.openOn}. `P1-T33` retired
   * `research-helper-import-toast-header` on that reasoning, leaving
   * `research-helper-progress-headline` as the only headline id;
   * `src/i18n/keys.ts`'s `L10N_PROGRESS_HEADLINE` carries the argument and
   * `src/bootstrap/registerUI.ts` is where it is named.
   */
  readonly progressHeadline: string | ProgressHeadlineSource;
  /**
   * Where the logger's lines go. The product passes
   * {@link createZoteroLogSink}; a test passes a capturing sink. Defaults to
   * `NULL_LOG_SINK`, which is correct only for a test.
   */
  readonly logSink?: LogSink;
  /**
   * The plugin database (`P3-T33`; `plan/00` §6 item 249, owner,
   * 2026-10-21): `src/zotero/db.ts`'s opener, path and cache blob store,
   * passed by `src/bootstrap/registerUI.ts`. {@link installServices} opens the
   * one connection through `installPluginDatabase`
   * (`src/bootstrap/pluginDatabase.ts`) and closes it in its teardown.
   * Omitted in a unit test of the graph: then there is no database, the job
   * queue stays storeless and the cache stores nothing.
   */
  readonly pluginDatabase?: PluginDatabaseSource;
  /**
   * The shipped prompt versions (`PROMPT_VERSIONS`, `src/prompts/bundled.ts`),
   * for `docs/07` §9.3 trigger 1 (`P3-T26`). A loader, because `bundled.ts`
   * imports the `.md` prompt files and no unit test's module graph may reach
   * it; `src/bootstrap/registerUI.ts` passes a lazy `import()`. Omitted in a
   * unit test of the graph: then the startup comparison does not run.
   */
  readonly promptVersions?: () => Promise<Readonly<Record<string, string>>>;
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
  /**
   * The degradation dialog (`docs/09` §1.7, `P3-T03`): asked only when the
   * startup keystore probe fails, and awaited before any store is installed.
   * `src/bootstrap/registerUI.ts` passes `openSecretBackendDialog` from
   * `src/ui/dialogs/secretBackendDialog.ts` over the main window. Omitted in a
   * unit test of the graph: then a failed probe installs no store, which is
   * the declined choice and never a silently selected tier.
   */
  readonly chooseSecretBackend?: () => Promise<SecretBackendChoice>;
  /**
   * The plugin lifetime's one session spend counter (`docs/06` §11.4,
   * `P3-T16`), which every job's budget guard shares (`P3-T35`).
   * `src/bootstrap/registerUI.ts` passes the counter its Usage readout reads.
   * Omitted in a unit test of the graph: then the graph builds its own.
   */
  readonly sessionSpend?: SessionSpendCounter;
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
  /**
   * `docs/09` §1.7's tier-1 key store, or `undefined` when the startup probe did
   * not reach tier 1 (`P1-T16`).
   *
   * **`undefined` is a normal outcome, not an error.**
   * `src/zotero/keychain.ts`'s `createKeychainSecretStore` says to "build this
   * store only on a tier-1 verdict; on any other verdict Phase 1 has no store to
   * offer, which is `docs/11` §1's scope and not an oversight" — tiers 2 and 3
   * are `P3-T03`'s. Every consumer in Phase 1 treats an absent store as "no
   * key", which `docs/02` §3.1 makes a working configuration.
   */
  readonly secrets: SecretStore | undefined;
  /** `docs/07` §11.1's registry, filled by `registerSources()`. */
  readonly sources: SourceRegistry;
  /** `docs/07` §11.3's registry, filled by `registerPipelines()`. */
  readonly pipelines: PipelineRegistry;
  /**
   * Where a caller gets one job's {@link PipelineContext} — the thing `P1-T22`
   * asks for before it calls `pipeline.run()`.
   *
   * One per job, for the same reason the reporter is (`P1-T31`): the context
   * *contains* the reporter, so an app-scoped context would carry an app-scoped
   * reporter and report exactly one job per plugin lifetime.
   */
  readonly pipelineContext: PipelineContextFactory;
  /**
   * The LLM layer `registerProviders()` built (`P3-T06`): the settings port,
   * the provider registry, the base-URL resolver and `docs/07` §4.3's
   * `LLMRouter`, which every job's `PipelineContext.llm` carries.
   */
  readonly llm: LLMServices;
  /**
   * The job queue's persistent half (`P3-T34`, `docs/07` §7.6): job records,
   * states, checkpoints and startup recovery. Built here with no store;
   * {@link database} attaches the `job` table's store once the plugin
   * database is open and migrated, and detaches it before the connection
   * closes (`P3-T33`; until then `src/bootstrap/registerUI.ts` did).
   */
  readonly jobs: JobQueue;
  /**
   * The plugin database, opened once here and shared by every store
   * (`P3-T33`; `plan/00` §6 item 249). `ready` is the background
   * open-and-migrate; `src/bootstrap/registerUI.ts` publishes the provenance
   * store from it.
   */
  readonly database: PluginDatabase;
  /**
   * `docs/07` §4.1's cache over `cache_entry` (`P3-T33`), the instance every
   * job's `PipelineContext.cache` carries. Stores nothing when there is no
   * database.
   */
  readonly cache: Cache;
  /**
   * `docs/07` §4.5's `ConfigReader` (`P3-T35`; owner, item 272(a)): the
   * read-only view of `getPref` every job's `PipelineContext.config` carries.
   */
  readonly config: ConfigReader;
  /**
   * The session spend counter every job's budget guard shares (`P3-T35`):
   * {@link ServiceGraphOptions.sessionSpend}, or the graph's own.
   */
  readonly sessionSpend: SessionSpendCounter;
  /**
   * `collection_settings` (`docs/07` §8.3, `P3-T15`) on the one connection,
   * usable before the database is ready: each call waits for it. Without a
   * database every call rejects with `StorageError`, so a privacy override
   * that cannot be read gives a strict policy, never the global mode
   * (`loadPrivacyPolicy`). The summarize surface (`P3-T29`) writes "don't ask
   * again for this collection" through it.
   */
  readonly collectionSettings: CollectionSettingsStore;
  /**
   * The one model price source (owner, 2026-10-23, `plan/00` §6 item
   * 278(b); `docs/07` §4.3's note of that date): the last catalogue snapshot
   * with the user price table over it, the documented table until one has
   * loaded. The budgeted router prices every reservation from it; the pane's
   * model suggestions refresh it; the cost dialog (`P3-T29`) must price from
   * it too, so the dialog and the reservations agree.
   */
  readonly modelPrices: ModelPriceSource;
  /**
   * The job queue's `JobNotifier` (`P3-T29`; owner, item 251): routes a pause
   * to the run that owns the job; `src/bootstrap/registerUI.ts` installs the
   * visible "jobs resumed" notice through `setResumedNotice`.
   */
  readonly jobNotices: JobNoticeRouter;
  /**
   * The trend-report jobs `recover()` re-queued and `installServices` is
   * running with no window (`P4-T20` step 0c; owner, `plan/00` §6 item
   * 324(a)): the report window's session finds its collection's run here and
   * attaches to it, so a pause waiting since the restart is asked when the
   * window opens.
   */
  readonly resumedReports: ResumedReportRuns;
}

/** One trend-report job resumed after a restart and running with no window. */
export interface ResumedReportRun {
  readonly jobId: string;
  readonly libraryID: number;
  readonly collectionKey: string;
  /** The run's surface: `attach` a window to it. */
  readonly surface: DeferredTrendReportSurface;
  /** The window's Cancel: a user cancel of this run. */
  cancel(): void;
}

/** {@link ServiceGraph.resumedReports}. */
export interface ResumedReportRuns {
  /** The collection's resumed run still going, if any. */
  find(libraryID: number, collectionKey: string): ResumedReportRun | undefined;
}

/** What {@link createResumedJobRunner} needs; each is read when a job runs. */
export interface ResumedJobRunnerDeps {
  readonly jobs: () => Pick<JobQueue, "get">;
  readonly pipelines: () => Pick<PipelineRegistry, "list">;
  readonly openJob: (options: QueuedPipelineJobOptions) => Promise<PipelineJob>;
  readonly logger: Logger;
}

/** {@link createResumedJobRunner}'s handle. */
export interface ResumedJobRunner extends ResumedReportRuns {
  /** Run a job `recover()` re-queued; not awaited (`installServices`' note). */
  run(jobId: string): void;
  /** A running job's deferred surface: `TrendReportPipelineDeps.surfaces`. */
  surfaceOf(jobId: string): DeferredTrendReportSurface | undefined;
  /** Cancel every run as a shutdown and wait for each to end. */
  stopAll(): Promise<void>;
}

/**
 * The runner of the jobs `recover()` re-queues (`P4-T18` step 6; changed
 * 2026-11-01 by `P4-T20` step 0c — owner, `plan/00` §6 item 324(a); item
 * 322(e)). Each job runs through `Pipeline.run` in its record's context, on
 * its own cancellation source, with a {@link DeferredTrendReportSurface}: a
 * pause with no window open is not answered "stop" — the job stays
 * `paused`, keeps its checkpoint and every paid-for result, and the question
 * waits for the report window, which finds the run with
 * {@link ResumedReportRuns.find} and attaches to it.
 * {@link ResumedJobRunner.stopAll} (plugin teardown) cancels each run's token
 * with `{ kind: "shutdown" }` — the pipeline then leaves the record for
 * `recover()` — and waits for every run to end, so none goes on against a
 * closing database.
 *
 * Constructed by `installServices`, which calls `run` from the queue's
 * `resumed` notice, hands `surfaceOf` to `buildPipelineSet` as the
 * trend-report pipeline's `surfaces`, publishes the runner as
 * {@link ServiceGraph.resumedReports}, and calls `stopAll` in its teardown.
 */
export function createResumedJobRunner(
  deps: ResumedJobRunnerDeps,
): ResumedJobRunner {
  const runs = new Map<string, ResumedReportRun>();
  const live = new Map<CancellationTokenSource, Promise<void>>();
  let stopping = false;

  return {
    run(jobId) {
      if (stopping) return;
      const source = createCancellationTokenSource();
      const running = (async () => {
        const record = await deps.jobs().get(jobId);
        if (record?.status !== "queued") return;
        const pipeline = deps
          .pipelines()
          .list()
          .find((candidate) => candidate.id === record.pipelineId);
        if (pipeline === undefined || !pipeline.resumable) return;
        const input = record.input as {
          readonly libraryID?: unknown;
          readonly collectionKey?: unknown;
        };
        const collection =
          typeof input.libraryID === "number" &&
          typeof input.collectionKey === "string"
            ? { libraryID: input.libraryID, collectionKey: input.collectionKey }
            : undefined;
        if (source.token.isCancellationRequested) return;
        const surface = createDeferredTrendReportSurface(source.token);
        runs.set(record.id, {
          jobId: record.id,
          libraryID: collection?.libraryID ?? 0,
          collectionKey: collection?.collectionKey ?? "",
          surface,
          cancel: () => {
            source.cancel({ kind: "user" });
          },
        });
        try {
          const job = await deps.openJob({
            pipelineId: pipeline.id,
            token: source.token,
            record,
            ...(collection !== undefined && { collection }),
            openOn: "completion",
          });
          try {
            const output = await (pipeline as Pipeline<unknown, unknown>).run(
              record.input,
              job.context,
            );
            if (record.pipelineId === "trendReport") {
              surface.finish(output as TrendReportOutput);
            }
          } finally {
            await job.checkpoints?.flush().catch(() => undefined);
            job.dispose();
          }
        } finally {
          runs.delete(record.id);
        }
      })()
        .catch((error: unknown) => {
          deps.logger.warn("a resumed job could not be run", {
            jobId,
            reason: error instanceof Error ? error.name : typeof error,
          });
        })
        .finally(() => {
          live.delete(source);
          source.dispose();
        });
      live.set(source, running);
    },
    surfaceOf: (jobId) => runs.get(jobId)?.surface,
    find: (libraryID, collectionKey) =>
      [...runs.values()].find(
        (run) =>
          run.libraryID === libraryID && run.collectionKey === collectionKey,
      ),
    async stopAll() {
      stopping = true;
      const going = [...live];
      for (const [source] of going) source.cancel({ kind: "shutdown" });
      await Promise.allSettled(going.map(([, running]) => running));
    },
  };
}

/** What {@link PipelineContextFactory.forJob} is asked for. */
export interface PipelineJobOptions {
  /** Which pipeline this job runs. Used for the job id and the progress label. */
  readonly pipelineId: PipelineId;
  /**
   * The job's cancellation token. The caller owns the
   * `CancellationTokenSource` — it is the thing the Cancel button fires — and
   * the reporter goes terminal with `done("cancelled")` when it does.
   */
  readonly token: CancellationToken;
  /**
   * When the progress popup is raised, `docs/07` §7.7 vs `docs/08` §4.4.
   *
   * There is deliberately no default: `JobProgressOptions.openOn` explains that
   * a default at the composition root is how `searchImport`'s `"completion"`
   * choice became every pipeline's.
   */
  readonly openOn?: "progress" | "completion";
  /** The job's initial message, already localized. */
  readonly message?: string;
}

/** One job's context and the surfaces that belong to it. */
export interface PipelineJob {
  readonly jobId: string;
  /** `docs/07` §4.5's context, ready to hand to `pipeline.run()`. */
  readonly context: PipelineContext;
  /** This job's reporter and sinks, for a caller that wants `events`. */
  readonly progress: JobProgress;
  /**
   * The job's own budget guard — the same object as `context.budget` — with
   * the members the cost dialog needs besides (`raiseLimit` for "continue",
   * `usage` for the readout, `check` for a pre-flight ceiling). `P3-T35`.
   */
  readonly budget: RunBudgetGuard;
  /**
   * The throttled writer `context.checkpoint` goes through, for a job opened
   * with a {@link QueuedPipelineJobOptions.record}; `undefined` otherwise.
   * The job's owner flushes it when the job stops, and passes it as
   * `runPooledItems`' `checkpoint` sink so a stage boundary is written at
   * once (`docs/07` §7.6). `P3-T35`.
   */
  readonly checkpoints: CheckpointWriter | undefined;
  /** Close this job's surfaces. Idempotent; touches no other job. */
  dispose(): void;
}

/**
 * What {@link PipelineContextFactory.openJob} is asked for: a job's options,
 * plus what makes its context the job's own (`P3-T35`).
 */
export interface QueuedPipelineJobOptions extends PipelineJobOptions {
  /**
   * The job's record in the queue (`P3-T34`), when it has one. Then the
   * context's `jobId` is the record's id, `checkpoint()` writes to the record,
   * `resumeState` is the record's checkpoint, and the budget guard's run
   * counter starts from the record's `usage`. Its `pipelineId` must be
   * {@link PipelineJobOptions.pipelineId}.
   */
  readonly record?: JobRecord;
  /**
   * The collection the job works on, when it has one: its
   * `collection_settings` privacy override is applied (it can only tighten
   * the global mode), and a store that cannot answer gives a strict policy.
   */
  readonly collection?: CollectionRef;
  /**
   * The collections a job's one item belongs to, for a job over items rather
   * than a collection — the item pane's one-item run (owner, `plan/00` §6
   * item 305(a); `docs/09` §3.5's note of 2026-10-29). The policy is then the
   * strictest of the global mode, {@link QueuedPipelineJobOptions.collection}'s
   * override and every listed collection's override
   * (`loadStrictestPrivacyPolicy`); with any row unreadable, strict. Absent
   * or empty: no further collection.
   */
  readonly itemCollections?: readonly CollectionRef[];
}

/**
 * Builds one {@link PipelineContext} per job.
 *
 * Separate from {@link JobProgressFactory} rather than folded into it because a
 * context is a `pipeline/` type and the progress factory is a `core/` one; the
 * composition root is the only place allowed to know both (`docs/07` §2.3).
 */
export interface PipelineContextFactory {
  /**
   * A job over no collection and with no record — Phase 1's `searchImport`,
   * run directly. Its privacy policy is the global `privacy.mode`, which is
   * what {@link openJob} gives a job with no collection; its `checkpoint()`
   * is a no-op, because there is no record to write to.
   */
  forJob(options: PipelineJobOptions): PipelineJob;
  /**
   * A job with a record or over a collection (`P3-T35`): asynchronous because
   * the collection's privacy override is read from the plugin database. A job
   * that works on a collection must be opened here, never with {@link forJob}.
   *
   * @throws ConfigurationError when `record.pipelineId` is not
   *   `options.pipelineId`
   */
  openJob(options: QueuedPipelineJobOptions): Promise<PipelineJob>;
}

/**
 * Resolve {@link ServiceGraphOptions.progressHeadline} to the string the popup
 * carries.
 *
 * A literal passes through. A {@link ProgressHeadlineSource} is awaited, and if
 * it yields nothing the declared fallback is used **and logged at `warn` with
 * the message id** — `P1-T32`'s `Do` step 4: "do not fall back to a brand name
 * silently, which is what today's code does with a comment". A thrown resolver
 * is treated the same way rather than failing startup: the plugin losing its
 * menus because a string did not resolve would be a worse outcome than a popup
 * headlined in English, and `FR-56`'s "no error in the debug log" is about
 * teardown, not about a diagnosed substitution.
 *
 * The `warn` line is the whole deliverable of the "not silent" requirement, so
 * it names the id, which is what makes the failure actionable: a missing
 * message, a bundle that was never inserted, and a locale with no chain to
 * `en-US` are three different bugs and the id is in all three reports.
 */
async function resolveProgressHeadline(
  source: string | ProgressHeadlineSource,
  logger: Logger,
): Promise<string> {
  if (typeof source === "string") return source;
  let resolved: string | undefined;
  try {
    resolved = await source.resolve();
  } catch (e) {
    logger.warn("progress headline lookup threw; falling back to en-US text", {
      messageId: source.messageId,
      err: e,
    });
    return source.fallback;
  }
  if (resolved === undefined) {
    logger.warn("progress headline resolved in no locale; using the fallback", {
      messageId: source.messageId,
      fallback: source.fallback,
    });
    return source.fallback;
  }
  return resolved;
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
 * not name this file's types, so the handle crosses the boundary as
 * `src/core/config.ts`'s {@link PrefObserverHandle}. The composition root may
 * name both, so this is where it is unwrapped.
 *
 * **Two shapes reach here and they are opposites:**
 *
 * | implementation | `kind` | calling it |
 * |---|---|---|
 * | `createZoteroPrefStore()` | `"scoped-registration"` | **registers** the observer |
 * | `createMemoryPrefStore()` | `"unsubscribe"` | **unregisters** it |
 *
 * **Discriminated by tag since `P1-T32`, and by arity before it.** Both
 * handles used to be bare functions satisfying `object`, so `typeof` could not
 * tell "register me" from "undo me" and the only property that separated them
 * was how many parameters they declared. Guessing wrong did not fail: it
 * silently removed the observer that had just been installed, and
 * `ncbi.keyPresent` would stop raising the NCBI budget with nothing anywhere
 * to see. Arity also left a hole, because every function has one — a third
 * implementation returning a one-argument thunk would have been *run* as a
 * registration. `src/core/config.ts` now tags the handle at the `observe()`
 * return, which is the only site that knows which semantic it meant, and this
 * function reads the tag.
 *
 * @param scope - the lifetime the observer is bound to
 * @param handle - whatever `PrefStore.observe` returned
 * @param description - what `liveHandles()` reports for the unsubscribe shape;
 *   the `"scoped-registration"` shape carries its own
 * @throws ConfigurationError if the handle carries neither tag. **Unreachable
 *   through the type system** — that is what the union bought — and kept as a
 *   runtime guard for the untyped edges, because the alternative to refusing is
 *   leaking an observer nothing will undo. `test/unit/bootstrap/container.test.ts`
 *   still asserts it, through a cast, and says there why the test is now
 *   redundant rather than deleted.
 */
export async function adoptPrefObserverHandle(
  scope: Scope,
  handle: PrefObserverHandle,
  description: string,
): Promise<void> {
  switch (handle.kind) {
    case "scoped-registration": {
      // Inert until a Scope runs it, which performs
      // `Zotero.Prefs.registerObserver` and records `unregisterObserver` in
      // one statement. The narrowing is from `(scope: never) => …` back to
      // `ScopedRegistration`: `core/` declared the parameter unsatisfiable
      // because it may not name `Scope`, and this is the one place that may.
      await (handle.register as ScopedRegistration)(scope);
      return;
    }
    case "unsubscribe": {
      // Already registered, so only the undo is left. This is the one place
      // the "registration and teardown are the same statement" property is the
      // caller's responsibility, which is what `defer` is for.
      const teardown: Teardown = () => {
        handle.unsubscribe();
      };
      scope.defer(description, teardown);
      return;
    }
    default: {
      // `handle` is `never` here, so the tag is read back off an unnarrowed
      // alias: a handle that reaches this line came through a cast or across
      // the sandbox boundary, not from a typechecked `PrefStore`.
      const untagged = handle as { readonly kind?: unknown };
      throw new ConfigurationError(
        `[research-helper] the PrefStore returned an observer handle for ` +
          `"${description}" tagged ${JSON.stringify(untagged.kind)}. ` +
          `src/core/config.ts's PrefObserverHandle has exactly two variants, ` +
          `"scoped-registration" (inert; the Scope runs it) and "unsubscribe" ` +
          `(already installed; the Scope undoes it), and a handle the ` +
          `composition root cannot bind is an observer FR-56 would never ` +
          `undo.`,
        { description },
      );
    }
  }
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
          popup.releaseJob();
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

/** What {@link createPipelineContextFactory} closes over. */
interface PipelineContextDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sources: SourceRegistry;
  readonly progress: JobProgressFactory;
  /** The one router (`P3-T06`); every job's context carries the same instance. */
  readonly llm: LLMRouter;
  /** The one cache (`P3-T33`); every job's context carries the same instance. */
  readonly cache: Cache;
  /** The one `ConfigReader` (`P3-T35`); every job's context carries it. */
  readonly config: ConfigReader;
  /** The one session counter every job's fresh budget guard shares (`P3-T35`). */
  readonly sessionSpend: SessionSpendCounter;
  /** What `loadPrivacyPolicy` reads: the global mode and `collection_settings`. */
  readonly privacy: LoadPrivacyPolicyDeps;
  /** The job queue whose records a queued job's checkpoint is written to. */
  readonly jobs: Pick<JobQueue, "writeCheckpoint">;
}

/**
 * Build {@link ServiceGraph.pipelineContext} — `docs/07` §4.5's context, per job.
 *
 * ## Since `P3-T35`: every member but `tts` and `zotero` is real
 *
 * *(Added 2026-10-23, `P3-T35`; `docs/07` §4.5's note of that date.)* The two
 * sections below record Phase 1's state and are kept for their reasoning; the
 * members they list as unfilled are now filled, each from what
 * {@link installServices} built once:
 *
 * - `cache`, `llm` and `config` — one instance each, shared by every job. `llm`
 *   is the router `withBudget` wraps (step 6d), so a call that passes
 *   `budget: ctx.budget` is reserved and settled, and one that does not is
 *   refused before anything is sent (owner, 2026-10-23, `plan/00` §6 item
 *   278(a)).
 * - `budget` — a **fresh** `createBudgetGuard` per job over the **one**
 *   session counter: two jobs never share a run counter, and both feed the
 *   same session total.
 * - `privacy` — `loadPrivacyPolicy`: a job over a collection gets the stricter
 *   of the global mode and the collection's override, and strict when the
 *   override cannot be read; a job over none gets the global mode, unless it
 *   names its item's collections (`itemCollections`, item 305(a)), when it
 *   gets the strictest of those overrides and the global mode
 *   (`loadStrictestPrivacyPolicy`).
 * - `checkpoint` / `resumeState` — bound to the job's `JobRecord` when it has
 *   one ({@link PipelineContextFactory.openJob}); the no-op otherwise.
 *
 * ## The seven members Phase 1 cannot fill, and what they are set to
 *
 * §4.5's `PipelineContext` names `cache`, `budget`, `llm`, `tts`, `zotero`,
 * `config` and `privacy`. `src/pipeline/types.ts`'s header has the measurement:
 * three of those types are declared in doc 07 but implemented by no module yet,
 * and **four are named nowhere else in the corpus at all**, so they are forward
 * aliases to `unknown` there. They are therefore set to `undefined` here, and
 * because the type is `unknown` a pipeline cannot read one without writing a
 * narrowing that would make the gap obvious at the point of use.
 *
 * That is the honest shape: Phase 1 ships no cache (Phase 2), no budget guard
 * and no LLM router (Phase 3), no TTS (Phase 5) and no declared privacy or
 * config port. `searchImport` reads `token`, `progress`, `logger`, `clock`,
 * `sources` and `checkpoint`, and nothing else.
 *
 * ## `checkpoint()` is a no-op, by instruction
 *
 * `P1-T16`'s **Do NOT**: "do not implement `checkpoint()`/`resumeState` for
 * real. Phase 3 owns the persistent queue; accept the members and make
 * `checkpoint()` a no-op, with `resumable: false`." It is a resolved promise
 * rather than a thrown error so the pipeline can call it at every stage boundary
 * exactly as §4.5 requires, which is what makes Phase 3's queue a *caller*
 * rather than a rewrite.
 *
 * ## The job id
 *
 * `docs/07` §5.2's `JobRecord.id` is Phase 3's, and the corpus declares no
 * generator, so this one is local and documented rather than borrowed: the
 * pipeline id, the clock's epoch milliseconds and a per-graph sequence number.
 * The sequence number is what keeps two jobs started in the same millisecond
 * distinct — `createManualClock()` makes that the common case in a test, not a
 * rare one.
 */
function createPipelineContextFactory(
  deps: PipelineContextDeps,
): PipelineContextFactory {
  let sequence = 0;

  /** One job: its context, its surfaces, its guard and its checkpoint writer. */
  const build = (
    options: PipelineJobOptions,
    privacy: PrivacyPolicy,
    record: JobRecord | undefined,
  ): PipelineJob => {
    sequence += 1;
    const jobId =
      record?.id ??
      `${options.pipelineId}-${String(deps.clock.now())}-${String(sequence)}`;
    // `P3-T16`'s guard, fresh for this job (its own run counter) over the one
    // session counter. A record's `usage` is what earlier attempts spent.
    const budget = createBudgetGuard({
      session: deps.sessionSpend,
      ...(record !== undefined && { resumedFrom: record.usage }),
    });
    // `P3-T34`'s throttled writer, bound to this job's record.
    const checkpoints =
      record === undefined
        ? undefined
        : createCheckpointWriter({
            queue: deps.jobs,
            jobId: record.id,
            clock: deps.clock,
          });
    const progress = deps.progress.forJob(options.pipelineId, {
      token: options.token,
      ...(options.openOn !== undefined && { openOn: options.openOn }),
      ...(options.message !== undefined && { message: options.message }),
    });

    const context: PipelineContext = {
      jobId,
      token: options.token,
      progress: progress.reporter,
      // Bound with the job id, so every line a pipeline logs can be traced to
      // one run without the pipeline having to remember to add it.
      logger: deps.logger.child({ jobId, pipelineId: options.pipelineId }),
      clock: deps.clock,
      sources: deps.sources,
      // `docs/07` §4.3's router (`P3-T06`, owner item 248): the one instance
      // `installServices` holds — `registerProviders`' router under
      // `withBudget` (`P3-T35`) — shared by every job.
      llm: deps.llm,
      // `docs/07` §4.1's cache over the plugin database (`P3-T33`): the one
      // instance `installPluginDatabase` built, shared by every job.
      cache: deps.cache,
      // `docs/07` §4.5's `PrivacyPolicy` (`P3-T15`, owner item 267), loaded
      // for this job by the caller (`P3-T35`): see `forJob` and `openJob`.
      privacy,
      // `docs/07` §4.3's `BudgetGuard` (`P3-T16`): this job's own guard.
      budget,
      // `docs/07` §4.5's `ConfigReader` (owner item 272(a), `P3-T35`).
      config: deps.config,
      // Not Phase 3's: TTS is Phase 5's and `ZoteroFacade` is declared
      // nowhere (`src/pipeline/types.ts`'s header).
      tts: undefined,
      zotero: undefined,
      // `docs/07` §4.5 / §7.6: written into the job's record, throttled to
      // one write per 2 s (`P3-T34`'s writer). A job with no record has
      // nothing to write into, so its checkpoint stays `P1-T16`'s no-op.
      checkpoint:
        checkpoints === undefined
          ? (): Promise<void> => Promise.resolve()
          : (state: unknown): Promise<void> => checkpoints.checkpoint(state),
      resumeState:
        record === undefined ? undefined : (record.checkpoint ?? undefined),
    };

    return {
      jobId,
      context,
      progress,
      budget,
      checkpoints,
      dispose(): void {
        progress.dispose();
      },
    };
  };

  /** `loadPrivacyPolicy`'s rule for a job over no collection: the global mode. */
  const globalPolicy = (): PrivacyPolicy =>
    createPrivacyPolicy(deps.privacy.globalMode());

  return {
    forJob(options: PipelineJobOptions): PipelineJob {
      return build(options, globalPolicy(), undefined);
    },

    async openJob(options: QueuedPipelineJobOptions): Promise<PipelineJob> {
      const { record, collection, itemCollections } = options;
      if (record !== undefined && record.pipelineId !== options.pipelineId) {
        throw new ConfigurationError(
          `[research-helper] job ${record.id} is a "${record.pipelineId}" ` +
            `record; it cannot be opened as "${options.pipelineId}"`,
        );
      }
      // The stricter of the global mode and the collection's override; with
      // an item's collections (item 305(a)), the strictest of them all.
      const privacy = await loadStrictestPrivacyPolicy(deps.privacy, [
        ...(collection === undefined ? [] : [collection]),
        ...(itemCollections ?? []),
      ]);
      return build(options, privacy, record);
    },
  };
}

/** What {@link createSpendResumeGuards} needs. */
export interface SpendResumeGuardDeps {
  /** The one session counter, which the ceilings guard judges against. */
  readonly session: SessionSpendCounter;
  /**
   * The summarize pipeline's estimate of a record's remaining work, over its
   * checkpoint (`P3-T29`). Absent until that pipeline exists.
   */
  readonly remaining?: ResumeGuardDeps["remaining"];
}

/**
 * `ResumeGuards.confirm` and `ResumeGuards.ceilings` (`P3-T16`), installed by
 * the composition root (`P3-T35`) — **only once the remaining-work estimate
 * exists**. Both judge a resumed job by what is left to do, which only the
 * pipeline can price; a guard built over an invented estimate would either
 * resume spending nobody confirmed or hold back every job for a reason that
 * is not true. So without `remaining` this returns neither, the queue keeps
 * naming them in `missingResumePrerequisites()`, and `recover()` resumes
 * nothing (`plan/00` §6 item 250). `P3-T29` passes its estimate here.
 *
 * @param deps - see {@link SpendResumeGuardDeps}
 * @returns both guards, or none
 */
export function createSpendResumeGuards(
  deps: SpendResumeGuardDeps,
): Partial<Pick<ResumeGuards, "confirm" | "ceilings">> {
  const { remaining } = deps;
  if (remaining === undefined) return {};
  return {
    confirm: createConfirmResumeGuard({ remaining }),
    ceilings: createCeilingsResumeGuard({ remaining, session: deps.session }),
  };
}

/**
 * `collection_settings` (`P3-T15`) on the plugin database's one connection,
 * usable before the open-and-migrate has settled: each call waits for it.
 *
 * With no database this run — none passed, or the open failed — every call
 * rejects with `StorageError`. `loadPrivacyPolicy` turns that into a strict
 * policy, so an override that cannot be read never reads as "no override".
 * Built here rather than in `installPluginDatabase` (whose file is not
 * `P3-T35`'s); it adds no connection and no teardown of its own, and after the
 * database's teardown a call fails the same way.
 *
 * @param database - the graph's plugin database
 * @returns the store
 */
function createDeferredCollectionSettings(
  database: Pick<PluginDatabase, "ready">,
): CollectionSettingsStore {
  let store: CollectionSettingsStore | undefined;
  const open = async (): Promise<CollectionSettingsStore> => {
    const ready = await database.ready;
    if (ready === undefined) {
      throw new StorageError(
        "[research-helper] the plugin database is not available, so " +
          "collection_settings cannot be read or written",
      );
    }
    store ??= createCollectionSettingsStore(ready.connection);
    return store;
  };
  return {
    get: async (libraryID, collectionKey) =>
      (await open()).get(libraryID, collectionKey),
    put: async (libraryID, collectionKey, settings) =>
      (await open()).put(libraryID, collectionKey, settings),
    delete: async (libraryID, collectionKey) =>
      (await open()).delete(libraryID, collectionKey),
  };
}

/**
 * The HTTP client's `retryFor`, built from `docs/07` §7.3's retry cells.
 *
 * `plan/00` §6 item 228 (owner, 2026-10-20). The cells are the `retry` member
 * of each `HOST_POLICIES` row, read through the registry's `policyFor` — the
 * same rows the buckets were built from — and turned into a policy by
 * `src/core/http/retry.ts`'s `retryPolicyFromBudget`, so no number is written
 * here (`plan/README.md` §5 rule 4).
 *
 * **A host gets a policy only when it has a limiter as well.** Every
 * `HOST_POLICIES` row has both today, so the condition changes nothing for a
 * shipped host; it is what makes "a retry never bypasses the limiter" a
 * property of this function rather than of the table's current contents.
 * `src/core/http/client.ts` issues an attempt for a host with no limiter
 * unpaced, and a retry of an unpaced request is exactly the retry `docs/07`
 * §7.4 says the limiter must be able to see.
 *
 * Built once per host and cached: the jitter is stateless (`withRetry` carries
 * the previous delay), so one policy object per host serves every request.
 *
 * @param limiters - the registry `installServices` built
 * @param random - uniform `[0, 1)` source for the jitter; a test injects one
 * @returns `(host) => RetryPolicy | undefined`
 */
export function createRetryFor(
  limiters: Pick<HostLimiterRegistry, "limiterFor" | "policyFor">,
  random: () => number = Math.random,
): (host: string) => RetryPolicy | undefined {
  const cache = new Map<string, RetryPolicy | undefined>();
  return (host) => {
    if (cache.has(host)) return cache.get(host);
    const budget = limiters.policyFor(host)?.retry;
    const policy =
      budget === undefined || limiters.limiterFor(host) === undefined
        ? undefined
        : retryPolicyFromBudget(budget, random);
    cache.set(host, policy);
    return policy;
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
 *    registry's `limiterFor`, {@link createRetryFor} over the same registry,
 *    the clock and the logger. Install it with
 *    `setHttpClient()` so `docs/13` §2.2's `httpRequest()` has something to
 *    delegate to.
 * 4. Build the per-job progress factory and bind the jobs it hands out to the
 *    scope. **No sink is constructed at this level** — see §3 of this file's
 *    header.
 *
 * **`retryFor` is supplied since 2026-10-20** (`plan/00` §6 item 228, the
 * owner's decision). It used to be left out deliberately: `docs/07` §7.3 named
 * a per-host attempt cap and published no number, `P1-T04` and `P1-T05` both
 * refused to invent one, and `P1-T28` owned it behind a human gate. That gate
 * was satisfied on 2026-10-07 for NCBI and §7.3's other retry cells were
 * filled on 2026-10-14, so the cells now take effect through
 * {@link createRetryFor}: a host gets the policy its `HOST_POLICIES` row's
 * `retry` cells describe, and a host without a row — or without a limiter —
 * gets none and makes exactly one attempt. Only the error classes `docs/07`
 * §10.1 marks retryable are retried, **except a timeout** (`plan/00` §6 item
 * 230, owner, 2026-10-20: `src/core/http/retry.ts`'s `isRetriedAutomatically`
 * — a `TimeoutError` surfaces after one attempt), every retry re-enters the
 * host's bucket, and a cancelled token ends the loop at once.
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

  // 2. `docs/09` §1.7's startup keystore probe, and the key store it licenses.
  //
  //    **Before the limiters, deliberately.** `createHostLimiterRegistry` reads
  //    `ncbi.keyPresent` at construction to choose between `docs/07` §7.3's
  //    unkeyed and keyed NCBI budgets, and `refreshKeyPresence` is what makes
  //    that flag agree with the keystore. A flag left `true` by a key the user
  //    removed outside Zotero would pace NCBI at 8 req/s against its unkeyed
  //    3 req/s ceiling and earn an IP block (`docs/02` §3.1) — so the
  //    reconciliation has to happen before the bucket is sized, not after.
  //
  //    `probeKeystore()` is a real encrypt/decrypt round trip and never throws:
  //    a platform without `Zotero.OSKeyStore` — a layer-1 unit test, for
  //    instance — comes back `"unavailable"`. Then the degradation dialog
  //    (`P3-T03`) is awaited, and the only store it can license is tier 2,
  //    whose in-memory keys this scope drops at teardown.
  const secrets = await installSecretStore(logger, {
    chooseSecretBackend: options.chooseSecretBackend,
    scope,
  });

  // 3. The per-host buckets, and the observer that raises NCBI's budget when a
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

  // 4. The one outbound choke point.
  const http = createHttpClient({
    transport: options.transport,
    userAgent: buildUserAgent(options.version),
    // `docs/07` §8.5: `timeoutSeconds` × 1000. Read through a function on every
    // request, because `core/` may not import `src/prefs/` (§2.3) and because a
    // pref change must not need a restart.
    timeoutMs: () => getPref("timeoutSeconds") * 1000,
    limiterFor: (host) => limiters.limiterFor(host),
    retryFor: createRetryFor(limiters),
    clock,
    logger,
  });
  setHttpClient(http);
  scope.defer("HttpClient (docs/13 §2.2)", () => {
    setHttpClient(undefined);
  });

  // 5. The per-job progress factory. No sink is constructed here: a job's
  //    surfaces are built by `forJob`, so one job's completion cannot close
  //    another's popup and `openOn` is the pipeline's choice (`P1-T31`; §3 of
  //    this file's header has the reasoning and the rejected alternative).
  //
  //    The headline is resolved **once, here**, because this is the last
  //    `await` before the factory: `forJob` is synchronous and
  //    `ZoteroProgressWindowSink` takes a `string` (`docs/08` §8.2.1 —
  //    `Zotero.getString()` throws on a plugin key, so Fluent is the only
  //    route and Fluent is async).
  const progress = createJobProgressFactory({
    clock,
    headline: await resolveProgressHeadline(options.progressHeadline, logger),
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

  // 6. The adapters (`P1-T09`, `P1-T10`; Europe PMC `P2-T03`, wired here by
  //    `P2-T32`) and the registry `registerSources()` has been waiting for
  //    since `P1-T07`.
  //
  //    **`keepRaw` is the whole reason the mapper is built here.** `docs/07`
  //    §5.1's `SourceRecord.raw` is "retained past that point only when
  //    `logRequestBodies` (§8.5) is on", `sources/` may not read a preference
  //    (§2.3), and `P1-T10` therefore takes the resolved boolean as an injected
  //    flag. This is the only place that boolean can come from.
  //
  //    **It is read once, at construction, and that is a real limitation.**
  //    `PubmedMapperDeps.keepRaw` is a `boolean`, not a getter, so toggling
  //    `logRequestBodies` while Zotero runs does not change what the mapper
  //    keeps until the plugin is re-enabled. Making it live would mean widening
  //    `src/sources/pubmed/mapper.ts`, which is outside `P1-T16`'s `Files` list,
  //    so it is reported rather than done. The safe direction is the default:
  //    `getPref` falls back to §8.5's `false`, so a missing or malformed
  //    preference keeps nothing.
  const keepRaw = getPref("logRequestBodies");
  const mapRecords = createPubmedRecordMapper({ clock, keepRaw, logger });
  const sources = createSourceRegistry();
  // The same bucket the client paces Crossref with (`limiterFor` above), so
  // the adapter's header-driven `reconfigure()` and the client's pacing agree.
  const crossrefLimiter = limiters.limiterFor(CROSSREF_HOST);
  // bioRxiv and medRxiv (`P2-T07`) share one mapper: the server comes from
  // each record's own `server` field, never from which adapter asked.
  const biorxivMapRecords = createBiorxivRecordMapper({
    clock,
    keepRaw,
    logger,
  });
  // `satisfies ShippedSourceAdapters`: every slot the registry knows must be
  // constructed here, so a dropped adapter is a compile error at this literal
  // rather than a database row missing from the search dialog (`P2-T32`).
  // `P5-T14`: the related pipeline calls what is specific to these two adapters
  // (`docs/07` §4.2), so both are built here, once, and handed to both consumers.
  const crossref = createCrossrefSource({
    http,
    clock,
    mapRecords: createCrossrefRecordMapper({ clock, keepRaw, logger }),
    userContactEmail: () => getPref("contactEmail"),
    ...(crossrefLimiter !== undefined && { limiter: crossrefLimiter }),
    logger,
  });
  const semanticscholar = createSemanticScholarSource({
    http,
    clock,
    mapRecords: createSemanticScholarRecordMapper({ clock, keepRaw, logger }),
    ...(secrets !== undefined && { secrets }),
    logger,
  });
  // `P5-T25`: the recommend pipeline calls `findSimilarForSeeds` on the typed instance.
  const pubmed = createPubmedSource({
    http,
    clock,
    mapRecords,
    // Conditional spread, not `secrets`: `tsconfig.json`'s
    // `exactOptionalPropertyTypes` rejects an explicit `undefined`, and
    // omitting the member is what `PubmedSourceDeps` documents as "every
    // request goes out without `api_key`".
    ...(secrets !== undefined && { secrets }),
    logger,
  });
  registerSources(sources, {
    pubmed,
    // Europe PMC has no key (`docs/02` §4.1), so no `secrets`. The mapper takes
    // the same resolved `keepRaw` as PubMed's for the same §5.1 reason: the
    // composition root is the only place the preference may be read.
    europepmc: createEuropePmcSource({
      http,
      clock,
      mapRecords: createEuropePmcRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    // Crossref (`P2-T04`). No key (Crossref Plus is out of scope, `docs/02`
    // §2.3). Two things only this root can supply: the `contactEmail`
    // preference for the `mailto` parameter — a getter, read on every request,
    // because `sources/` may not read a preference (§2.3) and a pref change
    // must not need a restart (D10: the user's address when set, the
    // maintainer's otherwise) — and the host's own limiter, so the adapter can
    // adopt the limits every Crossref response advertises in both directions
    // (`docs/07` §7.3's header-driven row; the client alone only tightens).
    crossref,
    // arXiv (`P2-T06`). No key and no contact parameter exist (`docs/02`
    // §7.1, §2.2). The three-second rule is the client's: `limiterFor` above
    // resolves §7.3's `export.arxiv.org` bucket for every request to that
    // host, so the adapter needs nothing beyond the client, the clock and
    // the mapper (same resolved `keepRaw`, same §5.1 reason). `DOMParser` is
    // the sandbox's own and the adapter's default.
    arxiv: createArxivSource({
      http,
      clock,
      mapRecords: createArxivRecordMapper({ clock, keepRaw, logger }),
      logger,
    }),
    // Semantic Scholar (`P2-T05`). The one keyed Phase 2 source: the adapter
    // reads `source.semanticscholar` from the same `SecretStore` PubMed reads
    // `source.ncbi` from, per request, and sends it as the `x-api-key` header
    // (`docs/02` §6.4, `docs/09` §1.7); with no store — or no key in it —
    // every request goes out unkeyed onto the shared anonymous pool and the
    // page says so. Same conditional spread as PubMed's, for the same
    // `exactOptionalPropertyTypes` reason. The budget is the client's:
    // `limiterFor` above resolves §7.3's `api.semanticscholar.org` bucket,
    // 0.9/s in both modes. Same resolved `keepRaw`, same §5.1 reason.
    semanticscholar,
    // bioRxiv and medRxiv (`P2-T07`): two `SourceId`s, one implementation
    // (`docs/07` §2.2), built once per server. No key and no contact
    // parameter (`docs/02` §8.1). Both have `rateLimitKey` `api.biorxiv.org`,
    // so `limiterFor` above resolves §7.3's one 1/s bucket for both. Neither
    // searches (`docs/02` §8.4): `search()` returns an empty page that says
    // keyword search of preprints runs through Europe PMC `SRC:PPR`.
    biorxiv: createBiorxivSource({
      server: "biorxiv",
      http,
      clock,
      mapRecords: biorxivMapRecords,
      logger,
    }),
    medrxiv: createBiorxivSource({
      server: "medrxiv",
      http,
      clock,
      mapRecords: biorxivMapRecords,
      logger,
    }),
  } satisfies ShippedSourceAdapters);

  // 6b. The LLM layer (`P3-T06`): settings over the typed prefs, the provider
  //     registry, the base-URL resolver and `docs/07` §4.3's router. No
  //     adapter yet — `P3-T07`–`P3-T10` add them inside `registerProviders`.
  //
  //     `P3-T35`: the OpenRouter adapter reads the global `privacy.mode` per
  //     request (`P3-T15`'s floor; a stricter collection mode rides on the
  //     request as `routing`), and the router every job carries is the one
  //     router wrapped **once** by `withBudget` (`P3-T16`): a call whose
  //     `LLMCallContext` carries `budget: ctx.budget` reserves before it is
  //     sent and settles when it returns, and a call without one is refused
  //     before anything is sent (owner, 2026-10-23, `plan/00` §6 item 278(a)).
  //     The wrapping waits for step 6c, because its prices do (item 278(b)).
  const globalPrivacyMode = (): PrivacyMode => {
    const mode = getPref("privacyMode");
    return isPrivacyMode(mode) ? mode : "strict";
  };
  const providers = registerProviders({
    logger,
    http,
    secrets,
    privacyMode: globalPrivacyMode,
  });

  // 6c. The plugin database, opened once here (`P3-T33`; `plan/00` §6 item
  //     249, owner, 2026-10-21), and `docs/07` §4.1's cache over it. The open
  //     is synchronous; the migrations run in the background so startup does
  //     not wait on the file (`src/bootstrap/pluginDatabase.ts`'s header). Its
  //     teardown — recovery awaited, stores detached, connection closed — is
  //     registered here, so it runs after every later registration is undone.
  // §9.4 step 4 (`P3-T17`): the work keys of live `llm` runs, which the
  // cache never evicts; the same registry reaches the runs through step 7.
  const runningWork = createRunningWork();
  const database = installPluginDatabase(scope, {
    source: options.pluginDatabase,
    clock,
    logger: logger.child({ surface: "pluginDatabase" }),
    // §8.5's `cache.maxSizeMB`, read on demand so a change applies at once.
    cacheMaxBytes: () => getPref("cacheMaxSizeMB") * 1024 * 1024,
    pinnedTags: runningWork.pinnedTags,
  });

  // 6d. The one model price source and the budgeted router (owner,
  //     2026-10-23, `plan/00` §6 item 278(b); `docs/07` §4.3's note of that
  //     date). One `createModelCatalogue` over the registry and the cache —
  //     built without the user table, which the source applies itself — held
  //     as a snapshot the router's synchronous `pricesFor` reads for the
  //     active provider: the documented table (`docs/03` §12.1) until a
  //     catalogue snapshot is adopted, the user's `user_price` rows over
  //     either. Nothing here fetches a catalogue: startup sends no request
  //     (item 279(c)); the pane's suggestions and the cost dialog refresh it.
  //     The user table is read once the database is open (no network), and
  //     the pane reloads it after each change it saves.
  const pricesLogger = logger.child({ surface: "modelPrices" });
  const modelPrices = createModelPriceSource({
    catalogue: createModelCatalogue({
      registry: providers.registry,
      openRouterCatalogue: (ctx) => {
        const adapter = providers.registry.get("openrouter");
        if (adapter === undefined || !("listCatalogue" in adapter)) {
          return Promise.reject(
            new Error("[research-helper] no OpenRouter adapter is registered"),
          );
        }
        return (adapter as OpenRouterProvider).listCatalogue(ctx);
      },
      cache: database.cache,
      clock,
      logger: pricesLogger,
    }),
    userPriceOverrides: () => database.prices.list(),
    logger: pricesLogger,
  });
  // Not awaited, and no teardown of its own: the read is one of the
  // database's tracked calls, which its teardown already waits for, and a
  // read that starts while it closes gets an empty table.
  void (async () => {
    if ((await database.ready) === undefined) return;
    await modelPrices.reloadUserPrices();
  })().catch((error: unknown) => {
    pricesLogger.warn("the user price table was not read at startup", {
      error: error instanceof Error ? error.name : typeof error,
    });
  });
  const llm: LLMServices = {
    ...providers,
    router: withBudget(providers.router, {
      pricesFor: (modelId) =>
        modelPrices.pricesFor(providers.router.activeProvider(), modelId),
      now: () => clock.now(),
    }),
  };

  // 7. The pipelines (`P1-T16`) and the per-job context factory.
  // `P3-T29`: the queue's `JobNotifier`, before the pipelines that register
  // for their jobs' pauses and the queue (step 8) that notifies through it.
  const jobNotices = createJobNoticeRouter();
  // `P4-T20` step 0c: the runner of the jobs `recover()` re-queues; the
  // queue and the context factory are built below and read when a job runs.
  const resumedRunner = createResumedJobRunner({
    jobs: () => jobs,
    pipelines: () => pipelines,
    openJob: (options) => pipelineContext.openJob(options),
    logger,
  });
  const pipelines = registerPipelines({
    // `http`: Strategy B's PMCID route (the NCBI ID Converter, owner
    // 2026-10-19, `plan/00` §6 item 214) goes through the one client, so
    // §7.3's `pmc.ncbi.nlm.nih.gov` bucket paces it. It is used only while
    // `useTranslators` is on, which it ships off.
    writer: createZoteroSearchImportWriter({ logger, http }),
    runningWork,
    // `P5-T14`: the typed adapters, and the vector store on the one connection.
    related: {
      semanticscholar,
      crossref,
      http,
      logger,
      embeddings: () => database.embeddings(),
    },
    // `P5-T25`: the typed adapters, the three stores on the one connection, the queue
    // and `collection_settings` (both built below, so read through closures), and what
    // the profile call reads, the same sources as the summarize pipeline's.
    recommend: {
      semanticscholar,
      pubmed,
      profiles: () => database.collectionProfiles(),
      recommendations: () => database.recommendations(),
      embeddings: () => database.embeddings(),
      clock,
      jobs: () => jobs,
      profileCall: {
        prices: (providerId, modelId) =>
          modelPrices.pricesFor(providerId, modelId),
        baseUrls: providers.baseUrls,
        modelInfo: (providerId, modelId) =>
          providers.registry.get(providerId)?.getModel(modelId),
        credentials: {
          hasKey: async (providerId) =>
            (await secrets?.has(`llm.${providerId}`)) === true,
        },
        routine: {
          read: (collection) =>
            recommendRoutineStore(collectionSettings).read(collection),
          write: (collection, record) =>
            recommendRoutineStore(collectionSettings).write(collection, record),
        },
      },
    },
    // `P3-T27`: the relevance screen's privacy check judges the model the
    // active adapter describes (`docs/12` §3's note of 2026-10-24).
    screening: {
      modelInfo: (providerId, modelId) =>
        providers.registry.get(providerId)?.getModel(modelId),
    },
    // `P3-T29`: the summarize pipeline's store (the one connection), the
    // queue (built in step 8, read through the getter), its pause notices,
    // the one price source, the effective host, the adapters' model
    // descriptions and the key check (`docs/09` §1.7).
    summarize: {
      store: () => database.summaries(),
      jobs: () => jobs,
      pauseNotices: jobNotices,
      prices: (providerId, modelId) =>
        modelPrices.pricesFor(providerId, modelId),
      baseUrls: providers.baseUrls,
      modelInfo: (providerId, modelId) =>
        providers.registry.get(providerId)?.getModel(modelId),
      credentials: {
        hasKey: async (providerId) =>
          (await secrets?.has(`llm.${providerId}`)) === true,
      },
    },
    // `P4-T18`: the report store (`P4-T14`), the report run's own "don't ask
    // again" in `collection_settings` (item 292(f)), the collection's latest
    // search record and the plugin version; the rest is the summarize deps'.
    trendReport: {
      reports: () => database.reports(),
      routine: {
        read: async (collection) =>
          readCollectionPrivacySettings(
            await collectionSettings.get(
              collection.libraryID,
              collection.collectionKey,
            ),
          ).reportRoutineConfirmation,
        write: (collection, record) =>
          writeCollectionPrivacySettings(collectionSettings, collection, {
            reportRoutineConfirmation: record,
          }),
      },
      searchRuns: async (libraryID, collectionKey) => {
        const open = await database.ready;
        const run = await open?.provenance.findProvenanceByCollection(
          libraryID,
          collectionKey,
        );
        return run === undefined ? [] : [run];
      },
      pluginVersion: options.version,
      utcOffsetMinutes: (atEpochMs) => -new Date(atEpochMs).getTimezoneOffset(),
      // `P4-T20` step 0c (owner, item 324(a)): a job resumed after a restart
      // runs on a deferred surface a report window can attach to; a pause
      // waits for that window instead of being answered "stop".
      surfaces: (jobId) => resumedRunner.surfaceOf(jobId),
    },
  });
  // The per-job context factory is built after step 8, because a queued
  // job's checkpoint writes through the queue (`P3-T35`).

  // `P3-T35`: what every job's context shares — the one `ConfigReader`
  // (owner item 272(a)), the one session spend counter (`docs/06` §11.4),
  // and `collection_settings` on the one connection.
  const config: ConfigReader = Object.freeze({ get: getPref });
  const sessionSpend = options.sessionSpend ?? createSessionSpendCounter();
  const collectionSettings = createDeferredCollectionSettings(database);

  // 8. The job queue's persistent half (`P3-T34`). Its store is attached by
  //    `database.attachJobs` below once the plugin database is open (`P3-T33`
  //    moved the open here). `skipCached` is `P3-T26`'s; until it has a probe
  //    (the summarize pipeline, `P3-T29`) it skips nothing, so the spend
  //    guards after it may over-count and never under-count. `egress` is
  //    `P3-T15`'s, installed by `P3-T35`. `confirm` and `ceilings` (`P3-T16`)
  //    need the summarize pipeline's remaining-work estimate, which `P3-T29`
  //    passes to {@link createSpendResumeGuards}; until then they are absent,
  //    so `recover()` resumes nothing: every resumable interrupted job waits
  //    (`plan/00` §6 item 250). *(Updated 2026-10-29, `P3-T29`: the notifier
  //    is now `jobNotices`' — a pause reaches the run that owns the job —
  //    and the summarize pipeline declares `resumable: false`, because
  //    nothing runs a queued job without its window yet; `docs/07` §12.3's
  //    note of 2026-10-29, item 13. Neither `remaining` nor the `skipCached`
  //    probe is supplied.)*
  const jobs = createJobQueue({
    clock,
    logger: logger.child({ surface: "jobQueue" }),
    pluginVersion: options.version,
    // `P4-T18`: after the resume notice, each re-queued job is run (below).
    notifier: {
      paused: (record) => jobNotices.notifier.paused(record),
      resumed: async (records) => {
        await jobNotices.notifier.resumed(records);
        for (const record of records) runResumedJob(record.id);
      },
    },
    isResumable: (pipelineId) =>
      pipelines
        .list()
        .some((pipeline) => pipeline.id === pipelineId && pipeline.resumable),
    resumeGuards: {
      skipCached: createSkipCachedGuard({
        logger: logger.child({ surface: "summaryCache" }),
      }),
      // Reads `privacy.egressAcknowledged` on every call (its default).
      egress: createEgressResumeGuard(),
      // `P4-T18`: the trend-report run is the one resumable pipeline; its
      // checkpoint carries the confirmed estimate per stage, so a resumed
      // job is priced from the stages still ahead. Any other record is one
      // call of unknown cost, which the confirm guard asks about.
      ...createSpendResumeGuards({
        session: sessionSpend,
        remaining: (record) => Promise.resolve(remainingFromCheckpoint(record)),
      }),
    },
  });

  // `P4-T18` step 6 (`plan/07` §0.2 item 18; `docs/07` §12.4): a job
  // `recover()` re-queued is run from its checkpoint with no second
  // confirmation, by {@link createResumedJobRunner} (changed 2026-11-01 by
  // `P4-T20` step 0c: a deferred surface a window can attach to, and a
  // shutdown cancel). Its teardown is registered after the database, so it
  // runs first (last in, first out) and no resumed run goes on against a
  // closing database (`plan/00` §6 item 322(e), `P4-T18` finding 5).
  const runResumedJob = (jobId: string): void => {
    resumedRunner.run(jobId);
  };
  scope.defer("resumed trend-report runs (P4-T20)", () =>
    resumedRunner.stopAll(),
  );
  // The `job` store on the one connection, then §7.6's startup recovery —
  // both once the migrations are done, neither awaited by startup.
  database.attachJobs(jobs);

  // 7 (cont.). The per-job context factory (`P1-T16`; every member wired by
  //    `P3-T35`, `docs/07` §4.5's note of 2026-10-23).
  const pipelineContext = createPipelineContextFactory({
    clock,
    logger,
    sources,
    progress: progress.factory,
    llm: llm.router,
    cache: database.cache,
    config,
    sessionSpend,
    privacy: {
      globalMode: globalPrivacyMode,
      store: collectionSettings,
      logger: logger.child({ surface: "privacyPolicy" }),
    },
    jobs,
  });

  // 8b. `docs/07` §9.3 trigger 1 (`P3-T26`): once the cache is usable,
  //     compare the shipped prompt versions with `cache.lastSeenPromptVersions`,
  //     invalidate by tag the cache entries of each prompt whose MAJOR.MINOR
  //     changed (never a Zotero note; a PATCH-only change keeps them, item
  //     273(a)), then write the new set once. Not awaited by startup; this
  //     teardown waits for it, so it never runs against a closing cache.
  //     Skipped without a database: the prompt's `cacheEpoch` is in every
  //     summary key, so a skipped run serves nothing stale and the next start
  //     does the work.
  const loadPromptVersions = options.promptVersions;
  if (loadPromptVersions !== undefined) {
    const versionLogger = logger.child({ surface: "summaryCache" });
    const promptVersionCheck = (async () => {
      if ((await database.ready) === undefined) return;
      await reconcilePromptVersions({
        cache: database.cache,
        shipped: await loadPromptVersions(),
        logger: versionLogger,
      });
    })().catch((error: unknown) => {
      versionLogger.error(
        "prompt-version check failed; the next start tries again",
        { error: error instanceof Error ? error.name : typeof error },
      );
    });
    scope.defer(
      "prompt-version check (docs/07 §9.3)",
      () => promptVersionCheck,
    );
  }

  logger.info("services installed", {
    hosts: limiters.hosts.length,
    observers: limiters.observers.length,
    secretBackend: secrets?.backend ?? "none",
    sources: sources.list().length,
    pipelines: pipelines.list().length,
    llmProviders: llm.registry.list().length,
  });

  return {
    clock,
    logger,
    prefs: options.prefs,
    limiters,
    http,
    progress: progress.factory,
    secrets,
    sources,
    pipelines,
    pipelineContext,
    llm,
    jobs,
    database,
    cache: database.cache,
    config,
    sessionSpend,
    collectionSettings,
    modelPrices,
    jobNotices,
    resumedReports: resumedRunner,
  };
}

/**
 * Run `docs/09` §1.7's startup probe and build the tier-1 key store if it
 * passed, then reconcile every `*.keyPresent` flag with what the keystore
 * actually holds (`P3-T02`; exported so its tests can call it).
 *
 * **Three failure modes, three different handlings, and none of them fails
 * startup.** A plugin that refused to load because a keychain was unavailable
 * would be a worse outcome than one that runs unkeyed, which `docs/02` §3.1
 * makes a supported configuration.
 *
 * 1. **The probe says `"unavailable"`.** `probeAndRecordBackend` has already
 *    written `secretBackend = ""` and logged a `warn` naming the failure class.
 *    Since `P3-T03` this goes on to {@link installFallbackSecretStore}: every
 *    `*.keyPresent` flag is reset from the empty session store, then the
 *    degradation dialog is awaited, and only a `"session"` answer installs a
 *    store — tier 2, recorded as `secretBackend = "session"`. `docs/09` §1.7
 *    forbids falling to tier 2 "without the dialog", and tier 3 does not ship
 *    in v1 (`G-10`).
 * 2. **The probe itself throws.** It is documented as never doing so, so this is
 *    a defect somewhere below; caught, logged, treated as unavailable.
 * 3. **`refreshKeyPresence` throws.** It reads the login manager, which
 *    `Services.logins` backs; an unreadable login store must not stop the plugin
 *    loading. Caught and logged — and the consequence is named in the log line,
 *    because a stale `true` is the expensive direction (`docs/02` §3.1's IP
 *    block) and whoever reads the log should know which way the error leans.
 *
 * **Nothing here can log a key.** The probe's plaintext is a throwaway random
 * value it never stores; `probeAndRecordBackend`'s own `ProbeAndRecordOptions`
 * doc forbids passing anything that writes a value, and what reaches the log is
 * a failure class, a platform error *name* and a boolean. `refreshKeyPresence`
 * returns the boolean `hasSecret` produced and writes it to a preference whose
 * schema row is not `secret: true`; `src/prefs/index.ts`'s `guardWritable`
 * refuses a write to a `secret: true` row before the value is coerced at all.
 * The store this function returns is handed to `createPubmedSource`, which reads
 * the key per request, puts it in the query string through `P1-T08`'s builder,
 * and logs only `request.transmittedUrl` — `redactUrl`'s output, with the
 * parameter removed.
 *
 * ## Why the module is loaded with `await import()` rather than imported
 *
 * **Found by wiring it, not by inspection.** `src/zotero/keychain.ts` evaluates
 *
 * ```ts
 * const LoginInfo = Components.Constructor(
 *   "@mozilla.org/login-manager/loginInfo;1", …);
 * ```
 *
 * **in its module body**, at line 95. `Components` is a Gecko global that exists
 * only inside the sandbox, so merely *importing* that module from here threw
 * `ReferenceError: Components is not defined` and took
 * `test/unit/bootstrap/container.test.ts` down with **0 tests collected** — the
 * suite went 1,115 passing to 1,110 with one failed *suite*, from a change that
 * added no test and touched no assertion. That is the shape to watch for: the
 * module graph of a layer-1 test is as much a part of its contract as its
 * assertions, and `docs/13` §2.1's "plain Node, no Zotero" holds for `import`
 * side effects too.
 *
 * The dynamic import moves the evaluation from this file's import time to this
 * function's first call, where the `try`/`catch` that already exists for "the
 * probe itself throws" covers it. In the sandbox `Components` is present and the
 * module loads normally; under `vitest` it throws, is caught, and the graph
 * continues with no secret backend — which is the same outcome a machine with no
 * usable keychain gets, and a configuration `docs/02` §3.1 supports.
 *
 * It also keeps the whole module in one bundled file: `zotero-plugin.config.ts`
 * builds with `bundle: true` and no code splitting, so esbuild inlines the
 * dynamic import rather than emitting a second chunk.
 *
 * **The one-line fix belongs in `keychain.ts`** — make `LoginInfo` lazy, as every
 * other platform reference in that file already is — and `src/zotero/keychain.ts`
 * is **not in `P1-T16`'s `Files` list**, so it is reported rather than edited
 * (`plan/README.md` §5 rule 2). **Needs a card.**
 */
export async function installSecretStore(
  logger: Logger,
  options: SecretStoreInstallOptions = {},
): Promise<SecretStore | undefined> {
  let keychain: typeof import("../zotero/keychain");
  try {
    keychain = await import("../zotero/keychain");
  } catch (error) {
    // Not reachable in the sandbox; reachable in plain Node. See the doc
    // comment above for the measurement and for where the fix belongs.
    logger.warn(
      "src/zotero/keychain.ts could not be loaded, so this build has no " +
        "secret backend. It touches the Gecko `Components` global in its " +
        "module body, which only exists inside the Zotero sandbox",
      { err: error },
    );
    return undefined;
  }

  let tierOne: boolean;
  try {
    const verdict = await keychain.probeAndRecordBackend({ logger });
    tierOne = verdict.backend === "os-keychain";
  } catch (error) {
    logger.warn(
      "OS keystore probe threw, which docs/09 §1.7 says it cannot; " +
        "continuing with no secret backend",
      { err: error },
    );
    return undefined;
  }
  if (!tierOne) return installFallbackSecretStore(keychain, logger, options);

  const secrets = keychain.createKeychainSecretStore();
  try {
    // `P3-T02` step 2: every `*.keyPresent` flag, not only NCBI's, re-derived
    // from the keystore. A flag left stale by a keystore entry removed outside
    // Zotero is corrected here, before the limiter registry reads NCBI's.
    const flags = await keychain.reconcileKeyPresence();
    logger.debug("key-presence flags reconciled from the keystore", {
      flags: Object.fromEntries(flags),
    });
  } catch (error) {
    logger.warn(
      "could not reconcile the key-presence flags from the keystore; the " +
        "stored flags stand. If ncbi.keyPresent is stale in the `true` " +
        "direction, NCBI will be paced at the keyed budget against an " +
        "unkeyed ceiling (docs/02 §3.1)",
      { err: error },
    );
  }
  return secrets;
}

/** What {@link installSecretStore} needs beyond a logger (`P3-T03`). */
export interface SecretStoreInstallOptions {
  /**
   * The degradation dialog, asked only after a failed probe. Absent: a failed
   * probe installs no store.
   */
  readonly chooseSecretBackend?:
    (() => Promise<SecretBackendChoice>) | undefined;
  /**
   * Where the tier-2 store's teardown goes: the in-memory keys are dropped
   * when this scope is torn down, which is `shutdown()`.
   */
  readonly scope?: Pick<Scope, "defer"> | undefined;
}

/**
 * `docs/09` §1.7 after a failed probe: the degradation dialog, never a silent
 * fallback (`P3-T03` step 2).
 *
 * In order:
 *
 * 1. **Every `*.keyPresent` flag is reset** from the session store, which is
 *    empty at startup, so every flag reads `false`. This happens whatever the
 *    user then chooses: no key is usable this session until one is entered,
 *    and a stale `ncbi.keyPresent = true` would pace NCBI at the keyed budget
 *    with no key sent (`docs/02` §3.1). A failure here is logged, not fatal.
 * 2. **The dialog is awaited.** No store exists until it answers, so nothing
 *    can store or read a key in the meantime.
 * 3. **Only `"session"` installs a store**: `adoptSessionSecretStore` writes
 *    `secretBackend = "session"` and returns tier 2, and the scope drops its
 *    keys at teardown. `"none"`, a closed window, a dialog that could not be
 *    opened, or no dialog at all (a unit test) all leave `secretBackend = ""`
 *    and no store — running without stored keys, which is not a tier.
 *
 * Never throws, for the reason {@link installSecretStore} gives. What reaches
 * the log is a choice and an error; no key exists yet to reach it.
 *
 * @param keychain - the loaded `src/zotero/keychain.ts`
 * @param logger - the graph's redacting logger
 * @param options - see {@link SecretStoreInstallOptions}
 * @returns the tier-2 store, or `undefined` when none was chosen
 */
async function installFallbackSecretStore(
  keychain: typeof import("../zotero/keychain"),
  logger: Logger,
  options: SecretStoreInstallOptions,
): Promise<SecretStore | undefined> {
  try {
    await keychain.reconcileSessionKeyPresence();
  } catch (error) {
    logger.warn(
      "could not reset the key-presence flags after the keystore probe " +
        "failed; the stored flags stand. If ncbi.keyPresent is stale in the " +
        "`true` direction, NCBI will be paced at the keyed budget with no key " +
        "sent (docs/02 §3.1)",
      { err: error },
    );
  }

  const choose = options.chooseSecretBackend;
  if (choose === undefined) {
    logger.warn(
      "the OS keystore is unavailable and this build has no degradation " +
        "dialog to offer session-only storage; continuing with no stored keys",
    );
    return undefined;
  }

  let choice: SecretBackendChoice;
  try {
    choice = await choose();
  } catch (error) {
    logger.warn(
      "the key-storage dialog could not be shown; continuing with no stored " +
        "keys rather than choosing a tier for the user (docs/09 §1.7)",
      { err: error },
    );
    return undefined;
  }
  if (choice !== "session") {
    logger.info(
      "session-only key storage declined; continuing with no stored keys",
      { choice },
    );
    return undefined;
  }

  let secrets: SecretStore;
  try {
    secrets = keychain.adoptSessionSecretStore();
  } catch (error) {
    logger.warn(
      "could not record the session-only choice in the secretBackend " +
        "preference; continuing with no stored keys",
      { err: error },
    );
    return undefined;
  }
  options.scope?.defer("tier-2 session-only key store (docs/09 §1.7)", () => {
    keychain.clearSessionSecrets();
  });
  logger.info(
    "session-only key storage chosen: keys are held in memory, written " +
      "nowhere, and must be entered again after a restart",
  );
  return secrets;
}

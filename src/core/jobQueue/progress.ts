/**
 * `ProgressReporter` — the contract every progress surface implements, the
 * composite that drives them, and the sink port they arrive through.
 *
 * **Scope — two cards, in this order.**
 *
 *  - **`P1-T02`** created this file and transcribed `docs/07` §4.1's
 *    `ProgressReporter` **interface**, nothing more. The path moved to that card
 *    because it had to: `docs/07` §4.2's `LiteratureSource` imports
 *    `ProgressReporter` from here, so `src/sources/types.ts` cannot compile
 *    without it — yet `P1-T15` sits after `P1-T07`, `P1-T08`, `P1-T09`,
 *    `P1-T10` and `P1-T11` in the dependency order, which left
 *    `npm run typecheck` unable to reach exit 0 for five consecutive cards. The
 *    plan was amended rather than the code: `P1-T02` `create`s the declaration,
 *    `P1-T15` `modify`s it into a working tree of reporters.
 *  - **`P1-T15`** (this pass) added everything below the interface:
 *    {@link ProgressSnapshot}, the {@link ProgressSink} port,
 *    {@link CompositeProgressReporter} with its `child()` range arithmetic, the
 *    FR-53 ETA and the §7.7 repaint throttle, and
 *    {@link createObservableProgressSink} — the dialog sink that `docs/08`
 *    §4.4's in-window status bar subscribes to. Its Zotero surface is
 *    `src/zotero/progressWindow.ts`.
 *
 * **Authority.** The interface below is
 * `docs/07-architecture-and-data-model.md` §4.1's
 * `// src/core/jobQueue/progress.ts` block, transcribed verbatim — every
 * member, with §4.1's names, signatures and doc comments. `plan/README.md` §5
 * rule 3 makes §4.1 the sole authority for it, so `P1-T15` added *around* it and
 * changed nothing *in* it.
 *
 * **No repair was needed for the transcription**, unlike the `docs/07` §10.1
 * block in `../errors.ts`. §4.1 declares an `interface`, so there is no class
 * field to acquire a literal type and nothing for `noImplicitOverride` to catch;
 * and its four optional items (`total`, `n`, `detail`, `message`) are optional
 * *parameters*, not optional *properties*, so `tsconfig.json`'s
 * `exactOptionalPropertyTypes` is not engaged. It compiles as printed, and it is
 * implementable as printed — {@link CompositeProgressReporter} implements all
 * six members with no widening.
 *
 * **Layering.** `core/` imports `model/` only and names no `Zotero` global
 * (§2.3, enforced by `eslint.config.js`'s `no-restricted-globals`). That is why
 * the `Zotero.ProgressWindow` fan-out §4.1's comment describes lives in
 * `src/zotero/progressWindow.ts` behind {@link ProgressSink}, and not in this
 * directory. `../logger.ts` declares its `LogSink` port for the same reason and
 * this file follows its shape: one required method, an optional second channel,
 * and a null implementation for code constructed before the container has wired
 * anything.
 *
 * ## Why the throttle is here and not only in the adapter
 *
 * `docs/07` §7.7: one window per job, "updated at most ~4×/second (throttled; a
 * 200-item loop must not repaint 200 times)", and `NFR-3` caps main-thread work
 * at 100 ms. `P0-T20` measured 100 items inserting in 293–425 ms (median 324),
 * so a reporter that fanned out per item would be issuing a repaint roughly
 * every 3 ms — the reporter would become the stall it exists to report on.
 * {@link CompositeProgressReporter} therefore coalesces at
 * {@link PROGRESS_REPAINT_INTERVAL_MS} before any sink is called, and the
 * `ProgressWindow` adapter keeps §7.7's own `lastPaintMs` guard as well, so a
 * sink driven directly (by a test, or by Phase 3's job queue) cannot repaint
 * faster either.
 *
 * The throttle is **leading-edge with a forced flush on `done()`**: the first
 * call in an interval paints, the rest are dropped, and the terminal call always
 * paints whatever the last value was. There is no trailing-edge timer, because
 * one would mean owning a timer in `core/` for a bar that is at most one
 * interval (250 ms) behind. The consequence to know: if a job reports progress
 * and then goes quiet inside a long stage, the surface can sit up to one
 * interval behind until the next report or `done()`.
 */

import type { Clock } from "../clock";
import type { CancellationToken } from "./cancellation";

// ---------------------------------------------------------------------------
// 1. The contract — docs/07 §4.1, verbatim
// ---------------------------------------------------------------------------

/**
 * Progress reporting. Implementations fan out to:
 *  - the persisted JobRecord (throttled),
 *  - the event bus (for UI subscribers),
 *  - Zotero.ProgressWindow (for the transient popup).
 *
 * A reporter is a *tree*: a pipeline creates child reporters per stage so that a
 * stage reporting 0..1 maps into its slice of the parent's range.
 */
export interface ProgressReporter {
  /** Human-readable current step, e.g. "Fetching PubMed page 3 of 8". */
  setMessage(message: string): void;
  /** Absolute progress. total === undefined means indeterminate. */
  setProgress(completed: number, total?: number): void;
  /** Convenience: completed += n. */
  increment(n?: number): void;
  /**
   * Create a sub-reporter occupying [fromFraction, toFraction] of this
   * reporter's range. Weights let stages of unequal cost divide the bar fairly.
   */
  child(
    label: string,
    fromFraction: number,
    toFraction: number,
  ): ProgressReporter;
  /** Non-fatal issue recorded in the JobRecord's warnings, not a popup. */
  warn(message: string, detail?: Record<string, unknown>): void;
  /** Final state; further calls are ignored. */
  done(outcome: "succeeded" | "failed" | "cancelled", message?: string): void;
}

// ---------------------------------------------------------------------------
// 2. The snapshot
// ---------------------------------------------------------------------------

/**
 * `done()`'s three terminal outcomes, named.
 *
 * §4.1 spells the union inline in `done()`'s signature and that spelling is left
 * exactly as it is above; this alias exists for {@link ProgressSnapshot.status}
 * and for callers, and is deliberately not substituted into the interface.
 */
export type ProgressOutcome = "succeeded" | "failed" | "cancelled";

/**
 * What every sink is handed, and what a UI renders.
 *
 * **Field-compatible with `docs/07` §4.5's `JobProgressSnapshot`, on purpose.**
 * Every member below has §4.5's name and type. It is a *subset*, because a
 * reporter cannot know the rest: §4.5's `spentUsd` belongs to the budget guard
 * and its `status: JobStatus` spans `"queued" | "paused" | "cancelling" |
 * "interrupted"` states that only a queue can be in. §4.5's block declares
 * `src/core/jobQueue/queue.ts`, which is Phase 3's (`docs/11` §1) and is not in
 * this card's `Files` list — so Phase 3 builds `JobProgressSnapshot` by adding
 * those two fields to this one rather than by reconciling two shapes.
 */
export interface ProgressSnapshot {
  /** `"running"` until `done()`; then the outcome it was given. */
  readonly status: "running" | ProgressOutcome;
  /**
   * The count last reported, by whichever node in the tree reported it — the
   * "5" in FR-53's "5 of 7 databases", not a tree-wide sum.
   */
  readonly completed: number;
  /** The total last reported. `undefined` means indeterminate (§4.1). */
  readonly total: number | undefined;
  /**
   * Overall progress across the whole tree, `0..1`, with a child's local
   * `completed/total` mapped into its slice of the parent's range.
   * `undefined` only while the *root* is indeterminate.
   */
  readonly fraction: number | undefined;
  /** The last `setMessage()`, already localized by its caller. */
  readonly message: string;
  /** The `label` of the child that last reported; `undefined` at the root. */
  readonly currentStageKey: string | undefined;
  /** Every `warn()` message so far, for the completion summary (§10.2). */
  readonly warnings: readonly string[];
  /** When the reporter was constructed, from the injected clock. */
  readonly startedAtEpochMs: number;
  /**
   * FR-53's "estimated remaining time", in **seconds**, or `undefined` when it
   * cannot honestly be computed. See {@link etaSecondsOf} for the three cases.
   */
  readonly etaSeconds: number | undefined;
}

// ---------------------------------------------------------------------------
// 3. The sink port
// ---------------------------------------------------------------------------

/**
 * Where a snapshot goes. `Zotero.ProgressWindow` and the search window's status
 * bar behind §2.3's dependency rule.
 *
 * `update` is called at most once per {@link PROGRESS_REPAINT_INTERVAL_MS} plus
 * once per terminal `done()`, so an implementation may repaint synchronously
 * inside it. A sink that throws is isolated: cancellation and the rest of the
 * fan-out still complete, and the throw is swallowed because there is no
 * `console` in the plugin sandbox to report it into (`docs/01` §2.3).
 */
export interface ProgressSink {
  /** Render this snapshot. Called on the main thread; must be cheap. */
  update(snapshot: ProgressSnapshot): void;
  /**
   * A non-fatal issue, with the structured `detail` {@link ProgressSnapshot}
   * cannot carry (§4.1's `warn(message, detail?)`). Optional: a surface that
   * only draws `snapshot.warnings` does not need it. This is **not** a popup —
   * §4.1 and `docs/07` §10.2 both say warnings accumulate for the completion
   * summary.
   */
  warn?(message: string, detail?: Record<string, unknown>): void;
  /**
   * Release whatever the sink holds — a `Zotero.ProgressWindow`, a listener
   * set. `P0-T07`'s scope/teardown registry and `P0-T33`'s leak-per-cycle
   * finding are why this exists: anything the plugin opens on enable must be
   * closable on disable.
   */
  dispose?(): void;
}

/** `docs/07` §7.7's repaint budget: "at most ~4×/second". */
export const PROGRESS_REPAINT_INTERVAL_MS = 250;

/**
 * A sink that discards everything.
 *
 * For a reporter constructed before the container has wired a surface, and for
 * tests that are not about progress. It is not a no-op *reporter*: the range
 * arithmetic, the ETA and the throttle still run, so a test cannot pass because
 * the pipe was dead. (`NULL_LOG_SINK` in `../logger.ts` exists for the same
 * reason.)
 */
export const NULL_PROGRESS_SINK: ProgressSink = {
  update(): void {
    /* discard */
  },
};

// ---------------------------------------------------------------------------
// 4. Shared state and the arithmetic
// ---------------------------------------------------------------------------

/** What every node of one reporter tree shares. */
interface RootState {
  readonly clock: Clock;
  readonly sinks: readonly ProgressSink[];
  readonly throttleMs: number;
  readonly startedAtEpochMs: number;
  status: "running" | ProgressOutcome;
  message: string;
  completed: number;
  total: number | undefined;
  fraction: number | undefined;
  currentStageKey: string | undefined;
  warnings: string[];
  lastPaintMs: number;
  terminal: boolean;
}

/** Clamp into `0..1`; `NaN` becomes `0` rather than poisoning the bar. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * One node's own progress as a fraction of *its* range, before mapping.
 *
 * `total === undefined` is §4.1's indeterminate. `total === 0` is a stage with
 * nothing to do, which is complete rather than indeterminate — a 0-item import
 * must not leave the bar stuck. A negative total is nonsense and reads as
 * indeterminate.
 */
function localFraction(
  completed: number,
  total: number | undefined,
): number | undefined {
  if (total === undefined || total < 0) return undefined;
  if (total === 0) return 1;
  return clamp01(completed / total);
}

/**
 * FR-53's estimated remaining time, in seconds.
 *
 * Linear extrapolation from the overall fraction and the elapsed wall time:
 * `remaining = elapsed × (1 − f) / f`. It is deliberately **not** a smoothed or
 * per-stage estimate — nothing in the corpus specifies one, and a naive ETA that
 * is visibly wrong is easier to reason about than a smoothed one that is
 * invisibly wrong.
 *
 * `undefined` in exactly three cases, each because the number would be a
 * fabrication:
 *
 * 1. **No total.** `fraction` is `undefined`, so there is no denominator. This
 *    is `P1-T15`'s fourth acceptance criterion: the ETA is `undefined` while
 *    `total` is undefined and becomes a number once it is known.
 * 2. **No progress yet.** `fraction <= 0` gives no rate to extrapolate from.
 * 3. **No elapsed time.** A rate measured over zero milliseconds is not a rate.
 *    Under `createManualClock` this is what a test sees if it reports progress
 *    without advancing the clock; in the product `Date.now()` has always moved.
 *
 * At `fraction >= 1` the answer is `0`, not `undefined`: nothing is left.
 *
 * Time is read through the injected {@link Clock}, never `Date.now()` directly —
 * `performance` is absent from the sandbox (`docs/01` §2.3, measured by
 * `P0-T08`) and the clock port is what makes this testable without real time.
 */
function etaSecondsOf(root: RootState): number | undefined {
  const fraction = root.fraction;
  if (fraction === undefined) return undefined;
  if (fraction >= 1) return 0;
  if (fraction <= 0) return undefined;
  const elapsedMs = root.clock.now() - root.startedAtEpochMs;
  if (elapsedMs <= 0) return undefined;
  return Math.round((elapsedMs * (1 - fraction)) / fraction / 1000);
}

/** Freeze the current state into the shape sinks and UIs read. */
function snapshotOf(root: RootState): ProgressSnapshot {
  return {
    status: root.status,
    completed: root.completed,
    total: root.total,
    fraction: root.fraction,
    message: root.message,
    currentStageKey: root.currentStageKey,
    // Copied, so a sink that holds onto a snapshot does not see the array grow
    // under it. Paints are capped at ~4/second, so the allocation is not a cost.
    warnings: [...root.warnings],
    startedAtEpochMs: root.startedAtEpochMs,
    etaSeconds: etaSecondsOf(root),
  };
}

/**
 * Fan one snapshot out to every sink, subject to the throttle.
 *
 * @param force - bypass the throttle. `done()` passes `true`; nothing else does.
 */
function emit(root: RootState, force: boolean): void {
  const now = root.clock.now();
  if (!force && now - root.lastPaintMs < root.throttleMs) return;
  root.lastPaintMs = now;
  const snapshot = snapshotOf(root);
  for (const sink of root.sinks) {
    try {
      sink.update(snapshot);
    } catch {
      /* a surface's failure is its own; the job still has to finish */
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The tree
// ---------------------------------------------------------------------------

/** What one node needs to know about its place in the tree. */
interface NodeConfig {
  readonly root: RootState;
  /** This node's range in *global* `0..1` terms, already mapped. */
  readonly from: number;
  readonly to: number;
  /** `child()`'s `label`, surfaced as `currentStageKey`. `undefined` at the root. */
  readonly stageKey: string | undefined;
  readonly parent: ProgressNode | undefined;
  readonly isRoot: boolean;
}

/**
 * One node of the reporter tree. Every node writes into the same
 * {@link RootState}; what distinguishes them is the `[from, to]` slice their own
 * `0..1` maps onto and the `stageKey` they stamp on the snapshot.
 *
 * Counts are **per node**: a child's `increment()` advances the child, never the
 * parent's count. Only the *last reported* pair is published to the snapshot,
 * which is what `docs/08` §4.5's wireframe draws ("5 of 7 databases" beside a
 * bar showing overall progress).
 */
class ProgressNode implements ProgressReporter {
  private readonly root: RootState;
  private readonly from: number;
  private readonly to: number;
  private readonly stageKey: string | undefined;
  private readonly parent: ProgressNode | undefined;
  private readonly isRoot: boolean;

  private completed = 0;
  private total: number | undefined;
  private finished = false;

  constructor(config: NodeConfig) {
    this.root = config.root;
    this.from = config.from;
    this.to = config.to;
    this.stageKey = config.stageKey;
    this.parent = config.parent;
    this.isRoot = config.isRoot;
  }

  /**
   * §4.1's "further calls are ignored", for this node.
   *
   * Three ways to become inert: this node finished, the root reached a terminal
   * state, or an ancestor finished. The third matters because a stage that
   * failed must not have a live sub-reporter still moving the bar.
   */
  private get inert(): boolean {
    return this.finished || this.root.terminal || this.parent?.inert === true;
  }

  /** Map this node's local `0..1` onto its global slice. */
  private mapFraction(local: number | undefined): number | undefined {
    if (local === undefined) {
      // An indeterminate *child* pins the bar at the start of its own slice:
      // the parent's structure still knows the stages before it are done. An
      // indeterminate *root* is genuinely unknown, which is §4.1's
      // "total === undefined means indeterminate".
      return this.isRoot ? undefined : this.from;
    }
    return this.from + local * (this.to - this.from);
  }

  /** Publish this node's counts and position into the shared snapshot state. */
  private publish(): void {
    this.root.completed = this.completed;
    this.root.total = this.total;
    this.root.currentStageKey = this.stageKey;
    this.root.fraction = this.mapFraction(
      localFraction(this.completed, this.total),
    );
  }

  setMessage(message: string): void {
    if (this.inert) return;
    this.root.message = message;
    this.root.currentStageKey = this.stageKey;
    emit(this.root, false);
  }

  /**
   * §4.1: "Absolute progress. total === undefined means indeterminate."
   *
   * Read literally, and it is worth knowing: omitting `total` on a later call
   * does **not** keep the total already set, it declares the node indeterminate
   * again. {@link increment} is the call that keeps a known total.
   */
  setProgress(completed: number, total?: number): void {
    if (this.inert) return;
    this.completed = completed;
    this.total = total;
    this.publish();
    emit(this.root, false);
  }

  /** §4.1: "Convenience: completed += n." */
  increment(n = 1): void {
    if (this.inert) return;
    this.completed += n;
    this.publish();
    emit(this.root, false);
  }

  child(
    label: string,
    fromFraction: number,
    toFraction: number,
  ): ProgressReporter {
    // `[from, to]` are the *child's* fractions of *this* node's range, so they
    // compose: a child of a child occupies a slice of a slice. Out-of-order or
    // out-of-range arguments are clamped rather than thrown — a reporter that
    // crashed a pipeline over a cosmetic range would be worse than a bar that
    // is slightly wrong.
    const lo = clamp01(Math.min(fromFraction, toFraction));
    const hi = clamp01(Math.max(fromFraction, toFraction));
    const span = this.to - this.from;
    return new ProgressNode({
      root: this.root,
      from: this.from + lo * span,
      to: this.from + hi * span,
      stageKey: label,
      parent: this,
      isRoot: false,
    });
  }

  warn(message: string, detail?: Record<string, unknown>): void {
    if (this.inert) return;
    this.root.warnings.push(message);
    for (const sink of this.root.sinks) {
      try {
        sink.warn?.(message, detail);
      } catch {
        /* as in `emit`: a surface's failure is its own */
      }
    }
    // Throttled, not forced: a warning is not a repaint, and §4.1 is explicit
    // that it is "not a popup". The next paint — or `done()` — carries it.
    emit(this.root, false);
  }

  done(outcome: "succeeded" | "failed" | "cancelled", message?: string): void {
    if (this.inert) return;
    this.finished = true;
    if (message !== undefined) this.root.message = message;
    this.root.currentStageKey = this.stageKey;
    if (outcome === "succeeded") {
      // A stage that succeeded is at the end of its slice, whatever it last
      // counted. A stage that failed or was cancelled stays where it stopped:
      // the bar should not lie about how much work happened.
      if (this.total !== undefined) this.completed = this.total;
      this.root.completed = this.completed;
      this.root.total = this.total;
      this.root.fraction = this.to;
    }
    if (this.isRoot) {
      this.root.status = outcome;
      this.root.terminal = true;
    }
    // Forced: a terminal transition must reach every surface even if the last
    // paint was 3 ms ago. This is the flush that makes the leading-edge
    // throttle safe.
    emit(this.root, true);
  }
}

// ---------------------------------------------------------------------------
// 6. The composite
// ---------------------------------------------------------------------------

/** What {@link CompositeProgressReporter} needs. */
export interface CompositeProgressReporterOptions {
  /**
   * Wall time for the ETA and the throttle. Injected rather than read from
   * `Date.now()` so both are testable with `createManualClock()`.
   */
  readonly clock: Clock;
  /** The surfaces. Empty is legal and means nothing is drawn. */
  readonly sinks?: readonly ProgressSink[];
  /** Defaults to {@link PROGRESS_REPAINT_INTERVAL_MS}. */
  readonly throttleMs?: number;
  /**
   * The job's cancellation token. When it is cancelled the whole tree goes
   * terminal with `done("cancelled")`, so every surface stops and shows the
   * cancelled state without the pipeline having to remember to say so — FR-53's
   * "the operation is cancellable", from the reporter's side. The *button* that
   * cancels the token is the search window's (`docs/08` §4.4), and the token
   * source belongs to the pipeline.
   *
   * Cancellation arrives through {@link CancellationToken}, never an
   * `AbortSignal`: `AbortController` is absent from the plugin sandbox
   * (`docs/01` §2.3, measured by `P0-T08`).
   */
  readonly token?: CancellationToken;
  /** Initial message. Defaults to the empty string. */
  readonly message?: string;
}

/**
 * The root of one reporter tree: `docs/07` §4.1's interface over a fan-out to
 * registered {@link ProgressSink}s.
 *
 * ```ts
 * const reporter = new CompositeProgressReporter({ clock, sinks, token });
 * const fetching = reporter.child("fetch", 0, 0.6);
 * fetching.setProgress(1, 2);        // → reporter.snapshot.fraction === 0.3
 * reporter.done("succeeded");
 * ```
 */
export class CompositeProgressReporter implements ProgressReporter {
  private readonly root: RootState;
  private readonly node: ProgressNode;
  private releaseToken: (() => void) | undefined;
  private disposed = false;

  constructor(options: CompositeProgressReporterOptions) {
    this.root = {
      clock: options.clock,
      sinks: options.sinks ?? [],
      throttleMs: options.throttleMs ?? PROGRESS_REPAINT_INTERVAL_MS,
      startedAtEpochMs: options.clock.now(),
      status: "running",
      message: options.message ?? "",
      completed: 0,
      total: undefined,
      fraction: undefined,
      currentStageKey: undefined,
      warnings: [],
      // Negative infinity, not `now`: the first report of a job paints
      // immediately (leading edge) instead of waiting out an interval, and no
      // paint is spent on the empty state before anything has happened.
      lastPaintMs: Number.NEGATIVE_INFINITY,
      terminal: false,
    };
    this.node = new ProgressNode({
      root: this.root,
      from: 0,
      to: 1,
      stageKey: undefined,
      parent: undefined,
      isRoot: true,
    });
    // Subscribed last, because `onCancelled` fires synchronously — and fires
    // immediately if the token is *already* cancelled — so the callback can run
    // before this constructor returns and must find `this.node` assigned.
    this.releaseToken = options.token?.onCancelled(() => {
      this.done("cancelled");
    });
  }

  setMessage(message: string): void {
    this.node.setMessage(message);
  }

  setProgress(completed: number, total?: number): void {
    this.node.setProgress(completed, total);
  }

  increment(n?: number): void {
    // Forwarded positionally rather than defaulted here, so §4.1's default
    // (`completed += 1`) lives in exactly one place.
    if (n === undefined) this.node.increment();
    else this.node.increment(n);
  }

  child(
    label: string,
    fromFraction: number,
    toFraction: number,
  ): ProgressReporter {
    return this.node.child(label, fromFraction, toFraction);
  }

  warn(message: string, detail?: Record<string, unknown>): void {
    this.node.warn(message, detail);
  }

  done(outcome: "succeeded" | "failed" | "cancelled", message?: string): void {
    this.node.done(outcome, message);
    // The job is over: stop holding a listener on the token. `docs/01` §12
    // gotcha 10 — a live closure on a finished job is the leak `P0-T33` found
    // one instance of and `P0-T11`'s disable/enable cycling is watching for.
    this.dropToken();
  }

  /**
   * Current state. Cheap, synchronous, always defined — the shape `docs/07`
   * §4.5's `JobHandle.progress` promises, available before the queue that will
   * expose it exists.
   */
  get snapshot(): ProgressSnapshot {
    return snapshotOf(this.root);
  }

  /**
   * Release the token subscription and every sink's resources.
   *
   * Idempotent, and separate from `done()`: `done()` ends the *job*, `dispose()`
   * ends the *surfaces*. A pipeline calls it in a `finally`; the plugin's
   * teardown path calls it on disable, which is what stops a
   * `Zotero.ProgressWindow` outliving the plugin that opened it.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropToken();
    for (const sink of this.root.sinks) {
      try {
        sink.dispose?.();
      } catch {
        /* teardown must reach every sink even if one throws */
      }
    }
  }

  private dropToken(): void {
    const release = this.releaseToken;
    this.releaseToken = undefined;
    release?.();
  }
}

// ---------------------------------------------------------------------------
// 7. The dialog sink
// ---------------------------------------------------------------------------

/**
 * The sink `docs/08` §4.4's in-window status bar subscribes to.
 *
 * It draws nothing — it is a snapshot holder with subscribers, which is what
 * keeps `docs/08` §4.4's status bar (and §6.4's item list) a `src/ui/` view over
 * a `core/` value rather than a DOM dependency in the reporter. The shape is
 * `docs/07` §4.5's `JobHandle.subscribe(listener) => unsubscribe`, so the view
 * written against it does not change when Phase 3's queue takes over ownership.
 */
export interface ObservableProgressSink extends ProgressSink {
  /** The last snapshot, or `undefined` before the first report. */
  readonly latest: ProgressSnapshot | undefined;
  /**
   * Subscribe. The current snapshot, if there is one, is delivered
   * synchronously on subscribe — a status bar that attaches after the job
   * started must not render an empty bar until the next repaint. Returns the
   * unsubscribe function, which the window's teardown must call.
   */
  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
  /**
   * Required here, unlike on {@link ProgressSink}: this sink always holds
   * listeners, so its teardown is never a no-op and a caller must not have to
   * test for it.
   */
  dispose(): void;
}

/** Create an {@link ObservableProgressSink}. */
export function createObservableProgressSink(): ObservableProgressSink {
  const listeners = new Set<(snapshot: ProgressSnapshot) => void>();
  let latest: ProgressSnapshot | undefined;

  return {
    update(snapshot: ProgressSnapshot): void {
      latest = snapshot;
      // A copy of the set, so a listener that unsubscribes itself during
      // delivery does not disturb the iteration.
      for (const listener of [...listeners]) {
        try {
          listener(snapshot);
        } catch {
          /* a view's failure is its own */
        }
      }
    },
    subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void {
      listeners.add(listener);
      if (latest !== undefined) {
        try {
          listener(latest);
        } catch {
          /* as above */
        }
      }
      return () => {
        listeners.delete(listener);
      };
    },
    get latest(): ProgressSnapshot | undefined {
      return latest;
    },
    dispose(): void {
      listeners.clear();
      latest = undefined;
    },
  };
}

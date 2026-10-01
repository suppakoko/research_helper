/**
 * The `Zotero.ProgressWindow` surface, as a {@link ProgressSink}.
 *
 * **Scope.** `P1-T15`, step 3. `docs/07` §7.7's first of two v1 progress
 * surfaces — "the transient corner popup, for the 'something is happening'
 * signal" — behind `src/core/jobQueue/progress.ts`'s port. The second surface is
 * the search window's own status bar, which subscribes to
 * `createObservableProgressSink()` in that same file and is drawn by `docs/08`
 * §4.4 / §6.4 in `src/ui/`.
 *
 * **Why a sink and not a `ProgressReporter`.** `docs/07` §7.7's sketch writes
 * `class ZoteroProgressWindowReporter implements ProgressReporter`, which would
 * put a second, parallel implementation of §4.1's six members — including
 * `child()`'s range arithmetic and the ETA — inside `src/zotero/`. `P1-T15`
 * step 1 puts exactly one implementation in `core/` and has it "fan out to
 * registered sinks", so this file implements the sink half of the sketch: the
 * `ProgressWindow` handling, the 250 ms repaint throttle and the close timer,
 * and nothing about progress arithmetic. The sketch's body is reproduced
 * faithfully; only its interface changed.
 *
 * ## The signatures are wrapped on purpose, and are now measured
 *
 * `P1-T15`'s **Do NOT** said to "wrap the calls so a signature change is one
 * edit". {@link ProgressWindowHandle} and {@link ProgressWindowLine} are that
 * wrapper: every platform call this plugin makes to the popup is inside
 * {@link openZoteroProgressWindow}, and the sink above it only ever touches
 * those two interfaces.
 *
 * Wrapping was not theoretical — **three descriptions of this API disagreed,
 * and two of them are in the repository:**
 *
 * | | first ctor arg of `ItemProgress` | icon setter |
 * |---|---|---|
 * | `docs/08` §8.2 (read from `progressWindow.js`) | an **item type** string | `setItemTypeAndIcon`; "there is **no `setIcon()`**" |
 * | `zotero-types@4.1.3` (`types/xpcom/progressWindow.d.ts`) | `iconSrc` | `setIcon(iconSrc)`, and no `setItemTypeAndIcon` |
 * | `docs/07` §7.7's sketch | an empty string, commented "iconURI" | — |
 *
 * **`P1-T29` measured it on 2026-10-01 against a running Zotero 10.0.3 and
 * `docs/08` §8.2 is right on every point** (`test/integration/zotero/progressWindow.spec.ts`;
 * the record is `docs/01` §10.2.1, and `docs/07` §7.7's `Unverified` marker is
 * retired). The first argument is an item type: the constructor's parameter
 * list is `(itemType, text, parentItemProgress)` and its body forwards it to
 * `setItemTypeAndIcon(itemType)`, which writes it verbatim into the icon
 * element's `data-item-type`. `setIcon` **does not exist** — calling it is a
 * `TypeError` — and `setItemTypeAndIcon(itemType, cssIcon = 'item-type')`
 * does. A path passed in that position throws nothing and renders the generic
 * `document` icon instead of the right one, which is why the typings' name is
 * dangerous rather than merely inaccurate.
 *
 * So `addLine()` below passes an item-type string, and neither icon setter is
 * called at all: the ctor argument already sets the icon. The code did not have
 * to change when the measurement came in — the wrapper is what made that true.
 *
 * ## Two things this must not do
 *
 * - **Not leave the popup open for the life of a long job.** `docs/07` §7.7: it
 *   opens `alwaysontop=yes` and floats above other applications, so §7.7
 *   prescribes `startCloseTimer()` "aggressively (close the popup a few seconds
 *   after the job *starts*, not when it ends)". {@link ZoteroProgressWindowSink}
 *   does exactly that and then stops painting into a window Zotero has closed;
 *   the status bar carries the rest.
 * - **Not use `Zotero.showZoteroPaneProgressMeter`.** §7.7: reserved for
 *   blocking operations, and "nothing in this plugin should block the pane". And
 *   not `Zotero.ProgressQueue` either — `docs/08` §8.2.1 and `docs/01` §10.4 own
 *   that decision (fixed three columns, `getString()` throws on a plugin FTL
 *   key, a session-long leak, no Cancel button).
 *
 * The native API is used rather than `zotero-plugin-toolkit`'s
 * `ProgressWindowHelper`: `docs/08` §8.2 notes "the native one has no
 * dependency", and `P0-T33` measured the toolkit leaking a listener per
 * enable/disable cycle and costing 130 KB of bundle.
 */

import type { Clock } from "../core/clock";
import {
  PROGRESS_REPAINT_INTERVAL_MS,
  type ProgressSink,
  type ProgressSnapshot,
} from "../core/jobQueue/progress";

// ---------------------------------------------------------------------------
// 1. The wrapped platform surface
// ---------------------------------------------------------------------------

/** The three `ItemProgress` members this plugin calls. */
export interface ProgressWindowLine {
  /** 0–100. Values strictly between render an arc; 100 restores the icon. */
  setProgress(percent: number): void;
  setText(text: string): void;
  /** Marks the line as failed (`docs/08` §8.2). */
  setError(): void;
}

/** The five `Zotero.ProgressWindow` members this plugin calls. */
export interface ProgressWindowHandle {
  show(): void;
  /** `docs/08` §8.2: the second argument is a **CSS icon key**, not a URL. */
  changeHeadline(text: string, cssIconKey?: string, postText?: string): void;
  /**
   * One line. The first argument is an **item type** string — measured, not
   * assumed (`P1-T29`, `docs/01` §10.2.1).
   */
  addLine(itemType: string, text: string): ProgressWindowLine;
  /**
   * A **no-op if called before `show()`** — confirmed by `P1-T29` against
   * Zotero 10.0.3, so every caller here shows first. The guard is
   * `_windowLoaded || _windowLoading` and `show()` sets `_windowLoading`
   * synchronously, so *`show()` having been called* is enough; the window does
   * not have to finish loading. Default in Zotero is 2500 ms.
   */
  startCloseTimer(ms: number): void;
  close(): void;
}

/**
 * Open a real `Zotero.ProgressWindow`.
 *
 * The only place in the plugin that names the platform class. Everything the
 * "unverified signatures" marker in `docs/07` §7.7 covers is inside this
 * function.
 *
 * @param win - the window to parent the popup to. `Zotero.ProgressWindow` takes
 *   `{ window, closeOnClick }` and nothing else (`docs/08` §8.2); omitted means
 *   Zotero's default.
 */
export function openZoteroProgressWindow(win?: Window): ProgressWindowHandle {
  const pw = new Zotero.ProgressWindow({
    // `closeOnClick: false`: the popup is a status signal, and the Cancel
    // affordance FR-53 requires is the search window's button (`docs/08` §4.4),
    // not a click on a toast.
    closeOnClick: false,
    // Spread rather than `window: win`: `exactOptionalPropertyTypes` rejects an
    // explicit `undefined` for an optional property.
    ...(win !== undefined && { window: win }),
  });

  return {
    show(): void {
      pw.show();
    },
    changeHeadline(text: string, cssIconKey?: string, postText?: string): void {
      pw.changeHeadline(text, cssIconKey, postText);
    },
    addLine(itemType: string, text: string): ProgressWindowLine {
      // `ItemProgress` is constructed off the *instance*, not off `Zotero`
      // (`docs/08` §8.2). `zotero-types@4.1.3` names this parameter `iconSrc`
      // and is wrong: `P1-T29` measured it as an item type in Zotero 10.0.3
      // (`docs/01` §10.2.1). The two types agree on `string`, so being right
      // costs no cast.
      return new pw.ItemProgress(itemType, text);
    },
    startCloseTimer(ms: number): void {
      pw.startCloseTimer(ms);
    },
    close(): void {
      pw.close();
    },
  };
}

// ---------------------------------------------------------------------------
// 2. The sink
// ---------------------------------------------------------------------------

/**
 * `docs/07` §7.7's "close the popup a few seconds after the job *starts*".
 * Matches the 4000 ms of `docs/08` §8.2's worked example.
 */
export const PROGRESS_WINDOW_CLOSE_MS = 4000;

/**
 * Zotero's default item type for a progress line. `docs/08` §8.2's example uses
 * `'journalArticle'`; this plugin's items are journal articles and preprints.
 */
const DEFAULT_ITEM_TYPE = "journalArticle";

/** What {@link ZoteroProgressWindowSink} needs. */
export interface ZoteroProgressWindowSinkOptions {
  /** Drives the repaint throttle and the close deadline. */
  readonly clock: Clock;
  /**
   * The headline text, **already localized**.
   *
   * `docs/07` §7.7's sketch writes `changeHeadline(getString(headlineKey))`, and
   * that is not available to a plugin: `docs/08` §8.2.1 records that
   * `Zotero.getString()` **throws on an unknown key** when
   * `Zotero.locale === 'en-US'`, because a plugin's `.ftl` is registered into
   * `L10nRegistry` but not into `getString`'s synchronous bundle. Plugin strings
   * resolve through Fluent (`docs/01` §9.1, `P1-T18`'s `src/i18n/ftl.ts`), which
   * is `async`, so the caller resolves the string and passes it here.
   */
  readonly headline: string;
  /** `changeHeadline`'s CSS icon key (`docs/08` §8.2). Defaults to `"library"`. */
  readonly headlineIcon?: string;
  /** `changeHeadline`'s trailing text, already localized. */
  readonly postText?: string;
  /** The `ItemProgress` item type. Defaults to `"journalArticle"`. */
  readonly itemType?: string;
  /** The window the popup is parented to. */
  readonly window?: Window;
  /** Defaults to {@link PROGRESS_REPAINT_INTERVAL_MS}. */
  readonly throttleMs?: number;
  /** Defaults to {@link PROGRESS_WINDOW_CLOSE_MS}. */
  readonly closeAfterMs?: number;
  /**
   * When the popup is raised.
   *
   * - `"progress"` (default) — §7.7's behaviour: open on the first progress
   *   report, then close a few seconds later.
   * - `"completion"` — `docs/08` §4.4's behaviour for the import pipeline: "a
   *   `Zotero.ProgressWindow` toast is raised **only on completion** so the user
   *   gets feedback if they have switched away from the window". Nothing is
   *   drawn until `done()`.
   *
   * The two sections describe different pipelines, not a contradiction: §4.4 is
   * `searchImport`, whose progress lives in the window's status bar because that
   * is where the Cancel button is, while §7.7's short pipelines (`related`,
   * `audioReport`) have no window of their own.
   */
  readonly openOn?: "progress" | "completion";
  /**
   * How a snapshot becomes the line's text. Defaults to the message the
   * pipeline already localized.
   *
   * There is no default that composes counts or an ETA into a sentence:
   * `docs/08` §10.3 forbids concatenating localized strings and requires `Intl`
   * with `Zotero.locale` for numbers, and the Fluent bundles are `P1-T18`'s. The
   * counts and the ETA are rendered by the status bar, from
   * {@link ProgressSnapshot}; this popup carries the one-line signal.
   */
  readonly formatLine?: (snapshot: ProgressSnapshot) => string;
  /** Test seam and the single platform call site. Defaults to {@link openZoteroProgressWindow}. */
  readonly openWindow?: () => ProgressWindowHandle;
}

/**
 * `Zotero.ProgressWindow` as a {@link ProgressSink}.
 *
 * Lifecycle, in order:
 *
 * 1. The first snapshot that gets past the throttle opens the popup, sets the
 *    headline, adds one line, and starts Zotero's close timer immediately —
 *    §7.7's "a few seconds after the job starts".
 * 2. Later snapshots repaint that line, at most once per `throttleMs`, until the
 *    close deadline passes; after it, nothing is painted, because the window is
 *    gone.
 * 3. A terminal snapshot (`status !== "running"`) opens a fresh popup if the
 *    first one has already closed, paints the final state — `setError()` on
 *    `"failed"` — and starts the close timer again. This is the completion toast
 *    `docs/08` §4.4 asks for.
 * 4. {@link dispose} closes whatever is still open. It is what the plugin's
 *    teardown calls so a popup cannot outlive the plugin (`P0-T07`'s scope
 *    registry, `docs/01` §12 gotcha 10).
 */
export class ZoteroProgressWindowSink implements ProgressSink {
  private readonly clock: Clock;
  private readonly throttleMs: number;
  private readonly closeAfterMs: number;
  private readonly openOn: "progress" | "completion";
  private readonly itemType: string;
  private readonly formatLine: (snapshot: ProgressSnapshot) => string;
  private readonly openWindow: () => ProgressWindowHandle;
  private readonly headline: string;
  private readonly headlineIcon: string;
  private readonly postText: string | undefined;
  private readonly window: Window | undefined;

  private handle: ProgressWindowHandle | undefined;
  private line: ProgressWindowLine | undefined;
  private lastPaintMs = Number.NEGATIVE_INFINITY;
  private closesAtMs = Number.POSITIVE_INFINITY;
  private autoClosed = false;
  private disposed = false;

  constructor(options: ZoteroProgressWindowSinkOptions) {
    this.clock = options.clock;
    this.throttleMs = options.throttleMs ?? PROGRESS_REPAINT_INTERVAL_MS;
    this.closeAfterMs = options.closeAfterMs ?? PROGRESS_WINDOW_CLOSE_MS;
    this.openOn = options.openOn ?? "progress";
    this.itemType = options.itemType ?? DEFAULT_ITEM_TYPE;
    this.formatLine = options.formatLine ?? ((snapshot) => snapshot.message);
    this.headline = options.headline;
    this.headlineIcon = options.headlineIcon ?? "library";
    this.postText = options.postText;
    this.window = options.window;
    const win = this.window;
    this.openWindow =
      options.openWindow ?? (() => openZoteroProgressWindow(win));
  }

  update(snapshot: ProgressSnapshot): void {
    if (this.disposed) return;
    const terminal = snapshot.status !== "running";

    if (!terminal) {
      // `docs/08` §4.4: for the import pipeline the toast is raised only on
      // completion; progress lives in the window's status bar.
      if (this.openOn === "completion") return;
      // Once Zotero's close timer has fired, the popup stays gone for the rest
      // of the job. §7.7 is explicit that it is a start signal — "close the
      // popup a few seconds after the job *starts*" — and that the in-window
      // status list carries long-running progress. Reopening it every few
      // hundred milliseconds would be the `alwaysontop` complaint in a loop.
      if (this.autoClosed) return;
      const now = this.clock.now();
      if (now >= this.closesAtMs) {
        // Drop the handle rather than paint into a window that is not there.
        this.autoClosed = true;
        this.release();
        return;
      }
      // §7.7's throttle, as a second line of defence behind
      // `CompositeProgressReporter`'s: at most one repaint per interval, so a
      // 200-item loop cannot repaint 200 times even if driven directly.
      if (this.line !== undefined && now - this.lastPaintMs < this.throttleMs) {
        return;
      }
      this.lastPaintMs = now;
      this.paint(snapshot);
      return;
    }

    // Terminal: always paints, whatever the throttle says — and in a fresh
    // popup if the start-of-job one has already closed. This is `docs/08`
    // §4.4's completion toast, "so the user gets feedback if they have switched
    // away from the window".
    this.lastPaintMs = this.clock.now();
    this.closesAtMs = Number.POSITIVE_INFINITY;
    this.autoClosed = false;
    this.paint(snapshot);
    if (snapshot.status === "failed") this.line?.setError();
    // Restarted for the completion toast. `startCloseTimer` is a no-op before
    // `show()` (`docs/08` §8.2), and `paint()` has already shown.
    this.handle?.startCloseTimer(this.closeAfterMs);
  }

  /** Open the popup if needed, then write this snapshot into its one line. */
  private paint(snapshot: ProgressSnapshot): void {
    if (this.handle === undefined) {
      const handle = this.openWindow();
      handle.changeHeadline(this.headline, this.headlineIcon, this.postText);
      this.line = handle.addLine(this.itemType, this.formatLine(snapshot));
      // `show()` before `startCloseTimer()`, always: the timer is a no-op
      // otherwise (`docs/08` §8.2).
      handle.show();
      handle.startCloseTimer(this.closeAfterMs);
      this.handle = handle;
      this.closesAtMs = this.clock.now() + this.closeAfterMs;
      return;
    }
    this.line?.setText(this.formatLine(snapshot));
    if (snapshot.fraction !== undefined) {
      this.line?.setProgress(percentOf(snapshot.fraction));
    }
  }

  /** Forget the popup without closing it — Zotero's timer already has. */
  private release(): void {
    this.handle = undefined;
    this.line = undefined;
    this.closesAtMs = Number.POSITIVE_INFINITY;
  }

  /** Close whatever is open and refuse further updates. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const handle = this.handle;
    this.release();
    try {
      handle?.close();
    } catch {
      /* a popup Zotero already closed must not fail plugin teardown */
    }
  }
}

/** `0..1` as the 0–100 integer `setProgress` takes (`docs/08` §8.2). */
function percentOf(fraction: number): number {
  const percent = Math.round(fraction * 100);
  return percent < 0 ? 0 : percent > 100 ? 100 : percent;
}

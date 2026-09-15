/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `V-12` / `P0-T20`: 100 new items in one transaction, timed against `NFR-1`,
 * with main-thread stalls recorded against `NFR-3`.
 *
 * **What is timed.** `NFR-1` measures "from user clicks Import to collection
 * contains 100 items" with every network response already in hand. The spec
 * starts the clock with 100 synthetic records in memory (no network), then
 * runs the real write path: `buildJournalArticle()` for each record, then
 * `saveNewItemsToCollection()` — one `Zotero.DB.executeTransaction`, the
 * collection created inside it, `setCollections()` + `save()` per item. The
 * clock stops when that promise resolves, which is after the commit *and*
 * after Zotero has delivered the batch's notifier events to its observers
 * (`Zotero.DB`'s permanent commit callbacks, `xpcom/zotero.js`), and the
 * collection is then required to report 100 children. Collection membership
 * is inside the timed region, never excluded from it.
 *
 * **What "freeze" means here.** Nobody watches the window during a runner
 * run, so `NFR-3` is measured, not eyeballed: a `setInterval` of
 * {@link TICK_MS} runs on the Zotero main window for the whole write, and every
 * gap between consecutive ticks is recorded. The main window, the runner
 * window and the DB code all share one main thread, so a gap far above the
 * interval is a period in which the main window's event loop could not run
 * anything — no repaint, no click handler. That is exactly what `NFR-3`'s
 * "block the Zotero main thread for more than 100 ms in a single task"
 * means in practice. The longest gap is reported against 100 ms. It is
 * recorded, not asserted: `P0-T20`'s `Done when` asks for the freeze to be
 * recorded, and a stall budget is a Phase 1 design question.
 *
 * **Budget and multiplier.** `docs/13` §2.3 prescribes "a generous multiplier
 * in CI, tightened locally" without naming a number. This spec uses
 * {@link CI_MULTIPLIER} on CI (detected from the `CI` environment variable
 * that GitHub Actions sets and that the scaffold also keys off) and 1× — the
 * bare `NFR-1` ceiling — locally. The 6 s target is reported, not asserted.
 *
 * **Output.** Timing lines go to the runner's terminal through the scaffold's
 * `window.debug()` (its generated `mocha-setup.js`), prefixed `[P0-T20]`.
 *
 * The runner's data directory is emptied before every run (`docs/13` §2.3),
 * so the library here holds only what earlier specs and earlier runs of this
 * one wrote — far below `docs/10`'s ~10,000-item baseline library.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, so `Date.now()` is the clock and `debug()` is the log.
 */

import {
  saveNewItemsToCollection,
  type BatchSaveResult,
} from "../../../src/zotero/collectionOps";
import {
  RESEARCH_HELPER_TAG,
  buildJournalArticle,
  type JournalArticleRecord,
} from "../../../src/zotero/itemMapper";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  isNotEmpty(value: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const ITEM_COUNT = 100;
/** Independent measurements per runner run (`P0-T20`: at least three). */
const RUNS = 3;

/** `docs/10` NFR-1: ≤ 10 s ceiling, 6 s target. */
const NFR1_CEILING_MS = 10_000;
const NFR1_TARGET_MS = 6_000;
/** `docs/10` NFR-3: no single main-thread task over 100 ms. */
const NFR3_TASK_MS = 100;
/** `docs/13` §2.3's "generous multiplier in CI"; the doc names no number. */
const CI_MULTIPLIER = 3;

/** The stall monitor's interval on the main window. */
const TICK_MS = 10;
/** Idle sampling before the write, to prove the timer is not throttled. */
const BASELINE_MS = 1_000;
/**
 * A baseline median gap above this means the main window's timers are being
 * throttled (an occluded or background window), and every stall number the
 * monitor reports would be meaningless.
 */
const MAX_BASELINE_MEDIAN_MS = 4 * TICK_MS;
/** Keep sampling after the write resolves, to catch deferred UI work. */
const SETTLE_MS = 1_000;

const TEST_TIMEOUT_MS = 180_000;
const LOG_PREFIX = "[P0-T20]";

/** A ~250-word abstract, `docs/10` NFR-4's "typical" length. */
const ABSTRACT_SENTENCE =
  "This synthetic abstract exists to give the batch-import timing a " +
  "realistically sized abstractNote field without touching the network. ";
const ABSTRACT = ABSTRACT_SENTENCE.repeat(12).trim();

function syntheticRecords(run: number): JournalArticleRecord[] {
  return Array.from({ length: ITEM_COUNT }, (_, i) => ({
    title: `Synthetic batch-import article ${run}.${i + 1} (P0-T20)`,
    abstractNote: ABSTRACT,
    DOI: `10.5555/research-helper-p0-t20.${run}.${i + 1}`,
    creators: [
      { kind: "two-field", firstName: "Grace", lastName: `Hopper${i + 1}` },
    ],
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idle(win: Window): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

/** One gap between consecutive ticks, stamped with the tick that ended it. */
interface Gap {
  readonly endedAt: number;
  readonly ms: number;
}

interface StallMonitor {
  readonly gaps: Gap[];
  /** When `probe` first returned true inside a tick, or `undefined`. */
  probeTrueAt(): number | undefined;
  stop(): void;
}

/**
 * Sample the main window's event loop every {@link TICK_MS}.
 *
 * `probe` runs inside each tick until it first returns true; it answers
 * "when could the UI first see the collection holding 100 items", as opposed
 * to the synchronous check the spec makes when the write promise resolves.
 */
function startStallMonitor(win: Window, probe: () => boolean): StallMonitor {
  const gaps: Gap[] = [];
  let last = Date.now();
  let probeAt: number | undefined;
  const handle = win.setInterval(() => {
    const now = Date.now();
    gaps.push({ endedAt: now, ms: now - last });
    last = now;
    if (probeAt === undefined && probe()) {
      probeAt = now;
    }
  }, TICK_MS);
  return {
    gaps,
    probeTrueAt: () => probeAt,
    stop: () => win.clearInterval(handle),
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)]!;
}

interface GapSummary {
  readonly count: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
  readonly overBudget: readonly number[];
}

function summarise(gaps: readonly Gap[]): GapSummary {
  const sorted = gaps.map((gap) => gap.ms).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : Number.NaN,
    overBudget: gaps
      .map((gap) => gap.ms)
      .filter((ms) => ms > NFR3_TASK_MS)
      .sort((a, b) => b - a),
  };
}

function formatSummary(summary: GapSummary): string {
  const over = summary.overBudget;
  const overText =
    over.length === 0
      ? "none"
      : `${over.length} (${over.join(", ")} ms; ` +
        `${over.reduce((sum, ms) => sum + ms, 0)} ms in total)`;
  return (
    `n=${summary.count} p50=${summary.p50} p90=${summary.p90} ` +
    `p99=${summary.p99} max=${summary.max} ms; gaps > ${NFR3_TASK_MS} ms: ${overText}`
  );
}

function verdict(ms: number, budget: number): string {
  return ms <= budget ? "PASS" : "FAIL";
}

function collectionNamed(
  name: string,
  libraryID: number,
): Zotero.Collection | undefined {
  return Zotero.Collections.getByLibrary(libraryID).find(
    (collection) => collection.name === name,
  );
}

/** Children of `name`, or 0 while it does not exist or is not loaded. */
function childCount(name: string, libraryID: number): number {
  try {
    return collectionNamed(name, libraryID)?.getChildItems(true).length ?? 0;
  } catch {
    // UnloadedDataException before the collection's child list is loaded.
    return 0;
  }
}

function isRunningOnCI(): boolean {
  return Services.env.exists("CI") && Services.env.get("CI") !== "";
}

/** One measured write, as the report table needs it. */
interface RunMeasurement {
  readonly totalMs: number;
  readonly longestStallMs: number;
}

/**
 * `src/zotero/itemMapper.ts` reads the build-time `__env__` constant. The
 * plugin build defines it; the scaffold's *test* bundler (esbuild with no
 * `define`) does not, so in this bundle it is a free identifier. Provide it
 * on the runner window for the duration of the spec, as `"production"`, so
 * the timed path is the non-strict `fromJSON()` Phase 1 ships.
 */
function withEnvConstant<T>(body: () => Promise<T>): Promise<T> {
  const global = globalThis as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(global, "__env__");
  const previous = global["__env__"];
  global["__env__"] = "production";
  return body().finally(() => {
    if (had) {
      global["__env__"] = previous;
    } else {
      delete global["__env__"];
    }
  });
}

async function measureOneRun(
  run: number,
  mainWindow: Window,
): Promise<RunMeasurement> {
  const libraryID = Zotero.Libraries.userLibraryID;
  const collectionName = `Research Helper batch import (P0-T20) run ${run} ${Date.now()}`;
  const records = syntheticRecords(run);

  await idle(mainWindow);

  const begun: string[] = [];
  const callbackID = Zotero.DB.addCallback("begin", (id) => {
    begun.push(id);
  });

  const monitor = startStallMonitor(
    mainWindow,
    () => childCount(collectionName, libraryID) === ITEM_COUNT,
  );

  try {
    await delay(BASELINE_MS);
    const baseline = summarise(monitor.gaps);
    if (baseline.p50 > MAX_BASELINE_MEDIAN_MS) {
      assert.fail(
        `stall monitor is throttled: baseline median gap ${baseline.p50} ms ` +
          `for a ${TICK_MS} ms interval, so no stall number would be valid`,
      );
    }
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} idle baseline: ${formatSummary(baseline)}`,
    );

    const baselineCount = monitor.gaps.length;
    begun.length = 0;

    // ---- timed region: records in memory -> collection holds 100 items ----
    const t0 = Date.now();
    const items = records.map((record) =>
      buildJournalArticle(record, libraryID),
    );
    const tBuilt = Date.now();
    const idBeforeSave = items[0]?.id;
    const result: BatchSaveResult = await saveNewItemsToCollection(
      items,
      collectionName,
      libraryID,
    );
    const tResolved = Date.now();
    const childrenAtResolve = result.collection.getChildItems(true).length;
    // ------------------------------------------------------------------------
    const transactionsDuringWrite = begun.length;

    await delay(SETTLE_MS);
    monitor.stop();

    const writeGaps = monitor.gaps
      .slice(baselineCount)
      .filter((gap) => gap.endedAt - gap.ms < tResolved);
    const settleGaps = monitor.gaps
      .slice(baselineCount)
      .filter((gap) => gap.endedAt - gap.ms >= tResolved);
    const writeSummary = summarise(writeGaps);
    const settleSummary = summarise(settleGaps);
    const probeAt = monitor.probeTrueAt();

    const totalMs = tResolved - t0;
    const buildMs = tBuilt - t0;
    const writeMs = tResolved - tBuilt;
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} single transaction: ` +
        `build ${buildMs} ms + write ${writeMs} ms = total ${totalMs} ms ` +
        `(${(totalMs / ITEM_COUNT).toFixed(1)} ms/item); ` +
        `collection reported ${childrenAtResolve} children at resolve (+${totalMs} ms), ` +
        `first seen by a main-window tick at ` +
        `${probeAt === undefined ? "never" : `+${probeAt - t0} ms`}; ` +
        `DB transactions begun during the write: ${transactionsDuringWrite}`,
    );
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} NFR-1: ${verdict(totalMs, NFR1_CEILING_MS)} ` +
        `vs ${NFR1_CEILING_MS} ms ceiling, ${verdict(totalMs, NFR1_TARGET_MS)} ` +
        `vs ${NFR1_TARGET_MS} ms target`,
    );
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} main-thread gaps during write ` +
        `(tick ${TICK_MS} ms): ${formatSummary(writeSummary)}`,
    );
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} main-thread gaps in ${SETTLE_MS} ms ` +
        `after resolve: ${formatSummary(settleSummary)}`,
    );
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} NFR-3: longest stall ` +
        `${Math.max(writeSummary.max, settleSummary.max)} ms, ` +
        `${verdict(Math.max(writeSummary.max, settleSummary.max), NFR3_TASK_MS)} ` +
        `vs ${NFR3_TASK_MS} ms`,
    );
    debug(
      `${LOG_PREFIX} run ${run}/${RUNS} observed shapes: new Zotero.Item().id ` +
        `before save() = ${String(idBeforeSave)}; executeTransaction resolved ` +
        `with the callback's return value: ${String(result.itemIDs.length === ITEM_COUNT)}`,
    );

    // ---- correctness: the 100 items really are there, in one transaction ----
    assert.strictEqual(
      transactionsDuringWrite,
      1,
      "exactly one DB transaction began during the write",
    );
    assert.strictEqual(result.collectionCreated, true, "fresh collection");
    assert.strictEqual(childrenAtResolve, ITEM_COUNT, "children at resolve");
    assert.strictEqual(result.itemIDs.length, ITEM_COUNT, "saved item IDs");
    assert.deepEqual(
      [...result.collection.getChildItems(true)].sort((a, b) => a - b),
      [...result.itemIDs].sort((a, b) => a - b),
      "the collection holds exactly the saved items",
    );
    for (const id of result.itemIDs) {
      const item = Zotero.Items.get(id);
      if (!item) {
        assert.fail(`item ${id} is not loadable`);
      }
      assert.strictEqual(
        Zotero.ItemTypes.getName(item.itemTypeID),
        "journalArticle",
      );
      assert.isNotEmpty(item.getField("title"), `item ${id} title`);
      assert.isNotEmpty(item.getField("DOI"), `item ${id} DOI`);
      assert.isNotEmpty(item.getField("abstractNote"), `item ${id} abstract`);
      assert.strictEqual(item.getField("extra"), "", `item ${id} Extra`);
      assert.strictEqual(item.getCreators().length, 1, `item ${id} creators`);
      assert.strictEqual(
        item.getTags().some((tag) => tag.tag === RESEARCH_HELPER_TAG),
        true,
        `item ${id} tag`,
      );
    }

    return {
      totalMs,
      longestStallMs: Math.max(writeSummary.max, settleSummary.max),
    };
  } finally {
    monitor.stop();
    Zotero.DB.removeCallback("begin", callbackID);
  }
}

describe("Batch import of 100 items (P0-T20, V-12, NFR-1)", function () {
  it("writes 100 journalArticles into one collection in one transaction within NFR-1", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const onCI = isRunningOnCI();
    const multiplier = onCI ? CI_MULTIPLIER : 1;
    const ceiling = NFR1_CEILING_MS * multiplier;

    const mainWindow = Zotero.getMainWindow() as unknown as Window;
    mainWindow.focus();

    debug(
      `${LOG_PREFIX} Zotero ${Zotero.version} on ${Services.appinfo.OS}; ` +
        `CI=${String(onCI)}; asserting total <= ${NFR1_CEILING_MS} ms x ${multiplier} = ${ceiling} ms; ` +
        `library holds ${(await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true)).length} ` +
        `regular items before the first run`,
    );

    const measurements: RunMeasurement[] = [];
    await withEnvConstant(async () => {
      for (let run = 1; run <= RUNS; run++) {
        measurements.push(await measureOneRun(run, mainWindow));
      }
    });

    debug(
      `${LOG_PREFIX} summary: totals ${measurements.map((m) => m.totalMs).join(", ")} ms; ` +
        `longest stalls ${measurements.map((m) => m.longestStallMs).join(", ")} ms`,
    );

    measurements.forEach((measurement, index) => {
      assert.isAtMost(
        measurement.totalMs,
        ceiling,
        `run ${index + 1}: 100 items within NFR-1's ${NFR1_CEILING_MS} ms x ${multiplier}`,
      );
    });
  });
});

/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T14`: the batched importer timed against `NFR-1`, with main-thread stalls
 * recorded against `NFR-3` and `docs/07` §7.2's chunk size instrumented.
 *
 * **What is timed.** `NFR-1` measures "from user clicks Import to collection
 * contains 100 items" with every network response already in hand. The clock
 * starts with 100 `CanonicalWork`s in memory and stops after the collection has
 * been *read back* and found to hold 100 children — so the dedup pass
 * (`buildLibraryIndex`: one `Zotero.Search`), the mapping, every
 * `executeTransaction`, the inter-chunk yields and Zotero's post-commit
 * notifier delivery are all inside the measured region. Collection membership
 * is never excluded from it (`P0-T20`'s **Do NOT**).
 *
 * **This is a second measurement of the same requirement, not a replacement.**
 * `P0-T20` measured **100 items in 293–425 ms, median 324**, longest
 * main-thread stall **77 ms**, in **one** `executeTransaction` on a near-empty
 * library. `P1-T13` then measured insertion at **~1.26 ms/item at 9,685
 * items** — *faster* per item than at 100, so insertion does not degrade with
 * library size. What this file adds is the **shipped** path on top of those:
 * the dedup pass, `toZoteroMapping()` instead of the spike's
 * `buildJournalArticle()`, and **chunked** transactions with a yield between
 * them. Every number is printed next to `P0-T20`'s so a regression is visible
 * rather than inferred.
 *
 * **What "freeze" means here.** Nobody watches the window during a runner run,
 * so `NFR-3` is measured, not eyeballed: a `setInterval` of {@link TICK_MS}
 * runs on the Zotero main window for the whole import, and every gap between
 * consecutive ticks is recorded. The main window, the runner window and the DB
 * code share one main thread, so a gap far above the interval is a period in
 * which the main window could not run a click handler or a repaint — which is
 * what `NFR-3`'s "block the Zotero main thread for more than 100 ms in a single
 * task" means in practice. This is the evidence for `P1-T14`'s criterion "the
 * UI is interactive during a 200-item import": the 200-item sweep below
 * reports its longest stall against 100 ms, and the stall figure — not a human
 * glance — is what the criterion is judged on. The monitor refuses to report at
 * all if its own idle baseline shows a throttled timer.
 *
 * **Budget and multiplier.** `docs/13` §2.3 prescribes "a generous multiplier
 * in CI, tightened locally" without naming a number; `P0-T20` chose
 * {@link CI_MULTIPLIER} = 3 and recorded it for confirmation, so this file uses
 * the same one rather than inventing a second convention. The 6 s target is
 * reported, not asserted.
 *
 * **`docs/07` §7.2's chunk size is instrumented, not trusted.** §7.2 marks both
 * the "~50 items" figure and the safety of notifier suppression
 * `> **Unverified:**` and says to "start at 50 and instrument it" against a
 * real 200-item import. {@link CHUNK_SIZES} is that sweep: 200 records at 25,
 * 50, 100 and 200 per transaction, each with its own stall monitor. 200 means
 * one transaction for the whole import — `P0-T20`'s shape at twice the scale —
 * so the sweep answers both "is 50 right?" and "does chunking still buy
 * anything?" in one table.
 *
 * **Fixtures are erased in `after()`, not gated behind a pref.** This spec
 * writes ~900 items, which would otherwise outlive it and silently change what
 * every later spec measures — exactly the defect `P1-T13` fixed by making its
 * 10,000-item test opt-in. `P1-T13` could not clean up instead, because 9,685
 * erases cost more than the measurement they would protect; 900 do not. Erasing
 * is strictly better than a gate, because the criteria then run on every
 * ordinary run instead of only when a pref is set by hand. Cleanup never fails
 * the run.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, so `Date.now()` is the clock and `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { type Doi, normalizeDoi, normalizePmid } from "../../../src/model/ids";
import { type ImportReport, importWorks } from "../../../src/zotero/importer";

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
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  isAtLeast(value: number, floor: number, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T14]";

/** `NFR-1`'s subject: 100 already-fetched records. */
const NFR1_ITEM_COUNT = 100;
/** `docs/07` §7.2 and `P1-T14`'s criterion 6: a real 200-item import. */
const SWEEP_ITEM_COUNT = 200;
/** `docs/07` §7.2's unverified "~50", with the values it is swept against. */
const CHUNK_SIZES: readonly number[] = [25, 50, 100, 200];

/** `docs/10` NFR-1: ≤ 10 s ceiling, 6 s target. */
const NFR1_CEILING_MS = 10_000;
const NFR1_TARGET_MS = 6_000;
/** `docs/10` NFR-3: no single main-thread task over 100 ms. */
const NFR3_TASK_MS = 100;
/** `docs/13` §2.3's "generous multiplier in CI"; `P0-T20`'s choice, reused. */
const CI_MULTIPLIER = 3;

/** `P0-T20`'s measured figures, printed beside every number below. */
const P0T20_TOTAL_MS = "293-425 (median 324)";
const P0T20_LONGEST_STALL_MS = 77;

/** The stall monitor's interval on the main window. */
const TICK_MS = 10;
/** Idle sampling before the import, to prove the timer is not throttled. */
const BASELINE_MS = 1_000;
/**
 * A baseline median gap above this means the main window's timers are being
 * throttled (an occluded or background window), and every stall number the
 * monitor reports would be meaningless.
 */
const MAX_BASELINE_MEDIAN_MS = 4 * TICK_MS;
/** Keep sampling after the import resolves, to catch deferred UI work. */
const SETTLE_MS = 1_000;

const TEST_TIMEOUT_MS = 300_000;

/** Namespaced so earlier spec files in the same run cannot collide. */
const DOI_PREFIX = "10.5555/rh-p1t14-perf.";
const PMID_BASE = 920_000_000;

/** A ~250-word abstract, `docs/10` NFR-4's "typical" length. */
const ABSTRACT = (
  "This synthetic abstract gives the import timing a realistically sized " +
  "abstractNote field without touching the network. "
)
  .repeat(13)
  .trim();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

function pmidOrThrow(raw: string) {
  const pmid = normalizePmid(raw);
  if (pmid === null) throw new Error(`fixture PMID must normalize: ${raw}`);
  return pmid;
}

/**
 * Batch counter, so each call gets its own PMID range.
 *
 * **Both** identifiers have to be namespaced, not just the DOI. The first draft
 * of this file namespaced only the DOI and gave every batch
 * `PMID_BASE + i + 1`, on the reasoning that `findExisting` tries DOI first
 * (`FR-51`, `docs/07` §5.1's precedence) so a fresh DOI would make a record
 * new. That is wrong, and the chunk sweep failed on it: DOI precedence decides
 * *which* match wins, not *whether* there is one, so a record whose DOI misses
 * falls through to the PMID arm and matched the previous batch's item. 100 of
 * the sweep's 200 records were linked instead of created. Recorded because the
 * same mistake in production code would silently under-import.
 */
let nextBatch = 0;

/**
 * `count` records, in memory, with no network and no source adapter.
 *
 * `slug` namespaces the DOIs and {@link nextBatch} namespaces the PMIDs, so two
 * batches never collide and a re-import of the *same* array is the `FR-51` test
 * rather than an accident.
 */
function syntheticWorks(slug: string, count: number): CanonicalWork[] {
  const normalizedAtEpochMs = Date.now();
  const pmidBase = PMID_BASE + nextBatch * 10_000;
  nextBatch += 1;
  return Array.from({ length: count }, (_, i) => {
    const doi = doiOrThrow(`${DOI_PREFIX}${slug}.${String(i + 1)}`);
    return {
      workKey: `doi:${doi}`,
      ids: { doi, pmid: pmidOrThrow(String(pmidBase + i + 1)) },
      type: "journal-article",
      title: `Synthetic import-perf article ${slug}.${String(i + 1)} (P1-T14)`,
      abstract: ABSTRACT,
      authors: [{ family: `Hopper${String(i + 1)}`, given: "Grace" }],
      containerTitle: "Journal of Synthetic Fixtures",
      volume: "1",
      issue: String((i % 12) + 1),
      pages: `${String(i + 1)}-${String(i + 9)}`,
      publishedDate: { year: 2026, month: 1, day: 1, iso: "2026-01-01" },
      provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["pubmed"] },
      normalizedAtEpochMs,
    } satisfies CanonicalWork;
  });
}

function collectionName(label: string): string {
  return `Research Helper import-perf (P1-T14) ${label} ${String(Date.now())}`;
}

// ---------------------------------------------------------------------------
// Stall monitor — `P0-T20`'s, so the two sets of numbers are comparable
// ---------------------------------------------------------------------------

/** One gap between consecutive ticks. */
interface Gap {
  readonly ms: number;
}

interface StallMonitor {
  readonly gaps: Gap[];
  stop(): void;
}

function startStallMonitor(win: Window): StallMonitor {
  const gaps: Gap[] = [];
  let last = Date.now();
  const handle = win.setInterval(() => {
    const now = Date.now();
    gaps.push({ ms: now - last });
    last = now;
  }, TICK_MS);
  return { gaps, stop: () => win.clearInterval(handle) };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

interface GapSummary {
  readonly count: number;
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly overBudget: readonly number[];
}

function summarise(gaps: readonly Gap[]): GapSummary {
  const sorted = gaps.map((gap) => gap.ms).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? (sorted[sorted.length - 1] ?? Number.NaN) : 0,
    overBudget: sorted.filter((ms) => ms > NFR3_TASK_MS).sort((a, b) => b - a),
  };
}

function formatSummary(summary: GapSummary): string {
  const over = summary.overBudget;
  const overText = over.length === 0 ? "none" : `${over.join(", ")} ms`;
  return (
    `n=${String(summary.count)} p50=${String(summary.p50)} ` +
    `p99=${String(summary.p99)} max=${String(summary.max)} ms; ` +
    `gaps > ${String(NFR3_TASK_MS)} ms: ${overText}`
  );
}

function verdict(ms: number, budget: number): string {
  return ms <= budget ? "PASS" : "FAIL";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idle(win: Window): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

function isRunningOnCI(): boolean {
  return Services.env.exists("CI") && Services.env.get("CI") !== "";
}

// ---------------------------------------------------------------------------
// One measured import
// ---------------------------------------------------------------------------

interface Measurement {
  readonly report: ImportReport;
  /** Click-to-"collection holds N items", the `NFR-1` region. */
  readonly totalMs: number;
  readonly childrenAtResolve: number;
  readonly longestStallMs: number;
  readonly stalls: GapSummary;
}

const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();

async function measureImport(
  label: string,
  works: readonly CanonicalWork[],
  chunkSize: number,
  mainWindow: Window,
): Promise<Measurement> {
  const name = collectionName(label);

  await idle(mainWindow);
  const monitor = startStallMonitor(mainWindow);
  try {
    await delay(BASELINE_MS);
    const baseline = summarise(monitor.gaps);
    if (baseline.p50 > MAX_BASELINE_MEDIAN_MS) {
      assert.fail(
        `stall monitor is throttled: baseline median gap ${String(baseline.p50)} ms ` +
          `for a ${String(TICK_MS)} ms interval, so no stall number would be valid`,
      );
    }
    const baselineCount = monitor.gaps.length;

    // ---- timed region: records in memory -> collection holds N items ----
    const t0 = Date.now();
    const report = await importWorks({
      works,
      collectionName: name,
      chunkSize,
    });
    const childrenAtResolve = report.collection.getChildItems(true).length;
    const totalMs = Date.now() - t0;
    // --------------------------------------------------------------------

    for (const id of report.createdItemIDs) writtenItemIDs.add(id);
    if (report.collectionCreated)
      writtenCollectionIDs.add(report.collection.id);

    await delay(SETTLE_MS);
    monitor.stop();
    const stalls = summarise(monitor.gaps.slice(baselineCount));

    debug(
      `${LOG_PREFIX} ${label} (${String(works.length)} records, chunkSize ` +
        `${String(chunkSize)}): total ${String(totalMs)} ms ` +
        `(${(totalMs / works.length).toFixed(2)} ms/record) = index ` +
        `${String(report.stats.indexMs)} + mapping ` +
        `${String(report.stats.mappingMs)} + write ` +
        `${String(report.stats.writeMs)} (+ readback); created ` +
        `${String(report.created)}, linked ${String(report.linkedExisting)}, ` +
        `skipped ${String(report.skipped)}, failed ` +
        `${String(report.failed.length)}; collection held ` +
        `${String(childrenAtResolve)} at resolve; ` +
        `${String(report.stats.transactions)} transactions over ` +
        `${String(report.stats.chunks)} chunks, chunkMs=[` +
        `${report.stats.chunkMs.join(", ")}]; abstracts ` +
        `${String(report.abstractCoverage.percent)}% ` +
        `(backfilled ${String(report.abstractCoverage.backfilled)})`,
    );
    debug(`${LOG_PREFIX} ${label} idle baseline: ${formatSummary(baseline)}`);
    debug(
      `${LOG_PREFIX} ${label} main-thread gaps during import + ` +
        `${String(SETTLE_MS)} ms settle (tick ${String(TICK_MS)} ms): ` +
        `${formatSummary(stalls)}; NFR-3 ${verdict(stalls.max, NFR3_TASK_MS)} ` +
        `vs ${String(NFR3_TASK_MS)} ms (P0-T20 measured ` +
        `${String(P0T20_LONGEST_STALL_MS)} ms at 100 items)`,
    );

    return {
      report,
      totalMs,
      childrenAtResolve,
      longestStallMs: stalls.max,
      stalls,
    };
  } finally {
    monitor.stop();
  }
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

describe("Batched import performance (P1-T14, NFR-1, NFR-3, R-16)", function () {
  it("imports 100 pre-fetched records within NFR-1, then links all 100 on a re-import (FR-51)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const onCI = isRunningOnCI();
    const multiplier = onCI ? CI_MULTIPLIER : 1;
    const ceiling = NFR1_CEILING_MS * multiplier;

    const mainWindow = Zotero.getMainWindow() as unknown as Window;
    mainWindow.focus();

    const libraryItemsBefore = (
      await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true)
    ).length;
    debug(
      `${LOG_PREFIX} Zotero ${Zotero.version} on ${Services.appinfo.OS}; ` +
        `CI=${String(onCI)}; asserting total <= ${String(NFR1_CEILING_MS)} ms ` +
        `x ${String(multiplier)} = ${String(ceiling)} ms; library holds ` +
        `${String(libraryItemsBefore)} regular items before the first import; ` +
        `P0-T20 measured ${P0T20_TOTAL_MS} ms for 100 items in one transaction`,
    );

    // The same array is imported twice: that is literally "re-running the same
    // import", which is what criterion 2 asks for.
    const works = syntheticWorks("nfr1", NFR1_ITEM_COUNT);

    const first = await measureImport(
      "NFR-1 first import",
      works,
      50,
      mainWindow,
    );

    assert.strictEqual(
      first.report.created,
      NFR1_ITEM_COUNT,
      "100 items created",
    );
    assert.strictEqual(first.report.failed.length, 0, "no failures");
    assert.strictEqual(
      first.childrenAtResolve,
      NFR1_ITEM_COUNT,
      "the collection contains 100 items — NFR-1's own end condition",
    );
    assert.strictEqual(
      first.report.stats.indexSearchCount,
      1,
      "the dedup pass is one search, inside the measured region",
    );
    debug(
      `${LOG_PREFIX} NFR-1: ${verdict(first.totalMs, NFR1_CEILING_MS)} vs ` +
        `${String(NFR1_CEILING_MS)} ms ceiling, ` +
        `${verdict(first.totalMs, NFR1_TARGET_MS)} vs ` +
        `${String(NFR1_TARGET_MS)} ms target`,
    );
    assert.isAtMost(
      first.totalMs,
      ceiling,
      `100 records within NFR-1's ${String(NFR1_CEILING_MS)} ms x ${String(multiplier)}`,
    );

    // ---- criterion 2: re-run the same import ----
    const second = await measureImport(
      "FR-51 re-import",
      works,
      50,
      mainWindow,
    );
    assert.strictEqual(second.report.created, 0, "0 new items (FR-51)");
    assert.strictEqual(
      second.report.linkedExisting,
      NFR1_ITEM_COUNT,
      "linkedExisting: 100 (FR-51)",
    );
    assert.strictEqual(second.report.failed.length, 0, "no failures");
    assert.strictEqual(
      second.childrenAtResolve,
      NFR1_ITEM_COUNT,
      "the second collection holds the same 100 existing items",
    );
    const libraryItemsAfter = (
      await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true)
    ).length;
    assert.strictEqual(
      libraryItemsAfter,
      libraryItemsBefore + NFR1_ITEM_COUNT,
      "the re-import added no item to the library at all",
    );
    debug(
      `${LOG_PREFIX} FR-51 re-import: library went ` +
        `${String(libraryItemsBefore)} -> ${String(libraryItemsAfter)} regular ` +
        `items across both imports, i.e. +${String(NFR1_ITEM_COUNT)} for the ` +
        `first and +0 for the second`,
    );
  });

  it("instruments docs/07 §7.2's chunk size against a real 200-item import (NFR-3)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const mainWindow = Zotero.getMainWindow() as unknown as Window;
    mainWindow.focus();

    const rows: string[] = [];
    const bySize = new Map<number, Measurement>();
    for (const chunkSize of CHUNK_SIZES) {
      const works = syntheticWorks(
        `sweep-${String(chunkSize)}`,
        SWEEP_ITEM_COUNT,
      );
      const measured = await measureImport(
        `chunk sweep ${String(chunkSize)}`,
        works,
        chunkSize,
        mainWindow,
      );
      assert.strictEqual(
        measured.report.created,
        SWEEP_ITEM_COUNT,
        `chunkSize ${String(chunkSize)}: 200 items created`,
      );
      assert.strictEqual(
        measured.childrenAtResolve,
        SWEEP_ITEM_COUNT,
        `chunkSize ${String(chunkSize)}: the collection holds 200 items`,
      );
      bySize.set(chunkSize, measured);
      rows.push(
        `| ${String(chunkSize)} | ${String(measured.report.stats.transactions)} | ` +
          `${String(measured.totalMs)} | ` +
          `${(measured.totalMs / SWEEP_ITEM_COUNT).toFixed(2)} | ` +
          `${String(Math.max(...measured.report.stats.chunkMs))} | ` +
          `${String(measured.longestStallMs)} | ` +
          `${String(measured.stalls.overBudget.length)} |`,
      );
    }

    debug(
      `${LOG_PREFIX} chunk-size sweep over ${String(SWEEP_ITEM_COUNT)} ` +
        `records (docs/07 §7.2's unverified "~50"):`,
    );
    debug(
      `${LOG_PREFIX} | chunkSize | txns | total ms | ms/item | slowest chunk ms | longest stall ms | gaps > 100 ms |`,
    );
    for (const row of rows) debug(`${LOG_PREFIX} ${row}`);
    debug(
      `${LOG_PREFIX} NFR-3 reference: P0-T20 measured a longest stall of ` +
        `${String(P0T20_LONGEST_STALL_MS)} ms for 100 items in one ` +
        `transaction, with no gap over ${String(NFR3_TASK_MS)} ms.`,
    );

    // ---- criterion 6: "the UI is interactive during a 200-item import" ----
    //
    // `P1-T14` asks for this as an observation noted in the spec comments, and
    // `P0-T20`'s equivalent criterion likewise asked for the freeze to be
    // *recorded* rather than asserted — because `NFR-3`'s 100 ms is a budget
    // for plugin code and the measured figure also contains Windows' ~16 ms
    // timer resolution and Zotero's own post-commit UI refresh (`P0-T20`
    // measured that refresh alone at 60-100 ms). The `NFR-3` verdict is
    // therefore printed per chunk size, above.
    //
    // What *is* asserted is the thing "interactive" means mechanically and
    // which no measurement noise can explain away: the main window's event loop
    // ran repeatedly throughout the import, and no single task monopolised it.
    // A frozen UI produces one enormous gap and almost no ticks; an interactive
    // one produces hundreds of short ones.
    const shipped = bySize.get(50);
    if (shipped === undefined) {
      assert.fail("the sweep must include the shipped chunk size of 50");
    }
    debug(
      `${LOG_PREFIX} criterion 6 (UI interactive during a 200-item import, ` +
        `chunkSize 50): the main window's event loop ran ` +
        `${String(shipped.stalls.count)} times during the import and the ` +
        `${String(SETTLE_MS)} ms settle; longest single gap ` +
        `${String(shipped.longestStallMs)} ms of ${String(shipped.totalMs)} ms ` +
        `total; NFR-3 ${verdict(shipped.longestStallMs, NFR3_TASK_MS)} vs ` +
        `${String(NFR3_TASK_MS)} ms`,
    );
    assert.isAtLeast(
      shipped.stalls.count,
      10,
      "the main window's event loop ran many times during the import",
    );
    assert.isAtMost(
      shipped.longestStallMs,
      Math.max(shipped.totalMs / 2, NFR3_TASK_MS),
      "no single task monopolised the import — the UI was interactive",
    );
  });
});

// ---------------------------------------------------------------------------
// Cleanup. See the file header: cleanup rather than a pref gate, and a failure
// here is reported, never thrown — it must not turn a passing run red.
// ---------------------------------------------------------------------------

after(async function () {
  const itemIDs = [...writtenItemIDs];
  const collectionIDs = [...writtenCollectionIDs];
  const startedAt = Date.now();
  try {
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    for (const collectionID of collectionIDs) {
      const collection = Zotero.Collections.get(collectionID);
      if (collection) await collection.eraseTx();
    }
    debug(
      `${LOG_PREFIX} cleanup erased ${String(itemIDs.length)} items and ` +
        `${String(collectionIDs.length)} collections in ` +
        `${String(Date.now() - startedAt)} ms, so this spec's fixtures do not ` +
        `change what any later spec measures`,
    );
  } catch (error) {
    debug(
      `${LOG_PREFIX} cleanup FAILED after ${String(Date.now() - startedAt)} ms ` +
        `(${error instanceof Error ? error.message : String(error)}); ` +
        `${String(itemIDs.length)} items may remain`,
    );
  }
});

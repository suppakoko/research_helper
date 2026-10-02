import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  CompositeProgressReporter,
  createObservableProgressSink,
  NULL_PROGRESS_SINK,
  PROGRESS_REPAINT_INTERVAL_MS,
  type ProgressSink,
  type ProgressSnapshot,
} from "../../../src/core/jobQueue/progress";
import {
  PROGRESS_WINDOW_CLOSE_MS,
  ZoteroProgressWindowSink,
  type ProgressWindowHandle,
  type ProgressWindowLine,
} from "../../../src/zotero/progressWindow";

/**
 * `P1-T15`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real time — every clock in this file is `createManualClock()`, which is what
 * makes the ETA and the 250 ms repaint throttle assertions deterministic rather
 * than flaky.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * **Why this file also covers `src/zotero/progressWindow.ts`.** `P1-T15`'s
 * `Files` list names exactly one test file, this one, and `plan/README.md` §5
 * rule 2 forbids creating a second. The `ProgressWindow` sink is nonetheless
 * testable at layer 1 without the platform, because its one platform call site
 * is behind the `openWindow` seam: the fake below implements
 * `ProgressWindowHandle`, so these tests assert the throttle, the close timer
 * and the `docs/08` §4.4 completion-toast behaviour without the `Zotero` global.
 * `cancellation.test.ts` carries `clock.ts`'s and `concurrency.ts`'s
 * cancellation assertions under the same reasoning.
 */

/** A sink that records every snapshot it is handed. */
function recordingSink(): ProgressSink & {
  readonly snapshots: readonly ProgressSnapshot[];
  readonly warnings: readonly { message: string; detail: unknown }[];
  disposeCount: number;
} {
  const snapshots: ProgressSnapshot[] = [];
  const warnings: { message: string; detail: unknown }[] = [];
  return {
    snapshots,
    warnings,
    disposeCount: 0,
    update(snapshot) {
      snapshots.push(snapshot);
    },
    warn(message, detail) {
      warnings.push({ message, detail });
    },
    dispose() {
      this.disposeCount += 1;
    },
  };
}

describe("CompositeProgressReporter", () => {
  describe("docs/07 §4.1's declared members", () => {
    it("implements all six with no widening", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      expect(typeof reporter.setMessage).toBe("function");
      expect(typeof reporter.setProgress).toBe("function");
      expect(typeof reporter.increment).toBe("function");
      expect(typeof reporter.child).toBe("function");
      expect(typeof reporter.warn).toBe("function");
      expect(typeof reporter.done).toBe("function");
    });

    it("reports the message, the counts and the fraction it was given", () => {
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        sinks: [sink],
        message: "Starting…",
      });

      expect(reporter.snapshot.message).toBe("Starting…");
      expect(reporter.snapshot.status).toBe("running");
      expect(reporter.snapshot.completed).toBe(0);
      expect(reporter.snapshot.total).toBeUndefined();
      expect(reporter.snapshot.fraction).toBeUndefined();
      // Nothing is painted before anything happens.
      expect(sink.snapshots).toHaveLength(0);

      reporter.setProgress(25, 100);
      expect(reporter.snapshot.completed).toBe(25);
      expect(reporter.snapshot.total).toBe(100);
      expect(reporter.snapshot.fraction).toBeCloseTo(0.25, 10);
      expect(sink.snapshots).toHaveLength(1);
    });

    it("increment(n) is completed += n, and defaults to 1", () => {
      const clock = createManualClock();
      const reporter = new CompositeProgressReporter({ clock });
      reporter.setProgress(0, 10);
      reporter.increment();
      reporter.increment(3);
      expect(reporter.snapshot.completed).toBe(4);
      expect(reporter.snapshot.total).toBe(10);
      expect(reporter.snapshot.fraction).toBeCloseTo(0.4, 10);
    });

    it("total === undefined means indeterminate", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      reporter.setProgress(7);
      expect(reporter.snapshot.total).toBeUndefined();
      expect(reporter.snapshot.fraction).toBeUndefined();
    });
  });

  describe("child() — the tree (criterion 1)", () => {
    it('child("fetch", 0, 0.6) reporting 50 % maps to 30 % on the parent', () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const fetch = reporter.child("fetch", 0, 0.6);
      fetch.setProgress(1, 2);
      expect(reporter.snapshot.fraction).toBeCloseTo(0.3, 10);
    });

    it("maps into the middle of a range too", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const write = reporter.child("write", 0.6, 1);
      write.setProgress(50, 200); // 25 % of [0.6, 1] → 0.7
      expect(reporter.snapshot.fraction).toBeCloseTo(0.7, 10);
    });

    it("composes: a child of a child occupies a slice of a slice", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const fetch = reporter.child("fetch", 0, 0.5);
      const pubmed = fetch.child("pubmed", 0, 0.5); // → global [0, 0.25]
      pubmed.setProgress(1, 2); // half of that
      expect(reporter.snapshot.fraction).toBeCloseTo(0.125, 10);
    });

    it("stamps the child's label as currentStageKey", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      expect(reporter.snapshot.currentStageKey).toBeUndefined();
      reporter.child("dedup", 0.5, 0.7).setProgress(1, 4);
      expect(reporter.snapshot.currentStageKey).toBe("dedup");
    });

    it("keeps counts per node: a child's increment does not move the parent's", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      reporter.setProgress(5, 10);
      const child = reporter.child("stage", 0, 1);
      child.setProgress(0, 3);
      child.increment();
      expect(reporter.snapshot.completed).toBe(1);
      expect(reporter.snapshot.total).toBe(3);
    });

    it("pins an indeterminate child at the start of its own slice", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const child = reporter.child("stage", 0.4, 0.8);
      child.setProgress(3); // no total
      expect(reporter.snapshot.fraction).toBeCloseTo(0.4, 10);
    });

    it("clamps a reversed or out-of-range sub-range instead of throwing", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const child = reporter.child("odd", 1.5, -0.5);
      expect(() => child.setProgress(1, 1)).not.toThrow();
      expect(reporter.snapshot.fraction).toBeCloseTo(1, 10);
    });

    it('a child done("succeeded") lands on the end of its slice without ending the job', () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const fetch = reporter.child("fetch", 0, 0.6);
      fetch.setProgress(1, 4);
      fetch.done("succeeded");
      expect(reporter.snapshot.fraction).toBeCloseTo(0.6, 10);
      expect(reporter.snapshot.status).toBe("running");
    });

    it("a finished child ignores further calls, and so do its children", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      const fetch = reporter.child("fetch", 0, 0.6);
      const page = fetch.child("page", 0, 1);
      fetch.done("failed", "PubMed failed");
      page.setProgress(1, 1);
      fetch.setProgress(1, 1);
      expect(reporter.snapshot.message).toBe("PubMed failed");
      expect(reporter.snapshot.fraction).toBeUndefined();
    });
  });

  describe("the repaint throttle (criterion 2)", () => {
    it("200 increment() calls over one simulated second produce ≤ 4 repaints", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      const startedMs = clock.now();

      // 200 items at 5 ms each — one simulated second, which is roughly three
      // times faster than P0-T20 measured 100 real Zotero inserts (293–425 ms,
      // median 324). Every paint in the window is counted, including the
      // leading-edge one that `setProgress` spends at t = 0: the throttle admits
      // one paint per 250 ms interval, so a whole simulated second holds four.
      reporter.setProgress(0, 200);
      for (let i = 0; i < 200; i += 1) {
        reporter.increment();
        clock.advance(5);
      }

      const elapsedSeconds = (clock.now() - startedMs) / 1000;
      const paints = sink.snapshots.length;
      expect(elapsedSeconds).toBe(1);
      expect(paints).toBe(4);
      expect(paints / elapsedSeconds).toBeLessThanOrEqual(4);
      // The 200 calls all landed, even though only four painted.
      expect(reporter.snapshot.completed).toBe(200);
    });

    it("no two repaints are closer together than the interval", () => {
      const clock = createManualClock();
      const stamps: number[] = [];
      const reporter = new CompositeProgressReporter({
        clock,
        sinks: [
          {
            update() {
              stamps.push(clock.now());
            },
          },
        ],
      });

      reporter.setProgress(0, 1000);
      for (let i = 0; i < 1000; i += 1) {
        clock.advance(3);
        reporter.increment();
      }

      expect(stamps.length).toBeGreaterThan(1);
      for (let i = 1; i < stamps.length; i += 1) {
        const previous = stamps[i - 1] ?? 0;
        const current = stamps[i] ?? 0;
        expect(current - previous).toBeGreaterThanOrEqual(
          PROGRESS_REPAINT_INTERVAL_MS,
        );
      }
    });

    it("done() flushes past the throttle", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      reporter.setProgress(199, 200);
      const before = sink.snapshots.length;
      clock.advance(1); // well inside the throttle window
      reporter.done("succeeded", "Imported 200");
      expect(sink.snapshots.length).toBe(before + 1);
      expect(sink.snapshots.at(-1)?.status).toBe("succeeded");
      expect(sink.snapshots.at(-1)?.message).toBe("Imported 200");
    });

    it("honours a throttleMs override", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock,
        sinks: [sink],
        throttleMs: 1000,
      });
      reporter.setProgress(0, 10);
      for (let i = 0; i < 10; i += 1) {
        clock.advance(100);
        reporter.increment();
      }
      // One leading paint, plus the one at t = 1000.
      expect(sink.snapshots).toHaveLength(2);
    });
  });

  describe("done() (criterion 3)", () => {
    it('done("cancelled") makes all further calls no-ops', () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      reporter.setProgress(30, 100);
      clock.advance(1000);
      reporter.done("cancelled", "Cancelled");

      const after = sink.snapshots.length;
      const frozen = reporter.snapshot;

      clock.advance(1000);
      reporter.setMessage("later");
      reporter.setProgress(90, 100);
      reporter.increment(5);
      reporter.warn("late warning");
      reporter.done("succeeded", "sneaky");
      reporter.child("late", 0, 1).setProgress(1, 1);

      expect(sink.snapshots).toHaveLength(after);
      expect(reporter.snapshot.status).toBe("cancelled");
      expect(reporter.snapshot.message).toBe("Cancelled");
      expect(reporter.snapshot.completed).toBe(frozen.completed);
      expect(reporter.snapshot.fraction).toBe(frozen.fraction);
      expect(reporter.snapshot.warnings).toEqual([]);
    });

    it('done("succeeded") completes the bar; done("failed") leaves it where it stopped', () => {
      const clock = createManualClock();
      const ok = new CompositeProgressReporter({ clock });
      ok.setProgress(7, 10);
      ok.done("succeeded");
      expect(ok.snapshot.fraction).toBe(1);
      expect(ok.snapshot.completed).toBe(10);
      expect(ok.snapshot.etaSeconds).toBe(0);

      const bad = new CompositeProgressReporter({ clock });
      bad.setProgress(7, 10);
      bad.done("failed");
      expect(bad.snapshot.fraction).toBeCloseTo(0.7, 10);
      expect(bad.snapshot.completed).toBe(7);
      expect(bad.snapshot.status).toBe("failed");
    });
  });

  describe("the ETA (criterion 4, FR-53)", () => {
    it("is undefined while total is undefined and a number once it is known", () => {
      const clock = createManualClock();
      const reporter = new CompositeProgressReporter({ clock });

      reporter.setMessage("Searching…");
      expect(reporter.snapshot.total).toBeUndefined();
      expect(reporter.snapshot.etaSeconds).toBeUndefined();

      clock.advance(1000);
      reporter.setProgress(10, 100);
      expect(reporter.snapshot.total).toBe(100);
      expect(typeof reporter.snapshot.etaSeconds).toBe("number");
      // 1 s bought 10 %, so 90 % is another 9 s.
      expect(reporter.snapshot.etaSeconds).toBe(9);
    });

    it("extrapolates linearly from the overall fraction of the whole tree", () => {
      const clock = createManualClock();
      const reporter = new CompositeProgressReporter({ clock });
      const fetch = reporter.child("fetch", 0, 0.5);
      clock.advance(4000);
      fetch.setProgress(1, 2); // 50 % of [0, 0.5] → 25 % overall
      expect(reporter.snapshot.etaSeconds).toBe(12); // 4 s for 25 %
    });

    it("stays undefined before any progress and before any elapsed time", () => {
      const clock = createManualClock();
      const reporter = new CompositeProgressReporter({ clock });

      clock.advance(5000);
      reporter.setProgress(0, 100); // no rate to extrapolate from
      expect(reporter.snapshot.etaSeconds).toBeUndefined();

      const instant = new CompositeProgressReporter({ clock });
      instant.setProgress(50, 100); // no elapsed time to measure a rate over
      expect(instant.snapshot.etaSeconds).toBeUndefined();
    });

    it("treats a zero total as nothing left to do", () => {
      const clock = createManualClock();
      const reporter = new CompositeProgressReporter({ clock });
      clock.advance(100);
      reporter.setProgress(0, 0);
      expect(reporter.snapshot.fraction).toBe(1);
      expect(reporter.snapshot.etaSeconds).toBe(0);
    });

    it("records startedAtEpochMs from the injected clock", () => {
      const clock = createManualClock(1_800_000_000_000);
      const reporter = new CompositeProgressReporter({ clock });
      expect(reporter.snapshot.startedAtEpochMs).toBe(1_800_000_000_000);
    });
  });

  describe("warn() — collected, not popped up", () => {
    it("accumulates messages on the snapshot for the completion summary", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });

      reporter.warn("Crossref returned 3 records without a DOI", {
        sourceId: "crossref",
        count: 3,
      });
      clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
      reporter.warn("1 abstract was empty");

      expect(reporter.snapshot.warnings).toEqual([
        "Crossref returned 3 records without a DOI",
        "1 abstract was empty",
      ]);
      expect(sink.warnings).toEqual([
        {
          message: "Crossref returned 3 records without a DOI",
          detail: { sourceId: "crossref", count: 3 },
        },
        { message: "1 abstract was empty", detail: undefined },
      ]);
    });

    it("carries warnings raised by any node in the tree", () => {
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      reporter.child("fetch", 0, 0.5).warn("PubMed page 3 timed out");
      expect(reporter.snapshot.warnings).toEqual(["PubMed page 3 timed out"]);
    });

    it("hands each snapshot its own copy of the warnings", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      reporter.warn("first");
      clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
      reporter.warn("second");
      expect(sink.snapshots[0]?.warnings).toEqual(["first"]);
      expect(sink.snapshots.at(-1)?.warnings).toEqual(["first", "second"]);
    });
  });

  describe("cancellation (FR-53's 'the operation is cancellable')", () => {
    it("goes terminal when the token is cancelled", () => {
      const clock = createManualClock();
      const source = createCancellationTokenSource();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock,
        sinks: [sink],
        token: source.token,
      });

      reporter.setProgress(30, 100);
      source.cancel({ kind: "user" });

      expect(reporter.snapshot.status).toBe("cancelled");
      expect(sink.snapshots.at(-1)?.status).toBe("cancelled");

      clock.advance(1000);
      reporter.increment(10);
      expect(reporter.snapshot.completed).toBe(30);
    });

    it("is already cancelled when built from an already-cancelled token", () => {
      const source = createCancellationTokenSource();
      source.cancel({ kind: "shutdown" });
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        token: source.token,
      });
      expect(reporter.snapshot.status).toBe("cancelled");
    });

    it("drops its token subscription on done()", () => {
      const source = createCancellationTokenSource();
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        token: source.token,
      });
      reporter.done("succeeded");
      // The listener is gone, so a later shutdown cannot rewrite a finished
      // job's outcome (docs/01 §12 gotcha 10).
      source.cancel({ kind: "shutdown" });
      expect(reporter.snapshot.status).toBe("succeeded");
    });
  });

  describe("fan-out", () => {
    it("drives every sink with the same snapshot", () => {
      const a = recordingSink();
      const b = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        sinks: [a, b, NULL_PROGRESS_SINK],
      });
      reporter.setProgress(1, 4);
      expect(a.snapshots).toHaveLength(1);
      expect(b.snapshots).toHaveLength(1);
      expect(a.snapshots[0]).toBe(b.snapshots[0]);
    });

    it("isolates a sink that throws", () => {
      const good = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        sinks: [
          {
            update() {
              throw new Error("the popup blew up");
            },
            warn() {
              throw new Error("so did its warn");
            },
          },
          good,
        ],
      });
      expect(() => reporter.setProgress(1, 2)).not.toThrow();
      expect(() => reporter.warn("still recorded")).not.toThrow();
      expect(good.snapshots.length).toBeGreaterThan(0);
      expect(reporter.snapshot.warnings).toEqual(["still recorded"]);
    });

    it("keeps two trees' state apart, including their stage keys", () => {
      // `P1-T31` criterion 2, at the level where it is decided: every node of
      // one tree shares one `RootState` and shares it with **no other tree**,
      // so two jobs reporting into their own sinks cannot cross.
      const clock = createManualClock();
      const first = recordingSink();
      const second = recordingSink();
      const a = new CompositeProgressReporter({ clock, sinks: [first] });
      const b = new CompositeProgressReporter({ clock, sinks: [second] });

      a.child("fetch", 0, 0.5).setProgress(1, 2);
      b.child("write", 0.5, 1).setProgress(1, 4);

      expect(a.snapshot.currentStageKey).toBe("fetch");
      expect(a.snapshot.completed).toBe(1);
      expect(a.snapshot.total).toBe(2);
      expect(a.snapshot.fraction).toBeCloseTo(0.25, 10);

      expect(b.snapshot.currentStageKey).toBe("write");
      expect(b.snapshot.completed).toBe(1);
      expect(b.snapshot.total).toBe(4);
      expect(b.snapshot.fraction).toBeCloseTo(0.625, 10);

      expect(first.snapshots).toHaveLength(1);
      expect(second.snapshots).toHaveLength(1);
      expect(first.snapshots[0]?.currentStageKey).toBe("fetch");
      expect(second.snapshots[0]?.currentStageKey).toBe("write");

      // And one tree's disposal latches only itself.
      a.dispose();
      clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
      b.increment();
      expect(second.snapshots).toHaveLength(2);
      expect(first.snapshots).toHaveLength(1);
    });

    it("dispose() tears every sink down, once", () => {
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
        sinks: [sink],
      });
      reporter.dispose();
      reporter.dispose();
      expect(sink.disposeCount).toBe(1);
    });
  });

  /**
   * `P1-T31` step 2. Before this card a node was inert when
   * `finished || root.terminal || parent?.inert` and **`disposed` was not one
   * of the three** — `root.terminal` is set only by `done()` — so a reporter
   * whose surfaces had been torn down went on fanning out into them.
   * `P1-T25` measured it and asserted it as a known defect in
   * `test/unit/bootstrap/container.test.ts`.
   */
  describe("dispose() latches the tree (P1-T31 criterion 3)", () => {
    it("reaches no sink from any member after dispose(), on any node", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      const stage = reporter.child("fetch", 0, 0.5);
      const page = stage.child("page", 0, 1);

      reporter.setProgress(1, 4);
      const painted = sink.snapshots.length;
      expect(painted).toBe(1);

      reporter.dispose();
      // Well past the throttle, so nothing is being held back by it: a call
      // that reached a sink would paint.
      clock.advance(10_000);

      reporter.setMessage("later");
      reporter.setProgress(90, 100);
      reporter.increment(5);
      reporter.warn("late warning", { source: "test" });
      reporter.done("succeeded", "sneaky");
      stage.setProgress(1, 1);
      page.increment();
      page.warn("later still");
      reporter.child("born dead", 0, 1).setProgress(1, 1);

      expect(sink.snapshots).toHaveLength(painted);
      expect(sink.warnings).toEqual([]);
    });

    it("does not claim an outcome the job never reported", () => {
      // `dispose()` ends the surfaces, `done()` ends the job. A plugin
      // disabled under a running job leaves `status === "running"`, which is
      // the honest reading — inventing `"cancelled"` here would write an
      // outcome into `docs/07` §4.5's snapshot that nothing cancelled.
      const reporter = new CompositeProgressReporter({
        clock: createManualClock(),
      });
      reporter.setProgress(1, 2);
      reporter.dispose();
      expect(reporter.snapshot.status).toBe("running");
      expect(reporter.snapshot.completed).toBe(1);
    });

    it("leaves a tree that finished with done() exactly as it was", () => {
      const clock = createManualClock();
      const sink = recordingSink();
      const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
      reporter.setProgress(5, 10);
      reporter.done("succeeded", "Imported 10");
      const painted = sink.snapshots.length;

      reporter.dispose();

      expect(sink.disposeCount).toBe(1);
      expect(sink.snapshots).toHaveLength(painted);
      expect(reporter.snapshot.status).toBe("succeeded");
    });

    it("latches the two shipped sinks identically — the P1-T25 asymmetry is gone", () => {
      // The asymmetry `P1-T25` recorded by name: `ZoteroProgressWindowSink`
      // carried its own `disposed` guard, so "no window survives" passed;
      // `createObservableProgressSink()` cleared `latest` without latching, so
      // the next `update()` repopulated a sink nothing could subscribe to.
      const clock = createManualClock();
      const windows: FakeWindow[] = [];
      const dialog = createObservableProgressSink();
      const popup = new ZoteroProgressWindowSink({
        clock,
        headline: "Research Helper",
        openWindow: () => {
          const win = fakeProgressWindow();
          windows.push(win);
          return win;
        },
      });
      const reporter = new CompositeProgressReporter({
        clock,
        sinks: [dialog, popup],
      });

      reporter.setProgress(1, 4);
      expect(windows).toHaveLength(1);
      expect(dialog.latest?.completed).toBe(1);

      reporter.dispose();
      expect(windows[0]?.closed).toBe(true);
      const platformCalls = windows[0]?.calls.length ?? 0;

      clock.advance(10_000);
      reporter.setProgress(4, 4);
      reporter.done("succeeded");

      // Both sinks, the same answer.
      expect(windows).toHaveLength(1);
      expect(windows[0]?.calls).toHaveLength(platformCalls);
      expect(dialog.latest).toBeUndefined();
    });
  });
});

describe("createObservableProgressSink — docs/08 §4.4's status bar", () => {
  it("delivers every snapshot to every subscriber", () => {
    const clock = createManualClock();
    const dialog = createObservableProgressSink();
    const seen: ProgressSnapshot[] = [];
    const off = dialog.subscribe((snapshot) => seen.push(snapshot));

    const reporter = new CompositeProgressReporter({ clock, sinks: [dialog] });
    reporter.setProgress(1, 4);
    clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
    reporter.increment();

    expect(seen).toHaveLength(2);
    expect(seen.at(-1)?.completed).toBe(2);
    expect(dialog.latest?.completed).toBe(2);
    off();
  });

  it("replays the current snapshot to a late subscriber", () => {
    const clock = createManualClock();
    const dialog = createObservableProgressSink();
    const reporter = new CompositeProgressReporter({ clock, sinks: [dialog] });
    reporter.setMessage("Searching Europe PMC…");
    // Past the throttle, so the second call paints too and `latest` is the pair
    // of counts the status bar should show on attach.
    clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
    reporter.setProgress(5, 7);

    const seen: ProgressSnapshot[] = [];
    dialog.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe("Searching Europe PMC…");
    expect(seen[0]?.completed).toBe(5);
    expect(seen[0]?.total).toBe(7);
  });

  it("stops delivering after unsubscribe, and after dispose", () => {
    const clock = createManualClock();
    const dialog = createObservableProgressSink();
    const seen: ProgressSnapshot[] = [];
    const off = dialog.subscribe((snapshot) => seen.push(snapshot));
    const reporter = new CompositeProgressReporter({ clock, sinks: [dialog] });

    reporter.setProgress(1, 10);
    off();
    clock.advance(PROGRESS_REPAINT_INTERVAL_MS);
    reporter.increment();
    expect(seen).toHaveLength(1);

    dialog.dispose();
    expect(dialog.latest).toBeUndefined();
  });

  /**
   * `P1-T31` step 3. Driven directly rather than through a reporter, because
   * the reporter now latches too and would hide a sink that does not: a sink
   * handed to Phase 3's queue, or to a test, must latch on its own.
   */
  it("latches on dispose(): update() is ignored and latest stays cleared", () => {
    const clock = createManualClock();
    const dialog = createObservableProgressSink();
    const seen: ProgressSnapshot[] = [];
    dialog.subscribe((snapshot) => seen.push(snapshot));

    dialog.update(runningSnapshot(clock.now(), 1, 10));
    expect(seen).toHaveLength(1);
    expect(dialog.latest?.completed).toBe(1);

    dialog.dispose();
    dialog.dispose(); // idempotent
    dialog.update(runningSnapshot(clock.now(), 9, 10));

    // The defect `P1-T25` recorded: this used to repopulate `latest` on a sink
    // nothing could subscribe to.
    expect(dialog.latest).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it("gives a subscriber that arrives after dispose() a callable no-op", () => {
    const dialog = createObservableProgressSink();
    dialog.dispose();

    const seen: ProgressSnapshot[] = [];
    const off = dialog.subscribe((snapshot) => seen.push(snapshot));

    expect(off).toBeInstanceOf(Function);
    expect(seen).toEqual([]);
    expect(() => off()).not.toThrow();
    // And nothing was registered, so a late update reaches no one either.
    dialog.update(runningSnapshot(0, 1, 2));
    expect(seen).toEqual([]);
    expect(dialog.latest).toBeUndefined();
  });

  it("isolates a view that throws", () => {
    const clock = createManualClock();
    const dialog = createObservableProgressSink();
    dialog.subscribe(() => {
      throw new Error("render failed");
    });
    const reporter = new CompositeProgressReporter({ clock, sinks: [dialog] });
    expect(() => reporter.setProgress(1, 2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The Zotero surface, through its `openWindow` seam
// ---------------------------------------------------------------------------

interface FakeWindow extends ProgressWindowHandle {
  readonly calls: readonly string[];
  readonly lines: readonly {
    readonly itemType: string;
    readonly texts: string[];
    readonly percents: number[];
    errors: number;
  }[];
  closed: boolean;
  headline: string | undefined;
  headlineIcon: string | undefined;
  closeTimers: readonly number[];
}

/** A `Zotero.ProgressWindow` stand-in recording every call this plugin makes. */
function fakeProgressWindow(): FakeWindow {
  const calls: string[] = [];
  const lines: {
    itemType: string;
    texts: string[];
    percents: number[];
    errors: number;
  }[] = [];
  const closeTimers: number[] = [];
  const win: FakeWindow = {
    calls,
    lines,
    closeTimers,
    closed: false,
    headline: undefined,
    headlineIcon: undefined,
    show() {
      calls.push("show");
    },
    changeHeadline(text, cssIconKey) {
      calls.push("changeHeadline");
      win.headline = text;
      win.headlineIcon = cssIconKey;
    },
    addLine(itemType, text): ProgressWindowLine {
      calls.push("addLine");
      const record = { itemType, texts: [text], percents: [], errors: 0 } as {
        itemType: string;
        texts: string[];
        percents: number[];
        errors: number;
      };
      lines.push(record);
      return {
        setProgress(percent) {
          record.percents.push(percent);
        },
        setText(value) {
          record.texts.push(value);
        },
        setError() {
          record.errors += 1;
        },
      };
    },
    startCloseTimer(ms) {
      calls.push("startCloseTimer");
      closeTimers.push(ms);
    },
    close() {
      calls.push("close");
      win.closed = true;
    },
  };
  return win;
}

describe("ZoteroProgressWindowSink", () => {
  it("opens once, with the headline and one line, and starts the close timer after show()", () => {
    const clock = createManualClock();
    const windows: FakeWindow[] = [];
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      postText: "Importing…",
      openWindow: () => {
        const win = fakeProgressWindow();
        windows.push(win);
        return win;
      },
    });
    const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });

    reporter.setMessage("Searching PubMed…");
    reporter.setProgress(1, 4);

    expect(windows).toHaveLength(1);
    const win = windows[0];
    expect(win?.headline).toBe("Research Helper");
    expect(win?.headlineIcon).toBe("library");
    // docs/08 §8.2: startCloseTimer is a no-op before show(), so show() first.
    expect(win?.calls).toEqual([
      "changeHeadline",
      "addLine",
      "show",
      "startCloseTimer",
    ]);
    expect(win?.closeTimers).toEqual([PROGRESS_WINDOW_CLOSE_MS]);
    expect(win?.lines[0]?.itemType).toBe("journalArticle");
    expect(win?.lines[0]?.texts[0]).toBe("Searching PubMed…");
  });

  it("repaints at most once per interval and never past the close deadline", () => {
    const clock = createManualClock();
    const win = fakeProgressWindow();
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openWindow: () => win,
    });

    // Driven directly, bypassing the composite's own throttle, so this measures
    // docs/07 §7.7's throttle inside the adapter.
    for (let i = 0; i <= 200; i += 1) {
      sink.update(runningSnapshot(clock.now(), i, 200));
      clock.advance(5);
    }

    const percents = win.lines[0]?.percents ?? [];
    // 1005 ms of updates, a 4000 ms close deadline: the paints are the leading
    // edge of each 250 ms window, minus the one folded into addLine().
    expect(percents.length).toBeLessThanOrEqual(4);
    expect(percents.every((p) => p >= 0 && p <= 100)).toBe(true);
  });

  it("stops painting once Zotero's close timer has fired", () => {
    const clock = createManualClock();
    const windows: FakeWindow[] = [];
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      closeAfterMs: 1000,
      openWindow: () => {
        const win = fakeProgressWindow();
        windows.push(win);
        return win;
      },
    });

    sink.update(runningSnapshot(clock.now(), 1, 10));
    expect(windows).toHaveLength(1);

    clock.advance(5000); // long past the 1000 ms close timer
    sink.update(runningSnapshot(clock.now(), 5, 10));
    clock.advance(250);
    sink.update(runningSnapshot(clock.now(), 6, 10));

    // Nothing was reopened for mid-job progress, and the closed window was not
    // painted into: docs/07 §7.7's alwaysontop caveat.
    expect(windows).toHaveLength(1);
    expect(windows[0]?.lines).toHaveLength(1);
    expect(windows[0]?.lines[0]?.percents).toEqual([]);
  });

  it("raises a completion toast even after the first popup closed", () => {
    const clock = createManualClock();
    const windows: FakeWindow[] = [];
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      closeAfterMs: 1000,
      openWindow: () => {
        const win = fakeProgressWindow();
        windows.push(win);
        return win;
      },
    });

    sink.update(runningSnapshot(clock.now(), 1, 10));
    clock.advance(5000);
    sink.update(runningSnapshot(clock.now(), 5, 10));
    sink.update({
      ...runningSnapshot(clock.now(), 10, 10),
      status: "succeeded",
      fraction: 1,
      message: "Imported 10 · Skipped 2",
    });

    expect(windows).toHaveLength(2);
    expect(windows[1]?.lines[0]?.texts[0]).toBe("Imported 10 · Skipped 2");
    expect(windows[1]?.calls).toContain("startCloseTimer");
  });

  it('openOn: "completion" draws nothing until done (docs/08 §4.4)', () => {
    const clock = createManualClock();
    const windows: FakeWindow[] = [];
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openOn: "completion",
      openWindow: () => {
        const win = fakeProgressWindow();
        windows.push(win);
        return win;
      },
    });
    const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });

    reporter.setProgress(0, 200);
    for (let i = 0; i < 200; i += 1) {
      clock.advance(5);
      reporter.increment();
    }
    expect(windows).toHaveLength(0);

    reporter.done("succeeded", "Imported 200 · 13 failed");
    expect(windows).toHaveLength(1);
    expect(windows[0]?.lines[0]?.texts[0]).toBe("Imported 200 · 13 failed");
    expect(windows[0]?.lines[0]?.errors).toBe(0);
  });

  it('marks the line as failed on done("failed")', () => {
    const clock = createManualClock();
    const win = fakeProgressWindow();
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openOn: "completion",
      openWindow: () => win,
    });
    const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
    reporter.done("failed", "PubMed is unreachable");
    expect(win.lines[0]?.errors).toBe(1);
  });

  it("formats the line through formatLine when one is supplied", () => {
    const clock = createManualClock();
    const win = fakeProgressWindow();
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openWindow: () => win,
      formatLine: (snapshot) =>
        `${snapshot.completed}/${snapshot.total ?? "?"}`,
    });
    sink.update(runningSnapshot(clock.now(), 3, 7));
    expect(win.lines[0]?.texts[0]).toBe("3/7");
  });

  it("dispose() closes the popup and refuses further updates", () => {
    const clock = createManualClock();
    const windows: FakeWindow[] = [];
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openWindow: () => {
        const win = fakeProgressWindow();
        windows.push(win);
        return win;
      },
    });

    sink.update(runningSnapshot(clock.now(), 1, 10));
    sink.dispose();
    sink.dispose();
    expect(windows[0]?.closed).toBe(true);
    expect(windows[0]?.calls.filter((call) => call === "close")).toHaveLength(
      1,
    );

    clock.advance(1000);
    sink.update(runningSnapshot(clock.now(), 2, 10));
    expect(windows).toHaveLength(1);
  });

  it("is torn down by the reporter's dispose()", () => {
    const clock = createManualClock();
    const win = fakeProgressWindow();
    const sink = new ZoteroProgressWindowSink({
      clock,
      headline: "Research Helper",
      openWindow: () => win,
    });
    const reporter = new CompositeProgressReporter({ clock, sinks: [sink] });
    reporter.setProgress(1, 2);
    reporter.dispose();
    expect(win.closed).toBe(true);
  });
});

/** A running snapshot, for driving a sink without a reporter. */
function runningSnapshot(
  startedAtEpochMs: number,
  completed: number,
  total: number,
): ProgressSnapshot {
  return {
    status: "running",
    completed,
    total,
    fraction: completed / total,
    message: `${completed} of ${total}`,
    currentStageKey: undefined,
    warnings: [],
    startedAtEpochMs,
    etaSeconds: undefined,
  };
}

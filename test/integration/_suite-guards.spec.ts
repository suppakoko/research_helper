/* eslint-disable no-restricted-globals -- the integration suite's setup: it reads the live platform's `Zotero.Translate.Search` to prove the guard is in place (docs/13 §2.3). */
/**
 * Suite-wide guards for the integration run (`plan/00` §6 items 208 and 229,
 * owner 2026-10-20).
 *
 * **Every spec gets these.** The scaffold loads every `*.spec.js` into one
 * Mocha page, sorted by path, and this file's name sorts first. Its top level
 * installs the `Zotero.Translate.Search` stub of `./support/translateSearchGuard.ts`
 * before any other spec's script is even evaluated, and its hooks are
 * registered **outside any `describe`**, so Mocha runs them around every test
 * in every file. A test that reaches the real translators without its own fake
 * fails in the root `afterEach` hook — a failure, never a request.
 *
 * Mocha's rule for a failed root `afterEach` hook is to stop the run, so one
 * incident fails loudly and the remaining tests are not run. That is the
 * intent: an incident means some code path would have sent real lookups.
 */

import { createCancellationTokenSource } from "../../src/core/jobQueue/cancellation";
import type { CanonicalWork } from "../../src/model/canonicalWork";
import { lookupThroughTranslators } from "../../src/zotero/translatorImport";
import {
  installTranslateSearchGuard,
  isTranslateSearchGuardInstalled,
  setGuardedTest,
  takeTranslateSearchIncidents,
  TranslateSearchGuardError,
  translateSearchGuardViolation,
  uninstallTranslateSearchGuard,
} from "./support/translateSearchGuard";

interface MochaHookContext {
  readonly currentTest?: { fullTitle(): string };
}
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare function before(body: () => void): void;
declare function beforeEach(body: (this: MochaHookContext) => void): void;
declare function afterEach(body: () => void): void;
declare function after(body: () => void): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  fail(message: string): never;
};

// ---------------------------------------------------------------------------
// The guard, for the whole run
// ---------------------------------------------------------------------------

// At load: before any later spec file's script runs.
installTranslateSearchGuard();

before(function () {
  installTranslateSearchGuard();
});

beforeEach(function (this: MochaHookContext) {
  setGuardedTest(this.currentTest?.fullTitle() ?? "(unnamed test)");
});

afterEach(function () {
  const violation = translateSearchGuardViolation();
  setGuardedTest("(between tests)");
  if (violation !== undefined) throw violation;
});

after(function () {
  const violation = translateSearchGuardViolation();
  uninstallTranslateSearchGuard();
  if (violation !== undefined) throw violation;
});

// ---------------------------------------------------------------------------
// The guard's own checks
// ---------------------------------------------------------------------------

function guardWork(): CanonicalWork {
  return {
    workKey: "doi:10.5555/rh-guard.1",
    ids: { doi: "10.5555/rh-guard.1" } as CanonicalWork["ids"],
    type: "journal-article",
    title: "Research Helper suite guard fixture (items 208, 229)",
    authors: [{ family: "Hopper", given: "Grace" }],
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["crossref"] },
    normalizedAtEpochMs: Date.now(),
  };
}

describe("Suite-wide Zotero.Translate.Search guard (plan/00 items 208, 229)", function () {
  it("is installed for the whole run: the constructor refuses, and the refusal is recorded", function () {
    assert.isTrue(
      isTranslateSearchGuardInstalled(),
      "Zotero.Translate.Search is the guard's stub",
    );
    const Search = (Zotero.Translate as { Search: new () => unknown }).Search;
    let refused: unknown;
    try {
      new Search();
    } catch (error) {
      refused = error;
    }
    assert.isTrue(
      refused instanceof TranslateSearchGuardError,
      "the stub throws TranslateSearchGuardError",
    );
    const incidents = takeTranslateSearchIncidents();
    assert.strictEqual(incidents.length, 1, "one incident recorded");
    assert.isTrue(
      incidents[0]?.includes("is installed for the whole run") === true,
      "the incident names the test",
    );
  });

  it("turns Strategy B without a fake into a recorded incident, never a translator run", async function () {
    // The precondition is checked before anything could reach a translator:
    // without the stub this test must not run its lookup at all.
    if (!isTranslateSearchGuardInstalled()) {
      assert.fail("the guard is not installed; refusing to run a lookup");
    }
    // What the 2026-10-16 mutant did: Strategy B with no `createSearch`, so
    // the production factory `new Zotero.Translate.Search()` is used.
    const result = await lookupThroughTranslators({
      works: [guardWork()],
      libraryID: Zotero.Libraries.userLibraryID,
      // Never used: the stub throws before `translate()` could save.
      collectionID: 0,
      token: createCancellationTokenSource().token,
      // Not Zotero's schema promise: this is the run's first test, and
      // measured 2026-10-20 it waited 19 s for that promise at startup.
      // Nothing here touches the schema; the stub throws first.
      options: { schemaReady: () => Promise.resolve() },
    });
    const incidents = takeTranslateSearchIncidents();
    assert.strictEqual(result.searches, 1);
    assert.deepEqual(result.translated, []);
    assert.deepEqual(
      result.fallbacks.map((fallback) => [fallback.reason, fallback.code]),
      [["lookup-error", "TranslateSearchGuardError"]],
    );
    assert.strictEqual(
      incidents.length,
      1,
      "the root afterEach hook would fail the test that did this",
    );
  });
});

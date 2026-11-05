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
 *
 * **Added 2026-11-05 (`plan/00` §6 item 347(c)):** the same hooks carry the live
 * request guard of `./support/liveRequestGuard.ts`, which cancels a live request
 * before it connects. It covers what the first guard cannot: a real related window
 * that starts its own run through `Zotero.HTTP`.
 */

import { createCancellationTokenSource } from "../../src/core/jobQueue/cancellation";
import type { CanonicalWork } from "../../src/model/canonicalWork";
import { lookupThroughTranslators } from "../../src/zotero/translatorImport";
import {
  installLiveRequestGuard,
  isLiveRequestGuardInstalled,
  liveGuardSummary,
  liveRequestViolation,
  setLiveGuardTest,
  takeLiveRequestIncidents,
  uninstallLiveRequestGuard,
} from "./support/liveRequestGuard";
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
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;
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
installLiveRequestGuard();

before(function () {
  installTranslateSearchGuard();
  installLiveRequestGuard();
});

beforeEach(function (this: MochaHookContext) {
  const title = this.currentTest?.fullTitle() ?? "(unnamed test)";
  setGuardedTest(title);
  setLiveGuardTest(title);
});

afterEach(function (this: MochaHookContext) {
  const violation = translateSearchGuardViolation() ?? liveRequestViolation();
  setGuardedTest("(between tests)");
  // A `before` hook is outside any test, so the last test's name says where it was.
  setLiveGuardTest(
    `(between tests, after ${this.currentTest?.fullTitle() ?? "an unnamed test"})`,
  );
  if (violation !== undefined) throw violation;
});

after(function () {
  const violation = translateSearchGuardViolation() ?? liveRequestViolation();
  const { channels, passedHosts, passedAway } = liveGuardSummary();
  debug(
    `[live-request guard] ${String(channels)} channels read, none cancelled ` +
      `unless a failure says so; hosts let through: ${JSON.stringify(passedHosts)}; ` +
      `away from loopback: ${JSON.stringify(passedAway)}`,
  );
  uninstallTranslateSearchGuard();
  uninstallLiveRequestGuard();
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

describe("Suite-wide live request guard (plan/00 item 347(c))", function () {
  it("is installed for the whole run, and cancels a request with the plugin's User-Agent before it connects", async function () {
    assert.isTrue(isLiveRequestGuardInstalled(), "the observer is registered");
    assert.deepEqual(takeLiveRequestIncidents(), []);
    // A reserved name: it resolves nowhere, so even a guard that failed sends nothing.
    // `successCodes: false` resolves whatever happened, so the channel's own status
    // says why it ended: a reserved name alone would fail with a DNS error instead.
    const ended = (await Zotero.HTTP.request(
      "GET",
      "https://rh-live-guard.invalid/probe",
      {
        headers: { "User-Agent": "research_helper/0.0.0 (guard check)" },
        timeout: 10_000,
        successCodes: false,
      },
    )) as unknown as {
      readonly status: number;
      readonly channel?: { readonly status?: number };
    };
    const incidents = takeLiveRequestIncidents();
    assert.strictEqual(incidents.length, 1, "one incident recorded");
    assert.isTrue(
      incidents[0]?.includes("rh-live-guard.invalid/probe") === true,
      "the incident names the address",
    );
    assert.strictEqual(ended.status, 0, "no answer came back");
    assert.strictEqual(
      ended.channel?.status,
      Components.results.NS_BINDING_ABORTED,
      "the guard cancelled the channel, and no DNS failure ended it",
    );
  });
});

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

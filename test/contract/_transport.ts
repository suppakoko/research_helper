/**
 * The record/replay harness of `docs/13` §2.2, as Node sees it — and the one
 * file Phase 2's contract tests import six more times.
 *
 * **Scope.** `P1-T11` wrote the harness here. `P2-T25` moved its body to
 * `test/support/fixtureReplay.ts`, which has no platform import and takes a
 * {@link FixtureIo} port instead, and left this file as the **Node face**: every
 * export below is the core's, bound to `test/support/fixtureIo.node.ts`, under
 * the signatures `test/contract/pubmed.contract.test.ts` and
 * `scripts/record-fixtures.ts` already call. Nothing those two files import
 * changed shape.
 *
 * ## Where the harness runs now
 *
 * Until `P2-T25` this header said the harness could not be loaded inside
 * Zotero, because it imported `node:fs/promises` and `node:crypto`. **That is
 * no longer true.** An integration spec imports `test/support/fixtureReplay.ts`
 * directly and passes `test/support/fixtureIo.zotero.ts`'s implementation; the
 * `P2-T25` block of `test/integration/searchDialog-flow.spec.ts` drives the
 * shipped PubMed adapter, the shipped `createHttpClient` and Gecko's own
 * `DOMParser` through the committed fixtures that way. What **this** file adds
 * is the Node binding, so it must stay out of anything the scaffold bundles for
 * the sandbox: import it from `test/contract/` and `scripts/` only.
 *
 * The three explanatory sections every user of the harness should read — why
 * the seam is the transport port rather than the `httpRequest` facade, why "the
 * fixture was found" is the strongest request-shape assertion in the suite, and
 * the staleness policy — are in `test/support/fixtureReplay.ts`'s header, with
 * the two deviations from `docs/13` §2.2's code block that `P2-T25` made.
 */

import { nodeFixtureIo } from "../support/fixtureIo.node";
import {
  assertFixturesFresh as assertFixturesFreshWith,
  createReplayHttpClient as createReplayHttpClientWith,
  createReplayTransport as createReplayTransportWith,
  listFixtureMeta as listFixtureMetaWith,
  replayTransport as replayTransportWith,
  type FreshnessReport,
  type LoadedFixtureMeta,
  type ReplayHttpClient,
  type ReplayHttpClientOptions as CoreReplayHttpClientOptions,
  type ReplayTransport,
} from "../support/fixtureReplay";

export {
  createRecordingLimiter,
  fixtureFileFor,
  fixtureKey,
  FIXTURE_RECORD_COMMAND,
  FIXTURE_STALE_FAIL_DAYS,
  FIXTURE_STALE_WARN_DAYS,
  FROZEN_NOW_EPOCH_MS,
  META_SUFFIX,
  ReplayBrowserOfflineException,
  ReplayCancelledException,
  ReplaySecurityException,
  ReplayTimeoutException,
  ReplayUnexpectedStatusException,
  type FixtureIo,
  type FixtureMeta,
  type FreshnessReport,
  type LoadedFixtureMeta,
  type RecordedExchange,
  type RecordingLimiter,
  type ReplayCall,
  type ReplayHttpClient,
  type ReplayTransport,
} from "../support/fixtureReplay";

/** The Node implementation every function in this file is bound to. */
export { nodeFixtureIo } from "../support/fixtureIo.node";

/**
 * `docs/13` §2.2's replay transport over the Node file system.
 *
 * @param dir - the fixture directory for one source
 * @returns an async function from a request to its recorded response
 */
export function replayTransport(dir: string) {
  return replayTransportWith(dir, nodeFixtureIo);
}

/**
 * A replay-backed `Zotero.HTTP` stand-in over the Node file system.
 *
 * @param dir - the fixture directory for one source
 * @returns the transport, plus the list of calls it has answered
 */
export function createReplayTransport(dir: string): ReplayTransport {
  return createReplayTransportWith(dir, nodeFixtureIo);
}

/** {@link CoreReplayHttpClientOptions} without the port, which this file supplies. */
export type ReplayHttpClientOptions = Omit<CoreReplayHttpClientOptions, "io">;

/**
 * The shipped `createHttpClient`, wired to fixtures on the Node file system.
 *
 * @param options - see {@link ReplayHttpClientOptions}
 * @returns the client and the three things a test asserts against
 */
export function createReplayHttpClient(
  options: ReplayHttpClientOptions,
): ReplayHttpClient {
  return createReplayHttpClientWith({ ...options, io: nodeFixtureIo });
}

/**
 * Read every `_meta.json` sidecar in a fixture directory on the Node file system.
 *
 * @param dir - the fixture directory
 * @returns the sidecars, sorted by scenario name
 */
export function listFixtureMeta(
  dir: string,
): Promise<readonly LoadedFixtureMeta[]> {
  return listFixtureMetaWith(dir, nodeFixtureIo);
}

/**
 * `docs/13` §3.3 item 2 over the Node file system.
 *
 * @param dir - the fixture directory
 * @param nowEpochMs - "now"; a test passes a fixed instant, CI passes
 *   `Date.now()`
 * @returns the warnings, for the caller to print
 */
export function assertFixturesFresh(
  dir: string,
  nowEpochMs: number,
): Promise<FreshnessReport> {
  return assertFixturesFreshWith(dir, nowEpochMs, nodeFixtureIo);
}

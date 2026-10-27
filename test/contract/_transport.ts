/**
 * The record/replay harness of `docs/13` §2.2, as Node sees it — and the one
 * file Phase 2's contract tests import six more times.
 *
 * **Scope.** `P1-T11` wrote the harness here. `P2-T25` moved its body to
 * `test/support/fixtureReplay.ts`, which has no platform import and takes a
 * {@link FixtureIo} port instead, and left this file as the **Node face**: every
 * export below is the core's, bound to `test/support/fixtureIoNode.ts`, under
 * the signatures `test/contract/pubmed.contract.test.ts` and
 * `scripts/record-fixtures.ts` already call. Nothing those two files import
 * changed shape.
 *
 * `P3-T30` (2026-10-27) added the last section, the LLM fixtures: named by
 * scenario rather than by request hash ({@link llmFixtureKey}), answered by
 * {@link createLlmReplayTransport}, and reported missing with the command that
 * records them ({@link llmRecordCommand}). Nothing above it changed.
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

import type {
  HttpExceptionClass,
  HttpTransport,
  HttpTransportOptions,
  HttpTransportXhr,
} from "../../src/core/http/client";
import { nodeFixtureIo } from "../support/fixtureIoNode";
import {
  assertFixturesFresh as assertFixturesFreshWith,
  type FixtureMeta,
  type RecordedExchange,
  ReplayBrowserOfflineException,
  ReplayCancelledException,
  ReplaySecurityException,
  ReplayTimeoutException,
  ReplayUnexpectedStatusException,
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
export { nodeFixtureIo } from "../support/fixtureIoNode";

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

// ---------------------------------------------------------------------------
// LLM fixtures (`P3-T30`, split by `plan/00` §6 item 298(b))
// ---------------------------------------------------------------------------

/*
 * **The LLM fixture key is the scenario name, not a request hash** (`docs/13`
 * §3.2's note of 2026-10-27). A literature fixture is found if and only if
 * the request is byte-identical, which is the strongest request-shape check
 * the suite has. An LLM request body carries the prompt and the model, so the
 * same rule would orphan every LLM fixture at each prompt edit, and `docs/13`
 * §3.2 wants a prompt change to show as a reviewable snapshot diff instead.
 * So the request shape is asserted by the per-adapter request snapshot in
 * `test/contract/llm/`, and the response is found by name:
 * `<dir>/<scenario>.json`, then `<dir>/<scenario>-page-2.json` for the second
 * request of the same scenario (Anthropic's model list follows `has_more`).
 */

/** An LLM fixture's sidecar: {@link FixtureMeta} plus what the recording was made against. */
export interface LlmFixtureMeta extends FixtureMeta {
  /** The provider the recording was made against. */
  readonly provider: string;
  /** The model the request named; absent for a request that names none. */
  readonly model?: string;
  /** 1 for a scenario's first request, 2 for its second, and so on. */
  readonly page: number;
}

/** The `--source` spelling the recorder takes for each LLM provider. */
export type LlmFixtureProvider =
  "openrouter" | "openai" | "anthropic" | "gemini";

/**
 * The file key of a scenario's `page`-th request (1-based).
 *
 * @param scenario - a name from the recorder's `LLM_SCENARIOS`
 * @param page - 1 for the first request
 * @returns `scenario` for page 1, `scenario-page-<n>` after it
 */
export function llmFixtureKey(scenario: string, page = 1): string {
  return page <= 1 ? scenario : `${scenario}-page-${String(page)}`;
}

/**
 * The commands a missing LLM fixture names. The live one is never run by an
 * agent: it needs the owner's key in the environment and a confirmed spend
 * (`docs/13` §3.4). A synthetic fixture is rewritten with no network and no key.
 *
 * @param provider - the provider
 * @param scenario - the scenario
 * @param synthetic - whether the scenario is written rather than recorded
 * @returns the command text, one or two lines
 */
export function llmRecordCommand(
  provider: LlmFixtureProvider,
  scenario: string,
  synthetic: boolean,
): string {
  if (synthetic) {
    return `FIXTURE_MODE=synthetic npm run fixtures:record -- --source ${provider}`;
  }
  return (
    `npm run fixtures:record -- --source ${provider} --only ${scenario} --dry-run   ` +
    `(prints the stated spend), then the owner runs: ` +
    `FIXTURE_MODE=record npm run fixtures:record -- --source ${provider} ` +
    `--only ${scenario} --live --confirm-spend-usd <the stated spend> ` +
    `(docs/13 §3.4; never an agent)`
  );
}

/** One request the LLM replay answered. */
export interface LlmReplayCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
  /** The fixture file read, `${dir}/${key}.json`. */
  readonly fixture: string;
}

/** A `Zotero.HTTP` stand-in that answers one LLM scenario from its fixtures. */
export interface LlmReplayTransport extends HttpTransport {
  readonly calls: readonly LlmReplayCall[];
}

/**
 * The LLM replay transport: the `n`-th request is answered with
 * `<scenario>` (n = 1) or `<scenario>-page-<n>`, whatever its body. No network:
 * the only I/O is reading the fixture directory.
 *
 * @param dir - the provider's fixture directory
 * @param provider - for the record command in the missing-fixture message
 * @param scenario - the scenario every request of this transport answers for
 * @param synthetic - whether the scenario is written rather than recorded
 * @returns the transport and the calls it answered
 */
export function createLlmReplayTransport(
  dir: string,
  provider: LlmFixtureProvider,
  scenario: string,
  synthetic: boolean,
): LlmReplayTransport {
  const calls: LlmReplayCall[] = [];
  return {
    calls,
    async request(method, url, options): Promise<HttpTransportXhr> {
      const key = llmFixtureKey(scenario, calls.length + 1);
      const fixture = `${dir}/${key}.json`;
      calls.push({ method, url, options, fixture });
      let recorded: RecordedExchange;
      try {
        recorded = JSON.parse(
          await nodeFixtureIo.readText(dir, `${key}.json`),
        ) as RecordedExchange;
      } catch {
        throw new Error(
          `Missing fixture ${fixture} for ${provider} scenario "${scenario}" ` +
            `(${method} ${new URL(url).pathname})\n` +
            `Record it with: ${llmRecordCommand(provider, scenario, synthetic)}`,
        );
      }
      const block = Object.entries(recorded.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      return {
        status: recorded.status,
        responseText: recorded.body,
        responseURL: url,
        getAllResponseHeaders: () => block,
      };
    },
    UnexpectedStatusException:
      ReplayUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: ReplayTimeoutException,
    BrowserOfflineException: ReplayBrowserOfflineException,
    SecurityException: ReplaySecurityException,
    CancelledException: ReplayCancelledException,
  };
}

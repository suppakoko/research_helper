/**
 * The record/replay harness of `docs/13` §2.2 — the platform-free core, usable
 * from a Vitest contract test **and** from an integration spec inside Zotero.
 *
 * **Scope.** `P1-T11` wrote this as `test/contract/_transport.ts`; `P2-T25`
 * moved it here unchanged in behaviour and gave it one injected port,
 * {@link FixtureIo}, so that nothing in this file touches `node:*`.
 * `test/contract/_transport.ts` is now the Node face: it binds every function
 * below to `test/support/fixtureIo.node.ts` and keeps the signatures the
 * contract tests and `scripts/record-fixtures.ts` already call. An integration
 * spec imports this file directly and passes
 * `test/support/fixtureIo.zotero.ts`'s implementation.
 *
 * {@link fixtureKey} and {@link replayTransport} are `docs/13` §2.2's own code
 * (step 1 of `P1-T11`). Everything after them is the wiring those two need in
 * order to be reachable from a test, and is source-agnostic: nothing below
 * mentions PubMed.
 *
 * ## The one thing to understand before using this
 *
 * A fixture is named after a **hash of the request**, not after the scenario.
 * So a fixture is found if and only if the code under test transmits byte for
 * byte the request the recorder transmitted. That makes "the fixture was found"
 * the strongest request-shape assertion in the suite — stronger than any
 * `expect(url).toContain(...)` — and it is why `src/sources/pubmed/query.ts`
 * fixes its parameter order. Reorder a parameter and every fixture for that
 * source goes missing at once.
 *
 * ## Where the typed errors come from
 *
 * `docs/13` §2.2 replaces `httpRequest` — the facade — with the replay
 * transport. Doing it there would skip `src/core/http/client.ts`'s status
 * classification, and then §2.2's own assertion category 3 ("error responses …
 * produce the expected typed errors") would be asserting nothing: a 429 fixture
 * would arrive as an {@link HttpResponse} with `status: 429` and no error would
 * ever be constructed. So the seam here is one layer lower —
 * {@link createReplayTransport} implements the `Zotero.HTTP` port
 * ({@link HttpTransport}) and {@link createReplayHttpClient} runs the **shipped**
 * `createHttpClient` over it. `RateLimitError`, `UpstreamServerError` and
 * friends are therefore produced by production code, not by the harness.
 *
 * That is a deliberate deviation from §2.2's wording and was reported with
 * `P1-T11`. §2.2's substitution point stays usable — {@link replayTransport} is
 * exported and `src/core/http/client.ts` still exports `setHttpClient` — it is
 * simply not what a contract test should hang off.
 *
 * ## Two deviations from §2.2's code block, both `P2-T25`'s
 *
 * 1. **The digest.** §2.2 hashes with `node:crypto`'s `createHash`. The
 *    sandbox has no `node:crypto`, and its `crypto.subtle.digest` is
 *    asynchronous, so following §2.2 literally would make {@link fixtureKey}
 *    `async` and ripple into every caller — including two files `P2-T25` may
 *    not edit. `test/support/sha256.ts` is a synchronous SHA-256 in plain
 *    TypeScript instead, and its output is asserted equal to `createHash`'s
 *    over every committed fixture name (`test/contract/replayHarness.test.ts`)
 *    and to `crypto.subtle.digest`'s inside Zotero
 *    (`test/integration/searchDialog-flow.spec.ts`, `P2-T25` block). **The key
 *    is byte-identical to what `P1-T11` recorded under**, which is the one
 *    property that matters: a changed key would silently orphan seventeen
 *    fixtures.
 * 2. **The file read.** §2.2's `replayTransport(dir)` reads with `readFile`.
 *    Here it takes the {@link FixtureIo} port as a second argument. The Node
 *    face in `test/contract/_transport.ts` restores the one-argument form.
 *
 * ## When a fixture goes stale
 *
 * `docs/13` §3.3 is the policy and {@link assertFixturesFresh} is the part of it
 * that runs: a fixture older than {@link FIXTURE_STALE_WARN_DAYS} warns, one
 * older than {@link FIXTURE_STALE_FAIL_DAYS} fails. Both messages name the
 * re-record command, because §3.3 rule 4 is "**never edit a fixture by hand** to
 * make a test pass. Re-record, or add a new scenario." A contract test that
 * fails after a re-record is the harness doing its job: read the fixture diff,
 * and if the service really changed shape, change the parser and say so in the
 * commit — do not delete the test.
 *
 * ## No network, ever
 *
 * Nothing in this file can reach the wire: there is no `fetch`, no
 * `Zotero.HTTP`, and the only I/O goes through the injected {@link FixtureIo},
 * under the fixture directory. Recording lives in `scripts/record-fixtures.ts`,
 * which is run by hand and is not imported by any test.
 */

import {
  createManualClock,
  type Clock,
  type ManualClock,
} from "../../src/core/clock";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
  type RateLimiterPort,
} from "../../src/core/http/client";
import {
  retryPolicyFromBudget,
  type RetryPolicy,
} from "../../src/core/http/retry";
import { buildUserAgent } from "../../src/core/http/userAgent";
import { HOST_POLICIES } from "../../src/core/rateLimit/hostLimiter";

import type { FixtureIo } from "./fixtureIo";
import { sha256Hex } from "./sha256";

export type { FixtureIo } from "./fixtureIo";

// ---------------------------------------------------------------------------
// 1. `docs/13` §2.2
// ---------------------------------------------------------------------------

/*
 * The two functions below are `docs/13` §2.2's code block, with the two
 * deviations the header lists and the `RecordedExchange` return annotation on
 * `replayTransport`'s inner function.
 *
 * Three properties of this code matter and none of them is obvious:
 *
 * 1. The URL redaction is **value-only**: `api_key=abc` becomes
 *    `api_key=REDACTED`, while an *absent* `api_key` stays absent. So a fixture
 *    recorded with a key and a replay issued without one hash differently and
 *    the fixture is reported missing. That is why `scripts/record-fixtures.ts`
 *    records NCBI unkeyed; see that file, and `P1-T11`'s report, for the corpus
 *    defect this is.
 * 2. `email=` is **not** redacted, so the maintainer address is part of the hash
 *    input. It never reaches a file: the hash is one way, and nothing here
 *    writes a URL.
 * 3. The `catch` covers `JSON.parse` as well as the read, so a corrupt fixture
 *    is reported as a missing one. Kept, because the section is to be
 *    implemented as written; noted so the next reader does not spend an hour on
 *    it.
 */

/**
 * `docs/13` §2.2's fixture name: a SHA-256 of the method, the
 * credential-redacted URL and the body, truncated to 16 hex characters.
 *
 * The input string is `` `${method} ${redacted} ${body ?? ""}` `` and must never
 * change shape: every committed fixture is named by it.
 *
 * @param req - the request as the transport sees it
 * @returns 16 lowercase hex characters
 */
export function fixtureKey(req: {
  method: string;
  url: string;
  body?: string;
}) {
  const redacted = req.url.replace(
    /(api[_-]?key|key|token)=[^&]+/gi,
    "$1=REDACTED",
  );
  return sha256Hex(`${req.method} ${redacted} ${req.body ?? ""}`).slice(0, 16);
}

/**
 * `docs/13` §2.2's replay transport: resolve a request from a committed file, or
 * fail with the command that records it.
 *
 * @param dir - the fixture directory for one source
 * @param io - how to read it on this platform
 * @returns an async function from a request to its recorded response
 */
export function replayTransport(dir: string, io: FixtureIo) {
  return async (req: {
    method: string;
    url: string;
    body?: string;
  }): Promise<RecordedExchange> => {
    const name = `${fixtureKey(req)}.json`;
    const file = `${dir}/${name}`;
    try {
      return JSON.parse(await io.readText(dir, name)) as RecordedExchange;
    } catch {
      throw new Error(
        `Missing fixture ${file} for ${req.method} ${req.url}\n` +
          `Record it with: FIXTURE_MODE=record npm run fixtures:record`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// 2. The fixture file formats
// ---------------------------------------------------------------------------

/**
 * A recorded exchange: exactly the three members `docs/13` §2.2 names, and
 * nothing else. A fixture file *is* one of these, so `JSON.parse` above needs no
 * unwrapping.
 */
export interface RecordedExchange {
  readonly status: number;
  /** Response headers, lower-cased, after §3.2's redaction pass. */
  readonly headers: Readonly<Record<string, string>>;
  /** The response body as text, byte for byte as received. */
  readonly body: string;
}

/**
 * The `_meta.json` sidecar of `docs/13` §3.2: "recorded-at timestamp, endpoint,
 * tool version, and the scenario name".
 *
 * The four §3.2 members are {@link recordedAt}, {@link endpoint},
 * {@link toolVersion} and {@link scenario}. The rest exist because a 16-hex
 * filename tells a reader nothing: {@link scenarioVersion} is the versioned
 * scenario list `P1-T11` step 2 requires, and {@link synthetic} /
 * {@link syntheticReason} mark the fixtures that were **not** recorded from the
 * service, so nobody mistakes a hand-written 429 for evidence about NCBI.
 *
 * `endpoint` is the endpoint base URL with no query string. The full URL is
 * never written to disk, because it carries `email=` and could carry `api_key=`.
 */
export interface FixtureMeta {
  readonly scenario: string;
  readonly scenarioVersion: number;
  readonly recordedAt: string;
  readonly endpoint: string;
  readonly method: string;
  readonly toolVersion: string;
  readonly synthetic: boolean;
  readonly syntheticReason?: string;
  /** What the redaction pass removed or rewrote, for review. */
  readonly redactions: readonly string[];
}

/** The `_meta.json` suffix. A fixture is `<key>.json`, its sidecar `<key>_meta.json`. */
export const META_SUFFIX = "_meta.json";

/** The command every "missing" and "stale" message names. `docs/13` §2.2 / §3.3. */
export const FIXTURE_RECORD_COMMAND =
  "FIXTURE_MODE=record npm run fixtures:record";

/**
 * The fixture path a request resolves to, for a test that wants to delete one.
 *
 * Spelled `${dir}/${key}.json` on every platform — the form Node reads and the
 * "Missing fixture" message prints. A Zotero caller that needs a native path
 * joins {@link fixtureKey} and `.json` with `PathUtils.join` instead.
 *
 * @param dir - the fixture directory
 * @param req - the request
 * @returns the absolute-or-relative path, spelled exactly as
 *   {@link replayTransport} spells it
 */
export function fixtureFileFor(
  dir: string,
  req: { method: string; url: string; body?: string },
): string {
  return `${dir}/${fixtureKey(req)}.json`;
}

// ---------------------------------------------------------------------------
// 3. The `Zotero.HTTP` port, backed by the replay transport
// ---------------------------------------------------------------------------

/* Zotero's exception classes, as `instanceof` needs them (`docs/01` §8.1). The
 * replay transport can only ever resolve, so none of these is thrown here; they
 * exist because `HttpTransport` declares them and `client.ts` reads them. */

/** @see HttpTransport.UnexpectedStatusException */
export class ReplayUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}
/** @see HttpTransport.TimeoutException */
export class ReplayTimeoutException extends Error {}
/** @see HttpTransport.BrowserOfflineException */
export class ReplayBrowserOfflineException extends Error {}
/** @see HttpTransport.SecurityException */
export class ReplaySecurityException extends Error {}
/** @see HttpTransport.CancelledException */
export class ReplayCancelledException extends Error {}

/** One request the harness answered, with the fixture it came from. */
export interface ReplayCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
  /** The file {@link replayTransport} read, as {@link fixtureFileFor} spells it. */
  readonly fixture: string;
}

/** A {@link HttpTransport} that reads fixtures and records what it was asked. */
export interface ReplayTransport extends HttpTransport {
  readonly calls: readonly ReplayCall[];
}

/**
 * Build a replay-backed `Zotero.HTTP` stand-in.
 *
 * @param dir - the fixture directory for one source
 * @param io - how to read it on this platform
 * @returns the transport, plus the list of calls it has answered
 */
export function createReplayTransport(
  dir: string,
  io: FixtureIo,
): ReplayTransport {
  const replay = replayTransport(dir, io);
  const calls: ReplayCall[] = [];

  return {
    calls,
    async request(method, url, options): Promise<HttpTransportXhr> {
      const call: ReplayCall = {
        method,
        url,
        options,
        fixture: fixtureFileFor(dir, {
          method,
          url,
          ...(options.body !== undefined && { body: options.body }),
        }),
      };
      calls.push(call);
      const recorded = await replay({
        method,
        url,
        ...(options.body !== undefined && { body: options.body }),
      });
      const block = Object.entries(recorded.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      return {
        status: recorded.status,
        responseText: recorded.body,
        // The *request* URL, not a recorded one: a recorded final URL would
        // have had to carry `email=` onto disk.
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

// ---------------------------------------------------------------------------
// 4. The shipped client over that transport
// ---------------------------------------------------------------------------

/** A limiter that records instead of pacing. Pacing is `P1-T04`'s to test. */
export interface RecordingLimiter extends RateLimiterPort {
  readonly acquired: readonly (number | undefined)[];
  readonly penalties: readonly { untilEpochMs: number; reason: string }[];
}

/**
 * A limiter that grants immediately and remembers.
 *
 * It is here so that a contract test can assert `docs/07` §7.3's "any 429 … with
 * `Retry-After` calls `limiter.penalize(...)`" — the observable consequence of a
 * 429 fixture beyond the thrown error.
 *
 * @param key - the host, as `docs/07` §7.3 keys buckets
 * @returns the limiter
 */
export function createRecordingLimiter(key: string): RecordingLimiter {
  const acquired: (number | undefined)[] = [];
  const penalties: { untilEpochMs: number; reason: string }[] = [];
  const limiter: RecordingLimiter = {
    key,
    acquired,
    penalties,
    acquire(cost) {
      acquired.push(cost);
      return Promise.resolve();
    },
    async run(fn, cost, token) {
      await limiter.acquire(cost, token);
      return fn();
    },
    penalize(untilEpochMs, reason) {
      penalties.push({ untilEpochMs, reason });
    },
  };
  return limiter;
}

/** What {@link createReplayHttpClient} hands back. */
export interface ReplayHttpClient {
  /** The shipped `HttpClient`, over the replay transport. */
  readonly client: HttpClient;
  readonly transport: ReplayTransport;
  readonly limiter: RecordingLimiter;
  /** Frozen: `P1-T11`'s **Do NOT** forbids a live timestamp in a snapshot. */
  readonly clock: ManualClock;
  /**
   * Every wait the client's retry loop asked for, in order. The waits do not
   * move {@link clock} and resolve at once, so a replayed 429 or 5xx finishes
   * without real or simulated time passing; the list is how a test sees them.
   */
  readonly slept: readonly number[];
}

/** Options for {@link createReplayHttpClient}. */
export interface ReplayHttpClientOptions {
  /** The fixture directory for one source. */
  readonly dir: string;
  /** How to read it on this platform. */
  readonly io: FixtureIo;
  /** The rate-limiter key, normally the API host. */
  readonly host: string;
  /**
   * The version the `User-Agent` reports. Fixed rather than read from
   * `package.json` so a version bump cannot change a test's expectations; it is
   * outside {@link fixtureKey}'s hash input either way.
   */
  readonly version?: string;
  /** `now()` for the frozen clock. */
  readonly nowEpochMs?: number;
}

/**
 * The retry policy the shipped composition root gives `host`, or `undefined`.
 *
 * The same two inputs `src/bootstrap/container.ts`'s `createRetryFor` reads —
 * the host's `HOST_POLICIES` row and its `retry` cells, through
 * `retryPolicyFromBudget` — without importing `src/bootstrap/`, which this
 * platform-free file must not. `random` is pinned to the top of each draw so a
 * test's recorded waits are one fixed sequence: `[base, min(cap, 3 × base)]`.
 */
function shippedRetryPolicy(host: string): RetryPolicy | undefined {
  const budget = HOST_POLICIES.find((row) => row.host === host)?.retry;
  return budget === undefined
    ? undefined
    : retryPolicyFromBudget(budget, () => 1);
}

/**
 * The shipped `createHttpClient`, wired to fixtures.
 *
 * **The shipped retry policy is injected for {@link ReplayHttpClientOptions.host}
 * since 2026-10-20** (`plan/00` §6 item 228). Until then no policy was
 * injected, so each request was a single attempt — which matched the shipped
 * client, because `src/bootstrap/container.ts` supplied no `retryFor` either.
 * Now that it does, a replayed 429 or 5xx is retried exactly as in the
 * product: the same fixture answers every attempt, so a 429 or 503 fixture is
 * read `docs/07` §7.3's attempt-cap times and the last error is what the
 * caller sees. The error shape a contract test asserts is unchanged; what
 * changes is the number of reads and of `penalize` calls, which a test must
 * now count at the attempt cap. The waits resolve at once and are recorded in
 * {@link ReplayHttpClient.slept}, so no test waits for them. A host with no
 * §7.3 row gets no policy, as in the product.
 *
 * @param options - see {@link ReplayHttpClientOptions}
 * @returns the client and the things a test asserts against
 */
export function createReplayHttpClient(
  options: ReplayHttpClientOptions,
): ReplayHttpClient {
  const transport = createReplayTransport(options.dir, options.io);
  const limiter = createRecordingLimiter(options.host);
  const clock = createManualClock(options.nowEpochMs ?? FROZEN_NOW_EPOCH_MS);
  const slept: number[] = [];
  // `now()` is the frozen clock's; `sleep()` records and returns at once, and
  // still rejects for a cancelled token as `Clock.sleep` must.
  const retryClock: Clock = {
    now: () => clock.now(),
    sleep: (ms, token) =>
      new Promise<void>((resolve) => {
        slept.push(ms);
        token?.throwIfCancelled();
        resolve();
      }),
  };
  const policy = shippedRetryPolicy(options.host);
  const client = createHttpClient({
    transport,
    userAgent: buildUserAgent(options.version ?? "0.0.2"),
    clock: retryClock,
    limiterFor: (host) => (host === options.host ? limiter : undefined),
    retryFor: (host) => (host === options.host ? policy : undefined),
  });
  return { client, transport, limiter, clock, slept };
}

/**
 * The instant every contract-test clock is frozen at: 2026-01-01T00:00:00Z.
 *
 * A fixed `now()` is what makes `retrievedAtEpochMs` snapshot-able — `P1-T11`'s
 * **Do NOT**: "do not snapshot the whole `CanonicalWork` with a live timestamp
 * in it".
 */
export const FROZEN_NOW_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

// ---------------------------------------------------------------------------
// 5. `docs/13` §3.3 — freshness
// ---------------------------------------------------------------------------

/** §3.3 item 2: past this age a fixture warns. */
export const FIXTURE_STALE_WARN_DAYS = 180;

/** §3.3 item 2: past this age a fixture fails the suite. */
export const FIXTURE_STALE_FAIL_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/** One sidecar, with the file it describes. */
export interface LoadedFixtureMeta {
  /** The `<key>_meta.json` file name. */
  readonly file: string;
  /** The 16-hex fixture key it belongs to. */
  readonly key: string;
  readonly meta: FixtureMeta;
}

/**
 * Read every `_meta.json` sidecar in a fixture directory.
 *
 * @param dir - the fixture directory
 * @param io - how to read it on this platform
 * @returns the sidecars, sorted by scenario name
 * @throws Error when a sidecar is not parseable — a fixture set whose metadata
 *   cannot be read cannot be aged, and silently skipping it would turn
 *   {@link assertFixturesFresh} into a no-op
 */
export async function listFixtureMeta(
  dir: string,
  io: FixtureIo,
): Promise<readonly LoadedFixtureMeta[]> {
  const names = (await io.listNames(dir)).filter((n) =>
    n.endsWith(META_SUFFIX),
  );
  const out: LoadedFixtureMeta[] = [];
  for (const file of names) {
    const text = await io.readText(dir, file);
    let meta: FixtureMeta;
    try {
      meta = JSON.parse(text) as FixtureMeta;
    } catch (cause) {
      throw new Error(`Unparseable fixture metadata ${dir}/${file}`, { cause });
    }
    out.push({ file, key: file.slice(0, -META_SUFFIX.length), meta });
  }
  return out.sort((a, b) => a.meta.scenario.localeCompare(b.meta.scenario));
}

/** The verdict {@link assertFixturesFresh} returns. */
export interface FreshnessReport {
  /** How many sidecars were aged. `synthetic` ones are aged too. */
  readonly checked: number;
  /** One line per fixture older than {@link FIXTURE_STALE_WARN_DAYS}. */
  readonly warnings: readonly string[];
  /** The oldest age seen, in whole days. `0` for an empty directory. */
  readonly oldestDays: number;
}

/**
 * `docs/13` §3.3 item 2, as a check that actually runs.
 *
 * @param dir - the fixture directory
 * @param nowEpochMs - "now"; a test passes a fixed instant, CI passes
 *   `Date.now()`
 * @param io - how to read the directory on this platform
 * @returns the warnings, for the caller to print
 * @throws Error naming {@link FIXTURE_RECORD_COMMAND} when any fixture is older
 *   than {@link FIXTURE_STALE_FAIL_DAYS}, or when the directory holds no
 *   sidecars at all — an empty fixture set passing silently is how a deleted
 *   corpus goes unnoticed
 */
export async function assertFixturesFresh(
  dir: string,
  nowEpochMs: number,
  io: FixtureIo,
): Promise<FreshnessReport> {
  const loaded = await listFixtureMeta(dir, io);
  if (loaded.length === 0) {
    throw new Error(
      `No fixture metadata in ${dir}: the recorded corpus is missing.\n` +
        `Record it with: ${FIXTURE_RECORD_COMMAND}`,
    );
  }

  const warnings: string[] = [];
  const failures: string[] = [];
  let oldestDays = 0;

  for (const { meta, key } of loaded) {
    const recordedMs = Date.parse(meta.recordedAt);
    if (Number.isNaN(recordedMs)) {
      failures.push(
        `${meta.scenario} (${key}): recordedAt "${meta.recordedAt}" is not a date`,
      );
      continue;
    }
    const days = Math.floor((nowEpochMs - recordedMs) / MS_PER_DAY);
    oldestDays = Math.max(oldestDays, days);
    if (days > FIXTURE_STALE_FAIL_DAYS) {
      failures.push(`${meta.scenario} (${key}): recorded ${days} days ago`);
    } else if (days > FIXTURE_STALE_WARN_DAYS) {
      warnings.push(
        `fixture "${meta.scenario}" is ${days} days old ` +
          `(warn at ${FIXTURE_STALE_WARN_DAYS}, fail at ${FIXTURE_STALE_FAIL_DAYS}); ` +
          `re-record with: ${FIXTURE_RECORD_COMMAND}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} fixture(s) are past ${FIXTURE_STALE_FAIL_DAYS} days ` +
        `(docs/13 §3.3):\n  ${failures.join("\n  ")}\n` +
        `Re-record with: ${FIXTURE_RECORD_COMMAND}\n` +
        `docs/13 §3.3 rule 4: never hand-edit a fixture to make this pass. ` +
        `Re-record, review the diff — a large unexplained diff is the signal — ` +
        `and if the service changed shape, fix the parser in the same commit.`,
    );
  }

  return { checked: loaded.length, warnings, oldestDays };
}

// ---------------------------------------------------------------------------
// 6. Several hosts behind one client (`P2-T16`)
// ---------------------------------------------------------------------------

/*
 * `createReplayHttpClient` above serves one fixture directory under one host,
 * which is what an adapter's contract test needs. A **pipeline** run hands one
 * `HttpClient` to every adapter — `src/bootstrap/container.ts` builds exactly
 * one — so an end-to-end run over replay needs one client whose transport
 * routes each request to the directory of the host it names.
 *
 * Two seams, both for `P2-T16`, and neither able to reach the network:
 *
 * - {@link MultiHostReplayOptions.answerFor} replaces a host's fixtures with
 *   one committed exchange. `P2-T16` step 3 uses it to make a source answer
 *   its own committed `error-500` fixture for every request; the exchange is
 *   read from disk, never written.
 * - {@link MultiHostReplayOptions.latency} delays each answer. The
 *   `npm run bench:search` script uses it for a per-host latency model;
 *   nothing else should, because an integration spec measures behaviour, not
 *   time.
 */

/** One host's fixture directories, tried in order until one holds the request. */
export interface ReplayRoute {
  /** The URL host, as `docs/07` §7.3 keys buckets — `new URL(url).host`. */
  readonly host: string;
  /**
   * Fixture directories, in the order they are tried. bioRxiv and medRxiv
   * share `api.biorxiv.org` and keep separate directories, so that host lists
   * both.
   */
  readonly dirs: readonly string[];
}

/** Options for {@link createMultiHostReplayTransport}. */
export interface MultiHostReplayOptions {
  readonly routes: readonly ReplayRoute[];
  /** How to read the directories on this platform. */
  readonly io: FixtureIo;
  /**
   * An exchange to answer instead of the host's fixtures, or `undefined` to
   * replay as usual. Called once per request.
   */
  readonly answerFor?: (
    host: string,
    request: { readonly method: string; readonly url: string },
  ) => RecordedExchange | undefined;
  /**
   * Awaited before each answer, inside the client's limiter slot exactly
   * where a real round trip would be. Omitted, answers are immediate.
   */
  readonly latency?: (
    host: string,
    request: { readonly method: string; readonly url: string },
  ) => Promise<void>;
}

/** One request {@link createMultiHostReplayTransport} answered or refused. */
export interface MultiHostReplayCall extends ReplayCall {
  readonly host: string;
  /** The status answered; `undefined` when no fixture held the request. */
  readonly status: number | undefined;
}

/** A multi-host {@link HttpTransport} that records what it was asked. */
export interface MultiHostReplayTransport extends HttpTransport {
  readonly calls: readonly MultiHostReplayCall[];
}

/**
 * Build a `Zotero.HTTP` stand-in that routes each request by host.
 *
 * A request to a host with no route, or one no listed directory holds, is
 * refused with {@link replayTransport}'s "Missing fixture … Record it with"
 * error — `docs/13` §2.2's rule that a missing fixture is a failure naming the
 * record command, never a live call. The client surfaces that error unchanged
 * (`src/core/http/client.ts` rethrows anything that is not a `Zotero.HTTP`
 * exception), so the adapter fails and the pipeline records the failure on
 * that source's report.
 *
 * @param options - see {@link MultiHostReplayOptions}
 * @returns the transport, plus every call it saw
 */
export function createMultiHostReplayTransport(
  options: MultiHostReplayOptions,
): MultiHostReplayTransport {
  const calls: MultiHostReplayCall[] = [];
  const byHost = new Map(
    options.routes.map((route) => [
      route.host,
      route.dirs.map((dir) => ({
        dir,
        replay: replayTransport(dir, options.io),
      })),
    ]),
  );

  async function answer(
    host: string,
    request: { method: string; url: string; body?: string },
  ): Promise<{ exchange: RecordedExchange; fixture: string }> {
    const injected = options.answerFor?.(host, request);
    if (injected !== undefined) {
      return { exchange: injected, fixture: `(injected for ${host})` };
    }
    let first: unknown;
    for (const { dir, replay } of byHost.get(host) ?? []) {
      try {
        return {
          exchange: await replay(request),
          fixture: fixtureFileFor(dir, request),
        };
      } catch (error) {
        first ??= error;
      }
    }
    throw first instanceof Error
      ? first
      : new Error(
          `Missing fixture: no route for host ${host} (${request.method} ` +
            `${request.url})\nRecord it with: ${FIXTURE_RECORD_COMMAND}`,
        );
  }

  return {
    calls,
    async request(method, url, transportOptions): Promise<HttpTransportXhr> {
      const host = new URL(url).host;
      const request = {
        method,
        url,
        ...(transportOptions.body !== undefined && {
          body: transportOptions.body,
        }),
      };
      if (options.latency !== undefined) {
        await options.latency(host, request);
      }
      let found: { exchange: RecordedExchange; fixture: string };
      try {
        found = await answer(host, request);
      } catch (error) {
        calls.push({
          method,
          url,
          options: transportOptions,
          fixture: "(missing)",
          host,
          status: undefined,
        });
        throw error;
      }
      calls.push({
        method,
        url,
        options: transportOptions,
        fixture: found.fixture,
        host,
        status: found.exchange.status,
      });
      const block = Object.entries(found.exchange.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      return {
        status: found.exchange.status,
        responseText: found.exchange.body,
        // The request URL, for the reason `createReplayTransport` gives.
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

/** Options for {@link createMultiHostReplayHttpClient}. */
export interface MultiHostReplayHttpClientOptions extends MultiHostReplayOptions {
  /** As {@link ReplayHttpClientOptions.version}. */
  readonly version?: string;
  /**
   * The client's clock. Omitted: a clock frozen at {@link FROZEN_NOW_EPOCH_MS}
   * whose `sleep` records and returns at once, as
   * {@link createReplayHttpClient}'s does. The bench passes the system clock.
   */
  readonly clock?: Clock;
  /**
   * Each host's limiter. Omitted: one {@link createRecordingLimiter} per
   * routed host, which grants at once. The bench passes the shipped
   * `HOST_POLICIES` buckets, which pace for real.
   */
  readonly limiterFor?: (host: string) => RateLimiterPort | undefined;
}

/** What {@link createMultiHostReplayHttpClient} hands back. */
export interface MultiHostReplayHttpClient {
  readonly client: HttpClient;
  readonly transport: MultiHostReplayTransport;
  /** The recording limiters, by host; empty when `limiterFor` was supplied. */
  readonly limiters: ReadonlyMap<string, RecordingLimiter>;
  /** Waits the retry loop asked for, when the default clock is in use. */
  readonly slept: readonly number[];
}

/**
 * The shipped `createHttpClient` over {@link createMultiHostReplayTransport},
 * with every host given the shipped §7.3 retry policy — the same
 * `HOST_POLICIES` row and `retryPolicyFromBudget` the composition root reads
 * (see {@link shippedRetryPolicy}).
 *
 * @param options - see {@link MultiHostReplayHttpClientOptions}
 * @returns the client and the things a test asserts against
 */
export function createMultiHostReplayHttpClient(
  options: MultiHostReplayHttpClientOptions,
): MultiHostReplayHttpClient {
  const transport = createMultiHostReplayTransport(options);
  const slept: number[] = [];
  const limiters = new Map<string, RecordingLimiter>();
  if (options.limiterFor === undefined) {
    for (const route of options.routes) {
      limiters.set(route.host, createRecordingLimiter(route.host));
    }
  }
  const frozen = createManualClock(FROZEN_NOW_EPOCH_MS);
  const clock: Clock = options.clock ?? {
    now: () => frozen.now(),
    sleep: (ms, token) =>
      new Promise<void>((resolve) => {
        slept.push(ms);
        token?.throwIfCancelled();
        resolve();
      }),
  };
  const policies = new Map<string, RetryPolicy | undefined>();
  const client = createHttpClient({
    transport,
    userAgent: buildUserAgent(options.version ?? "0.0.2"),
    clock,
    limiterFor: options.limiterFor ?? ((host) => limiters.get(host)),
    retryFor: (host) => {
      if (!policies.has(host)) policies.set(host, shippedRetryPolicy(host));
      return policies.get(host);
    },
  });
  return { client, transport, limiters, slept };
}

/**
 * The committed exchange of one scenario in one fixture directory, for
 * {@link MultiHostReplayOptions.answerFor}. Found through the sidecars, so a
 * caller names a scenario rather than a hash.
 *
 * @param dir - the fixture directory
 * @param scenario - the sidecar's `scenario`, e.g. `"error-500"`
 * @param io - how to read it on this platform
 * @returns the exchange
 * @throws Error unless exactly one sidecar names the scenario
 */
export async function readScenarioExchange(
  dir: string,
  scenario: string,
  io: FixtureIo,
): Promise<RecordedExchange> {
  const matches = (await listFixtureMeta(dir, io)).filter(
    (loaded) => loaded.meta.scenario === scenario,
  );
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only === undefined) {
    throw new Error(
      `${String(matches.length)} fixtures in ${dir} are named "${scenario}"; ` +
        `expected exactly one`,
    );
  }
  return JSON.parse(
    await io.readText(dir, `${only.key}.json`),
  ) as RecordedExchange;
}

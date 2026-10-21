import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock, type Clock } from "../../../src/core/clock";
import { UpstreamServerError } from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { type RetryPolicy } from "../../../src/core/http/retry";
import {
  createBackoff,
  decorrelatedJitter,
  parseRetryAfter,
  type RetryBudget,
} from "../../../src/core/rateLimit/backoff";
import {
  createHostLimiterRegistry,
  HOST_POLICIES,
  type HostRateLimitPolicy,
  LLM_RETRY_BUDGET,
  NCBI_HOST,
} from "../../../src/core/rateLimit/hostLimiter";

/**
 * `P1-T04`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no real
 * time — `parseRetryAfter`'s HTTP-date form is asserted against a
 * `createManualClock()` reading rather than `Date.now()`, which is the reason its
 * second parameter exists at all.
 *
 * `vitest` globals are deliberately not used — every symbol is imported.
 *
 * **The random source is injected, never sampled.** `decorrelatedJitter` takes a
 * `() => number`, so the tests below assert the *ends* of the interval §7.3
 * specifies instead of drawing a few values and hoping. A test that called
 * `Math.random` and asserted a range would pass on a broken implementation that
 * happened to stay inside it.
 *
 * **Section 4 is `P1-T28`'s**, and it is the one part of this file that is not
 * pure: it reads `docs/07` §7.3 off disk and drives a real `createHttpClient`
 * over a stub transport, because the card's criteria are about the *shipped*
 * numbers rather than about the shape. It stays in this file rather than in a new
 * one because `P1-T28`'s `Verify with` filters on `backoff http`, so a
 * `retryBudget.test.ts` would not be run by the command that gates the card —
 * the same reasoning `test/unit/core/http-client.test.ts`'s header records for
 * keeping `retry.ts`'s tests there.
 */

/** Narrow away `undefined` without a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

// ---------------------------------------------------------------------------
// 1. parseRetryAfter — the card's fifth criterion
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  const now = createManualClock().now();

  it("reads the delay-seconds form", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBe(0);
    expect(parseRetryAfter("1", now)).toBe(1000);
    expect(parseRetryAfter("3600", now)).toBe(3_600_000);
  });

  it("reads the HTTP-date form as a delta from now", () => {
    const header = new Date(now + 120_000).toUTCString();
    expect(header).toMatch(/GMT$/);
    expect(parseRetryAfter(header, now)).toBe(120_000);
  });

  it("clamps an HTTP-date already in the past to zero, never negative", () => {
    const header = new Date(now - 90_000).toUTCString();
    expect(parseRetryAfter(header, now)).toBe(0);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfter("  90  ", now)).toBe(90_000);
  });

  it("returns undefined when the header gives no answer", () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("", now)).toBeUndefined();
    expect(parseRetryAfter("   ", now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });

  it("refuses values that are not delay-seconds tokens", () => {
    // RFC 9110 §10.2.3's delay-seconds is a non-negative *integer*. Accepting
    // these would invent a delay the server did not send; the caller falls back
    // to the jittered backoff instead.
    expect(parseRetryAfter("120.5", now)).toBeUndefined();
    expect(parseRetryAfter("-5", now)).toBeUndefined();
    expect(parseRetryAfter("1e3", now)).toBeUndefined();
    expect(parseRetryAfter("+120", now)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. decorrelatedJitter — docs/07 §7.3's `min(cap, random(base, prev*3))`
// ---------------------------------------------------------------------------

describe("decorrelatedJitter", () => {
  it("returns the interval's lower end when the draw is 0", () => {
    expect(decorrelatedJitter(1000, 500, 60_000, () => 0)).toBe(500);
  });

  it("returns the interval's upper end when the draw is 1", () => {
    expect(decorrelatedJitter(1000, 500, 60_000, () => 1)).toBe(3000);
  });

  it("never exceeds the cap", () => {
    expect(decorrelatedJitter(100_000, 1000, 5000, () => 1)).toBe(5000);
    expect(decorrelatedJitter(100_000, 1000, 5000, () => 0.5)).toBe(5000);
  });

  it("collapses to the base when prev*3 is below it", () => {
    // The first retry, where the convention is `prev = base`, and the
    // degenerate `prev = 0`.
    expect(decorrelatedJitter(0, 1000, 60_000, () => 1)).toBe(1000);
    expect(decorrelatedJitter(1000, 1000, 60_000, () => 0)).toBe(1000);
    expect(decorrelatedJitter(1000, 1000, 60_000, () => 1)).toBe(3000);
  });

  it("stays inside [base, min(cap, max(base, prev*3))] for every draw", () => {
    const prev = 4000;
    const base = 1000;
    const cap = 60_000;
    const upper = Math.min(cap, Math.max(base, prev * 3));
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
      const delay = decorrelatedJitter(prev, base, cap, () => r);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(upper);
    }
  });

  it("defaults to Math.random and still respects the bounds", () => {
    for (let i = 0; i < 50; i += 1) {
      const delay = decorrelatedJitter(2000, 1000, 60_000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(6000);
    }
  });

  it("rejects a base, cap or prev it cannot work with", () => {
    expect(() => decorrelatedJitter(1000, 0, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(1000, -1, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(1000, 5000, 1000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(-1, 1000, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(Number.NaN, 1000, 60_000)).toThrow(
      RangeError,
    );
    expect(() =>
      decorrelatedJitter(1000, 1000, Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 3. createBackoff — the per-host attempt cap
// ---------------------------------------------------------------------------

describe("createBackoff", () => {
  const budget: RetryBudget = {
    baseMs: 1000,
    capMs: 60_000,
    maxAttempts: 5,
  };

  it("yields maxAttempts - 1 delays and then exhausts", () => {
    const backoff = createBackoff(budget, () => 0);
    const delays: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = backoff.next();
      if (next === undefined) break;
      delays.push(next);
    }
    // 5 total attempts = 1 initial try + 4 retries.
    expect(delays).toHaveLength(4);
    expect(backoff.delaysIssued).toBe(4);
    expect(backoff.next()).toBeUndefined();
    expect(backoff.next()).toBeUndefined();
  });

  it("allows no retry at all when the cap is 1", () => {
    const backoff = createBackoff({ ...budget, maxAttempts: 1 });
    expect(backoff.next()).toBeUndefined();
    expect(backoff.delaysIssued).toBe(0);
  });

  it("grows from the previous delay, tripling until the cap bites", () => {
    const backoff = createBackoff({ ...budget, maxAttempts: 6 }, () => 1);
    expect([
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
    ]).toEqual([3000, 9000, 27_000, 60_000, 60_000]);
  });

  it("stays at the base when every draw is 0", () => {
    const backoff = createBackoff(budget, () => 0);
    expect([backoff.next(), backoff.next(), backoff.next()]).toEqual([
      1000, 1000, 1000,
    ]);
  });

  it("lets a server-supplied Retry-After win", () => {
    const backoff = createBackoff(budget, () => 0);
    expect(backoff.next(120_000)).toBe(120_000);
    // The progression advanced by the *jittered* value, not the server's, so one
    // long Retry-After does not push every later delay to the cap.
    expect(backoff.next()).toBe(1000);
  });

  it("keeps its own delay when it is the longer of the two", () => {
    const backoff = createBackoff(budget, () => 1);
    expect(backoff.next(10)).toBe(3000);
  });

  it("does not clamp a server-supplied Retry-After to the cap", () => {
    const backoff = createBackoff(
      { baseMs: 1000, capMs: 5000, maxAttempts: 5 },
      () => 0,
    );
    expect(backoff.next(3_600_000)).toBe(3_600_000);
  });

  it("validates the budget eagerly", () => {
    expect(() => createBackoff({ ...budget, maxAttempts: 0 })).toThrow(
      RangeError,
    );
    expect(() => createBackoff({ ...budget, maxAttempts: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => createBackoff({ ...budget, baseMs: 0 })).toThrow(RangeError);
    expect(() => createBackoff({ ...budget, capMs: 10 })).toThrow(RangeError);
  });

  it("threads a whole retry sequence through one clock, with no real time", () => {
    // The shape a caller uses: parse the header, take the longer of it and the
    // jittered delay, stop when the cap is spent. No sleeping happens here —
    // that is `src/core/http/retry.ts`'s (`P1-T05`), and the point of this
    // assertion is that the numbers are computable without a timer.
    const clock = createManualClock();
    const backoff = createBackoff({ ...budget, maxAttempts: 3 }, () => 1);
    const headers = ["2", new Date(clock.now() + 30_000).toUTCString(), "1"];
    const delays: number[] = [];
    for (const header of headers) {
      const serverMs = parseRetryAfter(header, clock.now());
      const next = backoff.next(serverMs);
      if (next === undefined) break;
      delays.push(next);
    }
    expect(delays).toEqual([3000, 30_000]);
    expect(must(delays[1], "the second delay")).toBeGreaterThan(
      must(delays[0], "the first delay"),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. §7.3's three retry numbers, on the shipped policy row — `P1-T28`
// ---------------------------------------------------------------------------

/**
 * `docs/07` §7.3's policy table, parsed out of the document.
 *
 * **Why the document is read rather than restated.** `P1-T28`'s second criterion
 * is that "a test reads §7.3's values from the row", and `plan/README.md` §5
 * rule 4 makes §7.3 the only place a limit may be declared. A test that spelled
 * `1000` and `30_000` again would pass with §7.3 saying something else, which is
 * the one failure mode worth catching here. So the parse is the authority and
 * {@link HOST_POLICIES} is what is checked against it: edit §7.3's table and this
 * file fails, which is what makes the document load-bearing rather than
 * decorative.
 *
 * The parsing discipline is `test/unit/prefs/schema.test.ts`'s `readPrefsJs`,
 * named here because it is the pattern and not a coincidence: parse the
 * authoritative file, then **guard against a parse that silently matched
 * nothing** — that file counts `pref(` calls against the rows it consumed, and
 * the guards below count columns and rows. A table this test cannot read is an
 * error, never an empty result set, because an empty result set makes every
 * assertion downstream vacuously true.
 *
 * Column *names* are resolved from the header row rather than by position, so
 * inserting a column into §7.3 does not silently shift this test onto the wrong
 * cell.
 */
interface Section73Table {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function readSection73Table(): Section73Table {
  // `fileURLToPath(import.meta.url)` rather than `new URL(relative,
  // import.meta.url)`, for the reason `test/unit/prefs/schema.test.ts` records:
  // `tsconfig.json` extends `zotero-types/entries/sandbox`, whose `URL` is not
  // structurally the one `fileURLToPath` takes.
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(
    resolve(here, "../../../docs/07-architecture-and-data-model.md"),
    "utf8",
  );

  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith("### 7.3 "));
  if (start < 0) {
    throw new Error(
      "docs/07 has no `### 7.3 ` heading; §7.3 could not be read",
    );
  }
  const after = lines.findIndex(
    (line, index) => index > start && line.startsWith("### "),
  );
  const section = lines.slice(start, after < 0 ? lines.length : after);

  const cellsOf = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  // The *contiguous* block starting at the header, not every table line in the
  // section: §7.3 carries a second table — the attempt cap's cost in waiting —
  // and a filter over the whole section mixes the two. The cell-count guard
  // below caught exactly that while this test was being written.
  const headerIndex = section.findIndex((line) => line.startsWith("| Host |"));
  if (headerIndex < 0) {
    throw new Error(
      "§7.3 has no policy table whose header row starts `| Host |`",
    );
  }
  const block: string[] = [];
  for (let i = headerIndex; i < section.length; i += 1) {
    const line = must(section[i], "a line of §7.3");
    if (!line.startsWith("|")) break;
    if (/^\|[\s\-:|]*\|$/.test(line)) continue;
    block.push(line);
  }
  const columns = cellsOf(must(block[0], "§7.3's header row"));
  const rows = block.slice(1).map(cellsOf);

  // The three guards that stop a mis-parse from reading as "nothing to assert".
  if (rows.length === 0) {
    throw new Error("§7.3's policy table parsed to zero data rows");
  }
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(
        `§7.3's policy table has a row of ${row.length} cells against ` +
          `${columns.length} columns: ${row.join(" | ")}`,
      );
    }
  }
  return { columns, rows };
}

/** One cell of §7.3's table, by host and column name. */
function section73Cell(
  table: Section73Table,
  host: string,
  column: string,
): string {
  const hostColumn = table.columns.indexOf("Host");
  const index = table.columns.indexOf(column);
  if (hostColumn < 0 || index < 0) {
    throw new Error(
      `§7.3's policy table has no "${column}" column; it has ` +
        `${table.columns.join(", ")}`,
    );
  }
  const row = table.rows.find(
    (cells) => must(cells[hostColumn], "a Host cell") === `\`${host}\``,
  );
  if (row === undefined) {
    throw new Error(`§7.3's policy table has no row for \`${host}\``);
  }
  return must(row[index], `${host}'s "${column}" cell`);
}

/**
 * §7.3's Host cell for the row every LLM host shares. Matched as written:
 * `test/unit/core/hostLimiter.test.ts`'s `llmRowCells` finds the same row by
 * the same text, so the cell is not renamed.
 */
const LLM_ROW_HOST_CELL = "LLM/TTS hosts";

/** The marker §7.3 puts after each of that row's three retry figures. */
const LLM_CELL_MARKER = /\s*\(LLM\)$/;

/**
 * One cell of the §7.3 row a `HOST_POLICIES` row is checked against
 * (`P3-T38`, `plan/00` §6 item 244).
 *
 * A row whose `retry` **is** `LLM_RETRY_BUDGET` — the same object, not an
 * equal copy — is an LLM adapter's row (`P3-T07`–`P3-T10` add them), and is
 * checked against §7.3's shared "LLM/TTS hosts" row, whose retry cells read
 * `1000 ms (LLM)` and so on; the `(LLM)` marker is required and removed. Every
 * other row is checked against the row that names its own host, as before, so
 * a host §7.3 does not name still fails in {@link section73Cell}.
 */
function section73CellFor(
  table: Section73Table,
  policy: HostRateLimitPolicy,
  column: string,
): string {
  if (policy.retry !== LLM_RETRY_BUDGET) {
    return section73Cell(table, policy.host, column);
  }
  const hostColumn = table.columns.indexOf("Host");
  const index = table.columns.indexOf(column);
  const row = table.rows.find(
    (cells) => cells[hostColumn] === LLM_ROW_HOST_CELL,
  );
  if (hostColumn < 0 || index < 0 || row === undefined) {
    throw new Error(
      `§7.3's policy table has no "${column}" cell on its ` +
        `"${LLM_ROW_HOST_CELL}" row, which ${policy.host}'s row is read against`,
    );
  }
  const cell = must(row[index], `the LLM/TTS row's "${column}" cell`);
  if (!LLM_CELL_MARKER.test(cell)) {
    throw new Error(
      `§7.3's LLM/TTS "${column}" cell carries no "(LLM)" marker: ` +
        JSON.stringify(cell),
    );
  }
  return cell.replace(LLM_CELL_MARKER, "");
}

/** `1000 ms`, `30 000 ms` — digits may be space-grouped, as §7.3 writes them. */
function millisecondsIn(cell: string, what: string): number {
  const match = /^(\d+)ms$/.exec(cell.replace(/[\s*`]/g, ""));
  if (match === null) {
    throw new Error(
      `§7.3's ${what} cell is not a millisecond figure: ${JSON.stringify(cell)}`,
    );
  }
  return Number(match[1]);
}

/** A bare count, as §7.3 writes the attempt cap. */
function countIn(cell: string, what: string): number {
  const match = /^(\d+)$/.exec(cell.replace(/[\s*`]/g, ""));
  if (match === null) {
    throw new Error(
      `§7.3's ${what} cell is not a count: ${JSON.stringify(cell)}`,
    );
  }
  return Number(match[1]);
}

/**
 * A row's retry budget, through the registry that serves it. `policies`
 * defaults to the shipped table; `P3-T38`'s tests pass a synthetic one.
 */
function shippedBudget(
  host: string,
  policies: readonly HostRateLimitPolicy[] = HOST_POLICIES,
): RetryBudget {
  const registry = createHostLimiterRegistry({
    clock: createManualClock(),
    policies,
  });
  const policy = must(registry.policyFor(host), `the ${host} policy row`);
  return must(policy.retry, `the ${host} row's retry budget`);
}

/**
 * The check "transcribes §7.3's three columns" makes, over any policy list:
 * each row's base, cap and attempt cap equal the §7.3 row
 * {@link section73CellFor} picks for it.
 */
function expectTranscribed(
  table: Section73Table,
  policies: readonly HostRateLimitPolicy[],
): void {
  for (const policy of policies) {
    const { host } = policy;
    const budget = shippedBudget(host, policies);
    expect(budget.baseMs, `${host} retry base`).toBe(
      millisecondsIn(
        section73CellFor(table, policy, "Retry base"),
        `${host} retry base`,
      ),
    );
    expect(budget.capMs, `${host} retry cap`).toBe(
      millisecondsIn(
        section73CellFor(table, policy, "Retry cap"),
        `${host} retry cap`,
      ),
    );
    expect(budget.maxAttempts, `${host} attempt cap`).toBe(
      countIn(
        section73CellFor(table, policy, "Attempt cap"),
        `${host} attempt cap`,
      ),
    );
  }
}

/** The check "names every shipped host", over any policy list. */
function expectNamed(
  table: Section73Table,
  policies: readonly HostRateLimitPolicy[],
): void {
  for (const policy of policies) {
    // Throws rather than returns undefined when the host has no row, which is
    // the guard that keeps the assertion above from matching a row §7.3 does
    // not contain.
    expect(section73CellFor(table, policy, "Attempt cap")).not.toBe("—");
  }
}

/** The shipped NCBI row, through the registry that serves it. */
function shippedNcbiBudget(): RetryBudget {
  return shippedBudget(NCBI_HOST);
}

/**
 * The `RetryPolicy` a composition root builds from a §7.3 row — `maxAttempts`
 * straight off the row and `nextDelayMs` partially applied to that row's `base`
 * and `cap`, which is exactly what `src/core/http/retry.ts`'s
 * `RetryPolicy.nextDelayMs` documents as its "intended supplier".
 */
function policyOver(budget: RetryBudget, random: () => number): RetryPolicy {
  return {
    maxAttempts: budget.maxAttempts,
    nextDelayMs: (prevDelayMs) =>
      decorrelatedJitter(prevDelayMs, budget.baseMs, budget.capMs, random),
  };
}

/** A clock that records what it was asked to wait and waits none of it. */
function recordingClock(): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => 1_700_000_000_000,
    sleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

class StubZoteroException extends Error {}
class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}

/** A transport that answers every call with one status and counts the calls. */
function createCountingTransport(
  status: number,
): HttpTransport & { readonly calls: HttpTransportOptions[] } {
  const calls: HttpTransportOptions[] = [];
  return {
    calls,
    request(_method, _url, options) {
      calls.push(options);
      return Promise.resolve({
        status,
        responseText: "",
        responseURL: "",
        getAllResponseHeaders: () => "",
      });
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubZoteroException,
    BrowserOfflineException: StubZoteroException,
    SecurityException: StubZoteroException,
    CancelledException: StubZoteroException,
  };
}

const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";

describe("docs/07 §7.3's retry budget on the shipped policy rows", () => {
  it("transcribes §7.3's three columns for every shipped row, read from the document itself", () => {
    // `P1-T28` wrote this for the NCBI row alone; `P2-T32` widened it to every
    // row `HOST_POLICIES` carries, because the owner filled the remaining
    // retry cells on 2026-10-14 and a row whose budget is checked only for
    // presence could carry any three numbers. The loop is over the shipped
    // table, so a row added without the document saying what it should hold
    // fails in `section73Cell` rather than passing by omission.
    // `P3-T38` moved the loop into `expectTranscribed` so an LLM row is read
    // against §7.3's shared row; a literature row is read exactly as before.
    const table = readSection73Table();
    expect(HOST_POLICIES.length).toBeGreaterThan(1);
    expectTranscribed(table, HOST_POLICIES);
  });

  it("names every shipped host in §7.3's table, so no row is read from nowhere", () => {
    expectNamed(readSection73Table(), HOST_POLICIES);
  });

  it("gives every shipped policy row a retry budget", () => {
    // `retry` is optional on the type for a compatibility reason recorded in
    // `hostLimiter.ts`; it is not optional in practice. A Phase 2 row added
    // without its own three values fails here rather than silently shipping a
    // host that never retries.
    for (const policy of HOST_POLICIES) {
      const budget = must(policy.retry, `${policy.host}'s retry budget`);
      // Accepted by the shape that will consume it: `createBackoff` validates a
      // budget eagerly, so an impossible base/cap/attempt trio throws here.
      expect(() => createBackoff(budget)).not.toThrow();
    }
  });

  it("spends an attempt cap of 3 as two waits of at most base then 3x base", () => {
    // The arithmetic §7.3's cost table publishes, recomputed from the shipped
    // row rather than restated: `maxAttempts` counts the first attempt, so a
    // budget of 3 buys two waits, and `withRetry` enters the first retry with
    // `prevDelayMs = 0` so the first wait is exactly `base`.
    const budget = shippedNcbiBudget();
    const longest = policyOver(budget, () => 1);
    const shortest = policyOver(budget, () => 0);

    const walk = (policy: RetryPolicy): number[] => {
      const waits: number[] = [];
      let prev = 0;
      for (let attempt = 1; attempt < policy.maxAttempts; attempt += 1) {
        prev = policy.nextDelayMs(prev, attempt);
        waits.push(prev);
      }
      return waits;
    };

    expect(walk(longest)).toEqual([budget.baseMs, budget.baseMs * 3]);
    expect(walk(shortest)).toEqual([budget.baseMs, budget.baseMs]);
    // 4 s, which is the figure §7.3 weighs the attempt cap against.
    expect(walk(longest).reduce((a, b) => a + b, 0)).toBe(4000);
    // And the cap does not bind at this attempt cap, as §7.3 states.
    expect(Math.max(...walk(longest))).toBeLessThan(budget.capMs);
  });

  it("retries a 503 to exactly §7.3's attempt cap, counted on the transport", async () => {
    const budget = shippedNcbiBudget();
    const transport = createCountingTransport(503);
    const clock = recordingClock();
    const client = createHttpClient({
      transport,
      userAgent: UA,
      clock,
      // Exactly what a composition root supplies: the policy for this host and
      // nothing for any other.
      retryFor: (host) =>
        host === NCBI_HOST ? policyOver(budget, () => 1) : undefined,
    });

    await expect(
      client.request(
        "GET",
        `https://${NCBI_HOST}/entrez/eutils/esearch.fcgi?db=pubmed`,
      ),
    ).rejects.toBeInstanceOf(UpstreamServerError);

    // Exactly the cap, not "more than one": `maxAttempts` is total attempts
    // including the first, so 3 means 3 requests and 2 waits. A caller that read
    // the cap as *retries* would issue 4 requests and 3 waits, and all four
    // assertions below would fail. They are asserted after the rejection rather
    // than inside a `.catch`, so a failure reports the count rather than an
    // `AssertionError` wrapped in the rejection.
    expect(transport.calls).toHaveLength(budget.maxAttempts);
    expect(transport.calls).toHaveLength(3);
    expect(clock.slept).toEqual([1000, 3000]);
    expect(clock.slept).toHaveLength(budget.maxAttempts - 1);
  });
});

// ---------------------------------------------------------------------------
// 5. LLM rows against §7.3's shared row — `P3-T38`, `plan/00` §6 item 244
// ---------------------------------------------------------------------------

describe("an LLM adapter's row is read against §7.3's shared LLM/TTS row (P3-T38, item 244)", () => {
  // The four LLM rows ship since 2026-10-21 (owner, `plan/00` §6 item 260),
  // and the two tests above already read them. The first test here names the
  // shipped `api.anthropic.com` row; the hand-built rows below use hosts no
  // row ships, and their rate is a placeholder nothing here reads (the LLM
  // rows' rate cells are checked in `hostLimiter.test.ts`). *(Rewritten
  // 2026-10-21, item 260: the first test added a synthetic
  // `api.anthropic.com` row, which the shipped one now duplicates.)*
  const PLACEHOLDER_RATE = { ratePerSecond: 1, burst: 1, maxConcurrent: 1 };
  const anthropicRow: HostRateLimitPolicy = must(
    HOST_POLICIES.find((row) => row.host === "api.anthropic.com"),
    "the shipped api.anthropic.com row",
  );

  it("reads the shipped api.anthropic.com row, which carries LLM_RETRY_BUDGET, against the shared row", () => {
    const table = readSection73Table();
    expect(anthropicRow.retry).toBe(LLM_RETRY_BUDGET);
    expect(() => expectTranscribed(table, [anthropicRow])).not.toThrow();
    expect(() => expectNamed(table, [anthropicRow])).not.toThrow();
    // It was read against the shared row, not against a row of its own.
    expect(() =>
      section73Cell(table, anthropicRow.host, "Attempt cap"),
    ).toThrow(/no row for `api\.anthropic\.com`/);
    expect(section73CellFor(table, anthropicRow, "Attempt cap")).toBe("5");
  });

  it("still rejects a row whose host §7.3 does not name, even with a budget equal to the LLM one", () => {
    const table = readSection73Table();
    // Equal numbers, different object: not an LLM row, so it needs its own.
    const lookalike: HostRateLimitPolicy = {
      host: "llm.unnamed.test",
      withoutKey: PLACEHOLDER_RATE,
      retry: { ...LLM_RETRY_BUDGET },
    };
    const literatureShaped: HostRateLimitPolicy = {
      host: "papers.unnamed.test",
      withoutKey: PLACEHOLDER_RATE,
      retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
    };
    for (const row of [lookalike, literatureShaped]) {
      expect(() => expectNamed(table, [row]), row.host).toThrow(
        /has no row for/,
      );
      expect(() => expectTranscribed(table, [row]), row.host).toThrow(
        /has no row for/,
      );
    }
  });

  it("refuses an LLM/TTS cell that has lost its (LLM) marker, on a hand-built table", () => {
    // The marker is what says a figure is the LLM hosts' and not a TTS one
    // (TTS is undecided). The real §7.3 always carries it, so only a table
    // built here can show the guard firing.
    const columns = ["Host", "Retry base", "Retry cap", "Attempt cap"];
    const marked: Section73Table = {
      columns,
      rows: [
        [LLM_ROW_HOST_CELL, "1000 ms (LLM)", "60 000 ms (LLM)", "5 (LLM)"],
      ],
    };
    const unmarked: Section73Table = {
      columns,
      rows: [[LLM_ROW_HOST_CELL, "1000 ms", "60 000 ms", "5"]],
    };
    expect(section73CellFor(marked, anthropicRow, "Attempt cap")).toBe("5");
    expect(() =>
      section73CellFor(unmarked, anthropicRow, "Attempt cap"),
    ).toThrow(/no "\(LLM\)" marker/);
  });

  it("does not let an LLM row's budget stand in for a literature row's own cells", () => {
    // Only the `LLM_RETRY_BUDGET` object routes a row to the shared row. A
    // literature host carrying a copy of the LLM numbers is still read
    // against its own §7.3 row, whose cells (1000 / 30 000 / 3) differ.
    const table = readSection73Table();
    const ncbiWithWrongBudget: HostRateLimitPolicy = {
      host: NCBI_HOST,
      withoutKey: PLACEHOLDER_RATE,
      retry: { baseMs: 1000, capMs: 60_000, maxAttempts: 5 },
    };
    expect(() => expectTranscribed(table, [ncbiWithWrongBudget])).toThrow();
  });
});

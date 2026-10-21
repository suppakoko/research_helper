import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { UpstreamServerError } from "../../../src/core/errors";
import { type RateLimiterPort } from "../../../src/core/http/client";
import {
  REQUEST_BUDGET_MS,
  retryPolicyFromBudget,
  withRetry,
} from "../../../src/core/http/retry";
import { createBackoff } from "../../../src/core/rateLimit/backoff";
import {
  adoptAdvertisedLimits,
  createHostLimiterRegistry,
  HOST_POLICIES,
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_HOSTS,
  LLM_RETRY_BUDGET,
  parseAdvertisedLimits,
} from "../../../src/core/rateLimit/hostLimiter";
import {
  type RateLimiterConfig,
  TokenBucket,
} from "../../../src/core/rateLimit/tokenBucket";
import { ANTHROPIC_HOST } from "../../../src/llm/anthropic/anthropicProvider";
import { GEMINI_HOST } from "../../../src/llm/gemini/geminiProvider";
import { OPENAI_RATE_LIMIT_KEY } from "../../../src/llm/openai/openAiProvider";
import { createOpenRouterProvider } from "../../../src/llm/openrouter/openRouterProvider";
import {
  createBaseUrlResolver,
  DEFAULT_BASE_URLS,
} from "../../../src/llm/shared/baseUrl";
import type { ProviderId } from "../../../src/model/ids";

/**
 * `P2-T23`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network and no
 * clock — every assertion below calls `src/core/rateLimit/hostLimiter.ts`
 * directly.
 *
 * **This file is a move, not new coverage.** `P1-T26` wrote
 * `parseAdvertisedLimits` / `adoptAdvertisedLimits` and could only put their
 * tests in `test/unit/core/http-client.test.ts`, because that was the only test
 * file in its `Files` list. They are `hostLimiter.ts`'s functions, and
 * `plan/03`'s `P2-T03` runs `npm run test:unit -- hostLimiter` — a filter that
 * matched no file at all, and `test:unit` carries no `--passWithNoTests`, so the
 * `&&` chain failed on a file that did not exist rather than on a test.
 *
 * **What deliberately stayed in `http-client.test.ts`.**
 * `describe("the client reconfigures the limiter from live headers")` drives a
 * real `createHttpClient` over a stub transport and asserts what reached the
 * wire and when, what was logged, and that an unpaced host is left alone. A
 * limiter is involved, but the subject is the client. So is
 * `describe("the per-host limiter")`, which measures the client's `run()`
 * ordering, and the `Retry-After` describes, whose parser is
 * `src/core/rateLimit/backoff.ts`.
 *
 * **What is not here, and is not this card's to move.** The registry itself —
 * `HOST_POLICIES`, `createHostLimiterRegistry`, the key-presence switch and the
 * process-wide holder — is covered by `tokenBucket.test.ts` sections 10–11, for
 * the same reason and reported in `P1-T04`'s `Findings`. That file is not in this
 * card's `Files` list.
 */

/** A header lookup with `HttpResponse.header`'s case-insensitivity. */
function headerLookup(
  headers: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return (name) => byName.get(name.toLowerCase());
}

/** A limiter that only records what it was reconfigured to. */
function recordingLimiter(current: RateLimiterConfig): {
  readonly applied: RateLimiterConfig[];
  readonly currentConfig: RateLimiterConfig;
  reconfigure(config: RateLimiterConfig): void;
} {
  const applied: RateLimiterConfig[] = [];
  let config = current;
  return {
    applied,
    get currentConfig(): RateLimiterConfig {
      return config;
    },
    reconfigure(next) {
      applied.push(next);
      config = next;
    },
  };
}

/**
 * A limiter that only paces — the shape `src/core/http/client.ts`'s
 * {@link RateLimiterPort} requires, with neither half of the reconfigure seam.
 * Typed as the port on purpose: the "no-op for a limiter missing either half"
 * assertion below is about what the client is allowed to hand in, so weakening
 * this to a bare object literal would make that test prove less than it did in
 * `http-client.test.ts`, where it was written against that file's own stub.
 */
function createStubLimiter(key = "example.test"): RateLimiterPort {
  return {
    key,
    acquire: () => Promise.resolve(),
    run: (fn) => fn(),
    penalize: () => undefined,
  };
}

const NCBI_NO_KEY: RateLimiterConfig = {
  ratePerSecond: 2.5,
  burst: 1,
  maxConcurrent: 3,
};

describe("the limits a host advertises", () => {
  it("reads both measured spellings, in both cases", () => {
    // The trap this card was handed: `docs/02` §3.1 shows NCBI sending
    // `X-Ratelimit-Limit` in mixed case with no hyphen inside "Ratelimit", and
    // §5.1's measured Crossref response is all lowercase *with* one. Two
    // different headers, not one header twice — and a case-sensitive lookup
    // would silently read neither.
    expect(
      parseAdvertisedLimits(headerLookup({ "X-Ratelimit-Limit": "3" })),
    ).toStrictEqual({ ratePerSecond: 3 });
    expect(
      parseAdvertisedLimits(
        headerLookup({
          "x-rate-limit-limit": "3",
          "x-rate-limit-interval": "1s",
          "x-concurrency-limit": "3",
        }),
      ),
    ).toStrictEqual({ ratePerSecond: 3, maxConcurrent: 3 });
  });

  it("divides by a non-default interval, and voids a malformed one", () => {
    // §7.3: the interval "is **not** fixed at one second".
    expect(
      parseAdvertisedLimits(
        headerLookup({
          "x-rate-limit-limit": "6",
          "x-rate-limit-interval": "3s",
        }),
      ),
    ).toStrictEqual({ ratePerSecond: 2 });
    // Present but unreadable: the server said the interval is not one second
    // and we cannot tell what it is, so there is no rate here to adopt.
    expect(
      parseAdvertisedLimits(
        headerLookup({
          "x-rate-limit-limit": "6",
          "x-rate-limit-interval": "1 minute",
        }),
      ),
    ).toStrictEqual({});
  });

  it("reads nothing from a remaining count, a zero or a malformed value", () => {
    // `X-Ratelimit-Remaining` is a count against an unstated window. Turning it
    // into a rate would be inventing the window (rule 4), and `TokenBucket`
    // already models remaining budget as `stats.available`.
    expect(
      parseAdvertisedLimits(headerLookup({ "X-Ratelimit-Remaining": "2" })),
    ).toStrictEqual({});
    for (const value of ["0", "", "2.5", "-1", "many", "3 "]) {
      expect(
        parseAdvertisedLimits(headerLookup({ "x-ratelimit-limit": value }))
          .ratePerSecond,
      ).toBe(value === "3 " ? 3 : undefined);
    }
  });

  it("adopts a tighter rate and reports what it adopted", () => {
    const limiter = recordingLimiter(NCBI_NO_KEY);

    const adopted = adoptAdvertisedLimits(
      limiter,
      headerLookup({ "X-Ratelimit-Limit": "1" }),
    );

    expect(adopted).toStrictEqual({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 3,
    });
    expect(limiter.applied).toStrictEqual([adopted]);
  });

  it("does not reconfigure at all when nothing tightened", () => {
    // Three separate "no" cases, and each one must produce *no call*:
    // reconfigure() refills, re-queues and re-schedules, so a host advertising
    // its steady state on every response must not pay for it every time.
    const limiter = recordingLimiter(NCBI_NO_KEY);

    // (a) no header at all.
    expect(adoptAdvertisedLimits(limiter, headerLookup({}))).toBeUndefined();
    // (b) the advertised limit is *higher* than the policy in force. §7.3 puts
    //     NCBI at 2.5/s against a documented 3/s "for clock-skew headroom", and
    //     3 is exactly what the live header says — adopting it would spend the
    //     headroom the table exists to keep.
    expect(
      adoptAdvertisedLimits(
        limiter,
        headerLookup({ "x-ratelimit-limit": "3" }),
      ),
    ).toBeUndefined();
    // (c) equal to what is in force.
    expect(
      adoptAdvertisedLimits(
        limiter,
        headerLookup({
          "x-rate-limit-limit": "5",
          "x-rate-limit-interval": "2s",
        }),
      ),
    ).toBeUndefined();
    expect(limiter.applied).toStrictEqual([]);
  });

  it("is a no-op for a limiter missing either half of the seam", () => {
    const tightening = headerLookup({ "x-ratelimit-limit": "1" });

    // Neither member — the stub every pre-P1-T26 assertion in this file uses.
    expect(adoptAdvertisedLimits(createStubLimiter(), tightening)).toBe(
      undefined,
    );

    // `reconfigure` but no `currentConfig`. There is no policy to compare the
    // header against, and inventing one to compare against is what rule 4
    // forbids — so the call must not happen at all, not merely happen to be a
    // no-op for this particular header.
    let calls = 0;
    expect(
      adoptAdvertisedLimits(
        {
          reconfigure() {
            calls += 1;
          },
        },
        tightening,
      ),
    ).toBeUndefined();
    expect(calls).toBe(0);

    // `currentConfig` but no `reconfigure`: nothing to call, and it must not
    // throw trying.
    expect(
      adoptAdvertisedLimits({ currentConfig: NCBI_NO_KEY }, tightening),
    ).toBeUndefined();
  });

  it("adopts Crossref's measured 3 → 1 concurrency drop, downwards only", () => {
    // `docs/02` §5.1, verified live: polite pool `x-concurrency-limit: 3`,
    // public pool `1`. The static row this is applied to is §7.3's Crossref
    // cell, 2/interval with maxConcurrent 3.
    const limiter = recordingLimiter({
      ratePerSecond: 2,
      burst: 2,
      maxConcurrent: 3,
    });

    expect(
      adoptAdvertisedLimits(
        limiter,
        headerLookup({
          "x-rate-limit-limit": "1",
          "x-rate-limit-interval": "1s",
          "x-concurrency-limit": "1",
          "x-api-pool": "public-array",
        }),
      ),
    ).toStrictEqual({ ratePerSecond: 1, burst: 2, maxConcurrent: 1 });
    // Back in the polite pool, nothing is raised again: see the "only
    // downwards" rule and the gap reported against this card.
    expect(
      adoptAdvertisedLimits(
        limiter,
        headerLookup({
          "x-rate-limit-limit": "3",
          "x-rate-limit-interval": "1s",
          "x-concurrency-limit": "3",
        }),
      ),
    ).toBeUndefined();
    expect(limiter.applied).toHaveLength(1);
  });
});

/* ------------------------------------------------ the LLM hosts' budget */

/**
 * `P3-T05`. `docs/07` §7.3's LLM/TTS row, parsed out of the document, so the
 * three cells and {@link LLM_RETRY_BUDGET} cannot drift apart — the same
 * guarantee `test/unit/core/backoff.test.ts` gives every literature row. That
 * file matches rows by a backticked host name, and the LLM row has none (its
 * Host cell is "LLM/TTS hosts"), so it is read here by its own label.
 */
function llmRowCells(): Readonly<Record<string, string>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(
    resolve(here, "../../../docs/07-architecture-and-data-model.md"),
    "utf8",
  );
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith("### 7.3 "));
  const header = lines.findIndex(
    (line, index) => index > start && line.startsWith("| Host |"),
  );
  const row = lines.find(
    (line, index) => index > header && line.startsWith("| LLM/TTS hosts |"),
  );
  if (start < 0 || header < 0 || row === undefined) {
    throw new Error("docs/07 §7.3 has no LLM/TTS row under its policy table");
  }
  const cellsOf = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const columns = cellsOf(lines[header] ?? "");
  const cells = cellsOf(row);
  if (cells.length !== columns.length) {
    throw new Error(
      `§7.3's LLM/TTS row has ${cells.length} cells against ${columns.length} columns`,
    );
  }
  return Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ""]));
}

/** The leading figure of a cell such as `60 000 ms (LLM)` or `5 (LLM)`. */
function leadingNumber(cell: string | undefined): number {
  const match = /^([\d ]+)/.exec(cell ?? "");
  if (match?.[1] === undefined) {
    throw new Error(`not a number: ${JSON.stringify(cell)}`);
  }
  return Number(match[1].replace(/ /g, ""));
}

describe("the LLM hosts' retry budget and attempt timeout (P3-T05, item 240)", () => {
  it("transcribes docs/07 §7.3's LLM/TTS row: base 1000 ms, cap 60 000 ms, 5 attempts", () => {
    const cells = llmRowCells();
    expect(cells["Retry base"]).toMatch(/ms \(LLM\)$/);
    expect(cells["Retry cap"]).toMatch(/ms \(LLM\)$/);
    expect(LLM_RETRY_BUDGET.baseMs).toBe(leadingNumber(cells["Retry base"]));
    expect(LLM_RETRY_BUDGET.capMs).toBe(leadingNumber(cells["Retry cap"]));
    expect(LLM_RETRY_BUDGET.maxAttempts).toBe(
      leadingNumber(cells["Attempt cap"]),
    );
    expect(LLM_RETRY_BUDGET).toStrictEqual({
      baseMs: 1000,
      capMs: 60_000,
      maxAttempts: 5,
    });
    expect(Object.isFrozen(LLM_RETRY_BUDGET)).toBe(true);
  });

  it("is accepted by the shipped shapes, and its 60 s cap does not bind at five attempts", () => {
    expect(() => createBackoff(LLM_RETRY_BUDGET)).not.toThrow();
    const walk = (random: () => number): number[] => {
      const policy = retryPolicyFromBudget(LLM_RETRY_BUDGET, random);
      const waits: number[] = [];
      let prev = 0;
      for (let attempt = 1; attempt < policy.maxAttempts; attempt += 1) {
        prev = policy.nextDelayMs(prev, attempt);
        waits.push(prev);
      }
      return waits;
    };
    // Through withRetry's seam (prevDelayMs = 0 first): four waits.
    expect(walk(() => 1)).toEqual([1000, 3000, 9000, 27_000]);
    expect(walk(() => 0)).toEqual([1000, 1000, 1000, 1000]);
    expect(Math.max(...walk(() => 1))).toBeLessThan(LLM_RETRY_BUDGET.capMs);
  });

  it("lets one LLM attempt wait 3 minutes, three times the literature hosts' 60 s", () => {
    expect(LLM_ATTEMPT_TIMEOUT_MS).toBe(180_000);
    expect(LLM_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(REQUEST_BUDGET_MS);
  });

  it("does not retry an LLM attempt that failed after the 90 s request budget", async () => {
    // The budget limits when a retry may *start*; it never cuts an attempt.
    // A 3-minute attempt that ends in a 503 after 100 s is therefore final.
    const clock = createManualClock();
    let attempts = 0;
    const promise = withRetry(
      () => {
        attempts += 1;
        clock.advance(100_000);
        return Promise.reject(new UpstreamServerError(503, "slow refusal"));
      },
      {
        policy: retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
        clock,
        budget: { totalMs: REQUEST_BUDGET_MS },
      },
    );
    await expect(promise).rejects.toBeInstanceOf(UpstreamServerError);
    expect(attempts).toBe(1);
  });

  it("uses all five attempts when the failures are quick, inside the 90 s budget", async () => {
    const clock = createManualClock();
    const startedAt: number[] = [];
    const start = clock.now();
    const promise = withRetry(
      () => {
        startedAt.push(clock.now() - start);
        return Promise.reject(new UpstreamServerError(503, "quick refusal"));
      },
      {
        policy: retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 1),
        clock,
        budget: { totalMs: REQUEST_BUDGET_MS },
      },
    );
    const settled = promise.catch((error: unknown) => error);
    for (const wait of [1000, 3000, 9000, 27_000]) {
      for (let i = 0; i < 5 && clock.pending === 0; i += 1) {
        await Promise.resolve();
      }
      clock.advance(wait);
    }
    expect(await settled).toBeInstanceOf(UpstreamServerError);
    expect(startedAt).toEqual([0, 1000, 4000, 13_000, 40_000]);
  });
});

/* ------------------------------------------------- the LLM hosts' rows */

/** The four providers, in `HOST_POLICIES` order. */
const LLM_PROVIDERS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
];

describe("the four LLM hosts' HOST_POLICIES rows (owner, 2026-10-21, item 260)", () => {
  it("ships one row per LLM host with docs/07 §7.3's LLM/TTS rate, burst and max concurrent cells", () => {
    const cells = llmRowCells();
    // The "(LLM)" marker says the figure is the LLM hosts' and not a TTS
    // one (TTS is undecided), as on the three retry cells.
    expect(cells.Rate).toMatch(/^[\d.]+\/s \(LLM\)$/);
    expect(cells["Max concurrent"]).toMatch(/ \(LLM\)$/);
    const fromDocument: RateLimiterConfig = {
      ratePerSecond: leadingNumber(cells.Rate),
      burst: leadingNumber(cells.Burst),
      maxConcurrent: leadingNumber(cells["Max concurrent"]),
    };
    expect(fromDocument).toStrictEqual({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 3,
    });
    const llmRows = HOST_POLICIES.filter(
      (row) => row.retry === LLM_RETRY_BUDGET,
    );
    expect(llmRows.map((row) => row.host)).toEqual(
      LLM_PROVIDERS.map((id) => LLM_HOSTS[id]),
    );
    for (const row of llmRows) {
      // Exactly the four members the decision names: no key mode, no
      // presence flag, not header-driven.
      expect(row, row.host).toStrictEqual({
        host: row.host,
        withoutKey: fromDocument,
        retry: LLM_RETRY_BUDGET,
      });
    }
  });

  it("takes each host from the provider's documented base URL, and agrees with each adapter's rateLimitKey", () => {
    const resolver = createBaseUrlResolver({ override: () => "" });
    for (const id of LLM_PROVIDERS) {
      expect(LLM_HOSTS[id], id).toBe(new URL(DEFAULT_BASE_URLS[id]).host);
      expect(LLM_HOSTS[id], id).toBe(resolver.effectiveHost(id));
    }
    expect(LLM_HOSTS.anthropic).toBe(ANTHROPIC_HOST);
    expect(LLM_HOSTS.gemini).toBe(GEMINI_HOST);
    expect(LLM_HOSTS.openai).toBe(OPENAI_RATE_LIMIT_KEY);
    // OpenRouter's key is a getter over the resolver (a gateway override
    // moves it), so it is read off a constructed adapter.
    const openRouter = createOpenRouterProvider({
      secrets: undefined,
      baseUrls: resolver,
    });
    expect(LLM_HOSTS.openrouter).toBe(openRouter.rateLimitKey);
    expect(Object.isFrozen(LLM_HOSTS)).toBe(true);
  });

  it("gives each LLM host a bucket of its own that admits one request, then the next after one second", async () => {
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    const limiters = LLM_PROVIDERS.map((id) =>
      registry.limiterFor(LLM_HOSTS[id]),
    );
    expect(new Set(limiters).size).toBe(4);
    for (const limiter of limiters) {
      expect(limiter).toBeInstanceOf(TokenBucket);
      expect((limiter as TokenBucket).currentConfig).toStrictEqual({
        ratePerSecond: 1,
        burst: 1,
        maxConcurrent: 3,
      });
    }

    // Burst 1: the first request goes at once, the second waits for the
    // token that refills at 1/s. Another LLM host's bucket is not touched.
    const openRouter = limiters[0] as TokenBucket;
    const openAi = limiters[1] as TokenBucket;
    await openRouter.acquire();
    let second = false;
    const pending = openRouter.acquire().then(() => {
      second = true;
    });
    for (let i = 0; i < 5 && clock.pending === 0; i += 1) {
      await Promise.resolve();
    }
    await openAi.acquire();
    clock.advance(999);
    await Promise.resolve();
    expect(second).toBe(false);
    clock.advance(1);
    await pending;
    expect(second).toBe(true);
  });
});

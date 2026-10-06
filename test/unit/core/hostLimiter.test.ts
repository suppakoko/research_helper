import { describe, expect, it } from "vitest";

import { type RateLimiterPort } from "../../../src/core/http/client";
import {
  adoptAdvertisedLimits,
  parseAdvertisedLimits,
} from "../../../src/core/rateLimit/hostLimiter";
import { type RateLimiterConfig } from "../../../src/core/rateLimit/tokenBucket";

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

/**
 * The process-wide per-host limiter registry, and `docs/07` §7.3's policy table.
 *
 * **Scope.** `P1-T04`. The registry and the **one** row Phase 1 needs. §7.3's
 * table has seven rows; `P1-T04` step 4 says "Phase 1 registers only the
 * `eutils.ncbi.nlm.nih.gov` row; leave the table shape ready for Phase 2 rows",
 * and `plan/03-phase-2-multi-source-dedup.md` has five cards that each `modify`
 * this file to add one. The absent rows are listed at {@link HOST_POLICIES} so
 * that adding one is filling a named blank rather than a design decision.
 *
 * **Authority.** Every number in {@link HOST_POLICIES} is
 * `docs/07-architecture-and-data-model.md` §7.3's policy table, transcribed.
 * `plan/README.md` §5 rule 4 — "Never hardcode a model ID, price, or rate limit
 * … rate limits from `docs/07` §7.3" — makes this file the only place in the
 * product where a rate number may appear, and `docs/02` §2.4 carries a `NOT
 * AUTHORITATIVE` banner over its own copy of the same table for the same reason.
 * §7.3's values sit **deliberately below** the published upstream figures for
 * clock-skew headroom: NCBI documents 3/s unkeyed and 10/s keyed
 * (`docs/02` §3.1, NBK25497) and we enforce 2.5/s and 8/s.
 *
 * ## One bucket per host, for the whole process
 *
 * §7.3: "One `TokenBucket` per **host**, shared by every job — not per adapter
 * instance and not per job, or two concurrent jobs would each get a full budget
 * and together exceed the policy." That is the only reason this module holds
 * mutable module state: a registry created per caller would be per-job budgets
 * again under a different name. {@link installHostLimiters} is called once by
 * `src/bootstrap/`, {@link getHostLimiters} everywhere else, and
 * {@link resetHostLimiters} exists so a test is not talking to another test's
 * buckets.
 *
 * ## The with-key switch, and why it is a raw `PrefStore`
 *
 * `P1-T04` step 5: read `ncbi.keyPresent` at registry construction and
 * `reconfigure()` when it changes. `src/prefs/index.ts` is the typed reader, but
 * §2.3 and `eslint.config.js`'s `research-helper/layering/core` override forbid
 * `core/` importing `prefs/` — so the registry takes `src/core/config.ts`'s
 * `PrefStore` port, whose own documentation names `"ncbi.keyPresent"` as an
 * example of the branch-relative keys it is read with. Two consequences are
 * deliberate and both are duplication this layer cannot avoid:
 *
 * 1. The key *string* appears here as well as in `src/prefs/keys.ts`. A test
 *    asserts the two agree, from `test/` — the only place both may be imported.
 * 2. The boolean coercion is repeated in {@link readFlag}, because
 *    `src/prefs/index.ts`'s `coerce` — which exists precisely because the pane's
 *    `preference=` binding stringifies values on the way out (`docs/08` §7.2) —
 *    is out of reach. It is three lines and it is the narrow case: one boolean.
 *
 * ## Unregistered hosts get no limiter, on purpose
 *
 * {@link HostLimiterRegistry.limiterFor} returns `undefined` for a host with no
 * policy row rather than inventing a conservative default, because a default
 * *is* a rate number and `P1-T04`'s **Do NOT** forbids inventing one. In Phase 1
 * only NCBI is reached over the network, so the branch is unexercised in
 * practice; it becomes load-bearing as Phase 2's rows land, and what the HTTP
 * client should do when it is `undefined` is a question the plan has not
 * answered.
 */

import type { Clock } from "../clock";
import type { PrefObserverHandle, PrefScalar, PrefStore } from "../config";
import { ConfigurationError } from "../errors";

import {
  TokenBucket,
  type RateLimiter,
  type RateLimiterConfig,
} from "./tokenBucket";

// ---------------------------------------------------------------------------
// 1. The policy table — docs/07 §7.3
// ---------------------------------------------------------------------------

/**
 * One host's enforcement policy.
 *
 * `withKey` is separate from `withoutKey` rather than being a rate multiplier
 * because §7.3's two-mode hosts do not scale uniformly: NCBI's burst and
 * concurrency are the same in both modes while the rate more than triples, and
 * Semantic Scholar's rate is *identical* in both modes even though a key changes
 * the guarantee behind it ("unauthenticated requests draw on a shared 1000 RPS
 * pool … while an introductory API key grants a guaranteed but lower 1 RPS").
 */
export interface HostRateLimitPolicy {
  /** The host, exactly as it appears in a URL's authority. */
  readonly host: string;
  /** The policy when no API key for this host is present. */
  readonly withoutKey: RateLimiterConfig;
  /**
   * The policy when one is. Absent where a key changes nothing — which is a
   * documented case, not an oversight: §7.3 gives Semantic Scholar "0.9/s in
   * both modes".
   */
  readonly withKey?: RateLimiterConfig;
  /**
   * The branch-relative `*.keyPresent` preference that selects between the two
   * (`docs/07` §8.5, "Non-secret key-presence flags"). Absent when `withKey` is.
   *
   * It is a *presence flag*, never a key: decision D5, and `plan/README.md` §5
   * rule 5. Nothing in `src/core/rateLimit/` ever sees a credential.
   */
  readonly keyPresencePref?: string;
}

/** The host `P1-T07`'s PubMed adapter talks to. */
export const NCBI_HOST = "eutils.ncbi.nlm.nih.gov";

/** The preference that raises the NCBI budget (`docs/07` §8.5). */
export const NCBI_KEY_PRESENT_PREF = "ncbi.keyPresent";

/**
 * `docs/07` §7.3's policy table, as far as Phase 1 needs it.
 *
 * **NCBI, the one row that ships now.** 2.5/s without a key and 8/s with one,
 * burst 1, max concurrent 3. `tool` and `email` are always sent and always carry
 * the *maintainer's* address on this host — decision D10, because NBK25497
 * demands the developer's, "not that of a third-party end user" — which is
 * `src/core/http/userAgent.ts`'s business (`P1-T05`), not this file's.
 *
 * **Off-peak scheduling, carried forward from §7.3 as `P1-T04`'s Notes require.**
 * NCBI's own guidance is that large jobs run "either weekends or between 9:00 PM
 * and 5:00 AM Eastern time during weekdays", and that "failure to comply with
 * this policy may result in an IP address being blocked from accessing NCBI"
 * (`docs/02` §3.1). Phase 1 schedules nothing — there is no scheduler and no
 * time-of-day input to this module — but Phase 2's fan-out across seven hosts is
 * where it starts to matter, so the guidance stays recorded beside the row it
 * belongs to.
 *
 * **`X-Ratelimit-Limit` / `X-Ratelimit-Remaining` are live and unread.**
 * `docs/02` §3.1 verified NCBI returning both, and `P1-T04`'s "Read first" says
 * the governor "should read rather than assume" them. Reading a response header
 * requires a response, which lives in `src/core/http/` — a path this card may not
 * touch. {@link HostLimiterRegistry.limiterFor} plus
 * {@link ./tokenBucket.RateLimiter.reconfigure} is the seam that will
 * carry it; the same seam Crossref's `x-rate-limit-limit` /
 * `x-rate-limit-interval` needs, which §7.3 says "`reconfigure()` is called from
 * those headers on every response".
 *
 * **The five rows Phase 2 adds**, each from §7.3 verbatim and each with the card
 * that adds it: `www.ebi.ac.uk` (Europe PMC, `P2-T03`), `api.crossref.org`,
 * `api.semanticscholar.org`, `export.arxiv.org` — which needs
 * `minIntervalMs: 3000` and `maxConcurrent: 1`, aggregated across every machine
 * under our control — and `api.biorxiv.org`. `api.openalex.org` gets **no** row:
 * decision D2 puts OpenAlex out of v1 and one of `plan/03`'s cards greps this
 * file to prove it. The LLM and TTS hosts are Phase 3's and Phase 5's and are driven from
 * provider prefs rather than from a static row.
 */
export const HOST_POLICIES: readonly HostRateLimitPolicy[] = [
  {
    host: NCBI_HOST,
    withoutKey: { ratePerSecond: 2.5, burst: 1, maxConcurrent: 3 },
    withKey: { ratePerSecond: 8, burst: 1, maxConcurrent: 3 },
    keyPresencePref: NCBI_KEY_PRESENT_PREF,
  },
];

// ---------------------------------------------------------------------------
// 2. The registry
// ---------------------------------------------------------------------------

/** Everything the registry needs from outside `core/`. */
export interface HostLimiterRegistryOptions {
  /** The injected clock every bucket paces against (`src/core/clock.ts`). */
  readonly clock: Clock;
  /**
   * Raw preference access, for the `*.keyPresent` flags. Omitted — as in a unit
   * test of an unkeyed path — every host runs on its `withoutKey` policy.
   */
  readonly prefs?: PrefStore;
  /**
   * The rows to register. Defaults to {@link HOST_POLICIES}; overridden only by
   * tests, which must be able to exercise a two-row registry without waiting for
   * Phase 2.
   */
  readonly policies?: readonly HostRateLimitPolicy[];
}

export interface HostLimiterRegistry {
  /** Every host with a policy row, in table order. */
  readonly hosts: readonly string[];
  /**
   * The one limiter for `host`, or `undefined` if no row declares it.
   *
   * Always the same object for the same host — that identity *is* §7.3's "shared
   * by every job".
   */
  limiterFor(host: string): RateLimiter | undefined;
  /** `host`'s policy row, including the `maxConcurrent` the bucket cannot enforce. */
  policyFor(host: string): HostRateLimitPolicy | undefined;
  /**
   * Re-read every key-presence flag and `reconfigure()` the buckets whose mode
   * changed. Idempotent, and a no-op for a bucket already on the right config,
   * so calling it on an unrelated preference change costs nothing.
   *
   * @returns the hosts whose configuration actually changed
   */
  refresh(): readonly string[];
  /**
   * The preference-observer handles this registry registered, for the composition
   * root to hand to a `Scope`.
   *
   * Opaque by contract (`src/core/config.ts`): the Zotero implementation returns
   * `src/zotero/registrations.ts`'s `ScopedRegistration` so that no registration
   * can exist without the teardown that undoes it (FR-56, `docs/01` §12 gotcha
   * 10), and `core/` may not name that type. Empty when no `PrefStore` was
   * supplied.
   */
  readonly observers: readonly PrefObserverHandle[];
}

/**
 * Coerce a raw preference value to a boolean.
 *
 * `"true"` is accepted as well as `true` for the reason `docs/07` §8.5.1 gives
 * for numbers and `src/prefs/index.ts` implements once: the prefs pane's
 * `preference=` binding applies `String(value)` on the way out (`docs/08` §7.2),
 * so a flag a user's UI has touched can read back as a string. Anything else —
 * absent, wrong type, a throwing platform — is `false`, which is the
 * §8.5 default for every `*.keyPresent` row and the safe side of this particular
 * question: a key wrongly believed present would pace at 8/s against NCBI's
 * unkeyed 3/s ceiling and earn an IP block.
 */
function readFlag(prefs: PrefStore | undefined, key: string): boolean {
  if (prefs === undefined) return false;
  let raw: PrefScalar | undefined;
  try {
    raw = prefs.get(key);
  } catch {
    return false;
  }
  return raw === true || raw === "true";
}

/** The config a policy is in force under, given its key-presence flag. */
function configFor(
  policy: HostRateLimitPolicy,
  prefs: PrefStore | undefined,
): RateLimiterConfig {
  if (policy.withKey === undefined || policy.keyPresencePref === undefined) {
    return policy.withoutKey;
  }
  return readFlag(prefs, policy.keyPresencePref)
    ? policy.withKey
    : policy.withoutKey;
}

/**
 * Build a registry over `policies`, one {@link TokenBucket} per row.
 *
 * Each row's key-presence flag is read **now** (`P1-T04` step 5, "at registry
 * construction") and observed, so a key entered while Zotero is running raises
 * the budget without a restart and without dropping whatever is queued —
 * {@link TokenBucket.reconfigure} keeps its waiters.
 *
 * @param options - the clock, optionally a `PrefStore`, optionally the rows
 * @returns the registry; hand {@link HostLimiterRegistry.observers} to a `Scope`
 */
export function createHostLimiterRegistry(
  options: HostLimiterRegistryOptions,
): HostLimiterRegistry {
  const { clock, prefs } = options;
  const policies = options.policies ?? HOST_POLICIES;

  const buckets = new Map<string, TokenBucket>();
  const rows = new Map<string, HostRateLimitPolicy>();
  const applied = new Map<string, RateLimiterConfig>();
  const observers: PrefObserverHandle[] = [];

  for (const policy of policies) {
    if (rows.has(policy.host)) {
      throw new ConfigurationError(
        `duplicate rate-limit policy for ${policy.host}: docs/07 §7.3 declares ` +
          `one row per host and one TokenBucket per host.`,
        { host: policy.host },
      );
    }
    const config = configFor(policy, prefs);
    rows.set(policy.host, policy);
    applied.set(policy.host, config);
    buckets.set(policy.host, new TokenBucket(policy.host, config, clock));
  }

  const registry: HostLimiterRegistry = {
    hosts: policies.map((p) => p.host),
    limiterFor(host: string): RateLimiter | undefined {
      return buckets.get(host);
    },
    policyFor(host: string): HostRateLimitPolicy | undefined {
      return rows.get(host);
    },
    refresh(): readonly string[] {
      const changed: string[] = [];
      for (const [host, policy] of rows) {
        const wanted = configFor(policy, prefs);
        // Identity, not deep equality: `configFor` returns one of the row's two
        // frozen literals, so a change of mode is a change of object.
        if (applied.get(host) === wanted) continue;
        applied.set(host, wanted);
        buckets.get(host)?.reconfigure(wanted);
        changed.push(host);
      }
      return changed;
    },
    observers,
  };

  if (prefs !== undefined) {
    for (const policy of policies) {
      const { keyPresencePref } = policy;
      if (keyPresencePref === undefined) continue;
      observers.push(
        prefs.observe(keyPresencePref, () => {
          registry.refresh();
        }),
      );
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// 3. The process-wide holder
// ---------------------------------------------------------------------------

let installed: HostLimiterRegistry | undefined;

/**
 * Install the process-wide registry. Called once, from `src/bootstrap/`.
 *
 * Replacing a live registry would hand out fresh, full buckets while jobs were
 * still pacing against the old ones — §7.3's "two concurrent jobs would each get
 * a full budget" by another route — so a second install is refused.
 * {@link resetHostLimiters} is the way back, and it is for tests.
 *
 * @param optionsOrRegistry - construction options, or a registry already built
 * @returns the installed registry
 * @throws ConfigurationError if one is already installed
 */
export function installHostLimiters(
  optionsOrRegistry: HostLimiterRegistryOptions | HostLimiterRegistry,
): HostLimiterRegistry {
  if (installed !== undefined) {
    throw new ConfigurationError(
      "host rate limiters are already installed; docs/07 §7.3 requires one " +
        "TokenBucket per host for the whole process. Call " +
        "resetHostLimiters() first if this is a test.",
    );
  }
  installed =
    "limiterFor" in optionsOrRegistry
      ? optionsOrRegistry
      : createHostLimiterRegistry(optionsOrRegistry);
  return installed;
}

/**
 * The process-wide registry.
 *
 * **Throws when none is installed**, unlike `getPref`, which falls back to a
 * default. The asymmetry is deliberate: a missing preference degrades to a
 * documented value, whereas a missing limiter would silently unpace every
 * outbound request — the failure `docs/02` §3.1 says ends in "an IP address being
 * blocked from accessing NCBI". Loud at startup beats silent in the field.
 *
 * @throws ConfigurationError if {@link installHostLimiters} has not run
 */
export function getHostLimiters(): HostLimiterRegistry {
  if (installed === undefined) {
    throw new ConfigurationError(
      "no host rate limiters installed: src/bootstrap/ must call " +
        "installHostLimiters() before any outbound request.",
    );
  }
  return installed;
}

/** The installed registry, or `undefined`. Never throws. */
export function peekHostLimiters(): HostLimiterRegistry | undefined {
  return installed;
}

/**
 * Detach the process-wide registry.
 *
 * For tests, and for the plugin's own shutdown path. It does **not** tear down
 * {@link HostLimiterRegistry.observers} — those are the composition root's, held
 * by a `Scope`, and undoing a registration from here would be the unpaired
 * teardown FR-56 exists to prevent.
 */
export function resetHostLimiters(): void {
  installed = undefined;
}

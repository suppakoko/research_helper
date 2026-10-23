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

import type { ProviderId } from "../../model/ids";
import type { Clock } from "../clock";
import type { PrefObserverHandle, PrefScalar, PrefStore } from "../config";
import { ConfigurationError } from "../errors";

import type { RetryBudget } from "./backoff";
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
  /**
   * §7.3's retry budget for this host — `base`, `cap` and the per-host attempt
   * cap — as the three columns added to §7.3's policy table on 2026-10-07
   * (`P1-T28`). The source of each value is named in §7.3 immediately below the
   * table, and `plan/README.md` §5 rule 4 is why they are here and nowhere else.
   *
   * The budget does **not** vary with the key-presence flag, which is why it sits
   * on the row rather than inside {@link RateLimiterConfig}: a key raises how
   * fast we may ask, not how patiently we wait after a refusal.
   *
   * **Optional, and that is a compatibility decision rather than a design one.**
   * A required member would make every existing `policies:` literal a typecheck
   * error, including the two-row one in `test/unit/core/tokenBucket.test.ts`, a
   * file `P1-T28`'s `Files` list does not name — so the member is added rather
   * than imposed, which is `plan/README.md` §4's "extend rather than replace when
   * an importer is outside your `Files`" applied to a type instead of a module.
   * Absent means exactly what an absent `RetryPolicy` already means to
   * `src/core/http/client.ts`: one attempt and no retry. That is documented
   * behaviour, not a silent default. `test/unit/core/backoff.test.ts` asserts that
   * every row in {@link HOST_POLICIES} carries one, so a Phase 2 row cannot ship
   * without its own three values.
   */
  readonly retry?: RetryBudget;
  /**
   * §7.3 marks this row **header-driven**: the host advertises its current
   * limits on every response (`x-rate-limit-limit`, `x-rate-limit-interval`,
   * `x-concurrency-limit`) and the static cells are only the **starting**
   * point. For such a row the adapter calls {@link adoptHeaderDrivenLimits},
   * which adopts the advertised values in **both** directions; for every other
   * row only the HTTP client's {@link adoptAdvertisedLimits} runs, which
   * tightens and never raises. Absent means `false`. `P2-T04` added it for
   * `api.crossref.org`, the one row §7.3 writes this way.
   */
  readonly headerDriven?: boolean;
}

/** The host `P1-T07`'s PubMed adapter talks to. */
export const NCBI_HOST = "eutils.ncbi.nlm.nih.gov";

/** The preference that raises the NCBI budget (`docs/07` §8.5). */
export const NCBI_KEY_PRESENT_PREF = "ncbi.keyPresent";

/**
 * The host `P2-T03`'s Europe PMC adapter talks to — the authority of
 * `https://www.ebi.ac.uk/europepmc/webservices/rest/` (`docs/02` §4.1).
 * Imported by `src/sources/europepmc/` rather than respelled, as
 * {@link NCBI_HOST} is by the PubMed adapter, so §7.3's one-bucket-per-host
 * rule stays mechanical.
 */
export const EBI_HOST = "www.ebi.ac.uk";

/**
 * The host `P2-T04`'s Crossref adapter talks to — the authority of
 * `https://api.crossref.org` (`docs/02` §5.1). Imported by
 * `src/sources/crossref/` rather than respelled, for the reason
 * {@link EBI_HOST} gives.
 */
export const CROSSREF_HOST = "api.crossref.org";

/**
 * The host `P2-T06`'s arXiv adapter talks to — the authority of
 * `https://export.arxiv.org/api/query` (`docs/02` §7.1; `https://` only, the
 * plain scheme answers 301 with an empty body). Imported by
 * `src/sources/arxiv/` rather than respelled, for the reason {@link EBI_HOST}
 * gives.
 */
export const ARXIV_HOST = "export.arxiv.org";

/**
 * The host `P2-T05`'s Semantic Scholar adapter talks to — the authority of
 * `https://api.semanticscholar.org/graph/v1` (`docs/02` §6.1). Imported by
 * `src/sources/semanticscholar/` rather than respelled, for the reason
 * {@link EBI_HOST} gives.
 */
export const SEMANTICSCHOLAR_HOST = "api.semanticscholar.org";

/**
 * The host `P2-T07`'s bioRxiv / medRxiv adapter talks to — the authority of
 * `https://api.biorxiv.org` (`docs/02` §8.1). **One host, two `SourceId`s**:
 * `biorxiv` and `medrxiv` are two adapter objects over one implementation
 * (`docs/07` §2.2, "bioRxiv + medRxiv share one adapter, two servers"), both
 * with this `rateLimitKey`, so they draw on one bucket and together never
 * exceed the row below. Imported by `src/sources/biorxiv/` rather than
 * respelled, for the reason {@link EBI_HOST} gives.
 */
export const BIORXIV_HOST = "api.biorxiv.org";

/**
 * The host of the NCBI ID Converter — the authority of
 * `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/` (`docs/02`
 * §3.7), which resolves a PMCID-only record before Strategy B's lookup
 * (owner, 2026-10-19, `plan/00` §6 item 214). Imported by
 * `src/sources/pubmed/idConverter.ts` rather than respelled, for the reason
 * {@link EBI_HOST} gives.
 */
export const PMC_IDCONV_HOST = "pmc.ncbi.nlm.nih.gov";

/**
 * The four LLM hosts, by provider: each the authority of the provider's
 * documented base URL (`DEFAULT_BASE_URLS` in `src/llm/shared/baseUrl.ts`;
 * `docs/03` §2.1, §3.1, §4.1, §5.1).
 *
 * **Written out, not derived**, because `core/` may import only `model/`
 * (`docs/07` §2.3, `eslint.config.js`) and so cannot read `src/llm/`.
 * `test/unit/core/hostLimiter.test.ts` asserts that each equals the host of
 * that base URL and the adapter's own `rateLimitKey`, so a base-URL change on
 * either side fails a test rather than leaving a host unpaced.
 */
export const LLM_HOSTS: Readonly<Record<ProviderId, string>> = Object.freeze({
  openrouter: "openrouter.ai",
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  gemini: "generativelanguage.googleapis.com",
});

/**
 * The one retry budget every LLM host shares: base 1000 ms, cap 60 000 ms,
 * attempt cap 5 — `docs/07` §7.3's LLM/TTS row, whose three retry cells the
 * owner filled on 2026-10-20 (`plan/00` §6 item 240; `P3-T05`).
 *
 * **One budget, carried by every LLM row.** The four LLM rows in
 * {@link HOST_POLICIES} (owner, 2026-10-21, `plan/00` §6 item 260) each carry
 * `retry: LLM_RETRY_BUDGET`, the object itself, so the numbers are written
 * once. Nothing else is needed to make them work: `createRetryFor` in
 * `src/bootstrap/container.ts` already turns any row's `retry` member into a
 * policy for the one shipped `withRetry` (`src/core/http/retry.ts`), over the
 * one shipped jitter shape, `decorrelatedJitter` in `./backoff.ts`. Declared
 * above {@link HOST_POLICIES} because the table reads it while the module
 * loads. *(Corrected 2026-10-21, item 260: this paragraph said the adapter
 * cards "each add" their row, which none could until the rate was decided.)*
 *
 * **Why decorrelated jitter, and why these numbers.** `docs/03` §11.6 sketched
 * a full-jitter loop with `maxAttempts = 5, baseMs = 1000, capMs = 60_000`.
 * The owner kept the numbers and dropped the shape, so the tree has one jitter
 * and one loop. `maxAttempts` counts the first attempt
 * ({@link ./backoff.RetryBudget.maxAttempts}), so this allows four retries.
 * Through `withRetry`, which enters the first retry with `prevDelayMs = 0`, the
 * waits are 1 s, then at most 3 s, 9 s and 27 s: 40 s of silent waiting at
 * the longest. The 60 s cap therefore does not bind at five attempts; a sent
 * `Retry-After` is the wait itself and is not capped, as on every row.
 *
 * **What it does not change.** A timeout is still not retried (item 230:
 * `isRetriedAutomatically`), and `REQUEST_BUDGET_MS` (90 s, item 233) still
 * decides whether a retry may start — see {@link LLM_ATTEMPT_TIMEOUT_MS} for
 * how the two meet. The batch budget (§11.6's "e.g. 30 min") is not here: it
 * is a pipeline-level limit for `P3-T17`.
 */
export const LLM_RETRY_BUDGET: RetryBudget = Object.freeze({
  baseMs: 1000,
  capMs: 60_000,
  maxAttempts: 5,
});

/**
 * `docs/07` §7.3's policy table, as far as Phase 1 needs it.
 *
 * **NCBI, the one row that ships now.** 2.5/s without a key and 8/s with one,
 * burst 1, max concurrent 3. `tool` and `email` are always sent and always carry
 * the *maintainer's* address on this host — decision D10, because NBK25497
 * demands the developer's, "not that of a third-party end user" — which is
 * `src/core/http/userAgent.ts`'s business (`P1-T05`), not this file's.
 *
 * **The retry budget, settled 2026-10-07 (`P1-T28`).** `base` 1000 ms, `cap`
 * 30 000 ms, attempt cap **3** — transcribed from the three columns that card
 * added to §7.3's table, with the source of each value named in §7.3 under the
 * table. The attempt cap is **total attempts including the first**
 * ({@link ./backoff.RetryBudget.maxAttempts}), so it allows two retries and two
 * waits. Through the seam `src/core/http/retry.ts` drives — `withRetry` enters
 * the first retry with `prevDelayMs = 0`, so the first wait is exactly `base` —
 * the longest a failing request can wait before the job fails is **4 s**
 * (1 s + 3 s). `createBackoff` in this directory seeds `prev = base` instead and
 * would give 3 s + 9 s = 12 s for the same row; §7.3 records that divergence and
 * no shipped code calls `createBackoff`.
 *
 * **The client consumes this field since 2026-10-20** (`plan/00` §6 item 228).
 * `src/core/http/client.ts` takes the policy through `retryFor`, and
 * `src/bootstrap/container.ts`'s `createRetryFor` builds it from every row's
 * `retry` cells, for a host that also has a limiter; a host with no row makes
 * one attempt. A 429, a 5xx and an offline or network failure are retried up to
 * the row's attempt cap; **a timeout is not retried** (item 230, owner,
 * 2026-10-20: `src/core/http/retry.ts`'s `isRetriedAutomatically`). Until
 * 2026-10-20 nothing supplied `retryFor` and every host made exactly one attempt.
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
 * **`X-Ratelimit-Limit` is read, as of `P1-T26`.** `docs/02` §3.1 verified NCBI
 * returning it and `X-Ratelimit-Remaining`, and `P1-T04`'s "Read first" says the
 * governor "should read rather than assume" them. Reading a response header
 * requires a response, which lives in `src/core/http/` — a path `P1-T04` could
 * not touch. {@link adoptAdvertisedLimits} is now that seam: §3 of this file maps
 * the headers both measured hosts send onto a {@link RateLimiterConfig} and
 * `src/core/http/client.ts` calls it on every response. `X-Ratelimit-Remaining`
 * drives **nothing** — see {@link parseAdvertisedLimits} for why a remaining
 * *count* cannot become a rate.
 *
 * **The five rows Phase 2 adds**, each from §7.3 verbatim and each with the card
 * that adds it: `www.ebi.ac.uk` (Europe PMC, `P2-T03` — **shipped below**),
 * `api.crossref.org` (Crossref, `P2-T04` — **shipped below**),
 * `api.semanticscholar.org` (Semantic Scholar, `P2-T05` — **shipped below**),
 * `export.arxiv.org` (arXiv, `P2-T06` — **shipped
 * below**, with `minIntervalMs: 3000` and `maxConcurrent: 1`, aggregated across
 * every machine under our control) and `api.biorxiv.org` (bioRxiv and medRxiv,
 * `P2-T07` — **shipped below**). `api.openalex.org` gets
 * **no** row: decision D2 puts OpenAlex out of v1 and one of `plan/03`'s cards
 * greps this file to prove it. The LLM and TTS hosts are Phase 3's and Phase 5's.
 * The four LLM hosts have static rows since 2026-10-21 (see "LLM hosts"
 * below), each carrying `retry: LLM_RETRY_BUDGET` and checked against §7.3's
 * shared "LLM/TTS hosts" row *(corrected 2026-10-20, `P3-T38`, `plan/00` §6
 * item 247: this sentence said the LLM hosts "are driven from provider prefs
 * rather than from a static row"; corrected again 2026-10-21, item 260: it
 * then said the rows' request rate was still `P3-T07`'s open line)*. TTS
 * hosts are not decided. **Each of
 * those five rows has its own `retry` budget with its own named sources in
 * §7.3** (filled 2026-10-14) — the NCBI numbers are that host's and not a global default, which §7.3
 * states and `test/unit/core/backoff.test.ts` enforces.
 *
 * **Europe PMC, `P2-T03` (2026-10-14).** 5/s, burst 5, max concurrent 3, no key
 * mode — §7.3's `www.ebi.ac.uk` row, whose own basis is the **Unverified**
 * note under the table: the 10 req/s figure comes from an EBI mailing-list
 * thread, the team confirmed per-IP scoping but not the number, and the shipped
 * budget is half of it. It is not raised without asking the Europe PMC team
 * (`docs/02` §4.1, `docs/09` §5.5). Europe PMC has no API key at all
 * (`docs/02` §4.1, "None required, none available"), so the row has no
 * `withKey` and no `keyPresencePref`. **Its `retry` budget is §7.3's three
 * cells as the owner filled them on 2026-10-14** (`P2-T32`; the dated note
 * under §7.3's table gives the derivation: base 1000 ms as the smallest round
 * value above the host's 200 ms pacing interval, cap 30 000 ms below §8.5's
 * 60 s timeout, three attempts by the `P0-T21` argument). `P2-T03` shipped the
 * row without a budget because those cells then read `—` and
 * `plan/README.md` §5 rule 4 forbids writing a number here that the document
 * does not carry; `test/unit/core/backoff.test.ts` reads the cells back from
 * the document and compares them to this row, so the two cannot drift apart.
 *
 * **Crossref, `P2-T04` (2026-10-14).** §7.3's `api.crossref.org` row:
 * "header-driven; **start at 2/interval**", burst 2, max concurrent 3, retry
 * 1000 ms / 30 000 ms / 3 (the cells the owner filled on 2026-10-14). The
 * static rate is a starting point and nothing more: the row's basis cell says
 * the interval "is **not** fixed at one second — it comes back in
 * `x-rate-limit-limit` / `x-rate-limit-interval`, with `x-concurrency-limit`
 * alongside, and `reconfigure()` is called from those headers on every
 * response". So `ratePerSecond: 2` is §7.3's "2/interval" read against the
 * one-second interval `docs/02` §5.1 measured, and the row carries
 * `headerDriven: true` so that the adapter adopts whatever the host advertises
 * — upwards to the polite pool's 3/s as well as downwards to the public
 * pool's 1/s — through {@link adoptHeaderDrivenLimits}. No key: Crossref Plus
 * is out of scope (`docs/02` §2.3), so no `withKey` and no `keyPresencePref`.
 * The polite pool is earned by a contact address, not a key, and that is
 * `src/core/http/userAgent.ts`'s and the adapter's business.
 *
 * **Semantic Scholar, `P2-T05` (2026-10-15).** §7.3's `api.semanticscholar.org`
 * row: **0.9/s in both modes**, burst 1, max concurrent 1, retry 2000 ms /
 * 30 000 ms / 3 (the cells the owner filled on 2026-10-14; base 2000 ms as the
 * smallest round value above the host's 1.1 s pacing interval). The basis cell
 * is the counter-intuitive one: an anonymous request draws on a *shared*
 * 1000 RPS pool across every anonymous caller on the internet — measured
 * returning HTTP 429 on every attempt during US business hours (`docs/02`
 * §6.4) — while an introductory key grants a **guaranteed but lower 1 RPS**, so
 * there is no mode in which going faster is safe and the key changes the
 * guarantee, not the budget. The row therefore carries **no `withKey` and no
 * `keyPresencePref`**, exactly the documented case {@link HostRateLimitPolicy}'s
 * `withKey` comment names for this host: the adapter sends the `x-api-key`
 * header when the keystore holds a key and the bucket paces identically either
 * way. The key itself never comes near this module (D5).
 *
 * **bioRxiv / medRxiv, `P2-T07` (2026-10-15).** §7.3's `api.biorxiv.org`
 * row: **1/s, burst 2, max concurrent 2**, retry 1000 ms / 30 000 ms / 3 (the
 * cells the owner filled on 2026-10-14; base 1000 ms as the smallest round
 * value above the host's 1 s pacing interval). The basis cell: "No published
 * limit exists; this is a self-imposed conservative default" — and the
 * **Unverified** note under §7.3's table calls the absence a genuine
 * documentation gap, so the rate is not raised on the strength of nothing
 * having been refused (`docs/02` §8.5: "absence of enforcement is not
 * permission"). No key mechanism exists (`docs/02` §8.1, `docs/09` §5.6), so
 * no `withKey` and no `keyPresencePref`. **Both preprint servers share this
 * one row and one bucket**: the `biorxiv` and `medrxiv` sources are distinct
 * `SourceId`s with the same `rateLimitKey`.
 *
 * **NCBI ID Converter, item 214 (2026-10-19).** §7.3's
 * `pmc.ncbi.nlm.nih.gov` row, added by the owner's decision: the
 * `eutils.ncbi.nlm.nih.gov` row's **unkeyed** values — 2.5/s, burst 1, max
 * concurrent 3, retry 1000 ms / 30 000 ms / 3 — and **never keyed**, so the
 * row has no `withKey` and no `keyPresencePref`, and an NCBI key on the
 * keystore changes nothing here. A host of its own, so a bucket of its own:
 * the converter does not draw on E-utilities' 2.5/s, and the two together may
 * reach 5/s from one address (the dated note under §7.3's table says so).
 *
 * **LLM hosts, item 260 (owner, 2026-10-21).** §7.3's LLM/TTS row as
 * corrected that day: every LLM host is paced at **1/s, burst 1, at most 3 in
 * flight** (3 is the `concurrency` default, `docs/07` §8.5, fixed rather than
 * read from the live preference), with `retry: LLM_RETRY_BUDGET`, the object
 * itself, which `test/unit/core/backoff.test.ts` routes to the shared row. One
 * row per host in {@link LLM_HOSTS}, so each provider has a bucket of its own.
 * No `withKey` and no `keyPresencePref`: every chat request needs a key, so
 * there is no keyless mode to tell apart (§7.3's dated note "LLM hosts'
 * pacing"). Until this date the rows were absent, so `createRetryFor` gave
 * each LLM host one attempt and no pacing. A base-URL override's host still
 * has no row.
 */
export const HOST_POLICIES: readonly HostRateLimitPolicy[] = [
  {
    host: NCBI_HOST,
    withoutKey: { ratePerSecond: 2.5, burst: 1, maxConcurrent: 3 },
    withKey: { ratePerSecond: 8, burst: 1, maxConcurrent: 3 },
    keyPresencePref: NCBI_KEY_PRESENT_PREF,
    retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
  },
  {
    // `docs/07` §7.3, `www.ebi.ac.uk` (Europe PMC): 5/s, burst 5, max
    // concurrent 3; retry 1000 ms / 30 000 ms / 3. See the header's "Europe
    // PMC" paragraph.
    host: EBI_HOST,
    withoutKey: { ratePerSecond: 5, burst: 5, maxConcurrent: 3 },
    retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
  },
  {
    // `docs/07` §7.3, `api.crossref.org`: header-driven, start at 2/interval,
    // burst 2, max concurrent 3; retry 1000 ms / 30 000 ms / 3. See the
    // header's "Crossref" paragraph.
    host: CROSSREF_HOST,
    withoutKey: { ratePerSecond: 2, burst: 2, maxConcurrent: 3 },
    retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
    headerDriven: true,
  },
  {
    // `docs/07` §7.3, `export.arxiv.org` (arXiv, `P2-T06`, 2026-10-15): 0.33/s,
    // burst 1, max concurrent **1**, "enforced via `minIntervalMs: 3000` and
    // `maxConcurrent: 1`"; retry 3000 ms / 30 000 ms / 3 (the cells the owner
    // filled on 2026-10-14). The basis is a hard ToU obligation, not advice:
    // "no more than one request every three seconds, and … a single
    // connection at a time", aggregated across "all of the machines under
    // your control as a whole" (`docs/09` §5.4). No key exists and no contact
    // parameter is required (`docs/02` §7.1, §2.2), so no `withKey`, no
    // `keyPresencePref`, and the `User-Agent` is good citizenship only.
    host: ARXIV_HOST,
    withoutKey: {
      ratePerSecond: 0.33,
      burst: 1,
      maxConcurrent: 1,
      minIntervalMs: 3000,
    },
    retry: { baseMs: 3000, capMs: 30_000, maxAttempts: 3 },
  },
  {
    // `docs/07` §7.3, `api.semanticscholar.org` (Semantic Scholar, `P2-T05`,
    // 2026-10-15): 0.9/s in both modes, burst 1, max concurrent 1; retry
    // 2000 ms / 30 000 ms / 3 (the cells the owner filled on 2026-10-14). See
    // the header's "Semantic Scholar" paragraph for why the row has no
    // `withKey`: a key changes the guarantee behind the budget, not the budget.
    host: SEMANTICSCHOLAR_HOST,
    withoutKey: { ratePerSecond: 0.9, burst: 1, maxConcurrent: 1 },
    retry: { baseMs: 2000, capMs: 30_000, maxAttempts: 3 },
  },
  {
    // `docs/07` §7.3, `api.biorxiv.org` (bioRxiv and medRxiv, `P2-T07`,
    // 2026-10-15): 1/s, burst 2, max concurrent 2; retry 1000 ms / 30 000 ms
    // / 3 (the cells the owner filled on 2026-10-14). Self-imposed: no limit
    // is published. One row for both servers. See the header's "bioRxiv /
    // medRxiv" paragraph.
    host: BIORXIV_HOST,
    withoutKey: { ratePerSecond: 1, burst: 2, maxConcurrent: 2 },
    retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
  },
  {
    // `docs/07` §7.3, `pmc.ncbi.nlm.nih.gov` (the NCBI ID Converter, owner
    // 2026-10-19, `plan/00` §6 item 214): 2.5/s, never keyed, burst 1, max
    // concurrent 3; retry 1000 ms / 30 000 ms / 3 — E-utilities' unkeyed
    // values. No `withKey`, no `keyPresencePref`: no key is ever sent. See
    // the header's "NCBI ID Converter" paragraph.
    host: PMC_IDCONV_HOST,
    withoutKey: { ratePerSecond: 2.5, burst: 1, maxConcurrent: 3 },
    retry: { baseMs: 1000, capMs: 30_000, maxAttempts: 3 },
  },
  // `docs/07` §7.3, LLM/TTS hosts (owner 2026-10-21, `plan/00` §6 item 260):
  // 1/s, burst 1, max concurrent 3; retry `LLM_RETRY_BUDGET` (1000 ms /
  // 60 000 ms / 5). One row per LLM host. See the header's "LLM hosts"
  // paragraph.
  {
    host: LLM_HOSTS.openrouter,
    withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 },
    retry: LLM_RETRY_BUDGET,
  },
  {
    host: LLM_HOSTS.openai,
    withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 },
    retry: LLM_RETRY_BUDGET,
  },
  {
    host: LLM_HOSTS.anthropic,
    withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 },
    retry: LLM_RETRY_BUDGET,
  },
  {
    host: LLM_HOSTS.gemini,
    withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 },
    retry: LLM_RETRY_BUDGET,
  },
];

/**
 * How long one LLM attempt may wait for its answer: **3 minutes**
 * (`plan/00` §6 item 240, owner, 2026-10-20; `docs/07` §7.3's dated note "LLM
 * hosts' retry budget").
 *
 * A long full-text generation can take more than the 60 s `timeoutSeconds`
 * that literature hosts keep (`docs/07` §8.5), so an LLM adapter passes this
 * as the request's `timeoutMs` (`HttpOptions.timeoutMs` in
 * `src/core/http/client.ts`) instead of leaving the preference's value in
 * place. It is a named constant beside the retry budget rather than a
 * preference: only `P3-T32` adds preference rows, and the owner asked for none.
 *
 * **How it meets the 90-second request budget.** `REQUEST_BUDGET_MS` limits
 * when a retry may *start* and never cuts an attempt short, so:
 *
 * - an attempt that fails after 90 s or more is not retried at all;
 * - a timeout is not retried either (item 230), so a silent host costs one
 *   attempt of this length;
 * - the worst case is a retry started just inside 90 s that then runs this
 *   full timeout: about 90 s + 180 s = 270 s after the first attempt reached
 *   the wire, plus that retry's wait for the host's bucket.
 *
 * **A plain request only** since 2026-10-22: a streamed one has the two limits
 * below instead (`plan/00` §6 item 268(c); `docs/07` §4.3's note "a stream's
 * two time limits"). {@link llmAttemptTimeouts} picks between them.
 */
export const LLM_ATTEMPT_TIMEOUT_MS = 180_000;

/**
 * How long a **streamed** LLM attempt may go without new text: **3 minutes**
 * (`plan/00` §6 item 268(c), owner, 2026-10-22).
 *
 * Passed as `HttpOptions.idleTimeoutMs` (`src/core/http/client.ts`). The
 * client starts the count when the attempt is handed to the transport and
 * restarts it each time the body grows, so a host that sends nothing at all is
 * cut after the same 3 minutes as a plain request. Expiry is a `TimeoutError`
 * and is not retried.
 */
export const LLM_STREAM_IDLE_TIMEOUT_MS = 180_000;

/**
 * How long a **streamed** LLM attempt may last in all: **15 minutes**
 * (`plan/00` §6 item 268(c), owner, 2026-10-22).
 *
 * Passed as the request's `timeoutMs`, which reaches `Zotero.HTTP.request` as
 * the XHR `timeout` and covers the whole exchange, body included. It replaces
 * {@link LLM_ATTEMPT_TIMEOUT_MS} for a stream, which until this date covered
 * the whole stream and so ended any answer longer than 3 minutes.
 */
export const LLM_STREAM_TOTAL_TIMEOUT_MS = 900_000;

/**
 * The time limits an LLM adapter passes with one attempt (`plan/00` §6 item
 * 268(c)): {@link LLM_ATTEMPT_TIMEOUT_MS} for a plain request;
 * {@link LLM_STREAM_TOTAL_TIMEOUT_MS} and {@link LLM_STREAM_IDLE_TIMEOUT_MS}
 * for a streamed one. One function, so the four adapters cannot disagree.
 *
 * @param streamed - whether the request carries `HttpOptions.onBodyText`
 * @returns the `timeoutMs` and, for a stream, the `idleTimeoutMs` to send
 */
export function llmAttemptTimeouts(streamed: boolean): {
  readonly timeoutMs: number;
  readonly idleTimeoutMs?: number;
} {
  return streamed
    ? {
        timeoutMs: LLM_STREAM_TOTAL_TIMEOUT_MS,
        idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
      }
    : { timeoutMs: LLM_ATTEMPT_TIMEOUT_MS };
}

/**
 * How long one request of the pane's key Test may take: **15 seconds**
 * (owner, 2026-10-23, `plan/00` §6 item 279(b); `docs/07` §7.3's note "A key
 * Test makes one attempt of 15 seconds"). A named constant, not a preference.
 */
export const LLM_KEY_TEST_TIMEOUT_MS = 15_000;

/** The limits an LLM key Test request carries, in place of {@link llmAttemptTimeouts}. */
export interface LlmAttemptLimits {
  readonly timeoutMs: number;
  readonly idleTimeoutMs?: number;
  /** `HttpOptions.singleAttempt`: one attempt, never retried. */
  readonly singleAttempt?: boolean;
}

/**
 * What every request of a key Test (`validateCredentials`) carries: one
 * attempt, never retried, of at most {@link LLM_KEY_TEST_TIMEOUT_MS}. Summary
 * calls keep {@link llmAttemptTimeouts} and {@link LLM_RETRY_BUDGET} (item
 * 279(b)).
 */
export const LLM_KEY_TEST_ATTEMPT: LlmAttemptLimits = Object.freeze({
  timeoutMs: LLM_KEY_TEST_TIMEOUT_MS,
  singleAttempt: true,
});

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
  /**
   * `host`'s policy row — both key modes, and the `maxConcurrent` the bucket
   * enforces through `RateLimiter.run` (`P1-T27`; it was unenforceable when
   * `P1-T04` wrote this line).
   */
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
// 3. The limits the hosts advertise — docs/02 §3.1 and §5.1
// ---------------------------------------------------------------------------

/**
 * A case-insensitive response-header lookup.
 *
 * Exactly `src/core/http/client.ts`'s `HttpResponse.header`, declared
 * structurally so that nothing in `core/rateLimit/` has to compile against
 * `core/http/`. **Case-insensitivity is load-bearing and measured:** the two
 * hosts spell their headers differently — `docs/02` §3.1 shows NCBI sending
 * `X-Ratelimit-Limit` in mixed case while §5.1's measured Crossref response is
 * all lowercase — and `toHttpResponse` in `client.ts` lower-cases both the stored
 * name and the argument, so one set of lowercase names below reaches both. A
 * case-*sensitive* lookup would make this whole section a silent no-op for NCBI.
 */
export type ResponseHeaderLookup = (name: string) => string | undefined;

/**
 * The two spellings of "requests per interval" that are **measured in the
 * corpus**, in the order they are tried.
 *
 * They are different headers, not one header in two cases: NCBI's has no hyphen
 * inside `Ratelimit` (`docs/02` §3.1, verified live) and Crossref's does
 * (`docs/02` §5.1, verified live 2026-09-08). Both are stored lowercase here
 * because {@link ResponseHeaderLookup} is case-insensitive.
 *
 * No other spelling is guessed. `docs/02` §9.1's OpenAlex block shows a third
 * family (`X-RateLimit-Cost-USD`, `X-RateLimit-Reset`, …) and decision D2 puts
 * OpenAlex out of v1, so it gets no row here and no header reader.
 */
export const ADVERTISED_RATE_LIMIT_HEADERS: readonly string[] = [
  "x-ratelimit-limit",
  "x-rate-limit-limit",
];

/** Crossref's interval for {@link ADVERTISED_RATE_LIMIT_HEADERS}, e.g. `1s`. */
export const ADVERTISED_RATE_INTERVAL_HEADER = "x-rate-limit-interval";

/** Crossref's concurrency cap, `docs/02` §5.1: `3` polite, `1` public. */
export const ADVERTISED_CONCURRENCY_HEADER = "x-concurrency-limit";

/** What a response said about the host's own limits. Absent means "not said". */
export interface AdvertisedLimits {
  /** `limit / intervalSeconds`, when both could be read. */
  readonly ratePerSecond?: number;
  /** `x-concurrency-limit`, when it was a positive integer. */
  readonly maxConcurrent?: number;
}

/** A positive integer, nothing else — no sign, no fraction, no exponent. */
const POSITIVE_INTEGER = /^\d+$/;

/** Crossref's interval form, the only one measured: a count of seconds. */
const INTERVAL_SECONDS = /^(\d+)s$/;

/**
 * Read a header whose only legal value is a positive integer.
 *
 * `0` is rejected along with everything malformed. A literal `0` is a real
 * signal — "you have nothing left" — but turning it into `ratePerSecond: 0` or
 * `maxConcurrent: 0` would park the host forever, and `assertConfig` rejects
 * both outright. The 429 / `Retry-After` path is what expresses "stop for a
 * while", with a deadline the server actually sent.
 */
function readPositiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!POSITIVE_INTEGER.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * `limit / interval`, in requests per second, or `undefined`.
 *
 * **An absent interval header is read as one second, and that is the one
 * assumption in this file.** It is safe in the only direction that matters,
 * because {@link adoptAdvertisedLimits} only ever *tightens*: assuming a shorter
 * interval than the host meant computes too *high* a rate, and too high a rate
 * is discarded rather than adopted. NCBI sends no interval header at all and its
 * documented unit is per second — NBK25497's "no more than three URL requests
 * per second" beside the `X-Ratelimit-Limit: 3` of `docs/02` §3.1 — so the
 * reading is also the measured one for the only host Phase 1 reaches.
 *
 * A *present* but unparseable interval voids the whole observation rather than
 * falling back to one second: the server said the interval is not one second and
 * we could not read what it is, so there is no rate here to adopt. That is the
 * card's "do not invent a rate when a header is … malformed".
 *
 * **There is a measured counter-example to the per-second reading, and it is why
 * the tighten-only rule is not optional.** `docs/02` §9.1's verified OpenAlex
 * response carries `X-RateLimit-Limit: 1000` with no interval — and that 1000 is
 * a **daily** budget (`$0.10/day`, "~1,000 list calls shared per IP"), not a
 * rate. Read per-second it would be 1000/s, three orders of magnitude too
 * generous. Decision D2 keeps OpenAlex out of v1 so it has no row and
 * `limiterFor` never hands this function its responses, but the case shows what
 * the one-second reading can get wrong, and {@link adoptAdvertisedLimits}
 * discarding everything above the policy in force is what makes being wrong that
 * way harmless rather than an IP block.
 */
function readAdvertisedRate(header: ResponseHeaderLookup): number | undefined {
  let limit: number | undefined;
  for (const name of ADVERTISED_RATE_LIMIT_HEADERS) {
    limit = readPositiveInteger(header(name));
    if (limit !== undefined) break;
  }
  if (limit === undefined) return undefined;

  const rawInterval = header(ADVERTISED_RATE_INTERVAL_HEADER);
  if (rawInterval === undefined) return limit;
  const match = INTERVAL_SECONDS.exec(rawInterval.trim());
  if (match === null) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 1) return undefined;
  return limit / seconds;
}

/**
 * What a response advertised about its host's limits. Pure; reads nothing else.
 *
 * **`X-Ratelimit-Remaining` is deliberately not read, and this is the reason.**
 * `docs/02` §3.1 shows NCBI returning it beside `X-Ratelimit-Limit`, and
 * `P1-T04`'s "Read first" names both. But it is a remaining *count* against a
 * window whose length and start neither NCBI nor the header states — turning it
 * into a `ratePerSecond` would require inventing the window, which is exactly
 * what `plan/README.md` §5 rule 4 and `P1-T26`'s **Do NOT** forbid. Nor is it
 * needed: a remaining-budget count is precisely what {@link TokenBucket} already
 * models, from a rate we are allowed to know, and
 * `RateLimiterStats.available` reports it. A `Remaining: 0` is the one case that
 * says something a rate does not, and the host answers that case with a 429 and a
 * `Retry-After`, which {@link ./tokenBucket.RateLimiter.penalize} already honours
 * with a deadline the server sent.
 *
 * @param header - case-insensitive lookup over the response's headers
 * @returns only the fields the response actually carried
 */
export function parseAdvertisedLimits(
  header: ResponseHeaderLookup,
): AdvertisedLimits {
  const ratePerSecond = readAdvertisedRate(header);
  const maxConcurrent = readPositiveInteger(
    header(ADVERTISED_CONCURRENCY_HEADER),
  );
  return {
    ...(ratePerSecond !== undefined && { ratePerSecond }),
    ...(maxConcurrent !== undefined && { maxConcurrent }),
  };
}

/**
 * The slice of a limiter {@link adoptAdvertisedLimits} needs.
 *
 * Both members are **optional** so that the structural port
 * `src/core/http/client.ts` declares stays satisfiable by a limiter that only
 * paces — a probe's stub, or a future adapter — and so that a limiter which
 * publishes neither is a documented no-op rather than a crash.
 * {@link TokenBucket} supplies both: `currentConfig` and `reconfigure`.
 */
export interface AdvertisedLimitTarget {
  /** The policy in force, as {@link TokenBucket.currentConfig} reports it. */
  readonly currentConfig?: RateLimiterConfig;
  /** §4.1's runtime reconfiguration. */
  reconfigure?(config: RateLimiterConfig): void;
}

/**
 * `reconfigure()` the limiter from what the response advertised, if anything.
 *
 * §7.3 on Crossref: the interval "comes back in `x-rate-limit-limit` /
 * `x-rate-limit-interval`, with `x-concurrency-limit` alongside, and
 * `reconfigure()` is called from those headers on every response". This is that
 * call, and `P1-T26` is the card that finally makes it.
 *
 * ## Three rules, and why each one is not a guess
 *
 * 1. **Only when present.** A header the response did not carry changes nothing.
 *    An absent header is not a signal to guess (`P1-T26`'s **Do NOT**), and a
 *    malformed one is treated as absent.
 * 2. **Only downwards.** An advertised limit *below* the policy in force is
 *    adopted; one above it is ignored. This is the deliberate deviation from
 *    §7.3's Crossref cell, which reads as though a generous header should also
 *    raise the rate, and it is reported against the card rather than taken
 *    silently. The reason is §7.3's own NCBI basis: 2.5/s and 8/s "sit below
 *    both for clock-skew headroom" against NCBI's documented 3/s and 10/s — so
 *    the live `X-Ratelimit-Limit: 3` of `docs/02` §3.1 is *exactly* the figure
 *    the table deliberately stays under, and adopting it would spend the headroom
 *    that `docs/02` §3.1's "may result in an IP address being blocked" paragraph
 *    is the reason for. Taking the smaller of two measured numbers invents
 *    nothing; raising our rate on the strength of a header would overrule
 *    §7.3 as the authority `plan/README.md` §5 rule 4 makes it, which no card has
 *    authorised. Whether the *upward* half should also land is a question for a
 *    card of its own, alongside Phase 2's Crossref row.
 * 3. **No call when nothing changed.** `reconfigure()` refills, re-queues and
 *    re-schedules; a host that advertises its steady-state limit on every one of
 *    a hundred responses must not pay for that a hundred times, and a caller that
 *    sees `undefined` knows nothing moved.
 *
 * **A tightened `maxConcurrent` lands at once.** Until `P2-T21` (2026-10-06)
 * this paragraph recorded a known gap: {@link TokenBucket.reconfigure} adopted
 * a changed cap only when the host next went idle, because `Semaphore`'s permit
 * count was fixed at construction, so under continuous traffic the old, larger
 * cap stayed in force until a gap appeared. `Semaphore.resize` closed it: the
 * gate is resized in place, the new cap binds the next slot acquisition, and
 * the calls already admitted under the old cap drain by attrition rather than
 * being revoked — `docs/07` §4.1's dated correction under `RateLimiterStats`
 * states the semantics. The reachability facts are unchanged and are why
 * `P2-T21` blocked `P2-T04`: Phase 1 could never reach the gap, because NCBI
 * sends no `x-concurrency-limit` at all (`docs/02` §3.1's verified response
 * carries only the two `X-Ratelimit-*` headers) and its row is
 * `maxConcurrent: 3` in both key modes; Phase 2 can, because Crossref
 * advertises `x-concurrency-limit: 3` on the polite pool and `1` on the public
 * one (`docs/02` §5.1) against §7.3's `api.crossref.org` row of
 * `maxConcurrent: 3`, so a pool demotion is a live 3 → 1 — and `P2-T04`
 * registered that row. Corrected 2026-10-15 (`P2-T24`).
 *
 * @param limiter - the host's limiter; one that publishes no config is a no-op
 * @param header - case-insensitive lookup over the response's headers
 * @returns the config adopted, or `undefined` when nothing was
 */
export function adoptAdvertisedLimits(
  limiter: AdvertisedLimitTarget,
  header: ResponseHeaderLookup,
): RateLimiterConfig | undefined {
  const current = limiter.currentConfig;
  if (current === undefined || limiter.reconfigure === undefined) {
    return undefined;
  }

  const advertised = parseAdvertisedLimits(header);
  const tighterRate =
    advertised.ratePerSecond !== undefined &&
    advertised.ratePerSecond < current.ratePerSecond
      ? advertised.ratePerSecond
      : undefined;
  const tighterConcurrency =
    advertised.maxConcurrent !== undefined &&
    advertised.maxConcurrent < current.maxConcurrent
      ? advertised.maxConcurrent
      : undefined;
  if (tighterRate === undefined && tighterConcurrency === undefined) {
    return undefined;
  }

  const next: RateLimiterConfig = {
    ...current,
    ratePerSecond: tighterRate ?? current.ratePerSecond,
    maxConcurrent: tighterConcurrency ?? current.maxConcurrent,
  };
  limiter.reconfigure(next);
  return next;
}

/**
 * `reconfigure()` a **header-driven** host's limiter to exactly what the
 * response advertised, in both directions.
 *
 * This is the upward half {@link adoptAdvertisedLimits} deliberately does not
 * have, and it is confined to the rows §7.3 marks header-driven
 * ({@link HostRateLimitPolicy.headerDriven}) — today `api.crossref.org`, whose
 * row reads "header-driven; start at 2/interval" and whose basis cell says the
 * governor is reconfigured "from those headers on every response". For that
 * host the advertised figure *is* the policy (`docs/02` §5.1: Crossref
 * "advertises the current values on every call"), so adopting it invents
 * nothing and raising to it overrules no document; the tighten-only rule
 * exists for hosts whose §7.3 cell sits below the advertised figure on
 * purpose, and those rows do not carry the flag. `P2-T04` (2026-10-14).
 *
 * The same three disciplines as the tighten-only function: only what the
 * response carried is read (`burst` is never advertised and is kept); a
 * malformed header is treated as absent; and `reconfigure()` is not called
 * when the advertised values equal the config in force, because it refills,
 * re-queues and re-schedules. The HTTP client's own call on every response
 * runs first and can only tighten; this call then lands the advertised value
 * exactly, so the two agree whenever the host tightened and only this one
 * acts when it loosened. The adapter calls it with the limiter the composition
 * root resolved for the host, after every response.
 *
 * @param limiter - the host's limiter; one that publishes no config is a no-op
 * @param header - case-insensitive lookup over the response's headers
 * @returns the config adopted, or `undefined` when nothing was
 */
export function adoptHeaderDrivenLimits(
  limiter: AdvertisedLimitTarget,
  header: ResponseHeaderLookup,
): RateLimiterConfig | undefined {
  const current = limiter.currentConfig;
  if (current === undefined || limiter.reconfigure === undefined) {
    return undefined;
  }

  const advertised = parseAdvertisedLimits(header);
  const ratePerSecond = advertised.ratePerSecond ?? current.ratePerSecond;
  const maxConcurrent = advertised.maxConcurrent ?? current.maxConcurrent;
  if (
    ratePerSecond === current.ratePerSecond &&
    maxConcurrent === current.maxConcurrent
  ) {
    return undefined;
  }

  const next: RateLimiterConfig = { ...current, ratePerSecond, maxConcurrent };
  limiter.reconfigure(next);
  return next;
}

// ---------------------------------------------------------------------------
// 4. The process-wide holder
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

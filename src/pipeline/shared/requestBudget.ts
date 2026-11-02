/**
 * The per-run request budget and the value order it is spent in
 * (`docs/05` §9.3; `P5-T10`).
 *
 * **Callers.** `src/pipeline/related/generators.ts` (`P5-T12`) and
 * `src/pipeline/recommend/generators.ts` (`P5-T23`) each construct one
 * {@link RequestBudget} per run. Both spend it through `planRelatedSeeds` in
 * `relatedFetch.ts`, or through {@link RequestBudget.tryTake} for a request that
 * covers several seeds. The size is the caller's: `P5-T23` starts from 40
 * (`docs/05` §9.3's sketch), and `docs/07` §8.5 has no row for it.
 *
 * **Not `RequestBudget` in `src/core/http/retry.ts`.** That interface is one
 * request's time budget; this class counts the requests of one run.
 *
 * Budget is taken before a generator starts, so it does fewer seeds rather than
 * stopping part way (`docs/05` §9.3: "degrade rather than truncate mid-flight").
 */

function requireCount(what: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `[research-helper] ${what} must be a whole number of requests; got ${String(n)}`,
    );
  }
}

/** How many requests one run may still send. */
export class RequestBudget {
  private left: number;

  /**
   * @param total - the run's requests
   * @throws RangeError unless `total` is a non-negative integer
   */
  constructor(total: number) {
    requireCount("a request budget", total);
    this.left = total;
  }

  /** The requests not yet taken. */
  get remaining(): number {
    return this.left;
  }

  /**
   * Take exactly `n` requests, or none.
   *
   * @returns whether they were taken
   * @throws RangeError unless `n` is a non-negative integer
   */
  tryTake(n = 1): boolean {
    requireCount("tryTake", n);
    if (this.left < n) return false;
    this.left -= n;
    return true;
  }

  /**
   * Take as many of `n` requests as are left: a generator's share when it
   * cannot have all it wants.
   *
   * @returns how many were taken
   * @throws RangeError unless `n` is a non-negative integer
   */
  takeUpTo(n: number): number {
    requireCount("takeUpTo", n);
    const taken = Math.min(n, this.left);
    this.left -= taken;
    return taken;
  }
}

/** The recommend generators `docs/05` §9.3 ranks, as `plan/08` `P5-T23` builds them. */
export type BudgetedGenerator =
  | "s2-recommendations"
  | "pmra"
  | "author-watch"
  | "keyword-search"
  | "forward-citations"
  | "keyword-arxiv";

/**
 * `docs/05` §9.3's order, best value per request first. `P5-T23` plans its
 * generators in this order, one after another, and only then starts them
 * together, so a short budget goes to the best generators however fast each
 * host answers.
 *
 * Two of §9.3's eight rows are not here: "Cached everything" costs no request,
 * and co-citation is not built (`plan/00` §6 item 321(c)). "Europe PMC keyword
 * search" is `keyword-search` because FR-45's keyword generator covers every
 * selected source, and arXiv keeps its own later place because of its 3-second
 * rule. `forward-citations` covers `P5-T23`'s Europe PMC path for a run with no
 * key as well as §9.3's Semantic Scholar one.
 */
export const GENERATOR_VALUE_ORDER: readonly BudgetedGenerator[] = [
  "s2-recommendations",
  "pmra",
  "author-watch",
  "keyword-search",
  "forward-citations",
  "keyword-arxiv",
];

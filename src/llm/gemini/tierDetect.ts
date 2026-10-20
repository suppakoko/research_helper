/**
 * Whether the Gemini key's project is on the paid tier — and the conservative
 * answer when that cannot be told.
 *
 * **Scope.** `P3-T10` step 5. `docs/09` §3.4 rule 4: before the first Gemini
 * call in a session, and whenever the key changes, the plugin tries to tell
 * whether the key's Cloud **project** is billing-linked; if it cannot, it
 * **assumes the free tier**, on which Google trains on the content and human
 * reviewers may read it (§3.3). Assuming paid would be choosing the
 * safer-sounding answer without evidence.
 *
 * **No documented signal exists, so the answer is always
 * `"free-or-unknown"` today.** Neither `docs/03` nor `docs/09` records any
 * response field, header or endpoint that says a project is billing-linked;
 * `docs/09` §3.4 carries that as an **Unverified** note. So
 * {@link DOCUMENTED_PAID_SIGNALS} is empty, the detector sends **no
 * request** (there is nothing documented to read), and it never infers
 * `"paid"` from anything else — not from an account's billing method, not
 * from a model being listed, not from a rate limit (`P3-T10` **Do NOT**).
 * A signal is added to that list only when a document records it.
 *
 * **What is not built here.** Asking the user to confirm their tier, and
 * showing the free-tier warning on every job while the answer is not "paid",
 * are the card's `Open — recommended` line (owner decision pending, `docs/09`
 * §8 item 3) and `P3-T15`'s surface. `P3-T15` is the caller of
 * {@link GeminiTierDetector.detectTier}; the code that stores a new Gemini
 * key (`P3-T04` / `P3-T14`) is the caller of
 * {@link GeminiTierDetector.keyChanged}.
 */

/** The two answers. There is deliberately no plain `"free"`: the plugin cannot tell free from unknown. */
export type GeminiTier = "paid" | "free-or-unknown";

/**
 * Evidence a detector may be handed: whatever a Gemini answer carried.
 * Kept to the response's status, headers and parsed body, so a documented
 * signal can be added without changing the shape.
 */
export interface TierEvidence {
  readonly status?: number;
  readonly header?: (name: string) => string | undefined;
  readonly body?: unknown;
}

/**
 * A documented, programmatic "this project is billing-linked" test: `true`
 * only when the evidence proves the paid tier.
 */
export type PaidTierSignal = (evidence: TierEvidence) => boolean;

/**
 * Every documented paid-tier signal. **Empty**: none is documented
 * (`docs/09` §3.4 rule 4's Unverified note). Frozen so that nothing adds an
 * undocumented one at run time.
 */
export const DOCUMENTED_PAID_SIGNALS: readonly PaidTierSignal[] = Object.freeze(
  [],
);

/**
 * Classify one piece of evidence: `"paid"` only when a documented signal
 * proves it; `"free-or-unknown"` on anything inconclusive — an error, an
 * empty body, a body that merely mentions billing.
 *
 * @param evidence - what an answer carried
 * @param signals - the signals to try; {@link DOCUMENTED_PAID_SIGNALS} by default
 * @returns the tier
 */
export function classifyTier(
  evidence: TierEvidence,
  signals: readonly PaidTierSignal[] = DOCUMENTED_PAID_SIGNALS,
): GeminiTier {
  for (const signal of signals) {
    try {
      if (signal(evidence)) return "paid";
    } catch {
      // A signal that cannot read the evidence proved nothing.
    }
  }
  return "free-or-unknown";
}

/** One session's tier answer, cached until the key changes. */
export interface GeminiTierDetector {
  /**
   * The tier for the current key: computed once per session and again after
   * {@link GeminiTierDetector.keyChanged}. `"free-or-unknown"` whenever it
   * cannot tell — today, always.
   */
  detectTier(): Promise<GeminiTier>;
  /** Forget the cached answer: the next {@link detectTier} decides again. */
  keyChanged(): void;
}

/** What {@link createGeminiTierDetector} may be given. */
export interface GeminiTierDetectorDeps {
  /**
   * Supplies evidence for one decision. Absent — the shipped case, because no
   * documented signal needs any — the decision is made on no evidence and is
   * therefore `"free-or-unknown"`.
   */
  readonly gather?: () => Promise<TierEvidence>;
  /** Defaults to {@link DOCUMENTED_PAID_SIGNALS}. */
  readonly signals?: readonly PaidTierSignal[];
}

/**
 * Build the per-session detector.
 *
 * A `gather` that rejects is inconclusive, not an error: the answer is
 * `"free-or-unknown"` and the failure is not cached, so the next call tries
 * again.
 *
 * @param deps - see {@link GeminiTierDetectorDeps}
 * @returns the detector
 */
export function createGeminiTierDetector(
  deps: GeminiTierDetectorDeps = {},
): GeminiTierDetector {
  let cached: GeminiTier | undefined;
  let generation = 0;

  return {
    async detectTier(): Promise<GeminiTier> {
      if (cached !== undefined) return cached;
      const started = generation;
      let evidence: TierEvidence = {};
      if (deps.gather !== undefined) {
        try {
          evidence = await deps.gather();
        } catch {
          return "free-or-unknown";
        }
      }
      const tier = classifyTier(evidence, deps.signals);
      // A key change while gathering makes this answer stale: do not keep it.
      if (started === generation) cached = tier;
      return tier;
    },
    keyChanged(): void {
      generation += 1;
      cached = undefined;
    },
  };
}

/**
 * `Usage` — token and cost accounting for one LLM or TTS call.
 *
 * **Scope.** `P3-T06` step 1. Transcribed from
 * `docs/07-architecture-and-data-model.md` §5.1's `// src/model/usage.ts`
 * block, which `plan/README.md` §5 rule 3 makes the sole authority for types.
 *
 * **Why `model/`.** `StoredSummary` and `TrendReport` (§5.2) reference it, and
 * `model/` may import nothing but itself (§2.3), so declaring it in
 * `src/llm/types.ts` would make `model/ → llm/` an upward import.
 * `src/llm/types.ts` re-exports it so provider code has one import.
 */

/** Token / cost accounting for one LLM or TTS call. */
export interface Usage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
  /** Provider-reported cost where available (OpenRouter reports this). */
  readonly costUsd: number | undefined;
}

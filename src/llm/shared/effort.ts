/**
 * The five-level effort scale three adapters send, and the one fold onto it.
 *
 * **Authority.** `docs/03-llm-provider-integration.md` §14.2's
 * `mapEffortToFiveLevel`, "used by both adapters" there (OpenAI and
 * Anthropic), and §14.3's rule that every adapter maps the shared scale
 * through a function and never forwards it blind. The levels are §2.5's for
 * OpenAI's `reasoning.effort`, §3.6's for Anthropic's `output_config.effort`
 * and §9.4's `supported_efforts` for OpenRouter's `reasoning.effort`: all
 * five run `low` … `max`, with no `none` and no `minimal`.
 *
 * The shared scale itself is {@link Effort} in `../types.ts` (`docs/07`
 * §4.3, owner, 2026-10-21, `plan/00` §6 item 262(a)). Gemini's four thinking
 * levels are a different scale and keep their own map,
 * `mapEffortToThinkingLevel` in `../gemini/mapper.ts`.
 */

import type { Effort } from "../types";

/** The five levels OpenAI, Anthropic and OpenRouter accept. No `none`, no `minimal`. */
export type FiveLevelEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Fold the shared scale onto the five-level one.
 *
 * `none` and `minimal` become `low`, the bottom of the five-level scale: each
 * of the three providers rejects both (`docs/03` §2.5, §14.2, §14.3). Every
 * other level exists on both scales and passes through.
 *
 * @param effort - a level on the shared scale
 * @returns the level to send
 */
export function toFiveLevelEffort(effort: Effort): FiveLevelEffort {
  switch (effort) {
    case "none":
    case "minimal":
      return "low";
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return effort;
  }
}

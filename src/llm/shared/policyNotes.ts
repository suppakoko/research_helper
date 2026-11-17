/**
 * The provider-policy lines the preference pane's Privacy section shows, each
 * with its sources and the date they were last read (`plan/10` `P7-T17`;
 * `docs/09` §8 items 6 and 7; `docs/08` §7.3's note of 2026-11-16, item 3).
 *
 * **Authority.** `docs/09` §3.3's "Re-verified 2026-11-17" table. Every line
 * here words only claims that table marks "Unchanged" on the provider's own
 * pages, read on {@link POLICY_NOTES_AS_OF} without signing in and without a
 * key. A claim the table could not re-verify has no line, so it never reaches
 * the pane (`P7-T17` step 2). The wording is the bundle's
 * (`research-helper-prefs-retention-*`); it may say no more than the pages
 * (`docs/09` §7: the plugin "claims no protection it does not provide").
 *
 * **Re-verification.** At each minor release (`docs/09` §8 item 7;
 * `docs/13` §8.9's checklist line): read each source, compare the line,
 * update `asOf` (or remove the line), and add a dated table to `docs/09`
 * §3.3.
 *
 * **Caller.** `publishPreferencesHost` in `src/bootstrap/registerUI.ts`, which
 * hands the rows to `createPreferencesHost` (`src/ui/prefs/preferencesPane.ts`)
 * as data: `ui/` may not import `llm/` (`eslint.config.js`'s layering rule),
 * so the pane declares the shape (`PanePolicyNote`), not this file.
 */

import type { MainWindowMessageId } from "../../i18n/keys";
import type { ProviderId } from "../../model/ids";

/** The day every source below was read (`docs/09` §3.3's re-verification). */
export const POLICY_NOTES_AS_OF = "2026-11-17";

/** One line in the pane. */
export interface PolicyNote {
  readonly provider: ProviderId;
  /** The bundle's line; its `$date` is {@link asOf}. */
  readonly messageId: MainWindowMessageId;
  /** The provider's own pages the line's claims were read on. */
  readonly sourceUrls: readonly string[];
  /** ISO date (`YYYY-MM-DD`) the sources were read. */
  readonly asOf: string;
}

const OPENAI_DATA = "https://developers.openai.com/api/docs/guides/your-data";
const ANTHROPIC_TRAINING =
  "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training";
const ANTHROPIC_RETENTION =
  "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data";
const GEMINI_TERMS = "https://aistudio.google.com/docs/terms";
const GEMINI_USAGE = "https://aistudio.google.com/docs/usage-policies";
const OPENROUTER_PRIVACY = "https://openrouter.ai/privacy";
const OPENROUTER_TERMS = "https://openrouter.ai/terms";

/** `docs/09` §3.3's re-verified claims, one row per pane line. */
export const POLICY_NOTES: readonly PolicyNote[] = [
  {
    provider: "openai",
    messageId: "research-helper-prefs-retention-openai",
    sourceUrls: [OPENAI_DATA],
    asOf: POLICY_NOTES_AS_OF,
  },
  {
    provider: "anthropic",
    messageId: "research-helper-prefs-retention-anthropic",
    sourceUrls: [ANTHROPIC_TRAINING, ANTHROPIC_RETENTION],
    asOf: POLICY_NOTES_AS_OF,
  },
  {
    provider: "gemini",
    messageId: "research-helper-prefs-retention-gemini-paid",
    sourceUrls: [GEMINI_TERMS, GEMINI_USAGE],
    asOf: POLICY_NOTES_AS_OF,
  },
  {
    provider: "gemini",
    messageId: "research-helper-prefs-retention-gemini-free",
    sourceUrls: [GEMINI_TERMS],
    asOf: POLICY_NOTES_AS_OF,
  },
  {
    provider: "openrouter",
    messageId: "research-helper-prefs-retention-openrouter",
    sourceUrls: [OPENROUTER_PRIVACY, OPENROUTER_TERMS],
    asOf: POLICY_NOTES_AS_OF,
  },
];

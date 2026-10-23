/**
 * The typed preference schema (`P1-T03` step 1).
 *
 * **`docs/07-architecture-and-data-model.md` §8.5 is the sole authority** for
 * every key, type, default and allowed-value set below, and §8.5.1 is the
 * authority for {@link PrefDef}'s shape. This file restates nothing it does not
 * transcribe, and `plan/README.md` §5 rule 3 makes that non-negotiable: `docs/02`
 * and `docs/03` carry divergent working-name sketches of related types, each
 * carrying a "doc 07 wins" note.
 *
 * **Only the rows a shipped phase reads.** Phase 1's twelve came with `P1-T03`
 * — the whole "Sources & search" block plus `timeoutSeconds`, `logLevel`,
 * `logRequestBodies`, `ncbi.keyPresent`, `secretBackend` and
 * `prefsSchemaVersion`; `P2-T05` added `semanticscholar.keyPresent`; and
 * `P3-T32` added the fifty rows Phase 3 reads (its **Do** step 1 lists them).
 * `plan/04` §0.2 item 2 makes `P3-T32` the only Phase 3 card that adds a row:
 * every other card reads through `getPref` / `setPref`. *(Updated 2026-10-22:
 * the owner added one more Phase 3 row, `gemini.paidTier`, by decision —
 * `plan/00` §6 item 269(b) — written into §8.5 first.)* Rows for later phases
 * (`reportLanguage`, `tts.*`, `background.enabled`, …) are not here. Every card
 * that adds rows is bound by the same rule: "do not add a preference that
 * `docs/07` §8.5 does not declare, and do not change a default". The ordering
 * rule §8.5 states is *§8.5 first, then `prefs.js`, then the pane*.
 *
 * **Property names** follow one convention: the §8.5 key with its dots removed
 * and the letter after each dot capitalised (`ncbi.keyPresent` →
 * `ncbiKeyPresent`, `summary.fullTextMode` → `summaryFullTextMode`). §8.5.1's
 * sketch writes `fullTextMode` for the latter; `P3-T32`'s step 1 fixes the
 * convention instead, so the name can be derived from the key without a table.
 *
 * ## D5, and what the `secret` flag is for
 *
 * **No entry in {@link PREFS} carries `secret: true`, and none ever may.** That
 * is the whole point of the flag: §8.5's closing paragraph requires "a unit test
 * asserts that no `secret: true` entry has a `Zotero.Prefs` writer", and
 * `docs/09` §1.7 refuses tier 4 (plaintext prefs) outright — "implementing it as
 * a fallback guarantees it becomes the common case". Because every member of
 * `PREFS` is reachable from `setPref`, a `secret: true` member would *be* a
 * writer, so the assertion reduces to "no member is secret".
 *
 * The flag is nonetheless declared, for two live consumers: §10.4's debug bundle
 * replaces a secret-flagged value with `"[present]"` / `"[absent]"` in
 * `settings.json`, and `src/prefs/index.ts`'s write guard refuses one
 * structurally rather than by review. `test/unit/prefs/schema.test.ts` exercises
 * that guard against a synthetic secret definition, which is how the criterion
 * "the D5 test fails if a `secret: true` entry is added with a writer" is made
 * mechanical.
 *
 * What *is* a preference, per §8.5's last block: presence booleans
 * (`ncbi.keyPresent`), the selected backend (`secretBackend`), validation
 * timestamps and results, and every non-secret setting. Keys themselves go
 * through `Zotero.OSKeyStore` + `Services.logins` (`src/zotero/keychain.ts`).
 */

import { PREF_KEYS } from "./keys";

/**
 * One preference's declaration — `docs/07` §8.5.1's interface, verbatim.
 *
 * @typeParam T - the value type this preference holds
 */
export interface PrefDef<T> {
  /** Branch-relative key, e.g. "summary.fullTextMode". */
  readonly key: string;
  readonly type: "boolean" | "integer" | "number" | "string";
  readonly default: T;
  /** Closed value set, where §8.5 gives one. */
  readonly values?: readonly T[];
  /** Inclusive numeric bounds, where §8.5 gives them. */
  readonly min?: number;
  readonly max?: number;
  /** D5: never true for anything a Zotero.Prefs writer can reach. */
  readonly secret?: boolean;
}

/**
 * `docs/07` §8.5's value set for every `<provider>.lastValidationResult` row,
 * in §8.5's order; `""` means never validated.
 */
const VALIDATION_RESULT_VALUES = [
  "ok",
  "rejected",
  "forbidden",
  "inconclusive",
  "",
] as const;

/**
 * Every preference Phases 1–3 read, one entry per `docs/07` §8.5 row.
 *
 * The property name is what plugin code passes to `getPref`; `key` is the
 * branch-relative preference, and the two differ inside a dotted family
 * (`ncbiKeyPresent` → `"ncbi.keyPresent"`), which is §8.5.1's own convention for
 * `fullTextMode` → `"summary.fullTextMode"`. Key strings come from
 * `./keys.ts` so that a typo is a compile error rather than a silently-absent
 * preference.
 *
 * `min` / `max` are **inclusive** and are *not* clamped on read: §8.5.1 says
 * `coerce()` returns "the schema default when the value is absent, the wrong
 * type, **or out of range**", so a stored `searchYears` of `99` yields `3`, not
 * `20`. `P1-T03` step 3 states it as an acceptance criterion.
 *
 * `step` is deliberately absent even though §8.5 gives one for `maxResults`
 * (10) and `timeoutSeconds` (10). {@link PrefDef} declares no `step` member, a
 * step is a *widget* increment rather than a validity rule, and rejecting a
 * stored `maxResults` of `55` would discard a value a user can legitimately set
 * through `about:config`. `docs/08` §7.3's `<html:input>` owns the increment.
 */
export const PREFS = {
  // -------------------------------------------------------------------------
  // Sources & search — docs/07 §8.5, "Sources & search"
  // -------------------------------------------------------------------------

  /**
   * Comma-separated source IDs. Default is **all seven v1 sources** (decision
   * D2): an earlier draft of §8.5's row shipped five and silently dropped both
   * preprint servers. `openalex` is not a valid member — OpenAlex is out of v1.
   *
   * No `values`: §8.5 gives the shape ("comma-separated source IDs, from the
   * `SourceId` union (§5.1) minus `openalex`") rather than a closed set of whole
   * strings, and a closed set here would reject every combination but the
   * default. Membership in this list *is* each source's enable flag — §8.5 is
   * explicit that "there is no per-source `enabled` boolean".
   */
  sources: {
    key: PREF_KEYS.sources,
    type: "string",
    default: "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv",
  },

  /** Recency window in years. §8.5: 1–20, default 3. */
  searchYears: {
    key: PREF_KEYS.searchYears,
    type: "integer",
    default: 3,
    min: 1,
    max: 20,
  },

  /** Result cap per run. §8.5: 10–200 (step 10 is the widget's), default 100. */
  maxResults: {
    key: PREF_KEYS.maxResults,
    type: "integer",
    default: 100,
    min: 10,
    max: 200,
  },

  /**
   * Import through `Zotero.Translate.Search` (Strategy B) instead of the
   * hand-mapped path.
   *
   * **Ships off, and §8.5 explains why at length:** Strategy B costs one network
   * lookup per record, which puts a 100-record import outside NFR-1's budget by
   * construction. An earlier draft shipped this `true`, promising a path no phase
   * built and a throughput target it could not meet at the same time.
   */
  useTranslators: {
    key: PREF_KEYS.useTranslators,
    type: "boolean",
    default: false,
  },

  /** Hide results already in the library. §8.5: default true. */
  hideExisting: {
    key: PREF_KEYS.hideExisting,
    type: "boolean",
    default: true,
  },

  /**
   * A **general** contact address, not an NCBI one.
   *
   * It fills Crossref's `mailto` parameter only; NCBI always receives the
   * maintainer address (decision D10). `docs/02` §2.2 calls the name
   * `ncbi.email` "actively misleading" for exactly this reason, and `P1-T03`'s
   * **Do NOT** forbids that spelling. Phase 2 is the phase that sends it.
   */
  contactEmail: {
    key: PREF_KEYS.contactEmail,
    type: "string",
    default: "",
  },

  // -------------------------------------------------------------------------
  // LLM providers & models — docs/07 §8.5, "LLM providers & models" (P3-T32)
  //
  // Model IDs are SEED DEFAULTS ONLY: §8.5 says the pickers are repopulated
  // from each provider's models endpoint at run time, and plan/README.md §5
  // rule 4 forbids hardcoding a model ID anywhere but these defaults.
  // -------------------------------------------------------------------------

  /** The active LLM provider (decision D6). §8.5: default `openrouter`. */
  llmProvider: {
    key: PREF_KEYS.llmProvider,
    type: "string",
    default: "openrouter",
    values: ["openrouter", "openai", "gemini", "anthropic"],
  },

  /**
   * OpenRouter's model ID. No `values`: §8.5 gives "any model ID from the
   * provider's models endpoint", which is a live list, not a closed set.
   */
  openrouterModel: {
    key: PREF_KEYS.openrouterModel,
    type: "string",
    default: "anthropic/claude-sonnet-5",
  },

  /** OpenAI's model ID, as `openrouterModel`. */
  openaiModel: {
    key: PREF_KEYS.openaiModel,
    type: "string",
    default: "gpt-5.6-terra",
  },

  /** Gemini's model ID, as `openrouterModel`. */
  geminiModel: {
    key: PREF_KEYS.geminiModel,
    type: "string",
    default: "gemini-3.8-flash",
  },

  /** Anthropic's model ID, as `openrouterModel`. */
  anthropicModel: {
    key: PREF_KEYS.anthropicModel,
    type: "string",
    default: "claude-sonnet-5",
  },

  /**
   * Base-URL override (FR-29). Empty means the provider's documented base URL.
   * No `values`: §8.5 gives a shape ("an absolute `https://` URL with no
   * trailing slash, or empty"), which the reader validates, not this schema.
   * Never a credential.
   */
  openrouterBaseUrl: {
    key: PREF_KEYS.openrouterBaseUrl,
    type: "string",
    default: "",
  },

  /** OpenAI's base-URL override, as `openrouterBaseUrl`. */
  openaiBaseUrl: {
    key: PREF_KEYS.openaiBaseUrl,
    type: "string",
    default: "",
  },

  /** Gemini's base-URL override, as `openrouterBaseUrl`. */
  geminiBaseUrl: {
    key: PREF_KEYS.geminiBaseUrl,
    type: "string",
    default: "",
  },

  /** Anthropic's base-URL override, as `openrouterBaseUrl`. */
  anthropicBaseUrl: {
    key: PREF_KEYS.anthropicBaseUrl,
    type: "string",
    default: "",
  },

  /**
   * The cheap map-pass model (`docs/03` §16). Empty means `<provider>.model`.
   * Not in the pane and no `pref()` line (`docs/01` §7.2).
   */
  summaryModel: {
    key: PREF_KEYS.summaryModel,
    type: "string",
    default: "",
  },

  /** The strong reduce-pass model, as `summaryModel`. */
  reportModel: {
    key: PREF_KEYS.reportModel,
    type: "string",
    default: "",
  },

  /**
   * The relevance-screening model. Empty means `summaryModel`, then
   * `<provider>.model`. §8.5: **not a third model tier**.
   */
  screeningModel: {
    key: PREF_KEYS.screeningModel,
    type: "string",
    default: "",
  },

  /**
   * The **global** privacy-mode default (`docs/09` §3.5). Per-collection
   * overrides live in the `collection_settings` table and may only be stricter.
   */
  privacyMode: {
    key: PREF_KEYS.privacyMode,
    type: "string",
    default: "balanced",
    values: ["strict", "balanced", "full"],
  },

  /**
   * The one-time data-egress acknowledgement FR-36 requires be recorded in
   * prefs. Written once by the first-job confirmation dialog. **Not** a
   * suppression switch for the per-job disclosure or for any of `docs/09`
   * §3.6's non-suppressible warnings. Name confirmed by the owner 2026-10-20
   * (`plan/00` §6 item 241).
   */
  privacyEgressAcknowledged: {
    key: PREF_KEYS.privacyEgressAcknowledged,
    type: "boolean",
    default: false,
  },

  /**
   * The user's declaration that the Gemini key is on Google's paid tier, which
   * the plugin cannot read itself (`docs/09` §3.4 rule 4). Added 2026-10-22 by
   * the owner's decision (`plan/00` §6 item 269(b)); `docs/07` §8.5's row is
   * the authority. Read on demand, never cached. When `true`, strict and
   * balanced modes allow Gemini (item 270), and every job's free-tier warning
   * becomes a declared-paid reminder (`assertModelAllowed`,
   * `buildEgressDisclosure`). The checkbox is `P3-T04`'s. No `pref()` line.
   */
  geminiPaidTier: {
    key: PREF_KEYS.geminiPaidTier,
    type: "boolean",
    default: false,
  },

  /**
   * Per-model token-estimate correction factors, as a JSON object (model ID →
   * positive number). §8.5's type is "string (JSON)", so the schema holds the
   * string and the reader parses it; an absent or unparseable value means "no
   * calibration yet". Written at most once per job. Name confirmed by the owner
   * 2026-10-20 (`plan/00` §6 item 241).
   */
  llmTokenEstimateCalibration: {
    key: PREF_KEYS.llmTokenEstimateCalibration,
    type: "string",
    default: "{}",
  },

  // -------------------------------------------------------------------------
  // Summarization — docs/07 §8.5, "Summarization" (P3-T32)
  // -------------------------------------------------------------------------

  /** Full-text use (decision D7). `strict` privacy forces `never`. */
  summaryFullTextMode: {
    key: PREF_KEYS.summaryFullTextMode,
    type: "string",
    default: "auto",
    values: ["never", "auto", "always"],
  },

  /** Paper count above which `auto` pre-selects abstract-only. §8.5: ≥ 1. */
  summaryFullTextAutoMaxPapers: {
    key: PREF_KEYS.summaryFullTextAutoMaxPapers,
    type: "integer",
    default: 25,
    min: 1,
  },

  /**
   * Estimated cost, in **whole US cents**, above which the confirmation dialog
   * appears. §8.5: an `integer`, ≥ 0, default `200` ($2.00). Gecko holds no
   * fractional preference (`plan/00` §6 item 245), so every money row is cents;
   * the dialog shows and accepts dollars and converts at the boundary. Not a
   * spend ceiling — those are the two `run.*` rows below.
   */
  summaryConfirmAboveCents: {
    key: PREF_KEYS.summaryConfirmAboveCents,
    type: "integer",
    default: 200,
    min: 0,
  },

  /** Shortest abstract worth summarising, in characters. §8.5: ≥ 0. */
  summaryMinAbstractChars: {
    key: PREF_KEYS.summaryMinAbstractChars,
    type: "integer",
    default: 250,
    min: 0,
  },

  /** Prefer JATS XML over PDF text (`docs/06` §3.1, D-06-1). */
  fullTextPreferJATS: {
    key: PREF_KEYS.fullTextPreferJATS,
    type: "boolean",
    default: true,
  },

  /** Hard page cap on full-text extraction (`docs/06` §3.3). §8.5: ≥ 1. */
  fullTextHardPageCap: {
    key: PREF_KEYS.fullTextHardPageCap,
    type: "integer",
    default: 60,
    min: 1,
  },

  /**
   * Summarise on item selection. **Must ship off**: `onAsyncRender` fires on
   * every selection change, so an unconditional LLM call there burns credits.
   */
  autoSummarize: {
    key: PREF_KEYS.autoSummarize,
    type: "boolean",
    default: false,
  },

  /** Seeded relevance-screening threshold. §8.5: 0–100; `0` filters nothing. */
  screeningThreshold: {
    key: PREF_KEYS.screeningThreshold,
    type: "integer",
    default: 60,
    min: 0,
    max: 100,
  },

  /** What a retracted paper does in a summary run (`docs/06` §13.3). */
  screeningRetractionPolicy: {
    key: PREF_KEYS.screeningRetractionPolicy,
    type: "string",
    default: "exclude_from_synthesis",
    values: ["include", "exclude_from_synthesis", "exclude_entirely"],
  },

  /** What a non-English paper does in a summary run (`docs/06` §13.2). */
  screeningNonEnglishPolicy: {
    key: PREF_KEYS.screeningNonEnglishPolicy,
    type: "string",
    default: "translate_summary",
    values: ["skip", "translate_summary", "summarize_in_source_language"],
  },

  /** Collapse duplicates before summarising (`docs/06` §13.4). */
  screeningDedupe: {
    key: PREF_KEYS.screeningDedupe,
    type: "boolean",
    default: true,
  },

  /** Use the summary cache (`docs/06` §11.3). */
  cacheEnabled: {
    key: PREF_KEYS.cacheEnabled,
    type: "boolean",
    default: true,
  },

  /** Reuse a cached summary made by another model (`docs/06` §11.2). */
  cacheIgnoreModel: {
    key: PREF_KEYS.cacheIgnoreModel,
    type: "boolean",
    default: false,
  },

  /**
   * The last-seen prompt-version set `docs/07` §9.3 compares at startup, as a
   * JSON object (prompt ID → version string). The reader parses it. Name
   * confirmed by the owner 2026-10-20 (`plan/00` §6 item 241).
   */
  cacheLastSeenPromptVersions: {
    key: PREF_KEYS.cacheLastSeenPromptVersions,
    type: "string",
    default: "{}",
  },

  /** The **global** cache cap in MB (`docs/07` §9.2). §8.5: 100–5000. */
  cacheMaxSizeMB: {
    key: PREF_KEYS.cacheMaxSizeMB,
    type: "integer",
    default: 500,
    min: 100,
    max: 5000,
  },

  // -------------------------------------------------------------------------
  // Report & audio — docs/07 §8.5, "Report & audio" (P3-T32: this row only)
  // -------------------------------------------------------------------------

  /** Write one child note per paper (`docs/06` §14.2). Opt-in. */
  reportPerPaperNotes: {
    key: PREF_KEYS.reportPerPaperNotes,
    type: "boolean",
    default: false,
  },

  // -------------------------------------------------------------------------
  // Runtime & concurrency — docs/07 §8.5, "Runtime & concurrency"
  // -------------------------------------------------------------------------

  /**
   * The `llm` worker-pool size (`docs/07` §7.2), and the plugin's single
   * concurrency setting. §8.5: 1–8, default 3 (P3-T32).
   */
  concurrency: {
    key: PREF_KEYS.concurrency,
    type: "integer",
    default: 3,
    min: 1,
    max: 8,
  },

  /**
   * HTTP timeout in seconds. §8.5: 10–600 (step 10 is the widget's), default 60.
   *
   * `timeoutSeconds` × 1000 is the `timeout` passed to `Zotero.HTTP.request`;
   * `60` deliberately doubles Zotero's own 30 000 ms default because LLM calls
   * are long (§7.3).
   */
  timeoutSeconds: {
    key: PREF_KEYS.timeoutSeconds,
    type: "integer",
    default: 60,
    min: 10,
    max: 600,
  },

  /**
   * Per-job spend ceiling in **whole US cents** (shown and accepted as dollars;
   * P3-T39). **`0` means off, and it ships off**: §8.5's default, and changing
   * it is gate `G-20`, not a card's choice (P3-T32).
   */
  runMaxSpendCents: {
    key: PREF_KEYS.runMaxSpendCents,
    type: "integer",
    default: 0,
    min: 0,
  },

  /**
   * Per-Zotero-session spend ceiling in whole US cents (NFR-5). Ships off at
   * `0`, as `runMaxSpendCents`; the running total lives in memory and is never
   * persisted.
   */
  runMaxSessionSpendCents: {
    key: PREF_KEYS.runMaxSessionSpendCents,
    type: "integer",
    default: 0,
    min: 0,
  },

  /**
   * How far the pref migrations of §8.5.3 have got. `0` means none has run.
   *
   * Ships at `0` with **no migration entry**, and that is correct rather than
   * incomplete: §8.5.3 is explicit that renames applied *before* first release
   * need no migration entry, only document updates. A pref that has shipped may
   * only be renamed with an entry in `src/bootstrap/migrations.ts`.
   */
  prefsSchemaVersion: {
    key: PREF_KEYS.prefsSchemaVersion,
    type: "integer",
    default: 0,
    min: 0,
  },

  // -------------------------------------------------------------------------
  // Diagnostics — docs/07 §8.5, "Diagnostics"
  // -------------------------------------------------------------------------

  /**
   * Log verbosity. §8.5: `error` | `warn` | `info` | `debug`, default `warn`.
   * The union matches `src/core/logger.ts`'s `LogLevel` and
   * `DEFAULT_LOG_LEVEL`.
   *
   * **There is deliberately no `debug` boolean.** `docs/08` §7.3's "Verbose
   * debug logging" checkbox writes `debug` when checked and `warn` when
   * unchecked; §8.5's Diagnostics block records that an earlier draft shipped a
   * separate boolean and that it was removed, "because two switches over one
   * logger is exactly how a checkbox and a level drift apart". `P1-T03`'s
   * **Do NOT** repeats the ban.
   */
  logLevel: {
    key: PREF_KEYS.logLevel,
    type: "string",
    default: "warn",
    values: ["error", "warn", "info", "debug"],
  },

  /**
   * Log request and response bodies.
   *
   * A **content** switch, not a verbosity one, which is why the checkbox above
   * does not touch it and why raising `logLevel` never turns it on. It must
   * never write a credential whatever its value: `docs/09` §2.1's
   * `KEYISH_FIELD` / `KEY_PATTERNS` redaction runs at the logger regardless
   * (`src/core/errors.ts`, `src/core/logger.ts`).
   */
  logRequestBodies: {
    key: PREF_KEYS.logRequestBodies,
    type: "boolean",
    default: false,
  },

  // -------------------------------------------------------------------------
  // Non-secret key-presence flags — docs/07 §8.5, last block
  //
  // Per decision D5 and docs/09 §1.7, NO API KEY IS EVER A PREFERENCE. These
  // exist so the prefs pane can render a status row without a keychain
  // round-trip on every paint. They are written by the SecretStore and read by
  // the pane; nothing else may write them.
  // -------------------------------------------------------------------------

  /**
   * Whether an NCBI API key is in the keystore — **never the key**.
   *
   * Phase 1's with-key/no-key rate-limit switch reads this (`P1-T06`, `P1-T08`):
   * a keyed caller gets 10 req/s from E-utilities, an unkeyed one 3 req/s
   * (`docs/02` §3.1). §8.5 notes that a wrong or expired NCBI key does not
   * error — it silently drops the user back to 3 req/s — which is why the
   * validation-result row exists at all.
   */
  ncbiKeyPresent: {
    key: PREF_KEYS.ncbiKeyPresent,
    type: "boolean",
    default: false,
  },

  /**
   * Whether a Semantic Scholar API key is in the keystore — **never the key**
   * (`P2-T05`; `docs/07` §8.5's `semanticscholar.keyPresent` row, default
   * `false`; `docs/09` §1.7 assigns the `source.semanticscholar` `SecretId`).
   *
   * A presence flag only. The adapter does not read it — it asks the
   * `SecretStore` for the key at request time (`docs/02` §6.4's `x-api-key`)
   * — and `docs/07` §7.3's `api.semanticscholar.org` row has no keyed mode to
   * select, so nothing paces on it; it exists for the preferences pane's
   * status row (`docs/08` §7.3).
   *
   * `P2-T05` spelled the key string here because `src/prefs/keys.ts` was
   * outside its `Files`; `P3-T32` moved it into `PREF_KEYS` (2026-10-20), so
   * every `pref()` line in `addon/prefs.js` now names a `PREF_KEYS` entry. Its
   * writer is
   * `src/zotero/keychain.ts`'s `KEY_PRESENCE_PREFS` row for
   * `source.semanticscholar` (added 2026-10-15, `plan/00` §6 item 169): storing
   * or clearing the key through the pane re-derives this flag.
   */
  semanticscholarKeyPresent: {
    key: PREF_KEYS.semanticscholarKeyPresent,
    type: "boolean",
    default: false,
  },

  /**
   * Whether an OpenRouter key is in the keystore — **never the key** (P3-T32).
   * Written by the `SecretStore` and read by the pane, like `ncbiKeyPresent`.
   */
  openrouterKeyPresent: {
    key: PREF_KEYS.openrouterKeyPresent,
    type: "boolean",
    default: false,
  },

  /** Whether an OpenAI key is in the keystore, as `openrouterKeyPresent`. */
  openaiKeyPresent: {
    key: PREF_KEYS.openaiKeyPresent,
    type: "boolean",
    default: false,
  },

  /** Whether a Gemini key is in the keystore, as `openrouterKeyPresent`. */
  geminiKeyPresent: {
    key: PREF_KEYS.geminiKeyPresent,
    type: "boolean",
    default: false,
  },

  /** Whether an Anthropic key is in the keystore, as `openrouterKeyPresent`. */
  anthropicKeyPresent: {
    key: PREF_KEYS.anthropicKeyPresent,
    type: "boolean",
    default: false,
  },

  /**
   * When the OpenRouter key was last validated: an ISO 8601 timestamp, or
   * empty. No `values`: §8.5 gives a shape, not a closed set. One such row per
   * credential-holding ID — the same six as `*.keyPresent` (P3-T32).
   */
  openrouterLastValidatedAt: {
    key: PREF_KEYS.openrouterLastValidatedAt,
    type: "string",
    default: "",
  },

  /** As `openrouterLastValidatedAt`, for OpenAI. */
  openaiLastValidatedAt: {
    key: PREF_KEYS.openaiLastValidatedAt,
    type: "string",
    default: "",
  },

  /** As `openrouterLastValidatedAt`, for Gemini. */
  geminiLastValidatedAt: {
    key: PREF_KEYS.geminiLastValidatedAt,
    type: "string",
    default: "",
  },

  /** As `openrouterLastValidatedAt`, for Anthropic. */
  anthropicLastValidatedAt: {
    key: PREF_KEYS.anthropicLastValidatedAt,
    type: "string",
    default: "",
  },

  /** As `openrouterLastValidatedAt`, for NCBI. */
  ncbiLastValidatedAt: {
    key: PREF_KEYS.ncbiLastValidatedAt,
    type: "string",
    default: "",
  },

  /** As `openrouterLastValidatedAt`, for Semantic Scholar. */
  semanticscholarLastValidatedAt: {
    key: PREF_KEYS.semanticscholarLastValidatedAt,
    type: "string",
    default: "",
  },

  /**
   * The OpenRouter key's last validation outcome — a **status**, never any part
   * of the key. `""` means never validated. One such row per credential-holding
   * ID, all six: the owner extended it from the four LLM providers on
   * 2026-09-09 because a bad NCBI or Semantic Scholar key fails silently
   * (P3-T32).
   */
  openrouterLastValidationResult: {
    key: PREF_KEYS.openrouterLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /** As `openrouterLastValidationResult`, for OpenAI. */
  openaiLastValidationResult: {
    key: PREF_KEYS.openaiLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /** As `openrouterLastValidationResult`, for Gemini. */
  geminiLastValidationResult: {
    key: PREF_KEYS.geminiLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /** As `openrouterLastValidationResult`, for Anthropic. */
  anthropicLastValidationResult: {
    key: PREF_KEYS.anthropicLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /** As `openrouterLastValidationResult`, for NCBI. */
  ncbiLastValidationResult: {
    key: PREF_KEYS.ncbiLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /** As `openrouterLastValidationResult`, for Semantic Scholar. */
  semanticscholarLastValidationResult: {
    key: PREF_KEYS.semanticscholarLastValidationResult,
    type: "string",
    default: "",
    values: VALIDATION_RESULT_VALUES,
  },

  /**
   * Which secret backend is live, for the prefs pane's storage badge.
   *
   * §8.5's spellings, which are **not** `docs/09` §1.7's `SecretBackend` union
   * (`os-keychain` | `session-only`): §8.5 is the authority for the
   * *preference's* allowed values and this row is what it declares. `""`
   * means the backend has not been probed yet, or no store is installed.
   *
   * *Corrected 2026-10-22 (`plan/00` §6 item 268, recorded from `P3-T03`):*
   * the value set also listed `passphrase`, which §8.5 dropped on 2026-10-21
   * (item 267) because tier 3 does not ship in v1 (gate `G-10`). Nothing ever
   * wrote it; a stored `passphrase` now reads as the default, `""`.
   */
  secretBackend: {
    key: PREF_KEYS.secretBackend,
    type: "string",
    default: "",
    values: ["oskeystore", "session", ""],
  },
} as const satisfies Record<string, PrefDef<unknown>>;

/** The name plugin code passes to `getPref` / `setPref`. */
export type PrefName = keyof typeof PREFS;

/**
 * Widen a literal default back to the type it is a member of.
 *
 * **This repairs a defect in `docs/07` §8.5.1's sketch.** That section writes
 * `export type PrefValue<K extends PrefName> = (typeof PREFS)[K]["default"]`
 * beside a `PREFS` declared `as const` — so `PrefValue<"searchYears">` is the
 * literal type `3`, and `setPref("searchYears", 5)` is a compile error while
 * `getPref("searchYears")` is typed as being unable to return anything but `3`.
 * `as const` is load-bearing for `PrefName` and for the `key` strings, so the
 * widening belongs here rather than in the declaration.
 */
type Widen<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

/** The value type a preference holds — `boolean`, `number` or `string`. */
export type PrefValue<K extends PrefName> = Widen<(typeof PREFS)[K]["default"]>;

/** Every declared preference name, in declaration order. */
export const PREF_NAMES = Object.keys(PREFS) as readonly PrefName[];

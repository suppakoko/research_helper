/**
 * What the user is told before content leaves the machine — as data, for the
 * cost dialog to embed.
 *
 * **Scope.** `P3-T15` steps 5–8; `docs/09-security-privacy-and-api-keys.md`
 * §3.6. The disclosure is **not a second dialog**: `P3-T16`'s cost dialog
 * renders it (§3.6 item 1, "privacy information goes in the same dialog"). It
 * is built here, in `pipeline/`, because `ui/` may not reach
 * `resolveBaseUrl()` in `llm/` (`docs/07` §2.3) and the dialog must name the
 * **effective** host, an override's rather than the provider's default
 * (`docs/03` §14.4).
 *
 * ## What suppresses what
 *
 * - `privacy.egressAcknowledged` decides only whether the **first-job notice**
 *   is shown. It suppresses nothing else: the disclosure is built for every
 *   job, and the Gemini warning is unaffected by it (§3.6's second paragraph).
 *   It is written `true` by {@link settleDisclosure}, once, when the user
 *   confirms a dialog that carried the notice — never on cancel, never from
 *   anywhere else (`docs/07` §8.5's row).
 * - "Don't ask again for this collection" ({@link mustAskConfirmation})
 *   suppresses only the **routine** confirmation. A change of provider, a
 *   change of privacy mode, the first full-text send, the Gemini free-or-
 *   unknown warning and the first-job notice each force the question (§3.6
 *   item 2).
 * - The Gemini free-tier warning has **no** suppression path: it is on every
 *   disclosure whose provider is Gemini and whose tier is not a proven
 *   `"paid"` — an unknown tier is the free tier (§3.4 rule 4).
 * - **A Gemini key the user declared paid** (`gemini.paidTier`; owner,
 *   2026-10-22, `plan/00` §6 item 269(b); §3.6 item 3's extension): the
 *   warning is replaced, on every job, by a one-line reminder that the key is
 *   declared paid. The reminder has no suppression path either: it is on
 *   every Gemini disclosure while the declaration stands, and it forces the
 *   question as the warning does. The preference is read on demand, each time
 *   a Gemini disclosure is built.
 *
 * ## A report run's own notice (`P4-T16`)
 *
 * A trend-report run sends the **generated summaries** of the papers it
 * analyses, their titles, years and venues and the cluster statistics
 * (`docs/09` §3 row 3b), to up to three models of the one active provider —
 * `summaryModel` for the summaries it still makes, `reportModel`, and the
 * critique model. Given a `report` input, {@link buildEgressDisclosure} puts
 * {@link L10N_EGRESS_REPORT_NOTICE} first among the notices and adds a
 * {@link ReportEgressNotice} naming every model once (`docs/07` §4.5's note of
 * 2026-10-27). The notice forces nothing on its own:
 * {@link mustAskConfirmation} is unchanged. Without a `report` input — every
 * other job — the disclosure is exactly what it was.
 *
 * ## A collection profile's own notice (`P5-T22`)
 *
 * A recommend run's one model call sends one metadata line per paper (`docs/09`
 * §3 row 6), to one model. With `profileNotice` on,
 * {@link buildEgressDisclosure} puts {@link L10N_EGRESS_PROFILE_NOTICE} first
 * among the notices; the cost dialog fills its arguments from the disclosure's
 * `itemCount` and `modelId`, so it needs no member of its own. Like the report's,
 * it forces nothing.
 *
 * ## The egress log
 *
 * §3.6 item 4: the plugin's own job records say which provider received how
 * many items and what scope of content. {@link withEgressLog} puts
 * {@link EgressLogEntry} on the job's `input` as its `egress` member
 * (`docs/07` §4.5's `PrivacyPolicy` note), so the `input` column's redaction
 * gate (`toJobRow`, `src/core/jobQueue/jobRecord.ts`; `redactRecord`,
 * `P3-T36`) is the gate it passes. It is local only: nothing here sends it
 * anywhere.
 */

import type { JobRecord } from "../../core/jobQueue/jobRecord";
import type { ResumeVerdict } from "../../core/jobQueue/queue";
import {
  L10N_EGRESS_FIRST_JOB_NOTICE,
  L10N_EGRESS_GEMINI_DECLARED_PAID,
  L10N_EGRESS_GEMINI_FREE_TIER,
  L10N_EGRESS_PROFILE_NOTICE,
  L10N_EGRESS_REPORT_NOTICE,
} from "../../i18n/keys";
import type { GeminiTier } from "../../llm/gemini/tierDetect";
import type { BaseUrlResolver } from "../../llm/shared/baseUrl";
import type { ProviderId } from "../../model/ids";
import { getPref, setPref } from "../../prefs";

import type {
  InputScopeKind,
  PrivacyMode,
  RoutineConfirmation,
} from "./privacyPolicy";

// ===========================================================================
// 1. The disclosure
// ===========================================================================

/** How many items go with each scope (`docs/07` §5.2's `SummaryInputScope` kinds). */
export type EgressContentScope = { readonly [K in InputScopeKind]: number };

/** One notice the dialog shows, as its Fluent id. */
export type EgressNoticeId =
  | typeof L10N_EGRESS_REPORT_NOTICE
  | typeof L10N_EGRESS_PROFILE_NOTICE
  | typeof L10N_EGRESS_FIRST_JOB_NOTICE
  | typeof L10N_EGRESS_GEMINI_FREE_TIER
  | typeof L10N_EGRESS_GEMINI_DECLARED_PAID;

/** The models one report run sends to, all on the active provider. */
export interface ReportEgressModels {
  /** `summaryModel`, when the run makes a summary first; absent otherwise. */
  readonly map?: string;
  /** `reportModel`: clustering, theme analyses, the report and its rewrites. */
  readonly report: string;
  /** The critique model, when `report.maxCritiqueRounds` is above 0. */
  readonly critique?: string;
}

/** What a report run's notice is built from (`docs/09` §3 row 3b). */
export interface ReportEgressInput {
  /** The summaries the synthesis sends: one per analysed paper. */
  readonly papers: number;
  readonly models: ReportEgressModels;
}

/** A report run's notice, as data: how many summaries, and every model. */
export interface ReportEgressNotice {
  readonly papers: number;
  /** Distinct, in the order map, report, critique. */
  readonly modelIds: readonly string[];
}

/** What a disclosure is built from. */
export interface EgressDisclosureInput {
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** The mode in force for the job (`PrivacyPolicy.mode`). */
  readonly privacyMode: PrivacyMode;
  /** One planned scope per item (`planInputScopeKind`). */
  readonly items: readonly InputScopeKind[];
  /** The Gemini key's tier; absent counts as unknown, which is free. */
  readonly geminiTier?: GeminiTier;
  /**
   * A trend-report run (`P4-T16`): its own notice. For a report run,
   * `modelId` is the report model and `items` the planned scopes of the
   * summaries it still makes. Absent for every other job.
   */
  readonly report?: ReportEgressInput;
  /**
   * A collection profile's call (`P5-T22`): show its notice. `items` holds one
   * `metadata-only` per line sent. Caller: `planProfileCall`.
   */
  readonly profileNotice?: boolean;
}

/** The disclosure, as data (`docs/09` §3.6 item 1). */
export interface EgressDisclosure {
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** The host the content and the key go to: an override's, when one is set. */
  readonly host: string;
  readonly itemCount: number;
  readonly scope: EgressContentScope;
  readonly privacyMode: PrivacyMode;
  /** `privacy.egressAcknowledged` is `false`: the first-job notice is shown. */
  readonly firstJobNotice: boolean;
  /**
   * Provider Gemini with a tier that is not a proven `"paid"`, and not
   * declared paid by the user.
   */
  readonly geminiFreeTierWarning: boolean;
  /**
   * Provider Gemini and `gemini.paidTier` on: the one-line reminder that
   * replaces the free-tier warning (item 269(b)). Never both.
   */
  readonly geminiDeclaredPaidReminder: boolean;
  /** The notices to show, in order; none of them can be turned off here. */
  readonly noticeIds: readonly EgressNoticeId[];
  /** A report run's notice; the member is absent for every other job. */
  readonly report?: ReportEgressNotice;
}

/** What {@link buildEgressDisclosure} reads. */
export interface EgressDisclosureDeps {
  /** `src/llm/shared/baseUrl.ts`'s resolver, for the effective host. */
  readonly baseUrls: Pick<BaseUrlResolver, "effectiveHost">;
  /** `privacy.egressAcknowledged`; the preference by default. */
  readonly egressAcknowledged?: () => boolean;
  /**
   * `gemini.paidTier`; the preference by default. Called only for a Gemini
   * disclosure, every time one is built (on demand, never cached).
   */
  readonly geminiPaidTier?: () => boolean;
}

/** Every scope kind at zero. */
function emptyScope(): Record<InputScopeKind, number> {
  return {
    "metadata-only": 0,
    abstract: 0,
    "abstract+fulltext": 0,
    "abstract+notes": 0,
  };
}

/** A report run's notice: its paper count and its models, each once. */
function reportNotice(input: ReportEgressInput): ReportEgressNotice {
  const { map, report, critique } = input.models;
  const modelIds: string[] = [];
  for (const id of [map, report, critique]) {
    if (id !== undefined && !modelIds.includes(id)) modelIds.push(id);
  }
  return { papers: input.papers, modelIds };
}

/**
 * Build the disclosure the cost dialog embeds (`docs/09` §3.6 item 1):
 * provider and model, the **effective** host, the item count, what is sent
 * per scope, and the mode in force — plus the first-job notice while
 * `privacy.egressAcknowledged` is `false`, and the Gemini warning whenever the
 * tier is free or unknown — or, when the user declared the key paid
 * (`gemini.paidTier`), the declared-paid reminder in its place. A report run
 * (`input.report`) also gets its own notice, first (`P4-T16`).
 *
 * @param input - the job's provider, model, mode and planned scopes
 * @param deps - see {@link EgressDisclosureDeps}
 * @returns the disclosure
 */
export function buildEgressDisclosure(
  input: EgressDisclosureInput,
  deps: EgressDisclosureDeps,
): EgressDisclosure {
  const scope = emptyScope();
  for (const kind of input.items) scope[kind] += 1;
  const acknowledged =
    deps.egressAcknowledged?.() ?? getPref("privacyEgressAcknowledged");
  const firstJobNotice = acknowledged !== true;
  const gemini = input.providerId === "gemini";
  // Read only for Gemini, and on every build: the declaration can change
  // between two jobs.
  const geminiDeclaredPaidReminder =
    gemini && (deps.geminiPaidTier?.() ?? getPref("geminiPaidTier")) === true;
  const geminiFreeTierWarning =
    gemini && !geminiDeclaredPaidReminder && input.geminiTier !== "paid";
  const noticeIds: EgressNoticeId[] = [];
  // Before the first-job notice, whose "the content listed above" includes it.
  if (input.report !== undefined) noticeIds.push(L10N_EGRESS_REPORT_NOTICE);
  if (input.profileNotice === true) noticeIds.push(L10N_EGRESS_PROFILE_NOTICE);
  if (firstJobNotice) noticeIds.push(L10N_EGRESS_FIRST_JOB_NOTICE);
  if (geminiFreeTierWarning) noticeIds.push(L10N_EGRESS_GEMINI_FREE_TIER);
  if (geminiDeclaredPaidReminder) {
    noticeIds.push(L10N_EGRESS_GEMINI_DECLARED_PAID);
  }
  const disclosure: EgressDisclosure = {
    providerId: input.providerId,
    modelId: input.modelId,
    host: deps.baseUrls.effectiveHost(input.providerId),
    itemCount: input.items.length,
    scope,
    privacyMode: input.privacyMode,
    firstJobNotice,
    geminiFreeTierWarning,
    geminiDeclaredPaidReminder,
    noticeIds,
  };
  // The member exists only for a report run, so every other disclosure is
  // byte-identical to what it was before P4-T16.
  return input.report === undefined
    ? disclosure
    : { ...disclosure, report: reportNotice(input.report) };
}

/** What {@link settleDisclosure} writes through. */
export interface SettleDisclosureDeps {
  /** Record the acknowledgement; `setPref("privacyEgressAcknowledged", true)` by default. */
  readonly acknowledge?: () => void;
}

/**
 * The user answered the dialog that carried `disclosure`.
 *
 * Writes `privacy.egressAcknowledged` = `true` exactly once, and only when the
 * user **confirmed** a dialog that showed the first-job notice. A cancel
 * writes nothing; a confirm with the notice already acknowledged writes
 * nothing (`docs/07` §8.5: "written once").
 *
 * @param disclosure - what the dialog showed
 * @param outcome - the user's answer
 * @param deps - see {@link SettleDisclosureDeps}
 */
export function settleDisclosure(
  disclosure: EgressDisclosure,
  outcome: "confirmed" | "cancelled",
  deps: SettleDisclosureDeps = {},
): void {
  if (outcome !== "confirmed" || !disclosure.firstJobNotice) return;
  if (deps.acknowledge !== undefined) deps.acknowledge();
  else setPref("privacyEgressAcknowledged", true);
}

// ===========================================================================
// 2. "Don't ask again for this collection" (docs/09 §3.6 item 2)
// ===========================================================================

/** Why the confirmation must be asked although the collection suppressed it. */
export type ConfirmationReason =
  | "not-suppressed"
  | "provider-changed"
  | "privacy-mode-changed"
  | "first-full-text"
  | "gemini-free-tier"
  | "gemini-declared-paid"
  | "first-job-notice";

/** Whether to ask, and every reason that forces it. */
export interface ConfirmationDecision {
  readonly ask: boolean;
  readonly reasons: readonly ConfirmationReason[];
}

/** True when the disclosure sends full text for any item. */
function sendsFullText(disclosure: EgressDisclosure): boolean {
  return disclosure.scope["abstract+fulltext"] > 0;
}

/**
 * Whether the routine confirmation may be skipped for a collection that
 * ticked "don't ask again".
 *
 * It is skipped only when every reason below is absent: no record; a different
 * provider; a different mode in force; full text sent now but not under the
 * record; the Gemini free-or-unknown warning; the Gemini declared-paid
 * reminder that replaces it (item 269(b)); the first-job notice. Each is one
 * §3.6 items 2–3 name as never suppressed, except the last, which is the
 * acknowledgement the notice exists to collect.
 *
 * @param disclosure - this job's disclosure
 * @param suppression - the collection's stored record, if any
 * @returns whether to ask, and why
 */
export function mustAskConfirmation(
  disclosure: EgressDisclosure,
  suppression: RoutineConfirmation | undefined,
): ConfirmationDecision {
  const reasons: ConfirmationReason[] = [];
  if (suppression === undefined) {
    reasons.push("not-suppressed");
  } else {
    if (suppression.providerId !== disclosure.providerId) {
      reasons.push("provider-changed");
    }
    if (suppression.privacyMode !== disclosure.privacyMode) {
      reasons.push("privacy-mode-changed");
    }
    if (sendsFullText(disclosure) && !suppression.fullText) {
      reasons.push("first-full-text");
    }
  }
  if (disclosure.geminiFreeTierWarning) reasons.push("gemini-free-tier");
  if (disclosure.geminiDeclaredPaidReminder) {
    reasons.push("gemini-declared-paid");
  }
  if (disclosure.firstJobNotice) reasons.push("first-job-notice");
  return { ask: reasons.length > 0, reasons };
}

/**
 * The record to store in `collection_settings` when the user ticks "don't
 * ask again" on this disclosure (`writeCollectionPrivacySettings` with
 * `routineConfirmation`).
 *
 * @param disclosure - the disclosure the user confirmed
 * @returns the record
 */
export function routineConfirmationFor(
  disclosure: EgressDisclosure,
): RoutineConfirmation {
  return {
    providerId: disclosure.providerId,
    privacyMode: disclosure.privacyMode,
    fullText: sendsFullText(disclosure),
  };
}

// ===========================================================================
// 3. The egress log (docs/09 §3.6 item 4)
// ===========================================================================

/** One job's egress record: who received how many items, and what scope. */
export interface EgressLogEntry {
  readonly providerId: ProviderId;
  readonly host: string;
  readonly modelId: string;
  readonly itemCount: number;
  readonly scope: EgressContentScope;
  readonly privacyMode: PrivacyMode;
  readonly confirmedAtEpochMs: number;
  /** A report run's notice: every model it sent to (`P4-T16`). */
  readonly report?: ReportEgressNotice;
}

/**
 * The log entry for a confirmed disclosure.
 *
 * @param disclosure - what the user confirmed
 * @param confirmedAtEpochMs - when (`Clock.now()`)
 * @returns the entry
 */
export function egressLogEntry(
  disclosure: EgressDisclosure,
  confirmedAtEpochMs: number,
): EgressLogEntry {
  const entry: EgressLogEntry = {
    providerId: disclosure.providerId,
    host: disclosure.host,
    modelId: disclosure.modelId,
    itemCount: disclosure.itemCount,
    scope: { ...disclosure.scope },
    privacyMode: disclosure.privacyMode,
    confirmedAtEpochMs,
  };
  return disclosure.report === undefined
    ? entry
    : {
        ...entry,
        report: {
          papers: disclosure.report.papers,
          modelIds: [...disclosure.report.modelIds],
        },
      };
}

/**
 * A job input carrying its egress log, for `JobQueue.enqueue`. The queue
 * stores `input` through the redaction gate (`toJobRow`), so the log is gated
 * there and nowhere else.
 *
 * @param input - the pipeline's own input object
 * @param entry - from {@link egressLogEntry}
 * @returns `input` with an `egress` member
 */
export function withEgressLog<T extends object>(
  input: T,
  entry: EgressLogEntry,
): T & { readonly egress: EgressLogEntry } {
  return { ...input, egress: entry };
}

/**
 * The egress log a stored job carries, or `undefined` when it has none.
 *
 * @param record - the job record, as read back
 * @returns the entry
 */
export function readEgressLog(
  record: Pick<JobRecord, "input">,
): EgressLogEntry | undefined {
  const input = record.input;
  if (typeof input !== "object" || input === null) return undefined;
  const egress = (input as { egress?: unknown }).egress;
  if (typeof egress !== "object" || egress === null) return undefined;
  return egress as EgressLogEntry;
}

// ===========================================================================
// 4. The resume guard (plan/00 §6 item 250)
// ===========================================================================

/**
 * `ResumeGuards.egress` (`src/core/jobQueue/queue.ts`): a job interrupted by
 * a quit resumes on its own only once `privacy.egressAcknowledged` is set;
 * otherwise it waits `paused` with reason `egress-unacknowledged`. The
 * composition root installs it (`P3-T35`).
 *
 * @param acknowledged - `privacy.egressAcknowledged`; the preference by default
 * @returns the guard
 */
export function createEgressResumeGuard(
  acknowledged: () => boolean = () => getPref("privacyEgressAcknowledged"),
): (record: JobRecord) => Promise<ResumeVerdict> {
  return () =>
    Promise.resolve(
      acknowledged()
        ? { proceed: true }
        : { proceed: false, pauseReason: "egress-unacknowledged" },
    );
}

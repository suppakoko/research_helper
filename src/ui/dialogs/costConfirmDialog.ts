/**
 * The cost confirmation dialog (`P3-T16` step 2; `docs/06` §5.4, `docs/10`
 * FR-24, `docs/09` §3.6): the number shown before any paid run, the second
 * acknowledgement above `summary.confirmAboveCents`, the abstract-only
 * downgrade, the egress disclosure, and the question a reached spend ceiling
 * asks.
 *
 * **One dialog, two moments.**
 *
 * - `preflight` — before the first call. It shows the estimate of the plan the
 *   user would run (`estimateRun`, `src/pipeline/shared/estimate.ts`) and
 *   embeds `P3-T15`'s disclosure (`buildEgressDisclosure`) — provider, model,
 *   the **effective** host, what is sent, the privacy mode, and every notice,
 *   including the Gemini warning or the declared-paid reminder. It is **not a
 *   second dialog** (`docs/09` §3.6 item 1). When the estimate would pass a
 *   spend ceiling, the same dialog names that ceiling and says that running
 *   raises it for this run only: the job pauses before its first call and
 *   asks (`plan/00` §6 item 234).
 * - `ceiling` — a `BudgetExceededError` mid-run paused the job (`budget-stop`).
 *   It shows the spend so far and asks: continue (raise the ceiling for this
 *   run) or stop. Every summary already made is kept either way.
 *
 * **When it opens** ({@link shouldOpenCostDialog}): `docs/09` §3.6's dated
 * note "how item 2 meets 'always show the dialog'" (2026-10-23). The routine
 * confirmation follows `mustAskConfirmation`; a confirmation forced by money —
 * above the threshold, an unknown price, a ceiling — opens it whatever the
 * collection's "don't ask again" says. When it does not open, the job's
 * progress line still carries the number ({@link skippedNoticeLine}).
 *
 * **Never silent.** The downgrade is pre-selected above
 * `summary.fullTextAutoMaxPapers`, never applied without the dialog; the
 * second acknowledgement is enforced here again ({@link decideCostDialog}), so
 * a window that reports "accepted" without it runs nothing.
 *
 * ### Why this takes a window rather than fetching one
 *
 * As `./secretBackendDialog.ts` explains: `src/ui/**` may not reference the
 * `Zotero` global or import `src/llm/**` (`docs/07` §2.3). The window and the
 * locale are parameters; `src/bootstrap/registerUI.ts` supplies them. Every
 * figure is formatted here with `Intl` over that locale (`docs/08` §10.3), so
 * the window script only places Fluent ids and arguments.
 */

import { config } from "../../../package.json";
import type { MainWindowMessageId } from "../../i18n/keys";
import {
  isEstimatedSpend,
  type CeilingKind,
  type CeilingStop,
  type SpendTotals,
} from "../../pipeline/shared/budget";
import type {
  ConfirmationDecision,
  EgressDisclosure,
} from "../../pipeline/shared/egressDisclosure";
import {
  secondAcknowledgementFor,
  type RunEstimate,
  type RunPlan,
  type SecondAcknowledgementReason,
} from "../../pipeline/shared/estimate";

// ===========================================================================
// 1. Strings and window constants
// ===========================================================================

/**
 * Every id the dialog and its callers use, in `research-helper-mainWindow.ftl`
 * (`docs/08` §10.1: a dialog raised from the main window is not a surface of
 * its own). Typed against {@link MainWindowMessageId}, so an id missing from
 * that list does not compile. `addon/content/costConfirm.js` repeats the ones
 * it sets itself.
 */
export const COST_DIALOG_L10N = {
  title: "research-helper-cost-title",
  items: "research-helper-cost-items",
  destination: "research-helper-cost-destination",
  calls: "research-helper-cost-calls",
  input: "research-helper-cost-input",
  output: "research-helper-cost-output",
  total: "research-helper-cost-total",
  unpriced: "research-helper-cost-unpriced",
  disclaimer: "research-helper-cost-disclaimer",
  aboveThreshold: "research-helper-cost-above-threshold",
  acknowledge: "research-helper-cost-acknowledge",
  acknowledgeUnpriced: "research-helper-cost-acknowledge-unpriced",
  downgrade: "research-helper-cost-downgrade",
  downgradePreselected: "research-helper-cost-downgrade-preselected",
  ceilingPreflight: "research-helper-cost-ceiling-preflight",
  ceilingReached: "research-helper-cost-ceiling-reached",
  usageJob: "research-helper-cost-usage-job",
  usageSession: "research-helper-cost-usage-session",
  usageEstimated: "research-helper-cost-usage-estimated",
  dontAskAgain: "research-helper-cost-dont-ask",
  run: "research-helper-cost-run",
  cancel: "research-helper-cost-cancel",
  continue: "research-helper-cost-continue",
  stop: "research-helper-cost-stop",
  skippedNotice: "research-helper-cost-skipped-notice",
} as const satisfies Record<string, MainWindowMessageId>;

/** The document the window loads. */
export const COST_DIALOG_URL = `chrome://${config.addonRef}/content/costConfirm.xhtml`;

/** The window name's prefix; each dialog gets its own, so two jobs never share one. */
export const COST_DIALOG_NAME_PREFIX = "research-helper-cost-confirm-";

/** Non-modal: the library stays usable while the job waits for the answer. */
export const COST_DIALOG_FEATURES =
  "chrome,titlebar,centerscreen,dialog=yes,resizable=yes";

/** The dialog root, for `Zotero.UIProperties.registerRoot()` in the window script. */
export const COST_DIALOG_ROOT_ID = "rh-cost-dialog";

/** One Fluent message to place: an id and its already-formatted arguments. */
export interface FluentLine {
  readonly id: MainWindowMessageId;
  readonly args?: Readonly<Record<string, string | number>>;
}

// ===========================================================================
// 2. Formatting (docs/08 §10.3: the caller formats with Intl)
// ===========================================================================

/**
 * US dollars for display. A positive amount under one cent keeps four
 * decimals, so a $0.004 call does not read "$0.00".
 */
export function formatUsd(usd: number, locale: string): string {
  const small = usd > 0 && usd < 0.01;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? 4 : 2,
  }).format(usd);
}

/** A token count, grouped for the locale. */
export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

/** A price table's date, in UTC (the tables are dated, not timed). */
export function formatDate(epochMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(epochMs);
}

// ===========================================================================
// 3. Whether to open it (docs/09 §3.6's dated note, 2026-10-23)
// ===========================================================================

/** Why the dialog opens. */
export type CostDialogReason =
  "routine" | SecondAcknowledgementReason | "ceiling";

/** The answer of {@link shouldOpenCostDialog}. */
export interface CostDialogDecision {
  readonly open: boolean;
  readonly reasons: readonly CostDialogReason[];
}

/**
 * Whether the pre-run dialog opens. A plan that makes no call sends nothing
 * and costs nothing, so it never does. Otherwise it opens when
 * `mustAskConfirmation` asks, and — whatever the collection's "don't ask
 * again" says — when the cost needs the second acknowledgement (above the
 * threshold, or unknown) or the estimate would pass a ceiling.
 *
 * @param input - the routine decision, the plan, the threshold, and the
 *   ceiling the estimate would pass, if any
 * @returns whether to open, and why
 */
export function shouldOpenCostDialog(input: {
  readonly confirmation: ConfirmationDecision;
  readonly plan: Pick<RunPlan, "calls" | "costUsd">;
  readonly confirmAboveCents: number;
  readonly ceiling: CeilingStop | undefined;
}): CostDialogDecision {
  if (input.plan.calls === 0) return { open: false, reasons: [] };
  const reasons: CostDialogReason[] = [];
  if (input.confirmation.ask) reasons.push("routine");
  const ack = secondAcknowledgementFor(input.plan, input.confirmAboveCents);
  if (ack !== undefined) reasons.push(ack);
  if (input.ceiling !== undefined) reasons.push("ceiling");
  return { open: reasons.length > 0, reasons };
}

/**
 * The line the job's progress shows when the dialog did not open: the number,
 * and that it is an estimate (FR-24). `P3-T29`'s surface renders it.
 *
 * @param plan - the plan that runs; its cost is known (an unknown cost opens
 *   the dialog)
 * @param locale - for `Intl`
 * @returns the line
 */
export function skippedNoticeLine(
  plan: Pick<RunPlan, "calls" | "costUsd">,
  locale: string,
): FluentLine {
  return {
    id: COST_DIALOG_L10N.skippedNotice,
    args: {
      cost: formatUsd(plan.costUsd ?? 0, locale),
      calls: plan.calls,
    },
  };
}

// ===========================================================================
// 4. The model the window renders
// ===========================================================================

/** What the pre-run dialog is built from. */
export interface PreflightDialogInput {
  readonly mode: "preflight";
  readonly estimate: RunEstimate;
  readonly disclosure: EgressDisclosure;
  /** `summary.confirmAboveCents`. */
  readonly confirmAboveCents: number;
  /** `summary.fullTextAutoMaxPapers`, named in the pre-selection line. */
  readonly fullTextAutoMaxPapers: number;
  /** The provider's display name (untranslated, `docs/08` §10.3). */
  readonly providerName: string;
  /** The ceiling the selected plan's estimate would pass (`guard.check`). */
  readonly ceilingSelected: CeilingStop | undefined;
  /** The same for the abstract-only plan. */
  readonly ceilingDowngrade: CeilingStop | undefined;
  /** This session's spend so far, for the usage line. */
  readonly session: SpendTotals;
}

/** What the mid-run question is built from. */
export interface CeilingDialogInput {
  readonly mode: "ceiling";
  readonly stop: CeilingStop;
  /** The estimate for the rest of the job, when known (with headroom). */
  readonly remainingUsd: number | undefined;
  /** The limit "continue" raises to (`suggestedLimitUsd`). */
  readonly raiseToUsd: number;
  readonly usage: { readonly run: SpendTotals; readonly session: SpendTotals };
}

/** Either moment. */
export type CostDialogInput = PreflightDialogInput | CeilingDialogInput;

/** One plan's lines and what confirming it requires. */
export interface PlanView {
  readonly lines: readonly FluentLine[];
  /** FR-24's second acknowledgement, with its checkbox label, or `undefined`. */
  readonly acknowledge: FluentLine | undefined;
  /** The ceiling this plan would pass, and the raise running it applies. */
  readonly raise:
    | {
        readonly ceiling: CeilingKind;
        readonly limitUsd: number;
        readonly line: FluentLine;
      }
    | undefined;
}

/** The pre-run dialog, as data. */
export interface PreflightDialogModel {
  readonly mode: "preflight";
  readonly title: FluentLine;
  /** Items, destination and mode: the disclosure's facts (§3.6 item 1). */
  readonly header: readonly FluentLine[];
  /** The disclosure's notices; none can be turned off here. */
  readonly notices: readonly FluentLine[];
  readonly selected: PlanView;
  /** `undefined` when the run sends no full text: nothing to downgrade. */
  readonly downgrade:
    | {
        readonly label: FluentLine;
        readonly preselected: boolean;
        /** Why it is pre-selected, or `undefined`. */
        readonly note: FluentLine | undefined;
        readonly plan: PlanView;
      }
    | undefined;
  readonly footer: readonly FluentLine[];
  readonly dontAskAgain: FluentLine;
  readonly accept: FluentLine;
  readonly cancel: FluentLine;
}

/** The mid-run question, as data. */
export interface CeilingDialogModel {
  readonly mode: "ceiling";
  readonly title: FluentLine;
  readonly lines: readonly FluentLine[];
  readonly ceiling: CeilingKind;
  readonly raiseToUsd: number;
  readonly accept: FluentLine;
  readonly cancel: FluentLine;
}

/** Either model. */
export type CostDialogModel = PreflightDialogModel | CeilingDialogModel;

function usageLine(
  id: MainWindowMessageId,
  totals: SpendTotals,
  locale: string,
): FluentLine {
  return {
    id,
    args: {
      calls: totals.calls,
      input: formatCount(totals.inputTokens, locale),
      output: formatCount(totals.outputTokens, locale),
      cost: formatUsd(totals.costUsd, locale),
    },
  };
}

function planView(
  plan: RunPlan,
  modelId: string,
  confirmAboveCents: number,
  stop: CeilingStop | undefined,
  locale: string,
): PlanView {
  const lines: FluentLine[] = [
    { id: COST_DIALOG_L10N.calls, args: { calls: plan.calls } },
    {
      id: COST_DIALOG_L10N.input,
      args: { tokens: formatCount(plan.inputTokens, locale) },
    },
    {
      id: COST_DIALOG_L10N.output,
      args: { tokens: formatCount(plan.outputTokens, locale) },
    },
    plan.costUsd === undefined
      ? { id: COST_DIALOG_L10N.unpriced, args: { model: modelId } }
      : {
          id: COST_DIALOG_L10N.total,
          args: { cost: formatUsd(plan.costUsd, locale) },
        },
  ];
  const reason = secondAcknowledgementFor(plan, confirmAboveCents);
  if (reason === "above-threshold") {
    lines.push({
      id: COST_DIALOG_L10N.aboveThreshold,
      args: { threshold: formatUsd(confirmAboveCents / 100, locale) },
    });
  }
  const acknowledge: FluentLine | undefined =
    reason === undefined
      ? undefined
      : reason === "unknown-cost"
        ? { id: COST_DIALOG_L10N.acknowledgeUnpriced }
        : {
            id: COST_DIALOG_L10N.acknowledge,
            args: { cost: formatUsd(plan.costUsd ?? 0, locale) },
          };
  let raise: PlanView["raise"];
  if (stop !== undefined) {
    const limitUsd = Math.ceil(stop.projectedUsd * 100 - 1e-9) / 100;
    raise = {
      ceiling: stop.ceiling,
      limitUsd,
      line: {
        id: COST_DIALOG_L10N.ceilingPreflight,
        args: {
          ceiling: stop.ceiling,
          limit: formatUsd(stop.limitUsd, locale),
          spent: formatUsd(stop.spentUsd, locale),
          raised: formatUsd(limitUsd, locale),
        },
      },
    };
  }
  return { lines, acknowledge, raise };
}

/**
 * The dialog's model for `input`, every figure formatted for `locale`.
 *
 * @param input - either moment
 * @param locale - a BCP 47 tag, the application's
 * @returns the model the window script renders
 */
export function buildCostDialogModel(
  input: CostDialogInput,
  locale: string,
): CostDialogModel {
  if (input.mode === "ceiling") {
    const { stop } = input;
    const lines: FluentLine[] = [
      {
        id: COST_DIALOG_L10N.ceilingReached,
        args: {
          ceiling: stop.ceiling,
          limit: formatUsd(stop.limitUsd, locale),
          spent: formatUsd(stop.spentUsd, locale),
          raised: formatUsd(input.raiseToUsd, locale),
        },
      },
      usageLine(COST_DIALOG_L10N.usageJob, input.usage.run, locale),
      usageLine(COST_DIALOG_L10N.usageSession, input.usage.session, locale),
    ];
    if (
      isEstimatedSpend(input.usage.run) ||
      isEstimatedSpend(input.usage.session)
    ) {
      lines.push({ id: COST_DIALOG_L10N.usageEstimated });
    }
    return {
      mode: "ceiling",
      title: { id: COST_DIALOG_L10N.title },
      lines,
      ceiling: stop.ceiling,
      raiseToUsd: input.raiseToUsd,
      accept: { id: COST_DIALOG_L10N.continue },
      cancel: { id: COST_DIALOG_L10N.stop },
    };
  }

  const { estimate, disclosure } = input;
  const counts = estimate.selected.counts;
  const header: FluentLine[] = [
    {
      id: COST_DIALOG_L10N.items,
      args: {
        items: counts.items,
        fullText: counts.fullText,
        abstract: counts.abstractOnly,
        cached: counts.cached,
        metadata: counts.metadataOnly,
      },
    },
    {
      id: COST_DIALOG_L10N.destination,
      args: {
        provider: input.providerName,
        host: disclosure.host,
        model: disclosure.modelId,
        mode: disclosure.privacyMode,
      },
    },
  ];
  const notices: FluentLine[] = disclosure.noticeIds.map((id) => ({ id }));
  const selected = planView(
    estimate.selected,
    estimate.modelId,
    input.confirmAboveCents,
    input.ceilingSelected,
    locale,
  );
  const downgrade =
    estimate.selected.counts.fullText === 0
      ? undefined
      : {
          label: {
            id: COST_DIALOG_L10N.downgrade,
            args: {
              cost:
                estimate.abstractOnly.costUsd === undefined
                  ? "?"
                  : formatUsd(estimate.abstractOnly.costUsd, locale),
            },
          } satisfies FluentLine,
          preselected: estimate.preselectDowngrade,
          note: estimate.preselectDowngrade
            ? {
                id: COST_DIALOG_L10N.downgradePreselected,
                args: { max: input.fullTextAutoMaxPapers },
              }
            : undefined,
          plan: planView(
            estimate.abstractOnly,
            estimate.modelId,
            input.confirmAboveCents,
            input.ceilingDowngrade,
            locale,
          ),
        };
  const footer: FluentLine[] = [
    usageLine(COST_DIALOG_L10N.usageSession, input.session, locale),
  ];
  if (estimate.pricesAsOfEpochMs !== undefined) {
    footer.push({
      id: COST_DIALOG_L10N.disclaimer,
      args: { date: formatDate(estimate.pricesAsOfEpochMs, locale) },
    });
  }
  return {
    mode: "preflight",
    title: { id: COST_DIALOG_L10N.title },
    header,
    notices,
    selected,
    downgrade,
    footer,
    dontAskAgain: { id: COST_DIALOG_L10N.dontAskAgain },
    accept: { id: COST_DIALOG_L10N.run },
    cancel: { id: COST_DIALOG_L10N.cancel },
  };
}

// ===========================================================================
// 5. The answer, checked again here
// ===========================================================================

/** What the window script reports, once. */
export interface CostDialogAnswer {
  readonly accepted: boolean;
  /** The abstract-only box was ticked. */
  readonly downgrade?: boolean;
  /** The second-acknowledgement box was ticked. */
  readonly acknowledged?: boolean;
  /** "Don't ask again for this collection" was ticked. */
  readonly dontAskAgain?: boolean;
}

/** What the caller does next. */
export type CostDialogOutcome =
  | {
      readonly kind: "run";
      /** Which plan to run. */
      readonly plan: "selected" | "abstract-only";
      /** Raise this ceiling for this run before the first call. */
      readonly raise:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined;
      /** Store `routineConfirmationFor` the disclosure for the collection. */
      readonly dontAskAgain: boolean;
    }
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "continue";
      readonly raise: {
        readonly ceiling: CeilingKind;
        readonly limitUsd: number;
      };
    }
  | { readonly kind: "stop" };

/** Whether an unknown value from the window is a usable answer. */
function asAnswer(value: unknown): CostDialogAnswer {
  if (typeof value !== "object" || value === null) return { accepted: false };
  const v = value as Record<string, unknown>;
  return {
    accepted: v["accepted"] === true,
    downgrade: v["downgrade"] === true,
    acknowledged: v["acknowledged"] === true,
    dontAskAgain: v["dontAskAgain"] === true,
  };
}

/**
 * Turn the window's answer into what happens. Checked again here, whatever
 * the window enforced: an answer that is not an explicit accept, or that skips
 * a required acknowledgement, runs nothing.
 *
 * @param model - the model the window showed
 * @param raw - the window's report, as received
 * @returns the outcome
 */
export function decideCostDialog(
  model: CostDialogModel,
  raw: unknown,
): CostDialogOutcome {
  const answer = asAnswer(raw);
  if (model.mode === "ceiling") {
    return answer.accepted
      ? {
          kind: "continue",
          raise: { ceiling: model.ceiling, limitUsd: model.raiseToUsd },
        }
      : { kind: "stop" };
  }
  if (!answer.accepted) return { kind: "cancelled" };
  const downgrade = answer.downgrade === true && model.downgrade !== undefined;
  const view =
    downgrade && model.downgrade ? model.downgrade.plan : model.selected;
  if (view.acknowledge !== undefined && answer.acknowledged !== true) {
    return { kind: "cancelled" };
  }
  return {
    kind: "run",
    plan: downgrade ? "abstract-only" : "selected",
    raise:
      view.raise === undefined
        ? undefined
        : { ceiling: view.raise.ceiling, limitUsd: view.raise.limitUsd },
    dontAskAgain: answer.dontAskAgain === true,
  };
}

// ===========================================================================
// 6. The Usage readout in preferences (step 6)
// ===========================================================================

/**
 * The preference pane's Usage section ids. The heading is a `data-l10n-id` in
 * `addon/content/preferences.xhtml`; `addon/content/preferences.js` places
 * the lines {@link UsageHostApi.readout} returns. All are in
 * `PREFERENCES_L10N` (`src/ui/prefs/preferencesPane.ts`) too.
 */
export const USAGE_L10N = {
  title: "research-helper-prefs-usage",
  session: COST_DIALOG_L10N.usageSession,
  estimated: COST_DIALOG_L10N.usageEstimated,
  limit: "research-helper-prefs-usage-limit",
  limitOff: "research-helper-prefs-usage-limit-off",
} as const satisfies Record<string, MainWindowMessageId>;

/** Where `src/bootstrap/registerUI.ts` publishes {@link UsageHostApi} on `addon.api`. */
export const USAGE_API_PROPERTY = "usage";

/** The pane's privileged host for the Usage section. */
export interface UsageHostApi {
  /** The session's spend and its ceiling, as lines to place. */
  readout(): readonly FluentLine[];
}

/**
 * The Usage section's lines: this Zotero session's calls, tokens and dollars,
 * whether any figure is estimated, and the session ceiling (or that there is
 * none). The per-job figures are in the job's dialog
 * ({@link buildCostDialogModel}'s `ceiling` moment and `P3-T29`'s surface).
 *
 * @param session - the session counter's totals
 * @param sessionLimitCents - `run.maxSessionSpendCents`; `0` is off
 * @param locale - for `Intl`
 * @returns the lines, in order
 */
export function usageReadout(
  session: SpendTotals,
  sessionLimitCents: number,
  locale: string,
): readonly FluentLine[] {
  const lines: FluentLine[] = [usageLine(USAGE_L10N.session, session, locale)];
  if (isEstimatedSpend(session)) lines.push({ id: USAGE_L10N.estimated });
  lines.push(
    Number.isFinite(sessionLimitCents) && sessionLimitCents > 0
      ? {
          id: USAGE_L10N.limit,
          args: { limit: formatUsd(sessionLimitCents / 100, locale) },
        }
      : { id: USAGE_L10N.limitOff },
  );
  return lines;
}

/**
 * The Usage host: reads the session counter and the ceiling each time the
 * pane asks, so the readout is never stale.
 *
 * @param deps - the counter's totals, the ceiling preference, the locale
 * @returns the host
 */
export function createUsageHost(deps: {
  readonly session: () => SpendTotals;
  readonly sessionLimitCents: () => number;
  readonly locale: () => string;
}): UsageHostApi {
  return {
    readout: () =>
      usageReadout(deps.session(), deps.sessionLimitCents(), deps.locale()),
  };
}

// ===========================================================================
// 7. Opening it
// ===========================================================================

/** What the window receives as `window.arguments[0]`. */
export interface CostDialogArgs {
  readonly model: CostDialogModel;
  /** Called once: on accept, cancel, or close (`{ accepted: false }`). */
  onAnswer(answer: unknown): void;
}

/** The one member of the host window this module calls. */
export interface CostDialogHost {
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extraArguments: unknown[]
  ): unknown;
}

let dialogSequence = 0;

/**
 * Open the dialog over `host` and resolve with what happens next.
 *
 * Resolves on the window's first report only. A window that cannot be opened
 * rejects: the caller then runs nothing, because no number was shown.
 *
 * @param host - the window to raise the dialog over
 * @param model - from {@link buildCostDialogModel}
 * @returns the outcome
 */
export function openCostConfirmDialog(
  host: CostDialogHost,
  model: CostDialogModel,
): Promise<CostDialogOutcome> {
  return new Promise<CostDialogOutcome>((resolve, reject) => {
    let settled = false;
    const args: CostDialogArgs = {
      model,
      onAnswer(answer: unknown): void {
        if (settled) return;
        settled = true;
        resolve(decideCostDialog(model, answer));
      },
    };
    dialogSequence += 1;
    const win = host.openDialog(
      COST_DIALOG_URL,
      `${COST_DIALOG_NAME_PREFIX}${String(dialogSequence)}`,
      COST_DIALOG_FEATURES,
      args,
    );
    if (win === null || win === undefined) {
      settled = true;
      reject(
        new Error(
          `[research-helper] openDialog("${COST_DIALOG_URL}") returned no window.`,
        ),
      );
    }
  });
}

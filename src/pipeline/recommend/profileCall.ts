/**
 * The one model call of a recommend run: `COLLECTION_PROFILE` (`P5-T22`;
 * `docs/12` §15, whose note of 2026-11-02 holds the rules this file builds).
 *
 * **Callers.** `recommendPipeline.ts` (`P5-T25`) runs
 * {@link runProfileCall} at `docs/07` §12.5's `ProfileCall` state, after
 * `buildProfileStats` and `P5-T21`, and before `persistProfile`. Its
 * `Pipeline.estimate` can call {@link planProfileCall}, which sends nothing.
 * Nothing is constructed: every export is a function, a type or a constant, and
 * `P5-T25` passes its `PipelineContext` and {@link ProfileCallDeps}.
 *
 * **What is sent** is `docs/09` §3 row 6 and no more: one metadata line per
 * paper. No abstract, no summary, no note, no annotation, and not the
 * collection's name, for which the prompt's variable holds a fixed text. The scope
 * comes from `allowedInputScope` and `planInputScopeKind`, so strict mode allows
 * it.
 *
 * **The router only.** `PipelineContext.llm` is the `withBudget` router, so the
 * call reserves before it is sent. `completeJSON` does the repair and the retry,
 * and this file adds no loop.
 */

import { cacheKey, encodeTagValue, promptLineTag } from "../../core/cache/keys";
import {
  ConfigurationError,
  ContentFilterError,
  MissingCredentialError,
  OutputTruncatedError,
  StructuredOutputError,
} from "../../core/errors";
import { redactRecord } from "../../core/provenance";
import {
  L10N_RECOMMEND_PROFILE_UNUSABLE,
  type MainWindowMessageId,
} from "../../i18n/keys";
import { windowRoom } from "../../llm/shared/chunking";
import type { BaseUrlResolver } from "../../llm/shared/baseUrl";
import {
  completeJSON,
  type StructuredRequest,
} from "../../llm/shared/jsonMode";
import type { ModelPrices } from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type { ModelInfo, ResolvedModel } from "../../llm/types";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { ProviderId } from "../../model/ids";
import type { CollectionProfile } from "../../model/profile";
import {
  promptCacheLine,
  renderPrompt,
  resolveMaxTokens,
  type PromptId,
  type PromptRegistry,
  type PromptTemplate,
} from "../../prompts";
import { normalizeTitle } from "../../sources/shared/dedupe";
import type { CollectionSettingsStore } from "../../zotero/db";
import type { CollectionWorkRead } from "../../zotero/itemMapper";
import {
  ZERO_SPEND,
  type CeilingKind,
  type CeilingStop,
} from "../shared/budget";
import type { SpendTotals } from "../shared/budget";
import {
  buildEgressDisclosure,
  egressLogEntry,
  mustAskConfirmation,
  routineConfirmationFor,
  type ConfirmationDecision,
  type EgressDisclosure,
  type EgressLogEntry,
} from "../shared/egressDisclosure";
import { estimateProfileCall, type RunEstimate } from "../shared/estimate";
import {
  modelRouteFor,
  planInputScopeKind,
  readCollectionPrivacySettings,
  routingHints,
  writeCollectionPrivacySettings,
  type CollectionRef,
  type RoutineConfirmation,
} from "../shared/privacyPolicy";
import { isRunBudgetGuard } from "../summarize/summarizePipeline";
import type { PipelineContext } from "../types";

import { ARXIV_SCHEME, isCheckTag, MESH_SCHEME } from "./profile";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

const PROMPT_ID: PromptId = "COLLECTION_PROFILE";

/** The `json_schema` name sent with the schema: the schema's own `title`. */
export const PROFILE_SCHEMA_NAME = "CollectionProfile";

/** `docs/12` §15's note, item 1: top subject terms on one line. */
export const PROFILE_LINE_MAX_TERMS = 5;

/** Item 4: the input budget, the figure of `docs/06` §5.2's other `strong` rows. */
export const PROFILE_INPUT_BUDGET = 60_000;

/** Item 2: `{{COLLECTION_NAME}}`, because `docs/09` §3 row 6 does not send the name. */
export const PROFILE_COLLECTION_NAME_WITHHELD = "not supplied";

/** `{{USER_NOTE}}` in v1: no surface collects a note. */
export const PROFILE_USER_NOTE_NONE = "none";

/** A missing year or venue on a line, or a missing year range. */
const UNKNOWN = "unknown";

/** No term on a line, or no year for the histogram. */
const NONE = "none";

/** `docs/06` §11.2's namespace for synthesis results: no time limit (item 5). */
export const PROFILE_CACHE_NAMESPACE = "report" as const;

/** {@link cacheKey}'s `kind` for a profile answer. */
const PROFILE_KEY_KIND = "cp";

// ---------------------------------------------------------------------------
// 2. The lines
// ---------------------------------------------------------------------------

/** One line break, tab or other control character cannot start a new line. */
function oneLine(text: string): string {
  return text.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

/** Code-unit order, so the answer does not depend on a locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A paper's top subject terms (item 1): MeSH without the check tags and arXiv
 * categories, major topics first, then those most frequent in the collection,
 * then keywords to fill what is left.
 *
 * @param work - the paper
 * @param counts - this collection's counts, by {@link normalizeTitle}'s key
 * @returns at most {@link PROFILE_LINE_MAX_TERMS} terms
 */
export function topSubjectTerms(
  work: Pick<CanonicalWork, "subjects" | "keywords">,
  counts: ReadonlyMap<string, number>,
): readonly string[] {
  const subjects = new Map<
    string,
    { term: string; major: boolean; count: number }
  >();
  for (const subject of work.subjects ?? []) {
    const key = normalizeTitle(subject.term);
    const wanted =
      subject.scheme === ARXIV_SCHEME ||
      (subject.scheme === MESH_SCHEME && !isCheckTag(subject.term));
    if (!wanted || key === "") continue;
    const major = subject.isMajor === true;
    const known = subjects.get(key);
    subjects.set(key, {
      term: known?.term ?? oneLine(subject.term),
      major: major || known?.major === true,
      count: counts.get(key) ?? 0,
    });
  }
  const ranked = [...subjects.values()]
    .sort(
      (a, b) =>
        Number(b.major) - Number(a.major) ||
        b.count - a.count ||
        byCodeUnit(a.term, b.term),
    )
    .map(({ term }) => term);
  const keywords = new Map<string, string>();
  for (const keyword of work.keywords ?? []) {
    const key = normalizeTitle(keyword);
    if (key === "" || subjects.has(key) || isCheckTag(keyword)) continue;
    if (!keywords.has(key)) keywords.set(key, oneLine(keyword));
  }
  return [...ranked, ...[...keywords.values()].sort(byCodeUnit)].slice(
    0,
    PROFILE_LINE_MAX_TERMS,
  );
}

/**
 * One paper's line (`docs/12` §15's note): `KEY | year | venue | title | terms`.
 *
 * @param item - the paper, as `readCollectionWorks` read it
 * @param counts - see {@link topSubjectTerms}
 * @returns one line, with no line break in it
 */
export function profileLine(
  item: Pick<CollectionWorkRead, "itemKey" | "work">,
  counts: ReadonlyMap<string, number>,
): string {
  const { work } = item;
  const venue = oneLine(work.containerTitle ?? "");
  const terms = topSubjectTerms(work, counts);
  return [
    item.itemKey,
    work.publishedDate?.year === undefined
      ? UNKNOWN
      : String(work.publishedDate.year),
    venue === "" ? UNKNOWN : venue,
    oneLine(work.title),
    terms.length === 0 ? NONE : terms.join("; "),
  ].join(" | ");
}

/** The whole {@link profileLine} list's order: by year, no year last, then key. */
function byYearThenKey(
  a: Pick<CollectionWorkRead, "itemKey" | "work">,
  b: Pick<CollectionWorkRead, "itemKey" | "work">,
): number {
  const yearA = a.work.publishedDate?.year ?? Number.POSITIVE_INFINITY;
  const yearB = b.work.publishedDate?.year ?? Number.POSITIVE_INFINITY;
  return yearA === yearB
    ? byCodeUnit(a.itemKey, b.itemKey)
    : yearA < yearB
      ? -1
      : 1;
}

/** `keep` of `rows`, evenly spaced, in their order; the first is always kept. */
function evenlySpaced<T>(rows: readonly T[], keep: number): readonly T[] {
  const chosen: T[] = [];
  for (let at = 0; at < keep; at += 1) {
    chosen.push(rows[Math.floor((at * rows.length) / keep)] as T);
  }
  return chosen;
}

/**
 * The rows whose lines fit the input budget (item 4): all of them, or an evenly
 * spaced subset that fits, and none when not one fits. Each line also costs its
 * joining newline.
 *
 * @param rows - in the order they are sent
 * @param lineOf - a row's line
 * @param budget - tokens the lines may take
 * @param count - the token counter
 * @returns the rows to send, in order
 */
export function fitProfileLines<T>(
  rows: readonly T[],
  lineOf: (row: T) => string,
  budget: number,
  count: (text: string) => number,
): readonly T[] {
  const tokens = new Map<T, number>();
  for (const row of rows) tokens.set(row, count(lineOf(row)) + 1);
  const sum = (some: readonly T[]): number =>
    some.reduce((total, row) => total + (tokens.get(row) ?? 0), 0);
  const total = sum(rows);
  if (total <= budget) return rows;
  // A collection of thousands is over budget by a wide margin, so start from the
  // proportion and step down by 5 %, not one paper at a time. A budget of zero or
  // less starts below 1, so the loop does not run.
  let keep = Math.floor((rows.length * budget) / total);
  while (keep >= 1) {
    const some = evenlySpaced(rows, keep);
    if (sum(some) <= budget) return some;
    keep -= Math.max(1, Math.ceil(keep * 0.05));
  }
  return [];
}

/** The year variables, from the collection's whole histogram. */
function yearVariables(
  histogram: Readonly<Record<number, number>>,
): Readonly<Record<"YEAR_MIN" | "YEAR_MAX" | "YEAR_HISTOGRAM", string>> {
  const years = Object.keys(histogram)
    .map(Number)
    .sort((a, b) => a - b);
  const first = years[0];
  const last = years[years.length - 1];
  return {
    YEAR_MIN: first === undefined ? UNKNOWN : String(first),
    YEAR_MAX: last === undefined ? UNKNOWN : String(last),
    YEAR_HISTOGRAM:
      years.length === 0
        ? NONE
        : years
            .map((year) => `${String(year)}:${String(histogram[year])}`)
            .join(", "),
  };
}

// ---------------------------------------------------------------------------
// 3. Types
// ---------------------------------------------------------------------------

/** What {@link runProfileCall} needs from the job: its context, in pieces. */
export type ProfileCallContext = Pick<
  PipelineContext,
  | "budget"
  | "cache"
  | "clock"
  | "config"
  | "llm"
  | "logger"
  | "privacy"
  | "token"
>;

/** The recommend run's own "don't ask again" record; {@link recommendRoutineStore} builds it. */
export interface ProfileRoutineStore {
  read(collection: CollectionRef): Promise<RoutineConfirmation | undefined>;
  write(collection: CollectionRef, record: RoutineConfirmation): Promise<void>;
}

/** What the run reads besides its context; `installServices` supplies it (`P5-T25`). */
export interface ProfileCallDeps {
  readonly prompts: Pick<PromptRegistry, "get" | "cacheEpochs">;
  /** The provider's key; no key is `FR-45`'s "no provider". */
  readonly credentials: { hasKey(providerId: ProviderId): Promise<boolean> };
  /** The one price source (`plan/00` §6 item 278(b)). */
  prices(providerId: ProviderId, modelId: string): ModelPrices | undefined;
  /** The catalogue entry, for its window and data policy; absent counts as unknown. */
  modelInfo?(providerId: ProviderId, modelId: string): ModelInfo | undefined;
  readonly baseUrls: Pick<BaseUrlResolver, "effectiveHost">;
  /** `privacy.egressAcknowledged`; the preference by default. */
  readonly egressAcknowledged?: () => boolean;
  /** Absent: always asked, and "don't ask again" stores nothing. */
  readonly routine?: ProfileRoutineStore;
  /**
   * The egress log (`docs/09` §3.6 item 4), awaited **before** the first request
   * of a call goes, and not at all when nothing is sent. A rejection stops the
   * request, so a caller that wants the run to go on catches its own failure.
   */
  readonly logEgress?: (entry: EgressLogEntry) => Promise<void>;
}

/** What one call is made for. */
export interface ProfileCallInput {
  /** `buildProfileStats`' answer: `origin` still `"heuristic"`. */
  readonly profile: CollectionProfile;
  /** The members `readCollectionWorks` read, the same read the stats came from. */
  readonly items: readonly CollectionWorkRead[];
}

/** The question the surface is asked before anything is sent. */
export interface ProfileConfirmRequest {
  readonly estimate: RunEstimate;
  readonly disclosure: EgressDisclosure;
  /**
   * `mustAskConfirmation` against the recommend run's **own** record. The
   * surface still asks whatever this says when money forces it
   * (`shouldOpenCostDialog`).
   */
  readonly confirmation: ConfirmationDecision;
  readonly ceilingSelected: CeilingStop | undefined;
  readonly collection: CollectionRef;
  readonly session: SpendTotals;
}

/** The surface's answer. */
export type ProfileConfirmAnswer =
  | {
      readonly kind: "run";
      readonly raise:
        | { readonly ceiling: CeilingKind; readonly limitUsd: number }
        | undefined;
      /** The dialog's "don't ask again" box was ticked. */
      readonly dontAskAgain: boolean;
    }
  | { readonly kind: "cancelled" };

/** The window, as this call sees it (`P5-T26`). */
export interface ProfileCallSurface {
  /** A rejection sends nothing. */
  confirm(request: ProfileConfirmRequest): Promise<ProfileConfirmAnswer>;
}

/** What the model's answer gives the profile, and all the cache holds. */
export interface ProfileAnswer {
  readonly narrative: string;
  readonly suggestedQueries: readonly string[];
  /** The answer's output tokens, when its provider reported them. */
  readonly outputTokens?: number;
}

/** {@link planProfileCall}'s answer. */
export type ProfileCallPlan =
  | { readonly status: "no-provider" }
  | { readonly status: "cached"; readonly answer: ProfileAnswer }
  /** Not one line fits the model's window. */
  | { readonly status: "too-large"; readonly model: ResolvedModel }
  | {
      readonly status: "ready";
      readonly model: ResolvedModel;
      readonly request: StructuredRequest;
      readonly estimate: RunEstimate;
      readonly disclosure: EgressDisclosure;
      /** `assertModelAllowed` wants the user's word, so the question is asked. */
      readonly modelNeedsConfirmation: boolean;
      /** The key the answer is cached under. */
      readonly cacheKey: string;
    };

/** Why a profile stayed heuristic. */
export type ProfileHeuristicReason =
  "no-provider" | "too-large" | "unusable-answer";

/** {@link runProfileCall}'s answer. */
export type ProfileCallOutcome =
  | {
      readonly status: "llm";
      readonly profile: CollectionProfile;
      /** Absent when the answer came from the cache: nothing was sent. */
      readonly egress?: EgressLogEntry;
    }
  | {
      readonly status: "heuristic";
      readonly profile: CollectionProfile;
      readonly reason: ProfileHeuristicReason;
      /** What the window says; absent for no provider, whose notice is `P5-T26`'s. */
      readonly warningId?: MainWindowMessageId;
      /** Set when a request was sent before the answer proved unusable. */
      readonly egress?: EgressLogEntry;
    }
  /** `docs/07` §12.5's `ProfileCall --> Cancelled`: nothing was sent. */
  | { readonly status: "declined" };

// ---------------------------------------------------------------------------
// 4. The record of its own
// ---------------------------------------------------------------------------

/**
 * The record `plan/08` §0.4 line 36 asks for, over `collection_settings`:
 * `recommendRoutineConfirmation`, never a summarize run's or a report run's.
 * Caller: `installServices` (`src/bootstrap/container.ts`, `P5-T25`).
 *
 * @param settings - the `collection_settings` store
 * @returns the record's two operations
 */
export function recommendRoutineStore(
  settings: CollectionSettingsStore,
): ProfileRoutineStore {
  return {
    read: async (collection) =>
      readCollectionPrivacySettings(
        await settings.get(collection.libraryID, collection.collectionKey),
      ).recommendRoutineConfirmation,
    write: (collection, record) =>
      writeCollectionPrivacySettings(settings, collection, {
        recommendRoutineConfirmation: record,
      }),
  };
}

// ---------------------------------------------------------------------------
// 5. The plan: nothing is sent
// ---------------------------------------------------------------------------

/** A model the catalogue does not know: its data policy is unknown (`docs/09` §3.5). */
function unknownPolicyModel(id: string): ModelInfo {
  return {
    id,
    displayName: id,
    contextWindowTokens: 0,
    maxOutputTokens: 0,
    supportsJsonSchema: false,
    supportsStreaming: false,
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: {
      trainsOnInputByDefault: "unknown",
      retention: { days: "unknown", note: "" },
    },
  };
}

/** Whether a cache entry is an answer this build can read. */
function isProfileAnswer(value: unknown): value is ProfileAnswer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof ProfileAnswer, unknown>>;
  return (
    typeof v.narrative === "string" &&
    v.narrative !== "" &&
    Array.isArray(v.suggestedQueries) &&
    v.suggestedQueries.every((query) => typeof query === "string") &&
    (v.outputTokens === undefined || typeof v.outputTokens === "number")
  );
}

/** `model` when the active provider has a key and a model; `undefined` otherwise. */
async function configuredModel(
  ctx: Pick<ProfileCallContext, "llm">,
  deps: Pick<ProfileCallDeps, "credentials">,
): Promise<ResolvedModel | undefined> {
  let model: ResolvedModel;
  try {
    model = ctx.llm.resolveModel("strong");
  } catch (error) {
    // `resolveModel`: every link of the model chain is empty.
    if (error instanceof ConfigurationError) return undefined;
    throw error;
  }
  return (await deps.credentials.hasKey(model.providerId)) ? model : undefined;
}

/**
 * Everything up to the question: the provider, the cache, the mode, the lines,
 * the request, its price and its disclosure. **Sends nothing and stores nothing.**
 *
 * @param input - see {@link ProfileCallInput}
 * @param ctx - the job's context
 * @param deps - see {@link ProfileCallDeps}
 * @returns what the run does next
 * @throws PolicyViolationError when the privacy mode refuses the model
 */
export async function planProfileCall(
  input: ProfileCallInput,
  ctx: ProfileCallContext,
  deps: ProfileCallDeps,
): Promise<ProfileCallPlan> {
  ctx.token.throwIfCancelled();
  const model = await configuredModel(ctx, deps);
  if (model === undefined) return { status: "no-provider" };

  const { profile } = input;
  const prompt = deps.prompts.get(PROMPT_ID);
  const key = cacheKey(
    PROFILE_KEY_KIND,
    profile.libraryID,
    profile.membershipHash,
    deps.prompts.cacheEpochs[PROMPT_ID],
    model.providerId,
    model.modelId,
    prompt.defaultTemperature,
  );
  if (ctx.config.get("cacheEnabled")) {
    const stored = await ctx.cache.get<unknown>(PROFILE_CACHE_NAMESPACE, key);
    if (isProfileAnswer(stored)) return { status: "cached", answer: stored };
  }

  const info = deps.modelInfo?.(model.providerId, model.modelId);
  // Throws when the mode refuses the model, before the dialog and any request.
  const check = ctx.privacy.assertModelAllowed(
    info ?? unknownPolicyModel(model.modelId),
    ctx.privacy.mode,
    modelRouteFor(model.providerId, () => ctx.config.get("geminiPaidTier")),
  );
  if (check.warnings.length > 0) {
    ctx.logger.info("the profile's model passes with warnings", {
      warnings: check.warnings.join(","),
    });
  }
  const allowed = ctx.privacy.allowedInputScope(ctx.privacy.mode, {
    fullTextMode: "never",
  });
  // `docs/09` §3 row 6: a line carries no abstract, so this is `metadata-only`
  // in every mode.
  const scope = planInputScopeKind(allowed, {
    tier: "metadata_only",
    abstract: null,
  });

  const count = (text: string): number => estTokens(text, model.modelId);
  const outputTokens = resolveMaxTokens(prompt);
  const countsByKey = new Map(
    Object.entries(profile.subjectCounts).map(
      ([term, value]) => [normalizeTitle(term), value] as const,
    ),
  );
  const variables = (digests: string): Record<string, string> => ({
    COLLECTION_NAME: PROFILE_COLLECTION_NAME_WITHHELD,
    N_PAPERS: String(profile.itemCount),
    ...yearVariables(profile.yearHistogram),
    USER_NOTE: PROFILE_USER_NOTE_NONE,
    DIGESTS: digests,
  });
  const schemaTokens = count(JSON.stringify(prompt.schema));
  const requestTokens = (system: string, user: string): number =>
    count(system) + count(user) + schemaTokens;
  const empty = renderPrompt(prompt, variables(""));
  const budget =
    Math.min(PROFILE_INPUT_BUDGET, windowRoom(windowOf(info), outputTokens)) -
    requestTokens(empty.system, empty.user);
  const lineOf = (item: CollectionWorkRead): string =>
    profileLine(item, countsByKey);
  const sent = fitProfileLines(
    [...input.items].sort(byYearThenKey),
    lineOf,
    budget,
    count,
  );
  if (sent.length === 0) return { status: "too-large", model };

  const rendered = renderPrompt(prompt, variables(sent.map(lineOf).join("\n")));
  const request = profileRequest(prompt, rendered, model, ctx, profile.id);
  return {
    status: "ready",
    model,
    request,
    estimate: estimateProfileCall({
      workKeys: sent.map(({ work }) => work.workKey),
      rawInputTokens: requestTokens(rendered.system, rendered.user),
      outputTokens,
      modelId: model.modelId,
      prices: deps.prices(model.providerId, model.modelId),
      atEpochMs: ctx.clock.now(),
    }),
    disclosure: buildEgressDisclosure(
      {
        providerId: model.providerId,
        modelId: model.modelId,
        privacyMode: ctx.privacy.mode,
        items: sent.map(() => scope),
        profileNotice: true,
      },
      {
        baseUrls: deps.baseUrls,
        ...(deps.egressAcknowledged !== undefined && {
          egressAcknowledged: deps.egressAcknowledged,
        }),
        geminiPaidTier: () => ctx.config.get("geminiPaidTier"),
      },
    ),
    modelNeedsConfirmation: check.requiresConfirmation,
    cacheKey: key,
  };
}

/** The catalogue's window, when it knows one. */
function windowOf(info: ModelInfo | undefined): number | undefined {
  const window = info?.contextWindowTokens;
  return window !== undefined && window > 0 ? window : undefined;
}

/**
 * The request. **No `effort`:** `docs/12` §18.5 assigns this prompt none, and
 * `plan/08` §0.4 line 7 keeps it so.
 */
function profileRequest(
  prompt: PromptTemplate,
  rendered: { readonly system: string; readonly user: string },
  model: ResolvedModel,
  ctx: Pick<ProfileCallContext, "privacy">,
  profileId: string,
): StructuredRequest {
  return {
    model: model.modelId,
    messages: [
      { role: "system", content: rendered.system },
      { role: "user", content: rendered.user },
    ],
    temperature: prompt.defaultTemperature,
    maxOutputTokens: resolveMaxTokens(prompt),
    responseFormat: {
      kind: "json_schema",
      name: PROFILE_SCHEMA_NAME,
      schema: prompt.schema as Readonly<Record<string, unknown>>,
    },
    routing: routingHints(ctx.privacy.mode),
    traceId: `collection-profile:${profileId}`,
  };
}

// ---------------------------------------------------------------------------
// 6. The answer
// ---------------------------------------------------------------------------

/** The two members of the prompt's answer the profile reads. */
interface ProfilePromptAnswer {
  readonly focusStatement: string;
  readonly suggestedQueryTerms?: readonly string[];
}

/** Trimmed, blanks dropped, repeats dropped by {@link normalizeTitle}'s key. */
function cleanQueries(terms: readonly string[]): readonly string[] {
  const seen = new Map<string, string>();
  for (const term of terms) {
    const clean = oneLine(term);
    const key = normalizeTitle(clean);
    if (key !== "" && !seen.has(key)) seen.set(key, clean);
  }
  return [...seen.values()];
}

/**
 * `focusStatement` → `narrative`, `suggestedQueryTerms` → `suggestedQueries`
 * (`docs/12` §15's naming note). The other members have no reader in v1.
 *
 * @param profile - the statistical profile
 * @param answer - the answer, from the model or the cache
 * @returns the profile with `origin: "llm"`
 */
export function applyProfileAnswer(
  profile: CollectionProfile,
  answer: ProfileAnswer,
): CollectionProfile {
  return {
    ...profile,
    narrative: answer.narrative,
    suggestedQueries: answer.suggestedQueries,
    origin: "llm",
    ...(answer.outputTokens !== undefined && {
      profileCallOutputTokens: answer.outputTokens,
    }),
  };
}

/** Store an answer. A cache that fails costs a later call, never this run. */
async function rememberAnswer(
  plan: Extract<ProfileCallPlan, { status: "ready" }>,
  answer: ProfileAnswer,
  ctx: ProfileCallContext,
  prompt: PromptTemplate,
): Promise<void> {
  if (!ctx.config.get("cacheEnabled")) return;
  try {
    // The one gate for a persisted record (`docs/09` §2.1).
    await ctx.cache.set(
      PROFILE_CACHE_NAMESPACE,
      plan.cacheKey,
      redactRecord(answer).record,
      {
        tags: [
          promptLineTag(PROMPT_ID, promptCacheLine(prompt.version)),
          `model:${encodeTagValue(plan.model.modelId)}`,
          `provider:${encodeTagValue(plan.model.providerId)}`,
        ],
      },
    );
  } catch (error) {
    ctx.logger.warn("the collection profile's answer could not be cached", {
      reason: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** The error classes `docs/12` §15's note, item 6, reads as an unusable answer. */
function isUnusableAnswer(error: unknown): boolean {
  return (
    error instanceof StructuredOutputError ||
    error instanceof OutputTruncatedError ||
    error instanceof ContentFilterError
  );
}

// ---------------------------------------------------------------------------
// 7. The run
// ---------------------------------------------------------------------------

/**
 * `docs/07` §12.5's `ProfileCall`: plan, ask, send, read the answer. Writes only
 * the answer's cache entry and, when the box was ticked, the "don't ask again"
 * record, and hands the egress entry to `deps.logEgress` before the first request.
 * The caller stores the profile (`persistProfile`).
 *
 * @param input - see {@link ProfileCallInput}
 * @param ctx - the job's context; its router is the `withBudget` one
 * @param deps - see {@link ProfileCallDeps}
 * @param surface - who is asked
 * @returns the profile to store, or that the user declined
 * @throws PolicyViolationError when the privacy mode refuses the model
 * @throws BudgetExceededError when a spend ceiling refuses the call
 * @throws OperationCancelledError when the token is cancelled
 */
export async function runProfileCall(
  input: ProfileCallInput,
  ctx: ProfileCallContext,
  deps: ProfileCallDeps,
  surface: ProfileCallSurface,
): Promise<ProfileCallOutcome> {
  const { profile } = input;
  const heuristic = (
    reason: ProfileHeuristicReason,
    egress?: EgressLogEntry,
  ): ProfileCallOutcome => ({
    status: "heuristic",
    profile,
    reason,
    ...(reason !== "no-provider" && {
      warningId: L10N_RECOMMEND_PROFILE_UNUSABLE,
    }),
    ...(egress !== undefined && { egress }),
  });

  const plan = await planProfileCall(input, ctx, deps);
  if (plan.status === "no-provider") return heuristic("no-provider");
  if (plan.status === "too-large") {
    ctx.logger.warn("not one line of the profile fits the model's window", {
      modelId: plan.model.modelId,
    });
    return heuristic("too-large");
  }
  if (plan.status === "cached") {
    return { status: "llm", profile: applyProfileAnswer(profile, plan.answer) };
  }

  // AwaitingConfirm: the recommend run's own record, nobody else's.
  const collection: CollectionRef = {
    libraryID: profile.libraryID,
    collectionKey: profile.collectionKey,
  };
  let routine: RoutineConfirmation | undefined;
  try {
    routine = await deps.routine?.read(collection);
  } catch {
    routine = undefined; // asked again: the safe direction
  }
  const routineDecision = mustAskConfirmation(plan.disclosure, routine);
  const guard = isRunBudgetGuard(ctx.budget) ? ctx.budget : undefined;
  const check = guard?.check(plan.estimate.selected.costUsd ?? 0);
  let answer: ProfileConfirmAnswer;
  try {
    answer = await surface.confirm({
      estimate: plan.estimate,
      disclosure: plan.disclosure,
      confirmation: plan.modelNeedsConfirmation
        ? { ...routineDecision, ask: true }
        : routineDecision,
      ceilingSelected: check === undefined || check.ok ? undefined : check.stop,
      collection,
      session: guard?.usage().session ?? ZERO_SPEND,
    });
  } catch (error) {
    ctx.logger.warn("the profile's cost question failed; nothing is sent", {
      reason: error instanceof Error ? error.name : typeof error,
    });
    answer = { kind: "cancelled" };
  }
  if (answer.kind !== "run") return { status: "declined" };
  if (answer.dontAskAgain && deps.routine !== undefined) {
    try {
      await deps.routine.write(
        collection,
        routineConfirmationFor(plan.disclosure),
      );
    } catch {
      // Not stored: the next recommend run asks again.
    }
  }
  if (answer.raise !== undefined && guard !== undefined) {
    guard.raiseLimit(answer.raise.ceiling, answer.raise.limitUsd);
  }

  const prompt = deps.prompts.get(PROMPT_ID);
  const egress = egressLogEntry(plan.disclosure, ctx.clock.now());
  // Through the router, not ahead of this call: a ceiling can still refuse it. A
  // repair or a retry goes to the same model with the same scope, so one entry.
  let logged = false;
  const beforeSend = async (): Promise<void> => {
    if (logged) return;
    logged = true;
    await deps.logEgress?.(egress);
  };
  let completed;
  try {
    completed = await completeJSON<ProfilePromptAnswer>(
      ctx.llm,
      plan.request,
      { token: ctx.token, budget: ctx.budget, beforeSend },
      { includeBodies: ctx.config.get("logRequestBodies") },
    );
  } catch (error) {
    // The router's own check, for a key removed since `planProfileCall`.
    if (error instanceof MissingCredentialError)
      return heuristic("no-provider");
    if (!isUnusableAnswer(error)) throw error;
    ctx.logger.warn("the profile's answer could not be used", {
      reason: error instanceof Error ? error.name : typeof error,
      modelId: plan.model.modelId,
    });
    return heuristic("unusable-answer", egress);
  }
  const narrative = oneLine(completed.value.focusStatement);
  if (narrative === "") {
    ctx.logger.warn("the profile's answer states no focus", {
      modelId: plan.model.modelId,
    });
    return heuristic("unusable-answer", egress);
  }
  const { outputTokens } = completed.response.usage;
  const made: ProfileAnswer = {
    narrative,
    suggestedQueries: cleanQueries(completed.value.suggestedQueryTerms ?? []),
    ...(outputTokens !== undefined && { outputTokens }),
  };
  await rememberAnswer(plan, made, ctx, prompt);
  return {
    status: "llm",
    profile: applyProfileAnswer(profile, made),
    egress,
  };
}

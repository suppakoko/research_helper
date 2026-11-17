/**
 * The privacy policy a job runs under — `docs/07` §4.5's `PrivacyPolicy`, and
 * the per-collection settings it is read from.
 *
 * **Scope.** `P3-T15` steps 1–4 and the read half of step 6. The surface is the
 * one the owner declared in `docs/07` §4.5 on 2026-10-21 (`plan/00` §6 item
 * 267): the mode in force for the job, {@link effectiveMode},
 * {@link allowedInputScope} and {@link assertModelAllowed}. The rules are
 * `docs/09-security-privacy-and-api-keys.md` §3.5's table, and nothing here
 * adds a rule that table does not state. *(Updated 2026-10-22: that table's
 * Gemini row was corrected by the owner, `plan/00` §6 item 269(b)–(c), and
 * its rules are {@link assertModelAllowed}'s `route` parameter.)*
 *
 * ## Only ever stricter
 *
 * The global mode is the `privacy.mode` preference (`docs/07` §8.5). A
 * collection's override lives in the `collection_settings` table (§8.3), never
 * in a preference, and {@link effectiveMode} takes the **stricter** of the two:
 * an override can tighten the global mode and can never loosen it. Every
 * reading of a value this build does not know fails **closed**, to `strict` —
 * an override written by a later build, a malformed row, a store that cannot
 * be read — because reading an unknown override as "no override" would loosen
 * a collection the user had locked down.
 *
 * ## Callers
 *
 * `P3-T16`'s cost dialog and `P3-T29`'s summarize pipeline, through
 * `PipelineContext.privacy`, which `P3-T35` fills per job with
 * {@link loadPrivacyPolicy}. *(Updated 2026-10-23: `P3-T35` did, and the
 * 2026-10-21 strict placeholder is gone. `createPipelineContextFactory` in
 * `src/bootstrap/container.ts` gives a job over no collection the global
 * mode and a collection job the stricter of the two; an override that cannot
 * be read still gives strict — owner, `plan/00` §6 item 278(c).)*
 *
 * **Layering.** `pipeline/` may import `core/`, `model/`, `llm/` and
 * `zotero/` (`docs/07` §2.3); this file imports types from the last three and
 * one error class from `core/`.
 */

import { PolicyViolationError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { ModelInfo, ProviderRoutingHints } from "../../llm/types";
import type { ProviderId } from "../../model/ids";
import type { AcquiredSource } from "../../model/summary";
import { getPref } from "../../prefs";
import type {
  CollectionSettings,
  CollectionSettingsStore,
} from "../../zotero/db";

// ===========================================================================
// 1. docs/07 §4.5's declaration
// ===========================================================================

/** `docs/07` §8.5's `privacy.mode` values. */
export type PrivacyMode = "strict" | "balanced" | "full";

/** Every {@link PrivacyMode}, strictest first. */
export const PRIVACY_MODES: readonly PrivacyMode[] = [
  "strict",
  "balanced",
  "full",
];

/** `docs/06` §5.4's enum, `docs/07` §8.5's `summary.fullTextMode` values. */
export type FullTextMode = "never" | "auto" | "always";

/** What a run asks to send, before the mode has its say. */
export interface InputScopeRequest {
  /** The run's own choice; absent means `auto`, D7's default. */
  readonly fullTextMode?: FullTextMode;
  /**
   * Separate, explicitly labelled opt-ins (`docs/09` §3.2); honoured only
   * under `full`.
   */
  readonly optIns?: {
    readonly notes?: boolean;
    readonly annotations?: boolean;
    readonly collectionAndTagNames?: boolean;
  };
}

/** What a job in one mode may send (`docs/09` §3.5's table). */
export interface AllowedInputScope {
  readonly mode: PrivacyMode;
  /** `never` in strict mode; otherwise the run's own choice. */
  readonly fullTextMode: FullTextMode;
  readonly notes: boolean;
  readonly annotations: boolean;
  readonly collectionAndTagNames: boolean;
}

/** A model the mode lets through, and what the user must be told. */
export interface ModelPolicyCheck {
  readonly warnings: readonly ("data-policy-unknown" | "may-train-on-input")[];
  /** Full mode and a model that may train on input: the user confirms first. */
  readonly requiresConfirmation: boolean;
}

/** `docs/07` §4.5's `PrivacyPolicy` (owner, 2026-10-21, item 267). */
export interface PrivacyPolicy {
  /** The mode in force for this job: effectiveMode(privacy.mode, the collection's override). */
  readonly mode: PrivacyMode;
  /** The stricter of the two; an override never loosens the global mode. */
  effectiveMode(
    globalMode: PrivacyMode,
    collectionOverride: PrivacyMode | undefined,
  ): PrivacyMode;
  /** What a job in `mode` may send (09 §3.5's table). */
  allowedInputScope(
    mode: PrivacyMode,
    request?: InputScopeRequest,
  ): AllowedInputScope;
  /** Throws PolicyViolationError when `mode` refuses `model`; otherwise the warnings to show. */
  assertModelAllowed(
    model: ModelInfo,
    mode: PrivacyMode,
    route?: ModelRoute,
  ): ModelPolicyCheck;
}

/**
 * The provider a model is reached through, for the rules that depend on it
 * (`docs/07` §4.5's note "a Gemini key the user declares paid"; `plan/00` §6
 * item 269(b), owner, 2026-10-22). Build it with {@link modelRouteFor}.
 */
export interface ModelRoute {
  readonly providerId: ProviderId;
  /**
   * `gemini.paidTier` (`docs/07` §8.5), read when the check runs. Consulted
   * for Gemini only; absent reads as `false`.
   */
  readonly geminiPaidTier?: boolean;
}

// ===========================================================================
// 2. The three checks
// ===========================================================================

/** True for one of the three modes this build knows. */
export function isPrivacyMode(value: unknown): value is PrivacyMode {
  return (
    typeof value === "string" &&
    (PRIVACY_MODES as readonly string[]).includes(value)
  );
}

/** Position in {@link PRIVACY_MODES}; an unknown value ranks as `strict`. */
function strictness(mode: unknown): number {
  return isPrivacyMode(mode) ? PRIVACY_MODES.indexOf(mode) : 0;
}

/**
 * The mode in force: the stricter of the global mode and the collection's
 * override (`docs/09` §3.5, "it always wins over the global setting when it is
 * more restrictive; a per-collection setting can never loosen a stricter
 * global one").
 *
 * A value outside {@link PRIVACY_MODES} on either side counts as `strict`.
 *
 * @param globalMode - the `privacy.mode` preference
 * @param collectionOverride - the collection's override, or `undefined`
 * @returns the stricter mode
 */
export function effectiveMode(
  globalMode: PrivacyMode,
  collectionOverride: PrivacyMode | undefined,
): PrivacyMode {
  const global = strictness(globalMode);
  const override =
    collectionOverride === undefined ? global : strictness(collectionOverride);
  return PRIVACY_MODES[Math.min(global, override)] ?? "strict";
}

/**
 * What a job in `mode` may send (`docs/09` §3.5's table):
 *
 * - strict forces `fullTextMode` to `never`; balanced and full keep the run's
 *   own choice (D7's `auto` when the run states none);
 * - notes, annotations, and collection and tag names are sent only under
 *   `full`, and only with their own opt-in (`docs/09` §3.2's two rules).
 *
 * @param mode - the mode in force
 * @param request - the run's choices
 * @returns the allowed scope
 */
export function allowedInputScope(
  mode: PrivacyMode,
  request: InputScopeRequest = {},
): AllowedInputScope {
  const known: PrivacyMode = isPrivacyMode(mode) ? mode : "strict";
  const full = known === "full";
  const optIns = request.optIns ?? {};
  return {
    mode: known,
    fullTextMode:
      known === "strict" ? "never" : (request.fullTextMode ?? "auto"),
    notes: full && optIns.notes === true,
    annotations: full && optIns.annotations === true,
    collectionAndTagNames: full && optIns.collectionAndTagNames === true,
  };
}

/**
 * Whether `mode` lets `model` be used, from `ModelInfo.dataPolicy` alone
 * (`docs/09` §3.4 rule 3 and §3.5's table). No policy is guessed: an absent
 * or unrecognised `trainsOnInputByDefault` is treated as `"unknown"`.
 *
 * | `trainsOnInputByDefault` | strict | balanced | full |
 * |---|---|---|---|
 * | `"no"` | allowed | allowed | allowed |
 * | `"unknown"` | **refused** | warned | allowed |
 * | `"yes"` | **refused** | **refused** | warned, confirmation required |
 *
 * **Gemini** (`route.providerId === "gemini"`; owner, 2026-10-22, `plan/00`
 * §6 item 269(b); `docs/07` §4.5's note "a Gemini key the user declares
 * paid"). Every Gemini rule is here and nowhere else:
 * - every mode reads `trainsOnInputByDefault` as `"no"` when
 *   `route.geminiPaidTier` is `true` — the user declared the key paid — and
 *   as the model's own policy otherwise (`"yes"` for a free or unknown tier).
 *   *(Corrected 2026-10-23, owner, `plan/00` §6 item 270: strict refused
 *   Gemini on every tier for its abuse-monitoring retention. Strict judges the
 *   training policy only, as for OpenAI and Anthropic, so that rule is gone.)*
 * - a free or unknown key (`"yes"`) is refused in **strict** only; in
 *   balanced and full it is warned, `may-train-on-input`, and needs the
 *   user's confirmation. *(Added 2026-11-17, `P7-T32`: owner, 2026-11-16,
 *   `plan/00` §6 item 381. Balanced refused it until then; the audio job's
 *   `assertAudioAllowed` already followed this rule, item 379(d).)*
 *
 * The adapter's `dataPolicy` is left as the plugin knows it: the declaration
 * is the user's word, applied at this check. Without a `route` the table
 * above is the whole rule, which still refuses a free or unknown Gemini key
 * in strict and balanced mode, so leaving the route out loosens nothing.
 *
 * @param model - the model the job would use
 * @param mode - the mode in force
 * @param route - the provider the model is reached through; see {@link modelRouteFor}
 * @returns the warnings to show
 * @throws PolicyViolationError when the mode refuses the model
 */
export function assertModelAllowed(
  model: ModelInfo,
  mode: PrivacyMode,
  route?: ModelRoute,
): ModelPolicyCheck {
  const known: PrivacyMode = isPrivacyMode(mode) ? mode : "strict";
  const raw = (model.dataPolicy as { trainsOnInputByDefault?: unknown })
    .trainsOnInputByDefault;
  const gemini = route?.providerId === "gemini";
  const declaredPaid = gemini && route?.geminiPaidTier === true;
  const trains = declaredPaid
    ? "no"
    : raw === "no" || raw === "yes"
      ? raw
      : "unknown";

  const refuse = (rule: string): never => {
    throw new PolicyViolationError(
      `model "${model.id}" is refused in ${known} privacy mode: ${rule} ` +
        "(docs/09 §3.5)",
      {
        mode: known,
        modelId: model.id,
        trainsOnInputByDefault: trains,
        ...(gemini && { providerId: "gemini", geminiPaidTier: declaredPaid }),
      },
    );
  };

  if (trains === "unknown") {
    if (known === "strict") refuse("its data policy is unknown");
    return {
      warnings: known === "balanced" ? ["data-policy-unknown"] : [],
      requiresConfirmation: false,
    };
  }
  if (trains === "yes") {
    // P7-T32 (owner, 2026-11-16, plan/00 §6 item 381): a free or unknown
    // Gemini key is refused in strict only. Balanced warns and asks, as full
    // does and as an audio job already did (`assertAudioAllowed`, item 379(d)).
    if (known === "strict" || (known === "balanced" && !gemini)) {
      refuse("it may train on what it is sent");
    }
    return { warnings: ["may-train-on-input"], requiresConfirmation: true };
  }
  return { warnings: [], requiresConfirmation: false };
}

/**
 * The {@link ModelRoute} for a model reached through `providerId`, with
 * `gemini.paidTier` read **now**: on demand and never cached (`docs/07`
 * §8.5's row). The preference is read for Gemini only. The callers of
 * {@link assertModelAllowed} (`P3-T16`, `P3-T29`) build the route this way
 * for the provider the router resolved.
 *
 * @param providerId - the provider the model is reached through
 * @param readGeminiPaidTier - `gemini.paidTier`; the preference by default
 * @returns the route
 */
export function modelRouteFor(
  providerId: ProviderId,
  readGeminiPaidTier: () => boolean = () => getPref("geminiPaidTier"),
): ModelRoute {
  return providerId === "gemini"
    ? { providerId, geminiPaidTier: readGeminiPaidTier() }
    : { providerId };
}

/**
 * The OpenRouter `provider` hints for a job in `mode` (`P3-T15` step 4,
 * `docs/09` §3.4 rule 1): `requireZeroRetention` in strict mode, which the
 * adapter sends as `provider.zdr: true`. `data_collection: "deny"` is sent in
 * every mode by the adapter itself, so `requireNoTraining` is always set.
 * A pipeline puts this on every `ChatRequest.routing`, so a collection that is
 * stricter than the global mode reaches the request.
 *
 * @param mode - the mode in force
 * @returns the routing hints
 */
export function routingHints(mode: PrivacyMode): ProviderRoutingHints {
  return {
    requireNoTraining: true,
    ...(strictness(mode) === 0 && { requireZeroRetention: true }),
  };
}

/**
 * `docs/07` §5.2's `SummaryInputScope["kind"]`, transcribed. `SummaryInputScope`
 * itself arrives in `src/model/summary.ts` with `StoredSummary` (`P3-T25`);
 * this alias then becomes an import. `test/unit/pipeline/privacyPolicy.test.ts`
 * compares the four members with §5.2's text.
 */
export type InputScopeKind =
  "metadata-only" | "abstract" | "abstract+fulltext" | "abstract+notes";

/**
 * The scope one item is sent with, given what acquisition found and what the
 * mode allows (`P3-T15` Done-when: in strict mode a full-text item is sent as
 * `abstract`). Notes are never planned here: nothing acquires them yet.
 *
 * A full-text tier under a `never` scope falls back to the abstract, or to
 * metadata when there is none; the caller re-acquires without Tier 2
 * (`acquire.ts`'s `includeFullText: false`) rather than sending the text it has.
 *
 * @param allowed - from {@link allowedInputScope}
 * @param source - the acquired item's tier and abstract
 * @returns the kind of scope to send and record
 */
export function planInputScopeKind(
  allowed: AllowedInputScope,
  source: Pick<AcquiredSource, "tier" | "abstract">,
): InputScopeKind {
  const fullTextTier =
    source.tier === "fulltext_pdf" || source.tier === "fulltext_epmc";
  if (fullTextTier && allowed.fullTextMode !== "never") {
    return "abstract+fulltext";
  }
  const hasAbstract =
    source.tier !== "metadata_only" &&
    source.abstract !== null &&
    source.abstract.trim() !== "";
  return hasAbstract ? "abstract" : "metadata-only";
}

// ===========================================================================
// 3. The policy object
// ===========================================================================

/**
 * A {@link PrivacyPolicy} whose `mode` is the effective mode of `globalMode`
 * and `collectionOverride`.
 *
 * @param globalMode - the `privacy.mode` preference
 * @param collectionOverride - the collection's override, if it has one
 * @returns the policy
 */
export function createPrivacyPolicy(
  globalMode: PrivacyMode,
  collectionOverride?: PrivacyMode,
): PrivacyPolicy {
  return Object.freeze({
    mode: effectiveMode(globalMode, collectionOverride),
    effectiveMode,
    allowedInputScope,
    assertModelAllowed,
  });
}

// ===========================================================================
// 4. collection_settings — the privacy members (docs/07 §4.5's note)
// ===========================================================================

/**
 * What "don't ask again for this collection" was ticked under (`docs/09`
 * §3.6 item 2). It suppresses the routine confirmation only while the provider
 * and the mode are the same, and only covers full text if full text was in the
 * confirmed scope — see `egressDisclosure.ts`'s `mustAskConfirmation`.
 */
export interface RoutineConfirmation {
  readonly providerId: ProviderId;
  readonly privacyMode: PrivacyMode;
  readonly fullText: boolean;
}

/** The privacy members of one collection's settings object. */
export interface CollectionPrivacySettings {
  /** The override, as stored; {@link effectiveMode} applies it. */
  readonly privacyMode?: PrivacyMode;
  readonly routineConfirmation?: RoutineConfirmation;
  /**
   * The trend-report run's own "don't ask again" (owner, `plan/00` §6 item
   * 292(f); `docs/07` §4.5's note of 2026-11-01): a summarize run's
   * {@link routineConfirmation} never skips a report run's question, and only
   * this record does.
   */
  readonly reportRoutineConfirmation?: RoutineConfirmation;
  /**
   * The recommend run's own "don't ask again" (`plan/08` §0.4 line 36;
   * `docs/07` §4.5's note of 2026-11-02): only this record skips a recommend
   * run's question, and a recommend run changes neither of the other two.
   */
  readonly recommendRoutineConfirmation?: RoutineConfirmation;
}

/** The three "don't ask again" members of a collection's settings. */
const ROUTINE_MEMBERS = [
  "routineConfirmation",
  "reportRoutineConfirmation",
  "recommendRoutineConfirmation",
] as const;

/** A stored record as a {@link RoutineConfirmation}, or `undefined` when malformed. */
function readRoutine(routine: unknown): RoutineConfirmation | undefined {
  if (typeof routine !== "object" || routine === null) return undefined;
  const r = routine as Record<string, unknown>;
  const providerId = r["providerId"];
  if (
    typeof providerId === "string" &&
    (PROVIDER_IDS as readonly string[]).includes(providerId) &&
    isPrivacyMode(r["privacyMode"]) &&
    typeof r["fullText"] === "boolean"
  ) {
    return {
      providerId: providerId as ProviderId,
      privacyMode: r["privacyMode"],
      fullText: r["fullText"],
    };
  }
  return undefined;
}

const PROVIDER_IDS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
];

/**
 * Read the privacy members out of a stored settings object.
 *
 * A `privacyMode` this build does not know reads as `strict` (fail closed). A
 * malformed `routineConfirmation` reads as absent, which only means the user
 * is asked again. Other members (`docs/07` §8.3's model overrides) are not
 * this file's and are ignored.
 *
 * @param settings - the stored object, or `undefined` for no row
 * @returns the privacy members
 */
export function readCollectionPrivacySettings(
  settings: CollectionSettings | undefined,
): CollectionPrivacySettings {
  if (settings === undefined) return {};
  const out: {
    privacyMode?: PrivacyMode;
    routineConfirmation?: RoutineConfirmation;
    reportRoutineConfirmation?: RoutineConfirmation;
    recommendRoutineConfirmation?: RoutineConfirmation;
  } = {};
  const mode = settings["privacyMode"];
  if (mode !== undefined && mode !== null) {
    out.privacyMode = isPrivacyMode(mode) ? mode : "strict";
  }
  for (const member of ROUTINE_MEMBERS) {
    const routine = readRoutine(settings[member]);
    if (routine !== undefined) out[member] = routine;
  }
  return out;
}

/** Where a collection's settings are read from and written to. */
export interface CollectionRef {
  readonly libraryID: number;
  readonly collectionKey: string;
}

/**
 * Replace the privacy members of a collection's settings object, keeping
 * every other member. `undefined` removes a member.
 *
 * @param store - the `collection_settings` store
 * @param collection - which collection
 * @param patch - the members to set or (with `undefined`) remove
 */
export async function writeCollectionPrivacySettings(
  store: CollectionSettingsStore,
  collection: CollectionRef,
  patch: {
    readonly privacyMode?: PrivacyMode | undefined;
    readonly routineConfirmation?: RoutineConfirmation | undefined;
    readonly reportRoutineConfirmation?: RoutineConfirmation | undefined;
    readonly recommendRoutineConfirmation?: RoutineConfirmation | undefined;
  },
): Promise<void> {
  const current =
    (await store.get(collection.libraryID, collection.collectionKey)) ?? {};
  const next: Record<string, unknown> = { ...current };
  for (const member of ["privacyMode", ...ROUTINE_MEMBERS] as const) {
    if (!(member in patch)) continue;
    const value = patch[member];
    if (value === undefined) delete next[member];
    else next[member] = value;
  }
  await store.put(collection.libraryID, collection.collectionKey, next);
}

/** What {@link loadPrivacyPolicy} needs. */
export interface LoadPrivacyPolicyDeps {
  /** The `privacy.mode` preference (`getPref("privacyMode")` at the root). */
  readonly globalMode: () => PrivacyMode;
  /** The `collection_settings` store; absent when the database is not open. */
  readonly store: CollectionSettingsStore | undefined;
  readonly logger?: Logger;
}

/**
 * The policy for a job over `collection`: the global mode and the
 * collection's override (`P3-T35` builds the context with it).
 *
 * Fails **closed**: a store that cannot answer, or a row that cannot be read,
 * yields a strict policy and one `warn` line — never the global mode alone,
 * which could be looser than the collection's override. A job with no
 * collection runs under the global mode.
 *
 * @param deps - see {@link LoadPrivacyPolicyDeps}
 * @param collection - the job's collection, if it has one
 * @returns the policy
 */
export async function loadPrivacyPolicy(
  deps: LoadPrivacyPolicyDeps,
  collection: CollectionRef | undefined,
): Promise<PrivacyPolicy> {
  return loadStrictestPrivacyPolicy(
    deps,
    collection === undefined ? [] : [collection],
  );
}

/**
 * The policy for a job over several collections at once: the **strictest**
 * of the global mode and every listed collection's override, by the order of
 * {@link PRIVACY_MODES} — {@link effectiveMode} folded over the list, so each
 * override can still only tighten (`docs/09` §3.5's note of 2026-10-29). The
 * item pane's one-item run passes every collection its item belongs to
 * (owner, `plan/00` §6 item 305(a)); {@link loadPrivacyPolicy} passes one or
 * none.
 *
 * Fails **closed** as {@link loadPrivacyPolicy} does: with at least one
 * collection, a missing store or any row that cannot be read gives strict
 * and one `warn` line. An empty list gives the global mode.
 *
 * @param deps - see {@link LoadPrivacyPolicyDeps}
 * @param collections - the job's collections; empty for none
 * @returns the policy
 */
export async function loadStrictestPrivacyPolicy(
  deps: LoadPrivacyPolicyDeps,
  collections: readonly CollectionRef[],
): Promise<PrivacyPolicy> {
  const globalMode = deps.globalMode();
  if (collections.length === 0) return createPrivacyPolicy(globalMode);
  const store = deps.store;
  if (store === undefined) {
    deps.logger?.warn(
      "no collection_settings store: the job runs in strict privacy mode",
    );
    return createPrivacyPolicy("strict");
  }
  try {
    let mode = effectiveMode(globalMode, undefined);
    for (const collection of collections) {
      const stored = await store.get(
        collection.libraryID,
        collection.collectionKey,
      );
      mode = effectiveMode(
        mode,
        readCollectionPrivacySettings(stored).privacyMode,
      );
    }
    return createPrivacyPolicy(mode);
  } catch (error) {
    deps.logger?.warn(
      "could not read the collection's privacy settings: the job runs in " +
        "strict privacy mode",
      { error },
    );
    return createPrivacyPolicy("strict");
  }
}

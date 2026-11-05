/**
 * What the recommend pipeline takes and returns (`plan/08` `P5-T25`). `docs/07` §12.5's
 * note "As built 2026-11-05" is these types' authority and holds their decisions.
 *
 * **Who constructs what.** `recommendPipeline.ts` builds every value here except
 * {@link RecommendInput} and {@link RecommendSurface}, which the window's host builds
 * (`P5-T26`). `P5-T26` reads {@link RecommendProfileResult} and `P5-T27` reads
 * {@link RecommendRows}.
 */

import type { SerializedError } from "../../core/errors";
import type { MainWindowMessageId } from "../../i18n/keys";
import type { CollectionProfile, ProfileUserEdits } from "../../model/profile";
import type { SimilaritySpace } from "../../model/recommendation";
import type { SourceId } from "../../model/ids";
import type { AbstractBackfillReport } from "../searchImport/backfill";
import type { DedupeMergeResult } from "../searchImport/stages";
import type { EgressLogEntry } from "../shared/egressDisclosure";
import type { SummarizeQuestion } from "../summarize/summarizePipeline";
import type { Pipeline, PipelineContext } from "../types";
import type { RecommendGeneratorStatus } from "./generators";
import type { ProfileCallSurface, ProfileHeuristicReason } from "./profileCall";
import type { RecommendDropReason, RecommendationRow } from "./score";

/** The collection a run is about. */
export interface RecommendTarget {
  readonly libraryID: number;
  readonly collectionKey: string;
}

/** FR-44's first half: build or reuse the profile, and end with it. Sends no candidate request. */
export interface RecommendProfileOnlyInput extends RecommendTarget {
  readonly mode: "profile-only";
}

/** FR-44's second half: a new job, with what the user saw and changed. */
export interface RecommendEditedProfileInput extends RecommendTarget {
  readonly mode: "edited-profile";
  /** The profile the panel showed: `RecommendProfileResult.profile`. */
  readonly profile: CollectionProfile;
  /** What the user removed and added, stored as `userEdits`. */
  readonly edits: ProfileUserEdits;
  /** FR-49's per-run toggle. */
  readonly showDismissed: boolean;
  /** `plan/08` §0.4 line 24's per-run box. */
  readonly peerReviewedOnly: boolean;
  /** The Familiar ↔ Exploratory slider divided by 100, in [0, 1]. */
  readonly exploration: number;
}

/** One job's request (`plan/08` §0.4 line 20). */
export type RecommendInput =
  RecommendProfileOnlyInput | RecommendEditedProfileInput;

/** `SummarizeQuestion`'s budget stop: the cost dialog already words it. */
export type RecommendBudgetQuestion = Extract<
  SummarizeQuestion,
  { readonly reason: "budget-stop" }
>;

/** The window, as this run sees it (`P5-T26`). */
export interface RecommendSurface extends ProfileCallSurface {
  /** A spend ceiling refused the call. The stage stays pending. A rejection stops. */
  ask(question: RecommendBudgetQuestion): Promise<"resume" | "cancel">;
}

/** What the run asks and what it stores about the profile, on either success. */
interface RecommendProfileNotes {
  /** Why the profile has no model's text, when this run built it and has none. */
  readonly heuristicReason?: ProfileHeuristicReason;
  /** `runProfileCall`'s message for the window; absent with no provider. */
  readonly warningId?: MainWindowMessageId;
  /**
   * The vectors of some members could not be fetched, so the profile was not stored
   * and the next keyed run fetches them again (`P5-T21`'s finding 3).
   */
  readonly vectorsIncomplete: boolean;
}

/** What every ending has. */
interface RecommendEnding {
  /** The last stage entered. */
  readonly stageReached: string;
  /** This job's egress log, when the profile call sent a request. */
  readonly egress?: EgressLogEntry;
}

/** `docs/07` §12.5's `Failed`: a `SerializedError`, already redacted. */
export interface RecommendFailed extends RecommendEnding {
  readonly outcome: "failed";
  readonly error: SerializedError;
  /** Empty when the run stopped before the generators. */
  readonly statuses: readonly RecommendGeneratorStatus[];
  /** FR-44's refusal: `itemCount` fills the message's `$count`. */
  readonly tooFewItems?: {
    readonly itemCount: number;
    readonly minimum: number;
  };
}

/** The user cancelled or declined. Cache, vectors and stored rows stay. */
export interface RecommendCancelled extends RecommendEnding {
  readonly outcome: "cancelled";
}

/** A profile-only run's result. The job ends here. */
export interface RecommendProfileResult
  extends RecommendEnding, RecommendProfileNotes {
  readonly outcome: "succeeded";
  readonly ending: "profile";
  /** With any stored `userEdits`. */
  readonly profile: CollectionProfile;
  /** `false`: the stored profile was fresh, so no vector or model was asked. */
  readonly built: boolean;
}

/** Which similarity space scored the rows, and what went wrong with it. */
export interface RecommendSimilarityReport {
  readonly space: SimilaritySpace;
  /**
   * `"no-store"`: a run with a key had no vector store.
   * `"no-vectors"`: a run with a key got no member's vector, so it has no centroids.
   * `"fetch-failed"`: a batch failed, so works without a vector read 0.
   */
  readonly notice?: "no-store" | "no-vectors" | "fetch-failed";
  /** The failure behind `"fetch-failed"`. */
  readonly error?: SerializedError;
}

/** What the metadata fill-in did. Only `identifierFilters`' survivors were asked about. */
export interface RecommendFillInReport {
  /** Identifiers sent to `lookup`, counted once per source. */
  readonly sent: number;
  /** Identifiers past the budget, not sent. */
  readonly unsent: number;
  readonly failed: readonly {
    readonly sourceId: SourceId;
    readonly code: string;
  }[];
  /** Survivors dropped because no lookup found them a title. */
  readonly untitled: number;
  readonly backfill: AbstractBackfillReport;
  readonly warnings: readonly string[];
}

/** An edited-profile run's result. Zero rows is still this ending. */
export interface RecommendRows extends RecommendEnding, RecommendProfileNotes {
  readonly outcome: "succeeded";
  readonly ending: "rows";
  /** The profile that drove this run, with the edits. */
  readonly profile: CollectionProfile;
  /** The user did not see {@link profile}, so the window says so (FR-44). */
  readonly profileRebuilt: boolean;
  /** In the order `diversify` picked, at most the top K. */
  readonly rows: readonly RecommendationRow[];
  readonly statuses: readonly RecommendGeneratorStatus[];
  /** The run found no usable Semantic Scholar key. The window words it. */
  readonly keyNotice: boolean;
  readonly similarity: RecommendSimilarityReport;
  /** Both filters' counts, added. */
  readonly dropped: Readonly<Record<RecommendDropReason, number>>;
  readonly fillIn: RecommendFillInReport;
  /** Rows the cached references gave a `coupling` above 0, for `P5-T30`. */
  readonly couplingRows: number;
  readonly links: DedupeMergeResult["links"];
  readonly flags: DedupeMergeResult["flags"];
}

/** What a run returns; it does not reject. */
export type RecommendOutput =
  RecommendProfileResult | RecommendRows | RecommendFailed | RecommendCancelled;

/** `createRecommendPipeline`'s type, for the window's host to narrow to (`P5-T26`). */
export interface RecommendPipeline extends Pipeline<
  RecommendInput,
  RecommendOutput
> {
  /**
   * The run, with the window's questions. `run` is this with a surface that declines
   * every question, so nothing is spent without a window.
   *
   * @param input - the job's request
   * @param ctx - the job's context
   * @param surface - who is asked
   * @returns the ending; it does not reject
   */
  execute(
    input: RecommendInput,
    ctx: PipelineContext,
    surface: RecommendSurface,
  ): Promise<RecommendOutput>;
  /**
   * "Not interested": the one write of a user's action (`plan/08` §0.2 item 27). Called
   * by the window (`P5-T27`), after the job has ended.
   *
   * @param profileId - `RecommendRows.profile.id`
   * @param workKey - the row's work key
   * @returns whether a row was there to mark; `false` with no store, or for a row that
   *   was never stored
   * @throws StorageError when the store fails
   */
  reject(profileId: string, workKey: string): Promise<boolean>;
}

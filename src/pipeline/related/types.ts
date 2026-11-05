/**
 * What the related pipeline takes and returns (`plan/08` `P5-T14`). `docs/07` §12.2's
 * note "As built 2026-11-05" is these types' authority and holds their decisions.
 *
 * **Who constructs what.** `relatedPipeline.ts` builds every value here except
 * {@link RelatedInput}, which the search window's host builds (`P5-T16`), and
 * {@link RelatedLibrary}, which `createZoteroRelatedLibrary` builds
 * (`src/bootstrap/registerPipelines.ts`). `relatedViewModel.ts` (`P5-T16`) reads
 * {@link RelatedOutput} and {@link RelatedRow}.
 */

import type { SerializedError } from "../../core/errors";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SimilaritySpace } from "../../model/recommendation";
import type { LibraryItemFields } from "../../sources/shared/dedupe";
import type { LibraryIndex } from "../../zotero/libraryIndex";
import type { DedupeMergeResult } from "../searchImport/stages";
import type { Pipeline } from "../types";
import type {
  RelatedGenerationResult,
  RelatedGeneratorStatus,
} from "./generators";
import type { ScoredRelatedCandidate } from "./score";
import type { ResolvedSeed, SeedSourceFailure } from "./seed";

/** One run. A pick from `ending: "choose"` is a new run with `chosenSeed` set. */
export interface RelatedInput {
  /** The item the user asked about. Its text and its library are read on every run. */
  readonly seedItemID: number;
  /** One of the `candidates` the window showed: the run makes no title match. */
  readonly chosenSeed?: CanonicalWork;
}

/** A scored candidate, marked against the library. The score does not change. */
export interface RelatedRow extends ScoredRelatedCandidate {
  /** FR-16: the library holds this work, so the row starts unticked. */
  readonly inLibrary: boolean;
  /** The item that holds it, when {@link inLibrary}: by identifier or by title. */
  readonly existingItemID?: number;
}

/** Which similarity space this run used, chosen once, and what went wrong with it. */
export interface RelatedSimilarityReport {
  readonly space: SimilaritySpace;
  /**
   * `"no-store"`: a run with a key had no vector store, so it used the lexical space.
   * `"fetch-failed"`: a batch failed, so works without a vector score 0.
   */
  readonly notice?: "no-store" | "fetch-failed";
  /** The failure behind `"fetch-failed"`. */
  readonly error?: SerializedError;
}

/** The seed item, as the {@link RelatedLibrary} reads it. */
export interface RelatedSeedItem {
  readonly work: CanonicalWork;
  readonly libraryID: number;
}

/** The pipeline's Zotero reads. It has no write member (`plan/08` `P5-T14`). */
export interface RelatedLibrary {
  /** `undefined`: no such item, not a regular item, or in the trash. */
  readSeed(itemID: number): Promise<RelatedSeedItem | undefined>;
  /** For `findExisting` and the work keys `ensureEmbeddings` protects. */
  libraryIndex(libraryID: number): Promise<LibraryIndex>;
  /** For `matchAgainstLibrary`'s index: the title half of the mark. */
  libraryItems(libraryID: number): Promise<Iterable<LibraryItemFields>>;
}

/** What every ending has. */
interface RelatedEnding {
  /** The last stage entered. */
  readonly stageReached: string;
  /** Services that failed while the seed was read; the run went on without them. */
  readonly seedFailures: readonly SeedSourceFailure[];
}

/** `docs/07` §12.2's `Failed`: a `SerializedError`, already redacted. */
export interface RelatedFailed extends RelatedEnding {
  readonly outcome: "failed";
  readonly error: SerializedError;
  /** Empty when the run stopped before the generators. */
  readonly statuses: readonly RelatedGeneratorStatus[];
}

/** The user cancelled. Cache entries and fetched vectors stay; the library is untouched. */
export interface RelatedCancelled extends RelatedEnding {
  readonly outcome: "cancelled";
}

/** FR-14: the window asks which work the item is, and sends the pick back. */
export interface RelatedChoose extends RelatedEnding {
  readonly outcome: "succeeded";
  readonly ending: "choose";
  readonly candidates: readonly CanonicalWork[];
}

/** The list. Zero rows is still this ending (`docs/07` §12.2's note, decision 2). */
export interface RelatedRows extends RelatedEnding {
  readonly outcome: "succeeded";
  readonly ending: "rows";
  /** With its identifiers filled in. `matchedByTitle` drives `docs/08` §5.3's banner. */
  readonly seed: ResolvedSeed;
  /** Highest score first, with `outsideWindow` rows kept in place. */
  readonly rows: readonly RelatedRow[];
  readonly statuses: readonly RelatedGeneratorStatus[];
  /** The run found no usable Semantic Scholar key. The window words it. */
  readonly keyNotice: boolean;
  readonly similarity: RelatedSimilarityReport;
  readonly hydration: RelatedGenerationResult["hydration"];
  readonly links: DedupeMergeResult["links"];
  readonly flags: DedupeMergeResult["flags"];
}

/** What {@link RelatedPipeline} returns; it does not reject. */
export type RelatedOutput =
  RelatedRows | RelatedChoose | RelatedFailed | RelatedCancelled;

/** `createRelatedPipeline`'s type, for the window's host to narrow to (`P5-T16`). */
export type RelatedPipeline = Pipeline<RelatedInput, RelatedOutput>;

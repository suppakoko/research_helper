/**
 * How a related-paper record relates to its seed — `docs/07` §4.2's
 * `// src/model/related.ts` block (`P5-T01`).
 *
 * **Scope.** Transcribed from `docs/07-architecture-and-data-model.md` §4.2,
 * which `plan/README.md` §5 rule 3 makes the sole authority for types. These are
 * model types rather than `sources/` types because pipelines read them too, and
 * `model/` cannot import `sources/` (`docs/07` §2.3).
 *
 * **Callers.** `RelatedPage` in `src/sources/types.ts` references
 * {@link RelationEdge}. Nothing constructs one yet: the adapter cards `P5-T05` to
 * `P5-T09` do, and `P5-T12` and `P5-T13` read them.
 *
 * Types only: `model/` imports nothing but `model/`.
 */

/**
 * How a record relates to the seed, read from the seed's side:
 *   - "reference": the seed cites this record (FR-15's "cited by seed").
 *   - "citation": this record cites the seed (FR-15's "cites seed").
 *   - "recommendation": a source's recommender returned it (FR-15's "recommended").
 *   - "similar": a source's similar-articles list returned it (PubMed).
 */
export type RelationKind =
  "reference" | "citation" | "recommendation" | "similar";

export interface RelationEdge {
  readonly kind: RelationKind;
  /** 1-based position in this source's own list for this seed. */
  readonly rank: number;
  /** The source's own relevance, normalised to (0, 1], when it gives one (PubMed's similar articles). */
  readonly score?: number;
  /** Citation contexts, when the source returns them (Semantic Scholar). */
  readonly contexts?: readonly string[];
}

/**
 * The lexical similarity floor — `docs/05` §5.5, as built by `P5-T19`.
 *
 * A TF-IDF cosine over title, abstract and MeSH, computed entirely on this
 * machine: no network, no key, no model. It is what every similarity term falls
 * back to on a run without Semantic Scholar's SPECTER2 vectors (`plan/00` §6 item
 * 320(b)). `docs/05` §5.5's dated note of 2026-11-02 records the formula, the
 * readings it settles and the measurement behind them; this header does not
 * repeat them.
 *
 * **Callers.** `relatedPipeline.ts` (`P5-T14`) builds the
 * `SimilarityFn` of a keyless related run from it, `src/pipeline/recommend/score.ts`
 * (`P5-T24`) reads similarity and novelty from it, and `seeds.ts` (`P5-T21`)
 * diversifies seeds on it. `P5-T28` proves the keyless path end to end. Each
 * constructs its own {@link lexicalSpace} per run; vectors are never stored
 * (`docs/10`'s out-of-scope item 6 rules out a persistent vector store).
 *
 * **Never mix two spaces (`plan/08` §0.2 item 22).** A {@link LexicalVector} is not
 * assignable to anything SPECTER2-shaped, and {@link LexicalSpace.cosine} throws on
 * a vector it did not issue, because a vector built under another corpus's IDF is
 * another space even though its name is the same.
 *
 * **Deterministic.** Terms are sorted by UTF-16 code unit and every sum runs in
 * that order, so the result does not depend on the order of the corpus, of the
 * words or of the arguments, and no locale is consulted.
 *
 * **Scripts.** Tokens come from `normalizeTitle`, which keeps letters and digits of
 * every script and splits on everything else, so any text is safe. Overlap outside
 * Latin text is weaker: see the dated note, and `test/unit/pipeline/lexical.test.ts`.
 */

import type { CanonicalWork } from "../../model/canonicalWork";
import type { SimilaritySpace } from "../../model/recommendation";
import { normalizeTitle, titleTokens } from "../../sources/shared/dedupe";

/**
 * The id the window renders as "basic similarity" (`docs/05` §5.5). An id, not a
 * string: no card has added the message yet.
 */
export const LEXICAL_SIMILARITY_LABEL_ID = "basic-similarity";

/** `docs/05` §5.5's weights, over abstract terms. */
const ABSTRACT_WEIGHT = 1;
const TITLE_WEIGHT = 1.5;
const MESH_WEIGHT = 2;

/** `Subject.scheme` of a MeSH descriptor, as `src/sources/pubmed/mapper.ts` writes it. */
const MESH_SCHEME = "mesh";

/** The fields a lexical vector reads. Every `CanonicalWork` is one. */
export type LexicalWork = Pick<
  CanonicalWork,
  "title" | "abstract" | "subjects"
>;

/**
 * A sparse vector of unit length, or empty for a work with no text. Comparable only
 * through the {@link LexicalSpace} that issued it.
 */
export interface LexicalVector {
  readonly space: Extract<SimilaritySpace, "lexical">;
  /** Sorted by UTF-16 code unit, no repeats. */
  readonly terms: readonly string[];
  /** Parallel to {@link terms}, each above 0. */
  readonly weights: readonly number[];
}

export interface LexicalSpace {
  readonly space: Extract<SimilaritySpace, "lexical">;
  readonly labelId: typeof LEXICAL_SIMILARITY_LABEL_ID;
  vector(work: LexicalWork): LexicalVector;
  /**
   * In [0, 1], already: weights are never negative, so this must not pass through
   * `docs/05` §7.4's `(cosine + 1) / 2`. 0 when either vector is empty.
   * @throws when a vector came from another space.
   */
  cosine(a: LexicalVector, b: LexicalVector): number;
}

function tokens(text: string | undefined): readonly string[] {
  return text === undefined ? [] : titleTokens(normalizeTitle(text));
}

/**
 * The tokens of the work's distinct MeSH descriptors. Distinct because a merged work
 * can carry one descriptor from two sources, which is not two indexings.
 */
function meshTokens(work: LexicalWork): readonly string[] {
  const descriptors = new Set<string>();
  for (const subject of work.subjects ?? []) {
    if (subject.scheme === MESH_SCHEME) {
      descriptors.add(normalizeTitle(subject.term));
    }
  }
  return [...descriptors].flatMap(titleTokens);
}

/**
 * Adds one field's term frequencies: `weight × (1 + ln count)`, so a word used once
 * counts its field's full weight and repeats count for less.
 */
function addField(
  frequencies: Map<string, number>,
  fieldTokens: readonly string[],
  weight: number,
): void {
  const counts = new Map<string, number>();
  for (const token of fieldTokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    frequencies.set(
      token,
      (frequencies.get(token) ?? 0) + weight * (1 + Math.log(count)),
    );
  }
}

/**
 * Builds the space whose IDF comes from `corpus` (`docs/05` §5.5: the user's own
 * collection; the caller chooses). `corpus` is read once, here. An empty corpus is
 * legal and weighs every term alike.
 */
export function lexicalSpace(corpus: readonly LexicalWork[]): LexicalSpace {
  const documentFrequency = new Map<string, number>();
  for (const work of corpus) {
    const distinct = new Set([
      ...tokens(work.title),
      ...tokens(work.abstract),
      ...meshTokens(work),
    ]);
    for (const term of distinct) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  /** Above 0 for every term and every corpus, so no term of a real work vanishes. */
  const idf = (term: string): number =>
    Math.log(
      1 + (1 + corpus.length) / (1 + (documentFrequency.get(term) ?? 0)),
    );

  const issued = new WeakSet<LexicalVector>();

  return {
    space: "lexical",
    labelId: LEXICAL_SIMILARITY_LABEL_ID,

    vector(work: LexicalWork): LexicalVector {
      const frequencies = new Map<string, number>();
      addField(frequencies, tokens(work.abstract), ABSTRACT_WEIGHT);
      addField(frequencies, tokens(work.title), TITLE_WEIGHT);
      addField(frequencies, meshTokens(work), MESH_WEIGHT);

      const terms = [...frequencies.keys()].sort();
      const raw = terms.map((term) => (frequencies.get(term) ?? 0) * idf(term));
      const norm = Math.sqrt(raw.reduce((sum, w) => sum + w * w, 0));
      const vector: LexicalVector = {
        space: "lexical",
        terms,
        weights: raw.map((w) => w / norm),
      };
      issued.add(vector);
      return vector;
    },

    cosine(a: LexicalVector, b: LexicalVector): number {
      if (!issued.has(a) || !issued.has(b)) {
        throw new Error(
          "lexicalSpace.cosine: a vector from another space (plan/08 §0.2 item 22)",
        );
      }
      let dot = 0;
      let i = 0;
      let j = 0;
      while (i < a.terms.length && j < b.terms.length) {
        const left = a.terms[i] as string;
        const right = b.terms[j] as string;
        if (left === right) {
          dot += (a.weights[i] as number) * (b.weights[j] as number);
          i += 1;
          j += 1;
        } else if (left < right) {
          i += 1;
        } else {
          j += 1;
        }
      }
      // Rounding can carry a unit vector's dot with itself just past 1.
      return Math.min(1, dot);
    },
  };
}

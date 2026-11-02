/**
 * `P5-T19`: the lexical similarity floor (`docs/05` §5.5 and its dated note of
 * 2026-11-02). Every work below is SYNTHETIC. No network, no key, no LLM call.
 */

import { describe, expect, it } from "vitest";

import type { Subject } from "../../../src/model/canonicalWork";
import {
  LEXICAL_SIMILARITY_LABEL_ID,
  lexicalSpace,
  type LexicalVector,
  type LexicalWork,
} from "../../../src/pipeline/shared/lexical";

const mesh = (...terms: string[]): Subject[] =>
  terms.map((term) => ({ term, scheme: "mesh" }));

/** The raw weight ratio of two terms of a unit vector. */
function ratio(vector: LexicalVector, a: string, b: string): number {
  const weight = (term: string): number => {
    const at = vector.terms.indexOf(term);
    expect(at, term).toBeGreaterThanOrEqual(0);
    return vector.weights[at] as number;
  };
  return weight(a) / weight(b);
}

function similarity(
  a: LexicalWork,
  b: LexicalWork,
  corpus: readonly LexicalWork[] = [a, b],
): number {
  const space = lexicalSpace(corpus);
  return space.cosine(space.vector(a), space.vector(b));
}

const RICH: LexicalWork = {
  title: "CRISPR base editing in plants",
  abstract:
    "Base editors change single nucleotides without a double strand break.",
  subjects: mesh("Gene Editing", "Plants, Genetically Modified"),
};

describe("lexicalSpace: the card's three cases", () => {
  it("scores identical works 1", () => {
    expect(similarity(RICH, { ...RICH })).toBeCloseTo(1, 12);
  });

  it("scores identical works 1 whatever the corpus says about their words", () => {
    // Every word of the work is in every corpus document: a plain log(N/df) would zero all of it.
    expect(similarity(RICH, { ...RICH }, [RICH])).toBeCloseTo(1, 12);
    expect(similarity(RICH, { ...RICH }, [RICH, RICH, RICH])).toBeCloseTo(
      1,
      12,
    );
    expect(similarity(RICH, { ...RICH }, [])).toBeCloseTo(1, 12);
  });

  it("scores disjoint works exactly 0", () => {
    const other: LexicalWork = {
      title: "Glacier retreat",
      abstract: "Ice loss across alpine valleys.",
      subjects: mesh("Climate"),
    };
    expect(similarity(RICH, other)).toBe(0);
  });

  it("moves more on MeSH overlap than on title overlap, and on title than on abstract", () => {
    // Each pair shares one word, in one field, against the same unshared words.
    const filler = { left: "north east", right: "south west" };
    const inMesh = similarity(
      { title: filler.left, subjects: mesh("kinase") },
      { title: filler.right, subjects: mesh("kinase") },
      [],
    );
    const inTitle = similarity(
      { title: `${filler.left} kinase` },
      { title: `${filler.right} kinase` },
      [],
    );
    const inAbstract = similarity(
      { title: filler.left, abstract: "kinase" },
      { title: filler.right, abstract: "kinase" },
      [],
    );
    expect(inMesh).toBeGreaterThan(inTitle);
    expect(inTitle).toBeGreaterThan(inAbstract);
    expect(inAbstract).toBeGreaterThan(0);
  });
});

describe("lexicalSpace: the formula", () => {
  it("weighs one use of a word at MeSH 2, title 1.5, abstract 1", () => {
    const vector = lexicalSpace([]).vector({
      title: "beta",
      abstract: "alpha",
      subjects: mesh("gamma"),
    });
    expect(ratio(vector, "gamma", "alpha")).toBeCloseTo(2, 12);
    expect(ratio(vector, "beta", "alpha")).toBeCloseTo(1.5, 12);
  });

  it("adds a word's fields together", () => {
    const vector = lexicalSpace([]).vector({
      title: "alpha",
      abstract: "alpha beta",
      subjects: mesh("alpha"),
    });
    expect(ratio(vector, "alpha", "beta")).toBeCloseTo(1 + 1.5 + 2, 12);
  });

  it("counts repeats within a field as 1 + ln(count)", () => {
    const vector = lexicalSpace([]).vector({
      title: "",
      abstract: "alpha alpha alpha beta",
    });
    expect(ratio(vector, "alpha", "beta")).toBeCloseTo(1 + Math.log(3), 12);
  });

  it("uses ln(1 + (1 + N) / (1 + df)) for the IDF, with df 0 for an unseen word", () => {
    const corpus: LexicalWork[] = [
      { title: "common rare" },
      { title: "common" },
      { title: "common" },
    ];
    const vector = lexicalSpace(corpus).vector({ title: "common rare unseen" });
    expect(ratio(vector, "rare", "common")).toBeCloseTo(
      Math.log(1 + 4 / 2) / Math.log(1 + 4 / 4),
      12,
    );
    expect(ratio(vector, "unseen", "rare")).toBeCloseTo(
      Math.log(1 + 4 / 1) / Math.log(1 + 4 / 2),
      12,
    );
  });

  it("counts a corpus document once per word, across all its fields", () => {
    const corpus: LexicalWork[] = [
      {
        title: "alpha alpha",
        abstract: "alpha alpha alpha",
        subjects: mesh("alpha"),
      },
      { title: "beta" },
      { title: "other" },
    ];
    const vector = lexicalSpace(corpus).vector({ title: "alpha beta" });
    expect(ratio(vector, "alpha", "beta")).toBeCloseTo(1, 12);
  });

  it("reads MeSH words from a corpus document for the IDF", () => {
    const corpus: LexicalWork[] = [
      { title: "other", subjects: mesh("alpha") },
      { title: "beta" },
    ];
    const vector = lexicalSpace(corpus).vector({ title: "alpha beta" });
    expect(ratio(vector, "alpha", "beta")).toBeCloseTo(1, 12);
  });

  it("reads abstract words from a corpus document for the IDF", () => {
    const corpus: LexicalWork[] = [
      { title: "other", abstract: "alpha" },
      { title: "beta" },
    ];
    const vector = lexicalSpace(corpus).vector({ title: "alpha beta" });
    expect(ratio(vector, "alpha", "beta")).toBeCloseTo(1, 12);
  });

  it("lets a rare shared word count for more than a common one", () => {
    const corpus: LexicalWork[] = [
      { title: "cell line" },
      { title: "cell culture" },
      { title: "cell death crispr" },
    ];
    const a = (word: string): LexicalWork => ({ title: `north ${word}` });
    const b = (word: string): LexicalWork => ({ title: `south ${word}` });
    expect(similarity(a("crispr"), b("crispr"), corpus)).toBeGreaterThan(
      similarity(a("cell"), b("cell"), corpus),
    );
  });

  it("splits a descriptor into words, in one vocabulary with the other fields", () => {
    expect(
      similarity(
        { title: "CRISPR screens" },
        { title: "other", subjects: mesh("CRISPR-Cas Systems") },
      ),
    ).toBeGreaterThan(0);
  });

  it("reads only MeSH among the subjects", () => {
    const vector = lexicalSpace([]).vector({
      title: "alpha",
      subjects: [
        { term: "cs.LG", scheme: "arxiv-category" },
        { term: "Biochemistry", scheme: "crossref" },
      ],
    });
    expect(vector.terms).toEqual(["alpha"]);
  });

  it("reads one descriptor once, however many sources supplied it", () => {
    const vector = lexicalSpace([]).vector({
      title: "alpha",
      subjects: mesh("Humans", "HUMANS", "humans"),
    });
    expect(ratio(vector, "humans", "alpha")).toBeCloseTo(2 / 1.5, 12);
  });

  it("returns unit vectors with sorted, distinct terms", () => {
    const vector = lexicalSpace([RICH]).vector(RICH);
    expect(vector.weights.reduce((s, w) => s + w * w, 0)).toBeCloseTo(1, 12);
    expect([...vector.terms].sort()).toEqual(vector.terms);
    expect(new Set(vector.terms).size).toBe(vector.terms.length);
    expect(vector.weights.every((w) => w > 0)).toBe(true);
    expect(vector.space).toBe("lexical");
  });
});

describe("lexicalSpace: normalisation is normalizeTitle's", () => {
  it("ignores case, accents, tags, entities, dashes and punctuation", () => {
    expect(
      similarity(
        { title: "<i>CRISPR</i>–Cas9: café &amp; protéine." },
        { title: "crispr cas9 cafe protéine" },
      ),
    ).toBeCloseTo(1, 12);
  });

  it("handles words that are also Object.prototype members", () => {
    const work: LexicalWork = { title: "constructor toString valueOf" };
    expect(similarity(work, { ...work }, [work])).toBeCloseTo(1, 12);
  });
});

describe("lexicalSpace: determinism", () => {
  const corpus: LexicalWork[] = [
    RICH,
    { title: "Base editing in rice", abstract: "Editors in rice plants." },
    { title: "Rice yield", subjects: mesh("Oryza", "Plants") },
    { title: "Glacier retreat", abstract: "Ice loss across valleys." },
  ];
  const left: LexicalWork = {
    title: "Editing rice with base editors",
    abstract: "Single nucleotides change in rice plants without a break.",
    subjects: mesh("Gene Editing", "Oryza"),
  };

  it("gives bit-identical results on two runs", () => {
    const run = (): number => similarity(RICH, left, corpus);
    expect(run()).toBe(run());
  });

  it("does not depend on the order of the corpus", () => {
    expect(similarity(RICH, left, [...corpus].reverse())).toBe(
      similarity(RICH, left, corpus),
    );
  });

  it("does not depend on the order of the arguments", () => {
    const space = lexicalSpace(corpus);
    const a = space.vector(RICH);
    const b = space.vector(left);
    expect(space.cosine(a, b)).toBe(space.cosine(b, a));
  });

  it("does not depend on the order of the words or the descriptors", () => {
    const space = lexicalSpace(corpus);
    const a = space.vector({
      title: "one two three",
      abstract: "four five six four",
      subjects: mesh("Seven Eight", "Nine"),
    });
    const b = space.vector({
      title: "three one two",
      abstract: "six four five four",
      subjects: mesh("Nine", "Seven Eight"),
    });
    expect(b.terms).toEqual(a.terms);
    expect(b.weights).toEqual(a.weights);
  });

  it("does not let rounding carry a score past 1", () => {
    // Unclamped, this work's dot product with itself is 1.0000000000000002.
    const space = lexicalSpace([]);
    const vector = space.vector({ title: "aa", abstract: "b c d e f" });
    expect(space.cosine(vector, vector)).toBeLessThanOrEqual(1);
  });

  it("stays in [0, 1], with no NaN, over every pair of a small set", () => {
    const space = lexicalSpace(corpus);
    const vectors = [...corpus, left, { title: "" }].map((w) =>
      space.vector(w),
    );
    for (const a of vectors) {
      for (const b of vectors) {
        const score = space.cosine(a, b);
        expect(Number.isNaN(score)).toBe(false);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("lexicalSpace: one space at a time (plan/08 §0.2 item 22)", () => {
  it("throws on a vector from another corpus, in either position", () => {
    const one = lexicalSpace([RICH]);
    const two = lexicalSpace([]);
    const own = one.vector(RICH);
    const foreign = two.vector(RICH);
    expect(() => one.cosine(own, foreign)).toThrow(/another space/);
    expect(() => one.cosine(foreign, own)).toThrow(/another space/);
  });

  it("names its space and the label id the window renders", () => {
    const space = lexicalSpace([]);
    expect(space.space).toBe("lexical");
    expect(space.labelId).toBe(LEXICAL_SIMILARITY_LABEL_ID);
    expect(LEXICAL_SIMILARITY_LABEL_ID).toBe("basic-similarity");
  });
});

describe("lexicalSpace: a work with no text", () => {
  it("has an empty vector and scores 0 with everything, itself included", () => {
    const space = lexicalSpace([RICH]);
    for (const work of [
      { title: "" },
      { title: "   ", abstract: "" },
      { title: "!!! --- ???", subjects: mesh("...") },
    ] as LexicalWork[]) {
      const empty = space.vector(work);
      expect(empty.terms).toEqual([]);
      expect(empty.weights).toEqual([]);
      expect(space.cosine(empty, empty)).toBe(0);
      expect(space.cosine(empty, space.vector(RICH))).toBe(0);
    }
  });

  it("accepts a corpus of works with no text", () => {
    const space = lexicalSpace([{ title: "" }, { title: "", subjects: [] }]);
    const work = space.vector({ title: "alpha" });
    expect(space.cosine(work, work)).toBeCloseTo(1, 12);
  });
});

describe("lexicalSpace: non-Latin text", () => {
  const KOREAN: LexicalWork = {
    title: "유전자 가위 기술의 최근 동향",
    abstract: "식물에서 염기 편집의 효율을 측정하였다.",
    subjects: mesh("유전자 편집"),
  };

  it("scores identical Korean works 1 and disjoint ones 0", () => {
    expect(similarity(KOREAN, { ...KOREAN })).toBeCloseTo(1, 12);
    expect(similarity(KOREAN, { title: "빙하 후퇴" })).toBe(0);
    expect(similarity(KOREAN, RICH)).toBe(0);
  });

  it("matches a Korean word only when the whole space-separated word recurs", () => {
    const space = lexicalSpace([]);
    const same = space.cosine(
      space.vector({ title: "유전자 가위" }),
      space.vector({ title: "유전자 치료" }),
    );
    expect(same).toBeGreaterThan(0);
    // 유전자의 is 유전자 with a particle attached: nothing here splits it off.
    const withParticle = space.cosine(
      space.vector({ title: "유전자 가위" }),
      space.vector({ title: "유전자의 기능" }),
    );
    expect(withParticle).toBe(0);
  });

  it("does not separate a run of Chinese characters into words", () => {
    const space = lexicalSpace([]);
    expect(
      space.cosine(
        space.vector({ title: "基因编辑技术" }),
        space.vector({ title: "基因治疗技术" }),
      ),
    ).toBe(0);
  });

  it("does not crash on any script, on mixed text or on lone surrogates", () => {
    const works: LexicalWork[] = [
      { title: "ゲノム編集がん治療" },
      { title: "การตัดต่อพันธุกรรม" },
      { title: "तंत्रिका नेटवर्क" },
      { title: "تحرير الجينات" },
      { title: "Редактирование генома" },
      { title: "CRISPR 유전자 基因 ゲノム" },
      { title: "emoji \u{1F9EC} only" },
      { title: "lone \uD83D surrogate" },
    ];
    const space = lexicalSpace(works);
    for (const work of works) {
      const vector = space.vector(work);
      expect(vector.terms.length, work.title).toBeGreaterThan(0);
      expect(space.cosine(vector, vector)).toBeCloseTo(1, 12);
    }
  });

  it("lets Korean and English share a word when a mixed title repeats it", () => {
    expect(
      similarity({ title: "CRISPR 유전자" }, { title: "CRISPR plants" }),
    ).toBeGreaterThan(0);
  });
});

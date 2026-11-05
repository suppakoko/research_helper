/**
 * `P5-T13`: related scoring, reason chips and the recency flag.
 *
 * Plain Node. Expected numbers are written out rather than read from `score.ts`, so a
 * changed weight fails here and is seen. They are `docs/05` §6.2's unmeasured starting
 * values: a passing test says the formula is the one written, not that it ranks well.
 */

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import type {
  CanonicalWork,
  PartialDate,
} from "../../../src/model/canonicalWork";
import type { RelationEdge, RelationKind } from "../../../src/model/related";
import type {
  GeneratorEdge,
  RelatedCandidate,
  RelatedGeneratorId,
} from "../../../src/pipeline/related/generators";
import {
  isCheckedByDefault,
  scoreRelatedCandidates,
  type ReasonChip,
  type RelatedScoreOptions,
  type ScoredRelatedCandidate,
} from "../../../src/pipeline/related/score";
import { recencyWindow } from "../../../src/sources/shared/recency";

/** 2026 in every time zone: `recencyWindow` reads the local year. */
const CLOCK = createManualClock(Date.UTC(2026, 5, 15));
/** 2024 – 2026. */
const WINDOW = recencyWindow(3, CLOCK);

const GENERATOR_OF_KIND: Readonly<Record<RelationKind, RelatedGeneratorId>> = {
  recommendation: "s2-recommendations",
  similar: "pmra",
  citation: "s2-citations",
  reference: "s2-references",
};

function edgeOf(
  kind: RelationKind,
  fields: Partial<RelationEdge> & {
    generator?: RelatedGeneratorId;
    limit?: number;
  } = {},
): GeneratorEdge {
  const { generator, limit, ...edge } = fields;
  return {
    generator: generator ?? GENERATOR_OF_KIND[kind],
    sourceId: "semanticscholar",
    limit: limit ?? 100,
    edge: { kind, rank: 1, ...edge },
  };
}

/** `recScore` 0: the last place on the list counts for nothing but its chip and kind. */
const LAST_RECOMMENDATION = edgeOf("recommendation", { rank: 100, limit: 100 });

let nextKey = 0;

function candidateOf(
  edges: readonly GeneratorEdge[],
  work: Partial<CanonicalWork> = {},
): RelatedCandidate {
  nextKey += 1;
  return {
    work: {
      workKey: `doi:10.1000/${String(nextKey)}`,
      ids: {},
      type: "journal-article",
      title: "A title",
      authors: [],
      provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
      normalizedAtEpochMs: 0,
      ...work,
    },
    records: [],
    decisions: [],
    conflicts: [],
    edges,
  };
}

function dated(year: number): { publishedDate: PartialDate } {
  return { publishedDate: { year, iso: String(year) } };
}

const NO_SIMILARITY = (): number => 0;

function score(
  candidates: readonly RelatedCandidate[],
  options: Partial<RelatedScoreOptions> = {},
): readonly ScoredRelatedCandidate[] {
  return scoreRelatedCandidates(candidates, {
    similarity: NO_SIMILARITY,
    window: WINDOW,
    ...options,
  });
}

function only(
  candidate: RelatedCandidate,
  options: Partial<RelatedScoreOptions> = {},
): ScoredRelatedCandidate {
  const row = score([candidate], options)[0];
  if (row === undefined) throw new Error("no row");
  return row;
}

function scoreOf(
  edges: readonly GeneratorEdge[],
  work: Partial<CanonicalWork> = {},
  options: Partial<RelatedScoreOptions> = {},
): number {
  return only(candidateOf(edges, work), options).score;
}

function chipsOf(
  edges: readonly GeneratorEdge[],
  options: Partial<RelatedScoreOptions> = {},
): readonly ReasonChip[] {
  return only(candidateOf(edges), options).chips;
}

describe("Done when: agreement outranks either signal alone", () => {
  it("found by similar articles and the recommender outranks either alone at equal terms", () => {
    const similar = edgeOf("similar", { score: 0.5 });
    const recommended = edgeOf("recommendation", { rank: 10, limit: 100 });
    const both = candidateOf([similar, recommended]);
    const similarAlone = candidateOf([similar]);
    const recommendedAlone = candidateOf([recommended]);

    const rows = score([similarAlone, recommendedAlone, both]);

    expect(rows[0]?.work.workKey).toBe(both.work.workKey);
    expect(rows[0]?.score).toBeCloseTo(0.27 + 0.1 + 0.08, 10);
  });

  it("the bonus itself decides it: a second list adding no term still adds 0.08", () => {
    const similar = edgeOf("similar", { score: 0.5 });
    const alone = scoreOf([similar]);
    const agreed = scoreOf([similar, LAST_RECOMMENDATION]);

    expect(alone).toBeCloseTo(0.1, 10);
    expect(agreed).toBeCloseTo(0.18, 10);
  });
});

describe("Done when: every candidate has a chip and no score is NaN", () => {
  const kinds: readonly RelationKind[] = [
    "recommendation",
    "similar",
    "citation",
    "reference",
  ];

  it.each(kinds)("a %s edge alone gives a chip", (kind) => {
    expect(chipsOf([edgeOf(kind)]).length).toBeGreaterThanOrEqual(1);
  });

  it.each<[string, Partial<RelationEdge>, number | undefined]>([
    ["a NaN elink score", { score: Number.NaN }, undefined],
    ["an absent elink score", {}, undefined],
    ["a NaN rank", { rank: Number.NaN }, undefined],
    ["a list asked with limit 0", {}, 0],
    ["a NaN limit", {}, Number.NaN],
  ])("%s scores a number", (_name, fields, limit) => {
    const edges = kinds.map((kind) =>
      edgeOf(kind, { ...fields, ...(limit !== undefined && { limit }) }),
    );
    for (const edge of edges) {
      const value = scoreOf([edge]);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it.each<[string, Partial<CanonicalWork>, number]>([
    ["no date and no count", {}, 0],
    ["a NaN year", { publishedDate: { year: Number.NaN, iso: "" } }, 0],
    ["a NaN count", { citationCount: Number.NaN }, 0],
    ["a count below -1", { citationCount: -5 }, 0],
    ["a count of -1", { citationCount: -1 }, 0],
  ])("%s is a missing signal, which is 0", (_name, work, expected) => {
    expect(scoreOf([LAST_RECOMMENDATION], work)).toBe(expected);
  });

  it("one bad value costs its own term, not the row's other terms", () => {
    const citation = edgeOf("citation");
    expect(
      scoreOf([citation], { publishedDate: { year: Number.NaN, iso: "" } }),
    ).toBeCloseTo(0.2, 10);
    expect(
      scoreOf([citation], {
        publishedDate: { year: Number.NEGATIVE_INFINITY, iso: "" },
      }),
    ).toBeCloseTo(0.2, 10);
    expect(scoreOf([citation], { citationCount: Number.NaN })).toBeCloseTo(
      0.2,
      10,
    );
    expect(
      scoreOf([citation, edgeOf("recommendation", { rank: Number.NaN })]),
    ).toBeCloseTo(0.2 + 0.08, 10);
    expect(
      scoreOf([citation, edgeOf("similar", { score: Number.NaN })]),
    ).toBeCloseTo(0.2 + 0.08, 10);
    expect(
      scoreOf([citation], {}, { similarity: () => Number.NaN }),
    ).toBeCloseTo(0.2, 10);
  });

  it("a similarity that is not a number is 0, with no chip", () => {
    const row = only(candidateOf([LAST_RECOMMENDATION]), {
      similarity: () => Number.NaN,
    });
    expect(row.score).toBe(0);
    expect(row.chips).toEqual([{ id: "recommended" }]);
  });
});

describe("recScore", () => {
  it.each([
    [1, 200, 0.2985],
    [50, 100, 0.15],
    [50, 200, 0.225],
    [100, 100, 0],
  ])("rank %i of %i contributes %f", (rank, limit, expected) => {
    expect(scoreOf([edgeOf("recommendation", { rank, limit })])).toBeCloseTo(
      expected,
      10,
    );
  });

  it("a rank past the limit is 0, not a deduction", () => {
    expect(
      scoreOf([
        edgeOf("recommendation", { rank: 300, limit: 100 }),
        edgeOf("citation"),
      ]),
    ).toBeCloseTo(0.2 + 0.08, 10);
  });

  it("takes the best of two recommendation edges, in either order", () => {
    const near = edgeOf("recommendation", { rank: 10, limit: 100 });
    const far = edgeOf("recommendation", { rank: 90, limit: 100 });
    expect(scoreOf([near, far])).toBeCloseTo(0.27, 10);
    expect(scoreOf([far, near])).toBeCloseTo(0.27, 10);
  });

  it("does not read another kind's rank", () => {
    expect(scoreOf([edgeOf("similar", { rank: 1, score: 0.5 })])).toBeCloseTo(
      0.1,
      10,
    );
  });
});

describe("pmraScore", () => {
  it("reads the edge's score as it arrives, without dividing by the run's highest", () => {
    const rows = score([
      candidateOf([edgeOf("similar", { score: 0.5 })]),
      candidateOf([edgeOf("similar", { score: 0.25 })]),
    ]);
    expect(rows[0]?.score).toBeCloseTo(0.1, 10);
    expect(rows[1]?.score).toBeCloseTo(0.05, 10);
  });

  it("clips a score above 1 and takes the best of two edges", () => {
    expect(scoreOf([edgeOf("similar", { score: 7 })])).toBeCloseTo(0.2, 10);
    expect(
      scoreOf([
        edgeOf("similar", { score: 0.25 }),
        edgeOf("similar", { score: 0.75 }),
      ]),
    ).toBeCloseTo(0.15, 10);
    expect(
      scoreOf([
        edgeOf("similar", { score: 0.75 }),
        edgeOf("similar", { score: 0.25 }),
      ]),
    ).toBeCloseTo(0.15, 10);
  });

  it("does not read a score on another kind's edge", () => {
    expect(scoreOf([edgeOf("citation", { score: 0.5 })])).toBeCloseTo(0.2, 10);
  });

  it("an absent score is 0, not the top of the list", () => {
    expect(scoreOf([edgeOf("similar")])).toBe(0);
  });
});

describe("citeScore", () => {
  it.each<RelationKind>(["reference", "citation"])(
    "a %s edge contributes 0.2",
    (kind) => {
      expect(scoreOf([edgeOf(kind)])).toBeCloseTo(0.2, 10);
    },
  );

  it("two contexts change nothing: docs/05 §6.2's +0.2 is capped away", () => {
    expect(
      scoreOf([edgeOf("citation", { contexts: ["one", "two", "three"] })]),
    ).toBeCloseTo(0.2, 10);
  });

  it.each<RelationKind>(["recommendation", "similar"])(
    "a %s edge contributes no citation term",
    (kind) => {
      expect(scoreOf([edgeOf(kind, { rank: 100, limit: 100, score: 0 })])).toBe(
        0,
      );
    },
  );
});

describe("the similarity term", () => {
  it("takes the injected value, weighted 0.2, for this candidate's work", () => {
    const candidate = candidateOf([LAST_RECOMMENDATION]);
    const seen: CanonicalWork[] = [];
    const similarity = (work: CanonicalWork): number => {
      seen.push(work);
      return 0.5;
    };
    expect(only(candidate, { similarity }).score).toBeCloseTo(0.1, 10);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(candidate.work);
  });

  it("does not rescale: 0 stays 0, and a negative value is 0", () => {
    expect(scoreOf([LAST_RECOMMENDATION], {}, { similarity: () => 0 })).toBe(0);
    expect(scoreOf([LAST_RECOMMENDATION], {}, { similarity: () => -0.5 })).toBe(
      0,
    );
  });

  it("clips a value above 1", () => {
    expect(
      scoreOf([LAST_RECOMMENDATION], {}, { similarity: () => 3 }),
    ).toBeCloseTo(0.2, 10);
  });

  it("lets a thrown error through: two spaces in one run is a defect, not a low score", () => {
    expect(() =>
      score([candidateOf([LAST_RECOMMENDATION])], {
        similarity: () => {
          throw new RangeError("two models");
        },
      }),
    ).toThrow("two models");
  });
});

describe("recency", () => {
  it.each([
    [2026, 0.05],
    [2025, 0.05 * Math.exp(-0.5)],
    [2024, 0.05 * Math.exp(-1)],
    [2016, 0.05 * Math.exp(-5)],
  ])("a work of %i contributes %f", (year, expected) => {
    expect(scoreOf([LAST_RECOMMENDATION], dated(year))).toBeCloseTo(
      expected,
      10,
    );
  });

  it("a work dated next year is age 0, not above the term's top", () => {
    expect(scoreOf([LAST_RECOMMENDATION], dated(2027))).toBeCloseTo(0.05, 10);
  });

  it("counts from the window's last year", () => {
    const later = recencyWindow(3, createManualClock(Date.UTC(2030, 5, 15)));
    expect(
      scoreOf([LAST_RECOMMENDATION], dated(2028), { window: later }),
    ).toBeCloseTo(0.05 * Math.exp(-1), 10);
  });

  it("does not fall back to onlineDate", () => {
    expect(
      scoreOf([LAST_RECOMMENDATION], {
        onlineDate: { year: 2026, iso: "2026" },
      }),
    ).toBe(0);
  });
});

describe("quality", () => {
  it.each([
    [0, 0],
    [9, 0.05 / 3],
    [99, (0.05 * 2) / 3],
    [999, 0.05],
    [1_000_000, 0.05],
  ])("%i citations contribute %f", (citationCount, expected) => {
    expect(scoreOf([LAST_RECOMMENDATION], { citationCount })).toBeCloseTo(
      expected,
      10,
    );
  });
});

describe("the blend", () => {
  it("adds every term at its weight", () => {
    const value = scoreOf(
      [
        edgeOf("recommendation", { rank: 20, limit: 100 }),
        edgeOf("similar", { score: 0.5 }),
        edgeOf("citation"),
      ],
      { ...dated(2025), citationCount: 99 },
      { similarity: () => 0.25 },
    );
    expect(value).toBeCloseTo(
      0.3 * 0.8 +
        0.2 * 0.5 +
        0.2 +
        0.2 * 0.25 +
        0.05 * Math.exp(-0.5) +
        (0.05 * 2) / 3 +
        0.16,
      10,
    );
  });

  it("clips to 1 when every term is at its top and every kind agrees", () => {
    const value = scoreOf(
      [
        edgeOf("recommendation", { rank: 0 }),
        edgeOf("similar", { score: 1 }),
        edgeOf("citation"),
        edgeOf("reference"),
      ],
      { ...dated(2026), citationCount: 999 },
      { similarity: () => 1 },
    );
    expect(value).toBe(1);
  });
});

describe("agreement", () => {
  it.each<[string, readonly GeneratorEdge[], number]>([
    ["one kind", [edgeOf("citation")], 0.2],
    ["two kinds", [edgeOf("citation"), LAST_RECOMMENDATION], 0.2 + 0.08],
    [
      "three kinds",
      [
        edgeOf("citation"),
        LAST_RECOMMENDATION,
        edgeOf("similar", { score: 0 }),
      ],
      0.2 + 0.16,
    ],
    [
      "all four",
      [
        edgeOf("citation"),
        edgeOf("reference"),
        LAST_RECOMMENDATION,
        edgeOf("similar", { score: 0 }),
      ],
      0.2 + 0.24,
    ],
  ])("%s", (_name, edges, expected) => {
    expect(scoreOf(edges)).toBeCloseTo(expected, 10);
  });

  it("no edge is no deduction: the type forbids it, and a score must still not fall", () => {
    expect(scoreOf([], { citationCount: 999 })).toBeCloseTo(0.05, 10);
  });

  it("two generators of one kind do not agree", () => {
    expect(
      scoreOf([
        edgeOf("citation", { generator: "s2-citations" }),
        edgeOf("citation", { generator: "europepmc-citations" }),
      ]),
    ).toBeCloseTo(0.2, 10);
    expect(
      scoreOf([
        edgeOf("reference", { generator: "s2-references" }),
        edgeOf("reference", { generator: "europepmc-references" }),
        edgeOf("reference", { generator: "crossref-references" }),
      ]),
    ).toBeCloseTo(0.2, 10);
  });
});

describe("ranking", () => {
  it("returns every row, highest first, in a new array", () => {
    const low = candidateOf([edgeOf("similar", { score: 0.1 })]);
    const high = candidateOf([edgeOf("similar", { score: 0.9 })]);
    const middle = candidateOf([edgeOf("similar", { score: 0.5 })]);
    const input = [low, high, middle];

    const rows = score(input);

    expect(rows.map((row) => row.work.workKey)).toEqual([
      high.work.workKey,
      middle.work.workKey,
      low.work.workKey,
    ]);
    expect(input).toEqual([low, high, middle]);
  });

  it("a tie keeps the given order", () => {
    const first = candidateOf([edgeOf("citation")]);
    const second = candidateOf([edgeOf("reference")]);
    expect(score([first, second]).map((row) => row.work.workKey)).toEqual([
      first.work.workKey,
      second.work.workKey,
    ]);
    expect(score([second, first]).map((row) => row.work.workKey)).toEqual([
      second.work.workKey,
      first.work.workKey,
    ]);
  });

  it("a row keeps its work, records and edges for the include boxes", () => {
    const candidate = candidateOf([edgeOf("citation")]);
    const row = only(candidate);
    expect(row.work).toBe(candidate.work);
    expect(row.records).toBe(candidate.records);
    expect(row.edges).toBe(candidate.edges);
  });
});

describe("reason chips", () => {
  it("points each kind the way docs/07 §4.2 reads it", () => {
    expect(chipsOf([edgeOf("citation")])).toEqual([{ id: "cites-seed" }]);
    expect(chipsOf([edgeOf("reference")])).toEqual([{ id: "cited-by-seed" }]);
    expect(chipsOf([edgeOf("recommendation")])).toEqual([
      { id: "recommended" },
    ]);
    expect(chipsOf([edgeOf("similar")])).toEqual([{ id: "similar-pubmed" }]);
  });

  it("gives one chip per kind, however many lists returned the work", () => {
    expect(
      chipsOf([
        edgeOf("citation", { generator: "s2-citations" }),
        edgeOf("citation", { generator: "europepmc-citations" }),
      ]),
    ).toEqual([{ id: "cites-seed" }]);
  });

  it("orders chips the same whatever the edges' order", () => {
    const context = edgeOf("citation", { contexts: ["cited here"] });
    const edges = [
      edgeOf("similar"),
      edgeOf("recommendation"),
      edgeOf("reference"),
      context,
    ];
    const expected = [
      { id: "cites-seed" },
      { id: "cited-by-seed" },
      { id: "recommended" },
      { id: "similar-pubmed" },
      { id: "similar", similarity: 0.5 },
      { id: "citation-context", context: "cited here" },
    ];
    const similarity = (): number => 0.5;
    expect(chipsOf(edges, { similarity })).toEqual(expected);
    expect(chipsOf([...edges].reverse(), { similarity })).toEqual(expected);
  });

  it("gives the similar chip the clipped value, only above 0", () => {
    expect(chipsOf([edgeOf("citation")], { similarity: () => 0 })).toEqual([
      { id: "cites-seed" },
    ]);
    expect(chipsOf([edgeOf("citation")], { similarity: () => 2 })).toEqual([
      { id: "cites-seed" },
      { id: "similar", similarity: 1 },
    ]);
  });

  describe("the citation context", () => {
    const contextOf = (edges: readonly GeneratorEdge[]): string | undefined => {
      const chip = chipsOf(edges).find(
        (entry) => entry.id === "citation-context",
      );
      return chip !== undefined && "context" in chip ? chip.context : undefined;
    };

    it("is absent when no edge has one", () => {
      expect(contextOf([edgeOf("citation")])).toBeUndefined();
      expect(contextOf([edgeOf("citation", { contexts: [] })])).toBeUndefined();
    });

    it("is the edge's first, skipping blanks, unchanged", () => {
      expect(
        contextOf([
          edgeOf("citation", { contexts: ["", "   ", " as [4] shows ", "no"] }),
        ]),
      ).toBe(" as [4] shows ");
    });

    it("skips an edge holding only blanks", () => {
      expect(
        contextOf([edgeOf("citation", { rank: 1, contexts: [" "] })]),
      ).toBeUndefined();
      expect(
        contextOf([
          edgeOf("citation", { rank: 1, contexts: [" "] }),
          edgeOf("reference", { rank: 5, contexts: ["usable"] }),
        ]),
      ).toBe("usable");
    });

    it("comes from the lowest rank, in either order", () => {
      const near = edgeOf("citation", { rank: 2, contexts: ["near"] });
      const far = edgeOf("reference", { rank: 9, contexts: ["far"] });
      expect(contextOf([near, far])).toBe("near");
      expect(contextOf([far, near])).toBe("near");
    });

    it("the rank decides before the generator id does", () => {
      const near = edgeOf("citation", {
        generator: "s2-citations",
        rank: 2,
        contexts: ["near"],
      });
      const far = edgeOf("citation", {
        generator: "europepmc-citations",
        rank: 9,
        contexts: ["far"],
      });
      expect(contextOf([near, far])).toBe("near");
      expect(contextOf([far, near])).toBe("near");
    });

    it("a tie in rank goes to the generator id, in either order", () => {
      const a = edgeOf("citation", {
        generator: "europepmc-citations",
        rank: 3,
        contexts: ["from europe pmc"],
      });
      const b = edgeOf("citation", {
        generator: "s2-citations",
        rank: 3,
        contexts: ["from semantic scholar"],
      });
      expect(contextOf([a, b])).toBe("from europe pmc");
      expect(contextOf([b, a])).toBe("from europe pmc");
    });
  });
});

describe("outsideWindow (FR-18)", () => {
  const outside = (work: Partial<CanonicalWork>): boolean =>
    only(candidateOf([edgeOf("citation")], work)).outsideWindow;

  it.each([
    [2023, true],
    [2011, true],
    [2024, false],
    [2026, false],
  ])("a work of %i: %s", (year, expected) => {
    expect(outside(dated(year))).toBe(expected);
  });

  it("a work dated after the window's last year is not older, so it is not flagged", () => {
    expect(outside(dated(2027))).toBe(false);
  });

  it("a work with no date, or a date that is not a number, is not flagged", () => {
    expect(outside({})).toBe(false);
    expect(outside({ publishedDate: { year: Number.NaN, iso: "" } })).toBe(
      false,
    );
  });

  it("reads publishedDate, not onlineDate", () => {
    expect(
      outside({ ...dated(2011), onlineDate: { year: 2026, iso: "2026" } }),
    ).toBe(true);
    expect(outside({ onlineDate: { year: 2011, iso: "2011" } })).toBe(false);
  });

  it("follows the window it is given", () => {
    const wider = recencyWindow(5, CLOCK);
    const row = only(candidateOf([edgeOf("citation")], dated(2022)), {
      window: wider,
    });
    expect(row.outsideWindow).toBe(false);
  });

  it("drops nothing and demotes nothing: the seminal 2011 reference keeps its place and only its flag differs", () => {
    const seminal = candidateOf([edgeOf("reference")], {
      ...dated(2011),
      citationCount: 999,
    });
    const recent = candidateOf([edgeOf("reference")], dated(2026));

    const rows = score([seminal, recent]);

    expect(rows.map((row) => [row.work.workKey, row.outsideWindow])).toEqual([
      [seminal.work.workKey, true],
      [recent.work.workKey, false],
    ]);
    expect(rows[0]?.chips).toEqual([{ id: "cited-by-seed" }]);
  });
});

describe("isCheckedByDefault", () => {
  it.each([
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ])(
    "in library %s, outside the window %s: %s",
    (inLibrary, outsideWindow, expected) => {
      expect(isCheckedByDefault({ inLibrary, outsideWindow })).toBe(expected);
    },
  );
});

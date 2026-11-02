import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../../../src/core/cache/keys";
import type { Author, CanonicalWork } from "../../../src/model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmid,
} from "../../../src/model/ids";
import type { CollectionProfile } from "../../../src/model/profile";
import {
  addedAtByWorkKey,
  buildProfileStats,
  MAJOR_TOPIC_BOOST,
  MAX_PROFILE_SUBJECTS,
  MAX_PROFILE_TERMS,
  MAX_PROFILE_VENUES,
  membershipHash,
  MIN_PROFILE_ITEMS,
  MIN_TITLE_TERM_ITEMS,
  persistProfile,
  profileOwnedSets,
  rankedTerms,
  readProfileCollection,
  zoteroDateToEpochMs,
  type ProfileStatsInput,
} from "../../../src/pipeline/recommend/profile";
import { gateCollectionProfile } from "../../../src/zotero/db";
import type {
  CollectionWorkRead,
  ItemTermSource,
} from "../../../src/zotero/itemMapper";

/**
 * `P5-T18`, `src/pipeline/recommend/profile.ts`. Layer 1 (`docs/13` §2.1): plain
 * Node, because the module is pure over the port. What Zotero answers through
 * `createZoteroRecommendLibrary` is an integration claim.
 *
 * Fixture titles are made of words no other test line depends on, and the
 * default title `Z` yields no term, so a test sees only the terms it plants.
 */

const NO_TITLE_TERMS = "Z";

function item(
  index: number,
  fields: Partial<CanonicalWork> = {},
  read: Partial<CollectionWorkRead> = {},
): CollectionWorkRead {
  return {
    itemKey: `ITEM${String(index).padStart(4, "0")}`,
    dateModified: "2026-01-01 00:00:00",
    work: {
      workKey: `hash:${String(index)}`,
      ids: {},
      type: "journal-article",
      title: NO_TITLE_TERMS,
      authors: [],
      provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
      normalizedAtEpochMs: 1,
      ...fields,
    },
    ...read,
  };
}

function items(
  count: number,
  fields: (index: number) => Partial<CanonicalWork> = () => ({}),
): CollectionWorkRead[] {
  return Array.from({ length: count }, (_, index) =>
    item(index, fields(index)),
  );
}

function mesh(
  term: string,
  isMajor = false,
): NonNullable<CanonicalWork["subjects"]>[number] {
  return { term, scheme: "mesh", isMajor };
}

function build(
  collectionItems: readonly CollectionWorkRead[],
  librarySources: readonly ItemTermSource[] = [],
  overrides: Partial<ProfileStatsInput> = {},
): CollectionProfile {
  return buildProfileStats({
    libraryID: 7,
    collectionKey: "COLLKEY1",
    collection: { name: "A collection", items: collectionItems },
    librarySources,
    nowEpochMs: 1234,
    ...overrides,
  });
}

/** `count` library rows carrying `subject`, as bare untitled sources. */
function librarySources(
  count: number,
  fields: Partial<ItemTermSource> = {},
): ItemTermSource[] {
  return Array.from({ length: count }, () => ({
    title: NO_TITLE_TERMS,
    ...fields,
  }));
}

describe("term weight — docs/05 §7.2", () => {
  /** The card's first `Done when` line. */
  it("ranks a MeSH term on every library item below one specific to the collection, on a 30-item fixture", () => {
    const collection = items(30, (index) => ({
      subjects: [
        mesh("Everywhere Descriptor"),
        ...(index < 20 ? [mesh("Specific Descriptor")] : []),
      ],
    }));
    const library: ItemTermSource[] = [
      ...collection.map(({ work }) => work),
      ...librarySources(270, { subjects: [mesh("Everywhere Descriptor")] }),
    ];
    const profile = build(collection, library);

    expect(rankedTerms(profile.termWeights).map(([term]) => term)).toEqual([
      "Specific Descriptor",
      "Everywhere Descriptor",
    ]);
    // The formula itself, with its figures written out.
    expect(profile.termWeights["Specific Descriptor"]).toBeCloseTo(
      (20 / 30) * Math.log(1 + 300 / (1 + 20)),
      12,
    );
    expect(profile.termWeights["Everywhere Descriptor"]).toBeCloseTo(
      (30 / 30) * Math.log(1 + 300 / (1 + 300)),
      12,
    );
  });

  it("is the formula alone that fails when the library is no wider than the collection, which is why the check tags are a list", () => {
    const collection = items(30, (index) => ({
      subjects: [
        mesh("Everywhere Descriptor"),
        ...(index < 20 ? [mesh("Specific Descriptor")] : []),
      ],
    }));
    const profile = build(
      collection,
      collection.map(({ work }) => work),
    );
    expect(profile.termWeights["Everywhere Descriptor"]).toBeCloseTo(
      Math.log(1 + 30 / 31),
      12,
    );
    expect(profile.termWeights["Specific Descriptor"]).toBeCloseTo(
      (20 / 30) * Math.log(1 + 30 / 21),
      12,
    );
    expect(rankedTerms(profile.termWeights)[0]?.[0]).toBe(
      "Everywhere Descriptor",
    );
  });

  it("takes the library's count from its titles and keywords as well as its MeSH", () => {
    const collection = items(10, () => ({ keywords: ["Quantum Dots"] }));
    const alone = build(collection, librarySources(100));
    const inTitles = build(
      collection,
      librarySources(100, { title: "Quantum dots" }),
    );
    const inKeywords = build(
      collection,
      librarySources(100, { keywords: ["quantum DOTS"] }),
    );
    const inMesh = build(
      collection,
      librarySources(100, { subjects: [mesh("Quantum Dots")] }),
    );
    const weight = Math.log(1 + 100 / 1);
    const counted = Math.log(1 + 100 / 101);
    expect(alone.termWeights["Quantum Dots"]).toBeCloseTo(weight, 12);
    expect(inTitles.termWeights["Quantum Dots"]).toBeCloseTo(counted, 12);
    expect(inKeywords.termWeights["Quantum Dots"]).toBeCloseTo(counted, 12);
    expect(inMesh.termWeights["Quantum Dots"]).toBeCloseTo(counted, 12);
  });

  it("counts a library item once, however many of its tags and title words carry the term", () => {
    const collection = items(5, () => ({ keywords: ["Perovskite"] }));
    const once = build(collection, [
      {
        title: "Perovskite perovskite",
        keywords: ["perovskite", "PEROVSKITE"],
        subjects: [mesh("Perovskite")],
      },
      ...librarySources(9),
    ]);
    expect(once.termWeights["Perovskite"]).toBeCloseTo(
      Math.log(1 + 10 / 2),
      12,
    );
  });

  it("does not let a library item count a check tag or a term the collection lacks", () => {
    const collection = items(5, () => ({ keywords: ["Perovskite"] }));
    const profile = build(
      collection,
      librarySources(10, { keywords: ["Elsewhere"], title: "Elsewhere" }),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["Perovskite"]);
  });

  it("counts a collection item once when MeSH, a keyword and its title all name the term", () => {
    const collection = [
      item(0, {
        title: "Perovskite",
        subjects: [mesh("Perovskite")],
        keywords: ["perovskite"],
      }),
      ...items(4).map((entry, index) => item(index + 1, entry.work)),
    ];
    const profile = build(collection, librarySources(10));
    expect(profile.termWeights["Perovskite"]).toBeCloseTo(
      (1 / 5) * Math.log(1 + 10 / 1),
      12,
    );
  });

  it("gives 0 on an empty library rather than failing", () => {
    const profile = build(items(5, () => ({ keywords: ["Perovskite"] })));
    expect(profile.termWeights["Perovskite"]).toBe(0);
  });
});

describe("check tags — never topics (docs/05 §7.2, the card's Do NOT)", () => {
  const CHECK_TAGS = [
    "Humans",
    "Animals",
    "Male",
    "Female",
    "Infant",
    "Infant, Newborn",
    "Child",
    "Child, Preschool",
    "Adolescent",
    "Young Adult",
    "Adult",
    "Middle Aged",
    "Aged",
    "Aged, 80 and over",
    "Pregnancy",
    "Mice",
    "Rats",
    "Cats",
    "Cattle",
    "Chick Embryo",
    "Cricetinae",
    "Dogs",
    "Guinea Pigs",
    "Horses",
    "Rabbits",
    "Sheep",
    "Swine",
    "History, Ancient",
    "History, Medieval",
    "History, 15th Century",
    "History, 16th Century",
    "History, 17th Century",
    "History, 18th Century",
    "History, 19th Century",
    "History, 20th Century",
    "History, 21st Century",
  ];

  it.each(CHECK_TAGS)(
    "drops %s from terms and subjects, whichever way it arrives",
    (tag) => {
      const collection = items(5, () => ({
        title: tag,
        subjects: [mesh(tag, true)],
        keywords: [tag.toUpperCase()],
      }));
      const profile = build(collection, librarySources(10));
      const normal = tag.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      const terms = Object.keys(profile.termWeights).map((term) =>
        term.toLowerCase().replace(/[^a-z0-9]+/g, " "),
      );
      expect(terms).not.toContain(normal);
      expect(profile.subjectCounts).toEqual({});
    },
  );

  it("keeps a descriptor that only begins like one", () => {
    const profile = build(
      items(5, () => ({ subjects: [mesh("Mice, Inbred C57BL")] })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["Mice, Inbred C57BL"]);
    expect(profile.subjectCounts).toEqual({ "Mice, Inbred C57BL": 5 });
  });
});

describe("major-topic MeSH is preferred (docs/05 §7.2's note, item 2)", () => {
  it("multiplies by 1 + 0.5 × the share of items where it is major", () => {
    expect(MAJOR_TOPIC_BOOST).toBe(0.5);
    const collection = items(10, (index) => ({
      subjects: [
        mesh("Always Major", true),
        mesh("Half Major", index < 5),
        mesh("Never Major", false),
      ],
    }));
    const profile = build(collection, librarySources(100));
    const base = Math.log(1 + 100 / 1);
    expect(profile.termWeights["Always Major"]).toBeCloseTo(base * 1.5, 12);
    expect(profile.termWeights["Half Major"]).toBeCloseTo(base * 1.25, 12);
    expect(profile.termWeights["Never Major"]).toBeCloseTo(base, 12);
  });

  it("keeps a term major on an item when its keyword comes second or a second subject is not major", () => {
    const profile = build(
      items(5, () => ({
        subjects: [mesh("Two Headings", true), mesh("two headings", false)],
        keywords: ["Two Headings"],
      })),
      librarySources(100),
    );
    expect(profile.termWeights["Two Headings"]).toBeCloseTo(
      Math.log(1 + 100 / 1) * 1.5,
      12,
    );
  });
});

describe("title n-grams (docs/05 §7.2's note, item 3)", () => {
  it("takes adjacent pairs, and a single word gives way to the pairs that hold it", () => {
    expect(MIN_TITLE_TERM_ITEMS).toBe(2);
    const profile = build(
      items(5, () => ({ title: "Lipid nanoparticle delivery" })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights).sort()).toEqual([
      "lipid nanoparticle",
      "nanoparticle delivery",
    ]);
  });

  it("keeps a repeated single word that no repeated pair holds", () => {
    const profile = build(
      [
        item(0, { title: "Perovskite alpha" }),
        item(1, { title: "Perovskite beta" }),
        ...items(3).map((e, i) => item(i + 2, e.work)),
      ],
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["perovskite"]);
  });

  it("lets a tagged phrase take a title's single word, and leaves a tagged single word alone", () => {
    const profile = build(
      items(5, () => ({
        title: "Editing z cas",
        keywords: ["Gene Editing", "Cas", "Cas Protein"],
      })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights).sort()).toEqual([
      "Cas",
      "Cas Protein",
      "Gene Editing",
    ]);
  });

  it("does not let a dropped check-tag pair take its words", () => {
    const profile = build(
      items(5, () => ({ title: "Young adult" })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["young"]);
  });

  it("drops a term from one title, and keeps it from two", () => {
    const once = build(
      [
        item(0, { title: "Perovskite" }),
        ...items(4).map((e, i) => item(i + 1, e.work)),
      ],
      librarySources(10),
    );
    expect(once.termWeights).toEqual({});
    const twice = build(
      [
        item(0, { title: "Perovskite" }),
        item(1, { title: "Perovskite" }),
        ...items(3).map((e, i) => item(i + 2, e.work)),
      ],
      librarySources(10),
    );
    expect(Object.keys(twice.termWeights)).toEqual(["perovskite"]);
  });

  it("keeps a tag from a single item, which is the user's source's word and not a title's", () => {
    const profile = build(
      [
        item(0, { keywords: ["Perovskite"] }),
        ...items(4).map((e, i) => item(i + 1, e.work)),
      ],
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["Perovskite"]);
  });

  it("lets a stop word, a one-character token or an all-digit token break a pair", () => {
    const profile = build(
      items(5, () => ({
        title: "Solar of cells x perovskite 2024 tandem",
      })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights).sort()).toEqual([
      "cells",
      "perovskite",
      "solar",
      "tandem",
    ]);
  });

  it("reads a Korean title's words", () => {
    const profile = build(
      items(5, () => ({ title: "유전자 편집" })),
      librarySources(10),
    );
    // In composed form, though `normalizeTitle` decomposes: a query reads this.
    expect(Object.keys(profile.termWeights)).toEqual(["유전자 편집"]);
  });

  it("does not make a check tag a term from a title", () => {
    const profile = build(
      items(5, () => ({ title: "Mice" })),
      librarySources(10),
    );
    expect(profile.termWeights).toEqual({});
  });
});

describe("term identity and spelling (docs/05 §7.2's note, item 4)", () => {
  it("merges spellings on normalizeTitle and keeps the most frequent", () => {
    const profile = build(
      items(5, (index) => ({
        keywords: [index < 3 ? "CRISPR-Cas" : "crispr cas"],
      })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["CRISPR-Cas"]);
  });

  it("keeps the most frequent spelling even when a rarer one is read first", () => {
    const profile = build(
      items(5, (index) => ({
        keywords: [index === 0 ? "CRISPR cas" : "crispr-Cas"],
      })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["crispr-Cas"]);
  });

  it("breaks a spelling tie by the smaller in code-unit order, whichever is read first", () => {
    const forward = build(
      items(6, (index) => ({ keywords: [index < 3 ? "b term" : "B Term"] })),
      librarySources(10),
    );
    const backward = build(
      items(6, (index) => ({ keywords: [index < 3 ? "B Term" : "b term"] })),
      librarySources(10),
    );
    expect(Object.keys(forward.termWeights)).toEqual(["B Term"]);
    expect(Object.keys(backward.termWeights)).toEqual(["B Term"]);
  });

  it("prefers a tag's spelling over the title's lower case", () => {
    const profile = build(
      items(5, (index) => ({
        title: "Perovskite",
        ...(index === 0 && { keywords: ["PeroVskite"] }),
      })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights)).toEqual(["PeroVskite"]);
  });

  it("skips a tag that normalises to nothing", () => {
    const profile = build(
      items(5, () => ({ keywords: ["***"], subjects: [mesh("---")] })),
      librarySources(10),
    );
    expect(profile.termWeights).toEqual({});
    expect(profile.subjectCounts).toEqual({});
  });

  it("holds object-shaped words as plain data", () => {
    const profile = build(
      items(5, () => ({ keywords: ["constructor", "__proto__"] })),
      librarySources(10),
    );
    expect(Object.keys(profile.termWeights).sort()).toEqual([
      "__proto__",
      "constructor",
    ]);
    expect(typeof profile.termWeights["constructor"]).toBe("number");
    expect(Object.getPrototypeOf(profile.termWeights)).toBe(Object.prototype);
  });
});

describe("subjectCounts", () => {
  it("counts MeSH and arXiv categories once per item, and ignores other schemes", () => {
    const profile = build(
      items(5, (index) => ({
        subjects: [
          mesh("Gene Editing"),
          mesh("gene editing"),
          ...(index < 2 ? [{ term: "cs.LG", scheme: "arxiv-category" }] : []),
          { term: "Publisher Word", scheme: "publisher-keyword" },
        ],
      })),
      librarySources(10),
    );
    expect(profile.subjectCounts).toEqual({ "Gene Editing": 5, "cs.LG": 2 });
  });

  it("does not make an arXiv category or another scheme a term", () => {
    const profile = build(
      items(5, () => ({
        subjects: [
          { term: "cs.LG", scheme: "arxiv-category" },
          { term: "Publisher Word", scheme: "publisher-keyword" },
        ],
      })),
      librarySources(10),
    );
    expect(profile.termWeights).toEqual({});
  });

  it("orders by count, then name, and keeps the top", () => {
    expect(MAX_PROFILE_SUBJECTS).toBe(100);
    const subjects = Array.from({ length: 150 }, (_, i) =>
      mesh(`Subject ${String(i).padStart(3, "0")}`),
    );
    const profile = build(
      items(5, (index) => ({
        subjects:
          index === 0
            ? [...subjects, mesh("On Two")]
            : index === 1
              ? [mesh("On Two")]
              : [],
      })),
      librarySources(10),
    );
    const keys = Object.keys(profile.subjectCounts);
    expect(keys).toHaveLength(100);
    expect(keys[0]).toBe("On Two");
    expect(keys[1]).toBe("Subject 000");
    expect(keys[99]).toBe("Subject 098");
  });
});

describe("the term cap", () => {
  it("keeps the 100 heaviest terms", () => {
    expect(MAX_PROFILE_TERMS).toBe(100);
    const keywords = Array.from(
      { length: 150 },
      (_, i) => `Word q${String(i).padStart(3, "0")}`,
    );
    const heavy = "Heavy Word";
    const profile = build(
      items(5, (index) => ({
        keywords: index === 0 ? [...keywords, heavy] : [heavy],
      })),
      librarySources(10),
    );
    const ranked = rankedTerms(profile.termWeights);
    expect(ranked).toHaveLength(100);
    expect(ranked[0]?.[0]).toBe(heavy);
    expect(ranked[1]?.[0]).toBe("Word q000");
    expect(ranked[99]?.[0]).toBe("Word q098");
  });
});

describe("rankedTerms", () => {
  it("orders heaviest first, then by term in code-unit order, whatever order the object holds", () => {
    expect(rankedTerms({ b: 1, a: 1, c: 2, "2019": 0.5 })).toEqual([
      ["c", 2],
      ["a", 1],
      ["b", 1],
      ["2019", 0.5],
    ]);
  });
});

describe("topAuthors — ≥ 2 items, plus every last author (docs/05 §7.2)", () => {
  const author = (
    family: string,
    given?: string,
    extra: Partial<Author> = {},
  ): Author => ({
    family,
    ...(given !== undefined && { given }),
    ...extra,
  });

  it("keeps an author on two items and every last author, and drops the rest", () => {
    const profile = build(
      items(5, (index) => ({
        authors:
          index < 2
            ? [
                author("Twice", "Ann"),
                ...(index === 0 ? [author("Once", "Bo")] : []),
                author(`Last${String(index)}`, "Cy"),
              ]
            : [],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([
      { name: "Twice A", count: 2 },
      { name: "Last0 C", count: 1 },
      { name: "Last1 C", count: 1 },
    ]);
  });

  it("counts a sole author as a last author", () => {
    const profile = build(
      items(5, (index) => ({
        authors: index === 0 ? [author("Solo", "Ann")] : [],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([{ name: "Solo A", count: 1 }]);
  });

  it("merges the spellings of one name's initials, and keeps every initial distinct", () => {
    const profile = build(
      items(6, (index) => ({
        authors: [
          author(
            "Kim",
            ["Jun-Hee", "J. H.", "JH", "J H", "Jun Hee", "J"][index] as string,
          ),
          author("Anchor"),
        ],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([
      { name: "Anchor", count: 6 },
      { name: "Kim JH", count: 5 },
    ]);
  });

  it("reads initials through dots with no space, and upper-cases a lower-case given name", () => {
    const profile = build(
      items(5, (index) => ({
        authors:
          index === 0
            ? [author("Kim", "J.H.")]
            : index === 1
              ? [author("Lee", "jennifer")]
              : [],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors.map((entry) => entry.name)).toEqual([
      "Kim JH",
      "Lee J",
    ]);
  });

  it("names a single-field author by the literal, not the family", () => {
    const profile = build(
      items(5, (index) => ({
        authors:
          index === 0
            ? [author("Smith", undefined, { literal: " Smith Group " })]
            : [],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([{ name: "Smith Group", count: 1 }]);
  });

  it("writes no orcid key on an author with none", () => {
    const profile = build(
      items(5, () => ({ authors: [author("Plain", "Bo")] })),
      librarySources(10),
    );
    expect(profile.topAuthors).toStrictEqual([{ name: "Plain B", count: 5 }]);
  });

  it("keeps a single-field name whole, and counts one item once", () => {
    const profile = build(
      items(5, (index) => ({
        authors:
          index < 2
            ? [
                author("CRISPR Consortium", undefined, {
                  literal: "CRISPR Consortium",
                }),
                author("CRISPR Consortium", undefined, {
                  literal: "CRISPR Consortium",
                }),
              ]
            : [],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([
      { name: "CRISPR Consortium", count: 2 },
    ]);
  });

  it("ranks by items, then items as last author, then name", () => {
    const profile = build(
      [
        item(0, { authors: [author("Ccc"), author("Aaa"), author("Bbb")] }),
        item(1, { authors: [author("Ccc"), author("Aaa"), author("Bbb")] }),
        item(2, { authors: [author("Ccc"), author("Eee")] }),
        item(3, { authors: [author("Ddd")] }),
        item(4),
      ],
      librarySources(10),
    );
    expect(
      profile.topAuthors.map((entry) => [entry.name, entry.count]),
    ).toEqual([
      ["Ccc", 3],
      ["Bbb", 2],
      ["Aaa", 2],
      ["Ddd", 1],
      ["Eee", 1],
    ]);
  });

  it("carries an ORCID, the smaller of two, and none when no item has one", () => {
    const profile = build(
      items(5, (index) => ({
        authors: [
          author("Orc", "Ann", {
            ...(index === 1 && { orcid: "0000-0002" }),
            ...(index === 2 && { orcid: "0000-0001" }),
            ...(index === 3 && { orcid: "0000-0003" }),
          }),
          author("Plain", "Bo"),
        ],
      })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([
      { name: "Plain B", count: 5 },
      { name: "Orc A", count: 5, orcid: "0000-0001" },
    ]);
  });

  it("skips a name that normalises to nothing", () => {
    const profile = build(
      items(5, () => ({ authors: [author("***")] })),
      librarySources(10),
    );
    expect(profile.topAuthors).toEqual([]);
  });
});

describe("topVenues", () => {
  it("merges a venue's spellings, unions its ISSNs and orders by count, then name", () => {
    const profile = build(
      [
        item(0, { containerTitle: "Nature", issn: ["0028-0836"] }),
        item(1, { containerTitle: "NATURE ", issn: ["1476-4687"] }),
        item(2, { containerTitle: "Nature", issn: ["0028-0836"] }),
        item(3, { containerTitle: "Zeta Journal" }),
        item(4, { containerTitle: "Alpha Journal" }),
      ],
      librarySources(10),
    );
    expect(profile.topVenues).toEqual([
      { name: "Nature", count: 3, issn: ["0028-0836", "1476-4687"] },
      { name: "Alpha Journal", count: 1 },
      { name: "Zeta Journal", count: 1 },
    ]);
  });

  it("sorts the ISSNs and trims the name it stores", () => {
    const profile = build(
      items(5, (index) => ({
        ...(index === 0 && {
          containerTitle: "  Cell ",
          issn: ["1097-4172", "0092-8674"],
        }),
      })),
      librarySources(10),
    );
    expect(profile.topVenues).toEqual([
      { name: "Cell", count: 1, issn: ["0092-8674", "1097-4172"] },
    ]);
  });

  it("keeps the top 10 and skips an item with no venue", () => {
    expect(MAX_PROFILE_VENUES).toBe(10);
    const profile = build(
      items(14, (index) =>
        index === 13
          ? {}
          : { containerTitle: `Venue ${String(index).padStart(2, "0")}` },
      ),
      librarySources(10),
    );
    expect(profile.topVenues.map((venue) => venue.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Venue 0${String(i)}`),
    );
  });
});

describe("years", () => {
  const dated = (year: number): Partial<CanonicalWork> => ({
    publishedDate: { year, iso: String(year) },
  });

  it("makes a histogram and takes the middle year", () => {
    const profile = build(
      [2020, 2024, 2020, 2021, 2022].map((year, index) =>
        item(index, dated(year)),
      ),
    );
    expect(profile.yearHistogram).toEqual({
      2020: 2,
      2021: 1,
      2022: 1,
      2024: 1,
    });
    expect(profile.medianYear).toBe(2021);
  });

  it("takes the lower middle of an even count, numerically", () => {
    const profile = build(
      [2024, 999, 2021, 2020, 2022, 2023].map((year, index) =>
        item(index, dated(year)),
      ),
    );
    expect(profile.medianYear).toBe(2021);
  });

  it("skips an item with no date, and has no median when none has one", () => {
    const some = build([
      item(0, dated(2020)),
      ...items(4).map((e, i) => item(i + 1, e.work)),
    ]);
    expect(some.yearHistogram).toEqual({ 2020: 1 });
    expect(some.medianYear).toBe(2020);
    const none = build(items(5));
    expect(none.yearHistogram).toEqual({});
    expect(none.medianYear).toBeUndefined();
  });
});

describe("membershipHash — the card's second Done-when line", () => {
  const members = items(5);

  it("is SHA-256 over the sorted itemKey|dateModified lines", () => {
    expect(
      membershipHash([
        { itemKey: "BBBB", dateModified: "d2" },
        { itemKey: "AAAA", dateModified: "d1" },
      ]),
    ).toBe(sha256Hex("AAAA|d1\nBBBB|d2"));
  });

  it("does not change with reading order, with a re-read, or with anything but key and date", () => {
    const hash = membershipHash(members);
    expect(membershipHash([...members].reverse())).toBe(hash);
    expect(membershipHash(items(5))).toBe(hash);
    expect(
      membershipHash(
        members.map((entry) => ({
          ...entry,
          dateAdded: "2020-01-01 00:00:00",
          work: { ...entry.work, title: "Another title" },
        })),
      ),
    ).toBe(hash);
  });

  it("changes when an item is added, removed or modified", () => {
    const hash = membershipHash(members);
    expect(membershipHash([...members, item(99)])).not.toBe(hash);
    expect(membershipHash(members.slice(1))).not.toBe(hash);
    expect(
      membershipHash(
        members.map((entry, index) =>
          index === 2
            ? { ...entry, dateModified: "2026-01-01 00:00:01" }
            : entry,
        ),
      ),
    ).not.toBe(hash);
  });

  it("does not take two items' keys and dates for one another's", () => {
    expect(
      membershipHash([
        { itemKey: "AAAA", dateModified: "d2" },
        { itemKey: "BBBB", dateModified: "d1" },
      ]),
    ).not.toBe(
      membershipHash([
        { itemKey: "AAAA", dateModified: "d1" },
        { itemKey: "BBBB", dateModified: "d2" },
      ]),
    );
  });

  it("is the value on the built profile", () => {
    expect(build(members).membershipHash).toBe(membershipHash(members));
  });
});

describe("buildProfileStats — the record", () => {
  it("builds the id and names, and leaves the other cards' members empty", () => {
    const members = items(5);
    const profile = build(members);
    expect(profile).toMatchObject({
      id: "7:COLLKEY1",
      libraryID: 7,
      collectionKey: "COLLKEY1",
      collectionName: "A collection",
      builtAtEpochMs: 1234,
      itemCount: 5,
      centroids: [],
      seeds: [],
      suggestedQueries: [],
      origin: "heuristic",
    });
    expect(profile).not.toHaveProperty("narrative");
    expect(profile).not.toHaveProperty("userEdits");
    expect(profile).not.toHaveProperty("embeddingModel");
  });

  it("keeps knownWorkKeys sorted and distinct, while itemCount counts both items of one work", () => {
    const profile = build([
      item(0, { workKey: "doi:b" }),
      item(1, { workKey: "doi:a" }),
      item(2, { workKey: "doi:b" }),
      item(3, { workKey: "doi:c" }),
      item(4, { workKey: "doi:a" }),
    ]);
    expect(profile.knownWorkKeys).toEqual(["doi:a", "doi:b", "doi:c"]);
    expect(profile.itemCount).toBe(5);
  });

  it("holds no library-wide identifier set (P5-T01 decision 6)", () => {
    const profile = build(items(5));
    expect(profile).not.toHaveProperty("ownedInCollection");
    expect(profile).not.toHaveProperty("ownedInLibrary");
  });

  it("gives the same answer whatever order the items and the library are read in", () => {
    const members = items(12, (index) => ({
      title: index % 2 === 0 ? "Perovskite solar cells" : "Tandem solar cells",
      subjects: [
        mesh("Solar Energy", index < 6),
        mesh(`Topic ${String(index % 3)}`),
      ],
      keywords: [index % 2 === 0 ? "Solar Cell" : "solar cell"],
      authors: [
        { family: `Fam${String(index % 4)}`, given: "Ann" },
        { family: "Pi", given: "Bo" },
      ],
      containerTitle: `Venue ${String(index % 2)}`,
      issn: [`0000-000${String(index % 2)}`],
      publishedDate: { year: 2020 + (index % 3), iso: "2020" },
    }));
    const library = members.map(({ work }) => work);
    expect(build([...members].reverse(), [...library].reverse())).toEqual(
      build(members, library),
    );
  });

  it("throws RangeError below the minimum and builds at it", () => {
    expect(MIN_PROFILE_ITEMS).toBe(5);
    expect(() => build(items(4))).toThrow(RangeError);
    expect(build(items(5)).itemCount).toBe(5);
  });

  it("comes through the redaction gate unmarked, identifiers and all", () => {
    const profile = build(
      items(5, (index) => ({
        workKey: `hash:${String(index).repeat(40)}`,
        keywords: ["Perovskite"],
      })),
      librarySources(10),
    );
    const gated = gateCollectionProfile(profile);
    expect(gated.membershipHash).toBe(profile.membershipHash);
    expect(gated.knownWorkKeys).toEqual(profile.knownWorkKeys);
    expect(gated.termWeights).toEqual(profile.termWeights);
    expect(gated.redaction?.partlyRedacted).toBe(false);
  });
});

describe("readProfileCollection — FR-44's refusal", () => {
  const library = (count: number) => ({
    readCollection: vi.fn(() =>
      Promise.resolve({ name: "A collection", items: items(count) }),
    ),
  });

  it("refuses below 5, with the count and the minimum", async () => {
    const port = library(4);
    await expect(readProfileCollection(port, 7, "COLLKEY1")).resolves.toEqual({
      kind: "too-few-items",
      itemCount: 4,
      minimum: 5,
    });
    expect(port.readCollection).toHaveBeenCalledWith(7, "COLLKEY1");
  });

  it("answers ready at 5, with the collection", async () => {
    const answer = await readProfileCollection(library(5), 7, "COLLKEY1");
    expect(answer.kind).toBe("ready");
    expect(answer.kind === "ready" && answer.collection.items).toHaveLength(5);
  });
});

describe("persistProfile — userEdits outlive a rebuild", () => {
  const profile = build(items(5));
  const edits = { removedTerms: ["Old"], addedTerms: ["New"] };

  function store(stored?: CollectionProfile) {
    return {
      get: vi.fn(() => Promise.resolve(stored)),
      put: vi.fn((row: CollectionProfile) => Promise.resolve(row)),
    };
  }

  it("carries the stored row's edits onto a rebuilt profile, reading its own id", async () => {
    const fake = store({ ...profile, userEdits: edits });
    const written = await persistProfile(fake, profile);
    expect(fake.get).toHaveBeenCalledWith("7:COLLKEY1");
    expect(written.userEdits).toEqual(edits);
    expect(fake.put).toHaveBeenCalledWith({ ...profile, userEdits: edits });
  });

  it("lets the profile's own edits win, without reading the store", async () => {
    const own = { removedTerms: ["Mine"], addedTerms: [] };
    const fake = store({ ...profile, userEdits: edits });
    const written = await persistProfile(fake, { ...profile, userEdits: own });
    expect(written.userEdits).toEqual(own);
    expect(fake.get).not.toHaveBeenCalled();
  });

  it("adds no userEdits member when neither has any", async () => {
    const fake = store(profile);
    const written = await persistProfile(fake, profile);
    expect(written).not.toHaveProperty("userEdits");
    const empty = store(undefined);
    expect(await persistProfile(empty, profile)).not.toHaveProperty(
      "userEdits",
    );
  });

  it("answers what the store answers", async () => {
    const fake = store();
    const stored = {
      ...profile,
      redaction: {
        partlyRedacted: false,
        redactedStrings: 0,
        droppedFields: 0,
      },
    };
    fake.put.mockResolvedValueOnce(stored);
    await expect(persistProfile(fake, profile)).resolves.toBe(stored);
  });
});

describe("profileOwnedSets — each run, not stored", () => {
  const doi = normalizeDoi("10.1000/ABC");
  const pmid = normalizePmid("12345");
  const arxivId = normalizeArxivId("2106.15928");
  if (doi === null || pmid === null || arxivId === null) {
    throw new Error("test fixtures must normalize");
  }

  it("takes the collection's from its works and the library's from the index", () => {
    const { ownedInCollection, ownedInLibrary } = profileOwnedSets(
      [
        item(0, { workKey: "doi:one", ids: { doi, pmid, arxivId } }),
        item(1, { workKey: "hash:two" }),
      ],
      {
        byDoi: new Map([["10.1000/lib", 1]]),
        byPmid: new Map([["999", 2]]),
        byArxiv: new Map([["1111.2222", 3]]),
        byWorkKey: new Map([["s2:7", 4]]),
      },
    );
    expect(ownedInCollection).toEqual({
      doi: new Set([doi]),
      pmid: new Set([pmid]),
      arxiv: new Set([arxivId]),
      workKeys: new Set(["doi:one", "hash:two"]),
    });
    expect(ownedInLibrary).toEqual({
      doi: new Set(["10.1000/lib"]),
      pmid: new Set(["999"]),
      arxiv: new Set(["1111.2222"]),
      workKeys: new Set(["s2:7"]),
    });
  });
});

describe("addedAt — docs/05 §7.2's map, from Zotero's dateAdded", () => {
  it("reads Zotero's UTC form exactly", () => {
    expect(zoteroDateToEpochMs("2026-03-07 04:05:06")).toBe(
      Date.UTC(2026, 2, 7, 4, 5, 6),
    );
  });

  it.each([
    "",
    "2026-03-07",
    "2026-03-07T04:05:06Z",
    " 2026-03-07 04:05:06",
    "2026-03-07 04:05:06 ",
  ])("answers undefined for %j", (text) => {
    expect(zoteroDateToEpochMs(text)).toBeUndefined();
  });

  it("maps work key to time, keeps the later of two items, and skips an unreadable date", () => {
    const at = addedAtByWorkKey([
      item(0, { workKey: "doi:one" }, { dateAdded: "2026-01-01 00:00:00" }),
      item(1, { workKey: "doi:one" }, { dateAdded: "2026-02-01 00:00:00" }),
      item(2, { workKey: "doi:one" }, { dateAdded: "2025-01-01 00:00:00" }),
      item(3, { workKey: "doi:two" }, { dateAdded: "not a date" }),
      item(4, { workKey: "doi:three" }),
    ]);
    expect([...at.entries()]).toEqual([["doi:one", Date.UTC(2026, 1, 1)]]);
  });
});

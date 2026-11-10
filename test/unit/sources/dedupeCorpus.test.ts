/**
 * `P2-T13` Part A, step 3: the dedup corpus's shape.
 *
 * `test/fixtures/dedup/` holds the candidate pairs `scripts/build-dedup-corpus.ts`
 * assembles from the committed recorded fixtures of all seven sources. This
 * file checks four things, all without a network and without a label written
 * by code:
 *
 * 1. **Reproducible.** The committed files are byte for byte what the builder
 *    produces from the committed fixtures today — so a pair cannot be dropped,
 *    added or edited by hand, and a re-record that moves the corpus shows up
 *    here first.
 * 2. **Covers the cascade.** Every pair the shipped `dedupeRecords` can act on
 *    — every flag, every link, every merge — is a candidate pair, so the
 *    corpus cannot silently miss a decision the engine makes.
 * 3. **Counts each family.** The six families of step 3 (and `docs/02`
 *    §11.3.3's Korean-title note) are counted from the records' own fields,
 *    pinned at today's measured values, and compared with step 3's minimums,
 *    which are asserted verbatim from the card (`plan/README.md` §5 rule 6:
 *    the criterion is never adjusted to match the corpus).
 * 4. **The report refuses unlabelled input.** `scripts/dedup-report.ts` exits
 *    non-zero on an unlabelled file, and its arithmetic keeps a merged
 *    linked-version pair a false positive and a link out of the numerator.
 * 5. **The label set is the owner's sampling** (2026-10-16, `plan/00` §6
 *    item 223): exactly 20 pairs of each of the two big Crossref clusters,
 *    chosen independently of input order, and no other pair sampled out. Since
 *    the owner's decision of 2026-10-16 (`plan/00` §6 item 226), the
 *    short-title cluster holds book-part headings only, so the two identical
 *    Crossref titles that are not ("Genome editing using CRISPR", "Psoroptic
 *    mange") are labelled in full.
 *
 * Since Part B's targeted recording of 2026-10-16 every step-3 family meets
 * its minimum, in the candidate set and in the label set, and the shortfall
 * list is asserted empty. Part B still adds `dedupeAccuracy.test.ts` once the
 * owner has labelled.
 */

import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Doi, Pmid } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  dedupeRecords,
  type DedupDecision,
  type DedupResult,
} from "../../../src/sources/shared/dedupe";
import {
  buildCorpus,
  candidatePairs,
  countFamilies,
  DEDUP_CORPUS_DIR,
  ENGINE_ORIGINS,
  familyShortfalls,
  LABEL_SET_PER_CLUSTER,
  labelSetOf,
  labelSetRank,
  labelsFromSheet,
  labelsOf,
  META_FILE,
  MIN_LABELLED_PAIRS,
  PAIR_LABELS,
  pairFamilies,
  pairIdOf,
  PAIRS_FILE,
  parseCsv,
  parseJsonl,
  parseXmlInNode,
  SAMPLED_CLUSTERS,
  sampledClusterOf,
  sampledOutOf,
  SHEET_FILE,
  STEP3_MINIMUMS,
  toCsv,
  UTF8_BOM,
  PART_HEADING,
  type BuiltCorpus,
  type CorpusMeta,
  type PairRow,
} from "../../../scripts/build-dedup-corpus";
import {
  computeMetrics,
  inLabelSet,
  main as reportMain,
  sampledOutLine,
} from "../../../scripts/dedup-report";
import { assertFixturesFresh } from "../../contract/_transport";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let built: BuiltCorpus;
let committedRows: readonly PairRow[];

beforeAll(async () => {
  committedRows = parseJsonl(
    await readFile(resolve(DEDUP_CORPUS_DIR, PAIRS_FILE), "utf8"),
  );
  built = await buildCorpus(labelsOf(committedRows));
}, 120_000);

/** A hand-built record; only the fields the corpus reads. */
function rec(
  id: string,
  fields: {
    title: string;
    year?: number;
    venue?: string;
    doi?: string;
    pmid?: string;
    type?: SourceRecord["work"]["type"];
    family?: string;
    related?: { doi?: string };
  },
): SourceRecord {
  const [sourceId = "crossref", nativeId = id] = id.split(":");
  return {
    id,
    sourceId: sourceId as SourceRecord["sourceId"],
    nativeId,
    work: {
      ids: {
        ...(fields.doi !== undefined && { doi: fields.doi as Doi }),
        ...(fields.pmid !== undefined && { pmid: fields.pmid as Pmid }),
      },
      type: fields.type ?? "journal-article",
      title: fields.title,
      authors: [{ family: fields.family ?? "Smith" }],
      ...(fields.year !== undefined && {
        publishedDate: { year: fields.year, iso: String(fields.year) },
      }),
      ...(fields.venue !== undefined && { containerTitle: fields.venue }),
      ...(fields.related?.doi !== undefined && {
        relatedVersionIds: { doi: fields.related.doi as Doi },
      }),
    },
    retrievedAtEpochMs: 0,
    missingFields: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Reproducible
// ---------------------------------------------------------------------------

describe("the committed corpus is what the builder makes from the committed fixtures", () => {
  it("holds byte-identical pairs.jsonl, pairs.csv and _meta.json", async () => {
    for (const name of [PAIRS_FILE, SHEET_FILE, META_FILE]) {
      const onDisk = await readFile(resolve(DEDUP_CORPUS_DIR, name), "utf8");
      expect(onDisk, name).toBe(built.files[name]);
    }
  });

  it("reads records from all seven sources' fixtures", () => {
    const sources = new Set(built.corpus.records.map((c) => c.record.sourceId));
    expect([...sources].sort()).toEqual([
      "arxiv",
      "biorxiv",
      "crossref",
      "europepmc",
      "medrxiv",
      "pubmed",
      "semanticscholar",
    ]);
    for (const s of built.corpus.perSource) {
      expect(s.missing, `${s.source}: planned fixture absent`).toEqual([]);
      expect(s.fixturesWithRecords, s.source).toBeGreaterThan(0);
    }
  });

  // Measured 2026-10-16 after `P2-T13` Part B's targeted recording (Part A:
  // 296 / 47 / 40; Part B's first recording: 898 / 438 / 352).
  it("pins today's measured size: 1058 records, 534 pairs, 430 of them compared by the cascade", () => {
    expect(built.corpus.records).toHaveLength(1058);
    expect(built.rows).toHaveLength(534);
    expect(built.rows.filter((r) => r.engineCompares)).toHaveLength(430);
    expect(committedRows).toHaveLength(534);
  });

  // Measured 2026-10-16 after the targeted recording and the narrowed
  // short-title cluster (plan/00 §6 items 223 and 226; before: 169 of 438).
  it("pins the label set: 267 of 534 pairs, 267 sampled out of the two clusters", () => {
    expect(committedRows.filter((r) => r.labelSet)).toHaveLength(267);
    expect(committedRows.filter((r) => !r.labelSet)).toHaveLength(267);
    expect(
      committedRows.filter((r) => r.labelSet && r.a.source !== r.b.source),
    ).toHaveLength(147);
    expect(committedRows.filter((r) => r.a.source !== r.b.source)).toHaveLength(
      147,
    );
    expect(built.labelSetFamilies.counts).toEqual({
      "same-work-3-sources": 11,
      "preprint-published": 27,
      "short-title": 27,
      "series-title": 16,
      "same-title-diff-year-diff-venue": 15,
      "prefix-10.64898": 11,
      "korean-title": 0,
    });
  });

  it("gives every pair a unique, order-independent id", () => {
    const ids = committedRows.map((r) => r.pairId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of committedRows) {
      expect(r.pairId).toBe(pairIdOf(r.b.recordId, r.a.recordId));
      expect(r.pairId).toMatch(/^p-[0-9a-f]{12}$/u);
    }
  });

  it("shows the labeller both records' title, authors, year, venue, DOI, other ids and source", () => {
    for (const r of committedRows) {
      for (const side of [r.a, r.b]) {
        expect(Object.keys(side)).toEqual(
          expect.arrayContaining([
            "source",
            "title",
            "authors",
            "year",
            "venue",
            "doi",
            "otherIds",
          ]),
        );
        expect(side.title.length).toBeGreaterThan(0);
      }
    }
  });

  it("never writes a label: the builder with no human labels yields only empty ones", async () => {
    const fresh = await buildCorpus();
    expect(fresh.rows.every((r) => r.label === "" && r.reason === "")).toBe(
      true,
    );
  });

  it("holds only labels from step 2's three, each with a reason", () => {
    expect(PAIR_LABELS).toEqual([
      "duplicate",
      "not-duplicate",
      "linked-version",
    ]);
    for (const r of committedRows) {
      expect(["", ...PAIR_LABELS]).toContain(r.label);
      if (r.label !== "") expect(r.reason.trim(), r.pairId).not.toBe("");
    }
  });

  it("carries a docs/13 §3.2 sidecar marked derived, aged from its oldest input", async () => {
    const meta = JSON.parse(
      await readFile(resolve(DEDUP_CORPUS_DIR, META_FILE), "utf8"),
    ) as CorpusMeta;
    expect(meta.synthetic).toBe(false);
    expect(meta.derived).toBe(true);
    expect(meta.method).toBe("NONE");
    const oldest = [...meta.derivedFrom.map((d) => d.recordedAt)].sort()[0];
    expect(meta.recordedAt).toBe(oldest);
    expect(meta.pairCount).toBe(committedRows.length);
    const report = await assertFixturesFresh(DEDUP_CORPUS_DIR, Date.now());
    expect(report.checked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Covers the cascade
// ---------------------------------------------------------------------------

describe("the candidate set covers every pair the shipped cascade acts on", () => {
  it("contains every flag, every link, and connects every merged group", () => {
    const pool = built.corpus.records.map((c) => c.record);
    const counter = { comparisons: 0 };
    const result = dedupeRecords(pool, counter);
    const enginePairs = new Set(
      built.pairs
        .filter((p) => p.origins.some((o) => ENGINE_ORIGINS.has(o)))
        .map((p) => p.pairId),
    );
    expect(counter.comparisons).toBeLessThanOrEqual(enginePairs.size);
    for (const p of [...result.flags, ...result.links]) {
      expect(enginePairs, `${p.a.id} / ${p.b.id}`).toContain(
        pairIdOf(p.a.id, p.b.id),
      );
    }
    for (const g of result.groups) {
      if (g.records.length < 2) continue;
      const ids = g.records.map((r) => r.id);
      const reached = new Set([ids[0]]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const x of ids) {
          if (reached.has(x)) continue;
          for (const y of reached) {
            if (y !== undefined && enginePairs.has(pairIdOf(x, y))) {
              reached.add(x);
              grew = true;
              break;
            }
          }
        }
      }
      expect(reached.size, ids.join(" ")).toBe(ids.length);
    }
  });

  it("emits every pair of holders of one identifier, not only the first holder's", () => {
    const a = rec("crossref:a", { title: "x", doi: "10.1234/x" });
    const b = rec("europepmc:b", { title: "y", doi: "10.1234/x" });
    const c = rec("pubmed:c", { title: "z", doi: "10.1234/x" });
    const pairs = candidatePairs([a, b, c]);
    expect(pairs.map((p) => p.pairId).sort()).toEqual(
      [
        pairIdOf("crossref:a", "europepmc:b"),
        pairIdOf("crossref:a", "pubmed:c"),
        pairIdOf("europepmc:b", "pubmed:c"),
      ].sort(),
    );
    expect(pairs.every((p) => p.origins.includes("id:doi"))).toBe(true);
  });

  it("marks same-signature pairs beyond the year tolerance, and identical short titles, as skipped by blocking", () => {
    const title =
      "Comprehensive characterisation of zebrafish retinal regeneration";
    const early = rec("crossref:early", { title, year: 2015 });
    const late = rec("pubmed:late", { title, year: 2020 });
    const r1 = rec("crossref:r1", { title: "Retraction" });
    const r2 = rec("pubmed:r2", { title: "Retraction" });
    const pairs = candidatePairs([early, late, r1, r2]);
    const origins = Object.fromEntries(pairs.map((p) => [p.pairId, p.origins]));
    expect(origins[pairIdOf("crossref:early", "pubmed:late")]).toEqual([
      "block-year-gap",
    ]);
    expect(origins[pairIdOf("crossref:r1", "pubmed:r2")]).toEqual([
      "short-title-identical",
    ]);
    expect(pairs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Counts each family
// ---------------------------------------------------------------------------

describe("step 3's families", () => {
  it("states step 3's minimums verbatim", () => {
    expect(STEP3_MINIMUMS).toEqual({
      "same-work-3-sources": 10,
      "preprint-published": 5,
      "short-title": 5,
      "series-title": 5,
      "same-title-diff-year-diff-venue": 5,
      "prefix-10.64898": 5,
    });
    expect(MIN_LABELLED_PAIRS).toBe(200);
  });

  it("pins today's counts in the committed candidate set", () => {
    expect(built.families.counts).toEqual({
      "same-work-3-sources": 11,
      "preprint-published": 27,
      "short-title": 83,
      "series-title": 16,
      "same-title-diff-year-diff-venue": 15,
      "prefix-10.64898": 11,
      "korean-title": 0,
    });
    expect(built.families.prefix64898BySource).toEqual({
      biorxiv: 4,
      medrxiv: 4,
    });
    expect(built.families.sets.map((s) => s.sources.length)).toEqual([
      3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3,
    ]);
  });

  // Was a pinned list of four short families until the targeted recording of
  // 2026-10-16 (plan/00 §6 item 226).
  it("finds no family short of step 3's minimum, in the candidate set or in the label set", () => {
    expect(familyShortfalls(built.families)).toEqual([]);
    expect(familyShortfalls(built.labelSetFamilies)).toEqual([]);
    // The floor is on *labelled* pairs, and none is labelled yet; the label
    // set the owner will label is now past it.
    expect(
      committedRows.filter((r) => r.labelSet).length,
    ).toBeGreaterThanOrEqual(MIN_LABELLED_PAIRS);
  });

  it("reports no shortfall when every minimum is met and the prefix pairs mix both servers", () => {
    const counts = {
      "same-work-3-sources": 10,
      "preprint-published": 5,
      "short-title": 5,
      "series-title": 5,
      "same-title-diff-year-diff-venue": 5,
      "prefix-10.64898": 5,
      "korean-title": 0,
    };
    expect(
      familyShortfalls({
        counts,
        prefix64898BySource: { biorxiv: 3, medrxiv: 2 },
        sets: [],
      }),
    ).toEqual([]);
    expect(
      familyShortfalls({
        counts,
        prefix64898BySource: { biorxiv: 5, medrxiv: 0 },
        sets: [],
      }).map((s) => s.family),
    ).toEqual(["prefix-10.64898"]);
  });

  it("detects each family on hand-built pairs, from the records' own fields", () => {
    const fam = (a: SourceRecord, b: SourceRecord) => pairFamilies(a, b);
    expect(
      fam(
        rec("crossref:p2", { title: "Studies of the hepatic lobule, Part II" }),
        rec("crossref:p3", {
          title: "Studies of the hepatic lobule, Part III",
        }),
      ),
    ).toContain("series-title");
    expect(
      fam(
        rec("crossref:r1", { title: "Retraction" }),
        rec("pubmed:r2", { title: "Correction" }),
      ),
    ).toContain("short-title");
    expect(
      fam(
        rec("crossref:c", {
          title: "Deep residual learning for image recognition",
          year: 2015,
          venue: "CVPR",
        }),
        rec("crossref:j", {
          title: "Deep residual learning for image recognition",
          year: 2017,
          venue: "TPAMI",
        }),
      ),
    ).toContain("same-title-diff-year-diff-venue");
    expect(
      fam(
        rec("biorxiv:pre", {
          title: "A preprint title",
          doi: "10.1101/2020.01.01.000001",
          related: { doi: "10.1234/pub" },
        }),
        rec("crossref:pub", {
          title: "A different published title",
          doi: "10.1234/pub",
        }),
      ),
    ).toContain("preprint-published");
    expect(
      fam(
        rec("medrxiv:m", {
          title: "x y z w v",
          doi: "10.64898/2026.01.01.000001",
        }),
        rec("crossref:k", { title: "x y z w v" }),
      ),
    ).toContain("prefix-10.64898");
    expect(
      fam(
        rec("crossref:k1", { title: "유전체 편집 기술의 임상 적용" }),
        rec("crossref:k2", { title: "Genome editing" }),
      ),
    ).toContain("korean-title");
    expect(
      fam(
        rec("crossref:n1", {
          title: "Single-cell atlas of the developing human heart",
          year: 2020,
          venue: "Cell",
        }),
        rec("pubmed:n2", {
          title: "Single-cell atlas of the developing human heart",
          year: 2020,
          venue: "Cell",
        }),
      ),
    ).toEqual([]);
  });

  it("counts a same-work set only when three sources share an identifier or an identical title and year", () => {
    const t = "Single-cell atlas of the developing human heart";
    const two = countFamilies(
      candidatePairs([
        rec("crossref:x", { title: t, year: 2020, doi: "10.1234/h" }),
        rec("pubmed:y", { title: t, year: 2020, doi: "10.1234/h" }),
      ]),
    );
    expect(two.counts["same-work-3-sources"]).toBe(0);
    const three = countFamilies(
      candidatePairs([
        rec("crossref:x", { title: t, year: 2020, doi: "10.1234/h" }),
        rec("pubmed:y", { title: t, year: 2020, pmid: "1" }),
        rec("europepmc:MED/1", {
          title: "Something else entirely here",
          pmid: "1",
        }),
      ]),
    );
    expect(three.counts["same-work-3-sources"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3b. The label set — the owner's sampling of two clusters (2026-10-16)
// ---------------------------------------------------------------------------

describe("the label set (plan/00 §6 item 223)", () => {
  /** A deterministic shuffle: the order changes, the content does not. */
  function shuffled<T>(items: readonly T[], seed: number): T[] {
    const out = [...items];
    let s = seed;
    for (let i = out.length - 1; i > 0; i -= 1) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  it("keeps exactly 20 pairs of each cluster in the committed corpus", () => {
    expect(LABEL_SET_PER_CLUSTER).toBe(20);
    expect(SAMPLED_CLUSTERS).toEqual([
      "scotland-reports",
      "short-title-crossref",
    ]);
    expect(sampledOutOf(labelSetOf(built.pairs))).toEqual({
      "scotland-reports": { pairs: 231, kept: 20 },
      "short-title-crossref": { pairs: 76, kept: 20 },
    });
    for (const cluster of SAMPLED_CLUSTERS) {
      const inCluster = committedRows.filter(
        (r) => r.sampleCluster === cluster,
      );
      expect(
        inCluster.filter((r) => r.labelSet),
        cluster,
      ).toHaveLength(20);
    }
  });

  // Owner, 2026-10-16 (plan/00 §6 item 226).
  it("labels in full the two identical Crossref titles that are not book-part headings", () => {
    const named = committedRows.filter(
      (r) =>
        r.a.source === "crossref" &&
        r.b.source === "crossref" &&
        ["genome editing using crispr", "psoroptic mange"].includes(
          r.a.title.toLowerCase(),
        ) &&
        r.a.title.toLowerCase() === r.b.title.toLowerCase(),
    );
    expect(named.map((r) => r.a.title.toLowerCase()).sort()).toEqual([
      "genome editing using crispr",
      "psoroptic mange",
    ]);
    for (const r of named) {
      expect(r.labelSet, r.pairId).toBe(true);
      expect(r.sampleCluster, r.pairId).toBeNull();
    }
    // Every pair left in the short-title cluster is a book-part heading.
    for (const r of committedRows) {
      if (r.sampleCluster !== "short-title-crossref") continue;
      expect(r.a.title, r.pairId).toMatch(/\bpart\s+[ivxlc\d]+\b/iu);
    }
  });

  it("reads a book-part heading only as whole words: 'part' and a numeral", () => {
    for (const yes of ["part ii", "part iii introduction", "x part 2 y"]) {
      expect(PART_HEADING.test(yes), yes).toBe(true);
    }
    for (const no of [
      "psoroptic mange",
      "genome editing using crispr",
      "counterpart ii",
      "part iiia",
      "partii",
      "parts ii",
    ]) {
      expect(PART_HEADING.test(no), no).toBe(false);
    }
    const twin = (id: string, title: string) => rec(id, { title });
    expect(
      sampledClusterOf(
        twin("crossref:m1", "Psoroptic Mange"),
        twin("crossref:m2", "Psoroptic Mange"),
      ),
    ).toBeUndefined();
    expect(
      sampledClusterOf(
        twin("crossref:h1", "[Part III Introduction]"),
        twin("crossref:h2", "[Part III Introduction]"),
      ),
    ).toBe("short-title-crossref");
  });

  it("samples out no pair outside the two clusters", () => {
    for (const r of committedRows) {
      if (r.sampleCluster === null) expect(r.labelSet, r.pairId).toBe(true);
      if (!r.labelSet) expect(r.sampleCluster, r.pairId).not.toBeNull();
    }
    const byId = new Map(built.pairs.map((p) => [p.pairId, p]));
    for (const r of committedRows) {
      const p = byId.get(r.pairId);
      if (p === undefined) throw new Error(`no pair ${r.pairId}`);
      expect(sampledClusterOf(p.a, p.b) ?? null, r.pairId).toBe(
        r.sampleCluster,
      );
    }
  });

  it("keeps the 20 smallest salted hashes of the pair id in each cluster", () => {
    for (const cluster of SAMPLED_CLUSTERS) {
      const ids = committedRows
        .filter((r) => r.sampleCluster === cluster)
        .map((r) => r.pairId);
      const expected = [...ids]
        .sort((x, y) =>
          labelSetRank(x) < labelSetRank(y)
            ? -1
            : labelSetRank(x) > labelSetRank(y)
              ? 1
              : 0,
        )
        .slice(0, 20)
        .sort();
      expect(
        committedRows
          .filter((r) => r.sampleCluster === cluster && r.labelSet)
          .map((r) => r.pairId)
          .sort(),
        cluster,
      ).toEqual(expected);
    }
  });

  it("does not depend on input order: shuffled pairs and shuffled records give the same label set", () => {
    const reference = labelSetOf(built.pairs);
    for (const seed of [1, 7, 2026]) {
      expect(labelSetOf(shuffled(built.pairs, seed))).toEqual(reference);
    }
    const pool = built.corpus.records.map((c) => c.record);
    const fromShuffledRecords = labelSetOf(candidatePairs(shuffled(pool, 99)));
    expect(fromShuffledRecords).toEqual(reference);
  });

  it("recognises the clusters from record fields, on hand-built records", () => {
    const scot = (id: string, week: string) =>
      rec(id, {
        title: `Enhanced Surveillance of COVID-19 in Scotland - ${week}`,
      });
    expect(
      sampledClusterOf(
        scot("crossref:s1", "Week 1"),
        scot("crossref:s2", "Week 2"),
      ),
    ).toBe("scotland-reports");
    expect(
      sampledClusterOf(
        scot("crossref:s1", "Week 1"),
        scot("pubmed:s2", "Week 2"),
      ),
    ).toBeUndefined();
    expect(
      sampledClusterOf(
        rec("crossref:p1", { title: "Part III" }),
        rec("crossref:p2", { title: "PART III." }),
      ),
    ).toBe("short-title-crossref");
    expect(
      sampledClusterOf(
        rec("crossref:p1", { title: "Part II" }),
        rec("crossref:p2", { title: "Part III" }),
      ),
    ).toBeUndefined();
    const long = "Single-cell atlas of the developing human heart";
    expect(
      sampledClusterOf(
        rec("crossref:l1", { title: long }),
        rec("crossref:l2", { title: long }),
      ),
    ).toBeUndefined();
  });

  it("keeps 20 of a hand-built 28-pair cluster, the same 20 in any order, and every other pair", () => {
    const parts = Array.from({ length: 8 }, (_, i) =>
      rec(`crossref:part${String(i)}`, { title: "Part III" }),
    );
    const others = [
      rec("crossref:o1", { title: "Retraction" }),
      rec("pubmed:o2", { title: "Retraction" }),
    ];
    const pairs = candidatePairs([...parts, ...others]);
    expect(pairs).toHaveLength(29);
    const set = labelSetOf(pairs);
    expect(sampledOutOf(set)).toEqual({
      "scotland-reports": { pairs: 0, kept: 0 },
      "short-title-crossref": { pairs: 28, kept: 20 },
    });
    expect(set.get(pairIdOf("crossref:o1", "pubmed:o2"))).toEqual({
      labelSet: true,
      cluster: undefined,
    });
    expect(labelSetOf(candidatePairs([...others, ...parts].reverse()))).toEqual(
      set,
    );
  });

  it("writes only label-set pairs to the labelling sheet, and every pair to pairs.jsonl", () => {
    const sheet = parseCsv(built.files[SHEET_FILE] ?? "");
    const idCol = sheet[0]?.indexOf("pair_id") ?? -1;
    expect(
      sheet
        .slice(1)
        .map((r) => r[idCol])
        .sort(),
    ).toEqual(
      committedRows
        .filter((r) => r.labelSet)
        .map((r) => r.pairId)
        .sort(),
    );
    expect(parseJsonl(built.files[PAIRS_FILE] ?? "")).toHaveLength(534);
  });

  it("the report counts a row without labelSet as in the set, and names what was sampled out", () => {
    const [first, second] = committedRows;
    if (first === undefined || second === undefined) throw new Error("empty");
    const legacy: Record<string, unknown> = { ...first };
    delete legacy["labelSet"];
    expect(inLabelSet(legacy as unknown as PairRow)).toBe(true);
    expect(inLabelSet({ ...first, labelSet: false })).toBe(false);
    expect(
      sampledOutLine([
        { ...first, labelSet: false, sampleCluster: "scotland-reports" },
        { ...second, labelSet: true, sampleCluster: null },
      ]),
    ).toBe(
      "Sampled out of the label set (owner, 2026-10-16): 1 of 2 pairs, not measured (scotland-reports 1)",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The labelling sheet and the report
// ---------------------------------------------------------------------------

describe("the labelling sheet", () => {
  it("round-trips through CSV with a byte-order mark, quotes and commas intact", () => {
    const csv = toCsv(committedRows);
    expect(csv.startsWith(`${UTF8_BOM}pair_id,label,reason,`)).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(committedRows.length + 1);
    const titleCol = parsed[0]?.indexOf("a_title") ?? -1;
    expect(parsed.slice(1).map((r) => r[titleCol])).toEqual(
      committedRows.map((r) => r.a.title),
    );
  });

  it("copies only what a person typed, and refuses an unknown label or pair", () => {
    const known = new Set(committedRows.map((r) => r.pairId));
    const first = committedRows[0];
    if (first === undefined) throw new Error("empty corpus");
    const sheet = (label: string, id = first.pairId): string =>
      `pair_id,label,reason\r\n${id},${label},"typed, by a person"\r\n`;
    expect(labelsFromSheet(sheet(""), known).size).toBe(0);
    expect(
      labelsFromSheet(sheet("not-duplicate"), known).get(first.pairId),
    ).toEqual({
      label: "not-duplicate",
      reason: "typed, by a person",
    });
    expect(() => labelsFromSheet(sheet("dupe"), known)).toThrow(/not one of/u);
    expect(() =>
      labelsFromSheet(sheet("duplicate", "p-000000000000"), known),
    ).toThrow(/unknown pair/u);
  });
});

describe("scripts/dedup-report.ts", () => {
  it("refuses the committed corpus, labelled only on the owner's 60-pair sample, and exits non-zero (--full; the sample mode is dedupeLabelSample.test.ts)", async () => {
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const code = await reportMain([
        resolve(DEDUP_CORPUS_DIR, PAIRS_FILE),
        "--full",
      ]);
      expect(code).toBe(1);
      const said = String(err.mock.calls[0]?.[0]);
      expect(said).toMatch(
        /is not fully labelled: 207 of 267 label-set pairs have no label/u,
      );
      expect(said).toContain(
        "Sampled out of the label set (owner, 2026-10-16): 267 of 534 pairs, " +
          "not measured (scotland-reports 211, short-title-crossref 56)",
      );
    } finally {
      err.mockRestore();
    }
  });

  it("refuses a file with a label outside step 2's three, before running anything", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dedup-report-"));
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const file = join(dir, "pairs.jsonl");
      const first = committedRows[0];
      if (first === undefined) throw new Error("empty corpus");
      await writeFile(
        file,
        `${JSON.stringify({ ...first, label: "maybe" })}\n`,
      );
      expect(await reportMain([file])).toBe(2);
    } finally {
      err.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts a merged linked-version pair as a false positive and keeps links out of the numerator", () => {
    const a = rec("crossref:a", { title: "Alpha beta gamma delta epsilon" });
    const b = rec("pubmed:b", { title: "Alpha beta gamma delta epsilon" });
    const c = rec("biorxiv:c", { title: "Zeta eta theta iota kappa" });
    const d = rec("crossref:d", { title: "Zeta eta theta iota kappa" });
    const e = rec("crossref:e", { title: "Lambda mu nu xi omicron" });
    const f = rec("pubmed:f", { title: "Lambda mu nu xi omicron" });
    const none: DedupDecision = {
      verdict: "distinct",
      tier: null,
      confidence: 0,
      evidence: {},
    };
    const result: DedupResult = {
      groups: [
        { records: [a, b], decisions: [] },
        { records: [c, d], decisions: [] },
        { records: [e], decisions: [] },
        { records: [f], decisions: [] },
      ],
      flags: [{ a: e, b: f, decision: none }],
      links: [],
      comparisons: 3,
      recordsDeduplicatedAway: 2,
    };
    const row = (
      x: SourceRecord,
      y: SourceRecord,
      label: PairRow["label"],
    ): PairRow => ({
      pairId: pairIdOf(x.id, y.id),
      label,
      reason: "test case",
      labelSet: true,
      sampleCluster: null,
      engineCompares: true,
      origins: ["block"],
      families: [],
      a: {
        recordId: x.id,
        source: x.sourceId,
        title: x.work.title,
        authors: "",
        authorCount: 0,
        year: null,
        venue: null,
        type: x.work.type,
        doi: null,
        otherIds: {},
        relatedVersionIds: {},
        fixtures: [],
      },
      b: {
        recordId: y.id,
        source: y.sourceId,
        title: y.work.title,
        authors: "",
        authorCount: 0,
        year: null,
        venue: null,
        type: y.work.type,
        doi: null,
        otherIds: {},
        relatedVersionIds: {},
        fixtures: [],
      },
    });
    const byId = new Map([a, b, c, d, e, f].map((r) => [r.id, r]));
    const m = computeMetrics(
      [
        row(a, b, "duplicate"),
        row(c, d, "linked-version"),
        row(e, f, "duplicate"),
      ],
      byId,
      result,
    );
    expect(m.matrix.duplicate.merged).toBe(1);
    expect(m.matrix["linked-version"].merged).toBe(1);
    expect(m.matrix.duplicate.flagged).toBe(1);
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(1);
    expect(m.falseNegatives).toBe(1);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.5);
    expect(() => computeMetrics([row(a, b, "")], byId, result)).toThrow(
      /unlabelled/u,
    );
  });
});

describe("the Node XML parser the builder hands the mappers", () => {
  it("reports malformed XML and undeclared prefixes as a parsererror document, as Gecko does", () => {
    expect(parseXmlInNode("<a><b></a>").documentElement?.localName).toBe(
      "parsererror",
    );
    expect(parseXmlInNode("<x:a/>").documentElement?.localName).toBe(
      "parsererror",
    );
    const doc = parseXmlInNode(
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "x">]><r xmlns="urn:n" k="&amp;"><![CDATA[<i>]]>t&#233;</r>',
    );
    expect(doc.documentElement?.namespaceURI).toBe("urn:n");
    expect(doc.documentElement?.getAttribute("k")).toBe("&");
    expect(doc.documentElement?.textContent).toBe("<i>té");
  });
});

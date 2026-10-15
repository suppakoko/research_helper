/**
 * `P2-T11`: preprint ↔ published-version linking, end to end in Node.
 *
 * `docs/02` §11.4 — a preprint and its published version are **different
 * works**: link them, never merge them. Gate `G-16` (decided 2026-10-14) fixed
 * the product rule: both stay, related through Zotero *Related*, the preprint
 * tagged `research_helper/superseded-by-published`, no merge offered in v1.
 *
 * What is asserted here, by layer:
 *
 * 1. **The signals**, measured on the recorded fixtures through the shipped
 *    mappers: bioRxiv `published`, Crossref `is-preprint-of` / `has-preprint`,
 *    Europe PMC `commentCorrectionList`, and arXiv `<arxiv:doi>` (a hand-built
 *    `<entry>`, because Node has no `DOMParser` and the arXiv suite's own
 *    parser lives in a test file this one may not import without running it).
 * 2. **The cascade** (`src/sources/shared/dedupe.ts`): a named pair is always
 *    compared, Tier 7 says `"link"` and never `"match"`, a title match with
 *    conflicting DOIs is a link, the 0.75 preprint-pair row stays a flag, and
 *    `<arxiv:journal_ref>` is never a link.
 * 3. **The stage** (`src/pipeline/searchImport/stages.ts`): two works, each
 *    naming the other, one `VersionLink`, the preprint side named by `type`.
 * 4. **The write side's pure halves**: `areOtherVersions` (`src/model/merge.ts`),
 *    `versionAwareBatches` (`searchImportPipeline.ts`) and the `extra` line and
 *    tag `toZoteroMapping` writes (`src/zotero/itemMapper.ts`, `docs/07` §6.2).
 *    The *Related* relation itself is written inside Zotero and asserted by
 *    `test/integration/zotero/versionLinking.spec.ts`.
 *
 * No network: every record is a recorded fixture or built here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import type { CanonicalWork, WorkType } from "../../../src/model/canonicalWork";
import {
  normalizeDoi,
  type Doi,
  type ExternalIds,
  type SourceId,
} from "../../../src/model/ids";
import { areOtherVersions, merge } from "../../../src/model/merge";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import { versionAwareBatches } from "../../../src/pipeline/searchImport/searchImportPipeline";
import {
  dedupeAndMerge,
  SUPERSEDED_BY_PUBLISHED_TAG as STAGES_TAG,
} from "../../../src/pipeline/searchImport/stages";
import {
  ARXIV_NS,
  ATOM_NS,
  mapEntry,
  type XmlElementLike,
} from "../../../src/sources/arxiv/mapper";
import { createBiorxivRecordMapper } from "../../../src/sources/biorxiv/mapper";
import { createCrossrefRecordMapper } from "../../../src/sources/crossref/mapper";
import { createEuropePmcRecordMapper } from "../../../src/sources/europepmc/mapper";
import {
  compareRecords,
  dedupeRecords,
  TIER_CONFIDENCE,
} from "../../../src/sources/shared/dedupe";
import { parseExtra } from "../../../src/zotero/extraField";
import {
  SUPERSEDED_BY_PUBLISHED_TAG,
  toZoteroMapping,
  VERSION_DOI_EXTRA_KEY,
} from "../../../src/zotero/itemMapper";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../../fixtures");
const AT = Date.UTC(2026, 9, 15, 0, 0, 0);
const clock = createManualClock(AT);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The recorded response body of one scenario, by its sidecar's `scenario`. */
function recordedBody(source: string, scenario: string): unknown {
  const dir = resolve(FIXTURES, source);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith("_meta.json")) continue;
    const meta = JSON.parse(readFileSync(resolve(dir, name), "utf8")) as {
      scenario: string;
    };
    if (meta.scenario !== scenario) continue;
    const exchange = JSON.parse(
      readFileSync(resolve(dir, name.replace("_meta.json", ".json")), "utf8"),
    ) as { body: string };
    return JSON.parse(exchange.body) as unknown;
  }
  throw new Error(`no ${source} fixture for ${scenario}`);
}

function doi(raw: string): Doi {
  const d = normalizeDoi(raw);
  if (d === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return d;
}

function only<T>(items: readonly T[], what: string): T {
  expect(items, what).toHaveLength(1);
  const item = items[0];
  if (item === undefined) throw new Error(what);
  return item;
}

function byNativeId(
  records: readonly SourceRecord[],
  id: string,
): SourceRecord {
  const found = records.find((r) => r.nativeId === id);
  if (found === undefined) throw new Error(`no record ${id}`);
  return found;
}

/** The bioRxiv `record-rich` exchange through the shipped mapper. */
function biorxivRecordRich(): SourceRecord {
  const body = recordedBody("biorxiv", "record-rich") as {
    collection: unknown[];
  };
  return only(
    createBiorxivRecordMapper({ clock })(body.collection, {
      endpoint: "details",
      requestedServer: "biorxiv",
    }),
    "bioRxiv record-rich maps to one record",
  );
}

/** The Crossref `record-preprint` page, abstracts removed (they need a DOMParser). */
function crossrefRecordPreprint(): readonly SourceRecord[] {
  const body = recordedBody("crossref", "record-preprint") as {
    message: { items: Record<string, unknown>[] };
  };
  const items = body.message.items.map((item) => {
    const copy = { ...item };
    delete copy["abstract"];
    return copy;
  });
  return createCrossrefRecordMapper({ clock })(items);
}

function europepmc(scenario: string): readonly SourceRecord[] {
  const body = recordedBody("europepmc", scenario) as {
    resultList: { result: unknown[] };
  };
  return createEuropePmcRecordMapper({ clock })(body.resultList.result);
}

/** One element of the `XmlElementLike` port the arXiv mapper reads. */
function el(
  ns: string,
  local: string,
  text: string | undefined,
  children: readonly XmlElementLike[] = [],
  attrs: Readonly<Record<string, string>> = {},
): XmlElementLike {
  return {
    namespaceURI: ns,
    localName: local,
    textContent: text ?? children.map((c) => c.textContent ?? "").join(""),
    getAttribute: (name) => attrs[name] ?? null,
    children: {
      length: children.length,
      item: (i) => children[i] ?? null,
    },
  };
}

/**
 * An arXiv `<entry>` in the shape the `record-rich` fixture records for
 * `1907.10121v1` (`test/unit/sources/arxiv.test.ts` asserts that record's
 * mapped `ids` and `relatedVersionIds`): its id, title, date and the
 * `<arxiv:doi>` naming the journal version. `journalRef` adds an
 * `<arxiv:journal_ref>`; `journalDoi: undefined` leaves the DOI out.
 */
function arxivEntry(options: {
  readonly journalDoi: string | undefined;
  readonly journalRef?: string;
}): SourceRecord {
  const children: XmlElementLike[] = [
    el(ATOM_NS, "id", "http://arxiv.org/abs/1907.10121v1"),
    el(
      ATOM_NS,
      "title",
      "SciPy 1.0--Fundamental Algorithms for Scientific Computing in Python",
    ),
    el(ATOM_NS, "published", "2019-07-23T16:27:54Z"),
    el(ATOM_NS, "author", undefined, [el(ATOM_NS, "name", "Pauli Virtanen")]),
  ];
  if (options.journalDoi !== undefined) {
    children.push(el(ARXIV_NS, "doi", options.journalDoi));
  }
  if (options.journalRef !== undefined) {
    children.push(el(ARXIV_NS, "journal_ref", options.journalRef));
  }
  const record = mapEntry(
    el(ATOM_NS, "entry", undefined, children),
    AT,
    false,
    () => undefined,
  );
  if (record === null) throw new Error("the arXiv entry must map");
  return record;
}

/** A synthetic record — what a source would return for the other version. */
function synthetic(spec: {
  readonly source: SourceId;
  readonly nativeId: string;
  readonly title: string;
  readonly year: number;
  readonly type?: WorkType;
  readonly ids?: ExternalIds;
  readonly related?: ExternalIds;
  readonly family?: string;
}): SourceRecord {
  return {
    id: `${spec.source}:${spec.nativeId}`,
    sourceId: spec.source,
    nativeId: spec.nativeId,
    work: {
      ids: spec.ids ?? {},
      type: spec.type ?? "journal-article",
      title: spec.title,
      authors: [{ family: spec.family ?? "Synthetic", given: "A" }],
      publishedDate: { year: spec.year, iso: String(spec.year) },
      ...(spec.related !== undefined && { relatedVersionIds: spec.related }),
    },
    retrievedAtEpochMs: AT,
    missingFields: [],
  };
}

/** A merged work from one record — the shape the write side receives. */
function workOf(record: SourceRecord): CanonicalWork {
  return merge([record], AT).work;
}

// ---------------------------------------------------------------------------
// 1. The signals, measured on the recorded fixtures (rule 8: measure first)
// ---------------------------------------------------------------------------

describe("the docs/02 §11.4 signals the mappers already harvest (measured)", () => {
  it("bioRxiv: published != NA becomes relatedVersionIds.doi, ids.doi untouched", () => {
    const r = biorxivRecordRich();
    expect(r.work.type).toBe("preprint");
    expect(r.work.ids.doi).toBe("10.1101/2025.09.17.676679");
    expect(r.work.relatedVersionIds).toEqual({
      doi: "10.1091/mbc.e25-09-0454",
    });
  });

  it("Crossref: is-preprint-of and has-preprint name each other", () => {
    const records = crossrefRecordPreprint();
    const pre = byNativeId(records, "10.1101/2023.02.17.528953");
    const pub = byNativeId(records, "10.1093/nar/gkad598");
    expect(pre.work.type).toBe("preprint");
    expect(pre.work.relatedVersionIds).toEqual({ doi: "10.1093/nar/gkad598" });
    expect(pub.work.relatedVersionIds).toEqual({
      doi: "10.1101/2023.02.17.528953",
    });
  });

  it("Europe PMC: 'Preprint of' gives the PMID, 'Preprint in' the PPR id", () => {
    expect(
      byNativeId(europepmc("record-preprint"), "PPR/PPR657399").work
        .relatedVersionIds,
    ).toEqual({ pmid: "37347132" });
    expect(
      byNativeId(europepmc("search-typical"), "MED/36988873").work
        .relatedVersionIds,
    ).toEqual({ epmcId: "PPR578427" });
  });

  it("arXiv: <arxiv:doi> is the journal DOI, and the entry keeps its DataCite DOI", () => {
    const r = arxivEntry({ journalDoi: "10.1038/s41592-019-0686-2" });
    expect(r.work.ids).toEqual({
      doi: "10.48550/arxiv.1907.10121",
      arxivId: "1907.10121",
    });
    expect(r.work.relatedVersionIds).toEqual({
      doi: "10.1038/s41592-019-0686-2",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Done-when 1 — bioRxiv: two records, linked both ways
// ---------------------------------------------------------------------------

describe("criterion 1: a bioRxiv preprint with a published version stays two records", () => {
  const preprint = biorxivRecordRich();
  // Synthetic: the corpus records no Crossref answer for this DOI. The title
  // differs from the preprint's and the year is three after it, so the
  // blocking pass alone (same title signature, |Δyear| ≤ 1) would never put
  // the two through the cascade.
  const published = synthetic({
    source: "crossref",
    nativeId: "10.1091/mbc.e25-09-0454",
    title: "A published title that shares nothing with the preprint's wording",
    year: 2028,
    ids: { doi: doi("10.1091/mbc.E25-09-0454") },
  });

  it("produces relatedVersionIds on both sides and two works, not one", () => {
    const result = dedupeAndMerge([preprint, published], AT);
    expect(result.works).toHaveLength(2);
    expect(result.recordsDeduplicatedAway).toBe(0);
    const pre = result.works.find((w) => w.type === "preprint");
    const pub = result.works.find((w) => w.type !== "preprint");
    expect(pre?.relatedVersionIds?.doi).toBe("10.1091/mbc.e25-09-0454");
    expect(pub?.relatedVersionIds?.doi).toBe("10.1101/2025.09.17.676679");
    // Neither absorbed the other's record.
    expect(pre?.provenance.recordIds).toEqual([preprint.id]);
    expect(pub?.provenance.recordIds).toEqual([published.id]);
    expect(pre?.ids.doi).toBe("10.1101/2025.09.17.676679");
    expect(pub?.ids.doi).toBe("10.1091/mbc.e25-09-0454");
  });

  it("reports one link at Tier 7 naming the preprint by its type", () => {
    const result = dedupeAndMerge([preprint, published], AT);
    const link = only(result.links, "one link");
    expect(link.decision).toMatchObject({
      verdict: "link",
      tier: "version-link",
      confidence: TIER_CONFIDENCE.versionLink,
    });
    expect(link.preprintWorkKey).toBe("doi:10.1101/2025.09.17.676679");
    expect(result.flags).toEqual([]);
  });

  it("the identifier pass compares the named pair: one comparison, whatever the order", () => {
    for (const order of [
      [preprint, published],
      [published, preprint],
    ]) {
      const r = dedupeRecords(order);
      expect(r.comparisons).toBe(1);
      expect(r.groups).toHaveLength(2);
      expect(only(r.links, "one link").decision.verdict).toBe("link");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Done-when 2 — arXiv <arxiv:doi> at confidence 1.00; journal_ref is not a link
// ---------------------------------------------------------------------------

describe("criterion 2: arXiv <arxiv:doi> is a confidence-1.00 link", () => {
  const journal = synthetic({
    source: "crossref",
    nativeId: "10.1038/s41592-019-0686-2",
    title: "A published title written for this test, unlike the preprint's",
    year: 2020,
    ids: { doi: doi("10.1038/s41592-019-0686-2") },
  });

  it("links the entry to the journal record at Tier 7, confidence 1.00", () => {
    const entry = arxivEntry({ journalDoi: "10.1038/s41592-019-0686-2" });
    const d = compareRecords(entry, journal);
    expect(d.verdict).toBe("link");
    expect(d.tier).toBe("version-link");
    expect(d.confidence).toBe(1);
  });

  it("keeps the arXiv record's own DOI the constructed 10.48550/arXiv.<id>", () => {
    const entry = arxivEntry({ journalDoi: "10.1038/s41592-019-0686-2" });
    const result = dedupeAndMerge([entry, journal], AT);
    expect(result.works).toHaveLength(2);
    const arxiv = result.works.find((w) => w.type === "preprint");
    expect(arxiv?.ids.doi).toBe("10.48550/arxiv.1907.10121");
    expect(arxiv?.workKey).toBe("doi:10.48550/arxiv.1907.10121");
    expect(arxiv?.relatedVersionIds?.doi).toBe("10.1038/s41592-019-0686-2");
    expect(only(result.links, "one link").decision.confidence).toBe(1);
  });

  it("never treats <arxiv:journal_ref> as a resolved link (docs/02 §11.4: 0.90, text only)", () => {
    const entry = arxivEntry({
      journalDoi: undefined,
      journalRef: "Nature Methods 17, 261-272 (2020)",
    });
    expect(entry.work.relatedVersionIds).toBeUndefined();
    expect(compareRecords(entry, journal).verdict).toBe("distinct");
    const result = dedupeAndMerge([entry, journal], AT);
    expect(result.links).toEqual([]);
    expect(result.works).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Done-when 3 and the Tier 7 rule
// ---------------------------------------------------------------------------

describe("Tier 7 and §11.5 rule 1: link, never match", () => {
  const sharedTitle =
    "Precise and efficient editing of transcripts in living human cells";

  it("Tier 7 returns 'link', never 'match', for a pair named only through relatedVersionIds", () => {
    const a = synthetic({
      source: "biorxiv",
      nativeId: "10.1101/2024.01.01.000001",
      type: "preprint",
      title: "Working title of a preprint about transcript editing in cells",
      year: 2024,
      ids: { doi: doi("10.1101/2024.01.01.000001") },
      related: { doi: doi("10.5555/rh-p2t11.published") },
    });
    const b = synthetic({
      source: "crossref",
      nativeId: "10.5555/rh-p2t11.published",
      title: "Final title chosen by the journal after two rounds of review",
      year: 2026,
      ids: { doi: doi("10.5555/rh-p2t11.published") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.verdict).not.toBe("match");
    const r = dedupeRecords([a, b]);
    expect(r.groups).toHaveLength(2);
    expect(r.links).toHaveLength(1);
  });

  it("a title-matched pair with conflicting DOIs returns 'link', never 'match' (criterion 3)", () => {
    const a = synthetic({
      source: "pubmed",
      nativeId: "a",
      title: sharedTitle,
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.first") },
    });
    const b = synthetic({
      source: "crossref",
      nativeId: "b",
      title: sharedTitle,
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.second") },
    });
    const d = compareRecords(a, b);
    expect(d.verdict).toBe("link");
    expect(d.evidence["conflictingIds"]).toBe("doi");
    const result = dedupeAndMerge([a, b], AT);
    expect(result.works).toHaveLength(2);
    expect(only(result.links, "one link").preprintWorkKey).toBeUndefined();
    expect(result.works[0]?.relatedVersionIds?.doi).toBe(
      "10.5555/rh-p2t11.second",
    );
    expect(result.works[1]?.relatedVersionIds?.doi).toBe(
      "10.5555/rh-p2t11.first",
    );
  });

  it("the fuzzy preprint-pair signal (0.75) stays a flag, not a link", () => {
    const pre = synthetic({
      source: "europepmc",
      nativeId: "PPR/PPR000001",
      type: "preprint",
      title: sharedTitle,
      year: 2025,
    });
    const pub = synthetic({
      source: "pubmed",
      nativeId: "41000001",
      title: sharedTitle,
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.flag") },
    });
    const d = compareRecords(pre, pub);
    expect(d.verdict).toBe("flag");
    expect(d.confidence).toBe(TIER_CONFIDENCE.preprintPairFlag);
    const result = dedupeAndMerge([pre, pub], AT);
    expect(result.links).toEqual([]);
    expect(result.flags).toHaveLength(1);
    expect(result.works).toHaveLength(2);
  });

  it("Europe PMC: a published record's relatedVersionIds.epmcId links the PPR record it names", () => {
    const published = byNativeId(europepmc("search-typical"), "MED/36988873");
    // Synthetic: the recorded page holds no PPR578427 record.
    const preprint = synthetic({
      source: "europepmc",
      nativeId: "PPR/PPR578427",
      type: "preprint",
      title: "A preprint title written for this test, unlike the article's",
      year: 2022,
      ids: { doi: doi("10.1101/2022.11.11.516101") },
    });
    const d = compareRecords(published, preprint);
    expect(d.verdict).toBe("link");
    expect(d.tier).toBe("version-link");
    const result = dedupeAndMerge([published, preprint], AT);
    expect(result.works).toHaveLength(2);
    expect(only(result.links, "one link").preprintWorkKey).toBe(
      "doi:10.1101/2022.11.11.516101",
    );
  });

  it("names the preprint side by type, never by DOI prefix (docs/02 §11.2)", () => {
    // Two journal articles, one under a prefix in the §11.2 preprint set.
    const a = synthetic({
      source: "crossref",
      nativeId: "x",
      title: sharedTitle,
      year: 2025,
      ids: { doi: doi("10.1101/gr.000001.125") },
    });
    const b = synthetic({
      source: "pubmed",
      nativeId: "y",
      title: sharedTitle,
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.journal") },
    });
    const result = dedupeAndMerge([a, b], AT);
    expect(only(result.links, "one link").preprintWorkKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. The write side's pure halves
// ---------------------------------------------------------------------------

describe("areOtherVersions (src/model/merge.ts)", () => {
  const pre = workOf(
    synthetic({
      source: "biorxiv",
      nativeId: "p",
      type: "preprint",
      title: "Preprint",
      year: 2024,
      ids: { doi: doi("10.1101/2024.02.02.000002") },
      related: { doi: doi("10.5555/rh-p2t11.pub") },
    }),
  );
  const pub = workOf(
    synthetic({
      source: "crossref",
      nativeId: "q",
      title: "Published",
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.pub") },
    }),
  );

  it("is true in both directions when one side names the other", () => {
    expect(areOtherVersions(pre, pub)).toBe(true);
    expect(areOtherVersions(pub, pre)).toBe(true);
  });

  it("is true when only the published side names its preprint (Crossref has-preprint)", () => {
    const bare = workOf(
      synthetic({
        source: "biorxiv",
        nativeId: "b",
        type: "preprint",
        title: "Preprint that names nothing",
        year: 2024,
        ids: { doi: doi("10.1101/2024.06.06.000006") },
      }),
    );
    const naming = workOf(
      synthetic({
        source: "crossref",
        nativeId: "c",
        title: "Article naming its preprint",
        year: 2025,
        ids: { doi: doi("10.5555/rh-p2t11.names-preprint") },
        related: { doi: doi("10.1101/2024.06.06.000006") },
      }),
    );
    expect(areOtherVersions(bare, naming)).toBe(true);
    expect(areOtherVersions(naming, bare)).toBe(true);
  });

  it("is false for a work and itself, and for unrelated works", () => {
    expect(areOtherVersions(pre, pre)).toBe(false);
    const other = workOf(
      synthetic({
        source: "pubmed",
        nativeId: "r",
        title: "Other",
        year: 2025,
        ids: { doi: doi("10.5555/rh-p2t11.other") },
      }),
    );
    expect(areOtherVersions(pre, other)).toBe(false);
  });

  it("merge() drops a relatedVersionIds value that is the work's own id", () => {
    const self = workOf(
      synthetic({
        source: "crossref",
        nativeId: "s",
        title: "Self-referential record",
        year: 2025,
        ids: { doi: doi("10.5555/rh-p2t11.self") },
        related: { doi: doi("10.5555/rh-p2t11.self") },
      }),
    );
    expect(self.relatedVersionIds).toBeUndefined();
  });
});

describe("versionAwareBatches (searchImportPipeline.ts): versions share a write batch", () => {
  function filler(n: number): CanonicalWork[] {
    return Array.from({ length: n }, (_, i) =>
      workOf(
        synthetic({
          source: "pubmed",
          nativeId: `f${String(i)}`,
          title: `Filler ${String(i)}`,
          year: 2025,
          ids: { doi: doi(`10.5555/rh-p2t11.filler-${String(i)}`) },
        }),
      ),
    );
  }
  const pre = workOf(
    synthetic({
      source: "biorxiv",
      nativeId: "p",
      type: "preprint",
      title: "Preprint",
      year: 2024,
      ids: { doi: doi("10.1101/2024.03.03.000003") },
      related: { doi: doi("10.5555/rh-p2t11.batched") },
    }),
  );
  const pub = workOf(
    synthetic({
      source: "crossref",
      nativeId: "q",
      title: "Published",
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.batched") },
    }),
  );

  it("puts a preprint and its published version in one batch across a boundary", () => {
    const works = [pre, ...filler(60), pub];
    const batches = versionAwareBatches(works, 50);
    const holding = batches.filter((b) => b.includes(pre) || b.includes(pub));
    expect(holding).toHaveLength(1);
    expect(holding[0]).toContain(pre);
    expect(holding[0]).toContain(pub);
    expect(batches.flat()).toHaveLength(works.length);
    expect(new Set(batches.flat())).toEqual(new Set(works));
  });

  it("is a plain split into runs of `size` when no work names another", () => {
    const works = filler(120);
    expect(versionAwareBatches(works, 50)).toEqual([
      works.slice(0, 50),
      works.slice(50, 100),
      works.slice(100),
    ]);
  });
});

describe("toZoteroMapping: the docs/07 §6.2 extra line and tag (P2-T11)", () => {
  const preWork = workOf(
    synthetic({
      source: "biorxiv",
      nativeId: "p",
      type: "preprint",
      title: "Preprint",
      year: 2024,
      ids: { doi: doi("10.1101/2024.04.04.000004") },
      related: { doi: doi("10.5555/rh-p2t11.mapped") },
    }),
  );
  const pubWork = workOf(
    synthetic({
      source: "crossref",
      nativeId: "q",
      title: "Published",
      year: 2025,
      ids: { doi: doi("10.5555/rh-p2t11.mapped") },
      related: { doi: doi("10.1101/2024.04.04.000004") },
    }),
  );
  const extraLines = (work: CanonicalWork, types?: readonly WorkType[]) =>
    parseExtra(
      String(
        toZoteroMapping(work, {
          accessedAtEpochMs: AT,
          ...(types !== undefined && { importedVersionTypes: types }),
        }).itemJSON.extra ?? "",
      ),
    );
  const line = (
    work: CanonicalWork,
    key: string,
    types?: readonly WorkType[],
  ) => extraLines(work, types).find((l) => l.key === key)?.value;
  const tags = (work: CanonicalWork, types?: readonly WorkType[]) =>
    toZoteroMapping(work, {
      accessedAtEpochMs: AT,
      ...(types !== undefined && { importedVersionTypes: types }),
    }).itemJSON.tags.map((t) => t.tag);

  it("declares the tag once: the stage re-exports the mapper's constant", () => {
    expect(SUPERSEDED_BY_PUBLISHED_TAG).toBe(
      "research_helper/superseded-by-published",
    );
    expect(STAGES_TAG).toBe(SUPERSEDED_BY_PUBLISHED_TAG);
  });

  it("only the preprint imported: 'Published DOI:' in extra, and the superseded tag", () => {
    expect(line(preWork, VERSION_DOI_EXTRA_KEY.published)).toBe(
      "10.5555/rh-p2t11.mapped",
    );
    expect(line(preWork, VERSION_DOI_EXTRA_KEY.preprint)).toBeUndefined();
    expect(tags(preWork)).toContain(SUPERSEDED_BY_PUBLISHED_TAG);
  });

  it("only the published version imported: 'Preprint DOI:' in extra, no superseded tag", () => {
    expect(line(pubWork, VERSION_DOI_EXTRA_KEY.preprint)).toBe(
      "10.1101/2024.04.04.000004",
    );
    expect(line(pubWork, VERSION_DOI_EXTRA_KEY.published)).toBeUndefined();
    expect(tags(pubWork)).not.toContain(SUPERSEDED_BY_PUBLISHED_TAG);
  });

  it("both imported: no extra line on either; the preprint is tagged", () => {
    expect(
      line(preWork, VERSION_DOI_EXTRA_KEY.published, ["journal-article"]),
    ).toBeUndefined();
    expect(
      line(pubWork, VERSION_DOI_EXTRA_KEY.preprint, ["preprint"]),
    ).toBeUndefined();
    expect(tags(preWork, ["journal-article"])).toContain(
      SUPERSEDED_BY_PUBLISHED_TAG,
    );
    expect(tags(pubWork, ["preprint"])).not.toContain(
      SUPERSEDED_BY_PUBLISHED_TAG,
    );
  });

  it("a preprint imported beside another preprint only is not tagged", () => {
    expect(tags(preWork, ["preprint"])).not.toContain(
      SUPERSEDED_BY_PUBLISHED_TAG,
    );
  });

  it("a work with no known version gets neither line nor tag", () => {
    const plain = workOf(
      synthetic({
        source: "biorxiv",
        nativeId: "z",
        type: "preprint",
        title: "Unpublished preprint",
        year: 2025,
        ids: { doi: doi("10.1101/2025.05.05.000005") },
      }),
    );
    expect(line(plain, VERSION_DOI_EXTRA_KEY.published)).toBeUndefined();
    expect(tags(plain)).not.toContain(SUPERSEDED_BY_PUBLISHED_TAG);
  });
});

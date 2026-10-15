import { describe, expect, it } from "vitest";

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
} from "../../../src/model/ids";
import * as dedupe from "../../../src/sources/shared/dedupe";
import {
  BIORXIV_ACCESSION_PREFIXES,
  detectServer,
  PREPRINT_DOI_PREFIX_SERVERS,
  PREPRINT_DOI_PREFIXES,
} from "../../../src/sources/shared/preprintServers";
import { parseExtra } from "../../../src/zotero/extraField";
import {
  AUTOMATIC_TAG_TYPE,
  canonicalWorkFromSnapshot,
  NATIVE_ID_FIELDS_PRESENT,
  PREPRINT_GENRE,
  RESEARCH_HELPER_TAG,
  toZoteroItemJSON,
  UNCERTAIN_TYPE_TAG,
  type ZoteroItemJSON,
} from "../../../src/zotero/itemMapper";

/**
 * `P2-T08`: `docs/07` §6.2's `preprint` column, `docs/02` §11.2's server
 * attribution, and `docs/10` FR-7 scenario 3's uncertain-type default.
 * Layer 1 (`docs/13` §2.1), plain Node. That Zotero accepts the JSON and
 * reads the fields back is `test/integration/zotero/preprintRoundTrip.spec.ts`.
 */

function must<T>(value: T | null): T {
  if (value === null) throw new Error("test fixtures must normalize");
  return value;
}

/** 2026-03-07T04:05:06.789Z — fixed, so `accessDate` is exact. */
const AT = Date.UTC(2026, 2, 7, 4, 5, 6, 789);

const ARXIV_ID = must(normalizeArxivId("2609.04658"));
const ARXIV_DOI = must(normalizeDoi("10.48550/arXiv.2609.04658"));
const BIORXIV_DOI = must(normalizeDoi("10.64898/2026.08.20.745440"));
const MEDRXIV_DOI = must(normalizeDoi("10.64898/2026.09.03.26361736"));
const PMID = must(normalizePmid("41234567"));
const PMCID = must(normalizePmcid("PMC12345678"));

/** What the arXiv mapper produces for `http://arxiv.org/abs/2609.04658v1`. */
const ARXIV_WORK: CanonicalWork = {
  workKey: `doi:${ARXIV_DOI}`,
  ids: { doi: ARXIV_DOI, arxivId: ARXIV_ID },
  type: "preprint",
  title: "An arXiv e-print",
  authors: [{ family: "Kim", given: "Minji" }],
  containerTitle: "arXiv",
  publishedDate: { year: 2026, month: 9, day: 4, iso: "2026-09-04" },
  language: "en",
  provenance: {
    recordIds: ["arxiv:2609.04658v1"],
    fieldOrigin: {},
    seenIn: ["arxiv"],
  },
  normalizedAtEpochMs: AT,
};

/**
 * A bioRxiv preprint as Europe PMC returns it (`PPR`, publisher bioRxiv),
 * carrying a PMID and a PMCID — and, to prove the preprint column ignores
 * them, every journal-shaped field a careless merge could leave behind.
 */
const BIORXIV_WORK: CanonicalWork = {
  workKey: `doi:${BIORXIV_DOI}`,
  ids: { doi: BIORXIV_DOI, pmid: PMID, pmcid: PMCID },
  type: "preprint",
  title: "A bioRxiv preprint",
  authors: [{ family: "Lee", given: "Jun" }],
  containerTitle: "bioRxiv",
  containerAbbreviation: "bioRxiv",
  publisher: "bioRxiv",
  volume: "1",
  issue: "2",
  pages: "3-4",
  issn: ["1234-5678", "8765-4321"],
  publishedDate: { year: 2026, month: 8, day: 20, iso: "2026-08-20" },
  provenance: {
    recordIds: ["europepmc:PPR/PPR1000001"],
    fieldOrigin: {},
    seenIn: ["europepmc", "biorxiv"],
  },
  normalizedAtEpochMs: AT,
};

function map(work: CanonicalWork, existingExtra?: string): ZoteroItemJSON {
  return toZoteroItemJSON(work, {
    accessedAtEpochMs: AT,
    // The shipped baseline: both fields exist on journalArticle. A preprint
    // must ignore this answer, so it is passed explicitly.
    nativeIdentifierFields: NATIVE_ID_FIELDS_PRESENT,
    ...(existingExtra === undefined ? {} : { existingExtra }),
  });
}

function extraLines(json: ZoteroItemJSON): readonly string[] {
  return String(json["extra"] ?? "").split("\n");
}

// ---------------------------------------------------------------------------

describe("detectServer — the publisher/server field names the server (docs/02 §11.2)", () => {
  it("returns medRxiv for a 10.64898/ DOI whose publisher field says medRxiv", () => {
    expect(
      detectServer({ serverFields: ["medRxiv"], doi: MEDRXIV_DOI })?.server,
    ).toBe("medRxiv");
  });

  it("returns bioRxiv for a 10.64898/ DOI whose publisher field says bioRxiv", () => {
    expect(
      detectServer({ serverFields: ["bioRxiv"], doi: BIORXIV_DOI })?.server,
    ).toBe("bioRxiv");
  });

  it("never names a server from the DOI prefix alone", () => {
    for (const doi of [BIORXIV_DOI, ARXIV_DOI, "10.21203/rs.3.rs-1/v1"]) {
      expect(detectServer({ serverFields: [], doi })).toBeUndefined();
      expect(
        detectServer({ serverFields: [undefined, "openRxiv"], doi }),
      ).toBeUndefined();
    }
  });

  it("lets the field win over a disagreeing prefix, and reports the disagreement", () => {
    expect(detectServer({ serverFields: ["bioRxiv"], doi: ARXIV_DOI })).toEqual(
      { server: "bioRxiv", doiCorroborates: false },
    );
    expect(
      detectServer({ serverFields: ["medRxiv"], doi: MEDRXIV_DOI }),
    ).toEqual({ server: "medRxiv", doiCorroborates: true });
    expect(detectServer({ serverFields: ["SSRN"] })).toEqual({
      server: "SSRN",
      doiCorroborates: undefined,
    });
  });

  it("reads the fields in order, case-insensitively, skipping blanks and organisations", () => {
    expect(
      detectServer({ serverFields: ["", "  MEDRXIV "], doi: MEDRXIV_DOI })
        ?.server,
    ).toBe("medRxiv");
    expect(
      detectServer({ serverFields: ["openRxiv", "bioRxiv"] })?.server,
    ).toBe("bioRxiv");
    expect(detectServer({ serverFields: ["arXiv.org"] })?.server).toBe("arXiv");
    expect(detectServer({ serverFields: ["research square"] })?.server).toBe(
      "Research Square",
    );
  });
});

describe("the preprint DOI prefix set — one declaration (docs/02 §11.2)", () => {
  it("is docs/02 §11.2's five prefixes, each attributed to a server", () => {
    expect([...PREPRINT_DOI_PREFIXES].sort()).toEqual(
      ["10.1101/", "10.2139/", "10.21203/", "10.48550/", "10.64898/"].sort(),
    );
    for (const prefix of PREPRINT_DOI_PREFIXES) {
      expect(PREPRINT_DOI_PREFIX_SERVERS.get(prefix)?.length).toBeGreaterThan(
        0,
      );
    }
    expect([...BIORXIV_ACCESSION_PREFIXES].sort()).toEqual([
      "10.1101/",
      "10.64898/",
    ]);
  });

  it("is the very object dedupe.ts exports, not a second copy", () => {
    expect(dedupe.PREPRINT_DOI_PREFIXES).toBe(PREPRINT_DOI_PREFIXES);
    expect(dedupe.BIORXIV_ACCESSION_PREFIXES).toBe(BIORXIV_ACCESSION_PREFIXES);
  });
});

describe("an arXiv record → a Zotero preprint (docs/07 §6.2's preprint column)", () => {
  const json = map(ARXIV_WORK);

  it("emits item type preprint", () => {
    expect(json["itemType"]).toBe("preprint");
  });

  it('sets repository to "arXiv"', () => {
    expect(json["repository"]).toBe("arXiv");
  });

  it("sets archiveID to arXiv:<id><version>, the version from the arXiv record", () => {
    expect(json["archiveID"]).toBe("arXiv:2609.04658v1");
  });

  it('sets genre to "Preprint" (docs/02 §10.3)', () => {
    expect(json["genre"]).toBe(PREPRINT_GENRE);
    expect(PREPRINT_GENRE).toBe("Preprint");
  });

  it("writes no arXiv: line and no rh-work-type line in extra", () => {
    const keys = parseExtra(String(json["extra"] ?? "")).map((l) =>
      l.key?.toLowerCase(),
    );
    expect(keys).not.toContain("arxiv");
    expect(keys).not.toContain("rh-work-type");
    expect(keys).toContain("rh-work-key");
  });

  it("writes archiveID without a version when no arXiv record contributed", () => {
    const fromS2: CanonicalWork = {
      ...ARXIV_WORK,
      provenance: {
        recordIds: ["semanticscholar:abc"],
        fieldOrigin: {},
        seenIn: ["semanticscholar"],
      },
    };
    expect(map(fromS2)["archiveID"]).toBe("arXiv:2609.04658");
  });

  it("takes the version only from the arXiv record whose id matches", () => {
    const other: CanonicalWork = {
      ...ARXIV_WORK,
      provenance: {
        recordIds: ["arxiv:2501.00001v7", "arxiv:2609.04658v3"],
        fieldOrigin: {},
        seenIn: ["arxiv"],
      },
    };
    expect(map(other)["archiveID"]).toBe("arXiv:2609.04658v3");
  });

  // Owner, 2026-10-15 (`plan/00` §6 item 188): bioRxiv and medRxiv get the
  // DOI suffix, the stable accession of `docs/02` §11.2.
  it("writes a bioRxiv preprint's DOI suffix as archiveID", () => {
    expect(map(BIORXIV_WORK)["archiveID"]).toBe("2026.08.20.745440");
  });

  it("writes a medRxiv preprint's DOI suffix as archiveID, the field naming the server", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      ids: { doi: MEDRXIV_DOI },
      containerTitle: "medRxiv",
      publisher: "medRxiv",
    };
    expect(map(work)["archiveID"]).toBe(MEDRXIV_DOI.slice("10.64898/".length));
  });

  it("writes no archiveID when no field names bioRxiv or medRxiv, whatever the prefix", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      containerTitle: "openRxiv",
      publisher: "openRxiv",
    };
    expect(Object.hasOwn(map(work), "archiveID")).toBe(false);
  });

  it("writes no archiveID for a bioRxiv-named preprint whose DOI is not a bioRxiv DOI", () => {
    const work: CanonicalWork = { ...BIORXIV_WORK, ids: { doi: ARXIV_DOI } };
    expect(Object.hasOwn(map(work), "archiveID")).toBe(false);
  });
});

describe("a bioRxiv record with a PMID → PMID: in extra, no native field (docs/07 §6.1)", () => {
  const json = map(BIORXIV_WORK);

  it("writes PMID: and PMCID: lines into extra", () => {
    const lines = extraLines(json);
    expect(lines).toContain(`PMID: ${PMID}`);
    expect(lines).toContain(`PMCID: ${PMCID}`);
  });

  it("leaves no PMID or PMCID native field, whatever the journalArticle detection says", () => {
    expect(Object.hasOwn(json, "PMID")).toBe(false);
    expect(Object.hasOwn(json, "PMCID")).toBe(false);
  });

  it("writes no ISSN, no rh-issn, and none of the journal-shaped fields", () => {
    for (const absent of [
      "ISSN",
      "publicationTitle",
      "journalAbbreviation",
      "publisher",
      "volume",
      "issue",
      "pages",
    ]) {
      expect(Object.hasOwn(json, absent)).toBe(false);
    }
    expect(String(json["extra"])).not.toContain("rh-issn");
    expect(String(json["extra"])).not.toMatch(/(^|\n)ISSN\s*:/);
  });

  it("puts the server in repository and keeps the DOI", () => {
    expect(json["repository"]).toBe("bioRxiv");
    expect(json["DOI"]).toBe(BIORXIV_DOI);
    expect(json["genre"]).toBe("Preprint");
  });

  it("does not add a PMID: line when one already exists (§6.3)", () => {
    const out = map(BIORXIV_WORK, "PMID: 999");
    const pmidLines = extraLines(out).filter((l) => /^pmid\s*:/i.test(l));
    expect(pmidLines).toEqual(["PMID: 999"]);
  });
});

describe("repository — the server field, never the DOI prefix", () => {
  it("names medRxiv for a 10.64898/ preprint whose field says medRxiv", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      ids: { doi: MEDRXIV_DOI },
      containerTitle: "medRxiv",
      publisher: "medRxiv",
    };
    expect(map(work)["repository"]).toBe("medRxiv");
  });

  it("follows the field when the DOI prefix belongs to another server", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      ids: { doi: ARXIV_DOI },
    };
    expect(map(work)["repository"]).toBe("bioRxiv");
  });

  it("writes the canonical spelling for a recognised alias", () => {
    const work: CanonicalWork = { ...ARXIV_WORK, containerTitle: "arXiv.org" };
    expect(map(work)["repository"]).toBe("arXiv");
  });

  it("keeps containerTitle verbatim when no field names a known server", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      containerTitle: "openRxiv",
      publisher: "openRxiv",
    };
    expect(map(work)["repository"]).toBe("openRxiv");
  });

  it("finds the server in publisher when containerTitle does not name one", () => {
    const work: CanonicalWork = {
      ...BIORXIV_WORK,
      containerTitle: "Cold Spring Harbor Laboratory",
      publisher: "medRxiv",
    };
    expect(map(work)["repository"]).toBe("medRxiv");
  });
});

describe("foreign extra lines survive a preprint write byte-for-byte (§6.3)", () => {
  it("keeps Better BibTeX's Citation Key and every other foreign line, in order", () => {
    const existing =
      "Citation Key: smith2024\r\nnot a key-value line\n\nOriginal Date: 2025";
    const extra = String(map(BIORXIV_WORK, existing)["extra"]);
    expect(extra.startsWith(`${existing}\n`)).toBe(true);
    const lines = extra.split("\n");
    expect(lines.slice(0, 4)).toEqual(existing.split("\n"));
  });
});

describe("an undeterminable type → journalArticle + research_helper/uncertain-type (FR-7 scenario 3)", () => {
  const other: CanonicalWork = { ...BIORXIV_WORK, type: "other" };
  const json = map(other);

  it("imports as journalArticle", () => {
    expect(json["itemType"]).toBe("journalArticle");
  });

  it("carries the uncertain-type tag, automatic, beside the run tag", () => {
    const tags = json.tags;
    expect(UNCERTAIN_TYPE_TAG).toBe("research_helper/uncertain-type");
    expect(tags).toContainEqual({
      tag: UNCERTAIN_TYPE_TAG,
      type: AUTOMATIC_TAG_TYPE,
    });
    expect(tags.map((t) => t.tag)).toContain(RESEARCH_HELPER_TAG);
  });

  it("does not tag a determined type", () => {
    for (const type of ["journal-article", "review", "preprint"] as const) {
      const names = map({ ...BIORXIV_WORK, type }).tags.map((t) => t.tag);
      expect(names).not.toContain(UNCERTAIN_TYPE_TAG);
    }
  });

  it("still records rh-work-type: other, and reads back as type other without a keyword", () => {
    expect(extraLines(json)).toContain("rh-work-type: other");
    const back = canonicalWorkFromSnapshot(
      {
        itemType: "journalArticle",
        fields: { title: other.title, extra: String(json["extra"]) },
        dateMultipart: "",
        creators: [],
        tags: json.tags.map((t) => t.tag),
      },
      { nowEpochMs: AT },
    );
    expect(back.type).toBe("other");
    expect(back.keywords ?? []).not.toContain(UNCERTAIN_TYPE_TAG);
  });
});

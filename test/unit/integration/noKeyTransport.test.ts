/**
 * `P5-T28`: what `test/integration/support/noKeyTransport.ts` answers, over the committed
 * fixtures. The spec that uses it runs only in Zotero, so this is where a mistaken route
 * shows without one. Nothing is fetched, and a hand-written answer proves nothing about a
 * service: these tests are about the double.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { nodeFixtureIo } from "../../support/fixtureIoNode";
import {
  createNoKeyDouble,
  loadNoKeyRecordings,
  NO_KEY_FORBIDDEN_HOST,
  NO_KEY_SEED_DOI,
  noKeyPaper,
  titleKey,
  type NoKeyRecordings,
} from "../../integration/support/noKeyTransport";
import {
  CROSSREF_NON_BIOMEDICAL_REFERENCE_DOIS,
  recordedCrossrefDoiLookupRequest,
  recordedCrossrefWorkRequest,
} from "../../support/crossrefRecordedRequests";

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);
const EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CROSSREF = "https://api.crossref.org/works";

function recordedBody(dir: string, scenario: string): string {
  const folder = resolve(FIXTURES, dir);
  for (const name of readdirSync(folder)) {
    if (!name.endsWith("_meta.json")) continue;
    const meta = JSON.parse(readFileSync(resolve(folder, name), "utf8")) as {
      scenario?: string;
    };
    if (meta.scenario !== scenario) continue;
    const exchange = JSON.parse(
      readFileSync(
        resolve(folder, name.replace("_meta.json", ".json")),
        "utf8",
      ),
    ) as { body: string };
    return exchange.body;
  }
  throw new Error(`no ${dir} fixture for scenario "${scenario}"`);
}

let recordings: NoKeyRecordings;

beforeAll(async () => {
  recordings = await loadNoKeyRecordings(
    {
      pubmed: resolve(FIXTURES, "pubmed"),
      europepmc: resolve(FIXTURES, "europepmc"),
      europepmcRelated: resolve(FIXTURES, "europepmc/related"),
      crossref: resolve(FIXTURES, "crossref"),
      crossrefRelated: resolve(FIXTURES, "crossref/related"),
      arxiv: resolve(FIXTURES, "arxiv"),
    },
    nodeFixtureIo,
  );
});

function epmcSearch(query: string, cursorMark = "*"): string {
  return (
    `${EUROPE_PMC}/search?query=${encodeURIComponent(query)}` +
    `&cursorMark=${encodeURIComponent(cursorMark)}`
  );
}

describe("why two answers are hand-written", () => {
  it("no neighbour in the recorded elink answer is in a recorded efetch answer", () => {
    const elink = JSON.parse(
      recordedBody("pubmed/related", "elink-two-seeds"),
    ) as {
      linksets: {
        linksetdbs: { links: { id: string }[] }[];
      }[];
    };
    const neighbours = elink.linksets.flatMap((set) =>
      set.linksetdbs.flatMap((db) => db.links.map((link) => link.id)),
    );
    expect(neighbours.length).toBeGreaterThan(0);
    const fetched = new Set([
      ...recordings.similarPmids,
      ...recordings.keywordPmids,
    ]);
    expect(neighbours.filter((id) => fetched.has(id))).toEqual([]);
  });

  it("no Crossref row without an abstract has one in the recorded Europe PMC page", () => {
    const page = JSON.parse(recordings.epmcKeyword.body) as {
      resultList: { result: { doi?: string; abstractText?: string }[] };
    };
    const held = new Set(
      page.resultList.result
        .filter((row) => row.abstractText !== undefined)
        .map((row) => (row.doi ?? "").toLowerCase()),
    );
    expect(recordings.withoutAbstract.length).toBeGreaterThan(0);
    expect(recordings.withoutAbstract.filter((w) => held.has(w.doi))).toEqual(
      [],
    );
  });
});

describe("what the double refuses", () => {
  it("refuses Semantic Scholar and keeps the URL, whatever the path", () => {
    const double = createNoKeyDouble(recordings);
    const url = `https://${NO_KEY_FORBIDDEN_HOST}/graph/v1/paper/batch`;
    expect(() => double.answer({ method: "POST", url })).toThrow(
      NO_KEY_FORBIDDEN_HOST,
    );
    expect(double.refused.map((entry) => entry.url)).toEqual([url]);
    expect(double.calls).toEqual([]);
  });

  it.each([
    ["an unknown host", "https://example.invalid/x"],
    [
      "the PMC converter",
      "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/",
    ],
    ["bioRxiv", "https://api.biorxiv.org/details/biorxiv/10.1101/x"],
    ["a PMID no efetch answer holds", `${EUTILS}/efetch.fcgi?db=pubmed&id=1`],
    ["a Crossref work not recorded", `${CROSSREF}/10.5555/none`],
  ])("refuses %s", (_what, url) => {
    const double = createNoKeyDouble(recordings);
    expect(() => double.answer({ method: "GET", url })).toThrow(
      "no-key double",
    );
    expect(double.refused).toHaveLength(1);
  });
});

describe("what the double answers", () => {
  it("makes elink name one recorded efetch answer's PMIDs, one linkset per seed, labelled", () => {
    const double = createNoKeyDouble(recordings);
    const answer = double.answer({
      method: "GET",
      url: `${EUTILS}/elink.fcgi?dbfrom=pubmed&db=pubmed&id=1&id=2`,
    });
    expect(answer.origin).toBe("hand-written");
    const parsed = JSON.parse(answer.body) as {
      linksets: {
        ids: string[];
        linksetdbs: { links: { id: string; score: number }[] }[];
      }[];
    };
    expect(parsed.linksets.map((set) => set.ids)).toEqual([["1"], ["2"]]);
    expect(
      parsed.linksets[0]?.linksetdbs[0]?.links.map((link) => link.id),
    ).toEqual(recordings.similarPmids);
    expect(recordings.similarPmids).toHaveLength(20);
  });

  it("answers efetch by the PMIDs asked, in the URL or a form body", () => {
    const double = createNoKeyDouble(recordings);
    const similar = recordings.similarPmids.slice(0, 2).join(",");
    const keyword = recordings.keywordPmids.slice(0, 2).join(",");
    expect(
      double.answer({
        method: "GET",
        url: `${EUTILS}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(similar)}`,
      }).route,
    ).toBe("pubmed-efetch-similar");
    expect(
      double.answer({
        method: "POST",
        url: `${EUTILS}/efetch.fcgi`,
        body: `db=pubmed&id=${encodeURIComponent(keyword)}`,
      }).route,
    ).toBe("pubmed-efetch-keyword");
  });

  it("gives a second esearch page and a DOI asked of PubMed the recorded empty answer", () => {
    const double = createNoKeyDouble(recordings);
    const first = double.answer({
      method: "GET",
      url: `${EUTILS}/esearch.fcgi?db=pubmed&term=x`,
    });
    expect(first.body).toBe(recordings.esearch.body);
    for (const query of ["term=x&retstart=10", "term=10.1%2Fx%5Bdoi%5D"]) {
      expect(
        double.answer({
          method: "GET",
          url: `${EUTILS}/esearch.fcgi?db=pubmed&${query}`,
        }).body,
      ).toBe(recordings.esearchEmpty.body);
    }
  });

  it("tells Europe PMC's five kinds of request apart", () => {
    const double = createNoKeyDouble(recordings);
    const route = (url: string, body?: string): string =>
      double.answer({
        method: body === undefined ? "GET" : "POST",
        url,
        ...(body !== undefined && { body }),
      }).route;
    expect(route(`${EUROPE_PMC}/MED/1/citations?page=1`)).toBe(
      "europepmc-citations",
    );
    expect(route(`${EUROPE_PMC}/MED/1/references?page=1`)).toBe(
      "europepmc-references",
    );
    expect(route(epmcSearch('(AUTH:"Watched B") AND x'))).toBe(
      "europepmc-author-watch",
    );
    expect(route(epmcSearch('"base editing"'))).toBe("europepmc-keyword");
    expect(
      route(
        `${EUROPE_PMC}/searchPOST`,
        `query=${encodeURIComponent('DOI:"10.5555/none"')}`,
      ),
    ).toBe("europepmc-doi-lookup");
  });

  it("gives a later cursor nothing, so a paging adapter stops", () => {
    const double = createNoKeyDouble(recordings);
    expect(
      double.answer({ method: "GET", url: epmcSearch('"x"', "AoIIQ") }).body,
    ).toBe(recordings.epmcEmpty.body);
    expect(
      double.answer({
        method: "GET",
        url: `${CROSSREF}?query.bibliographic=x&cursor=AoJ`,
      }).body,
    ).toBe(recordings.crossrefEmpty.body);
    expect(
      double.answer({
        method: "GET",
        url: "https://export.arxiv.org/api/query?search_query=x&start=20",
      }).body,
    ).toBe(recordings.arxivEmpty.body);
  });

  it("hand-writes an abstract only for a Crossref row that lacks one, and says it did", () => {
    const double = createNoKeyDouble(recordings);
    const [wanted] = recordings.withoutAbstract;
    if (wanted === undefined) throw new Error("no such row is recorded");

    const unknown = double.answer({
      method: "GET",
      url: epmcSearch('DOI:"10.5555/none"'),
    });
    expect(unknown.origin).toBe("recorded-body");
    expect(unknown.body).toBe(recordings.epmcEmpty.body);
    expect(double.filledIn(wanted.doi)).toBe(false);

    const filled = double.answer({
      method: "GET",
      url: epmcSearch(`DOI:"${wanted.doi}" OR DOI:"10.5555/none"`),
    });
    expect(filled.origin).toBe("hand-written");
    const parsed = JSON.parse(filled.body) as {
      resultList: {
        result: { doi: string; title: string; abstractText: string }[];
      };
    };
    expect(parsed.resultList.result.map((row) => row.doi)).toEqual([
      wanted.doi,
    ]);
    expect(parsed.resultList.result[0]?.title).toBe(wanted.title);
    expect(parsed.resultList.result[0]?.abstractText).toContain("hand-written");
    expect(double.filledIn(wanted.doi.toUpperCase())).toBe(true);
  });

  it("recognises the very request Crossref's fixtures were recorded for", () => {
    const double = createNoKeyDouble(recordings);
    const work = recordedCrossrefWorkRequest(NO_KEY_SEED_DOI);
    expect(double.answer(work)).toMatchObject({
      route: "crossref-work",
      origin: "recorded",
    });
    const lookup = recordedCrossrefDoiLookupRequest();
    expect(double.answer(lookup)).toMatchObject({
      route: "crossref-doi-lookup",
      origin: "recorded",
    });
    expect(recordings.referenceDois.size).toBe(
      CROSSREF_NON_BIOMEDICAL_REFERENCE_DOIS.length,
    );
  });

  it("gives a DOI lookup outside the recorded set the recorded empty page", () => {
    const double = createNoKeyDouble(recordings);
    const answer = double.answer({
      method: "GET",
      url: `${CROSSREF}?filter=${encodeURIComponent("doi:10.5555/none")}`,
    });
    expect(answer.route).toBe("crossref-doi-lookup");
    expect(answer.body).toBe(recordings.crossrefEmpty.body);
  });

  it("forgets its calls when asked, and keeps what it refused", () => {
    const double = createNoKeyDouble(recordings);
    double.answer({ method: "GET", url: `${EUROPE_PMC}/MED/1/citations` });
    expect(() =>
      double.answer({ method: "GET", url: "https://example.invalid/" }),
    ).toThrow();
    double.clearCalls();
    expect(double.calls).toEqual([]);
    expect(double.refused).toHaveLength(1);
  });
});

describe("the spec's own data", () => {
  it("reads every list's titles from its recorded body", () => {
    const { titles } = recordings;
    expect(titles.pmra.size).toBe(20);
    for (const list of [
      titles.epmcCitations,
      titles.epmcReferences,
      titles.crossrefReferences,
      titles.epmcKeyword,
      titles.epmcAuthorWatch,
    ]) {
      expect(list.size).toBeGreaterThan(0);
      expect(list.has("")).toBe(false);
    }
  });

  it("names 30 papers with distinct ids that no recorded answer can hold", () => {
    const papers = Array.from({ length: 30 }, (_unused, at) =>
      noKeyPaper(at, "qztoken"),
    );
    expect(new Set(papers.map((paper) => paper.doi)).size).toBe(30);
    expect(new Set(papers.map((paper) => paper.pmid)).size).toBe(30);
    expect(new Set(papers.map((paper) => paper.title)).size).toBe(30);
    for (const paper of papers) {
      expect(paper.title).not.toContain("qztoken");
      expect(recordings.similarPmids).not.toContain(paper.pmid);
      expect(recordings.keywordPmids).not.toContain(paper.pmid);
    }
  });

  it("compares titles without their case, punctuation or markup", () => {
    expect(titleKey("<i>Drosophila</i> Using: CRISPR-Cas9.")).toBe(
      titleKey("drosophila using crispr cas9"),
    );
  });
});

/**
 * `P5-T28`: what answers every request of the keyless run in
 * `test/integration/pipeline/noKeyRelatedness.spec.ts`, its one product caller. That
 * spec builds it with {@link loadNoKeyRecordings} and {@link createNoKeyDouble} and
 * puts it behind `Zotero.HTTP.request`. `test/unit/integration/noKeyTransport.test.ts`
 * builds the same pair in Node over the same committed files.
 *
 * **Not evidence about any service.** A recorded body here is real, and almost none of
 * them was recorded for the request it answers: {@link NoKeyAnswer.origin} says which
 * did. Hand-written answers are labelled `hand-written`. Two have to be, because no
 * recording can do their job: no neighbour in the recorded `elink` answer is in any
 * recorded `efetch` answer, and no recorded Crossref row without an abstract has its
 * abstract in a recorded Europe PMC answer (both measured on 2026-11-06; `plan/08`'s
 * note on `P5-T28`). This file proves what the pipelines do with such answers, and
 * nothing about what the services would send.
 *
 * A request nothing here expects is refused, as a request to Semantic Scholar is, and
 * the spec fails on {@link NoKeyDouble.refused}. Platform-free: no `Zotero`, no `IOUtils`.
 */

import {
  fixtureKey,
  listFixtureMeta,
  type FixtureIo,
  type RecordedExchange,
} from "../../support/fixtureReplay";

/** The host the card asks for zero requests to (`plan/08`, `P5-T28`). */
export const NO_KEY_FORBIDDEN_HOST = "api.semanticscholar.org";

/** The recorded Crossref seed: a real DOI, and the one half of the spec's seed. */
export const NO_KEY_SEED_DOI = "10.1007/s11263-015-0816-y";

/** The recorded Europe PMC seed: a real PMID, a different paper from the DOI. */
export const NO_KEY_SEED_PMID = "37258680";

/** Where each committed fixture directory is on this platform. */
export interface NoKeyFixtureDirs {
  readonly pubmed: string;
  readonly europepmc: string;
  readonly europepmcRelated: string;
  readonly crossref: string;
  readonly crossrefRelated: string;
  readonly arxiv: string;
}

/** One committed exchange, with the key that names its file. */
interface LoadedExchange {
  readonly key: string;
  readonly body: string;
  readonly status: number;
}

/** A work the spec looks for in a finished list. */
export interface NoKeyWork {
  readonly doi: string;
  readonly title: string;
}

/** Every committed body the double answers from, and what the spec looks for in them. */
export interface NoKeyRecordings {
  readonly esearch: LoadedExchange;
  readonly esearchEmpty: LoadedExchange;
  readonly efetchSimilar: LoadedExchange;
  readonly efetchKeyword: LoadedExchange;
  readonly epmcCitations: LoadedExchange;
  readonly epmcReferences: LoadedExchange;
  readonly epmcKeyword: LoadedExchange;
  readonly epmcAuthorWatch: LoadedExchange;
  readonly epmcEmpty: LoadedExchange;
  readonly crossrefWork: LoadedExchange;
  readonly crossrefLookup: LoadedExchange;
  readonly crossrefKeyword: LoadedExchange;
  readonly crossrefEmpty: LoadedExchange;
  readonly arxivKeyword: LoadedExchange;
  readonly arxivEmpty: LoadedExchange;
  /** PMIDs in {@link NoKeyRecordings.efetchSimilar}: what `elink` is made to name. */
  readonly similarPmids: readonly string[];
  /** PMIDs in {@link NoKeyRecordings.efetchKeyword}. */
  readonly keywordPmids: readonly string[];
  /** The DOIs Crossref's recorded lookup answers for (lower case). */
  readonly referenceDois: ReadonlySet<string>;
  /** Journal articles in the Crossref keyword page with no abstract of their own. */
  readonly withoutAbstract: readonly NoKeyWork[];
  /** {@link titleKey}s per recorded list, to say which list a row came from. */
  readonly titles: {
    readonly pmra: ReadonlySet<string>;
    readonly epmcCitations: ReadonlySet<string>;
    readonly epmcReferences: ReadonlySet<string>;
    readonly crossrefReferences: ReadonlySet<string>;
    readonly epmcKeyword: ReadonlySet<string>;
    readonly epmcAuthorWatch: ReadonlySet<string>;
  };
}

/** What a request was, in the words a failure message needs. */
export type NoKeyRoute =
  | "pubmed-elink"
  | "pubmed-esearch"
  | "pubmed-efetch-similar"
  | "pubmed-efetch-keyword"
  | "europepmc-citations"
  | "europepmc-references"
  | "europepmc-doi-lookup"
  | "europepmc-author-watch"
  | "europepmc-keyword"
  | "crossref-work"
  | "crossref-doi-lookup"
  | "crossref-keyword"
  | "arxiv-keyword";

/**
 * - `recorded`: this very request was recorded (its `fixtureKey` names the file).
 * - `recorded-body`: a real body, answering a request it was not recorded for.
 * - `hand-written`: written in this file; says nothing about any service.
 */
export type NoKeyOrigin = "recorded" | "recorded-body" | "hand-written";

/** One answered request. */
export interface NoKeyAnswer {
  readonly route: NoKeyRoute;
  readonly origin: NoKeyOrigin;
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
}

/** One request as the transport sees it. */
export interface NoKeyRequest {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
}

/** One request and what happened to it. */
export interface NoKeyCall {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
  readonly route: NoKeyRoute;
  readonly origin: NoKeyOrigin;
}

/** One request the double would not answer. */
export interface NoKeyRefusal {
  readonly method: string;
  readonly url: string;
  readonly reason: string;
}

/** {@link createNoKeyDouble}'s result. */
export interface NoKeyDouble {
  /**
   * Answer one request, or refuse it.
   *
   * @throws Error for a request it refuses, after adding it to {@link NoKeyDouble.refused}
   */
  answer(request: NoKeyRequest): NoKeyAnswer;
  readonly calls: readonly NoKeyCall[];
  readonly refused: readonly NoKeyRefusal[];
  /** Whether this DOI was answered with a hand-written abstract. */
  filledIn(doi: string): boolean;
  /** Forget the calls so far, between the two features. */
  clearCalls(): void;
}

const JSON_TYPE = "application/json";
const XML_TYPE = "text/xml";
const ATOM_TYPE = "application/atom+xml";

/**
 * A title with its case, punctuation and markup gone: mappers tidy titles, and a list
 * is only being matched against the body it came from.
 *
 * @param title - a title, from a recorded body or a drawn row
 * @returns the letters and digits, lower case
 */
export function titleKey(title: string): string {
  return title
    .replace(/<[^>]+>/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function loadExchange(
  dir: string,
  scenario: string,
  io: FixtureIo,
): Promise<LoadedExchange> {
  const found = (await listFixtureMeta(dir, io)).filter(
    (loaded) => loaded.meta.scenario === scenario,
  );
  const only = found.length === 1 ? found[0] : undefined;
  if (only === undefined) {
    throw new Error(
      `${String(found.length)} fixtures in ${dir} are named "${scenario}"; ` +
        `expected exactly one`,
    );
  }
  const exchange = JSON.parse(
    await io.readText(dir, `${only.key}.json`),
  ) as RecordedExchange;
  return { key: only.key, body: exchange.body, status: exchange.status };
}

function pmidsIn(xml: string): readonly string[] {
  return [
    ...xml.matchAll(
      /<MedlineCitation[^>]*>\s*<PMID Version="\d+">(\d+)<\/PMID>/gu,
    ),
  ].map((match) => match[1] as string);
}

function articleTitlesIn(xml: string): ReadonlySet<string> {
  return new Set(
    [...xml.matchAll(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/gu)].map(
      (match) => titleKey(match[1] as string),
    ),
  );
}

/** One Europe PMC relation row, as far as this file reads it. */
interface RelationRow {
  readonly title?: string;
}

function relationTitles(rows: readonly RelationRow[]): ReadonlySet<string> {
  return new Set(rows.map((row) => titleKey(row.title ?? "")));
}

/** One Crossref row, as far as this file reads it. */
interface CrossrefRow {
  readonly DOI?: string;
  readonly type?: string;
  readonly title?: readonly string[];
  readonly abstract?: string;
}

function crossrefRows(body: string): readonly CrossrefRow[] {
  const { message } = JSON.parse(body) as {
    readonly message: { readonly items: readonly CrossrefRow[] };
  };
  return message.items;
}

/**
 * Read the committed bodies. The caller: `noKeyRelatedness.spec.ts`'s `before`, and
 * `test/unit/integration/noKeyTransport.test.ts`.
 *
 * @param dirs - where the fixture directories are on this platform
 * @param io - how to read them on this platform
 * @returns what {@link createNoKeyDouble} answers from
 * @throws Error when a named scenario is not exactly one committed file
 */
export async function loadNoKeyRecordings(
  dirs: NoKeyFixtureDirs,
  io: FixtureIo,
): Promise<NoKeyRecordings> {
  const load = (dir: string, scenario: string): Promise<LoadedExchange> =>
    loadExchange(dir, scenario, io);
  const [
    esearch,
    esearchEmpty,
    efetchSimilar,
    efetchKeyword,
    epmcCitations,
    epmcReferences,
    epmcKeyword,
    epmcAuthorWatch,
    epmcEmpty,
    crossrefWork,
    crossrefLookup,
    crossrefKeyword,
    crossrefEmpty,
    arxivKeyword,
    arxivEmpty,
  ] = await Promise.all([
    load(dirs.pubmed, "window-esearch"),
    load(dirs.pubmed, "search-empty"),
    load(dirs.pubmed, "search-typical-efetch"),
    load(dirs.pubmed, "window-efetch"),
    load(dirs.europepmcRelated, "citations"),
    load(dirs.europepmcRelated, "references"),
    load(dirs.europepmc, "corpus-q2"),
    load(dirs.europepmc, "corpus-q3"),
    load(dirs.europepmc, "search-empty"),
    load(dirs.crossrefRelated, "work-non-biomedical-seed"),
    load(dirs.crossrefRelated, "lookup-non-biomedical-references"),
    load(dirs.crossref, "corpus-q1"),
    load(dirs.crossref, "search-empty"),
    load(dirs.arxiv, "search-typical"),
    load(dirs.arxiv, "search-empty"),
  ]);
  const looked = crossrefRows(crossrefLookup.body);
  const citations = JSON.parse(epmcCitations.body) as {
    readonly citationList: { readonly citation: readonly RelationRow[] };
  };
  const references = JSON.parse(epmcReferences.body) as {
    readonly referenceList: { readonly reference: readonly RelationRow[] };
  };
  const searchRows = (exchange: LoadedExchange): readonly RelationRow[] =>
    (
      JSON.parse(exchange.body) as {
        readonly resultList: { readonly result: readonly RelationRow[] };
      }
    ).resultList.result;
  return {
    esearch,
    esearchEmpty,
    efetchSimilar,
    efetchKeyword,
    epmcCitations,
    epmcReferences,
    epmcKeyword,
    epmcAuthorWatch,
    epmcEmpty,
    crossrefWork,
    crossrefLookup,
    crossrefKeyword,
    crossrefEmpty,
    arxivKeyword,
    arxivEmpty,
    similarPmids: pmidsIn(efetchSimilar.body),
    keywordPmids: pmidsIn(efetchKeyword.body),
    referenceDois: new Set(looked.map((row) => (row.DOI ?? "").toLowerCase())),
    withoutAbstract: crossrefRows(crossrefKeyword.body)
      .filter(
        (row) =>
          row.type === "journal-article" &&
          row.abstract === undefined &&
          row.DOI !== undefined &&
          (row.title?.[0] ?? "") !== "",
      )
      .map((row) => ({
        doi: (row.DOI as string).toLowerCase(),
        title: (row.title as readonly string[])[0] as string,
      })),
    titles: {
      pmra: articleTitlesIn(efetchSimilar.body),
      epmcCitations: relationTitles(citations.citationList.citation),
      epmcReferences: relationTitles(references.referenceList.reference),
      crossrefReferences: new Set(
        looked.map((row) => titleKey(row.title?.[0] ?? "")),
      ),
      epmcKeyword: relationTitles(searchRows(epmcKeyword)),
      epmcAuthorWatch: relationTitles(searchRows(epmcAuthorWatch)),
    },
  };
}

/** Both query strings of a request: its URL's, and a form POST's. */
function parametersOf(request: NoKeyRequest): URLSearchParams {
  const url = new URL(request.url);
  const merged = new URLSearchParams(url.search);
  if (request.body !== undefined) {
    new URLSearchParams(request.body).forEach((value, name) => {
      merged.append(name, value);
    });
  }
  return merged;
}

/**
 * Hand-written, in the shape of the recorded `elink` answer: every seed's neighbours
 * are the PMIDs of one recorded `efetch` answer, best first. No recording can pair the
 * two. Not evidence about PubMed.
 */
function handWrittenElink(
  seeds: readonly string[],
  neighbours: readonly string[],
): string {
  return JSON.stringify({
    header: { type: "elink", version: "0.3" },
    linksets: seeds.map((seed) => ({
      dbfrom: "pubmed",
      ids: [seed],
      linksetdbs: [
        {
          dbto: "pubmed",
          linkname: "pubmed_pubmed",
          links: neighbours.map((id, at) => ({
            id,
            score: 30_000_000 - at * 100_000,
          })),
        },
      ],
    })),
  });
}

/**
 * Hand-written, in the shape of a recorded Europe PMC core row: the abstract a recorded
 * Crossref row lacks, so a fill-in has something to find. Not evidence about Europe PMC.
 */
function handWrittenFillIn(works: readonly NoKeyWork[]): string {
  return JSON.stringify({
    version: "6.9",
    hitCount: works.length,
    nextCursorMark: "*",
    request: {},
    resultList: {
      result: works.map((work, at) => ({
        id: `HANDWRITTEN${String(at)}`,
        source: "MED",
        doi: work.doi,
        title: work.title,
        authorString: "Hand-Written A.",
        pubYear: "2023",
        abstractText:
          "A hand-written abstract for the keyless spec: CRISPR base editing " +
          "of the genome, and how a base editor edits a mutation in cells.",
        pubTypeList: { pubType: ["research-article", "Journal Article"] },
      })),
    },
  });
}

/** The DOIs a Europe PMC lookup query asks for (lower case). */
function doisInQuery(query: string): readonly string[] {
  return [...query.matchAll(/DOI:"([^"]+)"/gu)].map((match) =>
    (match[1] as string).toLowerCase(),
  );
}

/** A DOI lookup's filter, `doi:a,doi:b` (lower case). */
function doisInFilter(filter: string): readonly string[] {
  return filter
    .split(",")
    .filter((pair) => pair.startsWith("doi:"))
    .map((pair) => pair.slice("doi:".length).toLowerCase());
}

/**
 * The double the spec puts behind `Zotero.HTTP.request`. The caller:
 * `noKeyRelatedness.spec.ts`'s `doubleTheTransport`.
 *
 * @param recordings - from {@link loadNoKeyRecordings}
 * @returns the double, with what it answered and refused
 */
export function createNoKeyDouble(recordings: NoKeyRecordings): NoKeyDouble {
  const calls: NoKeyCall[] = [];
  const refused: NoKeyRefusal[] = [];
  const filled = new Set<string>();
  const fillable = new Map(
    recordings.withoutAbstract.map((work) => [work.doi, work]),
  );

  const fromExchange = (
    request: NoKeyRequest,
    route: NoKeyRoute,
    exchange: LoadedExchange,
    contentType: string,
  ): NoKeyAnswer => ({
    route,
    origin:
      fixtureKey({
        method: request.method,
        url: request.url,
        ...(request.body !== undefined && { body: request.body }),
      }) === exchange.key
        ? "recorded"
        : "recorded-body",
    status: exchange.status,
    body: exchange.body,
    contentType,
  });

  const handWritten = (route: NoKeyRoute, body: string): NoKeyAnswer => ({
    route,
    origin: "hand-written",
    status: 200,
    body,
    contentType: JSON_TYPE,
  });

  function pubmed(
    request: NoKeyRequest,
    path: string,
    params: URLSearchParams,
  ): NoKeyAnswer | string {
    if (path.endsWith("/elink.fcgi")) {
      return handWritten(
        "pubmed-elink",
        handWrittenElink(params.getAll("id"), recordings.similarPmids),
      );
    }
    if (path.endsWith("/esearch.fcgi")) {
      // A second page, or a DOI asked of PubMed, has nothing recorded to answer it.
      const firstPage = Number(params.get("retstart") ?? "0") === 0;
      const byDoi = /\[(?:doi|aid|lid)\]/iu.test(params.get("term") ?? "");
      return fromExchange(
        request,
        "pubmed-esearch",
        firstPage && !byDoi ? recordings.esearch : recordings.esearchEmpty,
        JSON_TYPE,
      );
    }
    if (path.endsWith("/efetch.fcgi")) {
      const ids = (params.get("id") ?? "").split(",");
      if (ids.every((id) => recordings.similarPmids.includes(id))) {
        return fromExchange(
          request,
          "pubmed-efetch-similar",
          recordings.efetchSimilar,
          XML_TYPE,
        );
      }
      if (ids.every((id) => recordings.keywordPmids.includes(id))) {
        return fromExchange(
          request,
          "pubmed-efetch-keyword",
          recordings.efetchKeyword,
          XML_TYPE,
        );
      }
      return `no recorded efetch answer holds ${ids.join(",")}`;
    }
    return "no PubMed route for this path";
  }

  function europePmc(
    request: NoKeyRequest,
    path: string,
    params: URLSearchParams,
  ): NoKeyAnswer | string {
    if (path.endsWith("/citations")) {
      return fromExchange(
        request,
        "europepmc-citations",
        recordings.epmcCitations,
        JSON_TYPE,
      );
    }
    if (path.endsWith("/references")) {
      return fromExchange(
        request,
        "europepmc-references",
        recordings.epmcReferences,
        JSON_TYPE,
      );
    }
    if (!/\/search(?:POST)?$/u.test(path)) {
      return "no Europe PMC route for this path";
    }
    const query = params.get("query") ?? "";
    const dois = doisInQuery(query);
    if (dois.length > 0) {
      const works = dois.flatMap((doi) => {
        const work = fillable.get(doi);
        return work === undefined ? [] : [work];
      });
      if (works.length === 0) {
        return fromExchange(
          request,
          "europepmc-doi-lookup",
          recordings.epmcEmpty,
          JSON_TYPE,
        );
      }
      for (const work of works) filled.add(work.doi);
      return handWritten("europepmc-doi-lookup", handWrittenFillIn(works));
    }
    if ((params.get("cursorMark") ?? "*") !== "*") {
      return fromExchange(
        request,
        "europepmc-keyword",
        recordings.epmcEmpty,
        JSON_TYPE,
      );
    }
    return /\bAUTH:/u.test(query)
      ? fromExchange(
          request,
          "europepmc-author-watch",
          recordings.epmcAuthorWatch,
          JSON_TYPE,
        )
      : fromExchange(
          request,
          "europepmc-keyword",
          recordings.epmcKeyword,
          JSON_TYPE,
        );
  }

  function crossref(
    request: NoKeyRequest,
    path: string,
    params: URLSearchParams,
  ): NoKeyAnswer | string {
    if (path.startsWith("/works/")) {
      const doi = decodeURIComponent(path.slice("/works/".length));
      return doi.toLowerCase() === NO_KEY_SEED_DOI.toLowerCase()
        ? fromExchange(
            request,
            "crossref-work",
            recordings.crossrefWork,
            JSON_TYPE,
          )
        : `no recorded Crossref work for ${doi}`;
    }
    if (path !== "/works") return "no Crossref route for this path";
    const filter = params.get("filter") ?? "";
    const dois = doisInFilter(filter);
    if (dois.length > 0) {
      return fromExchange(
        request,
        "crossref-doi-lookup",
        dois.every((doi) => recordings.referenceDois.has(doi))
          ? recordings.crossrefLookup
          : recordings.crossrefEmpty,
        JSON_TYPE,
      );
    }
    return fromExchange(
      request,
      "crossref-keyword",
      (params.get("cursor") ?? "*") === "*"
        ? recordings.crossrefKeyword
        : recordings.crossrefEmpty,
      JSON_TYPE,
    );
  }

  function arxiv(
    request: NoKeyRequest,
    params: URLSearchParams,
  ): NoKeyAnswer | string {
    return fromExchange(
      request,
      "arxiv-keyword",
      Number(params.get("start") ?? "0") === 0
        ? recordings.arxivKeyword
        : recordings.arxivEmpty,
      ATOM_TYPE,
    );
  }

  function route(request: NoKeyRequest): NoKeyAnswer | string {
    if (request.url.toLowerCase().includes(NO_KEY_FORBIDDEN_HOST)) {
      return `a keyless run asked ${NO_KEY_FORBIDDEN_HOST}`;
    }
    const { hostname, pathname } = new URL(request.url);
    const params = parametersOf(request);
    switch (hostname) {
      case "eutils.ncbi.nlm.nih.gov":
        return pubmed(request, pathname, params);
      case "www.ebi.ac.uk":
        return europePmc(request, pathname, params);
      case "api.crossref.org":
        return crossref(request, pathname, params);
      case "export.arxiv.org":
        return arxiv(request, params);
      default:
        return `no route for host ${hostname}`;
    }
  }

  return {
    calls,
    refused,
    answer(request) {
      const answer = route(request);
      if (typeof answer === "string") {
        refused.push({
          method: request.method,
          url: request.url,
          reason: answer,
        });
        throw new Error(`[no-key double] ${answer}: ${request.url}`);
      }
      calls.push({
        method: request.method,
        url: request.url,
        body: request.body,
        route: answer.route,
        origin: answer.origin,
      });
      return answer;
    },
    filledIn: (doi) => filled.has(doi.toLowerCase()),
    clearCalls() {
      calls.length = 0;
    },
  };
}

/** One paper of the spec's 30-item collection. */
export interface NoKeyPaper {
  readonly title: string;
  readonly abstract: string;
  readonly doi: string;
  readonly pmid: string;
  readonly year: number;
  readonly creators: readonly {
    readonly lastName: string;
    readonly firstName: string;
  }[];
}

const NO_KEY_TOPICS: readonly string[] = [
  "CRISPR base editing of a sickle mutation in stem cells",
  "Prime editing with Cas9 nickases in mammalian cells",
  "Genome editing of hepatocytes with lipid nanoparticles",
  "Off-target mutations of cytosine base editors",
  "Adenine base editing in the mouse heart",
  "Pooled CRISPR screens for gene function",
];

/**
 * One saved paper, hand-written. The caller: `noKeyRelatedness.spec.ts`'s `before`, which
 * saves 30 as `journalArticle`s. Its words are chosen to meet the recorded CRISPR pages,
 * because a heuristic profile and word-space scoring read words. The DOI prefix is the
 * spec's own and the PMIDs are made up, so neither can match a recorded row.
 *
 * @param at - which paper, from 0
 * @param token - this run's token, for the DOI alone: a query must read as a topic
 * @returns the paper's fields
 */
export function noKeyPaper(at: number, token: string): NoKeyPaper {
  const topic = NO_KEY_TOPICS[at % NO_KEY_TOPICS.length] as string;
  return {
    title: `${topic}, study ${String(at)}`,
    abstract:
      `${topic}. We report how a CRISPR genome editing system changes a ` +
      `mutation in cells, with base editing outcomes measured for study ${String(at)}.`,
    doi: `10.5556/${token}.${String(at)}`,
    pmid: `9900${String(1000 + at)}`,
    year: 2021 + (at % 5),
    creators: [
      { lastName: `Saved${"abcde".charAt(at % 5)}`, firstName: "Ann" },
      { lastName: "Watched", firstName: "Bo" },
    ],
  };
}

/**
 * The related run's seed. Hand-written, with two real ids of two different papers: the
 * DOI is the recorded Crossref seed and the PMID the recorded Europe PMC seed, because
 * no one paper has both recorded with a Crossref title answer. Its words come from both,
 * so word-space similarity has something to read. The caller: the spec's related test.
 */
export const NO_KEY_SEED: Pick<NoKeyPaper, "title" | "abstract" | "year"> = {
  title:
    "Large scale visual recognition and transfer learning in network biology",
  abstract:
    "A hand-written seed for the keyless spec: object recognition on a large " +
    "image database, and transfer learning for single-cell predictions.",
  year: 2023,
};

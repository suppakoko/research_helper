/* eslint-disable no-restricted-globals -- the integration suite's setup: it doubles Zotero.HTTP.request for the recommend specs (docs/13 §2.3), and there is no src/zotero/ facade for that from outside the plugin bundle. */
/**
 * One hand-written Europe PMC page, and the transport double the recommend specs answer
 * with it (`recommendFlow.spec.ts`, `recommendWindow.spec.ts`).
 *
 * **Not evidence about any service.** Everything here is written by hand. Every request
 * of the plugin's is answered and recorded, nothing goes out, and there is no Semantic
 * Scholar key, so a run on this is the keyless path.
 */

import { isLiveRequest } from "./liveRequestGuard";

export const EUROPE_PMC_SEARCH =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const THIS_YEAR = new Date().getFullYear();

/** Letters only, so the term extraction keeps it as one word. */
export function runToken(): string {
  return `qz${Date.now()
    .toString(36)
    .replace(/[0-9]/g, (digit) => "abcdefghij".charAt(Number(digit)))}`;
}

/** The title {@link pageRecord} gives a record, so a spec can own one by title. */
export function pageTitle(token: string, at: number): string {
  return `Hand-written paper ${String(at)} on hepatocyte lipid delivery ${token}`;
}

/**
 * One hand-written record, in the shape `test/fixtures/europepmc` records have. Each has
 * its own journal, so `MAX_PER_VENUE` leaves all of them on the list.
 */
export function pageRecord(token: string, at: number): Record<string, unknown> {
  const name = `Author${String.fromCharCode(97 + at)}`;
  return {
    id: `${token}${String(at)}`,
    source: "MED",
    pmid: `9${String(Date.now() % 1_000_000)}${String(at)}`,
    doi: `10.5555/${token}.${String(at)}`,
    title: pageTitle(token, at),
    authorString: `${name} J.`,
    authorList: {
      author: [
        {
          fullName: `${name} J`,
          lastName: name,
          firstName: "J",
          initials: "J",
        },
      ],
    },
    journalInfo: {
      yearOfPublication: THIS_YEAR,
      journal: { title: `A Hand-Written Journal ${String(at)}` },
    },
    pubYear: String(THIS_YEAR),
    abstractText: `A hand-written abstract number ${String(at)} about hepatocyte lipid delivery.`,
    pubTypeList: { pubType: ["research-article", "Journal Article"] },
    firstPublicationDate: `${String(THIS_YEAR)}-01-15`,
  };
}

function europePmcPage(token: string, rows: number): string {
  return JSON.stringify({
    version: "6.9",
    hitCount: rows,
    nextCursorMark: "*",
    request: {},
    resultList: {
      result: Array.from({ length: rows }, (_unused, at) =>
        pageRecord(token, at),
      ),
    },
  });
}

/** How to answer: the page's length, and how long each answer takes. */
export interface RecommendPageOptions {
  readonly rows: number;
  readonly delayMs?: number;
}

/**
 * Answer every request of the plugin's from this file, and record its URL. Other hosts
 * get an empty JSON page, which a source reads as nothing or as its own failure: the
 * point is that nothing leaves the machine.
 *
 * Measured 2026-11-06: the runner's own reporter posts every test's result through this
 * same method, to loopback. So a request that is not live goes on to the real method;
 * answering it here lost a spec's failure messages and put the reporter's address in
 * `urls`.
 *
 * @returns the addresses asked, and how to put the real method back
 */
export function doubleTheTransport(
  token: string,
  { rows, delayMs = 0 }: RecommendPageOptions,
): {
  readonly urls: string[];
  readonly restore: () => void;
} {
  const http = Zotero.HTTP as unknown as {
    request: (
      method: string,
      url: string,
      options?: { readonly headers?: Readonly<Record<string, string>> },
    ) => unknown;
  };
  const real = http.request;
  const urls: string[] = [];
  http.request = (method, url, options) => {
    const userAgent = options?.headers?.["User-Agent"];
    if (!isLiveRequest({ url, userAgent })) {
      return real.call(http, method, url, options);
    }
    urls.push(url);
    const answer = {
      status: 200,
      responseText: url.startsWith(EUROPE_PMC_SEARCH)
        ? europePmcPage(token, rows)
        : "{}",
      responseURL: url,
      getAllResponseHeaders: () => "content-type: application/json\r\n",
    };
    return delayMs === 0
      ? Promise.resolve(answer)
      : Zotero.Promise.delay(delayMs).then(() => answer);
  };
  return {
    urls,
    restore: () => {
      http.request = real;
    },
  };
}

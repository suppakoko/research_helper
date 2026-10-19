/**
 * Item 214 (owner, 2026-10-19): a PMCID-only record is resolved through the
 * NCBI ID Converter (`docs/02` §3.7) before Strategy B's lookup.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, **no network**. Every request goes to
 * a fake `HttpClient` or to the real client over a fake transport, and every
 * response body is either `docs/02` §3.7's own documented example or — where
 * the document shows none — a synthetic body marked as such beside it.
 *
 * Four groups:
 * 1. the request: §3.7's URL, the maintainer's `tool`/`email`, never a key,
 *    batches of 100;
 * 2. the answer: §3.7's documented record, unresolved ids, error envelopes;
 * 3. the client: §7.3's `pmc.ncbi.nlm.nih.gov` bucket and the D10
 *    `User-Agent`, through the shipped `createHttpClient`;
 * 4. the policy row: `docs/07` §7.3's `pmc.ncbi.nlm.nih.gov` row, read off
 *    the page and compared with `HOST_POLICIES`, cell by cell.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  OperationCancelledError,
  ParseError,
  SourceError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpOptions,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { MAINTAINER_EMAIL, TOOL_NAME } from "../../../src/core/http/userAgent";
import {
  createHostLimiterRegistry,
  HOST_POLICIES,
  NCBI_HOST,
  PMC_IDCONV_HOST,
} from "../../../src/core/rateLimit/hostLimiter";
import {
  buildIdConverterUrl,
  createPmcidConverter,
  IDCONV_MAX_IDS_PER_REQUEST,
  NCBI_IDCONV_BASE_URL,
  parseIdConverterBody,
} from "../../../src/sources/pubmed/idConverter";

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/** `docs/02` §3.7's verified PMCID answer, verbatim. */
const DOC_PMCID_BODY =
  '{"status":"ok","records":[{"doi":"10.4103/tcmj.tcmj_71_20","pmcid":"PMC7605294","pmid":33163378,"requested-id":"PMC7605294"}]}';

/** `docs/02` §3.7's verified PMID answer, verbatim (two records). */
const DOC_PMID_BODY =
  '{"status":"ok","records":[{"doi":"10.1038/s41586-023-06139-9","pmcid":"PMC10949956","pmid":37258680,"requested-id":"37258680"},{"doi":"10.1177/1534735417753544","pmcid":"PMC6142073","pmid":29355051,"requested-id":"29355051"}]}';

/** `docs/02` §3.7's verified error envelope, verbatim. */
const DOC_ERROR_BODY =
  '{"status":"error","http_status":"400","http_status_reason":"Bad Request","errors":[{"message":"All values of query param `ids` must be PubMed IDs (Positive Integers).","code":"invalid_pmids"}]}';

/**
 * **Synthetic** — `docs/02` §3.7 shows no unresolved record. Shaped after the
 * documented record with its `doi` and `pmid` removed and a per-record
 * `status: "error"` added; the converter must resolve nothing from it either
 * way. Recording a real one is a follow-up that needs the owner's budget.
 */
const SYNTHETIC_UNRESOLVED_RECORD =
  '{"pmcid":"PMC9999999","requested-id":"PMC9999999","status":"error","errmsg":"synthetic: not found"}';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpOptions | undefined;
}

/** An `HttpClient` that answers from `answer(url)` and records every call. */
function fakeHttp(answer: (url: string) => string) {
  const calls: HttpCall[] = [];
  const http: HttpClient = {
    request: vi.fn((method, url, options) => {
      calls.push({ method, url, options });
      return Promise.resolve({
        status: 200,
        url,
        body: answer(url),
        rawHeaders: "",
        header: () => undefined,
      });
    }),
  };
  return { http, calls };
}

function idsOf(url: string): string[] {
  return (new URL(url).searchParams.get("ids") ?? "").split(",");
}

/** A synthetic answer: every asked PMCID resolves to a made-up DOI. */
function answerEvery(url: string): string {
  const records = idsOf(url).map((id) => ({
    doi: `10.5555/synthetic.${id.toLowerCase()}`,
    pmcid: id,
    "requested-id": id,
  }));
  return JSON.stringify({ status: "ok", records });
}

class StubZoteroException extends Error {}
class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}

/** A `Zotero.HTTP` stand-in answering `body` with HTTP 200. */
function fakeTransport(body: string): HttpTransport & {
  readonly calls: { url: string; options: HttpTransportOptions }[];
} {
  const calls: { url: string; options: HttpTransportOptions }[] = [];
  return {
    calls,
    request(_method, url, options) {
      calls.push({ url, options });
      return Promise.resolve({
        status: 200,
        responseText: body,
        responseURL: url,
        getAllResponseHeaders: () => "",
      });
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubZoteroException,
    BrowserOfflineException: StubZoteroException,
    SecurityException: StubZoteroException,
    CancelledException: StubZoteroException,
  };
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing: ${what}`);
  return value;
}

// ---------------------------------------------------------------------------
// 1. The request
// ---------------------------------------------------------------------------

describe("NCBI ID Converter — the request (docs/02 §3.7)", () => {
  it("builds docs/02 §3.7's URL: the new base, idtype=pmcid, format=json, and the maintainer's tool and email", () => {
    const url = new URL(buildIdConverterUrl(["PMC7605294", "PMC6142073"]));
    expect(`${url.origin}${url.pathname}`).toBe(NCBI_IDCONV_BASE_URL);
    expect(NCBI_IDCONV_BASE_URL).toBe(
      "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/",
    );
    expect(url.host).toBe(PMC_IDCONV_HOST);
    expect([...url.searchParams.keys()]).toEqual([
      "ids",
      "idtype",
      "format",
      "tool",
      "email",
    ]);
    expect(url.searchParams.get("ids")).toBe("PMC7605294,PMC6142073");
    expect(url.searchParams.get("idtype")).toBe("pmcid");
    expect(url.searchParams.get("format")).toBe("json");
    // The project's constants, never a spelled address (D10).
    expect(url.searchParams.get("tool")).toBe(TOOL_NAME);
    expect(url.searchParams.get("email")).toBe(MAINTAINER_EMAIL);
  });

  it("sends no API key: no key parameter in any URL and no header at all", async () => {
    const { http, calls } = fakeHttp(answerEvery);
    const convert = createPmcidConverter({ http });
    await convert(["PMC1", "PMC2"], undefined);
    expect(calls).toHaveLength(1);
    for (const call of calls) {
      const params = [...new URL(call.url).searchParams.keys()];
      expect(params.filter((name) => /key|token/iu.test(name))).toEqual([]);
      expect(call.url).not.toMatch(/api_key/iu);
      expect(call.options?.headers).toBeUndefined();
      expect(call.method).toBe("GET");
    }
  });

  it(`batches the ids ${String(IDCONV_MAX_IDS_PER_REQUEST)} to a request, never one id per request`, async () => {
    const { http, calls } = fakeHttp(answerEvery);
    const pmcids = Array.from({ length: 250 }, (_, i) => `PMC${String(i + 1)}`);
    const resolved = await createPmcidConverter({ http })(pmcids, undefined);

    expect(IDCONV_MAX_IDS_PER_REQUEST).toBe(100);
    expect(calls.map((call) => idsOf(call.url).length)).toEqual([100, 100, 50]);
    // Every id asked exactly once, in order.
    expect(calls.flatMap((call) => idsOf(call.url))).toEqual(pmcids);
    expect(resolved.size).toBe(250);
  });

  it("refuses an empty or oversized batch, and sends nothing for an empty list", async () => {
    expect(() => buildIdConverterUrl([])).toThrow(RangeError);
    expect(() =>
      buildIdConverterUrl(
        Array.from({ length: IDCONV_MAX_IDS_PER_REQUEST + 1 }, () => "PMC1"),
      ),
    ).toThrow(RangeError);
    const { http, calls } = fakeHttp(answerEvery);
    const resolved = await createPmcidConverter({ http })([], undefined);
    expect(calls).toHaveLength(0);
    expect(resolved.size).toBe(0);
  });

  it("never sends an id that is not a PMCID, and sends one spelling of each", async () => {
    const { http, calls } = fakeHttp(answerEvery);
    const resolved = await createPmcidConverter({ http })(
      ["PMC7605294", "pmc7605294", "not-a-pmcid", "7605295"],
      undefined,
    );
    expect(calls).toHaveLength(1);
    expect(idsOf(must(calls[0], "the one call").url)).toEqual([
      "PMC7605294",
      "PMC7605295",
    ]);
    // Answers come back under every spelling the caller used.
    expect(resolved.get("PMC7605294")).toEqual(resolved.get("pmc7605294"));
    expect(resolved.has("7605295")).toBe(true);
    expect(resolved.has("not-a-pmcid")).toBe(false);
  });

  it("passes the token to the client and checks it before every batch", async () => {
    const source = createCancellationTokenSource();
    const { http, calls } = fakeHttp((url) => {
      source.cancel({ kind: "user" });
      return answerEvery(url);
    });
    const pmcids = Array.from({ length: 150 }, (_, i) => `PMC${String(i + 1)}`);
    await expect(
      createPmcidConverter({ http })(pmcids, source.token),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(calls).toHaveLength(1);
    expect(must(calls[0], "the first call").options?.token).toBe(source.token);
  });
});

// ---------------------------------------------------------------------------
// 2. The answer
// ---------------------------------------------------------------------------

describe("NCBI ID Converter — the answer (docs/02 §3.7)", () => {
  it("resolves docs/02 §3.7's documented PMCID answer to its DOI and PMID", async () => {
    const { http } = fakeHttp(() => DOC_PMCID_BODY);
    const resolved = await createPmcidConverter({ http })(
      ["PMC7605294"],
      undefined,
    );
    expect([...resolved.entries()]).toEqual([
      ["PMC7605294", { doi: "10.4103/tcmj.tcmj_71_20", pmid: "33163378" }],
    ]);
  });

  it("reads §3.7's numeric pmid as a string, record by record", () => {
    expect(parseIdConverterBody(DOC_PMID_BODY, "u")).toEqual([
      {
        requestedId: "37258680",
        doi: "10.1038/s41586-023-06139-9",
        pmid: "37258680",
      },
      {
        requestedId: "29355051",
        doi: "10.1177/1534735417753544",
        pmid: "29355051",
      },
    ]);
  });

  it("leaves a PMCID the converter did not resolve out of the map", async () => {
    // One documented record and one synthetic unresolved record, plus a
    // PMCID the answer does not mention at all.
    const body =
      '{"status":"ok","records":[' +
      '{"doi":"10.4103/tcmj.tcmj_71_20","pmcid":"PMC7605294","pmid":33163378,"requested-id":"PMC7605294"},' +
      SYNTHETIC_UNRESOLVED_RECORD +
      "]}";
    const { http } = fakeHttp(() => body);
    const resolved = await createPmcidConverter({ http })(
      ["PMC7605294", "PMC9999999", "PMC8888888"],
      undefined,
    );
    expect([...resolved.keys()]).toEqual(["PMC7605294"]);
  });

  it("throws SourceError on §3.7's documented error envelope and ParseError on a body that is not the envelope", () => {
    let thrown: unknown;
    try {
      parseIdConverterBody(DOC_ERROR_BODY, "u");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourceError);
    expect(thrown).not.toBeInstanceOf(ParseError);
    expect((thrown as SourceError).message).toContain(
      "All values of query param",
    );
    expect((thrown as SourceError).context).toMatchObject({
      upstreamCode: "invalid_pmids",
    });
    expect(() => parseIdConverterBody("<html>busy</html>", "u")).toThrow(
      ParseError,
    );
    expect(() => parseIdConverterBody('{"status":"ok"}', "u")).toThrow(
      ParseError,
    );
    expect(() => parseIdConverterBody("[]", "u")).toThrow(ParseError);
  });
});

// ---------------------------------------------------------------------------
// 3. Through the shipped client
// ---------------------------------------------------------------------------

describe("NCBI ID Converter — through the shipped HTTP client", () => {
  it("is paced on docs/07 §7.3's pmc.ncbi.nlm.nih.gov bucket and carries the D10 User-Agent", async () => {
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    const asked: string[] = [];
    const transport = fakeTransport(DOC_PMCID_BODY);
    const userAgent =
      "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";
    const http = createHttpClient({
      transport,
      userAgent,
      clock,
      limiterFor: (host) => {
        asked.push(host);
        return registry.limiterFor(host);
      },
    });

    const resolved = await createPmcidConverter({ http })(
      ["PMC7605294"],
      undefined,
    );

    expect(resolved.get("PMC7605294")?.doi).toBe("10.4103/tcmj.tcmj_71_20");
    expect(asked).toEqual([PMC_IDCONV_HOST]);
    expect(registry.limiterFor(PMC_IDCONV_HOST)).toBeDefined();
    // Its own bucket, not E-utilities'.
    expect(registry.limiterFor(PMC_IDCONV_HOST)).not.toBe(
      registry.limiterFor(NCBI_HOST),
    );
    expect(transport.calls).toHaveLength(1);
    const sent = must(transport.calls[0], "the transport call");
    expect(sent.options.headers?.["User-Agent"]).toBe(userAgent);
    expect(new URL(sent.url).searchParams.has("api_key")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The policy row against docs/07 §7.3
// ---------------------------------------------------------------------------

/** `docs/07` §7.3's policy table, as header + rows of cells. */
function readSection73(): { columns: string[]; rows: string[][] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(
    resolve(here, "../../../docs/07-architecture-and-data-model.md"),
    "utf8",
  );
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith("### 7.3 "));
  if (start < 0) throw new Error("docs/07 has no `### 7.3 ` heading");
  const header = lines.findIndex(
    (line, index) => index > start && line.startsWith("| Host |"),
  );
  if (header < 0) throw new Error("§7.3 has no `| Host |` table");
  const cellsOf = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const block: string[] = [];
  for (let i = header; i < lines.length; i += 1) {
    const line = must(lines[i], "a §7.3 line");
    if (!line.startsWith("|")) break;
    if (/^\|[\s\-:|]*\|$/u.test(line)) continue;
    block.push(line);
  }
  const columns = cellsOf(must(block[0], "§7.3's header row"));
  const rows = block.slice(1).map(cellsOf);
  if (rows.length === 0) throw new Error("§7.3's table parsed to no rows");
  return { columns, rows };
}

function cell(
  table: { columns: string[]; rows: string[][] },
  host: string,
  column: string,
): string {
  const at = table.columns.indexOf(column);
  if (at < 0) throw new Error(`§7.3 has no "${column}" column`);
  const row = table.rows.find((cells) => cells[0] === `\`${host}\``);
  if (row === undefined) throw new Error(`§7.3 has no row for ${host}`);
  return must(row[at], `${host} ${column}`);
}

/** The first number in a cell: `2.5/s, never keyed` → 2.5, `30 000 ms` → 30000. */
function firstNumber(text: string): number {
  const match = /(\d[\d ]*(?:\.\d+)?)/u.exec(text.replace(/[*`]/gu, ""));
  if (match === null) throw new Error(`no number in ${JSON.stringify(text)}`);
  return Number(must(match[1], "the number").replace(/ /gu, ""));
}

describe("docs/07 §7.3's pmc.ncbi.nlm.nih.gov row (owner, 2026-10-19, item 214)", () => {
  it("ships the row exactly as §7.3 states it, read from the document, and never keyed", () => {
    const table = readSection73();
    const policy = must(
      HOST_POLICIES.find((row) => row.host === PMC_IDCONV_HOST),
      "the pmc.ncbi.nlm.nih.gov row",
    );
    expect(policy.withoutKey.ratePerSecond).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Rate")),
    );
    expect(policy.withoutKey.burst).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Burst")),
    );
    expect(policy.withoutKey.maxConcurrent).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Max concurrent")),
    );
    const retry = must(policy.retry, "the row's retry budget");
    expect(retry.baseMs).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Retry base")),
    );
    expect(retry.capMs).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Retry cap")),
    );
    expect(retry.maxAttempts).toBe(
      firstNumber(cell(table, PMC_IDCONV_HOST, "Attempt cap")),
    );
    // "never keyed": no keyed rate, no presence flag, nothing that could
    // switch the row to a key.
    expect(cell(table, PMC_IDCONV_HOST, "Rate")).toMatch(/never keyed/u);
    expect(policy.withKey).toBeUndefined();
    expect(policy.keyPresencePref).toBeUndefined();
    expect(policy.headerDriven).toBeUndefined();
  });

  it("is E-utilities' unkeyed policy, as the owner ruled", () => {
    const pmc = must(
      HOST_POLICIES.find((row) => row.host === PMC_IDCONV_HOST),
      "the pmc row",
    );
    const eutils = must(
      HOST_POLICIES.find((row) => row.host === NCBI_HOST),
      "the NCBI row",
    );
    expect(pmc.withoutKey).toEqual(eutils.withoutKey);
    expect(pmc.retry).toEqual(eutils.retry);
    expect(pmc.withoutKey).toEqual({
      ratePerSecond: 2.5,
      burst: 1,
      maxConcurrent: 3,
    });
    expect(pmc.retry).toEqual({ baseMs: 1000, capMs: 30_000, maxAttempts: 3 });
  });
});

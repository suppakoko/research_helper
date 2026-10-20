/**
 * PubMed contract tests — `docs/13` §2.2 layer 2, over the recorded fixtures in
 * `test/fixtures/pubmed/`.
 *
 * **Scope.** `P1-T11` step 5: all four of `docs/13` §2.2's assertion categories —
 * request shape, parser snapshot, typed errors, pagination — against responses
 * recorded from `eutils.ncbi.nlm.nih.gov` on 2026-10-07 by
 * `scripts/record-fixtures.ts`. **This file makes no network request and cannot:**
 * `./_transport.ts` has no `fetch` and no `Zotero.HTTP`, and a missing fixture is
 * an error naming the record command, never a silent call (§2.2).
 *
 * ## Read this before adding an assertion: what a contract test is for
 *
 * A contract test exists to notice when **the service** changes. An assertion
 * that records a response and then checks that our mapper produces what our
 * mapper produced is a snapshot of today's behaviour and catches only our own
 * regressions. Both kinds are worth having and they are not the same kind, so
 * **every `it` below is tagged**:
 *
 * - **`[service]`** — fails when NCBI changes what it sends. The assertion reads
 *   recorded bytes or a shape only NCBI controls. Our code can be untouched.
 * - **`[ours]`** — fails only when *our* code changes. The fixture's content is
 *   structural or synthetic; NCBI cannot make these fail.
 * - **`[both]`** — a parser snapshot: either side moving breaks it. These are the
 *   majority, and they are the ones that pay for the fixture corpus, because a
 *   re-record plus a failure here is the signal "the service moved".
 *
 * The tags are in the test names on purpose, so `npm run test:contract`'s own
 * output is the evidence rather than this comment.
 *
 * ## What to do when one of these fails
 *
 * 1. **`[ours]` failed** — a regression in our builders, client or mapper. Fix
 *    the code. A failure saying "Missing fixture …" means a *request* changed
 *    shape: a parameter was renamed, reordered or dropped, because the fixture
 *    name is a hash of the request. Fix the builder, or re-record if the change
 *    was intended.
 * 2. **`[service]` or `[both]` failed after a re-record** — NCBI moved. Read the
 *    fixture diff; a large unexplained diff *is* the signal (`docs/13` §3.3 item
 *    3). Change the parser and say so in the commit message.
 * 3. **A staleness failure** — the corpus is over a year old. Re-record with
 *    `FIXTURE_MODE=record npm run fixtures:record`.
 * 4. **Never hand-edit a fixture to make one of these pass** (`docs/13` §3.3
 *    rule 4). Re-record, or add a scenario to `scripts/record-fixtures.ts`.
 * 5. **Never delete the test.** A contract test that fails is doing its job.
 *
 * ## Why this file ships an XML parser
 *
 * Node has no `DOMParser` and the sandbox has one (`docs/01` §2.3's measured
 * list), so `createPubmedRecordMapper` takes the parse as a port.
 * {@link parseXmlInNode} is this file's Node implementation of it, and it mimics
 * Gecko's one non-obvious behaviour: a malformed document does not throw, it
 * comes back with a `<parsererror>` root, which is what the mapper detects.
 *
 * **What that costs, stated plainly:** decoding `&#x2009;` and flattening `<sup>`
 * into `textContent` are the *parser's* work. In the shipped path that parser is
 * Gecko's; here it is the one below. So an assertion about a decoded character
 * reference is, in this layer, an assertion that the mapper reads `textContent`
 * and re-escapes nothing. The parser duplicates the one in
 * `test/unit/sources/pubmed-mapper.test.ts`; extracting a shared
 * `test/helpers/xml.ts` needs a card, since that path is in neither card's
 * `Files` list.
 */

import { readdir, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ParseError,
  RateLimitError,
  redact,
  SourceError,
  UpstreamServerError,
} from "../../src/core/errors";
import { MAINTAINER_EMAIL, TOOL_NAME } from "../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../src/core/jobQueue/cancellation";
import { NCBI_HOST } from "../../src/core/rateLimit/hostLimiter";
import {
  createPubmedRecordMapper,
  type XmlCollectionLike,
  type XmlDocumentLike,
  type XmlElementLike,
} from "../../src/sources/pubmed/mapper";
import {
  buildEfetchRequest,
  createPubmedSource,
  parseEsearchBody,
  PUBMED_RETSTART_MAX,
} from "../../src/sources/pubmed/pubmedSource";
import { buildEsearchRequest } from "../../src/sources/pubmed/query";
import type { SourceCallContext, SourceQuery } from "../../src/sources/types";
import {
  type Answer,
  ERROR_RETSTART,
  PAGE_SIZE,
  planFor,
  plannedRequest,
  QUERY_EMPTY,
  QUERY_TYPICAL,
  readDocs02ErrorBody,
  RECORD_PMIDS,
} from "../../scripts/record-fixtures";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureFileFor,
  fixtureKey,
  FIXTURE_RECORD_COMMAND,
  FIXTURE_STALE_FAIL_DAYS,
  FIXTURE_STALE_WARN_DAYS,
  FROZEN_NOW_EPOCH_MS,
  listFixtureMeta,
  META_SUFFIX,
} from "./_transport";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pubmed",
);

/**
 * `P1-T11`'s inventory — the `docs/13` §3.1 scenarios — named here so a gap
 * fails loudly. **Since `P2-T36` (2026-10-15) this is a required subset, not
 * the whole corpus:** the corpus is whatever the recorder's PubMed plan names
 * ({@link plannedScenarios}), which now also holds the search window's two
 * fixtures, and the checks below compare the directory against that plan
 * rather than against a count written into this file.
 */
const EXPECTED_SCENARIOS: readonly string[] = [
  "error-429",
  "error-500",
  "error-malformed",
  "paginated-page-1",
  "paginated-page-1-efetch",
  "paginated-page-2",
  "paginated-page-2-efetch",
  "record-jats-abstract",
  "record-rich",
  "record-sparse",
  "record-unicode",
  "record-unknown-pmid",
  "search-empty",
  "search-error-retstart",
  "search-error-upstream",
  "search-single",
  "search-typical",
];

/**
 * Every scenario the recorder's PubMed plan names — independent, dependent
 * (resolved from the committed answers, as a dry run resolves them) and
 * synthetic. The source of truth for how many fixtures the directory holds.
 */
async function plannedScenarios(): Promise<readonly string[]> {
  const plan = planFor("pubmed");
  const fromDisk: Answer = async (planned) => {
    try {
      const file = fixtureFileFor(FIXTURE_DIR, {
        method: planned.method,
        url: planned.url,
        ...(planned.body !== undefined && { body: planned.body }),
      });
      return JSON.parse(await readFile(file, "utf8")) as Awaited<
        ReturnType<Answer>
      >;
    } catch {
      return undefined;
    }
  };
  return [
    ...plan.independent(),
    ...(await plan.dependent(fromDisk)),
    ...plan.syntheticRequests(),
  ].map((p) => p.scenario);
}

function context(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

// ---------------------------------------------------------------------------
// 1. A minimal XML parser, for Node only
// ---------------------------------------------------------------------------

/** XML's five predefined entities. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode predefined and numeric character references (`docs/02` §3.4 note 3). */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return NAMED_ENTITIES[body] ?? whole;
    },
  );
}

/** An element node, satisfying the mapper's {@link XmlElementLike} port. */
class NodeElement implements XmlElementLike {
  readonly nodes: Array<NodeElement | string> = [];

  constructor(
    readonly localName: string,
    private readonly attrs: ReadonlyMap<string, string>,
  ) {}

  get textContent(): string {
    return this.nodes
      .map((n) => (typeof n === "string" ? n : n.textContent))
      .join("");
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  get children(): XmlCollectionLike {
    const els = this.nodes.filter(
      (n): n is NodeElement => typeof n !== "string",
    );
    return { length: els.length, item: (i) => els[i] ?? null };
  }
}

const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/gu;
const TAG_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*/u;

/**
 * Parse XML the way Gecko's `DOMParser` reports failure: never by throwing.
 *
 * @param xml - a response body
 * @returns the document, or one whose root is `<parsererror>`
 */
function parseXmlInNode(xml: string): XmlDocumentLike {
  try {
    return { documentElement: parseOrThrow(xml) };
  } catch (error) {
    const el = new NodeElement("parsererror", new Map());
    el.nodes.push(error instanceof Error ? error.message : String(error));
    return { documentElement: el };
  }
}

/** Find the `>` that ends a start tag, ignoring ones inside attribute quotes. */
function findTagEnd(xml: string, from: number): number {
  let quote: string | undefined;
  for (let j = from + 1; j < xml.length; j += 1) {
    const ch = xml[j];
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return j;
    }
  }
  throw new Error("unterminated start tag");
}

function parseOrThrow(xml: string): NodeElement {
  let i = 0;
  const stack: NodeElement[] = [];
  let root: NodeElement | undefined;

  /** `<?…?>`, `<!--…-->` and `<!DOCTYPE …>`; all skipped, none kept. */
  const skipProlog = (): boolean => {
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i);
      if (end === -1) throw new Error("unterminated processing instruction");
      i = end + 2;
      return true;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i);
      if (end === -1) throw new Error("unterminated comment");
      i = end + 3;
      return true;
    }
    if (xml.startsWith("<!", i)) {
      // A DOCTYPE's system identifier is a quoted URL and may hold a `>`.
      let j = i + 2;
      let quote: string | undefined;
      while (j < xml.length) {
        const ch = xml[j];
        if (quote !== undefined) {
          if (ch === quote) quote = undefined;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === ">") break;
        j += 1;
      }
      if (j >= xml.length) throw new Error("unterminated declaration");
      i = j + 1;
      return true;
    }
    return false;
  };

  while (i < xml.length) {
    if (xml[i] !== "<") {
      const next = xml.indexOf("<", i);
      const end = next === -1 ? xml.length : next;
      const text = xml.slice(i, end);
      const parent = stack[stack.length - 1];
      if (parent !== undefined && text !== "") {
        parent.nodes.push(decodeEntities(text));
      }
      i = end;
      continue;
    }
    if (skipProlog()) continue;
    if (xml.startsWith("</", i)) {
      const close = xml.indexOf(">", i);
      if (close === -1) throw new Error("unterminated end tag");
      const name = xml.slice(i + 2, close).trim();
      const open = stack.pop();
      if (open === undefined || open.localName !== name) {
        throw new Error(
          `mismatched end tag </${name}> (open: ${open?.localName ?? "none"})`,
        );
      }
      i = close + 1;
      continue;
    }
    const close = findTagEnd(xml, i);
    const inner = xml.slice(i + 1, close);
    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = TAG_NAME.exec(body);
    if (nameMatch === null) throw new Error(`bad tag name in <${body}>`);
    const name = nameMatch[0];
    const attrs = new Map<string, string>();
    for (const m of body.slice(name.length).matchAll(ATTRIBUTE)) {
      attrs.set(m[1] ?? "", decodeEntities(m[3] ?? m[4] ?? ""));
    }
    const el = new NodeElement(name, attrs);
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      if (root !== undefined) throw new Error("second root element");
      root = el;
    } else {
      parent.nodes.push(el);
    }
    if (!selfClosing) stack.push(el);
    i = close + 1;
  }

  if (stack.length > 0) {
    throw new Error(
      `unclosed element <${stack[stack.length - 1]?.localName ?? "?"}>`,
    );
  }
  if (root === undefined) throw new Error("no root element");
  return root;
}

// ---------------------------------------------------------------------------
// 2. The harness
// ---------------------------------------------------------------------------

/** The shipped adapter, mapper and client, all over the fixture directory. */
function harness() {
  const replay = createReplayHttpClient({ dir: FIXTURE_DIR, host: NCBI_HOST });
  const mapRecords = createPubmedRecordMapper({
    clock: replay.clock,
    parseXml: parseXmlInNode,
  });
  const source = createPubmedSource({
    http: replay.client,
    clock: replay.clock,
    mapRecords,
  });
  return { ...replay, mapRecords, source };
}

/** A scenario's recorded body, read straight off disk. */
async function bodyOf(scenario: string): Promise<string> {
  const planned = plannedRequest(scenario);
  const file = fixtureFileFor(FIXTURE_DIR, {
    method: planned.method,
    url: planned.url,
    ...(planned.body !== undefined && { body: planned.body }),
  });
  const text = await readFile(file, "utf8");
  return (JSON.parse(text) as { body: string }).body;
}

/** Issue one scenario's request through the shipped client and return the body. */
async function fetchScenario(
  scenario: string,
): Promise<{ body: string; url: string; status: number }> {
  const { client, transport } = harness();
  const planned = plannedRequest(scenario);
  const response = await client.request(
    planned.method as "GET" | "POST",
    planned.url,
    {
      responseType: "text",
      ...(planned.body !== undefined && {
        body: planned.body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    },
  );
  return {
    body: response.body,
    url: transport.calls[0]?.url ?? "",
    status: response.status,
  };
}

/** Everything the adapter would send for a query, without a fixture. */
function esearchUrlFor(query: SourceQuery, retmax: number, retstart: number) {
  return buildEsearchRequest({ query, retmax, retstart, retmode: "json" }).url;
}

// ---------------------------------------------------------------------------
// 3. The corpus itself
// ---------------------------------------------------------------------------

describe("the recorded corpus", () => {
  it("pairs every fixture with a _meta.json sidecar [ours]", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    const fixtures = names
      .filter((n) => !n.endsWith(META_SUFFIX))
      .map((n) => n.slice(0, -".json".length))
      .sort();
    const sidecars = names
      .filter((n) => n.endsWith(META_SUFFIX))
      .map((n) => n.slice(0, -META_SUFFIX.length))
      .sort();
    expect(fixtures).toEqual(sidecars);
    expect(fixtures).toHaveLength((await plannedScenarios()).length);
  });

  it("covers every scenario the card's §3.1 inventory names [ours]", async () => {
    const loaded = await listFixtureMeta(FIXTURE_DIR);
    const onDisk = loaded.map((l) => l.meta.scenario).sort();
    // Exactly what the recorder plans — no unplanned file, no unrecorded plan —
    // and the §3.1 inventory is still all there.
    expect(onDisk).toEqual([...(await plannedScenarios())].sort());
    expect(onDisk).toEqual(expect.arrayContaining([...EXPECTED_SCENARIOS]));
    // The three the card lets be hand-written, plus the one docs/02 §3.3 is the
    // only surviving source for, are marked as such; nothing else is.
    const synthetic = loaded
      .filter((l) => l.meta.synthetic)
      .map((l) => l.meta.scenario)
      .sort();
    expect(synthetic).toEqual([
      "error-429",
      "error-500",
      "error-malformed",
      "search-error-upstream",
    ]);
    for (const l of loaded.filter((x) => x.meta.synthetic)) {
      expect(l.meta.syntheticReason ?? "").not.toBe("");
    }
  });

  it("holds no credential, maintainer address or api_key parameter [ours]", async () => {
    const names = (await readdir(FIXTURE_DIR)).filter((n) =>
      n.endsWith(".json"),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const text = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      expect(text, `${name} contains the maintainer address`).not.toContain(
        MAINTAINER_EMAIL,
      );
      expect(text, `${name} contains an api_key parameter`).not.toMatch(
        /api[_-]?key\s*=/i,
      );
      expect(text, `${name} contains an Authorization header`).not.toMatch(
        /"authorization"\s*:/i,
      );
      expect(text, `${name} contains a Set-Cookie header`).not.toMatch(
        /"set-cookie"\s*:/i,
      );
      // `redact()` rather than `KEY_PATTERNS.test()`: the patterns carry /g and
      // so are stateful, and src/core/errors.ts forbids calling `.test()` on them.
      expect(redact(text), `${name} matches a credential pattern`).toBe(text);
    }
  });

  it("is fresh, and says what to do when it is not [ours]", async () => {
    const planned = (await plannedScenarios()).length;
    const report = await assertFixturesFresh(FIXTURE_DIR, Date.now());
    expect(report.checked).toBe(planned);
    expect(report.oldestDays).toBeLessThanOrEqual(FIXTURE_STALE_WARN_DAYS);
    expect(report.warnings).toEqual([]);

    // docs/13 §3.3 item 2's two thresholds, exercised by moving "now" rather
    // than by waiting a year.
    const day = 86_400_000;
    const warnAt = Date.now() + (FIXTURE_STALE_WARN_DAYS + 2) * day;
    const warned = await assertFixturesFresh(FIXTURE_DIR, warnAt);
    expect(warned.warnings.length).toBe(planned);
    expect(warned.warnings[0]).toContain(FIXTURE_RECORD_COMMAND);

    const failAt = Date.now() + (FIXTURE_STALE_FAIL_DAYS + 2) * day;
    await expect(assertFixturesFresh(FIXTURE_DIR, failAt)).rejects.toThrow(
      /never hand-edit a fixture/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Category 1 — the transmitted request
// ---------------------------------------------------------------------------

describe("1. request shape", () => {
  it("transmits the exact esearch request the fixture was recorded from [ours]", async () => {
    // The fixture name is a hash of {method, url, body}, so a resolved fixture
    // *is* proof that the adapter's URL is byte-identical to the recorder's.
    // This is the strongest request-shape assertion in the file.
    const { source, transport } = harness();
    const page = await source.search({ ...QUERY_EMPTY }, context());
    expect(page.records).toEqual([]);
    expect(transport.calls).toHaveLength(1);

    const sent = transport.calls[0]?.url ?? "";
    const recorded = plannedRequest("search-empty").url;
    expect(sent).toBe(recorded);
    expect(fixtureKey({ method: "GET", url: sent })).toBe(
      fixtureKey({ method: "GET", url: recorded }),
    );
  });

  it("carries the date filter, retmode and paging parameters NCBI documents [ours]", () => {
    const url = esearchUrlFor(QUERY_TYPICAL, 20, 0);
    const params = new URL(url).searchParams;
    expect(params.get("db")).toBe("pubmed");
    expect(params.get("retmode")).toBe("json");
    expect(params.get("retmax")).toBe("20");
    expect(params.get("retstart")).toBe("0");
    // docs/02 §3.3: mindate and maxdate are "both required together", in
    // YYYY/MM/DD, and §3.3 defaults datetype to edat rather than pdat.
    expect(params.get("datetype")).toBe("edat");
    expect(params.get("mindate")).toBe("2023/01/01");
    expect(params.get("maxdate")).toBe("2023/03/31");
  });

  it("sends tool and the maintainer address on every request, and never a key [ours]", async () => {
    const { source, transport } = harness();
    await source.search({ ...QUERY_EMPTY }, context());
    const pages = await paginate();
    expect(pages.calls.length).toBeGreaterThan(1);

    for (const call of [...transport.calls, ...pages.calls]) {
      const url = new URL(call.url);
      expect(url.host).toBe(NCBI_HOST);
      // Decision D10 and NBK25497: the maintainer address, unconditionally.
      expect(url.searchParams.get("tool")).toBe(TOOL_NAME);
      expect(url.searchParams.get("email")).toBe(MAINTAINER_EMAIL);
      // docs/02 §3.1 makes the key optional; no key is configured and none is
      // sent, which is also what keeps the fixture hashes reachable.
      expect(url.searchParams.has("api_key")).toBe(false);
      expect(call.options.body ?? "").not.toMatch(/api_key/i);
      // docs/02 §2.2's one User-Agent, on every request to every host.
      const ua = call.options.headers?.["User-Agent"] ?? "";
      expect(ua).toMatch(
        /^research_helper\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/suppakoko\/research_helper; mailto:suppakoko@gmail\.com\)$/,
      );
    }
  });

  it("asks efetch for retmode=xml and rettype=abstract, batched at 200 [ours]", () => {
    const built = buildEfetchRequest(RECORD_PMIDS.rich);
    const params = new URL(built.url).searchParams;
    // docs/02 §3.4: retmode=xml "is the only mode that yields structured
    // abstracts, MeSH headings, and the full ID list", and retmode=json is not
    // supported for PubMed efetch at all.
    expect(params.get("retmode")).toBe("xml");
    expect(params.get("rettype")).toBe("abstract");
    expect(params.get("db")).toBe("pubmed");
    expect(params.get("id")).toBe(RECORD_PMIDS.rich.join(","));
    expect(built.method).toBe("GET");

    // §3.4's batch limit, enforced rather than silently split.
    expect(() =>
      buildEfetchRequest(Array.from({ length: 201 }, (_, i) => String(i + 1))),
    ).toThrow(RangeError);
  });

  it("never asks for a retstart past the 9,998 ceiling [ours]", async () => {
    const { source, transport } = harness();
    // docs/02 §3.3's hard constraint. There is no fixture for the clamped
    // request, so the call fails — the assertion is on what went out.
    await expect(
      source.search(
        { ...QUERY_TYPICAL, limit: PAGE_SIZE, cursor: "99999" },
        context(),
      ),
    ).rejects.toThrow(/Missing fixture/);
    const sent = new URL(transport.calls[0]?.url ?? "https://x.invalid");
    expect(sent.searchParams.get("retstart")).toBe(String(PUBMED_RETSTART_MAX));
  });
});

// ---------------------------------------------------------------------------
// 5. Category 2 — parser snapshots
// ---------------------------------------------------------------------------

describe("2. parser snapshot — esearch", () => {
  it("still answers with count, idlist, translationset and querytranslation [service]", async () => {
    const body = await bodyOf("search-typical");
    const envelope = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(["esearchresult", "header"]);
    const result = envelope["esearchresult"] as Record<string, unknown>;
    // docs/02 §3.3's documented members. A rename here is the service moving.
    for (const key of [
      "count",
      "retmax",
      "retstart",
      "idlist",
      "translationset",
      "querytranslation",
    ]) {
      expect(Object.keys(result), `esearchresult.${key} is gone`).toContain(
        key,
      );
    }
    // §3.3: count arrives as a *string*, not a number.
    expect(typeof result["count"]).toBe("string");
    expect(Array.isArray(result["idlist"])).toBe(true);
  });

  it("maps the typical page to 20 PMIDs, a count and the MeSH expansion [both]", async () => {
    const { body, url } = await fetchScenario("search-typical");
    const parsed = parseEsearchBody(body, url);
    expect(parsed.pmids).toHaveLength(20);
    expect(parsed.pmids.every((id) => /^\d+$/u.test(id))).toBe(true);
    expect(parsed.pmids[0]).toBe("39086673");
    expect(parsed.extras.count).toBe(840);
    // docs/02 §3.3: "PubMed automatically expands terms into MeSH. This is free
    // query expansion the plugin gets for nothing." Both rendered terms were
    // expanded, and the window arrives back in NCBI's own spelling.
    expect(parsed.extras.translationset).toHaveLength(2);
    expect(parsed.extras.translationset[0]?.from).toBe("CRISPR[All Fields]");
    expect(parsed.extras.translationset[0]?.to).toContain(
      '"clustered regularly interspaced short palindromic repeats"[MeSH Terms]',
    );
    expect(parsed.extras.querytranslation).toContain(
      "2023/01/01:2023/03/31[Date - Entry]",
    );
  });

  it("maps a one-result page to a one-element list, not to a bare string [both]", async () => {
    const { body, url } = await fetchScenario("search-single");
    const parsed = parseEsearchBody(body, url);
    // docs/13 §3.1's reason for this row: off-by-one and "not an array" bugs.
    expect(parsed.pmids).toEqual(["39086673"]);
    expect(parsed.extras.count).toBe(840);
  });
});

describe("2. parser snapshot — efetch", () => {
  it("still sends the elements the mapper reads, in record-rich [service]", async () => {
    const body = await bodyOf("record-rich");
    // Every one of these is an XPath the mapper depends on. NCBI renaming any
    // of them breaks the mapper, and this is where that shows up first.
    for (const marker of [
      "<PubmedArticleSet>",
      "<PubmedArticle>",
      "<MedlineCitation ",
      '<PMID Version="1">37258680</PMID>',
      "<ArticleTitle>",
      "<Abstract>",
      "<AbstractText>",
      '<ELocationID EIdType="doi"',
      '<ArticleId IdType="pmc">',
      '<ArticleId IdType="doi">',
      "<MeshHeadingList>",
      "<DescriptorName ",
      'MajorTopicYN="Y"',
      '<Identifier Source="ORCID">',
      '<PubMedPubDate PubStatus="pubmed">',
      "<ISOAbbreviation>",
      "<MedlinePgn>",
    ]) {
      expect(body, `record-rich no longer contains ${marker}`).toContain(
        marker,
      );
    }
    // §3.4 note 3: numeric character references "appear routinely".
    expect(body).toContain("&#x2009;");
  });

  it("maps record-rich to the committed canonical snapshot [both]", async () => {
    const { mapRecords } = harness();
    const { body } = await fetchScenario("record-rich");
    const records = mapRecords(body);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toBeDefined();
    if (record === undefined) return;

    expect(record.id).toBe("pubmed:37258680");
    expect(record.sourceId).toBe("pubmed");
    expect(record.nativeId).toBe("37258680");
    // P1-T11's Do NOT: frozen clock, so the timestamp is assertable.
    expect(record.retrievedAtEpochMs).toBe(FROZEN_NOW_EPOCH_MS);
    // NFR-7: the body is not retained unless logRequestBodies is on.
    expect(record.raw).toBeUndefined();

    const work = record.work;
    expect(work.ids).toEqual({
      pmid: "37258680",
      doi: "10.1038/s41586-023-06139-9",
      pmcid: "PMC10949956",
    });
    expect(work.type).toBe("journal-article");
    expect(work.title).toBe(
      "Transfer learning enables predictions in network biology",
    );
    expect(work.containerTitle).toBe("Nature");
    expect(work.containerAbbreviation).toBe("Nature");
    expect(work.volume).toBe("618");
    expect(work.issue).toBe("7965");
    expect(work.pages).toBe("616-624");
    expect(work.issn).toEqual(["1476-4687"]);
    expect(work.language).toBe("eng");
    // §3.4 note 4: PubmedData/History/PubMedPubDate[@PubStatus='pubmed'] is
    // preferred over JournalIssue/PubDate, which here is only Year + Month.
    expect(work.publishedDate).toEqual({
      year: 2023,
      month: 6,
      day: 1,
      iso: "2023-06-01",
    });
    expect(work.authors).toHaveLength(11);
    expect(work.authors[0]?.family).toBe("Theodoris");
    expect(work.authors[0]?.given).toBe("Christina V");
    expect(work.authors[0]?.orcid).toBe("0000-0003-1658-1447");
    expect(work.authors[10]?.family).toBe("Ellinor");
    // §3.4 note 6: DescriptorName@UI is the stable id and MajorTopicYN marks
    // the topics worth profiling on.
    expect(work.subjects?.map((s) => s.term)).toEqual([
      "Humans",
      "Biology",
      "Machine Learning",
      "Neural Networks, Computer",
      "Single-Cell Gene Expression Analysis",
      "Datasets as Topic",
      "Chromatin",
      "Cardiomyopathies",
    ]);
    expect(work.subjects?.[1]).toEqual({
      term: "Biology",
      scheme: "mesh",
      id: "D001695",
      isMajor: true,
    });
    expect(work.subjects?.filter((s) => s.isMajor)).toHaveLength(3);
    expect(record.missingFields).toEqual(["keywords"]);

    // §3.4 note 2: inline markup is read through textContent, so the source's
    // `<sup>1,2</sup>` arrives as text and is never re-escaped.
    expect(work.abstract).toContain("natural language understanding1,2");
    expect(work.abstract).not.toContain("<sup>");
    // §3.4 note 3, end to end: `&#x2009;` is a thin space, which is not ASCII
    // whitespace and so survives the mapper's whitespace squash.
    expect(work.abstract).toContain("about 30 million");
    expect(work.abstract).toHaveLength(1556);
  });

  it("maps record-sparse to a record with no abstract and no DOI [both]", async () => {
    const { mapRecords } = harness();
    const { body } = await fetchScenario("record-sparse");
    const records = mapRecords(body);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (record === undefined) throw new Error("no record");

    // docs/02 §3.4 note 5: "many records have no <Abstract> at all".
    expect(body).not.toContain("<Abstract>");
    expect(body).not.toContain('IdType="doi"');
    expect(record.work.abstract).toBeUndefined();
    expect(record.work.ids).toEqual({ pmid: "60000" });
    expect(record.work.title).toBe("[Measures in ovine psoroptic mange]");
    expect(record.work.language).toBe("rus");
    // §3.1's reason for this row: the gaps must be *reported*, not silent.
    expect(record.missingFields).toEqual([
      "abstract",
      "volume",
      "keywords",
      "ids.doi",
      "ids.pmcid",
    ]);
    // The JournalIssue/PubDate here is Year + Month only; the mapper still
    // produces a full date because §3.4 note 4 prefers the History entry.
    expect(body).toContain("<Year>1976</Year><Month>Jun</Month>");
    expect(record.work.publishedDate).toEqual({
      year: 1976,
      month: 6,
      day: 1,
      iso: "1976-06-01",
    });
  });

  it("keeps non-ASCII through the whole path, in record-unicode [both]", async () => {
    const { mapRecords } = harness();
    const { body } = await fetchScenario("record-unicode");
    const records = mapRecords(body);
    expect(records).toHaveLength(3);

    // What the *service* sends: CJK and Greek arrive as numeric character
    // references, never as raw UTF-8 bytes. That is a property of NCBI's
    // serializer and the reason §3.4 note 3 insists on a real XML parser.
    expect(body).toMatch(/&#x[4-9][0-9a-f]{3};/u); // CJK ideographs
    expect(body).toContain("&#x3b2;"); // Greek small beta
    expect(body).toContain("<VernacularTitle>");

    // Latin-Extended diacritics inside author names, decoded.
    const diacritic = records[2];
    if (diacritic === undefined) throw new Error("no third record");
    expect(diacritic.work.authors.map((a) => a.family)).toEqual([
      "Aracı",
      "Aslan",
    ]);
    expect(diacritic.work.authors[0]?.given).toBe("Ayça");
    expect(diacritic.work.authors[1]?.given).toBe("Ummuhan Baş");

    // §3.1's "a title with subscripts/superscripts": `VO <sub>2max</sub>`
    // flattens to text and the italic genus name loses its markup.
    const subscript = records[1];
    if (subscript === undefined) throw new Error("no second record");
    expect(subscript.work.title).toContain("VO 2max");
    expect(subscript.work.title).toContain("( Withania somnifera)");
    expect(subscript.work.title).not.toContain("<");

    // A `<b>` inside an ArticleTitle, likewise flattened rather than dropped.
    const cjk = records[0];
    if (cjk === undefined) throw new Error("no first record");
    expect(cjk.work.title).toBe(
      "Role in post-translational modification of M2-type pyruvate kinase " +
        "in tumorigenesis and development",
    );
    expect(cjk.work.keywords).toEqual([
      "M2-type pyruvate kinase",
      "protein kinase activity",
      "protein post-translational modification",
      "pyruvate kinase activity",
      "tumor",
    ]);
  });

  it("concatenates a structured abstract as Label: text [both]", async () => {
    const { mapRecords } = harness();
    const { body } = await fetchScenario("record-jats-abstract");
    // What the service sends: several AbstractText elements with Label and
    // NlmCategory attributes (docs/02 §3.4 note 1).
    expect(body.match(/<AbstractText /gu)).toHaveLength(5);
    expect(body).toContain('<AbstractText Label="BACKGROUND">');
    // Measured 2026-10-07: this record carries `Label` and **no**
    // `NlmCategory`, although docs/02 §3.4 note 1 describes the two together
    // ("multiple `<AbstractText>` elements with `Label=` and `NlmCategory=`
    // attributes"). So `NlmCategory` is optional in practice and the mapper
    // must key on `Label` alone, which it does. Asserted rather than noted, so
    // that a future NCBI change in either direction is visible here.
    expect(body).not.toContain("NlmCategory");
    expect(body).toContain("<sup>");

    const records = mapRecords(body);
    const record = records[0];
    if (record === undefined) throw new Error("no record");
    const abstract = record.work.abstract ?? "";
    // §3.4 note 1: `"{Label}: {text}"` joined by `\n\n`.
    expect(abstract.split("\n\n")).toHaveLength(5);
    expect(abstract.startsWith("BACKGROUND: Plai or Zingiber cassumunar")).toBe(
      true,
    );
    expect(abstract).toContain("\n\nMETHODS: A RCT was conducted");
    expect(abstract).toContain("\n\nRESULTS: At the end of week two");
    expect(abstract).toContain("\n\nCONCLUSIONS: Zingiber cassumunar balm");
    expect(abstract).toContain(
      "\n\nREGISTRATION: Registered with the Thai Clinical Trials Registry",
    );
    // `<sup>nd</sup>` flattened inside the body text, not stripped.
    expect(abstract).toContain("2 nd and 4 th weeks");
    expect(abstract).not.toContain("<sup>");
    expect(record.work.title).not.toContain("<i>");
  });
});

// ---------------------------------------------------------------------------
// 6. Category 3 — typed errors
// ---------------------------------------------------------------------------

describe("3. typed errors", () => {
  it("turns a 429 with Retry-After into RateLimitError and parks the host [ours]", async () => {
    const { client, limiter, clock, transport, slept } = harness();
    const planned = plannedRequest("error-429");
    // docs/02 §3.8 row 1. The fixture is hand-written: §3.1 quotes NCBI's IP
    // block warning, so the real limit is never provoked. Status and
    // Retry-After are therefore the only assertable parts, and they are what
    // src/core/http/client.ts classifies on.
    const error = await client
      .request("GET", planned.url, { responseType: "text" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    if (error instanceof RateLimitError) {
      expect(error.retryAfterMs).toBe(2000);
      expect(error.messageKey).toBe("rh-error-rate-limit");
    }
    // Item 228 (2026-10-20): the harness now carries the shipped retry
    // policy, so the one request is docs/07 §7.3's three attempts on the
    // eutils row — three reads of the fixture, two waits of exactly the
    // Retry-After, and the last 429 is what the caller sees. This test used
    // to issue the request twice and assert only "more than zero" penalties.
    expect(transport.calls).toHaveLength(3);
    expect(slept).toStrictEqual([2000, 2000]);
    // docs/07 §7.3: "Any 429 or 503 with Retry-After calls
    // limiter.penalize(...), which parks every waiter on that host." Once
    // per attempt, each at the frozen clock + 2 s.
    expect(limiter.penalties).toHaveLength(3);
    for (const penalty of limiter.penalties) {
      expect(penalty.untilEpochMs).toBe(clock.now() + 2000);
    }
  });

  it("turns a 500 into UpstreamServerError, not an exception [ours]", async () => {
    const { client, transport, slept } = harness();
    const planned = plannedRequest("error-500");
    // docs/02 §3.8 row 4. Hand-written for the same reason as the 429.
    await expect(
      client.request("GET", planned.url, { responseType: "text" }),
    ).rejects.toBeInstanceOf(UpstreamServerError);
    // Item 228: retried to the eutils row's cap of 3, with no Retry-After, so
    // the waits are the jitter's — base, then the top of `[base, 3 × base]`
    // with the harness's pinned draw.
    expect(transport.calls).toHaveLength(3);
    expect(slept).toStrictEqual([1000, 3000]);
  });

  it("turns a truncated efetch body into ParseError, not zero results [both]", async () => {
    const { mapRecords } = harness();
    const { body, status } = await fetchScenario("error-malformed");
    // A real response, cut short: the first 1,024 bytes of record-rich, which
    // stops inside an element. Status 200, so nothing upstream flags it.
    expect(status).toBe(200);
    expect(body).toContain("<PubmedArticleSet>");
    expect(body).not.toContain("</PubmedArticleSet>");
    // The failure mode this guards: a truncated body must never look like an
    // empty result set.
    expect(() => mapRecords(body)).toThrow(ParseError);
    expect(() => mapRecords(body)).toThrow(/not well-formed XML/);
  });

  it("turns esearchresult.ERROR inside a 200 into SourceError, not an empty page [both]", async () => {
    const { body, url, status } = await fetchScenario("search-error-upstream");
    expect(status).toBe(200);
    // docs/02 §3.8 row 2 and §3.3's implication: "the adapter must detect
    // esearchresult.ERROR and fail loudly rather than silently returning zero
    // results". The body is read out of docs/02 §3.3 at test time and compared
    // byte for byte with the fixture, so neither can drift unnoticed — the
    // pattern P1-T10 established for the §3.4 sample.
    expect(body).toBe(await readDocs02ErrorBody());
    expect(() => parseEsearchBody(body, url)).toThrow(SourceError);
    try {
      parseEsearchBody(body, url);
      expect.unreachable("parseEsearchBody must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      if (error instanceof SourceError) {
        expect(error).not.toBeInstanceOf(ParseError);
        expect(error.messageKey).toBe("rh-error-source");
        expect(error.message).toContain(
          "'retstart' cannot be larger than 9998",
        );
      }
    }
  });

  it("records that retstart=9999 no longer returns an ERROR at all [service]", async () => {
    const { body, url } = await fetchScenario("search-error-retstart");
    const parsed = parseEsearchBody(body, url);
    // Measured 2026-10-07: docs/02 §3.3's "Verified live — retstart=9999
    // returns an error inside an HTTP 200" does not reproduce. NCBI clamps the
    // window and answers with a *warning* instead, so the body that used to
    // prove §3.8 row 2 now proves the opposite. This assertion is the one that
    // will fail if NCBI ever restores the old behaviour, which is exactly what
    // a contract test is for.
    expect(body).not.toContain('"ERROR"');
    expect(parsed.pmids).toEqual([]);
    expect(parsed.extras.count).toBe(840);
    const warnings = (
      JSON.parse(body) as {
        esearchresult: { warninglist?: { outputmessages?: string[] } };
      }
    ).esearchresult.warninglist?.outputmessages;
    expect(warnings).toEqual([
      "Restrictions achieved. start and count adjusted to 9999, 0",
    ]);
  });

  it("treats an unknown PMID as an empty article set, not as a failure [both]", async () => {
    const { mapRecords } = harness();
    const { body, status } = await fetchScenario("record-unknown-pmid");
    // docs/02 §3.8 row 3: "Unknown PMID in efetch → Empty
    // <PubmedArticleSet/>, HTTP 200".
    expect(status).toBe(200);
    expect(body).toContain("<PubmedArticleSet></PubmedArticleSet>");
    expect(mapRecords(body)).toEqual([]);
  });

  it("returns an empty page for zero hits, and issues no efetch [both]", async () => {
    const { source, transport } = harness();
    const page = await source.search({ ...QUERY_EMPTY }, context());
    expect(page.records).toEqual([]);
    expect(page.totalAvailable).toBe(0);
    expect(page.nextCursor).toBeUndefined();
    expect(page.warnings).toEqual([]);
    expect(page.sourceExtras.count).toBe(0);
    // One request, not two: an empty idlist must not provoke an efetch.
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toContain("esearch.fcgi");
  });
});

// ---------------------------------------------------------------------------
// 7. Category 4 — pagination
// ---------------------------------------------------------------------------

/** Walk the two recorded pages by following `nextCursor`, as a caller would. */
async function paginate() {
  const { source, transport } = harness();
  const first = await source.search(
    { ...QUERY_TYPICAL, limit: PAGE_SIZE },
    context(),
  );
  const cursor = first.nextCursor;
  if (cursor === undefined) throw new Error("page 1 offered no cursor");
  const second = await source.search(
    { ...QUERY_TYPICAL, limit: PAGE_SIZE, cursor },
    context(),
  );
  return { first, second, calls: transport.calls };
}

describe("4. pagination", () => {
  it("follows nextCursor to a second page of distinct records [both]", async () => {
    const { first, second, calls } = await paginate();

    expect(first.records).toHaveLength(PAGE_SIZE);
    expect(first.totalAvailable).toBe(840);
    expect(first.nextCursor).toBe(String(PAGE_SIZE));
    expect(second.records).toHaveLength(PAGE_SIZE);
    expect(second.nextCursor).toBe(String(PAGE_SIZE * 2));

    const ids = [...first.records, ...second.records].map((r) => r.nativeId);
    expect(ids).toHaveLength(PAGE_SIZE * 2);
    expect(new Set(ids).size).toBe(PAGE_SIZE * 2);
    expect(ids).toEqual([
      "39086673",
      "36997768",
      "36997683",
      "36997680",
      "36997536",
      "36997524",
    ]);

    // One esearch and one efetch per page: four requests, in that order.
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/entrez/eutils/esearch.fcgi",
      "/entrez/eutils/efetch.fcgi",
      "/entrez/eutils/esearch.fcgi",
      "/entrez/eutils/efetch.fcgi",
    ]);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("retstart")).toBe("0");
    expect(new URL(calls[2]?.url ?? "").searchParams.get("retstart")).toBe(
      String(PAGE_SIZE),
    );
    // The second page's efetch asks for exactly the second page's identifiers.
    expect(new URL(calls[3]?.url ?? "").searchParams.get("id")).toBe(
      "36997680,36997536,36997524",
    );
  });

  it("stops searchAll at the limit instead of following the cursor [both]", async () => {
    const { source, transport } = harness();
    const yielded: string[] = [];
    for await (const record of source.searchAll(
      { ...QUERY_TYPICAL, limit: PAGE_SIZE },
      context(),
    )) {
      yielded.push(record.nativeId);
    }
    expect(yielded).toEqual(["39086673", "36997768", "36997683"]);
    // Page 1 offered a cursor — the other test asserts `nextCursor === "3"` for
    // the same request — and `searchAll` did not take it, because `emitted`
    // reached `limit`. Two requests, not four.
    expect(transport.calls).toHaveLength(2);
  });

  it("cannot exercise searchAll across two pages, and here is why [ours]", async () => {
    // Reported under plan/README.md §5 rule 6 rather than worked around.
    // `searchAll`'s page size is `Math.min(limit - emitted,
    // EFETCH_MAX_IDS_PER_CALL)` and that constant is 200 (docs/02 §3.4's batch
    // limit), so the generator takes a second page only for a limit above 200 —
    // which needs a 200-record `efetch` fixture, roughly two megabytes of
    // committed JSON for one assertion. docs/13 §3.1's `paginated` row is
    // therefore satisfied at the `search`/`nextCursor` level by the test above,
    // and `searchAll`'s multi-page path stays covered by the stubbed unit tests
    // in `test/unit/sources/pubmed-source.test.ts`.
    //
    // This test pins the arithmetic that makes that true, so the gap closes
    // itself the day the page size stops being 200.
    const { source, transport } = harness();
    await expect(
      source.search({ ...QUERY_TYPICAL, limit: 2 }, context()),
    ).rejects.toThrow(/^Missing fixture /);
    expect(
      new URL(transport.calls[0]?.url ?? "").searchParams.get("retmax"),
    ).toBe("2");
    expect(ERROR_RETSTART).toBeGreaterThan(PUBMED_RETSTART_MAX);
  });
});

// ---------------------------------------------------------------------------
// 8. A missing fixture
// ---------------------------------------------------------------------------

describe("a missing fixture", () => {
  it("fails with the command that records it, never a silent call [ours]", async () => {
    const planned = plannedRequest("record-sparse");
    const file = fixtureFileFor(FIXTURE_DIR, {
      method: planned.method,
      url: planned.url,
    });
    const hidden = `${file}.hidden`;
    await rename(file, hidden);
    try {
      const { client } = harness();
      await expect(
        client.request("GET", planned.url, { responseType: "text" }),
      ).rejects.toThrow(/^Missing fixture /);
      await client
        .request("GET", planned.url, { responseType: "text" })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "";
          // docs/13 §2.2: "a missing fixture is a test failure with the exact
          // command to record it".
          expect(message).toContain(FIXTURE_RECORD_COMMAND);
          expect(message).toContain("efetch.fcgi");
        });
    } finally {
      await rename(hidden, file);
    }
  });
});

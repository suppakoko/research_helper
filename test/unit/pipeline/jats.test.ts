import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  BadRequestError,
  OperationCancelledError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { validateAgainstSchema } from "../../../src/llm/shared/schemaValidate";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type { AcquiredSource } from "../../../src/model/summary";
import {
  acquireSource,
  buildMetadataOnlySummary,
  createLookupAbstractFetcher,
  createRunWriteBackConsent,
  readItemIdentifiers,
  summarizeOrStub,
  type AbstractRecovery,
  type AcquirableAttachment,
  type AcquirableItem,
  type EpmcTier3,
  type FullTextPort,
} from "../../../src/pipeline/summarize/acquire";
import {
  buildEpmcFullTextUrl,
  extractJats,
  fetchEpmcFullText,
  JatsParseError,
  tidyInlineText,
  type EpmcFullTextOutcome,
  type JatsDocumentLike,
  type JatsNode,
  type JatsNodeList,
} from "../../../src/pipeline/summarize/jats";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import { PROMPT_SCHEMAS } from "../../../src/prompts";
import type { LiteratureSource } from "../../../src/sources/types";
import { chatResponse, mockLLM } from "../../helpers/mockLLM";

/**
 * Tier 3 (`P3-T19` step 1): `docs/06` §3.4's element table over a synthetic
 * JATS fixture, the open-access gate in front of `fullTextXML`, and the
 * acquisition ladder that uses them — `fullText.preferJATS` (step 2), Tier 4's
 * no-LLM stub (step 6) and §13.1's recoveries (step 7), which live in
 * `acquire.ts` and have no test file of their own in the card's list.
 *
 * No network: every request goes to a recording fake `HttpClient`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = resolve(ROOT, "test/fixtures/fulltext");

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

// ---------------------------------------------------------------------------
// A small XML parser satisfying the JATS port (plain Node has no DOMParser)
// ---------------------------------------------------------------------------

interface TestNode extends JatsNode {
  readonly children: TestNode[];
}

function nodeList(nodes: TestNode[]): JatsNodeList {
  return {
    get length() {
      return nodes.length;
    },
    item: (index) => nodes[index] ?? null,
  };
}

function textOf(node: TestNode): string {
  if (node.nodeType !== 1) return node.textContent ?? "";
  return node.children.map(textOf).join("");
}

function element(
  qualifiedName: string,
  attributes: Record<string, string>,
): TestNode {
  const children: TestNode[] = [];
  const node: TestNode = {
    nodeType: 1,
    localName: qualifiedName.includes(":")
      ? (qualifiedName.split(":")[1] ?? qualifiedName)
      : qualifiedName,
    get textContent() {
      return textOf(node);
    },
    children,
    childNodes: nodeList(children),
    getAttribute: (name) => attributes[name] ?? null,
  };
  return node;
}

function textNode(text: string, nodeType = 3): TestNode {
  return {
    nodeType,
    localName: null,
    textContent: text,
    children: [],
    childNodes: nodeList([]),
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/** Gecko's answer to malformed XML: a `<parsererror>` root. */
function parserError(): JatsDocumentLike {
  return { documentElement: element("parsererror", {}) };
}

function parseXmlInNode(xml: string): JatsDocumentLike {
  const stack: TestNode[] = [];
  let root: TestNode | null = null;
  let i = 0;
  const append = (node: TestNode): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(node);
  };
  while (i < xml.length) {
    if (xml.startsWith("<?", i)) {
      i = xml.indexOf("?>", i) + 2;
    } else if (xml.startsWith("<!--", i)) {
      i = xml.indexOf("-->", i) + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i);
      append(textNode(xml.slice(i + 9, end), 4));
      i = end + 3;
    } else if (xml.startsWith("<!", i)) {
      i = xml.indexOf(">", i) + 1;
    } else if (xml.startsWith("</", i)) {
      const end = xml.indexOf(">", i);
      const name = xml.slice(i + 2, end).trim();
      const open = stack.pop();
      if (open === undefined) return parserError();
      const local = name.includes(":") ? name.split(":")[1] : name;
      if (open.localName !== local) return parserError();
      i = end + 1;
    } else if (xml[i] === "<") {
      const end = xml.indexOf(">", i);
      if (end === -1) return parserError();
      let body = xml.slice(i + 1, end);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/]+/u.exec(body)?.[0] ?? "";
      const attributes: Record<string, string> = {};
      for (const match of body.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/gu)) {
        attributes[match[1] ?? ""] = decodeEntities(match[2] ?? "");
      }
      const node = element(name, attributes);
      if (root === null) root = node;
      else append(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
    } else {
      const next = xml.indexOf("<", i);
      const end = next === -1 ? xml.length : next;
      if (stack.length > 0) append(textNode(decodeEntities(xml.slice(i, end))));
      i = end;
    }
  }
  if (stack.length > 0 || root === null) return parserError();
  return { documentElement: root };
}

// ---------------------------------------------------------------------------
// A recording HTTP client
// ---------------------------------------------------------------------------

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly options: HttpOptions | undefined;
}

type Responder = (request: RecordedRequest) => HttpResponse | Error;

function response(body: string, status = 200): HttpResponse {
  return { status, body } as unknown as HttpResponse;
}

function fakeHttp(responder: Responder): {
  http: Pick<HttpClient, "request">;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    http: {
      request(method, url, options) {
        const request = { method, url, options };
        requests.push(request);
        const answer = responder(request);
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
    },
  };
}

function searchBody(results: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    version: "6.9",
    hitCount: results.length,
    request: { queryString: "x" },
    resultList: { result: results },
  });
}

const OA_RECORD = {
  pmcid: "PMC0000001",
  doi: "10.5555/synthetic.0001",
  isOpenAccess: "Y",
  inEPMC: "Y",
};

const JATS_XML = fixture("jats-synthetic.xml");

/** Search answers with `record`; fullTextXML answers with the fixture. */
function epmcResponder(record: Record<string, unknown> | null): Responder {
  return ({ url }) => {
    if (url.includes("/fullTextXML")) return response(JATS_XML);
    return response(searchBody(record === null ? [] : [record]));
  };
}

// ---------------------------------------------------------------------------
// extractJats — docs/06 §3.4's element table
// ---------------------------------------------------------------------------

describe("extractJats (P3-T19 step 1, docs/06 §3.4)", () => {
  const extraction = extractJats(parseXmlInNode(JATS_XML));

  it("takes the main abstract, not the graphical one", () => {
    expect(extraction.abstract).toBe(
      "Widgets were counted weekly at three invented sites for one simulated year. " +
        "Counts rose by four per cent, and two observers agreed closely.",
    );
  });

  it("yields sectioned text: body sections in order, sec-type kept, the back's plain sec included", () => {
    expect(
      extraction.sections.map((section) => [section.secType, section.heading]),
    ).toEqual([
      [null, ""],
      ["intro", "Introduction"],
      ["methods", "Methods"],
      ["results", "Results"],
      ["discussion", "Discussion"],
      [null, "Abbreviations"],
    ]);
    expect(extraction.text).toContain(
      "Introduction\nWidget counting is a stand-in task with no real literature.",
    );
    expect(extraction.text.split("\n\n")).toHaveLength(6);
  });

  it("removes references, formulae, footnotes, the table body and every dropped section", () => {
    for (const marker of [
      "REFERENCE-MARKER",
      "FORMULA-INLINE-MARKER",
      "FORMULA-DISPLAY-MARKER",
      "TABLE-BODY-MARKER",
      "FOOTNOTE-MARKER",
      "FNGROUP-MARKER",
      "ACK-MARKER",
      "FUNDING-MARKER",
      "FUNDING-NESTED-MARKER",
      "CONFLICT-MARKER",
      "DATA-AVAILABILITY-MARKER",
      "SUPPLEMENT-SECTYPE-MARKER",
      "SUPPLEMENTARY-ELEMENT-MARKER",
      "GRAPHICAL-ABSTRACT-MARKER",
    ]) {
      expect(extraction.text, marker).not.toContain(marker);
    }
    // Funding (nested and top-level), conflict, supplementary sec-type, data availability.
    expect(extraction.droppedSections).toBe(5);
  });

  it("keeps figure and table captions, without their labels", () => {
    expect(extraction.text).toContain(
      "Weekly widget counts. Counts at the three invented sites over 52 weeks.",
    );
    expect(extraction.text).toContain("Observer agreement by site.");
    expect(extraction.text).not.toContain("Figure 1");
    expect(extraction.text).not.toContain("Table 1");
  });

  it("drops cross-references and the brackets they leave behind", () => {
    const intro = extraction.sections[1];
    expect(intro?.paragraphs).toEqual([
      "Widget counting is a stand-in task with no real literature. " +
        "Monthly counts hide short swings.",
    ]);
    const results = extraction.sections[3];
    expect(results?.paragraphs[0]).toBe("Counts rose by four per cent.");
  });

  it("keeps a formula's sentence, a nested section's title and paragraphs, lists and loose body text", () => {
    expect(extraction.text).toContain(
      "The agreement index was computed per site.",
    );
    expect(extraction.text).toContain(
      "Observers\nTwo observers counted every widget in a fixed square once a week.",
    );
    expect(extraction.text).toContain("The densest site swung the most.");
    expect(extraction.text).toContain("LOOSE-BODY-MARKER");
    expect(extraction.text).toContain(
      "A weekly series reveals swings a monthly series hides.",
    );
  });

  it("refuses a parse error and a non-article root", () => {
    expect(() => extractJats(parseXmlInNode("<article><p></article>"))).toThrow(
      JatsParseError,
    );
    expect(() => extractJats(parseXmlInNode("<html><body/></html>"))).toThrow(
      JatsParseError,
    );
  });

  it("tidyInlineText removes empty brackets and the space before punctuation", () => {
    expect(tidyInlineText("as shown [ , ] here ( ; ) and  there .")).toBe(
      "as shown here and there.",
    );
    expect(tidyInlineText("kept (n = 4) and [12]")).toBe(
      "kept (n = 4) and [12]",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchEpmcFullText — the open-access gate and the one shared client
// ---------------------------------------------------------------------------

describe("fetchEpmcFullText (P3-T19 step 1: the open-access gate)", () => {
  const deps = (http: Pick<HttpClient, "request">) => ({
    http,
    parseXml: parseXmlInNode,
  });

  it("makes no request at all without a PMCID or DOI", async () => {
    const { http, requests } = fakeHttp(epmcResponder(OA_RECORD));
    const outcome = await fetchEpmcFullText({ doi: "not a doi" }, deps(http));
    expect(outcome).toEqual({ kind: "unavailable", reason: "no_identifier" });
    expect(requests).toHaveLength(0);
  });

  it("never requests fullTextXML for a record that is not open access", async () => {
    for (const record of [
      { ...OA_RECORD, isOpenAccess: "N" },
      { ...OA_RECORD, inEPMC: "N" },
      { ...OA_RECORD, isOpenAccess: undefined },
    ]) {
      const { http, requests } = fakeHttp(epmcResponder(record));
      const outcome = await fetchEpmcFullText(
        { pmcid: "PMC0000001" },
        deps(http),
      );
      expect(outcome).toEqual({
        kind: "unavailable",
        reason: "not_open_access",
      });
      expect(
        requests.map((r) => r.url).some((u) => u.includes("fullTextXML")),
      ).toBe(false);
      expect(requests).toHaveLength(1);
    }
  });

  it("an open-access record: one core search, then fullTextXML, both through the one injected client", async () => {
    const { http, requests } = fakeHttp(epmcResponder(OA_RECORD));
    const outcome = await fetchEpmcFullText(
      { pmcid: "pmc0000001" },
      deps(http),
    );
    expect(outcome.kind).toBe("ok");
    expect(requests).toHaveLength(2);
    const [search, full] = requests;
    expect(search?.url).toContain("/europepmc/webservices/rest/search?");
    expect(search?.url).toContain(encodeURIComponent("PMCID:PMC0000001"));
    expect(search?.url).toContain("resultType=core");
    expect(full?.url).toBe(
      buildEpmcFullTextUrl(
        "PMC0000001" as Parameters<typeof buildEpmcFullTextUrl>[0],
      ),
    );
    for (const request of requests) {
      expect(new URL(request.url).host).toBe("www.ebi.ac.uk");
      expect(request.options?.responseType).toBe("text");
    }
  });

  it("looks a DOI-only item up by DOI and gates on the matching record", async () => {
    const { http, requests } = fakeHttp(epmcResponder(OA_RECORD));
    const outcome = await fetchEpmcFullText(
      { doi: "https://doi.org/10.5555/SYNTHETIC.0001" },
      deps(http),
    );
    expect(outcome.kind).toBe("ok");
    expect(decodeURIComponent(requests[0]?.url ?? "")).toContain(
      'DOI:"10.5555/synthetic.0001"',
    );
  });

  it("not found, a failed lookup, a 404 on fullTextXML and an unparseable body are outcomes, not throws", async () => {
    const notFound = await fetchEpmcFullText(
      { pmcid: "PMC0000001" },
      deps(fakeHttp(epmcResponder(null)).http),
    );
    expect(notFound).toEqual({ kind: "unavailable", reason: "not_found" });

    const lookupFailed = await fetchEpmcFullText(
      { pmcid: "PMC0000001" },
      deps(fakeHttp(() => new Error("socket hang up")).http),
    );
    expect(lookupFailed).toMatchObject({
      kind: "failed",
      reason: "lookup_failed",
    });

    const fetchFailed = await fetchEpmcFullText(
      { pmcid: "PMC0000001" },
      deps(
        fakeHttp(({ url }) =>
          url.includes("fullTextXML")
            ? new BadRequestError(404, "Not Found")
            : response(searchBody([OA_RECORD])),
        ).http,
      ),
    );
    expect(fetchFailed).toMatchObject({
      kind: "failed",
      reason: "fetch_failed",
    });

    const parseFailed = await fetchEpmcFullText(
      { pmcid: "PMC0000001" },
      deps(
        fakeHttp(({ url }) =>
          url.includes("fullTextXML")
            ? response("<html><body>not jats</body></html>")
            : response(searchBody([OA_RECORD])),
        ).http,
      ),
    );
    expect(parseFailed).toMatchObject({
      kind: "failed",
      reason: "parse_failed",
    });
  });

  it("rethrows cancellation", async () => {
    await expect(
      fetchEpmcFullText(
        { pmcid: "PMC0000001" },
        deps(
          fakeHttp(() => new OperationCancelledError({ kind: "user" })).http,
        ),
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

// ---------------------------------------------------------------------------
// The ladder with Tier 3, Tier 4 and the recoveries (acquire.ts)
// ---------------------------------------------------------------------------

const ABSTRACT =
  "BACKGROUND: Synthetic widgets were studied at three invented field sites. " +
  "METHODS: Widgets were counted weekly for one simulated year by two observers. " +
  "RESULTS: Counts rose by 4% (95% CI 2-6%) between the first and last quarter. " +
  "CONCLUSIONS: Widgets are countable, and the counts are stable between observers.";

const PDF_TEXT = fixture("two-column-synthetic.txt");

interface Item extends AcquirableItem {
  readonly abstract: string;
}

function item(abstract: string, key = "ITEMKEY1"): Item {
  return {
    key,
    libraryID: 1,
    abstract,
    getField: () => abstract,
  };
}

function port(options: { attachment?: boolean } = {}): {
  port: FullTextPort<Item, AcquirableAttachment>;
  reads: { count: number };
} {
  const reads = { count: 0 };
  return {
    reads,
    port: {
      pickTextAttachment: () =>
        Promise.resolve(
          options.attachment === false ? null : { id: 7, key: "ATTKEY01" },
        ),
      getIndexedState: () => Promise.resolve(3),
      isPartialIndexState: () => false,
      getIndexedPageCounts: () => Promise.resolve(null),
      getAttachmentText: () => {
        reads.count += 1;
        return Promise.resolve(PDF_TEXT);
      },
      getFullTextAllPages: () => Promise.reject(new Error("not used")),
      getFullTextFirstPages: () => Promise.reject(new Error("not used")),
      md5Hex: () => "0".repeat(32),
    },
  };
}

function tier3(outcome: () => Promise<EpmcFullTextOutcome>): EpmcTier3 & {
  calls: number;
} {
  const tier = {
    calls: 0,
    identifiers: { pmcid: "PMC0000001" },
    fetch: () => {
      tier.calls += 1;
      return outcome();
    },
  };
  return tier;
}

const OK_OUTCOME = (): Promise<EpmcFullTextOutcome> =>
  Promise.resolve({
    kind: "ok",
    pmcid: "PMC0000001" as never,
    extraction: extractJats(parseXmlInNode(JATS_XML)),
  });

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

afterEach(() => {
  setPrefStore(undefined);
});

describe("acquireSource with Tier 3 (P3-T19 step 2, D-06-1)", () => {
  it("fullText.preferJATS = true with an OA item and a local PDF selects Tier 3 and never opens the PDF", async () => {
    setPrefStore(
      createMemoryPrefStore({ [PREF_KEYS.fullTextPreferJATS]: true }),
    );
    const { port: p, reads } = port();
    const epmc = tier3(OK_OUTCOME);
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens, epmc },
      p,
    );
    expect(source.tier).toBe("fulltext_epmc");
    expect(epmc.calls).toBe(1);
    expect(reads.count).toBe(0);
    expect(source.attachmentKey).toBeNull();
    expect(source.text.startsWith(`${ABSTRACT}\n\n`)).toBe(true);
    expect(source.text).toContain("Observer agreement by site.");
  });

  it("fullText.preferJATS = false with the same item selects Tier 2 and never asks Europe PMC", async () => {
    setPrefStore(
      createMemoryPrefStore({ [PREF_KEYS.fullTextPreferJATS]: false }),
    );
    const { port: p, reads } = port();
    const epmc = tier3(OK_OUTCOME);
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens, epmc },
      p,
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(epmc.calls).toBe(0);
    expect(reads.count).toBe(1);
    expect(source.attachmentKey).toBe("ATTKEY01");
  });

  it("falls back to Tier 2 on any Tier 3 failure, with epmc_fulltext_failed", async () => {
    const { port: p } = port();
    const epmc = tier3(() =>
      Promise.resolve({
        kind: "failed",
        reason: "fetch_failed",
        error: new Error("404"),
      }),
    );
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens, epmc },
      p,
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.warnings).toContain("epmc_fulltext_failed");
  });

  it("an unavailable Tier 3 falls back without a warning", async () => {
    const { port: p } = port();
    const epmc = tier3(() =>
      Promise.resolve({ kind: "unavailable", reason: "not_open_access" }),
    );
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens, epmc },
      p,
    );
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.warnings).not.toContain("epmc_fulltext_failed");
  });

  it("with preferJATS off and no local PDF, Tier 3 still applies (docs/06 §13.1 recovery 2)", async () => {
    setPrefStore(
      createMemoryPrefStore({ [PREF_KEYS.fullTextPreferJATS]: false }),
    );
    const { port: p } = port({ attachment: false });
    const epmc = tier3(OK_OUTCOME);
    const source = await acquireSource(item(""), { estimateTokens, epmc }, p);
    expect(source.tier).toBe("fulltext_epmc");
    expect(epmc.calls).toBe(1);
  });

  it("uses the JATS abstract as the preamble when the item has none", async () => {
    setPrefStore(
      createMemoryPrefStore({ [PREF_KEYS.summaryMinAbstractChars]: 50 }),
    );
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(
      item(""),
      { estimateTokens, epmc: tier3(OK_OUTCOME) },
      p,
    );
    expect(source.abstract).toBe(
      "Widgets were counted weekly at three invented sites for one simulated year. " +
        "Counts rose by four per cent, and two observers agreed closely.",
    );
    expect(source.text.startsWith(`${source.abstract ?? ""}\n\n`)).toBe(true);
  });

  it("includeFullText: false tries neither Tier 2 nor Tier 3", async () => {
    const { port: p, reads } = port();
    const epmc = tier3(OK_OUTCOME);
    const source = await acquireSource(
      item(ABSTRACT),
      { estimateTokens, epmc, includeFullText: false },
      p,
    );
    expect(source.tier).toBe("abstract");
    expect(epmc.calls + reads.count).toBe(0);
  });
});

describe("Tier 4 (P3-T19 step 6, docs/06 §3.5)", () => {
  it("an item with no abstract and no attachment yields a stub with zero mockLLM calls", async () => {
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(item(""), { estimateTokens }, p);
    expect(source.tier).toBe("metadata_only");

    const provider = mockLLM([chatResponse("{}")]);
    let llmPathEntered = 0;
    const result = await summarizeOrStub(source, async () => {
      llmPathEntered += 1;
      return provider.chat({} as never, {} as never);
    }, ["Widgets", "widgets", " field work "]);
    expect(llmPathEntered).toBe(0);
    expect(provider.calls).toHaveLength(0);
    expect(result.kind).toBe("stub");
    if (result.kind !== "stub") return;
    expect(result.summary).toMatchObject({
      sourceTier: "metadata_only",
      confidence: "none",
      researchQuestion: null,
      novelty: null,
      researchTheme: null,
      studyDesign: { label: null, detail: null },
      population: { kind: null, description: null, size: null },
      keywords: ["widgets", "field work"],
    });
  });

  it("the stub validates against the PaperSummary v1 schema", () => {
    const stub = buildMetadataOnlySummary(
      {
        itemKey: "ABCD1234",
        libraryID: 1,
        tier: "metadata_only",
      } as AcquiredSource,
      ["x".repeat(61), ...Array.from({ length: 20 }, (_, i) => `tag ${i}`)],
    );
    const schema = PROMPT_SCHEMAS["paper-summary.v1.json"];
    expect(schema).toBeDefined();
    const result = validateAgainstSchema(stub, schema ?? {});
    expect(result.errors).toEqual([]);
    expect(stub.keywords).toHaveLength(12);
  });

  it("any other tier goes to the model, and a stub is refused for it", async () => {
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(item(ABSTRACT), { estimateTokens }, p);
    let calls = 0;
    const result = await summarizeOrStub(source, () => {
      calls += 1;
      return Promise.resolve("summary");
    });
    expect(result).toEqual({ kind: "summarized", summary: "summary" });
    expect(calls).toBe(1);
    expect(() => buildMetadataOnlySummary(source)).toThrow(RangeError);
  });
});

describe("§13.1 recovery 1 and the one-per-run consent (P3-T19 step 7)", () => {
  function recovery(
    answer: boolean,
    asks: { count: number },
    written: string[],
    fetched: string | null | Error = ABSTRACT,
  ): AbstractRecovery<Item> {
    return {
      fetchAbstract: () =>
        fetched instanceof Error
          ? Promise.reject(fetched)
          : Promise.resolve(fetched),
      consent: createRunWriteBackConsent(() => {
        asks.count += 1;
        return Promise.resolve(answer);
      }),
      writeBack: (target, abstract) => {
        written.push(`${target.key}:${abstract}`);
        return Promise.resolve();
      },
    };
  }

  it("a recovered abstract makes the item Tier 1, and is written back only after consent", async () => {
    const asks = { count: 0 };
    const written: string[] = [];
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(
      item(""),
      { estimateTokens, recovery: recovery(true, asks, written) },
      p,
    );
    expect(source.tier).toBe("abstract");
    expect(source.text).toBe(ABSTRACT);
    expect(source.warnings).toEqual([
      "abstract_recovered",
      "abstract_written_back",
    ]);
    expect(written).toEqual([`ITEMKEY1:${ABSTRACT}`]);
    expect(asks.count).toBe(1);
  });

  it("without consent nothing is written, and the abstract is still used", async () => {
    const asks = { count: 0 };
    const written: string[] = [];
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(
      item(""),
      { estimateTokens, recovery: recovery(false, asks, written) },
      p,
    );
    expect(source.tier).toBe("abstract");
    expect(written).toEqual([]);
    expect(source.warnings).toEqual(["abstract_recovered"]);
  });

  it("asks once per run however many items recover, concurrently or not", async () => {
    const asks = { count: 0 };
    const written: string[] = [];
    const shared = recovery(true, asks, written);
    const { port: p } = port({ attachment: false });
    await Promise.all(
      ["AAAAAAA1", "AAAAAAA2", "AAAAAAA3"].map((key) =>
        acquireSource(item("", key), { estimateTokens, recovery: shared }, p),
      ),
    );
    await acquireSource(
      item("", "AAAAAAA4"),
      { estimateTokens, recovery: shared },
      p,
    );
    expect(asks.count).toBe(1);
    expect(written).toHaveLength(4);
  });

  it("never asks when nothing was recovered, and never refetches an item that has text", async () => {
    const asks = { count: 0 };
    const written: string[] = [];
    let fetches = 0;
    const base = recovery(true, asks, written, null);
    const counting: AbstractRecovery<Item> = {
      ...base,
      fetchAbstract: (target) => {
        fetches += 1;
        return base.fetchAbstract(target);
      },
    };
    const { port: none } = port({ attachment: false });
    const empty = await acquireSource(
      item(""),
      { estimateTokens, recovery: counting },
      none,
    );
    expect(empty.tier).toBe("metadata_only");
    expect(asks.count).toBe(0);
    const { port: pdf } = port();
    await acquireSource(item(""), { estimateTokens, recovery: counting }, pdf);
    expect(fetches).toBe(1);
  });

  it("a failed refetch is a warning, not a throw", async () => {
    const { port: p } = port({ attachment: false });
    const source = await acquireSource(
      item(""),
      {
        estimateTokens,
        recovery: recovery(true, { count: 0 }, [], new Error("offline")),
      },
      p,
    );
    expect(source.tier).toBe("metadata_only");
    expect(source.warnings).toEqual(["abstract_recovery_failed"]);
  });

  it("a rejected consent question counts as no and is not asked again", async () => {
    let asks = 0;
    const consent = createRunWriteBackConsent(() => {
      asks += 1;
      return Promise.reject(new Error("dialog closed"));
    });
    expect(await consent.allowed()).toBe(false);
    expect(await consent.allowed()).toBe(false);
    expect(asks).toBe(1);
  });

  it("createLookupAbstractFetcher asks each source with the identifiers it accepts, first abstract wins", async () => {
    const seen: string[] = [];
    const source = (
      lookupById: LiteratureSource["capabilities"]["lookupById"],
      name: string,
      abstract: string | undefined,
    ): Pick<LiteratureSource, "capabilities" | "lookup"> => ({
      capabilities: { lookupById } as LiteratureSource["capabilities"],
      lookup: (ids) => {
        seen.push(`${name}:${JSON.stringify(ids)}`);
        return Promise.resolve([
          { work: abstract === undefined ? {} : { abstract } } as SourceRecord,
        ]);
      },
    });
    const fetch = createLookupAbstractFetcher<Item>(
      [
        source([], "none", "never"),
        source(["pmid"], "pmidOnly", "never"),
        source(["doi"], "doiEmpty", undefined),
        source(["doi", "pmcid"], "doiAbstract", "the abstract"),
      ],
      () => ({ doi: "10.5555/x" as never }),
      { token: {} as never },
    );
    expect(await fetch(item(""))).toBe("the abstract");
    expect(seen).toEqual([
      'doiEmpty:[{"doi":"10.5555/x"}]',
      'doiAbstract:[{"doi":"10.5555/x"}]',
    ]);
  });

  it("readItemIdentifiers reads the DOI field and extra's DOI, PMID and PMCID lines", () => {
    const fields: Record<string, string> = {
      DOI: "",
      extra: "PMID: 12345\nPMCID: PMC777\ntex.foo: bar\nDOI: 10.5555/ABC",
    };
    expect(readItemIdentifiers({ getField: (f) => fields[f] ?? "" })).toEqual({
      doi: "10.5555/abc",
      pmid: "12345",
      pmcid: "PMC777",
    });
    expect(
      readItemIdentifiers({
        getField: (f) => {
          if (f === "DOI") throw new Error("not a field for this type");
          return "";
        },
      }),
    ).toEqual({});
  });
});

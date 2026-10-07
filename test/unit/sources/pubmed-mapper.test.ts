import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { ParseError } from "../../../src/core/errors";
import type { Logger } from "../../../src/core/logger";
import { isWorkType } from "../../../src/model/canonicalWork";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  createPubmedRecordMapper,
  PUBMED_MAPPABLE_FIELDS,
  type XmlCollectionLike,
  type XmlDocumentLike,
  type XmlElementLike,
} from "../../../src/sources/pubmed/mapper";
import type {
  PubmedRecordMapper,
  PubmedSourceDeps,
} from "../../../src/sources/pubmed/pubmedSource";

/**
 * `P1-T10`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network** —
 * this card parses a response body and never fetches one.
 *
 * ## Where the XML comes from, and what is synthesized
 *
 * `test/fixtures/pubmed/` holds only a `.gitkeep`: recording the `docs/13` §3.1
 * inventory is `P1-T11`, which this card *blocks*, and `scripts/record-fixtures.ts`
 * does not exist yet. So the one piece of **real captured response text** the
 * corpus owns is `docs/02-literature-database-apis.md` §3.4's block, labelled
 * there "Real trimmed `PubmedArticle` XML (2026-09-08, PMID 37258680)". It is
 * transcribed verbatim below as {@link DOCS_02_SAMPLE}, and
 * {@link readDocs02Sample} re-reads it out of the document at test time so a
 * transcription drift fails loudly instead of quietly asserting against a copy.
 *
 * Every other body below is **synthesized**: the §3.4 skeleton with one thing
 * changed, to reach a shape §3.4's numbered notes describe but its single sample
 * does not contain (a structured abstract, a `<MedlineDate>`, a record with no
 * `<Abstract>`, a CJK title, 55 authors). Each is labelled with the note or
 * document row it is built from. **No live request was made by this card: zero.**
 *
 * ## Why this file ships its own XML parser
 *
 * Node has no `DOMParser` (`scripts/spike-abstract-coverage.ts` records the same
 * fact; `typeof DOMParser === "undefined"` on Node 22.23.0, measured), while the
 * sandbox does — `docs/01` §2.3's measured **Present** list. The
 * mapper therefore takes the parse as a port and {@link parseXmlInNode} is this
 * file's Node implementation of it.
 *
 * **What that costs, stated plainly.** Decoding `&#x2009;` and flattening
 * `<sup>` into `textContent` are the *parser's* work, not the mapper's. In the
 * shipped path that parser is Gecko's; here it is the one below. So the two
 * criteria that name those behaviours are, in this layer, assertions that the
 * mapper reads `textContent` and re-escapes nothing — not that Gecko decodes
 * correctly. {@link describe}("the Node XML stand-in") pins the stand-in's own
 * behaviour so a bug in it fails as itself rather than as a mapper bug, and the
 * residual gap is reported with this card: closing it needs either an XML
 * devDependency (`package.json` is outside this card's `Files`) or an
 * integration test inside Zotero (`test/integration/` likewise).
 */

// ---------------------------------------------------------------------------
// 1. A minimal XML parser, for Node only
// ---------------------------------------------------------------------------

/** XML's five predefined entities. Anything else named is undeclared. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode predefined and numeric character references (§3.4 note 3). */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu,
    (_m, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      const named = NAMED_ENTITIES[body];
      if (named === undefined) throw new Error(`undeclared entity &${body};`);
      return named;
    },
  );
}

/** An element node. Satisfies the mapper's {@link XmlElementLike} port. */
class TestElement implements XmlElementLike {
  readonly nodes: Array<TestElement | string> = [];

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
      (n): n is TestElement => typeof n !== "string",
    );
    return { length: els.length, item: (i) => els[i] ?? null };
  }
}

/** Mimic Gecko: a parse failure is a document, not an exception. */
function parserErrorDocument(message: string): XmlDocumentLike {
  const el = new TestElement("parsererror", new Map());
  el.nodes.push(message);
  return { documentElement: el };
}

/**
 * Parse an XML document well enough for PubMed `efetch`: declarations, DOCTYPEs,
 * comments, CDATA, attributes, self-closing tags, nested elements, mixed content
 * and character references. Anything else — a mismatched tag, an unclosed
 * element, an undeclared entity — becomes a `<parsererror>` document, which is
 * what Gecko's `DOMParser` does.
 */
export function parseXmlInNode(xml: string): XmlDocumentLike {
  const stack: TestElement[] = [];
  let root: TestElement | null = null;
  let i = 0;

  const append = (node: TestElement | string): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.nodes.push(node);
  };

  try {
    while (i < xml.length) {
      if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i);
        if (end === -1) throw new Error("unterminated processing instruction");
        i = end + 2;
      } else if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i);
        if (end === -1) throw new Error("unterminated comment");
        i = end + 3;
      } else if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        if (end === -1) throw new Error("unterminated CDATA");
        append(xml.slice(i + 9, end));
        i = end + 3;
      } else if (xml.startsWith("<!", i)) {
        const bracket = xml.indexOf("[", i);
        const close = xml.indexOf(">", i);
        if (close === -1) throw new Error("unterminated declaration");
        if (bracket !== -1 && bracket < close) {
          const subsetEnd = xml.indexOf("]", bracket);
          const after = xml.indexOf(">", subsetEnd);
          if (subsetEnd === -1 || after === -1) {
            throw new Error("unterminated internal subset");
          }
          i = after + 1;
        } else {
          i = close + 1;
        }
      } else if (xml.startsWith("</", i)) {
        const close = xml.indexOf(">", i);
        if (close === -1) throw new Error("unterminated end tag");
        const name = xml.slice(i + 2, close).trim();
        const open = stack.pop();
        if (open === undefined || open.localName !== name) {
          throw new Error(`end tag </${name}> does not match`);
        }
        i = close + 1;
      } else if (xml.startsWith("<", i)) {
        i = readStartTag(xml, i, stack, append, (el) => {
          if (root === null) root = el;
        });
      } else {
        const next = xml.indexOf("<", i);
        const end = next === -1 ? xml.length : next;
        const chunk = xml.slice(i, end);
        if (stack.length === 0) {
          if (chunk.trim().length > 0) throw new Error("text outside root");
        } else {
          append(decodeEntities(chunk));
        }
        i = end;
      }
    }
    if (stack.length > 0) throw new Error("unclosed element");
    if (root === null) throw new Error("no root element");
  } catch (error) {
    return parserErrorDocument(
      error instanceof Error ? error.message : "parse failed",
    );
  }

  return { documentElement: root };
}

/** Read one start tag, push it (unless self-closing), and return the new index. */
function readStartTag(
  xml: string,
  start: number,
  stack: TestElement[],
  append: (node: TestElement | string) => void,
  noteRoot: (el: TestElement) => void,
): number {
  const nameMatch = /^<([^\s/>]+)/u.exec(xml.slice(start));
  const name = nameMatch?.[1];
  if (name === undefined) throw new Error("malformed start tag");

  let i = start + 1 + name.length;
  const attrs = new Map<string, string>();

  for (;;) {
    while (i < xml.length && /\s/u.test(xml[i] ?? "")) i += 1;
    if (i >= xml.length) throw new Error("unterminated start tag");
    if (xml.startsWith("/>", i)) {
      const el = new TestElement(name, attrs);
      if (stack.length === 0) noteRoot(el);
      append(el);
      return i + 2;
    }
    if (xml[i] === ">") {
      const el = new TestElement(name, attrs);
      if (stack.length === 0) noteRoot(el);
      append(el);
      stack.push(el);
      return i + 1;
    }
    const attrMatch = /^([^\s=/>]+)\s*=\s*(["'])([^]*?)\2/u.exec(xml.slice(i));
    if (attrMatch === null) throw new Error("malformed attribute");
    const [whole, attrName, , attrValue] = attrMatch;
    attrs.set(attrName ?? "", decodeEntities(attrValue ?? ""));
    i += whole.length;
  }
}

// ---------------------------------------------------------------------------
// 2. The one real captured body — docs/02 §3.4
// ---------------------------------------------------------------------------

/**
 * `docs/02-literature-database-apis.md` §3.4's fenced block, lines 420–479,
 * transcribed character for character. {@link readDocs02Sample} proves it.
 */
const DOCS_02_SAMPLE = `<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM" IndexingMethod="Curated">
    <PMID Version="1">37258680</PMID>
    <DateRevised><Year>2026</Year><Month>04</Month><Day>23</Day></DateRevised>
    <Article PubModel="Print-Electronic">
      <Journal>
        <ISSN IssnType="Electronic">1476-4687</ISSN>
        <JournalIssue CitedMedium="Internet">
          <Volume>618</Volume><Issue>7965</Issue>
          <PubDate><Year>2023</Year><Month>Jun</Month></PubDate>
        </JournalIssue>
        <Title>Nature</Title>
        <ISOAbbreviation>Nature</ISOAbbreviation>
      </Journal>
      <ArticleTitle>Transfer learning enables predictions in network biology.</ArticleTitle>
      <Pagination><StartPage>616</StartPage><EndPage>624</EndPage><MedlinePgn>616-624</MedlinePgn></Pagination>
      <ELocationID EIdType="doi" ValidYN="Y">10.1038/s41586-023-06139-9</ELocationID>
      <Abstract>
        <AbstractText>Mapping gene networks requires large amounts of transcriptomic data ...
          Here, we developed a context-aware, attention-based deep learning model, Geneformer,
          pretrained on a large-scale corpus of about 30&#x2009;million single-cell transcriptomes ...</AbstractText>
        <CopyrightInformation>&#xa9; 2023. The Author(s), under exclusive licence to Springer Nature Limited.</CopyrightInformation>
      </Abstract>
      <AuthorList CompleteYN="Y">
        <Author ValidYN="Y">
          <LastName>Theodoris</LastName><ForeName>Christina V</ForeName><Initials>CV</Initials>
          <Identifier Source="ORCID">0000-0003-1658-1447</Identifier>
          <AffiliationInfo><Affiliation>Department of Data Science, Dana-Farber Cancer Institute, Boston, MA, USA.</Affiliation></AffiliationInfo>
        </Author>
        <!-- ... -->
      </AuthorList>
    </Article>
    <MeshHeadingList>
      <MeshHeading><DescriptorName UI="D006801" MajorTopicYN="N">Humans</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D001695" MajorTopicYN="Y">Biology</DescriptorName>
                   <QualifierName UI="Q000379" MajorTopicYN="N">methods</QualifierName></MeshHeading>
      <MeshHeading><DescriptorName UI="D000069550" MajorTopicYN="Y">Machine Learning</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D016571" MajorTopicYN="Y">Neural Networks, Computer</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D000092386" MajorTopicYN="N">Single-Cell Gene Expression Analysis</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D002843" MajorTopicYN="N">Chromatin</DescriptorName>
                   <QualifierName UI="Q000235" MajorTopicYN="N">genetics</QualifierName></MeshHeading>
    </MeshHeadingList>
  </MedlineCitation>
  <PubmedData>
    <History>
      <PubMedPubDate PubStatus="received"><Year>2022</Year><Month>3</Month><Day>29</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="accepted"><Year>2023</Year><Month>4</Month><Day>27</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="pubmed"><Year>2023</Year><Month>6</Month><Day>1</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="entrez"><Year>2023</Year><Month>5</Month><Day>31</Day></PubMedPubDate>
    </History>
    <PublicationStatus>ppublish</PublicationStatus>
    <ArticleIdList>
      <ArticleId IdType="pubmed">37258680</ArticleId>
      <ArticleId IdType="pmc">PMC10949956</ArticleId>
      <ArticleId IdType="doi">10.1038/s41586-023-06139-9</ArticleId>
    </ArticleIdList>
  </PubmedData>
</PubmedArticle>
</PubmedArticleSet>`;

/** Pull §3.4's fenced XML block back out of the document it was copied from. */
function readDocs02Sample(): string {
  // `fileURLToPath` is given a string, not a `URL`: `zotero-types` ships
  // Gecko's DOM lib, so the global `URL` here is Gecko's and is not assignable
  // to `node:url`'s (measured — TS2345 on `searchParams.entries()`).
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../../../docs/02-literature-database-apis.md");
  const doc = readFileSync(path, "utf8");
  const marker = "Real trimmed `PubmedArticle` XML";
  const from = doc.indexOf(marker);
  if (from === -1) throw new Error(`docs/02 no longer contains "${marker}"`);
  const open = doc.indexOf("```xml\n", from);
  const close = doc.indexOf("\n```", open);
  if (open === -1 || close === -1) throw new Error("docs/02 §3.4 fence moved");
  return doc.slice(open + "```xml\n".length, close);
}

// ---------------------------------------------------------------------------
// 3. Synthesized bodies, each labelled with what it is built from
// ---------------------------------------------------------------------------

/** Wrap one or more `<PubmedArticle>` bodies in a set. */
function articleSet(...articles: readonly string[]): string {
  return [
    '<?xml version="1.0" ?>',
    '<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2024//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_240101.dtd">',
    "<PubmedArticleSet>",
    ...articles,
    "</PubmedArticleSet>",
  ].join("\n");
}

/** The §3.4 skeleton, with each variable part supplied by the caller. */
function article(parts: {
  pmid?: string;
  journal?: string;
  title?: string;
  abstract?: string;
  authors?: string;
  pubDate?: string;
  history?: string;
  articleDate?: string;
  mesh?: string;
  keywords?: string;
  language?: string;
  pagination?: string;
  eLocationId?: string;
  ids?: string;
}): string {
  return `<PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM">
    <PMID Version="1">${parts.pmid ?? "11111111"}</PMID>
    <Article PubModel="Print">
      ${parts.journal ?? `<Journal><ISSN IssnType="Print">0000-0000</ISSN><JournalIssue CitedMedium="Print"><Volume>1</Volume><Issue>2</Issue>${parts.pubDate ?? "<PubDate><Year>2024</Year></PubDate>"}</JournalIssue><Title>Journal of Testing</Title><ISOAbbreviation>J Test</ISOAbbreviation></Journal>`}
      <ArticleTitle>${parts.title ?? "A title."}</ArticleTitle>
      ${parts.pagination ?? "<Pagination><MedlinePgn>1-9</MedlinePgn></Pagination>"}
      ${parts.eLocationId ?? ""}
      ${parts.abstract ?? ""}
      ${parts.authors ?? ""}
      ${parts.language ?? "<Language>eng</Language>"}
      ${parts.articleDate ?? ""}
    </Article>
    ${parts.mesh ?? ""}
    ${parts.keywords ?? ""}
  </MedlineCitation>
  <PubmedData>
    <History>${parts.history ?? ""}</History>
    <ArticleIdList>${parts.ids ?? `<ArticleId IdType="pubmed">${parts.pmid ?? "11111111"}</ArticleId>`}</ArticleIdList>
  </PubmedData>
</PubmedArticle>`;
}

/** `<Journal>` with no `<ISSN>` — the "no venue with an ISSN" arm of §10.2. */
const JOURNAL_WITHOUT_ISSN =
  "<Journal><JournalIssue><PubDate><Year>2019</Year></PubDate></JournalIssue>" +
  "<Title>Letters to the Editor</Title></Journal>";

/**
 * §3.4 note 1's structured abstract, with note 2's inline markup inside two of
 * the four sections. `NlmCategory` is carried in because the note names it,
 * even though nothing reads it.
 *
 * The markup is **added here**, not copied: note 2 claims "the example above
 * contains `<sup>1,2</sup>` in the source", and the §3.4 sample contains no
 * `<sup>` at all (grepped: zero matches in lines 420–479). Reported as a corpus
 * contradiction with this card.
 */
const STRUCTURED_ABSTRACT = `<Abstract>
        <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Gene regulatory networks are hard to map<sup>1,2</sup>.</AbstractText>
        <AbstractText Label="METHODS" NlmCategory="METHODS">We pretrained on 30&#x2009;million cells and measured <i>in vitro</i> response.</AbstractText>
        <AbstractText Label="RESULTS" NlmCategory="RESULTS">Accuracy rose by 12&#x2009;%.</AbstractText>
        <AbstractText Label="CONCLUSIONS" NlmCategory="CONCLUSIONS">Transfer learning generalizes.</AbstractText>
      </Abstract>`;

/** One author in §3.4's shape. */
function authorXml(family: string, given: string, extra = ""): string {
  return `<Author ValidYN="Y"><LastName>${family}</LastName><ForeName>${given}</ForeName>${extra}</Author>`;
}

/** `docs/07` §11.1 step 6's "an item with 50+ authors". */
const FIFTY_FIVE_AUTHORS = `<AuthorList CompleteYN="Y">${Array.from(
  { length: 55 },
  (_v, n) => authorXml(`Family${String(n)}`, `Given${String(n)}`),
).join("")}</AuthorList>`;

// ---------------------------------------------------------------------------
// 4. Harness
// ---------------------------------------------------------------------------

/** A logger that keeps every `warn` line, which is the mapper's one diagnostic
 * channel for "present but not understood". */
function capturingLogger(): {
  logger: Logger;
  warnings: Array<{ msg: string; ctx: Record<string, unknown> }>;
} {
  const warnings: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
  const logger: Logger = {
    child: () => logger,
    error: () => undefined,
    warn: (msg, ctx) => void warnings.push({ msg, ctx: ctx ?? {} }),
    info: () => undefined,
    debug: () => undefined,
    time: async (_msg, fn) => fn(),
  };
  return { logger, warnings };
}

/** The clock's fixed instant, so `retrievedAtEpochMs` is assertable. */
const FROZEN_NOW = 1_760_000_000_000;

function mapperWith(options: { keepRaw?: boolean } = {}): {
  map: (xml: string) => readonly SourceRecord[];
  warnings: Array<{ msg: string; ctx: Record<string, unknown> }>;
} {
  const { logger, warnings } = capturingLogger();
  const clock = createManualClock(FROZEN_NOW);
  const map = createPubmedRecordMapper({
    clock,
    parseXml: parseXmlInNode,
    logger,
    ...(options.keepRaw !== undefined && { keepRaw: options.keepRaw }),
  });
  return { map, warnings };
}

/** Map and return the single record, failing loudly if there is not exactly one. */
function one(xml: string, options: { keepRaw?: boolean } = {}): SourceRecord {
  const { map } = mapperWith(options);
  const records = map(xml);
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) throw new Error("unreachable");
  return record;
}

// ---------------------------------------------------------------------------
// 5. The Node XML stand-in's own behaviour
// ---------------------------------------------------------------------------

describe("the Node XML stand-in", () => {
  it("has no DOMParser to fall back on", () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe(
      "undefined",
    );
  });

  it("decodes numeric character references, hex and decimal", () => {
    const root = parseXmlInNode(
      "<a>30&#x2009;million &#169; &#xa9;</a>",
    ).documentElement;
    expect(root?.textContent).toBe("30 million © ©");
  });

  it("decodes the five predefined entities, in text and in attributes", () => {
    const root = parseXmlInNode(
      '<a t="&quot;q&quot; &amp; &apos;p&apos;">&lt;b&gt; &amp; c</a>',
    ).documentElement;
    expect(root?.textContent).toBe("<b> & c");
    expect(root?.getAttribute("t")).toBe("\"q\" & 'p'");
  });

  it("flattens inline markup into textContent (§3.4 note 2)", () => {
    const root = parseXmlInNode(
      "<AbstractText>rose by 12<sup>2</sup> <i>in vitro</i></AbstractText>",
    ).documentElement;
    expect(root?.textContent).toBe("rose by 122 in vitro");
  });

  it("skips declarations, DOCTYPEs and comments, and reads CDATA as text", () => {
    const xml =
      '<?xml version="1.0" ?><!DOCTYPE a SYSTEM "a.dtd"><a><!-- gone -->' +
      "<![CDATA[kept <b> raw]]></a>";
    const root = parseXmlInNode(xml).documentElement;
    expect(root?.localName).toBe("a");
    expect(root?.textContent).toBe("kept <b> raw");
  });

  it("exposes only direct element children, in document order", () => {
    const root = parseXmlInNode(
      "<a>text<b/><c><b/></c><b/></a>",
    ).documentElement;
    const names: string[] = [];
    const kids = root?.children;
    for (let i = 0; i < (kids?.length ?? 0); i += 1) {
      names.push(kids?.item(i)?.localName ?? "?");
    }
    expect(names).toEqual(["b", "c", "b"]);
  });

  it("reports a mismatched tag as a <parsererror> document, not a throw", () => {
    expect(parseXmlInNode("<a><b></a>").documentElement?.localName).toBe(
      "parsererror",
    );
    expect(parseXmlInNode("<a>").documentElement?.localName).toBe(
      "parsererror",
    );
    expect(parseXmlInNode("<a>&nosuch;</a>").documentElement?.localName).toBe(
      "parsererror",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Fixture provenance
// ---------------------------------------------------------------------------

describe("fixture provenance", () => {
  it("DOCS_02_SAMPLE is docs/02 §3.4's block, character for character", () => {
    expect(DOCS_02_SAMPLE).toBe(readDocs02Sample());
  });

  it("the sample parses to a PubmedArticleSet with one PubmedArticle", () => {
    const root = parseXmlInNode(DOCS_02_SAMPLE).documentElement;
    expect(root?.localName).toBe("PubmedArticleSet");
    expect(root?.children.length).toBe(1);
    expect(root?.children.item(0)?.localName).toBe("PubmedArticle");
  });
});

// ---------------------------------------------------------------------------
// 7. Criterion 1 — the §3.4 sample, mapped whole
// ---------------------------------------------------------------------------

describe("docs/02 §3.4, PMID 37258680 — the card's first criterion", () => {
  const record = one(DOCS_02_SAMPLE);

  it("maps to 6 MeSH subjects, 3 of them isMajor", () => {
    expect(record.work.subjects).toHaveLength(6);
    expect(record.work.subjects?.filter((s) => s.isMajor)).toHaveLength(3);
    expect(record.work.subjects?.map((s) => s.term)).toEqual([
      "Humans",
      "Biology",
      "Machine Learning",
      "Neural Networks, Computer",
      "Single-Cell Gene Expression Analysis",
      "Chromatin",
    ]);
  });

  it("carries every MeSH @UI (§3.4 note 6)", () => {
    expect(record.work.subjects?.map((s) => s.id)).toEqual([
      "D006801",
      "D001695",
      "D000069550",
      "D016571",
      "D000092386",
      "D002843",
    ]);
    expect(record.work.subjects?.every((s) => s.scheme === "mesh")).toBe(true);
  });

  it("does not emit QualifierName as a subject of its own", () => {
    expect(record.work.subjects?.map((s) => s.term)).not.toContain("methods");
    expect(record.work.subjects?.map((s) => s.term)).not.toContain("genetics");
  });

  it("has DOI 10.1038/s41586-023-06139-9 and PMCID PMC10949956", () => {
    expect(record.work.ids.doi).toBe("10.1038/s41586-023-06139-9");
    expect(record.work.ids.pmcid).toBe("PMC10949956");
    expect(record.work.ids.pmid).toBe("37258680");
  });

  it("has publishedDate.iso === 2023-06-01, from the pubmed history date", () => {
    expect(record.work.publishedDate).toStrictEqual({
      year: 2023,
      month: 6,
      day: 1,
      iso: "2023-06-01",
    });
  });

  it("strips the trailing period docs/02 §10.4 says PubMed appends", () => {
    expect(record.work.title).toBe(
      "Transfer learning enables predictions in network biology",
    );
  });

  it("maps the whole record, field for field", () => {
    expect(record).toStrictEqual({
      id: "pubmed:37258680",
      sourceId: "pubmed",
      nativeId: "37258680",
      retrievedAtEpochMs: FROZEN_NOW,
      missingFields: ["language", "keywords"],
      work: {
        ids: {
          pmid: "37258680",
          doi: "10.1038/s41586-023-06139-9",
          pmcid: "PMC10949956",
        },
        type: "journal-article",
        title: "Transfer learning enables predictions in network biology",
        abstract:
          "Mapping gene networks requires large amounts of transcriptomic data ... " +
          "Here, we developed a context-aware, attention-based deep learning model, Geneformer, " +
          "pretrained on a large-scale corpus of about 30 million single-cell transcriptomes ...",
        authors: [
          {
            family: "Theodoris",
            given: "Christina V",
            orcid: "0000-0003-1658-1447",
            affiliations: [
              "Department of Data Science, Dana-Farber Cancer Institute, Boston, MA, USA.",
            ],
            sequence: 0,
          },
        ],
        containerTitle: "Nature",
        containerAbbreviation: "Nature",
        volume: "618",
        issue: "7965",
        pages: "616-624",
        issn: ["1476-4687"],
        publishedDate: { year: 2023, month: 6, day: 1, iso: "2023-06-01" },
        subjects: [
          { term: "Humans", scheme: "mesh", id: "D006801", isMajor: false },
          { term: "Biology", scheme: "mesh", id: "D001695", isMajor: true },
          {
            term: "Machine Learning",
            scheme: "mesh",
            id: "D000069550",
            isMajor: true,
          },
          {
            term: "Neural Networks, Computer",
            scheme: "mesh",
            id: "D016571",
            isMajor: true,
          },
          {
            term: "Single-Cell Gene Expression Analysis",
            scheme: "mesh",
            id: "D000092386",
            isMajor: false,
          },
          { term: "Chromatin", scheme: "mesh", id: "D002843", isMajor: false },
        ],
      },
    });
  });

  it("writes no workKey, provenance or normalizedAtEpochMs", () => {
    const work = record.work as Record<string, unknown>;
    expect(work["workKey"]).toBeUndefined();
    expect(work["provenance"]).toBeUndefined();
    expect(work["normalizedAtEpochMs"]).toBeUndefined();
  });

  it("does not read Abstract/CopyrightInformation into the abstract", () => {
    expect(record.work.abstract).not.toContain("Springer Nature");
    expect(record.work.abstract).not.toContain("©");
  });

  it("emits a WorkType from docs/07 §5.1's kebab-case union", () => {
    expect(isWorkType(record.work.type)).toBe(true);
    expect(record.work.type).toBe("journal-article");
  });
});

// ---------------------------------------------------------------------------
// 8. Criteria 2 and 3 — structured abstracts, character references
// ---------------------------------------------------------------------------

describe("abstracts — §3.4 notes 1, 2, 3 and 5", () => {
  it("flattens BACKGROUND/METHODS/RESULTS/CONCLUSIONS into four paragraphs", () => {
    const record = one(articleSet(article({ abstract: STRUCTURED_ABSTRACT })));
    const paragraphs = (record.work.abstract ?? "").split("\n\n");
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs).toEqual([
      "BACKGROUND: Gene regulatory networks are hard to map1,2.",
      "METHODS: We pretrained on 30 million cells and measured in vitro response.",
      "RESULTS: Accuracy rose by 12 %.",
      "CONCLUSIONS: Transfer learning generalizes.",
    ]);
    expect(record.missingFields).not.toContain("abstract");
  });

  it("renders &#x2009; as a thin space, never as the literal entity", () => {
    const record = one(DOCS_02_SAMPLE);
    expect(record.work.abstract).toContain("30 million");
    expect(record.work.abstract).not.toContain("&#x2009;");
    expect(record.work.abstract).not.toContain("&amp;");
  });

  it("flattens inline markup via textContent, keeping no tags (note 2)", () => {
    const record = one(articleSet(article({ abstract: STRUCTURED_ABSTRACT })));
    expect(record.work.abstract).not.toContain("<");
    expect(record.work.abstract).toContain("measured in vitro response");
  });

  it("uses the bare text of a single unlabelled AbstractText", () => {
    const record = one(
      articleSet(
        article({
          abstract:
            "<Abstract><AbstractText>Just one.</AbstractText></Abstract>",
        }),
      ),
    );
    expect(record.work.abstract).toBe("Just one.");
  });

  it("labels a single AbstractText that carries a Label (note 1)", () => {
    const record = one(
      articleSet(
        article({
          abstract:
            '<Abstract><AbstractText Label="UNLABELLED">Body.</AbstractText></Abstract>',
        }),
      ),
    );
    expect(record.work.abstract).toBe("UNLABELLED: Body.");
  });

  it("normalizes the whitespace a pretty-printed AbstractText carries", () => {
    const record = one(
      articleSet(
        article({
          abstract:
            "<Abstract><AbstractText>one\n      two\n\n   three</AbstractText></Abstract>",
        }),
      ),
    );
    expect(record.work.abstract).toBe("one two three");
  });

  it("trims the indentation real efetch XML puts around element text", () => {
    // NLM pretty-prints some records with the text on its own indented line, so
    // `textContent` begins and ends with layout whitespace. Measured: without
    // the trim, nothing else in this file noticed (mutation M19).
    const record = one(
      articleSet(
        article({
          title: "\n        An indented title.\n      ",
          abstract:
            "<Abstract>\n  <AbstractText>\n    Indented body.\n  </AbstractText>\n</Abstract>",
          authors:
            "<AuthorList>\n  <Author>\n    <LastName>\n      Padded\n    </LastName>\n" +
            "    <ForeName>\n      Name\n    </ForeName>\n" +
            "    <AffiliationInfo>\n      <Affiliation>\n        A lab.\n      </Affiliation>\n    </AffiliationInfo>\n" +
            "  </Author>\n</AuthorList>",
        }),
      ),
    );
    expect(record.work.title).toBe("An indented title");
    expect(record.work.abstract).toBe("Indented body.");
    expect(record.work.authors[0]).toStrictEqual({
      family: "Padded",
      given: "Name",
      affiliations: ["A lab."],
      sequence: 0,
    });
  });

  it("maps a record with no <Abstract> and reports it (note 5, criterion 4)", () => {
    const record = one(articleSet(article({})));
    expect(record.work.abstract).toBeUndefined();
    expect("abstract" in record.work).toBe(false);
    expect(record.missingFields).toContain("abstract");
    expect(record.id).toBe("pubmed:11111111");
  });

  it("reports an <Abstract> that is present but empty as not understood", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          abstract:
            '<Abstract><AbstractText Label="X"></AbstractText></Abstract>',
        }),
      ),
    );
    expect(records[0]?.work.abstract).toBeUndefined();
    expect(records[0]?.missingFields).toContain("abstract");
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: Abstract is present but has no text",
    );
  });

  it("logs nothing when the abstract is merely absent", () => {
    const { map, warnings } = mapperWith();
    map(articleSet(article({})));
    expect(warnings.filter((w) => w.ctx["field"] === "abstract")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Criterion 5 and docs/13 §2.1's date matrix
// ---------------------------------------------------------------------------

describe("dates — §3.4 note 4 and docs/13 §2.1's required shapes", () => {
  const pubDate = (inner: string): string =>
    articleSet(article({ pubDate: `<PubDate>${inner}</PubDate>` }));

  it("2024 — year only", () => {
    expect(one(pubDate("<Year>2024</Year>")).work.publishedDate).toStrictEqual({
      year: 2024,
      iso: "2024",
    });
  });

  it("2024-03 — year and month, numeric", () => {
    expect(
      one(pubDate("<Year>2024</Year><Month>03</Month>")).work.publishedDate,
    ).toStrictEqual({ year: 2024, month: 3, iso: "2024-03" });
  });

  it("2024 Mar 15 — year, named month and day", () => {
    expect(
      one(pubDate("<Year>2024</Year><Month>Mar</Month><Day>15</Day>")).work
        .publishedDate,
    ).toStrictEqual({ year: 2024, month: 3, day: 15, iso: "2024-03-15" });
  });

  it("2023 Jun-Jul — a MedlineDate yields a year-only PartialDate", () => {
    const record = one(pubDate("<MedlineDate>2023 Jun-Jul</MedlineDate>"));
    expect(record.work.publishedDate).toStrictEqual({
      year: 2023,
      iso: "2023",
    });
  });

  it("2024 Spring — the other MedlineDate shape docs/13 §2.1 names", () => {
    const record = one(pubDate("<MedlineDate>2024 Spring</MedlineDate>"));
    expect(record.work.publishedDate).toStrictEqual({
      year: 2024,
      iso: "2024",
    });
  });

  it("a MedlineDate never throws and never logs (criterion 5)", () => {
    const { map, warnings } = mapperWith();
    expect(() =>
      map(pubDate("<MedlineDate>2023 Jun-Jul</MedlineDate>")),
    ).not.toThrow();
    expect(warnings).toEqual([]);
  });

  it("prefers the pubmed history date over ArticleDate and PubDate", () => {
    const record = one(
      articleSet(
        article({
          pubDate: "<PubDate><Year>2020</Year><Month>Jan</Month></PubDate>",
          articleDate:
            '<ArticleDate DateType="Electronic"><Year>2021</Year><Month>2</Month><Day>3</Day></ArticleDate>',
          history:
            '<PubMedPubDate PubStatus="pubmed"><Year>2022</Year><Month>4</Month><Day>5</Day></PubMedPubDate>',
        }),
      ),
    );
    expect(record.work.publishedDate?.iso).toBe("2022-04-05");
  });

  it("ignores history dates whose PubStatus is not 'pubmed'", () => {
    const record = one(
      articleSet(
        article({
          pubDate: "<PubDate><Year>2020</Year></PubDate>",
          history:
            '<PubMedPubDate PubStatus="entrez"><Year>2022</Year><Month>4</Month><Day>5</Day></PubMedPubDate>' +
            '<PubMedPubDate PubStatus="accepted"><Year>2021</Year></PubMedPubDate>',
        }),
      ),
    );
    expect(record.work.publishedDate?.iso).toBe("2020");
  });

  it("falls back to ArticleDate when no pubmed history date exists", () => {
    const record = one(
      articleSet(
        article({
          pubDate: "<PubDate><Year>2020</Year></PubDate>",
          articleDate:
            '<ArticleDate DateType="Electronic"><Year>2021</Year><Month>2</Month><Day>3</Day></ArticleDate>',
        }),
      ),
    );
    expect(record.work.publishedDate?.iso).toBe("2021-02-03");
  });

  it("reports an unreadable month, then falls through to the next candidate", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          pubDate: "<PubDate><Year>2020</Year><Month>Smarch</Month></PubDate>",
          history:
            '<PubMedPubDate PubStatus="pubmed"><Year>2022</Year><Month>13</Month></PubMedPubDate>',
        }),
      ),
    );
    expect(records[0]?.work.publishedDate).toBeUndefined();
    expect(records[0]?.missingFields).toContain("publishedDate");
    const reasons = warnings
      .filter((w) => w.ctx["field"] === "publishedDate")
      .map((w) => w.ctx["reason"]);
    expect(reasons).toEqual(["Month is not a month", "Month is not a month"]);
  });

  it("distinguishes an absent date from an unreadable one", () => {
    const { map, warnings } = mapperWith();
    const records = map(articleSet(article({ pubDate: "" })));
    expect(records[0]?.work.publishedDate).toBeUndefined();
    expect(records[0]?.missingFields).toContain("publishedDate");
    expect(warnings).toEqual([]);
  });

  it("drops an out-of-range day rather than emitting an unparseable iso", () => {
    const record = one(
      pubDate("<Year>2024</Year><Month>2</Month><Day>99</Day>"),
    );
    expect(record.work.publishedDate).toStrictEqual({
      year: 2024,
      month: 2,
      iso: "2024-02",
    });
  });

  it("never emits a day without a month", () => {
    const record = one(pubDate("<Year>2024</Year><Day>15</Day>"));
    expect(record.work.publishedDate).toStrictEqual({
      year: 2024,
      iso: "2024",
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Criterion 6 — Unicode round-trip
// ---------------------------------------------------------------------------

describe("Unicode — criterion 6 and docs/13 §3.1's record-unicode", () => {
  // Built from code points, not from literals, so neither this file's encoding
  // nor an editor's normalization can make the assertion pass by accident.
  const CJK = "전이 학습에 기반한 생분자 네트워크 예상"; // Korean
  const HANZI = "基因谱数据的迁移学习";
  const GREEK = "α-β cross-talk in TGF-β and Δψm collapse";

  it("round-trips a CJK title byte-identically", () => {
    const record = one(articleSet(article({ title: `${CJK}.` })));
    expect(record.work.title).toBe(CJK);
    expect([...(record.work.title ?? "")].length).toBe([...CJK].length);
  });

  it("round-trips a Han title and CJK author names byte-identically", () => {
    const record = one(
      articleSet(
        article({
          title: `${HANZI}.`,
          authors: `<AuthorList>${authorXml("张", "伟")}</AuthorList>`,
        }),
      ),
    );
    expect(record.work.title).toBe(HANZI);
    expect(record.work.authors[0]?.family).toBe("张");
    expect(record.work.authors[0]?.given).toBe("伟");
  });

  it("round-trips Greek letters byte-identically", () => {
    const record = one(articleSet(article({ title: `${GREEK}.` })));
    expect(record.work.title).toBe(GREEK);
    expect(record.work.title).toContain("β");
    expect(record.work.title).toContain("Δψm");
  });

  it("keeps Greek letters that arrived as character references", () => {
    const record = one(
      articleSet(article({ title: "TGF-&#x3b2; and &#916;&#968;m." })),
    );
    expect(record.work.title).toBe("TGF-β and Δψm");
  });

  it("does not strip a non-ASCII sentence-final mark as PubMed's period", () => {
    const record = one(articleSet(article({ title: `${HANZI}。` })));
    expect(record.work.title).toBe(`${HANZI}。`);
  });

  it("keeps a significant Unicode space that whitespace normalization would eat", () => {
    // `/\s+/g` matches U+2009, U+00A0 and U+2002, so a naive "collapse
    // whitespace" step rewrites §3.4's own thin space into an ASCII space.
    // Measured: that is exactly what this mapper did before PRINT_WHITESPACE.
    const record = one(
      articleSet(
        article({
          title: "30&#x2009;million cells and 5&#x2002;mm.",
          abstract:
            "<Abstract><AbstractText>a\n  b 30&#x2009;million</AbstractText></Abstract>",
        }),
      ),
    );
    expect(record.work.title).toBe("30 million cells and 5 mm");
    expect(record.work.abstract).toBe("a b 30 million");
  });
});

// ---------------------------------------------------------------------------
// 11. Authors
// ---------------------------------------------------------------------------

describe("authors — step 4 and docs/07 §5.1's drop rule", () => {
  it("reads LastName, ForeName, ORCID, affiliations and document order", () => {
    const record = one(
      articleSet(
        article({
          authors: `<AuthorList CompleteYN="Y">${
            authorXml(
              "Theodoris",
              "Christina V",
              '<Identifier Source="ORCID">0000-0003-1658-1447</Identifier>' +
                "<AffiliationInfo><Affiliation>A lab.</Affiliation></AffiliationInfo>" +
                "<AffiliationInfo><Affiliation>A second lab.</Affiliation></AffiliationInfo>",
            ) + authorXml("Kaski", "Ada")
          }</AuthorList>`,
        }),
      ),
    );
    expect(record.work.authors).toStrictEqual([
      {
        family: "Theodoris",
        given: "Christina V",
        orcid: "0000-0003-1658-1447",
        affiliations: ["A lab.", "A second lab."],
        sequence: 0,
      },
      { family: "Kaski", given: "Ada", sequence: 1 },
    ]);
  });

  it("ignores an Identifier whose Source is not ORCID", () => {
    const record = one(
      articleSet(
        article({
          authors: `<AuthorList>${authorXml(
            "Nemo",
            "A",
            '<Identifier Source="Scopus">7004212771</Identifier>',
          )}</AuthorList>`,
        }),
      ),
    );
    expect(record.work.authors[0]?.orcid).toBeUndefined();
  });

  it("strips the orcid.org prefix docs/07 §5.1 forbids", () => {
    const record = one(
      articleSet(
        article({
          authors: `<AuthorList>${authorXml(
            "Nemo",
            "A",
            '<Identifier Source="ORCID">https://orcid.org/0000-0002-1825-0097</Identifier>',
          )}</AuthorList>`,
        }),
      ),
    );
    expect(record.work.authors[0]?.orcid).toBe("0000-0002-1825-0097");
  });

  it("accepts the X checksum ORCID's mod-11 allows", () => {
    const record = one(
      articleSet(
        article({
          authors: `<AuthorList>${authorXml(
            "Nemo",
            "A",
            '<Identifier Source="ORCID">0000-0002-1694-233X</Identifier>',
          )}</AuthorList>`,
        }),
      ),
    );
    expect(record.work.authors[0]?.orcid).toBe("0000-0002-1694-233X");
  });

  it("drops an author with no usable name and says so", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          authors:
            "<AuthorList>" +
            authorXml("Real", "Name") +
            '<Author ValidYN="Y"><Initials>XX</Initials></Author>' +
            authorXml("Other", "Name") +
            "</AuthorList>",
        }),
      ),
    );
    expect(records[0]?.work.authors.map((a) => a.family)).toEqual([
      "Real",
      "Other",
    ]);
    expect(records[0]?.work.authors.map((a) => a.sequence)).toEqual([0, 1]);
    const warning = warnings.find((w) => w.ctx["field"] === "authors");
    expect(warning?.msg).toBe(
      "pubmed mapper: authors dropped for having no name",
    );
    expect(warning?.ctx["dropped"]).toBe(1);
  });

  it("keeps a CollectiveName author rather than dropping it", () => {
    const record = one(
      articleSet(
        article({
          authors:
            "<AuthorList><Author><CollectiveName>The GTEx Consortium</CollectiveName></Author></AuthorList>",
        }),
      ),
    );
    expect(record.work.authors[0]).toStrictEqual({
      family: "The GTEx Consortium",
      literal: "The GTEx Consortium",
      sequence: 0,
    });
  });

  it("handles 55 authors (docs/07 §11.1 step 6)", () => {
    const record = one(articleSet(article({ authors: FIFTY_FIVE_AUTHORS })));
    expect(record.work.authors).toHaveLength(55);
    expect(record.work.authors[54]).toStrictEqual({
      family: "Family54",
      given: "Given54",
      sequence: 54,
    });
    expect(record.work.authors.map((a) => a.sequence)).toEqual(
      Array.from({ length: 55 }, (_v, n) => n),
    );
    expect(record.missingFields).not.toContain("authors");
  });

  it("reports an absent AuthorList as a gap, with no warning", () => {
    const { map, warnings } = mapperWith();
    const records = map(articleSet(article({})));
    expect(records[0]?.work.authors).toEqual([]);
    expect(records[0]?.missingFields).toContain("authors");
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12. Identifiers
// ---------------------------------------------------------------------------

describe("identifiers — step 6, through P1-T01's normalizers", () => {
  it("lowercases a DOI, as docs/02 §11.1's normalizer does", () => {
    const record = one(
      articleSet(
        article({
          ids:
            '<ArticleId IdType="pubmed">11111111</ArticleId>' +
            '<ArticleId IdType="doi">10.1038/S41586-023-06139-9</ArticleId>',
        }),
      ),
    );
    expect(record.work.ids.doi).toBe("10.1038/s41586-023-06139-9");
  });

  it("adds the PMC prefix when PubMed omitted it", () => {
    const record = one(
      articleSet(
        article({
          ids:
            '<ArticleId IdType="pubmed">11111111</ArticleId>' +
            '<ArticleId IdType="pmc">10949956</ArticleId>',
        }),
      ),
    );
    expect(record.work.ids.pmcid).toBe("PMC10949956");
  });

  it("does not read the DOI out of ELocationID", () => {
    // §10.2's `ids.doi` row is `ArticleId[@IdType='doi']` and nothing else.
    const record = one(DOCS_02_SAMPLE);
    expect(record.work.ids.doi).toBe("10.1038/s41586-023-06139-9");
    const noArticleId = one(
      articleSet(
        article({
          eLocationId:
            '<ELocationID EIdType="doi" ValidYN="Y">10.1038/s41586-023-06139-9</ELocationID>',
        }),
      ),
    );
    expect(noArticleId.work.ids.doi).toBeUndefined();
    expect(noArticleId.missingFields).toContain("ids.doi");
  });

  it("reports a DOI that is present but not a DOI", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          ids:
            '<ArticleId IdType="pubmed">11111111</ArticleId>' +
            '<ArticleId IdType="doi">not a doi at all</ArticleId>',
        }),
      ),
    );
    expect(records[0]?.work.ids.doi).toBeUndefined();
    expect(records[0]?.missingFields).toContain("ids.doi");
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: DOI not understood",
    );
  });

  it("reports a PMCID that is present but not a PMCID", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          ids:
            '<ArticleId IdType="pubmed">11111111</ArticleId>' +
            '<ArticleId IdType="pmc">PMC-not-a-number</ArticleId>',
        }),
      ),
    );
    expect(records[0]?.work.ids.pmcid).toBeUndefined();
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: PMCID not understood",
    );
  });

  it("logs nothing when a DOI is simply absent", () => {
    const { map, warnings } = mapperWith();
    const records = map(articleSet(article({})));
    expect(records[0]?.missingFields).toContain("ids.doi");
    expect(warnings).toEqual([]);
  });

  it("drops an article with no usable PMID and says so", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        "<PubmedArticle><MedlineCitation><Article><ArticleTitle>No id.</ArticleTitle></Article></MedlineCitation></PubmedArticle>",
        article({ pmid: "22222222" }),
      ),
    );
    expect(records.map((r) => r.nativeId)).toEqual(["22222222"]);
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: article has no usable PMID, dropped",
    );
  });

  it("builds id as pubmed:<pmid> and nativeId as the bare PMID (step 10)", () => {
    const record = one(articleSet(article({ pmid: "33333333" })));
    expect(record.id).toBe("pubmed:33333333");
    expect(record.nativeId).toBe("33333333");
    expect(record.sourceId).toBe("pubmed");
  });
});

// ---------------------------------------------------------------------------
// 13. Subjects, keywords, venue, language, type
// ---------------------------------------------------------------------------

describe("subjects and keywords — step 7", () => {
  it("reads KeywordList/Keyword, across several lists", () => {
    const record = one(
      articleSet(
        article({
          keywords:
            '<KeywordList Owner="NOTNLM"><Keyword MajorTopicYN="N">CRISPR</Keyword>' +
            "<Keyword>base editing</Keyword></KeywordList>" +
            '<KeywordList Owner="NLM"><Keyword>prime editing</Keyword></KeywordList>',
        }),
      ),
    );
    expect(record.work.keywords).toEqual([
      "CRISPR",
      "base editing",
      "prime editing",
    ]);
  });

  it("reports a MeSH descriptor with no @UI, and still emits the term", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          mesh:
            "<MeshHeadingList><MeshHeading>" +
            '<DescriptorName MajorTopicYN="Y">Humans</DescriptorName>' +
            "</MeshHeading></MeshHeadingList>",
        }),
      ),
    );
    expect(records[0]?.work.subjects).toStrictEqual([
      { term: "Humans", scheme: "mesh", isMajor: true },
    ]);
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: MeSH descriptor has no UI",
    );
  });

  it("reports a MajorTopicYN that is neither Y nor N", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        article({
          mesh:
            "<MeshHeadingList><MeshHeading>" +
            '<DescriptorName UI="D006801" MajorTopicYN="maybe">Humans</DescriptorName>' +
            "</MeshHeading></MeshHeadingList>",
        }),
      ),
    );
    expect(records[0]?.work.subjects?.[0]?.isMajor).toBe(false);
    expect(warnings.map((w) => w.msg)).toContain(
      "pubmed mapper: MajorTopicYN not understood",
    );
  });

  it("logs nothing when there is no MeshHeadingList at all", () => {
    const { map, warnings } = mapperWith();
    const records = map(articleSet(article({})));
    expect(records[0]?.work.subjects).toBeUndefined();
    expect(records[0]?.missingFields).toContain("subjects");
    expect(warnings).toEqual([]);
  });
});

describe("venue, language and type — steps 8 and 9", () => {
  it("reads Journal/Title, ISOAbbreviation, ISSN, volume, issue and pages", () => {
    const record = one(articleSet(article({})));
    expect(record.work.containerTitle).toBe("Journal of Testing");
    expect(record.work.containerAbbreviation).toBe("J Test");
    expect(record.work.issn).toEqual(["0000-0000"]);
    expect(record.work.volume).toBe("1");
    expect(record.work.issue).toBe("2");
    expect(record.work.pages).toBe("1-9");
    expect(record.work.language).toBe("eng");
  });

  it("falls back to StartPage-EndPage when MedlinePgn is absent", () => {
    const record = one(
      articleSet(
        article({
          pagination:
            "<Pagination><StartPage>616</StartPage><EndPage>624</EndPage></Pagination>",
        }),
      ),
    );
    expect(record.work.pages).toBe("616-624");
  });

  it("reports pages as a gap when there is no Pagination at all", () => {
    const record = one(articleSet(article({ pagination: "" })));
    expect(record.work.pages).toBeUndefined();
    expect(record.missingFields).toContain("pages");
  });

  it("is journal-article when a venue with an ISSN exists", () => {
    expect(one(articleSet(article({}))).work.type).toBe("journal-article");
    expect(one(articleSet(article({}))).missingFields).not.toContain("type");
  });

  it("is other, and reports type, when no venue carries an ISSN", () => {
    const record = one(articleSet(article({ journal: JOURNAL_WITHOUT_ISSN })));
    expect(record.work.type).toBe("other");
    expect(record.missingFields).toContain("type");
    expect(record.missingFields).toContain("issn");
  });

  it("never emits docs/02 §10.2's camelCase Zotero item types", () => {
    for (const xml of [
      articleSet(article({})),
      articleSet(article({ journal: JOURNAL_WITHOUT_ISSN })),
    ]) {
      const type: string = one(xml).work.type;
      expect([
        "journalArticle",
        "bookSection",
        "conferencePaper",
      ]).not.toContain(type);
      expect(isWorkType(type)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. missingFields — step 9 and R-17
// ---------------------------------------------------------------------------

describe("missingFields — step 9, so P1-T22 can measure R-17", () => {
  it("only ever names a field from PUBMED_MAPPABLE_FIELDS", () => {
    for (const xml of [DOCS_02_SAMPLE, articleSet(article({}))]) {
      for (const field of one(xml).missingFields) {
        expect(PUBMED_MAPPABLE_FIELDS).toContain(field);
      }
    }
  });

  it("never names a field PubMed does not supply at all", () => {
    for (const field of ["citationCount", "openAccess", "publisher", "url"]) {
      expect(PUBMED_MAPPABLE_FIELDS).not.toContain(field);
      expect(one(articleSet(article({}))).missingFields).not.toContain(field);
    }
  });

  it("lists exactly the gaps of a maximally sparse record", () => {
    const sparse = one(
      articleSet(
        `<PubmedArticle><MedlineCitation><PMID>44444444</PMID>` +
          `<Article><ArticleTitle></ArticleTitle></Article></MedlineCitation>` +
          `<PubmedData><ArticleIdList></ArticleIdList></PubmedData></PubmedArticle>`,
      ),
    );
    expect([...sparse.missingFields].sort()).toEqual(
      [...PUBMED_MAPPABLE_FIELDS].sort(),
    );
    expect(sparse.work.title).toBe("");
    expect(sparse.work.authors).toEqual([]);
  });

  it("reports abstract coverage across a mixed batch", () => {
    const { map } = mapperWith();
    const records = map(
      articleSet(
        article({
          pmid: "1",
          abstract:
            "<Abstract><AbstractText>Has one.</AbstractText></Abstract>",
        }),
        article({ pmid: "2" }),
        article({
          pmid: "3",
          abstract:
            "<Abstract><AbstractText>Has one too.</AbstractText></Abstract>",
        }),
      ),
    );
    const withAbstract = records.filter(
      (r) => !r.missingFields.includes("abstract"),
    );
    expect(records).toHaveLength(3);
    expect(withAbstract).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 15. The batch, the clock, raw, and malformed bodies
// ---------------------------------------------------------------------------

describe("the batch — step 1 and step 10", () => {
  it("returns one record per PubmedArticle, in document order", () => {
    const { map } = mapperWith();
    const records = map(
      articleSet(
        article({ pmid: "111" }),
        article({ pmid: "222" }),
        article({ pmid: "333" }),
      ),
    );
    expect(records.map((r) => r.nativeId)).toEqual(["111", "222", "333"]);
  });

  it("returns an empty array for an empty set, without throwing", () => {
    const { map, warnings } = mapperWith();
    expect(map("<PubmedArticleSet></PubmedArticleSet>")).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("reports a PubmedArticleSet child it cannot map", () => {
    const { map, warnings } = mapperWith();
    const records = map(
      articleSet(
        "<PubmedBookArticle><BookDocument><PMID>55555555</PMID></BookDocument></PubmedBookArticle>",
        article({ pmid: "666" }),
      ),
    );
    expect(records.map((r) => r.nativeId)).toEqual(["666"]);
    expect(warnings[0]?.msg).toBe(
      "pubmed mapper: unmapped PubmedArticleSet child skipped",
    );
    expect(warnings[0]?.ctx["path"]).toBe("PubmedArticleSet/PubmedBookArticle");
  });

  it("stamps retrievedAtEpochMs from the injected clock, once per batch", () => {
    const clock = createManualClock(FROZEN_NOW);
    const map = createPubmedRecordMapper({ clock, parseXml: parseXmlInNode });
    const records = map(
      articleSet(article({ pmid: "1" }), article({ pmid: "2" })),
    );
    expect(records.map((r) => r.retrievedAtEpochMs)).toEqual([
      FROZEN_NOW,
      FROZEN_NOW,
    ]);
    clock.advance(5_000);
    expect(map(articleSet(article({})))[0]?.retrievedAtEpochMs).toBe(
      FROZEN_NOW + 5_000,
    );
  });

  it("omits raw by default — NFR-7's no-retention rule", () => {
    const record = one(DOCS_02_SAMPLE);
    expect(record.raw).toBeUndefined();
    expect("raw" in record).toBe(false);
  });

  it("keeps raw only when keepRaw is on, and shares one string per batch", () => {
    const { map } = mapperWith({ keepRaw: true });
    const xml = articleSet(article({ pmid: "1" }), article({ pmid: "2" }));
    const records = map(xml);
    expect(records[0]?.raw).toBe(xml);
    expect(records[1]?.raw).toBe(records[0]?.raw);
  });

  it("throws ParseError for a body that is not well-formed XML", () => {
    const { map } = mapperWith();
    expect(() => map("<PubmedArticleSet><PubmedArticle>")).toThrow(ParseError);
    expect(() => map("")).toThrow(ParseError);
  });

  it("tells a malformed body apart from an unexpected root, and keeps the parser's own reason", () => {
    // Without this, dropping the `<parsererror>` branch entirely changes
    // nothing a test can see — the root check throws `ParseError` too, just
    // with a message that blames the root element and loses the parser's
    // diagnostic. Measured: mutation M13 passed all 86 tests before this.
    const { map } = mapperWith();
    try {
      map("<PubmedArticleSet><PubmedArticle>");
      expect.unreachable();
    } catch (error) {
      expect((error as ParseError).message).toBe(
        "efetch response is not well-formed XML",
      );
      expect((error as ParseError).context["detail"]).toBe("unclosed element");
    }
  });

  it("throws ParseError rather than returning zero records for the wrong root", () => {
    const { map } = mapperWith();
    expect(() =>
      map("<eFetchResult><ERROR>bad id</ERROR></eFetchResult>"),
    ).toThrow(/root is <eFetchResult>/u);
  });

  it("names the source on every ParseError it throws", () => {
    const { map } = mapperWith();
    try {
      map("<nope/>");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).sourceId).toBe("pubmed");
      expect((error as ParseError).code).toBe("PARSE");
    }
  });

  it("works with no logger at all", () => {
    const clock = createManualClock(FROZEN_NOW);
    const map = createPubmedRecordMapper({ clock, parseXml: parseXmlInNode });
    expect(() => map(articleSet(article({ pmid: "" })))).not.toThrow();
  });

  it("is assignable to P1-T09's injected PubmedRecordMapper", () => {
    // The shape of this module is fixed by its one call site, not by this
    // card: `pubmedSource.ts` declares `PubmedRecordMapper` and
    // `PubmedSourceDeps.mapRecords` is typed with it. The annotation below is
    // the assertion — it is a typecheck failure if the two ever drift.
    const clock = createManualClock(FROZEN_NOW);
    const mapper: PubmedRecordMapper = createPubmedRecordMapper({
      clock,
      parseXml: parseXmlInNode,
    });
    const deps: Pick<PubmedSourceDeps, "mapRecords"> = { mapRecords: mapper };
    expect(deps.mapRecords(DOCS_02_SAMPLE)[0]?.id).toBe("pubmed:37258680");
  });
});

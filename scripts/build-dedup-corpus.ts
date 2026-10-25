/**
 * `scripts/build-dedup-corpus.ts` — the candidate-pair builder behind
 * `test/fixtures/dedup/` (`P2-T13` Part A, `plan/03`).
 *
 * **What it does.** It reads every committed recorded fixture of the seven
 * sources, turns each response body into `SourceRecord`s with the **shipped**
 * parsers and mappers, pools the records, and writes every pair of records the
 * dedup cascade's blocking step would put through the cascade — plus the pairs
 * blocking deliberately skips, marked as such — to an **unlabelled** file a
 * human then labels `duplicate` / `not-duplicate` / `linked-version`.
 *
 * **What it never does.** It never writes a label. The card's Do NOT: "The
 * whole value of the corpus is that the labels are independent of the code
 * under test." A label in the output is always one a human typed: carried over
 * from an earlier `pairs.jsonl` by pair id, or copied from a labelling sheet
 * with `--merge-labels`. Nothing here calls the cascade's verdicts
 * (`compareCandidates`, `dedupeRecords`); `scripts/dedup-report.ts` does that,
 * and only on a labelled file.
 *
 * **No network, by construction.** Which request produced which fixture comes
 * from `scripts/record-fixtures.ts`'s {@link planFor} — the recorder's own plan,
 * built from `test/support/*RecordedRequests.ts` — and the plan's dependent
 * requests (pagination, PubMed's `efetch` after `esearch`) are resolved from
 * the committed fixtures by {@link committedAnswer}. Nothing here imports an
 * HTTP client.
 *
 * ## Running it
 *
 * ```sh
 * npx tsx scripts/build-dedup-corpus.ts                     # rebuild, keep labels
 * npx tsx scripts/build-dedup-corpus.ts --check             # exit 1 if the files drifted
 * npx tsx scripts/build-dedup-corpus.ts --merge-labels f.csv  # copy a human's labels in
 * ```
 *
 * ## The three output files
 *
 * - `pairs.jsonl` — the corpus. One pair per line, `label` and `reason` first
 *   so they sit at the start of each line. The file `scripts/dedup-report.ts`
 *   and `P2-T13` Part B's accuracy test read.
 * - `pairs.csv` — the label-set pairs as a labelling sheet: UTF-8 with a byte-order
 *   mark so a spreadsheet shows Korean and accented names, one row per pair,
 *   the `label` and `reason` columns second and third. Fill those two columns
 *   and run `--merge-labels`; the sheet is regenerated from `pairs.jsonl`.
 * - `_meta.json` — the `docs/13` §3.2 sidecar, describing the corpus as
 *   **derived** from the listed committed fixtures. Its `recordedAt` is the
 *   **oldest** input fixture's, so `docs/13` §3.3's staleness clock runs from
 *   the oldest data in the corpus.
 *
 * ## The label set (owner's decision, 2026-10-16)
 *
 * `plan/00` §6 item 223: of the 231 pairs among the 22 Crossref "Enhanced
 * Surveillance of COVID-19 in Scotland" reports, and of the 78 pairs of
 * identical short Crossref titles, **20 of each** are labelled; every other
 * pair is labelled in full. The two clusters are recognised from record
 * fields ({@link sampledClusterOf}), and the 20 are the smallest values of a
 * fixed, salted SHA-256 of the pair id ({@link labelSetRank},
 * {@link labelSetOf}) — deterministic, and independent of input order and of
 * every engine verdict. Every pair stays in `pairs.jsonl`, marked
 * `labelSet: true|false` with its `sampleCluster`; `pairs.csv` holds the label
 * set only; `scripts/dedup-report.ts` measures the labelled label-set pairs
 * only and prints how many were sampled out. Section 4b has the details.
 *
 * **Narrowed 2026-10-16 (`plan/00` §6 item 226):** the short-title cluster
 * holds only titles that carry a book-part heading — "Part II", "Part III
 * Introduction" ({@link PART_HEADING}) — so that the two identical Crossref
 * titles that are not series headings ("Genome editing using CRISPR",
 * "Psoroptic mange") are labelled in full, as the owner decided.
 *
 * ## Redaction
 *
 * Every value written is copied from a committed fixture that already passed
 * the recorder's redaction pass. The output is still put through the
 * recorder's own {@link assertClean} — the `docs/13` §3.2 check — before it is
 * written, with the source plans' own opaque-token exemptions (a Semantic
 * Scholar `paperId` is 40 hex characters, which the catch-all would otherwise
 * refuse). No redaction rule is declared in this file.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createManualClock } from "../src/core/clock";
import type { SourceRecord } from "../src/model/sourceRecord";
import { parseArxivFeedBody } from "../src/sources/arxiv/arxivSource";
import { createArxivRecordMapper } from "../src/sources/arxiv/mapper";
import { parseBiorxivBody } from "../src/sources/biorxiv/biorxivSource";
import { createBiorxivRecordMapper } from "../src/sources/biorxiv/mapper";
import { parseCrossrefWorksBody } from "../src/sources/crossref/crossrefSource";
import { createCrossrefRecordMapper } from "../src/sources/crossref/mapper";
import { parseEuropePmcSearchBody } from "../src/sources/europepmc/europepmcSource";
import { createEuropePmcRecordMapper } from "../src/sources/europepmc/mapper";
import { createPubmedRecordMapper } from "../src/sources/pubmed/mapper";
import { createSemanticScholarRecordMapper } from "../src/sources/semanticscholar/mapper";
import {
  parseBatchBody,
  parsePaperBody,
  parseSearchBody,
} from "../src/sources/semanticscholar/semanticscholarSource";
import {
  ID_KINDS,
  MAX_YEAR_DELTA,
  toCandidate,
  yearDelta,
  type DedupCandidate,
  type NormalizedIds,
} from "../src/sources/shared/dedupe";
import {
  fixtureKey,
  META_SUFFIX,
  type FixtureMeta,
  type RecordedExchange,
} from "../test/contract/_transport";
import { sha256Hex } from "../test/support/sha256";
import {
  assertClean,
  literalDenyList,
  planFor,
  RECORDABLE_SOURCES,
  type Answer,
  type PlannedRequest,
  type RecordableSourceId,
} from "./record-fixtures";

// ---------------------------------------------------------------------------
// 0. Paths and vocabulary
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** `test/fixtures/dedup/`, the corpus directory the card names. */
export const DEDUP_CORPUS_DIR = resolve(REPO_ROOT, "test/fixtures/dedup");
/** The corpus file `P2-T13`'s `Files` list creates. */
export const PAIRS_FILE = "pairs.jsonl";
/** The labelling sheet: the same pairs, one spreadsheet row each. */
export const SHEET_FILE = "pairs.csv";
/** The `docs/13` §3.2 sidecar, named as the card names it. */
export const META_FILE = "_meta.json";

/** `P2-T13` step 2's three labels — the only values a label may take. */
export const PAIR_LABELS = [
  "duplicate",
  "not-duplicate",
  "linked-version",
] as const;
export type PairLabel = (typeof PAIR_LABELS)[number];

/** Is `value` one of {@link PAIR_LABELS}? */
export function isPairLabel(value: string): value is PairLabel {
  return (PAIR_LABELS as readonly string[]).includes(value);
}

/** The `_meta.json` scenario name, and its version: bump when the pair rule changes. */
export const CORPUS_SCENARIO = "dedup-candidate-pairs";
export const CORPUS_SCENARIO_VERSION = 1;

/** A fixed clock: `retrievedAtEpochMs` is never written, but the mappers need one. */
const CLOCK = createManualClock();

// ---------------------------------------------------------------------------
// 1. An XML parser for Node
//
// Node has no `DOMParser`, and the sandbox's is what the mappers' XML ports
// default to. Three unit tests each ship a parser shaped to one mapper's port;
// none is importable from here (they live in `*.test.ts` files, whose
// `describe` calls run on import). This one satisfies all three ports
// structurally — PubMed's and arXiv's element slices and Crossref's node
// slice — and mimics Gecko's two behaviours the mappers depend on: a parse
// failure is a `<parsererror>` document, not an exception, and an undeclared
// namespace prefix is a parse failure.
// ---------------------------------------------------------------------------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** A text node, as Crossref's JATS walk reads one. */
class NodeXmlText {
  readonly nodeType = TEXT_NODE;
  readonly localName = null;
  readonly childNodes = { length: 0, item: (): null => null };
  constructor(readonly nodeValue: string) {}
}

/** An element, as all three mappers read one. */
class NodeXmlElement {
  readonly nodeType = ELEMENT_NODE;
  readonly nodeValue = null;
  readonly nodes: (NodeXmlElement | NodeXmlText)[] = [];
  constructor(
    readonly namespaceURI: string | null,
    readonly localName: string,
    readonly qname: string,
    private readonly attrs: ReadonlyMap<string, string>,
  ) {}
  get textContent(): string {
    return this.nodes
      .map((n) => (n instanceof NodeXmlText ? n.nodeValue : n.textContent))
      .join("");
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  get children(): {
    readonly length: number;
    item(i: number): NodeXmlElement | null;
  } {
    const els = this.nodes.filter(
      (n): n is NodeXmlElement => n instanceof NodeXmlElement,
    );
    return { length: els.length, item: (i) => els[i] ?? null };
  }
  get childNodes(): {
    readonly length: number;
    item(i: number): NodeXmlElement | NodeXmlText | null;
  } {
    const nodes = this.nodes;
    return { length: nodes.length, item: (i) => nodes[i] ?? null };
  }
}

/** The document the parser returns. */
interface NodeXmlDocument {
  readonly documentElement: NodeXmlElement | null;
}

const XML_NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode XML's five named references and numeric character references. */
function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu,
    (_m, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      const named = XML_NAMED[body];
      if (named === undefined) throw new Error(`undeclared entity &${body};`);
      return named;
    },
  );
}

/**
 * Parse an XML document well enough for PubMed `efetch`, an arXiv Atom feed
 * and a Crossref JATS abstract: declarations, DOCTYPEs (with an internal
 * subset), comments, CDATA, attributes, self-closing tags, mixed content,
 * character references and namespaces.
 *
 * @param xml - the document text
 * @returns the document; a `<parsererror>` root on malformed input
 */
export function parseXmlInNode(xml: string): NodeXmlDocument {
  const stack: { node: NodeXmlElement; ns: ReadonlyMap<string, string> }[] = [];
  let root: NodeXmlElement | null = null;
  let i = 0;
  const scope = (): ReadonlyMap<string, string> =>
    stack[stack.length - 1]?.ns ?? new Map<string, string>();
  const append = (node: NodeXmlElement | NodeXmlText): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (node instanceof NodeXmlText) {
        if (node.nodeValue.trim() !== "") {
          throw new Error("text outside the root");
        }
        return;
      }
      if (root !== null) throw new Error("content after the root element");
      root = node;
    } else {
      top.node.nodes.push(node);
    }
  };
  try {
    while (i < xml.length) {
      if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i);
        if (end === -1) throw new Error("unterminated comment");
        i = end + 3;
      } else if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        if (end === -1) throw new Error("unterminated CDATA");
        append(new NodeXmlText(xml.slice(i + 9, end)));
        i = end + 3;
      } else if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i);
        if (end === -1) throw new Error("unterminated declaration");
        i = end + 2;
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
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated end tag");
        const name = xml.slice(i + 2, end).trim();
        const top = stack.pop();
        if (top === undefined || top.node.qname !== name) {
          throw new Error(`mismatched end tag </${name}>`);
        }
        i = end + 1;
      } else if (xml[i] === "<") {
        i = readStartTag(xml, i, scope(), append, (node, ns) =>
          stack.push({ node, ns }),
        );
      } else {
        const next = xml.indexOf("<", i);
        const textEnd = next === -1 ? xml.length : next;
        append(new NodeXmlText(decodeXml(xml.slice(i, textEnd))));
        i = textEnd;
      }
    }
    if (stack.length > 0) throw new Error("unclosed element");
    if (root === null) throw new Error("no root element");
    return { documentElement: root };
  } catch (error) {
    const el = new NodeXmlElement(
      null,
      "parsererror",
      "parsererror",
      new Map(),
    );
    el.nodes.push(
      new NodeXmlText(error instanceof Error ? error.message : String(error)),
    );
    return { documentElement: el };
  }
}

/** Read one start tag at `start`; returns the index after it. */
function readStartTag(
  xml: string,
  start: number,
  inScope: ReadonlyMap<string, string>,
  append: (node: NodeXmlElement) => void,
  open: (node: NodeXmlElement, ns: ReadonlyMap<string, string>) => void,
): number {
  const nameMatch = /^<([A-Za-z_][\w.:-]*)/u.exec(
    xml.slice(start, start + 256),
  );
  const qname = nameMatch?.[1];
  if (qname === undefined) throw new Error("malformed start tag");
  let i = start + 1 + qname.length;
  const attrs = new Map<string, string>();
  const ns = new Map(inScope);
  for (;;) {
    while (i < xml.length && /\s/u.test(xml[i] ?? "")) i += 1;
    if (i >= xml.length) throw new Error("unterminated start tag");
    const selfClosing = xml.startsWith("/>", i);
    if (selfClosing || xml[i] === ">") {
      const colon = qname.indexOf(":");
      const prefix = colon === -1 ? "" : qname.slice(0, colon);
      const local = colon === -1 ? qname : qname.slice(colon + 1);
      if (prefix !== "" && prefix !== "xml" && !ns.has(prefix)) {
        throw new Error(`undeclared prefix ${prefix}`);
      }
      const uri =
        prefix === "" ? (ns.get("") ?? null) : (ns.get(prefix) ?? null);
      const node = new NodeXmlElement(uri, local, qname, attrs);
      append(node);
      if (selfClosing) return i + 2;
      open(node, ns);
      return i + 1;
    }
    const attrMatch = /^([^\s=/>]+)\s*=\s*(["'])([^]*?)\2/u.exec(
      xml.slice(i, i + 65536),
    );
    if (attrMatch === null) throw new Error("malformed attribute");
    const [whole, attrName = "", , attrValue = ""] = attrMatch;
    const value = decodeXml(attrValue);
    if (attrName === "xmlns") ns.set("", value);
    else if (attrName.startsWith("xmlns:")) ns.set(attrName.slice(6), value);
    attrs.set(attrName, value);
    i += whole.length;
  }
}

// ---------------------------------------------------------------------------
// 2. Records from the committed fixtures
// ---------------------------------------------------------------------------

/** One record in the pool, with every fixture it was read from. */
export interface CorpusRecord {
  readonly record: SourceRecord;
  /** `<source>/<scenario>`, in plan order; more than one when re-read. */
  readonly seenIn: readonly string[];
}

/** What reading one source's fixtures found. */
export interface SourceLoadReport {
  readonly source: RecordableSourceId;
  /** Planned, non-synthetic requests whose fixture is on disk. */
  readonly fixturesRead: number;
  /** Of those, how many yielded at least one record. */
  readonly fixturesWithRecords: number;
  /** Records mapped from this source's fixtures, before pooling. */
  readonly recordsMapped: number;
  /** One line per fixture that yielded nothing, with the reason. */
  readonly yieldedNothing: readonly string[];
  /** Planned requests with no fixture on disk. */
  readonly missing: readonly string[];
}

/** One input fixture, for the sidecar's `derivedFrom`. */
export interface DerivedFrom {
  readonly source: RecordableSourceId;
  readonly key: string;
  readonly scenario: string;
  readonly recordedAt: string;
}

/** Everything {@link loadCorpusRecords} returns. */
export interface LoadedCorpus {
  /** The pooled records, one per `SourceRecord.id`, sorted by id. */
  readonly records: readonly CorpusRecord[];
  readonly perSource: readonly SourceLoadReport[];
  /** Every non-synthetic fixture read, whether or not it yielded records. */
  readonly derivedFrom: readonly DerivedFrom[];
}

/** An {@link Answer} that reads committed fixtures from `dir` — never the network. */
function committedAnswer(dir: string): Answer {
  return async (planned) => {
    try {
      const text = await readFile(`${dir}/${keyOf(planned)}.json`, "utf8");
      return JSON.parse(text) as RecordedExchange;
    } catch {
      return undefined;
    }
  };
}

/** The planned request's fixture key. */
function keyOf(p: PlannedRequest): string {
  return fixtureKey({
    method: p.method,
    url: p.url,
    ...(p.body !== undefined && { body: p.body }),
  });
}

/** Read and parse a JSON file, or `undefined` when it is absent. */
async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return JSON.parse(text) as T;
}

/** `/details/<server>` or `/pubs/<server>` out of a bioRxiv endpoint URL. */
function biorxivEndpointOf(endpoint: string): "details" | "pubs" | undefined {
  if (endpoint.includes("/details/")) return "details";
  if (endpoint.includes("/pubs/")) return "pubs";
  return undefined;
}

/**
 * Map one recorded response body to records with the shipped parser and
 * mapper the adapter itself calls for that endpoint — `search()`'s and
 * `lookup()`'s own pairs, one per endpoint. PubMed's `esearch` carries only
 * identifiers, so it maps to nothing; its `efetch` carries the records.
 *
 * @returns the records, or a reason string when the body yields none
 */
export function mapRecordedBody(
  source: RecordableSourceId,
  planned: PlannedRequest,
  body: string,
): readonly SourceRecord[] | string {
  const url = planned.url;
  const endpoint = planned.endpoint;
  switch (source) {
    case "pubmed":
      if (!endpoint.endsWith("/efetch.fcgi")) {
        return "esearch: identifiers only, no records";
      }
      return createPubmedRecordMapper({
        clock: CLOCK,
        parseXml: parseXmlInNode,
      })(body);
    case "europepmc":
      return createEuropePmcRecordMapper({ clock: CLOCK })(
        parseEuropePmcSearchBody(body, url).results,
      );
    case "crossref":
      return createCrossrefRecordMapper({
        clock: CLOCK,
        parseXml: parseXmlInNode,
      })(parseCrossrefWorksBody(body, url).items);
    case "arxiv":
      return createArxivRecordMapper({ clock: CLOCK })(
        parseArxivFeedBody(body, parseXmlInNode, url).entries,
      );
    case "semanticscholar": {
      const map = createSemanticScholarRecordMapper({ clock: CLOCK });
      if (endpoint.endsWith("/paper/batch"))
        return map(parseBatchBody(body, url));
      if (endpoint.includes("/paper/search")) {
        return map(parseSearchBody(body, url).data);
      }
      return map([parsePaperBody(body, url)]);
    }
    case "biorxiv":
    case "medrxiv": {
      const which = biorxivEndpointOf(endpoint);
      if (which === undefined) return `unknown bioRxiv endpoint ${endpoint}`;
      const parsed = parseBiorxivBody(body, source, url);
      if (!parsed.found) return `not found (status "${parsed.status}")`;
      return createBiorxivRecordMapper({ clock: CLOCK })(parsed.collection, {
        endpoint: which,
        requestedServer: source,
      });
    }
  }
}

/**
 * Every record the committed fixtures of all seven sources hold, pooled.
 *
 * Reads only planned, non-synthetic fixtures: a hand-written `error-429` is
 * not evidence about any paper. A record read from two fixtures (a source's
 * `record-rich` that also appears in its `search-typical`) is kept once, at
 * its first sighting, with both sightings listed — a source never returns one
 * record twice in one result set, so a pair of a record with itself would be
 * noise for the labeller.
 */
export async function loadCorpusRecords(): Promise<LoadedCorpus> {
  const byId = new Map<string, { record: SourceRecord; seenIn: string[] }>();
  const perSource: SourceLoadReport[] = [];
  const derivedFrom: DerivedFrom[] = [];
  for (const source of RECORDABLE_SOURCES) {
    const plan = planFor(source);
    const dir = plan.fixtureDir;
    const requests = [
      ...plan.independent(),
      ...(await plan.dependent(committedAnswer(dir))),
    ];
    let fixturesRead = 0;
    let fixturesWithRecords = 0;
    let recordsMapped = 0;
    const yieldedNothing: string[] = [];
    const missing: string[] = [];
    const seenKeys = new Set<string>();
    for (const planned of requests) {
      const key = keyOf(planned);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const exchange = await readJsonIfPresent<RecordedExchange>(
        `${dir}/${key}.json`,
      );
      const meta = await readJsonIfPresent<FixtureMeta>(
        `${dir}/${key}${META_SUFFIX}`,
      );
      if (exchange === undefined || meta === undefined) {
        missing.push(planned.scenario);
        continue;
      }
      if (meta.synthetic) continue;
      fixturesRead += 1;
      derivedFrom.push({
        source,
        key,
        scenario: meta.scenario,
        recordedAt: meta.recordedAt,
      });
      const sighting = `${source}/${meta.scenario}`;
      let mapped: readonly SourceRecord[] | string;
      if (exchange.status !== 200) {
        mapped = `HTTP ${String(exchange.status)}`;
      } else {
        try {
          mapped = mapRecordedBody(source, planned, exchange.body);
        } catch (error) {
          mapped =
            error instanceof Error
              ? `${error.name}: ${error.message.slice(0, 120)}`
              : String(error);
        }
      }
      if (typeof mapped === "string" || mapped.length === 0) {
        yieldedNothing.push(
          `${meta.scenario}: ${typeof mapped === "string" ? mapped : "zero records"}`,
        );
        continue;
      }
      fixturesWithRecords += 1;
      recordsMapped += mapped.length;
      for (const record of mapped) {
        const known = byId.get(record.id);
        if (known === undefined) {
          byId.set(record.id, { record, seenIn: [sighting] });
        } else if (!known.seenIn.includes(sighting)) {
          known.seenIn.push(sighting);
        }
      }
    }
    perSource.push({
      source,
      fixturesRead,
      fixturesWithRecords,
      recordsMapped,
      yieldedNothing,
      missing,
    });
  }
  const records = [...byId.values()].sort((x, y) =>
    compareStrings(x.record.id, y.record.id),
  );
  derivedFrom.sort(
    (x, y) =>
      compareStrings(x.source, y.source) || compareStrings(x.key, y.key),
  );
  return { records, perSource, derivedFrom };
}

/** Code-unit order, so the output does not depend on the machine's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 3. Candidate pairs — the blocking step, verdict-free
// ---------------------------------------------------------------------------

/**
 * Why a pair is in the corpus. The first five are the pair sources of
 * `dedupeCascade` in `src/sources/shared/dedupe.ts` — the pairs the shipped
 * cascade compares. The last two are pairs the cascade **never** compares,
 * included so that a true duplicate blocking misses is in the corpus and
 * counts against recall instead of being invisible:
 *
 * - `id:<kind>` — the two records share that identifier (identifier pass).
 * - `accession` — the two share a bioRxiv/medRxiv accession (identifier pass).
 * - `version-link` — one names the other in `relatedVersionIds` (`P2-T11`).
 * - `block` — same title signature, years within {@link MAX_YEAR_DELTA} or
 *   unknown (blocking pass, `docs/02` §11.3.3).
 * - `block-year-gap` — same title signature, years further apart than
 *   {@link MAX_YEAR_DELTA}: blocking skips these. `P2-T13` step 3's
 *   same-title-different-year family lives here.
 * - `short-title-identical` — two titles too short to have a signature that
 *   are identical after `normalizeTitle`: blocking skips these (`docs/02`
 *   §11.3.3 guard 1). The `"Retraction"` / `"Correction"` family lives here.
 */
export type PairOrigin =
  | `id:${keyof NormalizedIds}`
  | "accession"
  | "version-link"
  | "block"
  | "block-year-gap"
  | "short-title-identical";

/** The origins the shipped cascade compares; the others it never does. */
export const ENGINE_ORIGINS: ReadonlySet<PairOrigin> = new Set<PairOrigin>([
  ...ID_KINDS.map((k): PairOrigin => `id:${k}`),
  "accession",
  "version-link",
  "block",
]);

/** One unordered pair of pooled records; `a.id < b.id`. */
export interface CandidatePair {
  readonly pairId: string;
  readonly a: SourceRecord;
  readonly b: SourceRecord;
  readonly origins: readonly PairOrigin[];
}

/**
 * The stable pair id: a hash of the two record ids in code-unit order.
 * `SourceRecord.id` is `<source>:<native id>` for every mapper, so the id
 * survives a re-record that returns the same records.
 */
export function pairIdOf(idA: string, idB: string): string {
  const [lo, hi] = compareStrings(idA, idB) <= 0 ? [idA, idB] : [idB, idA];
  return `p-${sha256Hex(`${lo}\n${hi}`).slice(0, 12)}`;
}

/** Append `value` under `key` in a map of lists. */
function pushInto<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Every pair the blocking step would put through the cascade, plus the two
 * kinds it skips by design ({@link PairOrigin}).
 *
 * **Verdict-free.** The cascade's own driver skips a pair once an earlier
 * `"match"` has put both records in one group, and compares a shared
 * identifier's later holders with its first holder only. Both shortcuts
 * depend on verdicts, so a corpus that inherited them would depend on the
 * code it measures. Here every pair of holders of one key is emitted, and no
 * pair is skipped for any decision. The candidate set is therefore a superset
 * of what the cascade compares (asserted in
 * `test/unit/sources/dedupeCorpus.test.ts`).
 *
 * Built from the cascade's exported pieces — {@link toCandidate} (its
 * normalized ids, accession, title signature and year), {@link ID_KINDS},
 * {@link yearDelta} and {@link MAX_YEAR_DELTA} — so a change to blocking moves
 * the candidate set with it.
 *
 * @param records - the pooled records, in any order
 * @returns the pairs, sorted by pair id
 */
export function candidatePairs(
  records: readonly SourceRecord[],
): readonly CandidatePair[] {
  const candidates = records.map(toCandidate);
  const origins = new Map<string, Set<PairOrigin>>();
  const add = (i: number, j: number, origin: PairOrigin): void => {
    if (i === j) return;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const k = `${String(lo)}:${String(hi)}`;
    const set = origins.get(k);
    if (set === undefined) origins.set(k, new Set([origin]));
    else set.add(origin);
  };
  const allPairsOf = (holders: readonly number[], origin: PairOrigin): void => {
    for (let x = 0; x < holders.length; x += 1) {
      for (let y = x + 1; y < holders.length; y += 1) {
        const i = holders[x];
        const j = holders[y];
        if (i !== undefined && j !== undefined) add(i, j, origin);
      }
    }
  };

  // Identifier pass: every pair of holders of each id, and of each accession.
  for (const kind of ID_KINDS) {
    const byKey = new Map<string, number[]>();
    candidates.forEach((c, i) => {
      const v = c.ids[kind];
      if (v !== undefined) pushInto(byKey, v, i);
    });
    for (const holders of byKey.values()) allPairsOf(holders, `id:${kind}`);
  }
  const byAccession = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (c.accession !== undefined) pushInto(byAccession, c.accession, i);
  });
  for (const holders of byAccession.values()) allPairsOf(holders, "accession");

  // Version links: a record and every record its relatedVersionIds names.
  const byOwnId = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    for (const kind of ID_KINDS) {
      const v = c.ids[kind];
      if (v !== undefined) pushInto(byOwnId, `${kind}:${v}`, i);
    }
    if (c.epmcId !== undefined) pushInto(byOwnId, `epmcId:${c.epmcId}`, i);
  });
  candidates.forEach((c, i) => {
    for (const key of namedVersionKeys(c)) {
      for (const j of byOwnId.get(key) ?? []) add(i, j, "version-link");
    }
  });

  // Blocking pass: one bucket per title signature, split by year tolerance.
  const bySignature = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (c.signature !== undefined) pushInto(bySignature, c.signature, i);
  });
  for (const bucket of bySignature.values()) {
    for (let x = 0; x < bucket.length; x += 1) {
      for (let y = x + 1; y < bucket.length; y += 1) {
        const i = bucket[x];
        const j = bucket[y];
        const a = i === undefined ? undefined : candidates[i];
        const b = j === undefined ? undefined : candidates[j];
        if (i === undefined || j === undefined || !a || !b) continue;
        const delta = yearDelta(a, b);
        add(
          i,
          j,
          delta === undefined || delta <= MAX_YEAR_DELTA
            ? "block"
            : "block-year-gap",
        );
      }
    }
  }

  // Identical short titles, which have no signature and are never bucketed.
  const byShortTitle = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (c.signature === undefined && c.title.length > 0) {
      pushInto(byShortTitle, c.title, i);
    }
  });
  for (const holders of byShortTitle.values()) {
    allPairsOf(holders, "short-title-identical");
  }

  const out: CandidatePair[] = [];
  for (const [k, set] of origins) {
    const [loText, hiText] = k.split(":");
    const a = records[Number(loText)];
    const b = records[Number(hiText)];
    if (a === undefined || b === undefined) continue;
    const [first, second] = compareStrings(a.id, b.id) <= 0 ? [a, b] : [b, a];
    out.push({
      pairId: pairIdOf(first.id, second.id),
      a: first,
      b: second,
      origins: [...set].sort(compareStrings),
    });
  }
  return out.sort((x, y) => compareStrings(x.pairId, y.pairId));
}

/** The `<kind>:<value>` keys a candidate's `relatedVersionIds` names. */
function namedVersionKeys(c: DedupCandidate): readonly string[] {
  const named: string[] = [];
  for (const kind of ID_KINDS) {
    const v = c.relatedVersionIds?.[kind];
    if (v !== undefined) named.push(`${kind}:${v}`);
  }
  if (c.relatedEpmcId !== undefined) named.push(`epmcId:${c.relatedEpmcId}`);
  return named;
}

// ---------------------------------------------------------------------------
// 4. The step-3 families — counted from features, never from verdicts
//
// Each family is `P2-T13` step 3's wording turned into a test on the records'
// own fields. **None of them calls the cascade's guards** (`seriesMarkersDiffer`,
// `isPreprintPair`, `isTitleComparable`): a family detected by the function
// under test would vanish exactly when that function is wrong. The title
// normal form below is a separate, deliberately plain one for the same reason.
// These are *candidate* families — a pair can sit in the preprint family and
// still be labelled `not-duplicate`. Part B re-counts them with labels.
// ---------------------------------------------------------------------------

/** The families of `P2-T13` step 3, plus `docs/02` §11.3.3's Korean-title note. */
export const FAMILY_IDS = [
  "same-work-3-sources",
  "preprint-published",
  "short-title",
  "series-title",
  "same-title-diff-year-diff-venue",
  "prefix-10.64898",
  "korean-title",
] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

/**
 * `P2-T13` step 3's minimums, verbatim. `same-work-3-sources` counts **sets**,
 * every other family counts **pairs**. `korean-title` has no minimum: `docs/02`
 * §11.3.3 says the corpus "carries Korean titles" and states no number, so
 * none is invented here (`plan/README.md` §5 rule 4).
 */
export const STEP3_MINIMUMS: Readonly<Partial<Record<FamilyId, number>>> = {
  "same-work-3-sources": 10,
  "preprint-published": 5,
  "short-title": 5,
  "series-title": 5,
  "same-title-diff-year-diff-venue": 5,
  "prefix-10.64898": 5,
};

/**
 * `P2-T13` step 2's floor on the label set's size. Since 2026-10-25 (`plan/00` §6 item 284(c)) the owner labels
 * a recorded sample of 60 of these pairs (`scripts/dedup-label-sample.ts`), not 200 of them.
 */
export const MIN_LABELLED_PAIRS = 200;

/** `docs/02` §11.3.3 guard 1: "Titles under 5 normalized tokens". */
const SHORT_TITLE_TOKENS = 5;

/** `docs/02` §11.3.3 guard 2's pattern, as the document spells it. */
const SERIES_MARKER = /\b(part\s+)?([ivxlc]+|\d+)$/;

/** Preprint DOI prefixes (`docs/02` §11.2): bioRxiv/medRxiv old and new, arXiv's DataCite. */
const PREPRINT_DOI_PREFIXES_PLAIN = ["10.1101/", "10.64898/", "10.48550/"];

/** Sources that serve only preprints. */
const PREPRINT_SOURCES: ReadonlySet<string> = new Set([
  "arxiv",
  "biorxiv",
  "medrxiv",
]);

/** Hangul syllables, jamo and compatibility jamo. */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;

/** Lowercased, accents dropped, every non-letter non-digit a single space. */
function plainTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function plainTokens(title: string): readonly string[] {
  const t = plainTitle(title);
  return t === "" ? [] : t.split(" ");
}

function yearOf(r: SourceRecord): number | undefined {
  return r.work.publishedDate?.year ?? r.work.onlineDate?.year;
}

function venueOf(r: SourceRecord): string | undefined {
  const v = r.work.containerTitle;
  const plain = v === undefined ? "" : plainTitle(v);
  return plain === "" ? undefined : plain;
}

function doiOf(r: SourceRecord): string | undefined {
  const d = r.work.ids.doi?.trim().toLowerCase();
  return d === undefined || d === "" ? undefined : d;
}

/** The identifiers that name one work across sources, as `<kind>:<value>`. */
function strongIds(ids: SourceRecord["work"]["ids"] | undefined): string[] {
  if (ids === undefined) return [];
  const out: string[] = [];
  const push = (kind: string, v: string | undefined): void => {
    const s = v?.trim().toLowerCase();
    if (s !== undefined && s !== "") out.push(`${kind}:${s}`);
  };
  push("doi", ids.doi);
  push("pmid", ids.pmid);
  push("pmcid", ids.pmcid);
  push("arxiv", ids.arxivId);
  return out;
}

/** Is this record a preprint, by any of its own fields? */
export function looksLikePreprint(r: SourceRecord): boolean {
  if (r.work.type === "preprint") return true;
  if (PREPRINT_SOURCES.has(r.sourceId)) return true;
  if (r.sourceId === "europepmc" && r.nativeId.startsWith("PPR/")) return true;
  const doi = doiOf(r);
  return (
    doi !== undefined &&
    PREPRINT_DOI_PREFIXES_PLAIN.some((p) => doi.startsWith(p))
  );
}

/** Do the two records carry one identifier in common? */
function shareStrongId(a: SourceRecord, b: SourceRecord): boolean {
  const mine = new Set(strongIds(a.work.ids));
  return strongIds(b.work.ids).some((k) => mine.has(k));
}

/** Does either record name one of the other's identifiers as its other version? */
function namesOtherVersion(a: SourceRecord, b: SourceRecord): boolean {
  const names = (x: SourceRecord, y: SourceRecord): boolean => {
    const own = new Set(strongIds(y.work.ids));
    if (strongIds(x.work.relatedVersionIds).some((k) => own.has(k))) {
      return true;
    }
    const epmc = x.work.relatedVersionIds?.epmcId?.trim();
    return (
      epmc !== undefined &&
      epmc !== "" &&
      y.sourceId === "europepmc" &&
      y.nativeId === `PPR/${epmc}`
    );
  };
  return names(a, b) || names(b, a);
}

/** The series marker split, on the plain title. */
function seriesSplit(title: string): { stem: string; marker?: string } {
  const plain = plainTitle(title);
  const m = SERIES_MARKER.exec(plain);
  if (m === null || m[2] === undefined) return { stem: plain };
  return { stem: plain.slice(0, m.index).trim(), marker: m[2] };
}

/**
 * The step-3 families one pair belongs to. `same-work-3-sources` is a
 * property of a set, not of a pair, and is counted by {@link countFamilies};
 * a pair is tagged with it when it lies inside such a set.
 */
export function pairFamilies(
  a: SourceRecord,
  b: SourceRecord,
): readonly FamilyId[] {
  const out: FamilyId[] = [];
  const ta = plainTitle(a.work.title);
  const tb = plainTitle(b.work.title);
  const sameTitle = ta !== "" && ta === tb;
  if (
    looksLikePreprint(a) !== looksLikePreprint(b) &&
    (namesOtherVersion(a, b) || sameTitle)
  ) {
    out.push("preprint-published");
  }
  if (
    plainTokens(a.work.title).length < SHORT_TITLE_TOKENS ||
    plainTokens(b.work.title).length < SHORT_TITLE_TOKENS
  ) {
    out.push("short-title");
  }
  const sa = seriesSplit(a.work.title);
  const sb = seriesSplit(b.work.title);
  if (sa.stem !== "" && sa.stem === sb.stem && sa.marker !== sb.marker) {
    out.push("series-title");
  }
  const ya = yearOf(a);
  const yb = yearOf(b);
  const va = venueOf(a);
  const vb = venueOf(b);
  if (
    sameTitle &&
    ya !== undefined &&
    yb !== undefined &&
    ya !== yb &&
    va !== undefined &&
    vb !== undefined &&
    va !== vb
  ) {
    out.push("same-title-diff-year-diff-venue");
  }
  if (
    doiOf(a)?.startsWith("10.64898/") === true ||
    doiOf(b)?.startsWith("10.64898/") === true
  ) {
    out.push("prefix-10.64898");
  }
  if (HANGUL.test(a.work.title) || HANGUL.test(b.work.title)) {
    out.push("korean-title");
  }
  return out;
}

/** Is this pair evidence that its two records are one work, for set-building? */
function sameWorkEvidence(a: SourceRecord, b: SourceRecord): boolean {
  if (shareStrongId(a, b)) return true;
  const ta = plainTitle(a.work.title);
  const ya = yearOf(a);
  return (
    ta !== "" &&
    ta === plainTitle(b.work.title) &&
    ya !== undefined &&
    ya === yearOf(b)
  );
}

/** A set of records, joined by same-work evidence, spanning ≥ 3 sources. */
export interface SameWorkSet {
  readonly recordIds: readonly string[];
  readonly sources: readonly string[];
}

/**
 * `P2-T13` step 3's "same-paper-from-≥3-sources sets": connected components
 * over the candidate pairs that carry same-work evidence — a shared DOI,
 * PMID, PMCID or arXiv id, or an identical plain title in the same year —
 * whose records come from three or more sources.
 */
export function sameWorkSets(
  pairs: readonly CandidatePair[],
): readonly SameWorkSet[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) {
      r = parent.get(r) ?? r;
    }
    return r;
  };
  const sourceOf = new Map<string, string>();
  for (const p of pairs) {
    if (!sameWorkEvidence(p.a, p.b)) continue;
    for (const r of [p.a, p.b]) {
      if (!parent.has(r.id)) parent.set(r.id, r.id);
      sourceOf.set(r.id, r.sourceId);
    }
    const ra = find(p.a.id);
    const rb = find(p.b.id);
    if (ra !== rb) {
      const [lo, hi] = compareStrings(ra, rb) < 0 ? [ra, rb] : [rb, ra];
      parent.set(hi, lo);
    }
  }
  const members = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const list = members.get(root);
    if (list === undefined) members.set(root, [id]);
    else list.push(id);
  }
  const out: SameWorkSet[] = [];
  for (const ids of members.values()) {
    const sources = [...new Set(ids.map((id) => sourceOf.get(id) ?? ""))].sort(
      compareStrings,
    );
    if (sources.length >= 3) {
      out.push({ recordIds: [...ids].sort(compareStrings), sources });
    }
  }
  return out.sort((x, y) =>
    compareStrings(x.recordIds[0] ?? "", y.recordIds[0] ?? ""),
  );
}

/** Per-family counts over a candidate set. */
export interface FamilyCounts {
  /** Sets for `same-work-3-sources`, pairs for every other family. */
  readonly counts: Readonly<Record<FamilyId, number>>;
  /** `prefix-10.64898` pairs with a bioRxiv record, and with a medRxiv record. */
  readonly prefix64898BySource: {
    readonly biorxiv: number;
    readonly medrxiv: number;
  };
  readonly sets: readonly SameWorkSet[];
}

/** Count every family in `pairs`. */
export function countFamilies(pairs: readonly CandidatePair[]): FamilyCounts {
  const counts = Object.fromEntries(FAMILY_IDS.map((f) => [f, 0])) as Record<
    FamilyId,
    number
  >;
  let biorxiv = 0;
  let medrxiv = 0;
  for (const p of pairs) {
    for (const f of pairFamilies(p.a, p.b)) counts[f] += 1;
    if (pairFamilies(p.a, p.b).includes("prefix-10.64898")) {
      if (p.a.sourceId === "biorxiv" || p.b.sourceId === "biorxiv")
        biorxiv += 1;
      if (p.a.sourceId === "medrxiv" || p.b.sourceId === "medrxiv")
        medrxiv += 1;
    }
  }
  const sets = sameWorkSets(pairs);
  counts["same-work-3-sources"] = sets.length;
  return { counts, prefix64898BySource: { biorxiv, medrxiv }, sets };
}

/** One family the corpus does not yet supply in the number step 3 asks for. */
export interface FamilyShortfall {
  readonly family: FamilyId;
  readonly have: number;
  readonly need: number;
  readonly note?: string;
}

/**
 * The step-3 families below their minimum, in {@link FAMILY_IDS} order.
 * `prefix-10.64898` is also short when its pairs do not mix bioRxiv and
 * medRxiv (step 3: "mixing bioRxiv and medRxiv").
 */
export function familyShortfalls(
  families: FamilyCounts,
): readonly FamilyShortfall[] {
  const out: FamilyShortfall[] = [];
  for (const family of FAMILY_IDS) {
    const need = STEP3_MINIMUMS[family];
    if (need === undefined) continue;
    const have = families.counts[family];
    const mixed =
      family !== "prefix-10.64898" ||
      (families.prefix64898BySource.biorxiv > 0 &&
        families.prefix64898BySource.medrxiv > 0);
    if (have < need || !mixed) {
      out.push({
        family,
        have,
        need,
        ...(!mixed && {
          note:
            `bioRxiv pairs ${String(families.prefix64898BySource.biorxiv)}, ` +
            `medRxiv pairs ${String(families.prefix64898BySource.medrxiv)}: not mixed`,
        }),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4b. The label set — the owner's sampling of two big clusters (2026-10-16)
//
// `plan/00` §6 item 223, decided by the owner on 2026-10-16: two clusters of
// near-identical Crossref records would dominate the measured precision if
// every pair in them were labelled, so **20 pairs of each** go to the
// labeller and every other pair is labelled in full. Both clusters are
// recognised from the records' own fields, never from an engine verdict:
//
// - `scotland-reports`: both records are Crossref records whose plain title
//   starts with the stem "Enhanced Surveillance of COVID-19 in Scotland"
//   (22 separate `report` records from Crossref Q5; 231 pairs when measured).
// - `short-title-crossref`: both records are Crossref records with the same
//   plain title, Part A's own short-title family check
//   ({@link pairFamilies}' `short-title`) holds for the pair, **and** the
//   title carries a book-part heading ({@link PART_HEADING}: "Part III",
//   "Part III Introduction", …). 78 pairs when first measured; the heading
//   condition was added on 2026-10-16 (`plan/00` §6 item 226, owner) and
//   moved the 2 pairs titled "Genome editing using CRISPR" and "Psoroptic
//   mange" out of the cluster and into the label set, leaving 76 pairs of
//   which 20 are kept, as before.
//
// **Which 20.** Within each cluster, the 20 pairs with the smallest
// `sha256("P2-T13 label set 2026-10-16\n" + pairId)`, ties broken by pair id.
// The pair id is itself a hash of the two record ids, so the choice depends
// on neither input order nor anything the engine decides, and a re-record
// that returns the same records picks the same 20. Every pair stays in
// `pairs.jsonl` with `labelSet: false` when sampled out; only label-set pairs
// go to `pairs.csv`, and `scripts/dedup-report.ts` measures only them.
// ---------------------------------------------------------------------------

/** The clusters the owner sampled down, by name. */
export const SAMPLED_CLUSTERS = [
  "scotland-reports",
  "short-title-crossref",
] as const;
export type SampledCluster = (typeof SAMPLED_CLUSTERS)[number];

/** How many pairs of each sampled cluster stay in the label set. */
export const LABEL_SET_PER_CLUSTER = 20;

/** The Scotland reports' shared title stem, in {@link plainTitle}'s form. */
const SCOTLAND_TITLE_STEM = "enhanced surveillance of covid 19 in scotland";

/**
 * A book-part heading anywhere in a plain title: the word "part" followed by a
 * roman numeral or a number, as whole words. Only a title carrying one joins
 * the `short-title-crossref` cluster (owner, 2026-10-16, `plan/00` §6 item
 * 226). Read from the title alone, never from an engine verdict.
 */
export const PART_HEADING = /(?:^| )part (?:[ivxlc]+|\d+)(?: |$)/;

/** The fixed salt of the selection hash; changing it changes the 20. */
const LABEL_SET_SALT = "P2-T13 label set 2026-10-16";

/**
 * The sampled cluster a pair belongs to, read from the two records' fields.
 *
 * @returns the cluster, or `undefined` for a pair labelled in full
 */
export function sampledClusterOf(
  a: SourceRecord,
  b: SourceRecord,
): SampledCluster | undefined {
  if (a.sourceId !== "crossref" || b.sourceId !== "crossref") return undefined;
  const ta = plainTitle(a.work.title);
  const tb = plainTitle(b.work.title);
  const scotland = (t: string): boolean =>
    t === SCOTLAND_TITLE_STEM || t.startsWith(`${SCOTLAND_TITLE_STEM} `);
  if (scotland(ta) && scotland(tb)) return "scotland-reports";
  if (
    ta !== "" &&
    ta === tb &&
    PART_HEADING.test(ta) &&
    pairFamilies(a, b).includes("short-title")
  ) {
    return "short-title-crossref";
  }
  return undefined;
}

/** The selection key of one pair: smaller keys are kept first. */
export function labelSetRank(pairId: string): string {
  return sha256Hex(`${LABEL_SET_SALT}\n${pairId}`);
}

/** Where one pair stands in the label set. */
export interface LabelSetEntry {
  readonly labelSet: boolean;
  readonly cluster: SampledCluster | undefined;
}

/**
 * The owner's label set over `pairs`, by pair id: every pair outside the two
 * clusters, and the {@link LABEL_SET_PER_CLUSTER} smallest-ranked pairs
 * ({@link labelSetRank}) of each cluster.
 */
export function labelSetOf(
  pairs: readonly CandidatePair[],
): ReadonlyMap<string, LabelSetEntry> {
  const out = new Map<string, LabelSetEntry>();
  const byCluster = new Map<SampledCluster, string[]>();
  for (const p of pairs) {
    const cluster = sampledClusterOf(p.a, p.b);
    out.set(p.pairId, { labelSet: cluster === undefined, cluster });
    if (cluster !== undefined) {
      const list = byCluster.get(cluster);
      if (list === undefined) byCluster.set(cluster, [p.pairId]);
      else list.push(p.pairId);
    }
  }
  for (const [cluster, ids] of byCluster) {
    const kept = ids
      .map((id) => ({ id, rank: labelSetRank(id) }))
      .sort(
        (x, y) => compareStrings(x.rank, y.rank) || compareStrings(x.id, y.id),
      )
      .slice(0, LABEL_SET_PER_CLUSTER);
    for (const { id } of kept) out.set(id, { labelSet: true, cluster });
  }
  return out;
}

/** Per cluster: how many pairs it has and how many the label set keeps. */
export type SampledOut = Readonly<
  Record<SampledCluster, { readonly pairs: number; readonly kept: number }>
>;

/** Count {@link labelSetOf}'s result per cluster. */
export function sampledOutOf(
  entries: ReadonlyMap<string, LabelSetEntry>,
): SampledOut {
  const out = Object.fromEntries(
    SAMPLED_CLUSTERS.map((c) => [c, { pairs: 0, kept: 0 }]),
  ) as Record<SampledCluster, { pairs: number; kept: number }>;
  for (const e of entries.values()) {
    if (e.cluster === undefined) continue;
    out[e.cluster].pairs += 1;
    if (e.labelSet) out[e.cluster].kept += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. The file formats
// ---------------------------------------------------------------------------

/** One record as the labeller sees it. */
export interface RecordView {
  readonly recordId: string;
  readonly source: string;
  readonly title: string;
  /** `Family, Given` joined by `"; "`. */
  readonly authors: string;
  readonly authorCount: number;
  readonly year: number | null;
  readonly venue: string | null;
  readonly type: string;
  readonly doi: string | null;
  /** PMID, PMCID, arXiv id, S2 corpus id, Europe PMC id — whichever exist. */
  readonly otherIds: Readonly<Record<string, string>>;
  /** `relatedVersionIds`, whichever exist: what this record names as its other version. */
  readonly relatedVersionIds: Readonly<Record<string, string>>;
  /** `<source>/<scenario>` of every fixture the record was read from. */
  readonly fixtures: readonly string[];
}

/** One line of `pairs.jsonl`. `label` and `reason` are empty until a human fills them. */
export interface PairRow {
  readonly pairId: string;
  readonly label: PairLabel | "";
  readonly reason: string;
  /**
   * `false` when the owner's sampling of 2026-10-16 left this pair out of
   * the label set (section 4b): it stays in `pairs.jsonl`, is not in
   * `pairs.csv`, and `scripts/dedup-report.ts` does not measure it.
   */
  readonly labelSet: boolean;
  /** The sampled cluster the pair belongs to (section 4b), or `null`. */
  readonly sampleCluster: SampledCluster | null;
  /** `false` when blocking never compares this pair (a recall-only pair). */
  readonly engineCompares: boolean;
  readonly origins: readonly PairOrigin[];
  readonly families: readonly FamilyId[];
  readonly a: RecordView;
  readonly b: RecordView;
}

/** How many authors a view spells out before `et al.`. */
const AUTHORS_SHOWN = 8;

function idBag(
  ids: SourceRecord["work"]["ids"] | undefined,
  withDoi: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (ids === undefined) return out;
  const put = (name: string, v: string | undefined): void => {
    if (v !== undefined && v.trim() !== "") out[name] = v;
  };
  if (withDoi) put("doi", ids.doi);
  put("pmid", ids.pmid);
  put("pmcid", ids.pmcid);
  put("arxivId", ids.arxivId);
  put("s2CorpusId", ids.s2CorpusId);
  put("epmcId", ids.epmcId);
  return out;
}

/** A record reduced to what a labeller reads. */
export function viewOf(
  r: SourceRecord,
  fixtures: readonly string[],
): RecordView {
  const names = r.work.authors.map((a) =>
    a.given === undefined || a.given === ""
      ? a.family
      : `${a.family}, ${a.given}`,
  );
  const shown = names.slice(0, AUTHORS_SHOWN).join("; ");
  const otherIds = idBag(r.work.ids, false);
  if (r.sourceId === "europepmc" && r.nativeId.startsWith("PPR/")) {
    otherIds["epmcId"] = r.nativeId.slice("PPR/".length);
  }
  return {
    recordId: r.id,
    source: r.sourceId,
    title: r.work.title,
    authors: names.length > AUTHORS_SHOWN ? `${shown}; et al.` : shown,
    authorCount: names.length,
    year: yearOf(r) ?? null,
    venue: r.work.containerTitle ?? null,
    type: r.work.type,
    doi: r.work.ids.doi ?? null,
    otherIds,
    relatedVersionIds: idBag(r.work.relatedVersionIds, true),
    fixtures,
  };
}

/** Labels a human already gave, by pair id. */
export type LabelBook = ReadonlyMap<
  string,
  { readonly label: PairLabel; readonly reason: string }
>;

/**
 * The rows of `pairs.jsonl`, in a labelling order: identifier pairs first,
 * then version links, then the blocking pass, then the pairs blocking skips;
 * within each, by the first record's title, so near-identical titles sit
 * together.
 */
export function buildRows(
  pairs: readonly CandidatePair[],
  seenIn: ReadonlyMap<string, readonly string[]>,
  labels: LabelBook = new Map(),
): readonly PairRow[] {
  const sets = sameWorkSets(pairs);
  const inSet = new Set<string>();
  for (const s of sets) for (const id of s.recordIds) inSet.add(id);
  const sampling = labelSetOf(pairs);
  const rows = pairs.map((p): PairRow => {
    const entry = sampling.get(p.pairId);
    const families = [...pairFamilies(p.a, p.b)];
    if (inSet.has(p.a.id) && inSet.has(p.b.id) && sameWorkEvidence(p.a, p.b)) {
      families.unshift("same-work-3-sources");
    }
    const given = labels.get(p.pairId);
    return {
      pairId: p.pairId,
      label: given?.label ?? "",
      reason: given?.reason ?? "",
      labelSet: entry?.labelSet ?? true,
      sampleCluster: entry?.cluster ?? null,
      engineCompares: p.origins.some((o) => ENGINE_ORIGINS.has(o)),
      origins: p.origins,
      families,
      a: viewOf(p.a, seenIn.get(p.a.id) ?? []),
      b: viewOf(p.b, seenIn.get(p.b.id) ?? []),
    };
  });
  const rank = (r: PairRow): number => {
    if (r.origins.some((o) => o.startsWith("id:") || o === "accession"))
      return 0;
    if (r.origins.includes("version-link")) return 1;
    if (r.origins.includes("block")) return 2;
    return 3;
  };
  return [...rows].sort(
    (x, y) =>
      rank(x) - rank(y) ||
      compareStrings(plainTitle(x.a.title), plainTitle(y.a.title)) ||
      compareStrings(x.pairId, y.pairId),
  );
}

/** `pairs.jsonl`'s text: one row per line, LF, trailing newline. */
export function toJsonl(rows: readonly PairRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Parse `pairs.jsonl`.
 *
 * @throws Error naming the line when a row is not JSON or has a label outside
 *   {@link PAIR_LABELS}
 */
export function parseJsonl(text: string): readonly PairRow[] {
  const rows: PairRow[] = [];
  for (const [n, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let row: PairRow;
    try {
      row = JSON.parse(line) as PairRow;
    } catch (cause) {
      throw new Error(`${PAIRS_FILE} line ${String(n + 1)} is not JSON`, {
        cause,
      });
    }
    if (typeof row.pairId !== "string" || typeof row.label !== "string") {
      throw new Error(
        `${PAIRS_FILE} line ${String(n + 1)} has no string pairId/label`,
      );
    }
    if (row.label !== "" && !isPairLabel(row.label)) {
      throw new Error(
        `${PAIRS_FILE} line ${String(n + 1)} (${row.pairId}): label ` +
          `"${String(row.label)}" is not one of ${PAIR_LABELS.join(", ")}`,
      );
    }
    rows.push(row);
  }
  return rows;
}

/** The labels already present in a parsed `pairs.jsonl`. */
export function labelsOf(rows: readonly PairRow[]): LabelBook {
  const out = new Map<string, { label: PairLabel; reason: string }>();
  for (const r of rows) {
    if (r.label !== "") out.set(r.pairId, { label: r.label, reason: r.reason });
  }
  return out;
}

/** The labelling sheet's columns, in order. */
export const SHEET_COLUMNS = [
  "pair_id",
  "label",
  "reason",
  "families",
  "engine_compares",
  "origins",
  "a_source",
  "a_title",
  "a_authors",
  "a_year",
  "a_venue",
  "a_type",
  "a_doi",
  "a_other_ids",
  "b_source",
  "b_title",
  "b_authors",
  "b_year",
  "b_venue",
  "b_type",
  "b_doi",
  "b_other_ids",
  "a_related_version_ids",
  "b_related_version_ids",
  "a_record_id",
  "b_record_id",
] as const;

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function bagText(bag: Readonly<Record<string, string>>): string {
  return Object.entries(bag)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/**
 * The labelling sheet: RFC 4180 CSV with a UTF-8 byte-order mark, so a
 * spreadsheet shows Korean and accented names. Lines end in LF, not RFC
 * 4180's CRLF: `.gitattributes` stores `test/fixtures/**` with `eol=lf`, and
 * a CRLF file would come back from a checkout different from what this
 * writes.
 */
export function toCsv(rows: readonly PairRow[]): string {
  const lines = [SHEET_COLUMNS.join(",")];
  for (const r of rows) {
    const cells: string[] = [
      r.pairId,
      r.label,
      r.reason,
      r.families.join(" "),
      r.engineCompares ? "yes" : "no",
      r.origins.join(" "),
      r.a.source,
      r.a.title,
      r.a.authors,
      r.a.year === null ? "" : String(r.a.year),
      r.a.venue ?? "",
      r.a.type,
      r.a.doi ?? "",
      bagText(r.a.otherIds),
      r.b.source,
      r.b.title,
      r.b.authors,
      r.b.year === null ? "" : String(r.b.year),
      r.b.venue ?? "",
      r.b.type,
      r.b.doi ?? "",
      bagText(r.b.otherIds),
      bagText(r.a.relatedVersionIds),
      bagText(r.b.relatedVersionIds),
      r.a.recordId,
      r.b.recordId,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return `${UTF8_BOM}${lines.join("\n")}\n`;
}

/** The byte-order mark the sheet starts with, spelled by code point. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Parse RFC 4180 CSV, CRLF or LF (a leading byte-order mark is dropped). */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const src = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/**
 * The labels a human typed into a labelling sheet, by pair id. Blank labels
 * are skipped; anything else must be one of {@link PAIR_LABELS}.
 *
 * @throws Error on a missing column, an unknown label or an unknown pair id
 */
export function labelsFromSheet(
  text: string,
  knownPairIds: ReadonlySet<string>,
): LabelBook {
  const [header, ...body] = parseCsv(text);
  const col = (name: string): number => {
    const at = header?.indexOf(name) ?? -1;
    if (at === -1) throw new Error(`labelling sheet has no "${name}" column`);
    return at;
  };
  const idCol = col("pair_id");
  const labelCol = col("label");
  const reasonCol = col("reason");
  const out = new Map<string, { label: PairLabel; reason: string }>();
  for (const cells of body) {
    const pairId = (cells[idCol] ?? "").trim();
    const label = (cells[labelCol] ?? "").trim();
    const reason = (cells[reasonCol] ?? "").trim();
    if (label === "") continue;
    if (!knownPairIds.has(pairId)) {
      throw new Error(`labelling sheet names unknown pair "${pairId}"`);
    }
    if (!isPairLabel(label)) {
      throw new Error(
        `labelling sheet, pair ${pairId}: label "${label}" is not one of ` +
          PAIR_LABELS.join(", "),
      );
    }
    out.set(pairId, { label, reason });
  }
  return out;
}

/** The `_meta.json` sidecar: `FixtureMeta`'s members, plus what it was derived from. */
export interface CorpusMeta extends FixtureMeta {
  readonly derived: true;
  readonly generatedBy: string;
  readonly recordCount: number;
  readonly pairCount: number;
  readonly engineComparedPairCount: number;
  readonly labelledPairCount: number;
  /** Pairs in the owner's label set (section 4b); the rest are sampled out. */
  readonly labelSetPairCount: number;
  /** Per sampled cluster: its pairs, and how many the label set keeps. */
  readonly sampledOut: SampledOut;
  readonly familyCounts: Readonly<Record<FamilyId, number>>;
  readonly derivedFrom: readonly DerivedFrom[];
}

/** Build the sidecar. Deterministic: no timestamp of its own. */
export function buildMeta(
  corpus: LoadedCorpus,
  rows: readonly PairRow[],
  families: FamilyCounts,
): CorpusMeta {
  const oldest = corpus.derivedFrom
    .map((d) => d.recordedAt)
    .sort(compareStrings)[0];
  if (oldest === undefined) throw new Error("no committed fixture was read");
  return {
    scenario: CORPUS_SCENARIO,
    scenarioVersion: CORPUS_SCENARIO_VERSION,
    recordedAt: oldest,
    endpoint: "derived from test/fixtures/<source>/ — no request was made",
    method: "NONE",
    toolVersion: "scripts/build-dedup-corpus.ts",
    synthetic: false,
    redactions: [
      "none applied here: every value is copied from a committed fixture " +
        "that passed the recorder's docs/13 §3.2 redaction pass",
      "the written files were re-checked with scripts/record-fixtures.ts " +
        "assertClean before writing",
      "recordedAt is the oldest input fixture's, so docs/13 §3.3 ages the " +
        "corpus from its oldest data",
    ],
    derived: true,
    generatedBy: "npx tsx scripts/build-dedup-corpus.ts",
    recordCount: corpus.records.length,
    pairCount: rows.length,
    engineComparedPairCount: rows.filter((r) => r.engineCompares).length,
    labelledPairCount: rows.filter((r) => r.label !== "").length,
    labelSetPairCount: rows.filter((r) => r.labelSet).length,
    sampledOut: sampledOutOf(
      new Map(
        rows.map((r) => [
          r.pairId,
          { labelSet: r.labelSet, cluster: r.sampleCluster ?? undefined },
        ]),
      ),
    ),
    familyCounts: families.counts,
    derivedFrom: corpus.derivedFrom,
  };
}

// ---------------------------------------------------------------------------
// 6. Building the three files
// ---------------------------------------------------------------------------

/** The three files' texts, and what went into them. */
export interface BuiltCorpus {
  readonly corpus: LoadedCorpus;
  readonly pairs: readonly CandidatePair[];
  readonly rows: readonly PairRow[];
  readonly families: FamilyCounts;
  /** The same counts over the owner's label set only (section 4b). */
  readonly labelSetFamilies: FamilyCounts;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Build the corpus in memory.
 *
 * @param labels - human labels to carry onto the rows, by pair id
 */
export async function buildCorpus(
  labels: LabelBook = new Map(),
): Promise<BuiltCorpus> {
  const corpus = await loadCorpusRecords();
  const pool = corpus.records.map((c) => c.record);
  const seenIn = new Map(corpus.records.map((c) => [c.record.id, c.seenIn]));
  const pairs = candidatePairs(pool);
  const rows = buildRows(pairs, seenIn, labels);
  const families = countFamilies(pairs);
  const inLabelSet = new Set(
    rows.filter((r) => r.labelSet).map((r) => r.pairId),
  );
  const labelSetFamilies = countFamilies(
    pairs.filter((p) => inLabelSet.has(p.pairId)),
  );
  const meta = buildMeta(corpus, rows, families);
  const files = {
    [PAIRS_FILE]: toJsonl(rows),
    // The sheet holds the label set only (section 4b); pairs.jsonl holds all.
    [SHEET_FILE]: toCsv(rows.filter((r) => r.labelSet)),
    [META_FILE]: `${JSON.stringify(meta, null, 2)}\n`,
  };
  for (const [name, text] of Object.entries(files)) assertWritable(name, text);
  return { corpus, pairs, rows, families, labelSetFamilies, files };
}

/**
 * The `docs/13` §3.2 check, as the recorder runs it on a fixture, with the
 * source plans' own opaque-token exemptions.
 */
function assertWritable(name: string, text: string): void {
  const allow = new Set<string>();
  for (const source of RECORDABLE_SOURCES) {
    for (const token of planFor(source).opaqueTokens?.(text) ?? []) {
      allow.add(token);
    }
  }
  assertClean(`dedup/${name}`, text, literalDenyList(), [...allow]);
}

/** Read `pairs.jsonl` if it exists. */
export async function readCommittedRows(
  dir = DEDUP_CORPUS_DIR,
): Promise<readonly PairRow[] | undefined> {
  let text: string;
  try {
    text = await readFile(resolve(dir, PAIRS_FILE), "utf8");
  } catch {
    return undefined;
  }
  return parseJsonl(text);
}

/** A human-readable summary of a build, for the console. */
export function summarize(built: BuiltCorpus): string {
  const lines: string[] = [];
  lines.push("Records read from committed fixtures:");
  for (const s of built.corpus.perSource) {
    lines.push(
      `  ${s.source.padEnd(16)} fixtures ${String(s.fixturesRead).padStart(3)}` +
        `  with records ${String(s.fixturesWithRecords).padStart(3)}` +
        `  records ${String(s.recordsMapped).padStart(4)}` +
        (s.missing.length > 0 ? `  missing: ${s.missing.join(", ")}` : ""),
    );
  }
  lines.push(
    `Pooled records (one per record id): ${String(built.corpus.records.length)}`,
  );
  lines.push(
    `Candidate pairs: ${String(built.rows.length)} ` +
      `(${String(built.rows.filter((r) => r.engineCompares).length)} compared by the cascade, ` +
      `${String(built.rows.filter((r) => !r.engineCompares).length)} skipped by blocking)`,
  );
  const inLabelSet = built.rows.filter((r) => r.labelSet);
  lines.push(
    `Label set (owner's sampling of 2026-10-16): ${String(inLabelSet.length)} ` +
      `of ${String(built.rows.length)} pairs; sampled out ` +
      `${String(built.rows.length - inLabelSet.length)}`,
  );
  const sampled = sampledOutOf(
    new Map(
      built.rows.map((r) => [
        r.pairId,
        { labelSet: r.labelSet, cluster: r.sampleCluster ?? undefined },
      ]),
    ),
  );
  for (const c of SAMPLED_CLUSTERS) {
    lines.push(
      `  cluster ${c.padEnd(22)} ${String(sampled[c].pairs)} pairs, ` +
        `${String(sampled[c].kept)} kept, ` +
        `${String(sampled[c].pairs - sampled[c].kept)} sampled out`,
    );
  }
  const byOrigin = new Map<string, number>();
  for (const p of built.pairs) {
    for (const o of p.origins) byOrigin.set(o, (byOrigin.get(o) ?? 0) + 1);
  }
  for (const [o, n] of [...byOrigin].sort((x, y) =>
    compareStrings(x[0], y[0]),
  )) {
    lines.push(`  origin ${o.padEnd(24)} ${String(n)}`);
  }
  lines.push(
    "Step-3 families (sets for same-work-3-sources, pairs otherwise; " +
      "all candidate pairs, then the label set only):",
  );
  for (const f of FAMILY_IDS) {
    const need = STEP3_MINIMUMS[f];
    lines.push(
      `  ${f.padEnd(34)} ${String(built.families.counts[f]).padStart(4)}` +
        ` ${String(built.labelSetFamilies.counts[f]).padStart(4)}` +
        (need === undefined ? "   (no minimum)" : `   need ≥ ${String(need)}`),
    );
  }
  lines.push(
    `  prefix-10.64898 by source: bioRxiv ${String(built.families.prefix64898BySource.biorxiv)}, ` +
      `medRxiv ${String(built.families.prefix64898BySource.medrxiv)}`,
  );
  const short = familyShortfalls(built.families);
  lines.push(
    short.length === 0
      ? "Every step-3 family meets its minimum."
      : `Families short of step 3: ${short
          .map(
            (s) =>
              `${s.family} (${String(s.have)}/${String(s.need)}${s.note === undefined ? "" : `; ${s.note}`})`,
          )
          .join(", ")}`,
  );
  const labelled = inLabelSet.filter((r) => r.label !== "").length;
  lines.push(
    `Labelled pairs: ${String(labelled)} of the ${String(inLabelSet.length)} in the label set ` +
      `(the owner labels the 60-pair sample, plan/00 §6 item 284(c))`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 7. The command line
// ---------------------------------------------------------------------------

/**
 * `--check` compares with the committed files and writes nothing;
 * `--merge-labels <csv>` copies a human's labels from a labelling sheet into
 * the corpus; with no flag the files are rebuilt, keeping every label already
 * in `pairs.jsonl`.
 *
 * @returns the process exit code
 */
export async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes("--check");
  const mergeAt = argv.indexOf("--merge-labels");
  const sheetPath = mergeAt === -1 ? undefined : argv[mergeAt + 1];
  if (mergeAt !== -1 && sheetPath === undefined) {
    process.stderr.write("--merge-labels needs a path to a .csv sheet\n");
    return 2;
  }

  const committed = (await readCommittedRows()) ?? [];
  const kept = new Map(labelsOf(committed));
  if (sheetPath !== undefined) {
    const known = new Set(committed.map((r) => r.pairId));
    const fromSheet = labelsFromSheet(await readFile(sheetPath, "utf8"), known);
    for (const [id, l] of fromSheet) kept.set(id, l);
    process.stdout.write(
      `Copied ${String(fromSheet.size)} human label(s) from ${sheetPath}.\n`,
    );
  }

  const built = await buildCorpus(kept);
  process.stdout.write(`${summarize(built)}\n`);

  const present = new Set(built.rows.map((r) => r.pairId));
  const dropped = [...kept.keys()].filter((id) => !present.has(id));
  if (dropped.length > 0) {
    process.stderr.write(
      `Refusing to write: ${String(dropped.length)} labelled pair(s) are no ` +
        `longer candidates (${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? ", …" : ""}). ` +
        `A re-record changed the records; review before dropping a human's label.\n`,
    );
    return 1;
  }

  if (check) {
    const drift: string[] = [];
    for (const [name, text] of Object.entries(built.files)) {
      let onDisk: string | undefined;
      try {
        onDisk = await readFile(resolve(DEDUP_CORPUS_DIR, name), "utf8");
      } catch {
        onDisk = undefined;
      }
      if (onDisk !== text) drift.push(name);
    }
    if (drift.length > 0) {
      process.stderr.write(
        `Out of date: ${drift.join(", ")}. Rebuild with: npx tsx scripts/build-dedup-corpus.ts\n`,
      );
      return 1;
    }
    process.stdout.write("test/fixtures/dedup/ is up to date.\n");
    return 0;
  }

  await mkdir(DEDUP_CORPUS_DIR, { recursive: true });
  for (const [name, text] of Object.entries(built.files)) {
    await writeFile(resolve(DEDUP_CORPUS_DIR, name), text, "utf8");
  }
  process.stdout.write(
    `Wrote ${Object.keys(built.files).join(", ")} to test/fixtures/dedup/.\n`,
  );
  return 0;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));

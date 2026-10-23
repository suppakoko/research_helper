/**
 * Tier 3: Europe PMC `fullTextXML` (JATS) — `docs/06` §3.4 (`P3-T19` step 1).
 *
 * Two halves:
 *
 * - {@link extractJats} applies §3.4's element table to a parsed JATS
 *   document. Pure.
 * - {@link fetchEpmcFullText} is the network side: the open-access gate, then
 *   the fetch, then the parse.
 *
 * ## The open-access gate comes first, always
 *
 * §3.4: "fetch `fullTextXML` only when `isOpenAccess === "Y" && inEPMC ===
 * "Y"`". `docs/02` §4.8 measured why the gate cannot be replaced by trying:
 * a 404 with an empty body means both "not open access here" and "no such
 * id". So {@link fetchEpmcFullText} first asks the `search` endpoint for the
 * item's core record (`resultType=core`, by PMCID or DOI), and the private
 * fetch step runs only for a record that passes the gate. The fetch is not
 * exported, so there is no way to reach it without the gate.
 *
 * ## One Europe PMC pool
 *
 * Every request goes through the injected `http` — in the product the
 * installed `HttpClient` (`src/core/http/client.ts`), whose per-host limiter
 * for {@link EBI_HOST} is the same bucket the Europe PMC search adapter uses
 * (`docs/07` §7.3's one-bucket-per-host rule). Nothing here creates a client,
 * a limiter or a connection of its own.
 *
 * ## The element table, as built
 *
 * | JATS | Handling |
 * | --- | --- |
 * | `front/article-meta/abstract` | {@link JatsExtraction.abstract} (the first one without `@abstract-type`, else the first) |
 * | `body/sec`, `back/sec` | one {@link JatsSection} each, `@sec-type` kept for `P3-T21`'s mapping |
 * | `title` | the section heading; a nested section's title is a line of its parent |
 * | `p` | one paragraph; paragraphs are `\n`-joined |
 * | `xref` | dropped, and the empty brackets it leaves (`[]`, `( , )`) with it |
 * | `table-wrap`, `fig` | the `<caption>` text only |
 * | `disp-formula`, `inline-formula`, MathML `math`, `tex-math` | dropped |
 * | `ref-list`, `back/ack`, `back/fn-group`, `fn` | dropped |
 * | `sec` titled `/supplement\|supporting information\|data availability\|author contribution\|conflict\|funding\|competing interest/i`, or `@sec-type="supplementary-material"` | dropped with everything inside it |
 * | `supplementary-material` | dropped |
 *
 * Section *labels* (`ImradSection`) are not assigned here. The sections
 * live on {@link JatsExtraction}; `P3-T21`'s `detectSectionsFromJats`
 * (`./imrad.ts`, called from `acquire.ts`) maps their `@sec-type` and
 * headings onto §4.3's union and fills `AcquiredSource.sections`, with
 * offsets into the acquired text. *(Corrected 2026-10-23: this said
 * `AcquiredSource.sections` stays empty until `P3-T21`; it no longer does.)*
 *
 * ## `DOMParser` is injected
 *
 * As in `src/sources/pubmed/mapper.ts`: the sandbox has `DOMParser`
 * (`docs/01` §2.3), plain Node does not, so the parse is a port whose
 * production value is {@link domParserJats}. The node interface below is the
 * smallest slice of DOM this module reads; JATS is mixed content, so unlike
 * the PubMed port it walks text nodes too.
 */

import {
  ConfigurationError,
  OperationCancelledError,
  ParseError,
} from "../../core/errors";
import type { HttpClient } from "../../core/http/client";
import { MAINTAINER_EMAIL } from "../../core/http/userAgent";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { Logger } from "../../core/logger";
import { EBI_HOST } from "../../core/rateLimit/hostLimiter";
import {
  normalizeDoi,
  normalizePmcid,
  type Doi,
  type Pmcid,
} from "../../model/ids";
import { parseEuropePmcSearchBody } from "../../sources/europepmc/europepmcSource";
import {
  buildEuropePmcDoiLookupRequest,
  EUROPEPMC_REST_BASE_URL,
  EUROPEPMC_SEARCH_URL,
} from "../../sources/europepmc/query";

// ---------------------------------------------------------------------------
// 1. The XML port
// ---------------------------------------------------------------------------

/** `Node.ELEMENT_NODE`. */
const ELEMENT_NODE = 1;
/** `Node.TEXT_NODE` and `Node.CDATA_SECTION_NODE`. */
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** A `NodeList`, as this module reads one. */
export interface JatsNodeList {
  readonly length: number;
  item(index: number): JatsNode | null;
}

/**
 * The slice of a DOM `Node` this module reads. A Gecko `ChildNode` satisfies
 * it structurally; `localName` and `getAttribute` exist on elements only.
 */
export interface JatsNode {
  readonly nodeType: number;
  readonly localName?: string | null;
  readonly textContent: string | null;
  readonly childNodes: JatsNodeList;
  getAttribute?(name: string): string | null;
}

/** The slice of a DOM `Document` this module reads. */
export interface JatsDocumentLike {
  readonly documentElement: JatsNode | null;
}

/** Parse XML. Never throws for malformed input in Gecko: see {@link extractJats}. */
export type JatsXmlParser = (xml: string) => JatsDocumentLike;

/** The production parser: the sandbox's own `DOMParser`, XML mode. */
export function domParserJats(xml: string): JatsDocumentLike {
  return new DOMParser().parseFromString(xml, "application/xml");
}

// ---------------------------------------------------------------------------
// 2. Extraction
// ---------------------------------------------------------------------------

/** One body or back section, in document order. */
export interface JatsSection {
  /** `@sec-type`, verbatim; `null` when absent. `P3-T21` maps it. */
  readonly secType: string | null;
  /** The section's own `<title>`; `""` for body text outside any `sec`. */
  readonly heading: string;
  /** Paragraphs, captions and nested-section titles, in order. */
  readonly paragraphs: readonly string[];
}

/** What {@link extractJats} produces. */
export interface JatsExtraction {
  /** The article abstract's text, `\n`-joined; `null` when there is none. */
  readonly abstract: string | null;
  readonly sections: readonly JatsSection[];
  /**
   * The body as sent: each section's heading and paragraphs `\n`-joined,
   * sections separated by a blank line. No abstract: the caller prepends it.
   */
  readonly text: string;
  /** Sections dropped by the §3.4 title / `@sec-type` rule. */
  readonly droppedSections: number;
}

/** §3.4's last row. */
export const DROPPED_SECTION_TITLE =
  /supplement|supporting information|data availability|author contribution|conflict|funding|competing interest/i;

/** §4.3: `@sec-type="supplementary-material"` is dropped. */
const DROPPED_SEC_TYPE = /^supplementary-material$/i;

/** Elements dropped wherever they occur, with all their content. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "xref",
  "disp-formula",
  "inline-formula",
  "math",
  "tex-math",
  "ref-list",
  "fn-group",
  "fn",
  "ack",
  "supplementary-material",
  "label",
  "graphic",
  "inline-graphic",
  "media",
  "object-id",
]);

/** Elements whose caption alone is kept. */
const CAPTIONED_ELEMENTS: ReadonlySet<string> = new Set(["fig", "table-wrap"]);

function localNameOf(node: JatsNode): string {
  return node.localName ?? "";
}

function isElement(node: JatsNode): boolean {
  return node.nodeType === ELEMENT_NODE;
}

function childNodes(node: JatsNode): JatsNode[] {
  const out: JatsNode[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (child !== null) out.push(child);
  }
  return out;
}

function childElements(node: JatsNode, name?: string): JatsNode[] {
  return childNodes(node).filter(
    (child) =>
      isElement(child) && (name === undefined || localNameOf(child) === name),
  );
}

function attribute(node: JatsNode, name: string): string | null {
  return node.getAttribute?.(name) ?? null;
}

/**
 * Tidy one paragraph's text: whitespace runs to one space, the brackets a
 * dropped `xref` leaves empty removed, and the space before closing
 * punctuation that removal leaves.
 */
export function tidyInlineText(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .replace(/\s*\[[\s,;–—-]*\]/gu, "")
    .replace(/\s*\([\s,;–—-]*\)/gu, "")
    .replace(/\s+([.,;:!?)\]])/gu, "$1")
    .replace(/([([])\s+/gu, "$1")
    .trim();
}

/** Text of `node`, skipping every dropped and captioned element inside it. */
function inlineText(node: JatsNode): string {
  let out = "";
  for (const child of childNodes(node)) {
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) {
      out += child.textContent ?? "";
    } else if (isElement(child)) {
      const name = localNameOf(child);
      if (DROPPED_ELEMENTS.has(name) || CAPTIONED_ELEMENTS.has(name)) continue;
      // A block element inside a paragraph (rare) still separates words.
      out +=
        name === "p" || name === "list-item"
          ? ` ${inlineText(child)} `
          : inlineText(child);
    }
  }
  return out;
}

/** The caption of a `fig` / `table-wrap`, as one paragraph. */
function captionText(node: JatsNode): string {
  const parts: string[] = [];
  for (const caption of childElements(node, "caption")) {
    for (const part of childElements(caption)) {
      const text = tidyInlineText(inlineText(part));
      if (text !== "") parts.push(text);
    }
  }
  return parts.join(" ");
}

/** Captions of figures and tables nested anywhere inside `node`. */
function nestedCaptions(node: JatsNode, into: string[]): void {
  for (const child of childElements(node)) {
    const name = localNameOf(child);
    if (CAPTIONED_ELEMENTS.has(name)) {
      const caption = captionText(child);
      if (caption !== "") into.push(caption);
    } else if (!DROPPED_ELEMENTS.has(name)) {
      nestedCaptions(child, into);
    }
  }
}

function sectionTitle(sec: JatsNode): string {
  const title = childElements(sec, "title")[0];
  return title === undefined ? "" : tidyInlineText(inlineText(title));
}

/** §3.4's drop rule for a `sec`. */
export function isDroppedSection(sec: JatsNode): boolean {
  const secType = attribute(sec, "sec-type");
  if (secType !== null && DROPPED_SEC_TYPE.test(secType)) return true;
  return DROPPED_SECTION_TITLE.test(sectionTitle(sec));
}

interface BlockWalk {
  readonly paragraphs: string[];
  dropped: number;
}

/** Paragraph-level content of `node`'s children, its own `title` excluded. */
function collectBlocks(node: JatsNode, walk: BlockWalk): void {
  for (const child of childElements(node)) collectBlock(child, walk);
}

/** One element's paragraph-level content. */
function collectBlock(child: JatsNode, walk: BlockWalk): void {
  const name = localNameOf(child);
  if (name === "title" || DROPPED_ELEMENTS.has(name)) return;
  if (CAPTIONED_ELEMENTS.has(name)) {
    const caption = captionText(child);
    if (caption !== "") walk.paragraphs.push(caption);
    return;
  }
  if (name === "sec") {
    if (isDroppedSection(child)) {
      walk.dropped += 1;
      return;
    }
    const heading = sectionTitle(child);
    if (heading !== "") walk.paragraphs.push(heading);
    collectBlocks(child, walk);
    return;
  }
  if (name === "p") {
    const text = tidyInlineText(inlineText(child));
    if (text !== "") walk.paragraphs.push(text);
    nestedCaptions(child, walk.paragraphs);
    return;
  }
  // Containers (list, list-item, boxed-text, disp-quote, caption-less groups,
  // …): recurse; an element with no block inside it is a paragraph.
  const before = walk.paragraphs.length;
  collectBlocks(child, walk);
  if (walk.paragraphs.length === before) {
    const text = tidyInlineText(inlineText(child));
    if (text !== "") walk.paragraphs.push(text);
  }
}

function pickAbstract(articleMeta: JatsNode | undefined): JatsNode | undefined {
  if (articleMeta === undefined) return undefined;
  const abstracts = childElements(articleMeta, "abstract");
  return (
    abstracts.find((node) => attribute(node, "abstract-type") === null) ??
    abstracts[0]
  );
}

/** Thrown for a document that is not a parsed JATS `<article>`. */
export class JatsParseError extends ParseError {}

/**
 * Apply §3.4's element table.
 *
 * @param doc - a parsed `fullTextXML` body
 * @returns the abstract, the sections and the body text
 * @throws JatsParseError when the root is not `<article>` — including Gecko's
 *   `<parsererror>` root for malformed XML
 */
export function extractJats(doc: JatsDocumentLike): JatsExtraction {
  const root = doc.documentElement;
  if (root === null || localNameOf(root) !== "article") {
    throw new JatsParseError(
      "europepmc",
      `[research-helper] Europe PMC fullTextXML did not parse to a JATS ` +
        `<article> (root: ${root === null ? "none" : localNameOf(root)}).`,
      { root: root === null ? null : localNameOf(root) },
    );
  }

  const front = childElements(root, "front")[0];
  const articleMeta =
    front === undefined ? undefined : childElements(front, "article-meta")[0];
  const abstractNode = pickAbstract(articleMeta);
  let abstract: string | null = null;
  if (abstractNode !== undefined) {
    const walk: BlockWalk = { paragraphs: [], dropped: 0 };
    collectBlocks(abstractNode, walk);
    abstract = walk.paragraphs.length === 0 ? null : walk.paragraphs.join("\n");
  }

  const sections: JatsSection[] = [];
  let droppedSections = 0;
  let loose: string[] = [];
  const flushLoose = (): void => {
    if (loose.length > 0) {
      sections.push({ secType: null, heading: "", paragraphs: loose });
      loose = [];
    }
  };

  const containers = [
    childElements(root, "body")[0],
    childElements(root, "back")[0],
    childElements(root, "floats-group")[0],
  ];
  containers.forEach((container, index) => {
    if (container === undefined) return;
    const isBack = index === 1;
    for (const child of childElements(container)) {
      const name = localNameOf(child);
      if (name === "sec") {
        if (isDroppedSection(child)) {
          droppedSections += 1;
          continue;
        }
        flushLoose();
        const walk: BlockWalk = { paragraphs: [], dropped: 0 };
        collectBlocks(child, walk);
        droppedSections += walk.dropped;
        sections.push({
          secType: attribute(child, "sec-type"),
          heading: sectionTitle(child),
          paragraphs: walk.paragraphs,
        });
        continue;
      }
      // `back` holds ref-list, ack, fn-group, notes, glossary, app-group:
      // only its `sec` children are kept (§3.4).
      if (isBack) continue;
      const walk: BlockWalk = { paragraphs: loose, dropped: 0 };
      collectBlock(child, walk);
      droppedSections += walk.dropped;
    }
    flushLoose();
  });

  const text = sections
    .map((section) =>
      [section.heading, ...section.paragraphs]
        .filter((line) => line !== "")
        .join("\n"),
    )
    .filter((block) => block !== "")
    .join("\n\n");

  return { abstract, sections, text, droppedSections };
}

// ---------------------------------------------------------------------------
// 3. The network side
// ---------------------------------------------------------------------------

/** The identifiers Tier 3 can start from. Either may be missing. */
export interface EpmcIdentifiers {
  readonly pmcid?: string | null;
  readonly doi?: string | null;
}

/** What {@link fetchEpmcFullText} needs. */
export interface EpmcFullTextDeps {
  /**
   * The installed `HttpClient` — the one whose {@link EBI_HOST} limiter the
   * Europe PMC adapter shares. Never a client made for this call.
   */
  readonly http: Pick<HttpClient, "request">;
  /** Defaults to {@link domParserJats}. */
  readonly parseXml?: JatsXmlParser;
  readonly token?: CancellationToken;
  /** Diagnostics: outcome and sizes only, never a body. */
  readonly logger?: Logger;
}

/** Why Tier 3 did not apply, when nothing went wrong. */
export type EpmcUnavailableReason =
  "no_identifier" | "not_found" | "not_open_access";

/** Why Tier 3 failed. */
export type EpmcFailureReason =
  "lookup_failed" | "fetch_failed" | "parse_failed";

/** {@link fetchEpmcFullText}'s outcome. Never thrown, except cancellation. */
export type EpmcFullTextOutcome =
  | {
      readonly kind: "ok";
      readonly pmcid: Pmcid;
      readonly extraction: JatsExtraction;
    }
  | { readonly kind: "unavailable"; readonly reason: EpmcUnavailableReason }
  | {
      readonly kind: "failed";
      readonly reason: EpmcFailureReason;
      readonly error: unknown;
    };

/** The gate's fields on a `resultType=core` record (`docs/06` §3.4, verified). */
interface CoreRecordGate {
  readonly pmcid: Pmcid | null;
  readonly doi: Doi | null;
  readonly isOpenAccess: boolean;
  readonly inEPMC: boolean;
}

function readGate(record: unknown): CoreRecordGate | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const r = record as Record<string, unknown>;
  return {
    pmcid: normalizePmcid(typeof r.pmcid === "string" ? r.pmcid : null),
    doi: normalizeDoi(typeof r.doi === "string" ? r.doi : null),
    isOpenAccess: r.isOpenAccess === "Y",
    inEPMC: r.inEPMC === "Y",
  };
}

/**
 * The `search` request for one PMCID: `query=PMCID:PMC…`, `resultType=core`,
 * in the parameter order `./query.ts` uses, with `email=` last.
 */
export function buildEpmcPmcidLookupUrl(pmcid: Pmcid): string {
  return (
    `${EUROPEPMC_SEARCH_URL}?query=${encodeURIComponent(`PMCID:${pmcid}`)}` +
    `&resultType=core&format=json&pageSize=1` +
    `&email=${encodeURIComponent(MAINTAINER_EMAIL)}`
  );
}

/** `GET /{PMCID}/fullTextXML` (`docs/02` §4.8). */
export function buildEpmcFullTextUrl(pmcid: Pmcid): string {
  return `${EUROPEPMC_REST_BASE_URL}/${pmcid}/fullTextXML`;
}

function rethrowIfFatal(error: unknown): void {
  if (
    error instanceof OperationCancelledError ||
    error instanceof ConfigurationError
  ) {
    throw error;
  }
}

/** The core record for `ids`, by PMCID if there is one, else by DOI. */
async function lookUpCoreRecord(
  pmcid: Pmcid | null,
  doi: Doi | null,
  deps: EpmcFullTextDeps,
): Promise<CoreRecordGate | undefined> {
  let method: "GET" | "POST" = "GET";
  let url: string;
  let body: string | undefined;
  let transmittedUrl: string;
  if (pmcid !== null) {
    url = buildEpmcPmcidLookupUrl(pmcid);
    transmittedUrl = url;
  } else if (doi !== null) {
    const request = buildEuropePmcDoiLookupRequest([doi]);
    method = request.method === "POST" ? "POST" : "GET";
    url = request.url;
    body = request.body;
    transmittedUrl = request.transmittedUrl;
  } else {
    return undefined;
  }
  const response = await deps.http.request(method, url, {
    responseType: "text",
    ...(deps.token !== undefined && { token: deps.token }),
    ...(body !== undefined && {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  });
  const parsed = parseEuropePmcSearchBody(response.body, transmittedUrl);
  const gates = parsed.results
    .map(readGate)
    .filter((gate): gate is CoreRecordGate => gate !== undefined);
  return pmcid !== null
    ? gates.find((gate) => gate.pmcid === pmcid)
    : gates.find((gate) => gate.doi === doi);
}

/** The fetch step. Private: reachable only through the gate below. */
async function fetchGatedFullTextXml(
  pmcid: Pmcid,
  deps: EpmcFullTextDeps,
): Promise<string> {
  const response = await deps.http.request("GET", buildEpmcFullTextUrl(pmcid), {
    responseType: "text",
    ...(deps.token !== undefined && { token: deps.token }),
  });
  return response.body;
}

/**
 * Tier 3 for one item: gate, fetch, parse.
 *
 * Makes no request at all without a PMCID or DOI, and no `fullTextXML`
 * request unless the core record says `isOpenAccess: "Y"` and `inEPMC: "Y"`.
 *
 * @param ids - the item's PMCID and/or DOI, in any spelling `normalizePmcid`
 *   and `normalizeDoi` accept
 * @param deps - the shared HTTP client and the XML parser
 * @returns the extraction, or why there is none
 * @throws OperationCancelledError when `deps.token` is cancelled
 * @throws ConfigurationError when no HTTP client is installed (a
 *   composition-root bug, never a user condition)
 */
export async function fetchEpmcFullText(
  ids: EpmcIdentifiers,
  deps: EpmcFullTextDeps,
): Promise<EpmcFullTextOutcome> {
  const pmcid = normalizePmcid(ids.pmcid ?? null);
  const doi = normalizeDoi(ids.doi ?? null);
  if (pmcid === null && doi === null) {
    return { kind: "unavailable", reason: "no_identifier" };
  }

  let gate: CoreRecordGate | undefined;
  try {
    gate = await lookUpCoreRecord(pmcid, doi, deps);
  } catch (error) {
    rethrowIfFatal(error);
    deps.logger?.debug("europepmc fullText lookup failed", { host: EBI_HOST });
    return { kind: "failed", reason: "lookup_failed", error };
  }
  if (gate === undefined) return { kind: "unavailable", reason: "not_found" };
  if (!gate.isOpenAccess || !gate.inEPMC || gate.pmcid === null) {
    return { kind: "unavailable", reason: "not_open_access" };
  }

  let xml: string;
  try {
    xml = await fetchGatedFullTextXml(gate.pmcid, deps);
  } catch (error) {
    rethrowIfFatal(error);
    deps.logger?.debug("europepmc fullTextXML failed", { host: EBI_HOST });
    return { kind: "failed", reason: "fetch_failed", error };
  }
  if (xml.trim() === "") {
    return {
      kind: "failed",
      reason: "fetch_failed",
      error: new Error("empty fullTextXML body"),
    };
  }

  try {
    const extraction = extractJats((deps.parseXml ?? domParserJats)(xml));
    if (extraction.text === "") {
      return {
        kind: "failed",
        reason: "parse_failed",
        error: new Error("fullTextXML has no body text"),
      };
    }
    deps.logger?.debug("europepmc fullTextXML extracted", {
      host: EBI_HOST,
      xmlChars: xml.length,
      textChars: extraction.text.length,
      sections: extraction.sections.length,
      droppedSections: extraction.droppedSections,
    });
    return { kind: "ok", pmcid: gate.pmcid, extraction };
  } catch (error) {
    rethrowIfFatal(error);
    return { kind: "failed", reason: "parse_failed", error };
  }
}

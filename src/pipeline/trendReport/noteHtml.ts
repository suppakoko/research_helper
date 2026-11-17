/**
 * The finished trend report as Zotero note HTML (`P4-T13`; `docs/06` §14.1,
 * §10.2; the measured note schema is `docs/01` §5.7, the citation nodes
 * `docs/01` §5.11).
 *
 * **Callers.** Nothing calls this module yet. The run
 * (`trendReportPipeline.ts`, `P4-T18`) calls {@link renderReportNote} with the
 * stored report, `zoteroBibliographyPort` and the bibliography's style and CSL
 * locale, and hands the HTML string to `writeReportNote` in
 * `src/zotero/notes.ts` (`P4-T14`). Pure functions and one port, so nothing
 * constructs this module.
 *
 * ## What is decided here
 *
 * - **An in-house renderer for `docs/06` §14.1's closed construct set, no
 *   Markdown library** (owner, 2026-10-26, `plan/00` §6 item 286; D-06-9's
 *   note): headings, paragraphs, bold, italic, strike, lists, tables,
 *   blockquotes, inline code and fenced blocks. Anything else in the model's
 *   Markdown is shown as text.
 * - **Everything from the model is escaped unless this module produced the
 *   tag.** Raw HTML shows as text; a link is made only for an `http(s)`
 *   address; {@link assertNoteHtmlAllowed} then refuses any tag or attribute
 *   outside the measured subset, so a defect here throws instead of saving.
 * - **Only the measured schema is relied on** (`docs/01` §5.7): no inline
 *   styles but the line-through span, no class but `citation` and
 *   `citation-item`, no comment, `pre` without an inner `code`.
 * - **Markers** (`P4-T10`): body markers become `zotero://select` anchors
 *   `[n]` titled with the node's text (`docs/06` §10.2 (a)); a marker in the
 *   first cell of a §10 Notable Papers table row becomes a real citation node,
 *   and §11's body is replaced by the numbered entries, each with its node
 *   and one DOI link (D-06-7). The node text is the plugin's, made with the
 *   bibliography's CSL locale; Zotero's note editor draws its own text in the
 *   interface language and stores it on its first save, which the owner
 *   accepted (2026-10-27, `plan/00` §6 item 296(a)).
 * - **The eleven `## ` sections must be present once each and in order**
 *   (`docs/06` §9.1), and the text's cited keys in first-appearance order must
 *   be the bibliography's keys in index order, as for the export (`P4-T15`).
 * - **Code fences are left as written** (`P4-T10`'s rule): a marker inside one
 *   is shown as typed.
 */

import type {
  BibliographyEntry,
  RetractedEntry,
  TrendReport,
} from "../../model/trend";
import {
  type BibliographyPort,
  type BibliographyRequest,
  type CitationNode,
  escapeHtml,
  noteWrapperOpenTag,
} from "../../zotero/bibliography";
import { bindMarkers, citedKeysOf, fencedRanges } from "./citations";
import {
  DEFAULT_RETRACTED_HEADING,
  DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION,
  doiUrl,
  needsSemanticScholarAttribution,
  printedDoiAddress,
  sectionRange,
} from "./exportMarkdown";

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

/** Report-language text the renderer writes itself (`docs/08` §10.4). */
export interface ReportNoteLabels {
  /** Defaults to {@link DEFAULT_RETRACTED_HEADING}. */
  readonly retractedHeading?: string;
  /** Defaults to {@link DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION} (`P7-T35`). */
  readonly semanticScholarAttribution?: string;
}

/** What {@link renderReportNote} takes besides the report. */
export interface ReportNoteDeps {
  /** `zoteroBibliographyPort`; a unit test passes a fake. */
  readonly port: BibliographyPort;
  /**
   * The bibliography's style and CSL locale (`en-US` for every report, item
   * 294(a)); `libraryID` must be the report's.
   */
  readonly request: BibliographyRequest;
  readonly labels?: ReportNoteLabels;
}

// ---------------------------------------------------------------------------
// 2. The whitelist — `docs/01` §5.7, measured 2026-10-27
// ---------------------------------------------------------------------------

/** Tags this module writes, each with the attributes it may carry. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  div: ["data-citation-items", "data-schema-version"],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  p: [],
  strong: [],
  em: [],
  code: [],
  pre: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  table: [],
  tr: [],
  th: [],
  td: [],
  span: ["class", "data-citation", "style"],
  a: ["href", "title"],
};

const LINE_THROUGH_STYLE = "text-decoration: line-through";

/** One tag as written: `<name attr="value" …>` or `</name>`. */
const TAG_RE = /^<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z-]+="[^"<>]*")*)\s*>$/;
const ATTR_RE = /\s+([a-z-]+)="([^"<>]*)"/g;

/**
 * Throw unless every `<` in `html` opens a tag of the measured subset with
 * only its allowed attributes: `a` only to `zotero://select/` or `http(s)`,
 * `span` only as a citation node, its item, or the line-through span. The
 * last line of defence: everything from the model was escaped before it got
 * here, so a failure is a defect in this module, and nothing is saved.
 */
export function assertNoteHtmlAllowed(html: string): void {
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open < 0) return;
    const close = html.indexOf(">", open);
    const tag = close < 0 ? html.slice(open) : html.slice(open, close + 1);
    const match = TAG_RE.exec(tag);
    const name = match?.[2];
    const allowed = name === undefined ? undefined : ALLOWED[name];
    if (match === null || name === undefined || allowed === undefined) {
      throw new Error(`note HTML holds a disallowed tag at offset ${open}`);
    }
    const attrs = new Map<string, string>();
    for (const attr of (match[3] ?? "").matchAll(ATTR_RE)) {
      attrs.set(attr[1] ?? "", attr[2] ?? "");
    }
    for (const [attr, value] of attrs) {
      if (!allowed.includes(attr)) {
        throw new Error(`note HTML holds a disallowed attribute on <${name}>`);
      }
      if (
        attr === "href" &&
        !/^(?:zotero:\/\/select\/|https?:\/\/)/.test(value)
      ) {
        throw new Error("note HTML holds a disallowed link address");
      }
    }
    if (name === "span" && match[1] === "") {
      const cls = attrs.get("class");
      const ok =
        (cls === "citation" &&
          attrs.has("data-citation") &&
          attrs.size === 2) ||
        (cls === "citation-item" && attrs.size === 1) ||
        (attrs.get("style") === LINE_THROUGH_STYLE && attrs.size === 1);
      if (!ok) throw new Error("note HTML holds a disallowed span");
    }
    from = close < 0 ? html.length : close + 1;
  }
}

// ---------------------------------------------------------------------------
// 3. Inline Markdown
// ---------------------------------------------------------------------------

/**
 * A bound marker is U+E000, its number, U+E001, made by {@link bindMarkers}'
 * callback; a held piece of HTML is U+E002, its number, U+E003. The four are
 * Unicode private-use characters, built from their code points so the source
 * holds no invisible character.
 */
const CITE_OPEN = String.fromCharCode(0xe000);
const CITE_CLOSE = String.fromCharCode(0xe001);
const CITE_RE = new RegExp(`${CITE_OPEN}(\\d+)${CITE_CLOSE}`, "g");
const HOLD_OPEN = String.fromCharCode(0xe002);
const HOLD_CLOSE = String.fromCharCode(0xe003);
const HOLD_RE = new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g");
/** Every private-use character this module gives a meaning to. */
const RESERVED_RE = new RegExp(`[${CITE_OPEN}-${HOLD_CLOSE}]`, "g");
/** U+FFFD, what a reserved character the model wrote becomes. */
const REPLACEMENT = String.fromCharCode(0xfffd);

/** What a bound marker becomes where it stands. */
type CiteRenderer = (n: number) => string;

/** `` `code` `` spans: a backtick run closed by the next run of its length. */
function holdCodeSpans(text: string, hold: (html: string) => string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      out += text[i];
      i += 1;
      continue;
    }
    let run = 1;
    while (text[i + run] === "`") run += 1;
    const ticks = "`".repeat(run);
    let close = -1;
    let from = i + run;
    while (from < text.length) {
      const at = text.indexOf(ticks, from);
      if (at < 0) break;
      let after = at + run;
      while (text[after] === "`") after += 1;
      if (after - at === run) {
        close = at;
        break;
      }
      from = after;
    }
    if (close < 0) {
      out += ticks;
      i += run;
      continue;
    }
    let code = text.slice(i + run, close);
    if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) {
      code = code.slice(1, -1);
    }
    // A marker bound inside a code span is shown as its number, as text.
    code = code.replace(CITE_RE, (_m, n: string) => `[${n}]`);
    out += hold(`<code>${escapeHtml(code)}</code>`);
    i = close + run;
  }
  return out;
}

/**
 * One run of inline Markdown as note HTML: code spans, backslash escapes,
 * `http(s)` links, bold, italic, strike; everything else escaped text, and
 * each bound marker passed to `cite`.
 */
export function renderInline(text: string, cite: CiteRenderer): string {
  const held: string[] = [];
  const hold = (html: string): string => {
    held.push(html);
    return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
  };
  let s = holdCodeSpans(text, hold);
  s = s.replace(/\\([!-/:-@[-`{-~])/g, (_m, c: string) => hold(escapeHtml(c)));
  s = escapeHtml(s);
  const emphasis = (t: string): string =>
    t
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(
        /(?<![\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu,
        "<strong>$1</strong>",
      )
      .replace(
        /~~(?=\S)([\s\S]*?\S)~~/g,
        `<span style="${LINE_THROUGH_STYLE}">$1</span>`,
      )
      .replace(/\*(?=[^\s*])([^*]*?[^\s*])\*/g, "<em>$1</em>")
      .replace(/\*(?=[^\s*])([^*\s])\*/g, "<em>$1</em>")
      .replace(
        // An underscore inside a word (`research_helper`) neither opens nor
        // closes emphasis (CommonMark).
        /(?<![\p{L}\p{N}_])_(?=[^\s_])((?:[^_]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))*?[^\s_])_(?![\p{L}\p{N}_])/gu,
        "<em>$1</em>",
      );
  // An image is not emitted (`docs/06` §14.1): its Markdown stays as text.
  s = s.replace(/!\[[^\][]*\]\([^()]*\)/g, (image) => hold(image));
  // Links: only to an http(s) address, which escaping left without `"`.
  s = s.replace(
    /\[([^\][]+)\]\(\s*(https?:\/\/[^\s()]+)\s*\)/g,
    (_m, label: string, url: string) =>
      hold(`<a href="${url}">${emphasis(label)}</a>`),
  );
  s = emphasis(s);
  // Restore held HTML (a link label can hold a code span or an escape).
  for (let guard = 0; guard < 3 && s.includes(HOLD_OPEN); guard += 1) {
    s = s.replace(HOLD_RE, (_m, k: string) => held[Number(k)] ?? "");
  }
  return s.replace(CITE_RE, (_m, n: string) => cite(Number(n)));
}

// ---------------------------------------------------------------------------
// 4. Blocks
// ---------------------------------------------------------------------------

/** One line of the report, with its line number in the whole text. */
interface Line {
  readonly text: string;
  readonly at: number;
}

/** What the block renderer needs besides the lines. */
interface BlockContext {
  /** Line number → the fenced range's last line number, for fenced lines. */
  readonly fenceEndOf: ReadonlyMap<number, number>;
  /** Line numbers of fence lines that open a fence. */
  readonly fenceStarts: ReadonlySet<number>;
  /** Line numbers of fence lines that close a fence. */
  readonly fenceCloses: ReadonlySet<number>;
  /** A body marker's anchor. */
  readonly anchor: CiteRenderer;
  /** A citation node, for the first cell of a Notable Papers row. */
  readonly node: CiteRenderer;
  /** Line numbers inside §10 Notable Papers. */
  readonly notable: (at: number) => boolean;
  /** HTML to add after the heading on this line (§11's entries). */
  readonly after: ReadonlyMap<number, string>;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*$)/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(text: string): number {
  return (/^[ \t]*/.exec(text)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

/** A list item's marker, indent and where its content starts. */
function itemOf(text: string):
  | {
      readonly indent: number;
      readonly ordered: boolean;
      readonly contentIndent: number;
      readonly rest: string;
    }
  | undefined {
  const m = ITEM_RE.exec(text);
  if (m === null) return undefined;
  const indent = indentOf(m[1] ?? "");
  const marker = m[2] ?? "";
  const gap = (m[3] ?? " ").replace(/\t/g, "    ").length;
  return {
    indent,
    ordered: /\d/.test(marker),
    contentIndent: indent + marker.length + (gap > 4 ? 1 : gap),
    rest: m[4] ?? "",
  };
}

function splitRow(text: string): string[] {
  let row = text.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function isTableStart(lines: readonly Line[], i: number): boolean {
  const head = lines[i]?.text ?? "";
  const sep = lines[i + 1]?.text ?? "";
  return (
    head.includes("|") && TABLE_SEPARATOR_RE.test(sep) && sep.includes("-")
  );
}

/** Whether `line` starts a block that ends a paragraph. */
function startsBlock(
  lines: readonly Line[],
  i: number,
  ctx: BlockContext,
): boolean {
  const line = lines[i];
  if (line === undefined) return true;
  return (
    ctx.fenceEndOf.has(line.at) ||
    HEADING_RE.test(line.text) ||
    QUOTE_RE.test(line.text) ||
    itemOf(line.text) !== undefined ||
    isTableStart(lines, i)
  );
}

/** A slice of lines with `n` leading columns removed (at most their indent). */
function dedent(text: string, n: number): string {
  let cols = 0;
  let i = 0;
  while (i < text.length && cols < n && (text[i] === " " || text[i] === "\t")) {
    cols += text[i] === "\t" ? 4 : 1;
    i += 1;
  }
  return text.slice(i);
}

function renderTable(rows: readonly Line[], ctx: BlockContext): string {
  const [head, , ...body] = rows;
  const width = splitRow(head?.text ?? "").length;
  const cells = (line: Line, tag: "th" | "td"): string => {
    const values = splitRow(line.text).slice(0, width);
    while (values.length < width) values.push("");
    return values
      .map((value, col) => {
        const cite =
          tag === "td" && col === 0 && ctx.notable(line.at)
            ? ctx.node
            : ctx.anchor;
        return `<${tag}>${renderInline(value.replace(/\\\|/g, "|"), cite)}</${tag}>`;
      })
      .join("");
  };
  return (
    "<table>" +
    (head === undefined ? "" : `<tr>${cells(head, "th")}</tr>`) +
    body.map((row) => `<tr>${cells(row, "td")}</tr>`).join("") +
    "</table>"
  );
}

/** Render `lines` as blocks. */
function renderBlocks(lines: readonly Line[], ctx: BlockContext): string {
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as Line;
    const text = line.text;

    // A fenced block, left as written (`P4-T10`).
    const fenceEnd = ctx.fenceEndOf.get(line.at);
    if (fenceEnd !== undefined) {
      const body: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j] as Line).at <= fenceEnd) {
        const l = lines[j] as Line;
        if (!ctx.fenceStarts.has(l.at) && !ctx.fenceCloses.has(l.at)) {
          body.push(l.text);
        }
        j += 1;
      }
      html += `<pre>${escapeHtml(body.join("\n"))}</pre>`;
      i = j;
      continue;
    }
    if (isBlank(text)) {
      i += 1;
      continue;
    }
    const heading = HEADING_RE.exec(text);
    if (heading !== null) {
      const level = (heading[1] ?? "#").length;
      html += `<h${level}>${renderInline(heading[2] ?? "", ctx.anchor)}</h${level}>`;
      html += ctx.after.get(line.at) ?? "";
      i += 1;
      continue;
    }
    if (QUOTE_RE.test(text)) {
      const inner: Line[] = [];
      while (i < lines.length) {
        const q = QUOTE_RE.exec((lines[i] as Line).text);
        if (q === null || ctx.fenceEndOf.has((lines[i] as Line).at)) break;
        inner.push({ text: q[1] ?? "", at: (lines[i] as Line).at });
        i += 1;
      }
      html += `<blockquote>${renderBlocks(inner, ctx)}</blockquote>`;
      continue;
    }
    const first = itemOf(text);
    if (first !== undefined) {
      const items: Line[][] = [];
      while (i < lines.length) {
        const current = lines[i] as Line;
        const item = itemOf(current.text);
        if (
          item === undefined ||
          item.indent !== first.indent ||
          item.ordered !== first.ordered ||
          ctx.fenceEndOf.has(current.at)
        ) {
          break;
        }
        const content: Line[] = [{ text: item.rest, at: current.at }];
        i += 1;
        let lastBlank = false;
        while (i < lines.length) {
          const next = lines[i] as Line;
          if (isBlank(next.text)) {
            // Look past the blank lines: the item continues if the next line
            // is indented into it; the list continues on a sibling item.
            let k = i;
            while (k < lines.length && isBlank((lines[k] as Line).text)) k += 1;
            const after = lines[k];
            if (
              after !== undefined &&
              indentOf(after.text) >= item.contentIndent
            ) {
              content.push({ text: "", at: next.at });
              lastBlank = true;
              i += 1;
              continue;
            }
            break;
          }
          const sub = itemOf(next.text);
          if (
            indentOf(next.text) >= item.contentIndent ||
            (sub !== undefined && sub.indent > first.indent)
          ) {
            content.push({
              text: dedent(
                next.text,
                Math.min(indentOf(next.text), item.contentIndent),
              ),
              at: next.at,
            });
            lastBlank = false;
            i += 1;
            continue;
          }
          if (!lastBlank && !startsBlock(lines, i, ctx)) {
            content.push({ text: next.text.trimStart(), at: next.at });
            i += 1;
            continue;
          }
          break;
        }
        items.push(content);
        // A blank line between siblings does not end the list.
        let k = i;
        while (k < lines.length && isBlank((lines[k] as Line).text)) k += 1;
        const sibling =
          lines[k] === undefined ? undefined : itemOf((lines[k] as Line).text);
        if (
          k > i &&
          sibling !== undefined &&
          sibling.indent === first.indent &&
          sibling.ordered === first.ordered
        ) {
          i = k;
        }
      }
      const tag = first.ordered ? "ol" : "ul";
      html += `<${tag}>${items.map((item) => `<li>${renderBlocks(item, ctx)}</li>`).join("")}</${tag}>`;
      continue;
    }
    if (isTableStart(lines, i)) {
      const rows: Line[] = [line, lines[i + 1] as Line];
      i += 2;
      while (i < lines.length) {
        const row = lines[i] as Line;
        if (
          isBlank(row.text) ||
          !row.text.includes("|") ||
          ctx.fenceEndOf.has(row.at)
        )
          break;
        rows.push(row);
        i += 1;
      }
      html += renderTable(rows, ctx);
      continue;
    }
    // A paragraph: lines up to a blank line or another block.
    const para: string[] = [text.trim()];
    i += 1;
    while (
      i < lines.length &&
      !isBlank((lines[i] as Line).text) &&
      !startsBlock(lines, i, ctx)
    ) {
      para.push((lines[i] as Line).text.trim());
      i += 1;
    }
    html += `<p>${renderInline(para.join(" "), ctx.anchor)}</p>`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// 5. The bibliography
// ---------------------------------------------------------------------------

/** An entry's text, escaped, with its DOI as exactly one link. */
function entryHtml(text: string, doi: string | undefined): string {
  if (doi === undefined) return escapeHtml(text);
  const url = escapeHtml(doiUrl(doi));
  const printed = printedDoiAddress(text, doi);
  if (printed !== undefined) {
    const address = text.slice(printed.start, printed.end);
    return (
      escapeHtml(text.slice(0, printed.start)) +
      `<a href="${url}">${escapeHtml(address)}</a>` +
      escapeHtml(text.slice(printed.end))
    );
  }
  const link = `<a href="${url}">${url}</a>`;
  return text === "" ? link : `${escapeHtml(text)} ${link}`;
}

function bibliographyHtml(
  entries: readonly BibliographyEntry[],
  nodes: ReadonlyMap<string, CitationNode>,
  retracted: readonly RetractedEntry[],
  retractedHeading: string,
  attribution: string,
): string {
  let html = entries
    .map((entry) => {
      const node = nodes.get(entry.itemKey);
      if (node === undefined) {
        throw new Error(
          `no citation node for bibliography entry ${entry.index}`,
        );
      }
      return `<p>[${entry.index}] ${node.html} ${entryHtml(entry.text, entry.doi)}</p>`;
    })
    .join("");
  // Under the numbered entries, before the retracted list (`P7-T35`).
  if (needsSemanticScholarAttribution(entries)) {
    html += `<p>${escapeHtml(attribution)}</p>`;
  }
  if (retracted.length > 0) {
    html +=
      `<h3>${escapeHtml(retractedHeading)}</h3><ul>` +
      retracted
        .map((entry) => `<li><p>${entryHtml(entry.text, entry.doi)}</p></li>`)
        .join("") +
      "</ul>";
  }
  return html;
}

// ---------------------------------------------------------------------------
// 6. The note
// ---------------------------------------------------------------------------

/**
 * The stored report as note HTML, given its citation nodes (`P4-T13` steps
 * 2–3): the `data-schema-version="9"` wrapper around the converted Markdown,
 * body markers as `zotero://select` anchors `[n]`, the first cell of each §10
 * Notable Papers row and each §11 entry as a citation node.
 *
 * @param report - the stored record, after the citation pass
 * @param nodes - one node per bibliography entry, any order
 * @param labels - report-language text; English by default
 * @throws Error when a section heading is missing, repeated or out of order,
 *   when the bibliography's indices are not 1…n or disagree with the text's
 *   first-appearance order, when an entry has no node, or when the output
 *   holds anything outside the measured subset ({@link assertNoteHtmlAllowed})
 */
export function renderReportNoteHtml(
  report: TrendReport,
  nodes: readonly CitationNode[],
  labels: ReportNoteLabels = {},
): string {
  const lines = report.markdown.replace(/\r\n?/g, "\n").split("\n");

  // The eleven sections, once each, in order (`docs/06` §9.1).
  const ranges = new Map<
    number,
    { readonly start: number; readonly end: number }
  >();
  let previous = -1;
  for (let n = 1; n <= 11; n += 1) {
    const section = report.sections.find((s) => s.number === n);
    if (section === undefined)
      throw new Error(`the report has no §${n} section`);
    const range = sectionRange(lines, section.heading);
    if (range.start <= previous) throw new Error(`§${n} is out of order`);
    previous = range.start;
    ranges.set(n, range);
  }
  const notable = ranges.get(10) as { start: number; end: number };
  const references = ranges.get(11) as { start: number; end: number };

  const entries = [...report.bibliography].sort((a, b) => a.index - b.index);
  entries.forEach((entry, i) => {
    if (entry.index !== i + 1)
      throw new Error("the bibliography's indices are not 1…n");
  });

  // The text without §11's body; every line up to §11's heading keeps its
  // number, which is all the renderer looks up by number.
  const kept = [
    ...lines.slice(0, references.start + 1),
    ...lines.slice(references.end),
  ];
  const text = kept.join("\n").replace(RESERVED_RE, REPLACEMENT);
  const order = entries.map((entry) => entry.itemKey);
  const cited = citedKeysOf(text);
  if (
    cited.length !== order.length ||
    cited.some((key, i) => key !== order[i])
  ) {
    throw new Error(
      `the report cites ${cited.length} items and its bibliography lists ` +
        `${order.length}, or in another order`,
    );
  }
  const byKey = new Map(nodes.map((node) => [node.itemKey, node]));
  const byIndex = new Map<number, CitationNode>();
  for (const entry of entries) {
    const node = byKey.get(entry.itemKey);
    if (node === undefined) {
      throw new Error(`no citation node for bibliography entry ${entry.index}`);
    }
    byIndex.set(entry.index, node);
  }
  const bound = bindMarkers(
    text,
    new Set(order),
    (_key, n) => `${CITE_OPEN}${n}${CITE_CLOSE}`,
  );

  // Fenced ranges, by line number, from the same scanner the binder used.
  const lineStarts: number[] = [];
  let offset = 0;
  const boundLines = bound.split("\n");
  for (const l of boundLines) {
    lineStarts.push(offset);
    offset += l.length + 1;
  }
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const fenceEndOf = new Map<number, number>();
  const fenceStarts = new Set<number>();
  const fenceCloses = new Set<number>();
  for (const [from, to] of fencedRanges(bound)) {
    const first = lineOf(from);
    const last = lineOf(Math.max(from, to - 1));
    fenceStarts.add(first);
    // The last line closes the fence when it is a bare fence of the opener's
    // character, at least as long (`fencedRanges`' rule); an unclosed fence
    // runs to the end and keeps its last line as content.
    const opener =
      /^[ \t]*(`{3,}|~{3,})/.exec(boundLines[first] ?? "")?.[1] ?? "";
    const closer = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(
      boundLines[last] ?? "",
    )?.[1];
    if (
      last > first &&
      closer !== undefined &&
      closer[0] === opener[0] &&
      closer.length >= opener.length
    ) {
      fenceCloses.add(last);
    }
    for (let k = first; k <= last; k += 1) fenceEndOf.set(k, last);
  }

  const cite =
    (form: "anchor" | "node"): CiteRenderer =>
    (n) => {
      const node = byIndex.get(n);
      if (node === undefined) throw new Error(`citation [${n}] has no node`);
      return form === "node"
        ? node.html
        : `<a href="${escapeHtml(node.selectUri)}" title="${escapeHtml(node.text)}">[${n}]</a>`;
    };
  const after = new Map<number, string>([
    [
      references.start,
      bibliographyHtml(
        entries,
        byKey,
        report.retracted,
        labels.retractedHeading ?? DEFAULT_RETRACTED_HEADING,
        labels.semanticScholarAttribution ??
          DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION,
      ),
    ],
  ]);
  const body = renderBlocks(
    boundLines.map((t, at) => ({ text: t, at })),
    {
      fenceEndOf,
      fenceStarts,
      fenceCloses,
      anchor: cite("anchor"),
      node: cite("node"),
      notable: (at) => at > notable.start && at < notable.end,
      after,
    },
  );
  const html = `${noteWrapperOpenTag(entries.map((e) => byKey.get(e.itemKey) as CitationNode))}${body}</div>`;
  assertNoteHtmlAllowed(html);
  return html;
}

/**
 * The stored report as note HTML (`P4-T13`): its citation nodes made through
 * `deps.port` in the bibliography's style and CSL locale, then
 * {@link renderReportNoteHtml}.
 *
 * @throws Error when `deps.request` names another library than the report's,
 *   or as {@link renderReportNoteHtml} and `citationNodes` throw
 */
export async function renderReportNote(
  report: TrendReport,
  deps: ReportNoteDeps,
): Promise<string> {
  if (deps.request.libraryID !== report.libraryID) {
    throw new Error(
      "the citation request names another library than the report's",
    );
  }
  const keys = [...report.bibliography]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.itemKey);
  const nodes = await deps.port.citationNodes(keys, deps.request);
  return renderReportNoteHtml(report, nodes, deps.labels);
}

/**
 * The trend report's "Export as Markdown" (`P4-T15`; `docs/06` §14.3,
 * `docs/08` §6.3).
 *
 * **Callers.** The report window's host (`createReportWindowSession` in
 * `src/bootstrap/registerUI.ts`, `P4-T20`) calls {@link exportReportMarkdown}
 * with the path its window document chose and `src/zotero/notes.ts`'s
 * `reportFileWriter()`, {@link renderReportMarkdown} for the preview's final
 * text and for Copy, and {@link reportExportFileName} for the save dialog's
 * suggested name. A `ko` report's
 * caller passes `P4-T12`'s `reportLabels.ts` label as
 * {@link ReportExportLabels.retractedHeading} (`P4-T21`). Pure functions and
 * one port, so nothing constructs this module.
 *
 * ## What is decided here
 *
 * The owner's two decisions of 2026-10-26 (`plan/00` §6 item 286) and the
 * choices this card made are recorded in `docs/06` §14.3's notes of
 * 2026-10-27 and `docs/08` §6.3's; in short:
 *
 * - **`.md` to a user-chosen path only**, and **numeric markers with DOI
 *   links, no setting**: the export writes no `zotero://` link of its own.
 * - **The model's prose cannot add markup the reader did not see** (owner,
 *   2026-10-27, `plan/00` §6 item 296(c), (d); `docs/06` §14.3's note, item
 *   8): {@link escapeReportProse} shows raw HTML as text, lets no `zotero:`
 *   address become a link, and keeps a marker followed by `(…)` or `[…]` a
 *   plain number. Code fences and inline code spans stay as written.
 * - **The stored record is the source.** §11's body is replaced wholesale by
 *   the run's `bibliography` and `retracted` lists, which `P4-T11`'s port
 *   formatted, so an export makes no citeproc call and reads no Zotero item.
 * - **`[n]` is `BibliographyEntry.index`**, checked against the text's own
 *   first-appearance order ({@link citedKeysOf}); every marker goes through
 *   {@link bindMarkers}, so nothing unresolved reaches the file.
 * - **A marker inside a code fence stays as written** (`P4-T10`): "no `[[`"
 *   holds outside code fences.
 * - **One DOI link per DOI**; entry text is escaped so a title cannot become
 *   a marker, a link or emphasis.
 * - **The destination is never logged** (`docs/09` §2.2).
 */

import type { Logger } from "../../core/logger";
import type {
  BibliographyEntry,
  RetractedEntry,
  TrendReport,
} from "../../model/trend";
import { normalizeDoi } from "../../model/ids";
import type { ReportLanguage } from "../../model/trend";
import type { ReportFileWriter } from "../../zotero/notes";
import {
  assertAllMarkersResolve,
  bindMarkers,
  citedKeysOf,
  fencedRanges,
} from "./citations";

export type { ReportFileWriter } from "../../zotero/notes";

// ---------------------------------------------------------------------------
// 1. Labels
// ---------------------------------------------------------------------------

/**
 * The heading of the unnumbered list after §11, as the owner worded it on
 * 2026-10-26 (`plan/00` §6 item 286; `P4-T10`'s decided line). An English
 * report's default; `P4-T12`'s `reportLabels.ts` owns the report-language
 * table and a `ko` caller passes its label.
 */
export const DEFAULT_RETRACTED_HEADING = "Retracted — not used in this report";

/** Report-language text the export writes itself (`docs/08` §10.4). */
export interface ReportExportLabels {
  /** Defaults to {@link DEFAULT_RETRACTED_HEADING}. */
  readonly retractedHeading?: string;
}

// ---------------------------------------------------------------------------
// 2. The filename — `docs/08` §6.3
// ---------------------------------------------------------------------------

/** `docs/08` §6.3's cap on the base name, counted in code points. */
const BASE_NAME_MAX = 80;

/**
 * `docs/08` §6.3's `safeBaseName`: path separators, the characters Windows
 * refuses and control characters become `-`, whitespace runs one space, the
 * empty result `"report"` (`docs/01` gotcha 19). Two readings, recorded in
 * `docs/08` §6.3's note of 2026-10-27: the cap counts code points, so no
 * surrogate pair is cut, and the result is trimmed again after the cap.
 */
export function safeBaseName(name: string | undefined): string {
  const cleaned = (name ?? "")
    // eslint-disable-next-line no-control-regex -- the control range is the point
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const capped = Array.from(cleaned).slice(0, BASE_NAME_MAX).join("").trim();
  return capped === "" ? "report" : capped;
}

/**
 * The save dialog's suggested name: `<safe collection name> — trends
 * <YYYY-MM-DD>.md`, dated by the report's generation (UTC), not the export.
 * `language` is given only for a two-report run, whose two reports share a
 * date: `… — trends <YYYY-MM-DD> (ko).md` (`docs/08` §6.3's note of 2026-11-02).
 */
export function reportExportFileName(
  collectionName: string,
  generatedAtEpochMs: number,
  language?: ReportLanguage,
): string {
  const date = new Date(generatedAtEpochMs).toISOString().slice(0, 10);
  const suffix = language === undefined ? "" : ` (${language})`;
  return `${safeBaseName(collectionName)} — trends ${date}${suffix}.md`;
}

// ---------------------------------------------------------------------------
// 3. Escaping and DOI links
// ---------------------------------------------------------------------------

/** Characters escaped anywhere in an entry: marker, link, emphasis, HTML. */
const INLINE_SPECIAL_RE = /[\\`*_[\]<>~]/g;

/** A line start Markdown would read as a heading, a list or a list number. */
const LEADING_SPECIAL_RE = /^(?:([#+-])|(\d+)([.)]))/;

/**
 * `text` as one line of literal Markdown: line breaks become spaces, the
 * inline specials are backslash-escaped, and a leading `#`, `+`, `-` or list
 * number is escaped so the line cannot open a block.
 */
export function escapeMarkdownText(text: string): string {
  const oneLine = text.replace(/\s*[\r\n]+\s*/g, " ");
  const inline = oneLine.replace(INLINE_SPECIAL_RE, (c) => `\\${c}`);
  return inline.replace(
    LEADING_SPECIAL_RE,
    (_m, sign: string | undefined, digits: string, mark: string) =>
      sign !== undefined ? `\\${sign}` : `${digits}\\${mark}`,
  );
}

/** What a DOI may keep unencoded in a URL path (RFC 3986 `pchar` and `/`). */
const URL_SAFE_RE = /[A-Za-z0-9\-._~!$&'()*+,;=:@/]/;

/**
 * The portable `https://doi.org/` address of `doi` (`docs/06` §14.3), every
 * character a URL path or a Markdown autolink cannot carry percent-encoded
 * (`<`, `>`, `#`, `?`, `%`, `[`, `]`, non-ASCII, …).
 */
export function doiUrl(doi: string): string {
  let path = "";
  for (const char of doi) {
    path += URL_SAFE_RE.test(char) ? char : encodeURIComponent(char);
  }
  return `https://doi.org/${path}`;
}

/** A `doi.org` address as a style prints it, up to whitespace or `<`/`>`. */
const PRINTED_DOI_URL_RE = /(?:https?:\/\/)?(?:dx\.)?doi\.org\/[^\s<>]+/gi;

/** Punctuation `normalizeDoi` also strips from a DOI's end. */
const TRAILING_PUNCTUATION_RE = /[.,;)\]]+$/;

/**
 * Where the style printed `doi`'s own `doi.org` address in `text`, trailing
 * punctuation excluded, or `undefined`. Shared with `noteHtml.ts`
 * (`P4-T13`), so the note and the file link the same address.
 */
export function printedDoiAddress(
  text: string,
  doi: string,
): { readonly start: number; readonly end: number } | undefined {
  for (const match of text.matchAll(PRINTED_DOI_URL_RE)) {
    const printed = match[0];
    const trailing = TRAILING_PUNCTUATION_RE.exec(printed)?.[0] ?? "";
    const address = printed.slice(0, printed.length - trailing.length);
    if (normalizeDoi(address) !== doi) continue;
    return { start: match.index, end: match.index + address.length };
  }
  return undefined;
}

/**
 * One entry's text with its DOI as exactly one link: the style's own printed
 * `doi.org` address of the same DOI, linked where it stands, or else an
 * address appended. The rest of the text is escaped.
 */
function entryWithDoiLink(text: string, doi: string | undefined): string {
  if (doi === undefined) return escapeMarkdownText(text);
  const link = `<${doiUrl(doi)}>`;
  const printed = printedDoiAddress(text, doi);
  if (printed !== undefined) {
    const before = text.slice(0, printed.start);
    const after = text.slice(printed.end);
    return `${escapeMarkdownText(before)}${link}${escapeMarkdownText(after)}`;
  }
  const escaped = escapeMarkdownText(text);
  return escaped === "" ? link : `${escaped} ${link}`;
}

// ---------------------------------------------------------------------------
// 4. The model's prose — `plan/00` §6 item 296(c), (d)
// ---------------------------------------------------------------------------

/**
 * An inline link or image whose destination is a `zotero:` address:
 * `](zotero:…`, `]( <zotero:…`, any case.
 */
const ZOTERO_LINK_RE = /\]\((?=[ \t]*<?[ \t]*zotero:)/gi;

/** A marker directly followed by `(` or `[`: `[[KEY]](…)`, `[[KEY]][…]`. */
const MARKER_THEN_BRACKET_RE = /(\[\[[^[\]\r\n]*\]\])(?=[([])/g;

/**
 * A link reference definition (CommonMark: up to three spaces, `[label]:`,
 * a destination) that would turn text into a link the reader did not see: one
 * pointing at a `zotero:` address, or one whose label is all digits, which
 * would turn a bare `[n]` into a link.
 */
const RISKY_DEFINITION_RE =
  /^( {0,3})\[(?=\s*\d+\s*\]:|[^\]\r\n]+\]:[ \t]*<?[ \t]*zotero:)/i;

/** `segment` (no code span in it) with `<`, `zotero:` links and markers made inert. */
function escapeProseSegment(segment: string): string {
  return segment
    .replace(ZOTERO_LINK_RE, "]\\(")
    .replace(MARKER_THEN_BRACKET_RE, "$1\\")
    .replace(/</g, "\\<");
}

/**
 * `text`'s code spans (CommonMark: a backtick run closed by the next run of
 * the same length) left alone and every other part passed to `escape`.
 */
function outsideCodeSpans(text: string, escape: (s: string) => string): string {
  let out = "";
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      plain += text[i];
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
      plain += ticks;
      i += run;
      continue;
    }
    out += escape(plain) + text.slice(i, close + run);
    plain = "";
    i = close + run;
  }
  return out + escape(plain);
}

/**
 * The model's prose as it may go into the `.md` file (owner, 2026-10-27,
 * `plan/00` §6 item 296(c), (d); `docs/06` §14.3's note, item 8). Outside
 * code fences and inline code spans, which stay exactly as written:
 *
 * - every `<` is backslash-escaped, so raw HTML and autolinks show as text;
 * - an inline link or image to a `zotero:` address keeps its text and loses
 *   its link (`](` becomes `]\(`);
 * - a link reference definition to a `zotero:` address, or with an all-digit
 *   label, is escaped so it defines nothing;
 * - a marker followed directly by `(` or `[` gets a backslash before that
 *   bracket, so once bound it stays a plain `[n]` and the bracketed text
 *   after it stays visible.
 *
 * Markers themselves are untouched: {@link bindMarkers} numbers them after.
 */
export function escapeReportProse(markdown: string): string {
  const fences = fencedRanges(markdown);
  let out = "";
  let last = 0;
  const prose = (chunk: string): string =>
    chunk
      .split("\n")
      .map((line) =>
        outsideCodeSpans(
          line.replace(RISKY_DEFINITION_RE, "$1\\["),
          escapeProseSegment,
        ),
      )
      .join("\n");
  for (const [from, to] of fences) {
    out += prose(markdown.slice(last, from)) + markdown.slice(from, to);
    last = to;
  }
  return out + prose(markdown.slice(last));
}

// ---------------------------------------------------------------------------
// 5. The rendering
// ---------------------------------------------------------------------------

/** A level-1 or level-2 ATX heading line: where a report section ends. */
const SECTION_END_RE = /^#{1,2}[ \t]/;

/** `heading` without any leading `#`s, as `## <this>` would carry it. */
export function headingText(heading: string): string {
  return heading.replace(/^#+[ \t]*/, "").trim();
}

/**
 * Where a report section sits in the report's lines: its `## ` heading line
 * (`start`) and the first line after its body (`end`): the next level-1 or
 * level-2 heading, or the end. Shared with `noteHtml.ts` (`P4-T13`).
 *
 * @throws Error when the heading is not found exactly once
 */
export function sectionRange(
  lines: readonly string[],
  heading: string,
): { readonly start: number; readonly end: number } {
  const wanted = headingText(heading);
  const found = lines.flatMap((line, i) =>
    /^##[ \t]/.test(line) && headingText(line) === wanted ? [i] : [],
  );
  const start = found[0];
  if (start === undefined || found.length !== 1) {
    throw new Error(
      `a section heading appears ${found.length} times in the report`,
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (SECTION_END_RE.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** The §11 body's lines. */
function bibliographyBlock(
  entries: readonly BibliographyEntry[],
  retracted: readonly RetractedEntry[],
  retractedHeading: string,
): readonly string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (lines.length > 0) lines.push("");
    lines.push(`[${entry.index}] ${entryWithDoiLink(entry.text, entry.doi)}`);
  }
  if (retracted.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`### ${escapeMarkdownText(retractedHeading)}`, "");
    for (const entry of retracted) {
      lines.push(`- ${entryWithDoiLink(entry.text, entry.doi)}`);
    }
  }
  return lines;
}

/**
 * The stored report as a portable Markdown file (`P4-T15` steps 1–2).
 *
 * Every `[[itemKey]]` outside a code fence becomes `[n]`, the
 * {@link BibliographyEntry.index} of its item; §11's body, from its heading
 * to the next level-1 or level-2 heading, is replaced by the numbered entries
 * with their DOI links and, when the run kept any, the unnumbered retracted
 * list. Nothing else of the report is changed, and nothing outside
 * `markdown`, `sections`, `bibliography` and `retracted` is read.
 *
 * @param report - the stored record, after the citation pass
 * @param labels - report-language text; English by default
 * @returns the file's text, ending in one newline
 * @throws Error when §11's heading is not found exactly once, when the
 *   bibliography's indices are not 1…n, or when the text's cited keys in
 *   first-appearance order are not the bibliography's keys in index order —
 *   the record is then not one the run saved, and no file is better than a
 *   wrongly numbered one
 */
export function renderReportMarkdown(
  report: TrendReport,
  labels: ReportExportLabels = {},
): string {
  const section = report.sections.find((s) => s.number === 11);
  if (section === undefined) {
    throw new Error("the report has no §11 section");
  }
  const lines = report.markdown.split("\n");
  const { start: at, end } = sectionRange(lines, section.heading);

  const entries = [...report.bibliography].sort((a, b) => a.index - b.index);
  entries.forEach((entry, i) => {
    if (entry.index !== i + 1) {
      throw new Error("the bibliography's indices are not 1…n");
    }
  });

  // The text without §11's body: markers are numbered over it, and §11's
  // heading line keeps its place, so the body goes back in by line number.
  const kept = [...lines.slice(0, at + 1), ...lines.slice(end)];
  // The model's prose made inert (item 296(c), (d)); markers keep their place.
  const text = escapeReportProse(kept.join("\n"));
  const cited = citedKeysOf(text);
  const order = entries.map((entry) => entry.itemKey);
  if (
    cited.length !== order.length ||
    cited.some((key, i) => key !== order[i])
  ) {
    throw new Error(
      `the report cites ${cited.length} items and its bibliography lists ` +
        `${order.length}, or in another order`,
    );
  }
  const index = new Map(entries.map((entry) => [entry.itemKey, entry.index]));
  // `bindMarkers` numbers by the same first appearance, so its `n` equals the
  // entry's index; the map is used so the file prints the record's number.
  const bound = bindMarkers(
    text,
    new Set(order),
    (key, n) => `[${index.get(key) ?? n}]`,
  ).split("\n");

  const body = bibliographyBlock(
    entries,
    report.retracted,
    labels.retractedHeading ?? DEFAULT_RETRACTED_HEADING,
  );
  const head = bound.slice(0, at + 1);
  const tail = bound.slice(at + 1);
  const out = [
    ...head,
    ...(body.length > 0 ? ["", ...body] : []),
    ...(tail.length > 0 ? [""] : []),
    ...tail,
  ]
    .join("\n")
    .replace(/\n+$/, "");
  // The gate: no marker is left outside a code fence.
  assertAllMarkersResolve(out, new Set());
  return `${out}\n`;
}

// ---------------------------------------------------------------------------
// 6. The export
// ---------------------------------------------------------------------------

/**
 * What {@link exportReportMarkdown} did. A value, not a message: the report
 * window (`P4-T20`) renders it.
 *
 * - `written` — the file reached the path the window chose.
 * - `no-path` — the caller supplied an empty destination; nothing written.
 * - `invalid-report` — {@link renderReportMarkdown} refused the record;
 *   nothing written.
 * - `failed` — the writer threw.
 *
 * There is no `cancelled`: a dismissed save dialog never calls this.
 */
export type ReportExportOutcome =
  "written" | "no-path" | "invalid-report" | "failed";

export interface ReportExportDeps {
  readonly files: ReportFileWriter;
  readonly logger: Logger;
  readonly labels?: ReportExportLabels;
}

/**
 * "Save as Markdown" (`docs/08` §6.3): render the stored report and write it
 * to `path`.
 *
 * **The path is never logged** (`docs/09` §2.2), and neither is an error's
 * message, which can quote it: each outcome is logged with the report's `id`
 * alone.
 *
 * @param path - the destination the report window chose; never stored or
 *   logged, and never put into the file
 * @param report - the stored record
 * @param deps - the file-writing port, the logger, the report-language labels
 * @returns which {@link ReportExportOutcome} happened; never rejects
 */
export async function exportReportMarkdown(
  path: string,
  report: TrendReport,
  deps: ReportExportDeps,
): Promise<ReportExportOutcome> {
  const { files, logger } = deps;
  const ctx = { reportId: report.id };
  if (path === "") {
    logger.warn("Markdown export was asked for no destination", ctx);
    return "no-path";
  }
  let markdown: string;
  try {
    markdown = renderReportMarkdown(report, deps.labels);
  } catch {
    logger.warn(
      "Markdown export refused: the stored report has no single §11 or its " +
        "citations and bibliography do not agree, so nothing was written",
      ctx,
    );
    return "invalid-report";
  }
  try {
    await files.writeTextFile(path, markdown);
  } catch {
    logger.warn(
      "Markdown export could not be written; the destination and the " +
        "error are not logged",
      ctx,
    );
    return "failed";
  }
  logger.info("trend report exported as Markdown", ctx);
  return "written";
}

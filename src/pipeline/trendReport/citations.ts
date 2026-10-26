/**
 * The citation validator and marker binding of the trend report (`P4-T10`;
 * `docs/06` §10.1–§10.2, §13.4; `docs/12` §10 "Expected output" checks 2 and
 * 5).
 *
 * **Callers.** Nothing calls this module yet. `compose.ts` (`P4-T08`) runs
 * {@link validateCitations} on the model's report; `critique.ts` (`P4-T09`)
 * takes the cited keys it returns and {@link citedKeysOf} per section;
 * `noteHtml.ts` (`P4-T13`) and `exportMarkdown.ts` (`P4-T15`) render markers
 * through {@link bindMarkers}; the run (`trendReportPipeline.ts`, `P4-T18`)
 * calls {@link assertAllMarkersResolve} on the final text before it is saved.
 *
 * ## What is decided here
 *
 * The choices `docs/06` §10.1 and `docs/12` §10 left open are recorded in
 * `docs/06` §10.1's note of 2026-10-27; in short:
 *
 * - **A marker is any `[[…]]` on one line.** One whose content is not an item
 *   key (`/^[A-Z0-9]{8}$/`) is malformed and replaced, never trimmed or
 *   re-cased — code repairs no citation, and no model is called (`docs/12`
 *   §10, decided 2026-10-26).
 * - **A combined marker is split first** (owner, 2026-10-27, `plan/00` §6
 *   item 292(c); `docs/06` §10.1's note of that date): content holding a `,`
 *   or `;` becomes one marker per part, each checked on its own and joined by
 *   one space — a valid part kept, an invalid part replaced visibly. Only
 *   {@link validateCitations} splits; the gate and the binder read text it has
 *   already passed.
 * - **A dropped duplicate's key is rewritten to its kept key, then checked**
 *   (`docs/06` §13.4). The map is `findCollectionDuplicates`'s, which is flat:
 *   one rewrite, no chain.
 * - **A marker inside a code fence is left as written** — not checked, not
 *   numbered, not rendered — and counted for check 5.
 * - **`[n]` is first appearance in the text being rendered** (`docs/06`
 *   §10.2), computed from the text by {@link citedKeysOf}, so the numbering a
 *   renderer uses and the order the bibliography is built in come from one
 *   place.
 * - **Every marker left outside a fence resolves, or this module throws.**
 *
 * Pure apart from the logger: no platform call, no preference read.
 */

import type { Logger } from "../../core/logger";
import type { ReportQualityProxies } from "../../model/trend";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/06` §10.1's replacement for an invalid marker, verbatim. */
export const INVALID_CITATION_TEXT = "[citation removed: invalid reference]";

/** A Zotero item key: `docs/06` §10.1's `CITE_RE` body, anchored. */
export const ITEM_KEY_RE = /^[A-Z0-9]{8}$/;

/**
 * Anything shaped like a marker, so a malformed one is found and replaced
 * rather than left in the text: `[[`, then anything on one line but a
 * bracket, then `]]`.
 */
const MARKER_LIKE_RE = /\[\[([^[\]\r\n]*)\]\]/g;

/**
 * What separates the parts of a combined marker (`[[KEY1, KEY2]]`,
 * `[[KEY1; KEY2]]`): a comma or a semicolon, with any whitespace around it.
 * Whitespace alone separates nothing (`docs/06` §10.1, item 292(c)).
 */
const PART_SEPARATOR_RE = /\s*[,;]\s*/;

/** A fence line: three or more backticks or tildes, at any indentation. */
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;

// ---------------------------------------------------------------------------
// 2. The scanner
// ---------------------------------------------------------------------------

/** One marker-shaped match in a text. */
interface MarkerHit {
  /** Offset of the first `[`. */
  readonly start: number;
  /** Offset just past the last `]`. */
  readonly end: number;
  /** The marker as written, brackets included. */
  readonly raw: string;
  /** What is between the brackets. */
  readonly content: string;
  /** Inside a code fence. */
  readonly fenced: boolean;
}

/**
 * The fenced ranges of `markdown`, as `[start, end)` offsets covering the
 * fence lines themselves. A backtick fence's opening line holds no other
 * backtick (CommonMark: ```` ```x``` ```` on one line is inline code, not a
 * fence). A fence closes on a line of the same character, at least as long,
 * with nothing after it but whitespace; an unclosed fence runs to the end of
 * the text.
 */
function fencedRanges(
  markdown: string,
): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = [];
  let offset = 0;
  let open: { readonly start: number; readonly fence: string } | undefined;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length;
    const match = FENCE_OPEN_RE.exec(line);
    const fence = match?.[1];
    const rest = match === null ? "" : line.slice(match[0].length);
    if (open === undefined) {
      if (
        fence !== undefined &&
        !(fence.startsWith("`") && rest.includes("`"))
      ) {
        open = { start: offset, fence };
      }
    } else if (
      fence !== undefined &&
      fence[0] === open.fence[0] &&
      fence.length >= open.fence.length &&
      rest.trim() === ""
    ) {
      ranges.push([open.start, lineEnd]);
      open = undefined;
    }
    offset = lineEnd + 1;
  }
  if (open !== undefined) ranges.push([open.start, markdown.length]);
  return ranges;
}

/** Every marker-shaped match in `markdown`, in text order. */
function scanMarkers(markdown: string): readonly MarkerHit[] {
  const fences = fencedRanges(markdown);
  const hits: MarkerHit[] = [];
  for (const match of markdown.matchAll(MARKER_LIKE_RE)) {
    const start = match.index;
    const raw = match[0];
    hits.push({
      start,
      end: start + raw.length,
      raw,
      content: match[1] ?? "",
      fenced: fences.some(([from, to]) => start >= from && start < to),
    });
  }
  return hits;
}

/** `markdown` with each hit for which `replace` returns a string replaced by it. */
function rewrite(
  markdown: string,
  hits: readonly MarkerHit[],
  replace: (hit: MarkerHit) => string | undefined,
): string {
  let out = "";
  let last = 0;
  for (const hit of hits) {
    const next = replace(hit);
    if (next === undefined) continue;
    out += markdown.slice(last, hit.start) + next;
    last = hit.end;
  }
  return out + markdown.slice(last);
}

// ---------------------------------------------------------------------------
// 3. The validator
// ---------------------------------------------------------------------------

/** Why a marker was replaced. */
export type InvalidMarkerReason =
  /** The content is not an item key (`docs/12` §10 check 2's pattern). */
  | "malformed"
  /** A well-formed key, after the duplicate rewrite, outside the valid set. */
  | "not_in_valid_set";

/** One marker replaced with {@link INVALID_CITATION_TEXT}. */
export interface RemovedMarker {
  readonly reason: InvalidMarkerReason;
  /**
   * The marker as the model wrote it; for a part of a combined marker, that
   * part as a marker of its own (`[[part]]`).
   */
  readonly raw: string;
  /** The key checked, after the duplicate rewrite; absent when malformed. */
  readonly key?: string;
  /** The combined marker, as written, this part was split from. */
  readonly splitFrom?: string;
}

/** What the run knows about which keys a marker may name. */
export interface CitationContext {
  /**
   * The run's valid set: the analysed items' keys (`docs/12` §12's
   * `VALID_ITEM_KEYS`). A retracted, excluded or failed item is not in it.
   */
  readonly validKeys: ReadonlySet<string>;
  /**
   * Dropped duplicate's key → the kept key (`docs/06` §13.4), as
   * `findCollectionDuplicates` in `src/pipeline/summarize/screen.ts` returns it.
   */
  readonly duplicateOf: ReadonlyMap<string, string>;
  /** Each replacement is logged here at `warn`, without report text. */
  readonly logger: Logger;
  /**
   * The text an invalid marker becomes. Defaults to
   * {@link INVALID_CITATION_TEXT}; a report-language label (`P4-T12`'s
   * `reportLabels.ts`) is passed here once one exists.
   */
  readonly replacement?: string;
}

/**
 * The resolution figures Appendix B shows (`docs/06` §9.1, §12.3), counted
 * over the text {@link validateCitations} was given.
 */
export interface CitationFigures extends Pick<
  ReportQualityProxies,
  "brokenCitationCount" | "coverageRatio"
> {
  /**
   * Markers outside code fences, as the model wrote them, each part of a
   * combined marker counted as one: always {@link resolvedCount} plus
   * `brokenCitationCount`.
   */
  readonly markerCount: number;
  /** Combined markers outside fences split into one marker per part. */
  readonly splitMarkerCount: number;
  /** Of {@link markerCount}, the ones kept: in the valid set after the rewrite. */
  readonly resolvedCount: number;
  /** Of {@link resolvedCount}, the ones that resolved through the duplicate rewrite. */
  readonly rewrittenCount: number;
  /** Replaced because the content is not an item key. */
  readonly malformedCount: number;
  /** Replaced because the key is outside the valid set. */
  readonly notInValidSetCount: number;
  /** Markers inside a code fence: `docs/12` §10 check 5, not blocking. */
  readonly fencedMarkerCount: number;
  /** Distinct keys cited after the pass. */
  readonly distinctCitedCount: number;
  /**
   * Markers left outside fences that resolve, over markers left outside
   * fences: `1` after every pass that returns, `undefined` when none is left.
   */
  readonly resolvedShare: number | undefined;
}

export interface CitationValidation {
  /** The text with duplicates rewritten and invalid markers replaced. */
  readonly markdown: string;
  /** Distinct cited keys in order of first appearance: `[n]` is index + 1. */
  readonly citedKeys: readonly string[];
  readonly figures: CitationFigures;
  /** Every replaced marker, in text order. */
  readonly removed: readonly RemovedMarker[];
  /** Every marker inside a code fence, as written, in text order. */
  readonly fenced: readonly string[];
}

/** An outcome of {@link checkMarker}. */
type HitOutcome =
  | {
      readonly kind: "resolved";
      readonly key: string;
      readonly rewritten: boolean;
    }
  | { readonly kind: "removed"; readonly removed: RemovedMarker };

/**
 * Check one marker's content: the item-key pattern, the duplicate rewrite,
 * then the valid set. `raw` is the marker as reported when it is removed.
 */
function checkMarker(
  content: string,
  raw: string,
  validKeys: ReadonlySet<string>,
  duplicateOf: ReadonlyMap<string, string>,
): HitOutcome {
  if (!ITEM_KEY_RE.test(content)) {
    return { kind: "removed", removed: { reason: "malformed", raw } };
  }
  const kept = duplicateOf.get(content);
  const key = kept ?? content;
  if (!validKeys.has(key)) {
    return {
      kind: "removed",
      removed: { reason: "not_in_valid_set", raw, key },
    };
  }
  return {
    kind: "resolved",
    key,
    rewritten: kept !== undefined && kept !== content,
  };
}

/**
 * The parts of a combined marker's content, exactly as written between the
 * separators — never trimmed at either end, re-cased or filled in — or
 * `undefined` when the content holds no separator.
 */
function partsOf(content: string): readonly string[] | undefined {
  const parts = content.split(PART_SEPARATOR_RE);
  return parts.length > 1 ? parts : undefined;
}

/**
 * Check every marker of a generated text against the run's valid set
 * (`P4-T10` steps 1–4).
 *
 * A combined marker (`[[KEY1, KEY2]]`, `[[KEY1; KEY2]]`) is first split into
 * one marker per part, joined by one space, and each part is checked on its
 * own (item 292(c)). Duplicates are rewritten to the kept key; every marker
 * still not in the valid set, and every malformed one, is replaced with the
 * replacement text and logged. Markers inside code fences are left as written
 * and counted.
 *
 * @param markdown - generated text: the report, a section, or a narrative
 * @param context - the valid set, the duplicate map and the logger
 * @returns the rewritten text, the cited keys in first-appearance order, and
 *   the figures
 * @throws Error when a marker left outside a fence does not resolve — which
 *   only a defect here can cause
 */
export function validateCitations(
  markdown: string,
  context: CitationContext,
): CitationValidation {
  const { validKeys, duplicateOf, logger } = context;
  const replacement = context.replacement ?? INVALID_CITATION_TEXT;
  const hits = scanMarkers(markdown);
  const removed: RemovedMarker[] = [];
  const fenced: string[] = [];
  let markerCount = 0;
  let resolvedCount = 0;
  let rewrittenCount = 0;
  let splitMarkerCount = 0;

  /**
   * Check one marker (a whole marker, or one part of a combined one) and
   * return what it becomes, or `undefined` to keep it byte for byte.
   */
  const one = (
    content: string,
    raw: string,
    splitFrom: string | undefined,
  ): string | undefined => {
    markerCount += 1;
    const outcome = checkMarker(content, raw, validKeys, duplicateOf);
    if (outcome.kind === "removed") {
      removed.push(
        splitFrom === undefined
          ? outcome.removed
          : { ...outcome.removed, splitFrom },
      );
      logger.warn("citation marker removed", {
        reason: outcome.removed.reason,
        ...(outcome.removed.key !== undefined
          ? { key: outcome.removed.key }
          : { markerLength: raw.length }),
        ...(splitFrom !== undefined && { split: true }),
      });
      return replacement;
    }
    resolvedCount += 1;
    if (!outcome.rewritten) return undefined;
    rewrittenCount += 1;
    return `[[${outcome.key}]]`;
  };

  const out = rewrite(markdown, hits, (hit) => {
    if (hit.fenced) {
      fenced.push(hit.raw);
      return undefined;
    }
    const parts = partsOf(hit.content);
    if (parts === undefined) return one(hit.content, hit.raw, undefined);
    splitMarkerCount += 1;
    return parts
      .map((part) => {
        const raw = `[[${part}]]`;
        return one(part, raw, hit.raw) ?? raw;
      })
      .join(" ");
  });

  const left = resolutionOf(out, validKeys);
  const resolvedShare =
    left.markers === 0 ? undefined : left.resolving / left.markers;
  if (resolvedShare !== undefined && resolvedShare !== 1) {
    assertAllMarkersResolve(out, validKeys);
  }
  const citedKeys = citedKeysOf(out);
  const malformedCount = removed.filter((r) => r.reason === "malformed").length;
  return {
    markdown: out,
    citedKeys,
    removed,
    fenced,
    figures: {
      markerCount,
      splitMarkerCount,
      resolvedCount,
      rewrittenCount,
      malformedCount,
      notInValidSetCount: removed.length - malformedCount,
      brokenCitationCount: removed.length,
      fencedMarkerCount: fenced.length,
      distinctCitedCount: citedKeys.length,
      coverageRatio:
        validKeys.size === 0 ? 0 : citedKeys.length / validKeys.size,
      resolvedShare,
    },
  };
}

/** Markers outside fences, and how many of them resolve. */
function resolutionOf(
  markdown: string,
  validKeys: ReadonlySet<string>,
): {
  readonly markers: number;
  readonly resolving: number;
  readonly failure?: MarkerHit;
} {
  let markers = 0;
  let resolving = 0;
  let failure: MarkerHit | undefined;
  for (const hit of scanMarkers(markdown)) {
    if (hit.fenced) continue;
    markers += 1;
    if (ITEM_KEY_RE.test(hit.content) && validKeys.has(hit.content)) {
      resolving += 1;
    } else {
      failure ??= hit;
    }
  }
  return { markers, resolving, ...(failure !== undefined && { failure }) };
}

/**
 * Throw unless every marker outside a code fence is a well-formed key in
 * `validKeys`. The final gate before a report is saved: text added after
 * {@link validateCitations} (tables, the bibliography) passes it too.
 *
 * @returns the number of markers outside fences, every one resolving
 * @throws Error naming the first marker that does not resolve, by its key or,
 *   when malformed, by its length — never by the text around it
 */
export function assertAllMarkersResolve(
  markdown: string,
  validKeys: ReadonlySet<string>,
): number {
  const { markers, failure } = resolutionOf(markdown, validKeys);
  if (failure === undefined) return markers;
  throw new Error(
    ITEM_KEY_RE.test(failure.content)
      ? `citation marker does not resolve: ${failure.content}`
      : `citation marker does not resolve: malformed (${failure.raw.length} characters)`,
  );
}

// ---------------------------------------------------------------------------
// 4. Binding
// ---------------------------------------------------------------------------

/**
 * The distinct well-formed keys `markdown` cites outside code fences, in order
 * of first appearance: the order `[n]` is assigned in (`docs/06` §10.2) and
 * the order the numbered bibliography is built in. Validity is not checked.
 */
export function citedKeysOf(markdown: string): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const hit of scanMarkers(markdown)) {
    if (hit.fenced || !ITEM_KEY_RE.test(hit.content) || seen.has(hit.content)) {
      continue;
    }
    seen.add(hit.content);
    keys.push(hit.content);
  }
  return keys;
}

/**
 * Render every marker outside a code fence through `render`, with its `[n]`
 * index (1-based, first appearance in `markdown`). Fenced markers are left as
 * written.
 *
 * @param markdown - text that has passed {@link validateCitations}
 * @param validKeys - the run's valid set
 * @param render - the target's form of one citation: an anchor (`P4-T13`), a
 *   `[n]` (`P4-T15`)
 * @throws Error when a marker does not resolve: nothing is rendered from an
 *   unchecked marker, and nothing is dropped silently
 */
export function bindMarkers(
  markdown: string,
  validKeys: ReadonlySet<string>,
  render: (key: string, index: number) => string,
): string {
  assertAllMarkersResolve(markdown, validKeys);
  const index = new Map(citedKeysOf(markdown).map((key, i) => [key, i + 1]));
  return rewrite(markdown, scanMarkers(markdown), (hit) => {
    if (hit.fenced) return undefined;
    const n = index.get(hit.content);
    if (n === undefined) {
      throw new Error(`citation marker has no index: ${hit.content}`);
    }
    return render(hit.content, n);
  });
}

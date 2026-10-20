/**
 * Tier 1: `docs/06` §3.2's five abstract-normalization steps, in order
 * (`P3-T18` step 1).
 *
 * Pure: no platform call, no preference read. The caller supplies
 * `summary.minAbstractChars` (`acquireSource` reads it through `getPref`).
 *
 * The five steps, each exported so a test can pin it on its own:
 *
 * 1. {@link stripNoiseLabels} — drop a leading `Abstract` / `Summary` heading;
 *    **keep** the structured-abstract labels (`BACKGROUND:`, `METHODS:`,
 *    `RESULTS:`, `CONCLUSIONS:` and any other), which are free supervision
 *    for the summarizer.
 * 2. {@link collapseWhitespace} — NFC, then every whitespace run to one space.
 * 3. {@link stripBoilerplate} — trailing copyright lines and PubMed's trailing
 *    `Keywords:` block, the latter returned separately as `keywords`.
 * 4. {@link stripInlineMarkup} — HTML / JATS inline tags, keeping their text.
 * 5. {@link rejectionReason} — empty, a placeholder, or under the minimum.
 *
 * Step 2 deliberately runs before steps 3 and 4 because §3.2 orders it so.
 * Two consequences are handled inside the later steps rather than by
 * reordering: step 3 recognises a copyright marker straight after a closing
 * tag, and step 4 collapses the whitespace that removing a tag leaves.
 *
 * Whitespace collapsing applies to the **abstract** only. Attachment text is
 * kept exactly as the extractor gave it (`acquire.ts`; corrected D-06-4).
 */

/** What {@link normalizeAbstract} returns. */
export interface NormalizedAbstract {
  /** The normalized abstract, or `null` when step 5 rejected it. */
  readonly text: string | null;
  /** Terms from a trailing `Keywords:` block, in order; `[]` when none. */
  readonly keywords: readonly string[];
  /** Why step 5 rejected it; `null` when it was kept. */
  readonly rejected: AbstractRejection | null;
}

/** Step 5's three reasons. */
export type AbstractRejection = "empty" | "placeholder" | "too_short";

// ---------------------------------------------------------------------------
// Step 1 — noise labels
// ---------------------------------------------------------------------------

/**
 * A leading `Abstract` / `Summary` heading, followed by a colon, a full stop
 * or a line break — the forms scraped and translated abstracts arrive with.
 * Without that punctuation the word is only stripped when it is written in
 * capitals, so `Summary statistics showed…` keeps its first word.
 */
const LEADING_HEADING_CAPS = /^\s*(?:ABSTRACT|SUMMARY)\s+/;
const LEADING_HEADING_PUNCT =
  /^\s*(?:abstract|summary)\s*(?:[:.]\s*|\r?\n\s*)/i;

/** Step 1: drop a leading heading; keep every structured-abstract label. */
export function stripNoiseLabels(raw: string): string {
  if (LEADING_HEADING_PUNCT.test(raw)) {
    return raw.replace(LEADING_HEADING_PUNCT, "");
  }
  if (LEADING_HEADING_CAPS.test(raw)) {
    return raw.replace(LEADING_HEADING_CAPS, "");
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Step 2 — whitespace and NFC
// ---------------------------------------------------------------------------

/**
 * Step 2: NFC (what Zotero's own PDF extraction applies, so hashes stay
 * stable across tiers), then every whitespace run — line breaks included —
 * to a single space, trimmed.
 */
export function collapseWhitespace(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 3 — copyright boilerplate and the trailing Keywords block
// ---------------------------------------------------------------------------

/**
 * The longest tail step 3 will treat as boilerplate. A marker further from the
 * end than this is in the body of the abstract, not trailing it.
 */
export const MAX_BOILERPLATE_TAIL_CHARS = 400;

/** The longest `Keywords:` block step 3 will strip. */
export const MAX_KEYWORDS_TAIL_CHARS = 600;

/**
 * Where a trailing block may start: the start of the text, after a sentence's
 * closing punctuation, or straight after a closing tag (step 4 has not run
 * yet).
 */
const BLOCK_START = String.raw`(?:^|(?<=[.!?)\]>"'”’]\s*))`;

/**
 * Copyright markers. `Copyright` alone is not one — `Copyright law reform…`
 * is a sentence — so it must be followed by `©`, `(c)` or a year.
 */
const COPYRIGHT_MARKER = new RegExp(
  BLOCK_START +
    String.raw`(?:©|\(c\)\s*\d{4}|copyright\s*(?:©|\(c\)|\d{4})|crown copyright|this article is protected by copyright|all rights reserved)`,
  "giu",
);

const KEYWORDS_MARKER = new RegExp(
  BLOCK_START + String.raw`key\s?words?\s*[:：]\s*`,
  "giu",
);

/** The first marker match whose tail is short enough to be trailing. */
function firstTrailingMatch(
  text: string,
  marker: RegExp,
  maxTail: number,
): RegExpExecArray | null {
  marker.lastIndex = 0;
  for (const match of text.matchAll(marker)) {
    if (text.length - match.index <= maxTail) {
      return match as RegExpExecArray;
    }
  }
  return null;
}

/** Split a `Keywords:` block into terms: on `;` when present, else on `,`. */
function splitKeywords(block: string): string[] {
  const cleaned = stripInlineMarkup(block).replace(/[.;,\s]+$/u, "");
  if (cleaned === "") return [];
  const separator = cleaned.includes(";") ? ";" : ",";
  return cleaned
    .split(separator)
    .map((term) => term.trim())
    .filter((term) => term !== "");
}

/**
 * Step 3: strip trailing copyright boilerplate and a trailing `Keywords:`
 * block, in whichever order they trail, until neither is left.
 */
export function stripBoilerplate(text: string): {
  readonly text: string;
  readonly keywords: readonly string[];
} {
  let current = text;
  let keywords: string[] = [];
  for (;;) {
    const keywordMatch = firstTrailingMatch(
      current,
      KEYWORDS_MARKER,
      MAX_KEYWORDS_TAIL_CHARS,
    );
    const copyrightMatch = firstTrailingMatch(
      current,
      COPYRIGHT_MARKER,
      MAX_BOILERPLATE_TAIL_CHARS,
    );
    // Strip whichever block starts later first, so a copyright line after the
    // keywords does not end up inside a keyword.
    const keywordStart = keywordMatch?.index ?? -1;
    const copyrightStart = copyrightMatch?.index ?? -1;
    if (keywordMatch !== null && keywordStart > copyrightStart) {
      const block = current.slice(keywordStart + keywordMatch[0].length);
      keywords = [...splitKeywords(block), ...keywords];
      current = current.slice(0, keywordStart).trimEnd();
    } else if (copyrightMatch !== null) {
      current = current.slice(0, copyrightStart).trimEnd();
    } else {
      return { text: current, keywords };
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4 — inline markup
// ---------------------------------------------------------------------------

/**
 * The tags step 4 removes: an explicit list of HTML inline and block tags,
 * plus anything in the `jats:` / `mml:` namespaces. A general `<[^>]+>` would
 * eat text such as `a <b and c> d` or `p<0.05 and q>1`, which abstracts do
 * contain. For the same reason an attribute must carry a value
 * (`<span class="x">`): `<b and c>` is not taken for a `<b>` tag.
 */
const TAG_ATTRIBUTES = String.raw`(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))*\s*\/?>`;

const INLINE_TAG = new RegExp(
  String.raw`<\/?(?:(?:jats|mml):[A-Za-z][\w.-]*|i|b|u|em|strong|sup|sub|sc|span|italic|bold|underline)` +
    TAG_ATTRIBUTES,
  "giu",
);

/** Tags that separate words, so they become a space rather than nothing. */
const BLOCK_TAG = new RegExp(
  String.raw`<\/?(?:p|br|div|h[1-6]|li|ul|ol)` + TAG_ATTRIBUTES,
  "giu",
);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu,
    (whole, dec?: string, hex?: string, name?: string) => {
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      return NAMED_ENTITIES[(name ?? "").toLowerCase()] ?? whole;
    },
  );
}

/**
 * Step 4: remove HTML / JATS inline markup, keep the text it wrapped, decode
 * the common entities, and collapse the whitespace that removal leaves.
 */
export function stripInlineMarkup(text: string): string {
  const stripped = text.replace(BLOCK_TAG, " ").replace(INLINE_TAG, "");
  return collapseWhitespace(decodeEntities(stripped));
}

// ---------------------------------------------------------------------------
// Step 5 — rejection
// ---------------------------------------------------------------------------

/**
 * `docs/06` §3.2 step 5's known placeholders, as whole-text matches with an
 * optional full stop: `No abstract available`, `Abstract not available`,
 * `[No abstract]`, `N/A`.
 */
export const ABSTRACT_PLACEHOLDERS: readonly RegExp[] = [
  /^no abstract(?: available)?\.?$/iu,
  /^abstract not available\.?$/iu,
  /^\[\s*no abstract(?: available)?\s*\]\.?$/iu,
  /^n\/?a\.?$/iu,
];

/** Step 5: why `text` is unusable, or `null` when it is usable. */
export function rejectionReason(
  text: string,
  minChars: number,
): AbstractRejection | null {
  if (text === "") return "empty";
  if (ABSTRACT_PLACEHOLDERS.some((pattern) => pattern.test(text))) {
    return "placeholder";
  }
  if (text.length < minChars) return "too_short";
  return null;
}

// ---------------------------------------------------------------------------
// The five steps together
// ---------------------------------------------------------------------------

/**
 * Run `docs/06` §3.2's five steps in order.
 *
 * @param raw - `abstractNote` as Zotero stores it
 * @param minChars - `summary.minAbstractChars`
 */
export function normalizeAbstract(
  raw: string,
  minChars: number,
): NormalizedAbstract {
  const labelled = stripNoiseLabels(raw);
  const collapsed = collapseWhitespace(labelled);
  const { text: unboilered, keywords } = stripBoilerplate(collapsed);
  const plain = stripInlineMarkup(unboilered);
  const rejected = rejectionReason(plain, minChars);
  return { text: rejected === null ? plain : null, keywords, rejected };
}

/**
 * The `extra` field contract (`docs/07-architecture-and-data-model.md` §6.3).
 *
 * **Scope.** `P1-T12`. `extra` is the one Zotero field this plugin shares with
 * the user, with Better BibTeX and with every other plugin, so §6.3 makes the
 * write path *surgical* rather than generative:
 *
 * - plugin-owned lines are `rh-<key>: <value>`, one per line;
 * - reads parse the whole field into `(key, value, lineIndex)` triples;
 * - writes replace **only** the plugin's own lines and preserve everything
 *   else byte-for-byte, including the ordering of foreign lines;
 * - non-namespaced lines the ecosystem already understands (`PMID:`,
 *   `PMCID:`, `arXiv:`, `Citation Key:`) are written **only** when the item
 *   type has no dedicated field *and* only when no such line already exists;
 * - total growth is capped at ~500 characters, past which the payload becomes
 *   a child note and `extra` keeps only `rh-work-key`.
 *
 * **Purity.** Nothing here touches `Zotero.*`. The cap decision, the
 * preservation and the line algebra are all string work, which is what makes
 * them unit-testable in plain Node (`docs/07` §2.3, enforced by
 * `eslint.config.js`'s `no-restricted-globals`). Creating the child note is the
 * caller's job, because that *is* a platform write; this module only reports
 * which entries were deferred to it.
 *
 * **The `research_helper-` spellings are gone** (conflict `C1`,
 * `plan/02-phase-1-pubmed.md` §4, closed 2026-09-09). `rh-` is the only
 * prefix this plugin owns, so a `research_helper-key:` line met in a real
 * `extra` field is a **foreign** line and is preserved byte-for-byte like any
 * other — never rewritten, never migrated.
 */

// ---------------------------------------------------------------------------
// 1. The contract's constants
// ---------------------------------------------------------------------------

/**
 * The prefix that marks a line as this plugin's own (`docs/07` §6.3).
 *
 * A line whose key starts with this is ours to replace. Everything else is
 * somebody else's and is preserved.
 */
export const RH_PREFIX = "rh-";

/** `rh-work-key` — the join key between Zotero items and plugin tables (§6.2). */
export const RH_WORK_KEY = "rh-work-key";

/** `rh-sources` — which sources returned the work (§6.2, "debug aid; togglable"). */
export const RH_SOURCES_KEY = "rh-sources";

/**
 * Maximum number of characters the plugin may **add** to `extra` (§6.3's
 * "~500 characters").
 *
 * Measured as the growth of the whole field, not the length of the added
 * lines: a write that replaces an existing `rh-` line with a shorter value has
 * negative growth and can never trip the cap.
 */
export const EXTRA_GROWTH_CAP_CHARS = 500;

// ---------------------------------------------------------------------------
// 2. Reading
// ---------------------------------------------------------------------------

/**
 * One parsed line of `extra`: §6.3's `(key, value, lineIndex)` triple, plus the
 * raw text that preservation is defined against.
 */
export interface ExtraLine {
  /** 0-based position in the original field. */
  readonly lineIndex: number;
  /**
   * The line exactly as it appeared, including any trailing `\r` from a CRLF
   * field. Re-joining `raw` values with `"\n"` reproduces the original bytes,
   * which is what "preserve every foreign line byte-for-byte" means here.
   */
  readonly raw: string;
  /** The `Key` of a `Key: value` line, trimmed. `undefined` when the line has no colon. */
  readonly key: string | undefined;
  /** The `value` of a `Key: value` line, trimmed. Empty string when there is no key. */
  readonly value: string;
}

/** One line the plugin wants written: a key and its value, unrendered. */
export interface ExtraEntry {
  /** The full key, `rh-`-prefixed for plugin lines, bare for ecosystem lines. */
  readonly key: string;
  readonly value: string;
}

/**
 * `Key: value`, where the key is everything up to the first colon.
 *
 * Deliberately permissive on the key — Zotero's own
 * `extractExtraFields()` accepts hyphens, spaces and underscores, and Better
 * BibTeX writes `Citation Key:` — and deliberately strict about the colon
 * being the *first* one, so a value containing `https://…` still parses with
 * the URL intact.
 *
 * The value is `[\s\S]*` and **not** `.*`, which was a measured bug: `\r` is a
 * JavaScript line terminator, so `.` does not match it, and on a CRLF `extra`
 * field a `.*$` value group failed to match at all — every line of such a field
 * parsed as key-less, which would have made the plugin append a duplicate
 * `rh-work-key` on every write. Lines are already split on `\n`, so the class
 * can only ever pick up a trailing `\r`, which {@link parseExtra} trims off the
 * value while leaving it in `raw`.
 */
const KEY_VALUE = /^([^:]+):[ \t]*([\s\S]*)$/;

/**
 * Parse `extra` into §6.3's triples.
 *
 * Every line is returned, including blank ones and ones with no key, because
 * the write path has to be able to put the field back together unchanged.
 *
 * @param extra - the raw `extra` field, or nothing
 * @returns one {@link ExtraLine} per line, in field order
 */
export function parseExtra(
  extra: string | null | undefined,
): readonly ExtraLine[] {
  if (extra === null || extra === undefined || extra === "") return [];
  return extra.split("\n").map((raw, lineIndex) => {
    const match = KEY_VALUE.exec(raw);
    if (match === null) {
      return { lineIndex, raw, key: undefined, value: "" };
    }
    return {
      lineIndex,
      raw,
      key: (match[1] ?? "").trim(),
      // trimEnd() and not trim(): KEY_VALUE has already eaten the leading
      // space, and this is what removes a CRLF field's trailing "\r" from the
      // value without disturbing `raw`.
      value: (match[2] ?? "").trimEnd(),
    };
  });
}

/** Does this line's key mark it as the plugin's own (`rh-`-prefixed)? */
export function isPluginLine(line: ExtraLine): boolean {
  return line.key !== undefined && isPluginKey(line.key);
}

/** Is `key` in the plugin's namespace? Compared case-insensitively. */
export function isPluginKey(key: string): boolean {
  return key.toLowerCase().startsWith(RH_PREFIX);
}

/**
 * The first line carrying `key`, compared case-insensitively.
 *
 * Case-insensitive because the ecosystem is: Zotero's own extractor matches
 * `Key:` without regard to case, so treating `PMID:` and `pmid:` as different
 * lines is how the plugin ends up adding a duplicate of a line that is
 * already there.
 *
 * @param lines - the parsed field
 * @param key - the key to look for
 * @returns the first matching line, or `undefined`
 */
export function findExtraLine(
  lines: readonly ExtraLine[],
  key: string,
): ExtraLine | undefined {
  const wanted = key.toLowerCase();
  return lines.find((line) => line.key?.toLowerCase() === wanted);
}

/** Reads `rh-work-key` back out of an `extra` field. `undefined` when absent. */
export function readWorkKey(
  extra: string | null | undefined,
): string | undefined {
  const line = findExtraLine(parseExtra(extra), RH_WORK_KEY);
  return line === undefined || line.value === "" ? undefined : line.value;
}

// ---------------------------------------------------------------------------
// 3. Writing
// ---------------------------------------------------------------------------

/** What one write wants to put into `extra`. */
export interface ExtraUpdate {
  /**
   * Plugin-owned lines. Keys **must** be `rh-`-prefixed; an existing line with
   * the same key is replaced in place, keeping its position, and a new one is
   * appended in the order given.
   *
   * The first entry is privileged: §6.3's overflow rule keeps `rh-work-key`
   * and drops the rest, so {@link RH_WORK_KEY} belongs at index 0.
   */
  readonly pluginLines: readonly ExtraEntry[];
  /**
   * Non-namespaced ecosystem lines (`PMID:`, `arXiv:`, `Citations:` …). Each
   * is written **only** when no line with that key already exists — §6.3's
   * rule, and §6.2's "never overwrite a user-authored `extra` line".
   *
   * The caller is responsible for the other half of §6.3's condition: an
   * entry belongs here only when the item type has no native field for it.
   */
  readonly standardLines: readonly ExtraEntry[];
}

/** The outcome of one write. */
export interface ExtraUpdateResult {
  /** The new `extra` field. Hand this straight to `fromJSON()`. */
  readonly extra: string;
  /** `extra.length` minus the original's. Negative when a value shrank. */
  readonly growthChars: number;
  /** Did the un-capped write exceed {@link EXTRA_GROWTH_CAP_CHARS}? */
  readonly overflowed: boolean;
  /**
   * Entries the cap pushed out of `extra`. Empty unless `overflowed`.
   *
   * §6.3: when the cap trips, the payload "writes a child note instead" and
   * `extra` keeps only `rh-work-key`. Creating that note is a platform write
   * and therefore the caller's, not this module's.
   */
  readonly deferred: readonly ExtraEntry[];
}

/**
 * Apply one write to `extra`, preserving every foreign line.
 *
 * The algorithm is the whole point of the module, so it is spelled out:
 *
 * 1. Parse the existing field into raw lines. Foreign lines are never touched
 *    again — they are copied out verbatim in their original order.
 * 2. For each plugin line, replace the existing line with that key **in
 *    place** (position preserved, so a diff of the field stays small), or
 *    append.
 * 3. For each standard line, append it only if no line with that key exists.
 * 4. Measure growth. If it exceeds {@link EXTRA_GROWTH_CAP_CHARS}, redo
 *    steps 2–3 with only the *first* plugin line — `rh-work-key` — and report
 *    everything else as {@link ExtraUpdateResult.deferred}.
 *
 * @param existing - the item's current `extra`, or nothing for a new item
 * @param update - the lines to write
 * @returns the new field, its growth, and anything the cap deferred
 */
export function applyExtraUpdate(
  existing: string | null | undefined,
  update: ExtraUpdate,
): ExtraUpdateResult {
  const before = existing ?? "";
  const full = render(before, update.pluginLines, update.standardLines);
  const growth = full.length - before.length;
  if (growth <= EXTRA_GROWTH_CAP_CHARS) {
    return {
      extra: full,
      growthChars: growth,
      overflowed: false,
      deferred: [],
    };
  }

  // Over the cap: `extra` keeps only rh-work-key; everything else becomes the
  // caller's child note (§6.3).
  const kept = update.pluginLines.slice(0, 1);
  const capped = render(before, kept, []);
  return {
    extra: capped,
    growthChars: capped.length - before.length,
    overflowed: true,
    deferred: [...update.pluginLines.slice(1), ...update.standardLines],
  };
}

/**
 * Steps 1–3 of {@link applyExtraUpdate}, with no cap applied.
 *
 * Kept separate because the cap needs to run the same rendering twice — once
 * to find out how big the write would be, once to produce the reduced form —
 * and two copies of the preservation logic is exactly how a foreign line gets
 * lost on the second path.
 */
function render(
  existing: string,
  pluginLines: readonly ExtraEntry[],
  standardLines: readonly ExtraEntry[],
): string {
  const parsed = parseExtra(existing);
  // `raw` for untouched lines, a re-rendered string for replaced ones.
  const out: string[] = parsed.map((line) => line.raw);
  const appended: string[] = [];

  for (const entry of pluginLines) {
    const rendered = renderLine(entry);
    const hit = findExtraLine(parsed, entry.key);
    if (hit === undefined) {
      appended.push(rendered);
    } else {
      out[hit.lineIndex] = rendered;
    }
  }

  for (const entry of standardLines) {
    // Only when absent — both from the original field and from what this write
    // has already appended, so two entries with the same key cannot duplicate.
    if (findExtraLine(parsed, entry.key) !== undefined) continue;
    if (
      appended.some(
        (line) =>
          KEY_VALUE.exec(line)?.[1]?.trim().toLowerCase() ===
          entry.key.toLowerCase(),
      )
    ) {
      continue;
    }
    appended.push(renderLine(entry));
  }

  if (appended.length === 0) return out.join("\n");
  // A field that ends in a blank line would otherwise gain a second one.
  const body = out.join("\n");
  const separator = body === "" ? "" : body.endsWith("\n") ? "" : "\n";
  return `${body}${separator}${appended.join("\n")}`;
}

/** `Key: value`, or a bare `Key:` when the value is empty. */
function renderLine(entry: ExtraEntry): string {
  return entry.value === "" ? `${entry.key}:` : `${entry.key}: ${entry.value}`;
}

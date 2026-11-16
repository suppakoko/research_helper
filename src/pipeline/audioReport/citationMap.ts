/**
 * The citation map an audio script call is sent — `plan/09` `P6-T07` step 2,
 * `docs/12` §13's `{{CITATION_MAP}}`: one line per item the report's sections
 * cite as `[[itemKey]]`, mapping the key to a spoken attribution.
 *
 * **Caller.** `writeScript` in `./script.ts`. The Zotero read is a port,
 * {@link CitationSource}, so this module never touches Zotero; its Zotero half
 * is built in `src/bootstrap/registerPipelines.ts` by `P6-T16` (a
 * `createZoteroAudioLibrary` port). Constructed nowhere: functions only.
 *
 * **What leaves the machine** (`docs/09` §3 row 5, clarified 2026-11-16;
 * `plan/09` §0.2 item 21): the item key, the first author's surname and the
 * year, nothing else. No title, no venue and no other author is read.
 *
 * ## The line format (DECIDED 2026-11-16, coordinator, under `plan/00` §6
 * item 313, in `P6-T07` step 2; the reading of a missing field DECIDED
 * 2026-11-17, coordinator, under item 313)
 *
 * - more than one author: `KEY → "Surname and colleagues, 2024"`;
 * - one author: `KEY → "Surname, 2024"`;
 * - no year: the same without `, 2024` (a listener gains nothing from
 *   "no date");
 * - no surname, or an item the port could not read: **no line**, and the key
 *   is logged at `info` (by key, never by title). The model then drops the
 *   marker, which `docs/12` §13 rule 2 already allows.
 *
 * `docs/12` §13's variable table writes the attribution as "First-author
 * surname et al., Year"; the card's spoken form is used instead, because
 * `et al.` is itself a leak `validateScript` rejects (`docs/04` §8.5) and
 * the prompt's own example is "Kim and colleagues, 2024".
 *
 * A surname is Zotero data, so it is made inert before it is sent: NFC, every
 * control character and line break replaced by a space, the characters a
 * script may not contain (`"`, `→`, `[`, `]`, `|`, `*`, `#`, `` ` ``) removed,
 * runs of spaces collapsed, and the result cut to
 * {@link SURNAME_MAX_LENGTH} code points. A surname empty after that maps to
 * nothing.
 */

import type { Logger } from "../../core/logger";

/** One cited item as the port reads it: three fields, never a title. */
export interface CitationAuthorRecord {
  readonly itemKey: string;
  /** The first creator's last name (or single-field name); absent when none. */
  readonly firstAuthorSurname: string | undefined;
  /** How many creators the item has; 0 when none. */
  readonly authorCount: number;
  /** The item's year; absent when Zotero has none. */
  readonly year: number | undefined;
}

/**
 * The Zotero read behind the map. An item that cannot be read (deleted, in
 * another library, unreadable) is simply absent from the result; a failure of
 * the read as a whole rejects.
 */
export interface CitationSource {
  readCitations(
    libraryID: number,
    itemKeys: readonly string[],
  ): Promise<ReadonlyMap<string, CitationAuthorRecord>>;
}

/** What {@link citationMapFor} returns. */
export interface CitationMap {
  /** `{{CITATION_MAP}}`: the lines joined with `\n`; `""` when none. */
  readonly text: string;
  /** How many lines `text` holds. */
  readonly lines: number;
  /** The cited keys that got no line, in citation order. */
  readonly unmapped: readonly string[];
}

/** The longest surname sent, in code points. */
export const SURNAME_MAX_LENGTH = 80;

/** What separates a key from its attribution, as `docs/12` §13 prints it. */
export const CITATION_MAP_ARROW = "→";

// Every C0 and C1 control character, the line and paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
const FORBIDDEN = /["→[\]|*#`]/gu;

/**
 * A surname made inert for the prompt, or `undefined` when nothing is left.
 *
 * @param raw - the creator's last name as Zotero holds it
 */
export function inertSurname(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw
    .normalize("NFC")
    .replace(CONTROL, " ")
    .replace(FORBIDDEN, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return undefined;
  const points = Array.from(cleaned);
  return points.length <= SURNAME_MAX_LENGTH
    ? cleaned
    : points.slice(0, SURNAME_MAX_LENGTH).join("").trimEnd();
}

/**
 * The spoken attribution for one item, or `undefined` when it gets no line.
 *
 * @param record - the port's read of the item
 */
export function spokenAttribution(
  record: CitationAuthorRecord,
): string | undefined {
  const surname = inertSurname(record.firstAuthorSurname);
  if (surname === undefined) return undefined;
  const who = record.authorCount > 1 ? `${surname} and colleagues` : surname;
  const year =
    record.year !== undefined && Number.isInteger(record.year)
      ? `, ${String(record.year)}`
      : "";
  return `${who}${year}`;
}

/**
 * `{{CITATION_MAP}}` for the keys a report's sections cite.
 *
 * @param libraryID - the report's library
 * @param itemKeys - the cited keys, in order of first citation; repeats are dropped
 * @param source - the Zotero read
 * @param logger - receives one `info` line per key that gets no line
 * @returns the map's text, its line count and the keys left unmapped
 */
export async function citationMapFor(
  libraryID: number,
  itemKeys: readonly string[],
  source: CitationSource,
  logger?: Logger,
): Promise<CitationMap> {
  const keys = [...new Set(itemKeys)];
  if (keys.length === 0) return { text: "", lines: 0, unmapped: [] };
  const records = await source.readCitations(libraryID, keys);
  const lines: string[] = [];
  const unmapped: string[] = [];
  for (const key of keys) {
    const record = records.get(key);
    const spoken =
      record === undefined || record.itemKey !== key
        ? undefined
        : spokenAttribution(record);
    if (spoken === undefined) {
      unmapped.push(key);
      logger?.info("audio script: a cited item has no spoken attribution", {
        itemKey: key,
        read: record !== undefined,
      });
      continue;
    }
    lines.push(`${key} ${CITATION_MAP_ARROW} "${spoken}"`);
  }
  return { text: lines.join("\n"), lines: lines.length, unmapped };
}

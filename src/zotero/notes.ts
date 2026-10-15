/**
 * The standalone provenance note FR-8 requires, and the file writer FR-8's JSON
 * export needs (`P1-T17`, `docs/07` §2.2).
 *
 * ## Why the note lives here and the record does not
 *
 * `docs/07` §2.3 makes `src/zotero/` "the only directory permitted to reference
 * `Zotero.*`", and `src/core/` may name no platform API at all. So the split is
 * forced rather than stylistic:
 *
 * - `src/core/provenance.ts` owns the record, its redaction gate and the JSON
 *   serialisation. It is the authority.
 * - this file owns the two things that touch the platform: rendering the record
 *   as Zotero note HTML and saving it, and satisfying
 *   `ProvenanceFileWriter` over `Zotero.File.putContentsAsync`.
 *
 * ## The note is HTML, and a lossy projection
 *
 * `docs/01` §5.7: note content is **HTML**, stored and sanitised by Zotero's
 * note editor stack, and the conservative subset to keep to is `h1`–`h6`, `p`,
 * `ul`/`ol`/`li`, `strong`, `em`, `a`, `blockquote`, `pre`, `code`, `table`.
 * Markdown pasted into `setNote()` "will render as literal text".
 *
 * **`table` is in that list and `tr`, `td` and `th` are not**, so a table
 * cannot be built out of the listed elements alone. `renderProvenanceNoteHtml`
 * therefore uses nested `ul`/`li` for the per-source enumeration rather than
 * guessing at which table children survive §5.7's unverified sanitisation
 * whitelist.
 *
 * The note is a projection and is deliberately **not** complete by
 * construction: {@link renderProvenanceNoteHtml} names the fields it renders,
 * so a field added to §5.3 reaches the JSON export automatically and the note
 * only when someone adds it here. FR-8's own enumeration — the eight per-source
 * quantities and the title — is what the unit test pins, because that is the
 * list the requirement fixes.
 *
 * ## The title is Zotero's first line, not a field
 *
 * A Zotero note has no title column: `Zotero.Item.prototype.getNoteTitle()`
 * derives the displayed title from the note's first line. FR-8's
 * `Research Helper — search provenance <ISO timestamp>` is therefore produced
 * by making {@link provenanceNoteTitle}'s text the first element of the HTML.
 */

import {
  exportJson,
  type MergeDecision,
  type ProvenanceFileWriter,
  type SearchProvenance,
  type SourceProvenance,
} from "../core/provenance";
import { AUTOMATIC_TAG_TYPE, RESEARCH_HELPER_TAG } from "./itemMapper";

// ---------------------------------------------------------------------------
// 1. The title — FR-8's literal format
// ---------------------------------------------------------------------------

/**
 * Everything in FR-8's note title before the timestamp, including the trailing
 * space and the em dash.
 *
 * FR-8 fixes the string; it is **not** localized, because the requirement spells
 * it out and `P1-T17`'s acceptance criterion greps for it. The em dash is U+2014,
 * as FR-8 writes it.
 */
export const PROVENANCE_NOTE_TITLE_PREFIX =
  "Research Helper — search provenance ";

/**
 * FR-8's note title for a run.
 *
 * **`finishedAt`, not `startedAt`.** FR-8 says only "`<ISO timestamp>`" and
 * §5.3 declares both fields, so the choice is the implementation's. §5.3 says
 * the record is "Written once, when the run finishes or is cancelled", which
 * makes `finishedAt` the moment the note describes; it is also the later of the
 * two, so titles sort in the order the notes appear.
 *
 * @param provenance - the run's record
 * @returns `Research Helper — search provenance <finishedAt>`
 */
export function provenanceNoteTitle(provenance: SearchProvenance): string {
  return `${PROVENANCE_NOTE_TITLE_PREFIX}${provenance.finishedAt}`;
}

// ---------------------------------------------------------------------------
// 2. Rendering — `docs/01` §5.7's subset, nothing wider
// ---------------------------------------------------------------------------

/**
 * The five characters that must not reach note HTML unescaped.
 *
 * `&` is replaced first, otherwise the ampersands this function itself emits
 * would be escaped a second time. `'` and `"` are included because a rendered
 * value lands inside element text today but may land inside an attribute
 * tomorrow, and a renderer that escapes only what its current call sites need
 * is a renderer that breaks the next time one moves.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `<code>` around escaped text; the empty string renders as an em dash. */
function code(text: string): string {
  return text === "" ? "—" : `<code>${escapeHtml(text)}</code>`;
}

/** One `<li>` of `<strong>label</strong>: value`, where `value` is pre-rendered. */
function item(label: string, value: string): string {
  return `<li><strong>${escapeHtml(label)}</strong>: ${value}</li>`;
}

/**
 * One `sourceExtras` value as JSON inside `<code>`.
 *
 * `undefined` is a real value here, not an absent key — `PubmedSourceExtras`
 * declares `count: number | undefined` — and `JSON.stringify(undefined)`
 * returns `undefined` rather than a string, which `lib.es5.d.ts` types as
 * `string`. Narrowing first keeps that lie out of the output.
 */
function renderExtra(value: unknown): string {
  return value === undefined ? "—" : code(JSON.stringify(value));
}

/**
 * One source's entry, as FR-8's eight quantities plus the three §5.3 fields
 * that are not quantities.
 *
 * Every one of FR-8's "required even when they are zero" counts is rendered
 * unconditionally, including a `0`. `rawHitCount` is the one quantity FR-8
 * requires that §5.3 allows to be absent — the source may report none — so it
 * renders as an em dash rather than as a misleading `0`.
 */
function renderSource(source: SourceProvenance): string {
  const rows = [
    item("Endpoint base URL", code(source.endpointBaseUrl)),
    item("Transmitted query", code(source.transmittedQuery)),
    item("Transmitted URL", code(source.transmittedUrl)),
    item("Date filter applied", escapeHtml(source.dateFilterApplied)),
    item("Requested limit", String(source.requestedLimit)),
    item(
      "Raw hit count",
      source.rawHitCount === undefined ? "—" : String(source.rawHitCount),
    ),
    item("Records retrieved", String(source.recordsRetrieved)),
    item("Records deduplicated away", String(source.recordsDeduplicatedAway)),
    item("Records imported", String(source.recordsImported)),
  ];
  if (source.error !== undefined) {
    rows.push(
      item(
        "Error",
        `${code(source.error.code)} ${escapeHtml(source.error.detail)}`,
      ),
    );
  }
  if (source.sourceExtras !== undefined) {
    const extras = Object.entries(source.sourceExtras).map(([key, value]) =>
      item(key, renderExtra(value)),
    );
    if (extras.length > 0) {
      rows.push(
        `<li><strong>Source extras</strong><ul>${extras.join("")}</ul></li>`,
      );
    }
  }
  return `<h3>${escapeHtml(source.sourceId)}</h3><ul>${rows.join("")}</ul>`;
}

/**
 * One {@link MergeDecision} — FR-50 scenario 2's "rule fired, similarity
 * score" — as the merged work's key with its tier, confidence and evidence
 * beneath it (`P2-T34`). The evidence is shown as the JSON object it is, the
 * way `sourceExtras` values are, so no field of it is renamed or dropped.
 */
function renderMergeDecision(decision: MergeDecision): string {
  const rows = [
    item("Tier", code(decision.tier)),
    item("Confidence", String(decision.confidence)),
    item("Evidence", code(JSON.stringify(decision.evidence))),
  ];
  return `<li>${code(decision.workKey)}<ul>${rows.join("")}</ul></li>`;
}

/**
 * `docs/07` §5.3's `mergeDecisions` as a list, or "none" when nothing merged —
 * a heading over an empty list would read as a rendering failure.
 */
function renderMergeDecisions(provenance: SearchProvenance): string {
  const decisions = provenance.mergeDecisions;
  return decisions.length === 0
    ? "<p>none</p>"
    : `<ul>${decisions.map(renderMergeDecision).join("")}</ul>`;
}

/** `dateFilter` as prose. `"none"` is FR-3's "All years". */
function renderDateFilter(provenance: SearchProvenance): string {
  const filter = provenance.dateFilter;
  return filter === "none"
    ? "none (all years)"
    : `${escapeHtml(filter.fromIso)} … ${escapeHtml(filter.toIso)}`;
}

/**
 * The record as Zotero note HTML — `docs/01` §5.7's subset, no Markdown.
 *
 * One line, no newlines between elements: Zotero's note editor normalises
 * whitespace and `getNoteTitle()` reads the first line, so a leading newline
 * would make the derived title empty.
 *
 * @param provenance - the run's record, already through
 *   `redactSearchProvenance` by the time it gets here
 * @returns note HTML whose first element is the FR-8 title
 */
export function renderProvenanceNoteHtml(provenance: SearchProvenance): string {
  const collection =
    provenance.targetCollectionKey === undefined
      ? "—"
      : code(provenance.targetCollectionKey);
  return [
    `<h1>${escapeHtml(provenanceNoteTitle(provenance))}</h1>`,
    "<ul>",
    item("Query", code(provenance.userQuery)),
    item("Run id", code(provenance.runId)),
    item("Plugin version", code(provenance.pluginVersion)),
    item("Zotero version", code(provenance.zoteroVersion)),
    item("Started at", code(provenance.startedAt)),
    item("Finished at", code(provenance.finishedAt)),
    item("Date filter", renderDateFilter(provenance)),
    item("Target library", String(provenance.targetLibraryId)),
    item("Target collection", collection),
    "</ul>",
    "<h2>Totals</h2>",
    "<ul>",
    item("Retrieved", String(provenance.totals.retrieved)),
    item("Deduplicated away", String(provenance.totals.deduplicatedAway)),
    item("Imported", String(provenance.totals.imported)),
    "</ul>",
    "<h2>Sources</h2>",
    provenance.perSource.map(renderSource).join(""),
    "<h2>Merge decisions</h2>",
    renderMergeDecisions(provenance),
    `<p><em>Schema version ${String(provenance.schemaVersion)}. `,
    "This note is a projection of the run's machine-readable record; ",
    "use Export provenance as JSON for the authoritative copy.</em></p>",
  ].join("");
}

// ---------------------------------------------------------------------------
// 3. Writing the note
// ---------------------------------------------------------------------------

/**
 * The slice of `Zotero.Item` {@link writeProvenanceNote} uses.
 *
 * Narrowed to five members so the writer can be exercised in Node against a
 * double, which is the difference between the note writer shipping with a test
 * and shipping without one: `docs/13` §2.1's shared Zotero fake declares
 * `setField`, `getField`, `setCreators`, `addTag` and `saveTx`, and has
 * **neither `setNote` nor `setCollections`**, and extending it is outside
 * `P1-T17`'s `Files`.
 *
 * The member types are `zotero-types@4.1.3`'s: `setNote(content: string):
 * boolean`, `setCollections(collectionIDsOrKeys: Array<string | number>): void`,
 * `addTag(name: string, type?: number): boolean`, `saveTx(): Promise<boolean |
 * number>`, and `key: string` / `libraryID: number` on `Zotero.DataObject`.
 */
export interface ProvenanceNoteItem {
  libraryID: number;
  readonly key: string;
  setNote(content: string): boolean;
  setCollections(collectionIDsOrKeys: Array<string | number>): void;
  addTag(name: string, type?: number): boolean;
  saveTx(): Promise<boolean | number>;
}

/** What {@link writeProvenanceNote} needs from the composition root. */
export interface ProvenanceNoteDeps {
  /**
   * A fresh, unsaved standalone note item. Defaults to
   * `new Zotero.Item("note")`, which is `docs/01` §5.7's first line.
   */
  readonly createNote?: () => ProvenanceNoteItem;
}

/**
 * Write the run's provenance note into the target collection.
 *
 * `docs/01` §5.7's standalone-note sequence, in its order: `libraryID`,
 * `setNote()`, `setCollections()`, then one `saveTx()`. `saveTx()` and not
 * `save()` because nothing here opens a transaction — §5.8 and §12 gotcha 12's
 * rule is the reverse, that `saveTx()` must not be called *inside* one.
 *
 * **A standalone note, never a child.** FR-8 says "a standalone note in that
 * collection", so no `parentItemID` is set. NFR-20 permits exactly this:
 * "creating child/standalone notes owned by the plugin".
 *
 * **Collection membership by key.** `targetCollectionKey` is a key and
 * `setCollections` takes "Collection keys or ids" (`zotero-types@4.1.3`;
 * `docs/01` §5.6 records the same for `Zotero.Attachments`' `collections`
 * option), so no key-to-id lookup is needed. A run with no target collection
 * writes the note into the library root rather than skipping it.
 *
 * The record is **not** redacted here: `renderProvenanceNoteHtml` renders what
 * it is given, and `src/core/provenance.ts`'s gate is where NFR-16 is enforced,
 * once, for both outputs. Callers hand over the output of
 * `redactSearchProvenance`.
 *
 * @param provenance - the run's record
 * @param deps - the note factory; omit it outside a test
 * @returns the saved note's key
 */
export async function writeProvenanceNote(
  provenance: SearchProvenance,
  deps: ProvenanceNoteDeps = {},
): Promise<string> {
  const note = (deps.createNote ?? defaultCreateNote)();
  note.libraryID = provenance.targetLibraryId;
  note.setNote(renderProvenanceNoteHtml(provenance));
  if (provenance.targetCollectionKey !== undefined) {
    note.setCollections([provenance.targetCollectionKey]);
  }
  // Automatic (orange), like every other tag this plugin writes, so the user's
  // own tags stay visually distinct and the whole run is bulk-removable
  // (`src/zotero/itemMapper.ts`, `docs/01` §5.2, `docs/02` §10.3).
  note.addTag(RESEARCH_HELPER_TAG, AUTOMATIC_TAG_TYPE);
  await note.saveTx();
  return note.key;
}

/** `docs/01` §5.7's `new Zotero.Item('note')`. */
function defaultCreateNote(): ProvenanceNoteItem {
  return new Zotero.Item("note");
}

// ---------------------------------------------------------------------------
// 4. The JSON export's platform half
// ---------------------------------------------------------------------------

/**
 * `src/core/provenance.ts`'s file-writing port, over
 * `Zotero.File.putContentsAsync(path, data, charset?)`.
 *
 * `docs/01` §5.6's 2026-09-08 verification note: `Zotero.File.getContentsAsync`
 * / `putContentsAsync` "remain the simpler choice for text". The charset
 * argument is left at Zotero's default, which is UTF-8.
 */
export function provenanceFileWriter(): ProvenanceFileWriter {
  return {
    writeTextFile: (path, text) => Zotero.File.putContentsAsync(path, text),
  };
}

/**
 * FR-8's "Export provenance as JSON", wired to the platform.
 *
 * A one-line convenience over `src/core/provenance.ts`'s `exportJson` so a UI
 * action has a single call to make. The serialisation, the redaction and the
 * pretty-printing all stay in `core/`.
 *
 * @param path - the user-chosen destination, absolute
 * @param provenance - the run's record
 */
export async function exportProvenanceJson(
  path: string,
  provenance: SearchProvenance,
): Promise<void> {
  await exportJson(path, provenance, provenanceFileWriter());
}

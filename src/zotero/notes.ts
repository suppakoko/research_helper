/**
 * The standalone provenance note FR-8 requires, and the file writer FR-8's JSON
 * export needs (`P1-T17`, `docs/07` §2.2). Since `P4-T15`, also the file
 * writer of the trend report's Markdown export ({@link reportFileWriter}).
 * Since `P3-T29`, also FR-19–FR-21's per-paper summary note and FR-20's
 * "Remove generated notes from collection" (section 6 below; `docs/07` §6.4's
 * note of 2026-10-29). Callers: the summarize pipeline's Zotero port,
 * `createZoteroSummarizeLibrary` in `src/bootstrap/registerPipelines.ts`, and
 * the removal command's host in `src/bootstrap/registerUI.ts`.
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
import type {
  PaperSummary,
  StoredSummary,
  SummaryInputScope,
} from "../model/summary";
import { getIndexedPageCounts } from "./fulltext";
import {
  AUTOMATIC_TAG_TYPE,
  RESEARCH_HELPER_TAG,
  fromZoteroItem,
} from "./itemMapper";
import { readRetraction } from "./zoteroApi";

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

// ---------------------------------------------------------------------------
// 5. The trend report's Markdown export, platform half (`P4-T15`)
// ---------------------------------------------------------------------------

/**
 * The file-writing port of the trend report's "Export as Markdown"
 * (`docs/06` §14.3, `docs/08` §6.3), the same shape as
 * `src/core/provenance.ts`'s `ProvenanceFileWriter`.
 *
 * Declared here rather than in `src/pipeline/trendReport/exportMarkdown.ts`,
 * which takes it, because `zotero/` may not import `pipeline/` (`docs/07`
 * §2.3); `exportMarkdown.ts` re-exports it so `ui/` never names this file.
 */
export interface ReportFileWriter {
  /** Write `text` to `path` as UTF-8, overwriting. */
  writeTextFile(path: string, text: string): Promise<unknown>;
}

/**
 * {@link ReportFileWriter} over `Zotero.File.putContentsAsync(path, data)`,
 * exactly as {@link provenanceFileWriter} writes FR-8's JSON: the charset is
 * left at Zotero's default, UTF-8, so a Korean report is written as it reads.
 *
 * **Callers.** Nothing calls it yet. The report window host in
 * `src/bootstrap/registerUI.ts` binds it into the report view model
 * (`src/ui/viewModels/reportViewModel.ts`), whose Export action hands it to
 * `exportReportMarkdown` (`P4-T20`) — the way `provenanceFiles` reaches
 * `searchImportViewModel.ts`. The path is the window's, never stored or logged
 * (`docs/09` §2.2).
 */
export function reportFileWriter(): ReportFileWriter {
  return {
    writeTextFile: (path, text) => Zotero.File.putContentsAsync(path, text),
  };
}

// ---------------------------------------------------------------------------
// 6. The per-paper summary note and its removal (`P3-T29`; FR-19–FR-21)
// ---------------------------------------------------------------------------

/** FR-20's tag on every summary note (`docs/07` §6.4; owner, item 297). */
export const AI_SUMMARY_TAG = "research_helper/ai-summary";

/**
 * The namespace FR-20's removal command matches: a note carrying a tag that
 * starts with this is a generated note. FR-8's provenance note carries the
 * bare {@link RESEARCH_HELPER_TAG}, which is **not** in it.
 */
export const GENERATED_TAG_NAMESPACE = "research_helper/";

/** FR-20's "provider/model tag": `research_helper/model:<provider>/<model>`. */
export const MODEL_TAG_PREFIX = `${GENERATED_TAG_NAMESPACE}model:`;

/** The name FR-21's header gives a Europe PMC text, which has no attachment. */
export const EUROPE_PMC_SOURCE_NAME = "Europe PMC";

/**
 * FR-20's provider/model tag for a row.
 *
 * @param providerId - e.g. `openrouter`
 * @param modelId - the pinned model id
 */
export function modelTag(providerId: string, modelId: string): string {
  return `${MODEL_TAG_PREFIX}${providerId}/${modelId}`;
}

/** Whether a tag is in FR-20's `research_helper/` namespace. */
export function isGeneratedTag(tag: string): boolean {
  return tag.startsWith(GENERATED_TAG_NAMESPACE);
}

/**
 * FR-20's first line: provider, model ID and UTC timestamp. Plain text; the
 * renderer escapes it.
 *
 * @param stored - the row the note projects
 */
export function summaryDisclaimer(
  stored: Pick<StoredSummary, "providerId" | "modelId" | "generatedAtEpochMs">,
): string {
  return (
    "Machine-generated summary (Research Helper). " +
    `Provider: ${stored.providerId} · Model: ${stored.modelId} · ` +
    `Generated ${new Date(stored.generatedAtEpochMs).toISOString()}. ` +
    "Not reviewed by a person; check it against the paper."
  );
}

/**
 * FR-21's header line, verbatim: `Source: abstract only`, or `Source: full
 * text (<N> chars extracted from <attachment name>)`.
 *
 * @param scope - the row's `inputScope`
 * @param sourceName - the attachment's title, or {@link EUROPE_PMC_SOURCE_NAME}
 */
export function summarySourceLine(
  scope: SummaryInputScope,
  sourceName: string | undefined,
): string {
  switch (scope.kind) {
    case "abstract+fulltext":
      return (
        `Source: full text (${String(scope.charsSent)} chars extracted from ` +
        `${sourceName ?? "an attachment"})`
      );
    case "abstract+notes":
      return `Source: abstract and ${String(scope.noteCount)} notes`;
    case "metadata-only":
      return "Source: metadata only";
    case "abstract":
      return "Source: abstract only";
  }
}

/** A heading and one paragraph, or nothing when the value is empty. */
function section(heading: string, value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return text === ""
    ? ""
    : `<h2>${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p>`;
}

/** A heading and a list, or nothing when the list is empty. */
function listSection(heading: string, items: readonly string[]): string {
  const kept = items.map((entry) => entry.trim()).filter((e) => e !== "");
  return kept.length === 0
    ? ""
    : `<h2>${escapeHtml(heading)}</h2><ul>${kept
        .map((entry) => `<li>${escapeHtml(entry)}</li>`)
        .join("")}</ul>`;
}

/** `label_with_underscores` as words. */
function words(label: string): string {
  return label.replace(/_/g, " ");
}

/** The non-empty parts, joined. */
function joined(
  parts: readonly (string | null | undefined)[],
  by: string,
): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(by);
}

/** The structured payload, `docs/01` §5.7's subset only. */
function renderPaperSummary(content: PaperSummary): string {
  const design = joined(
    [
      content.studyDesign.label === null
        ? ""
        : words(content.studyDesign.label),
      content.studyDesign.detail,
    ],
    " — ",
  );
  const size = content.population.size;
  const population = joined(
    [
      content.population.kind === null ? "" : words(content.population.kind),
      content.population.description,
      size === null || size.trim() === "" ? "" : `n = ${size}`,
    ],
    " — ",
  );
  const findings = content.keyFindings.map((finding) => {
    const support = finding.verbatimSupport?.trim() ?? "";
    const quote =
      support === "" ? "" : `<br/><em>“${escapeHtml(support)}”</em>`;
    return (
      `<li>${escapeHtml(finding.statement)} ` +
      `(${escapeHtml(words(finding.direction))}; evidence ` +
      `${escapeHtml(finding.evidenceStrength)})${quote}</li>`
    );
  });
  const effects = content.effectSizes.map((effect) => {
    const extras = joined(
      [
        effect.comparison,
        effect.pValue === null || effect.pValue === undefined
          ? ""
          : `p = ${effect.pValue}`,
        effect.unit,
      ],
      "; ",
    );
    return `${effect.metric}: ${effect.value}${extras === "" ? "" : ` (${extras})`}`;
  });
  return [
    section("Research question", content.researchQuestion),
    section("Study design", design),
    section("Population", population),
    listSection("Methods", content.methods),
    findings.length === 0
      ? ""
      : `<h2>Key findings</h2><ul>${findings.join("")}</ul>`,
    listSection("Effect sizes", effects),
    listSection("Limitations", content.limitations),
    section("Novelty", content.novelty),
    section("Keywords", content.keywords.join(", ")),
    `<p><em>Model-reported confidence: ${escapeHtml(content.confidence)}.</em></p>`,
  ].join("");
}

/**
 * FR-19–FR-21's note, ordered as `docs/07` §6.4's note of 2026-10-29 says:
 * the FR-20 disclaimer first (the note's first line, so its title), the
 * marker comment as information only (item 296(b)), FR-21's source line, then
 * the structured fields. English and not localized, like FR-8's provenance
 * note: FR-20 and FR-21 fix the header text.
 *
 * @param stored - the row, as the store returned it (already gated)
 * @param sourceName - the attachment title, for a full-text row
 */
export function renderSummaryNoteHtml(
  stored: StoredSummary,
  sourceName?: string,
): string {
  const generatedAt = new Date(stored.generatedAtEpochMs).toISOString();
  // An HTML comment may not hold "--"; a model id is not ours to trust.
  const commentSafe = (value: string): string =>
    value.replace(/-{2,}/g, "-").replace(/>/g, "");
  return [
    `<p><strong>${escapeHtml(summaryDisclaimer(stored))}</strong></p>`,
    `<!-- rh:summary v=1 promptVersion=${commentSafe(stored.promptVersion)} ` +
      `model=${commentSafe(stored.modelId)} generatedAt=${generatedAt} -->`,
    `<p>${escapeHtml(summarySourceLine(stored.inputScope, sourceName))}</p>`,
    renderPaperSummary(stored.content),
  ].join("");
}

/**
 * One file holding every summary of a run, for a library the user cannot
 * write to (`P3-T29` step 8): the same projection as the notes, one section
 * per paper, as a standalone HTML document.
 *
 * @param title - the document's title (the collection's name)
 * @param entries - each paper's title and its note HTML
 */
export function renderSummaryExportHtml(
  title: string,
  entries: readonly { readonly title: string; readonly noteHtml: string }[],
): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(title)}</title></head><body>`,
    `<h1>${escapeHtml(title)}</h1>`,
    ...entries.map(
      (entry) =>
        `<section><h1>${escapeHtml(entry.title)}</h1>${entry.noteHtml}</section>`,
    ),
    "</body></html>",
  ].join("\n");
}

/** The slice of `Zotero.Item` {@link writeSummaryNote} uses. */
export interface SummaryNoteItem {
  libraryID: number;
  parentKey: string | false;
  readonly key: string;
  setNote(content: string): boolean;
  addTag(name: string, type?: number): boolean;
  saveTx(options?: { notifierData?: unknown }): Promise<boolean | number>;
}

/** What {@link writeSummaryNote} writes. */
export interface SummaryNoteRequest {
  readonly libraryID: number;
  /** The regular item the summary is of. */
  readonly parentItemKey: string;
  readonly stored: StoredSummary;
  /** The attachment title, for FR-21's full-text line. */
  readonly sourceName?: string | undefined;
}

/**
 * Write FR-19's child note: `libraryID`, then `parentKey`, then the HTML,
 * both tags, and one `saveTx` with Zotero's own sync debounce (`docs/06`
 * §14.2). The caller has checked that the library is editable and that the
 * item has no summary note yet; this writes, nothing more.
 *
 * @param request - the item, the row and the source name
 * @param deps - the note factory; omit it outside a test
 * @returns the new note's key
 */
export async function writeSummaryNote(
  request: SummaryNoteRequest,
  deps: { readonly createNote?: () => SummaryNoteItem } = {},
): Promise<string> {
  const note = (deps.createNote ?? defaultCreateSummaryNote)();
  note.libraryID = request.libraryID;
  note.parentKey = request.parentItemKey;
  note.setNote(renderSummaryNoteHtml(request.stored, request.sourceName));
  note.addTag(AI_SUMMARY_TAG, AUTOMATIC_TAG_TYPE);
  note.addTag(
    modelTag(request.stored.providerId, request.stored.modelId),
    AUTOMATIC_TAG_TYPE,
  );
  await note.saveTx({
    notifierData: { autoSyncDelay: Zotero.Notes.AUTO_SYNC_DELAY },
  });
  return note.key;
}

function defaultCreateSummaryNote(): SummaryNoteItem {
  return new Zotero.Item("note") as unknown as SummaryNoteItem;
}

/** Whether `item` carries `tag`. */
function hasTag(item: Zotero.Item, tag: string): boolean {
  return item.getTags().some((entry) => entry.tag === tag);
}

/** Whether `item` carries a tag in FR-20's namespace. */
function hasGeneratedTag(item: Zotero.Item): boolean {
  return item.getTags().some((entry) => isGeneratedTag(entry.tag));
}

/**
 * Whether a value from a `Zotero.*` getter is an object (not `false`).
 * Never `instanceof Object`: Zotero's objects come from another global, so
 * that test is false for every one of them (measured in Zotero 10.0.3 by
 * `removeGeneratedNotes.spec.ts`, 2026-10-29).
 */
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** `Zotero.Items.get`, narrowed to "an item or nothing". */
function itemById(id: number): Zotero.Item | undefined {
  const item: unknown = Zotero.Items.get(id);
  return isObject(item) ? (item as Zotero.Item) : undefined;
}

/**
 * The item's summary note: the stored key when it still names a note under
 * this item that carries {@link AI_SUMMARY_TAG} and is not in the trash, else
 * the first such child note (`plan/00` §6 item 296(b): by key and tag, never
 * by the marker comment).
 *
 * @param libraryID - the item's library
 * @param parentItemKey - the regular item's key
 * @param storedNoteKey - `StoredSummary.zoteroNoteKey`, when one is known
 * @returns the note's key, or `undefined`
 */
export function findSummaryNote(
  libraryID: number,
  parentItemKey: string,
  storedNoteKey?: string,
): string | undefined {
  if (storedNoteKey !== undefined && storedNoteKey !== "") {
    const stored = Zotero.Items.getByLibraryAndKey(libraryID, storedNoteKey);
    if (
      stored !== false &&
      stored.isNote() &&
      !stored.deleted &&
      stored.parentKey === parentItemKey &&
      hasTag(stored, AI_SUMMARY_TAG)
    ) {
      return stored.key;
    }
  }
  const parent = Zotero.Items.getByLibraryAndKey(libraryID, parentItemKey);
  if (parent === false || !parent.isRegularItem()) return undefined;
  for (const id of parent.getNotes(false)) {
    const note = itemById(id);
    if (note !== undefined && !note.deleted && hasTag(note, AI_SUMMARY_TAG)) {
      return note.key;
    }
  }
  return undefined;
}

/** What {@link saveSummaryNoteOnce} did. */
export type SummaryNoteSaveOutcome =
  | { readonly kind: "written"; readonly noteKey: string }
  | { readonly kind: "exists"; readonly noteKey: string }
  | { readonly kind: "read-only" };

/** What {@link saveSummaryNoteOnce} reads and writes through. */
export interface SaveSummaryNoteDeps {
  /** Store the row again; it carries the new note's key. */
  readonly put: (stored: StoredSummary) => Promise<unknown>;
  /** {@link findSummaryNote} outside a test. */
  readonly find?: typeof findSummaryNote;
  /** {@link writeSummaryNote} outside a test. */
  readonly write?: (request: SummaryNoteRequest) => Promise<string>;
  /** {@link isLibraryEditable} outside a test. */
  readonly editable?: (libraryID: number) => boolean;
}

/**
 * The item pane's "Save as child note" (`docs/08` §3.2; owner, `plan/00` §6
 * item 303(b)). When the item already has a summary note — by the row's
 * stored `zoteroNoteKey`, then by the tag (item 296(b), {@link findSummaryNote})
 * — nothing is written and the caller tells the user. Otherwise, in an
 * editable library, the note is written with {@link writeSummaryNote} and the
 * row is stored again with its key (`StoredSummary.zoteroNoteKey`).
 *
 * @param request - the item, its stored summary and the source name
 * @param deps - the store; the Zotero calls are injectable for a test
 * @returns what was done
 */
export async function saveSummaryNoteOnce(
  request: SummaryNoteRequest,
  deps: SaveSummaryNoteDeps,
): Promise<SummaryNoteSaveOutcome> {
  const existing = (deps.find ?? findSummaryNote)(
    request.libraryID,
    request.parentItemKey,
    request.stored.zoteroNoteKey,
  );
  if (existing !== undefined) return { kind: "exists", noteKey: existing };
  if (!(deps.editable ?? isLibraryEditable)(request.libraryID)) {
    return { kind: "read-only" };
  }
  const noteKey = await (deps.write ?? writeSummaryNote)(request);
  await deps.put({ ...request.stored, zoteroNoteKey: noteKey });
  return { kind: "written", noteKey };
}

/** `Zotero.Libraries.get(id).editable` (`P3-T29` step 8); `false` when unknown. */
export function isLibraryEditable(libraryID: number): boolean {
  const library: unknown = Zotero.Libraries.get(libraryID);
  return (
    isObject(library) && (library as { editable?: unknown }).editable === true
  );
}

/**
 * An attachment's title, for FR-21's "<attachment name>"; `undefined` when
 * the key names nothing.
 */
export function attachmentTitle(
  libraryID: number,
  attachmentKey: string,
): string | undefined {
  const item = Zotero.Items.getByLibraryAndKey(libraryID, attachmentKey);
  if (item === false) return undefined;
  const title: unknown = item.getField("title");
  return typeof title === "string" && title !== "" ? title : undefined;
}

/** What {@link findGeneratedNotes} found. */
export interface GeneratedNotes {
  readonly libraryID: number;
  readonly collectionName: string;
  /** The notes FR-20's command would remove, by item id. */
  readonly noteIDs: readonly number[];
}

/**
 * FR-20's removal set for one collection (`docs/07` §6.4's note of
 * 2026-10-29, item 5): its standalone notes and its regular items' child
 * notes that carry a tag in {@link GENERATED_TAG_NAMESPACE}, none in the
 * trash. Reads only.
 *
 * @param collectionID - the right-clicked collection
 * @throws Error when the id names no collection
 */
export function findGeneratedNotes(collectionID: number): GeneratedNotes {
  const found: unknown = Zotero.Collections.get(collectionID);
  if (!isObject(found)) {
    throw new Error(
      `[research-helper] no collection with id ${String(collectionID)}`,
    );
  }
  const collection = found as Zotero.Collection;
  const ids = new Set<number>();
  const consider = (note: Zotero.Item | undefined): void => {
    if (
      note !== undefined &&
      note.isNote() &&
      !note.deleted &&
      hasGeneratedTag(note)
    ) {
      ids.add(note.id);
    }
  };
  for (const item of collection.getChildItems(false, false)) {
    if (item.isNote()) consider(item);
    else if (item.isRegularItem()) {
      for (const id of item.getNotes(false)) consider(itemById(id));
    }
  }
  return {
    libraryID: collection.libraryID,
    collectionName: collection.name,
    noteIDs: [...ids],
  };
}

/**
 * Move the confirmed notes to Zotero's trash, from which the user can restore
 * them; nothing is erased. Every id is checked again first: only a note that
 * still carries a generated tag is moved, so a note re-tagged between the
 * count and the click stays.
 *
 * @param noteIDs - from {@link findGeneratedNotes}, after the user confirmed
 * @returns how many notes were moved
 */
export async function trashGeneratedNotes(
  noteIDs: readonly number[],
): Promise<number> {
  const confirmed = noteIDs.filter((id) => {
    const note = itemById(id);
    return (
      note !== undefined &&
      note.isNote() &&
      !note.deleted &&
      hasGeneratedTag(note)
    );
  });
  if (confirmed.length === 0) return 0;
  await Zotero.Items.trashTx(confirmed);
  return confirmed.length;
}

/** What {@link removeGeneratedNotes} did. */
export interface RemoveGeneratedNotesResult {
  readonly collectionName: string;
  /** The count the user was asked about; `0` when nothing was found. */
  readonly found: number;
  readonly confirmed: boolean;
  readonly moved: number;
}

/**
 * FR-20's command: find, ask with the exact count, move to the trash. Asks
 * nothing and moves nothing when the count is 0; moves nothing unless the
 * answer is an explicit yes.
 *
 * @param collectionID - the right-clicked collection
 * @param confirm - the question, with the count and the collection's name
 */
export async function removeGeneratedNotes(
  collectionID: number,
  confirm: (
    count: number,
    collectionName: string,
  ) => boolean | Promise<boolean>,
): Promise<RemoveGeneratedNotesResult> {
  const found = findGeneratedNotes(collectionID);
  const count = found.noteIDs.length;
  if (count === 0) {
    return {
      collectionName: found.collectionName,
      found: 0,
      confirmed: false,
      moved: 0,
    };
  }
  const confirmed = (await confirm(count, found.collectionName)) === true;
  const moved = confirmed ? await trashGeneratedNotes(found.noteIDs) : 0;
  return {
    collectionName: found.collectionName,
    found: count,
    confirmed,
    moved,
  };
}

// ---------------------------------------------------------------------------
// 7. Reading a collection for a summary run (`P3-T29`)
// ---------------------------------------------------------------------------

/**
 * One regular item, as plain values: what the summarize pipeline's Zotero
 * port (`createZoteroSummarizeLibrary`, `src/bootstrap/registerPipelines.ts`)
 * maps into its own item. `item` is the live object, for acquisition only.
 */
export interface SummaryRunItemSnapshot {
  readonly item: Zotero.Item;
  readonly itemID: number;
  readonly key: string;
  readonly libraryID: number;
  readonly itemType: string;
  /** `docs/07` §6.6: `fromZoteroItem(item).workKey`. */
  readonly workKey: string;
  readonly title: string;
  /** `Last, First`, or the single-field name; in item order. */
  readonly creators: readonly string[];
  readonly firstAuthorFamily: string | undefined;
  readonly date: string;
  readonly publicationTitle: string;
  readonly doi: string;
  readonly extra: string;
  readonly abstractLength: number;
  readonly hasAttachment: boolean;
  readonly dateAdded: string;
  readonly dateModified: string;
  /** The user's tags; this plugin's own (`research_helper…`) left out. */
  readonly tags: readonly string[];
  readonly retracted: boolean;
  readonly retractionReasons: readonly string[];
}

/** A collection, before a summary run: what the window shows on open. */
export interface SummaryRunCollectionHeader {
  readonly libraryID: number;
  readonly collectionKey: string;
  readonly name: string;
  readonly regularItems: number;
  readonly editable: boolean;
}

/**
 * The collection's name, its regular-item count (not in the trash) and
 * whether its library is editable; `undefined` when the id names nothing.
 *
 * @param collectionID - the right-clicked collection
 */
export function describeCollectionForSummary(
  collectionID: number,
): SummaryRunCollectionHeader | undefined {
  const found: unknown = Zotero.Collections.get(collectionID);
  if (!isObject(found)) return undefined;
  const collection = found as Zotero.Collection;
  const regularItems = collection
    .getChildItems(false, false)
    .filter((item) => item.isRegularItem() && !item.deleted).length;
  return {
    libraryID: collection.libraryID,
    collectionKey: collection.key,
    name: collection.name,
    regularItems,
    editable: isLibraryEditable(collection.libraryID),
  };
}

/**
 * The collections one item belongs to, as `{ libraryID, collectionKey }`
 * (owner, `plan/00` §6 item 305(a)): the item pane's one-item run takes the
 * strictest privacy mode of these and the global setting (`docs/09` §3.5's
 * note of 2026-10-29). `Zotero.Item.getCollections()`: the collections not in
 * the trash. Reads only.
 *
 * @param libraryID - the item's library
 * @param itemKey - the item's key
 * @throws Error when the key names no item, so the run stops before
 *   anything is sent rather than running under a looser mode
 */
export function collectionsOfItem(
  libraryID: number,
  itemKey: string,
): { readonly libraryID: number; readonly collectionKey: string }[] {
  const found: unknown = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
  if (!isObject(found)) {
    throw new Error(
      `[research-helper] no item ${itemKey} in library ${String(libraryID)}`,
    );
  }
  const refs: { readonly libraryID: number; readonly collectionKey: string }[] =
    [];
  for (const id of (found as Zotero.Item).getCollections()) {
    const collection: unknown = Zotero.Collections.get(id);
    if (!isObject(collection)) {
      throw new Error(
        `[research-helper] item ${itemKey} names collection ${String(id)}, ` +
          "which cannot be read",
      );
    }
    const { libraryID: lib, key } = collection as Zotero.Collection;
    refs.push({ libraryID: lib, collectionKey: key });
  }
  return refs;
}

/** What {@link readCollectionForSummary} returns. */
export interface SummaryRunCollection {
  readonly name: string;
  readonly editable: boolean;
  readonly items: readonly SummaryRunItemSnapshot[];
}

function fieldOf(item: Zotero.Item, field: string): string {
  try {
    const value: unknown = item.getField(field);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * The collection's regular items, not in the trash (`docs/07` §12.3's
 * `LoadingItems`; its note of 2026-10-29, item 2). Reads only.
 *
 * @param libraryID - the collection's library
 * @param collectionKey - the collection's key
 * @throws Error when the key names no collection
 */
export async function readCollectionForSummary(
  libraryID: number,
  collectionKey: string,
): Promise<SummaryRunCollection> {
  const found: unknown = Zotero.Collections.getByLibraryAndKey(
    libraryID,
    collectionKey,
  );
  if (!isObject(found)) {
    throw new Error("[research-helper] the collection to summarize is gone");
  }
  const collection = found as Zotero.Collection;
  const items: SummaryRunItemSnapshot[] = [];
  for (const item of collection.getChildItems(false, false)) {
    if (!item.isRegularItem() || item.deleted) continue;
    items.push(await snapshotForSummary(item));
  }
  return {
    name: collection.name,
    editable: isLibraryEditable(libraryID),
    items,
  };
}

/**
 * The listed regular items, not in the trash, in the order given (`docs/07`
 * §12.3's note of 2026-10-29 on the optional item list; owner, `plan/00` §6
 * item 303(a)): the item pane's one-item run. A key that names nothing, a
 * note, an attachment or an item in the trash is left out. Reads only.
 *
 * @param libraryID - the items' library
 * @param itemKeys - the items' keys
 */
export async function readItemsForSummary(
  libraryID: number,
  itemKeys: readonly string[],
): Promise<SummaryRunCollection> {
  const items: SummaryRunItemSnapshot[] = [];
  const seen = new Set<string>();
  for (const key of itemKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const found: unknown = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (!isObject(found)) continue;
    const item = found as Zotero.Item;
    if (!item.isRegularItem() || item.deleted) continue;
    items.push(await snapshotForSummary(item));
  }
  return { name: "", editable: isLibraryEditable(libraryID), items };
}

/** One regular item as {@link SummaryRunItemSnapshot}'s plain values. */
async function snapshotForSummary(
  item: Zotero.Item,
): Promise<SummaryRunItemSnapshot> {
  const creators = item.getCreatorsJSON().map((creator) => {
    const c = creator as {
      firstName?: string;
      lastName?: string;
      name?: string;
    };
    if (typeof c.name === "string" && c.name !== "") return c.name;
    return [c.lastName ?? "", c.firstName ?? ""]
      .filter((part) => part !== "")
      .join(", ");
  });
  const first = item.getCreatorsJSON()[0] as
    { lastName?: string; name?: string } | undefined;
  const retraction = await readRetraction(item);
  return {
    item,
    itemID: item.id,
    key: item.key,
    libraryID: item.libraryID,
    itemType: item.itemType,
    workKey: fromZoteroItem(item).workKey,
    title: fieldOf(item, "title"),
    creators,
    firstAuthorFamily: first?.lastName ?? first?.name,
    date: fieldOf(item, "date"),
    publicationTitle: fieldOf(item, "publicationTitle"),
    doi: fieldOf(item, "DOI"),
    extra: fieldOf(item, "extra"),
    abstractLength: fieldOf(item, "abstractNote").length,
    hasAttachment: item.getAttachments(false).length > 0,
    dateAdded: item.dateAdded,
    dateModified: item.dateModified,
    tags: item
      .getTags()
      .map((entry) => entry.tag)
      .filter((tag) => !tag.startsWith(RESEARCH_HELPER_TAG)),
    retracted: retraction.retracted,
    retractionReasons: retraction.reasons,
  };
}

/**
 * D-06-3's page counts of an attachment, for a page-capped text (`P3-T25`
 * finding 1): `Zotero.Fulltext.getPages`' indexed and total pages, or
 * `undefined` when either is unknown.
 */
export async function attachmentPageCounts(
  libraryID: number,
  attachmentKey: string,
): Promise<{ indexedPages: number; totalPages: number } | undefined> {
  const attachment = Zotero.Items.getByLibraryAndKey(libraryID, attachmentKey);
  if (attachment === false) return undefined;
  const counts = await getIndexedPageCounts(attachment.id);
  if (
    counts === null ||
    counts.indexedPages === null ||
    counts.total === null
  ) {
    return undefined;
  }
  return { indexedPages: counts.indexedPages, totalPages: counts.total };
}

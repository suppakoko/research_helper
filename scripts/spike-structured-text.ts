/**
 * P0-T18 (spike V-8b) — throwaway probe of `Zotero.PDFWorker`'s structured
 * document text, run from Zotero's Tools → Developer → Run JavaScript window
 * against the dev library.
 *
 * `docs/11` §4.2 V-8b asks one binary question — does
 * `getStructuredDocumentText` expose font/layout geometry? — and one practical
 * one — on a two-column PDF, is column order recoverable? This probe answers
 * both for every PDF attachment in the dev-library collection named
 * {@link COLLECTION_NAME} (the corpus indexed in `test/fixtures/pdf/README.md`),
 * and records `getFullText` on the same attachments for comparison.
 *
 * ## Producing the paste-ready block
 *
 * From the repository root:
 *
 * ```sh
 * npx tsx scripts/spike-structured-text.ts | Set-Clipboard   # PowerShell
 * npx tsx scripts/spike-structured-text.ts > probe.js        # to inspect
 * ```
 *
 * As in `scripts/spike-network.ts`, the Node half (below the
 * `NODE-ONLY BELOW THIS LINE` marker) bundles the half above it with esbuild
 * (IIFE, global `RHSpikeStructuredText`, target firefox140, ASCII-only) and
 * prints it followed by the one `return await …main(…)` line Run JavaScript's
 * async mode needs. Nothing is written to disk.
 *
 * ## What the API actually is on Zotero 10.0.2 (read from `omni.ja`)
 *
 * - `chrome/content/zotero/xpcom/pdfWorker/manager.js`:
 *   `getStructuredDocumentText(itemID, { isPriority, password, onProgress } = {})`
 *   takes the **attachment** item ID (it throws unless the item is a PDF, EPUB
 *   or snapshot attachment), returns `null` only when the file is missing, and
 *   otherwise resolves to **`{ buf: ArrayBuffer }`** — not a document object.
 *   `buf` is an "SDTPack": magic `\x89SDT\r\n\x1a\n`, pack version 1, schema
 *   1.2.0, a JSON metadata section, a JSON catalog and raw-DEFLATE chunks of
 *   JSON content blocks.
 * - `resource/document-worker/structured-document-text.js` is the reader.
 *   `openStructuredDocumentTextPack(bytes, { inflate })` needs a synchronous
 *   raw-inflate; Zotero's own `chrome/content/zotero/xpcom/sdt.js` passes
 *   `require('pako').inflateRaw`, and this probe does the same. `materialize()`
 *   yields `{ schemaVersion, metadata, catalog, content }`.
 * - Calling `PDFWorker.getStructuredDocumentText` directly **writes nothing**.
 *   The higher-level `Zotero.SDT.getPack()` / `getReader()` would, because it
 *   caches the pack as `.zotero-sdt-cache` in the attachment's storage
 *   directory, so this probe does not call it.
 * - `getFullText(itemID, maxPages, isPriority, password)` is unchanged from
 *   `docs/06` §3.3.5 and resolves to `{ text, extractedPages, totalPages }`.
 *
 * ## The column-order measure
 *
 * A page counts as two-column when at least two body rectangles sit wholly in
 * each half of it and full-measure rectangles are rare. Reading order is then
 * checked **within a vertical band**, not across the whole page: a page can
 * stack independent flows — a publisher's two-column front matter above a
 * two-column reference list — and pairing every right-hand rectangle with
 * every left-hand one calls that correct layout an error (measured: 111 such
 * pseudo-violations on the PNAS file's last page, 0 once banded). A band is a
 * maximal vertical interval covered by the page's body rectangles; inside one,
 * every left-column rectangle must come before every right-column one.
 *
 * Both APIs are measured on the same pairs, because Phase 3 may use either
 * (`docs/06` §3.3.5): `content[]` index order for the structure, and character
 * offset within the page's slice of the `\f`-delimited `getFullText` string
 * for the flat text. The page-wide count the 2026-09-15 run reported is kept
 * alongside the banded one so the two runs stay comparable.
 *
 * ## What it does not do
 *
 * It never calls `Zotero.Fulltext.indexItems`, `getItemContent`,
 * `setItemContent` or `semanticSplitter`, never reads `zotero.sqlite`, never
 * OCRs, and does not detect IMRaD sections (card `P0-T18`, Do NOT). It reads
 * the dev library only; it creates, modifies and deletes nothing.
 *
 * ## Output
 *
 * One plain-text report returned as the evaluation result, also written line
 * by line to `Zotero.debug` with the prefix `[research_helper P0-T18]`.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The dev-library collection holding the corpus (test/fixtures/pdf/README.md). */
const COLLECTION_NAME = "P0-T18 PDF corpus";

/** Characters of an example value quoted in the shape dump. */
const EXAMPLE_CHARS = 60;

/** Distinct example values quoted per key path. */
const EXAMPLES_PER_PATH = 2;

/**
 * A rect narrower than this fraction of the page width is a column candidate
 * (a full-measure body line on a single-column page is ~60–85 %).
 */
const COLUMN_MAX_WIDTH = 0.48;

/** Top-level block types that carry body text; figures and tables do not. */
const BODY_TYPES: readonly string[] = [
  "paragraph",
  "heading",
  "list",
  "listitem",
];

/**
 * Probe lengths, longest first, for locating a block in the flat `getFullText`
 * page. A block whose text is shorter than the last of them is counted as
 * *too short* rather than as missing: on a two-column page a short heading
 * ("MS COCO" on the arXiv file's page 10) occurs twice, so a shorter probe
 * would measure the wrong occurrence rather than nothing.
 */
const FLAT_PROBE_LENGTHS = [60, 40, 25, 15] as const;

/** `docs/06` §3.3.4, verified names for `getIndexedState` results. */
const INDEX_STATES = [
  "UNAVAILABLE",
  "UNINDEXED",
  "PARTIAL",
  "INDEXED",
  "QUEUED",
] as const;

// ---------------------------------------------------------------------------
// Environment handed in by the paste block's last line
// ---------------------------------------------------------------------------

/** The slice of a `Zotero.Item` this probe touches. */
export interface ProbeItem {
  readonly id: number;
  readonly key: string;
  readonly itemType: string;
  readonly attachmentFilename?: string;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  getAttachments(): number[];
  getField(field: string): unknown;
}

/** Reader returned by `openStructuredDocumentTextPack`. */
export interface PackReader {
  readonly header: {
    readonly packVersion: number;
    readonly schemaVersion: string;
  };
  getTopLevelBlockCount(): number;
  materialize(): Promise<unknown>;
}

export interface ProbeEnv {
  readonly zotero: {
    readonly version: string;
    debug(message: string): void;
    readonly Libraries: { readonly userLibraryID: number };
    readonly Collections: {
      getByLibrary(
        libraryID: number,
      ): readonly { readonly name: string; getChildItems(): ProbeItem[] }[];
    };
    readonly Items: { get(id: number): ProbeItem | false };
    readonly Fulltext: { getIndexedState(item: ProbeItem): Promise<number> };
    /** Typed `any` upstream (typings/zotero-augment.d.ts hole (a)). */
    readonly PDFWorker: {
      getStructuredDocumentText(
        itemID: number,
        options: Record<string, never>,
      ): Promise<unknown>;
      getFullText(itemID: number, maxPages: number | null): Promise<unknown>;
    };
  };
  /** `resource://zotero/document-worker/structured-document-text.js`. */
  readonly sdt: {
    openStructuredDocumentTextPack(
      bytes: Uint8Array,
      options: { inflate(bytes: Uint8Array): Uint8Array },
    ): Promise<PackReader>;
  };
  /** `require('pako').inflateRaw`, as `xpcom/sdt.js` uses it. */
  readonly inflateRaw: (bytes: Uint8Array) => Uint8Array;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

interface Row {
  readonly label: string;
  pages: string;
  geometry: string;
  fonts: string;
  columns: string;
  notes: string;
}

export async function main(env: ProbeEnv): Promise<string> {
  const lines: string[] = [];
  const say = (line = ""): void => {
    lines.push(line);
    try {
      env.zotero.debug(`[research_helper P0-T18] ${line}`);
    } catch {
      /* the report still comes back as the result */
    }
  };

  try {
    say("research_helper P0-T18 structured-text probe (V-8b)");
    say(`run at  ${new Date().toISOString()}`);
    say(`zotero  ${env.zotero.version}`);

    const attachments = findCorpus(env);
    say(`corpus  collection "${COLLECTION_NAME}": ${attachments.length} PDFs`);
    const rows: Row[] = [];
    for (const [i, a] of attachments.entries()) {
      say();
      rows.push(await probeOne(env, a, `${i + 1}/${attachments.length}`, say));
    }

    say();
    say(
      "SUMMARY file | pages (extracted/total) | geometry | fonts | columns | structure",
    );
    for (const r of rows) {
      say(`  ${r.label}`);
      say(`    pages ${r.pages}; geometry ${r.geometry}`);
      say(`    fonts ${r.fonts}`);
      say(`    columns ${r.columns}`);
      say(`    structure ${r.notes}`);
    }
  } catch (e) {
    say(`PROBE ABORTED: ${describeError(e)}`);
  }
  return lines.join("\n");
}

function findCorpus(env: ProbeEnv): ProbeItem[] {
  const z = env.zotero;
  const collection = z.Collections.getByLibrary(z.Libraries.userLibraryID).find(
    (c) => c.name === COLLECTION_NAME,
  );
  if (collection === undefined) {
    throw new Error(`no collection named "${COLLECTION_NAME}"`);
  }
  const out: ProbeItem[] = [];
  for (const parent of collection.getChildItems()) {
    if (!parent.isRegularItem()) continue;
    for (const id of parent.getAttachments()) {
      const a = z.Items.get(id);
      if (a !== false && a.isPDFAttachment()) out.push(a);
    }
  }
  return out.sort((a, b) =>
    (a.attachmentFilename ?? "").localeCompare(b.attachmentFilename ?? ""),
  );
}

async function probeOne(
  env: ProbeEnv,
  att: ProbeItem,
  ordinal: string,
  say: (line?: string) => void,
): Promise<Row> {
  const name = att.attachmentFilename ?? "?";
  const row: Row = {
    label: `[${ordinal}] ${name}`,
    pages: "?",
    geometry: "?",
    fonts: "?",
    columns: "?",
    notes: "",
  };
  say(`== [${ordinal}] attachment ${att.id} (${att.key}) ${name}`);
  const state = await env.zotero.Fulltext.getIndexedState(att);
  say(`   Fulltext.getIndexedState: ${state} (${INDEX_STATES[state] ?? "?"})`);

  // --- getStructuredDocumentText ------------------------------------------
  let t0 = Date.now(); // docs/01 §2.3: no `performance` in the sandbox
  let raw: unknown;
  let doc: unknown;
  try {
    raw = await env.zotero.PDFWorker.getStructuredDocumentText(att.id, {});
  } catch (e) {
    say(`   getStructuredDocumentText THREW after ${Date.now() - t0} ms:`);
    say(`     ${describeError(e)}`);
    row.geometry = row.fonts = row.columns = "n/a (threw)";
  }
  if (raw !== undefined) {
    const ms = Date.now() - t0;
    const buf = at(raw, "buf");
    say(
      `   getStructuredDocumentText(${att.id}, {}): ${ms} ms, resolved ` +
        (raw === null
          ? "null"
          : `{ ${Object.keys(raw as object).join(", ")} }, buf ${tag(buf)} ` +
            `${isArrayBuffer(buf) ? `${buf.byteLength} bytes` : ""}`),
    );
    if (isArrayBuffer(buf)) {
      const reader = await env.sdt.openStructuredDocumentTextPack(
        new Uint8Array(buf),
        { inflate: (b) => env.inflateRaw(b) },
      );
      doc = await reader.materialize();
      say(
        `   SDTPack v${reader.header.packVersion}, schema ` +
          `${reader.header.schemaVersion}, ${reader.getTopLevelBlockCount()} ` +
          "top-level blocks",
      );
      describeDocument(doc, row, say);
    }
  }

  // --- getFullText ----------------------------------------------------------
  let fullText: string | null = null;
  t0 = Date.now();
  try {
    const ft = await env.zotero.PDFWorker.getFullText(att.id, null);
    const text = str(at(ft, "text")) ?? "";
    fullText = text;
    const extracted = String(at(ft, "extractedPages"));
    const total = String(at(ft, "totalPages"));
    row.pages = `${extracted}/${total}`;
    say(
      `   getFullText(${att.id}, null): ${Date.now() - t0} ms, keys ` +
        `{ ${Object.keys(ft as object).join(", ")} }, extractedPages ` +
        `${extracted}, totalPages ${total}, ${text.length} chars, ` +
        `${text.split("\f").length - 1} form feeds`,
    );
    say(`     starts: ${JSON.stringify(text.slice(0, 120))}`);
  } catch (e) {
    say(
      `   getFullText THREW after ${Date.now() - t0} ms: ${describeError(e)}`,
    );
    row.pages = "threw";
  }

  // --- columns, which need the structure and the flat text together --------
  if (doc !== undefined) describeColumns(doc, fullText, row, say);
  return row;
}

// ---------------------------------------------------------------------------
// Decoding the materialized document
// ---------------------------------------------------------------------------

function describeDocument(
  doc: unknown,
  row: Row,
  say: (line?: string) => void,
): void {
  // 1. Shape: every key path, arrays collapsed to [], with types and counts.
  const shape = new Map<
    string,
    { types: Set<string>; count: number; ex: string[] }
  >();
  walk(doc, "$", shape);
  say("   SHAPE key path | types | occurrences | examples");
  for (const [path, e] of shape) {
    say(
      `     ${path} | ${[...e.types].join("|")} | ${e.count}` +
        (e.ex.length ? ` | ${e.ex.join("  ")}` : ""),
    );
  }

  // 2. Geometry and font evidence, by key path.
  const paths = [...shape.keys()];
  const fontKeys = paths.filter((p) => /font|size|weight/i.test(p));
  const blocks = arr(at(doc, "content"));
  const withRects = blocks.filter(
    (b) => arr(at(b, "anchor", "pageRects")).length > 0,
  ).length;
  let runs = 0;
  let textNodes = 0;
  let mapped = 0;
  const styles: Record<string, number> = {};
  forEachTextNode(doc, (n) => {
    textNodes++;
    const map = str(at(n, "anchor", "textMap"));
    if (map !== null) {
      mapped++;
      runs += arr(parseJson(map)).length;
    }
    const style = at(n, "style");
    if (style !== null && typeof style === "object") {
      for (const k of Object.keys(style)) styles[k] = (styles[k] ?? 0) + 1;
    }
  });
  say("   GEOMETRY");
  say(
    `     block bbox  $.content[].anchor.pageRects[] = [pageIndex, x1, y1, ` +
      `x2, y2] (PDF user space, origin bottom-left): ${withRects}/${blocks.length} blocks`,
  );
  say(
    `     run bbox    $.content[]..content[].anchor.textMap = JSON string of ` +
      `runs [header, pageIndex, minX, minY, maxX, maxY, ...charWidths]: ` +
      `${mapped}/${textNodes} text nodes, ${runs} runs`,
  );
  say(
    `     font size / weight / name keys: ${fontKeys.length ? fontKeys.join(", ") : "NONE"}`,
  );
  say(
    `     per-run style flags (booleans): ${JSON.stringify(styles)}` +
      " (bold is the only weight signal)",
  );
  row.geometry =
    withRects > 0 && runs > 0
      ? `yes (block pageRects ${withRects}/${blocks.length}; ${runs} textMap runs)`
      : `NO (block pageRects ${withRects}/${blocks.length}; ${runs} runs)`;
  row.fonts =
    `size/name ${fontKeys.length ? `keys ${fontKeys.join(",")}` : "absent"}; ` +
    `style flags ${JSON.stringify(styles)}`;

  // 3. Structure the worker already classified.
  say(`   BLOCK TYPES ${JSON.stringify(countBy(blocks, "type"))}`);
  say(
    `   FLOW CLASSES ${JSON.stringify(countBy(blocks, "flowClass"))} ` +
      "(absent = body)",
  );
  const outline = arr(at(doc, "catalog", "outline"));
  say(
    `   OUTLINE ${outline.length} top-level entries, source ` +
      `${JSON.stringify(countBy(outline, "source"))} (absent = inferred by the worker)`,
  );
  for (const o of outline) {
    const kids = arr(at(o, "children")).length;
    say(
      `     ${JSON.stringify(str(at(o, "title")))} -> block ` +
        `${JSON.stringify(at(o, "ref") ?? null)}${kids ? `, ${kids} children` : ""}`,
    );
  }
  row.notes =
    `${JSON.stringify(countBy(blocks, "type"))} blocks; outline ` +
    `${outline.length} top-level, source ${JSON.stringify(countBy(outline, "source"))}`;
}

function walk(
  v: unknown,
  path: string,
  shape: Map<string, { types: Set<string>; count: number; ex: string[] }>,
): void {
  const type = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
  let e = shape.get(path);
  if (e === undefined) {
    e = { types: new Set(), count: 0, ex: [] };
    shape.set(path, e);
  }
  e.types.add(type);
  e.count++;
  if (type === "array") {
    for (const x of v as unknown[]) walk(x, `${path}[]`, shape);
    return;
  }
  if (type === "object") {
    for (const [k, x] of Object.entries(v as object)) {
      // Pages carry arbitrary PDF Info keys; keep the path set stable.
      const key = path.endsWith(".properties") ? "<pdfInfoKey>" : k;
      walk(x, `${path}.${key}`, shape);
    }
    return;
  }
  const s = JSON.stringify(v) ?? String(v);
  const clipped =
    s.length > EXAMPLE_CHARS ? `${s.slice(0, EXAMPLE_CHARS)}…` : s;
  if (e.ex.length < EXAMPLES_PER_PATH && !e.ex.includes(clipped)) {
    e.ex.push(clipped);
  }
}

function forEachTextNode(v: unknown, visit: (node: unknown) => void): void {
  for (const b of arr(at(v, "content"))) {
    if (typeof at(b, "text") === "string") visit(b);
    else forEachTextNode(b, visit);
  }
}

// ---------------------------------------------------------------------------
// Columns — the practical half of V-8b
// ---------------------------------------------------------------------------

/** One body-text rectangle on one page, tagged with its `content[]` index. */
interface BodyRect {
  readonly block: number;
  readonly node: unknown;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Per-page body x-ranges and the page width first — a file is only reported as
 * two-column because its boxes say so — then, on the pages that qualify, the
 * band-wise order metric for the structure and for the flat text. See the
 * file header, "The column-order measure", for why the band matters.
 */
function describeColumns(
  doc: unknown,
  fullText: string | null,
  row: Row,
  say: (line?: string) => void,
): void {
  const pages = arr(at(doc, "catalog", "pages"));
  const flatPages =
    fullText === null ? null : fullText.split("\f").map(normalizeSpace);
  let twoColumnPages = 0;
  let bands = 0;
  let pagePairs = 0;
  let pageViolations = 0;
  let bandPairs = 0;
  let bandViolations = 0;
  let flatPairs = 0;
  let flatViolations = 0;
  let located = 0;
  let tooShort = 0;
  let notFound = 0;

  say("   COLUMNS per page: width, body x-range, column bands, order");
  pages.forEach((page, pageIndex) => {
    const view = arr(at(page, "viewRect")).map(Number);
    const width = (view[2] ?? 0) - (view[0] ?? 0);
    const rects = pageBodyRects(doc, pageIndex);
    const head = `     p${pageIndex} width ${round(width)}`;
    if (!(width > 0) || rects.length === 0) {
      say(`${head}: no body rectangle (figure-only or empty page)`);
      return;
    }
    const narrow = rects.filter((r) => r.x2 - r.x1 < width * COLUMN_MAX_WIDTH);
    const left = narrow.filter((r) => r.x2 < width * 0.55);
    const right = narrow.filter((r) => r.x1 > width * 0.45);
    const wide = rects.length - narrow.length;
    const extent =
      `body x ${round(Math.min(...rects.map((r) => r.x1)))}–` +
      `${round(Math.max(...rects.map((r) => r.x2)))} (${rects.length} rects, ` +
      `${wide} of them wider than ${COLUMN_MAX_WIDTH * 100}% of the page)`;
    if (left.length < 2 || right.length < 2 || wide > rects.length * 0.25) {
      say(
        `${head} ${extent}: NOT two-column ` +
          `(left ${left.length}, right ${right.length})`,
      );
      return;
    }
    twoColumnPages++;
    for (const l of left) {
      for (const r of right) {
        pagePairs++;
        if (r.block < l.block) pageViolations++;
      }
    }
    const flat = flatPages === null ? null : (flatPages[pageIndex] ?? "");
    let onPageBands = 0;
    let bp = 0;
    let bv = 0;
    let fp = 0;
    let fv = 0;
    for (const [lo, hi] of verticalBands(rects)) {
      const inBand = (r: BodyRect): boolean => r.y1 >= lo && r.y2 <= hi;
      const bandLeft = left.filter(inBand);
      const bandRight = right.filter(inBand);
      if (bandLeft.length === 0 || bandRight.length === 0) continue;
      onPageBands++;
      bands++;
      for (const l of bandLeft) {
        for (const r of bandRight) {
          bp++;
          if (r.block < l.block) bv++;
        }
      }
      if (flat === null) continue;
      const offsets = (rs: readonly BodyRect[]): number[] =>
        rs.map((r) => {
          const o = flatOffset(r.node, flat);
          if (o >= 0) located++;
          else if (o === TOO_SHORT) tooShort++;
          else notFound++;
          return o;
        });
      const leftOffsets = offsets(bandLeft);
      const rightOffsets = offsets(bandRight);
      for (const l of leftOffsets) {
        for (const r of rightOffsets) {
          if (l < 0 || r < 0) continue;
          fp++;
          if (r < l) fv++;
        }
      }
    }
    bandPairs += bp;
    bandViolations += bv;
    flatPairs += fp;
    flatViolations += fv;
    say(
      `${head} ${extent}: TWO-COLUMN left x ` +
        `${round(Math.min(...left.map((r) => r.x1)))}–` +
        `${round(Math.max(...left.map((r) => r.x2)))}, right x ` +
        `${round(Math.min(...right.map((r) => r.x1)))}–` +
        `${round(Math.max(...right.map((r) => r.x2)))}; ${onPageBands} bands; ` +
        `structure ${bv}/${bp}, flat ${flat === null ? "n/a" : `${fv}/${fp}`}`,
    );
  });

  const flatSummary =
    flatPages === null
      ? "flat getFullText unavailable (it threw)"
      : `flat getFullText, band-wise: ${flatViolations}/${flatPairs} ` +
        `(blocks located ${located}, too short to locate ${tooShort}, ` +
        `not found ${notFound})`;
  say(
    `   COLUMNS two-column pages ${twoColumnPages}/${pages.length}, ` +
      `${bands} column bands`,
  );
  say(
    `     structure (content[] order), band-wise: ` +
      `${bandViolations}/${bandPairs} right-before-left pairs`,
  );
  say(
    `     structure, page-wide (the 2026-09-15 measure): ` +
      `${pageViolations}/${pagePairs}`,
  );
  say(`     ${flatSummary}`);
  row.columns =
    twoColumnPages === 0
      ? `no two-column page (0/${pages.length}); not testable on this file`
      : `${twoColumnPages}/${pages.length} two-column pages, ${bands} bands; ` +
        `structure ${bandViolations}/${bandPairs} band-wise ` +
        `(${pageViolations}/${pagePairs} page-wide); ` +
        (flatPages === null
          ? "flat n/a"
          : `flat ${flatViolations}/${flatPairs}`);
}

/** Body rects on one page. Furniture, figures, captions and tables are out. */
function pageBodyRects(doc: unknown, pageIndex: number): BodyRect[] {
  const out: BodyRect[] = [];
  arr(at(doc, "content")).forEach((b, block) => {
    if (at(b, "flowClass") !== undefined) return; // running heads, footnotes
    if (!BODY_TYPES.includes(str(at(b, "type")) ?? "")) return;
    for (const r of arr(at(b, "anchor", "pageRects"))) {
      const [p, x1, y1, x2, y2] = arr(r).map(Number);
      if (p !== pageIndex) continue;
      if (x1 === undefined || y1 === undefined) continue;
      if (x2 === undefined || y2 === undefined) continue;
      out.push({ block, node: b, x1, y1, x2, y2 });
    }
  });
  return out;
}

/**
 * The maximal vertical intervals the page's body rects cover, bottom-up. Two
 * flows separated by a gutterless horizontal gap — front matter above a
 * reference list — fall into different intervals and are ordered separately.
 */
function verticalBands(rects: readonly BodyRect[]): [number, number][] {
  const spans = rects
    .map((r): [number, number] => [r.y1, r.y2])
    .sort((a, b) => a[0] - b[0]);
  const bands: [number, number][] = [];
  for (const [lo, hi] of spans) {
    const last = bands[bands.length - 1];
    if (last !== undefined && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else bands.push([lo, hi]);
  }
  return bands;
}

/** `flatOffset` result for a block too short to be located unambiguously. */
const TOO_SHORT = -2;

/**
 * Where a block's text starts within one page of flat `getFullText` output,
 * or a negative marker. Both strings are whitespace-normalized first: the flat
 * extractor rewraps lines (`docs/06` §3.3.5), so only the run of characters
 * matches, never the line breaks.
 */
function flatOffset(node: unknown, page: string): number {
  const text = normalizeSpace(blockText(node));
  const shortest = FLAT_PROBE_LENGTHS[FLAT_PROBE_LENGTHS.length - 1] ?? 15;
  if (text.length < shortest) return TOO_SHORT;
  for (const length of FLAT_PROBE_LENGTHS) {
    const found = page.indexOf(text.slice(0, length));
    if (found >= 0) return found;
  }
  return -1;
}

/** A block's text, concatenated depth-first over its nested runs. */
function blockText(node: unknown): string {
  const text = str(at(node, "text"));
  if (text !== null) return text;
  return arr(at(node, "content")).map(blockText).join("");
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// --- Helpers -----------------------------------------------------------------

function countBy(xs: readonly unknown[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const v = at(x, key);
    const k = v === undefined ? "(absent)" : String(v);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function tag(v: unknown): string {
  return Object.prototype.toString.call(v);
}

/**
 * Brand check rather than `instanceof`: the buffer is created in Zotero's
 * global and posted from the worker, so it need not share this realm's
 * `ArrayBuffer` constructor.
 */
function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return tag(v) === "[object ArrayBuffer]";
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  const message = at(e, "message");
  return typeof message === "string"
    ? `non-Error exception: ${message}`
    : `non-Error thrown: ${String(e)}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function at(v: unknown, ...path: readonly (string | number)[]): unknown {
  let cur = v;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

// ---------------------------------------------------------------------------
// NODE-ONLY BELOW THIS LINE: the emitter. It is cut off before bundling, so
// none of it reaches the paste block.
// ---------------------------------------------------------------------------

const NODE_ONLY_MARKER = "// NODE-ONLY BELOW THIS LINE";

async function emitPasteBlock(scriptPath: string): Promise<void> {
  const { build } = await import("esbuild");
  const { readFileSync } = await import("node:fs");
  const { basename, dirname, join } = await import("node:path");

  const source = readFileSync(scriptPath, "utf8");
  const cut = source.indexOf(NODE_ONLY_MARKER);
  if (cut < 0) throw new Error("node-only marker not found");

  const result = await build({
    stdin: {
      contents: source.slice(0, cut),
      loader: "ts",
      resolveDir: dirname(scriptPath),
      sourcefile: basename(scriptPath),
    },
    absWorkingDir: join(dirname(scriptPath), ".."),
    bundle: true,
    format: "iife",
    globalName: "RHSpikeStructuredText",
    platform: "browser",
    target: "firefox140",
    charset: "ascii",
    legalComments: "none",
    write: false,
    logLevel: "warning",
  });
  const js = result.outputFiles[0]?.text;
  if (js === undefined) throw new Error("esbuild produced no output");
  const ascii = js.replace(
    /[^\t\n\r -~]/g, // anything outside printable ASCII
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  process.stdout.write(
    [
      "// research_helper P0-T18 structured-text probe (V-8b). Read-only.",
      `// Generated ${new Date().toISOString()} from scripts/spike-structured-text.ts.`,
      "// Tools > Developer > Run JavaScript: paste, keep 'Run as async function'",
      "// checked, press Run. Run it against the DEV profile only.",
      ascii.trimEnd(),
      "return await RHSpikeStructuredText.main({",
      "  zotero: Zotero,",
      '  sdt: require("resource://zotero/document-worker/structured-document-text.js"),',
      '  inflateRaw: (bytes) => require("pako").inflateRaw(bytes),',
      "});",
      "",
    ].join("\n"),
  );
}

const nodeScriptPath = process.argv[1];
if (nodeScriptPath === undefined) {
  process.stderr.write(
    "spike-structured-text: cannot determine the script path\n",
  );
  process.exitCode = 1;
} else {
  emitPasteBlock(nodeScriptPath).catch((e: unknown) => {
    process.stderr.write(`spike-structured-text: ${String(e)}\n`);
    process.exitCode = 1;
  });
}

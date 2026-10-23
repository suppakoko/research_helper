/* eslint-disable no-restricted-globals -- this file runs inside a live Zotero through the scaffold's test harness (docs/13 §2.3), imports each fixture PDF as a temporary attachment and erases it again; there is no src/zotero/ facade for that from outside the plugin bundle. */
/**
 * `P3-T20` step 3, the in-Zotero half of `scripts/build-imrad-fixtures.ts`.
 *
 * **Not part of the integration suite.** This file lives outside
 * `test/integration/`, so `npm run test:integration` never bundles it. The
 * build script starts the scaffold's test harness with its `entries` pointed
 * at this directory alone, and passes the job through three environment
 * variables (the harness spawns Zotero with `{ ...process.env }`, so
 * `Services.env` sees them):
 *
 * - `RH_IMRAD_IDS` — the paper ids, comma-separated (`S1,S2,…`);
 * - `RH_IMRAD_PDF_DIR` — the folder holding `<id>.pdf` (outside the
 *   repository; the files are read by Zotero's importer and nothing else);
 * - `RH_IMRAD_WORK_DIR` — where `<id>.txt` and `<id>.run.json` are written.
 *
 * **Why it must run inside Zotero.** The text is defined as what the plugin
 * itself acquires: Zotero's own PDF extraction (`attachmentText`, i.e.
 * `Zotero.PDFWorker` over pdf.js inside Zotero's worker) followed by `P3-T19`'s
 * cleaning pass, through `acquireZoteroSource` — the same call `P3-T25`'s
 * summarizer makes. Neither `Zotero.PDFWorker` nor the attachment-text getter
 * exists outside a running Zotero, and a Node PDF library would produce a
 * different text with different offsets.
 *
 * **What it writes and what it never writes.** `<id>.txt` is
 * `AcquiredSource.text`, byte for byte (UTF-8, no BOM). The parent item has
 * no abstract, DOI or `extra`, and Tier 3 is switched off, so the text is the
 * cleaned attachment text with no preamble. `<id>.run.json` holds Zotero's
 * version and the acquisition's cleaning and OCR-probe diagnostics. The
 * acquisition also runs `docs/06` §4.3's section detector internally; its
 * output (`sections`, `sectionAware` and the diagnostics' section fields) is
 * **discarded and never written**, because the ground truth must not be seen
 * through the detector it measures.
 *
 * Every item created is erased in `after`, whatever happened before.
 */

import type { Logger } from "../../src/core/logger";
import { setPrefStore } from "../../src/prefs";
import { acquireZoteroSource } from "../../src/pipeline/summarize/acquire";
import { getStructuredDocumentText } from "../../src/zotero/fulltext";
import { createZoteroPrefStore } from "../../src/zotero/prefStore";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body?: (this: MochaContext) => Promise<void>,
): void;
declare function before(body: (this: MochaContext) => Promise<void>): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG = "[P3-T20]";
/** Importing all PDFs and waiting for Zotero's indexer to settle. */
const IMPORT_TIMEOUT_MS = 15 * 60_000;
/** How long the indexer may take, in all, before acquisition goes on demand. */
const INDEX_SETTLE_MS = 10 * 60_000;
const ACQUIRE_TIMEOUT_MS = 5 * 60_000;
/** Paper ids are short and plain; anything else is refused before use. */
const ID_PATTERN = /^[A-Z]{1,2}R?\d{1,2}$/u;

function env(name: string): string {
  try {
    return Services.env.exists(name) ? Services.env.get(name) : "";
  } catch {
    return "";
  }
}

const IDS = env("RH_IMRAD_IDS")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id !== "");
const PDF_DIR = env("RH_IMRAD_PDF_DIR");
const WORK_DIR = env("RH_IMRAD_WORK_DIR");

interface Imported {
  readonly parent: Zotero.Item;
  readonly attachment: Zotero.Item;
}

const imported = new Map<string, Imported>();

/** A logger that keeps `acquireSource`'s one diagnostics line. */
function captureLogger(): {
  logger: Logger;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const logger: Logger = {
    child: () => logger,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: (msg, ctx) => {
      if (msg === "summarize acquisition" && ctx !== undefined) lines.push(ctx);
    },
    time: (_msg, fn) => fn(),
  };
  return { logger, lines };
}

/**
 * The diagnostics fields that describe extraction and cleaning. Everything
 * else on that line (section labels, outline counts) comes from the detector
 * under test and is dropped here on purpose.
 */
const KEPT_DIAGNOSTICS = [
  "tier",
  "charCount",
  "truncated",
  "pages",
  "runningHeadLinesRemoved",
  "gutterPages",
  "referencesCut",
  "referencesShare",
  "supplementaryCharsRemoved",
  "ocrAlnumPunctShare",
  "ocrLetterShare",
  "ocrChars",
  "ocrFailed",
  "nonLatinShare",
  "warnings",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numbers(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as number[])
    : null;
}

/** A body box at most this share of its page's width is one column of two. */
const NARROW_SHARE = 0.55;

/**
 * Column evidence from Zotero's structured document text, read through the
 * plugin's own reader (`getStructuredDocumentText`). The flat text has one
 * line per block, so it cannot show columns; but every block carries its page
 * boxes (`anchor.pageRects[] = [page, x1, y1, x2, y2]`). Only `paragraph`
 * blocks in the body flow count (no headings, captions, tables or running
 * heads). A page is two-column when at least half of its paragraph area lies
 * in boxes no wider than {@link NARROW_SHARE} of the page. Nothing here reads
 * a heading, the outline, or a label.
 */
function columnGeometry(doc: unknown): {
  readonly pagesWithBody: number;
  readonly twoColumnPages: number;
} {
  const record = isRecord(doc) ? doc : {};
  const catalog = isRecord(record.catalog) ? record.catalog : {};
  const pages: unknown[] = Array.isArray(catalog.pages) ? catalog.pages : [];
  const content: unknown[] = Array.isArray(record.content)
    ? record.content
    : [];
  const total = new Map<number, number>();
  const narrow = new Map<number, number>();
  for (const block of content) {
    if (!isRecord(block) || block.type !== "paragraph") continue;
    if (block.flowClass !== undefined) continue;
    const anchor = isRecord(block.anchor) ? block.anchor : {};
    const rects: unknown[] = Array.isArray(anchor.pageRects)
      ? anchor.pageRects
      : [];
    for (const rect of rects) {
      const r = numbers(rect);
      if (r === null || r.length < 5) continue;
      const [page = -1, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = r;
      const pageRecord = pages[page];
      const view = isRecord(pageRecord) ? numbers(pageRecord.viewRect) : null;
      if (view === null || view.length < 4) continue;
      const pageWidth = (view[2] ?? 0) - (view[0] ?? 0);
      const area = Math.abs((x2 - x1) * (y2 - y1));
      if (pageWidth <= 0 || area === 0) continue;
      total.set(page, (total.get(page) ?? 0) + area);
      if ((x2 - x1) / pageWidth <= NARROW_SHARE) {
        narrow.set(page, (narrow.get(page) ?? 0) + area);
      }
    }
  }
  let twoColumnPages = 0;
  for (const [page, area] of total) {
    if ((narrow.get(page) ?? 0) / area >= 0.5) twoColumnPages++;
  }
  return { pagesWithBody: total.size, twoColumnPages };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Zotero's indexer is done with an attachment (indexed, partly, or not at all). */
function settled(state: number): boolean {
  return (
    state === Zotero.Fulltext.INDEX_STATE_INDEXED ||
    state === Zotero.Fulltext.INDEX_STATE_PARTIAL ||
    state === Zotero.Fulltext.INDEX_STATE_UNAVAILABLE
  );
}

describe("P3-T20 IMRaD fixture extraction (scripts/build-imrad-fixtures.ts)", function () {
  if (IDS.length === 0 || PDF_DIR === "" || WORK_DIR === "") {
    it("runs only from scripts/build-imrad-fixtures.ts (RH_IMRAD_* unset)");
    return;
  }

  before(async function () {
    this.timeout(IMPORT_TIMEOUT_MS);
    debug(`${LOG} Zotero ${Zotero.version}; ${IDS.length} PDFs`);
    for (const id of IDS) {
      if (!ID_PATTERN.test(id)) assert.fail(`refusing paper id ${id}`);
      const parent = new Zotero.Item("journalArticle");
      parent.setField("title", `RH P3-T20 fixture ${id}`);
      await parent.saveTx();
      const attachment = await Zotero.Attachments.importFromFile({
        file: PathUtils.join(PDF_DIR, `${id}.pdf`),
        parentItemID: parent.id,
        contentType: "application/pdf",
      });
      imported.set(id, { parent, attachment });
    }
    // Zotero's own import path queues every new attachment for background
    // indexing. Acquisition gives the same text either way (`attachmentText`
    // reads the index cache when the attachment is fully indexed and extracts
    // on demand otherwise, both from `PDFWorker.getFullText`, both trimmed);
    // waiting only keeps two extractions of one file from running at once.
    const deadline = Date.now() + INDEX_SETTLE_MS;
    let pending = [...imported.keys()];
    while (pending.length > 0 && Date.now() < deadline) {
      const still: string[] = [];
      for (const id of pending) {
        const { attachment } = imported.get(id) as Imported;
        if (!settled(await Zotero.Fulltext.getIndexedState(attachment))) {
          still.push(id);
        }
      }
      pending = still;
      if (pending.length > 0) await delay(1000);
    }
    debug(
      `${LOG} indexer settled; still unindexed after the wait: ${pending.join(",") || "none"}`,
    );
    setPrefStore(createZoteroPrefStore());
  });

  after(async function () {
    this.timeout(IMPORT_TIMEOUT_MS);
    setPrefStore(undefined);
    const ids = [...imported.values()].map(({ parent }) => parent.id);
    if (ids.length > 0) await Zotero.Items.erase(ids);
    const left = [...imported.values()].filter(
      ({ parent, attachment }) =>
        Zotero.Items.get(parent.id) !== false ||
        Zotero.Items.get(attachment.id) !== false,
    ).length;
    debug(`${LOG} erased ${ids.length} parents; items left behind: ${left}`);
  });

  for (const id of IDS) {
    it(`extracts ${id}`, async function () {
      this.timeout(ACQUIRE_TIMEOUT_MS);
      const entry = imported.get(id);
      if (entry === undefined) assert.fail(`${id} was not imported`);
      const { logger, lines } = captureLogger();
      const t0 = Date.now();
      const source = await acquireZoteroSource(entry.parent, {
        estimateTokens: (text) => Math.ceil(text.length / 4),
        tryEuropePmc: false,
        logger,
      });
      const ms = Date.now() - t0;
      const diagnostics = lines[0] ?? {};
      const kept: Record<string, unknown> = {};
      for (const key of KEPT_DIAGNOSTICS) {
        if (key in diagnostics) kept[key] = diagnostics[key];
      }
      debug(
        `${LOG} ${id}: tier=${source.tier} chars=${source.charCount} truncated=${String(source.truncated)} ` +
          `pages=${String(kept.pages)} warnings=${source.warnings.join(",")} ${ms} ms`,
      );
      assert.strictEqual(source.tier, "fulltext_pdf", `${id}: Tier 2`);
      assert.isTrue(!source.truncated, `${id}: not truncated`);
      assert.isTrue(source.text.length > 0, `${id}: text`);
      const columns = columnGeometry(
        await getStructuredDocumentText(entry.attachment.id),
      );
      debug(`${LOG} ${id}: columns ${JSON.stringify(columns)}`);
      await IOUtils.writeUTF8(
        PathUtils.join(WORK_DIR, `${id}.txt`),
        source.text,
      );
      await IOUtils.writeUTF8(
        PathUtils.join(WORK_DIR, `${id}.run.json`),
        `${JSON.stringify(
          {
            id,
            zoteroVersion: Zotero.version,
            acquiredInMs: ms,
            contentHash: source.contentHash,
            warnings: source.warnings,
            diagnostics: kept,
            columns,
          },
          null,
          2,
        )}\n`,
      );
    });
  }
});

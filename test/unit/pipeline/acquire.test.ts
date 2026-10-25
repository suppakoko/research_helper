import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  acquireSource,
  hashAcquiredText,
  isPasswordError,
  probeSubtleDigest,
  type AcquirableAttachment,
  type AcquirableItem,
  type FullTextPort,
} from "../../../src/pipeline/summarize/acquire";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import type {
  IndexedPageCounts,
  PdfFullText,
} from "../../../src/zotero/fulltext";

/**
 * `acquireSource`'s ladder and D-06-3 against a fake platform port
 * (`P3-T18`). The same cases run against real Zotero in
 * `test/integration/zotero/acquireFullText.spec.ts`; this file pins the
 * branch logic and the `contentHash` fallback, which the integration suite
 * cannot reach without a mutant.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const PARTIAL = 2;
const INDEXED = 3;

/** Over `summary.minAbstractChars`' default of 250 characters. */
const ABSTRACT =
  "BACKGROUND: Synthetic widgets were studied at three invented field sites. " +
  "METHODS: Widgets were counted weekly for one simulated year by two observers. " +
  "RESULTS: Counts rose by 4% (95% CI 2-6%) between the first and last quarter. " +
  "CONCLUSIONS: Widgets are countable, and the counts are stable between observers.";

/** Attachment text with a page break and per-line breaks, as an extractor emits it. */
const BODY = "Line one of page one\nline two of page one\n\n\n\fPage two text";

interface FakeItem extends AcquirableItem {
  /** Read by nothing; present so a test can prove it is not hashed. */
  dateModified: string;
}

function fakeItem(
  abstract: string,
  dateModified = "2026-10-21 00:00:00",
): FakeItem {
  return {
    key: "ITEMKEY1",
    libraryID: 1,
    dateModified,
    getField(field: "abstractNote") {
      if (field !== "abstractNote")
        throw new Error(`unexpected field ${String(field)}`);
      return abstract;
    },
  };
}

const ATTACHMENT: AcquirableAttachment = { id: 42, key: "ATTKEY01" };

interface Calls {
  attachmentText: number;
  allPages: number;
  firstPages: number[];
}

interface FakeOptions {
  attachment?: AcquirableAttachment | null;
  state?: number;
  counts?: IndexedPageCounts | null;
  text?: string | null;
  throws?: unknown;
}

function fakePort(options: FakeOptions): {
  port: FullTextPort<FakeItem, AcquirableAttachment>;
  calls: Calls;
} {
  const calls: Calls = { attachmentText: 0, allPages: 0, firstPages: [] };
  const pages = (count: number, total: number): PdfFullText => ({
    text: `${BODY} [${count}/${total}]`,
    extractedPages: count,
    totalPages: total,
  });
  const port: FullTextPort<FakeItem, AcquirableAttachment> = {
    pickTextAttachment: () =>
      Promise.resolve(
        options.attachment === undefined ? ATTACHMENT : options.attachment,
      ),
    getIndexedState: () => Promise.resolve(options.state ?? INDEXED),
    isPartialIndexState: (state) => state === PARTIAL,
    getIndexedPageCounts: () => Promise.resolve(options.counts ?? null),
    getAttachmentText: () => {
      calls.attachmentText += 1;
      if (options.throws !== undefined) return Promise.reject(options.throws);
      return Promise.resolve(options.text === undefined ? BODY : options.text);
    },
    getFullTextAllPages: () => {
      calls.allPages += 1;
      if (options.throws !== undefined) return Promise.reject(options.throws);
      const total = options.counts?.total ?? 1;
      return Promise.resolve(pages(total, total));
    },
    getFullTextFirstPages: (_id, maxPages) => {
      calls.firstPages.push(maxPages);
      return Promise.resolve(
        pages(maxPages, options.counts?.total ?? maxPages),
      );
    },
    md5Hex: () => "0".repeat(32),
  };
  return { port, calls };
}

const OPTIONS = {
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

afterEach(() => {
  setPrefStore(undefined);
});

describe("acquireSource — Tier 2 (P3-T18)", () => {
  it("a fully indexed attachment is read through attachmentText with no PDFWorker call", async () => {
    const { port, calls } = fakePort({ state: INDEXED });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(calls).toEqual({ attachmentText: 1, allPages: 0, firstPages: [] });
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.attachmentKey).toBe("ATTKEY01");
    expect(source.truncated).toBe(false);
  });

  it("prepends the normalized abstract and keeps the attachment text byte for byte", async () => {
    const { port } = fakePort({});
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(source.abstract).toBe(ABSTRACT);
    expect(source.text).toBe(`${ABSTRACT}\n\n${BODY}`);
    expect(source.text).toContain("page one\nline two");
    expect(source.charCount).toBe(source.text.length);
    expect(source.estTokens).toBe(Math.ceil(source.text.length / 4));
    expect(source.sections).toEqual([]);
  });

  it("INDEX_STATE_PARTIAL under the cap: exactly one all-pages re-extraction, not truncated", async () => {
    const { port, calls } = fakePort({
      state: PARTIAL,
      counts: { indexedPages: 2, total: 5 },
    });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(calls).toEqual({ attachmentText: 0, allPages: 1, firstPages: [] });
    expect(source.truncated).toBe(false);
  });

  it("INDEX_STATE_PARTIAL at the cap still re-extracts (total <= cap)", async () => {
    setPrefStore(createMemoryPrefStore({ [PREF_KEYS.fullTextHardPageCap]: 5 }));
    const { port, calls } = fakePort({
      state: PARTIAL,
      counts: { indexedPages: 2, total: 5 },
    });
    await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(calls.allPages).toBe(1);
  });

  it("INDEX_STATE_PARTIAL over the cap: no all-pages re-extraction, the indexed pages only, truncated", async () => {
    setPrefStore(createMemoryPrefStore({ [PREF_KEYS.fullTextHardPageCap]: 4 }));
    const { port, calls } = fakePort({
      state: PARTIAL,
      counts: { indexedPages: 2, total: 5 },
    });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(calls).toEqual({ attachmentText: 0, allPages: 0, firstPages: [2] });
    expect(source.truncated).toBe(true);
    expect(source.tier).toBe("fulltext_pdf");
  });

  it("INDEX_STATE_PARTIAL without page counts (a non-PDF) falls back to attachmentText", async () => {
    const { port, calls } = fakePort({ state: PARTIAL, counts: null });
    await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(calls).toEqual({ attachmentText: 1, allPages: 0, firstPages: [] });
  });

  it("includeFullText: false never opens an attachment", async () => {
    const { port, calls } = fakePort({});
    const source = await acquireSource(
      fakeItem(ABSTRACT),
      { ...OPTIONS, includeFullText: false },
      port,
    );
    expect(calls).toEqual({ attachmentText: 0, allPages: 0, firstPages: [] });
    expect(source.tier).toBe("abstract");
  });
});

describe("acquireSource — demotion (P3-T18 step 5)", () => {
  it("a password-protected PDF demotes to Tier 1 with pdf_password_protected and does not throw", async () => {
    const error = Object.assign(
      new Error("Worker action 'pdf.getFulltext' failed"),
      {
        name: "PasswordException",
      },
    );
    const { port } = fakePort({ throws: error });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(source.tier).toBe("abstract");
    expect(source.text).toBe(ABSTRACT);
    expect(source.attachmentKey).toBeNull();
    expect(source.warnings).toEqual(["pdf_password_protected"]);
  });

  it("any other extraction failure demotes with attachment_text_failed", async () => {
    const { port } = fakePort({ throws: new Error("Invalid PDF structure") });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(source.tier).toBe("abstract");
    expect(source.warnings).toEqual(["attachment_text_failed"]);
  });

  it("an empty attachment text demotes with attachment_text_empty", async () => {
    const { port } = fakePort({ text: "" });
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(source.tier).toBe("abstract");
    expect(source.warnings).toEqual(["attachment_text_empty"]);
  });

  it("no usable abstract and no attachment is metadata_only with empty text", async () => {
    const { port } = fakePort({ attachment: null });
    const source = await acquireSource(
      fakeItem("No abstract available"),
      OPTIONS,
      port,
    );
    expect(source.tier).toBe("metadata_only");
    expect(source.abstract).toBeNull();
    expect(source.text).toBe("");
  });

  it("an abstract under summary.minAbstractChars is not Tier 1", async () => {
    const { port } = fakePort({ attachment: null });
    const source = await acquireSource(fakeItem("Too short."), OPTIONS, port);
    expect(source.tier).toBe("metadata_only");
  });

  it("full text without a usable abstract is sent without a preamble", async () => {
    const { port } = fakePort({});
    const source = await acquireSource(fakeItem(""), OPTIONS, port);
    expect(source.tier).toBe("fulltext_pdf");
    expect(source.abstract).toBeNull();
    expect(source.text).toBe(BODY);
  });
});

describe("contentHash (P3-T18 step 6)", () => {
  it("is the SHA-256 of exactly the text sent", async () => {
    const { port } = fakePort({});
    const source = await acquireSource(fakeItem(ABSTRACT), OPTIONS, port);
    expect(source.contentHash).toBe(sha256(source.text));
    // P3-T19 made the 58-character BODY draw `ocr_suspected` (under the old
    // probe's 1,500-character minimum). Since item 285(b), 2026-10-25, a body
    // under 250 words is never warned on (and this port reads no word list),
    // so nothing warns at all.
    expect(source.warnings).toEqual([]);
  });

  it("changes with the text and not with dateModified", async () => {
    const a = await acquireSource(
      fakeItem(ABSTRACT, "2026-01-01 00:00:00"),
      OPTIONS,
      fakePort({}).port,
    );
    const b = await acquireSource(
      fakeItem(ABSTRACT, "2026-12-31 23:59:59"),
      OPTIONS,
      fakePort({}).port,
    );
    const c = await acquireSource(
      fakeItem(ABSTRACT),
      OPTIONS,
      fakePort({ text: `${BODY} changed` }).port,
    );
    expect(b.contentHash).toBe(a.contentHash);
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  it("probes crypto.subtle once and finds it in Node", () => {
    const first = probeSubtleDigest();
    expect(first).toBeDefined();
    expect(probeSubtleDigest()).toBe(first);
  });

  it("falls back to an md5:-prefixed hash when there is no digest", async () => {
    const result = await hashAcquiredText("text", undefined, () => "ABCDEF");
    expect(result).toEqual({ hash: "md5:ABCDEF", fallback: true });
  });
});

describe("isPasswordError", () => {
  it("recognises the worker's PasswordException by name or message", () => {
    expect(
      isPasswordError(
        Object.assign(new Error("x"), { name: "PasswordException" }),
      ),
    ).toBe(true);
    expect(
      isPasswordError(
        new Error(
          `Worker action 'pdf.getFulltext' failed: {"error":"{\\"name\\":\\"PasswordException\\"}"}`,
        ),
      ),
    ).toBe(true);
    expect(isPasswordError(new Error("Invalid PDF structure"))).toBe(false);
    expect(isPasswordError("PasswordException")).toBe(false);
  });
});

/**
 * `P3-T18` Done-when: "A grep test finds no `indexItems`, `setItemContent` or
 * `getItemContent` in `src/`." Comments are stripped first: the modules that
 * explain why they never call these name them in prose. The cache file and
 * the removed word tables are checked for the same reason (`P3-T18` Do NOT).
 */
describe("no full-text writer or raw cache reader in src/ (P3-T18)", () => {
  const FORBIDDEN = [
    /\bindexItems\b/u,
    /\bsetItemContent\b/u,
    /\bgetItemContent\b/u,
    /zotero-ft-cache/u,
    /\bgetItemCacheFile\b/u,
    /\bfulltextItemWords\b/u,
    /\bfulltextWords\b/u,
  ];

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return tsFiles(path);
      return path.endsWith(".ts") ? [path] : [];
    });
  }

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
  }

  it("finds none of them outside comments", () => {
    const hits: string[] = [];
    for (const file of tsFiles(join(ROOT, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(code))
          hits.push(`${relative(ROOT, file)}: ${pattern.source}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the comment stripper does not hide a real call", () => {
    const code = stripComments(
      "// indexItems is never called\nawait Zotero.Fulltext.indexItems([id]);",
    );
    expect(/\bindexItems\b/u.test(code)).toBe(true);
  });
});

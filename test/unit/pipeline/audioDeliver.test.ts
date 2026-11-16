/**
 * `plan/09` `P6-T13` — `deliverAudio` and `checkAudioDestination`
 * (`src/pipeline/audioReport/deliver.ts`), layer 1: the real audio store over
 * a fake file system and a fake `Zotero.Attachments`, and a fake library.
 */

import { describe, expect, it } from "vitest";

import type { Logger } from "../../../src/core/logger";
import {
  AUDIO_SLUG_MAX_LENGTH,
  audioFileStem,
  audioSlug,
  checkAudioDestination,
  deliverAudio,
  defaultAudioTitle,
  localDate,
  type AudioDeliveryDeps,
  type AudioDeliveryRequest,
} from "../../../src/pipeline/audioReport/deliver";
import {
  IMPORT_MAX_BYTES,
  MAX_FILE_STEM_LENGTH,
  createAudioStore,
  type AttachmentFromFileOptions,
  type AudioFileSystem,
  type PcmChunk,
} from "../../../src/tts/audioStore";
import type { ZoteroAudioAttachments } from "../../../src/zotero/attachments";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const MiB = 1024 * 1024;
const DATA = "D:/data";
const AUDIO_DIR = `${DATA}/research-helper/audio`;
const CHOSEN = "E:/Audio reports";
/** 2026-11-16 12:00 local time. */
const NOON = new Date(2026, 10, 16, 12, 0, 0).getTime();

interface World {
  readonly zotero: ZoteroAudioAttachments;
  readonly disk: Map<string, number>;
  readonly folders: Set<string>;
  readonly calls: string[];
  readonly imports: AttachmentFromFileOptions[];
  readonly links: AttachmentFromFileOptions[];
  readonly removed: string[];
  readonly names: Set<string>;
  editable: boolean;
  personal: boolean;
  collection: boolean;
  failAttach: boolean;
  failRemove: boolean;
}

function world(): World {
  const disk = new Map<string, number>();
  const folders = new Set<string>([CHOSEN]);
  const calls: string[] = [];
  const imports: AttachmentFromFileOptions[] = [];
  const links: AttachmentFromFileOptions[] = [];
  const removed: string[] = [];
  const names = new Set<string>();
  let next = 100;
  const files: AudioFileSystem = {
    join: (...segments) => segments.join("/"),
    makeDirectory: (path) => {
      calls.push("mkdir");
      folders.add(path);
      return Promise.resolve();
    },
    writeFile: (path, bytes) => {
      calls.push("write");
      disk.set(path, bytes.byteLength);
      return Promise.resolve();
    },
    appendFile: (path, bytes) => {
      calls.push("append");
      disk.set(path, (disk.get(path) ?? 0) + bytes.byteLength);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(disk.has(path)),
  };
  const w: World = {
    disk,
    folders,
    calls,
    imports,
    links,
    removed,
    names,
    editable: true,
    personal: true,
    collection: true,
    failAttach: false,
    failRemove: false,
    zotero: undefined as unknown as ZoteroAudioAttachments,
  };
  const attach =
    (into: AttachmentFromFileOptions[]) =>
    (options: AttachmentFromFileOptions) => {
      calls.push("attach");
      if (w.failAttach) return Promise.reject(new Error("attach failed"));
      into.push(options);
      next += 1;
      return Promise.resolve({ id: next, key: `KEY${next}` });
    };
  const store = createAudioStore({
    dataDirectory: DATA,
    files,
    attachments: {
      importFromFile: attach(imports),
      linkFromFile: attach(links),
    },
  });
  (w as { zotero: ZoteroAudioAttachments }).zotero = {
    store,
    isLibraryEditable: () => w.editable,
    canLinkFiles: () => w.personal,
    collectionExists: () => w.collection,
    attachmentFileNames: () => names,
    folderExists: (path) => Promise.resolve(folders.has(path)),
    isTemporaryFolder: (path) => path.startsWith("C:/Temp"),
    fileExists: (path) => Promise.resolve(disk.has(path)),
    removeFile: (path) => {
      calls.push("remove");
      if (w.failRemove) return Promise.reject(new TypeError("locked"));
      removed.push(path);
      disk.delete(path);
      return Promise.resolve();
    },
  };
  return w;
}

function capturingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const write = (msg: string, ctx?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(ctx ?? {})}`);
  };
  const logger: Logger & { lines: string[] } = {
    lines,
    child: () => logger,
    error: write,
    warn: write,
    info: write,
    debug: write,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

interface Prefs {
  folder: string;
  readonly asked: number[];
  readonly stored: string[];
}

function deps(
  w: World,
  prefs: Prefs,
  answers: (string | undefined)[] = [CHOSEN],
  logger?: Logger,
): AudioDeliveryDeps {
  return {
    zotero: w.zotero,
    clock: { now: () => NOON },
    pickFolder: () => {
      prefs.asked.push(1);
      return Promise.resolve(answers.shift());
    },
    readLinkedFolder: () => prefs.folder,
    writeLinkedFolder: (path) => {
      prefs.stored.push(path);
      prefs.folder = path;
    },
    ...(logger === undefined ? {} : { logger }),
  };
}

function prefs(folder = ""): Prefs {
  return { folder, asked: [], stored: [] };
}

/** Chunks whose WAV is `44 + 12,000 × (n − 1) + Σ` ≈ `totalBytes`. */
function chunksOf(totalBytes: number, n = 2): PcmChunk[] {
  const each = Math.floor(totalBytes / n / 2) * 2;
  return Array.from({ length: n }, () => ({
    pcm: new Uint8Array(each),
    sampleRateHz: 24000,
  }));
}

function request(
  chunks: PcmChunk[],
  extra: Partial<AudioDeliveryRequest> = {},
): AudioDeliveryRequest {
  return {
    report: {
      id: "rpt_01",
      libraryID: 1,
      collectionKey: "COLL1234",
      collectionName: "CRISPR delivery 2023–2026",
    },
    language: "en",
    chunks,
    sampleRateHz: 24000,
    usage: USAGE,
    scriptUsage: undefined,
    ...extra,
  };
}

const USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  costUsd: undefined,
} as const;

const STEM = "crispr-delivery-2023-2026-trends-20261116-en";

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

describe("naming (docs/04 §10.3)", () => {
  it("slugs a collection name, keeping Hangul in NFC", () => {
    expect(audioSlug("CRISPR delivery 2023–2026")).toBe(
      "crispr-delivery-2023-2026",
    );
    const korean = audioSlug("유전자 편집: 전달 기술");
    expect(korean).toBe("유전자-편집-전달-기술");
    expect(korean).toBe(korean.normalize("NFC"));
    expect(audioSlug("  ***  ")).toBe("collection");
  });

  it("caps the slug so the whole stem fits the 60-code-point cap", () => {
    const slug = audioSlug("a".repeat(200));
    expect(Array.from(slug)).toHaveLength(AUDIO_SLUG_MAX_LENGTH);
    const stem = audioFileStem("가".repeat(200), "20261116", "ko", 99);
    expect(Array.from(stem).length).toBeLessThanOrEqual(MAX_FILE_STEM_LENGTH);
    expect(stem.endsWith("-trends-20261116-ko-99")).toBe(true);
    expect(audioSlug(`${"b".repeat(AUDIO_SLUG_MAX_LENGTH - 1)} c`)).toBe(
      "b".repeat(AUDIO_SLUG_MAX_LENGTH - 1),
    );
  });

  it("dates by the local calendar and adds -2, -3 from the second run", () => {
    expect(localDate(NOON)).toEqual({ compact: "20261116", iso: "2026-11-16" });
    expect(audioFileStem("X", "20261116", "en")).toBe("x-trends-20261116-en");
    expect(audioFileStem("X", "20261116", "en", 2)).toBe(
      "x-trends-20261116-en-2",
    );
  });

  it("titles in English until P6-T17 localises it", () => {
    expect(defaultAudioTitle("en", "2026-11-16")).toBe(
      "Audio report (English), 2026-11-16",
    );
    expect(defaultAudioTitle("ko", "2026-11-16")).toBe(
      "Audio report (Korean), 2026-11-16",
    );
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

describe("deliverAudio — import at most 10 MiB", () => {
  it("imports a 5 MiB file into the collection with no parent and deletes the copy", async () => {
    const w = world();
    const p = prefs();
    const result = await deliverAudio(request(chunksOf(5 * MiB)), deps(w, p));
    if (result.kind !== "delivered") throw new Error(result.reason);
    const path = `${AUDIO_DIR}/${STEM}.wav`;
    expect(w.imports).toEqual([
      {
        file: path,
        title: "Audio report (English), 2026-11-16",
        contentType: "audio/wav",
        collections: ["COLL1234"],
        libraryID: 1,
      },
    ]);
    expect(w.imports[0]).not.toHaveProperty("parentItemID");
    expect(w.links).toEqual([]);
    expect(w.removed).toEqual([path]);
    expect(w.disk.size).toBe(0);
    expect(p.asked).toEqual([]);
    expect(result.outcome).toMatchObject({
      reportId: "rpt_01",
      language: "en",
      attachmentKey: "KEY101",
      mode: "imported",
      fileName: `${STEM}.wav`,
      usage: USAGE,
      scriptUsage: undefined,
    });
    expect(result.outcome.bytes).toBeLessThanOrEqual(IMPORT_MAX_BYTES);
    expect(result.outcome.seconds).toBeCloseTo(
      (result.outcome.bytes - 44) / 48000,
      9,
    );
    // Removal comes after the attach, never before.
    expect(w.calls.indexOf("remove")).toBeGreaterThan(
      w.calls.indexOf("attach"),
    );
  });

  it("imports a file of exactly 10 MiB", async () => {
    const w = world();
    const chunks = [
      {
        pcm: new Uint8Array(IMPORT_MAX_BYTES - 44 - 12000 - 1000),
        sampleRateHz: 24000,
      },
      { pcm: new Uint8Array(1000), sampleRateHz: 24000 },
    ];
    const result = await deliverAudio(request(chunks), deps(w, prefs()));
    expect(result.kind === "delivered" && result.outcome.bytes).toBe(
      IMPORT_MAX_BYTES,
    );
    expect(result.kind === "delivered" && result.outcome.mode).toBe("imported");
  });

  it("names a same-day re-run -2, then -3", async () => {
    const w = world();
    w.names.add(`${STEM}.wav`);
    w.names.add(`${STEM}-2.wav`);
    const result = await deliverAudio(
      request(chunksOf(1000)),
      deps(w, prefs()),
    );
    expect(result.kind === "delivered" && result.outcome.fileName).toBe(
      `${STEM}-3.wav`,
    );
  });

  it("keeps the written file when the import fails, and throws", async () => {
    const w = world();
    w.failAttach = true;
    await expect(
      deliverAudio(request(chunksOf(1000)), deps(w, prefs())),
    ).rejects.toThrow("attach failed");
    expect(w.disk.size).toBe(1);
    expect(w.removed).toEqual([]);
  });

  it("still delivers when the copy cannot be removed, and logs no path", async () => {
    const w = world();
    w.failRemove = true;
    const logger = capturingLogger();
    const result = await deliverAudio(
      request(chunksOf(1000)),
      deps(w, prefs(), [], logger),
    );
    expect(result.kind).toBe("delivered");
    expect(logger.lines[0]).toBe(
      'audio.copy-not-removed {"error":"TypeError"}',
    );
    expect(logger.lines.join("\n")).not.toMatch(/D:|E:|crispr|wav/u);
  });

  it("uses the localised title it is given", async () => {
    const w = world();
    await deliverAudio(request(chunksOf(1000), { language: "ko" }), {
      ...deps(w, prefs()),
      title: (language, iso) => `오디오 보고서 (${language}), ${iso}`,
    });
    expect(w.imports[0]?.title).toBe("오디오 보고서 (ko), 2026-11-16");
    expect(w.imports[0]?.file.endsWith("-ko.wav")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

describe("deliverAudio — link above 10 MiB", () => {
  it("links a 20 MiB file into tts.linkedFileDir and keeps it there", async () => {
    const w = world();
    const p = prefs(CHOSEN);
    const logger = capturingLogger();
    const result = await deliverAudio(
      request(chunksOf(20 * MiB)),
      deps(w, p, [], logger),
    );
    if (result.kind !== "delivered") throw new Error(result.reason);
    const path = `${CHOSEN}/${STEM}.wav`;
    expect(w.links).toEqual([
      {
        file: path,
        title: "Audio report (English), 2026-11-16",
        contentType: "audio/wav",
        collections: ["COLL1234"],
      },
    ]);
    expect(w.imports).toEqual([]);
    expect(w.removed).toEqual([]);
    expect(w.disk.get(path)).toBe(result.outcome.bytes);
    expect(result.outcome.mode).toBe("linked");
    expect(result.outcome.bytes).toBeGreaterThan(IMPORT_MAX_BYTES);
    expect(p.asked).toEqual([]);
    expect(logger.lines.join("\n")).not.toMatch(/Audio reports|E:/u);
  });

  it("asks once when the folder setting is empty, and stores the answer", async () => {
    const w = world();
    const p = prefs("");
    const result = await deliverAudio(request(chunksOf(11 * MiB)), deps(w, p));
    expect(result.kind).toBe("delivered");
    expect(p.asked).toHaveLength(1);
    expect(p.stored).toEqual([CHOSEN]);
    // The second run reads the stored folder and does not ask.
    await deliverAudio(request(chunksOf(11 * MiB)), deps(w, p));
    expect(p.asked).toHaveLength(1);
    expect(w.links[1]?.file).toBe(`${CHOSEN}/${STEM}-2.wav`);
  });

  it("asks again when the stored folder no longer exists", async () => {
    const w = world();
    const p = prefs("F:/gone");
    const result = await deliverAudio(request(chunksOf(11 * MiB)), deps(w, p));
    expect(result.kind).toBe("delivered");
    expect(p.asked).toHaveLength(1);
    expect(p.stored).toEqual([CHOSEN]);
  });

  it("refuses when the user cancels, and stores nothing or writes nothing", async () => {
    const w = world();
    const p = prefs("");
    const result = await deliverAudio(
      request(chunksOf(11 * MiB)),
      deps(w, p, [undefined]),
    );
    expect(result).toEqual({ kind: "refused", reason: "no-folder" });
    expect(p.stored).toEqual([]);
    expect(w.calls).toEqual([]);
  });

  it("refuses a temporary folder, stored or picked", async () => {
    const w = world();
    w.folders.add("C:/Temp/x");
    const p = prefs("C:/Temp/x");
    const result = await deliverAudio(
      request(chunksOf(11 * MiB)),
      deps(w, p, ["C:/Temp/x"]),
    );
    expect(result).toEqual({ kind: "refused", reason: "no-folder" });
    expect(p.asked).toHaveLength(1);
    expect(p.stored).toEqual([]);
    expect(w.calls).toEqual([]);
  });

  it("refuses a linked file outside the personal library before writing", async () => {
    const w = world();
    w.personal = false;
    const p = prefs(CHOSEN);
    const result = await deliverAudio(request(chunksOf(11 * MiB)), deps(w, p));
    expect(result).toEqual({
      kind: "refused",
      reason: "linked-needs-personal-library",
    });
    expect(w.calls).toEqual([]);
    // An import into the same group library is fine.
    const small = await deliverAudio(request(chunksOf(1000)), deps(w, p));
    expect(small.kind).toBe("delivered");
  });

  it("uses the folder the pre-check resolved", async () => {
    const w = world();
    w.folders.add("G:/Picked");
    const p = prefs(CHOSEN);
    await deliverAudio(
      request(chunksOf(11 * MiB), { linkedFolder: "G:/Picked" }),
      deps(w, p),
    );
    expect(w.links[0]?.file.startsWith("G:/Picked/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Refusals and the pre-check
// ---------------------------------------------------------------------------

describe("refusals before any write", () => {
  it("refuses a read-only library", async () => {
    const w = world();
    w.editable = false;
    const p = prefs("");
    const result = await deliverAudio(request(chunksOf(20 * MiB)), deps(w, p));
    expect(result).toEqual({ kind: "refused", reason: "read-only" });
    expect(w.calls).toEqual([]);
    expect(p.asked).toEqual([]);
  });

  it("refuses a missing collection", async () => {
    const w = world();
    w.collection = false;
    const result = await deliverAudio(
      request(chunksOf(1000)),
      deps(w, prefs()),
    );
    expect(result).toEqual({ kind: "refused", reason: "no-collection" });
    expect(w.calls).toEqual([]);
  });

  it("checks every chunk before writing anything", async () => {
    const w = world();
    const bad = [
      { pcm: new Uint8Array(10), sampleRateHz: 24000 },
      { pcm: new Uint8Array(10), sampleRateHz: 22050 },
    ];
    await expect(deliverAudio(request(bad), deps(w, prefs()))).rejects.toThrow(
      /sample rate/u,
    );
    expect(w.calls).toEqual([]);
  });
});

describe("checkAudioDestination (P6-T13 step 5)", () => {
  const input = { libraryID: 1, collectionKey: "COLL1234" } as const;

  it("is ready for an import without asking", async () => {
    const w = world();
    const p = prefs("");
    expect(
      await checkAudioDestination({ ...input, mode: "imported" }, deps(w, p)),
    ).toEqual({ kind: "ready" });
    expect(p.asked).toEqual([]);
  });

  it("refuses a read-only library and a missing collection", async () => {
    const w = world();
    w.editable = false;
    expect(
      await checkAudioDestination(
        { ...input, mode: "imported" },
        deps(w, prefs()),
      ),
    ).toEqual({ kind: "refused", reason: "read-only" });
    w.editable = true;
    w.collection = false;
    expect(
      await checkAudioDestination(
        { ...input, mode: "imported" },
        deps(w, prefs()),
      ),
    ).toEqual({ kind: "refused", reason: "no-collection" });
  });

  it("resolves the folder for a link, asking once when none is stored", async () => {
    const w = world();
    const p = prefs("");
    expect(
      await checkAudioDestination({ ...input, mode: "linked" }, deps(w, p)),
    ).toEqual({ kind: "ready", linkedFolder: CHOSEN });
    expect(p.asked).toHaveLength(1);
    expect(p.stored).toEqual([CHOSEN]);
  });

  it("refuses a link outside the personal library or with no folder", async () => {
    const w = world();
    w.personal = false;
    expect(
      await checkAudioDestination(
        { ...input, mode: "linked" },
        deps(w, prefs(CHOSEN)),
      ),
    ).toEqual({ kind: "refused", reason: "linked-needs-personal-library" });
    w.personal = true;
    expect(
      await checkAudioDestination(
        { ...input, mode: "linked" },
        deps(w, prefs(""), [undefined]),
      ),
    ).toEqual({ kind: "refused", reason: "no-folder" });
    expect(w.calls).toEqual([]);
  });
});

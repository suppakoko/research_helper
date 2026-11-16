/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `V-11` / `P0-T26`: binary audio lands on disk and becomes an attachment.
 *
 * `docs/13` §2.3's Attachments row — "writing a WAV file and attaching it to
 * an item; the attachment opens (FR-40)" — is this file. It exercises
 * `src/tts/audioStore.ts` against the real platform: `Zotero.DataDirectory.dir`
 * for the path, `PathUtils`/`IOUtils` for the file, `Zotero.Attachments` for
 * the item. **This spec is the module's only composition root today**; §2.3's
 * dependency rule keeps the `Zotero` global out of `src/tts/`, and
 * `P0-T26`'s two-file `Files` list has no `src/bootstrap/container.ts` in it.
 *
 * ## Where the audio comes from, and why it may differ between runs
 *
 * `P0-T25` writes its probe's raw PCM to `D:\ZoteroDev\tts\` precisely so this
 * card need not pay Gemini for synthesis again. That directory is one machine's
 * scratch folder, outside the repository, and the probe is human-gated — it may
 * never have run. So the spec **prefers** a real
 * `rh-p0t25-korean-<timestamp>.pcm` when one is there and **falls back** to a
 * synthetic 24 kHz mono 16-bit tone it generates itself, printing which it
 * used. Nothing here fails for the absence of the probe file, and nothing here
 * calls a network API (`docs/13` §2.3 forbids it).
 *
 * ## What is asserted
 *
 * 1. The WAV is written under a path derived from `Zotero.DataDirectory.dir`,
 *    and **not** under the profile directory (`docs/07` §8.4).
 * 2. The bytes on disk are a structurally valid RIFF/WAVE file: the tags, the
 *    little-endian fields, `ChunkSize === 36 + dataSize`, and the §3.1 format
 *    (24 kHz / 1 ch / 16-bit) — the two mistakes `docs/04` §3.3 calls out are
 *    read back from the file rather than trusted.
 * 3. The attachment item exists, is an attachment, hangs under the parent,
 *    carries `audio/wav`, has the `docs/04` §10.2 link mode the store chose,
 *    and its file is resolvable and readable through Zotero's own
 *    `getFilePathAsync()` — which is what "opens from the item pane" reduces
 *    to without a human at the keyboard.
 * 4. A hostile, LLM-shaped name (slashes, control characters, 400 characters,
 *    a Windows device name, the empty string) never reaches Zotero as a
 *    filename — `docs/01` §12 gotchas 18 and 19.
 *
 * 5. *(Added 2026-11-16, `plan/09` `P6-T13`.)* `deliverAudio` over the real
 *    adapter (`createZoteroAudioAttachments`, `src/zotero/attachments.ts`)
 *    puts a chunked WAV into a collection as a **standalone** attachment: a
 *    small one imported, with the data-directory copy removed afterwards; one
 *    over `IMPORT_MAX_BYTES` linked into a folder chosen through the injected
 *    picker. The folder is a permanent one under the throwaway data
 *    directory, never a temporary path (`docs/04` §10.2), and no path is
 *    logged by these two cases.
 *
 * **What it cannot assert: that the audio plays.** That needs ears. `P0-T26`'s
 * third `Done when` box stays open until a human opens the attachment from the
 * item pane and hears it.
 *
 * ## Cleanup
 *
 * Every item this spec creates is erased and every file it writes is removed,
 * including the `research-helper/audio` directory when the spec created it.
 * The runner's data directory is the throwaway `.scaffold/test/data`
 * (`P0-T13`), so this is belt and braces — but a spec that leaves litter in a
 * directory whose whole point is that it is the user's data directory is a
 * spec nobody can run twice.
 */

import {
  deliverAudio,
  type AudioDeliveryDeps,
} from "../../../src/pipeline/audioReport/deliver";
import {
  CHUNK_SILENCE_MS,
  GEMINI_PCM_FORMAT,
  IMPORT_MAX_BYTES,
  WAV_CONTENT_TYPE,
  WAV_HEADER_BYTES,
  audioFileName,
  chooseAttachmentMode,
  createAudioStore,
  pcmFormatFromMimeType,
  sanitizeFileStem,
  silencePcm,
  type AttachmentApi,
  type AudioFileSystem,
  type PcmChunk,
} from "../../../src/tts/audioStore";
import { createZoteroAudioAttachments } from "../../../src/zotero/attachments";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P0-T26]";
const TEST_TIMEOUT_MS = 60_000;

/**
 * `P0-T25`'s scratch folder (`scripts/spike-tts-korean.ts`, `OUTPUT_DIR`) and
 * its file stem. Deliberately one machine's absolute path: it is *optional*
 * input, checked for and skipped when absent, never a dependency.
 */
const PROBE_PCM_DIR = "D:\\ZoteroDev\\tts";
const PROBE_PCM_PREFIX = "rh-p0t25-korean-";

/** Synthetic fallback: a 0.5 s tone, i.e. 24,000 bytes of 16-bit mono PCM. */
const SYNTHETIC_SECONDS = 0.5;
const SYNTHETIC_TONE_HZ = 440;
const SYNTHETIC_AMPLITUDE = 0.25;

/** Titles carry the card ID so a stray item is identifiable if cleanup fails. */
const PARENT_TITLE = "research_helper P0-T26 binary/audio spike";

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

/**
 * Whether `text` holds a C0 control, DEL or a C1 control.
 *
 * A scan rather than a character class: the shared ESLint config's
 * `no-control-regex` forbids the literal, and this spec adds no rule
 * exemptions of its own beyond the file-level one every integration spec
 * carries.
 */
function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The composition root: the ports of src/tts/audioStore.ts, satisfied by the
// sandbox globals docs/01 §5.6 verified are present (IOUtils, PathUtils).
// ---------------------------------------------------------------------------

const files: AudioFileSystem = {
  join: (...segments) => PathUtils.join(...segments),
  makeDirectory: (path) =>
    IOUtils.makeDirectory(path, {
      createAncestors: true,
      ignoreExisting: true,
    }),
  writeFile: (path, bytes) => IOUtils.write(path, bytes),
  exists: (path) => IOUtils.exists(path),
};

/**
 * `Zotero.Attachments` satisfies {@link AttachmentApi} structurally — the port
 * was written from the shipped `xpcom/attachments.js`, so no cast is needed
 * and a signature drift would surface here as a compile error.
 */
const attachments: AttachmentApi = Zotero.Attachments;

function store() {
  return createAudioStore({
    dataDirectory: Zotero.DataDirectory.dir,
    files,
    attachments,
  });
}

// ---------------------------------------------------------------------------
// Audio input: the P0-T25 probe's bytes if they are there, synthetic if not.
// ---------------------------------------------------------------------------

interface AudioSource {
  readonly pcm: Uint8Array;
  readonly origin: "P0-T25 probe" | "synthetic";
  readonly describe: string;
}

/**
 * Signed 16-bit little-endian mono PCM at `GEMINI_PCM_FORMAT.sampleRateHz`,
 * generated here so the spec never depends on the human-gated probe having
 * run. A sine rather than silence: silence is indistinguishable from a bug
 * that writes zeroes.
 */
function syntheticPcm(): Uint8Array {
  const { sampleRateHz } = GEMINI_PCM_FORMAT;
  const frames = Math.round(sampleRateHz * SYNTHETIC_SECONDS);
  const pcm = new Uint8Array(frames * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(
      SYNTHETIC_AMPLITUDE *
        32767 *
        Math.sin((2 * Math.PI * SYNTHETIC_TONE_HZ * i) / sampleRateHz),
    );
    view.setInt16(i * 2, sample, true);
  }
  return pcm;
}

/** The newest `rh-p0t25-korean-*.pcm`, or `undefined` if there is none. */
async function probePcmPath(): Promise<string | undefined> {
  if (!(await IOUtils.exists(PROBE_PCM_DIR))) return undefined;
  const children = await IOUtils.getChildren(PROBE_PCM_DIR);
  const candidates = children
    .filter((path) => {
      const name = PathUtils.filename(path);
      return name.startsWith(PROBE_PCM_PREFIX) && name.endsWith(".pcm");
    })
    // The stem ends in a timestamp (scripts/spike-tts-korean.ts), so the
    // lexical maximum is the newest without a stat() per file.
    .sort();
  return candidates[candidates.length - 1];
}

async function audioSource(): Promise<AudioSource> {
  const probe = await probePcmPath();
  if (probe !== undefined) {
    const pcm = await IOUtils.read(probe);
    // A byte count that is not a whole number of 16-bit mono frames is not
    // what docs/04 §3.1 describes; fall back rather than write a broken WAV.
    if (pcm.byteLength >= 2 && pcm.byteLength % 2 === 0) {
      return {
        pcm,
        origin: "P0-T25 probe",
        describe: `${PathUtils.filename(probe)} (${pcm.byteLength} bytes)`,
      };
    }
    log(
      `ignoring ${probe}: ${pcm.byteLength} bytes is not whole 16-bit frames`,
    );
  }
  const pcm = syntheticPcm();
  return {
    pcm,
    origin: "synthetic",
    describe:
      `${SYNTHETIC_SECONDS}s ${SYNTHETIC_TONE_HZ} Hz tone ` +
      `(${pcm.byteLength} bytes) — no P0-T25 .pcm under ${PROBE_PCM_DIR}`,
  };
}

// ---------------------------------------------------------------------------
// Reading the header back off disk
// ---------------------------------------------------------------------------

interface WavHeader {
  readonly riff: string;
  readonly wave: string;
  readonly fmt: string;
  readonly data: string;
  readonly chunkSize: number;
  readonly audioFormat: number;
  readonly channels: number;
  readonly sampleRateHz: number;
  readonly byteRate: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
  readonly dataSize: number;
}

function parseWavHeader(bytes: Uint8Array): WavHeader {
  if (bytes.byteLength < WAV_HEADER_BYTES) {
    assert.fail(`file is ${bytes.byteLength} bytes; a WAV header is 44`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
  return {
    riff: tag(0),
    chunkSize: view.getUint32(4, true),
    wave: tag(8),
    fmt: tag(12),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRateHz: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: tag(36),
    dataSize: view.getUint32(40, true),
  };
}

// ---------------------------------------------------------------------------
// Cleanup bookkeeping
// ---------------------------------------------------------------------------

const createdItemIDs: number[] = [];
const writtenPaths: string[] = [];
/** Set when this spec created the audio directory, so it may remove it. */
let audioDirectoryWasCreated = false;

/**
 * A standalone parent item for the attachment (`docs/04` §10.1).
 *
 * `docs/01` §12 gotcha 29: `new Zotero.Item(type)` reaches `Zotero.ItemTypes`,
 * which throws `UnloadedDataException` before the schema is loaded. The
 * plugin's `onStartup` awaits `initializationPromise` / `unlockPromise` /
 * `uiReadyPromise` but **not** `schemaUpdatePromise`, so
 * `waitForPlugin` resolving is not the gate this needs; await it here.
 */
async function createParentItem(): Promise<Zotero.Item> {
  await Zotero.Schema.schemaUpdatePromise;
  const item = new Zotero.Item("document");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", PARENT_TITLE);
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

// ---------------------------------------------------------------------------
// The specs
// ---------------------------------------------------------------------------

describe("Audio file storage and attachment (P0-T26, V-11)", function () {
  // plan/00 §6 item 264: inside the describe, so it runs when this spec ends.
  after(async function () {
    for (const id of createdItemIDs.splice(0)) {
      const item = Zotero.Items.get(id) as Zotero.Item | false;
      if (item) {
        try {
          await item.eraseTx();
        } catch (error) {
          log(`could not erase item ${id}: ${String(error)}`);
        }
      }
    }
    for (const path of writtenPaths.splice(0)) {
      try {
        await IOUtils.remove(path, { ignoreAbsent: true });
      } catch (error) {
        log(`could not remove ${path}: ${String(error)}`);
      }
    }
    if (audioDirectoryWasCreated) {
      const directory = store().directory;
      try {
        // Only if this spec emptied it: recursive: false fails on a non-empty
        // directory, which is the behaviour wanted.
        await IOUtils.remove(directory, { ignoreAbsent: true });
        await IOUtils.remove(PathUtils.parent(directory) ?? directory, {
          ignoreAbsent: true,
        });
      } catch {
        // Something else is in there; leave it alone.
      }
    }
  });
  it("writes a valid WAV under the data directory and attaches it", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const audio = await audioSource();
    log(`audio source: ${audio.origin} — ${audio.describe}`);

    const audioStore = store();
    const dataDirectory = Zotero.DataDirectory.dir;
    audioDirectoryWasCreated = !(await IOUtils.exists(audioStore.directory));

    // docs/07 §8.4: the data directory, never the profile directory.
    assert.isTrue(
      audioStore.directory.startsWith(dataDirectory),
      `${audioStore.directory} is under ${dataDirectory}`,
    );
    assert.isFalse(
      audioStore.directory.startsWith(PathUtils.profileDir),
      `${audioStore.directory} is NOT under the profile directory ${PathUtils.profileDir}`,
    );

    // docs/04 §3.1 / §3.3: the format is parsed from the response's mimeType,
    // and Gemini's legacy mimeType is the one P0-T25 recorded.
    const format = pcmFormatFromMimeType("audio/L16;codec=pcm;rate=24000");
    assert.strictEqual(format.sampleRateHz, 24000, "rate= is parsed");

    const written = await audioStore.writeWav({
      stem: `rh-p0t26-${audio.origin === "synthetic" ? "synthetic" : "probe"}-${Date.now()}`,
      pcm: audio.pcm,
      format,
    });
    writtenPaths.push(written.path);

    assert.isTrue(
      await IOUtils.exists(written.path),
      `${written.path} exists on disk`,
    );
    assert.strictEqual(
      written.byteLength,
      WAV_HEADER_BYTES + audio.pcm.byteLength,
      "44-byte header plus the PCM payload",
    );
    assert.strictEqual(written.contentType, WAV_CONTENT_TYPE, "contentType");

    // Read the bytes back off disk — not the in-memory buffer — and check the
    // two things docs/04 §3.3 says are easy to get wrong.
    const onDisk = await IOUtils.read(written.path);
    assert.strictEqual(onDisk.byteLength, written.byteLength, "bytes on disk");
    const header = parseWavHeader(onDisk);
    assert.strictEqual(header.riff, "RIFF", "RIFF tag");
    assert.strictEqual(header.wave, "WAVE", "WAVE tag");
    assert.strictEqual(header.fmt, "fmt ", "fmt  tag");
    assert.strictEqual(header.data, "data", "data tag");
    assert.strictEqual(header.audioFormat, 1, "AudioFormat 1 = uncompressed");
    assert.strictEqual(header.dataSize, audio.pcm.byteLength, "dataSize");
    assert.strictEqual(
      header.chunkSize,
      36 + header.dataSize,
      "ChunkSize is 36 + dataSize, not 44 + dataSize (docs/04 §3.3 detail 2)",
    );
    // Little-endianness (detail 1): a big-endian header would read these as
    // absurd numbers rather than as docs/04 §3.1's table.
    assert.strictEqual(header.sampleRateHz, 24000, "24 kHz");
    assert.strictEqual(header.channels, 1, "mono");
    assert.strictEqual(header.bitsPerSample, 16, "16-bit");
    assert.strictEqual(header.blockAlign, 2, "blockAlign = channels × bytes");
    assert.strictEqual(header.byteRate, 48000, "byteRate = 24000 × 2");
    log(
      `WAV: ${written.fileName}, ${written.byteLength} bytes, ` +
        `${header.sampleRateHz} Hz / ${header.channels} ch / ` +
        `${header.bitsPerSample}-bit, ChunkSize ${header.chunkSize}`,
    );

    // docs/04 §10.2: which mode, and why.
    const expectedMode = chooseAttachmentMode(written.byteLength);
    assert.strictEqual(
      expectedMode,
      written.byteLength > IMPORT_MAX_BYTES ? "linked" : "imported",
      "mode follows docs/04 §10.2's size rule",
    );

    const parent = await createParentItem();
    const attachment = await audioStore.attach({
      file: written,
      parentItemID: parent.id,
      title: `Audio report (P0-T26, ${audio.origin})`,
    });
    createdItemIDs.unshift(attachment.itemID); // erase the child first
    assert.strictEqual(attachment.mode, expectedMode, "attachment mode");
    log(
      `attachment ${attachment.itemID} registered as ${attachment.mode} ` +
        `(docs/04 §10.2), parent ${parent.id}`,
    );

    const item = Zotero.Items.get(attachment.itemID) as Zotero.Item | false;
    if (!item) {
      assert.fail(`attachment item ${attachment.itemID} is not loadable`);
    }
    assert.isTrue(item.isAttachment(), "the created item is an attachment");
    assert.strictEqual(item.parentItemID, parent.id, "hangs under the parent");
    assert.strictEqual(
      item.attachmentContentType,
      WAV_CONTENT_TYPE,
      "contentType on the item (docs/04 §10.4)",
    );
    assert.strictEqual(
      item.attachmentLinkMode,
      attachment.mode === "imported"
        ? Zotero.Attachments.LINK_MODE_IMPORTED_FILE
        : Zotero.Attachments.LINK_MODE_LINKED_FILE,
      "link mode matches the chosen docs/04 §10.2 mode",
    );

    // "Opens from the item pane", minus the human: Zotero resolves the
    // attachment to a real file and that file is the WAV that was written.
    const attachedPath = await item.getFilePathAsync();
    if (attachedPath === false) {
      assert.fail("Zotero cannot resolve the attachment to a file");
    }
    assert.isTrue(
      await IOUtils.exists(attachedPath),
      `${attachedPath} exists on disk`,
    );
    const attachedBytes = await IOUtils.read(attachedPath);
    assert.strictEqual(
      parseWavHeader(attachedBytes).riff,
      "RIFF",
      "the attached file is a RIFF/WAVE file",
    );
    assert.strictEqual(
      attachedBytes.byteLength,
      written.byteLength,
      "the attached file is byte-for-byte the size that was written",
    );
    if (attachment.mode === "imported") {
      // importFromFile copies into storage; the source file stays where it is.
      assert.notStrictEqual(
        attachedPath,
        written.path,
        "an imported attachment lives in Zotero storage, not at the source",
      );
    } else {
      assert.strictEqual(
        attachedPath,
        written.path,
        "a linked attachment points at the data-directory file",
      );
    }
    log(`attachment file: ${attachedPath}`);
  });

  it("never lets a hostile filename reach Zotero (gotchas 18 and 19)", async function () {
    this.timeout(TEST_TIMEOUT_MS);

    const hostile = [
      "../../etc/passwd",
      "C:\\Windows\\System32\\evil",
      "report\u0000\u0007name",
      "NUL",
      "  .hidden.  ",
      "",
      "리서치 헬퍼 보고서: 2026/09/29",
      "x".repeat(400),
    ];
    for (const raw of hostile) {
      const name = audioFileName(raw, "wav");
      assert.isFalse(name.includes("/"), `no forward slash in "${name}"`);
      assert.isFalse(name.includes("\\"), `no backslash in "${name}"`);
      assert.isFalse(
        hasControlCharacter(name),
        `no control characters in "${name}"`,
      );
      assert.isAbove(name.length, 4, `"${raw}" produced a usable name`);
      assert.isAtMost(
        Array.from(name).length,
        64,
        `"${name}" is capped (docs/04 §10.3's 260-char path budget)`,
      );
    }
    // Hangul survives: docs/04 §10.3 keeps \p{L} so Korean names work.
    assert.isTrue(
      sanitizeFileStem("리서치 헬퍼 보고서: 2026/09/29").includes("리서치"),
      "Hangul is preserved",
    );

    // And the sanitised name really is acceptable to Zotero: attach a WAV
    // named from the worst of them and let the platform validate it.
    const audioStore = store();
    const written = await audioStore.writeWav({
      stem: `../../rh-p0t26-hostile\u0007${Date.now()}`,
      pcm: syntheticPcm(),
    });
    writtenPaths.push(written.path);
    assert.strictEqual(
      PathUtils.filename(written.path),
      written.fileName,
      "the written leaf name is the sanitised name",
    );

    const parent = await createParentItem();
    const attachment = await audioStore.attach({
      file: written,
      parentItemID: parent.id,
    });
    createdItemIDs.unshift(attachment.itemID);
    const item = Zotero.Items.get(attachment.itemID) as Zotero.Item | false;
    if (!item) {
      assert.fail(`attachment item ${attachment.itemID} is not loadable`);
    }
    assert.isTrue(item.isAttachment(), "Zotero accepted the sanitised name");
    log(`hostile-name attachment stored as "${written.fileName}"`);
  });
});

// ---------------------------------------------------------------------------
// P6-T13: delivery as a standalone attachment in a collection
// ---------------------------------------------------------------------------

const DELIVERY_PREFIX = "[P6-T13]";
const deliveryItemIDs: number[] = [];
const deliveryCollectionIDs: number[] = [];
const deliveryFolders: string[] = [];

/** `n` chunks of `bytesEach` of a quiet tone, as `synthesizeChunks` returns them. */
function toneChunks(n: number, bytesEach: number): PcmChunk[] {
  const one = new Uint8Array(bytesEach);
  const tone = syntheticPcm();
  for (let at = 0; at < bytesEach; at += tone.byteLength) {
    one.set(tone.subarray(0, Math.min(tone.byteLength, bytesEach - at)), at);
  }
  return Array.from({ length: n }, () => ({ pcm: one, sampleRateHz: 24000 }));
}

async function deliveryCollection(): Promise<Zotero.Collection> {
  await Zotero.Schema.schemaUpdatePromise;
  const collection = new Zotero.Collection({
    libraryID: Zotero.Libraries.userLibraryID,
    name: `research_helper P6-T13 delivery ${Date.now()}`,
  });
  await collection.saveTx();
  deliveryCollectionIDs.push(collection.id);
  return collection;
}

function deliveryDeps(
  linkedFolder: { value: string },
  picked: string | undefined,
  asked: { count: number },
): AudioDeliveryDeps {
  return {
    zotero: createZoteroAudioAttachments(),
    clock: { now: () => Date.now() },
    pickFolder: () => {
      asked.count += 1;
      return Promise.resolve(picked);
    },
    readLinkedFolder: () => linkedFolder.value,
    writeLinkedFolder: (path) => {
      linkedFolder.value = path;
    },
  };
}

async function checkStandaloneInCollection(
  key: string,
  collection: Zotero.Collection,
  linkMode: number,
): Promise<Zotero.Item> {
  const item = Zotero.Items.getByLibraryAndKey(
    Zotero.Libraries.userLibraryID,
    key,
  );
  if (item === false) assert.fail(`no attachment with the returned key`);
  deliveryItemIDs.push(item.id);
  assert.isTrue(item.isAttachment(), "an attachment");
  assert.isFalse(Boolean(item.parentItemID), "standalone: no parent item");
  assert.isTrue(
    item.getCollections().includes(collection.id),
    "in the report's collection",
  );
  assert.strictEqual(item.attachmentContentType, WAV_CONTENT_TYPE, "audio/wav");
  assert.strictEqual(item.attachmentLinkMode, linkMode, "link mode");
  const path = await item.getFilePathAsync();
  if (path === false) assert.fail("Zotero cannot resolve the attachment file");
  assert.isTrue(await IOUtils.exists(path), "the attachment's file exists");
  return item;
}

describe("Audio delivery into a collection (P6-T13)", function () {
  after(async function () {
    for (const id of deliveryItemIDs.splice(0)) {
      const item = Zotero.Items.get(id) as Zotero.Item | false;
      if (item) await item.eraseTx().catch(() => undefined);
    }
    for (const id of deliveryCollectionIDs.splice(0)) {
      const collection = Zotero.Collections.get(id);
      if (collection) await collection.eraseTx().catch(() => undefined);
    }
    for (const folder of deliveryFolders.splice(0)) {
      await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
    }
  });

  it("imports a small WAV with no parent and removes the written copy", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const collection = await deliveryCollection();
    const deps = deliveryDeps({ value: "" }, undefined, { count: 0 });
    const chunks = toneChunks(3, 24_000);
    const result = await deliverAudio(
      {
        report: {
          id: "rpt_p6t13_import",
          libraryID: Zotero.Libraries.userLibraryID,
          collectionKey: collection.key,
          collectionName: collection.name,
        },
        language: "en",
        chunks,
        sampleRateHz: 24000,
        usage: undefined,
        scriptUsage: undefined,
      },
      deps,
    );
    if (result.kind !== "delivered") assert.fail(`refused: ${result.reason}`);
    const { outcome } = result;
    const silence = silencePcm(CHUNK_SILENCE_MS).byteLength;
    assert.strictEqual(
      outcome.bytes,
      WAV_HEADER_BYTES + 3 * 24_000 + 2 * silence,
      "44 + chunks + two silences",
    );
    assert.strictEqual(outcome.mode, "imported", "at most 10 MiB is imported");
    const item = await checkStandaloneInCollection(
      outcome.attachmentKey,
      collection,
      Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
    );
    assert.isTrue(
      String(item.getField("title")).startsWith("Audio report (English), "),
      "FR-40's descriptive title",
    );
    const path = await item.getFilePathAsync();
    if (path === false) assert.fail("no file");
    const header = parseWavHeader(await IOUtils.read(path));
    assert.strictEqual(
      header.dataSize,
      outcome.bytes - WAV_HEADER_BYTES,
      "one header over the whole",
    );
    assert.isFalse(
      await IOUtils.exists(deps.zotero.store.pathFor(outcome.fileName)),
      "the data-directory copy is removed after the import (plan/09 §0.4 line 6)",
    );
    debug(
      `${DELIVERY_PREFIX} imported ${outcome.bytes} bytes as a standalone attachment`,
    );
  });

  it("links a WAV over 10 MiB into the chosen folder, asking once", async function () {
    this.timeout(TEST_TIMEOUT_MS * 2);
    const collection = await deliveryCollection();
    const folder = PathUtils.join(
      Zotero.DataDirectory.dir,
      `rh-p6t13-linked-${Date.now()}`,
    );
    await IOUtils.makeDirectory(folder, { createAncestors: true });
    deliveryFolders.push(folder);
    const stored = { value: "" };
    const asked = { count: 0 };
    const deps = deliveryDeps(stored, folder, asked);
    const half = Math.ceil(IMPORT_MAX_BYTES / 2 / 2) * 2 + 2;
    const result = await deliverAudio(
      {
        report: {
          id: "rpt_p6t13_link",
          libraryID: Zotero.Libraries.userLibraryID,
          collectionKey: collection.key,
          collectionName: collection.name,
        },
        language: "ko",
        chunks: toneChunks(2, half),
        sampleRateHz: 24000,
        usage: undefined,
        scriptUsage: undefined,
      },
      deps,
    );
    if (result.kind !== "delivered") assert.fail(`refused: ${result.reason}`);
    const { outcome } = result;
    assert.strictEqual(outcome.mode, "linked", "over 10 MiB is linked");
    assert.isAbove(outcome.bytes, IMPORT_MAX_BYTES, "over the threshold");
    assert.strictEqual(asked.count, 1, "the empty setting asked once");
    assert.strictEqual(stored.value, folder, "and stored the answer");
    const item = await checkStandaloneInCollection(
      outcome.attachmentKey,
      collection,
      Zotero.Attachments.LINK_MODE_LINKED_FILE,
    );
    const path = await item.getFilePathAsync();
    assert.strictEqual(
      path,
      PathUtils.join(folder, outcome.fileName),
      "the linked file is in the chosen folder",
    );
    assert.isTrue(
      outcome.fileName.endsWith("-ko.wav"),
      "named per docs/04 §10.3",
    );
    debug(
      `${DELIVERY_PREFIX} linked ${outcome.bytes} bytes as a standalone attachment`,
    );
  });
});

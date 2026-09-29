/**
 * Audio file storage and attachment — the `V-11` primitive.
 *
 * **Scope.** `P0-T26`. Three things and nothing else: wrap raw PCM in a WAV
 * container (`docs/04` §3.2–§3.3), write it under a plugin-owned path derived
 * from the Zotero **data** directory (`docs/07` §8.4), and register it as an
 * attachment on an item (`docs/01` §5.6, `docs/04` §10.2). Chunk
 * concatenation is `docs/04` §6 and Phase 6; the card's `Do NOT` list keeps it
 * out of here. Nothing in this file synthesizes audio or talks to a provider —
 * `src/tts/types.ts` (`P0-T25`) owns the wire shapes and
 * `scripts/spike-tts-korean.ts` owns the probe.
 *
 * ## Why every platform capability is injected
 *
 * `docs/07` §2.3 makes `src/zotero/` "the only directory permitted to
 * reference `Zotero.*`", and `eslint.config.js`'s `research-helper/zotero-global`
 * rule enforces that with `no-restricted-globals` over the whole tree bar
 * `src/zotero/**`, `addon/**` and the three lifecycle files. `P0-T26`'s `Files`
 * list puts this module in `src/tts/`, which is **not** one of those
 * exemptions, so naming `Zotero.DataDirectory`, `IOUtils`, `PathUtils` or
 * `Zotero.Attachments` here would either break the lint gate or need an
 * exemption the card does not authorise.
 *
 * The resolution is the one §2.3 itself prescribes and that
 * `src/core/http/client.ts` (`P0-T15`) already uses: this file declares
 * *ports* — {@link AudioFileSystem}, {@link AttachmentApi} — that describe
 * exactly the slice of the platform it uses, plus a `dataDirectory` string,
 * and a composition root supplies `PathUtils` / `IOUtils` /
 * `Zotero.Attachments` / `Zotero.DataDirectory.dir`. The data-directory path is
 * therefore still never hardcoded (the card's first `Do NOT`); it is simply
 * resolved one layer up. Everything in this file runs under plain Node with
 * fakes, which is what let `P0-T26` be verified offline.
 *
 * **There is no wiring yet.** `src/bootstrap/container.ts` does not exist and
 * is not in this card's `Files` list, so today the only composition root is
 * `test/integration/zotero/attachments.spec.ts`. Phase 6 wires it for real.
 *
 * ## The attachment API, read from the shipped client rather than remembered
 *
 * `docs/01` §12 gotcha 20 (`Zotero.Attachments.importEmbeddedItems` does not
 * exist — "Do not invent API names; grep the source") is why
 * {@link AttachmentApi} was written from a grep of the **installed** Zotero's
 * `chrome/content/zotero/xpcom/attachments.js`, extracted from
 * `C:\Program Files\Zotero\app\omni.ja` on 2026-09-29:
 *
 * ```js
 * this.importFromFile = async function (options) { … }   // line 63
 * this.linkFromFile   = async function (options) { … }   // line 187
 * ```
 *
 * with the JSDoc immediately above each one giving
 * `{file, libraryID?, parentItemID?, title?, collections?, fileBaseName?,
 * contentType?, charset?, saveOptions?}` for the first and the same set minus
 * `libraryID`/`fileBaseName` for the second, both returning
 * `Promise<Zotero.Item>`. That matches `docs/01` §5.6 exactly. The port below
 * is a subset of it, so `Zotero.Attachments` is assignable to the port with no
 * cast.
 */

import type { PcmFormat } from "./types";

// ---------------------------------------------------------------------------
// 1. Constants fixed by the design corpus
// ---------------------------------------------------------------------------

/**
 * `docs/04` §3.1's table: Gemini's legacy path returns signed 16-bit
 * little-endian mono PCM at 24,000 Hz with **no container**. Only
 * `sampleRateHz` is recoverable from the response (`rate=` in the `mimeType`,
 * §3.3); `channels` and `bitsPerSample` are the doc's assertion, not a
 * measurement — `src/tts/types.ts` says so on {@link PcmFormat} itself.
 */
export const GEMINI_PCM_FORMAT: PcmFormat = {
  sampleRateHz: 24000,
  channels: 1,
  bitsPerSample: 16,
};

/** The canonical RIFF/WAVE header is 44 bytes (`docs/04` §3.2). */
export const WAV_HEADER_BYTES = 44;

/**
 * `docs/04` §10.4: "Set `contentType` correctly … `audio/wav` for WAV.
 * Getting this wrong is the most common reason a Zotero attachment fails to
 * open in the right application."
 */
export const WAV_CONTENT_TYPE = "audio/wav";

/**
 * The plugin's own folder inside the data directory, and the audio folder
 * inside that. `docs/07` §8.4: plugin-owned files go in the **data**
 * directory — the place users back up and a library migration carries — and
 * the profile directory is reserved for the one tier-3 secrets file, which
 * audio is explicitly not.
 *
 * ASCII, lower-case, no separators of their own: they are joined through
 * {@link AudioFileSystem.join}, never concatenated with a literal `/` or `\`.
 */
export const PLUGIN_DIRECTORY_NAME = "research-helper";
/** @see PLUGIN_DIRECTORY_NAME */
export const AUDIO_DIRECTORY_NAME = "audio";

/**
 * At or below this size the audio is **imported** (copied into Zotero storage,
 * syncs, counts against quota); above it the file is **linked**.
 *
 * `docs/04` §10.2's table recommends imported for MP3 (~3.6 MB / 10 min) and
 * linked for WAV (~28.8 MB / 10 min), and its sketch encodes the rule as a
 * size test — `const useLink = wavBytes.byteLength > 10 * 1024 * 1024`. That
 * threshold is transcribed here rather than the "WAV ⇒ always linked" reading
 * of the table, because §10.4 wants imported wherever quota allows (imported
 * attachments are what Zotero sync carries to the phone, "the feature's whole
 * point") and a short clip is nowhere near the quota argument.
 *
 * Linking is safe *here* specifically because the file is written under the
 * data directory: §10.2's warning is that "for linked attachments the file
 * must live somewhere permanent … do not link to a temp path", and
 * {@link AudioStore.directory} is permanent. The `docs/01` §5.6 sketch, which
 * writes to `Zotero.getTempDirectory()` and deletes after importing, is the
 * import-only path and is deliberately not what this module does.
 */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Cap on a sanitised filename stem, in code points.
 *
 * `docs/04` §10.3 caps its slug at 60 and gives the reason: "cap the slug so
 * the full path stays under the Windows 260-character limit".
 */
export const MAX_FILE_STEM_LENGTH = 60;

/** What {@link sanitizeFileStem} returns when nothing usable is left. */
export const FALLBACK_FILE_STEM = "audio";

// ---------------------------------------------------------------------------
// 2. WAV container — docs/04 §3.3, transcribed
// ---------------------------------------------------------------------------

/**
 * Wrap raw PCM samples in a canonical 44-byte RIFF/WAVE header.
 *
 * Transcribed from `docs/04` §3.3's dependency-free writer rather than
 * re-derived, including the two correctness details that section calls out:
 *
 * 1. **Every multi-byte field is little-endian** — the `true` third argument
 *    to every `setUint32`/`setUint16`. A big-endian header produces a file
 *    that opens but plays as noise.
 * 2. **`ChunkSize` at offset 4 is `36 + dataSize`, not `44 + dataSize`.** It
 *    counts everything after the first 8 bytes.
 *
 * The only departures from §3.3's JavaScript: the options object is a required
 * {@link PcmFormat} defaulting to {@link GEMINI_PCM_FORMAT} instead of three
 * `??` defaults, and the two guards below. §3.3's own helpers
 * `base64ToBytes` (it uses `atob`, which `docs/01` §2.3's measured sandbox
 * global list does name) and `sampleRateFromMime` are not duplicated here:
 * decoding a provider response belongs to the TTS adapter, and
 * {@link pcmFormatFromMimeType} is this module's use of the latter.
 *
 * @param pcm - raw PCM sample bytes, no header
 * @param format - defaults to Gemini's legacy output (`docs/04` §3.1)
 * @returns complete `.wav` file bytes
 */
export function pcmToWav(
  pcm: Uint8Array,
  format: PcmFormat = GEMINI_PCM_FORMAT,
): Uint8Array {
  const { sampleRateHz, channels, bitsPerSample } = format;
  if (
    !Number.isInteger(sampleRateHz) ||
    sampleRateHz <= 0 ||
    !Number.isInteger(channels) ||
    channels <= 0 ||
    !Number.isInteger(bitsPerSample) ||
    bitsPerSample <= 0 ||
    bitsPerSample % 8 !== 0
  ) {
    throw new RangeError(
      `invalid PCM format: ${sampleRateHz} Hz, ${channels} ch, ` +
        `${bitsPerSample}-bit`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;
  const dataSize = pcm.byteLength;

  // Not in §3.3. `setUint32` truncates silently, so a payload this large would
  // write a header that disagrees with the file — a WAV is a 32-bit format and
  // the caller has to chunk (which is docs/04 §6, Phase 6). Fail loudly.
  if (dataSize > 0xffffffff - 36) {
    throw new RangeError(
      `PCM payload of ${dataSize} bytes does not fit a 32-bit RIFF ChunkSize`,
    );
  }

  const header = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(header);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  // ── RIFF chunk descriptor ──────────────────────────────────────────────
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // 4 + (8+16) + (8+dataSize)
  ascii(8, "WAVE");

  // ── "fmt " sub-chunk (PCM, 16 bytes) ───────────────────────────────────
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size = 16 for PCM
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM, uncompressed)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // ── "data" sub-chunk ───────────────────────────────────────────────────
  ascii(36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(WAV_HEADER_BYTES + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, WAV_HEADER_BYTES);
  return out;
}

/**
 * `docs/04` §3.3: parse `audio/L16;codec=pcm;rate=24000` → a {@link PcmFormat}.
 *
 * §3.3's `sampleRateFromMime` falls back to 24000, and so does this. The
 * channel count and bit depth are **not in the response at all** (`docs/04`
 * §3.1, and the note on {@link PcmFormat} in `src/tts/types.ts`), so they are
 * carried from {@link GEMINI_PCM_FORMAT} rather than guessed from the MIME
 * type's `L16`.
 */
export function pcmFormatFromMimeType(
  mimeType: string | null | undefined,
): PcmFormat {
  const match = /rate=(\d+)/.exec(mimeType ?? "");
  const rate = match?.[1];
  const parsed = rate === undefined ? Number.NaN : Number.parseInt(rate, 10);
  return {
    sampleRateHz:
      Number.isInteger(parsed) && parsed > 0
        ? parsed
        : GEMINI_PCM_FORMAT.sampleRateHz,
    channels: GEMINI_PCM_FORMAT.channels,
    bitsPerSample: GEMINI_PCM_FORMAT.bitsPerSample,
  };
}

// ---------------------------------------------------------------------------
// 3. Filenames — docs/01 §12 gotchas 18 and 19
// ---------------------------------------------------------------------------

/**
 * Characters Zotero's own `Zotero.File.getValidFileName()` strips, read from
 * the shipped `chrome/content/zotero/xpcom/file.js` (line 1600) in
 * `C:\Program Files\Zotero\app\omni.ja` on 2026-09-29:
 * `fileName.replace(/[\/\\\?\*:|"<>]/g, '')`.
 *
 * Both path separators are in that set, which is what `docs/01` §12 gotcha 18
 * needs: Zotero 10's `attachmentFilename` / `attachmentPath` setters throw on
 * a value containing slashes.
 */
const INVALID_FILENAME_CHARS = /[/\\?*:|"<>]/g;

/**
 * The same set without the `g` flag, for {@link assertLeafName}. A global
 * regex carries `lastIndex` across `.test()` calls and would answer `false`
 * every other time.
 */
const INVALID_FILENAME_CHAR = /[/\\?*:|"<>]/;

/**
 * Whether a code point is a C0 control, DEL, or a C1 control — gotcha 19's
 * "control characters".
 *
 * A predicate rather than a character-class regex on purpose: the shared
 * config's `no-control-regex` forbids the literal, and disabling a rule to
 * write the obvious regex is worse than the three-line scan in
 * {@link stripControlCharacters}. Tabs and newlines are handled before this
 * runs, by {@link LINE_BREAKS}.
 */
function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** Drop every character {@link isControlCodePoint} matches. */
function stripControlCharacters(text: string): string {
  let out = "";
  for (const character of text) {
    if (!isControlCodePoint(character.codePointAt(0) ?? 0)) out += character;
  }
  return out;
}

/** Tabs and newlines become a space, as `getValidFileName()` does. */
const LINE_BREAKS = /[\r\n\t]+/g;

/**
 * Zero-width and bidi-control characters. `getValidFileName()` strips
 * `\u200B-\u200E` and the bidi isolates `\u2068\u2069`; the line and paragraph
 * separators `\u2028\u2029` and the thin spaces `\u2000-\u200A` become spaces
 * there and here.
 */
const ZERO_WIDTH_CHARS = /[\u200B-\u200F\u2060\u2066-\u2069\uFEFF]/g;
/** @see ZERO_WIDTH_CHARS */
const EXOTIC_SPACES = /[\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

/**
 * Windows reserved device names, which cannot be a filename or a stem even
 * with an extension. Not handled by `getValidFileName()`; added because
 * `docs/04` §10.3 requires names "safe on Windows/macOS/Linux" and this
 * machine is Windows.
 */
const RESERVED_DEVICE_NAMES =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

/**
 * Make an arbitrary string safe to use as a filename stem.
 *
 * `docs/01` §12 gotcha 19: "LLM-generated text used as a filename or
 * collection name must be sanitised. Strip path separators and control
 * characters, cap length, and handle the empty string." All four, in order,
 * plus the Windows-specific rules a trend-report title will hit in practice.
 * Gotcha 18 is covered by the same pass: no `/` or `\` survives it, so a name
 * from here can never make `attachmentFilename` throw.
 *
 * Unicode letters are **kept**, including Hangul: `docs/04` §10.3 is explicit
 * that a Korean collection name must survive naming. Only the characters that
 * are unsafe are removed.
 *
 * @param raw - any string, including one an LLM produced
 * @param options.maxLength - code points to keep; {@link MAX_FILE_STEM_LENGTH}
 * @param options.fallback - used when nothing survives; {@link FALLBACK_FILE_STEM}
 */
export function sanitizeFileStem(
  raw: string,
  options: { readonly maxLength?: number; readonly fallback?: string } = {},
): string {
  const maxLength = options.maxLength ?? MAX_FILE_STEM_LENGTH;
  const fallback = options.fallback ?? FALLBACK_FILE_STEM;
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new RangeError(
      `maxLength must be a positive integer, got ${maxLength}`,
    );
  }

  let name = raw.normalize("NFC");
  name = name.replace(LINE_BREAKS, " ");
  name = name.replace(INVALID_FILENAME_CHARS, "");
  name = stripControlCharacters(name);
  name = name.replace(ZERO_WIDTH_CHARS, "");
  name = name.replace(EXOTIC_SPACES, " ");
  name = name.replace(/\s+/g, " ").trim();
  // No hidden files, and Windows forbids a trailing dot or space.
  name = name
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  // Cap by code point, never mid-surrogate — a split pair is an unpaired
  // surrogate, which getValidFileName() strips and which no filesystem wants.
  if (Array.from(name).length > maxLength) {
    name = Array.from(name).slice(0, maxLength).join("");
    name = name.replace(/[. ]+$/, "").trim();
  }
  if (RESERVED_DEVICE_NAMES.test(name)) {
    name = `_${name}`;
  }
  if (name === "" || name === "." || name === "..") {
    return fallback;
  }
  return name;
}

/**
 * A sanitised `<stem>.<extension>` leaf name. Never contains a separator, so
 * it is safe to hand to Zotero (`docs/01` §12 gotcha 18).
 *
 * The extension is reduced to ASCII alphanumerics and lower-cased; an
 * extension that survives as empty is dropped rather than leaving a trailing
 * dot, which Windows rejects.
 */
export function audioFileName(stem: string, extension = "wav"): string {
  const safeStem = sanitizeFileStem(stem);
  const safeExtension = extension.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return safeExtension === "" ? safeStem : `${safeStem}.${safeExtension}`;
}

/**
 * Throw if `fileName` is not a bare leaf name.
 *
 * The belt to {@link sanitizeFileStem}'s braces: `docs/01` §12 gotcha 18 makes
 * a slash in a filename a *throw* deep inside Zotero, so this module refuses
 * it at its own boundary, where the message names the cause.
 */
function assertLeafName(fileName: string): void {
  if (fileName === "" || INVALID_FILENAME_CHAR.test(fileName)) {
    throw new RangeError(
      `"${fileName}" is not a bare filename (docs/01 §12 gotcha 18)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Ports — the exact slice of the platform this module uses
// ---------------------------------------------------------------------------

/**
 * File-system operations, as the plugin sandbox provides them.
 *
 * `docs/01` §5.6 (verified 2026-09-08) records that `IOUtils` and `PathUtils`
 * are assigned directly into the plugin sandbox's global scope by
 * `_loadScope()`, so a composition root inside `src/zotero/` can satisfy this
 * port with four one-line adapters. The shapes match Gecko 140's
 * `IOUtils.write(path, data, options?) => Promise<number>`,
 * `IOUtils.makeDirectory(path, options?) => Promise<void>`,
 * `IOUtils.exists(path) => Promise<boolean>` and
 * `PathUtils.join(...components) => string`; the writes return `unknown` here
 * so `IOUtils.write`'s byte count is assignable without a wrapper.
 */
export interface AudioFileSystem {
  /** `PathUtils.join`. The only place a path separator is ever produced. */
  join(...segments: string[]): string;
  /**
   * Create the directory and any missing ancestors, succeeding if it already
   * exists — `IOUtils.makeDirectory(path, { createAncestors: true,
   * ignoreExisting: true })`.
   */
  makeDirectory(path: string): Promise<unknown>;
  /** `IOUtils.write`. Overwrites. */
  writeFile(path: string, bytes: Uint8Array): Promise<unknown>;
  /** `IOUtils.exists`. */
  exists(path: string): Promise<boolean>;
}

/**
 * The options both attachment calls take, as the shipped
 * `xpcom/attachments.js` declares them (see the file header). Only the
 * members this module passes are listed; `collections`, `charset`,
 * `fileBaseName`, `libraryID` and `saveOptions` exist but are not used here.
 *
 * `file` is typed `string` because Zotero calls `Zotero.File.pathToFile()` on
 * it and accepts `nsIFile|String`; a path keeps the port Node-testable.
 */
export interface AttachmentFromFileOptions {
  readonly file: string;
  readonly parentItemID?: number;
  readonly title?: string;
  readonly contentType?: string;
}

/** As much of a created attachment item as this module reads back. */
export interface AttachedItem {
  readonly id: number;
}

/**
 * `Zotero.Attachments`, as far as this module is concerned.
 *
 * Exactly two methods, both verified present in the installed client's
 * `chrome/content/zotero/xpcom/attachments.js` (lines 63 and 187) on
 * 2026-09-29. `docs/01` §12 gotcha 20's lesson — grep the source, do not
 * invent a name — is why that grep is recorded rather than the API being
 * quoted from memory.
 */
export interface AttachmentApi {
  /** Copies the file into Zotero storage; syncs; counts against quota. */
  importFromFile(options: AttachmentFromFileOptions): Promise<AttachedItem>;
  /** Leaves the file where it is and stores the path; does not sync. */
  linkFromFile(options: AttachmentFromFileOptions): Promise<AttachedItem>;
}

/** Which of `docs/04` §10.2's two modes an attachment used. */
export type AttachmentMode = "imported" | "linked";

/**
 * `docs/04` §10.2's rule as a function: import what is small enough to sync,
 * link what is not. See {@link IMPORT_MAX_BYTES} for why the threshold is a
 * size test rather than a file-type test.
 */
export function chooseAttachmentMode(byteLength: number): AttachmentMode {
  return byteLength > IMPORT_MAX_BYTES ? "linked" : "imported";
}

// ---------------------------------------------------------------------------
// 5. The store
// ---------------------------------------------------------------------------

/** A file this module wrote. */
export interface WrittenAudioFile {
  /** Absolute path, always inside {@link AudioStore.directory}. */
  readonly path: string;
  /** Bare leaf name, separator-free (`docs/01` §12 gotcha 18). */
  readonly fileName: string;
  /** Bytes on disk, i.e. `44 + pcm.byteLength` for a WAV. */
  readonly byteLength: number;
  /** The PCM format written into the header. */
  readonly format: PcmFormat;
  /** `docs/04` §10.4's "set `contentType` correctly". */
  readonly contentType: string;
}

/** The outcome of registering a {@link WrittenAudioFile} on an item. */
export interface AudioAttachment {
  readonly itemID: number;
  /** Which `docs/04` §10.2 mode was used — `P0-T26` step 5 records this. */
  readonly mode: AttachmentMode;
  readonly path: string;
  readonly fileName: string;
  readonly contentType: string;
}

/** What {@link AudioStore.writeWav} is asked for. */
export interface WriteWavRequest {
  /** Filename stem; sanitised before use, so any string is safe to pass. */
  readonly stem: string;
  /** Raw PCM sample bytes, no container (`docs/04` §3.1). */
  readonly pcm: Uint8Array;
  /** Defaults to {@link GEMINI_PCM_FORMAT}. */
  readonly format?: PcmFormat;
}

/** What {@link AudioStore.attach} is asked for. */
export interface AttachRequest {
  readonly file: WrittenAudioFile;
  /** The item the attachment hangs under (`docs/04` §10.1's parent item). */
  readonly parentItemID: number;
  /** Attachment title; defaults to the file name. */
  readonly title?: string;
  /** Defaults to {@link chooseAttachmentMode} of the file's size. */
  readonly mode?: AttachmentMode;
}

/** Write audio into the data directory and register it on an item. */
export interface AudioStore {
  /** `<dataDirectory>/research-helper/audio`. */
  readonly directory: string;
  /** The absolute path a given leaf name would occupy. */
  pathFor(fileName: string): string;
  /** Wrap PCM in a WAV container and write it. Creates the directory. */
  writeWav(request: WriteWavRequest): Promise<WrittenAudioFile>;
  /** Register a written file as an attachment (`docs/04` §10.2). */
  attach(request: AttachRequest): Promise<AudioAttachment>;
}

/**
 * Build the store.
 *
 * @param deps.dataDirectory - `Zotero.DataDirectory.dir`, supplied by the
 *   composition root. `docs/07` §8.4: the data directory is user-relocatable,
 *   so it is never hardcoded — and it is never the **profile** directory,
 *   whose single sanctioned use is the tier-3 secrets file.
 * @param deps.files - `PathUtils` / `IOUtils` (`docs/01` §5.6)
 * @param deps.attachments - `Zotero.Attachments` (`docs/01` §5.6)
 */
export function createAudioStore(deps: {
  readonly dataDirectory: string;
  readonly files: AudioFileSystem;
  readonly attachments: AttachmentApi;
}): AudioStore {
  const { dataDirectory, files, attachments } = deps;
  if (dataDirectory.trim() === "") {
    throw new RangeError(
      "dataDirectory must be Zotero.DataDirectory.dir (docs/07 §8.4)",
    );
  }

  const directory = files.join(
    dataDirectory,
    PLUGIN_DIRECTORY_NAME,
    AUDIO_DIRECTORY_NAME,
  );

  const pathFor = (fileName: string): string => {
    assertLeafName(fileName);
    return files.join(directory, fileName);
  };

  return {
    directory,
    pathFor,

    async writeWav(request) {
      const format = request.format ?? GEMINI_PCM_FORMAT;
      const fileName = audioFileName(request.stem, "wav");
      const path = pathFor(fileName);
      const bytes = pcmToWav(request.pcm, format);

      await files.makeDirectory(directory);
      await files.writeFile(path, bytes);

      return {
        path,
        fileName,
        byteLength: bytes.byteLength,
        format,
        contentType: WAV_CONTENT_TYPE,
      };
    },

    async attach(request) {
      const { file, parentItemID } = request;
      assertLeafName(file.fileName);
      const mode = request.mode ?? chooseAttachmentMode(file.byteLength);
      const options: AttachmentFromFileOptions = {
        file: file.path,
        parentItemID,
        title: request.title ?? file.fileName,
        contentType: file.contentType,
      };

      const item =
        mode === "imported"
          ? await attachments.importFromFile(options)
          : await attachments.linkFromFile(options);

      return {
        itemID: item.id,
        mode,
        path: file.path,
        fileName: file.fileName,
        contentType: file.contentType,
      };
    },
  };
}

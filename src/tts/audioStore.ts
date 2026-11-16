/**
 * Audio file storage and attachment — the `V-11` primitive.
 *
 * **Scope.** `P0-T26`. Three things and nothing else: wrap raw PCM in a WAV
 * container (`docs/04` §3.2–§3.3), write it under a plugin-owned path derived
 * from the Zotero **data** directory (`docs/07` §8.4), and register it as an
 * attachment on an item (`docs/01` §5.6, `docs/04` §10.2). Chunk
 * concatenation is `docs/04` §6 and Phase 6; the card's `Do NOT` list keeps it
 * out of here. *(Extended 2026-11-16, `plan/09` `P6-T12`: section 2a below now
 * joins N PCM chunks into one WAV — 250 ms of silence between chunks, exactly
 * one header, written header-first and appended chunk by chunk — and every
 * `P0-T26` export is kept, since `test/integration/zotero/attachments.spec.ts`
 * imports them.)* Nothing in this file synthesizes audio or talks to a provider —
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
 * *(2026-11-16, `P6-T13`: `createZoteroAudioAttachments` in
 * `src/zotero/attachments.ts` now builds the store over the platform, and
 * `P6-T16` constructs that in `src/bootstrap/registerPipelines.ts`.)*
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

import { TTSError } from "../core/errors";
import type { Logger } from "../core/logger";

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
  assertPcmFormat(format);
  const out = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  out.set(wavHeader(pcm.byteLength, format), 0);
  out.set(pcm, WAV_HEADER_BYTES);
  return out;
}

/**
 * `pcmToWav`'s format guard, shared with {@link wavHeader} and
 * {@link silencePcm} since `P6-T12` (the message is unchanged).
 */
function assertPcmFormat(format: PcmFormat): PcmFormat {
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
  return format;
}

/** Bytes per sample frame: every channel's sample once. */
function frameBytes(format: PcmFormat): number {
  return format.channels * (format.bitsPerSample / 8);
}

/**
 * The canonical 44-byte RIFF/WAVE header for `dataBytes` of PCM in `format`
 * (`plan/09` `P6-T12` step 2): the header {@link pcmToWav} prepends, built
 * on its own so a chunked file can be written header first and its samples
 * appended after it (`docs/04` §6.3's memory note). The two §3.3 details hold:
 * every multi-byte field is little-endian, and `ChunkSize` at offset 4 is
 * `36 + dataBytes`.
 *
 * @param dataBytes - the PCM byte count the file will carry
 * @param format - defaults to Gemini's legacy output (`docs/04` §3.1)
 * @returns the 44 header bytes
 */
export function wavHeader(
  dataBytes: number,
  format: PcmFormat = GEMINI_PCM_FORMAT,
): Uint8Array {
  const { sampleRateHz, channels, bitsPerSample } = assertPcmFormat(format);
  if (!Number.isInteger(dataBytes) || dataBytes < 0) {
    throw new RangeError(`invalid PCM byte count: ${dataBytes}`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;
  const dataSize = dataBytes;
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

  return new Uint8Array(header);
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
// 2a. Joining chunks — docs/04 §6 (`plan/09` `P6-T12`)
// ---------------------------------------------------------------------------

/** `docs/04` §6.2's `SILENCE_MS`: the beat between two chunks. */
export const CHUNK_SILENCE_MS = 250;

/**
 * `ms` milliseconds of digital silence (all-zero samples) in `format`
 * (`docs/04` §6.2's `silencePcm`, `plan/09` `P6-T12` step 1).
 *
 * The length is `round(ms × rate / 1000)` sample frames times the frame
 * size, so it is a whole number of frames by construction — for 16-bit mono,
 * always even, which is §6.3's first correctness note (an odd length shifts
 * every later sample by one byte and turns the rest of the file into noise).
 * 250 ms at 24 kHz is 6,000 frames, 12,000 bytes.
 *
 * @param ms - a non-negative duration
 * @param format - defaults to Gemini's legacy output (`docs/04` §3.1)
 */
export function silencePcm(
  ms: number,
  format: PcmFormat = GEMINI_PCM_FORMAT,
): Uint8Array {
  assertPcmFormat(format);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`invalid silence length: ${ms} ms`);
  }
  const frames = Math.round((ms * format.sampleRateHz) / 1000);
  return new Uint8Array(frames * frameBytes(format));
}

/** One synthesized chunk as the assembler takes it. */
export interface PcmChunk {
  /** Raw PCM; a whole WAV handed in by mistake is tolerated (§2.4). */
  readonly pcm: Uint8Array;
  /** The rate the provider reported for this chunk (`docs/04` §3.3). */
  readonly sampleRateHz: number;
}

/** `RIFF` — the first four bytes of a WAV file (`docs/04` §2.4). */
function startsWithRiff(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  );
}

function asciiAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * `docs/04` §2.4's sanity check, acted on (`plan/09` `P6-T12` step 4): a
 * chunk whose first four bytes are `RIFF` is a whole WAV, not bare samples.
 * Its sub-chunks are walked from offset 12 to the `data` sub-chunk, and only
 * the samples after that are kept — wrapping it again would give the
 * double-headered file §2.4 describes. A `fmt ` sub-chunk that disagrees
 * with `format` stops the join (§6.4: no transcoding or resampling).
 * The strip is logged by chunk index and header length, never by content.
 */
function stripRiffHeader(
  bytes: Uint8Array,
  index: number,
  format: PcmFormat,
  logger: Logger | undefined,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || asciiAt(bytes, 8) !== "WAVE") {
    throw new TTSError(
      `chunk ${index} begins with RIFF but is not a WAVE file; refusing to join it`,
      { reason: "unsupported-format", chunk: index },
    );
  }
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = asciiAt(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.byteLength) {
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (rate !== format.sampleRateHz) {
        throw sampleRateMismatch(index, rate, format.sampleRateHz);
      }
      if (channels !== format.channels || bits !== format.bitsPerSample) {
        throw new TTSError(
          `chunk ${index} is a ${channels}-channel ${bits}-bit WAV; ` +
            "refusing to join it (docs/04 §6.4: no transcoding)",
          { reason: "unsupported-format", chunk: index },
        );
      }
    }
    if (id === "data") {
      const end = Math.min(body + size, bytes.byteLength);
      logger?.warn("tts.chunk.wav-header-stripped", {
        chunk: index,
        headerBytes: body,
      });
      return bytes.subarray(body, end);
    }
    offset = body + size + (size % 2);
  }
  throw new TTSError(
    `chunk ${index} is a WAVE file with no data sub-chunk; refusing to join it`,
    { reason: "unsupported-format", chunk: index },
  );
}

/**
 * The same `TTSError` reason `P6-T11`'s `synthesizeChunks` uses for a rate
 * change between chunks, so the job reports one failure either way.
 */
function sampleRateMismatch(
  index: number,
  got: number,
  expected: number,
): TTSError {
  return new TTSError(
    `sample rate changed: chunk ${index} is ${got} Hz, expected ` +
      `${expected} Hz; refusing to join them (docs/04 §6.3)`,
    { reason: "sample-rate", chunk: index, expected, got },
  );
}

/**
 * Check every chunk against `format` and reduce each to bare samples: one
 * sample rate for the whole file (`docs/04` §6.3), a whole number of sample
 * frames per chunk, and a stray WAV header stripped.
 */
function prepareChunks(
  chunks: readonly PcmChunk[],
  format: PcmFormat,
  logger: Logger | undefined,
): Uint8Array[] {
  assertPcmFormat(format);
  if (chunks.length === 0) {
    throw new RangeError("no audio chunks to join");
  }
  const frame = frameBytes(format);
  return chunks.map((chunk, index) => {
    if (chunk.sampleRateHz !== format.sampleRateHz) {
      throw sampleRateMismatch(index, chunk.sampleRateHz, format.sampleRateHz);
    }
    const pcm = startsWithRiff(chunk.pcm)
      ? stripRiffHeader(chunk.pcm, index, format, logger)
      : chunk.pcm;
    if (pcm.byteLength % frame !== 0) {
      throw new RangeError(
        `chunk ${index} is ${pcm.byteLength} bytes, not a whole number of ` +
          `${frame}-byte sample frames`,
      );
    }
    return pcm;
  });
}

/** Options shared by {@link concatPcm} and {@link AudioStore.writeChunkedWav}. */
export interface JoinOptions {
  /** Defaults to {@link GEMINI_PCM_FORMAT}. */
  readonly format?: PcmFormat;
  /** Told when a chunk's stray WAV header is stripped. */
  readonly logger?: Logger;
}

function joinedByteLength(
  pcms: readonly Uint8Array[],
  silence: Uint8Array,
): number {
  const samples = pcms.reduce((total, pcm) => total + pcm.byteLength, 0);
  return samples + silence.byteLength * (pcms.length - 1);
}

/** Copy `pcms` into `out` from `start`, with `silence` between them. */
function fillJoined(
  out: Uint8Array,
  start: number,
  pcms: readonly Uint8Array[],
  silence: Uint8Array,
): void {
  let offset = start;
  pcms.forEach((pcm, index) => {
    if (index > 0) {
      out.set(silence, offset);
      offset += silence.byteLength;
    }
    out.set(pcm, offset);
    offset += pcm.byteLength;
  });
}

/**
 * Join chunks into one flat PCM buffer: chunk 1, 250 ms of silence, chunk 2,
 * … — no silence after the last (`docs/04` §6.2). Every check of
 * {@link prepareChunks} applies. The store's chunked write does not use this
 * when the file system can append; it is the fallback and the reference.
 */
export function concatPcm(
  chunks: readonly PcmChunk[],
  options: JoinOptions = {},
): Uint8Array {
  const format = options.format ?? GEMINI_PCM_FORMAT;
  const pcms = prepareChunks(chunks, format, options.logger);
  const silence = silencePcm(CHUNK_SILENCE_MS, format);
  const out = new Uint8Array(joinedByteLength(pcms, silence));
  fillJoined(out, 0, pcms, silence);
  return out;
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
  /**
   * `IOUtils.write(path, bytes, { mode: "append" })` — added 2026-11-16 by
   * `plan/09` `P6-T12`. The option's name was read from the installed
   * Zotero's `chrome/content/zotero/xpcom/http.js`, which appends with
   * exactly that call, and `zotero-types` declares `WriteMode` as
   * `"append" | "appendOrCreate" | "create" | "overwrite"`. Optional so the
   * `P0-T26` adapters keep compiling; without it
   * {@link AudioStore.writeChunkedWav} builds one flat buffer instead.
   */
  appendFile?(path: string, bytes: Uint8Array): Promise<unknown>;
  /** `IOUtils.exists`. */
  exists(path: string): Promise<boolean>;
}

/**
 * The options both attachment calls take, as the shipped
 * `xpcom/attachments.js` declares them (see the file header). Only the
 * members this module passes are listed; `charset`, `fileBaseName` and
 * `saveOptions` exist but are not used here.
 *
 * *(Extended 2026-11-16, `plan/09` `P6-T13`: `libraryID` and `collections`,
 * for a standalone attachment in a collection.)* Read again in the installed
 * client's `attachments.js` that day: `importFromFile` sets the new item's
 * library from `libraryID` when there is no parent and calls
 * `setCollections(collections)`; `linkFromFile` reads **no** `libraryID` —
 * its `_addToDB` takes the library from the parent only — and both throw
 * "parentItemID and collections cannot both be provided".
 *
 * `file` is typed `string` because Zotero calls `Zotero.File.pathToFile()` on
 * it and accepts `nsIFile|String`; a path keeps the port Node-testable.
 */
export interface AttachmentFromFileOptions {
  readonly file: string;
  readonly parentItemID?: number;
  readonly title?: string;
  readonly contentType?: string;
  /** `importFromFile` only; `linkFromFile` ignores it. */
  readonly libraryID?: number;
  /** Collection keys or ids the new item is added to. */
  readonly collections?: string[];
}

/** As much of a created attachment item as this module reads back. */
export interface AttachedItem {
  readonly id: number;
  /** `Zotero.DataObject.key`; added by `P6-T13` for `audioAttachmentKeys`. */
  readonly key: string;
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
  /** The attachment item's key (`P6-T13`: `audioAttachmentKeys`). */
  readonly itemKey: string;
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

/** What {@link AudioStore.writeChunkedWav} is asked for (`P6-T12`). */
export interface WriteChunkedWavRequest extends JoinOptions {
  /** Filename stem; sanitised before use, so any string is safe to pass. */
  readonly stem: string;
  /** The synthesized chunks, in reading order. */
  readonly chunks: readonly PcmChunk[];
  /**
   * An absolute folder to write into instead of {@link AudioStore.directory}
   * — the linked-file folder of `plan/09` `P6-T13` step 4. Created when
   * missing, like the default.
   */
  readonly directory?: string;
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

/**
 * What {@link AudioStore.attachStandalone} is asked for (`plan/09` `P6-T13`):
 * an attachment with no parent, in one collection (`plan/09` §0.4 line 7).
 */
export interface AttachStandaloneRequest {
  readonly file: WrittenAudioFile;
  /** The library the attachment is created in (imported files only). */
  readonly libraryID: number;
  /** The report's collection, by key. */
  readonly collectionKey: string;
  readonly title: string;
  readonly mode: AttachmentMode;
}

/** Write audio into the data directory and register it on an item. */
export interface AudioStore {
  /** `<dataDirectory>/research-helper/audio`. */
  readonly directory: string;
  /** The absolute path a given leaf name would occupy. */
  pathFor(fileName: string): string;
  /**
   * The same in another folder (`P6-T13`'s linked-file folder); the leaf name
   * is checked as {@link pathFor} checks it.
   */
  pathIn(folder: string, fileName: string): string;
  /** Wrap PCM in a WAV container and write it. Creates the directory. */
  writeWav(request: WriteWavRequest): Promise<WrittenAudioFile>;
  /**
   * Join chunks into one WAV with exactly one header and write it
   * (`plan/09` `P6-T12` step 3): the header for the total length first, then
   * each chunk, with {@link CHUNK_SILENCE_MS} of silence between, appended in
   * order — so nothing beyond the chunks already held and one silence buffer
   * is in memory. Without {@link AudioFileSystem.appendFile}, one flat buffer
   * is built and written instead. Creates the folder.
   */
  writeChunkedWav(request: WriteChunkedWavRequest): Promise<WrittenAudioFile>;
  /** Register a written file as an attachment (`docs/04` §10.2). */
  attach(request: AttachRequest): Promise<AudioAttachment>;
  /**
   * Register a written file as a **standalone** attachment in a collection,
   * no parent (`plan/09` `P6-T13`). Linked mode is valid only in the
   * personal library — Zotero refuses a linked file elsewhere ("Linked files
   * can only be added to user library", `Zotero.Item.prototype._saveData` in
   * `chrome/content/zotero/xpcom/data/item.js`) — so the caller checks that
   * first; this method passes `libraryID` only to `importFromFile`.
   */
  attachStandalone(request: AttachStandaloneRequest): Promise<AudioAttachment>;
}

/**
 * The size of the WAV {@link AudioStore.writeChunkedWav} would write for
 * `chunks`: 44 + every chunk's samples + one silence between each pair. Runs
 * every check the write runs, so a bad chunk fails here, before any file or
 * folder is touched (`plan/09` `P6-T13`: the mode is chosen from this).
 */
export function chunkedWavByteLength(
  chunks: readonly PcmChunk[],
  options: JoinOptions = {},
): number {
  const format = options.format ?? GEMINI_PCM_FORMAT;
  const pcms = prepareChunks(chunks, format, undefined);
  return (
    WAV_HEADER_BYTES +
    joinedByteLength(pcms, silencePcm(CHUNK_SILENCE_MS, format))
  );
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

  const pathIn = (folder: string, fileName: string): string => {
    assertLeafName(fileName);
    if (folder.trim() === "") {
      throw new RangeError("an audio folder must be an absolute path");
    }
    return files.join(folder, fileName);
  };
  const pathFor = (fileName: string): string => pathIn(directory, fileName);

  return {
    directory,
    pathFor,
    pathIn,

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

    async writeChunkedWav(request) {
      const format = request.format ?? GEMINI_PCM_FORMAT;
      const pcms = prepareChunks(request.chunks, format, request.logger);
      const silence = silencePcm(CHUNK_SILENCE_MS, format);
      const dataBytes = joinedByteLength(pcms, silence);
      const header = wavHeader(dataBytes, format);
      const folder = request.directory ?? directory;
      const fileName = audioFileName(request.stem, "wav");
      const path = pathIn(folder, fileName);

      await files.makeDirectory(folder);
      if (files.appendFile === undefined) {
        const flat = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
        flat.set(header, 0);
        fillJoined(flat, WAV_HEADER_BYTES, pcms, silence);
        await files.writeFile(path, flat);
      } else {
        await files.writeFile(path, header);
        for (const [index, pcm] of pcms.entries()) {
          if (index > 0) await files.appendFile(path, silence);
          await files.appendFile(path, pcm);
        }
      }

      return {
        path,
        fileName,
        byteLength: WAV_HEADER_BYTES + dataBytes,
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
        itemKey: item.key,
        mode,
        path: file.path,
        fileName: file.fileName,
        contentType: file.contentType,
      };
    },

    async attachStandalone(request) {
      const { file, mode } = request;
      assertLeafName(file.fileName);
      if (request.collectionKey.trim() === "") {
        throw new RangeError(
          "a standalone audio attachment needs a collection",
        );
      }
      const shared = {
        file: file.path,
        title: request.title,
        contentType: file.contentType,
        collections: [request.collectionKey],
      };
      const item =
        mode === "imported"
          ? await attachments.importFromFile({
              ...shared,
              libraryID: request.libraryID,
            })
          : await attachments.linkFromFile(shared);

      return {
        itemID: item.id,
        itemKey: item.key,
        mode,
        path: file.path,
        fileName: file.fileName,
        contentType: file.contentType,
      };
    },
  };
}

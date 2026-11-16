/**
 * Delivery of a synthesized audio report into Zotero (`plan/09` `P6-T13`,
 * FR-40): one WAV, named per `docs/04` §10.3, put into the report's
 * collection as a **standalone attachment** with a descriptive title —
 * imported at most `IMPORT_MAX_BYTES` (10 MiB), linked above that into the
 * folder the user chose (`plan/09` §0.4 lines 6, 7 and 25).
 *
 * Caller: `audioReportPipeline.ts` (`P6-T16`, not built on 2026-11-16), which
 * calls {@link checkAudioDestination} **before** synthesis and
 * {@link deliverAudio} after it. The Zotero half is
 * {@link ZoteroAudioAttachments} from `src/zotero/attachments.ts`, constructed
 * in `src/bootstrap/registerPipelines.ts` by `P6-T16`.
 *
 * ## Decisions taken here (coordinator, under `plan/00` §6 item 313)
 *
 * 1. **A refusal is a value, not a throw.** Both entry points return
 *    `{ kind: "refused", reason }` for a destination the run cannot use —
 *    `read-only`, `no-collection`, `linked-needs-personal-library`,
 *    `no-folder` — so `P6-T14` can offer "Save as" from one place. A fault
 *    while writing or attaching still throws.
 * 2. **The mode is chosen from the assembled size**, not the estimate:
 *    `chunkedWavByteLength` runs every chunk check first, so a bad chunk fails
 *    before a folder is asked for or a byte is written.
 * 3. **A linked file in a group library is refused.** Zotero allows a linked
 *    file only in the personal library (`src/zotero/attachments.ts`'s header),
 *    which §0.4 line 6 did not foresee; whether such a report should be
 *    imported anyway or refused is an owner question (`plan/00` §6, recorded
 *    2026-11-16, draft answer not adopted). Until it is answered the run is
 *    refused before synthesis, which spends nothing.
 * 4. **The file stem fits the 60-code-point cap** (`MAX_FILE_STEM_LENGTH`):
 *    the slug is cut to leave room for `-trends-<yyyymmdd>-<lang>-NN`, so
 *    `sanitizeFileStem` never cuts the suffix off. `docs/04` §10.3's sketch
 *    caps the slug alone at 60.
 * 5. **The slug keeps NFC**, not the sketch's NFKD: NFKD splits each Hangul
 *    syllable into conjoining letters, which a file browser shows apart.
 * 6. **The date is the local calendar date** of the clock, so "the same day"
 *    is the user's day.
 * 7. **After a failed import or link the written file is kept**, since it is
 *    the only copy of paid audio and `P6-T14`'s "Save as" can use it; after a
 *    successful import it is deleted (§0.4 line 6).
 * 8. **The title** is English here ("Audio report (English), 2026-11-16");
 *    `P6-T17` passes the localised one through {@link AudioDeliveryDeps.title}.
 *
 * Nothing here logs a path or a file name: the folder the user chose is "the
 * folder you chose" (`docs/09` §2.2).
 */

import type { Clock } from "../../core/clock";
import type { Logger } from "../../core/logger";
import type {
  AudioAttachmentMode,
  AudioLanguage,
  AudioRunOutcome,
} from "../../model/audio";
import type { TrendReport } from "../../model/trend";
import type { Usage } from "../../model/usage";
import { getPref, setPref } from "../../prefs";
import {
  GEMINI_PCM_FORMAT,
  MAX_FILE_STEM_LENGTH,
  WAV_HEADER_BYTES,
  audioFileName,
  chooseAttachmentMode,
  chunkedWavByteLength,
  type PcmChunk,
} from "../../tts/audioStore";
import type { PcmFormat } from "../../tts/types";
import type { ZoteroAudioAttachments } from "../../zotero/attachments";

// ---------------------------------------------------------------------------
// Naming — docs/04 §10.3
// ---------------------------------------------------------------------------

/** What is left of the stem for the slug: `-trends-yyyymmdd-xx-NN` is 22. */
export const AUDIO_SLUG_MAX_LENGTH = MAX_FILE_STEM_LENGTH - 22;

/** The highest same-day suffix tried (`-2` … `-99`). */
export const MAX_SAME_DAY_RUNS = 99;

/** Used when a collection name has no letter or digit left. */
export const FALLBACK_AUDIO_SLUG = "collection";

/**
 * `docs/04` §10.3's slug: lower case, every run of characters that is not a
 * letter or a digit becomes one `-`, Hangul kept, capped at
 * {@link AUDIO_SLUG_MAX_LENGTH} code points.
 */
export function audioSlug(collectionName: string): string {
  const dashed = collectionName
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const capped = Array.from(dashed)
    .slice(0, AUDIO_SLUG_MAX_LENGTH)
    .join("")
    .replace(/-+$/g, "");
  return capped === "" ? FALLBACK_AUDIO_SLUG : capped;
}

/** The clock's local calendar date as `{ compact: yyyymmdd, iso: yyyy-mm-dd }`. */
export function localDate(epochMs: number): {
  readonly compact: string;
  readonly iso: string;
} {
  const date = new Date(epochMs);
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return { compact: `${yyyy}${mm}${dd}`, iso: `${yyyy}-${mm}-${dd}` };
}

/**
 * `<collection-slug>-trends-<yyyymmdd>-<lang>`, with `-<run>` from the second
 * run of the day on.
 */
export function audioFileStem(
  collectionName: string,
  compactDate: string,
  language: AudioLanguage,
  run = 1,
): string {
  const base = `${audioSlug(collectionName)}-trends-${compactDate}-${language}`;
  return run > 1 ? `${base}-${run}` : base;
}

/** FR-40's title in English; `P6-T17` supplies the localised one. */
export function defaultAudioTitle(
  language: AudioLanguage,
  isoDate: string,
): string {
  return `Audio report (${language === "ko" ? "Korean" : "English"}), ${isoDate}`;
}

// ---------------------------------------------------------------------------
// Ports and results
// ---------------------------------------------------------------------------

/** What delivery needs from outside. */
export interface AudioDeliveryDeps {
  readonly zotero: ZoteroAudioAttachments;
  readonly clock: Pick<Clock, "now">;
  /**
   * The folder picker the UI passes in (`plan/09` `P6-T13` step 4): resolves
   * to an absolute folder, or `undefined` when the user cancels.
   */
  readonly pickFolder: () => Promise<string | undefined>;
  /** `tts.linkedFileDir`; defaults to the preference. */
  readonly readLinkedFolder?: () => string;
  /** Stores the chosen folder; defaults to the preference. */
  readonly writeLinkedFolder?: (path: string) => void;
  /** FR-40's title; defaults to {@link defaultAudioTitle}. */
  readonly title?: (language: AudioLanguage, isoDate: string) => string;
  readonly logger?: Logger;
}

/** Why a destination cannot take the audio. */
export type AudioDeliveryRefusal =
  /** The library is read-only, or a group the user cannot write. */
  | "read-only"
  /** The report's collection is gone or in the trash. */
  | "no-collection"
  /** The file is over 10 MiB and the library is not the personal one. */
  | "linked-needs-personal-library"
  /** No usable folder for a linked file: cancelled, missing or temporary. */
  | "no-folder";

/** {@link checkAudioDestination}'s answer. */
export type AudioDestinationCheck =
  | {
      readonly kind: "ready";
      /** The folder a linked file goes to; absent for an import. */
      readonly linkedFolder?: string;
    }
  | { readonly kind: "refused"; readonly reason: AudioDeliveryRefusal };

/** {@link deliverAudio}'s answer. */
export type AudioDelivery =
  | { readonly kind: "delivered"; readonly outcome: AudioRunOutcome }
  | { readonly kind: "refused"; readonly reason: AudioDeliveryRefusal };

/** What {@link deliverAudio} is asked to deliver. */
export interface AudioDeliveryRequest {
  readonly report: Pick<
    TrendReport,
    "id" | "libraryID" | "collectionKey" | "collectionName"
  >;
  readonly language: AudioLanguage;
  /** `synthesizeChunks`'s chunks, in reading order. */
  readonly chunks: readonly PcmChunk[];
  /** The one rate every chunk came back at. */
  readonly sampleRateHz: number;
  /** The TTS calls' usage, summed. */
  readonly usage: Usage | undefined;
  /** The script call's usage; absent when a stored script was used. */
  readonly scriptUsage: Usage | undefined;
  /** {@link checkAudioDestination}'s folder, when it resolved one. */
  readonly linkedFolder?: string;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * The folder for a linked file: the stored one when it still exists and is
 * not temporary; otherwise the user is asked once, and a usable answer is
 * stored. `undefined` when there is none.
 */
async function resolveLinkedFolder(
  preset: string | undefined,
  deps: AudioDeliveryDeps,
): Promise<string | undefined> {
  const { zotero } = deps;
  const usable = async (path: string): Promise<boolean> =>
    path.trim() !== "" &&
    !zotero.isTemporaryFolder(path) &&
    (await zotero.folderExists(path));

  const stored =
    preset ?? (deps.readLinkedFolder ?? (() => getPref("ttsLinkedFileDir")))();
  if (await usable(stored)) return stored;

  const picked = await deps.pickFolder();
  if (picked === undefined || !(await usable(picked))) return undefined;
  (deps.writeLinkedFolder ?? ((path) => setPref("ttsLinkedFileDir", path)))(
    picked,
  );
  return picked;
}

function libraryRefusal(
  libraryID: number,
  collectionKey: string,
  zotero: ZoteroAudioAttachments,
): AudioDeliveryRefusal | undefined {
  if (!zotero.isLibraryEditable(libraryID)) return "read-only";
  if (!zotero.collectionExists(libraryID, collectionKey)) {
    return "no-collection";
  }
  return undefined;
}

/**
 * The checks `P6-T16` runs **before** synthesis (`plan/09` `P6-T13` step 5):
 * a library the user cannot write, a missing collection, and — when the
 * estimate says the file will be linked — a library that cannot hold a
 * linked file, or no folder to put it in. Asks for the folder when none is
 * stored, so the question comes before any money is spent.
 *
 * @param input.mode - the estimate's mode (`AudioEstimate.mode`)
 */
export async function checkAudioDestination(
  input: {
    readonly libraryID: number;
    readonly collectionKey: string;
    readonly mode: AudioAttachmentMode;
  },
  deps: AudioDeliveryDeps,
): Promise<AudioDestinationCheck> {
  const refusal = libraryRefusal(
    input.libraryID,
    input.collectionKey,
    deps.zotero,
  );
  if (refusal !== undefined) return { kind: "refused", reason: refusal };
  if (input.mode === "imported") return { kind: "ready" };
  if (!deps.zotero.canLinkFiles(input.libraryID)) {
    return { kind: "refused", reason: "linked-needs-personal-library" };
  }
  const folder = await resolveLinkedFolder(undefined, deps);
  return folder === undefined
    ? { kind: "refused", reason: "no-folder" }
    : { kind: "ready", linkedFolder: folder };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** The first stem of the day whose `.wav` is not taken. */
async function freeStem(
  request: AudioDeliveryRequest,
  compactDate: string,
  folder: string | undefined,
  deps: AudioDeliveryDeps,
): Promise<string> {
  const { zotero } = deps;
  const { report, language } = request;
  const taken = zotero.attachmentFileNames(
    report.libraryID,
    report.collectionKey,
  );
  for (let run = 1; run <= MAX_SAME_DAY_RUNS; run++) {
    const stem = audioFileStem(
      report.collectionName,
      compactDate,
      language,
      run,
    );
    const fileName = audioFileName(stem, "wav");
    if (taken.has(fileName)) continue;
    const path =
      folder === undefined
        ? zotero.store.pathFor(fileName)
        : zotero.store.pathIn(folder, fileName);
    if (await zotero.fileExists(path)) continue;
    return stem;
  }
  throw new RangeError(
    `more than ${MAX_SAME_DAY_RUNS} audio reports of this collection today`,
  );
}

/**
 * Write the WAV and attach it (`plan/09` `P6-T13` steps 2–4, 6).
 *
 * Import (at most 10 MiB): written into the plugin's audio folder, imported
 * with no parent into the report's collection, then the written copy is
 * deleted. Link (above): written into the folder the user chose, linked into
 * the collection. Never creates a parent item and never touches the note.
 */
export async function deliverAudio(
  request: AudioDeliveryRequest,
  deps: AudioDeliveryDeps,
): Promise<AudioDelivery> {
  const { zotero, logger } = deps;
  const { report, language } = request;
  const format: PcmFormat = {
    ...GEMINI_PCM_FORMAT,
    sampleRateHz: request.sampleRateHz,
  };

  const refusal = libraryRefusal(
    report.libraryID,
    report.collectionKey,
    zotero,
  );
  if (refusal !== undefined) return { kind: "refused", reason: refusal };

  const bytes = chunkedWavByteLength(request.chunks, { format });
  const mode = chooseAttachmentMode(bytes);
  let folder: string | undefined;
  if (mode === "linked") {
    if (!zotero.canLinkFiles(report.libraryID)) {
      return { kind: "refused", reason: "linked-needs-personal-library" };
    }
    folder = await resolveLinkedFolder(request.linkedFolder, deps);
    if (folder === undefined) return { kind: "refused", reason: "no-folder" };
  }

  const date = localDate(deps.clock.now());
  const stem = await freeStem(request, date.compact, folder, deps);
  const written = await zotero.store.writeChunkedWav({
    stem,
    chunks: request.chunks,
    format,
    ...(folder === undefined ? {} : { directory: folder }),
    ...(logger === undefined ? {} : { logger }),
  });
  const attachment = await zotero.store.attachStandalone({
    file: written,
    libraryID: report.libraryID,
    collectionKey: report.collectionKey,
    title: (deps.title ?? defaultAudioTitle)(language, date.iso),
    mode,
  });

  if (mode === "imported") {
    try {
      await zotero.removeFile(written.path);
    } catch (error) {
      logger?.warn("audio.copy-not-removed", {
        error: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  logger?.info("audio.delivered", {
    mode,
    bytes: written.byteLength,
    language,
  });

  const frame = format.channels * (format.bitsPerSample / 8);
  return {
    kind: "delivered",
    outcome: {
      reportId: report.id,
      language,
      attachmentKey: attachment.itemKey,
      mode,
      fileName: written.fileName,
      seconds:
        (written.byteLength - WAV_HEADER_BYTES) / (format.sampleRateHz * frame),
      bytes: written.byteLength,
      usage: request.usage,
      scriptUsage: request.scriptUsage,
    },
  };
}

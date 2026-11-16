/**
 * The audio report's Zotero half (`plan/09` `P6-T13`, FR-40): the only file in
 * `src/` that calls `Zotero.Attachments` for audio. It satisfies
 * `src/tts/audioStore.ts`'s ports over `IOUtils`, `PathUtils`,
 * `Zotero.DataDirectory` and `Zotero.Attachments`, and adds the library reads
 * `src/pipeline/audioReport/deliver.ts` needs before it writes anything.
 *
 * Caller: `deliverAudio` in `src/pipeline/audioReport/deliver.ts`, through
 * {@link ZoteroAudioAttachments}. Constructed by
 * {@link createZoteroAudioAttachments} in `src/bootstrap/registerPipelines.ts`
 * (`P6-T16`, not built on 2026-11-16).
 *
 * ## What the Zotero source says, read 2026-11-16
 *
 * From the installed client's `omni.ja`:
 *
 * - **A note cannot parent an attachment.** `Zotero.Item.prototype._saveData`
 *   in `chrome/content/zotero/xpcom/data/item.js` throws "Parent item … must
 *   be a regular item" for any child whose parent is not a regular item; the
 *   two exceptions are an embedded image (whose parent must be a note) and an
 *   annotation (whose parent must be a file attachment). The audio is
 *   therefore a standalone attachment in the report's collection, as
 *   `plan/09` §0.4 line 7 already decided (`docs/07` §6.5's note of the day).
 * - **A linked file must be in the personal library.** The same
 *   `_saveData`, and the `attachmentPath` setter in the same file, throw
 *   "Linked files can only be added to user library"; `linkFromFile` in
 *   `xpcom/attachments.js` takes no `libraryID`, and
 *   `Zotero.Item.prototype.setCollections` sets an unset library to the
 *   personal one before it resolves collection keys, so a parentless linked
 *   attachment is created in the personal library.
 *   `ZoteroAudioAttachments.canLinkFiles` says so before any write.
 * - **Appending to a file** is `IOUtils.write(path, bytes, { mode: "append" })`,
 *   as `xpcom/http.js` does it.
 *
 * ## Paths are never logged
 *
 * Nothing here logs, and the folder the user chose for linked files is a
 * local path that `docs/09` §2.2 keeps out of every log, report and message
 * (`tts.linkedFileDir`'s schema row says the same).
 */

import {
  createAudioStore,
  type AudioFileSystem,
  type AudioStore,
} from "../tts/audioStore";
import { isLibraryEditable } from "./notes";

/** What `deliverAudio` reads from the library and the file system. */
export interface ZoteroAudioAttachments {
  /** The audio store over the data directory and `Zotero.Attachments`. */
  readonly store: AudioStore;
  /** `Zotero.Libraries.get(id).editable` (`isLibraryEditable`). */
  isLibraryEditable(libraryID: number): boolean;
  /** Only the personal library may hold a linked file (see the header). */
  canLinkFiles(libraryID: number): boolean;
  /** The collection exists in the library and is not in the trash. */
  collectionExists(libraryID: number, collectionKey: string): boolean;
  /**
   * The leaf file names of the attachments directly in the collection, trash
   * excluded — what a same-day re-run's `-2`, `-3` is chosen against.
   */
  attachmentFileNames(
    libraryID: number,
    collectionKey: string,
  ): ReadonlySet<string>;
  /** `true` when the path names an existing folder. */
  folderExists(path: string): Promise<boolean>;
  /** `true` when the folder is inside a temporary directory (`docs/04` §10.2). */
  isTemporaryFolder(path: string): boolean;
  /** `IOUtils.exists`. */
  fileExists(path: string): Promise<boolean>;
  /** `IOUtils.remove`, absent files ignored. */
  removeFile(path: string): Promise<void>;
}

/** `IOUtils` and `PathUtils` as {@link AudioFileSystem}, with append. */
export function zoteroAudioFileSystem(): AudioFileSystem {
  return {
    join: (...segments) => PathUtils.join(...segments),
    makeDirectory: (path) =>
      IOUtils.makeDirectory(path, {
        createAncestors: true,
        ignoreExisting: true,
      }),
    writeFile: (path, bytes) => IOUtils.write(path, bytes),
    appendFile: (path, bytes) => IOUtils.write(path, bytes, { mode: "append" }),
    exists: (path) => IOUtils.exists(path),
  };
}

function collectionOf(
  libraryID: number,
  collectionKey: string,
): Zotero.Collection | undefined {
  const found: unknown = Zotero.Collections.getByLibraryAndKey(
    libraryID,
    collectionKey,
  );
  if (typeof found !== "object" || found === null) return undefined;
  const collection = found as Zotero.Collection;
  return collection.deleted ? undefined : collection;
}

/** `a` is `b` or inside it, compared case-insensitively on Windows. */
function isInside(path: string, folder: string): boolean {
  const fold = (p: string): string => {
    const normal = PathUtils.normalize(p);
    return Zotero.isWin ? normal.toLowerCase() : normal;
  };
  const inner = fold(path);
  const outer = fold(folder);
  if (inner === outer) return true;
  const separator = Zotero.isWin ? "\\" : "/";
  return inner.startsWith(
    outer.endsWith(separator) ? outer : outer + separator,
  );
}

/**
 * Build the adapter. Reads `Zotero.DataDirectory.dir` once, when built.
 */
export function createZoteroAudioAttachments(): ZoteroAudioAttachments {
  const files = zoteroAudioFileSystem();
  const dataDirectory = Zotero.DataDirectory.dir;
  const store = createAudioStore({
    dataDirectory,
    files,
    attachments: Zotero.Attachments,
  });

  return {
    store,
    isLibraryEditable,
    canLinkFiles: (libraryID) => libraryID === Zotero.Libraries.userLibraryID,
    collectionExists: (libraryID, collectionKey) =>
      collectionOf(libraryID, collectionKey) !== undefined,
    attachmentFileNames(libraryID, collectionKey) {
      const collection = collectionOf(libraryID, collectionKey);
      const names = new Set<string>();
      if (collection === undefined) return names;
      for (const item of collection.getChildItems(false, false)) {
        if (!item.isAttachment()) continue;
        const name = item.attachmentFilename;
        if (typeof name === "string" && name !== "") names.add(name);
      }
      return names;
    },
    async folderExists(path) {
      if (!PathUtils.isAbsolute(path)) return false;
      try {
        const info = await IOUtils.stat(path);
        return info.type === "directory";
      } catch {
        return false;
      }
    },
    isTemporaryFolder: (path) =>
      isInside(path, PathUtils.tempDir) ||
      isInside(path, PathUtils.join(dataDirectory, "tmp")),
    fileExists: (path) => IOUtils.exists(path),
    async removeFile(path) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    },
  };
}

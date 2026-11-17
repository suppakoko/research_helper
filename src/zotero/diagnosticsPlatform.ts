/**
 * The platform half of the diagnostics text (`plan/10` `P7-T13`): what only
 * `src/zotero/` may read or do, because only it may name the `Zotero` global
 * (`eslint.config.js`).
 *
 * ## Callers and construction (`plan/README.md` §5 rule 10)
 *
 * **Caller:** `preferencesDiagnosticsPort` in `src/bootstrap/registerUI.ts`, the
 * one construction site of the preferences pane's diagnostics port. Nothing here
 * logs a path or a value: a path the user chose is written to and forgotten.
 */

/** The environment lines of the text. */
export interface ZoteroEnvironment {
  readonly zoteroVersion: string;
  readonly os: string;
  readonly locale: string;
  /** `Zotero.DataDirectory.dir`: withheld from the text wherever it occurs. */
  readonly dataDirectory: string;
}

/** Zotero's version, the OS name, the UI locale and the data directory. */
export function zoteroEnvironment(): ZoteroEnvironment {
  return {
    zoteroVersion: String(Zotero.version),
    os: String(Services.appinfo.OS),
    locale: String(Zotero.locale),
    dataDirectory: String(Zotero.DataDirectory.dir),
  };
}

/**
 * The error console's entries that this plugin's logger wrote: those carrying
 * `prefix`. Another add-on's errors, and Zotero's own, can quote a path or a
 * title, and are not this plugin's to copy out.
 *
 * @param prefix - `LOG_PREFIX` from `src/core/logger.ts`
 */
export function pluginErrorLines(prefix: string): readonly string[] {
  const errors = Zotero.getErrors(true) as unknown;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((entry) => String(entry))
    .filter((line) => line.includes(prefix));
}

/**
 * Write `text` to `path`, UTF-8. The path is the one the user just chose in
 * the save picker; it is not kept and not logged.
 *
 * @returns whether the file was written
 */
export async function writeDiagnosticsFile(
  path: string,
  text: string,
): Promise<boolean> {
  try {
    await IOUtils.writeUTF8(path, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put `text` on the clipboard with Zotero's own helper
 * (`Zotero.Utilities.Internal.copyTextToClipboard`, as the report window's
 * Copy does).
 *
 * @returns whether it was put there
 */
export function copyDiagnosticsText(text: string): boolean {
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    return true;
  } catch {
    return false;
  }
}

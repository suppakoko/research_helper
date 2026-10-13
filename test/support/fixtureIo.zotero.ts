/* eslint-disable no-restricted-globals -- test support for integration specs that run inside a live Zotero (docs/13 §2.3); `Zotero.Plugins` is the only way to learn where the plugin under test was loaded from, and there is no src/zotero/ facade for it to go through from outside the plugin bundle. */
/**
 * `FixtureIo` for the Zotero sandbox and the scaffold's test-runner window —
 * what an integration spec passes to `test/support/fixtureReplay.ts`.
 *
 * `IOUtils` and `PathUtils` are assigned into the plugin sandbox's global scope
 * by `_loadScope()` (`docs/01` §5.6, verified 2026-09-08) and are ordinary
 * globals of the chrome window the test runner loads specs into — which is the
 * scope this file actually runs in. `test/integration/phase1-dod.spec.ts` and
 * `test/integration/zotero/attachments.spec.ts` already read files through them
 * from that window, and the `P2-T25` block of
 * `test/integration/searchDialog-flow.spec.ts` reads all seventeen PubMed
 * fixtures and their sidecars through this file (Zotero 10.0.3, Gecko
 * 140.15.0, Windows, 2026-10-13).
 *
 * **No `node:` import, and no fallback.** This file is bundled into every spec
 * that imports it, so it may use only what the sandbox has. It does not probe
 * for `IOUtils` and does not catch a failed import: if the globals are missing
 * the first read throws and the suite fails, which is what `P2-T25`'s **Do NOT**
 * asks for.
 */

import { config } from "../../package.json";

import type { FixtureIo } from "./fixtureIo";

/**
 * Reads with `IOUtils`, joins with `PathUtils`.
 *
 * `PathUtils.join` rather than `${dir}/${name}`: Gecko's `nsLocalFile` on
 * Windows rejects a native path with a forward slash in it
 * (`NS_ERROR_FILE_UNRECOGNIZED_PATH`, measured 2026-10-13 — see
 * `fixtureIo.ts`), so the spelling the Node side uses is not portable here. `IOUtils.getChildren` returns absolute
 * paths; `PathUtils.filename` takes them back to names so both
 * implementations answer `listNames` the same way.
 */
export const zoteroFixtureIo: FixtureIo = {
  readText: (dir, name) => IOUtils.readUTF8(PathUtils.join(dir, name)),
  listNames: async (dir) =>
    (await IOUtils.getChildren(dir)).map((path) => PathUtils.filename(path)),
};

/**
 * How many directories above the plugin's root the repository root is looked
 * for. The scaffold loads the plugin from `<repo>/.scaffold/build/addon/`, three
 * levels down; the bound is twice that so a moved `dist` still resolves and a
 * stray profile elsewhere on the disk still fails rather than scanning to the
 * drive root.
 */
const MAX_ASCENT = 6;

/**
 * The repository's fixture directory for one source, found from where Zotero
 * loaded the plugin under test.
 *
 * **Why it is found and not configured.** The scaffold's test bundler defines
 * no constant a spec could read, and `zotero-plugin.config.ts` is outside
 * `P2-T25`'s `Files`. What *is* knowable from inside Zotero is the plugin's own
 * `rootURI`: `zotero-plugin-scaffold` 0.9.2 installs the build as a temporary
 * add-on from `<repo>/.scaffold/build/addon/`, so `Zotero.Plugins.getRootURI`
 * answers with a `file:` URL under the repository. This climbs from there until
 * it finds a directory holding `test/fixtures`, and fails naming where it
 * looked.
 *
 * @param source - a `SourceId`-shaped directory name under `test/fixtures/`
 * @returns the native path of `test/fixtures/<source>`
 * @throws Error when the plugin's root is not a `file:` URL, or when no
 *   ancestor within {@link MAX_ASCENT} levels holds `test/fixtures/<source>`
 */
export async function repositoryFixtureDir(source: string): Promise<string> {
  const rootURI = await Zotero.Plugins.getRootURI(config.addonID);
  const uri = Services.io.newURI(rootURI);
  const asFileUrl = uri.QueryInterface?.(Components.interfaces.nsIFileURL);
  if (asFileUrl === undefined) {
    throw new Error(
      `[P2-T25] the plugin's rootURI ${rootURI} is not a file: URL, so the ` +
        `repository's fixtures cannot be located from it`,
    );
  }

  const tried: string[] = [];
  let candidate: string | null = asFileUrl.file.path;
  for (let level = 0; level <= MAX_ASCENT && candidate !== null; level += 1) {
    const dir = PathUtils.join(candidate, "test", "fixtures", source);
    tried.push(dir);
    if (await IOUtils.exists(dir)) return dir;
    candidate = PathUtils.parent(candidate);
  }
  throw new Error(
    `[P2-T25] no test/fixtures/${source} above the plugin root ${rootURI}; ` +
      `looked at:\n  ${tried.join("\n  ")}`,
  );
}

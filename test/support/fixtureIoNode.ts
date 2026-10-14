/**
 * `FixtureIo` for Node — what Vitest's contract tests and the recorder use.
 *
 * This file is the **only** place the replay harness touches `node:*`. It must
 * never be imported, directly or through another module, by anything under
 * `test/integration/`: the scaffold bundles those specs for the Zotero sandbox,
 * where `node:fs/promises` does not exist and the bundle fails to build.
 * `test/support/fixtureIo.zotero.ts` is the implementation for that side.
 *
 * **Why the name has no dot (`P2-T33`).** This file was `fixtureIo.node.ts`
 * until 2026-10-14. Node treats `.node` as the native-addon extension, so when
 * `tsx` resolved the extensionless specifier `../support/fixtureIo.node` it
 * took the suffix for a real extension and never tried appending `.ts`:
 * `npm run fixtures:record` died with `ERR_MODULE_NOT_FOUND` while Vitest,
 * whose resolver does try, was green. Measured on tsx 4.23.13 / Node 22.23.0:
 * `fixtureIo.zotero` and the bare `fixtureIo` both resolved, only `.node` did
 * not. Importing with an explicit `.ts` extension would need
 * `allowImportingTsExtensions` in `tsconfig.json` (TS5097), so the rename is
 * the fix.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FixtureIo } from "./fixtureIo";

/** Reads with `node:fs/promises`, joins with `node:path`. */
export const nodeFixtureIo: FixtureIo = {
  readText: (dir, name) => readFile(join(dir, name), "utf8"),
  listNames: (dir) => readdir(dir),
};

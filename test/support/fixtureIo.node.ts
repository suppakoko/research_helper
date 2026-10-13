/**
 * `FixtureIo` for Node — what Vitest's contract tests and the recorder use.
 *
 * This file is the **only** place the replay harness touches `node:*`. It must
 * never be imported, directly or through another module, by anything under
 * `test/integration/`: the scaffold bundles those specs for the Zotero sandbox,
 * where `node:fs/promises` does not exist and the bundle fails to build.
 * `test/support/fixtureIo.zotero.ts` is the implementation for that side.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FixtureIo } from "./fixtureIo";

/** Reads with `node:fs/promises`, joins with `node:path`. */
export const nodeFixtureIo: FixtureIo = {
  readText: (dir, name) => readFile(join(dir, name), "utf8"),
  listNames: (dir) => readdir(dir),
};

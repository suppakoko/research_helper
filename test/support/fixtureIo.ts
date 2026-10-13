/**
 * The one platform port the replay harness needs: reading committed fixtures.
 *
 * **Why a port (`P2-T25`).** `test/support/fixtureReplay.ts` used to be
 * `test/contract/_transport.ts` and imported `node:fs/promises` directly, which
 * is why it could not be bundled into an integration spec: the scaffold's test
 * bundler runs esbuild with `bundle: true` and the default browser platform, so
 * a `node:` import in the dependency graph fails the bundle — loudly, which is
 * the right failure, but it kept the harness out of the place where the shipped
 * adapter and the shipped HTTP client can be exercised together. Reading a file
 * is the only thing the harness needs from a platform, so this is the whole
 * port. Hashing was the other candidate and turned out not to need one:
 * `test/support/sha256.ts` explains why.
 *
 * Two implementations, one per runtime, and **nothing chooses between them at
 * run time**: a caller imports the one for the runtime it is written for.
 * `fixtureIo.node.ts` is what `test/contract/_transport.ts` binds, and
 * `fixtureIo.zotero.ts` is what an integration spec passes. A harness that
 * picked an implementation by probing for `IOUtils` or by swallowing a failed
 * import would be able to degrade to "no replay" with the suite still green,
 * which the card forbids.
 *
 * **`dir` and `name` arrive separately** rather than as one joined path. The
 * reason is Windows: Gecko's `nsLocalFile` rejects a native path containing a
 * forward slash, so the `${dir}/${name}` spelling the Node side has always used
 * cannot be handed to `IOUtils` as it is. **Measured 2026-10-13 on Zotero
 * 10.0.3, Gecko 140.15.0, Windows** (`P2-T25` block, logged on every run):
 * `IOUtils.exists("D:\\…\\pubmed/b68358327ce730cd.json")` throws
 * `OperationError: … could not parse path (NS_ERROR_FILE_UNRECOGNIZED_PATH)`.
 * Each implementation therefore joins with the separator its platform wants.
 */
export interface FixtureIo {
  /**
   * The UTF-8 text of the file `name` inside `dir`.
   *
   * @throws when the file is absent or unreadable — the replay transport turns
   *   that into `docs/13` §2.2's "Missing fixture …" error
   */
  readText(dir: string, name: string): Promise<string>;
  /**
   * The names — not paths — of the entries directly inside `dir`, in no
   * particular order.
   *
   * @throws when `dir` does not exist
   */
  listNames(dir: string): Promise<readonly string[]>;
}

import Addon from "./addon";
import { config } from "../package.json";

/**
 * Composition root. `Zotero` and the other privileged globals are put on the
 * sandbox context by addon/bootstrap.js, so they are simply in scope here —
 * see the comment there for why this does not go through the toolkit's
 * `BasicTool.getGlobal()` the way the upstream template does.
 */

// @ts-expect-error - the plugin instance is not part of the Zotero types
if (!Zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();

  // @ts-expect-error - the plugin instance is not part of the Zotero types
  Zotero[config.addonInstance] = addon;
}

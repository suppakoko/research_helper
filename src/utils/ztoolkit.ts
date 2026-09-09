// P0-T02 fix 2. Verified against the published zotero-plugin-toolkit@5.2.0
// tarball on 2026-09-10: the package's `exports` map is
//   { ".": "./dist/index.js", "./ztoolkit": "./dist/ztoolkit.js", ... }
// and `ZoteroToolkit` is NOT among the root entry's exports. It lives only on
// the `/ztoolkit` subpath. Importing it from the bare specifier — which the
// upstream template still does at src/utils/ztoolkit.ts:1 — does not compile.
//
// Caveat recorded for the spike report: that exports map has no `types`
// condition on any subpath, so TypeScript resolves these types only through
// the .js -> .d.ts sibling fallback. That works under moduleResolution
// "bundler" or "node16" and fails under legacy "node".
import { ZoteroToolkit } from "zotero-plugin-toolkit/ztoolkit";
import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const _ztoolkit = new ZoteroToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = env === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = env === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
}

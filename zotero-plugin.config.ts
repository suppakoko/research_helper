import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

// P0-T02 fix 6 (docs/01 §4.6 item 6, docs/13 §1.4):
//   `namespace` and the preference prefix are deliberately DIFFERENT strings.
//   Do not conflate them. docs/13 §1.4 is the configuration of record.
//
// P0-T02 step 9 / docs/01 §4.6 item 8: prefer the native `Zotero.*Manager`
//   APIs over toolkit wrappers. The toolkit is kept only for DialogHelper,
//   VirtualizedTableHelper, FilePickerHelper, ClipboardHelper, KeyboardManager
//   and unregisterAll(). docs/01 §4.3 verified that the toolkit ships no
//   wrapper for items, collections, search or attachments at all.

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",

  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: "researchHelper",
  xpiName: "research-helper",

  xpiDownloadLink:
    "https://github.com/suppakoko/research_helper/releases/download/v{{version}}/research-helper.xpi",
  // Fix 7: the repository's permanent `release` tag, per docs/01 §11.3 / §4.5.
  updateURL:
    "https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
      updateJSON: "update.json",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        // Fix 5: raised from the template's firefox115. docs/13 §1.5 records
        // firefox140 as a CANDIDATE to confirm, not a confirmed fact — if the
        // build or the smoke test fails, drop back to firefox115 and record
        // which value actually worked in docs/spikes/phase-0.md.
        target: "firefox140",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
    fluent: {
      prefixLocaleFiles: true,
      prefixFluentMessages: true,
      // Off until the first .ftl file lands (P0-T24 owns localization).
      //
      // scaffold 0.9.2 bug, found 2026-09-10: with zero .ftl files it still
      // writes typings/i10n.d.ts, and the file it writes is
      //     export type FluentMessageId =
      //     ;
      // an empty union, which is TS1110 "Type expected". The generated header
      // carries `// @ts-nocheck`, but that suppresses semantic errors only —
      // a parse error still fails `tsc --noEmit`. So a fresh clone that runs
      // `npm run build` before `npm run typecheck` breaks its own typecheck.
      // Turn this back on in P0-T24, when there are messages to put in the
      // union, and file the bug upstream.
      dts: false,
    },
    prefs: {
      prefixPrefKeys: true,
      // docs/01 §7.1's branch. NOT the same string as `namespace` above.
      prefix: pkg.config.prefsPrefix,
      dts: "typings/prefs.d.ts",
    },
    makeUpdateJson: {
      hash: true,
    },
  },

  server: {
    devtools: true, // appends --jsdebugger to Zotero's start args
    debugOutputFile: true, // capture stdout/stderr into .scaffold/logs/
  },

  test: {
    entries: ["test/integration"],
    // P0-T02 step 12 finding, verified 2026-09-10 against the installed
    // zotero-plugin-scaffold 0.9.2 type definitions: the published scaffold
    // docs and docs/13 §1.4 both name these `timeout`, `startDelay` and
    // `abort`. The shipped `TestConfig` names them `mocha.timeout`,
    // `startupDelay` and `abortOnFail`. The types win. V-5 / P0-T13 confirm.
    mocha: {
      timeout: 30000,
    },
    startupDelay: 10000,
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}?.data?.initialized`,
  },

  release: {
    bumpp: {
      release: "prompt",
      commit: "chore(publish): release v%s",
      tag: "v%s",
      execute: "npm run build",
    },
  },
});

import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

// P0-T02 fix 6 (docs/01 §4.6 item 6, docs/13 §1.4):
//   `namespace` and the preference prefix are deliberately DIFFERENT strings.
//   Do not conflate them. docs/13 §1.4 is the configuration of record.
//
// P0-T02 step 9 / docs/01 §4.6 item 8: prefer the native `Zotero.*Manager`
//   APIs over toolkit wrappers. The toolkit is kept only for DialogHelper,
//   VirtualizedTableHelper, FilePickerHelper and ClipboardHelper, imported
//   individually — never a whole `ZoteroToolkit`, which leaks on every
//   disable/enable cycle (P0-T11, P0-T33). docs/01 §4.3 verified that the
//   toolkit ships no wrapper for items, collections, search or attachments.
//
// P0-T03 (docs/00 §3 D9): the plugin ID is a PERMANENT constant, not a
//   build-varying value, so it is written here as a literal and again as a
//   literal in `addon/manifest.json`. It must stay byte-identical in both, in
//   `package.json`'s `config.addonID`, in `Zotero.PreferencePanes.register({
//   pluginID })`, in `Zotero.MenuManager` registrations and in `update.json`.
//   Never change it.
//
// P0-T03 finding, read from the installed zotero-plugin-scaffold 0.9.2
//   (`dist/shared/scaffold-src-*.mjs`, `buildManifest`): the build merges as
//   `toMerged(userData, template)` where `template.applications.zotero` is
//   `{ id, update_url: updateURL }` taken from THIS file. Only `name` and
//   `version` are guarded with `userData.x || x`. So for `id` and
//   `update_url` THIS FILE WINS over `addon/manifest.json` — `docs/01` §4.5's
//   "existing values win" note is accurate for `name`/`version` only. A
//   divergence between the two files would therefore be silent: the manifest
//   in the XPI would carry the value from here. Keep them identical.

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",

  name: pkg.config.addonName,
  // Literal, not `pkg.config.addonID`: permanent identity, D9. See above.
  id: "research-helper@suppakoko.github.io",
  namespace: "researchHelper",
  xpiName: "research-helper",

  xpiDownloadLink:
    "https://github.com/suppakoko/research_helper/releases/download/v{{version}}/research-helper.xpi",
  // Fix 7: the repository's permanent `release` tag, per docs/01 §11.3 / §4.5,
  // with the exact URL taken from docs/13 §1.4. P0-T03: this string is
  // duplicated verbatim as `applications.zotero.update_url` in
  // `addon/manifest.json` and must stay HTTPS (docs/01 §11.2).
  updateURL:
    "https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json",

  build: {
    // P0-T34: an EXPLICIT extension list, not `addon/**/*.*`. The wildcard shipped
    // `content/icons/README.md` (11,925 B) to every user — developer documentation inside a
    // user artifact — and would ship every future `.md` under `addon/` the same way (measured,
    // P0-T30). Adding a new asset type is now a visible decision rather than an accident.
    //
    // Every extension currently under `addon/`: .js (bootstrap.js, prefs.js), .json
    // (manifest.json), .ftl (the two locale bundles), .png (the two icons). `.gitkeep` files are
    // not matched by either glob — dotfiles have no extension to match — so the empty-directory
    // markers stay out of the XPI as before.
    //
    // Keep binaries in mind when extending this list: scaffold `replaceDefine()` reads every
    // matched asset as UTF-8 and writes back only when a substitution changed the string, so a
    // binary survives unless it happens to contain a literal `__KEY__` byte sequence (P0-T02).
    assets: ["addon/**/*.{js,json,ftl,png}"],
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
      // P0-T32: both prefixers OFF. The `research-helper-` prefix on Fluent
      // filenames and identifiers is a correctness requirement (docs/01 §9.1,
      // §9.3, §12 gotcha 16), so it is written by hand in the file a human
      // edits rather than applied invisibly here. Read from scaffold 0.9.2's
      // `buildLocale()` and measured on the built artifact, 2026-09-14:
      //
      // - `prefixLocaleFiles` renames every `.ftl` to `${namespace}-${name}`
      //   UNCONDITIONALLY (no already-prefixed check), so the flat
      //   `research-helper-mainWindow.ftl` shipped as
      //   `researchHelper-research-helper-mainWindow.ftl`.
      // - `prefixFluentMessages` prepends `${namespace}-` to every message
      //   not already starting with `namespace`, so
      //   `research-helper-menu-root` shipped as
      //   `researchHelper-research-helper-menu-root`, and it rewrites
      //   `data-l10n-id` in built .xhtml the same way.
      //
      // `namespace` stays `researchHelper` (P0-T02 fix 6); it is not the fix.
      // With both off, the built filename and identifiers are byte-identical
      // to `addon/locale/<locale>/`, which is what `insertFTLIfNeeded` and
      // every `l10nID` in `src/` name.
      prefixLocaleFiles: false,
      prefixFluentMessages: false,
      // P1-T30, 2026-10-01: ON. `src/i18n/keys.ts` re-exports the union this
      // writes, so `typings/i10n.d.ts` is the SOURCE OF TRUTH for the message
      // vocabulary and the hand-written per-surface lists are a compiler-checked
      // partition of it. Measured on 84 messages across the two Phase 1 bundles
      // (25 mainWindow + 59 searchDialog): the generated union has exactly those
      // 84 members, and turning this on changed nothing about the built .ftl
      // files — all four stayed byte-identical to `addon/locale/**`, as P0-T32
      // requires (`dts` only writes the typings file).
      //
      // Two properties of the generator that `keys.ts` is written around:
      //
      // - It is the union over ALL LOCALES, not over `en-US`. `buildLocale()`
      //   feeds every locale's messages into one `MessageManager` and
      //   `getFTLMessages()` flattens them, so a typo in `ko-KR` WIDENS the
      //   union. `keys.ts`'s `UndeclaredBundleMessageId` is what catches that.
      // - It carries no surface information at all, for the same reason, so it
      //   cannot express "this id belongs to searchDialog.ftl and must not also
      //   be in mainWindow.ftl" — the silent collision docs/01 §9.3 warns about.
      //   That is upstream issue #125, "Generate i10n key types based on file"
      //   (open as of 2026-10-01), and it is why the per-surface lists stay.
      //
      // The file is COMMITTED, like typings/prefs.d.ts. `npm run build` is
      // `tsc --noEmit && zotero-plugin build`, so the typecheck that consumes
      // the union runs before the step that writes it: a bundle edit is caught
      // by the typecheck AFTER the next build, never during it.
      //
      // scaffold 0.9.2 bug, found 2026-09-10 and RE-MEASURED 2026-10-01 against
      // the installed 0.9.2 — still present: with zero .ftl files it still
      // writes typings/i10n.d.ts, and the file it writes is
      //     export type FluentMessageId =
      //     ;
      // an empty union, which is TS1110 "Type expected". The generated header
      // carries `// @ts-nocheck`, but that suppresses semantic errors only —
      // a parse error still fails `tsc --noEmit`. So a fresh clone that runs
      // `npm run build` before `npm run typecheck` breaks its own typecheck.
      // `buildLocale()` calls `generateFluentDts()` whenever `dts` is set, with
      // no guard on the message count; the one-line fix upstream is to skip the
      // write, or emit `export type FluentMessageId = never;`, when the set is
      // empty.
      //
      // TODO(P1-T30): file this upstream at
      // https://github.com/northword/zotero-plugin-scaffold/issues and replace
      // this TODO with the issue link. P1-T30 could not file it: no `gh` on the
      // machine, and opening a public issue on someone else's repository is not
      // an agent's call. A search of that tracker on 2026-10-01 found no
      // existing report (the Fluent issues open there are #140, #125 and #70).
      // What to file: title "fluent.dts writes a syntactically invalid
      // d.ts when there are no .ftl files"; body = the five-line generated file
      // above, the `tsc --noEmit` output `error TS1110: Type expected`, the note
      // that `@ts-nocheck` does not suppress a parse error, the reproduction
      // (any project with `build.fluent.dts` set and no `.ftl` under
      // `addon/locale/`, e.g. before the first bundle lands), and the
      // `generateFluentDts()` / `buildLocale()` lines in
      // `dist/shared/scaffold-src-*.mjs`.
      dts: "typings/i10n.d.ts",
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
    // P0-T13 (V-5), 2026-09-15: these names are the installed
    // zotero-plugin-scaffold 0.9.2's `TestConfig`, and the runner ran green
    // with them. docs/13 §1.4's `timeout`, `abort`, `exit`, `startDelay` and
    // `reporter` are each a TS2353/TS2561 excess-property error against
    // `defineConfig` — so `npm run typecheck`, which includes this file, is
    // what catches a wrong key; at runtime an unknown key is silently ignored.
    // The full key list is `entries`, `prefs`, `mocha.timeout`, `abortOnFail`,
    // `watch`, `headless`, `startupDelay`, `waitForPlugin`, `hooks`. There is
    // no `exit` key (`--exit-on-finish` / `--no-watch` set `watch: false`) and
    // no `reporter` key (the runner's HTTP reporter is hard-coded).
    //
    // Test runs also inherit `server.devtools` (so the Browser Toolbox opens)
    // and `server.startArgs`, but NOT `server.debugOutputFile`: an integration
    // run writes no `.scaffold/logs/` file.
    entries: ["test/integration"],
    mocha: {
      timeout: 30000,
    },
    // Scaffold's default is 1000, not docs/13's 10000.
    startupDelay: 10000,
    // Not a function *body*: the runner does `eval(waitForPlugin)()`, so this
    // must be a function *expression*. It polls every 100 ms and gives up after
    // a hard-coded 10 s (after `startupDelay`), failing the run with
    // "Internal: Plugin awaiting timeout". `data.initialized` is set last in
    // `hooks.onStartup` (P0-T07).
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

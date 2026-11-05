# 13 — Testing, Build, and Release

**Project:** `research_helper` — Zotero 10.x plugin (bootstrapped: `manifest.json` + `bootstrap.js`), fully client-side, no backend.
**Scope of this document:** the development toolchain, the testing strategy, API/LLM fixtures, CI and release automation, versioning and update delivery, distribution, and the pre-release manual QA checklist.

**Not in scope here:** platform APIs (`01-zotero-plugin-platform.md`), API contracts (`02`, `03`, `04`), module boundaries (`07-architecture-and-data-model.md`), requirements (`10-requirements-and-user-stories.md`), phasing (`11-implementation-roadmap.md`), prompts (`12-prompt-library.md`).

Everything below that could not be confirmed against a primary source is marked `> **Unverified:**`.

---

## 1. Toolchain

### 1.1 The recommended stack (2026)

Zotero's own developer documentation for plugin development is explicitly described on the page as a work in progress and covers only the manual proxy-file workflow ([zotero.org/support/dev/client_coding/plugin_development](https://www.zotero.org/support/dev/client_coding/plugin_development)). The de facto modern toolchain comes from the community, coordinated at [zotero-plugin.dev](https://zotero-plugin.dev/), which links the canonical pieces:

| Layer | Package / repo | Role |
| --- | --- | --- |
| Project template | [`windingwind/zotero-plugin-template`](https://github.com/windingwind/zotero-plugin-template) | Opinionated starting repo wiring everything below together |
| Build / dev server / test / release | [`zotero-plugin-scaffold`](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold) (npm: `zotero-plugin-scaffold`) | Compiles TS via esbuild, does placeholder substitution, localizes FTL and prefs, packages the XPI, runs Zotero with the plugin installed from source, hot-reloads, runs in-Zotero tests, and publishes releases |
| Zotero API wrappers | [`zotero-plugin-toolkit`](https://github.com/windingwind/zotero-plugin-toolkit) (npm: `zotero-plugin-toolkit`) | Managed registration of UI elements, shortcuts, prefs panes, notifiers — with automatic unregistration, which directly serves FR-56 |
| Type definitions | [`zotero-types`](https://www.npmjs.com/package/zotero-types) | TypeScript definitions for Zotero's JS internals |
| Bundler | **esbuild** (inside scaffold) | Transpiles/bundles TS to the single JS file loaded by `bootstrap.js` |
| Lint | [`@zotero-plugin/eslint-config`](https://npmx.dev/package/@zotero-plugin/eslint-config) | Shared ESLint config for Zotero plugins |
| Dependency updates | [`zotero-plugin-dev/renovate-config`](https://github.com/zotero-plugin-dev/renovate-config) | Renovate preset tuned for this ecosystem |
| Reusable CI | [`zotero-plugin-dev/workflows`](https://github.com/zotero-plugin-dev) | `setup-js` action and `release-plugin.yml` reusable workflow used by the template |

**Decision for `research_helper`:** start from `windingwind/zotero-plugin-template`, keep `zotero-plugin-scaffold` as the build/dev/test/release driver, adopt `zotero-plugin-toolkit` for registration lifecycle, and depend on `zotero-types` for typing. Write our own CI workflows (§5) rather than only calling the reusable ones, so the pipeline is explicit and auditable — but keep the reusable `release-plugin.yml` as a documented alternative.

Version note at time of writing: `zotero-plugin-toolkit` ≈ 5.2.x, `zotero-types` ≈ 4.1.x.
> **Unverified:** whether the current `zotero-types` release fully covers the Zotero 10 API surface we depend on. Spike V-6 in `11-implementation-roadmap.md` measures this; if it lags, add a local `typings/zotero-augment.d.ts`. **The directory is `typings/`, not `types/`** — that is the name `07-architecture-and-data-model.md` §2.2 declares, it is where the scaffold already emits `typings/prefs.d.ts` and `typings/i10n.d.ts` (§1.4), and it is one of the four entries in §1.5's tsconfig `include`. A file placed under `types/` would never be typechecked and the augmentation would silently have no effect.

Vite is *not* used. The scaffold standardizes on esbuild, and a Zotero plugin has no dev-server/HMR-in-browser story that Vite would improve; introducing Vite would mean re-implementing the scaffold's placeholder substitution, FTL prefixing, prefs prefixing, and XPI packaging.

---

### 1.2 Repository layout

> **`07-architecture-and-data-model.md` §2.2 owns the directory tree** — every layer, every module path, and the dependency rule between them. The listing below is the same tree at one level of depth, annotated for build and test purposes; where the two disagree, §2.2 wins and this listing is the defect. An earlier draft of this section had **`src/platform/`** where §2.2 declares **`src/zotero/`**, and omitted `bootstrap/`, `model/`, `pipeline/`, `prefs/` and `i18n/` entirely. This is the one place in the corpus that records that rename, so: the Zotero-facing adapter layer is `src/zotero/`; `src/platform/` does not exist and no document should reintroduce it.
>
> **This listing is build-visible only, which is why it does not declare `docs/` or `plan/`.** Everything drawn below either ships inside the XPI (`addon/`), is bundled into it (`src/`), or is executed by the pipeline (`test/`, `scripts/`, `.github/workflows/`). The documentation and planning directories — `docs/` for the living design corpus, `docs/spikes/` for the dated, immutable spike and measurement reports, and `plan/` (with `plan/decisions/`) for the execution plan — reach neither the build nor the test run, so they are declared where top-level repository directories are owned, in **`07-architecture-and-data-model.md` §2.2.1**. Nothing in CI reads them, and nothing has to be excluded for them: the XPI is `addon/` copied verbatim plus the bundled `src/` output (see the paragraph below this tree, and §1.4), so a directory that is neither is outside the package by construction rather than by rule.

```
research_helper/
├─ addon/                       # static plugin payload
│  ├─ manifest.json             # with __placeholders__
│  ├─ bootstrap.js
│  ├─ prefs.js                  # default preferences (must be at addon root)
│  ├─ content/
│  │  ├─ preferences.xhtml
│  │  ├─ searchDialog.xhtml     # + reportWindow.xhtml (07-… §2.2)
│  │  └─ icons/
│  └─ locale/                   # per-surface FTL, flat: research-helper-<surface>.ftl (01-… §9.1)
│     ├─ en-US/
│     └─ ko-KR/
├─ src/                         # TypeScript, bundled by esbuild
│  ├─ index.ts                  # entry; exposes the plugin object on Zotero
│  ├─ addon.ts                  # Addon class: DI container + lifecycle state
│  ├─ hooks.ts                  # onStartup / onShutdown / onMainWindowLoad …
│  ├─ bootstrap/                # composition root: container, registries, migrations
│  ├─ core/                     # platform-agnostic infra: jobQueue, rateLimit, cache,
│  │                            #   http, logger, errors, provenance — NO Zotero imports
│  ├─ model/                    # pure types + guards: canonicalWork, ids, merge, usage
│  ├─ sources/                  # pubmed, europepmc, crossref, semanticscholar, arxiv, biorxiv
│  ├─ llm/                      # provider abstraction + 4 adapters + shared/
│  ├─ tts/                      # gemini TTS + audio assembly
│  ├─ pipeline/                 # summarize, trendReport, related, recommend, audioReport
│  ├─ zotero/                   # the ONLY directory allowed to touch Zotero.* (R-1 isolation)
│  ├─ prompts/                  # prompt text as data (12-… §17.3)
│  ├─ prefs/                    # typed pref schema, keys, secret helpers
│  ├─ i18n/
│  └─ ui/
├─ schema/
│  └─ provenance.schema.json    # FR-8 export schema (07-… §5.3)
├─ test/
│  ├─ unit/                     # Node, vitest — pure logic
│  ├─ contract/                 # Node, vitest — record/replay against fixtures
│  ├─ integration/              # in-Zotero, mocha via scaffold  (*.spec.ts)
│  ├─ helpers/                  # fake clock, fake HTTP, in-memory Cache/JobStore
│  └─ fixtures/                 # one directory per SourceId (07-… §11.1 step 5)
│     ├─ pubmed/ europepmc/ crossref/ semanticscholar/ arxiv/ biorxiv/ medrxiv/
│     └─ llm/
├─ scripts/
│  └─ record-fixtures.ts        # refreshes recorded API responses
├─ zotero-plugin.config.ts
├─ tsconfig.json
├─ package.json
├─ .env.example
└─ .github/workflows/{ci.yml,release.yml,compat.yml}
```

`addon/` holds files copied verbatim (with placeholder substitution); `src/` is bundled. Default preferences must live in a root-level `prefs.js`, not a subdirectory ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)).

`test/contract/` is this document's addition to §2.2's `test/` tree — §2.2 lists `unit/`, `integration/`, `fixtures/` and `helpers/`, and the record/replay layer in §2.2 lives under `unit/` there. Keep contract tests separate: §2.2's dependency rule is about `src/`, and this split is a runner concern (§2.2's `unit/` and this `contract/` both run under Vitest in Node).

---

### 1.3 `manifest.json`

The template's manifest shows the canonical shape and the placeholders the scaffold substitutes:

```json
{
  "manifest_version": 2,
  "name": "__addonName__",
  "version": "__buildVersion__",
  "description": "__description__",
  "homepage_url": "__homepage__",
  "author": "__author__",
  "icons": {
    "48": "content/icons/favicon@0.5x.png",
    "96": "content/icons/favicon.png"
  },
  "applications": {
    "zotero": {
      "id": "__addonID__",
      "update_url": "__updateURL__",
      "strict_min_version": "6.999",
      "strict_max_version": "8.*"
    }
  }
}
```

For `research_helper` targeting Zotero 10 only:

```json
{
  "manifest_version": 2,
  "name": "__addonName__",
  "version": "__buildVersion__",
  "description": "__description__",
  "homepage_url": "__homepage__",
  "author": "__author__",
  "icons": {
    "48": "content/icons/favicon@0.5x.png",
    "96": "content/icons/favicon.png"
  },
  "applications": {
    "zotero": {
      "id": "__addonID__",
      "update_url": "__updateURL__",
      "strict_min_version": "10.0",
      "strict_max_version": "10.0.*"
    }
  }
}
```

Notes:

- `applications.zotero` is **required** for Zotero to recognize the plugin at all.
- `id` is an extension-ID-style string: use `research-helper@suppakoko.github.io` (or the institution's actual domain).
- Zotero's Zotero-10 developer page states directly: update `strict_max_version` to `10.0.*`, and *"If no changes are required, you can simply update `strict_max_version` in your plugin's update manifest without releasing a new version."* — see §6.
- `strict_min_version: "6.999"` in the template is the idiom for "allow Zotero 7 betas". We do not need it; we deliberately floor at 10.0 (`10-requirements-and-user-stories.md`, open question 15).

---

### 1.4 `zotero-plugin.config.ts`

The scaffold reads `zotero-plugin.config.ts`. Documented keys (from the [scaffold docs](https://zotero-plugin.dev/zotero-plugin-scaffold/)):

Top level: `name`, `id`, `namespace`, `source`, `dist` (default `.scaffold/build`), `xpiName`, `xpiDownloadLink`, `updateURL`.

Under `build`: `assets`, `define`, `esbuildOptions`, `makeManifest.enable` (true by default), `makeUpdateJson` (with `updates` and `hash`), `fluent.prefixLocaleFiles`, `fluent.prefixFluentMessages`, `fluent.dts`, `prefs.prefixPrefKeys`, `prefs.prefix` (default `extensions.${namespace}`, no trailing dot), `prefs.dts`, `hooks`.

Under `server`: `startArgs`, `devtools`, `debugOutputFile`, `debugOutputWindow`, `asProxy`.

Under `test` — **corrected 2026-09-15 against the installed scaffold 0.9.2's types (`P0-T13`)**: `entries` (default `["test"]`), `prefs`, `mocha.timeout`, `abortOnFail`, `watch`, `headless`, `startupDelay` (default **1000**), `waitForPlugin`, `hooks`. The names this section previously gave — `timeout`, `abort`, `exit`, `reporter`, `startDelay` — are all type errors and are silently ignored at runtime, so `npm run typecheck` is what catches a wrong key. There is no `exit` key (`--exit-on-finish` / `--no-watch` set `watch: false`) and no `reporter` key. `waitForPlugin` must be a function *expression* string: the runner `eval`s it and calls the result, and gives up after a fixed 10 s.

Under `release`: `bumpp`, `changelog`, `github`.

> **Unverified:** the `test` key names above are taken from the published [scaffold test docs](https://zotero-plugin.dev/zotero-plugin-scaffold/test.html), but the scaffold's own type definitions on `main` currently name them `abortOnFail`, `watch` and `startupDelay`, and put `timeout` under `mocha`. The two disagree, so the docs are presumably behind (or ahead of) the release we will install. **Diff `zotero-plugin.config.ts` against the installed scaffold version's types in Phase 0 (spike V-5) before relying on these names.**

A working configuration for this project:

```ts
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: "Research Helper",
  id: "research-helper@suppakoko.github.io",
  namespace: "researchHelper",
  xpiName: "research-helper",
  xpiDownloadLink:
    "https://github.com/suppakoko/research_helper/releases/download/v{{version}}/research-helper.xpi",
  updateURL:
    "https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg,
      updateJSON: "update.json",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        bundle: true,
        target: "firefox115",
        outfile: ".scaffold/build/addon/content/scripts/research-helper.js",
      },
    ],
    fluent: {
      prefixLocaleFiles: true,
      prefixFluentMessages: true,
    },
    prefs: {
      prefixPrefKeys: true,
      prefix: "extensions.zotero.research-helper",
      dts: "typings/prefs.d.ts",
    },
    makeUpdateJson: {
      hash: true,
    },
  },

  server: {
    devtools: true,        // appends --jsdebugger to Zotero's start args
    debugOutputFile: true, // capture stdout/stderr into .scaffold/logs/
  },

  test: {
    entries: ["test/integration"],
    mocha: { timeout: 30000 },
    startupDelay: 10000,
    waitForPlugin: `() => Zotero.ResearchHelper?.data?.initialized`,
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
```

> **Unverified:** the exact `esbuildOptions` array shape and the `{{version}}` templating in `xpiDownloadLink` follow the template's conventions but should be diffed against the current template on first scaffold, since the scaffold is under active development. Do not treat this file as authoritative until the Phase 0 spike (V-1) confirms it builds.

`build.prefs.prefixPrefKeys` combined with `prefs.prefix` means our preferences are namespaced as `extensions.zotero.research-helper.*` — the branch decided in `01-zotero-plugin-platform.md` §7.1 and used by every pref name in docs 01, 06, 07 and 08. Note that `namespace` above is the JavaScript namespace (`Zotero.ResearchHelper`) and is deliberately a different string; do not conflate the two. **API keys are not among them.** Per decision D5 (`00-overview.md` §3), secrets go through `Zotero.OSKeyStore.encrypt()` into `Services.logins`, never into a preference; `Zotero.Prefs` holds only non-secret settings and key-presence booleans. See `09-security-privacy-and-api-keys.md`.

---

### 1.5 TypeScript configuration

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["zotero-types", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "test", "typings", "zotero-plugin.config.ts"]
}
```

`noEmit: true` because esbuild does the emitting; `tsc` is used purely as a typechecker in `npm run typecheck` and in CI. `target: ES2022` is safe for the Firefox-derived runtime Zotero 10 ships; the esbuild `target` (`firefox115`) is what actually governs downlevelling.
> **Unverified:** the precise Gecko/Firefox version underlying Zotero 10. `01-zotero-plugin-platform.md` §4.5 names **`firefox140`** as the value to raise the template's `firefox115` to for a Zotero-10-only plugin, and asks for the same verification (build and smoke-test) — that is one open question, not two, and `firefox140` is the candidate Phase 0 has to confirm or refute. Confirm it in Phase 0 and set the esbuild `target` accordingly; until it is confirmed, target a conservative `firefox115`.

---

### 1.6 Development environment

**`.env`** (copied from `.env.example`, git-ignored):

```
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=C:\Program Files\Zotero\zotero.exe
ZOTERO_PLUGIN_PROFILE_PATH=C:\Users\<user>\AppData\Roaming\Zotero\Zotero\Profiles\dev.default
ZOTERO_PLUGIN_DATA_DIR=D:\ZoteroDev\data
GITHUB_TOKEN=<only needed for local release publishing>
```

Per the scaffold's Dev Serve docs: `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` is required (on macOS typically `*/Zotero.app/Contents/MacOS/zotero`); `ZOTERO_PLUGIN_PROFILE_PATH` and `ZOTERO_PLUGIN_DATA_DIR` are optional. These may also be set as system/user environment variables, which is convenient when maintaining several plugins — note the documented caveat that `.env` values currently do not override system-level settings.

**Creating a dedicated development profile.** Never develop against the production profile: a plugin bug can damage a 10,000-item library.

**The profile manager is optional.** Verified 2026-09-10 against `zotero-plugin-scaffold` 0.9.2 (task `P0-T08`): `startZoteroInstance()` passes `-profile <resolved path>` and `--dataDir <resolved path>`, and `createProfile()` is literally `ensureDir(path)`. So `ZOTERO_PLUGIN_PROFILE_PATH` is a **directory path, not a profile name from `profiles.ini`** — point it at any empty directory and Zotero initialises a fresh profile there on first launch, creating the data directory too. Such a profile deliberately never appears in the profile manager, which also means it can never be selected as the startup default by accident. Both routes work:

1. *Recommended — no GUI.* Put an unused absolute path in `ZOTERO_PLUGIN_PROFILE_PATH` (e.g. `D:ZoteroDevprofile`) and a separate one in `ZOTERO_PLUGIN_DATA_DIR`, then run `npm start`.
2. *GUI.* Launch the profile manager with `zotero.exe -P` (Windows) / `/Applications/Zotero.app/Contents/MacOS/zotero -P` (macOS), create a profile named e.g. `dev` pointed at a separate data directory, and put **the profile's directory path** — not its name — in `ZOTERO_PLUGIN_PROFILE_PATH`. Note that `-P` silently does nothing if Zotero is already running; close it first.
3. In the dev profile, enable `Advanced → Config Editor` and consider setting the debug logging preferences.

**Debugging the plugin.** Verified 2026-09-15 (`P0-T08`). With `server.devtools: true`, `npm start` opens the Browser Toolbox as a separate window already attached to the **parent (chrome) process**, which is where the plugin sandbox runs. In its Debugger tab press `Ctrl+P`, type `research-helper.js`, and set breakpoints in the bundle (`.scaffold/build/addon/content/scripts/research-helper.js`). **Only the bundle is debuggable** — no source map is emitted, so `src/*.ts` does not appear; the bundle is unminified and carries `// src/…` comments. Two cautions: a paused thread freezes the main window's timers and events for everything, and the Toolbox is attached from startup, so **a `debugger;` statement anywhere in plugin code pauses Zotero** until someone resumes it in the Toolbox — never leave one in. Automation uses scaffold's separate `-start-debugger-server <port>` (the port is on the running `zotero.exe` command line); a line breakpoint by `sourceUrl` binds, and `why.actors` is `[null]` on Gecko 140, so match a pause by `frame.where`.

**A glob inside a TSDoc comment can break the test transform, and the error points somewhere else.**
Recorded 2026-09-30 (`P1-T08`). The two characters `*/` terminate a block comment, so writing a path
like `sources/*/query.ts` in prose inside `/** … */` ends the comment early and the rest of it
becomes code. **`tsc --noEmit` accepted the resulting file**; what failed was vitest's oxc transform,
with a parse error pointing **about 400 lines away** from the cause. Write `sources/<id>/query.ts`.
Worth knowing because the symptom sends you looking in the wrong file, and because a green typecheck
is not evidence that the test runner can parse the same source.

**Corporate TLS inspection breaks Node tooling, not the plugin.** Measured 2026-09-30 on the project owner's machine (`P0-T21`): `api.semanticscholar.org`, `eutils.ncbi.nlm.nih.gov`, `api.crossref.org`, `www.ebi.ac.uk` and `api.biorxiv.org` were served with certificates issued by `C=KR, O=SOOSAN INT, CN=ePrism SSL` — a network security gateway re-signing HTTPS — while `export.arxiv.org` kept its real issuer. Node trusts **its own bundled CA list, not the Windows certificate store**, so every intercepted host failed with `SELF_SIGNED_CERT_IN_CHAIN` while the one un-intercepted host succeeded. The fix for any Node-based script here is `NODE_USE_SYSTEM_CA=1` (Node 22.15+; verified on 22.23.0), which trusts what Windows already trusts — **not** `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables verification entirely. **The plugin itself is unaffected**: requests from inside Zotero go through Gecko, which honours the OS trust store, and every in-Zotero probe on the same machine and network succeeded.

**Useful launch flags** (from Zotero's plugin-development page):

| Flag | Effect |
| --- | --- |
| `-P <Profile>` | Launch with the named profile (bare `-P` opens the profile manager) |
| `-purgecaches` | Force re-reading of cached files |
| `-ZoteroDebugText` | Emit debug text output to the console |
| `-jsconsole` | Open the JavaScript console |
| `--jsdebugger` | Appended automatically by the scaffold when `server.devtools: true`; opens the Firefox developer tools / debugger against the Zotero process |

Do not invent additional flags. `--debugger` as such is **not** documented for Zotero; the scaffold uses `--jsdebugger`.

**Two ways to load a plugin from source:**

1. **Scaffold dev serve (preferred).** `npm start` (which runs `zotero-plugin serve`) launches Zotero with the dev profile and installs the plugin from source, then watches: *"When source code changes are detected, the plugin is automatically recompiled and reloaded in Zotero."* Modern versions drive this over the Remote Debugging Protocol rather than proxy files; `server.asProxy: true` switches back to the proxy-file approach for older Zotero.
2. **Proxy file (manual fallback, documented by Zotero).** With Zotero **closed**, create a file in the profile's `extensions/` directory named exactly after the extension ID (e.g. `research-helper@suppakoko.github.io`) whose contents are the absolute path to the plugin's root source directory. Then open `prefs.js` in the profile directory and **delete the lines containing `extensions.lastAppBuildId` and `extensions.lastAppVersion`**, save, and restart Zotero — this forces Zotero to re-scan and discover the plugin. This is the trick to know when hot reload misbehaves, and it is the reason Phase 0 spike V-2 exists.

**Debug output.** Use `Help → Debug Output Logging` in the Zotero UI, and/or `server.debugOutputFile: true` to capture stdout/stderr into timestamped files under `.scaffold/logs/`. `server.debugOutputWindow: true` opens the Debug Output window automatically at launch. Ad-hoc snippets can be run from `Tools → Developer → Run JavaScript`.

**npm scripts** (`package.json`):

```jsonc
{
  "scripts": {
    "start": "zotero-plugin serve",
    "build": "tsc --noEmit && zotero-plugin build",
    "typecheck": "tsc --noEmit",
    "lint:check": "eslint . && prettier --check .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "test:unit": "vitest run --dir test/unit",
    "test:contract": "vitest run --dir test/contract --passWithNoTests",
    "test:integration": "zotero-plugin test",
    "test": "npm run test:unit && npm run test:contract",
    "fixtures:record": "tsx scripts/record-fixtures.ts",
    "release": "zotero-plugin release"
  }
}
```

`test:contract` carries `--passWithNoTests` because `test/contract/` stays empty until
Phase 1, and Vitest exits **1** on an empty directory — verified 2026-09-10 under
`vitest@5.0.0` (task `P0-T12`), where it made `npm test` fail on a green tree. Remove the flag
once the directory has specs, so a contract suite that silently stops being collected fails
loudly again.

---

## 2. Testing strategy

Four layers, deliberately weighted toward the cheap ones.

```
      ┌─────────────────────────────┐
      │  Manual QA (§8)             │  per release, 3 OSes
      ├─────────────────────────────┤
      │  Integration (in Zotero)    │  ~20-30 specs, mocha via scaffold
      ├─────────────────────────────┤
      │  Contract (record/replay)   │  ~7 sources x N + 4 LLM providers
      ├─────────────────────────────┤
      │  Unit (Node, mocked globals)│  the bulk; every pure function
      └─────────────────────────────┘
```

Coverage targets: **≥ 85% line coverage on `src/core/`, `src/sources/*/normalize*`, `src/llm/`** (the pure logic); no coverage target on `src/ui/`, which is covered by integration and manual QA.

---

### 2.1 Layer 1 — Unit tests in Node

**Runner:** [Vitest](https://vitest.dev/) (fast, native ESM/TS, built-in coverage via v8, snapshot support). Mocha is used *inside* Zotero (§2.3) because the scaffold ships it; Vitest is used *outside*. Two runners is a deliberate, documented split, not an accident.

**What is unit-tested — everything that is pure:**

Module paths below are `07-architecture-and-data-model.md` §2.2's; an earlier draft of this table used flattened invented paths (`src/core/dedup.ts`, `src/core/http/client.ts`, `src/core/rateLimiter.ts`, `src/zotero/`) that §2.2 does not declare.

| Module | Representative tests |
| --- | --- |
| Query builders (`src/sources/*/query.ts`) | boolean translation, parenthesis balancing, date-range rendering per source, URL encoding, key redaction in the recorded URL |
| Mappers (`src/sources/*/mapper.ts`) | source record → `CanonicalWork`; author-name splitting; date parsing across `2024`, `2024-03`, `2024 Mar 15`, `2024 Spring`; JATS/HTML abstract stripping; DOI normalization; item-type mapping |
| Dedup (`src/sources/shared/dedupe.ts`) | identifier matching, title normalization (case, punctuation, diacritics, greek letters, subscripts), similarity scoring, threshold behaviour, "flag not merge" rule |
| Merge (`src/model/merge.ts`) | field-priority resolution against `02-literature-database-apis.md` §10.4's precedence table, source list accumulation, preprint/published policy |
| Chunkers (`src/llm/shared/chunking.ts`) | token-budget chunking, sentence/paragraph boundary preservation, overlap, degenerate inputs (empty, one 50k-char word) |
| Token/cost estimation (`src/llm/shared/tokenEstimate.ts`) | estimate monotonicity, per-model pricing lookup, currency formatting, budget-ceiling arithmetic, and that a stored `llm.tokenEstimateCalibration` factor is applied before the headroom margin |
| HTTP client (`src/core/http/client.ts`, `retry.ts`) | that Zotero's own retry loop stays disabled (`noRetryOnThrottle`, `errorDelayMax: 0` — `07-architecture-and-data-model.md` §7.4), `Retry-After` parsing, cancellation via `cancellerReceiver` |
| Citation binding (`src/pipeline/trendReport/`) | marker extraction, resolution against a collection index, rejection of unresolvable markers |
| Script preparation (`src/tts/ssml.ts`) | markdown stripping, citation removal, number/abbreviation expansion, segmentation at the TTS length limit |
| Provenance (`src/core/provenance.ts`) | conformance of a `SearchProvenance` object (`07-architecture-and-data-model.md` §5.3) against `schema/provenance.schema.json`, and key redaction in `transmittedUrl` |
| Rate limiter (`src/core/rateLimit/tokenBucket.ts`) | token-bucket behaviour under fake timers, `Retry-After` honouring, jitter bounds |

**Mocking `Zotero.*` in Node.** Pure modules must not import Zotero at all — that is the dependency rule in `07-architecture-and-data-model.md` §2.3, enforced by an ESLint rule forbidding the `Zotero` global outside `src/zotero/`. Everything that genuinely needs Zotero goes through `src/zotero/`, which is mocked wholesale in unit tests; `core/` reaches the platform through ports (`PrefStore`, `Clock`, `HttpClient`) supplied by the container, so it needs no mock at all.

For the small number of tests that do want a Zotero global, install a minimal fake in a Vitest setup file:

```ts
// test/setup/zotero-global.ts
import { vi } from "vitest";

class FakeItem {
  private _fields = new Map<string, string>();
  // `nextId` is declared before `id` on purpose. Statics initialise at
  // class-definition time and instance fields at construction, so the reverse
  // order works at runtime — but TypeScript rejects it textually with
  // "TS2729: Property 'nextId' is used before its initialization"
  // (observed 2026-09-10 under this project's tsconfig, task P0-T12).
  static nextId = 1;
  public id = FakeItem.nextId++;
  constructor(public itemType: string) {}
  setField(f: string, v: string) { this._fields.set(f, v); }
  getField(f: string) { return this._fields.get(f) ?? ""; }
  setCreators(_c: unknown[]) { /* recorded via spy */ }
  addTag(_t: string) {}
  async saveTx() { return this.id; }
}

const Zotero = {
  debug: vi.fn(),
  logError: vi.fn(),
  Prefs: (() => {
    const store = new Map<string, unknown>();
    return {
      get: vi.fn((k: string) => store.get(k)),
      set: vi.fn((k: string, v: unknown) => void store.set(k, v)),
      clear: vi.fn((k: string) => void store.delete(k)),
      __store: store,
    };
  })(),
  Items: { getAsync: vi.fn(), get: vi.fn() },
  Collections: { getAsync: vi.fn() },
  Item: FakeItem,
  DB: { executeTransaction: vi.fn(async (fn: () => Promise<void>) => fn()) },
  HTTP: { request: vi.fn() },
  getMainWindow: vi.fn(() => undefined),
  locale: "en-US",
};

vi.stubGlobal("Zotero", Zotero);
export { Zotero as FakeZotero };
```

Registered in `vitest.config.ts` via `test.setupFiles`. The fake is intentionally small: if a test needs a richer Zotero, that is a signal the code belongs in an integration test instead.

> **Unverified:** exact signatures of `Zotero.DB.executeTransaction` and `Zotero.Item` construction on Zotero 10. The fake must be reconciled against `zotero-types` and against observed behaviour in Phase 0 (spike V-12); a fake that lies is worse than no fake.

---

### 2.2 Layer 2 — Contract tests (record / replay)

**Purpose.** Guarantee that our parsers still handle what the real services actually return, without hitting the network in CI. These are the tests that catch "Crossref changed its abstract field shape" *before* users do.

**Mechanism.** A tiny record/replay transport, not a heavyweight VCR library:

- `src/core/http/client.ts` exposes `httpRequest(req): Promise<HttpResponse>` and is the single outbound choke point (this also serves FR-54 redaction and FR-11 headers).
- In contract tests, `httpRequest` is replaced by a replay transport that hashes `{method, url-with-keys-redacted, body}` into a fixture filename and returns the recorded `{status, headers, body}`.
- In record mode (`FIXTURE_MODE=record npm run fixtures:record`), the real transport runs, responses are written to `test/fixtures/`, and a redaction pass strips API keys, `Authorization` headers, and any `mailto` values before writing.
- A missing fixture in replay mode is a **test failure with the exact command to record it**, never a silent network call.

> **Corrected 2026-10-15 (owner review of 2026-10-14, row 72; shape from `P2-T25`).** Until this date
> the block below showed `node:crypto`'s `createHash`, `node:fs/promises`' `readFile` and a one-argument
> `replayTransport(dir)` living in `test/contract/_transport.ts`. The harness now lives in
> `test/support/fixtureReplay.ts` with **no platform import**: it hashes with `test/support/sha256.ts`
> (a plain-TypeScript SHA-256, byte-identical to `createHash`'s and asserted so against `node:crypto` by
> `test/contract/replayHarness.test.ts`), because the Zotero sandbox has only the *asynchronous*
> `crypto.subtle.digest` (measured 2026-10-13 on Zotero 10.0.3), and it takes a `(dir, io)` pair where
> `io` is the `FixtureIo` port — `test/support/fixtureIoNode.ts` in Node, `test/support/fixtureIo.zotero.ts`
> inside Zotero. `test/contract/_transport.ts` remains as the Node face that binds the port. The fixture
> name's input string, `` `${method} ${redacted} ${body ?? ""}` ``, has not changed shape: every
> committed fixture is named by it.

```ts
// test/support/fixtureReplay.ts — the core; test/contract/_transport.ts binds it to Node
import type { FixtureIo } from "./fixtureIo";
import { sha256Hex } from "./sha256";

export function fixtureKey(req: { method: string; url: string; body?: string }) {
  const redacted = req.url.replace(/(api[_-]?key|key|token)=[^&]+/gi, "$1=REDACTED");
  return sha256Hex(`${req.method} ${redacted} ${req.body ?? ""}`).slice(0, 16);
}

export function replayTransport(dir: string, io: FixtureIo) {
  return async (req: { method: string; url: string; body?: string }): Promise<RecordedExchange> => {
    const name = `${fixtureKey(req)}.json`;
    const file = `${dir}/${name}`;
    try {
      return JSON.parse(await io.readText(dir, name)) as RecordedExchange;
    } catch {
      throw new Error(
        `Missing fixture ${file} for ${req.method} ${req.url}\n` +
        `Record it with: FIXTURE_MODE=record npm run fixtures:record`,
      );
    }
  };
}
```

**What contract tests assert:**

1. The transmitted request matches the expected shape (endpoint, params, headers, rate-limit-relevant identification).
2. The parser produces the expected canonical record for a *known* fixture — asserted against a committed snapshot.
3. Error responses (400/401/429/500, malformed JSON, truncated XML, empty result sets) produce the expected typed errors, not exceptions.
4. Pagination is followed correctly to the configured limit.

**Deterministic LLM mocking.** LLM providers are non-deterministic by nature, so contract tests assert two different things:

- **Wire-shape tests (deterministic).** Given a fixed prompt and options, the adapter must produce an exact request body — asserted against a committed snapshot. This is where a provider adapter regression (wrong role names, missing `anthropic-version` header, wrong `max_tokens` field name) is caught.
- **Response-parsing tests (deterministic).** Given a recorded provider response — including streaming SSE chunk sequences, tool-call shapes, refusals, truncation with `finish_reason: "length"`, and rate-limit errors — the adapter must produce the expected internal result and usage numbers.

The LLM is *never* actually called in unit or contract tests. A `MockLLMProvider` implementing the same interface returns canned, scripted responses:

```ts
// test/support/mockLLM.ts
import type { LLMProvider, LLMRequest, LLMResult } from "@/llm/provider";

export function mockLLM(script: Array<LLMResult | Error>): LLMProvider & { calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];
  let i = 0;
  return {
    calls,
    id: "mock",
    async complete(req: LLMRequest): Promise<LLMResult> {
      calls.push(req);
      const next = script[Math.min(i++, script.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    async listModels() { return ["mock-small", "mock-large"]; },
  };
}
```

This makes the interesting behaviours testable deterministically: retry-then-succeed, context-length-error-then-shrink-and-retry (FR-34), budget ceiling reached mid-job (FR-24), cancellation at item 87 of 200 (FR-23), malformed JSON output rejected by the schema validator (R-6), and a trend report containing an unresolvable citation being rejected (R-7).

**Quality of generated text is not asserted here.** Prompt-quality regression is handled by the small curated evaluation set described in `06-summarization-and-trend-report.md`, run manually — never as a blocking CI gate, because it costs money and is inherently fuzzy. *Corrected 2026-11-02 (`plan/00` §6 item 335(f)): this read "run manually or in a nightly opt-in job"; a nightly job would need a key in CI (item 287(d)).*

---

### 2.3 Layer 3 — Integration tests inside a real Zotero

**What exists.** `zotero-plugin-scaffold` ships a test runner, and it is the right answer. Per the [scaffold's test documentation](https://zotero-plugin.dev/zotero-plugin-scaffold/test.html):

- Tests **execute inside a live Zotero instance via a proxy plugin**, not in Node, with a temporary profile and data directory, giving *"full access to Zotero's APIs during testing"* and avoiding the extensive mocking that would otherwise be necessary.
- Test files live in `test/` (configurable via `test.entries`) with extensions `.spec.js`, `.spec.ts`, `.test.js`, `.test.ts`.
- **Mocha and Chai globals** (`describe`, `it`, `expect`, `assert`) are available.
- Config keys (scaffold 0.9.2, verified 2026-09-15): `entries`, `prefs`, `mocha.timeout`, `abortOnFail`, `watch`, `headless`, `startupDelay` (default 1000), `waitForPlugin` (a function-*expression* string, e.g. `` `() => Zotero.ResearchHelper?.data?.initialized` ``), `hooks`. See §1.4.
- CLI overrides: `--abort-on-fail`, `--exit-on-finish`, `--no-watch` (equivalent to exit-on-finish), and `-h`/`--help`. **That is the whole list** — `zotero-plugin test` has no `--headless` flag; headless is a config key (`test.headless`) only, and an unknown option makes the CLI exit with an error.
- Headless mode activates automatically on CI services; the **built-in headless implementation supports Ubuntu 22.04 and 24.04 only** — on other systems, disable built-in headless and use `xvfb-run`.

**Recommendation.** Use the scaffold runner as the only in-Zotero test mechanism. Do **not** hand-roll a mocha-in-Zotero harness, and do not attempt to piggyback on Zotero's own internal test infrastructure.

> **Unverified:** whether a public, plugin-consumable `Zotero.Test` API exists in Zotero 10. Zotero's own test suite is internal to the client repository and is not documented as a plugin-facing API. Do not depend on it. If a Phase 0 investigation finds one, it is a bonus, not the plan.

**What integration tests cover** (~20–30 specs; each must be fast and hermetic):

| Area | Spec |
| --- | --- |
| Lifecycle | plugin registers its menu items on `onMainWindowLoad`; `shutdown()` removes every menu item, notifier, and timer (FR-56, R-12) — asserted by enable/disable cycling |
| Item creation | canonical record → `journalArticle` with correct fields, creators, `Extra` identifiers (FR-6, FR-7) |
| Item creation | canonical record → `preprint` with `repository` / `archiveID` |
| Collections | creating a collection, adding items, nesting under a chosen parent |
| Dedup at write time | importing a record whose DOI already exists links the existing item instead of creating a duplicate (FR-51) |
| Notes | summary child note is created with the disclaimer header and `research_helper/ai-summary` tag (FR-20) |
| Notes | "remove generated notes" deletes only `research_helper/`-tagged notes and leaves user notes untouched (NFR-20) |
| Secrets | an API-key-shaped string round-trips through `Zotero.OSKeyStore.encrypt()` → `Services.logins` → search → decrypt, and no key is written to any preference (FR-30, NFR-16) |
| Prefs | non-secret settings round-trip under `extensions.zotero.research-helper.*`; the prefs pane registers (FR-52) |
| Attachments | writing a WAV file and attaching it to an item; the attachment opens (FR-40) |
| Provenance | provenance note is created and its JSON export validates |
| Performance | importing 100 records completes within NFR-1's budget (asserted with a generous multiplier in CI, tightened locally) |
| L10n | `ko-KR` bundle resolves a known key; a missing key falls back to English (FR-55) |
| Report measurement | `reportMeasurement-flow.spec.ts`, added 2026-11-02 (`P4-T23` step 4). Two of its proofs are outside the suite, because a spec cannot run once Zotero has closed: `measure` against the run's `[P4-T23-expect]` lines, on a copy of `.scaffold/test/data/research-helper.sqlite`; and its `[P4-T23-screen]` and `[P4-T23-report]` lines against the same spec's on a build from before the capture, where its six tests fail, as they must |
| Related reads | `zotero/relatedLibrary.spec.ts`, added 2026-11-05 (`P5-T14`). Reads every item type the running Zotero declares (37 on 10.0.3) and a real group library. Its no-write check uses the row's `clientDateModified` and the notifier, each with a real save as its control, because `item.version` moves only on a sync. It also opens `graph.pipelines`' `related` on a real start and ends a run on `rh-error-seed-gone`, which stops before any request |

| Related window | `relatedWindow.spec.ts`, added 2026-11-05 (`plan/00` §6 item 347(d)). A real window on the published host and stub sources: markup in a title, an author's name and a citation context is drawn as text; re-opening and closing cancel a run with no toast (`P5-T16`); the link box reads its preference, and an import from a group seed lands in that group (`P5-T17`'s `wire-pref` and `wire-library`). |
| No live request | `support/liveRequestGuard.ts`, added 2026-11-05 (`plan/00` §6 item 347(c)), installed by `_suite-guards.spec.ts` for the whole run. An `http-on-modify-request` observer cancels any channel with the plugin's `User-Agent` away from loopback, or to a host on `LIVE_SERVICE_HOSTS`, and the root `afterEach` fails the test. The run's log names the hosts it let through. Until then the suite had only the `Zotero.Translate.Search` stub and two recorders scoped to one body each, which do not see a real window starting its own run. |

*Measured 2026-11-05, Zotero 10.0.3: what the guard found on its first whole run.* (1) `reportWindow-flow.spec.ts` and `reportMeasurement-flow.spec.ts` asked the real Europe PMC for their fixtures' DOIs: a report's summary stage walks `acquire.ts`'s full-text ladder whatever provider answers the model. 77 channels were cancelled in that run. Cancelling also slowed the stage past a spec's 60 s wait, since a cancelled channel fails and is retried. Both specs now use `answerEuropePmcWithNothing`. So until this date a full integration run did send those requests, which held fixture DOIs and no key. (2) Saving an item with a DOI makes Zotero itself ask `api.zotero.org/retractions/search`. `test.prefs` in `zotero-plugin.config.ts` now sets `extensions.zotero.retractions.enabled` to false, so a run reaches loopback only: after both changes, one whole run read 1107 channels, cancelled none, and let through only the runner's `localhost` and the closed `127.0.0.1` port `phase1-dod.spec.ts` uses. (3) A root `afterEach` that throws ends the whole Mocha run, so one guard failure hides every later spec: that run stopped at 75 tests of about 316.

*Measured 2026-11-05, Zotero 10.0.3: a spec's `OperationCancelledError` is not the plugin's.* A spec is its own bundle, so a token made with the spec's `createCancellationTokenSource` and given to the pipeline at `graph.pipelines` ends the run as `failed`, with `{"code":"UNTYPED","detail":"non-Error throw"}`, and not `cancelled`. This says nothing about the product: `recommendLibrary.spec.ts` builds the pipeline in its own bundle through `buildPipelineSet` to test a cancel.

Integration tests must never call an external API or an LLM. The `httpRequest` choke point is stubbed inside the test plugin with the same fixture replay used in contract tests, and `MockLLMProvider` is injected.

**Running them.** Locally: `npm run test:integration` (headed, watch). In CI: `ubuntu-latest` with `--exit-on-finish --abort-on-fail` — headless is not a CLI flag; the scaffold enables it automatically on CI services. On Windows/macOS, integration tests are run **manually** as part of the release QA (§8) rather than in CI, per the documented headless limitation.

---

### 2.4 Layer 4 — Manual QA

See §8. Manual QA is where UI, accessibility, real network behaviour, real cost, and real Korean audio quality are checked. It is not optional and it is not automatable in v1.

---

## 3. Fixtures

### 3.1 Inventory

**Literature sources** — for each of PubMed (E-utilities `esearch` + `efetch`), Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv, record at minimum:

| Fixture | Purpose |
| --- | --- |
| `search-typical` | ~20 results for a stable biomedical query, with the date filter applied |
| `search-empty` | zero results |
| `search-single` | one result (off-by-one and "not an array" bugs) |
| `record-rich` | one record with every optional field populated |
| `record-sparse` | one record with no abstract, no DOI, incomplete date |
| `record-unicode` | CJK/Greek/diacritics in title and author names, and a title with subscripts/superscripts — *source-specific, see note (a)* |
| `record-jats-abstract` | an abstract with structured JATS/HTML markup — *source-specific, see note (b)* |
| `record-preprint` | a preprint with a linked published DOI |
| `error-429` | rate-limit response, with `Retry-After` where the host sends one — *source-specific, see note (c)* |
| `error-500` | server error |
| `error-malformed` | truncated/invalid body |
| `paginated` | a multi-page result set exercising the pagination loop |
| `dedup-pair-set` | the same paper as returned by ≥3 different sources — the single most valuable fixture we own |

> **Which rows are source-specific (added 2026-10-15, owner review rows 129 and 162).** The scenario
> *names* are the same for every source — the adapters' unit tests expect the thirteen — but three rows
> cannot mean the same thing on every host:
>
> **(a) `record-unicode` — a CJK title is not obtainable from Europe PMC for MED records** (measured
> 2026-10-14, `P2-T03`). Europe PMC's `title` is the translated English title: the probe
> `TITLE:"基因编辑"` (recorded as `record-unicode-cjk`, 11 hits) returned only Latin titles such as
> `[Advancements in CRISPR-Cas9 for Fanconi anemia].`. The recorded Europe PMC fixture therefore pins
> **diacritics** (`Aracı|Ayça`, `Aslan|Ummuhan Baş`), a raw `<b>-</b>` inside a title and
> `(Withania somnifera)`, and CJK byte-identity is asserted on a hand-built result driven through the
> real mapper. PubMed's CJK case is likewise synthesised from §3.4's sample (`P1-T10`).
>
> **(b) `record-jats-abstract` has no arXiv analogue** — arXiv abstracts are plain text (measured
> 2026-10-15, `P2-T06`). The name is kept and the arXiv fixture pins the host's own markup problem
> instead: a hard-wrapped `<summary>` carrying LaTeX, which must map to a single-spaced abstract.
>
> **(c) `error-429` carries no `Retry-After` on arXiv.** arXiv's measured 429 (`docs/02` §7.1,
> 2026-09-15) is `text/html`, `Rate exceeded.`, `server: Google Frontend`, with **no `Retry-After`**;
> the synthetic arXiv fixture reproduces that shape and the replay asserts `RateLimitError` with
> `retryAfterMs: undefined` and no `penalize` call (`P2-T06`). "Including `Retry-After`" describes
> Crossref and NCBI, the two hosts that send one.

**LLM providers** — for each of OpenRouter, OpenAI, Gemini, Anthropic:

| Fixture | Purpose |
| --- | --- |
| `chat-nonstream-ok` | normal completion with a `usage` block |
| `chat-stream-ok` | the full SSE chunk sequence, including the terminal event |
| `chat-json-ok` | a structured/JSON-mode response matching our schema |
| `chat-json-malformed` | a response that *nearly* matches the schema (trailing prose, code fences) |
| `error-401` | bad key |
| `error-429` | rate limit, with and without `Retry-After` |
| `error-context-length` | the provider's specific over-length error shape |
| `error-truncated` | a completion stopped by `max_tokens` |
| `refusal` | a safety refusal |
| `models-list` | the model-listing endpoint response, for the model selector |

> **Which LLM rows are recorded and which are written (added 2026-10-27, `P3-T30`, split by `plan/00`
> §6 item 298(b)).** Eleven scenarios per provider, forty-four in all: `error-429` is two scenarios,
> `error-429` (with `Retry-After`) and `error-429-no-retry-after`, as the card's Notes say. **Seven are
> recorded live** — `models-list`, `chat-nonstream-ok`, `chat-stream-ok`, `chat-json-ok`,
> `chat-json-malformed`, `error-truncated` and `error-401` (sent with a deliberately invalid,
> key-shaped value built by the recorder, never the owner's key); five of them are billed. **Four are
> written, not recorded**, each with `"synthetic": true` and a reason in its sidecar, as the literature
> sources' 429s are: both `error-429`s (provoking a rate limit spends money and risks the account),
> `error-context-length` (provoking it needs a prompt above the model's context window, up to about a
> million tokens, whose window the bundled price table does not state) and `refusal` (provoking one
> means sending a request the provider's policy forbids). Gemini's `refusal` uses the legacy
> `generateContent` shape `docs/03` §11.5 documents and is driven through `chatViaGenerateContent`,
> because the Interactions API's blocked shape is not documented (`plan/reports/P3-T05.md`). The list
> is `LLM_SCENARIOS` in `scripts/record-fixtures.ts`.

**Gemini TTS** — a short English response and a short Korean response, captured as base64/binary plus headers, sufficient to test the audio-assembly path (`src/tts/audio.ts`) without network access; plus a quota-exceeded error and a model-not-found error to exercise FR-43.

**Relatedness (Phase 5)** — what the related-papers and recommendation adapters send, in `test/fixtures/<source>/related/`, one directory below each source's search fixtures. *As built 2026-11-02 (`P5-T04`).* The scenario lists are `relatedPlanFor` in `scripts/record-fixtures.ts`; the requests are `test/support/*RecordedRequests.ts`'s, built by the shipped builders in `src/sources/semanticscholar/graph.ts`, `recommendations.ts`, `src/sources/europepmc/citations.ts`, `src/sources/pubmed/elink.ts` and `src/sources/crossref/references.ts`.

| Source | Fixture | Purpose | Recorded |
| --- | --- | --- | --- |
| Europe PMC | `citations` | `/MED/37258680/citations`, page 1 of 25 | live 2026-11-02, HTTP 200: `hitCount` 927, 25 rows, sources `MED` and `PPR` |
| Europe PMC | `references` | `/MED/37258680/references`, page 1 of 25 | live 2026-11-02, HTTP 200: `hitCount` 144, 25 rows. The endpoint `docs/02` §4.7 measured down on 2026-09-08 and 2026-09-09 was up |
| Europe PMC | `citations-outage-seed` | `/MED/39220605/citations`: answers for the seed whose `/references` is the hand-written 503 | live 2026-11-02, HTTP 200: `hitCount` 1 |
| Europe PMC | `references-503` | `/MED/39220605/references`: `docs/02` §4.7's measured outage | **hand-written** (`"synthetic": true`): status, `text/plain` and body from §4.7 |
| NCBI | `elink-two-seeds` | `elink` `neighbor_score`, `id=37258680&id=39220605` | live 2026-11-02, HTTP 200: two linksets, 100 links each, neither seed in its own list |
| Crossref | `work-with-references` | `/works/10.1038/s41586-023-06139-9` | live 2026-11-02, HTTP 200: `reference[]` of 160 entries, 155 with a `DOI` |
| Crossref | `work-without-references` | `/works/10.1007/3-540-29835-5_2408` | live 2026-11-02, HTTP 200: `references-count` 0, no `reference` member |
| Crossref | `title-search` | `query.bibliographic` for the first paper's title, `rows` 5, no cursor | live 2026-11-02, HTTP 200: 5 items, that paper first, no `next-cursor` |
| Crossref | `work-non-biomedical-seed` | `/works/10.1007/s11263-015-0816-y` (`P5-T32`) | live 2026-11-05, HTTP 200: `reference[]` of 102 entries, 60 with a distinct `DOI` |
| Crossref | `lookup-non-biomedical-references` | `filter=doi:` over those 60 DOIs, `rows` 60 (`P5-T32`) | live 2026-11-05, HTTP 200: 60 items, all titled, 3 with an `abstract`, no `next-cursor` |
| Semantic Scholar | `references`, `citations`, `forpaper`, `recommend-post`, `match-title`, `match-title-absent`, `batch-unresolvable`, `seed-not-found`, `citations-unknown-field` | see `semanticscholarRelatedPlan` | **stand-ins, not evidence** (`"synthetic": true`), hand-written 2026-11-02 from `docs/02` §6 and `docs/05` §2–§3 for `P5-T05` and `P5-T06` (`plan/00` §6 item 335(a)); not recorded yet: the owner's, with the key (§3.5, `P5-T31`), whose run overwrites each one |
| Semantic Scholar | `batch-embedding` | see `semanticscholarRelatedPlan` | **stand-in, not evidence** (`"synthetic": true`), hand-written 2026-11-02 for `P5-T20` from `docs/02` §6.8 and §6.9 (`plan/00` §6 item 335(a)); not recorded yet: the owner's, with the key (§3.5, `P5-T31`), whose run overwrites it |
| Semantic Scholar | `batch-references` | see `semanticscholarRelatedPlan` | **not recorded yet**: the owner's, with the key (§3.5, `P5-T31`). No stand-in: no card reads it |
| Semantic Scholar | `recommend-size-cap` | the Recommendations 400 for a response over 10 MB | **hand-written, and not evidence** (`"synthetic": true`): no recording has drawn it; `docs/05` §3.3 gives the status and the opening of the message only. Written by the owner's run (or `FIXTURE_MODE=synthetic … --keyed`, no key, no request). Match on the opening of the message, never the whole |

> **Why a directory of their own (DECIDED 2026-11-02, coordinator, under `plan/00` §6 item 313).** The search
> directories are pinned file by file: `crossref.test.ts` and the other adapter tests count their fixtures, and
> `semanticscholar.test.ts` and `replayHarness.test.ts` assert the keys on disk are exactly the search plan. All of
> them filter on `.json`, so `related/` moves none. An adapter card replays with
> `createReplayHttpClient({ dir: relatedFixtureDirFor(source), … })`, or lists both directories in a
> `ReplayRoute` when a test needs a search fixture too.
>
> **Measured while recording (2026-11-02).** (a) `elink` with two `id=` parameters returned exactly 100 links for
> each seed, where `docs/05` §4.3 reads "often 100–300+"; one run, two seeds, so 100 may or may not be a cap. (b)
> Neither seed appeared in its own list, where §4.3 says the seed "may appear"; the filter stays. (c) Europe PMC's
> `request.offSet` read 0 on `/citations` and 1 on `/references` for the same `page=1`; `hitCount` and the rows
> are what to read. (d) `/citations` rows can carry `source` `PPR` as well as `MED`. (e) `work-with-references`
> holds one `[redacted:42]`: `redact()`'s 40-character net took a dataset address's last path segment inside an
> `unstructured` reference with no DOI, entry `6139_CR13`, and the sidecar says the body was scrubbed. Nothing
> reads that text; a reference's `DOI` would be read, and none was touched.

### 3.2 Recording and redaction

`scripts/record-fixtures.ts` drives recording:

- Reads **no credential from any file**. Decision D5 and `docs/09` §1.7 allow no plaintext credential
  tier, `.env.example` says in capitals that no key may be put there, and the recorder follows D5: the
  scenarios run **unauthenticated** (*except the LLM providers and Semantic Scholar, each with the key in the
  process environment: the two notes at the end of this section; the second added 2026-11-02, `P5-T04`*) (NCBI unkeyed, which is also why a keyed replay would hash to a
  different fixture name — see `test/support/fixtureReplay.ts`), and the process environment is read
  only to build the redaction deny-list of key-shaped values described below. *(Corrected 2026-10-15,
  owner review row 139: this line said "reads real keys from `.env`" since Phase 1 and contradicted D5
  and the recorder's own header.)*
- Runs a fixed, versioned list of scenarios so recordings are reproducible.
- Applies a **mandatory redaction pass** before writing: strips `Authorization`, `x-api-key`, `api_key`/`key`/`token` query params, `mailto` values, `Set-Cookie`, and any string matching known key prefixes. A fixture that still matches a secret pattern after redaction causes the recorder to abort.
- Scrubs the maintainer contact address in **both** its plain and its percent-encoded (`%40`) spellings, and aborts on either — Europe PMC echoes the request's `email=` back verbatim in `request.email` and percent-encoded in `nextPageUrl` (measured 2026-10-14, `P2-T03`; `P2-T33`).
- Strips **every email address** from a fixture, not only the maintainer's, and aborts on one that survives. Recorded responses carry authors' published contact addresses inside affiliation fields (PubMed `<Affiliation>`, Europe PMC `affiliation`). They are public bibliographic metadata, but no test needs them and a committed file should not collect them. Each becomes `[redacted:email-address]` in the same pass (`scrub`) that turns the maintainer address into `[redacted:maintainer-address]`; the maintainer placeholder still wins for that one address. Both the plain `@` and the percent-encoded `%40` spelling are matched. A Java object identity string that two medRxiv abstracts carry (`org.highwire.dtl.DTLVardef@ebf121…`) is not an address and is kept. The committed fixtures were re-scrubbed by the same code (`--rescrub`, no network): **390 addresses in 29 fixtures** (12 PubMed, 17 Europe PMC), request keys unchanged, and each changed sidecar's `redactions` names the re-scrub and the count. Only the recorder changes; the product's own redaction (`src/core/provenance.ts`, `src/core/errors.ts`) does not. *(Added 2026-10-16, owner decision, `plan/00` §6 item 224.)*
- Exempts **pagination tokens by name, per source** (`SourcePlan.opaqueTokens` in the recorder), and nothing else. `redact()`'s 40-character catch-all also matches an opaque cursor: Crossref's `message.next-cursor` is 51–84 base64 characters and was being scrubbed to `[redacted:NN]`, so no recorded page could drive a replayed paging loop and `assertClean` refused the truncated `error-malformed` body for the same reason (measured 2026-10-15, `P2-T04`, on every Crossref page). A plan names the tokens its bodies carry that are opaque but not secret; `scrub` shields exactly those and `assertClean` ignores exactly those. PubMed and Europe PMC carry no such token. *(Added 2026-10-15, owner review row 150.)*
- Writes a sidecar `_meta.json` per fixture: recorded-at timestamp, endpoint, tool version, and the scenario name.
- For LLM fixtures, records **response bodies only**; request bodies are asserted against committed snapshots generated by the adapters themselves, so a prompt change shows up as a reviewable snapshot diff.

Fixtures are committed to the repo. They are small (JSON/text), and having them in-repo is what makes CI hermetic and offline-capable.

> **The LLM exception to "unauthenticated", and the LLM fixture name (added 2026-10-27, `P3-T30`, split
> by `plan/00` §6 item 298(b)).** An LLM cannot be called unauthenticated, so the LLM scenarios are the
> one exception to the first bullet above, and the exception is narrow. **The owner records them, never
> an agent**, with the provider's key set in the process environment for that one recording session
> only (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`); the recorder
> reads no key from `.env` or any other file. Live mode needs three things at once — `FIXTURE_MODE=record`,
> the `--live` flag and the key in the environment — and even then it only **prints the stated spend
> and stops** with nothing sent, unless a second flag, `--confirm-spend-usd <amount>`, names an amount
> at least that large. That amount then binds the run as a ceiling (the shipped `createBudgetGuard`),
> settled at the tokens each answer reports. The stated spend is an upper bound, never an expectation:
> each billed call is charged its whole `maxOutputTokens` and an input of one token per two characters
> of its messages and schema plus 300, at the prices of the shipped price source
> (`createModelPriceSource`, which until refreshed holds `docs/03` §12.1's table and its date). Before
> any billed call the recorder lists the provider's models (free) and stops if the chosen model is not
> there. Response headers are kept only from an allow-list (`content-type`, `retry-after`,
> `retry-after-ms`, `x-ratelimit-*`, `anthropic-ratelimit-*`): organisation and project identifiers,
> cookies and request ids never reach a file. Every exchange of the run passes the redaction pass and
> `assertClean` before **any** file is written, so one surviving key-shaped value writes nothing at
> all. **An LLM fixture is named by its scenario, not by a hash of the request** —
> `test/fixtures/llm/<provider>/<scenario>.json` and `<scenario>_meta.json`, a further page of a
> paginated model list `<scenario>-page-<n>.json` — because the request body carries the prompt and the
> model: a hashed name would orphan every fixture at each prompt edit, while the bullet above wants a
> prompt change to show as a reviewable snapshot diff. The request bodies are snapshotted from the
> adapters themselves in `test/contract/llm/__snapshots__/`. The owner's steps are §3.4.

> **The Semantic Scholar exception (as built 2026-11-02, `P5-T04`, `plan/00` §6 item 323(c)).** The second
> narrow exception to the first bullet above, and to its "reads no credential": the anonymous pool refused 12 of 12
> calls on 2026-09-09 and 12 in a row on 2026-10-16, so `FIXTURE_MODE=record --source semanticscholar` is **refused
> and sends nothing** unless `--keyed` is given and `SEMANTIC_SCHOLAR_API_KEY` is set in the process environment;
> the refusal prints the owner's command, and there is no anonymous attempt. The agent records the other sources;
> **the owner records this one and no agent runs it** (§3.5). `--keyed` records the relatedness scenarios only: the
> search fixtures directly under `test/fixtures/semanticscholar/` stay as `P2-T05` recorded them, and re-recording
> them under the key is not built. The key is read from the environment and from nothing else, at run time, in
> record mode; it is sent as the `x-api-key` header and nowhere else, so `fixtureKey`, which hashes the method, the
> URL and the body, names a keyed recording exactly as an unkeyed one and it replays with no key. What reaches a file
> (`runRelatedRecorder`, `stripKeyedExchange`, `assertNoKeyHeaderName`): only the response headers
> `KEYED_RESPONSE_HEADER_ALLOW` names (`content-type`, `retry-after`, `x-amzn-errortype`, `x-ratelimit-*`); the
> key's value replaced wherever a response echoed it, then on the deny-list whatever its length; the header's name
> replaced in a body and refused in any fixture or sidecar. Everything is staged and checked before any file is
> written. What is printed: whether a key is present, never the value or its length. A 401 or 403 stops the run and
> writes nothing; a 429 stops the requests, keeps what was answered and prints the `--only` command for the rest; a
> 5xx is reported and not written; a 400 or 404 is an answer and is recorded. `test/unit/sources/relatedRequests.test.ts`
> proves all of it with a fake key and a fake service that echoes the key back in headers and body.

### 3.3 Keeping fixtures fresh

Staleness is the known failure mode of record/replay: green tests against a two-year-old API shape. Mitigations:

1. **A scheduled `live-contract` workflow** (§5.3) runs the *real* requests weekly against a small subset of scenarios, in a separate job that does **not** block PRs, and opens an issue on mismatch. This is the early-warning system for R-2 and R-5.
2. **A staleness assertion in CI:** if any fixture's `_meta.json` `recordedAt` is older than 180 days, the contract test suite emits a warning; older than 365 days, it fails. Refreshing is then a deliberate, dated act.
3. **Re-record before every minor release** as a checklist item (§8), reviewing the diff — a large unexplained diff *is* the signal.
4. **Never edit a fixture by hand** to make a test pass. Re-record, or add a new scenario.
5. **LLM fixtures are re-recorded when a provider's API version changes**, not on a schedule, since model outputs vary run to run and diffs would be pure noise.

### 3.4 Recording the LLM fixtures — the owner's runbook

> **Added 2026-10-27 (`P3-T30`, split by `plan/00` §6 item 298(b)).** The recorder, the scenario list and
> the contract tests are built; the recording is the owner's, after gate `G-18` and the owner's approval
> of the stated spend below. **No agent runs these steps**: they put the owner's key in a process
> environment and spend the owner's money. Until a provider is recorded, its seven recorded scenarios
> are skipped by `npm run test:contract` with a message naming this section; its four synthetic ones
> and its request snapshot run already.

**The stated spend**, from `npm run fixtures:record -- --source <provider> --dry-run` on 2026-10-27. It
is an upper bound (§3.2's note), at the shipped price source's prices — `docs/03` §12.1's table **as of
2026-09-08**, which the owner checks against each provider's current price page first (gate `G-18`):

| Provider | Model (cheapest priced) | $ / 1M in · out | Live requests | Billed | Input ≤ | Output ≤ | Stated spend ≤ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenRouter | `openai/gpt-5.6-luna` | 0.20 · 1.20 | 7 | 5 | 10,707 | 4,288 | $0.0073 |
| OpenAI | `gpt-5.6-luna` | 0.20 · 1.20 | 7 | 5 | 10,707 | 4,288 | $0.0073 |
| Anthropic | `claude-haiku-4-5` | 1.00 · 5.00 | 7 | 5 | 10,707 | 4,288 | $0.0322 |
| Gemini | `gemini-3.1-flash-lite` | 0.25 · 1.50 | 7 | 5 | 10,707 | 4,288 | $0.0092 |
| **All four** | | | **28** | **20** | | | **$0.0560** |

The two free requests per provider are `models-list` and `error-401` (an invalid key the recorder
builds). Anthropic's model list may take a second page, which is free too. OpenRouter adds no per-token
mark-up (`docs/03` §12.1); its 5.5 % fee is charged on buying credit, not per call.

**Steps, one provider at a time** (OpenAI shown; the others swap the name and the variable —
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`):

1. **Read the plan.** `npm run fixtures:record -- --source openai --dry-run`. It reads no key and sends
   nothing. Check the model and its prices; if the model is retired or a price has moved, stop: the
   table in `docs/03` §12.1 is updated first (then `src/llm/shared/pricing.ts`), or another model in it is
   named with `--model <id>` — an unpriced model is refused, because its spend cannot be bounded.
2. **Open a new terminal for this one session** and put the key in its environment without echoing it
   or writing it to the shell history. PowerShell (5.1 or 7):
   `$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "OpenAI key" -AsSecureString)).Password`;
   Git Bash: `read -rs OPENAI_API_KEY; export OPENAI_API_KEY`. Never put it in `.env` or any file: the
   recorder would not read it there anyway. On this network also set `NODE_USE_SYSTEM_CA=1`
   (PowerShell: `$env:NODE_USE_SYSTEM_CA = "1"`); never turn certificate checks off.
3. **Set record mode and see the gate.** PowerShell: `$env:FIXTURE_MODE = "record"`, then
   `npm run fixtures:record -- --source openai --live`. It prints the same plan and **stops with nothing
   sent** (exit code 3). This proves the key is seen without spending anything.
4. **Approve and record.** `npm run fixtures:record -- --source openai --live --confirm-spend-usd 0.0073`
   (any amount at least the stated spend; it becomes the run's ceiling). The run lists the models first
   (free) and stops before anything billed if the model is not listed; then sends each scenario once,
   never retried, and writes `test/fixtures/llm/openai/<scenario>.json` and `_meta.json` only if every
   exchange passed redaction — otherwise it writes nothing. It ends by printing what was spent, from the
   tokens the answers reported, beside the stated figure.
5. **Remove the key and close the terminal.** `Remove-Item Env:OPENAI_API_KEY; Remove-Item Env:FIXTURE_MODE`
   (Git Bash: `unset OPENAI_API_KEY FIXTURE_MODE`), then close the window.
6. **Check before committing.** `npm run test:unit -- recordFixturesRedaction` (scans every LLM fixture
   for key shapes, addresses and credential headers) and `npm run test:contract` (the provider's recorded
   block now runs). Read the new files' diff, including each sidecar's `redactions`. A failing recorded
   test is a finding about the adapter — Gemini's stream shapes are assumptions until this recording
   (`createGeminiStreamDecoder`) — to report, **not** a fixture to edit (§3.3 rule 4).

**Exit codes:** 0 recorded; 1 a scenario failed, the model is not listed, the ceiling stopped the run, or
a redaction check refused (each message says which, and whether anything was written); 2 a refused
command (no `--live`, no key, an amount below the stated spend, an unpriced `--model`); 3 stopped at
the spend gate with nothing sent. One scenario again: add `--only <scenario>` to steps 1, 3 and 4 and
use the amount its own dry run states.

### 3.5 Recording the Semantic Scholar fixtures — the owner's runbook

> **Added 2026-11-02 (`P5-T04`, for the owner's card `P5-T31`; `plan/00` §6 items 323(c), 326(d)).** It costs
> nothing and takes about two minutes once the new key is in hand. **No agent runs these steps or sees the key.
> The key never goes into a chat message, a file or a command line.** The tool was tested with a fake key and a
> fake service only, so this run is its first against the real one.

**What it sends:** 11 requests to `api.semanticscholar.org`, one at a time, at least 1.112 seconds apart
(`HOST_POLICIES`' row, a little under the keyed limit of 1 per second), about 15 seconds in all. It writes 24 files to
`test/fixtures/semanticscholar/related/`: 12 fixtures, one of them the hand-written `recommend-size-cap`, each with its
sidecar.

**Steps, in PowerShell** (Git Bash spellings are in §3.4 step 2):

1. **Rotate the key first.** The copy pasted into a chat on 2026-10-14 counts as exposed (`plan/06` `G-03`). Get a new
   key from Semantic Scholar and have the old one withdrawn. The request form is
   <https://www.semanticscholar.org/product/api#api-key-form>; the documents here record no self-service rotation, so
   if the page offers none, ask Semantic Scholar through it. Keep the new key in your password manager. Do not paste
   it anywhere else.
2. **Read the plan.** In the repository folder: `npm run fixtures:record -- --source semanticscholar --dry-run`. It
   reads no key and sends nothing, and lists the search scenarios and, after them, the eleven scenarios above.
3. **Open a new terminal for this one session,** go to the repository folder, and put the key in that terminal's
   environment without showing it:
   `$env:SEMANTIC_SCHOLAR_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Semantic Scholar key" -AsSecureString)).Password`
   — it asks for the key and shows stars. Paste the new key at that prompt only. Then, for this network:
   `$env:NODE_USE_SYSTEM_CA = "1"`. Never turn certificate checks off.
4. **Check the key is seen, with nothing sent.** `npm run fixtures:record -- --source semanticscholar --keyed --dry-run`.
   It should print `Key present in SEMANTIC_SCHOLAR_API_KEY: yes` and `Nothing was sent.` It never prints the key.
5. **Record.** `$env:FIXTURE_MODE = "record"`, then `npm run fixtures:record -- --source semanticscholar --keyed`.
   Each request prints a line with its path and status. It ends with `11 live request(s); 12 fixtures written`.
6. **Remove the key and close the terminal.**
   `Remove-Item Env:SEMANTIC_SCHOLAR_API_KEY; Remove-Item Env:FIXTURE_MODE; Remove-Item Env:NODE_USE_SYSTEM_CA`,
   then close the window.
7. **Tell the coordinator it has finished, and how it ended** (the last lines and the exit code; nothing about the key).
   An agent then does `P5-T31`'s checks: every scenario has a fixture, no file names the key header, the status and
   body of the no-match title for `P5-T05`, and the inventory row in §3.1.
8. **Enter the new key in the plugin** through the preferences pane's key dialog when you next use it (`G-26`). That is
   a separate step; this recording does not store the key anywhere.

**If it does not end as in step 5:**

| What it prints | What happened | What to do |
| --- | --- | --- |
| `nothing was sent … needs the explicit --keyed flag` (exit code 2) | The flag was left off | Add `--keyed` |
| `SEMANTIC_SCHOLAR_API_KEY is not set` (exit code 2) | The key is not in this terminal | Repeat step 3 in this terminal |
| `the service refused this request with HTTP 401` or `403` (exit code 1) | The key was refused. Nothing was written and nothing more sent | Check it is the new key; repeat from step 3 |
| `HTTP 429, so the rest were not sent`, then a command ending `--only …` (exit code 1) | Rate limited. What was answered is written | Wait a few minutes and run the printed command |
| `HTTP 5xx, not written`, then a command ending `--only …` (exit code 1) | The service failed on those scenarios. The rest are written | Run the printed command later |
| `Refusing to write fixture …` then `Nothing was written` (exit code 1) | A safety check found something key-shaped in an answer | Stop and report that line. Do not retry or edit a file |

A scenario answering 400 or 404 is not a failure: `seed-not-found` and `citations-unknown-field` exist to record those
two answers. Running the steps twice overwrites the same files, harmlessly.

> *Added 2026-11-02 (`plan/00` §6 item 335(a)):* `related/` already holds eleven stand-ins (*read ten until `P5-T20` added `batch-embedding`, the same day*), under the keys this run writes, so
> it overwrites them and the 24 files above stay 24. A scenario that was not recorded keeps its stand-in, with its sidecar
> still `"synthetic": true`, which is how step 7's check tells the two apart.

---

## 4. Mocking summary (quick reference)

| Thing | Unit (Node) | Contract (Node) | Integration (in Zotero) |
| --- | --- | --- | --- |
| `Zotero.*` | minimal fake global + mocked `src/zotero/*` | mocked `src/zotero/*` | **real** |
| Literature APIs | not called | replay transport over `src/core/http/client.ts` | replay transport |
| LLM providers | `MockLLMProvider` | `MockLLMProvider` + recorded wire fixtures | `MockLLMProvider` |
| Gemini TTS | mocked | recorded audio fixture | recorded audio fixture |
| Time | fake timers | fake timers | real (generous timeouts) |
| Filesystem | in-memory | in-memory | real, in the temp profile |

The invariant: **no test at any layer performs a live network call**, except the explicitly-separated scheduled `live-contract` job.

---

## 5. Continuous Integration

The template's own workflows use reusable pieces from `zotero-plugin-dev/workflows` — a `setup-js` composite action and a `release-plugin.yml` reusable workflow:

```yaml
# windingwind/zotero-plugin-template — .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - v**

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  create-release:
    uses: zotero-plugin-dev/workflows/.github/workflows/release-plugin.yml@main
    with:
      build: "npm run build"
      release: "npm run release"
    secrets: inherit
```

That is a fine default. For `research_helper` we write the pipeline out explicitly, so the steps are auditable and so we can add our own gates (typecheck, coverage, localization completeness, in-Zotero tests). Both approaches are valid; the explicit one is recommended here.

### 5.1 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  NODE_VERSION: "22"

jobs:
  lint:
    name: Lint and typecheck
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: ESLint and Prettier
        run: npm run lint:check

      - name: TypeScript typecheck
        run: npm run typecheck

      - name: Verify Korean localization completeness
        run: node scripts/check-l10n.mjs --base en-US --target ko-KR

  unit:
    name: Unit and contract tests
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests with coverage
        run: npx vitest run --dir test/unit --coverage

      - name: Run contract tests (replay mode, no network)
        env:
          FIXTURE_MODE: replay
        run: npx vitest run --dir test/contract

      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
          retention-days: 14

  build:
    name: Build XPI
    runs-on: ubuntu-latest
    needs: [lint, unit]
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build plugin
        run: npm run build

      - name: Assert XPI was produced
        run: |
          set -euo pipefail
          xpi="$(find .scaffold/build -name '*.xpi' -print -quit)"
          if [ -z "$xpi" ]; then
            echo "::error::No XPI produced by the build"
            exit 1
          fi
          echo "Built: $xpi ($(du -h "$xpi" | cut -f1))"
          # NFR-18: bundle size ceiling of 3 MB
          size_bytes="$(stat -c%s "$xpi")"
          if [ "$size_bytes" -gt 3145728 ]; then
            echo "::error::XPI exceeds the 3 MB budget (NFR-18): ${size_bytes} bytes"
            exit 1
          fi

      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: research-helper-xpi
          path: .scaffold/build/*.xpi
          retention-days: 14

  integration:
    name: In-Zotero integration tests
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run in-Zotero tests (headless)
        env:
          FIXTURE_MODE: replay
        run: npm run test:integration -- --exit-on-finish --abort-on-fail

      - name: Upload Zotero debug logs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: zotero-logs
          path: .scaffold/logs/
          retention-days: 7
```

> **Unverified:** whether `zotero-plugin test` downloads a Zotero build itself in CI or requires one to be provisioned. The scaffold's docs state headless mode activates automatically on CI and supports Ubuntu 22.04/24.04, which implies it handles acquisition, but this must be confirmed in Phase 0 (spike V-5). If a Zotero build must be provisioned, add a step that downloads the Zotero Linux tarball and sets `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` before running the tests. Until confirmed, mark the `integration` job `continue-on-error: true` so it does not block PRs on infrastructure uncertainty.

> **Decided 2026-10-20 (owner; `plan/00` §6 item 236(e)).** V-5 settled the question in Phase 0 (a pinned Zotero is provisioned and `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` set), and after `P2-T37` the full suite is green (171 of 171 on 10.0.3). The `integration` job is therefore **no longer** `continue-on-error`: a red in-Zotero run blocks a pull request. The pinned release follows the developer machine, now **10.0.3**. The suite is load-sensitive and has an intermittent first-import hang (`plan/reports/P2-T16-partA.md`, `plan/reports/P2-T37.md`); a red run is re-run before it is called a regression. The beta-channel job below stays `continue-on-error`.

### 5.2 `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing tag to (re-)release, e.g. v1.0.0"
        required: true
        type: string

permissions:
  contents: write

env:
  NODE_VERSION: "22"

jobs:
  release:
    name: Build and publish release
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag || github.ref }}
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint and typecheck
        run: |
          npm run lint:check
          npm run typecheck

      - name: Run tests
        env:
          FIXTURE_MODE: replay
        run: npm test

      - name: Resolve version from tag
        id: version
        run: |
          set -euo pipefail
          tag="${{ inputs.tag || github.ref_name }}"
          version="${tag#v}"
          pkg_version="$(node -p "require('./package.json').version")"
          if [ "$version" != "$pkg_version" ]; then
            echo "::error::Tag $tag does not match package.json version $pkg_version"
            exit 1
          fi
          echo "version=$version" >> "$GITHUB_OUTPUT"
          if [[ "$version" == *-* ]]; then
            echo "prerelease=true" >> "$GITHUB_OUTPUT"
            echo "update_manifest=update-beta.json" >> "$GITHUB_OUTPUT"
          else
            echo "prerelease=false" >> "$GITHUB_OUTPUT"
            echo "update_manifest=update.json" >> "$GITHUB_OUTPUT"
          fi

      - name: Build XPI and update manifest
        run: npm run build

      - name: Collect release assets
        id: assets
        run: |
          set -euo pipefail
          mkdir -p dist
          cp .scaffold/build/*.xpi dist/
          cp .scaffold/build/update*.json dist/ 2>/dev/null || true
          ls -la dist/
          ( cd dist && sha256sum *.xpi > SHA256SUMS.txt )
          cat dist/SHA256SUMS.txt

      - name: Create GitHub Release and attach assets
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ inputs.tag || github.ref_name }}
          name: research_helper ${{ steps.version.outputs.version }}
          prerelease: ${{ steps.version.outputs.prerelease }}
          generate_release_notes: true
          fail_on_unmatched_files: true
          files: |
            dist/*.xpi
            dist/update*.json
            dist/SHA256SUMS.txt

      - name: Publish update manifest to the release branch
        if: steps.version.outputs.prerelease == 'false'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          manifest="${{ steps.version.outputs.update_manifest }}"
          tmp="$(mktemp -d)"
          cp "dist/${manifest}" "$tmp/"
          # update-beta.json is refreshed by prerelease runs; keep whichever exists
          [ -f "dist/update-beta.json" ] && cp dist/update-beta.json "$tmp/" || true
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git fetch origin release:release || git branch release
          git checkout release
          cp "$tmp/"*.json .
          git add ./*.json
          if git diff --cached --quiet; then
            echo "Update manifest unchanged; nothing to publish."
          else
            git commit -m "chore(release): update manifest for v${{ steps.version.outputs.version }}"
            git push origin release
          fi
```

Two things this workflow deliberately does:

- **Refuses to release when the tag and `package.json` version disagree.** This is the single most common release footgun.
- **Publishes `update.json` to a long-lived `release` branch**, which is what `update_url` points at. Serving the manifest from a stable branch (rather than from a per-release asset URL) is what makes the "bump `strict_max_version` without a new release" trick in §6.3 possible.

### 5.3 `.github/workflows/compat.yml` (scheduled early warning)

```yaml
name: Compatibility and freshness watch

on:
  schedule:
    - cron: "17 4 * * 1"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

env:
  NODE_VERSION: "22"

jobs:
  live-contract:
    name: Live contract check against real APIs
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Compare live responses against recorded fixtures
        id: drift
        continue-on-error: true
        env:
          FIXTURE_MODE: verify
          NCBI_API_KEY: ${{ secrets.NCBI_API_KEY }}
          CROSSREF_MAILTO: ${{ secrets.CROSSREF_MAILTO }}
          SEMANTIC_SCHOLAR_API_KEY: ${{ secrets.SEMANTIC_SCHOLAR_API_KEY }}
        run: npx tsx scripts/record-fixtures.ts --verify --report drift-report.md

      - name: Upload drift report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: drift-report
          path: drift-report.md
          retention-days: 30

      - name: Open an issue when a source API has drifted
        if: steps.drift.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('node:fs');
            let body = 'Live contract check failed; see the drift-report artifact.';
            try {
              body = fs.readFileSync('drift-report.md', 'utf8').slice(0, 60000);
            } catch (e) {
              core.warning(`Could not read drift report: ${e.message}`);
            }
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Literature API drift detected (${new Date().toISOString().slice(0, 10)})`,
              labels: ['api-drift', 'maintenance'],
              body,
            });

  zotero-beta:
    name: Integration tests against the Zotero beta channel
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run in-Zotero tests against the beta build
        env:
          FIXTURE_MODE: replay
          ZOTERO_CHANNEL: beta
        run: npm run test:integration -- --exit-on-finish
```

The `zotero-beta` job is the concrete mitigation for risk R-1 in `11-implementation-roadmap.md`: it surfaces Zotero-side breakage during the beta window rather than after users upgrade.

> **Unverified:** whether `zotero-plugin-scaffold` reads a `ZOTERO_CHANNEL` environment variable to select a beta build. If it does not, the job must download the beta tarball explicitly and set `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`. Confirm in Phase 0.

---

## 6. Versioning and updates

### 6.1 Semantic versioning policy

`research_helper` follows [SemVer 2.0.0](https://semver.org/) with the plugin's **user-visible behaviour and stored data** as the public API:

| Change | Bump |
| --- | --- |
| Breaking change to stored data shape, preference keys, or note format that requires user action | **major** |
| Removing a feature, a source, or a provider | **major** |
| Raising `strict_min_version` (dropping support for a Zotero series users are on) | **major** |
| New feature, new source, new provider, new language | **minor** |
| Raising `strict_max_version` to cover a newly-tested Zotero series | **minor** (or manifest-only; see §6.3) |
| Bug fix, prompt tuning, copy change, dependency bump | **patch** |
| Pre-release | `X.Y.Z-beta.N`, published as a GitHub pre-release and advertised only in `update-beta.json` |

`package.json` `version` is the single source of truth; `manifest.json` receives it via the `__buildVersion__` placeholder at build time. The release workflow enforces tag/version agreement.

### 6.2 `strict_min_version` / `strict_max_version` strategy under rapid release

Zotero now ships a new major version roughly every **6–10 weeks** ([Zotero blog, Jan 2026](https://www.zotero.org/blog/a-faster-release-cycle-for-zotero/)), and Zotero 10 already introduced breaking plugin-facing changes ([Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)). This makes version pinning a real operational decision rather than boilerplate.

**Policy:**

- **`strict_min_version: "10.0"`** — the oldest series we test against and support.
- **`strict_max_version: "<latest tested series>.*"`**, e.g. `"10.0.*"`. Zotero's own Zotero-10 guidance is to set it to `10.0.*` after confirming compatibility.
- **Never use an open-ended `strict_max_version` such as `"*"`.** Under a 6–10-week cadence with documented breaking changes, an unbounded max version guarantees that some users will run a Zotero release the plugin has never been tested on, and the resulting failure mode (a plugin that loads but misbehaves) is worse than the "incompatible" message.
- **Never omit `strict_max_version`.** Omission is equivalent to unbounded.

**The upgrade drill** — run within one week of each Zotero major release entering beta:

1. Read `zotero.org/support/dev/zotero_<N>_for_developers` in full.
2. Run the integration suite against the beta (the `zotero-beta` CI job does this weekly).
3. If **no code change is needed**: bump only `strict_max_version` — see §6.3, which does not require a new XPI.
4. If a code change is needed: fix it behind `src/zotero/`, release a **minor** version supporting both series (`strict_min_version` stays at the oldest supported), and note the compatibility in the changelog.
5. Update the README compatibility table.

> ⚠️ **Not yet.** [Zotero 11 for Developers](https://www.zotero.org/support/dev/zotero_11_for_developers) currently states: *"Do not update your plugin to declare compatibility with Zotero 11 at this time."* Zotero 11 moves the platform from Firefox 140 to 153 ESR and carries its own breaking list. Do not publish an `11.0.*` range until that instruction is withdrawn **and** the plugin has been tested against a Zotero 11 build. See `01-zotero-plugin-platform.md` §1.3 and §11.3.

**Supporting two series at once.** When Zotero 11 arrives *and declaring compatibility with it is sanctioned*, prefer a single XPI with `strict_min_version: "10.0"`, `strict_max_version: "11.0.*"` and runtime feature detection inside `src/zotero/`, over maintaining parallel branches. Branch only if the two APIs genuinely cannot coexist in one bundle.

### 6.3 The `update.json` manifest

Zotero uses the Firefox-style JSON update manifest, fetched from the `update_url` declared in `manifest.json`. Real-world Zotero plugins confirm the shape — for example [`zotero-ocr/updates.json`](https://github.com/UB-Mannheim/zotero-ocr/blob/master/updates.json) and [`zotmoov/updates.json`](https://github.com/wileyyugioh/zotmoov/blob/master/updates.json).

A complete, realistic manifest for this project:

```json
{
  "addons": {
    "research-helper@suppakoko.github.io": {
      "updates": [
        {
          "version": "0.9.0",
          "update_link": "https://github.com/suppakoko/research_helper/releases/download/v0.9.0/research-helper-0.9.0.xpi",
          "update_hash": "sha256:0b6f5cb6bb3f8b4e2f2f0d4b7f2f4c9c9a1f2e3d4c5b6a7988776655443322110",
          "applications": {
            "zotero": {
              "strict_min_version": "10.0",
              "strict_max_version": "10.0.*"
            }
          }
        },
        {
          "version": "1.0.0",
          "update_link": "https://github.com/suppakoko/research_helper/releases/download/v1.0.0/research-helper-1.0.0.xpi",
          "update_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          "update_info_url": "https://github.com/suppakoko/research_helper/releases/tag/v1.0.0",
          "applications": {
            "zotero": {
              "strict_min_version": "10.0",
              "strict_max_version": "10.0.*"
            }
          }
        }
      ]
    }
  }
}
```

Field notes:

- `addons` is keyed by the **exact** `applications.zotero.id` from `manifest.json`. A mismatch silently disables updates.
- Each entry in `updates` is a candidate version. Zotero picks the highest version whose `applications.zotero` constraints are satisfied by the running client — which is precisely why keeping older entries in the array is useful: a user on an older Zotero series still gets the newest version *compatible with them*.
- `update_link` must be a stable, direct HTTPS download of the XPI. GitHub Release asset URLs are stable.
- `update_hash` is **`sha512:<hex>`** when the scaffold generates it (corrected 2026-09-16, `P0-T27`: scaffold 0.9.2 hard-codes SHA-512 and exposes no algorithm option; Zotero accepts it and installs). Strongly recommended, and generated automatically when `build.makeUpdateJson.hash` is set — never hand-written (R-15).
- `update_info_url` (optional) points at release notes.
- Some plugins additionally declare a `gecko` application block (e.g. `"gecko": { "strict_min_version": "60.0" }`), which is a Firefox-lineage carryover. It is harmless but unnecessary for a Zotero-only plugin.
- Prereleases go in a **separate** `update-beta.json` so stable users are never offered a beta. The scaffold generates both.

**Hosting.** `update_url` points at the `release` branch of the repo:

```
https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json
```

This is the pattern the template uses (the release automation *"generates both `update.json` (stable) and `update-beta.json` (prerelease versions), hosted on a dedicated `release` Git tag"*). A branch or tag both work; a branch is easier to update from CI, which is what §5.2 does.

**The manifest-only compatibility bump.** Because the manifest is served from a mutable ref, and because Zotero's guidance explicitly allows *"simply update `strict_max_version` in your plugin's update manifest without releasing a new version"*, the fastest response to a new Zotero major is a one-line commit to the `release` branch widening `strict_max_version` on the current version entry — **only after** the beta integration run is green. This is the single most valuable operational lever the project has against risk R-1.

Caveat: the *installed* XPI's own `manifest.json` still carries the old `strict_max_version`, so an already-installed plugin may be marked incompatible locally until it updates.
> **Unverified:** exactly how Zotero reconciles a widened `strict_max_version` in the update manifest against the narrower value inside an already-installed XPI. Verify this behaviour empirically in Phase 0 (spike V-18) before relying on the manifest-only bump as the primary compatibility strategy; if it does not work as hoped, the fallback is a patch release whose only change is the manifest.

### 6.4 How Zotero checks for updates

Zotero inherits Mozilla's add-on update mechanism: it periodically fetches each installed plugin's `update_url`, compares the advertised versions against the installed version and the running client version, and offers or applies an update. Users can also check manually from **Tools → Plugins** (the gear/options menu offers "Check for Updates").

> **Unverified:** the exact background check interval and the preference that controls it in Zotero 10 (in Firefox this is governed by `extensions.update.interval` and `extensions.update.enabled`). Do not document a specific interval to users; say "Zotero checks periodically, and you can check manually from Tools → Plugins."

Practical consequences for release engineering:

- Do not assume users update promptly. Support the previous minor version for at least one release cycle.
- Never break stored data in a patch release; users may skip versions.
- Keep the manual XPI download link in the README for users whose updates fail (R-15).

---

## 7. Distribution

### 7.1 GitHub Releases (canonical)

The GitHub Release is the single source of truth. Each release carries:

- `research-helper-<version>.xpi` — the installable plugin.
- `update.json` (and `update-beta.json` for prereleases) — also mirrored to the `release` branch.
- `SHA256SUMS.txt` — checksums, so users and mirrors can verify.
- Auto-generated release notes plus a hand-written "Highlights" and "Compatibility" section stating the tested Zotero series.

Users install by downloading the `.xpi` and dragging it onto **Tools → Plugins**, per Zotero's own instructions.

### 7.2 Listing on the Zotero plugins page

**Verified current state (September 2026):** there is no official submission process. The [Plugins for Zotero](https://www.zotero.org/support/plugins) page states plainly that Zotero does not currently provide a list of available plugins, that most plugins are announced and discussed in the [Zotero Forums](https://forums.zotero.org/), and that an official plugin directory is *planned*. The same page carries the security caveat that plugins have full access to Zotero and the user's computer, and that users should only install plugins from developers they trust.

The [Zotero Plugin Dev](https://zotero-plugin.dev/) community hub confirms the interim arrangement: *"The Zotero Plugin Registry is currently under development. Developers are encouraged to submit their plugins to the Zotero Chinese List or Official Plugin List for now. This list will eventually be merged into the official registry."*

**Therefore the v1.0 distribution plan is:**

1. Publish the GitHub Release.
2. **Announce in the Zotero Forums** — the de facto channel — with a post covering: what it does, Zotero compatibility, that it is fully client-side, that it requires user-supplied API keys, where keys are stored, what data is sent where, the license, and the repo link. Given the page's trust caveat, being explicit about data egress is not optional politeness; it is the price of adoption.
3. **Submit to the community plugin lists** slated to merge into the future official registry — notably the [zotero-chinese plugin list](https://zotero-chinese.com/plugins) / [`zotero-chinese/zotero-plugins`](https://github.com/zotero-chinese/zotero-plugins), and the community scraper repository that feeds the in-Zotero plugin-browser plugins.
4. **Watch for the official registry** and submit on day one when it opens.

> **Unverified:** the exact submission mechanics (repository, file format, PR template) for each community list, and the current maintenance status of `zotero-chinese/zotero-plugins` — its README carried a "maintenance suspended" note at the time of writing. Confirm the live process immediately before submitting rather than relying on this document.

### 7.3 README and documentation requirements

The README is the primary user-facing artifact and, per §7.2, the main trust signal. It must contain:

1. **What it does** — the six features in one screenful, with screenshots.
2. **Compatibility table** — plugin version ↔ tested Zotero series ↔ tested OSes.
3. **Install** — direct XPI download link plus the drag-onto-Tools-→-Plugins instruction; how updates are delivered.
4. **Setup** — how to obtain a key for each supported provider, with links.
5. **A prominent data and privacy section** — exactly which services receive which data under which action; that the plugin is fully client-side with no backend; **that API keys are encrypted with `Zotero.OSKeyStore` and held in the OS login manager, never in Zotero preferences** (decision D5), together with the residual risk that other Zotero plugins share the same privileged context and can decrypt them (risk R-9); how to remove all plugin-generated content. Cross-reference `09-security-privacy-and-api-keys.md`.
6. **A cost section** — that LLM and TTS usage is billed to the user's own keys, with the reference-workload cost figure from NFR-5, the fact that **summaries use full text by default** (decision D7) and cost roughly 8–32× an abstract-only run, and the caveat that provider pricing changes.
7. **Known limitations** — no paywalled PDF access, English/Korean only, no scheduled jobs, PDF text extraction is best-effort and falls back to the abstract (risk R-19).
8. **Troubleshooting** — how to enable debug output, how to use "Copy diagnostics", where to file issues.
9. **Contributing and license.**
10. **CHANGELOG.md** in Keep-a-Changelog format, with a Compatibility line per release.

A Korean-language README (`README.ko.md`) ships at v1.0, matching the Korean UI commitment (FR-55).

---

## 8. Manual QA checklist (run before every release)

Run on **Windows, macOS, and Linux** for a minor or major release; Windows plus one other for a patch release. Use a **fresh Zotero profile with a fresh data directory** for the install tests, and a **copy of a large real library (~10k items)** for the performance tests. Record results in the release issue.

### 8.1 Install and lifecycle

- [ ] XPI installs by drag-and-drop onto Tools → Plugins on a fresh profile, with no errors.
- [ ] Plugin appears with the correct name, version, icon, and description.
- [ ] Restarting Zotero leaves the plugin working.
- [ ] Disabling the plugin removes every menu item and the preferences pane, with no errors in debug output (FR-56).
- [ ] Re-enabling restores everything; repeat the disable/enable cycle 5 times without leaks or duplicated menu items.
- [ ] Uninstalling leaves previously created items, collections, notes, and audio attachments intact (NFR-20).
- [ ] In-place update from the previous released version via `update.json` succeeds, and settings are preserved (R-15).
- [ ] Zotero startup time is not visibly degraded; no network request is issued at startup (NFR-10).

### 8.2 Search and import

- [ ] Search dialog opens from Tools and from the collection context menu (FR-1).
- [ ] All seven sources are selectable; deselecting all disables the Search button (FR-2).
- [ ] Default date range is the last 3 years; overriding to "All years" works and is recorded (FR-3).
- [ ] A real multi-source search returns results, and a known cross-indexed paper appears exactly once (FR-50).
- [ ] Preview selection is honoured exactly: unchecking N rows imports `total - N` items (FR-5).
- [ ] Imported items have correct item types, creators, dates, DOIs, and non-empty abstracts where the source provides them (FR-6, FR-7).
- [ ] Preprints import as `preprint` with repository and archive ID.
- [ ] Importing a record already in the library links it rather than duplicating (FR-51).
- [ ] Cancel mid-search aborts within ~2 s and creates zero items (FR-10).
- [ ] Disconnecting the network mid-search produces a clear error, not a stack trace (NFR-9, NFR-14).
- [ ] Provenance note exists, is accurate, and its JSON export validates against `schema/provenance.schema.json` (FR-8; the record is `07-architecture-and-data-model.md` §5.3).
- [ ] **Performance:** 100 records import within the NFR-1 budget; the Zotero UI stays responsive throughout (NFR-3).

### 8.3 Related papers and recommendations

- [ ] "Find related papers" is enabled for one selected item and behaves correctly for multi-selection (FR-13).
- [ ] An item with only a title triggers resolution with disambiguation rather than a silent guess (FR-14).
- [ ] Candidates show reason chips and scores (FR-15, FR-47).
- [ ] Items already in the library are marked and unchecked by default (FR-16, FR-46).
- [ ] Related linkage to the seed works when enabled (FR-17).
- [ ] **Without a Semantic Scholar key**, related discovery still returns usable results and explains the limitation (R-3).
- [ ] Collection profiling shows an editable profile; edits are respected (FR-44).
- [ ] Recommendations exclude everything already in the source collection (FR-46).

### 8.4 LLM layer

- [ ] All four providers configure and pass "Test connection" (FR-31); a wrong key produces a specific 401 message.
- [ ] Keys are masked by default and reveal correctly (FR-30).
- [ ] **No key appears** in debug output, in any note, in the provenance record, or in "Copy diagnostics" (NFR-16) — grep the debug log to confirm.
- [ ] Invoking an LLM feature with no provider configured shows the guided error and makes no request (FR-33).
- [ ] The pre-flight dialog shows item count, model, token estimate, and USD estimate, and names the destination host (FR-24, FR-36).
- [ ] A per-job ceiling set below the estimate pauses the job and asks (FR-24).
- [ ] Summaries are created as child notes with the disclaimer header and the `research_helper/ai-summary` tag (FR-19, FR-20).
- [ ] The note header correctly states abstract-only vs. full text, including the fallback case (FR-21, FR-22).
- [ ] An item with no abstract and no extractable text is **skipped**, not fabricated (FR-21).
- [ ] Cancelling at item ~40 of 100 retains 39 summaries; re-running resumes and skips them (FR-23).
- [ ] "Remove generated notes" deletes only tagged notes, after a confirmation naming the exact count (FR-20).
- [ ] Usage counters match the provider dashboard within a reasonable margin (FR-35).
- [ ] **Cost:** the 100-abstract reference workload lands within the NFR-5 ceiling on the default model.
- [ ] **Pricing table** `as-of` date is current and the displayed prices match each provider's published pricing (R-5).

### 8.5 Trend report

- [ ] A report is produced with all required sections (FR-25).
- [ ] **Every citation marker resolves** to an item in the collection; the reference list is complete and contains no invented entries (FR-26, R-7).
- [ ] A 400-item collection produces a report without a context-length error, and the pass count is stated (FR-27).
- [ ] Korean report generation keeps titles, authors, and venues in original form (FR-28).
- [ ] "Export as Markdown" produces a clean file.
- [ ] Spot-check by a domain reader: the themes are recognizable and no claim is obviously fabricated (R-6).

### 8.6 Audio report

- [ ] English audio generates, attaches to the right item, and plays from Zotero (FR-37, FR-40).
- [ ] **Korean audio** generates and is judged natural by a native Korean speaker, including embedded English technical terms (FR-38, R-8).
- [ ] No markdown or citation brackets are audible (FR-39).
- [ ] A long report is segmented and concatenated without gaps, clicks, or truncation (FR-41).
- [ ] Character count and cost estimate are shown; cancel discards partial output (FR-42).
- [ ] With an invalid/unentitled TTS key, the written report survives and the script can be saved as text (FR-43).
- [ ] Both `tts.outputFormat` values round-trip with the right `contentType`, and `04-audio-report-tts.md` §10.2's 10 MB threshold routes them as expected: a 10-minute `wav` is **linked** (does not sync), the same report as `mp3` is **imported** (`04-audio-report-tts.md` §10.2).
- [ ] With `tts.targetMinutes` left in its auto state, the produced audio is within ±30% of `04-audio-report-tts.md` §12's derived target for the corpus size; setting it explicitly overrides that.
- [ ] With `tts.model` left empty, synthesis uses the model `04-audio-report-tts.md` recommends, resolved from the live model list — and **no** TTS model ID appears hardcoded anywhere in the built XPI outside a last-resort fallback (`04-audio-report-tts.md` §2.2).

### 8.7 Preferences, i18n, accessibility, offline

- [ ] The Research Helper pane appears in Zotero Settings and all controls persist across restarts (FR-52).
- [ ] "Clear cache" works and the storage cap is enforced (NFR-8); changing the cache-limit control takes effect on the next prune, and the per-namespace breakdown adds up to the reported total.
- [ ] The "Verbose debug logging" checkbox writes `logLevel` (`debug` when checked, `warn` when unchecked) and renders from the stored value on reopen. Confirm no `debug` preference is created in `about:config`, and that the checkbox does **not** change `logRequestBodies`.
- [ ] The clear/delete buttons cover `09-security-privacy-and-api-keys.md` §3.7's list, and "Clear generated summaries" leaves the user's Zotero notes intact.
- [ ] The privacy-mode control persists, and a collection-level override that is *stricter* wins over it while a *looser* one does not (doc 09 §3.5).
- [ ] Switching Zotero to `ko-KR` renders the entire plugin UI in Korean with **no untranslated strings and no raw message identifiers** (FR-55, R-22).
- [ ] Korean and English UI both render without clipping or overlap at the default window size and at 150% OS scaling.
- [ ] Every dialog is fully keyboard operable: logical tab order, visible focus, `Escape` cancels, `Enter` confirms (NFR-13).
- [ ] Screen-reader smoke test: NVDA on Windows and VoiceOver on macOS announce dialog titles, control labels, and job completion.
- [ ] Both Zotero light and dark themes render legibly; no status is conveyed by colour alone (NFR-13).
- [ ] **Fully offline:** the plugin loads, the UI opens, existing content is usable, and every network action fails with a clear message (NFR-9).

### 8.8 Resources and stability

- [ ] Idle incremental memory ≤ 30 MB; peak during the 100-item reference workload ≤ 150 MB (NFR-7).
- [ ] No memory growth after 5 consecutive jobs (measure before/after with the same idle state).
- [ ] Built XPI ≤ 3 MB (NFR-18) — enforced in CI, re-confirmed here.
- [ ] Debug output contains no unredacted secrets and no unhandled promise rejections across the full QA pass.

### 8.9 Release hygiene

- [ ] `package.json` version, git tag, and the version inside the built `manifest.json` all agree.
- [ ] `strict_min_version` / `strict_max_version` reflect the actually-tested Zotero series (§6.2).
- [ ] `update.json` on the `release` branch advertises the new version, with a correct `update_link` and `update_hash`.
- [ ] Installing the **previous** version and letting Zotero update to this one succeeds.
- [ ] CHANGELOG entry written, including a Compatibility line.
- [ ] README compatibility table, screenshots, and cost figures updated.
- [ ] Fixtures re-recorded within the last 180 days, with the diff reviewed (§3.3).
- [ ] The `live-contract` scheduled job was green (or its drift issue was triaged) within the last 2 weeks.
- [ ] Forum announcement drafted; community-list submission prepared (§7.2).
- [ ] **NCBI registration is on file** for `tool=research_helper` and `email=suppakoko@gmail.com`. NCBI's policy is that *"merely providing values for tool and email in requests is not sufficient… these values must be registered with NCBI"*, which makes this a release obligation rather than a code one — see `09-security-privacy-and-api-keys.md` §5.1 and decision D10 (`00-overview.md` §3). The address is the maintainer's on every NCBI request, never a user's.

---

## Sources

- [Zotero Plugin Development — zotero.org](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero 7 for Developers — zotero.org](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero 10 for Developers — zotero.org](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Plugins for Zotero — zotero.org](https://www.zotero.org/support/plugins)
- [A Faster Release Cycle for Zotero — Zotero Blog](https://www.zotero.org/blog/a-faster-release-cycle-for-zotero/)
- [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [zotero-plugin-dev/zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [zotero-plugin-scaffold — Quick Start / docs index](https://zotero-plugin.dev/zotero-plugin-scaffold/)
- [zotero-plugin-scaffold — Dev Serve](https://zotero-plugin.dev/zotero-plugin-scaffold/serve.html)
- [zotero-plugin-scaffold — Build](https://zotero-plugin.dev/zotero-plugin-scaffold/build.html)
- [zotero-plugin-scaffold — Test](https://zotero-plugin.dev/zotero-plugin-scaffold/test.html)
- [zotero-plugin-scaffold — Release](https://zotero-plugin.dev/zotero-plugin-scaffold/release.html)
- [zotero-plugin-scaffold on npm](https://www.npmjs.com/package/zotero-plugin-scaffold)
- [windingwind/zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- [zotero-plugin-toolkit on npm](https://www.npmjs.com/package/zotero-plugin-toolkit)
- [zotero-types on npm](https://www.npmjs.com/package/zotero-types)
- [Zotero Plugin Dev Community](https://zotero-plugin.dev/)
- [UB-Mannheim/zotero-ocr — updates.json](https://github.com/UB-Mannheim/zotero-ocr/blob/master/updates.json)
- [wileyyugioh/zotmoov — updates.json](https://github.com/wileyyugioh/zotmoov/blob/master/updates.json)
- [ImperialSquid/zotero-zotts — update.json](https://github.com/ImperialSquid/zotero-zotts/blob/main/update.json)
- [zotero-chinese/zotero-plugins](https://github.com/zotero-chinese/zotero-plugins)
- [zotero/make-it-red — official minimal plugin example](https://github.com/zotero/make-it-red/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [Zotero Forums](https://forums.zotero.org/)

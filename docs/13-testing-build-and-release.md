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
│  └─ locale/                   # per-surface FTL under a plugin subfolder (01-… §9.1)
│     ├─ en-US/research-helper/
│     └─ ko-KR/research-helper/
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

Under `test`: `entries` (default `["test"]`), `mocha`, `timeout` (default 10000), `abort`, `exit`, `headless`, `startDelay` (default 10000), `waitForPlugin`, `reporter`.

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
    timeout: 30000,
    startDelay: 10000,
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

```ts
// test/contract/_transport.ts
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export function fixtureKey(req: { method: string; url: string; body?: string }) {
  const redacted = req.url.replace(/(api[_-]?key|key|token)=[^&]+/gi, "$1=REDACTED");
  return createHash("sha256")
    .update(`${req.method} ${redacted} ${req.body ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export function replayTransport(dir: string) {
  return async (req: { method: string; url: string; body?: string }) => {
    const file = `${dir}/${fixtureKey(req)}.json`;
    try {
      return JSON.parse(await readFile(file, "utf8"));
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

**Quality of generated text is not asserted here.** Prompt-quality regression is handled by the small curated evaluation set described in `06-summarization-and-trend-report.md`, run manually or in a nightly opt-in job — never as a blocking CI gate, because it costs money and is inherently fuzzy.

---

### 2.3 Layer 3 — Integration tests inside a real Zotero

**What exists.** `zotero-plugin-scaffold` ships a test runner, and it is the right answer. Per the [scaffold's test documentation](https://zotero-plugin.dev/zotero-plugin-scaffold/test.html):

- Tests **execute inside a live Zotero instance via a proxy plugin**, not in Node, with a temporary profile and data directory, giving *"full access to Zotero's APIs during testing"* and avoiding the extensive mocking that would otherwise be necessary.
- Test files live in `test/` (configurable via `test.entries`) with extensions `.spec.js`, `.spec.ts`, `.test.js`, `.test.ts`.
- **Mocha and Chai globals** (`describe`, `it`, `expect`, `assert`) are available.
- Config keys: `entries`, `mocha`, `timeout` (default 10000), `abort`, `exit`, `headless`, `startDelay` (default 10000), `waitForPlugin` (a function-body string returning true when the plugin is ready), `reporter`.
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
| `record-unicode` | CJK/Greek/diacritics in title and author names, and a title with subscripts/superscripts |
| `record-jats-abstract` | an abstract with structured JATS/HTML markup |
| `record-preprint` | a preprint with a linked published DOI |
| `error-429` | rate-limit response including `Retry-After` |
| `error-500` | server error |
| `error-malformed` | truncated/invalid body |
| `paginated` | a multi-page result set exercising the pagination loop |
| `dedup-pair-set` | the same paper as returned by ≥3 different sources — the single most valuable fixture we own |

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

**Gemini TTS** — a short English response and a short Korean response, captured as base64/binary plus headers, sufficient to test the audio-assembly path (`src/tts/audio.ts`) without network access; plus a quota-exceeded error and a model-not-found error to exercise FR-43.

### 3.2 Recording and redaction

`scripts/record-fixtures.ts` drives recording:

- Reads real keys from `.env` (never committed).
- Runs a fixed, versioned list of scenarios so recordings are reproducible.
- Applies a **mandatory redaction pass** before writing: strips `Authorization`, `x-api-key`, `api_key`/`key`/`token` query params, `mailto` values, `Set-Cookie`, and any string matching known key prefixes. A fixture that still matches a secret pattern after redaction causes the recorder to abort.
- Writes a sidecar `_meta.json` per fixture: recorded-at timestamp, endpoint, tool version, and the scenario name.
- For LLM fixtures, records **response bodies only**; request bodies are asserted against committed snapshots generated by the adapters themselves, so a prompt change shows up as a reviewable snapshot diff.

Fixtures are committed to the repo. They are small (JSON/text), and having them in-repo is what makes CI hermetic and offline-capable.

### 3.3 Keeping fixtures fresh

Staleness is the known failure mode of record/replay: green tests against a two-year-old API shape. Mitigations:

1. **A scheduled `live-contract` workflow** (§5.3) runs the *real* requests weekly against a small subset of scenarios, in a separate job that does **not** block PRs, and opens an issue on mismatch. This is the early-warning system for R-2 and R-5.
2. **A staleness assertion in CI:** if any fixture's `_meta.json` `recordedAt` is older than 180 days, the contract test suite emits a warning; older than 365 days, it fails. Refreshing is then a deliberate, dated act.
3. **Re-record before every minor release** as a checklist item (§8), reviewing the diff — a large unexplained diff *is* the signal.
4. **Never edit a fixture by hand** to make a test pass. Re-record, or add a new scenario.
5. **LLM fixtures are re-recorded when a provider's API version changes**, not on a schedule, since model outputs vary run to run and diffs would be pure noise.

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
- `update_hash` is `sha256:<hex>`; strongly recommended, and generated automatically by the scaffold when `build.makeUpdateJson.hash` is set.
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

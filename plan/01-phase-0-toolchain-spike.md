# Phase 0 — Toolchain spike

> **Schema.** Every card below uses the task-card shape defined in
> [`README.md`](README.md) §4. Fields are never omitted.
> **Status:** no code written yet; every task is `TODO`.
> **Last updated:** 2026-09-09.

---

## Phase header

**Goal** (`docs/11-implementation-roadmap.md` §1, Phase 0). Prove that a modern Zotero 10
plugin can be built, hot-reloaded, debugged, and can create a Zotero item — on the actual
developer machine, with the actual Zotero 10.0.1 the user runs. Answer every question in
`docs/11` §4 before any architecture is committed.

**Effort estimate in `docs/11`.** **15.5–22 developer-days** (`docs/11` §1, Phase 0, revised
2026-09-09). That figure is *measured*, not guessed: its low end is the sum of the 28 task
cards below and its high end is that × 1.4. It replaced an earlier **6–9 d** estimate, which
`docs/11` R-23 records as one of four systematically low phase figures. `docs/11` §4 separately
sums the listed spike timeboxes to **≈ 10.75 d**; the remaining ≈ 4.75 d is Phase 0 work
`docs/11` §1 lists as a deliverable but never priced. See "Estimate reconciliation" at the end
of this file for the derivation.

**Risks this phase retires** (`docs/11` §3.1): **R-1** (partly), **R-8** (Korean TTS spike,
`V-10`), **R-11**, **R-12**, **R-13**, **R-14**, **R-15** (dry run, `V-18`), **R-19b**
(feasibility spike, `V-8b`).

**Definition of done** (`docs/11` §1, Phase 0 — verbatim criteria):

- `npm run build` produces an installable XPI; dragging it into Zotero 10.0.1 → Tools →
  Plugins installs it cleanly on Windows.
- Editing a source file reloads the plugin in the running Zotero without a manual restart.
- Disabling the plugin from the Plugins window leaves no menu item, no observer, and no error
  in the debug log (FR-56).
- CI is green on a clean clone.
- The spike report is committed and every item in `docs/11` §4 is marked verified /
  worked-around / blocked.

**Human gates in this phase:** 9 — `P0-T08`, `P0-T09`, `P0-T11`, `P0-T15`, `P0-T18`,
`P0-T22`, `P0-T25`, `P0-T27`, `P0-T28`. `P0-T22` is the **week-1** gate: the Semantic Scholar
key application has approval lead time measured in weeks (`docs/11` R-3) and gates Phase 5.

**Standing rule for this phase.** Where a card says an API shape, config key, CLI flag or
version is **unknown**, that unknown is part of what the spike resolves. Do not invent a value
to make the card pass; record the observed value in the spike report and, if it contradicts a
design doc, say which document is now the defect.

---

## Task cards

### P0-T01 — Initialise the repository, licence and ignore rules

| Field | Value |
|---|---|
| **ID** | `P0-T01` |
| **State** | `DONE` — completed 2026-09-10, commit `df15816`; approved by the project owner |
| **Depends on** | none |
| **Blocks** | `P0-T02`, `P0-T29` |
| **Retires** | none |
| **Implements** | none (D8) |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The repository exists as a git repository on `main`, carries an MIT licence, and
ignores the files that must never be committed — most importantly `.env`, which holds
machine-local Zotero paths.

**Read first.**
- `docs/00-overview.md` §3 D8 — the licence is MIT; that is the only licence text permitted.
- `docs/00-overview.md` §3 D9 — the plugin ID `research-helper@suppakoko.github.io`; it is
  permanent from first release and this card is where the repository name and remote must line
  up with it.
- `plan/README.md` §6 "Conventions" — default branch `main`, work on `phase-N/<task-id>`
  branches.
- `docs/13-testing-build-and-release.md` §1.6 — `.env` is "copied from `.env.example`,
  git-ignored"; this is the reason `.env` must be in `.gitignore` before any developer creates it.
- `docs/13-testing-build-and-release.md` §1.2 — the repository layout, so `.gitignore` covers
  the generated directories (`.scaffold/build`, `.scaffold/logs`) rather than source.

**Files.**
- create `.gitignore`
- create `LICENSE`
- create `.env.example`

**Do.**
1. `git init`, set the default branch to `main`, and make the first commit contain only the
   pre-existing `README.md` and `docs/` plus this `plan/` directory.
2. Write `LICENSE` as the standard MIT licence text. The copyright holder string is **not
   specified by any design doc** — leave a `<COPYRIGHT HOLDER>` placeholder and record it in
   the spike report as an item for the owner to fill.
3. Write `.gitignore` covering at minimum: `node_modules/`, `.env`, `.scaffold/`, `coverage/`,
   and OS noise (`.DS_Store`, `Thumbs.db`). The exact list is not specified by the design docs;
   these entries are derived from `docs/13` §1.2's layout and §1.6's "git-ignored" note.
4. Write `.env.example` with the three keys named in `docs/13` §1.6 —
   `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`, `ZOTERO_PLUGIN_PROFILE_PATH`, `ZOTERO_PLUGIN_DATA_DIR` —
   plus the commented `GITHUB_TOKEN` line, with placeholder values only.

**Do NOT.**
- Do not commit a real `.env`. It carries absolute paths into the developer's profile and, once
  `GITHUB_TOKEN` is added for local publishing (`docs/01` §4.5), a credential.
- Do not put any API key in `.env.example` beyond a placeholder, and never a real one —
  decision D5 forbids credentials outside the OS keystore, and `.env` is a plaintext file.
- Do not choose a licence other than MIT; D8 is binding and changing it invalidates
  `docs/11` §5's release row.
- Do not rename or rewrite the existing `README.md` — it is the design record's entry point.

**Done when.**
- [ ] `git status` on a clean tree reports no untracked files other than deliberately ignored ones.
- [ ] `LICENSE` exists and its first line names the MIT License.
- [ ] `git check-ignore -v .env` reports a match.
- [ ] `.env.example` contains exactly the three `ZOTERO_PLUGIN_*` keys and no secret values.

**Verify with.**
```bash
git rev-parse --abbrev-ref HEAD && test -f LICENSE && git check-ignore -v .env
```

**Notes.** The copyright-holder string and the concrete `.gitignore` entry list are the two
things no design doc specifies. Both are recorded as unknowns resolved by this card rather than
invented facts.

---

### P0-T02 — Scaffold from the template and re-baseline it

| Field | Value |
|---|---|
| **ID** | `P0-T02` |
| **State** | `DONE` — completed 2026-09-10, commits `437b366`, `f9e97d9`, `ffae1eb`; all six criteria verified after a clean install AND a build |
| **Depends on** | `P0-T01`, `P0-T29` |
| **Blocks** | `P0-T03`, `P0-T04` |
| **Retires** | part of `V-1`, part of `R-11` |
| **Implements** | none |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** A checkout derived from `windingwind/zotero-plugin-template` whose dependencies
resolve to current versions **and still compile**, with every one of the eight day-one
deviations in `docs/01` §4.6 applied as an explicit change.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §4.2 — the stale-template warning: `main` HEAD is
  2025-12-16, pins `zotero-plugin-toolkit ^5.1.0-beta.13`, and a fresh `npm install` resolving
  to 5.2.0 **will not compile**. This is the reason the card exists.
- `docs/01-zotero-plugin-platform.md` §4.3 — the toolkit removal table and the 5.2.0 import
  break; you cannot fix the build without it.
- `docs/01-zotero-plugin-platform.md` §4.6 — the eight numbered deviations to make on day one,
  and the recommended version set.
- `docs/13-testing-build-and-release.md` §1.1 — the layer/package table and the decision to
  keep scaffold as the build driver, so you know what to keep and what to replace.
- `docs/13-testing-build-and-release.md` §1.4 — the working `zotero-plugin.config.ts` for this
  project, including the two `> **Unverified:**` markers this card must diff against reality.

**Files.**
- create `package.json`
- create `zotero-plugin.config.ts`
- create `addon/bootstrap.js`
- create `addon/manifest.json`
- create `addon/prefs.js`
- delete `src/modules/examples.ts` (as scaffolded from the template)
- create `.npmrc` (pnpm only — see step 9)

**Do.**
1. Take the template's structure (`addon/`, `src/`, `zotero-plugin.config.ts`,
   `package.json`) as the starting shape, per `docs/07` §2.1.
2. **Fix 1 (manifest compatibility).** Set `applications.zotero.strict_min_version` to
   `"10.0"` and `strict_max_version` to `"10.0.*"` in `addon/manifest.json`. The template ships
   `"6.999"` / `"8.*"`. Detail and verification belong to `P0-T03`; make the edit here so the
   tree is never committed carrying `"8.*"`.
3. **Fix 2 (toolkit version + import).** Set `zotero-plugin-toolkit` to `^5.2.0` and change
   every `import { ZoteroToolkit } from "zotero-plugin-toolkit"` to
   `import { ZoteroToolkit } from "zotero-plugin-toolkit/ztoolkit"` — the class moved to a
   subpath export in 5.2.0 (`docs/01` §4.3).
4. **Fix 3 (deleted menu API).** Delete every `ztoolkit.Menu.register(...)` call. The API was
   removed in toolkit 5.1.1. Menu registration is `Zotero.MenuManager.registerMenu()`
   (`docs/01` §3.2 for the call shape); the actual menu item is `P0-T10`.
5. **Fix 4 (stale examples).** Read `src/modules/examples.ts` once for orientation, then delete
   it. Several snippets predate Zotero 8.
6. **Fix 5 (esbuild target).** Raise the esbuild `target` from `firefox115` to `firefox140`
   for a Zotero-10-only plugin. `docs/13` §1.5 records that `firefox140` is a **candidate to
   confirm**, not a confirmed fact: if the build or smoke test fails, drop back to
   `firefox115` and record which value actually worked in the spike report.
7. **Fix 6 (namespaces).** Set the preference prefix to `extensions.zotero.research-helper`
   (`docs/01` §7.1's branch) and the scaffold `namespace` to **`researchHelper`** per
   `docs/13` §1.4, which is the project's configuration of record; `docs/01` §4.6 item 6 defers
   to it by name. Note §1.4's explicit warning that the JavaScript namespace
   (`Zotero.ResearchHelper`) and the pref prefix are deliberately different strings — an earlier
   draft of `docs/01` §4.6 gave `research-helper` for both, which is exactly the conflation
   §1.4 warns against.
8. **Fix 7 (update URL).** Point `updateURL` at the repository's permanent `release` tag, the
   scaffold convention described in `docs/01` §11.3 / §4.5.
9. **Fix 8 (native managers).** Adopt the rule from `docs/01` §4.6 item 8: prefer the native
   `Zotero.*Manager` APIs, keeping the toolkit only for `DialogHelper`,
   `VirtualizedTableHelper`, `FilePickerHelper`, `ClipboardHelper`, `KeyboardManager` and
   `unregisterAll()`. Encode this as a comment at the top of the composition root and as the
   ESLint rule added in `P0-T04`. If pnpm is used, add
   `public-hoist-pattern[]=*@types/bluebird*` to `.npmrc` (`docs/01` §4.6).
10. Pin the version floor: Node 22.8+ (scaffold 0.9.x requires it), TypeScript 5.9,
    `zotero-plugin-scaffold ^0.9.2`, `zotero-types ^4.1.3` (`docs/01` §4.6).
11. Write the npm scripts exactly as `docs/13` §1.6 lists them (`start`, `build`, `typecheck`,
    `lint:check`, `lint:fix`, `test:unit`, `test:contract`, `test:integration`, `test`,
    `fixtures:record`, `release`).
12. Diff the scaffolded `zotero-plugin.config.ts` against the **installed** scaffold's own type
    definitions and record every key name that disagrees with `docs/13` §1.4. `docs/13` §1.4
    flags the `test.*` key names (`abort` vs `abortOnFail`, `startDelay` vs `startupDelay`,
    `timeout` at top level vs under `mocha`) and the `esbuildOptions` array shape as unverified;
    `P0-T13` resolves them for real.

**Do NOT.**
- Do not run a fresh `npm install` against the template's unmodified `package.json` and assume
  the lockfile saves you: `npm ci` works only because the committed lockfile pins the old beta.
- Do not keep `strict_max_version: "8.*"` even temporarily on a commit — a plugin shipped that
  way is administratively disabled on the user's Zotero 10 (`docs/01` §12 gotcha 21).
- Do not declare compatibility with Zotero 11. `docs/01` §1.3 quotes Zotero verbatim: "Do not
  update your plugin to declare compatibility with Zotero 11 at this time."
- Do not call `ztoolkit.PreferencePane`, `ztoolkit.ItemTree`, `ztoolkit.ItemBox`,
  `ztoolkit.Shortcut` or `ztoolkit.ReaderInstance` — all removed in toolkit 3.0.0
  (`docs/01` §4.3).
- Do not assume `zotero-plugin-toolkit` wraps items, collections, search or attachments. The
  verified `5.2.0` component list in `docs/01` §4.3 contains no such wrapper; that work goes
  through `Zotero.Items` / `Zotero.Collections` / `Zotero.Search` / `Zotero.Attachments`
  directly, behind `src/zotero/`.
- Do not add Vite. `docs/13` §1.1 rules it out: the scaffold standardizes on esbuild and Vite
  would mean re-implementing placeholder substitution, FTL prefixing, prefs prefixing and XPI
  packaging.
- Do not trust the toolkit's documentation site over its published `.d.ts` (`docs/01` §4.3).

**Done when.**
- [ ] `npm install` on a clean clone (no lockfile reuse) completes and `npm run typecheck`
      exits 0.
- [ ] `grep -r "ztoolkit.Menu" src/ addon/` returns nothing.
- [ ] `grep -r 'from "zotero-plugin-toolkit"' src/` returns nothing (only the `/ztoolkit`
      subpath import remains).
- [ ] `src/modules/examples.ts` does not exist.
- [ ] `addon/manifest.json` contains `"strict_max_version": "10.0.*"` and no `"8.*"`.
- [ ] The installed versions of `zotero-plugin-scaffold`, `zotero-plugin-toolkit` and
      `zotero-types` are recorded verbatim in the spike-report notes.

**Verify with.**
```bash
rm -rf node_modules package-lock.json && npm install && npm run typecheck \
  && ! grep -rq "ztoolkit\.Menu" src addon
```

**Notes.** This card is where `docs/01` §4.2's warning is cashed in. The template is ~9 months
stale; treat every example module as pseudocode until read against `docs/01` §§3.2–3.4. Two
`> **Unverified:**` markers are attached to `docs/13` §1.4 (`test` config key names,
`esbuildOptions` shape / `{{version}}` templating) and one to `docs/01` §4.5 (whether scaffold
0.9.x's RDP client has been validated against Zotero 10); step 12 collects evidence, `P0-T08`
and `P0-T13` close them.


**Findings, 2026-09-10** (for `P0-T28`'s spike report; `docs/spikes/phase-0.md`).

*Installed versions, verbatim from `npm ls --depth=0` after a lockfile-free install*
— criterion 6:

```
typescript@5.9.3
zotero-plugin-scaffold@0.9.2
zotero-plugin-toolkit@5.2.0
zotero-types@4.1.3
```

*The template is exactly as `docs/01` §4.2 described.* `main` HEAD is still
`306d4e2a0959a7b2f5e44bb38169fb25f841dbaf`, 2025-12-16 — unmoved in nine months.
Its lockfile pins `zotero-plugin-toolkit@5.1.0-beta.13`, so `npm ci` compiles and a
lockfile-free `npm install` resolves to 5.2.0 and does not. The break is exactly two
sites: the root `ZoteroToolkit` import and four `ztoolkit.Menu` calls.

*Fix 2 is confirmed against the published package, not the docs.* toolkit 5.2.0's
`exports` map is `{ ".": "./dist/index.js", "./ztoolkit": "./dist/ztoolkit.js",
"./package.json": "./package.json" }`, and `ZoteroToolkit` is absent from the root
entry's exports. **New constraint the docs do not record:** that map carries no
`types` condition on any subpath, so TypeScript resolves `/ztoolkit`'s types only
through the `.js` → `.d.ts` sibling fallback. `moduleResolution` must be `"bundler"`
or `"node16"`; legacy `"node"` silently loses the types.

*Three of the eight day-one fixes were already done upstream.* `docs/01` §4.6 lists six
removed toolkit APIs to strip. Only the menu API is still called in the template
(`src/modules/examples.ts:143, 154, 176, 180`). `PreferencePane`, `ItemTree` and
`ItemBox` already go through `Zotero.PreferencePanes` / `Zotero.ItemTreeManager` /
`Zotero.ItemPaneManager`, `Shortcut` is already `ztoolkit.Keyboard`, and
`ReaderInstance` never appears. `docs/01` §4.6 should be corrected. Also already
satisfied: the template's `addon/bootstrap.js` carries no Zotero 6 shim.

*Step 12 — the four `test.*` keys `docs/13` §1.4 flagged `> **Unverified:**` are
resolved, and the types win over the published docs.* From scaffold 0.9.2's own
`TestConfig`: `abortOnFail` (not `abort`), `startupDelay` (not `startDelay`),
`timeout` **under `mocha`** (not top level), and `esbuildOptions` is an array
(`BuildOptions[]`). `zotero-plugin.config.ts` is written to the type names.
`docs/13` §1.4's example block uses the documented names and would fail; V-5 /
`P0-T13` should close the marker in the doc's favour of the types.

*`docs/01` §4.6's Node floor is too low.* It says ≥ 22.8, which is scaffold's own
`engines`. But vitest 5 requires `^22.12` and eslint 10 requires `^22.13`, so the
effective floor on the 22 line is **≥ 22.13**. `package.json` declares that. Installed
locally: Node v22.23.0.

*TypeScript stayed at 5.9 by owner decision (2026-09-10).* `docs/01` §4.6 pins 5.9 and
the template uses `^5.9.3`, but 5.9.3 shipped 2025-09-30 and the current release is
7.0.2 — scaffold 0.9.2 is itself built with `typescript ^6.0.3`. Holding at 5.9 keeps
Phase 0 to one variable; re-evaluate once the toolchain is proven.

*Deviations from the template, deliberate.*
1. **`BasicTool` is not used.** The template's `src/index.ts` pulls `Zotero` into the
   sandbox via `basicTool.getGlobal()`. Fix 8's keep-list does not include
   `BasicTool`, and criterion 3 forbids any bare root import, so `addon/bootstrap.js`
   forwards `Zotero`, `Services`, `Components` and `ChromeUtils` onto the sandbox
   context instead. **Not yet proven at runtime** — `P0-T09` and `P0-T11` are the
   first tests of it. If the plugin fails to start, this is the first thing to suspect.
2. **No `.npmrc`.** The card scopes it to pnpm; this project uses npm. The template
   ships none either.
3. **`addon/prefs.js` keys are bare.** No `__prefsPrefix__` placeholder — verified that
   the template does the same and scaffold injects `build.prefs.prefix` at build time.
   Confirmed in the output: `pref("extensions.zotero.research-helper.enable", true)`.

*Evidence beyond the card's criteria.* `npm run build` succeeds in 0.134 s and emits
`research-helper.xpi` (30,269 bytes), `update.json` and `update-beta.json`. Every
manifest placeholder substituted correctly, including `strict_max_version: "10.0.*"`
and the `release`-branch `update_url`. This is the first real evidence for `V-1`; what
remains for `V-1` is installing the XPI in Zotero 10 (`P0-T09`).

*Still open.* The esbuild `target: "firefox140"` compiles, but compiling is not running
— `docs/13` §1.5 calls it a candidate, and only the `P0-T09` smoke test can confirm it.
The built manifest references `content/icons/favicon.png`, which does not exist yet;
`P0-T04` creates `addon/content/icons/`.

*scaffold 0.9.2 bug, found while verifying this card.* With zero `.ftl` files the
build still writes `typings/i10n.d.ts`, and writes it as an empty union —
`export type FluentMessageId =` followed by `;` — which is **TS1110 "Type
expected"**. The generated header carries `// @ts-nocheck`, but that suppresses
semantic errors only; a parse error still fails `tsc --noEmit`. So on a fresh
clone, `npm run build` followed by `npm run typecheck` fails, while `typecheck`
alone passes. This card's own verification missed it on the first pass for
exactly that reason — the criteria were run before the first build.
`build.fluent.dts` is set to `false` until `P0-T24` adds the first locale file.
Worth reporting upstream.
---

### P0-T03 — Write the Zotero 10 manifest and pin the plugin identity

| Field | Value |
|---|---|
| **ID** | `P0-T03` |
| **State** | `DONE` — completed 2026-09-10, commit `500cf7b`; all three criteria verified |
| **Depends on** | `P0-T02` |
| **Blocks** | `P0-T09` |
| **Retires** | part of `V-1` |
| **Implements** | `NFR-17` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** `addon/manifest.json` declares a Zotero-10-only plugin under the permanent ID
`research-helper@suppakoko.github.io`, with an HTTPS `update_url`, and the identity string is
consistent everywhere it appears.

**Read first.**
- `docs/00-overview.md` §3 D9 — the plugin ID is permanent once released and "appears in 15
  places across these documents"; it must be identical in `manifest.json`,
  `Zotero.PreferencePanes.register({ pluginID })`, `Zotero.MenuManager` registrations and
  `update.json`.
- `docs/00-overview.md` §3 D1 — Zotero 10.x, bootstrapped plugin; this is why the version range
  is floored at 10.0 rather than 6.999.
- `docs/13-testing-build-and-release.md` §1.3 — the exact target manifest for this project,
  including why `applications.zotero` is required and why the template's `"6.999"` idiom is
  deliberately not used.
- `docs/01-zotero-plugin-platform.md` §1.3 — the compatibility model, the "bump
  `strict_max_version` in the update manifest alone" trick, and Zotero's explicit instruction
  not to declare Zotero 11 compatibility.
- `docs/01-zotero-plugin-platform.md` §4.5 — "**Scaffold does not write `strict_min_version` /
  `strict_max_version`**"; `addon/manifest.json` owns the compatibility range, so an omission
  here is silent.
- `docs/07-architecture-and-data-model.md` §1.2 — the `> **Unverified:**` marker on the exact
  `strict_max_version` string Zotero 10 expects; this card gathers the evidence that closes it.

**Files.**
- modify `addon/manifest.json`
- modify `zotero-plugin.config.ts`

**Do.**
1. Set `manifest_version: 2` and the `__placeholder__` fields scaffold substitutes (`name`,
   `version`, `description`, `homepage_url`, `author`) as shown in `docs/13` §1.3.
2. Set `applications.zotero.id` to `research-helper@suppakoko.github.io`.
3. Set `applications.zotero.strict_min_version` to `"10.0"` and `strict_max_version` to
   `"10.0.*"`.
4. Set `applications.zotero.update_url` to the HTTPS URL of the permanent `release`-tag
   `update.json` asset, matching `updateURL` in `zotero-plugin.config.ts` (`docs/13` §1.4).
5. Add the two icon entries (`48`, `96`) pointing into `content/icons/`.
6. Grep the whole tree for any other occurrence of the plugin ID and confirm they are identical
   strings, not near-misses.

**Do NOT.**
- Do not write `strict_max_version: "11.*"` or any 11.x range. `docs/01` §1.3 and §11.3 both
  carry Zotero's explicit instruction against it, and Zotero 11 breaks
  `Services.logins.findLogins`, which our key storage (D5) sits on.
- Do not use `strict_min_version: "6.999"`. That is the template's "allow Zotero 7 betas" idiom
  and `docs/13` §1.3 says we deliberately floor at 10.0.
- Do not ship `update.rdf`. It is the Zotero-6-era format; Zotero 7+ uses `update.json`
  (`docs/01` §11.2).
- Do not serve `update_url` over plain HTTP — `docs/01` §11.2 requires HTTPS.
- Do not expect the scaffold to fill in the version range (`docs/01` §4.5).
- Do not change the plugin ID for convenience, ever. It is the root of the preference branch
  and the plugin's identity in the user's profile (D9).

**Done when.**
- [ ] `addon/manifest.json` parses as JSON and contains `"strict_min_version": "10.0"` and
      `"strict_max_version": "10.0.*"`.
- [ ] The literal `research-helper@suppakoko.github.io` appears in `addon/manifest.json` and in
      `zotero-plugin.config.ts`, and `grep -r` finds no variant spelling.
- [ ] `update_url` begins with `https://`.

**Verify with.**
```bash
node -e "const m=require('./addon/manifest.json').applications.zotero; \
 if(m.id!=='research-helper@suppakoko.github.io'||m.strict_min_version!=='10.0'|| \
 m.strict_max_version!=='10.0.*'||!m.update_url.startsWith('https://')) \
 { console.error(m); process.exit(1);} console.log('ok');"
```

**Notes.** `docs/07` §1.2 flags the exact `strict_max_version` string as unverified while
`docs/11` Phase 0 and `docs/13` §1.3 both assert `10.0.*`. `P0-T09` is where the string is
proved by an actual install; if Zotero rejects it, `docs/07` §1.2's marker resolves and
`docs/13` §1.3 becomes the defect.

---

### P0-T04 — Lay out the directory skeleton and dependency rule

| Field | Value |
|---|---|
| **ID** | `P0-T04` |
| **State** | `DONE` — completed 2026-09-10, commit `500cf7b`; all four criteria verified, lint rules proved to fire with six probe files |
| **Depends on** | `P0-T02` |
| **Blocks** | `P0-T05`, `P0-T30` |
| **Retires** | part of `R-1` |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The source tree matches `docs/07` §2.2, and the one-way dependency rule of
`docs/07` §2.3 is mechanically enforced rather than merely documented — so that ~80% of the
codebase stays runnable in plain Node.

**Read first.**
- `docs/07-architecture-and-data-model.md` §2.2 — **the authoritative directory tree.** Create
  it verbatim; this is the file that decides where every later task's files go.
- `docs/07-architecture-and-data-model.md` §2.3 — the dependency rule
  (`ui/ → pipeline/ → {sources,llm,tts,zotero} → core/ → model/`) and the statement that it is
  "mechanically enforceable with an ESLint `no-restricted-imports` config".
- `docs/13-testing-build-and-release.md` §2.1 — "an ESLint rule forbidding the `Zotero` global
  outside `src/zotero/`", plus the corollary this card encodes: everything that genuinely needs
  Zotero goes through `src/zotero/`, and `core/` reaches the platform through ports (`PrefStore`,
  `Clock`, `HttpClient`) supplied by the container, so it needs no mock at all.
- `docs/01-zotero-plugin-platform.md` §4.6 — the `zotero-types` entry table (`sandbox`,
  `xhtml`, `mainWindow`), because the tree's split between plugin-sandbox code and dialog
  scripts determines which entry each part is typed against.

**Files.**
- create `src/` subtree per `docs/07` §2.2 (`bootstrap/`, `core/`, `model/`, `sources/`,
  `llm/`, `tts/`, `pipeline/`, `zotero/`, `ui/`, `prefs/`, `prompts/`, `i18n/`) with
  `.gitkeep` or a one-line placeholder module where a directory would otherwise be empty
- create `addon/content/`, `addon/content/icons/`, `addon/locale/en-US/research-helper/`,
  `addon/locale/ko-KR/research-helper/`
- create `test/unit/`, `test/integration/`, `test/fixtures/`, `test/helpers/`, and
  `test/contract/` (`docs/13` §1.2's deliberate addition to §2.2's `test/` tree)
- create `schema/`, `typings/`, `scripts/`
- create `eslint.config.js`

**Do.**
1. Create every directory named in `docs/07` §2.2. Do not create files the tree does not name;
   later tasks create them.
2. Add an ESLint flat config extending `@zotero-plugin/eslint-config` plus a
   `no-restricted-imports` block encoding `docs/07` §2.3's layering: `model/` may import
   nothing but `model/`; `core/` may import only `model/`; `sources/`, `llm/`, `tts/` may not
   import `pipeline/` or `ui/`; `ui/` may not import `sources/`, `llm/`, `tts/` or `zotero/`
   directly.
3. Add a `no-restricted-globals` rule forbidding the `Zotero` global everywhere except
   `src/zotero/**` and `addon/**`.
4. Prove both rules fire: write a throwaway file that violates each, confirm ESLint errors,
   then delete it.

**Do NOT.**
- Do not fold `src/zotero/` into `src/core/`. `docs/07` §2.3 makes `zotero/` "the only
  directory permitted to reference `Zotero.*`", and the whole compatibility-isolation argument
  for R-1 rests on it.
- Do not create `src/platform/`. `docs/07` §2.2 is authoritative and names `src/zotero/`;
  `src/platform/` was an earlier draft's name for the same directory. `docs/13` §1.2 is the one
  place in the corpus that records the rename — "the Zotero-facing adapter layer is
  `src/zotero/`; `src/platform/` does not exist and no document should reintroduce it" — so read
  that sentence there, not as a live path anywhere else.
- Do not add `localStorage`/`sessionStorage`-based state anywhere in the tree; they are not
  available or persistent in the Zotero chrome context (`docs/01` §12 gotcha 2).
- Do not put the plugin's own SQLite or cache files in the profile directory. `docs/07` §8.4:
  plugin-owned files go in the **data** directory; the tier-3 secrets file is the single
  deliberate exception.
- Do not pre-create module files with invented type definitions. `docs/07` §4/§5 owns the
  types, and `plan/README.md` §5 rule 3 warns that typing from docs 02/03's working-name sketches
  builds a parallel, wrong type system.

**Done when.**
- [ ] Every directory named in `docs/07` §2.2 exists in the working tree.
- [ ] `npm run lint:check` exits 0 on the empty skeleton.
- [ ] A deliberate `import ... from "../ui/x"` inside `src/core/` fails `npm run lint:check`
      with a `no-restricted-imports` error (demonstrated, then reverted).
- [ ] A deliberate `Zotero.debug("x")` inside `src/core/` fails lint.

**Verify with.**
```bash
npm run lint:check
```

**Notes.** `docs/13` §1.2's tree and `docs/13` §2.1's ESLint rule now both agree with
`docs/07` §2.2 — `src/zotero/`, and the full `bootstrap/`, `model/`, `pipeline/`, `prefs/`,
`i18n/` layer set — and `docs/13` §1.2 states the precedence in its own header ("§2.2 wins and
this listing is the defect"), which `plan/README.md` §5 rule 3 makes binding anyway. Two directories
are deliberate `docs/13` additions that `docs/07` §2.2 does not carry: `test/contract/`
(§1.2 calls it a runner concern, kept separate from §2.2's `test/unit/`) and
`addon/content/icons/` (§1.3's manifest points its `48`/`96` icon entries there). Create both;
do not "correct" either back out against §2.2.

---

### P0-T05 — TypeScript config, npm scripts and a green typecheck

| Field | Value |
|---|---|
| **ID** | `P0-T05` |
| **State** | `DONE` — completed 2026-09-10; all three criteria verified, strict flags proved to fire |
| **Depends on** | `P0-T04` |
| **Blocks** | `P0-T06`, `P0-T07`, `P0-T12` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** `npm run typecheck` and `npm run lint:check` both exit 0 on the skeleton, with
TypeScript configured as a pure checker (esbuild emits).

**Read first.**
- `docs/13-testing-build-and-release.md` §1.5 — the `tsconfig.json` this project uses, and why
  `noEmit: true` (esbuild does the emitting; `tsc` is a checker in `npm run typecheck` and CI).
- `docs/01-zotero-plugin-platform.md` §4.6 — the alternative `zotero-types` "entries" form
  (`"extends": "zotero-types/entries/sandbox/"`) and the entry-per-context table. The two
  configs differ; reconcile them here.
- `docs/13-testing-build-and-release.md` §1.6 — the exact npm script list, so `typecheck`,
  `lint:check` and `build` mean what CI (`P0-T14`) expects them to mean.

**Files.**
- create `tsconfig.json`
- modify `package.json`
- create `prettier` config (`.prettierrc` or the `prettier` key in `package.json`)

**Do.**
1. Write `tsconfig.json` from `docs/13` §1.5: `target` ES2022, `module`/`moduleResolution`
   ESNext/Bundler, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `exactOptionalPropertyTypes`, `noEmit`, `skipLibCheck`, `resolveJsonModule`,
   `esModuleInterop`, `isolatedModules`, the `@/* → src/*` path alias, and
   `include: ["src", "test", "typings", "zotero-plugin.config.ts"]`.
2. Decide between `docs/13` §1.5's explicit `types: ["zotero-types", "node"]` and `docs/01`
   §4.6's `extends: "zotero-types/entries/sandbox/"`. Try the `entries/sandbox` form first —
   it is the entry `docs/01` §4.6 says is "the right one for a bootstrapped plugin" — and if
   it conflicts with `include`ing `test/` (which needs Node types), record the resolution in
   the spike report. **Which form the installed `zotero-types@4.1.3` actually supports is
   unknown from the docs and is part of what this card resolves.**
3. Confirm every script in `docs/13` §1.6 is present in `package.json`, including
   `test:contract` and `fixtures:record` even though their targets do not exist yet.
4. Run `npm run typecheck` and `npm run lint:check` and drive both to 0.

**Do NOT.**
- Do not set `noEmit: false` or let `tsc` produce output. esbuild owns emission
  (`docs/13` §1.5); two emitters is a debugging trap.
- Do not silence `strict` family flags to make the skeleton pass. They are chosen deliberately
  in `docs/13` §1.5.
- Do not set the esbuild `target` from `tsconfig`'s `target` — `docs/13` §1.5 states the
  esbuild target (`firefox140`, pending `P0-T02` step 6) is what actually governs downlevelling.
- Do not add a `types` entry for a package that is not installed; `skipLibCheck` will not save
  a missing types package.

**Done when.**
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint:check` exits 0.
- [ ] `package.json` contains all eleven scripts listed in `docs/13` §1.6.

**Verify with.**
```bash
npm run typecheck && npm run lint:check
```

**Notes.** No test file exists yet, so `npm test` is expected to fail or no-op at this point;
`P0-T12` fixes that. The `zotero-types` entry-vs-`types` discrepancy between `docs/01` §4.6 and
`docs/13` §1.5 is a real divergence in the corpus, not a mistake in this card — whichever form
works becomes the answer and the other document is the defect.


**Findings, 2026-09-10.** Step 2's divergence is resolved **in favour of `docs/01` §4.6's
`entries/` form**, and `docs/13` §1.5's `types: ["zotero-types", "node"]` block is the defect —
but only partly, because §1.5's strict-family flags are still right and are layered on top.

`zotero-types@4.1.3` ships seven entries (`base`, `sandbox`, `xhtml`, `mainWindow`, `html`,
`shared`, `webworker`). `entries/sandbox` is not a types package but a real tsconfig:

```jsonc
{ "extends": "../base/tsconfig.json",
  "compilerOptions": { "lib": ["ESNext"], "types": ["zotero-types/entries/sandbox"] } }
```

and `entries/base` already supplies `target: ES2022`, `module: ESNext`,
`moduleResolution: bundler`, `resolveJsonModule`, `strict` and `skipLibCheck` — six of the
fifteen options §1.5 lists. Three things had to be overridden:

1. **`composite: true`** comes from `entries/base` and implies emitting. Set `composite: false`
   alongside `noEmit: true`; esbuild owns emission (§1.5).
2. **`types` replaces rather than merges.** Extending the sandbox entry and then adding `"node"`
   means re-stating the sandbox entry: `["zotero-types/entries/sandbox", "node"]`. Node types
   are not optional — `zotero-plugin.config.ts` reads `process.env.NODE_ENV`, and `test/` will
   need them for vitest (`P0-T12`).
3. **`lib` is `["ESNext"]`, with no DOM**, which contradicts §1.5's
   `["ES2022", "DOM", "DOM.Iterable"]`. **The sandbox entry is right and §1.5 is wrong for
   `src/`**: a bootstrapped plugin's sandbox has no DOM, which is exactly the distinction
   `docs/01` §4.6's entry table draws. Nothing in `src/` references `document`, `window` or an
   HTML element type today. **This will need revisiting when UI code lands** — the prefs pane
   and dialog scripts run in the `xhtml` context, which does have a DOM, and `docs/01` §4.6
   says to pick the entry per execution context. Those files are plain `.js` under
   `addon/content/` today, so one tsconfig still suffices; the moment a `.ts` module needs the
   DOM, this becomes a second tsconfig (a project reference or a `test/tsconfig.json`-style
   sibling), not a widened `lib` here.

*The strict flags were proved to fire, not merely to be set.* A probe with an unchecked index
access and an `exactOptionalPropertyTypes` violation produced `TS18048` and `TS2375`; removed
afterwards. `tsc --listFiles` confirms `zotero-plugin.config.ts` is genuinely in the program —
an `include` entry that silently misses is the failure mode worth checking for.

*Left alone deliberately.* `addon/prefs.js` carries `/* eslint-disable no-undef */`, which the
shared ESLint config's own `specialCases` block has since made redundant, so every `lint:check`
run reports one `Unused eslint-disable directive` warning. It does not affect the exit code.
The file is `P0-T02`'s and is not in this card's `Files` list.
---

### P0-T06 — Verify `zotero-types` against the Zotero 10 API surface

| Field | Value |
|---|---|
| **ID** | `P0-T06` |
| **State** | `TODO` |
| **Depends on** | `P0-T05` |
| **Blocks** | `P0-T07` |
| **Retires** | `V-6` |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A written answer to `V-6`: are `zotero-types` definitions accurate for Zotero 10 for
the APIs this plugin depends on — items, collections, notifiers, preference panes,
`Zotero.HTTP` — and, where they are not, a local augmentation file that closes the gap.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.1 `V-6` — the exact scope of the check and the stated
  consequence ("cheap to do, expensive to discover late").
- `docs/13-testing-build-and-release.md` §1.1 — the `> **Unverified:**` marker on whether the
  current `zotero-types` release covers the Zotero 10 surface, and the prescribed remedy, a
  local augmentation file. §1.1 now states the directory explicitly — "**The directory is
  `typings/`, not `types/`**", because that is `docs/07` §2.2's name, where the scaffold already
  emits `typings/prefs.d.ts` and `typings/i10n.d.ts`, and one of §1.5's four tsconfig `include`
  entries; "a file placed under `types/` would never be typechecked and the augmentation would
  silently have no effect."
- `docs/01-zotero-plugin-platform.md` §4.6 — the `zotero-types` entry table; a "missing" type
  is often a wrong-entry problem, not a missing definition.
- `docs/01-zotero-plugin-platform.md` §8.1 — the full `Zotero.HTTP.request` option table and
  exception classes; this is the largest surface to check and the one every network task uses.
- `docs/01-zotero-plugin-platform.md` §3.4 — the Zotero 10 changes (plural selection getters,
  `addCondition` signature, `Zotero.HTTP.newCookieContext()`), because a type package that
  still models the Zotero 9 shapes will typecheck code that throws at runtime.

**Files.**
- create `typings/zotero-augment.d.ts`
- create `scripts/probe-types.ts` (throwaway probe; delete or keep as documentation)

**Do.**
1. Write a probe file that references, with types only, each API in `V-6`'s list:
   `Zotero.Items.getAsync`, `new Zotero.Item(...)`, `item.fromJSON`, `item.saveTx`,
   `Zotero.Collections.getAsync`, `new Zotero.Collection()`, `Zotero.Notifier.registerObserver`,
   `Zotero.PreferencePanes.register`, `Zotero.HTTP.request` and its exception classes,
   `Zotero.MenuManager.registerMenu`, `Zotero.OSKeyStore.encrypt`, `Zotero.PDFWorker.getFullText`,
   `Zotero.DB.executeTransaction`, `Zotero.DataDirectory.dir`.
2. Run `npm run typecheck` and record, per symbol: present / absent / present-but-wrong-shape.
3. For each gap, add a minimal declaration to `typings/zotero-augment.d.ts` — narrow, commented
   with the source of truth (a `chrome/content/zotero/xpcom/...` path from the design docs), and
   dated.
4. Record the installed `zotero-types` version and the per-symbol table in the spike report;
   this table is `V-6`'s answer.

**Do NOT.**
- Do not widen a type to `any` to make the probe pass. An `any` here re-hides exactly the
  breakage `V-6` exists to surface.
- Do not add declarations for APIs the design docs say do not exist:
  `Zotero.Fulltext.getItemContent` (`docs/06` §3.3.1 — does not exist) and
  `Zotero.Attachments.importEmbeddedItems` (`docs/01` §12 gotcha 20 — it is
  `importEmbeddedImage`). Declaring them creates a compiling call to nothing.
- Do not model the singular selection getters. `ZoteroPane.getSelectedCollection()`,
  `getCollectionTreeRow()`, `getSelectedLibraryID()`, `getSelectedSavedSearch()` and
  `getSelectedGroup()` **throw on Zotero 10** (`docs/01` §12 gotcha 3); type only the plural
  forms.
- Do not use `zotero/zotero@main` as the reference for what exists in 10.0 — `main` is already
  `11.0.SOURCE` (`docs/01` §12 gotcha 32).

**Done when.**
- [ ] Every symbol in step 1 either typechecks against `zotero-types` or has a dated,
      source-cited declaration in `typings/zotero-augment.d.ts`.
- [ ] `npm run typecheck` exits 0 with the probe file included.
- [ ] The per-symbol verdict table exists in the spike-report draft.

**Verify with.**
```bash
npm run typecheck
```

**Notes.** Types are a compile-time claim only. A symbol that typechecks here can still be
absent at runtime on Zotero 10.0.1 — `P0-T10`, `P0-T20` and `P0-T23` are where the runtime
claims get tested. Record type-verified and runtime-verified separately in the spike report.

The augmentation file goes in **`typings/`**, not `types/`, and the corpus now says so in one
voice: `docs/07` §2.2's tree declares `typings/`, `docs/13` §1.5's `tsconfig.json` `include`
array lists `"typings"`, and `docs/13` §1.1 — which said `types/zotero-augment.d.ts` in an
earlier draft — was corrected on 2026-09-09 and now spells out that a file under `types/` "would
never be typechecked and the augmentation would silently have no effect." Nothing to record as a
corpus defect any more.

**Findings, 2026-09-10.** Probed `zotero-types@4.1.3` (`entries/sandbox`) with
`scripts/probe-types.ts`. Baseline against the unaugmented package: 15 errors. After
`typings/zotero-augment.d.ts`: 0.

`V-6`'s answer: **`zotero-types@4.1.3` is broadly accurate for Zotero 10, but lags in six
places, four of which this plugin will hit.** Items, collections, `Notifier`, `PreferencePanes`,
`MenuManager`, `ItemPaneManager`, `Prefs`, `DB`, `ProgressWindow` and the core of `HTTP.request`
are all present and correctly typed.

*Augmented — five blocks, each proven necessary by the baseline run:*
`DataObject.SaveOptions.undoAction`/`undoActionArgs`; `HTTP.request`'s `anon` /
`noRetryOnThrottle` / `userContextId` plus the five `HTTP` exception classes; `OSKeyStore`
(absent entirely); `Retractions.isRetracted` (absent entirely); the four Zotero 10 plural
selection getters.

*Compile-time holes a later card will hit — recorded, not invented:*

| Hole | Symbol | Why it cannot be augmented | Lands on |
|---|---|---|---|
| (a) | `Zotero.PDFWorker.getFullText` | upstream `let PDFWorker: any` → duplicate identifier | Phase 3 `src/zotero/fulltext.ts` |
| (b) | `item.libraryID = n` | declared `readonly`; declaration merging cannot relax it | `P0-T10` / Phase 1 `itemMapper.ts` |
| (c) | `Services.logins.removeLoginAsync` | existence on Firefox 140 ESR unestablished | `P0-T23` |
| (f) | `Fulltext.getPages().indexedPages` | upstream overload with identical parameters resolves first | `src/zotero/fulltext.ts` |

*Wrong rather than missing — no augmentation can help:* `_ZoteroTypes.ZoteroPane` carries
`[attr: string]: any`, so the singular getters that **throw** on Zotero 10 still compile;
`Search.addCondition` keeps the pre-10 `required` parameter and `Conditions` keeps the removed
`fulltextWord`; `DB.executeTransaction`'s options members are all required and misspell
`disableForeignKeys`.

Criterion [2] as written — "`npm run typecheck` exits 0 with the probe file included" — **does
not hold**: `tsconfig.json`'s `include` is `["src", "test", "typings",
"zotero-plugin.config.ts"]`, so `scripts/` is outside the program. An equivalent config that
does include it exits 0. Reported rather than papered over, per `plan/README.md` §5 rule 6.

**Findings, 2026-09-10 (build).** `zotero-plugin-scaffold`'s `replaceDefine()` globs
`.scaffold/build/addon/**/*` with no extension filter and reads every match as UTF-8, but it
writes back **only when a replacement actually changed the string**
(`if (contents !== newContents) await writeFile(path, newContents)`). A binary under `addon/`
therefore survives intact unless it happens to contain a literal `__KEY__` byte sequence, in
which case the whole file is re-encoded as UTF-8 and corrupted. Both icons round-trip
byte-identically today (SHA-256 verified through the XPI); a future binary fixture is the risk.

---

### P0-T07 — `bootstrap.js` lifecycle and a central teardown registry

| Field | Value |
|---|---|
| **ID** | `P0-T07` |
| **State** | `TODO` |
| **Depends on** | `P0-T05`, `P0-T06` |
| **Blocks** | `P0-T08`, `P0-T09` |
| **Retires** | part of `V-4`, part of `R-12` |
| **Implements** | `FR-56` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `install` / `startup` / `shutdown` / `uninstall` / `onMainWindowLoad` /
`onMainWindowUnload` are implemented, dispatch into `src/hooks.ts`, and every registration
passes through one registry with a single `unregisterAll()` — so teardown is structural, not
remembered.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §2.3 — the six hook signatures, the `data`/`reason`
  parameters, `rootURI` semantics (always ends in `/`, may be a `jar:` URL), and the reason
  constants; the `APP_SHUTDOWN` early-return rationale is here.
- `docs/01-zotero-plugin-platform.md` §2.4 — the window-scoped-vs-application-scoped split.
  This is the rule that decides which registration goes in which hook, and getting it wrong
  leaks a window per close.
- `docs/01-zotero-plugin-platform.md` §2.5 — the two `loadSubScript` forms and the
  `aomStartup.registerChrome` / `chromeHandle.destruct()` pair.
- `docs/01-zotero-plugin-platform.md` §4.4 — the template's `hooks.ts`, specifically the
  `await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise,
  Zotero.uiReadyPromise])` startup barrier and the `ztoolkit.unregisterAll()` teardown.
- `docs/07-architecture-and-data-model.md` §2.2 — where `index.ts`, `addon.ts`, `hooks.ts` and
  `bootstrap/` sit, and what belongs in the composition root.
- `docs/10-requirements-and-user-stories.md` FR-56 — the acceptance criteria this card is
  written against.

**Files.**
- modify `addon/bootstrap.js`
- modify `src/index.ts`
- modify `src/addon.ts`
- modify `src/hooks.ts`
- create `src/bootstrap/container.ts`
- create `src/bootstrap/registerUI.ts`

**Do.**
1. Keep `bootstrap.js` tiny: register the chrome namespace via
   `amIAddonManagerStartup.registerChrome`, `loadSubScript` the bundle into an explicit context
   object, and dispatch each hook into `Zotero.<instance>.hooks.*`.
2. In `onStartup`, await the three-promise barrier before touching anything.
3. Register **application-scoped** things in `startup` only:
   `Zotero.PreferencePanes.register`, `Zotero.MenuManager.registerMenu`,
   `Zotero.Notifier.registerObserver`, pref observers.
4. Register **window-scoped** things in `onMainWindowLoad` only, give every injected DOM element
   an `id`, and record it for removal.
5. After registering app-scoped things in `startup`, iterate existing windows:
   `await Promise.all(Zotero.getMainWindows().map(win => onMainWindowLoad({ window: win })))`,
   so the plugin works when enabled mid-session.
6. Implement a `Registry` in `src/bootstrap/` holding every registration handle (menu IDs,
   pane IDs, notifier symbols, pref-observer symbols, timers, injected element IDs) with one
   `unregisterAll()`.
7. In `shutdown`: early-return on `APP_SHUTDOWN`; otherwise call `unregisterAll()`, then
   `ztoolkit.unregisterAll()`, then `chromeHandle.destruct()` and null it, then delete the
   plugin object off `Zotero`.
8. Set `addon.data.initialized = true` at the end of `onStartup` — `docs/13` §1.4's
   `test.waitForPlugin` reads exactly this, and `P0-T13` depends on it.

**Do NOT.**
- Do not do window-scoped setup in `startup()`. `startup()` can run before any window exists
  and `Zotero.getMainWindows()` can legitimately return `[]` (`docs/01` §2.4, §12 gotcha 8).
- Do not blanket-skip teardown. Skipping on `APP_SHUTDOWN` is correct; skipping on
  `ADDON_DISABLE` / `ADDON_UNINSTALL` / `ADDON_UPGRADE` is a leak (`docs/01` §12 gotcha 11).
- Do not call `Zotero.PreferencePanes.registerPane`. The method is
  **`Zotero.PreferencePanes.register`**, it is async and resolves to the pane ID
  (`docs/01` §7.3).
- Do not pass `defaultXUL` to `register()` — it is **not a caller option**; `register()` sets
  it internally. There is also **no `l10nID`**; `label` is a raw string (`docs/01` §7.3).
- Do not add a `Services.prefs.getDefaultBranch(...)` loop to load `addon/prefs.js`. Zotero 7+
  reads it automatically on install, on enable and on every startup; there is **no manifest
  declaration and no bootstrap call**, and the hand-rolled loop is a Zotero 6 shim
  (`docs/01` §7.2).
- Do not use `Cu.import` or Bluebird promise methods (`.map`, `.filter`, `.each`,
  `.isPending`, `.cancel`, `Zotero.spawn`) — both removed in Zotero 8
  (`docs/01` §12 gotchas 5 and 6).
- Do not inject a DOM element without an `id` you have recorded; `onMainWindowUnload` cannot
  clean up what it cannot find (`docs/01` §12 gotcha 9).
- Do not assume `rootURI` is a filesystem path — build paths as `rootURI + 'content/...'`
  (`docs/01` §2.3).

**Done when.**
- [ ] All six hooks exist as plain top-level functions in `addon/bootstrap.js`.
- [ ] `shutdown` returns early when `reason === APP_SHUTDOWN` and otherwise calls
      `unregisterAll()`, `chromeHandle.destruct()` and deletes the `Zotero` property.
- [ ] `src/bootstrap` exposes a registry whose `unregisterAll()` is the only teardown call site.
- [ ] `addon.data.initialized` becomes `true` at the end of `onStartup`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check
```

**Notes.** Runtime proof of teardown is `P0-T11` (manual, five cycles) and `P0-T13`
(automated). This card only makes teardown *structurally possible*. `docs/01` §2.4 notes
`Zotero.MenuManager` self-cleans on shutdown in Zotero 10, but native registrations you made
yourself are still your responsibility (`docs/01` §12 gotcha 10) — register them anyway.

**Findings, 2026-09-10.** `FR-56` is enforced structurally, in four layers, not by discipline:
(1) `Registration<THandle>.unregister` is a **required** property, so a registration that does
not describe its own removal is a compile error at the point of definition; (2) `Scope.use()`
performs the platform call and records the teardown in one step — there is no separate
`record()` to forget; (3) `container.ts` and `registerUI.ts` may not even name `Zotero`, because
`P0-T04`'s existing `no-restricted-globals` rule confines it to `src/zotero/**`, so bypassing the
registry is already a lint error and no new exemption was added; (4) two runtime tripwires — a
duplicate-description guard inside a scope (the "two menu items after re-enable" failure) and
`reportSurvivors()` on shutdown.

**The audit is one-sided, and deliberately so.** `Zotero.PreferencePanes.pluginPanes` lets
`reportSurvivors()` catch a pane registered *outside* the scope. `Zotero.MenuManager` and
`Zotero.Notifier` expose no equivalent enumeration in `zotero-types@4.1.3`, so no such audit
exists for them and none was invented; `P0-T11`'s manual cycling remains the only check.
Closing that gap needs an ESLint `no-restricted-properties` rule banning direct
`MenuManager.registerMenu` / `Notifier.registerObserver` / `PreferencePanes.register` /
`Prefs.registerObserver` outside a scope-aware wrapper — `eslint.config.js` is outside this
card's `Files`, so it is left for a card of its own.

**Open risk carried into `P0-T09` / `P0-T11`.** `addon/bootstrap.js` forwards exactly five
globals onto the sandbox context — `rootURI`, `Zotero`, `Services`, `Components`,
`ChromeUtils`. A bare `setTimeout`, `fetch`, `TextDecoder`, `URL` or `AbortController` inside
`src/` therefore resolves against the sandbox's own globals, and which of those exist is
unverified. Timer registration in particular assumes `setTimeout`. If it is absent, the fix is
to widen `ctx` in `bootstrap.js` — **not** to reintroduce `BasicTool`.

---

### P0-T08 — Dev profile, `.env`, hot reload and debugger attach

| Field | Value |
|---|---|
| **ID** | `P0-T08` |
| **State** | `TODO` |
| **Depends on** | `P0-T07` |
| **Blocks** | `P0-T10`, `P0-T13`, `P0-T15`, `P0-T18`, `P0-T21`, `P0-T23`, `P0-T24` |
| **Retires** | `V-2`, `V-3`, part of `R-11` |
| **Implements** | none |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — a human must create the dev profile through Zotero's profile-manager GUI and fill `.env` with machine-local absolute paths. An agent must stop and request these. |

**Goal.** `npx zotero-plugin serve` launches Zotero 10.0.1 with a dedicated dev profile and a
separate data directory, installs the plugin from source, reloads it on file save without a
restart, and the debugger attaches with breakpoints hitting plugin code.

**Read first.**
- `docs/13-testing-build-and-release.md` §1.6 — the `.env` keys, the profile-creation steps
  (`zotero.exe -P`), the launch-flag table, and the explicit warning never to develop against
  the production profile.
- `docs/01-zotero-plugin-platform.md` §4.5 "Hot reload uses RDP, not proxy files" — what
  `serve` actually passes (`--purgecaches --no-remote`, `--jsdebugger` when
  `server.devtools`), where logs land, and the `> **Unverified:**` marker on whether scaffold
  0.9.x's RDP client has been validated against Zotero 10.
- `docs/01-zotero-plugin-platform.md` §11.6 — the proxy-file fallback, step by step, including
  deleting `extensions.lastAppBuildId` / `extensions.lastAppVersion` from `prefs.js`.
- `docs/11-implementation-roadmap.md` §3 R-11 — the mitigation this card executes: fall back to
  the proxy-file method if hot reload misbehaves.
- `docs/07-architecture-and-data-model.md` §8.4 — profile directory vs data directory, so the
  two `.env` paths are not confused with each other.

**Files.**
- create `.env` (git-ignored; **human-supplied values**)
- modify `zotero-plugin.config.ts`

**Do.**
1. **Human gate.** Ask the human to: launch `zotero.exe -P`, create a profile named `dev`,
   point it at a separate data directory, and report the three absolute paths.
2. Write `.env` from those values: `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` (required),
   `ZOTERO_PLUGIN_PROFILE_PATH`, `ZOTERO_PLUGIN_DATA_DIR`.
3. Set `server.devtools: true` and `server.debugOutputFile: true` in
   `zotero-plugin.config.ts` (`docs/13` §1.4).
4. Run `npm start`. Confirm Zotero launches on the dev profile and the plugin appears in
   Tools → Plugins.
5. Edit a string in `src/hooks.ts`, save, and confirm the change takes effect in the running
   Zotero with no restart. **This is `V-2`'s answer.**
6. Confirm `--jsdebugger` opened the developer tools, set a breakpoint inside the plugin bundle,
   trigger it, and confirm it hits. Confirm debug output reaches `.scaffold/logs/` and that
   `Help → Debug Output Logging` shows plugin lines. **This is `V-3`'s answer.**
7. If step 5 fails: set `server.asProxy: true` and retry; if that also fails, execute the
   manual proxy-file procedure from `docs/01` §11.6 and record hot reload as
   **worked-around (manual restarts)** in the spike report — that is R-11 materialising, and
   `docs/11` §1's "editing a source file reloads without a manual restart" becomes a known
   deviation the owner must accept.

**Do NOT.**
- Do not point `.env` at the production profile or the production data directory. `docs/13`
  §1.6: "a plugin bug can damage a 10,000-item library."
- Do not invent launch flags. `docs/13` §1.6 states plainly: `--debugger` is **not** documented
  for Zotero; the scaffold uses `--jsdebugger`, and `server.devtools: true` is what appends it.
  Documented flags are `-P`, `-purgecaches`, `-ZoteroDebugText`, `-jsconsole`, `--jsdebugger`.
- Do not commit `.env` (see `P0-T01`).
- Do not assume `.env` overrides system-level environment variables — `docs/13` §1.6 records
  the documented caveat that it currently does not.
- Do not combine proxy files with `serve`'s RDP path expecting hot reload: `docs/01` §4.5 says
  proxy files **cannot** hot-reload.

**Done when.**
- [ ] `npm start` launches Zotero on the `dev` profile with the plugin installed from source.
- [ ] A saved edit to `src/hooks.ts` is observable in the running Zotero without restarting it —
      or the fallback is documented with the exact failure observed.
- [ ] A breakpoint set in the plugin bundle in the attached debugger is hit.
- [ ] A timestamped log file exists under `.scaffold/logs/`.

**Verify with.**
Manual, because no command asserts this:
1. `npm start`; confirm Tools → Plugins lists Research Helper.
2. Change a `Zotero.debug()` string in `src/hooks.ts`, save, watch the terminal report a
   reload, and confirm the new string appears in Debug Output.
3. In the attached devtools, set a breakpoint in the plugin bundle and trigger the hook.
4. `ls .scaffold/logs/` shows a `zotero-<starttime>.log`.

**Notes.** `V-2` and `V-3` are `docs/11` §4.1's 0.5 d + 0.5 d; they are merged here because
both are answered by one working dev-serve setup. `docs/11` §4's closing paragraph now confirms
this from the other side: of the four spikes it once expected to collapse together, "`V-2` and
`V-3` do collapse into one card" while `V-1` and `V-4` do not. The outcome of step 5 is the
single highest-leverage finding in Phase 0: on `docs/11` §1's corrected figures it sets
development velocity across ~154–215 developer-days, not the ~80 assumed when `V-2` was
written.

---

### P0-T09 — Build the first XPI and install it on Zotero 10.0.1

| Field | Value |
|---|---|
| **ID** | `P0-T09` |
| **State** | `TODO` |
| **Depends on** | `P0-T03`, `P0-T07`, `P0-T30` |
| **Blocks** | `P0-T27` |
| **Retires** | `V-1`, part of `R-11` |
| **Implements** | `NFR-17`, `NFR-18` |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — installing an XPI is a drag-and-drop into Tools → Plugins on the human's real Zotero 10.0.1. |

**Goal.** `npm run build` produces an XPI that installs cleanly on the actual Zotero 10.0.1 on
Windows, with `strict_min_version` / `strict_max_version` accepted — the first half of Phase 0's
definition of done.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.1 `V-1` — the assumption in full and its consequence
  ("the entire toolchain choice").
- `docs/01-zotero-plugin-platform.md` §11.1 — an XPI is a ZIP with `manifest.json` **at the
  archive root**; this is the single most common packaging mistake.
- `docs/01-zotero-plugin-platform.md` §11.5 — Zotero does not require signing; a plain zip
  renamed `.xpi` installs. No AMO, no `web-ext sign`.
- `docs/01-zotero-plugin-platform.md` §4.5 "Build pipeline (ordered)" — what scaffold does to
  your files (placeholder substitution, manifest deep-merge, FTL and prefs prefixing), so a
  surprising built artifact is diagnosable.
- `docs/10-requirements-and-user-stories.md` NFR-18 — the ≤ 3 MB bundle ceiling CI will enforce.

**Files.**
- modify `zotero-plugin.config.ts` (only if the build reveals a wrong key)

**Do.**
1. Run `npm run build` and locate the XPI under `.scaffold/build`.
2. `unzip -l` the XPI and confirm `manifest.json` and `bootstrap.js` are at the **archive
   root**, not nested in a folder.
3. Confirm the built `manifest.json` still carries `strict_min_version: "10.0"` and
   `strict_max_version: "10.0.*"` — scaffold's manifest builder deep-merges and does **not**
   write these (`docs/01` §4.5), so this is a check that they survived.
4. Record the XPI size and confirm it is under 3 MB.
5. **Human gate.** Have the human drag the XPI onto Tools → Plugins in their real Zotero
   10.0.1 and report: does it install, does it enable, does the version range get accepted, and
   does anything appear in the debug log.
6. Record the observed `strict_max_version` acceptance in the spike report — that closes
   `docs/07` §1.2's `> **Unverified:**` marker on the exact string.

**Do NOT.**
- Do not zip the containing folder. Zotero silently refuses an XPI whose `manifest.json` is one
  level down (`docs/01` §12 gotcha 1).
- Do not attempt to sign the XPI or submit it anywhere. `docs/01` §11.5 documents that Zotero
  sets `xpinstall.signatures.required` to `false`; signing is not part of this project.
- Do not install into the production profile for this test — use the dev profile from `P0-T08`
  unless the human explicitly wants the real-profile check, which `docs/11` Phase 0's
  definition of done does ask for; if so, install and then **uninstall** it there.
- Do not treat a successful build as a successful install. `V-1` is answered by the install,
  not the build.

**Done when.**
- [ ] `npm run build` exits 0 and produces exactly one `.xpi`.
- [ ] `unzip -l <xpi>` lists `manifest.json` with no directory prefix.
- [ ] The XPI is ≤ 3 MB.
- [ ] The human confirms the plugin installs and enables on Zotero 10.0.1 with no version
      warning, or reports the exact refusal message.

**Verify with.**
```bash
npm run build && xpi="$(find .scaffold/build -name '*.xpi' -print -quit)" \
  && unzip -l "$xpi" | grep -qE '(^| )manifest\.json$' \
  && test "$(stat -c%s "$xpi")" -le 3145728 && echo "ok: $xpi"
```

**Notes.** `docs/07` §1.2 flags the exact `strict_max_version` string as unverified while
`docs/13` §1.3 and `docs/11` Phase 0 both assert `10.0.*`. This card is where reality decides.
On Windows without a POSIX shell, the `Verify with` command runs under the Git Bash that ships
with Git for Windows; the size check has a PowerShell equivalent
(`(Get-Item $xpi).Length`) if needed.

---

### P0-T10 — Tools-menu item that creates a `journalArticle`

| Field | Value |
|---|---|
| **ID** | `P0-T10` |
| **State** | `TODO` |
| **Depends on** | `P0-T08` |
| **Blocks** | `P0-T11`, `P0-T20`, `P0-T24` |
| **Retires** | part of `V-1` |
| **Implements** | part of `FR-6` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A Tools-menu item exists that, when clicked, creates one `journalArticle` with a
title, an author, a DOI and an `abstractNote` inside a named collection — the first end-to-end
proof that the plugin can write to the library.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §3.2 "New in Zotero 8: `Zotero.MenuManager`" — the
  verbatim `registerMenu` call shape (`menuID`, `pluginID`, `target`, `menus[]` with
  `menuType`, `l10nID`, `onShowing`, `onCommand`) and `unregisterMenu`.
- `docs/01-zotero-plugin-platform.md` §5.2 — item creation, the creator object shape,
  `setCollections()` semantics, automatic-tag type `1`, and the `> **Unverified:**` marker on
  the `undoAction` identifier.
- `docs/01-zotero-plugin-platform.md` §5.2.1 — why `fromJSON()` is preferred over field-by-field
  `setField()`, and the warning that `fromJSON` is a replace, not a merge.
- `docs/01-zotero-plugin-platform.md` §5.4 — collection creation, and the `> **Unverified:**`
  marker on whether `collection.addItems()` exists on Zotero 10 plus the safe item-side
  alternative.
- `docs/01-zotero-plugin-platform.md` §5.8 — `save()` inside a transaction vs `saveTx()`
  outside, and the rule against network I/O inside a transaction.
- `docs/07-architecture-and-data-model.md` §2.2 — the files this belongs in
  (`src/ui/menus/`, `src/zotero/collectionOps.ts`, `src/zotero/itemMapper.ts`).
- `docs/07-architecture-and-data-model.md` §6.1 "Verified Zotero field keys" — the field keys
  to use, so `abstractNote` and `DOI` are spelled as Zotero spells them.

**Files.**
- create `src/ui/menus/toolsMenu.ts`
- create `src/zotero/zoteroApi.ts`
- create `src/zotero/collectionOps.ts`
- create `src/zotero/itemMapper.ts`
- modify `src/bootstrap/registerUI.ts`
- create `addon/locale/en-US/research-helper/mainWindow.ftl`

**Do.**
1. Register one Tools-menu item through `Zotero.MenuManager.registerMenu`, storing the returned
   ID in the `P0-T07` registry and unregistering it on shutdown.
2. On command: create (or find) a collection with a fixed spike name, then create one
   `journalArticle` with `title`, one author creator, `DOI` and `abstractNote`, tag it
   `research_helper` as an automatic tag, and put it in that collection.
3. Gate any field-key lookup on `await Zotero.Schema.schemaUpdatePromise` before calling
   `Zotero.ItemFields.*`.
4. Do the write inside one `Zotero.DB.executeTransaction` using `item.save()`; take the
   collection creation outside it or inside it consistently, and record which shape worked.
5. Resolve `docs/01` §5.4's open question in the console before choosing: does
   `collection.addItems()` exist on Zotero 10? If unsure, use the documented-safe item-side
   pattern (`item.addToCollection(collection.id)` then `item.save()` inside a transaction).
6. Resolve `docs/01` §5.2's `undoAction` question: grep `zotero.ftl` for `undo-action-` and use
   a real identifier, or **omit the option entirely**.
7. Put the menu label in `addon/locale/en-US/research-helper/mainWindow.ftl` with a
   `research-helper-` prefixed ID; the Korean bundle arrives in `P0-T24`.

**Do NOT.**
- Do not use `ztoolkit.Menu.register`. It was removed in toolkit 5.1.1 and the toolkit
  deliberately does not wrap `Zotero.MenuManager` (`docs/01` §4.3, `docs/08` §2.4.2).
- Do not hand-inject `<menuitem>` elements into the menubar as a shortcut around
  `registerMenu` — `docs/08` §2.4.1 rules it out explicitly.
- Do not call `saveTx()` inside `executeTransaction()` — it deadlocks or throws
  (`docs/01` §12 gotcha 12). `save()` inside, `saveTx()` outside.
- Do not perform network I/O inside the transaction (`docs/01` §12 gotcha 13). This spike does
  none, but the pattern is being established here.
- Do not call `ZoteroPane.getSelectedCollection()` or any other singular selection getter to
  find a target collection — they throw on Zotero 10 (`docs/01` §12 gotcha 3). Use the plural
  forms, or create the collection outright, which is what this card does.
- Do not invent an `undoAction` string (`docs/01` §5.2 marks
  `'undo-action-add-item'` unverified). Omit rather than invent.
- Do not call `setField()` on a field invalid for the item type — it throws
  (`docs/01` §12 gotcha 17). `PMID`/`PMCID` are valid on `journalArticle` but not on
  `preprint` (`docs/01` §5.2).
- Do not hand-copy an item-field list; feature-detect via `Zotero.ItemFields.getID(...)`
  (`docs/01` §12 gotcha 28), and only after the schema promise resolves (gotcha 29).
- Do not use `fromJSON()` to patch an existing item — it clears fields absent from the JSON
  (`docs/01` §12 gotcha 24).

**Done when.**
- [ ] A "Research Helper" item appears in the Tools menu of the running dev Zotero.
- [ ] Clicking it creates exactly one `journalArticle` whose `title`, first author, `DOI` and
      `abstractNote` are all populated and visible in the item pane.
- [ ] The item is inside the named collection and carries the automatic tag `research_helper`.
- [ ] Clicking it twice does not throw; the second click's behaviour (second item, or reuse of
      the collection) is deliberate and recorded.
- [ ] No error appears in Debug Output during the click.

**Verify with.**
Manual, in the running dev Zotero:
1. `npm start`, then Tools → Research Helper → the spike command.
2. Confirm the collection exists in the left pane and holds one item with all four fields set.
3. Confirm Debug Output shows no exception.
(An automated version of this check lands in `P0-T13`.)

**Notes.** This card resolves two `> **Unverified:**` markers by observation:
`collection.addItems()` existence (`docs/01` §5.4) and the `undoAction` identifier
(`docs/01` §5.2). Record both answers in the spike report. The menu **target** string for the
Tools menu is not stated in `docs/01` §3.2's example (which uses `main/library/item`);
`docs/08` §2.1 owns the target list — it reproduces `menuManager.js`'s `VALID_TARGETS` array
verbatim, and the Tools-menu value is **`"main/menubar/tools"`**. Use that; if Zotero 10.0.1
rejects it, that is a spike finding, not a licence to invent a different string.

---

### P0-T11 — Prove clean teardown across five disable/enable cycles

| Field | Value |
|---|---|
| **ID** | `P0-T11` |
| **State** | `TODO` |
| **Depends on** | `P0-T10` |
| **Blocks** | `P0-T13` |
| **Retires** | `V-4`, `R-12` |
| **Implements** | `FR-56` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — the Plugins window disable/enable cycle and the debug-log inspection are GUI actions on the human's Zotero. |

**Goal.** `V-4`'s answer: `shutdown()` fully tears down every registration with no residue and
no console errors, verified by disabling and re-enabling the plugin five times in one session.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.1 `V-4` — the exact protocol (five disable/enable
  cycles) and the stated stake ("a leak here is user-visible and reputation-damaging").
- `docs/11-implementation-roadmap.md` §3 R-12 — the mitigation being validated: a central
  registry of every registered artifact with a single `unregisterAll()` called from
  `shutdown()`.
- `docs/01-zotero-plugin-platform.md` §2.4 — the per-window add/remove bookkeeping, including
  `storeAddedElement()` throwing when an element has no `id`.
- `docs/01-zotero-plugin-platform.md` §2.3 — the `APP_SHUTDOWN` branch, so you disable rather
  than quit when testing.
- `docs/10-requirements-and-user-stories.md` FR-56 — both acceptance criteria, including that
  previously created items must survive uninstall as ordinary Zotero data.

**Files.**
- modify `src/hooks.ts` (fixes found by the cycling)
- modify `src/bootstrap/registerUI.ts` (fixes found by the cycling)

**Do.**
1. With `npm start` running, open Tools → Plugins and disable the plugin.
2. Confirm the Tools-menu item from `P0-T10` is gone from the menu.
3. Confirm Debug Output contains no exception from the shutdown path.
4. Re-enable. Confirm the menu item returns exactly once — not twice.
5. Repeat steps 1–4 five times total, watching for a menu item that accumulates duplicates or a
   growing set of listeners.
6. Close and reopen a main window between two of the cycles, to exercise
   `onMainWindowUnload` / `onMainWindowLoad` independently of enable/disable.
7. Uninstall the plugin and confirm the item and collection created in `P0-T10` survive as
   ordinary Zotero data (FR-56's second criterion).
8. Fix anything the cycling exposes and re-run the whole sequence from a clean start.

**Do NOT.**
- Do not test teardown by quitting Zotero. `shutdown()` early-returns on `APP_SHUTDOWN`
  (`docs/01` §2.3), so quitting exercises the path that deliberately does nothing.
- Do not accept "no visible menu item" as proof. Also check for surviving notifier observers,
  pref observers and timers — the registry from `P0-T07` should be able to report zero live
  handles after `unregisterAll()`.
- Do not rely on `Zotero.MenuManager`'s self-cleaning to cover registrations you made yourself
  (`docs/01` §12 gotcha 10).
- Do not delete or modify the user's items to "clean up" between cycles — NFR-20 forbids
  touching user-authored data, and the spike collection is plugin-owned and tagged.

**Done when.**
- [ ] Five disable/enable cycles leave exactly one Tools-menu item after each enable, and none
      after each disable.
- [ ] Debug Output for the whole session contains no exception originating in plugin code.
- [ ] A window close/reopen mid-session does not duplicate or orphan the menu item.
- [ ] After uninstall, the `P0-T10` item and collection still exist.
- [ ] The registry reports zero live handles after `unregisterAll()`.

**Verify with.**
Manual (no command exists for this in Phase 0):
1. `npm start`.
2. Tools → Plugins: disable, observe, enable, observe — five times.
3. `Help → Debug Output Logging`: inspect the whole session for exceptions.
4. Uninstall; confirm the spike item and collection remain.
(The automated regression for this is the lifecycle spec in `P0-T13`.)

**Notes.** This is the `docs/11` Phase 0 definition-of-done bullet "Disabling the plugin from
the Plugins window leaves no menu item, no observer, and no error in the debug log (FR-56)".
Whatever this card finds becomes the lifecycle integration spec in `P0-T13`, so the regression
is permanent rather than a one-off observation.

---

### P0-T12 — First Node unit test under Vitest

| Field | Value |
|---|---|
| **ID** | `P0-T12` |
| **State** | `TODO` |
| **Depends on** | `P0-T05` |
| **Blocks** | `P0-T14` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** One passing unit test runs in plain Node under Vitest with coverage available, and
the minimal `Zotero` fake exists so later pure modules never need a real Zotero.

**Read first.**
- `docs/13-testing-build-and-release.md` §2.1 — the runner choice (Vitest outside Zotero, Mocha
  inside — "a deliberate, documented split"), the coverage targets, the `Zotero` mocking rule,
  and the `test/setup/zotero-global.ts` fake in full.
- `docs/13-testing-build-and-release.md` §2 — the four-layer pyramid, so this card is scoped to
  layer 1 only and does not drift into contract tests.
- `docs/07-architecture-and-data-model.md` §2.3 — why ~80% of the codebase is Node-runnable:
  the layering this test exercises.
- `docs/07-architecture-and-data-model.md` §2.2 — where unit tests live (`test/unit/core/`,
  `test/unit/model/`, …).

**Files.**
- create `vitest.config.ts`
- create `test/setup/zotero-global.ts`
- create `src/model/ids.ts`
- create `test/unit/model/ids.spec.ts`

**Do.**
1. Add Vitest as a dev dependency. **The design docs name Vitest but pin no version** — record
   the installed version in the spike report as a resolved unknown.
2. Write `vitest.config.ts` registering `test/setup/zotero-global.ts` via `test.setupFiles`,
   and enabling v8 coverage.
3. Write the minimal `Zotero` fake exactly as `docs/13` §2.1 gives it, and keep it minimal —
   §2.1's rule is that a test needing a richer Zotero is a signal the code belongs in an
   integration test.
4. Implement the smallest genuinely pure function that Phase 1 will need anyway: DOI
   normalization in `src/model/ids.ts` (named in `docs/07` §2.2).
5. Write `test/unit/model/ids.spec.ts` covering normal, uppercase, `https://doi.org/`-prefixed
   and malformed inputs.
6. Confirm `npm run test:unit` passes and coverage output is produced.

**Do NOT.**
- Do not import `Zotero` from `src/model/` or `src/core/` — the ESLint rule from `P0-T04`
  forbids it and `docs/13` §2.1 states pure modules "must not import Zotero at all".
- Do not extend the fake to make a test pass. `docs/13` §2.1: "a fake that lies is worse than
  no fake", and its `> **Unverified:**` marker names `Zotero.DB.executeTransaction` and
  `Zotero.Item` construction as shapes to reconcile against `zotero-types` and against
  observed Zotero 10 behaviour (`P0-T20`).
- Do not make a network call from a unit test. Layer 2 (contract, record/replay) is not part of
  Phase 0.
- Do not use Mocha outside Zotero or Vitest inside it — the split is deliberate
  (`docs/13` §2.1).

**Done when.**
- [ ] `npm run test:unit` exits 0 with at least one passing spec.
- [ ] A coverage report is emitted under `coverage/`.
- [ ] `test/setup/zotero-global.ts` is registered and the spec runs without a real Zotero.
- [ ] The installed Vitest version is recorded in the spike-report notes.

**Verify with.**
```bash
npx vitest run --dir test/unit --coverage
```

**Notes.** `docs/13` §1.6's script list has `test:unit` running `vitest run --dir test/unit`;
keep that exact form so `P0-T14`'s CI job matches. `test:contract` stays in `package.json`
pointing at an empty `test/contract` directory until Phase 1 — record that as a known no-op
rather than deleting the script.

---

### P0-T13 — First in-Zotero Mocha test via the scaffold runner

| Field | Value |
|---|---|
| **ID** | `P0-T13` |
| **State** | `TODO` |
| **Depends on** | `P0-T08`, `P0-T11` |
| **Blocks** | `P0-T14` |
| **Retires** | `V-5` |
| **Implements** | `FR-56` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `V-5`'s answer: does the scaffold's in-Zotero Mocha runner work, what are its real
config key names, and can it run on GitHub Actions Ubuntu — which decides whether integration
tests are automatable at all.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.1 `V-5` — the exact scope, including the note that
  documented headless support covers Ubuntu 22.04/24.04 only, and the stated consequence: it
  "changes the whole test strategy in `13-testing-build-and-release.md`".
- `docs/13-testing-build-and-release.md` §2.3 — how the runner works (tests execute inside a
  live Zotero via a proxy plugin, temporary profile and data directory), the Mocha/Chai
  globals, the **complete** CLI flag list, and the explicit statement that there is no
  `--headless` flag.
- `docs/13-testing-build-and-release.md` §1.4 — the `test` config block for this project and
  its `> **Unverified:**` marker: the published docs and the scaffold's own types disagree on
  `abort`/`abortOnFail`, `startDelay`/`startupDelay`, and whether `timeout` sits under `mocha`.
  **Diffing these is the core of this card.**
- `docs/13-testing-build-and-release.md` §2.3's `> **Unverified:**` on `Zotero.Test` — do not
  build on a plugin-facing Zotero test API; it is not documented to exist.
- `docs/07-architecture-and-data-model.md` §2.2 — integration tests live under
  `test/integration/zotero/` and `test/integration/pipeline/`.

**Files.**
- create `test/integration/lifecycle.spec.ts`
- create `test/integration/zotero/itemCreation.spec.ts`
- modify `zotero-plugin.config.ts`

**Do.**
1. Open the **installed** `zotero-plugin-scaffold`'s type definitions and enumerate the real
   `test` config keys. Correct `zotero-plugin.config.ts` to whichever names the installed
   version accepts, and record the diff against `docs/13` §1.4 in the spike report.
2. Set `test.entries` to `["test/integration"]` and `test.waitForPlugin` to a function-body
   string that returns true once `addon.data.initialized` is set by `P0-T07`.
3. Write `test/integration/lifecycle.spec.ts` asserting the `P0-T11` findings mechanically: the
   Tools-menu item exists after startup, and after a shutdown/startup cycle exactly one exists.
4. Write `test/integration/zotero/itemCreation.spec.ts` asserting that the `P0-T10` command
   creates a `journalArticle` with the four fields populated inside the named collection.
5. Run `npm run test:integration` locally (headed) and get both specs green.
6. Determine whether the runner acquires a Zotero build itself or requires one to be
   provisioned — `docs/13` §5.1 flags this as unverified and it decides the CI job's shape.
   Record the answer.
7. Record whether headless works on Ubuntu in CI, or whether `xvfb-run` is needed. This is
   `V-5`'s second half and it is answered for real in `P0-T14`.

**Do NOT.**
- Do not pass `--headless` to `zotero-plugin test`. `docs/13` §2.3 states the whole CLI flag
  list is `--abort-on-fail`, `--exit-on-finish`, `--no-watch`, `-h`/`--help`, that headless is a
  **config key only**, and that an unknown option makes the CLI exit with an error.
- Do not hand-roll a Mocha-in-Zotero harness, and do not piggyback on Zotero's internal test
  infrastructure — `docs/13` §2.3 rules both out explicitly.
- Do not let an integration test call an external API or an LLM (`docs/13` §2.3). Phase 0's
  specs touch only local Zotero state.
- Do not point the runner at the developer's dev profile expecting persistence: it uses a
  temporary profile and data directory (`docs/13` §2.3), so a spec must create whatever it
  asserts on.
- Do not copy the `test` key names from `docs/13` §1.4 without diffing them first — that is the
  documented disagreement this card exists to settle.

**Done when.**
- [ ] `npm run test:integration` runs inside a real Zotero and both specs pass locally.
- [ ] `zotero-plugin.config.ts`'s `test` block uses key names the installed scaffold accepts,
      and the diff against `docs/13` §1.4 is written down.
- [ ] The lifecycle spec fails if `unregisterAll()` is deliberately removed (verified once,
      then reverted).
- [ ] Whether the runner provisions Zotero itself is recorded as yes/no.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `V-5` has the largest blast radius of the toolchain spikes: if the runner cannot run
on CI, `docs/13` §2.3's "Running them" paragraph and §5.1's `integration` job both change, and
in-Zotero testing becomes manual-release-QA-only on all platforms. `docs/13` §5.1 already
prescribes the interim posture — mark the CI `integration` job `continue-on-error: true` until
this is settled — which `P0-T14` implements.

---

### P0-T14 — CI workflow: lint, typecheck, unit test, build XPI

| Field | Value |
|---|---|
| **ID** | `P0-T14` |
| **State** | `TODO` |
| **Depends on** | `P0-T12`, `P0-T13` |
| **Blocks** | `P0-T27`, `P0-T28` |
| **Retires** | part of `V-5`, part of `R-11` |
| **Implements** | `NFR-18` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `.github/workflows/ci.yml` runs on push and PR, is green on a clean clone, and
enforces the four Phase 0 gates: lint, typecheck, unit tests, and an XPI build under the 3 MB
ceiling.

**Read first.**
- `docs/13-testing-build-and-release.md` §5.1 — the full `ci.yml` for this project: the four
  jobs, the Node version, the `needs:` graph, the XPI assertion with the NFR-18 size check, and
  the `> **Unverified:**` marker about Zotero acquisition in CI plus the instruction to mark the
  `integration` job `continue-on-error: true` until `V-5` is settled.
- `docs/13-testing-build-and-release.md` §5 preamble — the decision to write the pipeline out
  explicitly rather than only calling `zotero-plugin-dev/workflows`'s reusable workflow, "so
  the steps are auditable".
- `docs/13-testing-build-and-release.md` §1.6 — the npm script names the workflow invokes.
- `docs/11-implementation-roadmap.md` §1 Phase 0 definition of done — "CI is green on a clean
  clone" is a phase gate, not a nice-to-have.

**Files.**
- create `.github/workflows/ci.yml`

**Do.**
1. Write `ci.yml` following `docs/13` §5.1: `lint`, `unit`, `build`, `integration` jobs, Node
   22, `cache: npm`, `concurrency` group, `permissions: contents: read`.
2. In `lint`: `npm ci`, `npm run lint:check`, `npm run typecheck`.
3. In `unit`: `npx vitest run --dir test/unit --coverage`, upload coverage. **Omit the
   contract-test step for now** — `test/contract/` is empty until Phase 1; add a comment saying
   so rather than a failing step.
4. In `build`: `npm run build`, then the XPI existence and ≤ 3 MB assertions from `docs/13`
   §5.1 verbatim, and upload the XPI artifact.
5. In `integration`: run `npm run test:integration -- --exit-on-finish --abort-on-fail` with
   `continue-on-error: true`, per `docs/13` §5.1's instruction, until `V-5` is settled. If
   `P0-T13` established that a Zotero build must be provisioned, add the provisioning step and
   set `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`.
6. **Omit the `check-l10n.mjs` step** shown in `docs/13` §5.1's `lint` job for now: that script
   does not exist and `docs/11` R-22 makes the localization gate warn-only until Phase 7. Add
   it as a commented placeholder naming `P0-T24` as where the Fluent bundles come from.
7. Push a branch, confirm the run is green, and record the run URL in the spike report.

**Do NOT.**
- Do not add the release workflow here. `docs/13` §5.2 owns `release.yml`; `P0-T27` uses it
  only as far as `V-18` needs.
- Do not add the scheduled `compat.yml` (`docs/13` §5.3) in Phase 0 — it belongs with the
  ongoing R-1 mitigation, not the toolchain spike.
- Do not run in-Zotero integration tests on Windows or macOS runners. `docs/13` §2.3: headless
  support covers Ubuntu 22.04/24.04 only, and Windows/macOS in-Zotero runs are manual release
  QA.
- Do not put any API key in the workflow or in repository secrets for Phase 0. The `V-7` and
  `V-10` spikes run locally under a human gate; CI must stay credential-free.
- Do not weaken the 3 MB assertion to make a build pass — NFR-18 is the constraint, and a build
  over it is a finding.

**Done when.**
- [ ] A push to a branch produces a green `lint`, `unit` and `build` run.
- [ ] The `build` job uploads an `.xpi` artifact and fails if the XPI is missing or > 3 MB
      (verified once by temporarily lowering the threshold, then reverted).
- [ ] The `integration` job runs and does not block the PR while `continue-on-error: true`.
- [ ] The workflow does not reference any secret.

**Verify with.**
```bash
gh workflow run ci.yml && gh run watch
```
(or, without `gh`: push the branch and confirm the Actions run is green.)

**Notes.** Two steps from `docs/13` §5.1's listing are deliberately not implemented yet — the
contract-test step and `check-l10n.mjs` — because their inputs do not exist in Phase 0. Both
are commented placeholders, not silent omissions, so `docs/13` §5.1 stays the target shape.

---

### P0-T15 — Cross-origin POST with custom headers from inside Zotero

| Field | Value |
|---|---|
| **ID** | `P0-T15` |
| **State** | `TODO` |
| **Depends on** | `P0-T08` |
| **Blocks** | `P0-T16`, `P0-T17`, `P0-T25`, `P0-T28` |
| **Retires** | `V-7`, `R-13` |
| **Implements** | part of `FR-11`, part of `NFR-16` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — requires the human's four LLM provider API keys and spends real money (target: well under $1 for minimal completions). An agent must stop and ask; keys must be entered by the human, never pasted into a file or a pref. |

**Goal.** `V-7`'s answer: from inside the Zotero process, can we issue arbitrary cross-origin
POSTs with custom headers (`Authorization`, `x-api-key`, `anthropic-version`) to all four LLM
providers and one literature API, and receive full responses? This is the entire client-side,
no-backend premise.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-7` — the assumption verbatim and the stated
  consequence: "A CORS-equivalent restriction would force a fundamental redesign."
- `docs/11-implementation-roadmap.md` §3 R-13 — the mitigation being validated: use
  `Zotero.HTTP.request` (or verified `fetch`) rather than any provider SDK; no provider SDK is
  bundled.
- `docs/01-zotero-plugin-platform.md` §8.3 — why there is no CORS preflight in the privileged
  chrome context, and the rule that all network I/O must happen in the plugin sandbox, never
  from a dialog document.
- `docs/01-zotero-plugin-platform.md` §8.1 — the `Zotero.HTTP.request` option table
  (`headers`, `responseType`, `timeout`, `anon`, `errorDelayIntervals`, `noRetryOnThrottle`,
  `cancellerReceiver`) and the exception classes to catch.
- `docs/01-zotero-plugin-platform.md` §8.2 — the wrapper shape for this project, including
  `anon: true` on every LLM and literature-API call and the maintainer `User-Agent` from D10.
  Note §8.2's own header: it shows the *platform mechanics* only and defers the shipped option
  set to `docs/07` §7.4.
- `docs/07-architecture-and-data-model.md` §7.4 — **the authority for `src/core/http/client.ts`'s
  option set.** It carries the `client.ts` excerpt this card implements and the three deliberate
  overrides of Zotero's defaults (`successCodes: false`, `noRetryOnThrottle: true`,
  `errorDelayMax: 0`, with `timeout: opts.timeoutMs ?? 60_000`), because a retry issued below
  our per-host token bucket is one the rate limiter cannot pace.
- `docs/03-llm-provider-integration.md` §2.1–§2.3 (OpenAI), §3.1–§3.3 (Anthropic, incl. the
  `anthropic-version` header), §4.1–§4.3 (Gemini) and §5.1–§5.3 (OpenRouter) — the base URLs,
  auth-header shapes and minimal request bodies. **These sections own the request shapes; do
  not compose one from memory.** `docs/03` §5.2 also carries OpenRouter's attribution headers.
- `docs/09-security-privacy-and-api-keys.md` §2.1 "Never log a key" — the redaction rules that
  must hold from the very first request.
- `docs/00-overview.md` §3 D10 — the `User-Agent` and contact-address rules per host.
- `docs/00-overview.md` §3 D6 — the requirement to send `provider.data_collection: "deny"` on
  every OpenRouter request; `docs/09` §3.3 gives the reason (the API default is `"allow"`,
  which permits providers that store and train on the content) and the rest of the routing
  block.

**Files.**
- create `src/core/http/client.ts`
- create `src/core/http/userAgent.ts`
- create `scripts/spike-network.ts` (throwaway probe run from Tools → Developer → Run JavaScript)

**Do.**
1. Implement the minimal `HttpClient` facade over `Zotero.HTTP.request` from `docs/01` §8.2,
   with the D10 `User-Agent`, `anon: true`, an explicit `timeout`, and mapping of Zotero's
   exception classes to a typed error.
2. **Human gate.** Ask the human to run the probe themselves from Tools → Developer → Run
   JavaScript with their keys pasted into the console session only, or to supply keys for a
   one-off local run they then discard.
3. POST a minimal completion request to each of: OpenRouter, OpenAI, Gemini and Anthropic.
   Anthropic requires the `anthropic-version` header; Gemini and OpenAI/OpenRouter use
   different auth header shapes. **The exact endpoint paths, request bodies and header names
   are owned by `docs/03-llm-provider-integration.md`** — read the relevant provider section
   there rather than composing a request from memory.
4. POST (or GET, whichever the API supports) one literature API request — PubMed E-utilities is
   the Phase 1 target, so use that; parameters are owned by `docs/02` §3.
5. For each call record: status, whether custom headers arrived (echo endpoints or the
   provider's own error text will show a rejected header), full response received, and any
   Zotero-specific failure.
6. Send `provider.data_collection: "deny"` on the OpenRouter request — D6 requires it on every
   OpenRouter request and the API default is `"allow"`.
7. Write the five verdicts into the spike report. **If this spike fails, `docs/11` §4 says to
   stop and re-plan before Phase 1.**

**Do NOT.**
- Do not write any key to a preference. Decision D5 is absolute; `docs/01` §7.2 and `docs/09`
  §1.7 both state there is no code path that writes a key to a pref, and tier 4 does not exist.
- Do not write a key into `.env`, a fixture, a test file, or a commit. `docs/09` §2.1.
- Do not log the key, the `Authorization` header, or a request body containing one.
  `Zotero.debug()` output is routinely pasted into public forums (`docs/01` §12 gotcha 15).
- Do not bundle a provider SDK. R-13's mitigation is thin hand-rolled adapters
  (`docs/11` §3), and NFR-19 forbids remote script loading.
- Do not make the call from inside an XHTML dialog document. `docs/01` §8.3 warns you may
  re-enter a CORS-checked context; all network I/O lives in the privileged sandbox.
- Do not accept the default 30-second timeout for an LLM call — `docs/01` §12 gotcha 14 says
  completions routinely exceed it. Set `timeout` explicitly.
- Do not hardcode a model ID. `plan/README.md` §5 rule 4 and `docs/07` §8.5 both forbid it; use the
  seed default from the pref schema or the provider's live catalogue.

**Done when.**
- [ ] All four LLM providers returned a non-error completion with custom auth headers accepted,
      or the exact failure is recorded per provider.
- [ ] One literature-API request succeeded from inside the Zotero process.
- [ ] No key appears anywhere in the repository, in Debug Output, or in `.scaffold/logs/`
      (verified by grepping both).
- [ ] The five verdicts and the observed spend are recorded in the spike report.

**Verify with.**
Manual, then a grep gate:
1. Run the probe from Tools → Developer → Run JavaScript and capture the five status lines.
2. ```bash
   grep -rIn -E "sk-[A-Za-z0-9]|Bearer [A-Za-z0-9]" . --exclude-dir=node_modules \
     --exclude-dir=.git .scaffold/logs 2>/dev/null && echo "LEAK" && exit 1 || echo "clean"
   ```

**Notes.** `docs/11` §4's closing paragraph names `V-7` and `V-10` as the two spikes whose
failure stops the plan. `docs/01` §8.3 also carries a `> **Unverified:**` marker on the CSP
applied to plugin XHTML loaded via `chrome://` — this card sidesteps it by construction (all
I/O in the sandbox) and should say so in the spike report rather than claim it resolved.

---

### P0-T16 — Streaming (SSE) consumption from inside Zotero

| Field | Value |
|---|---|
| **ID** | `P0-T16` |
| **State** | `TODO` |
| **Depends on** | `P0-T15` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-8`, `R-14` |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-8`'s answer: are SSE streaming responses consumable inside Zotero — via `fetch`,
or via the XHR fallback — or cleanly not? This decides the trend-report UI design.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-8` — the assumption and its consequence for the
  report UI (R-14).
- `docs/01-zotero-plugin-platform.md` §8.4 — the evidence that `fetch` is in the sandbox's
  `wantGlobalProperties`, the reference async-generator SSE reader, and the three specific
  checks the section demands: is `res.body` a live `ReadableStream`, does `TextDecoderStream`
  exist, does `AbortController` actually abort the channel.
- `docs/01-zotero-plugin-platform.md` §8.4.1 — the XHR fallback and the three mechanics it
  requires (`responseType: "text"` mandatory, defusing the 30 s timeout from inside the
  progress handler, `e.target.response` being cumulative not a delta), plus the survey finding
  that 55 production calls use `Zotero.HTTP.request` against 2 uses of `fetch`.
- `docs/11-implementation-roadmap.md` §3 R-14 — the acceptable substitute if streaming is
  impractical: per-item progress and a determinate progress bar over reduction passes.

**Files.**
- create `src/llm/shared/sse.ts`
- modify `scripts/spike-network.ts`

**Do.**
1. In the plugin sandbox, run the three checks from `docs/01` §8.4 verbatim and record each
   yes/no: `res.body` is a live `ReadableStream`; `TextDecoderStream` exists; `AbortController`
   aborts the underlying channel.
2. If all three pass, implement the async-generator SSE reader from `docs/01` §8.4 and stream
   one short completion from one provider, printing deltas.
3. If any check fails, implement the XHR fallback from `docs/01` §8.4.1 with all three
   mechanics, and stream the same completion.
4. Record which path worked, and whether the design should build on `fetch` (cleaner, less
   production mileage) or XHR (55:2 in favour among established plugins).
5. Write `src/llm/shared/sse.ts` as the frame parser only — pure, no Zotero import — so it is
   unit-testable under `P0-T12`'s runner.

**Do NOT.**
- Do not use `responseType: "json"` on the XHR fallback — with `"json"` you cannot observe
  partial responses (`docs/01` §8.4.1).
- Do not re-parse the whole accumulated response on every progress tick. `docs/01` §8.4.1 names
  this as `zotero-gpt`'s O(n²) mistake; keep a `preLength` cursor and buffer the trailing
  partial line.
- Do not leave the 30-second default timeout in place on a stream — `docs/01` §8.4.1 gives the
  in-handler defusal (`if (e.target.timeout) e.target.timeout = 0;`).
- Do not put the SSE parser in `src/core/` or `src/model/` — `docs/07` §2.2 places it at
  `src/llm/shared/sse.ts`.
- Do not treat a failed stream as a blocked feature. `docs/01` §8.4's closing design
  implication: build the report generator so a non-streaming provider still produces the same
  output, without incremental rendering.

**Done when.**
- [ ] The three `docs/01` §8.4 checks are answered yes/no in the spike report.
- [ ] At least one provider's completion streamed incrementally, or the reason it cannot is
      recorded with the exact failure.
- [ ] `src/llm/shared/sse.ts` parses a recorded SSE frame sequence and passes a unit test with
      no Zotero import.
- [ ] The recommendation (`fetch` vs XHR) is written down with its reasoning.

**Verify with.**
```bash
npx vitest run --dir test/unit -t sse
```
plus the manual streaming observation from Tools → Developer → Run JavaScript.

**Notes.** `docs/01` §8.4's `> **Unverified — test this early, it is on the critical path.**`
marker is exactly this card. Whatever it finds also constrains `docs/08` §6.2's streaming
report preview, so record the answer in a form that section can be updated against.

This card carries no gate of its own: it reuses the session key entered for `P0-T15`. If a
fresh key entry is needed, escalate to `P0-T15`'s gate.

---

### P0-T17 — Request abortion

| Field | Value |
|---|---|
| **ID** | `P0-T17` |
| **State** | `TODO` |
| **Depends on** | `P0-T15` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-9` |
| **Implements** | part of `FR-10`, part of `FR-23`, part of `FR-42` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** `V-9`'s answer: does cancellation actually abort an in-flight request, so that Cancel
is real rather than cosmetic?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-9` — the assumption and the three requirements
  that depend on it (FR-10, FR-23, FR-42).
- `docs/01-zotero-plugin-platform.md` §8.1 — the `cancellerReceiver` option and
  `Zotero.HTTP.CancelledException`.
- `docs/01-zotero-plugin-platform.md` §8.2 — the wrapper's `cancellerReceiver` usage: store the
  returned function and call it on Cancel.
- `docs/01-zotero-plugin-platform.md` §10.3 — the cancellation section this wires into.
- `docs/07-architecture-and-data-model.md` §7.4 — the `CancellationToken` design the plugin
  will actually use, so the spike's finding lands in the right abstraction.

**Files.**
- modify `src/core/http/client.ts`
- modify `scripts/spike-network.ts`

**Do.**
1. Issue a long-running request (a large literature-API result set, or a streaming completion
   from `P0-T16`).
2. Abort it mid-flight via `cancellerReceiver`'s function, and separately via
   `AbortController.abort()` on the `fetch` path if `P0-T16` established `fetch` works.
3. Confirm the request genuinely stops: the promise rejects with
   `Zotero.HTTP.CancelledException` (or the fetch equivalent), and no further data arrives.
4. Record which mechanism works on which path.

**Do NOT.**
- Do not conflate "the UI stopped showing progress" with "the request aborted". `V-9` exists
  precisely to distinguish real cancellation from cosmetic cancellation.
- Do not swallow `Zotero.HTTP.CancelledException` as a generic error — `docs/07` §10.1's typed
  error hierarchy treats cancellation as a distinct outcome, not a failure.
- Do not build the cancellation abstraction here. `docs/07` §7.4 owns it; this card only proves
  the primitive works.

**Done when.**
- [ ] An in-flight request aborted via `cancellerReceiver` rejects with a cancellation
      exception and produces no further data.
- [ ] The `AbortController` path is answered yes/no (or n/a if `fetch` was ruled out in
      `P0-T16`).
- [ ] Both answers are in the spike report.

**Verify with.**
Manual, from Tools → Developer → Run JavaScript: start the request, call the canceller after
~200 ms, and confirm the rejection type and that no further progress callbacks fire.

**Notes.** `docs/11` §4.2 gives this a 0.25 d timebox — it is a confirmation, not a build.
`docs/11` §4's closing note lists `V-9` among the spikes that "are quick confirmations rather
than builds".

---

### P0-T18 — `getStructuredDocumentText` and IMRaD feasibility

| Field | Value |
|---|---|
| **ID** | `P0-T18` |
| **State** | `TODO` |
| **Depends on** | `P0-T08` |
| **Blocks** | `P0-T19`, `P0-T28` |
| **Retires** | `V-8b`, `R-19b` (feasibility half) |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — a human must supply five real PDFs (single-column publisher, two-column publisher, arXiv preprint, bioRxiv preprint, scanned) attached to items in the dev library. An agent cannot obtain publisher PDFs. |

**Goal.** `V-8b`'s answer: does `Zotero.PDFWorker.getStructuredDocumentText` expose usable
font/layout geometry, or does it not? Decision D7 put this on the critical path.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-8b` — the exact five-PDF protocol and the stated
  consequence: if geometry is unavailable, `auto` degrades to whole-document chunking and the
  summary prompt must drop section provenance.
- `docs/11-implementation-roadmap.md` §3 R-19b — why a mis-labelled section is worse than an
  unlabelled one, and the owner decision required if the spike fails.
- `docs/06-summarization-and-trend-report.md` §3.3.5 — the verified `getFullText` contract, the
  `getStructuredDocumentText(itemID, { isPriority, password, onProgress })` signature returning
  `Promise<Object|null>`, and the `> **Unverified:**` marker on its serialization (packed via
  `packStructuredDocumentText`) — this card decodes it.
- `docs/06-summarization-and-trend-report.md` §4.3 — the IMRaD segmentation this geometry would
  improve, and the regex heading detector it would replace.
- `docs/00-overview.md` §3 D7 — why full text is the default and what that decision costs
  (≈ 8× typical, up to ~32× with chunking).

**Files.**
- create `scripts/spike-structured-text.ts`
- create `test/fixtures/pdf/README.md` (an index of the five supplied PDFs, no PDFs committed).
  `docs/07` §2.2 declares `test/fixtures/` with one directory per `SourceId` plus `llm/`; `pdf/`
  is this card's addition and is a *manifest* directory, not a recorded-response one — say so in
  the README so a later reader does not mistake it for a fixture set. It is also where R-19b's
  40-PDF Phase 3 corpus will be indexed.

**Do.**
1. **Human gate.** Ask the human to attach the five PDFs to items in the dev library and report
   their item IDs, plus a note on each one's layout class.
2. For each of the five, call `Zotero.PDFWorker.getStructuredDocumentText(itemID, {})` and dump
   the returned object's shape: top-level keys, nesting, and — critically — whether any
   per-character or per-run entry carries font size, font weight, font name, or bounding-box
   coordinates.
3. Also call `getFullText(itemID, null)` on each and record `extractedPages` / `totalPages`, so
   the two APIs can be compared on the same documents.
4. Answer the binary question: **is font/layout geometry available?** Then answer the practical
   one: on the two-column publisher PDF, does the geometry make column order recoverable?
5. On the scanned PDF, record what both APIs return — `docs/11` R-19 says never OCR in v1, so
   "returns nothing usable" is the expected and acceptable answer.
6. Write the verdict plus the decoded object shape into the spike report. If geometry is
   **not** available, escalate the R-19b owner decision (ship whole-document chunking, or flip
   the default back to abstracts) through `P0-T28`.

**Do NOT.**
- Do not commit the PDFs. They are publisher content; `docs/09` §4.4 covers licensing and
  redistribution of publisher content.
- Do not call `Zotero.Fulltext.indexItems([id])` to force indexing. `docs/06` §3.3 (the
  paragraph before §3.3.5) forbids it: it mutates the user's library and index as a side effect
  of running a report.
- Do not call `Zotero.Fulltext.getItemContent` — it **does not exist** (`docs/06` §3.3.1). And
  do not call `setItemContent`, which is the sync **download** path, not a reader.
- Do not read `fulltextWords` / `fulltextItemWords` — removed in Zotero 10's FTS5 rewrite, and
  they were a word-ID inverted index that cannot reconstruct text anyway
  (`docs/06` §3.3.1, `docs/07` §1.1 fact 3).
- Do not touch `zotero.sqlite` directly. `docs/07` §1.1 fact 2 makes this an architectural
  rule, reinforced by WAL mode in Zotero 10.
- Do not reach for `Zotero.Fulltext.semanticSplitter` — `docs/06` §3.3.6 names it explicitly as
  a trap: it is a search-index tokenizer returning a deduplicated bag of lowercase words.
- Do not build the IMRaD detector here. This card answers feasibility only; R-19b's 40-PDF
  accuracy measurement is a Phase 3 gate (`docs/11` §3.1).

**Done when.**
- [ ] The returned object's shape is documented for at least one PDF, with the exact key path
      to any font-size/weight/coordinate data, or a statement that none exists.
- [ ] All five layout classes have a recorded result, including "null/unusable" where that is
      the answer.
- [ ] A yes/no verdict on font geometry is written in the spike report.
- [ ] If the verdict is no, the R-19b owner decision is raised in `P0-T28` rather than resolved
      unilaterally.

**Verify with.**
Manual, from Tools → Developer → Run JavaScript:
```js
const o = await Zotero.PDFWorker.getStructuredDocumentText(ITEM_ID, {});
Zotero.debug(JSON.stringify(Object.keys(o ?? {})));
```
then inspect one nested entry for geometry fields.

**Notes.** `docs/06` §3.3.5 now labels this "Also available, and **on the v1 critical path** —
this is not an optional extra", names D7 as the cause, and records that an earlier draft's
"not used in v1" phrasing was wrong. `docs/06` §16 item 2 (open questions) and `docs/11` §4.2
agree: this is a **required** Phase 0 spike. There is no longer a corpus disagreement to flag
here — what the spike report records is the decoded object shape and the yes/no verdict.

---

### P0-T19 — Read Zotero's existing full-text index from a plugin

| Field | Value |
|---|---|
| **ID** | `P0-T19` |
| **State** | `TODO` |
| **Depends on** | `P0-T18` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-15`, part of `R-19` |
| **Implements** | none |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `V-15`'s answer: can a plugin read Zotero's existing full-text for an item with a PDF
attachment, and is its quality adequate? A yes avoids bundling a PDF parser entirely
(NFR-18, NFR-19).

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-15` — the assumption and the scope saving a yes
  buys.
- `docs/06-summarization-and-trend-report.md` §3.3.2 — the verified answer that **yes**, a
  plugin can, and the instruction to use `item.attachmentText` rather than reading
  `.zotero-ft-cache` yourself, with the full accessor source.
- `docs/06-summarization-and-trend-report.md` §3.3.5 — the `getFullText` return contract and
  **design decision D-06-4**: `\f` is a hard page boundary, `\n` a paragraph boundary,
  guaranteed by the extractor, not guessed.
- `docs/06-summarization-and-trend-report.md` §3.1 — the priority ladder (abstract → PDF text →
  Europe PMC JATS → metadata only), so the spike measures the right tier.
- `docs/11-implementation-roadmap.md` §3 R-19 — the quality gate this feeds: minimum character
  count, alphabetic-character ratio, detected-language check, and never OCR in v1.

**Files.**
- create `src/zotero/fulltext.ts`
- modify `scripts/spike-structured-text.ts`

**Do.**
1. For each of the five `P0-T18` PDFs, call `await item.attachmentText` on the attachment and
   record: character count, whether `\f` page delimiters are present, whether paragraphs are
   flowing rather than hard-wrapped, and the alphabetic-character ratio.
2. Record `Zotero.Fulltext.getIndexedState(item)` for each, and confirm that reading
   `attachmentText` on an unindexed item extracts on demand **without persisting anything**.
3. Compare `attachmentText` output against a direct `Zotero.PDFWorker.getFullText(id, null)`
   call on the same item, and record whether they differ.
4. Apply the R-19 quality gate criteria to each result and record pass/fail, especially for the
   two-column and scanned PDFs.
5. Write `src/zotero/fulltext.ts` as the thin accessor — no parsing, no chunking; that is
   Phase 3.
6. Record the verdict: is Zotero's own index adequate, so no PDF parser is bundled?

**Do NOT.**
- Do not read `.zotero-ft-cache` directly. `docs/06` §3.3.2 is explicit: "you should not read
  that file yourself" — `item.attachmentText` does the whole ladder correctly.
- Do not force indexing (`Zotero.Fulltext.indexItems`) — same reason as `P0-T18`.
- Do not OCR, and do not add an OCR dependency. `docs/11` R-19: "Never OCR in v1."
- Do not run a generic "detect paragraphs by blank line" heuristic over the text — D-06-4 says
  it is already structured and the heuristic will fight the extractor (`docs/06` §3.3.5).
- Do not bundle a PDF parsing library on the strength of one bad result. NFR-18's 3 MB ceiling
  and NFR-19's dependency-hygiene rule both bear on this; a negative finding is an owner
  decision, not an implementer's shortcut.

**Done when.**
- [ ] Character count, `\f` presence, and alphabetic ratio are recorded for all five PDFs.
- [ ] The `attachmentText` vs `getFullText` comparison is recorded.
- [ ] A yes/no verdict on "Zotero's index is adequate; no bundled parser needed" is in the
      spike report.
- [ ] `src/zotero/fulltext.ts` typechecks and contains no parsing logic.

**Verify with.**
```bash
npm run typecheck
```
plus the manual per-PDF measurements from Tools → Developer → Run JavaScript.

**Notes.** `docs/13` §2.1's `> **Unverified:**` marker on `Zotero.Item` construction and
`Zotero.DB.executeTransaction` signatures is adjacent to this work; if the observations here
contradict the Vitest fake, fix the fake (`P0-T12`) rather than the observation.

This card carries no gate of its own: it reuses the PDFs supplied for `P0-T18`, whose gate
already put the human in the loop. If fresh PDFs are needed, escalate to `P0-T18`'s gate.

---

### P0-T20 — Create 100 Zotero items in one transaction within NFR-1

| Field | Value |
|---|---|
| **ID** | `P0-T20` |
| **State** | `TODO` |
| **Depends on** | `P0-T10` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-12`, part of `R-16` |
| **Implements** | `NFR-1` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-12`'s answer: does creating 100 Zotero items in a batch meet NFR-1's ≤ 10 s
budget without freezing the UI, using transactions?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-12` — the assumption and the consequence
  ("determines whether an entirely different write strategy is needed").
- `docs/10-requirements-and-user-stories.md` NFR-1 — the exact budget (≤ 10 s, target ≤ 6 s),
  the measurement definition ("from user clicks Import to collection contains 100 items", all
  network pre-fetched), and the stated hardware baseline.
- `docs/10-requirements-and-user-stories.md` NFR-3 — the ≤ 100 ms main-thread rule this must
  not violate while hitting the throughput number.
- `docs/01-zotero-plugin-platform.md` §5.8 — the batch pattern, `save()` vs `saveTx()`, the
  50-transactions-is-slow warning, and the WAL note.
- `docs/11-implementation-roadmap.md` §3 R-16 — the fallback if it is slow: chunk into groups
  of 25 with progress, defer collection-tree updates.

**Files.**
- create `test/integration/zotero/batchImport.spec.ts`
- modify `src/zotero/collectionOps.ts`

**Do.**
1. Generate 100 synthetic `journalArticle` records in memory (no network) with title, one
   author, DOI and abstract.
2. Write them in a single `Zotero.DB.executeTransaction` using `item.save()`, into one
   collection.
3. Time the whole operation from first write to the collection reporting 100 children.
4. Observe UI responsiveness during the write — does the Zotero window stay interactive?
   Record any freeze longer than NFR-3's 100 ms.
5. If over budget, retry with chunks of 25 (R-16's mitigation) and record both numbers.
6. Encode the measurement as `test/integration/zotero/batchImport.spec.ts` with the generous
   CI multiplier `docs/13` §2.3 prescribes ("asserted with a generous multiplier in CI,
   tightened locally").

**Do NOT.**
- Do not call `saveTx()` inside the transaction (`docs/01` §12 gotcha 12).
- Do not `await` any network I/O inside the transaction — Zotero's DB is single-writer and
  holding a transaction across a round-trip stalls the application (`docs/01` §12 gotcha 13).
- Do not use raw SQL via `Zotero.DB.queryAsync` to speed this up. `docs/01` §5.8 and `docs/07`
  §1.1 fact 2 both forbid touching the schema directly.
- Do not refresh the collection tree per item; defer it until the batch completes
  (`docs/11` R-16).
- Do not "pass" NFR-1 by writing fewer than 100 items or by excluding the collection
  membership write from the timing.

**Done when.**
- [ ] 100 items are created in one transaction and the elapsed time is recorded.
- [ ] The result is compared to NFR-1's 10 s ceiling and 6 s target, with a pass/fail verdict.
- [ ] Any UI freeze longer than 100 ms is recorded (NFR-3).
- [ ] `test/integration/zotero/batchImport.spec.ts` passes under `npm run test:integration`.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** This card also settles `docs/13` §2.1's `> **Unverified:**` marker on
`Zotero.DB.executeTransaction` and `Zotero.Item` construction shapes — reconcile the Vitest
fake against what is observed here, because "a fake that lies is worse than no fake".

---

### P0-T21 — Measure abstract availability across the seven sources

| Field | Value |
|---|---|
| **ID** | `P0-T21` |
| **State** | `TODO` |
| **Depends on** | `P0-T08` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-13`, part of `R-17` |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-13`'s answer: for one realistic biomedical query, what fraction of records from
each source carries an abstract? This drives Phase 2's source-priority and backfill design and
sets the realistic ceiling on summary quality.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-13` — the assumption, and the two things the
  measurement drives.
- `docs/11-implementation-roadmap.md` §3 R-17 — likelihood **High**: Crossref in particular
  often lacks abstracts; the mitigation (source priority, DOI backfill, coverage percentage in
  the import summary) is what this measurement calibrates.
- `docs/00-overview.md` §3 D2 — the seven v1 sources, so none is silently skipped.
- `docs/00-overview.md` §3 D10 — the `User-Agent` and per-host contact rules every request here
  must carry.
- `docs/02-literature-database-apis.md` §5.4 "Abstracts — the big caveat" — the Crossref
  specifics, so the measured number is interpreted rather than merely reported.
- `docs/02-literature-database-apis.md` §2.2 — the per-host `User-Agent` / `mailto` / `tool` /
  `email` table; get these right or the measurement is impolite as well as inaccurate.

**Files.**
- create `scripts/spike-abstract-coverage.ts`

**Do.**
1. Pick one realistic biomedical query and fix it for the whole measurement (record it — the
   number is meaningless without the query).
2. For each of PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and medRxiv,
   fetch up to 100 records for that query using each source's documented endpoint and
   parameters from `docs/02`.
3. Count, per source: records returned, records with a non-empty abstract, and the percentage.
4. Record the shape each source uses for the abstract (plain text, JATS, HTML), because
   `docs/13` §2.1 lists JATS/HTML abstract stripping as a normalizer concern.
5. Record the overlap: how many records lacking an abstract in one source have one in another,
   keyed by DOI. That is the backfill opportunity R-17's mitigation depends on.
6. Send every request with the D10-correct `User-Agent`, NCBI `tool`/`email`, and Crossref
   `mailto`.

**Do NOT.**
- Do not run this at high concurrency. NCBI is 3 req/s without a key
  (`docs/01` §8.5, `docs/02` §3.1); exceeding it is a terms violation, not just rudeness.
- Do not send the **user's** address to NCBI. D10: NCBI always receives the maintainer address,
  because NBK25497 requires the developer's address "and not that of a third-party end user".
- Do not attempt to fix a low coverage number by scraping publisher pages. `docs/09` §3.4 and
  `docs/07` §1.1 fact 5 both point away from fetching publisher pages by default.
- Do not build the normalizers here. This card measures; `docs/07` §2.2's
  `src/sources/*/mapper.ts` files are Phase 1 and Phase 2 work.
- Do not treat a Semantic Scholar 429 as a coverage finding — it is `P0-T22`'s subject; record
  it separately.

**Done when.**
- [ ] A per-source table exists with: records returned, records with abstracts, percentage, and
      abstract format.
- [ ] The query used is recorded verbatim alongside the table.
- [ ] The DOI-keyed cross-source backfill opportunity is quantified.
- [ ] Every request carried the D10-correct identification.

**Verify with.**
```bash
npx tsx scripts/spike-abstract-coverage.ts
```
(the script prints the table; it runs in Node, not in Zotero, because no Zotero API is needed —
record in the spike report whether it was also re-run inside Zotero via the `P0-T15` client.)

**Notes.** `docs/11` §4.3 gives `V-13` a 0.5 d timebox. The measurement's value depends
entirely on the query being realistic and recorded; a synthetic query produces a number nobody
can act on.

This card carries no gate: all seven sources in scope here are free and keyless for a single
small query (Semantic Scholar's throttling is `P0-T22`'s subject).

---

### P0-T22 — Measure S2 throttling and submit the key application

| Field | Value |
|---|---|
| **ID** | `P0-T22` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P0-T28` |
| **Retires** | `V-14`, starts the clock on `R-3` |
| **Implements** | none |
| **Estimate** | 0.25 d + external wait |
| **Human gate** | **Yes** — the key application is a web form requiring the human's own identity and contact details. An agent must not fill it in. |

**Goal.** `V-14`'s answer: what does unauthenticated Semantic Scholar access actually do, and
— the part that matters for scheduling — the key application is **submitted**, so its
multi-week approval lead time runs in parallel with Phases 1–4 rather than blocking Phase 5.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-14` — the assumption and the explicit rationale:
  "the key's lead time starts now rather than in Phase 5".
- `docs/11-implementation-roadmap.md` §3 R-3 — likelihood **High**: "Apply for the key in
  **week 1** of Phase 0, before it is needed in Phase 5", plus the degradation design (Crossref
  references + Europe PMC citations + lexical similarity with zero S2 calls).
- `docs/02-literature-database-apis.md` §6.4 — the auth/rate-limit table, the form URL, and the
  live 2026-09-08 evidence (HTTP 429 on first attempt, again after 8 s, again after 20 s), plus
  the four design decisions it forces.
- `docs/09-security-privacy-and-api-keys.md` §5.3 — Semantic Scholar's terms, so the
  application is made under terms we have actually read.
- `docs/00-overview.md` §3 D5 — where the key goes once it arrives: `SecretId`
  `source.semanticscholar` in the keystore, never a pref.

**Files.**
- create `scripts/spike-s2-throttle.ts`

**Do.**
1. **Human gate, day 1.** Ask the human to submit the Semantic Scholar API key application at
   the form linked from `docs/02` §6.4, and to record the submission date. Nothing else in this
   card blocks on the reply.
2. Independently, measure unauthenticated behaviour: issue a small series of
   `/paper/search` requests, record status codes, the exact error body shape, and the observed
   recovery pattern. Compare against the 2026-09-08 evidence in `docs/02` §6.4 to see whether
   the shared anonymous pool behaves the same today.
3. Record the observed error shape verbatim — Phase 2's typed error mapping needs it.
4. Record the submission date and the expected wait in `plan/06-human-gates.md`'s terms (that
   file does not exist yet; record it in the spike report and flag it for the human-gates
   register).

**Do NOT.**
- Do not fill in the application form yourself. It carries the human's identity and contact
  details; entering personal data into a form is a human action.
- Do not hammer the unauthenticated endpoint to "get better data". `docs/02` §6.4 already
  documents the behaviour; a handful of requests suffices, and abusing a shared anonymous pool
  harms every other user of it.
- Do not design any feature to require a Semantic Scholar key. `docs/11` R-3: treat it as an
  enhancer, never a hard dependency.
- Do not store the key, when it arrives, in a preference — `SecretId`
  `source.semanticscholar` goes in the keystore (D5, `docs/09` §1.7).
- Do not block Phase 0 completion on the key arriving. The deliverable is the **submission**
  plus the measurement.

**Done when.**
- [ ] The key application is submitted and the submission date is recorded.
- [ ] Observed unauthenticated status codes and the verbatim error body are recorded.
- [ ] Whether today's behaviour matches `docs/02` §6.4's 2026-09-08 evidence is stated.
- [ ] The pending approval is registered as an open human gate for Phase 5.

**Verify with.**
```bash
npx tsx scripts/spike-s2-throttle.ts
```
plus the human's confirmation of the submission date.

**Notes.** This is the one card in Phase 0 with a dependency of `none` **by design**: `docs/11`
R-3 makes it a week-1 action and the whole point is that its external wait overlaps the rest of
the plan. It needs no plugin and no Zotero — plain HTTP is sufficient, which is how `docs/02`
§6.4's own evidence was gathered.

---

### P0-T23 — OS keystore and preference round-trip

| Field | Value |
|---|---|
| **ID** | `P0-T23` |
| **State** | `TODO` |
| **Depends on** | `P0-T08` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-16`, part of `R-9` |
| **Implements** | `FR-30`, `NFR-16` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-16`'s answer: does an API-key-shaped string round-trip through
`Zotero.OSKeyStore.encrypt()` → `Services.logins.addLoginAsync` → search → decrypt on Windows,
what happens when the keystore is unavailable, and do non-secret preferences round-trip
cheaply?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-16` — the exact round-trip to perform, the
  Linux-without-libsecret question, and the consequence: "decision D5 forbids preference
  storage for keys, so the keystore path is the *only* path".
- `docs/09-security-privacy-and-api-keys.md` §1.3 — that `encrypt()` and `decrypt()` are
  **both async**, the `oskv1:` prefix, the `available` getter, and the implementer note that
  the startup probe should be a real round-trip rather than a flag read.
- `docs/09-security-privacy-and-api-keys.md` §1.7 — the three-tier design, the exact
  `LOGIN_ORIGIN` / `LOGIN_REALM` constants, the `SecretId` union, and the `setTier1`
  implementation to mirror.
- `docs/00-overview.md` §3 D5 — the binding decision, and that there is no tier 4.
- `docs/07-architecture-and-data-model.md` §8.5 — the preference schema, which owns every key,
  type and default; the `*.keyPresent` booleans are prefs, the keys are not.
- `docs/01-zotero-plugin-platform.md` §7.1 — `Zotero.Prefs.get/set/clear` and the
  `registerObserver` signature returning a Symbol for `unregisterObserver`.

**Files.**
- create `src/zotero/keychain.ts`
- create `src/zotero/prefStore.ts`
- create `test/integration/zotero/secrets.spec.ts`

**Do.**
1. Implement tier 1 of `docs/09` §1.7 exactly: encrypt, store as the `password` of an
   `nsILoginInfo` under origin `chrome://research-helper` and realm
   `research_helper API Keys (encrypted)`, with the `SecretId` as the username.
2. Round-trip a synthetic key-shaped string (`sk-` + random) and assert equality after decrypt.
3. Implement `has()` as a cheap existence check that never decrypts (`docs/09` §1.7).
4. Implement the startup probe as a real encrypt/decrypt of a throwaway value, not a read of
   the `available` getter.
5. Round-trip a non-secret preference through `Zotero.Prefs` under the
   `extensions.zotero.research-helper.` branch and measure the cost of a read in a tight loop
   (`V-16`'s second half).
6. Record what happens if the keystore is unavailable — on Windows this may not be reproducible;
   record it as "not reachable on this machine" rather than guessing, and note that the
   Linux-without-libsecret behaviour remains the open product decision named in `docs/11` §5.
7. Write `test/integration/zotero/secrets.spec.ts` asserting the round-trip **and** that no
   preference under the plugin's branch contains the test value.

**Do NOT.**
- Do not use a real API key for this test. A synthetic string proves the mechanism.
- Do not write any key to a preference, in any tier, ever. D5; `docs/09` §1.7 tier 4 is "Not
  implemented" and adding it "guarantees it becomes the common case".
- Do not log the value, encrypted or decrypted (`docs/09` §2.1, `docs/01` §12 gotcha 15).
- Do not forget that `encrypt()`/`decrypt()` are async — `docs/09` §1.3 flags this explicitly.
- Do not call `ensureLoggedIn()` or `hasCredentials()` on `Zotero.OSKeyStore`; `docs/09` §1.3
  verified they are not re-exported, and the `hasCredentials()` that exists belongs to
  `Zotero.Sync.Data.Local` and is unrelated.
- Do not assume `encrypt()` always succeeds (`docs/09` §1.3).
- Do not restate any preference default here — `docs/07` §8.5 owns them
  (`plan/README.md` §5 rule 3).
- Do not build tier 2 or tier 3 in Phase 0. Only the probe and tier 1 are in scope; the tier
  ladder ships in Phase 3.

**Done when.**
- [ ] A synthetic key-shaped string round-trips through encrypt → store → search → decrypt and
      compares equal.
- [ ] `has()` returns true without decrypting.
- [ ] The startup probe is a real round-trip and returns a tier verdict.
- [ ] A non-secret preference round-trips under `extensions.zotero.research-helper.` and the
      hot-loop read cost is recorded.
- [ ] `test/integration/zotero/secrets.spec.ts` passes, including its assertion that no pref
      holds the test value.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/11` §5 lists "the Linux-without-libsecret behaviour" as still open before
Phase 0 ends, with `V-16` as the measurement. On a Windows-only dev machine that measurement
cannot be completed; record it as **blocked pending a Linux environment** in the spike report
rather than claiming a result. `docs/01` §7.2 also carries a `> **Unverified:**` marker on
whether Zotero syncs plugin prefs — if the round-trip work makes that cheap to check, answer it
here; if not, leave it marked.

This card carries no gate: the keystore round-trip uses a synthetic API-key-shaped string,
never a real key.

---

### P0-T24 — Fluent localization with an `en-US` and `ko-KR` bundle

| Field | Value |
|---|---|
| **ID** | `P0-T24` |
| **State** | `TODO` |
| **Depends on** | `P0-T08`, `P0-T10` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-17`, part of `R-22` |
| **Implements** | `FR-55`, `NFR-11` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-17`'s answer: does Fluent localization work for plugin strings on Zotero 10,
including a `ko-KR` bundle, with English fallback for a missing key?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-17` — the assumption, including the note that
  Zotero 10 changed FTL registration ("plugin FTL registration consolidated with proper
  per-locale fallback").
- `docs/01-zotero-plugin-platform.md` §9.1 — the directory layout, that Korean is a supported
  Zotero UI locale, and that there is **no manual registration call**: "Just ship the
  directory."
- `docs/01-zotero-plugin-platform.md` §9.2 — `data-l10n-id`,
  `MozXULElement.insertFTLIfNeeded`, and the `> **Unverified:**` marker on which `Localization`
  argument form to use for a plugin's own files.
- `docs/01-zotero-plugin-platform.md` §9.3 — the two namespace rules: Fluent identifiers and
  filenames are **global** namespaces; a collision silently shadows.
- `docs/01-zotero-plugin-platform.md` §4.5 "Build pipeline (ordered)" — scaffold auto-prefixes
  `.ftl` filenames *and* message IDs with `${namespace}-`, so source IDs do not match shipped
  IDs.
- `docs/01-zotero-plugin-platform.md` §9.4 — the three independent language settings (UI,
  report, TTS) that must not be conflated.

**Files.**
- modify `addon/locale/en-US/research-helper/mainWindow.ftl` (created by `P0-T10` for the
  Tools-menu label)
- create `addon/locale/ko-KR/research-helper/mainWindow.ftl`
- create `src/i18n/ftl.ts`
- create `test/integration/l10n.spec.ts`

**Do.**
1. Create both locale directories with a `mainWindow.ftl` containing the same two keys, one of
   which is deliberately **absent** from `ko-KR` so fallback can be observed.
2. Prefix every identifier with `research-helper-` and keep every file under
   `locale/<lang>/research-helper/`.
3. Bind the `P0-T10` Tools-menu label to a `data-l10n-id` (or `l10nID` in the
   `Zotero.MenuManager.registerMenu` menu descriptor) and confirm it renders.
4. Switch the dev profile's Zotero UI locale to Korean and confirm the localized key renders in
   Korean and the missing key falls back to English rather than showing the raw ID.
5. Resolve `docs/01` §9.2's open question by reading the template's `src/utils/locale.ts` and
   recording which `Localization` argument form actually works.
6. Write `test/integration/l10n.spec.ts` asserting a known `ko-KR` key resolves and a missing
   key falls back (`docs/13` §2.3's L10n row).

**Do NOT.**
- Do not ship an unprefixed Fluent identifier or filename. `docs/01` §9.3 and §12 gotcha 16:
  unprefixed IDs silently shadow Zotero's own, and a collision does not error.
- Do not add a manual FTL registration call — `docs/01` §9.1: "There is no manual registration
  call."
- Do not use `Zotero.getString()` for plugin strings: it throws on an unknown key when the
  locale is `en-US`, and plugin `.ftl` files are registered into `L10nRegistry`, not into
  `getString`'s synchronous bundle (`docs/01` §12 gotcha 26).
- Do not be surprised that source IDs differ from shipped IDs — scaffold prefixes them at build
  time (`docs/01` §4.5). Know which you are looking at when debugging.
- Do not derive the **report** language from `Zotero.locale`. `docs/01` §9.4: a Korean-locale
  user reading English papers frequently wants an English report; that is the `reportLanguage`
  pref, whose default `docs/07` §8.5 owns.
- Do not add the `check-l10n.mjs` CI gate as blocking. `docs/11` R-22 makes it warn-only until
  Phase 7.

**Done when.**
- [ ] Both `en-US` and `ko-KR` bundles exist under `locale/<lang>/research-helper/` with
      `research-helper-`-prefixed IDs.
- [ ] The Tools-menu label renders from Fluent in `en-US`.
- [ ] With the UI locale set to Korean, the localized key renders in Korean.
- [ ] The key deliberately missing from `ko-KR` falls back to English, not to a raw ID.
- [ ] `test/integration/l10n.spec.ts` passes.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish --abort-on-fail
```
plus the manual locale switch in the dev profile.

**Notes.** `docs/01` §9.2's `> **Unverified:**` marker (which `Localization` argument form, and
whether the sync flag is safe) is closed by step 5. `docs/11` §4.3's note about Zotero 10's
consolidated FTL registration is the reason this is a spike at all rather than assumed working.

---

### P0-T25 — Gemini TTS Korean quality spike

| Field | Value |
|---|---|
| **ID** | `P0-T25` |
| **State** | `TODO` |
| **Depends on** | `P0-T15` |
| **Blocks** | `P0-T26`, `P0-T28` |
| **Retires** | `V-10`, `R-8` |
| **Implements** | none |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — twice over: it spends money on the Gemini API, and the quality verdict must come from a **native Korean speaker**, which no agent can supply. |

**Goal.** `V-10`'s answer: does Gemini TTS return acceptable audio for a 200-word **Korean**
script containing embedded English technical terms, judged by a native speaker? If Korean
quality is poor, Feature 5's headline value evaporates and the provider decision changes.

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-10` — the exact protocol (200-word Korean script,
  embedded English terms, native-speaker judgement) and the stakes.
- `docs/11-implementation-roadmap.md` §3 R-8 — the mitigation being validated, including the
  instruction to spike this in **Phase 0, not Phase 6**, and the FR-43 text fallback that ships
  from day one regardless.
- `docs/04-audio-report-tts.md` §2.2 — the model IDs, all carrying `-preview`, and the explicit
  instruction: **do not hardcode**; fetch `GET /v1beta/models` and filter.
- `docs/04-audio-report-tts.md` §2.8 — Korean is confirmed supported, the same 30 voices work
  across languages, there is no `language` parameter on the legacy `generateContent` path, and
  mixed Korean/English text is the named risk.
- `docs/04-audio-report-tts.md` §2.9 — prosody is prompt-controlled: no `speed`/`pitch`/`rate`
  parameter and **SSML is not supported**; the style instruction must include an explicit "do
  not add commentary" clause.
- `docs/04-audio-report-tts.md` §3.1 — the exact return format: 16-bit signed LE PCM, 24 kHz,
  mono, no container, base64 in `candidates[0].content.parts[0].inlineData.data`.
- `docs/07-architecture-and-data-model.md` §8.5 — the `tts.voice` and `tts.model` rows;
  `tts.model` ships **empty on purpose**.

**Files.**
- create `scripts/spike-tts-korean.ts`
- create `src/tts/types.ts`

**Do.**
1. **Human gate.** Obtain the human's consent to spend, their Gemini key for a session-only
   run, and their commitment to judge (or to route to) a native Korean speaker.
2. Fetch `GET /v1beta/models` and select a TTS model from the live list rather than a
   hardcoded ID.
3. Write a ~200-word Korean script containing at least five embedded English technical terms of
   the kind an academic report actually carries.
4. Prepend a short (< 60 token) style instruction per `docs/04` §2.9, with an explicit "do not
   add commentary" clause and a clear delimiter.
5. Send it, decode the base64 PCM, and confirm the returned `mimeType` matches `docs/04`
   §3.1's expectation.
6. Have a native speaker judge: is the Korean prosody natural, are the English terms
   intelligible, does the accent switch mid-sentence, and is the whole acceptable for an
   academic briefing?
7. Record the verdict, the model ID used, the observed cost, and — if quality is poor — raise
   the provider-decision question through `P0-T28`.

**Do NOT.**
- Do not hardcode a TTS model ID anywhere but the last-resort fallback (`docs/04` §2.2), and
  never outside `prefs.js` (`docs/07` §8.5, `plan/README.md` §5 rule 4).
- Do not send SSML — it will be read aloud (`docs/04` §2.9).
- Do not look for a `speed`, `pitch` or `rate` parameter; there is none (`docs/04` §2.9).
- Do not expect a `language` parameter on the legacy `generateContent` path — there is none
  (`docs/04` §2.8).
- Do not write the Gemini key to a pref or a file (D5), and do not log it
  (`docs/09` §2.1).
- Do not judge Korean quality yourself. `docs/11` §4.2 requires a native speaker; an agent's
  opinion is not the deliverable.
- Do not build the chunking, concatenation or attachment pipeline here — `docs/04` §§5–6 are
  Phase 6, and `P0-T26` covers only the binary-handling primitive.

**Done when.**
- [ ] A Korean script with embedded English terms was synthesized and the audio bytes were
      received.
- [ ] The returned `mimeType`, sample rate, channel count and bit depth are recorded and match
      (or do not match) `docs/04` §3.1.
- [ ] A native speaker's verdict is recorded in the speaker's own words, not paraphrased into a
      pass.
- [ ] The model ID used and the observed spend are recorded.
- [ ] If the verdict is negative, the R-8 provider question is raised for the owner.

**Verify with.**
Manual: run the spike script under the human's supervision, play the resulting audio, and
capture the native speaker's written verdict into the spike report.

**Notes.** `docs/11` §4's closing paragraph names `V-10` alongside `V-7` as a spike whose
failure means "stop and re-plan before Phase 1". The FR-43 fallback (save the spoken script as
text) ships regardless of the outcome, so a negative verdict degrades Feature 5 rather than
deleting it.

---

### P0-T26 — Binary/audio response handling and attachment

| Field | Value |
|---|---|
| **ID** | `P0-T26` |
| **State** | `TODO` |
| **Depends on** | `P0-T25` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-11` |
| **Implements** | part of `FR-40` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `V-11`'s answer: does binary/audio response handling work inside Zotero — an
`arraybuffer` response type, writing a file into the storage directory, and registering it as
an attachment that opens?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.2 `V-11` — the assumption and the consequence:
  "Text-only HTTP would block the audio feature entirely."
- `docs/01-zotero-plugin-platform.md` §8.4.1 — the parenthetical that `Zotero.HTTP.request`
  does **not** whitelist `responseType`; it assigns straight onto the XHR, so `arraybuffer`
  and `blob` work, and "that matters for the TTS audio path".
- `docs/04-audio-report-tts.md` §3.1 — what Gemini returns (raw PCM, no container).
- `docs/04-audio-report-tts.md` §3.2–§3.3 — that you must add the WAV container yourself on the
  legacy path, and the dependency-free WAV header writer.
- `docs/01-zotero-plugin-platform.md` §5.6 — the attachment APIs, and `docs/01` §12 gotcha 20:
  `Zotero.Attachments.importEmbeddedItems` does not exist; it is `importEmbeddedImage`.
- `docs/07-architecture-and-data-model.md` §8.4 — plugin-owned files go in the **data**
  directory, resolved via `Zotero.DataDirectory.dir`, never hardcoded.

**Files.**
- create `src/tts/audioStore.ts`
- create `test/integration/zotero/attachments.spec.ts`

**Do.**
1. Confirm an `arraybuffer` response type works through `Zotero.HTTP.request` (or capture the
   bytes via the `P0-T25` path, whichever the network spike established).
2. Wrap the raw 24 kHz mono 16-bit PCM in a WAV container using `docs/04` §3.3's header writer.
3. Write the file under a plugin-owned path derived from `Zotero.DataDirectory.dir`.
4. Attach it to a Zotero item and confirm it opens from the item pane and plays.
5. Record whether WAV is linked or imported, per `docs/04` §10.2's distinction, and which the
   spike used.
6. Write `test/integration/zotero/attachments.spec.ts` asserting the file is written and the
   attachment exists (`docs/13` §2.3's Attachments row).

**Do NOT.**
- Do not hardcode the data-directory path. `docs/07` §8.4: the data directory is
  user-relocatable; use `Zotero.DataDirectory.dir`.
- Do not put the audio in the **profile** directory. `docs/07` §8.4: the tier-3 secrets file is
  the single deliberate exception, and audio is not it.
- Do not call `Zotero.Attachments.importEmbeddedItems` — it does not exist
  (`docs/01` §12 gotcha 20). Do not invent API names; grep the source.
- Do not set an `attachmentFilename` or `attachmentPath` containing slashes — Zotero 10 throws
  (`docs/01` §12 gotcha 18).
- Do not use an LLM- or model-generated string as a filename without sanitising path
  separators, control characters, length and the empty case (`docs/01` §12 gotcha 19).
- Do not build audio chunk concatenation here — `docs/04` §6 is Phase 6.

**Done when.**
- [ ] Binary bytes are obtained inside Zotero via a documented response type.
- [ ] A valid WAV file is written under a path derived from `Zotero.DataDirectory.dir`.
- [ ] The file is registered as an attachment on a Zotero item and opens and plays.
- [ ] `test/integration/zotero/attachments.spec.ts` passes.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish --abort-on-fail
```
plus manually opening the attachment from the item pane and hearing audio.

**Notes.** `docs/04` §10.2's WAV-linked / MP3-imported distinction decides the attachment mode;
read it before choosing, because the choice affects whether the file travels with the user's
Zotero data.

This card carries no gate of its own: it reuses the audio bytes captured in `P0-T25`, whose
gate already put the human in the loop. If fresh audio must be generated, escalate to
`P0-T25`'s gate.

---

### P0-T27 — `update.json` delivery dry run

| Field | Value |
|---|---|
| **ID** | `P0-T27` |
| **State** | `TODO` |
| **Depends on** | `P0-T09`, `P0-T14` |
| **Blocks** | `P0-T28` |
| **Retires** | `V-18`, `R-15` |
| **Implements** | part of `NFR-17` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — this publishes two public GitHub releases on the user's account. Publishing public content requires explicit permission. |

**Goal.** `V-18`'s answer: does update delivery work end to end — build v0.0.1, install it,
publish v0.0.2 with a generated `update.json` at the `update_url`, and observe Zotero offering
the update?

**Read first.**
- `docs/11-implementation-roadmap.md` §4.3 `V-18` — the exact protocol and the rationale:
  "Cheapest to verify while nothing depends on it."
- `docs/11-implementation-roadmap.md` §3 R-15 — the mitigations being validated: generate
  `update.json` from the build (`build.makeUpdateJson`) rather than by hand, include
  `update_hash`, serve from a stable `release` tag.
- `docs/01-zotero-plugin-platform.md` §11.2 — the verbatim `update.json` schema for this
  project, the `sha256:` hash format, HTTPS requirement, and the instruction never to use
  `update.rdf`.
- `docs/01-zotero-plugin-platform.md` §11.4 — the two-tag distribution model: `v0.1.0` carries
  the XPI, the moving `release` tag carries `update.json` / `update-beta.json`.
- `docs/01-zotero-plugin-platform.md` §4.5 "Release" — what `zotero-plugin release` actually
  does in its bump and publish phases, and the pre-release behaviour of `-`-containing versions.
- `docs/13-testing-build-and-release.md` §6.3 — the `update.json` manifest section.
- `docs/13-testing-build-and-release.md` §6.4 — how Zotero checks for updates, so the
  observation in step 5 is interpreted correctly.

**Files.**
- create `.github/workflows/release.yml`
- modify `zotero-plugin.config.ts` (`build.makeUpdateJson.hash`)

**Do.**
1. Confirm `build.makeUpdateJson: { hash: true }` is set (`docs/13` §1.4).
2. **Human gate.** Get explicit permission to publish two releases to the public repository,
   and confirm the version numbers (v0.0.1, v0.0.2) are acceptable as throwaway pre-1.0 tags.
3. Build and publish v0.0.1: the `v0.0.1` tag carries the XPI; the `release` tag carries the
   generated `update.json`.
4. Install v0.0.1 into the dev profile from the released XPI (not from source).
5. Build and publish v0.0.2 the same way, letting the release step regenerate `update.json`.
6. In Zotero, check for plugin updates and observe whether v0.0.2 is offered and installs.
7. Verify the `update_hash` in the published `update.json` matches the actual XPI's SHA-256.
8. Record the verdict and the exact URLs.

**Do NOT.**
- Do not hand-write `update.json`. R-15's mitigation is generation from the build; a hand-edited
  manifest is the failure mode being guarded against.
- Do not publish `update.rdf` (`docs/01` §11.2) — it is the legacy format.
- Do not serve `update_url` over HTTP (`docs/01` §11.2).
- Do not put an 11.x `strict_max_version` in the published `update.json`, even though §11.3
  shows the compatibility-bump trick — `docs/01` §11.3 carries an explicit "Do not actually
  publish an 11.x range yet."
- Do not publish anything without the human's explicit go-ahead; the releases are public and
  permanent-ish.
- Do not use a version containing `-` for this dry run unless you intend to exercise the
  beta path: `docs/01` §4.5 records that such a version regenerates **only**
  `update-beta.json`.

**Done when.**
- [ ] v0.0.1 and v0.0.2 exist as GitHub releases with XPIs attached.
- [ ] The `release` tag carries a generated `update.json` reachable over HTTPS at the
      `update_url` in the shipped manifest.
- [ ] Zotero, running v0.0.1, offers and installs v0.0.2.
- [ ] The published `update_hash` matches the XPI's actual SHA-256.

**Verify with.**
```bash
curl -sSf "$UPDATE_URL" | node -e "let s='';process.stdin.on('data',d=>s+=d)\
.on('end',()=>{const u=JSON.parse(s).addons['research-helper@suppakoko.github.io'].updates;\
console.log(u.map(x=>x.version+' '+x.update_hash).join('\n'));});"
```
plus the manual "Check for Updates" observation in Zotero.

**Notes.** `docs/11` §4.3 gives `V-18` 0.5 d and calls it the cheapest thing to verify while
nothing depends on it. Doing it now means the release path is known-good before there is
anything to lose. `docs/13` §5.2's full `release.yml` is the target shape; Phase 0 needs only
as much of it as this dry run exercises. The gate at step 2 is **G-40** in
[`06-human-gates.md`](06-human-gates.md) — a Phase 0 gate distinct from `G-35`, which covers the
v1.0 release and everything after it.

---

### P0-T28 — Write and commit the Phase 0 spike report

| Field | Value |
|---|---|
| **ID** | `P0-T28` |
| **State** | `TODO` |
| **Depends on** | `P0-T14`, `P0-T15`, `P0-T16`, `P0-T17`, `P0-T18`, `P0-T19`, `P0-T20`, `P0-T21`, `P0-T22`, `P0-T23`, `P0-T24`, `P0-T25`, `P0-T26`, `P0-T27` |
| **Blocks** | none |
| **Retires** | closes out every `V-*`; `R-21` (partly) |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — the owner must rule on any spike that failed, in particular the R-19b decision if `V-8b` found no font geometry, and the R-8 provider decision if `V-10`'s Korean quality was judged inadequate. |

**Goal.** A committed spike report answering every question in `docs/11` §4 with
yes / no / workaround, so Phase 1's design can be frozen on evidence rather than assumption —
and so a second developer can reproduce every finding without re-spiking (R-21).

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 0 "Deliverables" — "A written **spike report**
  (2–3 pages) answering §4's questions with yes/no/workaround", and the definition-of-done
  bullet requiring every §4 item to be marked verified / worked-around / blocked.
- `docs/11-implementation-roadmap.md` §4 in full — the source of every row in the report table.
- `docs/11-implementation-roadmap.md` §4's closing paragraph — that the predicted
  non-collapse happened and §1 **has already been re-derived** (2026-09-09) from this file's
  card sum, and that a `V-7` or `V-10` failure still means stop and re-plan before Phase 1.
- `docs/11-implementation-roadmap.md` §3 R-23 — the standing instruction to **record actual
  days against each card from `P0-T01` onward**, so the ×1.50 correction factor applied to
  Phases 4–7 becomes a measurement instead of an inference. Phase 0's actuals are the first
  data point, and this card is where they are collected.
- `docs/11-implementation-roadmap.md` §5 — the product-owner decision table; two of its rows
  ("Before Phase 0 ends", and the R-19b consequence of the full-text decision) are settled or
  escalated here.
- `docs/11-implementation-roadmap.md` §3 R-21 — why the report is committed: it is the
  bus-factor mitigation.
- `plan/README.md` §5 "Execution protocol" step 6 — paste real output; if a check failed,
  report the failure rather than adjusting the criterion.

**Files.**
- create `docs/spikes/phase-0.md`

**Do.**
1. Fill in the template at the end of this file, one row per `V-*` id including `V-8b`.
2. For each row, cite the evidence: a commit SHA, a CI run URL, a log excerpt, or the fixture
   that demonstrates it. A verdict with no evidence is not a verdict.
3. Write the "Decisions forced" section: for every `no` or `workaround`, state which design
   document is now the defect and what changes.
4. Escalate to the owner, explicitly and by name: the R-19b decision if `V-8b` failed; the R-8
   provider decision if `V-10` failed; the Linux-without-libsecret fallback question from
   `docs/11` §5 if `V-16` could not measure it; and any `V-7` failure, which stops the plan.
5. Record every unknown this phase resolved that the docs had marked `> **Unverified:**`, with
   the resolution, so the corpus can be corrected.
6. Record Phase 0's **actual** elapsed developer-days, per card where possible, against
   `docs/11` §1's current **15.5–22 d** figure and this file's 15.5 d card sum. State whether
   `docs/11` §1's Phase 0 row needs re-deriving again. This is R-23's measurement: whether the
   ×1.50 factor `docs/11` §1 applies to the undecomposed Phases 4–7 is supported or not.
7. Commit it. `docs/11` §3 R-21 requires the report, the fixtures and the tests to be in-repo.

**Do NOT.**
- Do not mark a spike "verified" on the strength of a typecheck. Types are a compile-time
  claim; `V-6` is the only spike types can answer, and even it needs the runtime caveat.
- Do not soften a negative finding. `plan/README.md` §5 rule 6: report the failure, do not adjust
  the criterion to match the code.
- Do not resolve an owner decision yourself. `docs/11` §5's rows and R-19b's "Owner decision
  required if the spike fails" are human gates.
- Do not omit a `V-*` row because it was folded into another task. Every id gets a row, even if
  the row says "answered as part of `P0-T08`".
- Do not include any API key, key fragment, or unredacted request body in the report
  (`docs/09` §2.2 — the debug bundle redaction rules apply to the spike report too).
- Do not write the report anywhere but the repository. R-21's whole point is that it is
  committed.

**Done when.**
- [ ] Every `V-*` id from `docs/11` §4, including `V-8b`, has a row with a verdict of
      verified / worked-around / blocked and an evidence citation.
- [ ] Every design-doc `> **Unverified:**` marker this phase touched is listed with its
      resolution or a statement that it remains open.
- [ ] The Phase 0 actual-effort figure is stated against `docs/11` §1's 15.5–22 d and against
      this file's 15.5 d card sum.
- [ ] Every owner decision the phase raised is listed, unresolved, and addressed to the owner.
- [ ] The report is committed on `main`.
- [ ] No credential appears anywhere in it.

**Verify with.**
```bash
test -f docs/spikes/phase-0.md \
  && for v in V-1 V-2 V-3 V-4 V-5 V-6 V-7 V-8 V-8b V-9 V-10 V-11 V-12 V-13 V-14 V-15 V-16 V-17 V-18; do \
       grep -q "\b$v\b" docs/spikes/phase-0.md || { echo "missing $v"; exit 1; }; done \
  && echo "all 19 spikes present"
```

**Notes.** The report is the phase's most durable artifact: `docs/11` §3 R-21 names it as the
mitigation for single-developer bus-factor risk, and `plan/README.md` §2 makes Phase 0's
outcomes the reason Phases 4–7 are deliberately not decomposed yet. Phase 1 decomposition
(`plan/02-phase-1-pubmed.md`) should be written immediately after this card lands, not before.


---

### P0-T29 — Pin line endings with `.gitattributes`

| Field | Value |
|---|---|
| **ID** | `P0-T29` |
| **State** | `DONE` — completed 2026-09-10, commit `010ede3`; all four criteria verified, including a fresh clone showing zero CR bytes |
| **Depends on** | `P0-T01` |
| **Blocks** | `P0-T02` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** Every clone of the repository checks the corpus out with LF line endings, on every
platform, without depending on a machine-local git setting.

**Read first.**
- `plan/README.md` §5 rule 2 — why this card exists at all: `P0-T01` hit the problem, fixed it
  locally with `core.autocrlf=false`, and stopped rather than adding a file its `Files` list did
  not name.
- `docs/07-architecture-and-data-model.md` §2.2 — the directory tree, so the attributes file
  covers the generated and binary paths (`test/fixtures/`, `addon/content/icons/`) as well as
  source.
- `docs/08-ui-ux-spec.md` §4.5 and §7.4 — the ASCII wireframes measured character-by-character.
  These are why line endings are not cosmetic here: a CRLF rewrite changes byte offsets and
  breaks the width checks the review rounds ran.
- `docs/13-testing-build-and-release.md` §1.6 — the `fixtures:record` script writes recorded API
  responses; those are data and must not be re-encoded.

**Files.**
- create `.gitattributes`

**Do.**
1. Set the default: `* text=auto eol=lf`, so text files are stored LF in the object database and
   checked out LF everywhere.
2. Mark the recorded-fixture directory as text with LF explicitly, so a fixture recorded on
   Windows and one recorded on Linux compare equal — the record/replay layer in
   `docs/13` §3 depends on byte equality.
3. Mark genuinely binary paths `binary` so git never re-encodes them: PDFs (the IMRaD corpus,
   `P3-T20`), images under `addon/content/icons/`, and any `.xpi`.
4. Leave `core.autocrlf` alone. `.gitattributes` overrides it, and `P0-T01` already set it
   `false` for this working copy; the point of this card is that a fresh clone needs no such
   setting.

**Do NOT.**
- Do **not** add `* text eol=crlf` for any path. The corpus was normalised to LF during the
  design review and `docs/08`'s wireframe measurements assume it.
- Do **not** mark `.md` binary to "protect" it. That disables diffs on the design corpus, which
  is the repository's main content.
- Do **not** rewrite existing history to normalise it. The working tree is already LF and the
  first two commits stored it that way; `git add --renormalize .` is unnecessary and would
  produce a confusing empty-diff commit.

**Done when.**
- [ ] `.gitattributes` exists and its first non-comment line is `* text=auto eol=lf`.
- [ ] `git check-attr -a README.md` reports `text: auto` and `eol: lf`.
- [ ] `git ls-files --eol` reports `i/lf` and `w/lf` for every `.md` file in `docs/` and `plan/`.
- [ ] A fresh `git clone` into a temporary directory produces `.md` files containing no CR byte.

**Verify with.**
```bash
git check-attr -a README.md \
  && git ls-files --eol -- 'docs/*.md' 'plan/*.md' | grep -v 'i/lf.*w/lf' && echo "NON-LF FOUND" && exit 1 \
  || echo "all LF"
```

**Notes.** Discovered during `P0-T01`, not planned: git warned that `core.autocrlf` would
rewrite the corpus to CRLF on checkout. `P0-T01` set the flag `false` for its own working copy,
which fixes this machine and nobody else's — hence a separate, durable card. Numbered `P0-T29`
because `plan/README.md` §3 forbids renumbering and this is the next free number in the phase,
even though it runs second in dependency order.
---


---

### P0-T30 — Create the plugin icon assets

| Field | Value |
|---|---|
| **ID** | `P0-T30` |
| **State** | `TODO` |
| **Depends on** | `P0-T04` |
| **Blocks** | `P0-T09` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The two icon files `addon/manifest.json` already points at exist, so the plugin
renders with an icon in Zotero's Plugins window instead of a broken image.

**Read first.**
- `docs/13-testing-build-and-release.md` §1.3 — the manifest's `icons` block, which fixes both
  the sizes (`48`, `96`) and the paths (`content/icons/favicon@0.5x.png`,
  `content/icons/favicon.png`). Those paths are already committed; this card supplies the files,
  it does not get to rename them.
- `docs/08-ui-ux-spec.md` §9 — the accessibility rules. An icon carries no information the UI
  does not also state in text, so it needs no alternative text of its own, but it must stay
  legible at 48 px against both light and dark Zotero themes.
- `plan/06-human-gates.md` `G-35` — final artwork is a release concern, not a Phase 0 one. This
  card ships a functional placeholder; see `Notes`.

**Files.**
- create `addon/content/icons/favicon.png` (96×96)
- create `addon/content/icons/favicon@0.5x.png` (48×48)
- create `addon/content/icons/README.md`

**Do.**
1. Produce a 96×96 and a 48×48 PNG. Generate them deterministically from a committed source
   (a small script, or an SVG committed alongside) rather than pasting binary blobs nobody can
   regenerate — `docs/07` §2.2.1's rule that a record must be reproducible applies here too.
2. Keep the mark legible at 48 px: one shape, high contrast, no fine detail and no text. It is
   rendered at icon size in a list, not viewed full-size.
3. Check it against both Zotero themes. A mark that relies on a light background disappears in
   dark mode; give it either its own background or a colour that works on both.
4. Write `addon/content/icons/README.md` recording what the source is, how to regenerate the
   PNGs, and that the current mark is a placeholder pending the owner's decision.
5. Rebuild and confirm the icons are packaged into the XPI at `content/icons/`.

**Do NOT.**
- Do not rename the files or change the manifest's `icons` block. `P0-T03` pinned those paths
  and `addon/manifest.json` is that card's file, not this one's.
- Do not commit a PNG with no reproducible source. A binary nobody can regenerate is a
  maintenance dead end, and `.gitattributes` (`P0-T29`) marks `*.png` binary precisely so git
  will not diff it for you.
- Do not copy an icon from another project, from Zotero itself, or from an icon set whose
  licence has not been checked. The repository is MIT (D8) and its assets have to be
  redistributable under it.
- Do not add an icon size the manifest does not declare. Zotero reads `48` and `96`; a stray
  `128` is dead weight in the XPI, which `NFR-18` budgets at 3 MB.

**Done when.**
- [ ] Both files exist at the exact paths `addon/manifest.json` names.
- [ ] `file addon/content/icons/favicon.png` reports a PNG, and its dimensions are 96×96;
      `favicon@0.5x.png` is 48×48.
- [ ] `npm run build` succeeds and both files appear under
      `.scaffold/build/addon/content/icons/`.
- [ ] The XPI contains both, at `content/icons/`.
- [ ] `addon/content/icons/README.md` states the source and the regeneration command, and
      whoever follows it reproduces byte-identical PNGs.

**Verify with.**
```bash
npm run build \
  && test -f .scaffold/build/addon/content/icons/favicon.png \
  && test -f .scaffold/build/addon/content/icons/favicon@0.5x.png \
  && unzip -l .scaffold/build/research-helper.xpi | grep -c "content/icons/favicon"
```

**Notes.** Discovered during `P0-T03`, not planned: `addon/manifest.json` declares both icon
entries and `P0-T04` created `addon/content/icons/`, but no card supplied the files, so the XPI
currently ships a manifest pointing at nothing. Numbered `P0-T30` because `plan/README.md` §3
forbids renumbering.

**The mark this card ships is a placeholder, and that is deliberate.** Final artwork is a design
decision the project owner has not made, and `P0-T09` only needs an icon that renders. Replacing
it before v1.0 belongs with the release checklist (`docs/13` §8, gate `G-35`); this card's
README.md is where that hand-off is recorded so it is not forgotten between here and Phase 7.

**Findings, 2026-09-10.** Both PNGs are generated by a dependency-free Node script embedded in
`addon/content/icons/README.md` as its only fenced `js` block (raw deflate stored blocks + a hand-rolled
CRC-32/Adler-32, so it needs no `zlib` bindings beyond Node's own). Regeneration was proven, not
asserted: both files were deleted and rebuilt, and the SHA-256s matched byte for byte
(`48e9ad94…` for `favicon.png`, `aad6e9a1…` for `favicon@0.5x.png`). Those same two hashes come
back out of the packed XPI, so the build does not touch them.

**The XPI ships this README.** `build.assets` is `addon/**/*.*`, so
`content/icons/README.md` (11.9 KB) is delivered to every user alongside the icons. Harmless
against `NFR-18`'s 3 MB budget, but it is developer documentation inside a user artifact, and
the same rule will ship every future `.md` under `addon/`. Worth an asset-glob narrowing before
`P0-T14`.

## Phase 0 spike report template

Copy this into `docs/spikes/phase-0.md` (`P0-T28`) and fill it in. One row per `V-*`
id from `docs/11-implementation-roadmap.md` §4 — **all 19, including `V-8b`**.

**Verdict values:** `verified` (works as assumed) · `workaround` (does not work as assumed, but
a documented fallback is in place) · `blocked` (cannot be answered here; states what is needed)
· `failed` (the assumption is wrong and the design must change).

### Environment

| Item | Value |
|---|---|
| Date range of the spike | |
| OS and version | |
| Zotero version (exact, e.g. 10.0.1) | |
| Node version | |
| `zotero-plugin-scaffold` version | |
| `zotero-plugin-toolkit` version | |
| `zotero-types` version | |
| TypeScript version | |
| Vitest version | |
| esbuild `target` that actually worked (`firefox140` / `firefox115`) | |

### Spike results

| # | Assumption (short) | Task | Verdict | Evidence (commit / CI run / log / fixture) | Consequence & follow-up |
|---|---|---|---|---|---|
| `V-1` | Scaffold-built plugin installs and runs on Zotero 10.0.1 Windows; version range accepted | `P0-T02`, `P0-T03`, `P0-T09`, `P0-T10` | | | |
| `V-2` | Hot reload works on Windows via `zotero-plugin serve` / RDP | `P0-T08` | | | |
| `V-3` | Debugger attaches (`server.devtools` → `--jsdebugger`); breakpoints hit; debug logging usable | `P0-T08` | | | |
| `V-4` | `shutdown()` fully tears down, verified by 5 disable/enable cycles | `P0-T07`, `P0-T11` | | | |
| `V-5` | Scaffold in-Zotero Mocha runner works and can run on GitHub Actions Ubuntu | `P0-T13`, `P0-T14` | | | |
| `V-6` | `zotero-types` accurate for Zotero 10 across items, collections, notifiers, prefs panes, `Zotero.HTTP` | `P0-T06` | | | |
| `V-7` | Arbitrary cross-origin POSTs with custom headers to all four LLM providers + one literature API | `P0-T15` | | | |
| `V-8` | SSE streaming responses are consumable, or cleanly not | `P0-T16` | | | |
| `V-8b` | `getStructuredDocumentText` exposes usable font/layout geometry | `P0-T18` | | | |
| `V-9` | Request abortion works (`AbortController` or Zotero equivalent) | `P0-T17` | | | |
| `V-10` | Gemini TTS returns acceptable Korean audio with embedded English terms (native-speaker judged) | `P0-T25` | | | |
| `V-11` | Binary/audio response handling: arraybuffer, file write, attachment registration | `P0-T26` | | | |
| `V-12` | 100 Zotero items created in a batch within NFR-1 (≤ 10 s) without freezing the UI | `P0-T20` | | | |
| `V-13` | Abstract availability measured empirically across the seven sources | `P0-T21` | | | |
| `V-14` | Semantic Scholar unauthenticated behaviour measured; key application submitted | `P0-T22` | | | |
| `V-15` | Zotero's existing full-text index readable from a plugin, quality adequate | `P0-T19` | | | |
| `V-16` | OS-keystore round-trip for an API-key-shaped string; unavailable-keystore behaviour; pref round-trip cost | `P0-T23` | | | |
| `V-17` | Fluent `.ftl` localization works on Zotero 10 including `ko-KR`, with English fallback | `P0-T24` | | | |
| `V-18` | `update.json` delivery works end to end (v0.0.1 → v0.0.2) | `P0-T27` | | | |

### `> **Unverified:**` markers touched by this phase

| Document & section | Marker (short) | Resolution | Still open? |
|---|---|---|---|
| `docs/01` §4.5 | Scaffold 0.9.x RDP validated against Zotero 10 | | |
| `docs/01` §5.2 | `undoAction: 'undo-action-add-item'` identifier | | |
| `docs/01` §5.4 | `collection.addItems()` existence and save semantics on Zotero 10 | | |
| `docs/01` §7.2 | Whether Zotero syncs plugin prefs | | |
| `docs/01` §8.3 | CSP on plugin XHTML loaded via `chrome://`; `fetch` from such a document | | |
| `docs/01` §8.4 | `res.body` streamable, `TextDecoderStream` present, `AbortController` aborts | | |
| `docs/01` §9.2 | Which `Localization` argument form to use for plugin `.ftl` files | | |
| `docs/06` §3.3.5 | Serialization of `getStructuredDocumentText` | | |
| `docs/07` §1.2 | Exact `strict_max_version` string Zotero 10 expects | | |
| `docs/13` §1.1 | `zotero-types` coverage of the Zotero 10 surface | | |
| `docs/13` §1.4 | Scaffold `test.*` config key names; `esbuildOptions` shape; `{{version}}` templating | | |
| `docs/13` §1.5 | Gecko/Firefox baseline under Zotero 10 (`firefox140` candidate) | | |
| `docs/13` §2.1 | `Zotero.DB.executeTransaction` / `Zotero.Item` construction signatures | | |
| `docs/13` §2.3 | Whether a plugin-consumable `Zotero.Test` API exists | | |
| `docs/13` §5.1 | Whether `zotero-plugin test` provisions Zotero in CI | | |

### Corpus defects found

Start this table empty. The three entries a pre-2026-09-09 draft of this file carried —
`docs/13` §1.2 / §2.1's `src/platform/` tree, `docs/06` §3.3.5's "not used in v1", and
`docs/13` §1.1's `types/zotero-augment.d.ts` — were **all corrected in the corpus on 2026-09-09**
and must not be re-reported. §1.1 now reads "**The directory is `typings/`, not `types/`**" and
§1.2 now carries the `src/platform/` → `src/zotero/` rename note as the one place in the corpus
that records it.

| Document & section | What it says | What is actually true | Action |
|---|---|---|---|
| | | | |

### Decisions forced, and owner decisions raised

| # | Trigger | Decision needed | Owner | Status |
|---|---|---|---|---|
| 1 | `V-8b` found no font geometry (R-19b) | Ship whole-document chunking, or flip `summary.fullTextMode` default back to abstracts | Product owner | |
| 2 | `V-10` Korean quality inadequate (R-8) | Change TTS provider, or reduce Feature 5 to the FR-43 text fallback | Product owner | |
| 3 | `V-16` Linux-without-libsecret unmeasurable (`docs/11` §5) | Tier 2 session-only, tier 3 passphrase file, or refuse | Product owner | |
| 4 | `V-7` failed (R-13) | **Stop and re-plan before Phase 1** — the client-side, no-backend premise is invalid | Product owner | |
| 5 | `V-2` hot reload unavailable (R-11) | Accept proxy-file + manual restarts as the development loop | Developer | |
| 6 | `V-5` in-Zotero tests not automatable on CI | Integration tests become manual release QA on all platforms; `docs/13` §2.3 and §5.1 change | Developer | |
| 7 | Copyright holder string for `LICENSE` (D8) | Name to use | Product owner | |

### Effort actual vs plan

| | Value |
|---|---|
| `docs/11` §1 Phase 0 estimate (revised 2026-09-09) | 15.5–22 developer-days |
| `plan/01` task-card sum (the source of that low end) | 15.5 developer-days |
| Superseded `docs/11` §1 estimate, for reference | 6–9 developer-days |
| Actual elapsed developer-days | |
| Actual ÷ 15.5 — the observed correction factor (R-23) | |
| Does `docs/11` §1's effort summary need re-deriving again? | |

---

## Estimate reconciliation

| | Developer-days |
|---|---|
| Sum of the 28 task cards above | **15.5** |
| `docs/11-implementation-roadmap.md` §1 Phase 0 estimate, **as it now stands** | **15.5–22** |
| `docs/11` §4's own sum of listed spike timeboxes | 10.75 |
| Non-spike Phase 0 deliverables `docs/11` §1 lists but never priced | 4.75 |
| Superseded `docs/11` §1 estimate | 6–9 |
| Divergence from the top of the superseded band (9 d) | **+72%** |

**Status: reconciled.** This section originally recorded an unresolved conflict — a 15.5 d card
sum against a 6–9 d phase figure, i.e. **+72%**, far beyond `plan/README.md` §7's ±30%
tolerance. Per §7 the correct response was to re-estimate the phase in `docs/11`, **not** to
shrink the tasks, and that is what happened: `docs/11` §1 was re-derived on **2026-09-09** to
**15.5–22 d** (low end = this card sum, high end = × 1.4), with the reasoning in `docs/11` §1's
"Why these figures changed" and the residual tracked as **R-23**. The two documents now agree,
and this section is retained as the derivation rather than as an open discrepancy. Do not
re-open it by shaving cards.

The divergence was not a surprise; `docs/11` §4 predicted its mechanism. Its closing paragraph
records that the listed spike timeboxes alone sum to ≈ 10.75 d and that the old 6–9 figure had
assumed "several spikes collapse into one another — `V-1`, `V-2`, `V-3` and `V-4` all fall out
of a single working dev-serve setup, and `V-6`, `V-9`, `V-14` and `V-16` are quick
confirmations rather than builds". Decomposition showed partial collapse only, and `docs/11`
§4 now says so in its own words:

- `V-2` and `V-3` **do** collapse — both are answered by `P0-T08` (0.75 d against a 1.0 d
  combined timebox).
- `V-1` and `V-4` **do not** fully collapse: `V-1` needs the template re-baselining
  (`P0-T02`, 1.0 d) before an XPI exists at all, and `V-4` needs a teardown registry
  (`P0-T07`) before there is anything to tear down.
- The remaining **4.75 d** above the spike total is non-spike Phase 0 work that `docs/11` §1
  lists as deliverables but does not price: repository bootstrap, the `docs/07` §2.2 skeleton
  and its enforced dependency rule, the TypeScript/lint configuration, the Tools-menu item, the
  CI workflow, and the spike report itself.

`docs/11` §4 had stated the consequence in advance: "If they do not collapse, Phase 0 runs to
the top of its band or past it, and the effort summary in §1 should be re-derived." They
largely did not, and §1 **was** re-derived — to **15.5–22 developer-days**, not to the 12–16
this section first recommended; the roadmap took the card sum as the low end rather than
splitting the difference. Note that this does not mean 15.5 − 7.5 = 8 days of genuinely new
work in the whole-plan total, because several of these cards (the HTTP client, the keystore
adapter, the full-text accessor, the Fluent bundles, the item mapper) produce code Phases 1–6
would otherwise have written anyway — `docs/11` R-23's mitigation is nonetheless to plan
against the **top** of each band.

**Two caveats on the sum.** It excludes review latency and the external wait on the Semantic
Scholar key application (`P0-T22`), per `plan/README.md` §7. And it assumes every human gate is
answered promptly; nine gates in one phase is a lot of round-trips, and `P0-T25`'s
native-speaker judgement in particular is not a same-day turnaround in most teams.

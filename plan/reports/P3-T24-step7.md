# P3-T24 step 7 report: the prompt files reach the bundle

## Verdict

Step 7 is done, and the decision of 2026-10-20 is wired in. The wiring module is `src/prompts/bundled.ts`. It imports the five prompt files with `with { type: "text" }`, builds the registry once through `createPromptRegistry`, and exports it with `PROMPT_VERSIONS`. No build setting changed. The unit tests do not import the module.

The proof is the in-Zotero spec `test/integration/prompts.spec.ts`. The scaffold builds the test bundle separately, with no loader for `.md`. Inside that bundle the spec loads all five prompts at 1.0.0, checks that each inlined text matches its released file byte for byte by SHA-256, and renders every prompt with a fixture. It passed in 3 of 3 clean full-suite runs (176 passed each time).

The bundle that `npm run build` makes does **not** contain the prompts yet. Nothing reachable from `src/index.ts` imports `src/prompts/`. A check on the built script found 0 of 5 prompt texts and no `createPromptRegistry`. I decided not to add a dead import:
- **The build settings are already proven.** A scratch esbuild build of `bundled.ts` with the main build's settings (target firefox140, the same `define`) gave 5 of 5 texts identical to the files when run in Node. The test bundler's target, firefox115, gave the same result.
- **A dead import would need a file outside this step's scope.** It would mean editing `src/index.ts`.
- **A dead import would add startup behaviour with no caller.** The registry would be parsed at every Zotero start, and a bad prompt file would break plugin startup.

`P3-T25`'s import of `summarizeItem` will bring the module into the main bundle.

All six checks exit 0, and 6 of 6 mutants were caught.

## Files changed

- **`docs/12-prompt-library.md` §17.3**
  - The old sentence "A malformed prompt file fails the build, not the user's run." is struck through and marked **Corrected 2026-10-20**. A bad file fails `npm run test` and the in-Zotero spec, not `npm run build`; mutant M3 measured this.
  - New note "Decided 2026-10-20 (owner; `plan/00` §6 items 237–239)". It covers:
    - the `variables` header field, with an example and the rules the registry enforces;
    - `maxTokensPerItem`: `RELEVANCE_SCREEN` gets 100 × the batch size, through `resolveMaxTokens`;
    - import attributes in one wiring module;
    - `bundled.ts` added to the file tree;
    - the JSON schema imported natively and kept in Prettier formatting.
- **created `src/prompts/bundled.ts`.** Exports `PROMPT_SOURCE_FILES`, `PROMPT_REGISTRY` and `PROMPT_VERSIONS`. The module comment says that unit tests must not import it, how to add a new prompt version, and which cards will call it (`P3-T25`, `P3-T26`, `P3-T27`).
- **created `typings/prompts.d.ts`.** `declare module "*.md"` with a `string` default export.
- **created `test/integration/prompts.spec.ts`.**
  - Contains `RELEASED_FILE_SHA256` and `loadBundled`.
  - The wiring module is loaded with a dynamic `import()` inside each test. esbuild inlines that as a lazy module in the same bundle.
  - Reason: a registry error thrown at the top of a spec script happens before Mocha starts. The spec's tests would then never register, and the run could still pass.
- **`src/prompts/index.ts`, module comment only.** The section "The bundling seam — deliberately not wired" became "The bundling seam" and now names `./bundled.ts`. No code changed. This file was in the "Read first" list rather than the list of files to change, so I am flagging the edit.
- **`plan/04-phase-3-llm-summaries.md`, P3-T24 card only.**
  - Removed the "Open — recommended" block and added a "Decided 2026-10-20" block in its place.
  - **Files:** the `zotero-plugin.config.ts` row is struck and marked Corrected. Rows added for `bundled.ts`, the spec and `docs/12`.
  - **Step 4:** "fails the build" corrected.
  - **Step 6:** now names `bundled.ts`.
  - **Done when:** the byte-identical line is corrected per item 238, and the build line is annotated.
  - **Verify with:** added `npm run test:integration -- --exit-on-finish --abort-on-fail`.
  - **State** was left at `TODO` for the coordinator.

## Tests

`test/integration/prompts.spec.ts`, suite "P3-T24: the bundled prompt registry (docs/12 §17.3)":
1. loads all five prompts at version 1.0.0 from the bundled files
2. bundles each prompt file byte for byte
3. renders PAPER_SUMMARY_ABSTRACT with a fixture and leaves no {{
4. renders every prompt with every declared variable, keeping non-ASCII text intact (the em dashes in `CHUNK_MAP` and `RELEVANCE_SCREEN`)
5. carries the schema and max_tokens each bundled prompt declares

The unit tests are unchanged: `test/unit/prompts/registry.test.ts` has 56 cases.

## Runs

| Command | Result | Runs |
|---|---|---|
| `npm run typecheck` | exit 0 | 2 (mid-work and final) |
| `npm run lint:check` | exit 0, "All matched files use Prettier code style!" | 2 |
| `npx eslint .` | exit 0 | 2 |
| `npm run test` | exit 0. Unit: 50 files, 2654 tests. Contract: 2 files, 40 tests. | 2 |
| `npm run build` | exit 0. The built script holds 0 of 5 prompt texts, as expected (see the verdict). | 2 clean (plus 2 with a mutant live) |
| `npm run test:integration -- --exit-on-finish` | 176 passed, exit 0, about 183 s; all 5 P3-T24 tests passed | 3 of 3 clean runs; no hang |
| Scratch esbuild build of `bundled.ts` (firefox140 and firefox115) | 5 of 5 files identical to disk; plain `.md` import without the attribute fails with "No loader is configured" | 1 |

No Zotero process was ever left running on the test profile, and nothing was killed.

## Mutants

Each mutant was live for its own run only. Each was restored by copying the saved original back, and every restore was verified by SHA-256. The final hash check also matched `typings/i10n.d.ts` and `typings/prefs.d.ts`. The final `grep -rn MUTANT src test addon typings scripts` was empty. No mutant touched `useTranslators`.

| ID | Change | Result | Caught by |
|---|---|---|---|
| M1 | `typings/prompts.d.ts`: the text is declared as `number` | caught | typecheck, TS2322 in `bundled.ts` |
| M2 | `typings/prompts.d.ts`: `*.md` becomes `*.markdown` | caught | typecheck, TS2307 ×5 |
| M3 | `chunk-map.v1.0.0.md`: `cacheEpoch: 0` (marker in the system text) | caught | `npm run test` (the registry unit test fails to collect) and integration (171 passed, 5 failed: all five P3-T24 tests, with `PromptRegistryError`). `npm run build` **exited 0**. |
| M4 | `bundled.ts`: the import attribute removed from one import | caught | integration only: the test bundle fails with "No loader is configured for .md" and exits 1 in 7 s. Typecheck, eslint, build and the unit tests all pass. |
| M5 | `bundled.ts`: `PROMPT_VERSIONS` reports `CHUNK_MAP` as `1.0.1` | caught | integration: "loads all five prompts…" fails (175 passed, 1 failed) |
| M6 | `chunk-reduce.v1.0.0.md`: valid edit to the user text | caught | unit: "CHUNK_REDUCE … verbatim". Integration: "bundles each prompt file byte for byte" (hash mismatch, 175 passed, 1 failed) |

## Contradictions

1. **`docs/12` §17.3 and card step 4 said "a malformed file fails the build". It does not.**
   - `tsc` sees each file only as a `string`, and esbuild inlines the text without reading it.
   - M3 measured `npm run build` exit 0 with a malformed file.
   - Both places are now corrected: the failure comes from `npm run test` and the integration spec.
2. **The finishing condition "`npm run build` produces a bundle in which the registry loads all five prompts" is met only through its "or by an integration check" clause.**
   - The main bundle has no prompts until `P3-T25` imports `bundled.ts`.
   - Until then, M4 shows that a missing import attribute is caught only by the integration suite.
   - Suggestion for the coordinator: once `P3-T25` lands, its card can re-check the built script for the five texts.
3. **Item 237 said step 7 waits for `P2-T37`.** `P2-T37` is in the tree (commit b2d7f58), the test profile was free, and no conflict arose.
4. **`test/unit/prompts/registry.test.ts` still says bundling "is the card's open line".** The comment is stale but harmless. I did not edit it because the file is outside the allowed list.

## What I did not check

- Loading `bundled.ts` from the real `npm run build` script inside Zotero. It is not in that bundle; only the scratch build with the same settings was run, in Node.
- The cost of building the registry at Zotero startup. There is no import yet.
- `vitest --coverage`. Its `include: src/**/*.ts` covers `bundled.ts`, and I did not test whether coverage can handle that file.
- The XPI contents beyond the built script. The XPI is packed from the same build directory.
- `git` beyond `status` and `diff --stat`. Nothing is committed.

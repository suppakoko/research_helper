# Phase 7 batch L: cards P1-T38, P1-T37 and P0-T35

**Date:** 2026-11-25 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-25 (batch L) · **Commit base:** 26250a9, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository. Batch L's own files there start with `l-`.

## 1. Summary

The three cards are built or measured and stay `TODO`; only the owner sets `DONE`.

- **P1-T38** (`plan/reports/P1-T38.md`).
  - A run rejected for an empty keyword or an out-of-range Max per database now headlines its own sentence, with
    no button. An import that names no collection shows a sentence in the inline banner and keeps the preview.
  - The window's second Fluent bundle is linked in the markup, and the run-time call is removed. Measured: every
    main-window string the window renders still rendered.
  - Three new en-US ids, pending Korean review.
- **P1-T37** (`plan/reports/P1-T37.md`).
  - Timeouts and unreachable hosts render `docs/08` §8.3's sentences, from two named members of
    `SerializedError`: `host` (the host name only, redacted) and `timeoutSeconds`.
  - The HTTP client's two unredacted call sites are fixed.
  - Planted keys and paths reach neither the screen nor stored records. Five unit mutants that drop the redaction
    were all killed.
- **P0-T35** (`plan/reports/P0-T35.md`). Measured against a loopback server the probe starts, with the cancel
  after 12,288 characters had arrived. Three separate answers:
  - (a) the cancel stops the request;
  - (b) the partial body is **not** readable from the request afterwards (0 characters), so partial output must be
    kept as it arrives;
  - (c) no further events arrive.
  The client still classifies the cancel as code `CANCELLED` and throws `OperationCancelledError`.

**No regression**, and no `DONE` card affected by a failure: every run and check passed.

## 2. Figures

| What | Result |
|---|---|
| Recorded integration runs (debugger on, one tree, 1,234 files in `l-tree.sha`) | 3 of 3 exit 0, 392 passed each (batch K: 388) |
| Development runs (with the temporary probe spec) | 2 of 2 exit 0, 393 passed each |
| Live-request guard, every run | only loopback hosts; "away from loopback" empty (lists in each report) |
| `npm run typecheck`, `npm run lint:check`, `npx eslint .` | exit 0 |
| `npm run l10n:check` with CI's arguments | exit 0; 572 messages, 3 allowed holes (the three P1-T38 ids) |
| `npm run test` | exit 0; 8,541 unit tests passed, 105 skipped (batch K: 8,529); contract 93 passed, 28 skipped |
| `npm run build` | exit 0; XPI 736,260 bytes (batch K 735,222, +1,038) |
| Typings | `i10n.d.ts` 86f684d1…94fc4 (batch K cd93b62a…196b, +3 lines); `global`, `prefs`, `prompts`, `zotero-augment` equal to batch K's |
| Unit mutants (P1-T37) | L1–L5, 5 of 5 killed |
| P0-T35 probe | two runs: 3 progress events, 12,288 characters at the cancel; settled 0–1 ms after; 0 events in 2,500 ms; `xhr.response` 0 characters afterwards |

**Item 411(b).** The current time was written into `%LOCALAPPDATA%	iny-update-notifierCachezotero-plugin-scaffold`
before every Zotero launch and every build. Each run log's first line has the value; the build of 23:58:09 is in
`l-checks.sh`'s output. The launch gate passed all four checks before each launch. No updater.exe and nothing under
C:Program Files or C:ProgramData was touched, and no Zotero process was killed.

## 3. Decisions and questions

- Coordinator-level choices: `plan/00` §6 item 416 (a)–(l), each marked DECIDED 2026-11-25 (coordinator, under
  item 313).
- Owner questions: item 417, with draft answers not adopted:
  - (a) whether a dismissed collection-name prompt should explain itself;
  - (b) the persisted `stack`'s source locations.
- `npm run index:derive` was run after: 280 tasks, 235 `DONE`, 45 `TODO`.
- **No estimate changed**, so `plan/README` §7 is untouched.
- **Korean ids pending:** `research-helper-search-query-empty`, `research-helper-search-max-results-range` and
  `research-helper-search-target-missing`. The brief for their drafts is `plan/reports/ko-review-batchL.md`. It
  holds no Korean, because the brief says this executor writes none.

## 4. Tree changes (uncommitted)

- **Source:**
  - `src/core/errors.ts`
  - `src/core/http/client.ts`
  - `src/i18n/keys.ts`
  - `src/ui/viewModels/searchImportViewModel.ts`
- **Add-on:**
  - `addon/content/searchDialog.js`
  - `addon/content/searchDialog.xhtml`
  - `addon/locale/en-US/research-helper-searchDialog.ftl`
  - `addon/locale/ko-KR/research-helper-searchDialog.ftl` (a comment only)
- **Tests:**
  - `test/integration/searchDialog-flow.spec.ts`
  - `test/unit/core/errors.test.ts`
  - `test/unit/core/http-client.test.ts`
  - `test/unit/ui/searchImportViewModel.test.ts`
- **Probe:** `scripts/spike-network.ts`
- **Generated:** `typings/i10n.d.ts`
- **CI:** `.github/workflows/ci.yml` (the l10n step's `--allow`)
- **Docs:**
  - `docs/01-zotero-plugin-platform.md` (§8.4)
  - `docs/07-architecture-and-data-model.md` (§5.2, §7.4, §10.1)
  - `docs/spikes/phase-0.md` (Addendum C)
- **Plan:**
  - `plan/00-task-index.md` (items 416, 417, derived header)
  - `plan/01-phase-0-toolchain-spike.md` and `plan/02-phase-1-pubmed.md` (State notes)
  - new reports `P0-T35.md`, `P1-T37.md`, `P1-T38.md`, `P7-batchL.md` and `ko-review-batchL.md`

The temporary spec `test/integration/zz-p0t35-probe.spec.ts` was removed before the recorded runs.

## Appendix: progress log

*Notes written as the batch goes, kept as written.*

- 22:44 Start. Tree clean at 26250a9 (`git status --short` empty). Read `plan/README.md`, `plan/reports/P7-batchK.md` with its `k-` scripts, `plan/00` §6 items 410–415, and the three cards.
- 22:55 Reading done for all three cards. Stale card text found so far: P1-T38's pipeline now declares five validation ids (`worksMisaligned`, P2-T31, no window can trigger it); the no-target id cannot be reached from the Import button since item 358(b) (the window asks for a name first and the view model refuses an unnamed target before the pipeline). P1-T37: `RATE_LIMIT` already left `UNRENDERABLE_ERROR_ROWS` on 2026-10-21 (item 232), so after the card the constant is empty; the search window's per-source unit tests in `test/unit/ui/searchImportViewModel.test.ts` (P1-T39) assert the two rows and need changing. P0-T35: legs [14] and [15] were added on 2026-09-30 (commit 4980899) against a public host (Europe PMC) and never run; they will be pointed at a loopback server the probe starts.
- 23:01 P1-T38 built (not yet run in Zotero). Three en-US sentences in `research-helper-searchDialog.ftl`; each id on `SEARCH_DIALOG_MESSAGE_IDS` and `KO_PENDING_REVIEW`, the range id also on `FluentMessageArgsMap` and `ARGUMENT_MESSAGE_IDS`; ko-KR carries a comment naming each id and its English, no Korean; CI's l10n step passes the three with `--allow` (the pattern its own comment names). View model: `VALIDATION_HEADLINES` / `validationHeadline` headline a rejected run with its sentence and offer no button; `runImport`'s unnamed-target refusal shows the target sentence in the inline banner. Second bundle moved into the markup's `<linkset>`; `addMainWindowBundle` removed (to be measured in Zotero). Typings: `npx zotero-plugin build` at 23:00 (cache written first) regenerated `typings/i10n.d.ts` (+3 lines); typecheck exit 0; unit i18n+ui 1,308 passed.
- 23:13 P1-T37 built (not yet run in Zotero). `SerializedError` gains `host` and `timeoutSeconds`; `NetworkError` gains `host`, read off `context.url` by `hostNameOf` and passed through `redact`; `toSerialized` reads the two off public members, never off `context`. The client's OFFLINE and NETWORK call sites in `toHierarchy` now pass `redactUrl(error.url)`. View model: `TIMEOUT` and `NETWORK` rows; a row whose value is absent draws the generic row; `UNRENDERABLE_ERROR_ROWS` is empty. `docs/07` §5.2 and §10.1 amended with dated notes. Unit tests: `errors.test.ts` 179 passed, `http-client.test.ts` 121 passed, `searchImportViewModel.test.ts` 115 passed. One test fix on the way: the planted string `esearch` also matches the repository folder name `research_helper` inside every serialized stack, so the planted list uses `esearch.fcgi`. Observation, not fixed (before this batch): a serialized `stack` names source file paths, which in Zotero can include the user's profile folder, and it persists in `JobRecord.error` and `SourceProvenance.error` redacted for keys only. Put to the owner (item 417).
- 23:13 Mutants L1 to L5 (`l-mutants.mjs`, results in `l-mutants.json`): L1 and L2 (a raw URL at the OFFLINE or the NETWORK call site), L3 (`hostNameOf` without `redact`), L4 (`toSerialized` spreads `this.context`), L5 (`host` holds the whole URL). All five killed by the unit tests (1, 1, 1, 3 and 7 failing tests of 415); each file restored and its sha256 matched; the `/* MUTANT` grep over src, test, scripts and addon is empty.
- 23:38 Development run 1 (debugger on, probe spec planted): exit 0, 393 passed. The five new integration tests pass: the TIMEOUT and NETWORK rows render their sentences with the host (and 45 s); the three validation sentences render as headline or banner. Every test that renders a `mainWindow.ftl` string passed with the run-time bundle call removed, so the markup link works. The P0-T35 probe ran against its loopback server (127.0.0.1:50971): both legs cancelled after 3 progress events with 12,288 characters received, 0 events after, and the server's next write refused with `NS_ERROR_NET_RESET`; `xhr.response` read back 0 characters after the rejection. Guard hosts: `127.0.0.1:50971`, `127.0.0.1:59321`, `localhost:52490`; away from loopback none.
- 23:41 Two wording faults in the probe's own verdict lines, fixed: leg [14] named the rejection by `name`, but Zotero.HTTP's exceptions are not `Error`s ("non-Error exception: Request cancelled"), so the leg now checks `instanceof` against all five classes as `P0-T17`'s leg [11] does; and (b) said "readable, 0 chars", which now reads "NOT readable" when the read returns an empty string. The measured numbers are unchanged by this. Block re-emitted for development run 2.
- 23:56 Development run 2 (debugger on, corrected probe): exit 0, 393 passed. Probe on 127.0.0.1:62486: leg [14] rejected with `Zotero.HTTP.CancelledException` (the only one of the five classes to match) 0 ms after the cancel at t+279 ms, 12,288 characters received, `xhr.response` empty (0 characters) afterwards, 0 events in 2,500 ms; leg [15] `OperationCancelledError` 1 ms after the cancel at t+200 ms, Zotero.HTTP itself rejected with `CancelledException`, 12,288 characters delivered, 0 deliveries after. Server: 5 of 48 writes accepted on each connection, then `NS_ERROR_NET_RESET`. Guard hosts: `127.0.0.1:59321`, `127.0.0.1:62486`, `localhost:63247`.
- 23:57 Planted probe spec removed (copy kept as `l-zz-p0t35-probe.spec.ts.bak`). `/* MUTANT` grep and `.only(` grep over src, test, scripts and addon empty. Final checks (`l-checks.sh`, logs `l-c-*.log`): typecheck, `lint:check`, `npx eslint .`, the l10n check with CI's arguments (572 messages, 3 allowed holes) and `npm run test` (8,541 + 93 passed) all exit 0. Cache written at 23:58:09, then `npm run build` exit 0: XPI 736,260 bytes (batch K 735,222); `typings/i10n.d.ts` 86f684d1…94fc4 (batch K cd93b62a…196b, +3 lines), the other four typings files equal to batch K's. Manifest `l-tree.sha`: 1,234 files. Recorded runs started.
- 00:52 Recorded runs 1–3 (debugger on, `l-record.sh`): each exit 0, 392 passed; guard hosts loopback only (`127.0.0.1:59321` and one `localhost` port each). Tree still matches `l-tree.sha` afterwards.
- 00:58 Reports filled, State notes on the three cards (State unchanged), `plan/00` items 416–417, `npm run index:derive` (280 tasks, 235 `DONE`). Summary above.

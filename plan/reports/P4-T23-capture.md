# P4-T23-capture — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: READY FOR THE INTEGRATION ROUND. The data source for `P4-T23` step 4 is built and passes all unit tests. No schema migration, no type change visible to users, and no new user-visible string was needed, so nothing triggered the "stop and report" condition. Not committed, card not set to DONE, `plan/00` not edited, nothing re-priced.

## What is stored and exactly where
An optional member `runMeasurement` on the stored report record (`TrendReport.runMeasurement`, inside the existing `report.json` column). It sits only on the first report of a run.

- `calls[]`, one entry per answered call: `promptId`, `language` (absent means a stage shared by the whole run), `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `costUsd`, `maxOutputTokens` and `papers`. A figure the provider did not report stays absent, never 0.
- `themeAnalyses[]`, one entry per analysed theme: `tokens`, `narrativeTokens` and `papers`. These are estimates from the text by the same raw `estTokens` the composition uses, not provider counts.
- `resumed: true`, only when the job was resumed after a restart.

**A `both` run's shared stages count once.** A `both` run has one measurement, on its first record, and each call appears once in it. The script refuses a run where two records each hold a measurement rather than adding them.

**An old record** prints "not measured", never 0.

## Files changed, with caller and constructor
New declarations:
- `src/pipeline/trendReport/runMeasurement.ts` (new): `createRunCallRecorder`, `themeAnalysisSize`, `runMeasurementOf`, `RunCallRecorder`, `UNLABELLED_CALL`. Caller: `execute` in `trendReportPipeline.ts`. Nothing else constructs these values.
- `src/model/trend.ts`: `ReportCallUsage`, `ThemeAnalysisSize`, `ReportRunMeasurement`, `TrendReport.runMeasurement?`. Constructed only in `runMeasurement.ts`; read by `scripts/eval-trend-report.ts`.
- `src/llm/types.ts`: `CallAccounting`, `ChatRequest.accounting?`. Constructed at the seven call sites listed below; read only by `entryOf` in `runMeasurement.ts`. The adapters build request bodies field by field, so it is never sent upstream, and a test proves this for five body builders.
- `src/model/usage.ts`: `Usage.reasoningTokens?`. Constructed by three mappers; read by `entryOf`.
- `scripts/eval-trend-report.ts`: new `measure` subcommand, plus `measurementOf`, `answerTokensOf`, `formatMeasurement`, `parseMeasurement` and `THEME_CLUSTER_ASSUMED_PER_PAPER`. Called from the script's `main`, and read by tests.

Tests:
- New: `test/unit/llm/usageReasoning.test.ts`, `test/unit/pipeline/runMeasurement.test.ts`.
- Extended: `test/unit/pipeline/trendKorean.test.ts`, `test/unit/pipeline/trendCluster.test.ts`, `test/unit/scripts/evalTrendReport.test.ts`.
- Changed: `test/unit/llm/openai.test.ts`, the test "counts reasoning tokens as output". Its expected object gains `reasoningTokens: 64`, because the exact comparison failed once the mapper kept the figure.

## Shared-file edits, quoted
- `src/model/usage.ts`: `readonly reasoningTokens?: number;`
- `src/llm/types.ts`: `readonly accounting?: CallAccounting;` and `export interface CallAccounting { readonly promptId: string; readonly papers?: number; }`
- `src/llm/openai/mapper.ts`, `extractUsage`: `const reasoningTokens = countOf(recordOf(usage, "output_tokens_details"), "reasoning_tokens");` and `...(reasoningTokens !== undefined && { reasoningTokens }),`
- `src/llm/openrouter/mapper.ts`, `toUsage`: `const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};`, `const reasoningTokens = finiteNumber(details.reasoning_tokens);` and the same conditional spread.
- `src/llm/gemini/mapper.ts`, `interactionUsage`: `const reasoningTokens = countAt(usage, "total_thought_tokens");` and the same conditional spread. The legacy `readGenerateContent` and the Anthropic `toUsage` are unchanged, because no document here names a figure for them.
- `src/llm/shared/jsonMode.ts`, `buildRepairRequest`: `...(original.accounting !== undefined && { accounting: original.accounting, }),`
- One line at each call site:
  - `cluster.ts` batch: `accounting: { promptId: prompt.id, papers: keys.length },`
  - `cluster.ts` merge: `accounting: { promptId: mergePrompt.id },`
  - `cluster.ts` single call: `accounting: { promptId: prompt.id, papers: input.digests.length },`
  - `themeAnalysis.ts`, `compose.ts`, `critique.ts`: `accounting: { promptId: prompt.id },`
  - `src/pipeline/summarize/summarizeItem.ts`: `accounting: { promptId: template.id },`
- `src/pipeline/trendReport/trendReportPipeline.ts`, `execute`:
  - The import from `./runMeasurement`.
  - `const recorder = createRunCallRecorder(ctx.llm);` and `const sharedLlm = recorder.llm();`
  - `{ ...itemDeps, llm: sharedLlm, token }`, and `llm: sharedLlm` for clustering and theme analysis.
  - `const ownLlm = recorder.llm(language);`, and `llm: ownLlm` for compose and critique.
  - In the draft: `...(index === 0 && { runMeasurement: runMeasurementOf(recorder.calls(), analysedThemes.map((t) => themeAnalysisSize(t.analysis, memberCount.get(t.themeId) ?? 0)), isTrendReportCheckpoint(ctx.resumeState)) }),`

## Document notes, all dated 2026-11-02
- `docs/07-architecture-and-data-model.md`: §4.3 (`accounting`, `CallAccounting`), §5.1 (`reasoningTokens`), §5.2 (the new types and an "As built 2026-11-02" note with the rules).
- `docs/06` §12.3: an "As built 2026-11-02" note on the `measure` command and what it prints.
- `docs/spikes/trend-eval-baseline.md`: step 4 no longer lacks a source. It names the command, the words "not reported" and "not measured", and the check on field names.
- `plan/07-phase-4-trend-report.md`, `P4-T23` Notes: "As built 2026-11-02".

## Coordinator-level decisions (under `plan/00` §6 item 313, recorded in the `docs/07` §5.2 and `docs/06` §12.3 notes)
1. One measurement per run, on the first record.
2. Recording happens at the router, with the label carried on `accounting`. A call with no label reads `UNLABELLED`, never a guessed prompt.
3. A stage that is re-sent is counted again. A cached stage adds no call.
4. `themeAnalyses` lists every analysed theme, cached or not. Its sizes are estimates.
5. `totalTokens` is kept per call so that the call's own total settles whether reasoning sits inside the output or on top of it. No list of providers is involved, and where the total does not settle it, the script prints "not reported".
6. Per-adapter fields as quoted above. Absent stays absent.
7. Stated limits: a call that throws leaves no entry, which includes a cut-off stream; a run ending before Saving stores nothing; a resumed job is flagged; `costUsd` comes only where a provider reports it, and among the adapters that is OpenRouter.
8. A `measure` subcommand rather than a line in `score`. Answer tokens print as "at most" when no reasoning figure exists, and are not guessed.

## Runs (final state, all with `env -u OPENROUTER_API_KEY`)
- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npm run lint:check`: exit 0, "All matched files use Prettier code style!"
- `npm run test`: exit 0. Unit tests: 6065 passed, 105 skipped. Contract tests: 84 passed, 28 skipped.
- The Semantic Scholar test failures and the formatting warning seen in earlier runs of this round are gone in this one. Those files belong to the other agent and were not touched here.
- The search for `/* MUTANT` over `src` and `test` found nothing.

## Mutation results
- 99 mutants on a scratch mirror, never in the tree. Each ran against six test files: `usageReasoning`, `openai`, `runMeasurement`, `trendKorean`, `trendCluster`, `evalTrendReport`.
- 98 were killed on the full run. The one survivor, `or-wrong-parent`, was the sweep's own error: the replacement hit the first occurrence of the text, which is a documentation comment. Corrected to change the code, it was killed in a rerun, so 99 of 99 are killed, one of them on a separate rerun.
- The first attempt at the sweep stopped at the baseline because the mirror lacked `addon`. No result from that attempt was used.
- Two test gaps were closed before the sweep rather than found by it: the batch and merge labels (the 30-paper harness takes the single-call path), and two script cases (an unknown numeric member, and a ceiling of 0).
- Kills were counted by a non-zero test exit, and each mutant was not traced to the test that caught it. Sweep script and log: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p4t23-step4\sweep.mjs and C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p4t23-step4\sweep-full.log

## Proofs the brief asked for
- (a) Captured numbers match the mock per call: `trendKorean` and `runMeasurement` tests.
- (b) A `both` run counts shared stages once: `trendKorean`, plus the script's refusal of two measurements.
- (c) A marker string in prompts and answers does not reach the stored field: `trendKorean` and `runMeasurement`.
- (d) An old record reads as not measured: `evalTrendReport`.
- (e) The reasoning figure is read where present and absent where not: `usageReasoning`. See the first finding for what the fixtures can and cannot prove here.

## Findings
**Field names are not yet confirmed by a real answer.** `test/fixtures/llm` holds no successful response, only four synthetic refusals whose usage blocks have no reasoning figure. The fixtures therefore prove "absent stays absent", while the "read where present" figures are hand-written in the documented shapes. The OpenAI and Gemini shapes come from `docs/03`, and the OpenRouter shape from the public usage-accounting page fetched on 2026-11-02. The first paid run confirms the names; a wrong name reads "not reported", never a wrong number.

**A run that ends before Saving stores no numbers.** That includes a truncated report, which is the case the measurement most wants to see. The default log level is `warn` and no log line was added. The coordinator may want a decision on whether that matters before the first paid run.

**Gemini may under-cost thinking.** The `docs/03` §4.4 sample adds up as 412+118+44=574, which suggests thought tokens sit outside `total_output_tokens`, so `Usage.outputTokens` may under-cost Gemini thinking. Nothing was changed; the kept `totalTokens` lets the first real answer settle it. OpenRouter's page also does not say whether `completion_tokens` includes reasoning, and the same check covers that case.

**Two limits on the figures themselves.** The recorded `maxOutputTokens` is what the stage asked for, before any adapter clamp, so the share of the ceiling is against the ask. A resumed job's list covers only calls after the restart, and the script prints a line saying so.

**A `both` run's spend can now be read as a run total.** Where the provider reports cost, which today means OpenRouter only, `measure` prints the total. That closes finding 2 of `plan/reports/P4-T23.md` for OpenRouter only.

## What the integration round must prove in Zotero
An unrun spec is parked at C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p4t23-step4\integration-spec-UNRUN.md. With a mock provider, in real Zotero:
- A `both` run stores the measurement on the English row only.
- The measurement survives the row's second `put` (the note key).
- No marker, theme name or collection name appears in it.
- The note and the export show none of the numbers, and no new text appears on screen.
- After closing Zotero, `measure` reads the file, and its call count equals the mock's.
- An old database prints "not measured".
- A resumed job prints the resumed line.

## What `P4-T25` reads
`runMeasurement.themeAnalyses[].tokens`, `narrativeTokens` and `papers`, against the stated minimum of 38 500 / 2 950 in `docs/07` §12.4 and the assumed 40% narrative share. All are printed by `npx tsx scripts/eval-trend-report.ts measure --database <file> [--report <id>]`. The same command prints THEME_CLUSTER answer tokens per paper against the 40 that the prompt file assumes, which a test ties to `src/prompts/theme-cluster.v1.0.0.md`.

## Effort seen
Judgement only, not a measurement, and not a re-pricing: at or somewhat above the top of the approved 0.25–0.5 d. The source change was small: one new file of about 145 lines plus one-line call sites. Most of the effort went into the script's strict reading and the tests.

## What was not checked
- Any real provider, real field names, or a real paid run.
- Zotero or the build, which this round does not own, so `npm run build` and `npm run test:integration` were not run.
- Whether the legacy Gemini path reports a thinking figure.
- Whether OpenRouter's `completion_tokens` includes reasoning.

**Key handling:** every type check, lint, test and sweep run had the key removed from its environment. Small helper commands (`grep`, `sed`, `cut`, `ls`, `cp`) in the same shell chains did not all have it removed. None of them reads or prints the key, and the key's value was never read or written. No live language-model call was made. One network fetch was made outside the test suite: the OpenRouter public documentation page, once, with no key.

**Scratch leftovers:** the mirror directory `p4t23-step4\mirror` under the scratchpad remains, and it holds a directory link to the repository's `node_modules`. No user-visible string was added, so no Korean draft is included.

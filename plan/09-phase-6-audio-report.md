# Phase 6 — TTS audio report

> **Decomposed 2026-11-16, for the coordinator's review.** Drafted under the coordinator's brief of
> 2026-11-16, which carried four owner decisions recorded as `plan/00` §6 item 378(a)–(d) and asked
> for the remaining `plan/05` §3.3 decisions to be taken by the coordinator under item 313. Every card
> is `TODO`. Unlike `plan/07` and `plan/08`, this file has had **no independent review** yet; the
> author's report is `plan/reports/P6-decomposition.md`, and §0.4 lists the lines the owner still
> has to answer. The card sum replaced `docs/11`'s scaled 15–21 d on 2026-11-16 at the five places
> `plan/README.md` §7 names (`docs/11` §1–§2, `plan/00` §1, `plan/05` §3, now a pointer here).
>
> **What this file is.** The task-card decomposition of `docs/11-implementation-roadmap.md` §1
> "Phase 6 — TTS audio report". The card schema, the field rules and the execution protocol are
> [`README.md`](README.md) §4–§5 and bind every card below. A step that depends on a document
> change the card makes first is not executed before that change lands.
>
> **Read by `npm run index:derive`** since 2026-11-16: `scripts/derive-task-index.ts` reads this file
> with `plan/01`–`plan/04`, `plan/07` and `plan/08` and builds `plan/00` §4's Phase 6 table from it, as
> it was extended for `plan/08` on 2026-11-01. The file is numbered `09` because `05`–`08` are taken.

---

## 0. Phase summary

**Goal (docs/11).** Feature 5: English and Korean spoken briefings from a stored trend report, kept in
Zotero.

**Why this phase is different.** Phases 3–5 send text to one destination and get text back. Phase 6
makes **two paid calls in sequence to two different companies** and gets **binary audio** back.
Four consequences run through every card:

1. **Two hosts, both named.** The spoken script is written by the provider of `reportModel` (the one
   the report run already used); the audio is made by Google's TTS host,
   `generativelanguage.googleapis.com`, which may be a provider the user has never sent anything to
   (`docs/09` §3.4 rule 5). Every notice names both hosts (§0.2 item 21).
2. **The expensive call comes last and only after a second look.** The script call is cheap and is
   priced from the target length; the TTS calls are priced from the real script's length, shown
   again, and only then made (FR-42; §0.4 line 13). Nothing goes to Google before the script has
   passed validation.
3. **A Gemini key may be free-tier, and nothing can tell.** No billing signal exists
   (`DOCUMENTED_PAID_SIGNALS` is empty), so the user is asked once and an unknown answer counts as
   free (owner, item 378(b)); strict privacy mode makes no audio with such a key.
4. **Audio is large and binary.** A 10-minute WAV is about 28.8 MB; it is assembled from PCM in
   memory, written once, and linked rather than imported when it is above 10 MiB (`docs/04` §6, §10.2).

**Schedule and entry conditions.** `plan/05` §0 schedules this decomposition for the end of Phase 5;
the coordinator's brief of 2026-11-16 brought it forward, so §5.2's entry conditions (moved from
`plan/05` §3.2 on 2026-11-16) are **not all met**. Their status on **2026-11-16**, by grep of the
documents, `plan/reports/` and the tree:

| §5.2 entry condition | Status 2026-11-16 | Cards it reaches |
|---|---|---|
| Phase 4 `DONE` | **Not met as a state.** `plan/00` shows Phase 4 **0 of 25 `DONE`** because only the human sets `DONE`; `plan/reports/` holds a report for `P4-T01`–`P4-T23`, and none for `P4-T24` (determinism) or `P4-T25` (acceptance). **What Phase 6 takes from Phase 4 is built:** `TrendReport` with `audioScripts` and `audioAttachmentKeys` (`src/model/trend.ts`), `createReportStore` (`src/zotero/db.ts`), `writeReportNote` (`src/zotero/notes.ts`), the report window and its session (`openReportWindow`, `createReportWindowSession`) | `P6-T07`, `P6-T16`, `P6-T17`, `P6-T19` |
| V-10 passed (Korean TTS sample judged acceptable) | **Met 2026-09-30.** `plan/01` `P0-T25`: the owner's verdict "음성 판정 좋음, 그대로 써도 됨" on a Korean script with embedded English terms, voice `Charon`, on `gemini-2.5-flash-preview-tts`; the audio is kept outside the repository | `P6-T08`, `P6-T19` |
| V-11 passed (binary handling, file write, attachment) | **Met.** `plan/01` `P0-T26` built `src/tts/audioStore.ts` behind ports, confirmed `importFromFile` and `linkFromFile` against Zotero's `attachments.js`, imported a 5 MB WAV, and found the written file left in the data directory as well (a second copy) | `P6-T12`, `P6-T13` |
| Audio output token rate measured | **Met for one model.** `docs/04` §4.2 records `P0-T25`'s 24.998 tok/s on `gemini-2.5-flash-preview-tts` (2,709 tokens for 108.37 s; one call, $0.0273). Not measured on any other TTS model; `docs/04` §4.2 asks for re-verification by **2026-12-01** (`plan/06` `G-29`'s note of 2026-11-16) | `P6-T10`, `P6-T04`, `P6-T19` |
| Per-request audio duration ceiling understood | **Unchanged, and not needed.** `docs/04` §4.1 still marks the maximum `Unverified`; chunks of `docs/04` §5.2's size (600–900 English characters, 300–450 Korean) are about a minute of speech, far below any figure the 32 k context implies | `P6-T09` |
| `docs/10` §5 Q9 and Q10 answered | **Met 2026-11-16.** Q9 and Q10 marked decided (coordinator, under item 313; Q10 within the owner's item 378(a)) | `P6-T06`, `P6-T08` |
| `docs/12` §19 item 6 answered | **Met 2026-11-16.** Owner, item 378(a): one call from the English report, a script newly written in Korean | `P6-T08` |
| Voice-set question closed | **Moot for v1.0.** `docs/04` §2.7's question is whether the Interactions voice set matches the legacy one; v1.0 builds the legacy path only (§0.4 line 5). The voice list is still not hardcoded: it is the documented default list, validated by a real call (`docs/07` §8.5) | `P6-T05` |
| Attachment API signature confirmed | **Met.** `P0-T26` read `importFromFile` and `linkFromFile` in Zotero's source; `chooseAttachmentMode` and `IMPORT_MAX_BYTES` are built. **Not recorded anywhere:** whether a note may be an attachment's parent — `P6-T13` checks it (§0.4 line 7) | `P6-T13` |
| Gemini tier position settled and disclosed | **Settled 2026-11-16** (owner, item 378(b)); `docs/09` §3.4 rule 4 and §8 item 3 carry it. `plan/06` `G-06` (the owner's acknowledgement of Google's free-tier terms) has **no status note** in `plan/06`; `P6-T19` needs it | `P6-T15`, `P6-T19` |

**Deliverables (docs/11 §1 Phase 6) → cards.**

| `docs/11` deliverable | Cards |
|---|---|
| Gemini TTS client with voice selection and audio-format handling (PCM → WAV). FR-37, FR-38 | `P6-T05`, `P6-T12`, `P6-T17` |
| Spoken-script generation: markdown and citation stripping, number and abbreviation expansion, target-length control; the Korean script written in Korean, not translated. FR-39, FR-38 | `P6-T06`, `P6-T07`, `P6-T08` |
| Segmenting long scripts and concatenating audio without artifacts. FR-41 | `P6-T09`, `P6-T11`, `P6-T12` |
| Attachment writer: stored-file attachment with a descriptive title; "Save as…" fallback. FR-40 | `P6-T13`, `P6-T14` |
| Cost estimate by character count; cancellation. FR-42 | `P6-T10`, `P6-T11`, `P6-T15`, `P6-T17` |
| Graceful failure path that saves the script as text when TTS is unavailable. FR-43 | `P6-T14` |
| Types, preferences, fixtures, the pipeline and its wiring the deliverables need | `P6-T01`, `P6-T02`, `P6-T03`, `P6-T04`, `P6-T16` |
| The disclosure the second host requires (`docs/09` §3.4 rules 4–5) | `P6-T15` |
| The definition of done, offline and live | `P6-T18`, `P6-T19` |

**Risks retired.** R-8 (`docs/11` §1 Phase 6), by `P6-T19` with `G-30`'s ratings. `P0-T25` already
retired its feasibility half; what is left is Korean quality at report length and the FR-43 path on a
real refusal.

**Effort.** **20.00 developer-days over 19 cards** (§1), so the band these cards imply is
**20.00–28 d** (20.00 × 1.4 = 28.0 → 28). Against the scaled 15–21 d `docs/11` published before this
file, the low end is **+33 %** (20.00 ÷ 15 = 1.33) and 5 % below the scaled top (20.00 ÷ 21 = 0.95) —
above the ~30 % `plan/README.md` §7 calls a signal to re-estimate the phase in `docs/11`, which was
done. **Propagated 2026-11-16** to `docs/11` §1–§2, `plan/00` §1 and `plan/05` §3. §3 says where the
days went and where the sum is still likely low.

### Phase definition of done

Taken from `docs/11` §1 Phase 6 "Definition of done":

- [ ] A 1,000-word English script produces a single playable file opened from Zotero on Windows and
      macOS. (`P6-T12`, `P6-T13`, `P6-T19`; macOS needs `G-09`, §0.4 line 31)
- [ ] A Korean briefing is judged natural by a native Korean speaker on a 5-point scale (≥ 4 average
      over 3 samples), with correct pronunciation of English technical terms embedded in Korean
      sentences. (`P6-T08`, `P6-T19` with `G-30`)
- [ ] Revoking the TTS entitlement produces the FR-43 fallback, not a stack trace. (`P6-T14`,
      `P6-T18` offline, `P6-T19` live)

And two that the phase needs as hard as the above:

- [ ] Every Phase 6 test passes with **zero** live network calls and **zero** spend (`docs/13` §4);
      live calls happen only in `P6-T04` (the owner's recording) and `P6-T19` (the owner's
      acceptance run). No agent runs a keyed path.
- [ ] `docs/13` §8.6's nine QA lines each map to a recorded result (`P6-T19`).

### 0.1 Already landed — cite these by name, do not rebuild them

Checked against the tree on 2026-11-16.

| What | Where (by name) | Landed by |
|---|---|---|
| TTS wire and value types, spike version: `TtsProviderId`, `SynthesisRequest`, `AudioArtifact` (no `usage` yet), `VoiceInfo`, `PcmFormat`, and the Gemini request, response, usage and model-list shapes (`GeminiTtsRequest`, `GeminiTtsResponse`, `GeminiUsageMetadata`, `GeminiModelsListResponse`). `TTSProvider` is deliberately absent | `src/tts/types.ts` | `P0-T25` |
| PCM → WAV, MIME parsing, file naming, import-or-link, the attachment write behind ports | `GEMINI_PCM_FORMAT`, `WAV_HEADER_BYTES`, `WAV_CONTENT_TYPE`, `pcmToWav`, `pcmFormatFromMimeType`, `sanitizeFileStem`, `audioFileName`, `MAX_FILE_STEM_LENGTH`, `FALLBACK_FILE_STEM`, `AUDIO_DIRECTORY_NAME`, `PLUGIN_DIRECTORY_NAME`, `IMPORT_MAX_BYTES`, `chooseAttachmentMode`, `AudioFileSystem`, `AttachmentApi`, `AudioStore`, `createAudioStore` in `src/tts/audioStore.ts`. No unit test; `test/integration/zotero/attachments.spec.ts` covers it in Zotero | `P0-T26` |
| The Korean TTS spike script, with its runtime password dialog for the key | `scripts/spike-tts-korean.ts` | `P0-T25` |
| Gemini chat provider: secret id, key header, host, model-list path, the `generateContent` chat path | `GEMINI_SECRET_ID` (`"llm.gemini"`), `geminiHeaders`, `GEMINI_API_KEY_HEADER`, `GEMINI_HOST`, `MODELS_PATH`, `chatViaGenerateContent` in `src/llm/gemini/geminiProvider.ts`; `TTS_MODEL_ID` and `readModelList` (which drops TTS models from the chat list) in `src/llm/gemini/mapper.ts` | Phase 3 |
| Tier detection with no documented signal | `GeminiTier`, `DOCUMENTED_PAID_SIGNALS` (empty), `createGeminiTierDetector` in `src/llm/gemini/tierDetect.ts` | Phase 3 |
| Secret ids, including an unused `"tts.gemini"` | `SECRET_IDS` in `src/core/secretStore.ts` | Phase 0–3 |
| Redaction | `redact`, `redactUrl`, `loggableHeaders` in `src/core/errors.ts`; `redactRecord`, `redactText` in `src/core/provenance.ts` | Phase 0–3 |
| Error classes Phase 6 throws | `TTSError` (`rh-error-tts`, deferred: `DEFERRED_ERROR_MESSAGE_IDS` in `src/i18n/keys.ts`), `OperationCancelledError`, `BudgetExceededError`, `StorageError`, `ZoteroApiError` in `src/core/errors.ts` | Phase 0–3 |
| Spend guards, privacy, egress, the cost dialog | `withBudget`, `createBudgetGuard` (`src/pipeline/shared/budget.ts`); `loadPrivacyPolicy`, `effectiveMode`, `assertModelAllowed` (`privacyPolicy.ts`); `buildEgressDisclosure`, `EgressNoticeId`, `mustAskConfirmation`, `routineConfirmationFor`, `withEgressLog` (`egressDisclosure.ts`); `L10N_EGRESS_GEMINI_FREE_TIER`, `L10N_EGRESS_GEMINI_DECLARED_PAID` (`src/i18n/keys.ts`); `buildCostDialogModel`, `shouldOpenCostDialog`, `decideCostDialog`, `openCostConfirmDialog` (`src/ui/dialogs/costConfirmDialog.ts`); `confirmRunCost` (`src/bootstrap/registerUI.ts`) | `P3-T15`, `P3-T16`, `P3-T35`, Phase 4 |
| Prices and the estimate | `DOCUMENTED_PRICE_TABLE`, `DOCUMENTED_PRICES_AS_OF`, `costOf`, `UserPriceStore`, `applyUserPriceOverride` (`src/llm/shared/pricing.ts`); `estimateRun`, `secondAcknowledgementFor`, `withHeadroom` (`src/pipeline/shared/estimate.ts`); `estTokens` (`src/llm/shared/tokenEstimate.ts`) | Phase 3 |
| The stored report and its audio fields | `TrendReport.audioScripts`, `TrendReport.audioAttachmentKeys`, `TrendReport.language`, `collectionName`, `scope`, `sections`, `bibliography` (`src/model/trend.ts`); `createReportStore`, `ReportStore` (`put`, `get` only) in `src/zotero/db.ts` | `P4-T01`, `P4-T14` |
| The report note and the library check | `writeReportNote` (a standalone note, never a child), `reportFileWriter`, `isLibraryEditable` in `src/zotero/notes.ts`; `safeBaseName` in `src/pipeline/trendReport/exportMarkdown.ts` | `P4-T14`, `P4-T21` |
| The report's target length | `targetWordsForOutput` in `src/pipeline/trendReport/compose.ts` (`docs/06` §9.2's table) | `P4-T08` |
| The report window and its session | `openReportWindow`, `ReportWindowSession`, `buildReportWindowModel` (`src/ui/panes/reportWindow.ts`); `reportViewModel.ts`; `addon/content/reportWindow.{js,xhtml}`; `createReportWindowSession`, `ReportWindowCommands` (`src/bootstrap/registerUI.ts`) | `P4-T20`, `P4-T21` |
| Collection menu | `collectionMenuOptions` in `src/ui/menus/registerMenus.ts` | Phases 1–5 |
| Pipeline ids, construction and registry | `PipelineId` (already has `"audioReport"`) in `src/pipeline/types.ts`; `PipelineSet` (no `audioReport` member) in `src/pipeline/registry.ts`; `buildPipelineSet`, `PipelineConstructionDeps`, `createZoteroTrendReportLibrary` (the Zotero-read port precedent) in `src/bootstrap/registerPipelines.ts`; `installServices` (`src/bootstrap/container.ts`); `registerProviders` (`src/bootstrap/registerProviders.ts`); `JobNotifier` (`src/core/jobQueue/queue.ts`) | Phases 1–5 |
| Prompts | `PROMPT_IDS`, `PROMPT_FILE_NAMES` (`src/prompts/index.ts`), the add-a-prompt procedure in `src/prompts/bundled.ts`; no audio prompt file exists | Phase 3–4 |
| The fixture recorder's keyed LLM path | `scripts/record-fixtures.ts`: `FIXTURE_MODE=record`, `--source <provider> --live --confirm-spend-usd <x>`, the key read from the environment through `LLM_KEY_ENV_VARS` and nowhere else; LLM fixtures under `test/fixtures/llm/<provider>/` | `P3-T30` |
| The empty pipeline directory | `src/pipeline/audioReport/` (holds only `.gitkeep`) | Phase 0 |

### 0.2 Conventions binding on every card in this file

Items 1–10 of `plan/04` §0.2 apply unchanged (strings and `G-41`; one card adds preference rows; test
locations and the three-run rule; migrations appended; one redaction gate; no live requests; an agent
never holds a key; layering; callers named — `plan/README.md` §5 rule 10; open lines stop a step).
Items 11–18 of `plan/07` §0.2 apply where a card calls an LLM or makes a paid TTS call (budget on every
call; ceilings pause; `cacheEpoch` in keys; prompt text verbatim; the job conventions of item 18, except
where `P6-T16` decides otherwise for resume). Items 24 and 25 of `plan/08` §0.2 apply (a mutation sweep
with every card that adds logic; features hide until they work). In addition:

19. **Keys.** A key is never written to any file, preference or log — not a fixture, not a report,
    not a test snapshot. In the plugin a key comes only from the secret store, which the pane's runtime
    password dialog fills (`docs/09` §1); in a script it comes only from the process environment, and only
    in the owner's run. Every string that can hold a URL or a header passes `redact` or `redactUrl`
    (`src/core/errors.ts`) before it is logged or thrown; every record that is persisted passes
    `redactRecord` (`src/core/provenance.ts`). Gemini's key travels in the `x-goog-api-key` header
    (`GEMINI_API_KEY_HEADER`), never in a `key=` query parameter.
20. **No agent runs a keyed path, and tests make no live call.** Every Phase 6 test replays fixtures or
    synthetic stand-ins; the only live calls are `P6-T04` and `P6-T19`, both the owner's.
21. **What leaves the machine is `docs/09` §3 row 5 as clarified on 2026-11-16.** The script call
    sends the report's sections, the collection's name, counts, the year range and a citation map
    (item key, first-author surname, year) to the provider of `reportModel`; Google's TTS host receives
    the spoken script only. Every notice names **both hosts**. A card that would send anything else
    stops and reports.
22. **Google is called last.** No TTS request is made before the script has passed validation and the
    second confirmation, which shows the real character count (FR-42).
23. **Identical inputs across chunks** (`docs/04` §5.3): one voice, one model and one style prefix,
    captured at the start of a run; a retried chunk is sent byte-identical.
24. **No TTS model ID is compiled in** except the one marked last-resort fallback (`docs/04` §2.2;
    `plan/README.md` §5 rule 4), and no price except in a dated, documented table with a row-by-row
    test, as `DOCUMENTED_PRICE_TABLE` is.

### 0.3 What Phase 6 needs from earlier phases

Phase 6 cards list only Phase 6 IDs in **Depends on**, for the reason `plan/07` §0.3 gives. Each card's
**Notes** starts with the earlier cards it needs. **NOT BUILT** marks a card with no
`plan/reports/<card>.md` on 2026-11-16.

| Earlier card | State | What Phase 6 takes from it | Phase 6 cards |
|---|---|---|---|
| `P0-T25`, `P0-T26` | Built | The measured rate, the response shape, the owner's Korean verdict; `audioStore.ts` | `P6-T05`, `P6-T10`, `P6-T12`, `P6-T13` |
| `P3-T15`, `P3-T16`, `P3-T35` | Built | Privacy, egress disclosure, the cost dialog, the one price source | `P6-T10`, `P6-T15` |
| `P3-T30` | Built | The recorder's keyed LLM path | `P6-T03` |
| `P3-T31` | **NOT BUILT** | Nothing Phase 6 calls; its calibration improves the script call's estimate | `P6-T19` |
| `P4-T14`, `P4-T18`, `P4-T20`, `P4-T21` | Built | The stored report, the report job, the report window | `P6-T07`, `P6-T16`, `P6-T17` |
| `P4-T24`, `P4-T25` | **NOT BUILT** | Nothing directly; Phase 4's sign-off, which `P6-T19` records as it stands | `P6-T19` |
| `P5-T06`, `P5-T29`, `P5-T30`, `P5-T31` | **NOT BUILT** | Nothing. Phase 5 cards edited `registerUI.ts`, `registerPipelines.ts`, `container.ts`, `registerMenus.ts` and `docs/07`, which Phase 6 cards also edit; grep names before editing | `P6-T16`, `P6-T17` |

### 0.4 Decisions of 2026-11-16, and the lines still open

"Owner" decisions cite `plan/00` §6 item 378; "coordinator" decisions were taken under item 313 and
may be overturned by the owner. Each card named carries the decision as a `DECIDED` block or a step.

| Line | Decision | By | Where |
|---|---|---|---|
| 1 | When only an English report exists, the Korean script is written from it in **one call** — a spoken script newly written in Korean, not a sentence-by-sentence translation; titles and venue names stay untranslated | owner, item 378(a) | `P6-T06`, `P6-T08`; `docs/12` §19 item 6 and §14, `docs/04` §9.4 marked 2026-11-16 |
| 2 | No programmatic billing signal: the user is asked once (paid / free / don't know); no answer or "don't know" counts as free; every audio confirmation on such a key shows the free-tier warning; a "paid" answer is not warned again; strict mode makes no audio with a free or unknown key | owner, item 378(b) | `P6-T02`, `P6-T15`; `docs/09` §3.4 rule 4 and §8 item 3 marked 2026-11-16 |
| 3 | v1.0 ships Gemini TTS only; on failure the script is saved as text (FR-43); OpenAI TTS is a later-release candidate, with no cards | owner, item 378(c) | `P6-T14`; §4; `docs/04` §7.5 marked 2026-11-16 |
| 4 | The offline "Read aloud" (`speechSynthesis`, `W6-9`) is not in v1.0; later-release candidate, no cards | owner, item 378(d) | §4; `docs/04` §7.1 marked 2026-11-16 |
| 5 | Primary Gemini surface: **legacy `generateContent` only**; Interactions is a later-release candidate | coordinator | `P6-T05`; `docs/04` §2.1 marked 2026-11-16 |
| 6 | `tts.outputFormat` ships `"wav"`; v1.0 writes WAV only. Import at most 10 MiB, link above, into `tts.linkedFileDir` chosen on first use; the data-directory copy an import leaves is deleted | coordinator | `P6-T02`, `P6-T13`; `docs/04` §6.4 and §10.2, `docs/07` §8.5, `docs/08` §7.3, `docs/13` §8.6 marked 2026-11-16 |
| 7 | The audio is a **standalone attachment in the report's collection**, its key kept in `TrendReport.audioAttachmentKeys`; `P6-T13` checks in Zotero's source whether a note can parent an attachment and records it, and writes a standalone attachment either way | coordinator | `P6-T13`; `docs/04` §10.1 marked 2026-11-16 |
| 8 | Register: conversational, no citation markers read aloud, the written report is the source of record (`docs/10` Q9) | coordinator | `P6-T06`; `docs/10` §5 Q9, `docs/12` §14 marked 2026-11-16 |
| 9 | The Korean script is written natively, not translated (`docs/10` Q10) | coordinator, within item 378(a) | `P6-T08`; `docs/10` §5 Q10 marked 2026-11-16 |
| 10 | `tts.language` `auto` means "the report's `language`"; no per-collection language is stored | coordinator | `P6-T02`, `P6-T08`; `docs/04` §9.4 marked 2026-11-16 |
| 11 | `tts.provider` is not shipped; the pane's audio controls are Phase 7's (`W7-4`); the voice is chosen in the report window's audio section and written back to `tts.voice` | coordinator | `P6-T02`, `P6-T17`; `docs/07` §8.5, `docs/08` §7.3 marked 2026-11-16 |
| 12 | The audio job is its **own `audioReport` job** against a stored report, not a continuation of the report job | coordinator | `P6-T01`, `P6-T16` |
| 13 | Two confirmations: the script call priced from the target length (TTS priced from target minutes, shown as an estimate), then the TTS step with the real character count, chunk count, duration, size, import-or-link and cost; a stored script for that language skips the first | coordinator | `P6-T10`, `P6-T15`, `P6-T16` |
| 14 | Chunks are synthesized **sequentially** and held in memory; cancel discards them; a retry in the same session reuses the finished chunks; no resume after a restart; a content-hashed chunk cache is backlog | coordinator | `P6-T11`, `P6-T16`; §4 |
| 15 | `REPORT_MARKDOWN` is the report's eleven sections, without the bibliography, the retracted list and the appendices; `COLLECTION_NAME` is the name already in the report; `CITATION_MAP` is built from Zotero items through a port | coordinator | `P6-T07` |
| 16 | The retry's correction list is written in English for both languages | coordinator | `P6-T07` |
| 17 | A script outside ±30 % of its target length is a warning shown in the second confirmation, not a reject; marker leaks after the one retry stop before any TTS spend and offer FR-43's save-as-text; Korean numerals are logged, not rejected; no glossary in v1.0 | coordinator | `P6-T07`, `P6-T08`; §4 |
| 18 | The tier answer is a new preference `gemini.tierAnswer` (`""` \| `paid` \| `free` \| `unknown`), asked inside the first audio confirmation; "paid" also sets `gemini.paidTier`; the privacy table governs (strict and balanced refuse a free or unknown key, full warns) | coordinator | `P6-T02`, `P6-T15` |
| 19 | The collection menu gets "Generate Audio Report…", which opens the report window on the collection's newest stored report (a new `ReportStore` lookup) | coordinator | `P6-T16`, `P6-T17` |
| 20 | A hidden preference `audio.enabled`, off until `P6-T19` passes (item 307(d)'s pattern) | coordinator | `P6-T02`, `P6-T19` |
| 21 | TTS prices come from a dated table mirrored from `docs/04` §4.2 with a row test; a user override wins; an unknown model's cost is unknown and forces the confirmation; 25 tok/s is labelled measured only for `gemini-2.5-flash-preview-tts` | coordinator | `P6-T10` |
| 22 | `src/tts/ssml.ts` (named in `docs/07` §4.4 and `docs/11`) becomes `src/tts/chunk.ts`: v1.0 sends plain text, not SSML | coordinator | `P6-T01`, `P6-T09` |
| 23 | Script-call output ceilings: `docs/12`'s 2,500 (English) and 3,500 (Korean) tokens are floors; above the length they cover the ceiling scales with the target | coordinator | `P6-T07` |

**Open lines for the owner.** Each card that depends on one says so; a step that depends on an open
line is not executed on the recommendation (`plan/04` §0.2 item 10).

| Line | Question | Recommendation | Card that stops |
|---|---|---|---|
| 24 | Which secret does TTS read: the chat key `llm.gemini` (the one the pane fills today) or the unused `tts.gemini`? `docs/09` §3.3 says TTS uses the same Gemini key | `llm.gemini`; leave `tts.gemini` unused and note it | `P6-T16` step 2 |
| 25 | A 10-minute WAV is about 28.8 MB, so the typical report is **linked** and does not reach Zotero's mobile apps (`docs/04` §10.4). Accept for v1.0? | Accept; MP3 through Interactions is the later fix | none — `P6-T13` builds the decided rule; the answer may reopen line 6 |
| 26 | Does the declared-paid one-line reminder (item 269(b)) still show on every audio job, given item 378(b)'s "not warned repeatedly"? | Keep it: it is a reminder, not the warning, and costs one line | `P6-T15` step 4 |
| 27 | Balanced mode refuses audio on a free or unknown key, by `docs/09` §3.5's table. Is that what item 378(b) intended, or should balanced warn as full does? | Keep the table (refuse) | none — `P6-T15` builds the table; the answer may change one row |
| 28 | A spend gate for Phase 6's paid runs, modelled on `G-43` (`G-44`)? | Yes, numbered `G-44`; until then `P6-T19` stops before each paid run under `G-07`'s rule | `P6-T19` step 1 |
| 29 | FR-37 also names "a per-paper summary set" as a source. v1.0 builds audio from a trend report only. Accept? | Accept; summary-set audio is backlog (§4) | none |
| 30 | The Korean wording of every new string, including the line that says a Korean script was written from an English report | Through `G-41` as usual | `P6-T17` (Korean bundle only) |
| 31 | `docs/11`'s first DoD line says "Windows and macOS". `G-09` (machines) has a degraded path: ship Windows-tested, mark macOS untested | Run macOS if `G-09` provides a Mac; otherwise record macOS as untested under `G-09`'s degraded path | `P6-T19` step 2 |

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P6-T01` | Reconcile Phase 6 types, files and audio states in `docs/07` | 1.0 | none |
| `P6-T02` | Preference rows Phase 6 reads | 0.5 | none |
| `P6-T03` | Recorder's Gemini TTS path and synthetic stand-ins | 0.75 | none |
| `P6-T04` | Owner-recorded Gemini TTS and script fixtures | 0.25 | **Yes** |
| `P6-T05` | Gemini TTS client: synthesize, model list, voices | 1.5 | none |
| `P6-T06` | `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` prompt files | 0.75 | none |
| `P6-T07` | Script pass: citation map, target, validation, one retry | 1.5 | none |
| `P6-T08` | Korean script path, language default, Korean length check | 0.75 | none |
| `P6-T09` | Chunker: sentence- and paragraph-aware splitting | 0.75 | none |
| `P6-T10` | TTS prices and the two-step audio estimate | 1.25 | none |
| `P6-T11` | Synthesis loop: sequential chunks, budget, cancel | 1.0 | none |
| `P6-T12` | WAV assembly: silence, one header, sample-rate check | 0.75 | none |
| `P6-T13` | Delivery into Zotero: import or link, naming | 1.5 | none |
| `P6-T14` | Failure paths: specific errors, script as text, Save as | 1.0 | none |
| `P6-T15` | Audio confirmation, tier question and both-host disclosure | 1.5 | none |
| `P6-T16` | Audio pipeline: stages, job, wiring | 1.75 | none |
| `P6-T17` | Report window audio section and menu entry | 1.75 | none |
| `P6-T18` | Prove the offline paths end to end on recorded answers | 0.75 | none |
| `P6-T19` | Phase-6 acceptance run against the definition of done | 1.0 | **Yes** |
| | **Total** | **20.00** | 2 gates |

**Entry points** (no `Depends on`): `P6-T01`, `P6-T02`, `P6-T03`, `P6-T06`. They are documents,
preference rows, the recorder and two prompt files; none touches a file another entry point holds,
except that `P6-T01` and `P6-T02` both edit `docs/07` (different sections — exact-string edits).

**Critical path inside the phase:** `P6-T01` → `P6-T05` → `P6-T11` → `P6-T12` → `P6-T13` → `P6-T14` →
`P6-T16` → `P6-T17` → `P6-T18` → `P6-T19`, **12.0 d**, computed by script over the **Depends on** rows.
The script chain (`P6-T06` → `P6-T07` → `P6-T08`, 3.25 d from the start) and the estimate and disclosure
chain (`P6-T09` → `P6-T10` → `P6-T15`, ending at 5.25 d) finish well before `P6-T14` (6.75 d), so a second
agent can carry them in parallel. `P6-T04` needs the owner but blocks only `P6-T18`; it should run early,
and before **2026-12-01** if it is to serve as `docs/04` §4.2's re-verification (`G-29`).

---

## 2. Task cards

### P6-T01 — Reconcile Phase 6 types, files and audio states in `docs/07`

| Field | Value |
|---|---|
| **ID** | `P6-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P6-T05`, `P6-T07`, `P6-T09`, `P6-T11`, `P6-T12`, `P6-T13`, `P6-T16` |
| **Retires** | none |
| **Implements** | part of `FR-37`, part of `FR-41`, part of `FR-42` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `docs/07` declares what Phase 6 passes between stages — the provider contract, the spoken
script, the audio plan and the run's outcome — and the audio job's own state machine; `src/tts/types.ts`
and a new `src/model/audio.ts` hold them.

**Read first.**
- `docs/07-architecture-and-data-model.md` §2.2 (tree), §4.4 (`TTSProvider`), §5.2 (`TrendReport`'s
  audio fields), §6.5 (where the audio goes), §7.4 (cancel semantics), §12.4 (the audio states drawn
  after `Succeeded`, and its "Notes" paragraph) — as declared today
- `src/tts/types.ts` — the spike version, and why `TTSProvider` is absent
- `docs/04-audio-report-tts.md` §2.1 and §10.1 notes of 2026-11-16 — the surface and the placement
- §0.4 lines 7, 12, 13, 14 and 22 — the decisions this card writes into `docs/07`

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§2.2, §4.4, §5.2, §6.5, §7.4, §12.4 and a new §12.6
  for the audio job; dated notes first)
- modify `docs/11-implementation-roadmap.md` (Phase 6 "Modules touched": `ssml.ts` → `chunk.ts`; dated note)
- modify `src/tts/types.ts` (add `TTSProvider`, `AudioArtifact.usage`, the chunk and plan shapes the
  provider layer needs; keep every spike export, which `scripts/spike-tts-korean.ts` imports)
- create `src/model/audio.ts` (types only: `SpokenScript`, `AudioPlan`, `AudioRunInput`,
  `AudioRunOutcome`; callers: `src/pipeline/audioReport/*` from `P6-T07`–`P6-T16`,
  `src/ui/viewModels/reportViewModel.ts` from `P6-T17`)

**Do.**
1. §4.4: declare `TTSProvider` as `src/tts/types.ts` will hold it, with `maxInputChars` "split by
   `src/tts/chunk.ts`" (§0.4 line 22). Keep `TtsProviderId`'s three members — the comment in §4.4 says
   why — and add a dated note that v1.0 implements `gemini` alone (owner, item 378(c)) and that
   `system` and `openai` have no implementation. Add `usage` to `AudioArtifact` in the source, where
   the spike left it out.
2. §5.2: declare in a new block `SpokenScript` (text, language, the language of the report it was
   written from, word or syllable count, validation warnings), `AudioPlan` (chunks with their character
   counts, voice, model, estimated seconds, estimated bytes, `"import" | "link"`, cost estimate) and
   `AudioRunOutcome` (attachment key, mode, file name, seconds, bytes, usage). State that
   `TrendReport.audioScripts[lang]` stores the validated script and `audioAttachmentKeys[lang]` the
   newest attachment's key, both written through `ReportStore.put`.
3. §6.5: replace "child attachment of the report note" with the decision of §0.4 line 7, dated, and say
   that `P6-T13` records whether a note can parent an attachment at all.
4. §12.4 and a new §12.6: the audio states move from the report job to an `audioReport` job of their
   own (decided below): `Queued → Scripting → AwaitingConfirm → Synthesizing → Assembling → Attaching →
   Succeeded`, with `Cancelling → Cancelled` from any state before `Attaching`, `Failed` with the
   script kept, and no `Interrupted → resume` edge (§0.4 line 14). §7.4's "partial audio segments are
   discarded" stays.
5. §2.2: `src/tts/ssml.ts` → `src/tts/chunk.ts`; add `src/tts/geminiTts.ts`,
   `src/tts/pricing.ts`, `src/zotero/attachments.ts` and the `src/pipeline/audioReport/` files named
   by `P6-T07`–`P6-T16`.

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** the audio job's identity.
> `docs/07` §12.4's note says audio "is modelled as a continuation of the report job … it can still be
> triggered later against a stored `TrendReport`". The report job is built and ends when its note is
> written (`P4-T18`), the report window opens before any report exists, and `PipelineId` already has
> `"audioReport"`. **Audio is its own `audioReport` job, always run against a stored `TrendReport` by
> id and language**; the report's identity, language and citations flow through the stored record,
> which is what the note's reason asked for. (§0.4 line 12.)

**Do NOT.**
- Do **not** import `pipeline/`, `tts/`, `llm/` or `core/` from `src/model/audio.ts`.
- Do **not** narrow `TtsProviderId`; do not remove a spike export from `src/tts/types.ts` (grep its
  importers first, `plan/README.md` §4 "Files").
- Do **not** declare a type in `docs/04` or `docs/12`; `docs/07` is the sole authority.

**Done when.**
- [ ] `docs/07` §2.2, §4.4, §5.2, §6.5, §12.4 and §12.6 carry dated notes and match the declarations.
- [ ] `src/model/audio.ts` exports only types and imports only `src/model/`.
- [ ] `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npx eslint .
```

**Notes.** Needs: `P0-T25`, `P0-T26`, `P4-T01`. Callers of what it declares: `src/tts/geminiTts.ts`
(`P6-T05`), `src/pipeline/audioReport/*` (`P6-T07`–`P6-T16`), `reportViewModel.ts` (`P6-T17`). Types
only, so no test file; the cards that use the shapes pin them.

---

### P6-T02 — Preference rows Phase 6 reads

| Field | Value |
|---|---|
| **ID** | `P6-T02` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P6-T07`, `P6-T08`, `P6-T13`, `P6-T15`, `P6-T16`, `P6-T17` |
| **Retires** | none |
| **Implements** | part of `FR-38`, part of `FR-42` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The rows Phase 6 reads exist, as decided on 2026-11-16, in `docs/07` §8.5, `PREFS`,
`PREF_KEYS` and (where `docs/01` §7.2 lists them) `addon/prefs.js`.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5 "Report & audio" rows and the note of 2026-11-16 under
  them — what changes and why
- `docs/09-security-privacy-and-api-keys.md` §3.4 rule 4's note of 2026-11-16 — the tier answer
- `plan/08` `P5-T02` — the last rows card, and the hidden-row precedent

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§8.5 rows; dated note)
- modify `src/prefs/schema.ts`, `src/prefs/keys.ts`
- modify `addon/prefs.js` (only rows `docs/01` §7.2 lists; the others fall back to the schema default)
- modify `test/unit/prefs/schema.test.ts` (`SECTION_8_5` and the D5 block)

**Do.**
1. Documents first. In `docs/07` §8.5: strike `tts.provider` (§0.4 line 11); keep `tts.outputFormat`
   with `wav` its only allowed value (§0.4 line 6); clear the ⚠ on `tts.language` (`auto` follows the
   report's `language`, §0.4 line 10) and on `tts.linkedFileDir` (name confirmed, asked on first use,
   never logged); add `gemini.tierAnswer` — string, default `""`, values `""` \| `paid` \| `free` \|
   `unknown` (§0.4 line 18) — and the hidden `audio.enabled` — boolean, `false` (§0.4 line 20).
2. Add `tts.voice`, `tts.language`, `tts.model`, `tts.targetMinutes`, `tts.outputFormat`,
   `tts.linkedFileDir`, `gemini.tierAnswer` and `audio.enabled` to `PREFS` and `PREF_KEYS` with the
   ranges §8.5 states (`tts.targetMinutes` `0` or 1–60); extend the schema test, including the D5
   block (no row's name or default can hold a credential).

**Do NOT.**
- Do **not** add a row `docs/07` §8.5 does not declare first.
- Do **not** ship any TTS model ID as a default: `tts.model` stays `""` (`docs/04` §2.2).
- Do **not** log `tts.linkedFileDir`'s value; it is a local path (`docs/09` §2.2's rule for paths).

**Done when.**
- [ ] Every row named in step 2 is in `docs/07` §8.5, `PREFS` and `PREF_KEYS`, and the schema test
      covers it.
- [ ] `tts.provider` is in none of the three.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit -- prefs` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- prefs
```

**Notes.** Needs: nothing built beyond §0.1. Callers of the rows: `P6-T07` (`tts.targetMinutes`),
`P6-T08` (`tts.language`), `P6-T13` (`tts.linkedFileDir`), `P6-T15` (`gemini.tierAnswer`,
`gemini.paidTier`), `P6-T16` (`audio.enabled`, `tts.voice`, `tts.model`), `P6-T17`; all read through
`getPref` in `src/bootstrap/` or a pipeline's injected settings, as Phase 5's rows are.

---

### P6-T03 — Recorder's Gemini TTS path and synthetic stand-ins

| Field | Value |
|---|---|
| **ID** | `P6-T03` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P6-T04`, `P6-T05` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `scripts/record-fixtures.ts` can record Gemini TTS and audio-script responses on the owner's
machine with the key in the environment, and every scenario already has a synthetic stand-in under its
fixture key, so `P6-T05` and `P6-T07` can be tested before the owner records.

**Read first.**
- `scripts/record-fixtures.ts` — the keyed LLM path (`runLlmRecorder`, `LLM_KEY_ENV_VARS`, `--live`,
  `--confirm-spend-usd`), read by name with Grep: the file holds the maintainer's contact address, and
  a tool hook refuses a whole-file read of it
- `docs/13-testing-build-and-release.md` §3.1 (inventory) and §3.4 (recording rules)
- `docs/04-audio-report-tts.md` §2.3–§2.4 — the legacy request and response
- `plan/08` `P5-T04` and `P5-T31` — the stand-in-first pattern and the owner's recording card

**Files.**
- modify `scripts/record-fixtures.ts` (a `gemini-tts` source; two audio-script scenarios on the LLM path)
- create `test/fixtures/tts/gemini/` (one stand-in and one `_meta.json` sidecar with `"synthetic": true`
  per scenario)
- modify `test/unit/scripts/recordFixturesRedaction.test.ts` (the new source's redaction)
- modify `docs/13-testing-build-and-release.md` (§3.1 rows; dated note)

**Do.**
1. A `gemini-tts` source behind the existing opt-ins (`FIXTURE_MODE=record`, `--live`,
   `--confirm-spend-usd`), its key read from `GEMINI_API_KEY` through `LLM_KEY_ENV_VARS` and from
   nowhere else, sent only as the `x-goog-api-key` header. Scenarios: `tts-en-short` (one English
   sentence, about 3 s, voice `Charon`); `tts-ko-short` (one Korean sentence with one embedded English
   term); `models-list` (the TTS entries of `GET /v1beta/models`); `error-unknown-model` (a model ID
   that does not exist); `error-invalid-key` (the real key with one character appended). `error-429`
   and `no-audio-part` cannot be provoked on purpose and stay synthetic.
2. Two scenarios on the LLM path, `audio-script-en` and `audio-script-ko`, sending the bundled prompts
   (`P6-T06`) over a small synthetic report, on the owner's `reportModel` provider. If `P6-T06` has not
   landed, write the scenarios against its file names and mark them pending.
3. `--dry-run` prints every scenario, the request count and the spend estimate from the documented
   prices, without a key.
4. A stand-in per scenario under the fixture key the recorder will write, with a sidecar saying
   `"synthetic": true` and why. Audio stand-ins hold a short generated PCM tone, base64-encoded; a test
   tells a stand-in from a recording by its sidecar.
5. The redaction test: no fixture or sidecar the new source writes can contain `x-goog-api-key`, a
   `key=` parameter or the key's value (a fake key in the test).

**Do NOT.**
- Do **not** run the live path, read `GEMINI_API_KEY` or `OPENROUTER_API_KEY`, or print either.
- Do **not** store long audio: keep each recorded body under 300 KB (a few seconds of speech).

**Done when.**
- [ ] `--dry-run` for `gemini-tts` lists its scenarios and an estimate, and exits 0 without a key.
- [ ] Every scenario has a stand-in and a `"synthetic": true` sidecar.
- [ ] `npm run test:unit -- recordFixtures` passes; `docs/13` §3.1 lists the scenarios.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- recordFixtures
```

**Notes.** Needs: `P3-T30`. Caller: the owner's run in `P6-T04`; the stand-ins are read by
`test/contract/tts/geminiTts.contract.test.ts` (`P6-T05`) and `test/unit/pipeline/audioScript.test.ts`
(`P6-T07`).

---

### P6-T04 — Owner-recorded Gemini TTS and script fixtures

| Field | Value |
|---|---|
| **ID** | `P6-T04` |
| **State** | `TODO` |
| **Depends on** | `P6-T03` |
| **Blocks** | `P6-T18` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — the owner runs `P6-T03`'s recording with `GEMINI_API_KEY` and the `reportModel` provider's key in the process environment, after approving the stated spend: two billed TTS calls of about 3 s each (about 75 audio tokens each, under $0.001 at `docs/04` §4.2's prices) and two script calls on the owner's `reportModel` (`--dry-run` prints their estimate); expected under $0.10 in all, with `--confirm-spend-usd 0.25` as the cap. The agent never sees a key. |

**Goal.** Every scenario `P6-T03` lists has a fixture recorded by the owner, checked by the agent, and
the audio token rate is read again from the recorded bodies.

**Read first.**
- `P6-T03` steps 1–2 — the scenarios and the opt-ins
- `docs/04-audio-report-tts.md` §4.2 — how the rate was measured, and the 2026-12-01 re-verification
- `plan/06` `G-06`, `G-29` — the free-tier terms and the calibration gate

**Files.**
- modify `test/fixtures/tts/gemini/` and `test/fixtures/llm/<provider>/` (the owner's run writes them;
  the agent commits them after the checks)
- modify `docs/13-testing-build-and-release.md` (§3.1 rows; dated note)
- modify `docs/04-audio-report-tts.md` (§4.2: the rate read from these bodies; dated note)

**Do.**
1. Print for the owner the exact commands, the `--dry-run` output and the expected spend; stop at
   the gate.
2. After the run: check that every scenario has a fixture, or a stand-in still marked synthetic with
   its reason; grep the new files for `x-goog-api-key`, `key=` and `Bearer`; read each TTS body's
   `mimeType` and `usageMetadata.candidatesTokenCount`, decode the PCM length, and compute tokens per
   second for the model the run used.
3. Write that figure into `docs/04` §4.2 under a dated note, naming the model and the seconds. If the
   run is before 2026-12-01 and on the model §4.2 names, say that it is the re-verification `G-29` asks
   for; otherwise say what it is not.

**Do NOT.**
- Do **not** ask for, read, print or store a key; do not run the keyed path.
- Do **not** replace a synthetic stand-in with a hand-made "real" body.

**Done when.**
- [ ] Every scenario of `P6-T03` has a committed fixture or a stand-in with its reason.
- [ ] `grep -rliE "x-goog-api-key|key=|Bearer" test/fixtures/tts` prints nothing.
- [ ] `docs/04` §4.2 records the rate read here, with the model and the date.

**Verify with.**
```bash
npm run test:contract && ! grep -rliE "x-goog-api-key|key=|Bearer" test/fixtures/tts
```

**Notes.** The 0.25 d is the agent's checking and inventory work; the owner's time is the gate. Kept
apart from `P6-T03` so that only `P6-T18` waits on the owner (`plan/08` `P5-T31`'s reasoning). Caller
of what it records: the contract and pipeline tests of `P6-T05`, `P6-T07` and `P6-T18`.

---

### P6-T05 — Gemini TTS client: synthesize, model list, voices

| Field | Value |
|---|---|
| **ID** | `P6-T05` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T03` |
| **Blocks** | `P6-T10`, `P6-T11`, `P6-T15`, `P6-T16` |
| **Retires** | part of `R-8` |
| **Implements** | `FR-37`, part of `FR-38` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** `src/tts/geminiTts.ts` implements `TTSProvider` over the legacy `generateContent` path: it
synthesizes one chunk into PCM with usage, resolves the TTS model from the live list, lists the voices,
and maps every failure to a specific error.

**Read first.**
- `docs/04-audio-report-tts.md` §2.1's note of 2026-11-16, §2.2 (never hardcode), §2.3–§2.4 (request
  and response), §2.7 (voices), §6.2 (`ttsChunk`: check the status before parsing)
- `docs/07-architecture-and-data-model.md` §4.4 as `P6-T01` leaves it
- `src/llm/gemini/geminiProvider.ts` (`geminiHeaders`, `GEMINI_HOST`, `MODELS_PATH`) and `mapper.ts`
  (`TTS_MODEL_ID`, `readModelList`) — reuse, do not copy
- `docs/03-llm-provider-integration.md` §11.5–§11.6 — the error taxonomy and retry-after

**Files.**
- create `src/tts/geminiTts.ts` (`createGeminiTts`; callers: `src/pipeline/audioReport/synthesize.ts`
  (`P6-T11`) and the voice list in `P6-T16`'s session; constructed in `src/bootstrap/registerProviders.ts`)
- modify `src/bootstrap/registerProviders.ts` (construct it beside the Gemini chat provider; not yet
  passed to a pipeline)
- modify `src/llm/gemini/mapper.ts` (a `readTtsModelList` beside `readModelList`, sharing `TTS_MODEL_ID`)
- create `test/unit/tts/geminiTts.test.ts`
- create `test/contract/tts/geminiTts.contract.test.ts` (replays `P6-T03`'s stand-ins, later `P6-T04`'s recordings)

**Do.**
1. `synthesize(request, ctx)`: one `POST /v1beta/models/{model}:generateContent` through
   `src/core/http/client.ts`'s JSON path, `responseModalities: ["AUDIO"]`, the voice in
   `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`, the key only in `x-goog-api-key`
   (`geminiHeaders`). Check the HTTP status before parsing. Return an `AudioArtifact` with the decoded
   PCM, the sample rate from the `mimeType` (`pcmFormatFromMimeType`), the model, the voice and `usage`
   from `usageMetadata`.
2. A 200 with no `inlineData` part, or a `mimeType` that is not 16-bit PCM, is a `TTSError` with its own
   reason, never a generic one. Map 401/403 (key or entitlement), 404 (model gone), 429 (with
   `retry-after`) and 5xx through the existing taxonomy; every message passes `redact`.
3. `resolveModel()`: `tts.model` if set; otherwise `docs/04` §7.5's current recommendation if the live
   list (`GET /v1beta/models`, filtered by `TTS_MODEL_ID`) contains it; otherwise the first TTS model in
   the list. One ID may be compiled in, as the last-resort fallback when the list fetch fails, marked
   with a comment naming `docs/04` §2.2 (§0.2 item 24).
4. `listVoices(language)`: `docs/04` §2.7's documented list as `VoiceInfo`s, as `docs/07` §8.5 says
   ("ship them as a default list and validate the stored `tts.voice` against a real test call" — the
   real call is `P6-T19`'s). `validateCredentials` makes no billed call: it reads the model list.
5. `maxInputChars` from `docs/04` §5.2's upper targets (900 English, 450 Korean characters), exported as
   constants the chunker reads.

**Do NOT.**
- Do **not** build the Interactions path (§0.4 line 5), or send `store`, `language` or `response_format`.
- Do **not** put the key in a URL, a log line, an error message or a fixture.
- Do **not** retry inside `synthesize`; `P6-T11` owns retries, with identical inputs.

**Done when.**
- [ ] The contract test parses `tts-en-short` and `tts-ko-short` into PCM of the length the base64
      decodes to, with `sampleRateHz` 24000 and the output token count equal to `candidatesTokenCount`.
- [ ] `error-invalid-key`, `error-unknown-model`, `error-429` and `no-audio-part` each give their own
      error class or reason, and no thrown message contains the test key.
- [ ] `grep -rnE "preview-tts|tts-preview" src` finds exactly one ID, on the marked fallback line.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- geminiTts && npm run test:contract -- geminiTts
```

**Notes.** Needs: `P0-T25` (the measured response shape), Phase 3's Gemini provider. Which secret it
reads is a constructor argument, so this card does not wait for §0.4 line 24; `P6-T16` passes it.

---

### P6-T06 — `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` prompt files

| Field | Value |
|---|---|
| **ID** | `P6-T06` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P6-T07`, `P6-T08` |
| **Retires** | none |
| **Implements** | part of `FR-38`, part of `FR-39` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** The two audio prompts ship as bundled prompt files, verbatim from `docs/12` §13 and §14, and
the prompt registry serves them.

**Read first.**
- `docs/12-prompt-library.md` §13, §14 (with the notes of 2026-11-16) and §17 (versioning)
- `src/prompts/index.ts` (`PROMPT_IDS`, `PROMPT_FILE_NAMES`) and `src/prompts/bundled.ts` — the
  add-a-prompt procedure

**Files.**
- create `src/prompts/audio-script-en.v1.0.0.md`, `src/prompts/audio-script-ko.v1.0.0.md` (caller:
  `src/pipeline/audioReport/script.ts`, `P6-T07`; served by `createPromptRegistry`, constructed in
  `installServices`)
- modify `src/prompts/index.ts`, `src/prompts/bundled.ts`
- modify `test/unit/prompts/registry.test.ts` (its verbatim check, which the other prompts have)

**Do.**
1. Add `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` to `PROMPT_IDS` and their files to the registry, by the
   procedure `bundled.ts` documents, with `docs/12`'s versions, temperature 0.4 and the documented output
   ceilings (2,500 and 3,500 tokens; `P6-T07` scales them, §0.4 line 23).
2. The system and user prompts are copied verbatim; the verbatim test compares them with `docs/12`.

**Do NOT.**
- Do **not** reword a prompt; a wording change is a `docs/12` change first, and Korean wording is the
  owner's (`docs/12` §19 item 4).
- Do **not** give either prompt a JSON schema: the output is plain text.

**Done when.**
- [ ] `createPromptRegistry` returns both prompts by id, and the verbatim test passes.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit -- prompts` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- prompts
```

**Notes.** Needs: Phase 3's registry. The register (§0.4 line 8) is already in both prompts' rules.

---

### P6-T07 — Script pass: citation map, target, validation, one retry

| Field | Value |
|---|---|
| **ID** | `P6-T07` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T02`, `P6-T06` |
| **Blocks** | `P6-T08`, `P6-T10`, `P6-T14`, `P6-T16` |
| **Retires** | none |
| **Implements** | `FR-39`, part of `FR-38` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Given a stored `TrendReport` and a language, `src/pipeline/audioReport/script.ts` builds the
prompt inputs, makes the one script call through the router on `reportModel`, validates the result,
retries once with the failures listed, and returns a `SpokenScript` or a specific failure.

**Read first.**
- `docs/04-audio-report-tts.md` §8.1 (what the rewrite must do), §8.4 (use `reportModel`), §8.5
  (`LEAKS`, `validateScript`, one retry), §12 item 1 (`targetMinutes = round(reportTargetWords / 300)`,
  clamped 1–60)
- `docs/12-prompt-library.md` §13 — input variables, the marker rejects, the ±30 % length band
- `src/pipeline/trendReport/compose.ts` (`targetWordsForOutput`) — the report's target, not its length
- `docs/09-security-privacy-and-api-keys.md` §3 row 5's clarification of 2026-11-16

**Files.**
- create `src/pipeline/audioReport/script.ts` (`buildScriptInputs`, `validateScript`, `writeScript`;
  caller: `src/pipeline/audioReport/audioReportPipeline.ts`, `P6-T16`)
- create `src/pipeline/audioReport/citationMap.ts` (`citationMapFor`; caller: `script.ts`; its Zotero
  read is a port, built in `src/bootstrap/registerPipelines.ts` by `P6-T16`)
- create `test/unit/pipeline/audioScript.test.ts`
- modify `docs/12-prompt-library.md` (§13 "Expected output" and §13–§14 "Model / temperature": the
  decisions below; dated notes first)

**Do.**
1. `buildScriptInputs(report, language)`: `REPORT_MARKDOWN` from `report.sections` (§0.4 line 15);
   `COLLECTION_NAME` from `report.collectionName`; `N_ANALYSED`, `YEAR_MIN`, `YEAR_MAX` from
   `report.scope`; `TARGET_MINUTES` from `tts.targetMinutes`, or, when it is `0`,
   `round(targetWordsForOutput(…) / 300)` clamped to 1–60 — never `0` into the template.
2. `citationMapFor(itemKeys)`: one line per item cited as `[[itemKey]]` in the sections —
   `itemKey → "Surname and colleagues, Year"` (the surname alone for one author) — from Zotero item data
   through a port; an item that cannot be read maps to nothing and is logged by key, not by title.
3. The call goes through `withBudget` and `withEgressLog` on the `strong` purpose (`reportModel`), at
   temperature 0.4, with the output ceiling of §0.4 line 23.
4. `validateScript(text, language)`: the union of `docs/04` §8.5's `LEAKS` and `docs/12` §13's rejects
   (`[[`, `##`, `|`, `**`, a backtick, `http`). On any leak, one retry with the failures appended in
   English (§0.4 line 16); a leak after the retry returns a `ScriptRejected` failure that `P6-T14` turns
   into the FR-43 offer, and no TTS call follows. Length outside ±30 % of `TARGET_MINUTES × 150` words
   is a warning on the `SpokenScript` (§0.4 line 17).
5. The validated script is returned, not stored; `P6-T16` writes it to `audioScripts[language]`.

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** what the script call is sent.
> `docs/12` §13 names `REPORT_MARKDOWN` "the final report", which in a stored report includes the
> numbered bibliography, the retracted list and the appendices — material a listener never hears and
> that only feeds `et al.` and DOI leaks. **The eleven sections only; the collection's name as the
> report run already sent it; the citation map from Zotero items.** No new kind of content leaves the
> machine (§0.2 item 21). (§0.4 line 15.)

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** length is a warning. `docs/12` §13
> lists the ±30 % word band beside the marker rejects. A long or short script is still listenable, and
> the second confirmation shows its real duration and cost before anything is spent. **Out-of-band length
> is a warning shown there; only marker leaks are rejected.** `docs/12` §13's "Expected output" gets a
> dated note. (§0.4 line 17.)

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** the output ceiling. `docs/12`'s
> 2,500 tokens cover about 10 minutes of English script, and `tts.targetMinutes` allows 60. **The
> documented figure is a floor; above the length it covers, the ceiling is the target's word (or
> syllable) count converted by `estTokens`'s ratio, plus the 30 % band, and the call's estimate uses the
> same figure.** `docs/12` §13 and §14 "Model / temperature" get dated notes. (§0.4 line 23.)

**Do NOT.**
- Do **not** send the summaries, the abstracts or the bibliography (§0.2 item 21).
- Do **not** use `summaryModel`: `docs/04` §8.4 says why.
- Do **not** strip markers in code and call the result a script: a leak is a failed rewrite (`docs/12`
  §13, "This is a rewrite, not a strip").

**Done when.**
- [ ] A synthetic report citing `[[k1]]`…`[[k5]]` produces a citation map of five lines and a prompt
      whose `REPORT_MARKDOWN` holds no bibliography line.
- [ ] A first answer with `##` and `[12]` triggers exactly one retry naming both; a second leak returns
      `ScriptRejected` with no further call.
- [ ] `tts.targetMinutes` `0` with a 3,000-word target gives `TARGET_MINUTES` 10; the clamp holds at 1 and 60.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioScript
```

**Notes.** Needs: `P4-T14` (the stored report), Phase 3's router and budget. Caller:
`audioReportPipeline.ts` (`P6-T16`). Tests use `P6-T03`'s `audio-script-en` stand-in until `P6-T04`
records it.

---

### P6-T08 — Korean script path, language default, Korean length check

| Field | Value |
|---|---|
| **ID** | `P6-T08` |
| **State** | `TODO` |
| **Depends on** | `P6-T02`, `P6-T06`, `P6-T07` |
| **Blocks** | `P6-T16` |
| **Retires** | part of `R-8` |
| **Implements** | `FR-38` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A Korean script is written by `AUDIO_SCRIPT_KO` from the Korean report when one exists and
from the English report otherwise, in one call, with Korean's own length check, and the run says which
source it used.

**Read first.**
- `docs/04-audio-report-tts.md` §9.1–§9.4 (with the notes of 2026-11-16) — terms, numbers, length,
  the language default
- `docs/12-prompt-library.md` §14 — the Korean length rule (`TARGET_MINUTES × ~330` Hangul syllables,
  ±30 %) and its notes
- `plan/01` `P0-T25` — the owner's verdict on a script without the mitigations

**Files.**
- modify `src/pipeline/audioReport/script.ts` (the Korean branch, `resolveAudioLanguage`)
- create `src/pipeline/audioReport/korean.ts` (`countHangulSyllables`, `countArabicNumerals`; caller:
  `script.ts`)
- modify `test/unit/pipeline/audioScript.test.ts`; create `test/unit/pipeline/audioKorean.test.ts`

**Do.**
1. `resolveAudioLanguage(pref, report)`: `tts.language` `auto` → the report's `language`; `en` or `ko`
   as set; the run's choice in the window overrides both (§0.4 line 10).
2. Source: for `ko`, the run's stored Korean report if one exists (a `both` run stores two, `P4-T21`),
   else the English report, with `SpokenScript.sourceLanguage` set; the window shows "written from the
   English report" from it (`P6-T17`). One call either way (§0.4 line 1).
3. Korean length: Hangul syllables (U+AC00–U+D7A3) against `TARGET_MINUTES × 330`, ±30 %, as a warning
   (§0.4 line 17); the English word band is never applied to Korean.
4. Arabic numerals left in a Korean script are counted and logged at `info` with the count, not
   rejected; the acceptance run reads the log (`P6-T19`).

**Do NOT.**
- Do **not** generate a Korean report first (item 378(a)).
- Do **not** add a glossary or a pronunciation table (§0.4 line 17; §4).
- Do **not** send English text to the TTS call when Korean is chosen (FR-38).

**Done when.**
- [ ] An English-only report with `ko` makes one `AUDIO_SCRIPT_KO` call over the English sections and
      returns `sourceLanguage: "en"`; a `both` run's Korean report is used when present.
- [ ] `countHangulSyllables` is exact on a fixed sample, and the band check uses it.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioScript audioKorean
```

**Notes.** Needs: `P4-T21` (two reports from one run). Caller: `audioReportPipeline.ts` (`P6-T16`).
How a `both` run's two stored reports are found from one of them is read from `P4-T21`'s report before
coding; if no link between them is stored, this card uses the report it was given and says so in its
report.

---

### P6-T09 — Chunker: sentence- and paragraph-aware splitting

| Field | Value |
|---|---|
| **ID** | `P6-T09` |
| **State** | `TODO` |
| **Depends on** | `P6-T01` |
| **Blocks** | `P6-T10`, `P6-T11` |
| **Retires** | none |
| **Implements** | part of `FR-41` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `src/tts/chunk.ts` splits a validated script into chunks on paragraph, then sentence,
boundaries, within the language's size targets, never mid-sentence.

**Read first.**
- `docs/04-audio-report-tts.md` §5.1–§5.2 (`chunkScript`, `splitSentences`, the abbreviation guard,
  600–900 English and 300–450 Korean characters), §5.3 (paragraph boundaries)
- `docs/07-architecture-and-data-model.md` §4.4 — `maxInputChars`, as `P6-T01` leaves it

**Files.**
- create `src/tts/chunk.ts` (`chunkScript`, `splitSentences`; callers: `src/pipeline/audioReport/estimate.ts`
  (`P6-T10`) and `src/pipeline/audioReport/synthesize.ts` (`P6-T11`))
- create `test/unit/tts/chunk.test.ts`

**Do.**
1. Port `docs/04` §5.2's two functions to TypeScript, with the size targets read from `P6-T05`'s
   constants if they have landed, else declared here and moved by `P6-T05`.
2. A single sentence longer than the upper target is split at the last clause break before the limit
   (a comma or semicolon) and logged; never at a character count alone unless no break exists.
3. Korean sentence ends are `.`, `?` and `!`; the abbreviation guard applies to English only.

**Do NOT.**
- Do **not** carry text from one chunk into the next (`docs/04` §5.3, "Do not include cross-chunk context").
- Do **not** emit SSML or markup (§0.4 line 22).

**Done when.**
- [ ] Joining the chunks with their separators reproduces the script exactly.
- [ ] No chunk exceeds the language's upper target on a 1,500-word English and a 4,000-syllable Korean
      sample; no English chunk ends inside "et al." or "e.g.".
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- chunk
```

**Notes.** Needs: nothing built beyond §0.1.

---

### P6-T10 — TTS prices and the two-step audio estimate

| Field | Value |
|---|---|
| **ID** | `P6-T10` |
| **State** | `TODO` |
| **Depends on** | `P6-T05`, `P6-T07`, `P6-T09` |
| **Blocks** | `P6-T15`, `P6-T16` |
| **Retires** | none |
| **Implements** | part of `FR-42` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** `src/pipeline/audioReport/estimate.ts` prices an audio run twice — before the script exists,
from the target length, and after, from the real script — in characters, chunks, seconds, bytes,
import-or-link and dollars, from one dated TTS price table.

**Read first.**
- `docs/04-audio-report-tts.md` §4.2 (prices; the measured 24.998 tok/s and the model it was measured
  on), §11 (worked example), §6.4's note of 2026-11-16 (show the size)
- `src/llm/shared/pricing.ts` — `DOCUMENTED_PRICE_TABLE`, its as-of date and its row test; `costOf`;
  `UserPriceStore`
- `src/pipeline/shared/estimate.ts` — `estimateRun`, `secondAcknowledgementFor`, `withHeadroom`

**Files.**
- create `src/tts/pricing.ts` (`DOCUMENTED_TTS_PRICE_TABLE`, `TTS_PRICES_AS_OF`, `AUDIO_TOKENS_PER_SECOND`,
  `ttsCostOf`; callers: `src/pipeline/audioReport/estimate.ts` and `synthesize.ts`)
- create `src/pipeline/audioReport/estimate.ts` (`estimateScriptStep`, `estimateAudioPlan`; caller:
  `audioReportPipeline.ts`, `P6-T16`)
- create `test/unit/tts/pricing.test.ts`, `test/unit/pipeline/audioEstimate.test.ts`
- modify `docs/04-audio-report-tts.md` (§11: the estimate as built; dated note)

**Do.**
1. `DOCUMENTED_TTS_PRICE_TABLE`: `docs/04` §4.2's three rows with their as-of date, and a row-by-row test
   against the document, as `DOCUMENTED_PRICE_TABLE`'s test does. A user override in `UserPriceStore`
   wins; a model with neither is **unknown cost** (§0.4 line 21).
2. `AUDIO_TOKENS_PER_SECOND = 25`, labelled measured for `gemini-2.5-flash-preview-tts` only; for any
   other model the estimate carries a flag the dialog shows ("rate measured on another model").
3. `estimateScriptStep`: the script call's input from `estTokens` of the prompt and its output from the
   ceiling (`P6-T07`), priced by `costOf`; plus a TTS estimate from `TARGET_MINUTES`, marked as an
   estimate to be replaced.
4. `estimateAudioPlan(script, chunks, model, voice)`: characters, chunk count, seconds from the
   language's speaking rate (150 words or 330 syllables a minute), output tokens = seconds × the rate,
   input tokens from `estTokens` of each chunk plus the style prefix, bytes = seconds × 48,000 plus
   `WAV_HEADER_BYTES`, `chooseAttachmentMode(bytes)`, and the cost by `ttsCostOf`, through
   `withHeadroom`.
5. `secondAcknowledgementFor` applies unchanged: an estimate above `summary.confirmAboveCents`, an unknown
   cost or a ceiling the estimate would pass forces the dialog (`docs/09` §3.6).

**Do NOT.**
- Do **not** compile a price anywhere but the dated table (§0.2 item 24).
- Do **not** show a per-minute figure as a quote for a model whose rate is not measured.

**Done when.**
- [ ] The row test fails if a `docs/04` §4.2 price changes without the table.
- [ ] `docs/04` §11's worked example (a 1,500-word, 10-minute English script) reproduces its tokens and
      dollars within the headroom on `gemini-2.5-flash-preview-tts`, and reports `"link"` for its 28.8 MB.
- [ ] An unknown model gives unknown cost and forces the confirmation.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- pricing audioEstimate
```

**Notes.** Needs: `P3-T35` (the price source). `P3-T31` (NOT BUILT) would calibrate the script call;
until then it uses `P3-T13`'s ratios, as every other call does.

---

### P6-T11 — Synthesis loop: sequential chunks, budget, cancel

| Field | Value |
|---|---|
| **ID** | `P6-T11` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T05`, `P6-T09` |
| **Blocks** | `P6-T12`, `P6-T16` |
| **Retires** | none |
| **Implements** | `FR-41`, part of `FR-42` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `src/pipeline/audioReport/synthesize.ts` sends the chunks one at a time with identical
inputs, reserves and settles budget per chunk, retries a failed chunk unchanged, reports "chunk n of N",
and on cancel aborts the request in flight and drops every finished chunk.

**Read first.**
- `docs/04-audio-report-tts.md` §5.3 (consistency rules, `STYLE_PREFIX`), §5.4 (sequential, or at most
  two at once), §6.3 (one sample rate, or fail)
- `docs/07-architecture-and-data-model.md` §7.4 (audio cancel), §7.5 (pauses), and §12.6 as `P6-T01`
  writes it
- `src/pipeline/shared/budget.ts` — `withBudget`'s reserve and settle

**Files.**
- create `src/pipeline/audioReport/synthesize.ts` (`synthesizeChunks`; caller: `audioReportPipeline.ts`,
  `P6-T16`)
- create `test/unit/pipeline/audioSynthesize.test.ts`
- modify `docs/04-audio-report-tts.md` (§5.4: the decision below; dated note first)

**Do.**
1. Capture voice, model and `STYLE_PREFIX` once; send `STYLE_PREFIX + chunk` for each chunk, one at a
   time (§0.2 item 23).
2. Each call goes through `withBudget` (reserved from the chunk's estimate, settled from `usage` priced
   by `ttsCostOf`) and `withEgressLog`; a budget refusal pauses with the chunk pending (`plan/07` §0.2
   items 12 and 18).
3. A retryable failure (429 with or without `retry-after`, 5xx, timeout) is retried with byte-identical
   inputs under the existing retry policy; a non-retryable one (401, 403, 404, no audio part) stops the
   loop with that error and the finished chunks kept **in memory** for an in-session retry (§0.4 line 14).
4. Assert every chunk's sample rate equals the first one's; a mismatch is a `TTSError` ("sample rate
   changed"), never a silent concatenation (`docs/04` §6.3).
5. Cancel: abort the request in flight through the job's signal, drop every finished chunk, throw
   `OperationCancelledError` (FR-42).

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** where finished chunks live.
> `docs/04` §5.4 says to persist completed chunks as PCM in a temporary directory so a failure resumes.
> A 10-minute report is about ten one-minute chunks and costs about $0.15 on the cheaper model; a
> second store, its clean-up and its key are more code than the money saved. **Sequential, in memory; a
> retry in the same session (the user presses Retry in the window) reuses the finished chunks; nothing
> survives a restart; a content-hashed chunk cache is backlog** (§4). `docs/04` §5.4 gets a dated note.
> (§0.4 line 14.)

**Do NOT.**
- Do **not** run chunks more than one at a time in v1.0.
- Do **not** retry with modified text, another voice or another model (`docs/04` §5.3).
- Do **not** write a chunk to disk.

**Done when.**
- [ ] With a fake provider: three chunks are sent in order with identical prefix, voice and model; a 429
      on chunk 2 is retried with the same body; a 401 on chunk 2 stops with chunk 1 kept; a sample-rate
      change stops with a `TTSError`.
- [ ] Cancel during chunk 2 aborts its request and the result holds no PCM.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioSynthesize
```

**Notes.** Needs: Phase 3's budget and egress log. Caller: `audioReportPipeline.ts` (`P6-T16`).

---

### P6-T12 — WAV assembly: silence, one header, sample-rate check

| Field | Value |
|---|---|
| **ID** | `P6-T12` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T11` |
| **Blocks** | `P6-T13`, `P6-T16` |
| **Retires** | part of `R-8` |
| **Implements** | part of `FR-41`, part of `FR-37` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `src/tts/audioStore.ts` turns N PCM chunks into one WAV with 250 ms of silence between
chunks and exactly one header, and writes it without building more than one full copy in memory.

**Read first.**
- `docs/04-audio-report-tts.md` §3.3 (`pcmToWav`), §6.1–§6.3 (concatenate PCM; even-length silence; one
  sample rate; memory)
- `src/tts/audioStore.ts` — `pcmToWav`, `WAV_HEADER_BYTES`, `AudioFileSystem`, `createAudioStore`
- `plan/01` `P0-T26` — what it built and what it left to Phase 6

**Files.**
- modify `src/tts/audioStore.ts` (`concatPcm`, `silencePcm`, `wavHeader`; the store writes header and
  chunks in order; caller: `src/pipeline/audioReport/deliver.ts`, `P6-T13`)
- create `test/unit/tts/audioStore.test.ts` (the first unit test of this file)

**Do.**
1. `silencePcm(ms, format)`: `round(ms × rate / 1000)` samples × 2 bytes — always even (`docs/04` §6.3).
2. `wavHeader(dataBytes, format)`: the 44-byte header for the total length; `pcmToWav` keeps working
   for its existing callers.
3. Writing: the header, then each chunk with silence between (none after the last), appended in order
   through `AudioFileSystem`, so peak memory is the chunks already held plus one chunk (`docs/04` §6.3's
   memory note). If the platform write has no append mode, build one flat buffer and say so in the
   report. Verify the append option's name in the Zotero source the project already reads (`docs/01`),
   not from memory.
4. A WAV handed in by mistake (`RIFF` at offset 0) has its header stripped before joining, and the
   strip is logged (`docs/04` §2.4's sanity check).

**Do NOT.**
- Do **not** write one header per chunk.
- Do **not** transcode or resample (`docs/04` §6.4).

**Done when.**
- [ ] For three chunks of known lengths, the file is `44 + sum(chunks) + 2 × silence` bytes, its header's
      sizes agree, and its first data bytes equal chunk 1's.
- [ ] A 250 ms silence at 24 kHz is 12,000 bytes; an odd length is impossible by construction.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioStore
```

**Notes.** Needs: `P0-T26`. Grep `audioStore.ts`'s importers before changing an export
(`test/integration/zotero/attachments.spec.ts` is one); extend, do not replace (`plan/README.md` §4).

---

### P6-T13 — Delivery into Zotero: import or link, naming

| Field | Value |
|---|---|
| **ID** | `P6-T13` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T02`, `P6-T12` |
| **Blocks** | `P6-T14`, `P6-T16` |
| **Retires** | none |
| **Implements** | `FR-40` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** `src/zotero/attachments.ts` puts the WAV into the report's collection as a standalone
attachment with a descriptive title, imported at most 10 MiB and linked above into the folder the user
chose, and deletes the data-directory copy an import leaves.

**Read first.**
- `docs/04-audio-report-tts.md` §10.1–§10.3 with the notes of 2026-11-16 — placement, the threshold,
  naming
- `src/tts/audioStore.ts` — `chooseAttachmentMode`, `IMPORT_MAX_BYTES`, `audioFileName`,
  `sanitizeFileStem`, `AttachmentApi`
- `plan/01` `P0-T26` — the signatures it read in Zotero's `attachments.js`, and the second copy it found
- `src/zotero/notes.ts` — `isLibraryEditable`, and how `writeReportNote` places a standalone note in a
  collection

**Files.**
- create `src/zotero/attachments.ts` (`createZoteroAudioAttachments`; the only file in `src/` that calls
  `Zotero.Attachments` for audio; caller: `src/pipeline/audioReport/deliver.ts`; constructed in
  `src/bootstrap/registerPipelines.ts` by `P6-T16`)
- create `src/pipeline/audioReport/deliver.ts` (`deliverAudio`; caller: `audioReportPipeline.ts`)
- create `test/unit/pipeline/audioDeliver.test.ts`
- modify `test/integration/zotero/attachments.spec.ts` (a standalone attachment in a collection; linked
  and imported; the copy removed)
- modify `docs/07-architecture-and-data-model.md` (§6.5: the finding of step 1; dated note)

**Do.**
1. Before code: read Zotero's item and attachment source for whether an attachment's parent may be a
   note, and record the answer with the file and function name in `docs/07` §6.5 and the card's report.
   The decision does not depend on it (§0.4 line 7).
2. Name: `audioFileName` per `docs/04` §10.3 (`<collection-slug>-trends-<yyyymmdd>-<lang>.wav`, Hangul
   kept, `-2`, `-3` on a same-day re-run); title: "Audio report (English|Korean), <date>", localised in
   `P6-T17`'s strings (FR-40).
3. Import (at most `IMPORT_MAX_BYTES`): write to the plugin's audio directory, `importFromFile` with no
   parent, `contentType` `audio/wav`, add to the report's collection, then delete the written file once
   the import has succeeded (§0.4 line 6).
4. Link (above the threshold): the folder is `tts.linkedFileDir`; when empty, ask once through a folder
   picker the UI passes in, store the answer, and never log it. Write the file there, `linkFromFile`,
   add to the collection. A folder that no longer exists asks again.
5. A read-only library or a group the user cannot write is refused before synthesis, not after
   (`isLibraryEditable`); `deliverAudio` exposes the check for `P6-T16` to call first.
6. Return an `AudioRunOutcome`; `P6-T16` writes the key into `audioAttachmentKeys[language]`.

**Do NOT.**
- Do **not** create a parent item, or move or edit the report note (§0.4 line 7).
- Do **not** link to a temporary path (`docs/04` §10.2).
- Do **not** write a path into a log, a report or an error message; name the folder "the folder you
  chose".

**Done when.**
- [ ] With fake ports: a 5 MiB file is imported, added to the collection, and its written copy deleted;
      a 20 MiB file is linked into `tts.linkedFileDir`; an empty folder setting asks once and stores the
      answer; a read-only library is refused before any write.
- [ ] `docs/07` §6.5 records step 1's finding with its source location by name.
- [ ] The integration spec passes three runs in a row in an integration round (`plan/04` §0.2 item 3);
      the coordinator decides who runs it.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioDeliver
```

**Notes.** Needs: `P0-T26`, `P4-T14`. Callers: `audioReportPipeline.ts` (`P6-T16`). §0.4 line 25 (a
linked file does not reach the phone) is the owner's; this card builds the decided rule either way.

---

### P6-T14 — Failure paths: specific errors, script as text, Save as

| Field | Value |
|---|---|
| **ID** | `P6-T14` |
| **State** | `TODO` |
| **Depends on** | `P6-T07`, `P6-T13` |
| **Blocks** | `P6-T16` |
| **Retires** | part of `R-8` |
| **Implements** | `FR-43`, part of `FR-40` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Every way an audio run can fail ends in a specific message, the written report untouched, and
an offer: save the spoken script as a text file (FR-43), or, when only the attachment failed, save the
audio itself with "Save as…" (FR-40).

**Read first.**
- `docs/10-requirements-and-user-stories.md` FR-40 (second scenario), FR-43
- `docs/04-audio-report-tts.md` §7.5's note of 2026-11-16 — no second provider in v1.0
- `src/core/errors.ts` (`TTSError`, its `messageKey` `rh-error-tts`), `src/i18n/keys.ts`
  (`DEFERRED_ERROR_MESSAGE_IDS`) and the comment in `research-helper-mainWindow.ftl` on why
  `rh-error-tts` was deferred
- `src/pipeline/trendReport/exportMarkdown.ts` (`safeBaseName`) and `src/zotero/notes.ts`
  (`reportFileWriter`) — the save-to-a-path precedent: the path is used once and never kept or logged

**Files.**
- create `src/pipeline/audioReport/failures.ts` (`classifyAudioFailure`, `saveScriptAsText`,
  `saveAudioAs`; caller: `audioReportPipeline.ts` (`P6-T16`) and the session commands in
  `src/bootstrap/registerUI.ts` (`P6-T17`))
- modify `src/core/errors.ts` (reasons on `TTSError`: `unentitled`, `model-gone`, `no-audio`,
  `sample-rate`, `script-rejected`, `rate-limited`; no new class unless a reason cannot carry it)
- modify `src/i18n/keys.ts` (move `rh-error-tts` out of `DEFERRED_ERROR_MESSAGE_IDS`)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`, `addon/locale/ko-KR/research-helper-mainWindow.ftl`
  (`rh-error-tts` with one variant per reason; the Korean through `G-41`)
- create `test/unit/pipeline/audioFailures.test.ts`

**Do.**
1. `classifyAudioFailure(error)`: 401/403 → `unentitled` ("the key cannot use Gemini text-to-speech");
   404 or a model missing from the list → `model-gone`; no audio part → `no-audio`; `ScriptRejected` →
   `script-rejected`; 429 after retries → `rate-limited`; anything else keeps its own class. Each message
   passes `redact`.
2. FR-43: whenever a validated script exists and the audio did not get made, the outcome carries
   `offerScriptText: true`. `saveScriptAsText(path)` writes the script as UTF-8 text with a header line
   naming the report, its language and date; the file name comes from `safeBaseName`; the path is used
   once and never stored or logged. The written report and its note are never touched.
3. FR-40's fallback: when assembly succeeded but the Zotero write failed, keep the WAV bytes in memory
   for the session and offer `saveAudioAs(path)`; dropping them is the window's Close.
4. A script that was validated is written to `audioScripts[language]` even when TTS then fails, so a
   retry or a save needs no second script call (`P6-T16` does the write).

> **DECIDED 2026-11-16 (owner, plan/00 §6 item 378(c)):** v1.0 ships Gemini TTS only. **On failure the
> script is offered as text (FR-43); no second provider is tried.** OpenAI TTS is a later-release
> candidate with no card.

**Do NOT.**
- Do **not** show a stack trace or a raw response body (the DoD's third line).
- Do **not** fall back to another TTS model mid-report (`docs/04` §5.3).
- Do **not** write the script into a note or an attachment unasked; it is a file the user saves.

**Done when.**
- [ ] Each reason maps to its own Fluent variant in both bundles, and `rh-error-tts` is no longer in
      `DEFERRED_ERROR_MESSAGE_IDS`.
- [ ] A 403 from the TTS stand-in yields `unentitled`, `offerScriptText: true`, and a report store
      unchanged apart from `audioScripts`.
- [ ] `saveScriptAsText` writes UTF-8 with Hangul intact, and no log line holds the path.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioFailures i18n
```

**Notes.** Needs: Phase 3's error taxonomy. The Korean variant text waits for `G-41` like every new
string (§0.4 line 30); the English lands with the card.

---

### P6-T15 — Audio confirmation, tier question and both-host disclosure

| Field | Value |
|---|---|
| **ID** | `P6-T15` |
| **State** | `TODO` |
| **Depends on** | `P6-T02`, `P6-T05`, `P6-T10` |
| **Blocks** | `P6-T16` |
| **Retires** | none |
| **Implements** | `FR-42`, part of `FR-37` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Before any audio spend the user sees, in the existing cost dialog: the character count, chunks,
duration, file size, import-or-link and cost (FR-42); both hosts and what each receives; the tier
question the first time; the free-tier warning on a free or unknown key; and strict or balanced mode
refuses such a key with the reason.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §3 row 5 (clarified 2026-11-16), §3.4 rules 4–5 (with the
  note of 2026-11-16), §3.5's Gemini row, §3.6 items 2–3 (the warning text; the declared-paid reminder)
- `src/ui/dialogs/costConfirmDialog.ts` (`buildCostDialogModel`, `decideCostDialog`, `PreflightDialogInput`)
  and `src/bootstrap/registerUI.ts` (`confirmRunCost`) — extend, do not fork
- `src/pipeline/shared/egressDisclosure.ts` (`buildEgressDisclosure`, `EgressNoticeId`,
  `mustAskConfirmation`, `withEgressLog`) and `privacyPolicy.ts` (`assertModelAllowed`, `effectiveMode`)
- `src/llm/gemini/tierDetect.ts` — the detector the answer feeds

**Files.**
- create `src/pipeline/audioReport/disclosure.ts` (`audioEgressNotice`, `audioTierState`,
  `assertAudioAllowed`; caller: `audioReportPipeline.ts`, `P6-T16`)
- modify `src/pipeline/shared/egressDisclosure.ts` (an audio notice id naming both hosts; the
  first-use-per-key destination record)
- modify `src/ui/dialogs/costConfirmDialog.ts` (an audio variant of the preflight model: the FR-42 lines,
  the size and import-or-link line, the tier question)
- modify `src/i18n/keys.ts`, `addon/locale/{en-US,ko-KR}/research-helper-mainWindow.ftl` (new ids; the
  Korean through `G-41`)
- create `test/unit/pipeline/audioDisclosure.test.ts`; modify `test/unit/ui/costConfirmDialog.test.ts`

**Do.**
1. `audioEgressNotice`: two destinations — the `reportModel` provider's host, only when a script call is
   due (no stored script for that language), with what it receives; `GEMINI_HOST` with "the spoken
   script, which can name the collection and cited authors" (§0.2 item 21).
2. `audioTierState(prefs)`: `gemini.tierAnswer` `paid` (or `gemini.paidTier` set from the pane) →
   paid; `free`, `unknown` or `""` → free-or-unknown (item 378(b)). The tier question is three choices
   inside the first audio confirmation while the answer is `""`; the answer is written to
   `gemini.tierAnswer`, and `paid` also sets `gemini.paidTier` (§0.4 line 18).
3. `assertAudioAllowed(mode, tier)`: strict and balanced refuse free-or-unknown with a message naming
   the reason and the way out (declare the key paid in the settings, or switch privacy mode), before any
   call; full allows it with the free-tier warning on **every** audio confirmation, with no "don't ask
   again" path (`docs/09` §3.6 items 2–3).
4. A paid answer does not show the warning again. Whether the declared-paid one-line reminder still
   shows is §0.4 line 26: **this step is not executed until the owner answers**; until then the reminder
   stays as `docs/09` §3.6 item 3 has it.
5. `docs/09` §3.4 rule 5: the first audio run with a given Gemini key shows the destination
   confirmation even when the routine one is suppressed; the record holds a hash of the key's secret id
   and a fingerprint, never the key (`redactRecord` on the record).
6. The two dialog moments of §0.4 line 13: the script step (when due) with `estimateScriptStep`, then the
   audio step with `estimateAudioPlan` and the script's length warning (`P6-T07`). A confirmation forced
   by money opens whatever "don't ask again" says (`mustAskConfirmation`).

**Do NOT.**
- Do **not** infer a tier from a response, a quota error or a model list (`DOCUMENTED_PAID_SIGNALS` is
  empty for a reason).
- Do **not** let a collection's "don't ask again" suppress the free-tier warning, a changed privacy mode
  or a first use with a new key.
- Do **not** store a key, or anything a key can be recovered from, in the destination record.

**Done when.**
- [ ] For each of strict, balanced and full × paid, free, unknown, unanswered, the outcome matches
      `docs/09` §3.5's Gemini row and item 378(b), in a table-driven test.
- [ ] The audio notice names both hosts when a script call is due and one when it is not.
- [ ] The tier question appears once, writes `gemini.tierAnswer`, and never again once answered.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioDisclosure costConfirmDialog
```

**Notes.** Needs: `P3-T15`, `P3-T16`, `P3-T35`. Caller: `audioReportPipeline.ts` and `confirmRunCost`
(`P6-T16`). §0.4 line 27 (whether balanced refuses) is the owner's; the table is built as written.

---

### P6-T16 — Audio pipeline: stages, job, wiring

| Field | Value |
|---|---|
| **ID** | `P6-T16` |
| **State** | `TODO` |
| **Depends on** | `P6-T01`, `P6-T02`, `P6-T05`, `P6-T07`, `P6-T08`, `P6-T10`, `P6-T11`, `P6-T12`, `P6-T13`, `P6-T14`, `P6-T15` |
| **Blocks** | `P6-T17` |
| **Retires** | none |
| **Implements** | `FR-37`, part of `FR-42` |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** `createAudioReportPipeline` runs one audio job end to end against a stored report — check,
script (or the stored script), confirm, synthesize, assemble, attach, record — and is constructed in
`buildPipelineSet` and reachable from the report window's session.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.6 as `P6-T01` writes it; §4.5 (`PipelineContext`); §7.4
- `src/pipeline/trendReport/trendReportPipeline.ts` — the `prepare` / `execute` split the report window
  drives, which this pipeline copies
- `src/bootstrap/registerPipelines.ts` (`buildPipelineSet`, `PipelineConstructionDeps`,
  `createZoteroTrendReportLibrary`), `src/pipeline/registry.ts` (`PipelineSet`),
  `src/bootstrap/container.ts` (`installServices`)

**Files.**
- create `src/pipeline/audioReport/audioReportPipeline.ts` (`createAudioReportPipeline`; constructed in
  `buildPipelineSet`; caller: the report window's session in `src/bootstrap/registerUI.ts`, `P6-T17`)
- modify `src/pipeline/registry.ts` (`PipelineSet.audioReport`, optional like `trendReport`)
- modify `src/bootstrap/registerPipelines.ts` (construct it; a `createZoteroAudioLibrary` port for the
  citation map and the attachment writer of `P6-T13`)
- modify `src/bootstrap/container.ts` (pass the TTS client from `registerProviders`)
- modify `src/zotero/db.ts` (`ReportStore.latestForCollection(libraryID, collectionKey)`; §0.4 line 19)
- create `test/unit/pipeline/audioReportPipeline.test.ts`

**Do.**
1. `prepare(input)`: `audio.enabled` must be on; load the report by id; refuse a read-only library
   (`P6-T13` step 5) and a refused tier (`P6-T15` step 3) **before** any call; resolve the language
   (`P6-T08`) and the model (`P6-T05`); return the script-step estimate when no script is stored for
   that language, else the audio-step plan.
2. The TTS client reads the Gemini key by the secret id §0.4 line 24 settles. **This step is not
   executed until the owner answers that line**; everything else in this card can be built and tested
   with an injected key source.
3. `execute`: script (`P6-T07`/`P6-T08`), written at once to `audioScripts[language]` through
   `ReportStore.put` → chunks (`P6-T09`) → the audio confirmation (`P6-T15`) → `synthesizeChunks`
   (`P6-T11`) → assemble and deliver (`P6-T12`, `P6-T13`) → `audioAttachmentKeys[language]` through
   `ReportStore.put`. Progress is one line, "chunk n of N" (`docs/07`'s choice for `audioReport`).
4. Failures go through `classifyAudioFailure` (`P6-T14`); cancel discards the audio and keeps the script.
5. `ReportStore.latestForCollection`: the newest stored report of a collection, for the menu entry.

> **DECIDED 2026-11-16 (coordinator, under plan/00 §6 item 313):** resume. `plan/07` §0.2 item 18
> makes a report job resume after a restart. An audio job's paid state is chunks in memory (§0.4 line
> 14), so there is nothing to resume from. **An audio job interrupted by a restart is marked cancelled;
> its stored script stays, so running it again costs only the TTS calls.** (§0.4 line 14.)

**Do NOT.**
- Do **not** make a TTS call from `prepare`; it is the estimate half.
- Do **not** construct the pipeline anywhere but `buildPipelineSet`, or the TTS client anywhere but
  `registerProviders` (§0.2; `plan/04` §0.2 item 9).
- Do **not** write to the report note.

**Done when.**
- [ ] With fakes: a run with no stored script makes one script call, asks twice, synthesizes N chunks,
      attaches, and stores both the script and the key; a run with a stored script makes no script call
      and asks once.
- [ ] A strict-mode run on an unknown key and a read-only library are refused before any call.
- [ ] `buildPipelineSet` supplies `audioReport`; the container test still holds.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioReportPipeline container
```

**Notes.** Needs: `P4-T18` (the pattern), `P5`'s edits to the same bootstrap files — grep names before
editing. Caller: `createReportWindowSession` (`P6-T17`).

---

### P6-T17 — Report window audio section and menu entry

| Field | Value |
|---|---|
| **ID** | `P6-T17` |
| **State** | `TODO` |
| **Depends on** | `P6-T02`, `P6-T16` |
| **Blocks** | `P6-T18` |
| **Retires** | none |
| **Implements** | `FR-37`, `FR-38`, part of `FR-42`, part of `FR-43` |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** The report window has an audio section — language, voice, the source line, Generate, a
progress line with Cancel, and the save offers — and the collection menu has "Generate Audio Report…",
which opens the window on the collection's newest stored report; both hidden while `audio.enabled` is off.

**Read first.**
- `docs/08-ui-ux-spec.md` §6.3 (delivery), §6.4 (the "Audio (spoken report)" row and the progress
  wireframe), §7.3's note of 2026-11-16
- `src/ui/panes/reportWindow.ts` (`ReportWindowSession`, `buildReportWindowModel`),
  `src/ui/viewModels/reportViewModel.ts`, `addon/content/reportWindow.{js,xhtml}` (its file picker for the
  Markdown save), `src/bootstrap/registerUI.ts` (`createReportWindowSession`, `ReportWindowCommands`)
- `src/ui/menus/registerMenus.ts` — `collectionMenuOptions` and the hidden-entry precedent

**Files.**
- modify `docs/08-ui-ux-spec.md` (§6.4: the audio section and the menu entry as built here; dated note
  first)
- modify `src/ui/panes/reportWindow.ts`, `src/ui/viewModels/reportViewModel.ts`
- modify `addon/content/reportWindow.xhtml`, `addon/content/reportWindow.js`
- modify `src/bootstrap/registerUI.ts` (session commands: `audioDescribe`, `startAudio`, `cancelAudio`,
  `saveScript`, `saveAudio`, the folder picker for `P6-T13`; the menu command)
- modify `src/ui/menus/registerMenus.ts`
- modify `addon/locale/{en-US,ko-KR}/research-helper-reportWindow.ftl` and `research-helper-mainWindow.ftl`
- modify `test/unit/ui/reportViewModel.test.ts`, `test/unit/i18n/keys.test.ts`, `test/integration/menus.spec.ts` (the collection entry)

**Do.**
1. Documents first: redraw §6.4's audio row as a section under the preview — Language (English / 한국어,
   from `tts.language`), Voice (from `listVoices`, written back to `tts.voice`), the line "Korean script
   written from the English report" when that applies (`P6-T08`), "Generate audio", and the progress line
   "chunk n of N" with Cancel; then Save script as text and Save audio as when offered (`P6-T14`).
2. The window works on the run it made or, opened from the new menu entry, on
   `ReportStore.latestForCollection`; with no stored report the section says so and offers nothing.
3. The section and the menu entry are hidden while `audio.enabled` is off (`plan/08` §0.2 item 25).
4. Every string through Fluent in both bundles; the Korean text goes to `G-41` (§0.4 line 30).

**Do NOT.**
- Do **not** add the pane's audio controls (§0.4 line 11; Phase 7's `W7-4`).
- Do **not** name `Zotero` outside `src/zotero/` and `src/bootstrap/`; the window reaches Zotero through
  the session (`registerUI.ts`'s own header says why).
- Do **not** keep or log a path the user picked for a save.

**Done when.**
- [ ] The view model test covers: no stored report; a stored English report with `ko` chosen (the source
      line shows); progress; cancel; each save offer.
- [ ] The menu entry exists only when `audio.enabled` is on and opens the window for that collection.
- [ ] Both bundles hold every new id (the key-parity check passes).
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- reportViewModel i18n && npm run build
```

**Notes.** Needs: `P4-T20`, `P4-T21`. The window's audio section is also where §0.4 line 11 puts voice
selection. Caller of the session commands: `addon/content/reportWindow.js`.

---

### P6-T18 — Prove the offline paths end to end on recorded answers

| Field | Value |
|---|---|
| **ID** | `P6-T18` |
| **State** | `TODO` |
| **Depends on** | `P6-T04`, `P6-T17` |
| **Blocks** | `P6-T19` |
| **Retires** | none |
| **Implements** | part of `FR-37`–`FR-43` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** One test drives the audio pipeline from a stored report to a WAV and an attachment record on
`P6-T04`'s recorded answers, and each failure path of `P6-T14` on its fixture, with zero live calls.

**Read first.**
- `plan/08` `P5-T28` — the offline end-to-end proof this copies
- `docs/13-testing-build-and-release.md` §4 (no live calls) and §8.6 (the lines this proves offline)

**Files.**
- create `test/unit/pipeline/audioEndToEnd.test.ts`
- create `plan/reports/P6-T18.md` (the card's report; it lists which `docs/13` §8.6 lines are proved
  offline and which need `P6-T19`)

**Do.**
1. English: stored report → recorded script → chunks → recorded TTS bodies replayed per chunk → a WAV
   whose header and length agree → a fake attachment write → `audioAttachmentKeys.en` set.
2. Korean from an English report: the same, with `sourceLanguage: "en"` on the outcome.
3. `error-invalid-key` → `unentitled`, the script saved as text, the report unchanged;
   `error-unknown-model` → `model-gone`; `no-audio-part` → `no-audio`.
4. Cancel during chunk 2 → no file, no key, the script kept.
5. The transport counts requests: zero reach the network.

**Do NOT.**
- Do **not** call a live host or read a key.
- Do **not** count a stand-in as a recording: read the sidecars (`plan/08` `P5-T31`'s note).

**Done when.**
- [ ] Steps 1–5 pass, three runs in a row (`plan/04` §0.2 item 3).
- [ ] The report maps each `docs/13` §8.6 line to "proved offline", "needs `P6-T19`" or both.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- audioEndToEnd
```

**Notes.** Needs: every Phase 6 card before it. If `P6-T04` has not run, the test runs on stand-ins and
the card stays open until it has.

---

### P6-T19 — Phase-6 acceptance run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P6-T19` |
| **State** | `TODO` |
| **Depends on** | `P6-T18` |
| **Blocks** | none |
| **Retires** | closes `R-8` |
| **Implements** | `FR-37`–`FR-43` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — gates `G-06` (the owner acknowledges Google's free-tier terms for the key used), `G-18` (a Gemini key and an LLM key entered in the pane), `G-30` (a native Korean speaker rates three Korean briefings, ≥ 4 of 5 on average), and the owner's approval of each paid run before it runs (`G-07`'s rule, or `G-44` if the owner adds it, §0.4 line 28) — expected under US$2 in all at `docs/04` §4.2's prices: one English briefing of about 7 minutes and three Korean briefings of about 5 minutes are about 22 minutes of audio, about $0.33 on `gemini-2.5-flash-preview-tts` or $0.66 on `gemini-3.1-flash-tts-preview`, plus four script calls on `reportModel` priced by the dialog. |

**Goal.** Every line of the Phase 6 definition of done and `docs/13` §8.6 is demonstrated on a real
Zotero profile and recorded, and audio is switched on.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 6 "Definition of done"; `docs/13` §8.6
- `plan/06` `G-06`, `G-09`, `G-18`, `G-29`, `G-30`
- `plan/reports/P6-T18.md` — which lines are already proved offline

**Files.**
- create `docs/spikes/phase-6-acceptance-report.md`
- modify `docs/07-architecture-and-data-model.md` (§8.5: `audio.enabled` default `true`; dated note)
- modify `src/prefs/schema.ts`, `test/unit/prefs/schema.test.ts` (that default)
- modify `docs/04-audio-report-tts.md` (§4.2: the rate on the model used, if it differs; dated note)

**Do.**
1. Stop for spend approval before the first paid run, with the dialog's figures beside this card's;
   stop again before each later one (§0.4 line 28).
2. English: a report whose script is about 1,000 words → one WAV, opened from Zotero on Windows by
   double-click; on macOS too if `G-09` gives a Mac, else record "macOS untested" under `G-09`'s
   degraded path (§0.4 line 31). Record its size, whether it was imported or linked, and the seconds.
3. Korean: three briefings, at least one from an English-only report; stop for `G-30`; record the three
   scores and the speaker's notes on embedded English terms verbatim; read `P6-T08`'s numeral count.
4. FR-43: with the key's TTS access removed by the owner (or a key without it), run again: a specific
   message, the report intact, the script saved as text — no stack trace.
5. Each `docs/13` §8.6 line → a recorded result, including the `tts.model`-empty line (grep the built
   XPI for TTS model IDs) and the auto-length line (the produced seconds against `docs/04` §12's target).
6. Read `usageMetadata` against the duration on the model used and write the rate into `docs/04` §4.2
   (`G-29`'s re-verification, if `P6-T04` did not do it before 2026-12-01).
7. Only then set `audio.enabled` to `true`, `docs/07` §8.5 first.

**Do NOT.**
- Do **not** count `G-30` as passed because the English line passed.
- Do **not** reuse one spend approval for a later run.
- Do **not** turn audio on before every DoD line has a recorded result.

**Done when.**
- [ ] Each DoD line and each `docs/13` §8.6 line has a recorded figure or verdict.
- [ ] `G-30`'s three scores are recorded, with the average.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run build
```
Then the manual steps above on a real Zotero 10 profile, stopping at each gate.

**Notes.** Needs: `P3-T31` and `P4-T25` (both NOT BUILT) for Phase 3's and Phase 4's sign-offs, which
this card records as they stand. **Degraded path** if `G-30` fails: `plan/06` `G-30` — English audio
ships, Korean stays behind the FR-43 text fallback, and the second bullet of §5.4 ("Korean quality is marginal rather than good")
applies.

---

## 3. Estimate reconciliation

Where the 20.00 d sit against `plan/05` §3.1's work areas (now §5.1):

| Work area | Cards | Days |
|---|---|---|
| W6-1 TTS provider abstraction and Gemini client | `P6-T01` (half), `P6-T05` | 2.0 |
| W6-2 Spoken-script generation | `P6-T06`, `P6-T07` | 2.25 |
| W6-3 Korean-specific handling | `P6-T08` | 0.75 |
| W6-4 Chunking and sequencing | `P6-T09`, `P6-T11` | 1.75 |
| W6-5 Audio assembly | `P6-T12` | 0.75 |
| W6-6 Delivery into Zotero | `P6-T13` | 1.5 |
| W6-7 Cost estimation, duration, cancellation | `P6-T10` | 1.25 |
| W6-8 Failure and disclosure paths | `P6-T14`, `P6-T15` | 2.5 |
| W6-9 Offline "Read aloud" | — (item 378(d)) | 0 |
| W6-10 Audio dialog | `P6-T17` | 1.75 |
| Not a work area: documents and rows, fixtures, the pipeline, the proofs | `P6-T01` (half), `P6-T02`, `P6-T03`, `P6-T04`, `P6-T16`, `P6-T18`, `P6-T19` | 5.5 |
| | **Total** | **20.00** |

**Where the sum is likely low.** (1) `P6-T13`: Zotero's attachment calls have surprised this project
before (`P0-T26`'s second copy), and a standalone attachment in a collection is a path nothing here has
exercised. (2) `P6-T17`: the report window already carries two languages and five delivery buttons; a
third concern in the same window is a layout risk that Phase 4's cards for it (`P4-T20`, `P4-T21`) have
not yet tested, since they are not built. (3) Korean
quality: if `G-30` comes back below 4, the work is prompt iteration that no card here prices — `docs/11`
named it unpredictable, and it still is. (4) No card is priced for a second review of this file, which
Phases 4 and 5 both had.

**Where it may be high.** `P6-T15` reuses the cost dialog and the egress notice rather than building a
dialog; if the audio variant fits the preflight model with little change, 0.25–0.5 d comes back.

---

## 4. What is not carded, and why

- **OpenAI TTS** as a second provider — owner, item 378(c). Later release.
- **The offline "Read aloud"** (`speechSynthesis`, `W6-9`) — owner, item 378(d). Later release.
- **The Interactions API path**, its `language` field and its MP3 output — §0.4 line 5; the single-chunk
  MP3 of `docs/04` §6.4 option 1 goes with it, as does `docs/04` §2.7's voice-set question.
- **A content-hashed chunk cache and resume after a restart** — §0.4 line 14; backlog.
- **A per-collection glossary and pronunciation hints** (`docs/04` §9.1) — `P0-T25` found the owner
  satisfied without them; backlog, to be reopened by `G-30`'s notes.
- **A per-collection audio-language memory** (`docs/04` §9.4's first paragraph) — §0.4 line 10; backlog.
- **Audio from a per-paper summary set** (FR-37's parenthesis) — §0.4 line 29; backlog unless the owner
  says otherwise.
- **Chapter boundaries for a player** (`docs/12` §13's "best-effort; used only for player navigation") and
  **an in-app player** (`docs/04` §10.4) — no player in v1.0.
- **The pane's audio controls** (`docs/08` §7.3) — §0.4 line 11; Phase 7's `W7-4`.
- **Multi-speaker audio** (`docs/04` §2.5) — no requirement asks for it.

---

## 5. Outline carried over from `plan/05` §3

Moved verbatim from `plan/05` §3.1–§3.4 on 2026-11-16, when `plan/05` §3 became a pointer here, as
`plan/08` §5 did for Phase 5. The text below is the outline as it stood; §0 and §0.4 record what has
changed since.

### 5.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W6-1 | **TTS provider abstraction and Gemini client** | The `TTSProvider` interface R-8's mitigation requires, plus the Gemini client over whichever of the two API surfaces is chosen, with the model ID resolved from the live model list rather than hardcoded (`docs/04` §2.1, §2.2). |
| W6-2 | **Spoken-script generation** | The rewrite pass that turns a written report into speech — markdown and citation stripping, number and abbreviation expansion, target-length control — plus `validateScript()` and its single retry on leaks (`docs/04` §8, `docs/12` §13–§14). |
| W6-3 | **Korean-specific handling** | Embedded English technical terms, the per-collection glossary, numbers and units, and language defaulting (`docs/04` §9) — the part `docs/11` calls unpredictable. |
| W6-4 | **Chunking and sequencing** | Sentence- and paragraph-aware splitting with language-dependent size targets, voice consistency across chunks, and bounded concurrency (`docs/04` §5). |
| W6-5 | **Audio assembly** | Raw PCM concatenation with inter-chunk silence, the WAV header writer, and the single-chunk MP3 path (`docs/04` §3, §6). |
| W6-6 | **Delivery into Zotero** | The standalone item, the report as child note, the audio as child attachment, and the import-versus-link rule with its size threshold and `contentType` (`docs/04` §10). |
| W6-7 | **Cost estimation, duration derivation and cancellation** | Resolving `tts.targetMinutes` in its auto state via `docs/04` §12's derivation, showing chunk count and estimated duration and cost before proceeding, and making cancel real (FR-42). |
| W6-8 | **Failure and disclosure paths** | FR-43's save-the-script-as-text fallback, the unentitled-key path, and the second, independent destination disclosure that `docs/09` §3.4 rule 5 requires because audio uses Google even when summarization did not. |
| W6-9 | **Offline "Read aloud"** | The separate `speechSynthesis` action, with Korean disabled when `getVoices()` returns no `ko-*` voice and the `voiceschanged` race handled (`docs/04` §7.1, §12 item 7). |
| W6-10 | **Audio dialog** | The UI that carries voice selection, language, the live cost estimate, progress across chunks, and cancellation. |

### 5.2 Entry conditions

- **Phase 4 is `DONE`** — there must be a real report to speak.
- **V-10 passed in Phase 0** (`docs/11` §4.2): a 200-word Korean script with
  embedded English terms returned audio that a native speaker judged acceptable.
  `docs/11` §4's closing note says explicitly that if V-7 or V-10 fails, stop and
  re-plan. Phase 6 as described does not exist if V-10 failed.
- **V-11 passed** — binary/arraybuffer handling, writing a file into the storage
  directory, and registering it as an attachment. W6-5 and W6-6 are unwritable
  otherwise.
- **The audio output token rate has been measured.** `docs/04` §4.2 marks the
  25-tokens-per-second conversion `> **Unverified:**` and states that *the whole
  TTS cost model inherits this uncertainty*, with the instruction to make one
  real call, read `usageMetadata.candidatesTokenCount`, divide by the measured
  duration, and calibrate. Until that number exists, W6-7 cannot be specified
  and every per-minute figure in `docs/04` §11 is an order of magnitude, not a
  quote. `docs/04` §4.2 also asks for re-verification by 2026-12-01 regardless.
- **The per-request audio duration ceiling is understood.** `docs/04` §4.1 marks
  the absence of a documented maximum audio duration `> **Unverified:**`, and
  notes that Google's own first-party guidance about quality drift past a few
  minutes is the argument for chunking independent of any token accounting.
- **`docs/10` §5 questions 9 and 10 are answered** — the audio register, and
  Korean-native generation versus translation. `docs/11` §5 lists both as
  "Before Phase 6".
- **`docs/12` §19 item 6 is answered** — when only an English report exists,
  whether the Korean script is generated from it or a Korean report is generated
  first. This is a distinct question from `docs/10` §5 question 10 and it changes
  W6-2's call graph and cost.
- **The voice-set question is closed.** `docs/04` §2.7 marks
  `> **Unverified:**` whether the Interactions API's voice set matches the legacy
  `generateContent` set, with an explicit instruction not to hardcode the names.
- **The attachment API signature is confirmed.** `docs/04` §10.1 marks
  `Zotero.Attachments.importFromFile`'s exact signature and option set
  `> **Unverified:**`, quoting Zotero's own documentation that this area "requires
  a lot of looking around in the source code".
- **The Gemini tier position is settled and disclosed.** `docs/09` §3.3 states
  that a free-tier user generating an audio report has sent their trend report to
  Google for product improvement with human reviewers able to read it, and
  `docs/09` §3.5 refuses the Gemini free tier in strict mode. `docs/09` §3.4
  rule 4 marks `> **Unverified:**` whether a programmatic billing signal exists
  at all. See [`06-human-gates.md`](06-human-gates.md) G-06.

### 5.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Audio register (`docs/10` §5 question 9) | `docs/04` §8.1 and the `docs/12` §13/§14 templates |
| Korean script source — native generation vs. translation of the English report (`docs/10` §5 question 10; `docs/12` §19 item 6) | `docs/04` §9.4 and `docs/12` §14 |
| Primary Gemini API surface — legacy `generateContent` or Interactions | `docs/04` §2.1, with the ZDR consequence (`store: false`) recorded in `docs/09` §3.3 |
| Whether the OpenAI TTS fallback ships in v1 | `docs/04` §7.5. **No longer blocked on a missing price:** `docs/04` §7.2 carries `gpt-4o-mini-tts`'s per-token pricing re-confirmed 2026-09-08. What remains is a product decision, plus §7.2's own warning that mixing a per-character model (`tts-1`/`tts-1-hd`) and a per-token one in a single estimator is the trap (`docs/04` §11) |
| Shipped `tts.outputFormat` default, and therefore whether the typical report is imported or linked | value in `docs/07` §8.5; the rule stays in `docs/04` §10.2 |
| Whether audio is offered at all on an unconfirmed-tier Gemini key | `docs/09` §3.4 rule 4 and §3.5 |
| Whether "Read aloud" ships in v1 given no Korean system voice may exist | `docs/04` §7.1, whose Windows Korean-voice availability is `> **Unverified:**` |

### 5.4 What would change the plan

- **The measured token rate differs materially from 25/s.** Every per-minute and
  per-report figure in `docs/04` (§11 included) is re-derived, W6-7's estimator
  changes, and if the real rate is much higher the 32k-context math in `docs/04`
  §4.1 tightens the chunk targets in W6-4.
- **Korean quality is marginal rather than good.** Either Korean audio ships
  behind a flag with the FR-43 text fallback as the honest default, or OpenAI TTS
  is promoted to primary for Korean (`docs/04` §7.5 rank 2) — which needs a
  second provider key and therefore a new human gate, plus the estimator work
  `docs/04` §7.2 warns about (that model is token-priced while `tts-1`/`tts-1-hd`
  are character-priced), and it inherits §7.2's own caveat that OpenAI's voices
  are English-optimized.
- **Interactions rather than legacy is chosen as primary.** `speech_config`'s
  explicit `language` field removes the mixed-language guessing that W6-3 exists
  to mitigate (`docs/04` §2.8), and the response shape changes W6-5. It also
  binds the feature to `store: false` for any ZDR project (`docs/09` §3.3).
- **`importFromFile` differs from the assumed shape.** W6-6 is re-planned, and
  the import-versus-link threshold logic may have to move.
- **A TTS model ID is deprecated mid-phase.** All three IDs in `docs/04` §2.2
  carry `-preview`. This is why W6-1 resolves the model from the live list; a
  deprecation should cost a preference change, not a release.


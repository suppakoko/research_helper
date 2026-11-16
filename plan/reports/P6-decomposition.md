# Phase 6 decomposition — report, 2026-11-16

Phase 6 is the spoken audio report: a script written from a stored trend report, turned into speech by
Gemini text-to-speech, and saved in Zotero as a WAV file. It is now split into 19 task cards in the new
file `D:\KIST\projects\research_helper\plan\09-phase-6-audio-report.md`. Nothing was committed or pushed.
Zotero was not touched, no integration test was run, the OpenRouter key was never read, and no keyed path
was run.

## 1. The cards and the sum

| Card | Title | Estimate |
|---|---|---|
| `P6-T01` | Reconcile Phase 6 types, files and audio states in `docs/07` | 1.0 d |
| `P6-T02` | Preference rows Phase 6 reads | 0.5 d |
| `P6-T03` | Recorder's Gemini TTS path and synthetic stand-ins | 0.75 d |
| `P6-T04` | Owner-recorded Gemini TTS and script fixtures (owner gate) | 0.25 d |
| `P6-T05` | Gemini TTS client: synthesize, model list, voices | 1.5 d |
| `P6-T06` | `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` prompt files | 0.75 d |
| `P6-T07` | Script pass: citation map, target, validation, one retry | 1.5 d |
| `P6-T08` | Korean script path, language default, Korean length check | 0.75 d |
| `P6-T09` | Chunker: sentence- and paragraph-aware splitting | 0.75 d |
| `P6-T10` | TTS prices and the two-step audio estimate | 1.25 d |
| `P6-T11` | Synthesis loop: sequential chunks, budget, cancel | 1.0 d |
| `P6-T12` | WAV assembly: silence, one header, sample-rate check | 0.75 d |
| `P6-T13` | Delivery into Zotero: import or link, naming | 1.5 d |
| `P6-T14` | Failure paths: specific errors, script as text, Save as | 1.0 d |
| `P6-T15` | Audio confirmation, tier question and both-host disclosure | 1.5 d |
| `P6-T16` | Audio pipeline: stages, job, wiring | 1.75 d |
| `P6-T17` | Report window audio section and menu entry | 1.75 d |
| `P6-T18` | Prove the offline paths end to end on recorded answers | 0.75 d |
| `P6-T19` | Phase 6 acceptance run against the definition of done (owner gate) | 1.0 d |

- **Sum: 20.00 developer-days over 19 cards**, read from the cards' `Estimate` rows by script. The band
  is 20.00–28 d (20.00 × 1.4 = 28.0). It replaces the scaled 15–21 d and is 33 % above that low end.
- Two cards wait on the owner: `P6-T04` and `P6-T19`.
- The cards start at `P6-T01`, `P6-T02`, `P6-T03` and `P6-T06`. The longest chain inside Phase 6 is
  `P6-T01` → `T05` → `T11` → `T12` → `T13` → `T14` → `T16` → `T17` → `T18` → `T19`, 12.0 d.
- Where the new figure was carried, by the cards-sum rule of `plan/README.md` §7:
  - `docs/11` §1: the project total is now **217.00–304 d** (it was 212.00–297), about 10–14 months at
    21 working days a month.
  - `docs/11` §2: the critical path is now **148.75–208 d** (it was 143.75–201). The Phase 3 route is
    145.75–204 d, so the 3 d / 4 d margin is unchanged. Phase 5's float is now **9.5–13 d** (it was
    4.5–6 d).
  - `docs/11`: the Gantt node, the R-23 row and §5's Phase 6 rows.
  - `plan/00` §1: the "6–7" row is split into a Phase 6 row and a Phase 7 row.
  - `plan/05` §3 is now a pointer. Its contents moved word for word to `plan/09` §5.

## 2. The owner's decisions and where they are recorded

The four decisions are recorded as `plan/00` §6 item 378(a)–(d) and `plan/09` §0.4 lines 1–4.

- **(a) Korean script from an English report.** One call writes a new spoken script in Korean. It is
  not a sentence-by-sentence translation. Recorded in:
  - `docs/12` §19 item 6 (struck through) and §14
  - `docs/04` §9.4
  - `docs/10` §5 Q10
  - cards `P6-T06` and `P6-T08`
- **(b) Billing tier.** The tier is asked once (paid / free / don't know). No answer, or "don't know",
  counts as free. The free-tier warning shows on every audio confirmation. A "paid" answer is not
  warned again. Strict mode makes no audio with a free or unknown key. Recorded in:
  - `docs/09` §3.4 rule 4 and §8 item 3 (struck through)
  - `plan/05` §4.3, the tier row
  - `plan/06` `G-28`, now closed
  - cards `P6-T02` and `P6-T15`
- **(c) Provider.** v1.0 ships Gemini TTS only. If Gemini fails, the script is saved as text (FR-43).
  OpenAI TTS is left for a later release and has no cards. Recorded in:
  - `docs/04` §7.5
  - `plan/09` §4
  - card `P6-T14`
- **(d) No "Read aloud" in v1.0.** Recorded in:
  - `docs/04` §7.1
  - `plan/09` §4

## 3. The coordinator's decisions

All of these were taken under `plan/00` §6 item 313, and the owner may overturn any of them. They are
`plan/09` §0.4 lines 5–23. Each line names the cards that carry it and the doc marked 2026-11-16.

- **Gemini surface:** the older `generateContent` call only (`docs/04` §2.1).
- **File format:** WAV only. A file up to 10 MiB (about 3.6 minutes of audio) is imported into Zotero;
  a larger one is linked from `tts.linkedFileDir`. The data-directory copy left by an import is deleted.
  Recorded in `docs/04` §6.4 and §10.2, `docs/07` §8.5 and `docs/13` §8.6.
- **Placement:** a standalone attachment in the report's collection (`docs/04` §10.1).
- **Register:** conversational, with no citation markers read aloud (`docs/10` Q9, `docs/12` §14).
- **Korean:** the script is written natively in Korean (`docs/10` Q10).
- **`tts.language`:** `auto` means the report's own language (`docs/04` §9.4).
- **No `tts.provider` preference.** The voice is chosen in the report window (`docs/07` §8.5,
  `docs/08` §7.3).
- **Jobs and cost:**
  - an `audioReport` job of its own;
  - two cost confirmations;
  - chunks are synthesized one after another and held in memory, with no resume after a restart.
- **Script call:**
  - the inputs the script call is given;
  - retry corrections written in English;
  - a script outside ±30 % of its target length gets a warning, not a rejection;
  - output ceilings scale with the target length.
- **New preferences:**
  - `gemini.tierAnswer`;
  - a hidden `audio.enabled`, off until `P6-T19` passes.
- **Menu entry:** a collection menu entry, backed by a new `ReportStore` lookup.
- **Prices:** a dated TTS price table.
- **Rename:** `src/tts/ssml.ts` becomes `src/tts/chunk.ts`.
- **Also clarified:** `docs/09` §3.2 row 5 now states what each of the two hosts receives.
- **`plan/06`:** `G-29` got a status note. Its token rate is measured for one model only, so the gate
  stays open. `G-30` stays open.

## 4. Open lines for the owner (`plan/09` §0.4 lines 24–31)

1. Which secret TTS reads: the existing chat key `llm.gemini` (recommended) or the unused `tts.gemini`.
   This stops `P6-T16` step 2.
2. A 10-minute WAV is about 28.8 MB, so it is linked rather than imported, and it does not reach
   Zotero's phone apps. Accept for v1.0?
3. Whether the one-line reminder for a declared-paid key still shows on every audio job. This stops
   `P6-T15` step 4.
4. Balanced mode refuses audio on a free or unknown key, as the privacy table says. Is that the intent
   of item 378(b)?
5. A spend gate `G-44`, modelled on `G-43` (recommended; not added). This stops `P6-T19` step 1.
6. FR-37's audio from a per-paper summary set goes to the backlog. Accept?
7. The Korean wording of the new strings goes through `G-41`.
8. macOS testing depends on `G-09` (machines).

## 5. Unresolved

- No one else has reviewed `plan/09` yet.
- The owner has not said whether 20.00–28 d is accepted.
- Phase 6 was split into cards before `plan/05` §0's exit conditions (a) and (c) held: Phase 5 is not
  done, and `P4-T24`/`P4-T25` have not run. `plan/09` §0's entry-condition table records which
  conditions are met.
- `plan/06` `G-06` (acknowledging Google's free-tier terms) got no status note of this date. `P6-T19`
  names it as one of its gates.

## 6. Self-review and checks

- Every source, test and script file a card names either exists or is created by a named card. Checked
  by script against each card's **Files** list. `src/tts/ssml.ts` is named only as the old name being
  replaced.
- No card cites a source line number. Every "line N" in `plan/09` points to the decision table in
  `plan/09` §0.4.
- FR-37 to FR-43 each appear in at least two cards' `Implements` rows.
- The three lines of `docs/11`'s definition of done, and `docs/13` §8.6's nine quality-check lines, each
  map to cards (`plan/09` §0).
- Every measurement `plan/09` claims is on record. The 24.998 tokens per second, the 2,709 tokens for
  108.37 s and the $0.0273 are in `plan/01` (`P0-T25`), `docs/04` §4.2 and `docs/spikes/phase-0.md`.
  The 10 MiB threshold is `IMPORT_MAX_BYTES` in `src/tts/audioStore.ts`. At 24,000 Hz the audio runs
  48,000 bytes per second. The 28.8 MB and 3.6 minutes are arithmetic from these.
- One unsupported claim was removed from `plan/09` §3: that an earlier window card "has cost more than
  its card". The Phase 4 cards are not built.
- `env -u OPENROUTER_API_KEY npm run index:derive`: 238 tasks, 112 DONE, 126 TODO; Phase 6 has 19 rows.
- `env -u OPENROUTER_API_KEY npm run typecheck`: passed.
- `env -u OPENROUTER_API_KEY npm run lint:check`: passed (eslint and prettier).
- `env -u OPENROUTER_API_KEY npm run test:unit`: 139 files; 7,808 tests passed, 105 skipped. No test
  covers `scripts/derive-task-index.ts` directly.

## 7. Files changed (uncommitted, base commit 76fc753)

- New:
  - `D:\KIST\projects\research_helper\plan\09-phase-6-audio-report.md`
  - `D:\KIST\projects\research_helper\plan\reports\P6-decomposition.md` (this report)
- Modified, plan files:
  - `D:\KIST\projects\research_helper\plan\00-task-index.md` (item 378, §1, §3, §4, header)
  - `D:\KIST\projects\research_helper\plan\05-phases-4-7-outline.md`
  - `D:\KIST\projects\research_helper\plan\06-human-gates.md`
  - `D:\KIST\projects\research_helper\plan\README.md`
- Modified, script:
  - `D:\KIST\projects\research_helper\scripts\derive-task-index.ts`
- Modified, docs:
  - `D:\KIST\projects\research_helper\docs\04-audio-report-tts.md`
  - `D:\KIST\projects\research_helper\docs\07-architecture-and-data-model.md`
  - `D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md`
  - `D:\KIST\projects\research_helper\docs\09-security-privacy-and-api-keys.md`
  - `D:\KIST\projects\research_helper\docs\10-requirements-and-user-stories.md`
  - `D:\KIST\projects\research_helper\docs\11-implementation-roadmap.md`
  - `D:\KIST\projects\research_helper\docs\12-prompt-library.md`
  - `D:\KIST\projects\research_helper\docs\13-testing-build-and-release.md`

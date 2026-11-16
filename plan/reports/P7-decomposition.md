# Phase 7 decomposition — report, 2026-11-16

Phase 7 is the last phase before version 1.0. It covers translation into Korean, accessibility, the
settings pane, the "clear data" and "remove all content" actions, error messages, the diagnostics file,
profiling, security and offline checks, the README and change log, the release workflow, the release
checklist, and the release itself. Phase 7 is now split into 31 task cards in the new file
`D:\KIST\projects\research_helper\plan\10-phase-7-release.md`. Before that, the eight open questions left
by the Phase 6 split were answered and recorded (Part A).

Nothing was committed or pushed. Zotero was not touched, no integration test was run, the OpenRouter key
was never read, no tag was pushed and nothing was published.

## 1. Part A: Phase 6 open lines 24–31, answered

The open-lines table in `plan/09` §0.4 is now titled "Lines 24–31, answered 2026-11-16". Each line has
an answer, who gave the answer, and where the answer is recorded. The details are in `plan/00` §6
item 379.

| Line | Answer | By | Recorded in | Card changed |
|---|---|---|---|---|
| 24 | Text-to-speech reads the same Gemini secret as chat (`llm.gemini`, `GEMINI_SECRET_ID`). The separate `tts.gemini` entry stays unused, with a comment beside the entry. | Owner | `docs/09` §3.3 | `P6-T16` step 2 runs now; `P6-T05` Notes |
| 25 | Accepted for version 1.0: a WAV file over 10 MiB is linked, not imported, and does not reach Zotero's phone apps. | Owner | `docs/04` §10.4, `docs/10` FR-37 | `P6-T13` Notes |
| 26 | The one-line reminder stays on every audio confirmation for a key declared paid. The free-tier warning is not shown for that key. | Owner | `docs/09` §3.4 rule 4 | `P6-T15` step 4 runs now |
| 27 | Changed. In balanced mode, a free or unknown Gemini key shows the warning and goes ahead only after the user confirms. Only strict mode refuses. | Owner | `docs/09` §3.5, Gemini row (a dated correction, for audio jobs) | `P6-T15` Goal, step 3, Done when, Notes; `plan/09` §0.4 line 18 corrected |
| 28 | A new human gate, `G-44`, modelled on `G-43`, covers `P6-T04` and `P6-T19`. | Coordinator | `plan/06` §8 | `P6-T19` Human gate cell, Read first, step 1 |
| 29 | Accepted for version 1.0: audio comes only from a trend report. MP3 output and audio from a set of per-paper summaries are candidates for a later release. | Owner | `docs/04` §10.4, `plan/09` §4 | none |
| 30 | The Korean wording goes through `G-41` as usual. | Coordinator | `plan/09` §0.4 | none |
| 31 | macOS is recorded as untested under the fallback route of `G-09`, following the owner's Phase 7 decision on operating systems (section 4 below). | Coordinator | `plan/06` `G-09`, `plan/09` finishing conditions | `P6-T19` step 2 |

The Phase 6 total stays at **20.00 days**. No card grew enough to need a new price: the
warn-and-confirm route for balanced mode is the same route full mode already needed.

Not decided by the Part A answers: whether Gemini chat (not audio) in balanced mode follows the same
change. Phase 7 open line 20 asks (section 6).

## 2. The Phase 7 cards and the sum

Estimates are in developer-days of six focused hours. "Gate" means the card waits on a person, named
by the human-gate number in `plan/06`.

| Card | Title | Estimate | Gate |
|---|---|---|---|
| `P7-T01` | Bring the design documents into line with the decisions | 0.75 | |
| `P7-T02` | Check that English and Korean have the same message keys (`scripts/check-l10n.mjs`) | 0.75 | |
| `P7-T03` | Sweep out hard-coded strings; locale-aware dates and numbers (`src/i18n/format.ts`) | 1.5 | |
| `P7-T04` | Retire the spike command; move the test helper to `test/integration/support/spikeArticle.ts` | 0.75 | |
| `P7-T05` | Korean review by a native speaker | 0.75 | `G-31`, `G-41` |
| `P7-T06` | Accessibility pass | 2.0 | |
| `P7-T07` | Screen-reader smoke test with NVDA | 0.25 | `G-33` |
| `P7-T08` | Settings pane: Search, Report and audio, Privacy; the default values | 1.5 | |
| `P7-T09` | Settings pane: Advanced section | 1.0 | |
| `P7-T10` | The "clear" actions (`src/core/dataReset.ts`) | 1.5 | |
| `P7-T11` | "Remove all Research Helper content" | 1.5 | |
| `P7-T12` | Error-message audit | 1.25 | |
| `P7-T13` | In-memory log buffer and the diagnostics file (`src/core/diagnostics.ts`) | 1.5 | |
| `P7-T14` | Redaction audit: no key or private text in logs or diagnostics | 0.75 | |
| `P7-T15` | Profiling on a large library | 1.5 | `G-34` |
| `P7-T16` | Security review and `SECURITY.md` | 1.5 | |
| `P7-T17` | Re-check each provider's data policy (`src/llm/shared/policyNotes.ts`) | 0.75 | |
| `P7-T18` | Offline check | 1.0 | |
| `P7-T19` | README and change log | 1.5 | |
| `P7-T20` | Korean README (`README.ko.md`) | 0.5 | |
| `P7-T21` | Harden the release workflow | 1.0 | |
| `P7-T22` | Compatibility workflow (`.github/workflows/compat.yml`) | 0.5 | |
| `P7-T23` | Drafts for the Zotero Forums and the community plugin lists (`docs/release/announcement-v1.0.md`) | 0.5 | |
| `P7-T24` | Release checklist (`docs/release/v1.0-checklist.md`) | 1.0 | |
| `P7-T25` | Full manual check on Windows | 1.0 | `G-45` |
| `P7-T26` | Release candidate, version 0.9.0 | 0.25 | `G-35` |
| `P7-T27` | Walkthrough and screenshots | 0.5 | `G-45` |
| `P7-T28` | Registration with the National Center for Biotechnology Information (NCBI) | 0.25 | `G-04` |
| `P7-T29` | Owner signs off the release checklist | 0.25 | `G-37` |
| `P7-T30` | Publish version 1.0.0; check the upgrade from 0.9.0 | 0.5 | `G-35` |
| `P7-T31` | Forum and list posts | 0.25 | `G-36` |
| **Total** | | **28.50** | 10 gated |

- The sum was read from the cards' Estimate rows by script, together with a check that every
  "Depends on" and "Blocks" pair agrees. The script found no edge errors.
- The ten gated cards add up to 5.5 days. Their calendar time belongs to the owner, not to the
  developer.
- Band: 28.50 to 28.50 × 1.4 = 39.9, rounded to 40. Phase 7 is **28.50–40 days, measured**. The
  earlier figure was 21–29 days, scaled up from a guess and never split into cards.
- Against the scaled figure: 36 % above the low end (28.50 ÷ 21) and 2 % below the top (28.50 ÷ 29).
  Against the original 10–14 days: 2.04 times the top, +104 % in the last column of `plan/00` §1.
- Cards that can start at once: `P7-T01`, `T04`, `T12`, `T21`, `T22`, `T28`. Last card: `P7-T31`.
- Longest chain inside Phase 7 (computed by script): `P7-T01` → `T08` → `T09` → `T10` → `T11` → `T03`
  → `T06` → `T15` → `T24` → `T26` → `T25` → `T29` → `T30` → `T31`, **14.5 days**, with six gated
  cards on the chain.
- `plan/10` §3 compares the cards with the eleven work areas the old outline listed (`W7-1` to
  `W7-11`). Every area has at least one card.

## 3. New totals

| Figure | Before | Now |
|---|---|---|
| Phase 7 | 21–29 days, scaled | **28.50–40 days, measured**, 31 cards |
| Phases 4–7 together | 103.00–144 | **110.50–155** (25.75 + 36.25 + 20.00 + 28.50; 36 + 51 + 28 + 40) |
| Whole plan | 217.00–304 days, 238 cards | **224.50–315 days, 269 cards, every phase measured** |
| Months at 21 working days | about 10–14 | **about 11–15** (224.50 ÷ 21 ≈ 10.7; 315 ÷ 21 = 15.0) |
| Fifteen-per-cent reserve | about 33–46 days | **about 34–47 days** |
| Longest route through the phases (Phases 0, 1, 2, 4, 6, 7) | 148.75–208 | **156.25–219**, every step measured |
| Route through Phase 3 instead of Phase 2 | 145.75–204 | 153.25–215; the gap stays 3 days low, 4 days high |
| Spare time for Phase 5 | 9.5–13 days | unchanged at 9.5–13 days; Phase 7 lies on both routes, so the gap does not move |

- Risk R-23 (the risk that the estimates run low) has a new dated sentence: Phase 7 landed above its
  scaled low end for the fifth phase in a row, and every phase is now measured. What is left of the risk
  is that the card sums may still run low, and that actual days are not yet recorded against cards.
- One stale figure was found and corrected: the `docs/11` §2 sentence on a single developer working
  through the phases one after another still quoted 208.50–292, a whole-plan total from 2026-11-10 that
  five later changes had not reached. That sentence now quotes 224.50–315, with a dated note.

## 4. The owner's decisions and where they are recorded

1. **Operating systems.** Version 1.0 is checked on Windows only. macOS and Linux are marked "untested"
   in the README, and the release checklist records the waiver and the reason. macOS and Linux get
   checked in a later release, once machines exist (`G-09`). The Linux check without a keyring
   (`P3-T37`) is deferred on the same condition; the card carries a dated note and keeps its State. The
   screen-reader test uses NVDA only; VoiceOver is waived.
   Recorded in: `docs/13` §8 and §7.3; `docs/10` NFR-13 and NFR-17; `plan/04` `P3-T37`; `plan/06`
   `G-09`, `G-33`, `G-34`, `G-37`; `docs/11` Phase 7 deliverables.
2. **"Remove all Research Helper content" ships in version 1.0.** The action covers the notes,
   attachments and stored data the plugin created. The dialog shows a count for each kind and asks for
   confirmation. Everything goes to the Zotero trash and is never deleted outright. Notes the user wrote
   and the original library items stay untouched.
   Recorded in: `docs/10` §5 question 14; `docs/11` Phase 7 deliverables. Carried by `P7-T11`.
3. **No prompt overrides in version 1.0.** User-edited prompts are a candidate for a later release.
   Recorded in: `docs/12` §19 item 5; `docs/11` §5.
4. **Listing at version 1.0.** The plugin is announced on the Zotero Forums and submitted to the
   community plugin lists when 1.0.0 is out. Posting and submitting are the owner's (`G-36`); `P7-T23`
   writes the drafts.
   Recorded in: `docs/10` §5 question 20; `docs/13` §7.2; `plan/06` `G-36`; `docs/11` §5.

Already settled, and cited rather than reopened:

- question 15, the lowest Zotero version, 10.0, in `addon/manifest.json`;
- question 16, the update file on the `release` branch, confirmed by spike V-18 on 2026-09-16;
- `G-10`, the session-only fallback on Linux with no passphrase option;
- `G-20`, a spending ceiling of 500 cents per session and 0 per run;
- the MIT licence, with `G-32` closed.

`docs/10` §5 questions 15 and 16 carry notes of this date saying so.

## 5. The coordinator's decisions

These were taken under the standing rule to proceed without asking on small and medium choices
(`plan/00` §6 item 313). The owner may overturn any of them. Each one is a line in `plan/10` §0.4,
lines 9–17.

- **Policy re-check timing.** The default for `docs/09` §8 item 7: re-check each provider's data-policy
  claims at every minor release, and show the check date next to the retention text in the interface.
  Carried by `P7-T17`.
- **A spending gate, `G-45`**, for the two cards that spend real provider money: the Windows check
  (`P7-T25`) and the walkthrough (`P7-T27`).
- **The release checklist is a file**, `docs/release/v1.0-checklist.md`.
- **The diagnostics file is plain text.** The settings pane gets "Save diagnostics…" and "Copy
  diagnostics". There is no zip archive and no Help-menu entry.
- **No paid voice preview** in the settings pane.
- **Version 0.9.0 is a published release candidate.** The upgrade from 0.9.0 to 1.0.0 is checked and
  recorded after 1.0.0 is published.
- **The meaning of "content the plugin created":**
  - included: generated notes, provenance notes, audio attachments that a stored report names, and the
    rows of the plugin's own database;
  - left alone: imported items, the tags on those items, and their Related links.
- **Korean wording goes through `G-41`.**
- **The redaction audit runs on recorded test fixtures**, not on live provider calls.

## 6. Open lines for the owner (`plan/10` §0.4 lines 18–23)

18. **The live-contract test job** (real calls to each provider on a schedule). Recommendation: defer
    the job and record the line as waived for version 1.0.
19. **Hash algorithm.** `docs/09` §7 has a blocking rule that asks for `sha256:` in the update file,
    while the measured build output uses `sha512:`. One of the two must give way.
20. **Gemini chat in balanced mode.** Should chat follow the audio change from line 27 (warn and confirm
    instead of refuse)?
21. **Risk R-19, the quality of text pulled out of PDF files.** Whether a later phase checks that
    quality at scale was carried to Phase 7, and no card does so yet.
22. **May `P3-T31` (the Phase 3 acceptance run) go ahead without the deferred `P3-T37`?** `P3-T37`
    still blocks `P3-T31`. Recommendation: yes, drop the dependency with a dated note.
23. **`autoSummarize`** (summarise new items automatically) against the blocking rule "no background
    processing". One of the two must give way.

## 7. Unresolved

- No one else has reviewed `plan/10` yet.
- The owner has not said whether 28.50–40 days is accepted.
- Phase 7 was split into cards before the exit conditions (a) and (c) in `plan/05` §0 held: Phases 3 to
  6 are not done, and Phase 6 is not built. `plan/10` §0 records which entry conditions are met.
- `docs/10` NFR-20 got no note of this date. `P7-T01` brings the remaining design documents into line,
  NFR-20 included.
- Gemini chat in balanced mode is marked "not decided" in `docs/09` §3.5 until line 20 is answered.
- No card was set to done.

## 8. Self-review and checks

- Every file a card names either exists or is created by a named card. Checked by script over all 114
  paths that `plan/10` names. The files not yet on disk are each created by the card that names them;
  the one exception is this report, which now exists.
- No card cites a source line number (script found none). Every "line N" in `plan/10` points to the
  decision table in `plan/10` §0.4.
- Every Phase 7 deliverable in `docs/11`, every line of the Phase 7 finishing conditions, and every work
  area `W7-1` to `W7-11` maps to at least one card (`plan/10` §0 and §3).
- Every figure in this report is a card sum, arithmetic on card sums, or a figure already on record.
  Nothing is presented as measured that was not measured.
- One card reference was corrected while writing: the card that built `removeGeneratedNotes` is
  `P3-T29`, not `P3-T26`.
- `plan/05` §4 is now a pointer. The old contents moved word for word to `plan/10` §5.1–§5.4, with a
  note on §5.3 saying where each decision landed.
- `scripts/derive-task-index.ts` reads `plan/10` as an eighth table. Changes:
  - the Phase 7 entry in `PHASES`;
  - `DECOMPOSED` is now 98 + 25 + 30 + 19 + 31;
  - the header count "Phase 7 **n of m**" is kept current.
- Command results:
  - `env -u OPENROUTER_API_KEY npm run index:derive`: 269 tasks, 112 done, 157 to do; Phase 7 has 31
    rows.
  - `env -u OPENROUTER_API_KEY npm run typecheck`: passed.
  - `env -u OPENROUTER_API_KEY npm run lint:check`: passed (eslint and prettier).
  - `env -u OPENROUTER_API_KEY npm run test:unit`: 139 files; 7,808 tests passed, 105 skipped.
  - No test covers `scripts/derive-task-index.ts` directly.

## 9. Files changed (uncommitted, base commit 6a3c944)

- New:
  - `D:\KIST\projects\research_helper\plan\10-phase-7-release.md`
  - `D:\KIST\projects\research_helper\plan\reports\P7-decomposition.md` (this report)
- Modified, plan files:
  - `D:\KIST\projects\research_helper\plan\00-task-index.md` (items 379 and 380, §1, §3, §4, header)
  - `D:\KIST\projects\research_helper\plan\04-phase-3-llm-summaries.md` (`P3-T37` deferral note)
  - `D:\KIST\projects\research_helper\plan\05-phases-4-7-outline.md` (§4 reduced to a pointer)
  - `D:\KIST\projects\research_helper\plan\06-human-gates.md` (`G-44`, `G-45`, notes on eight gates)
  - `D:\KIST\projects\research_helper\plan\09-phase-6-audio-report.md` (Part A)
  - `D:\KIST\projects\research_helper\plan\README.md` (§2 row for `10`, notes in §2 and §7)
- Modified, script:
  - `D:\KIST\projects\research_helper\scripts\derive-task-index.ts`
- Modified, docs:
  - `D:\KIST\projects\research_helper\docs\04-audio-report-tts.md`
  - `D:\KIST\projects\research_helper\docs\09-security-privacy-and-api-keys.md`
  - `D:\KIST\projects\research_helper\docs\10-requirements-and-user-stories.md`
  - `D:\KIST\projects\research_helper\docs\11-implementation-roadmap.md`
  - `D:\KIST\projects\research_helper\docs\12-prompt-library.md`
  - `D:\KIST\projects\research_helper\docs\13-testing-build-and-release.md`

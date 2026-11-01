VERDICT
The Phase 5 draft is written: D:\KIST\projects\research_helper\plan\08-phase-5-related-papers.md, marked "DRAFT — for review, 2026-11-01", every card `TODO`. It has 30 cards (P5-T01…P5-T30) summing to 33.25 developer-days, so the band they imply is 33.25–47 d (33.25 × 1.4 = 46.55 → 47). That is 58 % above the scaled low end of 21 d that `docs/11` §1 publishes (33.25 ÷ 21 = 1.58) and 15 % above its scaled top of 29 — past the ~30 % that `plan/README.md` §7 treats as the signal to re-estimate. Against the superseded top of 14 d it is 2.38×, beside Phase 4's measured 2.16×. Every `docs/11` §1 Phase 5 deliverable and definition-of-done line has at least one card. 29 lines are left open for the owner or the coordinator (28 on cards, 1 in §4). No estimate site was touched (`docs/11`, `plan/00`, `plan/05`, `plan/README.md`), no code, test, addon, typings or script file was edited, and nothing was committed.

FILES CHANGED
- create `plan/08-phase-5-related-papers.md`: §0 summary (goal, why this phase differs, entry-condition table measured 2026-11-01, deliverables → cards, risks, effort, definition of done, §0.1 already-landed names, §0.2 conventions 19–25 added to `plan/04` §0.2 items 1–10 and `plan/07` §0.2 items 11–18, §0.3 earlier-phase dependencies), §1 roll-up with critical path, §2 thirty cards, §3 estimate reconciliation, §4 items not carded.
- create `plan/reports/phase5-draft.md` (this report).
- Scratch only: the checker `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p5check.mjs`.

RUNS
- The checker script over the plan file: 30 cards; card sum 33.25 = §1 table sum 33.25; every card's title, estimate and gate match the table; 0 Depends/Blocks mismatches, no cycle, no unknown id; no path `create`d by two cards; gate cells spelled `none` or `**Yes** — …`; entry points `P5-T01`, `P5-T02`, `P5-T04`; one terminal, `P5-T30`; estimates 0.5–1.5 d, mean 1.11 d; 28 `Open — recommended` markers.
- Longest chain: `P5-T01 → P5-T03 → P5-T18 → P5-T21 → P5-T23 → P5-T24 → P5-T25 → P5-T26 → P5-T27 → P5-T28 → P5-T30` = 13.5 d. Feature 2's own chain (`P5-T01 → P5-T06 → P5-T12 → P5-T13 → P5-T14 → P5-T16 → P5-T17`) is 8.25 d, so a second agent can carry it in parallel.
- As instructed, no build, typecheck, test or Zotero run.

CARD LIST (estimate; Phase 5 dependencies)
- T01 Reconcile Phase 5 types and state machines in docs/07 — 1.0; none
- T02 Preference rows Phase 5 reads — 0.5; none
- T03 Profile, recommendation and embedding tables (migrations 8–10) — 1.0; T01
- T04 Record the relatedness fixtures — 1.0; none
- T05 Semantic Scholar references, citations, title match — 1.0; T01, T04
- T06 Semantic Scholar Recommendations, one seed and many — 1.25; T01, T04
- T07 Europe PMC citations and references — 0.75; T01, T04
- T08 PubMed related articles (elink pmra) — 1.0; T01, T04
- T09 Crossref deposited references and title search — 0.75; T01, T04
- T10 Relatedness cache, negative cache, request budget — 1.0; T01
- T11 Seed resolution with a title-match threshold — 1.25; T05, T09
- T12 Related-paper generators, union and hydration — 1.25; T05–T10
- T13 Related scoring, reason chips, recency de-emphasis — 1.0; T12
- T14 Related pipeline: stages, partial results, wiring — 1.5; T11, T12, T13, T19, T20
- T15 Item menu entry and the window's related mode — 1.25; T02
- T16 Related results: relation column, picker, key notice — 1.25; T14, T15
- T17 Import from related results, optional Related link — 1.0; T02, T16
- T18 Collection reader and statistical profile — 1.25; T01, T03
- T19 Lexical similarity floor (TF-IDF) — 0.75; T01
- T20 SPECTER2 vectors: fetch, normalise, store — 1.25; T03, T05
- T21 Centroids and seed selection with negatives — 1.0; T18, T19, T20
- T22 COLLECTION_PROFILE call with estimate and consent — 1.5; T18
- T23 Recommendation candidate generators — 1.5; T06, T07, T08, T10, T21
- T24 Recommendation filters, scoring, diversity, reasons — 1.5; T19, T20, T21, T23
- T25 Recommend pipeline: profile check, stages, wiring — 1.5; T03, T22, T23, T24
- T26 Recommend entry and the editable profile panel — 1.5; T02, T15, T25
- T27 Recommendation results: dismiss, clusters, import — 1.5; T26
- T28 Prove the no-key path end to end — 0.75; T17, T27
- T29 Probe the positive-seed cap with the real key — 0.5; T06. Human gate: G-26 (owner rotates and enters the Semantic Scholar key) and the owner's approval of one probe run, no money.
- T30 Phase-5 acceptance run against the definition of done — 1.0; T28, T29. Human gate: G-26, G-27 (owner as domain expert), G-18 (LLM key), and a spend gate for profile calls, expected under $1.

Earlier-phase IDs are not in any Depends cell, for `plan/07` §0.3's reason; they are in §0.3's table and each card's Notes. What Phase 5 calls from Phases 2–3 is built; `P3-T22`, `P3-T31`, `P3-T37` (no reports) and Phase 2's Part B sign-offs are not, and only `P5-T30` records them.

WHERE THE DAYS WENT, AND WHAT IS STILL LIKELY LOW
By work area (`plan/05` §2.1): review/exclusion/import UI and pipelines 8.0; citation-graph gathering 4.75; collection profiler 3.75; types/prefs/tables/fixtures 3.5; candidate generation 3.0; scoring 2.5; rate limits/caching/no-key/probe 2.25; embeddings 2.0; Recommendations adapter 1.25; seed resolution 1.25; acceptance 1.0. The hidden work is: four adapters must implement a `findRelated` contract no adapter implements today (`plan/00` §6 item 184), and none of the sources caches responses yet; a fixture pass against a host whose anonymous pool refused 12 of 12 calls; two pipelines with composition-root wiring; the plugin's first item context menu; two new modes of a search window whose view model is 3 171 lines and whose document script is 3 940; three migrations with their pinned tests; a documents-first type reconciliation; and a mutation sweep per logic card (the Phase 4 practice). Still likely low by 2–3 d (the window work, the S2 half of the fixtures possibly moving to the owner, `fanOut` under a per-run budget, library-wide term counts on a 10 k-item library), which would put the low end near +68 % to +73 %. If the embedding line is answered "lexical only", the sum drops 1.75 d to 31.5.

OPEN LINES (29) — the questions for the owner, grouped
Each: the decision · recommended · main alternative · [who decides under item 313: owner = money, keys, labels, Korean, scope, finishing conditions, privacy/security; coordinator = the rest].

Theme 1 — What works without a Semantic Scholar key, and what the AI model is used for (6)
1. (P5-T28) Is a Semantic Scholar key required for related papers and recommendations? · No: both features work without it, at lower quality, and say what a key adds; `docs/10` question 8 marked decided; the preferences pane's "need a key" text corrected to "work better with a key" · Require the key. [owner: scope]
2. (P5-T12) Without a key, does the plugin still try Semantic Scholar's free shared access? · No request at all (12 of 12 refused when measured); the Semantic Scholar sources show "no key" · One attempt per run with back-off, which adds seconds of refusals to most runs. [owner: scope]
3. (P5-T20) How "similarity" is computed in v1 · Semantic Scholar's paper vectors (SPECTER2) when a key is present, otherwise word-overlap similarity computed on the computer; no third-party embedding service · Word-overlap only (−1.75 d), or add OpenAI embeddings as a fallback (+1.5 d, a new "data sent to" notice and cost line). [owner: scope]
4. (P5-T22) Which AI-model calls Phase 5 makes · One call per collection profile (`COLLECTION_PROFILE`), cached until the collection changes; ranking and the one-line reasons are computed in code; the ranking prompt `RECOMMEND_RANK` is not built in v1 · Also re-rank every run with `RECOMMEND_RANK` (+1.5 d, a paid call per run). [owner: scope, money]
5. (P5-T22) What the profile call is sent · One line per paper: title, year, journal, top subject terms — no abstracts, no summaries; the privacy document's "a sample of titles" corrected to "every paper's title" · Send the Phase 4 summary digests, which first needs a summary of every paper (cost, time, and the separately labelled mode the privacy document requires). [owner: privacy]
6. (P5-T30) A spending-approval gate for recommendation runs · A new gate G-43, modelled on the report gate G-42 · The card states its expected spend only. [owner: money]

Theme 2 — Find related papers from one item (8)
7. (P5-T11) When a paper has only a title, how close must a match be · Title similarity ≥ 0.95, or ≥ 0.88 with the year within one and the same first author — the duplicate-detection rules already in use; two or more passing → the user picks · A new threshold tuned on a labelled sample. [coordinator]
8. (P5-T15) More than one item selected · The menu entry is disabled; a tooltip only if Zotero's menu shows one on a disabled entry · "Find papers related to N items" (+1 d). [owner: scope]
9. (P5-T12) "Co-cited" papers (papers cited together with the seed) · Not in Phase 5; to the backlog · Build it now (+0.5 d). [owner: scope]
10. (P5-T16) Year range in the related window · No year filter by default; papers outside the usual three-year window are greyed and unticked · Restrict to three years by default, which hides foundational references. [coordinator]
11. (P5-T02) Default of the new "link imported papers to the seed" setting · On (the window sketch shows it ticked) · Off. [coordinator]
12. (P5-T17) Which imported papers get linked to the seed · Newly created ones and ones already in the library alike · Newly created ones only. [coordinator]
13. (P5-T17) A provenance note for related or recommendation imports · None in v1; the job record keeps the seed or profile · Extend the search-provenance record and its schema. [coordinator]
14. (P5-T01) What a related or recommendation job is · It ends when results are shown; importing is the search window's existing import; no automatic resume after a restart · Keep the job alive while the user chooses (the design document's "awaiting selection" state with a 30-minute timeout). [coordinator]

Theme 3 — Recommend new papers from a collection (9)
15. (P5-T26) Where the user sees and edits the collection profile · A profile panel inside the search window's recommend mode, drawn in `docs/08` first · A separate profile-editor window. [coordinator; owner if it is read as scope]
16. (P5-T25) Do profile edits last beyond one run · Yes, stored with the profile and re-applied when it is rebuilt · One run only. [coordinator]
17. (P5-T25) Scope of "Not interested" · Per collection (a paper dismissed for one collection can still appear for another) · Library-wide. [coordinator]
18. (P5-T01) Which scoring signals · The design document's eight (similarity, recency, citations per year, novelty, author and journal affinity, agreement between sources, shared references) · The architecture document's seven older ones. [coordinator]
19. (P5-T24) Papers already in the library but not in this collection · Shown, marked "in library", unticked (FR-46) · Removed, as `docs/05`'s filter does. [coordinator]
20. (P5-T24) Preprints · A "preprint (not peer reviewed)" label on every preprint; a per-run "Peer-reviewed only" box, off by default · A setting, on by default. [coordinator]
21. (P5-T27) The "Familiar ↔ Exploratory" slider · Per run, default 25 of 100, not saved · A saved setting. [coordinator]
22. (P5-T23) Which sources of candidates · All five the design names, including the one-request "new papers by your frequent authors" watch · Drop the author watch, which no requirement names. [owner: scope]
23. (§4) A held-out evaluation tool (hide recent papers, check whether they come back) · Not a card: no finishing condition needs it, and the owner's expert judgement (G-27) is the finishing condition; to the backlog · A card now (+1 d). [owner: finishing conditions]

Theme 4 — Data, storage and testing (6)
24. (P5-T01) What a source returns for "related" · Each paper with its relation (reference, citation, recommendation, similar), rank, score and citation context, declared in `docs/07` first · Source-specific methods outside the shared interface. [coordinator]
25. (P5-T03) Where paper vectors are stored · The dedicated `embedding` table only; the unused cache namespace of the same name is left alone and the design note naming it corrected · Store them in the general cache. [coordinator]
26. (P5-T10) How long relatedness responses are cached · The design document's ten per-signal lifetimes (references 90 days, citations 7, recommendations 3, …), written into `docs/07` · The architecture document's two (24 hours / 30 days). [coordinator]
27. (P5-T04) Recording test responses from Semantic Scholar · The agent records without a key, retrying off-peak; anything refused is recorded by the owner with the key in the environment, no cost · The owner records all of them with the key. [owner: keys]
28. (P5-T29) Probe sizes for the "how many example papers" limit · 10, 20 and 50 positive examples with 10 negatives; keep 15 unless 15 fails · No probe; ship at 15. [coordinator; the run itself is gated on the owner's key]
29. (P5-T02) How the two features stay hidden until they work · Two hidden settings, `related.enabled` and `recommend.enabled`, off, switched on by the acceptance card · One shared hidden setting. [coordinator]

Lines 3, 4 and 5 interact: answering 4 with RECOMMEND_RANK adds a second content flow that line 5's privacy wording must also cover; answering 3 against its recommendation changes `P5-T03`, `P5-T20`, `P5-T21` and the "data sent to" notices.

CONTRADICTIONS FOUND BETWEEN DOCUMENTS
1. Key requirement: `docs/08` §7.4's pane text says "Related papers and recommendations need a key"; `docs/10` §5 Q8's default is "no — degrade gracefully", and `docs/11` §1's definition of done requires a no-key path.
2. `docs/11` §3's risk table says Phase 2 retired "R-3 (fallback proven)", but no adapter implements `findRelated` (`plan/00` §6 item 184: "No card in the plan wires `findRelated` for any adapter"), so no relatedness fallback exists to have been proven. `P5-T28` corrects it.
3. `docs/11` §1 Phase 5 and §3's table say Phase 5 retires "R-19 (validated at scale)"; R-19 is PDF full-text extraction, which no Phase 5 deliverable touches.
4. `docs/12` §15 `COLLECTION_PROFILE` takes "paper digests" (built from `PaperSummary`, `docs/06` §6.1 item 5); `docs/09` §3 row 6 lets the LLM see only terms, subjects, venues, years "and optionally a sample of titles", with abstracts only in a distinct labelled mode.
5. `docs/12` §16 `RECOMMEND_RANK` ranks by model with rule 2 "do not reward citation count"; `docs/05` §7.4 ranks in code with a velocity term built on citation counts and §8.5 warns against LLM relevance judgements. `docs/12`'s header says `docs/05` "consumes COLLECTION_PROFILE and RECOMMEND_RANK"; `docs/05` names neither.
6. `docs/07` §5.2 `RecommendationSignals` (seven members) and the single `discoveredVia` disagree with `docs/05` §7.4's eight terms over multi-generator candidates.
7. `docs/07` §12.5's recommend machine is query-centric (`GeneratingQueries → Searching` per source per query); `docs/05` §7.1/§7.3 has five generators with Semantic Scholar Recommendations primary and keyword search one of five.
8. `docs/07` §12.2 keeps the related job alive in `AwaitingSelection` with a 30-minute timeout; the search window built in Phases 1–2 splits fetch and import into separate runs, and `docs/08` §5 reuses that window.
9. Embedding defaults: `docs/03` §16 (`gemini-embedding-2`, then `text-embedding-3-small`, then BM25; Anthropic-only "BM25 + LLM re-rank") vs `docs/05` §5.1/§5.5 (SPECTER2, then `text-embedding-3-small@768`, then TF-IDF).
10. `docs/07` §13 item 5 leaves "whether embeddings ship in v1" open while `docs/07` §8.3 declares the `embedding` table and `docs/05` assumes vectors.
11. Two homes for vectors: the `embedding` table (`docs/07` §8.3, `docs/05` §5.4) and an `embedding` cache namespace with `embeddingKey` (`docs/07` §9.1–§9.2, `CACHE_NAMESPACES`).
12. FR-14 requires a confidence threshold "per `05-related-work-discovery.md`", which states none; `docs/08` §5.3's title fallback shows a banner and proceeds, with no disambiguation step, while FR-14 scenario 2 requires the user to pick.
13. `docs/08` §5.1 step 5 sets the seed relation on every import; FR-17 makes it a preference; `docs/07` §8.5 declares no such preference.
14. FR-18 has the three-year window active with older rows de-emphasised and unchecked; `docs/08` §5.2 says "the year filter is off by default here".
15. FR-46 marks library items outside the collection "in library" and unchecked; `docs/05` §7.4's hard filter removes everything owned library-wide.
16. `docs/10` §5 Q2 is unstruck though `G-16` decided it 2026-10-14 and Phase 2 built it; Q13 is unstruck though Phase 2 built its recommended default (`G-17`'s corrected text).
17. `docs/08` §1 says "Three windows total" and routes recommendations into the search window, but no `docs/08` section draws the profile display/edit step FR-44 requires; `docs/11` §1's modules list a separate "profile editor" pane.
18. `docs/05` §6.1 cites "doc 02 §3.7" for resolving identifiers; §3.7 is the PMC ID converter only — the cross-ID resolver is Semantic Scholar `/paper/batch` (`docs/02` §6.3).
19. `docs/05` §9.2's ten per-signal TTLs vs `docs/07` §9.2's two `source-response` TTLs.
20. `docs/07` §12.5 "optional LLM rationales" and `Recommendation.rationale` ("model-authored") vs FR-47's rationale of "matched terms, citation overlap, or similarity score", derivable in code.
21. `docs/12` §15 keys the profile cache on sorted `(itemKey, contentHash)`; `docs/07` §5.2 keys staleness on `membershipHash` over item keys and `dateModified`.
22. `docs/03` §13.2 calls the lexical floor BM25; `docs/05` §5.5 calls it TF-IDF.
23. `plan/05` §2.4 says a V-14 result of "unusable" should re-sequence Phase 5 after Phase 6; V-14 did measure "unusable", but the key arrived on 2026-09-30, so the trigger no longer applies. `plan/06` `G-03`'s header still says Phase 5 "carries 10.5–15 days of float"; `docs/11` §2 now says 17.75–25.

WHAT I COULD NOT DETERMINE
- Whether the Semantic Scholar key has been rotated and entered: `plan/06` `G-03`'s last note (2026-10-14) says it must be rotated before entry; `G-26` is open and nothing records an entry since.
- Whether the anonymous Semantic Scholar pool will let the new endpoints be recorded (`P5-T04`); the 2026-10-15 search fixtures were recorded unkeyed, the 2026-09-09 measurement refused 12 of 12.
- Whether Zotero's menu manager shows a tooltip on a disabled entry (`P5-T15` asks).
- How the search pipeline's preview import writes search provenance for a non-keyword run (`P5-T17` asks).
- Whether the search window's document can host a second and third view model, or the modes must extend `searchImportViewModel.ts` (`P5-T16` and `P5-T26` mark their `Files` row as a guess).
- Whether `fanOut` can run under a per-run request budget without change (`P5-T23`).
- The `/paper/search/match` response and its "no match" status; `docs/02` §6.2 lists the endpoint but records no response.
- Whether `fromZoteroItem`'s snapshot exposes `dateAdded` for seed selection (`P5-T21`'s Do NOT names the trap; I did not check the field).
- Europe PMC's real rate limit and Crossref's `reference[]` coverage on typical seeds.
- The cost of library-wide term counts on a 10 k-item library (`P5-T18`).
- `P4-T18` is editing `registerPipelines.ts`, `container.ts`, `registerUI.ts`, `docs/07` and `docs/12` now; names cited on `P5-T03`, `P5-T14`, `P5-T22`, `P5-T25` may move and each card says to grep first.
- Dollar figures are order-of-magnitude at `docs/06` §5.4's illustrative prices, not live prices.

FOR THE COORDINATOR (not owner questions)
- After the owner decides: add `plan/08` to `scripts/derive-task-index.ts` and a "Phase 5" table to `plan/00` §4; a row in `plan/README.md` §2; reduce `plan/05` §2 to a pointer (moving its §2.1–§2.4 into this file as `plan/07` §5 did); propagate the card sum to the five `plan/README.md` §7 sites.
- If line 6 is accepted, add `G-43` to `plan/06` §7.
- Documents that only the coordinator touches: `docs/10` §5 Q2 struck as decided by `G-16`; Q8 per line 1; `docs/11` §1/§3's "R-19" for Phase 5 and Phase 2's "R-3 (fallback proven)"; `plan/06` `G-03`'s float figure.
- Lines 1, 2 and 27 depend on the key's state; asking the owner whether `G-26` can be done now would unblock `P5-T29` early, which is the card whose answer can change `P5-T21`.
- Wave advice: `P5-T02` and `P5-T04` can run now beside `P4-T18`; `P5-T01` should wait for `P4-T18`'s `docs/07` commit.

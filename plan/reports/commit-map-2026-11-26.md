# Commit numbers before and after the 2026-11-26 rewrite

**Why.** The owner chose to remove the Windows user name from the 251 commits that had not yet been
pushed, before the first push of them to the public repository (`plan/00` §6 item 424(a)). The name was in
90 files under `plan/reports/` (written by earlier batches; replaced in the working tree by item 419(b)).
Rewriting gave each of those commits a new number. Plan documents and reports written before the rewrite cite
the old numbers; this table turns an old number into the new one.

**How.** `git filter-branch --tree-filter` over `origin/main..main` only, replacing the name with `<user>`
in files under `plan/`. The commits already on GitHub were not touched, so no force push was needed. Checks
after the rewrite: 251 commits before and after, in the same order; the final tree is identical to the tree
before the rewrite; 0 lines and 0 commit messages in the rewritten range name the user. Commit dates,
authors and messages are unchanged.

Newest first. The first row's new number is the commit that existed before this file was added.

| Old | New | Date | Subject |
|---|---|---|---|
| `a14f6a9` | `32e5a93` | 2026-11-26 | G-17 signed off by the owner; P2-T13's loosened-threshold check run (item 423) |
| `5cba570` | `005d8f0` | 2026-11-26 | Owner sets 11 cards DONE (item 422(a)); P7-T22 held (item 422(b)) |
| `920d9d8` | `baa901d` | 2026-11-26 | P7-T43: test windows stay visible under other windows (batch O, item 420) |
| `2a5f81c` | `a85c6b8` | 2026-11-26 | Item 419: user name out of 90 reports; P4-T23 spec ignores the report marker |
| `ae3a39e` | `db0e07d` | 2026-11-26 | P1-T47: stored, exported and logged stacks no longer name the install folder (batch M, item 417(b)) |
| `1674121` | `3646a9e` | 2026-11-26 | Korean for P1-T38's three sentences, approved by the owner (item 417) |
| `4f8f186` | `c876a88` | 2026-11-26 | Batch L: P1-T38 validation sentences, P1-T37 host and timeout on errors, P0-T35 probe (items 416, 417) |
| `26250a9` | `d51cd13` | 2026-11-25 | Record item 415(a): P7-T41's line read as met by batch K's six runs |
| `76724b6` | `d036e56` | 2026-11-25 | P7-T42: the summarize window keeps its rows between updates (batch K, items 414, 415) |
| `7f1a6df` | `d31e058` | 2026-11-25 | Record item 413 answers: card P7-T42; P7-T41 read with accessibility off |
| `3e67b57` | `5e2e052` | 2026-11-24 | Batch J: pauses traced to Gecko accessibility work; 500-item window freed (items 412, 413) |
| `661a96b` | `e8610c0` | 2026-11-24 | Record item 411 answers: index probe first, keep npm check blocked; heap snapshot and gate path check (coordinator) |
| `880fd42` | `8383040` | 2026-11-24 | Batch I: six recorded integration runs on Zotero 10.0.8 (items 410, 411) |
| `a6fa4e7` | `1412364` | 2026-11-21 | Owner sets 123 cards DONE (item 409(a)); Korean prompts approved (item 409(b)) |
| `187479b` | `c024872` | 2026-11-21 | Add DONE review list and P7-T05 step 1 Korean prompt review files |
| `0106721` | `add7ce5` | 2026-11-21 | Fill SECURITY.md contact with GitHub private vulnerability reporting; record item 408 |
| `f779190` | `62445ea` | 2026-11-18 | Record owner answer to plan/00 item 407(a): keep profile prefs, check host list each run |
| `92c6baf` | `a37503d` | 2026-11-18 | Phase 7 batch H: item 405 answers, P7-T41 duplicate screen, test profile update prefs |
| `2ba93f1` | `057eece` | 2026-11-18 | Phase 7 batch G: item 403 answers, P7-T39, P7-T40, P7-T15 profile, P7-T38 accepted |
| `a52225b` | `14dc7e7` | 2026-11-18 | Phase 7 batch F: test-profile memory measurement, README.ko.md adopted, npm audit fix attempt |
| `9500f63` | `cc4ffa3` | 2026-11-18 | Phase 7 batch E: accessibility pass, Korean README draft, announcement drafts, startup timings, release checklist |
| `ff23bcd` | `ced96ca` | 2026-11-18 | Phase 7 batch D: security follow-ups, string and Intl sweep, restore-notice fix |
| `8f1f828` | `a14aeb9` | 2026-11-17 | Phase 7 batch C: data clearing, remove-all content, security review, README and CHANGELOG, offline message |
| `a4fb6b3` | `b2011e2` | 2026-11-17 | Phase 7 batch B: preferences sections, retention notes, offline check, diagnostics, redaction audit |
| `d741ff2` | `462d9b0` | 2026-11-17 | Phase 6 follow-ups (items 385-387) and Phase 7 batch A: P7-T01, T02, T04, T12, T21, T22, T32 |
| `9109bcc` | `049358a` | 2026-11-17 | Phase 6 batch 4: item 384 decided; docs/07 §4.5 figures restored; P6-T16 pipeline wiring, P6-T17 report window and menu, P6-T18 offline end to end |
| `322cd60` | `c07debf` | 2026-11-17 | Phase 6 batch 3: items 382 and 383 recorded; P6-T07 script pass, P6-T08 Korean path, P6-T10 TTS prices and estimate, P6-T14 failure paths, P6-T15 confirmation, tier and disclosure |
| `ef9caf4` | `c6980dd` | 2026-11-17 | Phase 6 batch 2: P6-T05 Gemini TTS client, P6-T09 chunker, P6-T11 synthesis loop, P6-T12 WAV assembly, P6-T13 delivery into Zotero |
| `7d16009` | `ba6fc32` | 2026-11-16 | Phase 6 batch 1: item 381 recorded; P6-T01 audio types, P6-T02 audio prefs, P6-T03 TTS recorder and stand-ins, P6-T06 prompts held pending item 382 |
| `678c50f` | `3de5a02` | 2026-11-16 | Phase 6 open lines answered (item 379); Phase 7 decomposed: 31 cards, 28.50-40 d; every phase now measured (item 380) |
| `6a3c944` | `1431f46` | 2026-11-16 | Phase 6 decomposed: 19 cards, 20.00-28 d; owner's four audio decisions recorded (item 378) |
| `76fc753` | `9d9fae6` | 2026-11-13 | P3-T41 part 2: held-out 92.94 % recorded, detector validated; single-shot prompt drops the section clause (item 377) |
| `257b244` | `ab5db5f` | 2026-11-13 | P3-T41 part 1: section detector improved on the first set (tuned 93.61 %), validation now only from a held-out record (item 376) |
| `01da6a6` | `09059d4` | 2026-11-13 | Held-out IMRaD labels: the owner's 19 papers, given in chat (item 375) |
| `d4facdb` | `654ad0b` | 2026-11-12 | P3-T40: held-out IMRaD fixture set (19 of 20 papers), P3-T41 carded; G-22 decision written (item 374) |
| `7e11e2b` | `161eb29` | 2026-11-12 | Owner decisions: dedup recall settled as measured; held-out PDFs (item 373) |
| `5dabaa2` | `a94084d` | 2026-11-12 | Dedup: the second top-up's twenty labels, given in chat (item 372) |
| `7253a0d` | `72b44b4` | 2026-11-12 | Dedup: a paper's attached documents and versions link, never merge; second top-up of 20 (P2-T40, item 371) |
| `2ba8958` | `ff2bfa9` | 2026-11-12 | Dedup: the top-up's ten labels, and a paper's attached documents relabelled linked versions (item 370) |
| `2e40932` | `cb29d13` | 2026-11-11 | Dedup: a ten-pair top-up of the label sample, drawn once (item 369) |
| `1e99125` | `c4a4c2e` | 2026-11-11 | Test: the theme contrast test waits for the switch, not a fixed time (item 368) |
| `a9ea442` | `3fd6642` | 2026-11-10 | Dedup: compare a DOI family across title blocks; newest F1000 version wins (P2-T39, item 367) |
| `98d9689` | `a79a8af` | 2026-11-10 | Plan: the owner's decisions on dedup recall, a DOI-family pass and the F1000 winner (item 366) |
| `d1cda01` | `94ce0a1` | 2026-11-10 | IMRaD: accuracy harness and degrade switch; 68.00 % against 85 % (P3-T22, item 365) |
| `3067c0f` | `99ce630` | 2026-11-10 | IMRaD: the owner's ground truth for all 40 papers, from chat (item 364) |
| `673dd53` | `57b0dc0` | 2026-11-10 | Dedup: a paper's reviews and versions merge by DOI family (P2-T38, item 363) |
| `0053237` | `1586944` | 2026-11-10 | Dedup: pair 40 relabelled by the owner; no false merge in the sample; P2-T38 decided (item 362) |
| `f103af5` | `0bbbd89` | 2026-11-10 | Dedup: the owner's 60 labels from chat, and the first accuracy measurement (item 361) |
| `becbeca` | `ebf60fd` | 2026-11-06 | Summaries read each type's own title, date and venue; Import asks for a new collection's name; layout fixes |
| `46e08d4` | `2e1cfc7` | 2026-11-06 | Korean: the owner's review of 116 strings (related and recommend windows), and the egress sentence naming every host |
| `c39b20e` | `01a2e33` | 2026-11-06 | Plan: owner's Korean review of 116 strings, the egress sentence naming every host, and next steps (items 357, 358) |
| `6876ba4` | `a05e110` | 2026-11-06 | Search dialog: an element asked to hide is no longer drawn |
| `5542c16` | `6ad6e77` | 2026-11-06 | Recommend window: give the profile the room of the inert rows before a list |
| `e4bc476` | `958874e` | 2026-11-06 | Phase 5: P5-T26, T27, T28 (recommend entry, profile panel, results, no-key proof) and five window defects |
| `43c69d6` | `552cbf5` | 2026-11-05 | Phase 5: P5-T16, T17, T24, T25, T32 (related window, import and seed link, recommend scoring and pipeline, Crossref lookup); egress entry before the send; live-request guard; items 340-350 |
| `1d5e09e` | `9bc7c84` | 2026-11-05 | Phase 5: P5-T11, T12, T13, T14, T20, T21, T23 (related pipeline, scoring, vectors, seeds, recommend generators); key gate closed; title reads fixed; items 339-344 |
| `15a157c` | `17c50c4` | 2026-11-02 | Phase 5: P5-T05, P5-T06 (Semantic Scholar related routes, on marked stand-in fixtures); Phase 4: usage capture for P4-T23 step 4, P4-T22 and P4-T23 re-priced; items 336-338 |
| `2273874` | `f58c5a1` | 2026-11-02 | G-41: approved Korean for P4-T21's stop reason, P5-T22's two strings and FINDING P4-T22-2's two labels; item 335(l) |
| `5fde102` | `f9ff65d` | 2026-11-02 | Phase 5: P5-T15 (item menu, related mode), P5-T18 (profile statistics), P5-T22 (profile call); Phase 4: P4-T21 (Korean path), P4-T22 second fix and re-pricing, P4-T23 steps 0-2; items 334-335 |
| `9bc7cc4` | `bac040f` | 2026-11-02 | Phase 5: P5-T03 (relatedness tables and stores); Phase 4: P4-T22 window fix; item 333 |
| `6dfbb06` | `88106b2` | 2026-11-02 | Phase 5: P5-T02 (preferences), P5-T07, P5-T08, P5-T09 (Europe PMC, PubMed, Crossref related routes), P5-T10 (related cache, request budget); item 332 |
| `94af944` | `6977051` | 2026-11-02 | Phase 4: P4-T20 (report window, streaming preview, delivery, resumed-job host); Phase 5: P5-T19 (lexical similarity floor); items 330-331 |
| `092a7c9` | `265097d` | 2026-11-02 | Phase 5: P5-T04 (request builders, relatedness fixtures, keyed recording path for the owner); item 329 |
| `0659187` | `20c186b` | 2026-11-02 | Phase 5: P5-T01 (relatedness, profile and recommendation types); P4-T22 scale test with its finding; items 327-328 |
| `ed589e8` | `6e9e641` | 2026-11-02 | Phase 5 plan accepted: plan/08 at 31 cards and 35.75 d, estimate propagated, G-43 added; item 326 |
| `f9b6dc2` | `8e46901` | 2026-11-01 | Phase 4: P4-T18 (trend-report pipeline: stages, passes, cancel, resume); Phase 5 draft and review; items 318-325 |
| `2989feb` | `4711739` | 2026-10-30 | Phase 4: P4-T09 (self-critique pass, revision loop, warning banner); items 316-317 |
| `f03bec0` | `d446ca3` | 2026-10-30 | Phase 4: P4-T12 (title block, tables, appendices, report labels), P4-T14 (report note writer, report table migration 7, Markdown file); items 315-316 |
| `405b450` | `7e75b2e` | 2026-10-30 | Item 312: target words capped at 4 250 with a warning, rewrite failure keeps the earlier draft (cards), PATCH confirmed, Korean for the structure stop; items 313-315 recorded |
| `8dbad15` | `52ac7b0` | 2026-10-30 | Item 311: structure-invalid stop with a message, structure note approved, report prompt ceilings raised to 23 000 / 26 000 (prompts 1.0.1, PATCH) |
| `0c441ae` | `9343921` | 2026-10-29 | Phase 4: P4-T08 (report composition call and structural validation); item 310 |
| `04d6e63` | `75ec08c` | 2026-10-29 | Item 309: estimate counts per-theme packing at its worst, dialog shows themes reserved, batch over band goes to merge with a measured merge budget, all-unanalysed stop, Korean for the no-theme stop |
| `aff85f4` | `694e54b` | 2026-10-29 | Phase 4: P4-T06 (two-stage clustering, theme merge), P4-T07 (per-theme analysis with sub-batching); item 308 |
| `880a0fb` | `7e9b3d2` | 2026-10-29 | Item 307: Other theme reserved in the estimate, no-theme stop, report entry hidden behind report.enabled, summarize window closed at shutdown, Korean for 11 strings; item 308 recorded |
| `e93a6e8` | `9bb9a16` | 2026-10-29 | Phase 4: P4-T05 (theme clustering with client-side validation), P4-T19 (report window shell and menu entry); item 306 |
| `ed5319a` | `49a331f` | 2026-10-29 | Item pane: strictest privacy mode across the item's collections, Regenerate really re-asks, Korean result lines; item 305 |
| `ff8479e` | `2d816bd` | 2026-10-29 | Phase 3: P3-T28 (item-pane AI summary), P3-T29 (summarize collection, notes, removal), P4-T04 (digest); items 302-304 |
| `e4b0651` | `fc2c78b` | 2026-10-29 | Phase 3: P3-T25 (per-paper summarizer, DR-1, grounding check; fake model only); items 300-301 |
| `77fdec3` | `1780d31` | 2026-10-27 | Phase 3: P3-T23 (chunker, built ahead of the labels) and P3-T30's recorder half; items 297-299 |
| `ee4c09f` | `dd6c7bd` | 2026-10-27 | docs/07 §6.4: summary note tag is research_helper/ai-summary (item 297) |
| `5a3b330` | `5dd745b` | 2026-10-27 | Phase 4 wave 4: P4-T13 (report note HTML, measured note editor), P4-T15 (Markdown export); items 295-296 |
| `70c337f` | `062c6b7` | 2026-10-27 | Phase 4 wave 3: P4-T11 (bibliography and citation nodes through Zotero's citation processor); items 293-294 |
| `f109725` | `4135d04` | 2026-10-27 | Phase 4 wave 2: P4-T10 (citation validator), P4-T16 (report cost estimate and confirmation), P4-T17 (synthesis cache keys); items 291-292 |
| `6becc5a` | `475cf37` | 2026-10-26 | Phase 4 wave 1: P4-T01 (trend types, state machine), P4-T02 (report preference rows), P4-T03 (synthesis prompts and schemas); items 288-290 |
| `c00e82c` | `95026df` | 2026-10-26 | Korean review, cleaning pass, dedup sample, scan probe, Phase 4 plan; items 283-288 |
| `2e437c7` | `eb0982e` | 2026-10-24 | plan: item 281 confirmations; item 282 records where Phase 3 waits on the owner |
| `a416529` | `65011bc` | 2026-10-24 | Phase 3 wave 8: P3-T20 (40-paper IMRaD fixture texts, up to the owner's labelling), P3-T27 (screening); items 280-281 |
| `3a7423b` | `87f6235` | 2026-10-23 | Phase 3 wave 7: P3-T14 (key Test, model suggestions, user prices), P3-T35 (pipeline-context wiring); G-12 set; items 276-279 |
| `dc61675` | `487c671` | 2026-10-23 | Phase 3 wave 6: P3-T04 (LLM provider blocks), P3-T16 (cost estimate, confirmation, BudgetGuard), P3-T21 (IMRaD detector), P3-T26 (summary cache); items 271-275 |
| `d293a7e` | `dc51972` | 2026-10-23 | Phase 3 wave 5: P3-T03 (session-only key tier), P3-T11 (streaming), P3-T15 (privacy policy, egress disclosure), P3-T19 (tiers 3-4, cleaning, OCR probe, language); items 266-270 |
| `896b1ac` | `de4c821` | 2026-10-21 | Item 265: 30-minute batch budget pauses and asks; OutputTruncatedError; user price table (schema 4); NFR-10 ignores Zotero's own hosts |
| `6596104` | `0a063b5` | 2026-10-21 | plan: owner decisions on item 265 (30-minute batch budget pauses and asks, price table in the plugin database, truncation message, NFR-10 test ignores Zotero's own hosts) |
| `9b1126c` | `ab7bb7c` | 2026-10-21 | Phase 3 wave 4: P3-T12 (structured output and repair), P3-T13 (catalogue, pricing, calibration), P3-T17 (llm pool, admission, pooled runner); item 264 (five spec cleanups) |
| `e9fb19b` | `d1984a8` | 2026-10-21 | test: P3-T18's spec cleans up when it ends, not at the end of the suite; Korean for the guardrail message |
| `14b2720` | `18fe678` | 2026-10-21 | Adapters: LLM host rows (1/s, burst 1, 3 in flight, LLM_RETRY_BUDGET), ChatRequest.effort, provider names, PrivacyRoutingError |
| `13f9be8` | `7c1f242` | 2026-10-21 | plan: owner decisions 260 (LLM host rate) and 262 (effort member, provider names, guardrail message) |
| `13d6beb` | `ade9a53` | 2026-10-21 | Phase 3 wave 3: the four LLM adapters (P3-T07 OpenRouter, P3-T08 OpenAI, P3-T09 Anthropic, P3-T10 Gemini) |
| `e135477` | `850d3bd` | 2026-10-21 | plan: owner decisions 257-259 (eviction numbers, P3-T19 lines, wave 3 = four adapters) |
| `0737f36` | `c1d995d` | 2026-10-21 | Phase 3 wave 2: P3-T33 (cache layer; the plugin database opens once in installServices) and P3-T02 (all key-presence flags reconciled at startup; clearAll on uninstall only) |
| `188f988` | `3361d08` | 2026-10-21 | plan, i18n: owner decisions 251-255; Korean for the resume notice |
| `e9445b6` | `ace0ef7` | 2026-10-21 | Phase 3 wave: P3-T06 (provider contract, registry, router, mock), P3-T18 (text acquisition tiers 1-2), P3-T34 (job record, queue, checkpoint, job table) |
| `81a599f` | `fb2a3c1` | 2026-10-21 | plan: owner decisions 248-250 (LLMRouter, one shared database connection, automatic job resume) |
| `a8f680c` | `da68115` | 2026-10-21 | P3-T39: money preferences stored as whole cents (summary.confirmAboveCents, run.maxSpendCents, run.maxSessionSpendCents) |
| `95a8a72` | `30eb0fa` | 2026-10-21 | P3-T38: an LLM error answer is read before the retry decision; a parse failure is never retried by the transport |
| `99de803` | `d016d7d` | 2026-10-20 | plan: cards P3-T38 (LLM 429 body, no transport retry of a parse failure) and P3-T39 (money prefs in cents) |
| `f766279` | `7ce8eca` | 2026-10-20 | i18n: owner-approved Korean for the four LLM error strings (G-41) |
| `0b024ca` | `de466b3` | 2026-10-20 | plan: items 243-247 from P3-T05, P3-T32 and P3-T36 |
| `2a27e3c` | `1bc4fd2` | 2026-10-20 | P3-T32: the fifty preference rows Phase 3 reads; docs/07 notes for items 240-242 |
| `8240fe9` | `1a65dd4` | 2026-10-20 | P3-T05: one provider-error map; LLM retry budget (5 attempts, 1 s base, 60 s cap) and a 3-minute LLM attempt |
| `1952b3b` | `6bfddc8` | 2026-10-20 | P3-T36: one redaction gate (redactRecord) for every new persisted record, with a partly-redacted mark |
| `b83a052` | `dc7a96d` | 2026-10-20 | plan: owner decisions 240-242 (LLM retry and 3-minute wait, preference names, redaction gate scope) |
| `a8c2d02` | `206f1e6` | 2026-10-20 | P3-T24 step 7: prompt files reach the bundle through import attributes |
| `f64c85b` | `10d2a94` | 2026-10-20 | ci: the in-Zotero integration job blocks pull requests; Zotero pinned to 10.0.3 |
| `b2d7f58` | `49007a6` | 2026-10-20 | P2-T37: a re-run finds a record with no DOI and no PMID by its work key (FR-51) |
| `1523e63` | `77105fb` | 2026-10-20 | plan: owner decisions on items 237 (import attributes) and 238 (formatted schema file) |
| `e5af83b` | `1b2ecd5` | 2026-10-20 | plan: items 237-239 from P3-T01 and P3-T24; P3-T01 Verify line corrected |
| `9ebe983` | `75b62ce` | 2026-10-20 | P3-T24: prompt registry and the five v1.0.0 prompt files (bundling seam left open) |
| `1f4f7de` | `63460b0` | 2026-10-20 | P3-T01: Secret wrapper, loggableHeaders beside the one redactor, debug: true lint rule |
| `7ae3bff` | `f150feb` | 2026-10-20 | plan: save the bookkeeping report verbatim |
| `b55ace3` | `cf50cf2` | 2026-10-20 | plan, docs: propagate Phase 2 (33.25 d) and Phase 3 (27.5 d) estimates; spend ceiling pauses and asks |
| `ef8e5ee` | `e72192d` | 2026-10-20 | plan: Phase 3 cards revised against the tree (37 cards, 27.5 d); P2-T37 for the re-run duplicate |
| `2362160` | `2362160` | 2026-10-20 | P2-T16 Part A: seven-source end-to-end spec, search benchmark, CI steps |
| `92d1b21` | `92d1b21` | 2026-10-20 | Items 232, 233: a 90-second retry budget per request; a truthful row for a refused 429 |
| `c6fe81d` | `c6fe81d` | 2026-10-20 | plan: Phase 3 plan review saved; item 234 records its findings for the owner |
| `0cf227e` | `0cf227e` | 2026-10-20 | plan: P2-T16 split into Part A (now) and Part B (after P2-T13 labels); rule-10 note |
| `77b10f3` | `77b10f3` | 2026-10-20 | plan: owner decisions of 2026-10-21 (items 232, 233) |
| `b1d781c` | `b1d781c` | 2026-10-20 | Items 230, 231: timeouts not retried automatically; no-search estimate is zero |
| `00a0469` | `00a0469` | 2026-10-20 | Items 227, 228, 229: late translator copies to trash; retries wired; guards |
| `2f34386` | `2f34386` | 2026-10-20 | plan: owner decisions of 2026-10-20 (items 227, 228, 229) |
| `2c651f0` | `2c651f0` | 2026-10-19 | Items 180, 198, 205, 206, 207, 213, 214; three owner-reviewed Korean tier names |
| `7ce00e8` | `7ce00e8` | 2026-10-19 | plan: owner decisions of 2026-10-19 (items 180, 198, 205, 206, 207, 213, 214) |
| `5336cd7` | `5336cd7` | 2026-10-16 | P2-T13 Part B targeted recording: 267-pair label set, every family met |
| `5e3725a` | `5e3725a` | 2026-10-16 | plan: item 226 decided (targeted recording within 35 requests; two non-series pairs labelled) |
| `97ad036` | `97ad036` | 2026-10-16 | P2-T13 Part B: strip author addresses from fixtures; sample the two big clusters |
| `b28b071` | `b28b071` | 2026-10-16 | plan: items 223 and 224 decided (sample clusters, more recording, strip author addresses) |
| `5dbd968` | `5dbd968` | 2026-10-16 | P2-T13 Part B recording: 48 live requests, 438 candidate pairs |
| `5d26764` | `5d26764` | 2026-10-16 | Item 220: the all-failed panel decides its buttons from per-source errors |
| `9f8b0e8` | `9f8b0e8` | 2026-10-16 | plan: items 220 and 222 decided (Retry from per-source errors; 85-request recording budget) |
| `946b2be` | `946b2be` | 2026-10-16 | Items 204, 209, 212, 217; P2-T13 Part A; twelve owner-reviewed Korean strings |
| `46102eb` | `46102eb` | 2026-10-16 | plan: P2-T13 split into Part A (tooling, no live request) and Part B (owner labels, gate) |
| `6159632` | `6159632` | 2026-10-16 | plan: owner approves P2-T17 and P2-T18; items 209 and 217 decided |
| `ff41539` | `ff41539` | 2026-10-16 | P2-T17 + P2-T18 + item 200; owner-reviewed Korean for six window strings |
| `a05d1f5` | `a05d1f5` | 2026-10-15 | plan: P2-T17 and P2-T18 Files notes under rule 10 (window files, store wiring, no preferences bundle) |
| `127dba7` | `127dba7` | 2026-10-15 | plan: owner approves P2-T11 and P2-T14; item 200 decided (downgrade to a link) |
| `5c71ea6` | `5c71ea6` | 2026-10-15 | P2-T11 + P2-T14: preprint/published linking (G-16) and the search window's per-source display |
| `86fc7a0` | `86fc7a0` | 2026-10-15 | plan: P2-T11 and P2-T14 Files notes under rule 10 (G-16 already decided; shared bundles) |
| `680e2cd` | `680e2cd` | 2026-10-15 | Owner approves P2-T08 and P2-T12; three decisions applied (items 188, 193, 194) |
| `95a4b4e` | `95a4b4e` | 2026-10-15 | P2-T08 + P2-T12: preprints import as Zotero preprint items; batched abstract backfill |
| `6996962` | `6996962` | 2026-10-15 | plan: P2-T08 and P2-T12 Files notes under rule 10 (measured before launch) |
| `99b4df1` | `99b4df1` | 2026-10-15 | Owner approves P2-T34; Semantic Scholar citationGraph false (item 184) |
| `50d49ab` | `50d49ab` | 2026-10-15 | P2-T34: six schema extensions (merge decisions in provenance, rh-s2-corpus-id, capability filters, epmcId, citationGraph meaning, openAccess row, arXiv dotted class, badge wording) |
| `0f8df0a` | `0f8df0a` | 2026-10-15 | plan: P2-T34 Files note under rule 10 (provenance builder, note renderer, extra parser, bioRxiv, capability fakes) |
| `6e05396` | `6e05396` | 2026-10-15 | Owner approves P2-T07; Europe PMC stays unrestricted; medRxiv ranks beside bioRxiv |
| `42004fd` | `42004fd` | 2026-10-15 | P2-T07: bioRxiv and medRxiv ship (seven sources); lookup-only, one shared limiter |
| `493bc6c` | `493bc6c` | 2026-10-15 | keychain: storing the Semantic Scholar key now sets semanticscholar.keyPresent |
| `2a0da40` | `2a0da40` | 2026-10-15 | plan: owner approves P2-T05, P2-T35, P2-T36 (2026-10-15) |
| `6b5d38f` | `6b5d38f` | 2026-10-15 | P2-T05 + P2-T36: Semantic Scholar ships (five sources); Korean titles, PubMed filters, window fixtures |
| `28c3114` | `28c3114` | 2026-10-15 | plan: P2-T36's Files gain the two contract tests that pin PubMed's fixture count (rule 10, mid-run) |
| `f225d50` | `f225d50` | 2026-10-15 | test: drop the unused NCBI_HOST import left by the coordinator's pin fix in 9a416f4 |
| `19fe65a` | `19fe65a` | 2026-10-15 | P2-T35: a 4xx body reaches the adapter, redacted; arXiv's error sentence survives |
| `43e9562` | `43e9562` | 2026-10-15 | docs: the owner's 2026-10-15 review decisions applied — 21 rows across five documents |
| `ce84d6d` | `ce84d6d` | 2026-10-15 | plan: owner approves review-page group 라 (50, 51, 142), 2026-10-15 |
| `ed61fe5` | `ed61fe5` | 2026-10-15 | plan: P2-T05's Files gain addon/prefs.js and the schema test (rule 10, mid-run) |
| `af6fa84` | `af6fa84` | 2026-10-15 | plan: the owner's review-page decisions (2026-10-15) become P2-T34, P2-T35, P2-T36 |
| `5ee10d9` | `5ee10d9` | 2026-10-15 | plan: owner approves P2-T04, P2-T06, P2-T24, P2-T31 (2026-10-15) |
| `4511699` | `4511699` | 2026-10-15 | plan: owner review page gains arXiv's items (159, 160, 162) |
| `9a416f4` | `9a416f4` | 2026-10-15 | P2-T06: arXiv adapter, registered in the product; four sources ship |
| `29e6441` | `29e6441` | 2026-10-15 | P2-T24: the three statements P2-T21 made false are corrected, dated |
| `cf6dbd4` | `cf6dbd4` | 2026-10-15 | plan: owner review page gains Crossref's three items (149-151) |
| `d6cedf1` | `d6cedf1` | 2026-10-15 | P2-T04: Crossref adapter, registered in the product; three sources ship |
| `ba81a3a` | `ba81a3a` | 2026-10-14 | P2-T31: the import writes the merged work the preview showed; flags/links required |
| `c1c6f02` | `c1c6f02` | 2026-10-14 | plan: one-page owner review of the recorded document edits and schema decisions (2026-10-14) |
| `c432c9b` | `c432c9b` | 2026-10-14 | plan: P2-T32 approved; G-03 — the Semantic Scholar key has arrived (value kept nowhere) |
| `12e31da` | `12e31da` | 2026-10-14 | plan: adapter cards' Files notes gain the recorder plan files and the two growing test expectations (rule 10) |
| `c1e21de` | `c1e21de` | 2026-10-14 | P2-T32: the product registers Europe PMC; one-host pins retired; unit suite green |
| `4260dd9` | `4260dd9` | 2026-10-14 | plan: G-03 status (key applied, not received); adapter order and S2 notes on P2-T04/P2-T05 |
| `aa657f0` | `aa657f0` | 2026-10-14 | docs/07 section 7.3: retry budgets for the five non-NCBI hosts (owner, 2026-10-14); P2-T30, P2-T33 approved |
| `e2e476c` | `e2e476c` | 2026-10-14 | P2-T33: the fixture recorder runs under tsx again and takes --source <id> |
| `140b387` | `140b387` | 2026-10-14 | P2-T30: the dedup cascade yields; the 100-record import stalls 43-57 ms again |
| `49471bf` | `49471bf` | 2026-10-14 | plan: owner approves P2-T03, P2-T20, P2-T29 (2026-10-14, second batch) |
| `c4d3854` | `c4d3854` | 2026-10-14 | P2-T03: Europe PMC adapter, proven on 19 recorded fixtures; not yet constructed (P2-T32) |
| `9481e07` | `9481e07` | 2026-10-14 | P2-T29: run() dedups and merges; NFR-3 regresses (P2-T30), import half narrows (P2-T31) |
| `bc36785` | `bc36785` | 2026-10-14 | plan: P2-T23 gets its closing separator (README section 4 card format) |
| `2a79cb2` | `2a79cb2` | 2026-10-14 | P2-T20: PubMed renders languages and raw; refuses openAccessOnly by name |
| `45e6a63` | `45e6a63` | 2026-10-14 | plan: owner approves P2-T10, P2-T19, P2-T28; rule 10 (pre-launch caller check); item 96 decided |
| `735b66e` | `735b66e` | 2026-10-14 | P2-T19: arXiv and work-key arms on the library index; fromZoteroItem |
| `f54c3f5` | `f54c3f5` | 2026-10-14 | P2-T28 + P2-T10: SourceCapabilities.query; field-merge policy; P2-T29 to wire it |
| `8edfd17` | `8edfd17` | 2026-10-14 | plan: G-16 decided — preprint and published versions kept as two linked items |
| `741e126` | `741e126` | 2026-10-14 | plan: owner approves P2-T09, P2-T26, P2-T27 and confirms two product decisions (2026-10-14) |
| `2921358` | `2921358` | 2026-10-14 | P2-T09: dedup engine - identifier-first cascade, conservative fuzzy fallback |
| `adabe68` | `adabe68` | 2026-10-14 | P2-T26: replaceForTest on the source registry; both specs stub pubmed in place |
| `f357837` | `f357837` | 2026-10-14 | P2-T27: the shipped pipeline fetches through fanOut; one network-metadata pool |
| `f8bd8bc` | `f8bd8bc` | 2026-10-13 | plan: P2-T28's Human gate cell is the bare word none (README section 4) |
| `3093333` | `3093333` | 2026-10-13 | plan: P2-T28, the per-source query dialect's home in SourceCapabilities |
| `329ff57` | `329ff57` | 2026-10-13 | plan: owner approves P2-T01, P2-T02, P2-T15, P2-T25 (2026-10-13) |
| `58cee44` | `58cee44` | 2026-10-13 | P2-T25: the fixture replay harness runs inside Zotero |
| `67ede06` | `67ede06` | 2026-10-13 | P2-T02: fanOut with per-source timeouts and failure isolation; P2-T27 to wire it |
| `6c324de` | `6c324de` | 2026-10-13 | P2-T01: normalizeForSource, the per-source render contract on the parser |
| `7726ebd` | `7726ebd` | 2026-10-13 | P2-T15: record the closed OpenAlex decision and guard it in CI |
| `8491cc0` | `8491cc0` | 2026-10-13 | plan: P2-T26, the first card created under rule 9 |
| `2b05ef4` | `2b05ef4` | 2026-10-13 | plan: remove the duplicated §6.5 in the intake, mine, and make every item number unique again |
| `9e6c70a` | `9e6c70a` | 2026-10-13 | plan: owner approved P1-T42, P1-T43 and P1-T44 DONE; Phase 1 has no open approvals left |
| `c4dc769` | `c4dc769` | 2026-10-13 | P1-T44: a preferences pane with the two literature-source key fields, and the first card landed under the 2026-10-13 rules |
| `a44df72` | `a44df72` | 2026-10-13 | Phase 1 closed on its five finishing conditions, and the four process changes the owner approved are now rules |
| `ac2461b` | `ac2461b` | 2026-10-13 | P1-T43: the duplicate choice now reaches the importer that already implements it; the hide-existing flip is blocked outside the list and reported |
| `2deb393` | `2deb393` | 2026-10-13 | P1-T42: the 40-character floor stays, a hexadecimal shape joins it, and the measured key length is finally in the corpus |
| `4ef19bc` | `4ef19bc` | 2026-10-13 | plan: owner approved P1-T39, P1-T40 and P1-T41 DONE |
| `bde0d8c` | `bde0d8c` | 2026-10-13 | P1-T39: thirty-three tests in 0.4 s over the view model, and a premise of mine that was false when I wrote it |
| `8c4be5f` | `8c4be5f` | 2026-10-13 | P1-T40: eleven relations over the identifier lists, at a quarter of a second |
| `2e8aad6` | `2e8aad6` | 2026-10-13 | P1-T41: P3-T02 now measures itself against the shipped code, step by step |
| `718c639` | `718c639` | 2026-10-13 | P1-T23: the confirming live run is green, so one thing is left for a person |
| `1b5ea19` | `1b5ea19` | 2026-10-12 | P1-T23: all five of Phase 1's finishing conditions pass, measured live |
| `51cc064` | `51cc064` | 2026-10-12 | plan: owner approved P1-T46, and two stale claims in P1-T23 corrected before it runs |
| `a835a48` | `a835a48` | 2026-10-12 | P1-T46: the three tests no longer wait on text the run can replace |
| `882608d` | `882608d` | 2026-10-12 | plan: owner approved P1-T36 and P1-T45 DONE |
| `6ad0b1c` | `6ad0b1c` | 2026-10-08 | P1-T45: the export control, its chooser and its three strings - criterion 4 closed |
| `f49eee4` | `f49eee4` | 2026-10-08 | plan: card P1-T46, the half-day correction that is all that stands before sign-off |
| `c30adb6` | `c30adb6` | 2026-10-08 | plan: card P1-T45, the export surface P1-T36 measured itself unable to build |
| `7497b20` | `7497b20` | 2026-10-08 | P1-T36: the provenance record now survives the run that made it, and exports |
| `b362072` | `b362072` | 2026-10-08 | plan: P1-T44 - a place to put a key, and an honest record of the key application |
| `658da5a` | `658da5a` | 2026-10-08 | plan: two more owner decisions, and P1-T43 - the second one turned out to be a flip and a wire |
| `89914a0` | `89914a0` | 2026-10-08 | plan: four owner decisions of 2026-10-08, and the steps for the one that is in motion |
| `93a1ebf` | `93a1ebf` | 2026-10-08 | plan: owner approved P1-T22 and P1-T35 DONE, and the index status line re-derived |
| `1681c1a` | `1681c1a` | 2026-10-08 | P1-T35: publish the search window's host, so the window stops shipping inert |
| `f2f3f81` | `f2f3f81` | 2026-10-07 | plan: record the 19 measured gaps that have no card, as plan/00 §6 |
| `f9e53b4` | `f9e53b4` | 2026-10-07 | plan: seven cards from the uncarded backlog, and three claims of mine corrected |
| `ebae83a` | `ebae83a` | 2026-10-07 | plan: card P1-T36, FR-8's JSON-export control and the record it needs |
| `6da10eb` | `6da10eb` | 2026-10-07 | Card P1-T35: publish the search window's host, and propagate |
| `54eaf23` | `54eaf23` | 2026-10-07 | P1-T22: a search runs end to end, and the window still ships inert |
| `c237584` | `c237584` | 2026-10-07 | Run the contract suite in CI, on the condition the placeholder named |
| `ead0c21` | `ead0c21` | 2026-10-07 | Approve five task items as DONE |
| `80526bc` | `80526bc` | 2026-10-07 | P1-T21: the result table, and the selection defect that survived its own tests |
| `4eba0ae` | `4eba0ae` | 2026-10-07 | P1-T11 + P1-T16: a real fixture corpus, and the installer finally grows |
| `cefe9ef` | `cefe9ef` | 2026-10-07 | P1-T10 + P1-T17: the PubMed mapper, and provenance with two leaks closed |
| `e3d1004` | `e3d1004` | 2026-10-07 | Approve ten task items as DONE |
| `e0cfd99` | `e0cfd99` | 2026-10-07 | P1-T28 + P1-T09: retry numbers with a named source, and the PubMed adapter |
| `7b3387f` | `7b3387f` | 2026-10-07 | Correct the retry worst-case arithmetic before the card is handed out |
| `fddc456` | `fddc456` | 2026-10-07 | P1-T06: the key-presence flag finally has a writer, and it moves the limiter |
| `bb655da` | `bb655da` | 2026-10-07 | Record the owner's three retry numbers, satisfying P1-T28's gate |
| `2184309` | `2184309` | 2026-10-06 | P1-T20: the Search and Import window, and two vacuous tests made real |
| `f5b0e33` | `f5b0e33` | 2026-10-06 | Card P2-T24, and fix two estimate sites that five propagations missed |
| `438beac` | `438beac` | 2026-10-06 | P2-T21: a resizable cap, and the invariant was never in the way |
| `4bcfa37` | `4bcfa37` | 2026-10-06 | P2-T22: declare the menu-context member, and find that typings/ is unchecked |
| `eb75688` | `eb75688` | 2026-10-06 | P2-T23: hostLimiter.ts gets its test file, and README gains rule 8 |
| `d6abe71` | `d6abe71` | 2026-10-06 | G-41: re-point owner decision (2) at the surviving headline id |
| `9b00447` | `9b00447` | 2026-10-05 | P1-T33 + P1-T34: one headline id, and figures that re-derive themselves |
| `1457e70` | `1457e70` | 2026-10-05 | Approve P1-T19, P1-T26 and P1-T32 as DONE |
| `42dff0c` | `42dff0c` | 2026-10-03 | Card the backlog: 5 cards from the P1-T19/T26/T32 reports, and propagate |
| `c4acb45` | `c4acb45` | 2026-10-03 | P1-T32: the four platform seams, and a card premise that was false when written |
| `d29cc97` | `d29cc97` | 2026-10-02 | P1-T26: one Retry-After parser, and limits adopted only downwards |
| `864dd83` | `864dd83` | 2026-10-02 | P1-T19: menu entry points, and three criteria the card they block must verify |

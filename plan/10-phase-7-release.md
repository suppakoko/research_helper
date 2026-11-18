# Phase 7 — Polish, i18n, prefs, release

> **Decomposed 2026-11-16, for the coordinator's review.** Drafted under the coordinator's brief of
> 2026-11-16, which carried four owner decisions for Phase 7, recorded as `plan/00` §6 item 380, cited
> the release facts already settled, and asked for one coordinator default to be recorded (`docs/09`
> §8 item 7). Every card is `TODO`. Like `plan/09`, this file has had **no independent review** yet;
> the author's report is `plan/reports/P7-decomposition.md`, and §0.4 lists the lines the owner still
> has to answer. *Updated 2026-11-16, later (`plan/00` §6 item 381): the owner answered §0.4's lines 18–23; no
> line is open now, and line 20 added `P7-T32` (0.75 d), so the file holds 32 cards summing to 29.25 d.* *Updated 2026-11-17 (`plan/00` §6 item 393(d)): the owner answered item 393, and `P7-T33` (0.5 d) was added, so the file holds 33 cards summing to 29.75 d.* *Updated 2026-11-17, later (`plan/00` §6 items 395, 398): the owner answered item 395; `P7-T34`–`P7-T38` (2.0 d) were added and `P7-T03` went from 1.5 to 1.75 d for item 395(b)'s step, so the file holds 38 cards summing to 32.00 d.* *Updated 2026-11-18 (`plan/00` §6 items 401(a), 402(a)): the owner answered item 401(a) ("만듦"), and `P7-T15` went from 1.5 to 2.0 d for the test-profile memory measurement, so the file holds 38 cards summing to 32.50 d.* *Updated 2026-11-18, later (`plan/00` §6 items 403, 404(a), 404(b)): the owner answered item 403; `P7-T39` and `P7-T40` (1.0 d each) were added and `P7-T15` went from 2.0 to 2.25 d for item 403(b)'s profile, so the file holds 40 cards summing to 34.75 d.* The card sum replaced `docs/11`'s scaled 21–29 d on 2026-11-16 at the five places
> `plan/README.md` §7 names (`docs/11` §1–§2, `plan/00` §1, `plan/05` §4, now a pointer here).
>
> **What this file is.** The task-card decomposition of `docs/11-implementation-roadmap.md` §1
> "Phase 7 — Polish, i18n, prefs, release". The card schema, the field rules and the execution
> protocol are [`README.md`](README.md) §4–§5 and bind every card below. A step that depends on a
> document change the card makes first is not executed before that change lands.
>
> **Read by `npm run index:derive`** since 2026-11-16: `scripts/derive-task-index.ts` reads this file
> with `plan/01`–`plan/04` and `plan/07`–`plan/09` and builds `plan/00` §4's Phase 7 table from it, as
> it was extended for `plan/09`. The file is numbered `10` because `05`–`09` are taken.

---

## 0. Phase summary

**Goal (docs/11).** Ship v1.0.

**Why this phase is different.** Phases 1–6 each build a feature. Phase 7 builds almost nothing new;
it **proves** that what was built is fit to publish, and then publishes it. Three consequences run
through every card:

1. **Most of the finishing conditions are measurements or human judgements, not code.** Twenty-one
   cards are agent work; ten stop at a human gate (§1). Every number the release checklist records
   comes from a run named on a card, never from a reading of the code.
2. **Nothing is published by an agent.** Agents build and harden the release workflow and draft every
   text; the owner pushes tags, publishes releases, posts in the forum and submits to the lists
   (`plan/06` `G-35`, `G-36`).
3. **What is not measured is waived in writing, with a reason.** `docs/11`'s definition of done
   permits a waiver and forbids an omission. The owner's decision 1 (§0.4 line 1) makes macOS, Linux,
   VoiceOver and the Linux keyring-less check four such waivers for v1.0.

**Schedule and entry conditions.** `plan/05` §0 schedules this decomposition for the end of Phase 6;
the coordinator's brief of 2026-11-16 brought it forward, so §5.2's entry conditions (moved from
`plan/05` §4.2 on 2026-11-16) are **not all met**. Their status on **2026-11-16**, by grep of the
documents, `plan/reports/` and the tree:

| §5.2 entry condition | Status 2026-11-16 | Cards it reaches |
|---|---|---|
| Phases 4, 5 and 6 `DONE` | **Not met.** `plan/00`'s header shows Phase 4 **0 of 25**, Phase 5 **0 of 32**, Phase 6 **0 of 19** `DONE` (and Phase 3 **0 of 41**), because only the human sets `DONE`. Phase 6 is not built at all; Phase 5 has no card reports. Every card below that reads a feature names the earlier card in its **Notes** (§0.3) | `P7-T03`, `P7-T08`–`P7-T18`, `P7-T25`, `P7-T27` |
| V-17 answered (Fluent registration on Zotero 10, `ko-KR` with English fallback) | **Met.** `plan/01` `P0-T24`: answered **yes** on Zotero 10.0.2; a missing key degrades to English. The two related markers — `docs/01` §9.2's `Localization` argument form and `docs/01` §10.4 / `docs/08` §8.2.1's `Zotero.ftl.addResourceIds` — are still `Unverified` in the text. The code's own comments (`src/i18n/ftl.ts`, `src/i18n/keys.ts`) say the plugin never calls `Zotero.getString()` for its own strings; `P7-T01` records what is on file and closes or narrows the markers | `P7-T01`, `P7-T02` |
| V-18 answered (`update.json` delivery end to end) | **Met 2026-09-16.** `plan/01` `P0-T27`: YES, and R-15 retired. `docs/13` §6.3's `strict_max_version` reconciliation marker is still `Unverified`; `P7-T30`'s upgrade run is the first real-release observation | `P7-T21`, `P7-T26`, `P7-T30` |
| `docs/10` §5 Q20 answered (registry-listing timing) | **Met 2026-11-16** (owner, item 380, decision 4): list at v1.0 | `P7-T23`, `P7-T31` |
| `docs/09` §8 items 1, 2, 3, 6 and 7 answered | **Items 1 and 2 settled** 2026-10-08 (`G-10`: session-only fallback, no passphrase tier). **Item 3 settled** 2026-11-16 (item 378(b)). **Item 7 decided** 2026-11-16 (coordinator default, §0.4 line 9). **Item 6 open:** the re-verification itself is `P7-T17`'s work | `P7-T17` |
| MIT confirmed with the IP office | **Satisfied 2026-09-09** (`G-32` closed) | `P7-T19` |
| NCBI registration on file | **Not confirmed.** `G-04` is IN MOTION since 2026-10-08; no confirmation is recorded | `P7-T28` |
| The accessibility surface understood | **Not met.** `docs/10` §3 (NFR-13) and `docs/08` §9 still mark Zotero 10's assistive-technology surface and the high-contrast inheritance `Unverified`. `P7-T06` and `P7-T07` are the measurement | `P7-T06`, `P7-T07` |
| `docs/13` toolchain markers closed by Phase 0's report | **Partly.** The markers in `docs/13` §1.4, §1.5, §2, §5.1 and §5.3 are still in the text. `.github/workflows/ci.yml` declares an integration job on `ubuntu-24.04` with `ZOTERO_VERSION` 10.0.3 and `release.yml` exists (`P0-T27`), which answers the scaffold questions in practice; `ZOTERO_CHANNEL` for a beta build is untested | `P7-T21`, `P7-T22` |

**Deliverables (docs/11 §1 Phase 7) → cards.**

| `docs/11` deliverable | Cards |
|---|---|
| Complete `en-US` and `ko-KR` Fluent bundles; no hard-coded strings; `Intl` formatting. FR-55, NFR-11 | `P7-T02`, `P7-T03`, `P7-T04`, `P7-T05` |
| Accessibility pass: keyboard, focus order, accessible names, contrast in light and dark, screen-reader smoke test (NVDA; VoiceOver waived, §0.4 line 1). NFR-13 | `P7-T06`, `P7-T07` |
| Preferences consolidation, defaults review, "Clear cache", storage cap enforcement. NFR-8 | `P7-T08`, `P7-T09`, `P7-T10` |
| Error-message audit against NFR-14; "Copy diagnostics" and the debug bundle; the verbose-logging checkbox. Completes FR-54 | `P7-T09`, `P7-T12`, `P7-T13` |
| Offline behaviour verification. NFR-9 | `P7-T18` |
| Memory and startup profiling against NFR-7 and NFR-10 | `P7-T15` |
| Security review against `docs/09`; log-redaction audit | `P7-T14`, `P7-T16`, `P7-T17` |
| README, user documentation, screenshots, CHANGELOG | `P7-T19`, `P7-T20`, `P7-T27` |
| Release workflow: tagged build → XPI + `update.json` on a GitHub Release; `update_url` verified by an upgrade | `P7-T21`, `P7-T26`, `P7-T30` |
| Manual QA checklist on Windows, macOS and Linux (Windows only for v1.0; the other two waived, §0.4 line 1) | `P7-T24`, `P7-T25` |
| Announcement in the Zotero Forums and submission to the community lists | `P7-T23`, `P7-T31` |
| "Remove all Research Helper content" (`docs/10` §5 Q14; §0.4 line 2) | `P7-T11` |
| The scheduled Zotero-beta job (`docs/13` §5.3; R-1's early warning) | `P7-T22` |
| Documents first; NCBI registration; the sign-off | `P7-T01`, `P7-T28`, `P7-T29` |

**Risks retired.** R-10 by `P7-T15`'s measurements; R-22 by `P7-T02`'s blocking check; R-20's
mitigation by `P7-T31`; R-15 was already retired on 2026-09-16 (`P0-T27`) and `P7-T30` re-confirms it
on a real release; R-1 moves to ongoing handling with `P7-T22`'s job.

**Effort.** **34.75 developer-days over 40 cards** (§1), so the band these cards imply is
**34.75–49 d** (34.75 × 1.4 = 48.65 → 49). Against the scaled 21–29 d `docs/11` published before this
file, the low end is **+65 %** (34.75 ÷ 21 = 1.655) and 20 % above the scaled top (34.75 ÷ 29 = 1.198)
— above the ~30 % `plan/README.md` §7 calls a signal to re-estimate the phase in `docs/11`, which was
done. Against the old 10–14 d band the low end is **+148 %** (34.75 ÷ 14 = 2.482). **Propagated
2026-11-16** to `docs/11` §1–§2, `plan/00` §1 and `plan/05` §4. *Updated 2026-11-16, later (`plan/00` §6
item 381): this read 28.50 d over 31 cards, 28.50–40 d, +36 %, 2 % below the scaled top and +104 %, before
`P7-T32` (0.75 d) was added for §0.4 line 20; propagated the same day to the same five sites.* *Updated 2026-11-17 (`plan/00` §6 item 393(d)): this read 29.25 d over 32 cards, 29.25–41 d, +39 %, 1 % above the scaled top and +109 %, before `P7-T33` (0.5 d) was added for the owner's answer to item 393; propagated the same day to the same five sites.* *Updated 2026-11-17, later (`plan/00` §6 item 398): this read 29.75 d over 33 cards, 29.75–42 d, +42 %, 3 % above the scaled top and +113 %, before `P7-T34`–`P7-T38` (2.0 d) were added for the owner's answers to item 395 and `P7-T03` rose by 0.25 d for item 395(b); propagated the same day to the same five sites.* *Updated 2026-11-18 (`plan/00` §6 items 401(a), 402(a)): this read 32.00 d over 38 cards, 32.00–45 d, +52 %, 10 % above the scaled top and +129 %, before `P7-T15` rose by 0.5 d for the owner's answer to item 401(a); propagated the same day to the same five sites.* *Updated 2026-11-18, later (`plan/00` §6 item 404(a)): this read 32.50 d over 38 cards, 32.50–46 d, +55 %, 12 % above the scaled top and +132 %, before `P7-T39` and `P7-T40` (1.0 d each) were added for the owner's answers to items 403(a) and 403(e) and `P7-T15` rose by 0.25 d for item 403(b); propagated the same day to the same five sites.* §3 says where the days went and where
the sum is still likely low.

### Phase definition of done

Taken from `docs/11` §1 Phase 7 "Definition of done":

- [ ] Every NFR in `docs/10` §3 has a measured or explicitly waived result recorded in the release
      checklist, `docs/release/v1.0-checklist.md`. (`P7-T24` builds it; `P7-T25` and the measuring
      cards fill it; `P7-T29` signs it with `G-37`)
- [ ] A user on a fresh Zotero 10 profile can install, configure a key, and complete a search →
      summarize → report → audio flow using only the README. (`P7-T19`, `P7-T27` with `G-18`, `G-45`)
- [ ] An in-place update from v0.9.0 to v1.0.0 succeeds via `update.json`. (`P7-T26`, `P7-T30` with
      `G-35`)

And two that the phase needs as hard as the above:

- [ ] Every `[BLOCKER]` in `docs/09` §7 is resolved and recorded, each with the test or run that shows
      it (`P7-T16`). Nothing ships with one open (`plan/05` §4.4, now §5.4).
- [ ] Every Phase 7 test passes with **zero** live network calls and **zero** spend; live calls happen
      only in `P7-T25` and `P7-T27`, both the owner's runs. No agent runs a keyed path, pushes a tag or
      publishes.

### 0.1 Already landed — cite these by name, do not rebuild them

Checked against the tree on 2026-11-16.

| What | Where (by name) | Landed by |
|---|---|---|
| The two Fluent bundles, three surfaces each; the id lists and their partitions; the deferred error ids | `addon/locale/{en-US,ko-KR}/research-helper-{mainWindow,reportWindow,searchDialog}.ftl`; `KO_PENDING_REVIEW` (empty), `KO_DELIBERATELY_ABSENT` (one id, the spike menu item), `KO_PRESENT`, `DEFERRED_ERROR_MESSAGE_IDS` (`rh-error-tts`, `rh-error-policy`), `MESSAGE_IDS_BY_SURFACE` in `src/i18n/keys.ts`; the relations tested in `test/unit/i18n/keys.test.ts`; `test/integration/l10n.spec.ts` | `P0-T24`, Phases 1–5 |
| The Fluent helpers | `src/i18n/ftl.ts` (the one place allowed to call `insertFTLIfNeeded`) | Phase 1 |
| The key-parity CI step, as a commented placeholder | `.github/workflows/ci.yml`, the "Verify Korean localization completeness" comment naming `scripts/check-l10n.mjs` (which does not exist) | `P0-T14` |
| The preferences pane: storage, providers, NCBI, Semantic Scholar and usage groupboxes; "Remove all stored keys" | `addon/content/preferences.{xhtml,js}`; `PREFERENCES_L10N`, `preferencePaneOptions` and the rest of `src/ui/prefs/preferencesPane.ts`; `test/unit/ui/preferencesPane.test.ts`, `test/integration/preferences.spec.ts` | `P1-T44`, `P3-T04`, Phase 3 |
| Preference schema and keys | `src/prefs/schema.ts`, `src/prefs/keys.ts` (`autoSummarize` ships `false`; the ceilings ship as `G-20` decided) | Phases 0–6 |
| The cache: namespaces, policies, prune, stats, per-namespace clear | `Cache`, `CacheStats`, `CACHE_NAMESPACES`, `CACHE_NAMESPACE_POLICIES` (`src/core/cache/cache.ts`); `SqliteCache` and its prune against `cache.maxSizeMB` (`src/core/cache/sqliteCache.ts`); the startup prune in `src/bootstrap/pluginDatabase.ts` | Phases 1–3 |
| The logger, with unconditional redaction and no ring buffer | `LogLevel` and the logger in `src/core/logger.ts` (its header says `docs/07` §10.4's ring buffer is "not built here"); `test/unit/core/logger-redaction.test.ts` | Phase 1 |
| Redaction | `redact`, `redactUrl`, `loggableHeaders` (`src/core/errors.ts`); `redactRecord`, `redactText` (`src/core/provenance.ts`) | Phases 0–3 |
| Error classes and their message ids | `src/core/errors.ts`; `test/unit/core/errors.test.ts` | Phases 0–3 |
| Generated-note handling: the tags, the per-collection removal | `AI_SUMMARY_TAG`, `GENERATED_TAG_NAMESPACE`, `TREND_REPORT_TAG`, `isGeneratedTag`, `findGeneratedNotes`, `trashGeneratedNotes`, `removeGeneratedNotes`, `PROVENANCE_NOTE_TITLE_PREFIX` in `src/zotero/notes.ts`; `RESEARCH_HELPER_TAG` (the bare tag on imported items and provenance notes) in `src/zotero/itemMapper.ts`; `test/integration/zotero/removeGeneratedNotes.spec.ts` | `P3-T29`, Phase 1 |
| Uninstall clears the keys | `onUninstall` in `src/hooks.ts`; `test/unit/bootstrap/uninstall.test.ts` | Phase 3 |
| The developer spike command in the Tools menu | `L10N_MENU_SPIKE_CREATE_ITEM`, `toolsMenuOptions` (`src/ui/menus/toolsMenu.ts`); `createSpikeArticle`, `SPIKE_COLLECTION_NAME` (`src/zotero/zoteroApi.ts`); wired in `src/bootstrap/registerUI.ts`; used by `test/integration/zotero/itemCreation.spec.ts`, `test/integration/menus.spec.ts`, `test/integration/l10n.spec.ts`, `test/unit/bootstrap/container.test.ts` | `P0-T10`; `plan/00` §5 backlog item 25 |
| CI: lint, the OpenAlex guard, unit and contract tests with coverage, bench, build with the 3 MB check, integration in Zotero | `.github/workflows/ci.yml` | Phases 0–2 |
| The release workflow: tag `v*.*.*`, version check, build, `SHA256SUMS.txt`, GitHub Release, `update.json` pushed to `release` | `.github/workflows/release.yml` (still sets `FIXTURE_MODE: replay`, which `ci.yml` says is not a real mode; actions pinned by tag, not by commit) | `P0-T27` |
| Manifest and build config | `addon/manifest.json` (`strict_min_version` 10.0, `strict_max_version` 10.0.*, `update_url` on the `release` branch); `zotero-plugin.config.ts` (`xpiDownloadLink`) | `P0-T01`, `P0-T27` |
| Package scripts | `package.json` (`version` 0.0.2; `typecheck`, `lint:check`, `test:unit`, `test:contract`, `build`, `index:derive`; the runtime dependency `zotero-plugin-toolkit` pinned with `^`, not exactly) | Phases 0–6 |
| The README | `README.md` — stale: it still says the project is in its design phase with no code | Phase 0 |

**Not in the tree:** `CHANGELOG.md`, `SECURITY.md`, `README.ko.md`, `docs/release/`,
`.github/workflows/compat.yml`, `scripts/check-l10n.mjs`, a `--verify` mode in
`scripts/record-fixtures.ts`.

### 0.2 Conventions binding on every card in this file

Items 1–10 of `plan/04` §0.2 apply unchanged (strings and `G-41`; one card adds preference rows; test
locations and the three-run rule; migrations appended; one redaction gate; no live requests; an agent
never holds a key; layering; callers named — `plan/README.md` §5 rule 10; open lines stop a step).
Items 24 and 25 of `plan/08` §0.2 apply (a mutation sweep with every card that adds logic; features hide
until they work). Items 19 and 20 of `plan/09` §0.2 apply (keys; no agent runs a keyed path). In
addition:

25. **Results go into the release checklist, with their source.** Every measured figure or verdict a
    card produces is written into `docs/release/v1.0-checklist.md` (created by `P7-T24`) with the card,
    the date, the build it was measured on and the command or procedure; a card that runs before
    `P7-T24` writes it into its own report and `P7-T24` carries it over. A waiver carries its reason
    and the decision that allows it.
26. **No agent publishes.** No card's agent half creates or pushes a tag, pushes to the `release`
    branch, triggers `release.yml`, publishes a GitHub Release, posts in a forum or opens a pull
    request against a community list. Those are `G-35` and `G-36`.
27. **Polish does not change behaviour silently.** A card that finds a feature behaving against its
    requirement records it in its report and stops if fixing it is outside its **Files**; a rule-9 card
    is created only if the finding blocks a finishing condition of this phase (`plan/README.md` §5
    rule 9).
28. **Deletion is to the trash.** No card deletes a Zotero item permanently; "remove" means
    `Zotero.Items.trashTx`, after a confirmation that names the counts (`docs/10` NFR-20 and Q14).
    Plugin database rows are deleted, since they are not Zotero items.

### 0.3 What Phase 7 needs from earlier phases

Phase 7 cards list only Phase 7 IDs in **Depends on**, for the reason `plan/07` §0.3 gives. Each card's
**Notes** starts with the earlier cards it needs. **NOT BUILT** marks a card with no
`plan/reports/<card>.md` on 2026-11-16.

| Earlier card | State | What Phase 7 takes from it | Phase 7 cards |
|---|---|---|---|
| `P0-T24`, `P0-T27` | Built | V-17's answer; the release workflow and V-18's answer | `P7-T02`, `P7-T21` |
| `P3-T37` | **NOT BUILT**, deferred 2026-11-16 (§0.4 line 1) | Nothing; the checklist records it as waived | `P7-T24` |
| `P3-T31` | **NOT BUILT** | Phase 3's sign-off, which the checklist records as it stands | `P7-T24`, `P7-T29` |
| `P4-T24`, `P4-T25` | **NOT BUILT** | Phase 4's determinism run and sign-off | `P7-T25`, `P7-T29` |
| `P5-T30` and the rest of `plan/08` | **NOT BUILT** | The related and recommend features the QA run checks (`docs/13` §8.3) | `P7-T03`, `P7-T25` |
| `plan/09`, all 19 cards, `P6-T17` and `P6-T19` above all | **NOT BUILT** | The audio feature, its report-window section, `audio.enabled` switched on | `P7-T08`, `P7-T25`, `P7-T27` |
| Every card that adds a user-visible string | — | The strings `P7-T03` sweeps and `P7-T05` sends for review | `P7-T03`, `P7-T05` |

### 0.4 Decisions of 2026-11-16, and the lines still open

"Owner" decisions cite `plan/00` §6 item 380; "coordinator" decisions were taken under item 313 and
may be overturned by the owner. "Settled" lines were decided before this file and are cited, not
re-decided. Each card named carries the decision as a `DECIDED` block or a step.

| Line | Decision | By | Where |
|---|---|---|---|
| 1 | **OS matrix.** v1.0 is checked on **Windows**. macOS and Linux are marked "untested" in the README's compatibility table and recorded as **waived, with the reason**, in the release checklist; they are checked in a later release once machines exist (`G-09`). The Linux keyring-less check `P3-T37` is deferred on the same condition (its State unchanged). The screen-reader test is NVDA on Windows; VoiceOver is waived | owner, item 380, decision 1 | `P7-T07`, `P7-T19`, `P7-T24`, `P7-T25`; `docs/13` §8, §7.3; `docs/10` NFR-13, NFR-17; `plan/04` `P3-T37`; `plan/06` `G-09`, `G-33`, `G-34` marked 2026-11-16 |
| 2 | **Remove all Research Helper content** ships in v1.0. Scope: the notes, attachments and stored data the plugin created. It shows the count of each kind and asks for confirmation. Deleted items go to the Zotero trash, never hard-deleted. User-written notes and the original items are untouched | owner, item 380, decision 2 | `P7-T11`; `docs/10` §5 Q14 marked 2026-11-16 |
| 3 | **No prompt overrides in v1.0**; later-release candidate | owner, item 380, decision 3 | §4; `docs/12` §19 item 5 marked 2026-11-16 |
| 4 | **List at v1.0**: announce on the Zotero Forums and submit to the community lists. Posting and submitting are the owner's (`G-36`); a card drafts the texts | owner, item 380, decision 4 | `P7-T23`, `P7-T31`; `docs/10` §5 Q20, `docs/13` §7.2 marked 2026-11-16 |
| 5 | `strict_min_version` is `10.0` (`docs/10` Q15) | settled — `addon/manifest.json` | `P7-T21` |
| 6 | `update.json` lives on the `release` branch (`docs/10` Q16; manifest `update_url`; V-18 YES 2026-09-16) | settled | `P7-T21`, `P7-T26`, `P7-T30` |
| 7 | The Linux fallback is session-only, with no passphrase tier (`G-10`) | settled 2026-10-08 | `P7-T16`, `P7-T19` |
| 8 | The session ceiling ships at 500 cents, the per-run ceiling at 0 (`G-20`); MIT (`G-32` closed) | settled | `P7-T08`, `P7-T19` |
| 9 | Provider policy claims are **re-verified at each minor release**, and the verification date is stamped next to the retention text in the UI (`docs/09` §8 item 7) | coordinator, item 313 (the brief's default) | `P7-T17`; `docs/09` §8 item 7 marked 2026-11-16 |
| 10 | A spend gate for Phase 7's paid runs, `G-45`, modelled on `G-43` and `G-44`; it covers `P7-T25` and `P7-T27` | coordinator | `plan/06` `G-45` |
| 11 | The release checklist is a file in the repository, `docs/release/v1.0-checklist.md`, not a GitHub issue: it is reviewed with the code and kept with it | coordinator | `P7-T24`; `docs/13` §8 marked 2026-11-16 |
| 12 | The debug bundle is a **plain-text file** the user saves where they choose ("Save diagnostics…"), with the same text offered by "Copy diagnostics", both in the pane's Advanced section after a preview; not a zip, so no archive writer is added; no Help-menu entry in v1.0 | coordinator | `P7-T01`, `P7-T13`; `docs/07` §10.4 marked by `P7-T01` |
| 13 | The pane gets **no paid voice preview** (`docs/08` §7.3's preview button): a preview is a paid Gemini call, and the report window's audio section already lets the user hear the voice on a real job; the pane's voice list is the documented default list, fetched by no call | coordinator | `P7-T01`, `P7-T08` |
| 14 | The release candidate is **v0.9.0**, published by the owner before the QA run, so the QA run, the screen-reader test and the walkthrough test the built artefact users get; the v0.9.0 → v1.0.0 upgrade line is recorded in the checklist **after** v1.0.0 is published, as an addendum to the signed checklist | coordinator | `P7-T26`, `P7-T29`, `P7-T30` |
| 15 | The reading of line 2: the plugin-created content is (a) notes carrying a tag in `GENERATED_TAG_NAMESPACE` (summaries, trend reports), (b) provenance notes (`PROVENANCE_NOTE_TITLE_PREFIX`, the bare tag), (c) audio attachments whose keys a stored `TrendReport` holds in `audioAttachmentKeys`, and (d) the plugin database's rows. (a)–(c) go to the trash; (d) is deleted and counted. A linked audio file on disk is left in place and its folder named. Imported items, their tags (including the bare `research_helper` tag) and Related links are untouched. Keys are not touched; "Remove all stored keys" stays a separate button | coordinator | `P7-T01`, `P7-T11` |
| 16 | Every Phase 7 string's Korean goes through `G-41`'s review page process, which `G-31` folds into for the prompts and `README.ko.md` | coordinator | `P7-T05`, `P7-T20`; `plan/06` `G-31` marked 2026-11-16 |
| 17 | The debug output for the redaction audit is captured from an integration run on recorded fixtures with `logLevel` `debug`, not from a keyed run | coordinator | `P7-T14` |

**Lines 18–23, answered 2026-11-16.** These were open lines for the owner until the owner answered them on
2026-11-16, recorded as `plan/00` §6 item 381. No line of this table is open any more; the steps that stopped on
them (`plan/04` §0.2 item 10) may now be executed as the answer says. Every answer below is **DECIDED 2026-11-16
(owner, `plan/00` §6 item 381)**; the recommendation each line carried is kept in item 380(h).

| Line | Question | Answer, DECIDED 2026-11-16 (owner, `plan/00` §6 item 381) | Where |
|---|---|---|---|
| 18 | `docs/13` §8.9 asks that the scheduled `live-contract` job was green within two weeks. It needs a `--verify` mode in `scripts/record-fixtures.ts` that does not exist, and repository secrets holding real keys. Build it for v1.0, or waive the line? | **Deferred.** The scheduled `live-contract` job is a later-release candidate, and `docs/13` §8.9's line is **waived for v1.0**, with the reason: no secret-holding job exists. The fixtures' 180-day age rule (the §8.9 line before it) still applies | `P7-T24` step 3; `docs/13` §8.9 marked 2026-11-16 |
| 19 | `docs/09` §7's `[BLOCKER]` asks for a `sha256:` `update_hash`; the scaffold writes `sha512:` and Zotero installs it (`docs/13` §6.3, corrected 2026-09-16). Is a CI-generated `sha512:` hash the blocker met, or must CI add `sha256:`? | **A CI-generated `sha512:` hash meets the blocker.** Its wording is corrected to "a CI-generated sha256 or sha512 hash", with a dated note | `P7-T16` step 3, `P7-T21` step 3; `docs/09` §7 corrected 2026-11-16 |
| 20 | Item 379 (line 27) changed balanced mode for **audio** with a free or unknown Gemini key: warn and confirm. Does Gemini **chat** in balanced mode follow? | **Yes.** A Gemini chat, summary or report call in balanced mode follows the audio rule: a free or unknown key shows the warning and proceeds only after the user confirms; only strict mode refuses. `assertModelAllowed` changes in one place | `P7-T32` (added 2026-11-16, 0.75 d); `docs/09` §3.5 marked 2026-11-16 |
| 21 | `docs/11` R-19 (PDF extraction quality) — whether a later phase validates at scale was carried to Phase 7 (`plan/00` §6 item 326(g)) | **Not in v1.0.** No PDF-extraction-quality validation at scale; the held-out IMRaD measurement (`plan/00` §6 items 375–377) is the record, and the README's known-limitations section states it | `P7-T19` step 1 |
| 22 | `P3-T37` is deferred but still **Blocks** `P3-T31` (Phase 3's acceptance run). May `P3-T31` run without it? | **Yes.** The `P3-T37` → `P3-T31` edge is dropped, with a dated note on both cards | `plan/04` `P3-T31`, `P3-T37` |
| 23 | `autoSummarize` exists (ships `false`) against `docs/09` §7's `[BLOCKER]` "no background, idle-time, or on-import processing". Is an opt-in on-import summarizer allowed? | **Not in v1.0.** `autoSummarize` stays **off and hidden from the preferences pane**; the `[BLOCKER]` stands as written; an opt-in automatic summarizer is a later-release candidate | `P7-T08` step 2, `P7-T16` step 2; `docs/09` §7 and `docs/07` §8.5 marked 2026-11-16 |

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P7-T01` | Reconcile Phase 7 documents: debug bundle, pane sections, remove-all scope | 0.75 | none |
| `P7-T02` | Key-parity check script as a blocking CI step | 0.75 | none |
| `P7-T03` | Hard-coded string and `Intl` sweep | 1.75 | none |
| `P7-T04` | Retire the spike command; keep its fixture in the tests | 0.75 | none |
| `P7-T05` | Korean review of the UI, the prompts and `README.ko.md` | 0.75 | **Yes** |
| `P7-T06` | Keyboard, focus, accessible names and contrast pass | 2.0 | none |
| `P7-T07` | NVDA smoke test on the release candidate | 0.25 | **Yes** |
| `P7-T08` | Pane: Search, Report & audio, Privacy; defaults review | 1.5 | none |
| `P7-T09` | Pane: Advanced section, cache usage, verbose logging, data location | 1.0 | none |
| `P7-T10` | Clear actions, delete all plugin data, reset, uninstall coverage | 1.5 | none |
| `P7-T11` | Remove all Research Helper content | 1.5 | none |
| `P7-T12` | Error-message audit against NFR-14 | 1.25 | none |
| `P7-T13` | Log ring buffer and diagnostics: save and copy | 1.5 | none |
| `P7-T14` | Log-redaction audit of a full job at debug level | 0.75 | none |
| `P7-T15` | Startup, memory and main-thread profiling | 2.25 | **Yes** |
| `P7-T16` | `docs/09` §7 security review, `SECURITY.md`, dependency audit | 1.5 | none |
| `P7-T17` | Provider-policy re-verification and dated retention text | 0.75 | none |
| `P7-T18` | Offline verification | 1.0 | none |
| `P7-T19` | README and CHANGELOG | 1.5 | none |
| `P7-T20` | `README.ko.md` | 0.5 | none |
| `P7-T21` | Release workflow hardening | 1.0 | none |
| `P7-T22` | `compat.yml`: the scheduled Zotero-beta job | 0.5 | none |
| `P7-T23` | Forum announcement and community-list drafts | 0.5 | none |
| `P7-T24` | The release checklist document | 1.0 | none |
| `P7-T25` | Windows manual QA run on the release candidate | 1.0 | **Yes** |
| `P7-T26` | Publish the release candidate v0.9.0 | 0.25 | **Yes** |
| `P7-T27` | Fresh-profile README walkthrough and screenshots | 0.5 | **Yes** |
| `P7-T28` | NCBI registration on file | 0.25 | **Yes** |
| `P7-T29` | Release checklist sign-off | 0.25 | **Yes** |
| `P7-T30` | Publish v1.0.0 and verify the upgrade from v0.9.0 | 0.5 | **Yes** |
| `P7-T31` | Forum post and community-list submissions | 0.25 | **Yes** |
| `P7-T32` | Gemini in balanced mode: warn and confirm, not refuse | 0.75 | none |
| `P7-T33` | Offline message in report, related and summarize windows | 0.5 | none |
| `P7-T34` | Summary prompts send no tags | 0.5 | none |
| `P7-T35` | Semantic Scholar attribution under the report's references | 0.5 | none |
| `P7-T36` | Teardown error line through `redact` | 0.25 | none |
| `P7-T37` | Redaction audit reads the plugin database | 0.25 | none |
| `P7-T38` | `npm audit fix` as its own reviewed change | 0.5 | none |
| `P7-T39` | Closed plugin windows are freed | 1.0 | none |
| `P7-T40` | The 500-item full-text job within 400 MB | 1.0 | none |
| | **Total** | **34.75** | 10 gates |

*Updated 2026-11-16, later (`plan/00` §6 item 381): `P7-T32` added for §0.4 line 20; the total read 28.50. It is
a new entry point that blocks `P7-T16`, and it does not lie on the critical path below (it ends at 0.75 d, before
`P7-T16`'s other inputs; recompute with the script after `npm run index:derive`).*

*Updated 2026-11-17 (`plan/00` §6 item 393(d)): `P7-T33` added for the owner's answer to item 393; the total read 29.25. It depends on `P7-T12` and `P7-T18` and blocks `P7-T03`; it ends at 2.75 d (1.25 + 1.0 + 0.5), before `P7-T03`'s other inputs, so it does not lie on the critical path below, which stays 14.5 d (recomputed by script the same day).*

*Updated 2026-11-17, later (`plan/00` §6 items 395, 398): `P7-T34`–`P7-T38` added for the owner's answers to item 395 (2.0 d), and `P7-T03` rose from 1.5 to 1.75 d for item 395(b)'s step; the total read 29.75. Each new card depends on `P7-T16`; `P7-T34`–`P7-T37` block `P7-T24`, `P7-T35` also blocks `P7-T05`, and `P7-T38` blocks `P7-T26`. None lies on the critical path below; `P7-T03` does, so the path is now 14.75 d (recomputed by script the same day).*

*Updated 2026-11-18 (`plan/00` §6 items 401(a), 402(a)): `P7-T15` rose from 1.5 to 2.0 d for the owner's answer to item 401(a) (the test-profile memory measurement); the total read 32.00. `P7-T15` lies on the critical path below, so the path is now 15.25 d (recomputed by script the same day).*

*Updated 2026-11-18, later (`plan/00` §6 items 403(a), 403(b), 403(e), 404(a), 404(b)): `P7-T39` and `P7-T40` (1.0 d each) added for the owner's answers to items 403(a) and 403(e), and `P7-T15` rose from 2.0 to 2.25 d for item 403(b)'s profile; the total read 32.50. Each new card depends on `P7-T15` and blocks `P7-T24`; both end at 13.25 d, so the path now runs through one of them (the script names `P7-T39`) and is 16.50 d (recomputed by script the same day).*

**Entry points** (no `Depends on`): `P7-T01`, `P7-T04`, `P7-T12`, `P7-T21`, `P7-T22`, `P7-T28`, and `P7-T32`
(added 2026-11-16, `plan/00` §6 item 381). They
are documents, the spike's removal, the error audit, two workflow files and the owner's NCBI check;
none touches a file another entry point holds, except that `P7-T04` and `P7-T12` both edit
`src/i18n/keys.ts` and both bundles (different ids — exact-string edits).

**Critical path inside the phase:** `P7-T01` → `P7-T08` → `P7-T09` → `P7-T10` → `P7-T11` → `P7-T03`
→ `P7-T06` → `P7-T15` → `P7-T39` (or `P7-T40`, which ends at the same 13.25 d) → `P7-T24` → `P7-T26` → `P7-T25` → `P7-T29` → `P7-T30` → `P7-T31`,
**16.50 d** *(15.25 d before 2026-11-18's batch G changes, item 404(a); 14.75 d before 2026-11-18's `P7-T15` change, item 402(a); 14.5 d before 2026-11-17's `P7-T03` change, item 398)*, computed by script over the **Depends on** rows. The documents chain (`P7-T19` →
`P7-T20` → `P7-T05`, ending at 9.0 d) and the security chain (`P7-T13` → `P7-T14` → `P7-T16`, ending
at 7.0 d) finish before `P7-T24` (14.25 d; 13.0 d before batch G, item 404(a); 12.5 d before 2026-11-18, item 402(a); 12.25 d before 2026-11-17, item 398) and `P7-T26` need them. Ten of the 31 cards are
human-gated, and six of those sit on the path: the calendar time of `P7-T15`, `P7-T26`, `P7-T25`,
`P7-T29`, `P7-T30` and `P7-T31` is the owner's, not the developer's.

---

## 2. Task cards

### P7-T01 — Reconcile Phase 7 documents: debug bundle, pane sections, remove-all scope

| Field | Value |
|---|---|
| **ID** | `P7-T01` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T01.md`. |
| **Depends on** | none |
| **Blocks** | `P7-T08`, `P7-T09`, `P7-T11`, `P7-T13` |
| **Retires** | none |
| **Implements** | part of `FR-52`, part of `FR-54`, part of `FR-20` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** The documents the Phase 7 code cards build from say what v1.0 ships: the debug bundle's
format and where it is offered (§0.4 line 12), the pane's sections without a paid voice preview (line
13), and what "remove all Research Helper content" removes (lines 2 and 15).

**Read first.**
- `docs/07-architecture-and-data-model.md` §10.4 (the debug bundle), §8.5 (the preference schema),
  §9.2 (cache caps)
- `docs/08-ui-ux-spec.md` §7.3 (the pane's target sections), §7.5, §9 (accessibility)
- `docs/09-security-privacy-and-api-keys.md` §3.7; `docs/10` FR-20, FR-54, NFR-20 and §5 Q14 (noted
  2026-11-16)
- `docs/01` §9.2 and §10.4, `docs/08` §8.2.1 — the two Fluent markers (§0, V-17 row)

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§10.4: plain text, the sections in order, the
  preview, the two actions; dated note)
- modify `docs/08-ui-ux-spec.md` (§7.3: the Report & audio section without a preview button; the
  Advanced section's diagnostics and data-location rows; the remove-all button; dated notes)
- modify `docs/09-security-privacy-and-api-keys.md` (§3.7: the remove-all command beside the clear list)
- modify `docs/10-requirements-and-user-stories.md` (FR-20 and NFR-20: the remove-all scope; dated notes)
- modify `docs/01-zotero-plugin-platform.md`, `docs/08-ui-ux-spec.md` §8.2.1 (the Fluent markers)

**Do.**
1. `docs/07` §10.4: the bundle is one UTF-8 text file with the sections environment, settings (every
   `secret: true` value replaced by "set" or "not set"), recent jobs, the last log lines, recent
   errors and cache statistics; it carries no key and no paper content; the user previews it before
   saving or copying. Name the two pane actions. Strike the zip and the Help-menu entry with a dated
   note citing §0.4 line 12.
2. `docs/08` §7.3: record the sections the pane ships — Search, Report & audio (voice list from the
   documented defaults, no preview call; §0.4 line 13), Privacy (with the policy-verification date,
   `P7-T17`), Advanced (concurrency, timeout, cache size and usage, verbose logging, the clear actions,
   delete all plugin data, reset, remove all Research Helper content, data location, diagnostics).
3. `docs/09` §3.7 and `docs/10` FR-20/NFR-20: write §0.4 line 15's reading as a dated note; NFR-20's
   deletion rule gains "and, through the remove-all command, plugin-created notes and attachments, to
   the trash, after a confirmation naming each count".
4. The Fluent markers: find on file (`plan/01` `P0-T24`, `plan/reports/`) what the plugin measured
   about `Zotero.getString()` on a plugin key. If a measurement is recorded, mark the markers with a
   dated note citing it; if not, write that the plugin does not depend on that path (cite
   `src/i18n/ftl.ts`) and leave the marker as `Unverified`.

**Do NOT.**
- Do **not** add a preference row; `P7-T08` and `P7-T09` add any they need, through `docs/07` §8.5
  first.
- Do **not** state a measurement that is not on file (step 4).
- Do **not** write code.

**Done when.**
- [ ] Each of the four documents carries a dated 2026-11-16 note naming §0.4's line.
- [ ] `grep -n "zip" docs/07-architecture-and-data-model.md` in §10.4 finds only struck or noted text.

**Verify with.**
```bash
grep -n "2026-11-16" docs/07-architecture-and-data-model.md docs/08-ui-ux-spec.md docs/09-security-privacy-and-api-keys.md docs/10-requirements-and-user-stories.md
```

**Notes.** Needs: nothing earlier. Callers: none (documents); `P7-T08`, `P7-T09`, `P7-T11` and
`P7-T13` build from them.

---

### P7-T02 — Key-parity check script as a blocking CI step

| Field | Value |
|---|---|
| **ID** | `P7-T02` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T02.md`. |
| **Depends on** | `P7-T04` |
| **Blocks** | `P7-T05`, `P7-T24` |
| **Retires** | `R-22` |
| **Implements** | `FR-55`, part of `NFR-11` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `scripts/check-l10n.mjs` compares every `en-US` bundle with its `ko-KR` twin and fails CI on
any message or attribute missing from either side or empty, and the commented placeholder in `ci.yml`
becomes a blocking step (R-22: warn-only until Phase 7, then error).

**Read first.**
- `docs/11` R-22; `docs/13` §5.1 (the CI job list)
- `.github/workflows/ci.yml` — the "Verify Korean localization completeness" placeholder
- `src/i18n/keys.ts` (`MESSAGE_IDS_BY_SURFACE`, `KO_DELIBERATELY_ABSENT`) and
  `test/unit/i18n/keys.test.ts` — what is already checked in unit tests, so the script adds only the
  file-to-file comparison

**Files.**
- create `scripts/check-l10n.mjs` (caller: the new `ci.yml` step and the `l10n:check` script)
- modify `.github/workflows/ci.yml` (the placeholder becomes a step in the lint job)
- modify `package.json` (`"l10n:check": "node scripts/check-l10n.mjs --base en-US --target ko-KR"`)
- create `test/unit/scripts/checkL10n.test.ts`

**Do.**
1. Parse each `.ftl` file into message ids and their attribute names with a small line-based reader
   (no new dependency): an id at column 0, `.attr =` lines, continuation lines, comments skipped.
2. For each of the three surfaces, report ids and attributes present on one side only, and values that
   are empty; exit 1 on any, printing each with its file.
3. `KO_DELIBERATELY_ABSENT` is empty after `P7-T04`; the script takes no exception list. If the
   owner keeps a deliberate hole, it is passed with `--allow <id>` in the CI step, visibly.
4. Tests run the script on small fixture bundles in a temporary directory: equal, missing id, missing
   attribute, empty value, extra Korean id.

**Do NOT.**
- Do **not** compare the Korean text with the English text (that is `P7-T05`'s human review).
- Do **not** add an npm dependency for Fluent parsing.

**Done when.**
- [ ] `npm run l10n:check` exits 0 on the tree and 1 on each fixture defect.
- [ ] The CI step is not commented and is not `continue-on-error`.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run l10n:check && npm run test:unit -- checkL10n && npm run lint:check
```

**Notes.** Needs: `P0-T24`. Callers: `ci.yml` (lint job), `package.json` `l10n:check`.

---

### P7-T03 — Hard-coded string and `Intl` sweep

| Field | Value |
|---|---|
| **ID** | `P7-T03` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T03.md`. |
| **Depends on** | `P7-T08`, `P7-T09`, `P7-T10`, `P7-T11`, `P7-T12`, `P7-T13`, `P7-T33` |
| **Blocks** | `P7-T05`, `P7-T06` |
| **Retires** | none |
| **Implements** | `NFR-11`, part of `FR-55` |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** No user-visible string is written outside Fluent, no sentence is assembled from English
fragments, and every date, number and currency amount the UI shows is formatted with `Intl` in Zotero's
locale; a unit test keeps it so.

**Read first.**
- `docs/10` NFR-11; `docs/08` §8 (localization)
- `src/i18n/ftl.ts`; the `Intl` calls already in `src/ui/dialogs/costConfirmDialog.ts`,
  `src/ui/dialogs/searchDialog.ts`, `src/ui/panes/summarySection.ts`
- `addon/content/*.xhtml` and `addon/content/*.js`; `src/ui/**`

**Files.**
- create `src/i18n/format.ts` (`formatDate`, `formatNumber`, `formatUsd`, `formatBytes`, taking the
  locale from the caller; callers: the dialogs, panes and view models below)
- modify the files the sweep finds, among `src/ui/dialogs/*.ts`, `src/ui/panes/*.ts`,
  `src/ui/viewModels/*.ts`, `src/ui/prefs/preferencesPane.ts`, `addon/content/*.{xhtml,js}`, and both
  bundles (new ids; the Korean through `G-41`)
- create `test/unit/i18n/noHardcodedStrings.test.ts`, `test/unit/i18n/format.test.ts`

**Do.**
1. A test that reads every `addon/content/*.xhtml` and fails on an element with visible text, `label`,
   `value` (on buttons), `placeholder`, `tooltiptext` or `title` that has no `data-l10n-id`, except an
   allow-list of non-language text (a URL, a number), each entry with a reason.
2. The same test greps `src/ui/**` and `addon/content/*.js` for assignments to `textContent`,
   `label`, `title` or `placeholder` from a string literal that contains a letter, with the same
   allow-list.
3. Replace each finding with a Fluent id; join sentences inside Fluent with arguments, never in code.
4. Route every displayed date, count, dollar amount and size through `src/i18n/format.ts`; the
   existing `Intl` calls move there.

**Do NOT.**
- Do **not** change a message's English wording while moving it (review is `P7-T05`).
- Do **not** format numbers inside Fluent with `NUMBER()` options the plugin cannot test in Node.

**Done when.**
- [ ] Both tests pass on the tree and fail on a planted literal in a fixture string.
- [ ] `npm run l10n:check` passes with every new id in both bundles.
- [ ] Mutation sweep per `plan/08` §0.2 item 24 on `format.ts`.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- i18n && npm run l10n:check
```

**Notes.** Needs: every earlier card that adds UI (§0.3), and `P6-T17` for the report window's audio
section. Callers of `format.ts`: the dialogs, panes and view models it is wired into.

> **Added 2026-11-17 (`plan/00` §6 item 392(a)).** Step 5: the item pane's summary section shows `failureText` of a
> failed run's `detail` (`runItemSummary`, `src/ui/dialogs/summarizeDialog.ts`; `src/ui/panes/summarySection.ts`),
> free text outside Fluent and against item 389(f)'s "not on screen". Show the error's `messageKey` message and its
> code instead, never `detail`; a test plants provider text in `detail` and asserts it is not drawn. Both files are
> already in this card's Files; no estimate change is claimed here, and the executing agent re-prices if it is not
> small.


> **Added 2026-11-17 (owner, `plan/00` §6 item 395(b), "주의 문장만 추가"; +0.25 d, propagated as item 398).** Step 6:
> add this sentence, verbatim, to the `en-US` `research-helper-egress-first-job-notice`, after "under its own terms.":
> "Do not use it on manuscripts you are peer-reviewing, on unpublished work covered by a confidentiality agreement, or
> on any material containing participant data, without checking your institution's rules first." The Korean of the whole
> message goes in as a commented draft for `G-41` beside the live Korean, which stays on `KO_PRESENT`; no `--allow`
> is needed, because the id is not new. v1.0 ships the global privacy mode only; a per-collection mode is a
> later-release candidate (`docs/09` §4.3's note of this date).

> **Built 2026-11-17 (coordinator's batch D; `plan/reports/P7-T03.md`).** `src/i18n/format.ts` holds every formatter
> (`formatUsd`, `formatNumber`, `formatList`, `formatMinutes`, `formatBytes`, `formatDate`, `formatDateTime`; callers:
> `costConfirmDialog.ts`, `reportViewModel.ts`, `searchImportViewModel.ts`, `summarySection.ts`; nothing is
> constructed). `addon/content/preferences.js` keeps its three helpers, because a chrome script cannot import the bundle
> (coordinator, under item 313). Step 5 is `summaryFailure` and `SummaryFailedError` in `src/ui/panes/summarySection.ts`
> (callers: the section's own run handlers, and `runItemSummary` in `src/ui/dialogs/summarizeDialog.ts`). The summarize
> window's second-run note finding of `plan/reports/P7-batchB.md` is behaviour, not a string or `Intl` call, and is not
> under this sweep (`plan/00` §6 item 398).

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 399(c)): "그대로 둠" — a named exception to the Do NOT's `NUMBER()`
> line.** The preferences pane's megabyte figures, `NUMBER($megabytes, maximumFractionDigits: 1)`, stay in Fluent: four
> messages (`research-helper-prefs-cache-usage-row`, `-cache-usage-total`, `-confirm-clear-responses`,
> `-confirm-delete-all`), five placeables in en-US and four in ko-KR, their Korean approved and their output checked in
> Zotero by `preferences.spec.ts`. `test/unit/i18n/format.test.ts` pins exactly these and fails on any other `NUMBER()`
> in a bundle (added 2026-11-18, batch E).

*Updated 2026-11-17 (`plan/00` §6 item 393(d)): depends on `P7-T33`, which changes `src/ui/viewModels/reportViewModel.ts`, `src/ui/viewModels/relatedViewModel.ts` and `src/ui/dialogs/summarizeDialog.ts`, files this sweep also edits.*
---

### P7-T04 — Retire the spike command; keep its fixture in the tests

| Field | Value |
|---|---|
| **ID** | `P7-T04` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T04.md`. |
| **Depends on** | none |
| **Blocks** | `P7-T02` |
| **Retires** | `plan/00` §5 backlog item 25 |
| **Implements** | part of `FR-56` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** v1.0's Tools menu has no developer command: "Create spike item (P0-T10)" is gone from the
menu, the bundles and the id lists, and the integration tests that used `createSpikeArticle` get the
same fixture from test support.

**Read first.**
- `plan/00` §5 backlog item 25
- `src/ui/menus/toolsMenu.ts` (`toolsMenuOptions`, `L10N_MENU_SPIKE_CREATE_ITEM`),
  `src/zotero/zoteroApi.ts` (its header on why `createSpikeArticle` is in the wrong layer),
  `src/bootstrap/registerUI.ts` (the wiring)
- `test/integration/zotero/itemCreation.spec.ts`, `test/integration/menus.spec.ts`,
  `test/integration/l10n.spec.ts`, `test/unit/bootstrap/container.test.ts`

**Files.**
- modify `src/ui/menus/toolsMenu.ts`, `src/bootstrap/registerUI.ts`, `src/zotero/zoteroApi.ts`
  (remove the spike command, `SPIKE_COLLECTION_NAME`, `SPIKE_WORK`)
- modify `src/i18n/keys.ts` (remove the id; `KO_DELIBERATELY_ABSENT` becomes empty — keep the list,
  empty, with its test)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- create `test/integration/support/spikeArticle.ts` (the fixture work and a helper that writes it
  through `importWorks`; callers: the specs below)
- modify the four test files above

**Do.**
1. Move the fixture work and its writer to `test/integration/support/spikeArticle.ts`, unchanged.
2. Remove the menu entry, its command, its string and the source constants; the Tools menu keeps its
   other entries.
3. `menus.spec.ts` asserts the spike entry is **absent**; `l10n.spec.ts` drops the id.

**Do NOT.**
- Do **not** change what `itemCreation.spec.ts` proves (V-2's item round trip).
- Do **not** remove `KO_DELIBERATELY_ABSENT` itself; `keys.test.ts` checks the partition.

**Done when.**
- [ ] `grep -rn "createSpikeArticle\|menu-spike" src addon` finds nothing.
- [ ] Unit tests pass; the three integration specs pass three times in a row (`plan/04` §0.2 item 3).

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:integration
```

**Notes.** Needs: `P0-T10`. Callers of `spikeArticle.ts`: `itemCreation.spec.ts`.

---

### P7-T05 — Korean review of the UI, the prompts and `README.ko.md`

| Field | Value |
|---|---|
| **ID** | `P7-T05` |
| **State** | `TODO` |
| **Depends on** | `P7-T02`, `P7-T03`, `P7-T20`, `P7-T35` |
| **Blocks** | `P7-T26` |
| **Retires** | none |
| **Implements** | `FR-55`, part of `FR-28`, part of `FR-38` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — gate `G-31`, folded into `G-41`'s review process (§0.4 line 16): a Korean-speaking researcher (the owner) reviews every `ko-KR` string not yet reviewed, the Korean prompt files (`TREND_REPORT_KO`, `AUDIO_SCRIPT_KO` and any other Korean prompt in `src/prompts/`) and `README.ko.md`, in chat, and the agent applies the corrections. |

**Goal.** Every Korean string, prompt and document v1.0 ships has been read by a native speaker in the
register `docs/12` §19 item 4 asks for, and the corrections are in the tree.

**Read first.**
- `plan/06` `G-31` (note of 2026-11-16) and `G-41` (the review process: drafts in
  `plan/reports/ko-review-*.ftl`, review in chat)
- `docs/12` §19 item 4, §11, §14; `docs/12` §17.2 and §17.6 (a prompt change bumps its version and
  invalidates cached output)
- what the owner already reviewed: `KO_PRESENT` in `src/i18n/keys.ts` and the `G-41` notes

**Files.**
- create `plan/reports/ko-review-p7.ftl` (every id added or changed since the last `G-41` batch, both
  languages side by side) and `plan/reports/ko-review-p7-prompts.md` (the Korean prompts and
  `README.ko.md`)
- modify `addon/locale/ko-KR/*.ftl`, the Korean prompt files in `src/prompts/`, `README.ko.md`,
  `src/i18n/keys.ts` (ids move to `KO_PRESENT`)
- modify `src/prompts/` version markers per `docs/12` §17.2 for any prompt that changes

**Do.**
1. List the ids changed since the last `G-41` batch by diffing against `KO_PRESENT` and the batch
   record; draft the review files; **stop for the owner**.
2. Apply the corrections exactly as given; bump each changed prompt's version; record in the report
   which cached outputs the bump invalidates (`docs/12` §17.6).
3. If the owner finds register-level problems in a prompt (`plan/05` §4.4, now §5.4), stop and report:
   a re-run of Phase 4's and Phase 6's Korean DoD items is then due, and no card here prices it.

**Do NOT.**
- Do **not** correct a Korean string the owner did not correct.
- Do **not** count the review done for strings added after the batch was drafted.

**Done when.**
- [ ] Every `ko-KR` id is on `KO_PRESENT`; `KO_PENDING_REVIEW` is empty.
- [ ] The owner's verdict on the prompts and `README.ko.md` is recorded verbatim in the report.
- [ ] `npm run l10n:check` and the unit tests pass.

**Verify with.**
```bash
npm run l10n:check && npm run test:unit -- i18n prompts
```

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(c)): "모두 승인".** The owner approved `README.ko.md` as
> written, so this card's `README.ko.md` part is settled: its draft comment and draft line are gone and nothing else
> changed. The rest of this card (the Korean prompts, and every `ko-KR` string not yet reviewed) stays the owner's,
> and its `Done when` lines are unchanged.

**Notes.** Needs: every card that adds a Korean string or prompt, including `P6-T06`, `P6-T08`,
`P6-T17`. Callers: none (strings and prompts).

---

### P7-T06 — Keyboard, focus, accessible names and contrast pass

| Field | Value |
|---|---|
| **ID** | `P7-T06` |
| **State** | `TODO` — built 2026-11-18, awaiting the owner's review (only the owner sets `DONE`); the NVDA half is `P7-T07`'s (`G-33`). Report at `plan/reports/P7-T06.md`. |
| **Depends on** | `P7-T03` |
| **Blocks** | `P7-T07`, `P7-T15` |
| **Retires** | none |
| **Implements** | `NFR-13` |
| **Estimate** | 2.0 d |
| **Human gate** | none |

**Goal.** Every plugin dialog, window and pane section is fully keyboard operable (logical tab order,
visible focus, `Escape` cancels, `Enter` confirms), every control has an accessible name, no status is
carried by colour alone, and text contrast meets 4.5:1 in Zotero's light and dark themes; integration
tests hold the first two.

**Read first.**
- `docs/10` NFR-13; `docs/08` §9 (and its `Unverified` high-contrast marker); `docs/13` §8.7
- `addon/content/*.xhtml`, `addon/content/style/searchDialog.css`
- the existing window specs: `test/integration/searchDialog-*.spec.ts`,
  `reportWindow-flow.spec.ts`, `relatedWindow.spec.ts`, `preferences.spec.ts`

**Files.**
- modify `addon/content/*.xhtml`, `addon/content/*.js`, `addon/content/style/*.css`
- modify both bundles (accessible names as Fluent attributes; the Korean through `G-41`)
- create `test/integration/accessibility.spec.ts` (for each window: the tab order visits every
  enabled control once, each has a non-empty accessible name, `Escape` closes or cancels, `Enter`
  activates the default)
- create `docs/spikes/phase-7-accessibility.md` (the contrast table and the colour-only audit)

**Do.**
1. For each window the plugin opens and the pane, list the controls and their order; fix order,
   `tabindex`, default buttons, `Escape` handling and missing names.
2. Status indicators (deduplication flags, the AI marker, job states) carry text or an icon besides
   colour.
3. Measure contrast of every text colour the plugin's own CSS sets against both themes' backgrounds,
   by computing the ratio from the CSS values; record the table; fix any below 4.5:1. Record whether
   forced-colours mode inherits (the `docs/08` §9 marker) by observation in the integration profile.
4. Progress dialogs announce completion: an `aria-live` region or the platform alert, as `docs/08`
   §9 says; note which.

**Do NOT.**
- Do **not** restyle Zotero's own chrome.
- Do **not** claim a screen reader announces anything; that is `P7-T07`.

**Done when.**
- [ ] `accessibility.spec.ts` passes three times in a row.
- [ ] The contrast table lists every plugin text colour with its ratio in both themes, all ≥ 4.5:1.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:integration -- accessibility
```

> **Updated 2026-11-18 (batch F, `plan/00` §6 item 402(f)): mutant M10 is killed.** That the cost dialog's ceiling
> moment never shows the tier question is intended: `CeilingDialogModel` (`src/ui/dialogs/costConfirmDialog.ts`) has
> no `tierQuestion` member, and the question belongs to an audio run's confirmation (`docs/08` §6.4's note "the audio section
> and its menu entry, as built", item 5; `docs/07` §8.5's note "As built 2026-11-17 (`plan/09` `P6-T15`)", item 2). So M10 was not equivalent: the
> spec opened only the ceiling moment. `accessibility.spec.ts` now also opens an audio run's pre-flight moment with the
> question, built by `buildAudioDialogModel` and opened by `openCostConfirmDialog`, so no run starts; with M10 planted
> it failed on the group's name (`plan/reports/P7-batchF.md`). Batch E's report said the pre-flight moment "would need
> a run to start"; the pure builders make that untrue.
>
> **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(b)): "1.0에서는 그대로".** The report window does not follow Zotero's
> dark appearance in v1.0; following it is a later-release candidate (a dated note in `docs/08` §9's Visual list).

**Notes.** Needs: every window card (`P2-*` search, `P4-T20`, `P5-*` related, `P6-T17`). Callers:
none new.

---

### P7-T07 — NVDA smoke test on the release candidate

| Field | Value |
|---|---|
| **ID** | `P7-T07` |
| **State** | `TODO` |
| **Depends on** | `P7-T06`, `P7-T26` |
| **Blocks** | `P7-T29` |
| **Retires** | none |
| **Implements** | `NFR-13` |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-33`, NVDA on Windows only (§0.4 line 1): the owner runs NVDA against every plugin dialog of the v0.9.0 build and records whether titles, control labels and job completion are announced. VoiceOver is recorded as waived. |

**Goal.** NFR-13's screen-reader line has a Windows result and a written VoiceOver waiver in the
release checklist.

**Read first.**
- `plan/06` `G-33` (note of 2026-11-16); `docs/13` §8.7
- `docs/spikes/phase-7-accessibility.md` (`P7-T06`)

**Files.**
- modify `docs/release/v1.0-checklist.md` (the NVDA result per dialog; the VoiceOver waiver)

**Do.**
1. Give the owner the list of dialogs, the three announcement classes to check and how to start NVDA
   speech logging; **stop for the owner**.
2. Record each dialog's result as the owner states it; record VoiceOver as waived, with the reason
   (no macOS machine, `G-09`) and §0.4 line 1.
3. A failure the owner hears becomes a finding in the report; fixing it is a rule-9 card if it
   blocks the checklist line.

**Do NOT.**
- Do **not** mark a dialog announced from `P7-T06`'s tests.

**Done when.**
- [ ] The checklist's NFR-13 screen-reader row has one result per dialog and the waiver.

**Verify with.** The owner's run; then `grep -n "NVDA" docs/release/v1.0-checklist.md`.

**Notes.** Needs: nothing from earlier phases. Callers: none.

---

### P7-T08 — Pane: Search, Report & audio, Privacy; defaults review

| Field | Value |
|---|---|
| **ID** | `P7-T08` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T08.md`. Korean for 25 ids awaits `G-41`. *Updated 2026-11-17: the owner approved the 25 and they are live (`plan/00` §6 item 394).* |
| **Depends on** | `P7-T01` |
| **Blocks** | `P7-T03`, `P7-T09`, `P7-T17` |
| **Retires** | none |
| **Implements** | `FR-52`, part of `FR-38` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** The pane has the Search, Report & audio and Privacy sections `docs/08` §7.3 names, bound to
their preferences, and every shipped default equals `docs/07` §8.5's.

**Read first.**
- `docs/08` §7.3 as `P7-T01` leaves it; `docs/07` §8.5
- `addon/content/preferences.{xhtml,js}`, `src/ui/prefs/preferencesPane.ts` (`PREFERENCES_L10N`,
  `preferencePaneOptions`), `src/prefs/schema.ts`
- `plan/09` §0.4 line 11 (the pane's audio controls are Phase 7's)

**Files.**
- modify `addon/content/preferences.xhtml` and `preferences.js` (three new groupboxes)
- modify `src/ui/prefs/preferencesPane.ts` (their l10n ids and bindings; caller: `preferences.js`,
  through `preferencePaneOptions` registered in `src/bootstrap/registerUI.ts`)
- modify both `research-helper-mainWindow.ftl` bundles (the Korean through `G-41`)
- modify `test/unit/ui/preferencesPane.test.ts`, `test/integration/preferences.spec.ts`;
  modify `test/unit/prefs/schema.test.ts` (the defaults table)

**Do.**
1. Search: the default sources, the default date range and the per-source limit `docs/07` §8.5
   declares.
2. Report & audio: the default report language, `tts.language`, `tts.voice` from the documented
   default voice list (no call), `tts.targetMinutes`, `tts.linkedFileDir`; the section is hidden while
   `audio.enabled` is off. No preview button (§0.4 line 13). **No `autoSummarize` control**, although
   `docs/07` §8.5 and `docs/08` §7.3 place one here: *DECIDED 2026-11-16 (owner, `plan/00` §6 item 381;
   §0.4 line 23)*, it stays off and hidden from the pane in v1.0; the test asserts the pane has no
   element bound to it.
3. Privacy: `privacy.mode`, the full-text mode, the egress-log view `docs/08` §7.3 names; a
   placeholder for `P7-T17`'s dated retention line.
4. A table-driven test asserts every row of `docs/07` §8.5 against `src/prefs/schema.ts`'s default;
   a difference is fixed in the schema only if §8.5 is right, otherwise reported.

**Do NOT.**
- Do **not** add a preference row that `docs/07` §8.5 does not declare.
- Do **not** issue a network request when the pane opens (NFR-10).

**Done when.**
- [ ] Each new control persists across a pane reopen in `preferences.spec.ts` (three runs).
- [ ] The defaults test covers every §8.5 row.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- preferencesPane schema && npm run test:integration -- preferences
```

**Notes.** Needs: `P6-T02` (the Phase 6 rows), `P3-T04`. Callers: `preferences.js`.

---

### P7-T09 — Pane: Advanced section, cache usage, verbose logging, data location

| Field | Value |
|---|---|
| **ID** | `P7-T09` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T09.md`. Korean for 12 ids awaits `G-41`. *Updated 2026-11-17: the owner approved the 12 and they are live (`plan/00` §6 item 394).* |
| **Depends on** | `P7-T01`, `P7-T08` |
| **Blocks** | `P7-T03`, `P7-T10`, `P7-T13` |
| **Retires** | none |
| **Implements** | part of `FR-52`, part of `FR-54`, part of `NFR-8` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The Advanced section shows concurrency, timeout and the cache-size cap; the cache's size per
namespace adding up to the total; the "Verbose debug logging" checkbox writing `logLevel`; and where
the plugin database lives.

**Read first.**
- `docs/08` §7.3; `docs/13` §8.7 (the verbose-logging line: `debug` when checked, `warn` when not; no
  `debug` preference; `logRequestBodies` unchanged); `docs/10` FR-54
- `CacheStats` and `stats` in `src/core/cache/cache.ts`, `sqliteCache.ts`;
  `src/bootstrap/pluginDatabase.ts`

**Files.**
- modify `addon/content/preferences.{xhtml,js}`, `src/ui/prefs/preferencesPane.ts`, both bundles
- modify `src/bootstrap/registerUI.ts` (the pane's privileged host gains `cacheStats` and
  `databasePath`; caller: `preferences.js`)
- modify `test/unit/ui/preferencesPane.test.ts`, `test/integration/preferences.spec.ts`

**Do.**
1. Concurrency (1–8), request timeout, `cache.maxSizeMB` with its range from §8.5.
2. Cache usage: one row per namespace from `stats`, and the total; refreshed on open and after a
   clear (`P7-T10`).
3. The checkbox reads `logLevel` and writes `debug` or `warn`; a test asserts it never writes
   `logRequestBodies` and never creates a `debug` preference.
4. The data location: the plugin database's path, read-only, with a "Show in folder" button.

**Do NOT.**
- Do **not** enforce the cap here; prune already does (`sqliteCache.ts`). Test that a lower cap takes
  effect on the next prune.

**Done when.**
- [ ] The namespace rows add up to the total in a unit test with fake stats.
- [ ] The checkbox round trip passes in `preferences.spec.ts` (three runs).
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- preferencesPane cache && npm run test:integration -- preferences
```

**Notes.** Needs: Phase 1's cache and logger. Callers: `preferences.js`.

---

### P7-T10 — Clear actions, delete all plugin data, reset, uninstall coverage

| Field | Value |
|---|---|
| **ID** | `P7-T10` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T10.md`. Korean for 16 ids awaits `G-41`. |
| **Depends on** | `P7-T09` |
| **Blocks** | `P7-T03`, `P7-T11`, `P7-T16` |
| **Retires** | none |
| **Implements** | part of `NFR-8`, part of `FR-56`, part of `NFR-16` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** The pane offers every action `docs/09` §3.7 lists — clear cached responses (with its size),
clear stored summaries, clear job history, clear embeddings, delete all plugin data — plus "reset to
defaults"; none touches a Zotero note; `uninstall()` deletes all plugin data and every preference.

**Read first.**
- `docs/09` §3.7 and §7's storage lines; `docs/13` §8.7 and §8.1 (the uninstall line)
- `src/core/cache/sqliteCache.ts` (`clearNamespace`), `src/zotero/db.ts`,
  `src/bootstrap/pluginDatabase.ts`, `onUninstall` in `src/hooks.ts`

**Files.**
- create `src/core/dataReset.ts` (`clearCachedResponses`, `clearStoredSummaries`, `clearJobHistory`,
  `clearEmbeddings`, `deleteAllPluginData`, `resetPreferences`; caller: the pane's host in
  `src/bootstrap/registerUI.ts` and `onUninstall`)
- modify `src/bootstrap/registerUI.ts`, `src/hooks.ts`, `addon/content/preferences.{xhtml,js}`,
  `src/ui/prefs/preferencesPane.ts`, both bundles
- create `test/unit/core/dataReset.test.ts`; modify `test/unit/bootstrap/uninstall.test.ts`,
  `test/integration/preferences.spec.ts`

**Do.**
1. Each clear deletes exactly its table or namespace, after a confirmation naming the count or size,
   and reports what it removed.
2. "Clear stored summaries" deletes the plugin's summary rows only; the confirmation says the Zotero
   notes stay (`docs/09` §3.7).
3. "Delete all plugin data" deletes every plugin table's rows and the cache blobs; keys stay (their
   own button exists).
4. "Reset" restores every non-secret preference to its §8.5 default.
5. `onUninstall` calls `deleteAllPluginData` and clears every plugin preference as well as the keys;
   `shutdown()` does none of it (`docs/09` §7).

**Do NOT.**
- Do **not** trash or delete any Zotero item (that is `P7-T11`, behind its own confirmation).
- Do **not** delete a key from any clear except uninstall.

**Done when.**
- [ ] A unit test per action against a fake database shows only its table changes.
- [ ] `uninstall.test.ts` shows data, preferences and keys cleared; a shutdown test shows none.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- dataReset uninstall && npm run test:integration -- preferences
```

**Notes.** Needs: every card that adds a plugin table (Phases 3–6; `P6-T16` adds none). Callers:
the pane's host, `onUninstall`.

---

### P7-T11 — Remove all Research Helper content

| Field | Value |
|---|---|
| **ID** | `P7-T11` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T11.md`. Korean for 4 ids awaits `G-41`. |
| **Depends on** | `P7-T01`, `P7-T10` |
| **Blocks** | `P7-T03`, `P7-T19` |
| **Retires** | none |
| **Implements** | `docs/10` §5 Q14, part of `FR-20`, `NFR-20` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** One command, in the pane's Advanced section, finds every note, attachment and stored row the
plugin created, shows the count of each kind, and on confirmation moves the notes and attachments to
Zotero's trash and deletes the stored rows; user-written notes and the original items stay.

> **DECIDED 2026-11-16 (owner, `plan/00` §6 item 380, decision 2):** v1.0 ships "remove all Research
> Helper content". Scope: the notes, attachments and stored data the plugin created. It shows counts
> per kind and asks for confirmation before deleting. Deleted items go to the Zotero trash; never
> hard-delete. User-written notes and the original items are untouched.
>
> **DECIDED 2026-11-16 (coordinator, under item 313):** the reading in §0.4 line 15.

**Read first.**
- `docs/10` §5 Q14 and NFR-20 (notes of 2026-11-16); `docs/09` §3.7 as `P7-T01` leaves it
- `findGeneratedNotes`, `trashGeneratedNotes`, `isGeneratedTag`, `PROVENANCE_NOTE_TITLE_PREFIX` in
  `src/zotero/notes.ts`; `RESEARCH_HELPER_TAG` in `src/zotero/itemMapper.ts`;
  `TrendReport.audioAttachmentKeys` (`src/model/trend.ts`) and `ReportStore` (`src/zotero/db.ts`)
- `deleteAllPluginData` (`P7-T10`)

**Files.**
- modify `src/zotero/notes.ts` (`findAllPluginContent(libraryIDs)` across all editable libraries:
  generated notes, provenance notes, audio attachments; `trashPluginContent`; caller: the pane's host)
- modify `src/bootstrap/registerUI.ts` (the host command: count, confirm, trash, delete rows, report)
- modify `addon/content/preferences.{xhtml,js}`, `src/ui/prefs/preferencesPane.ts`, both bundles
- create `test/integration/zotero/removeAllContent.spec.ts`; modify
  `test/unit/ui/preferencesPane.test.ts`

**Do.**
1. Find, without writing: (a) notes not in the trash with a tag in `GENERATED_TAG_NAMESPACE`; (b)
   notes not in the trash with the bare tag whose title starts with `PROVENANCE_NOTE_TITLE_PREFIX`;
   (c) attachments whose keys a stored report lists, not in the trash; (d) the plugin database's row
   counts per table.
2. The confirmation shows four counts and the libraries they are in, says the items go to the trash
   and can be restored there, names the folder of any linked audio file (left on disk), and that
   imported items and the user's own notes stay.
3. On yes: re-check each id as `trashGeneratedNotes` does; `Zotero.Items.trashTx` in batches; then
   `deleteAllPluginData`; report what moved.
4. A group library the user cannot edit is skipped and named.

**Do NOT.**
- Do **not** call `erase`, empty the trash, or touch an item without one of (a)–(c)'s marks.
- Do **not** remove the bare `research_helper` tag from imported items, or Related links.
- Do **not** run this from `uninstall()`.

**Done when.**
- [ ] The integration spec builds a library with each kind, a user note, a user note whose text
      mentions `research_helper/` but which carries no such tag, and an imported item; after the
      command exactly (a)–(c) are in the trash and restorable, and the rest is untouched (three runs).
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- preferencesPane && npm run test:integration -- removeAllContent
```

**Notes.** Needs: `P3-T29` (FR-20's per-collection removal), `P4-T14`, `P6-T13`. Callers: the pane's
host in `registerUI.ts`.

---

### P7-T12 — Error-message audit against NFR-14

| Field | Value |
|---|---|
| **ID** | `P7-T12` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T12.md`. Korean for 23 ids awaits `G-41` (`plan/00` §6 item 389(b)). *Updated 2026-11-17: the owner approved the 23 and they are live (item 389(g)).* |
| **Depends on** | none |
| **Blocks** | `P7-T03`, `P7-T18`, `P7-T33` |
| **Retires** | none |
| **Implements** | `NFR-14` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** Every user-facing error message states what failed, which service was involved and one
next action, with the provider's text verbatim in a details disclosure; the two deferred error ids
ship; a test holds it.

**Read first.**
- `docs/10` NFR-14; `docs/08`'s error-message section
- `src/core/errors.ts` (the classes and `messageKey`s); `DEFERRED_ERROR_MESSAGE_IDS` and
  `ERROR_MESSAGE_IDS` in `src/i18n/keys.ts`; every `rh-error-*` message in both bundles

**Files.**
- modify both `research-helper-mainWindow.ftl` bundles (the rewritten messages; the Korean through
  `G-41`)
- modify `src/i18n/keys.ts` (`DEFERRED_ERROR_MESSAGE_IDS` empty, the two ids declared)
- modify `src/core/errors.ts` only where a class lacks the service name or details its message needs
- create `test/unit/i18n/errorMessages.test.ts`; modify `test/unit/i18n/keys.test.ts`,
  `test/unit/core/errors.test.ts`

**Do.**
1. Table every error id: the class that raises it, the service argument it takes, its next action.
   A message missing one of the three is rewritten.
2. `rh-error-tts` and `rh-error-policy` get text and leave the deferred list.
3. The test asserts each English message has a `{ $service }`-style argument or names the service,
   and contains a next action from the table; the table is the test's data.
4. Check that every place an error reaches the UI shows the details disclosure with the provider's
   text after `redact`.

**Do NOT.**
- Do **not** put a key, a URL query or a header in a message argument.

**Done when.**
- [ ] `DEFERRED_ERROR_MESSAGE_IDS` is empty and the tests pass.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- errorMessages keys errors && npm run l10n:check
```

**Notes.** Needs: `P6-T14` for the TTS error text. Callers: none new.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 389(f)): "not on screen".** The Goal's "with the provider's text
> verbatim in a details disclosure" and step 4's "with the provider's text after `redact`" are superseded: a
> disclosure shows machine values only (`docs/07` §10.2), and the provider's text goes only to the debug log, after
> `redact`. `docs/10` NFR-14 was amended to match. The surfaces were checked the same day (item 392(a), (b)).

---

### P7-T13 — Log ring buffer and diagnostics: save and copy

| Field | Value |
|---|---|
| **ID** | `P7-T13` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T13.md`. Korean for 7 ids awaits `G-41`. *Updated 2026-11-17: the owner approved the 7 and they are live (`plan/00` §6 item 394).* |
| **Depends on** | `P7-T01`, `P7-T09` |
| **Blocks** | `P7-T03`, `P7-T14`, `P7-T15`, `P7-T19` |
| **Retires** | none |
| **Implements** | `FR-54` (completes it), part of `NFR-16` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** The logger keeps the last lines in a bounded ring buffer, and the pane's Advanced section
offers "Save diagnostics…" and "Copy diagnostics", both after a preview, producing the plain-text
bundle `docs/07` §10.4 describes as `P7-T01` leaves it.

**Read first.**
- `docs/07` §10.4; `docs/10` FR-54; `docs/09` §7 ("the debug bundle contains no key and no paper
  content; its confirmation dialog says so and offers a preview")
- `src/core/logger.ts`; `redact` (`src/core/errors.ts`); `CacheStats`; the job store

**Files.**
- modify `src/core/logger.ts` (a ring buffer of `docs/07` §10.4's size, filled after redaction)
- create `src/core/diagnostics.ts` (`buildDiagnostics(deps)`; caller: the pane's host in
  `src/bootstrap/registerUI.ts`)
- modify `src/bootstrap/registerUI.ts`, `addon/content/preferences.{xhtml,js}`,
  `src/ui/prefs/preferencesPane.ts`, both bundles
- create `test/unit/core/diagnostics.test.ts`; modify `test/unit/core/logger-redaction.test.ts`

**Do.**
1. The buffer stores the already-redacted line; it is memory only and bounded by line count.
2. `buildDiagnostics`: plugin and Zotero versions, OS, locale; every preference with `secret: true`
   values as "set"/"not set"; recent jobs (type, state, counts, error class — no titles, no queries);
   the buffer; recent errors; cache stats.
3. Preview in a read-only text box; Save writes through the file picker; Copy uses the clipboard
   helper. Neither keeps the path.
4. Tests: a planted key in a log line, a preference, a job error and a header never appears; a
   planted paper title in a job never appears.

**Do NOT.**
- Do **not** include `logRequestBodies` output in the bundle even when on.
- Do **not** upload anything.

**Done when.**
- [ ] The diagnostics test passes with the planted values absent.
- [ ] The buffer never exceeds its bound in a test that logs past it.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- diagnostics logger
```

**Notes.** Needs: Phase 1's logger. Callers: the pane's host.

---

### P7-T14 — Log-redaction audit of a full job at debug level

| Field | Value |
|---|---|
| **ID** | `P7-T14` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T14.md`. The audit found no planted key. |
| **Depends on** | `P7-T13` |
| **Blocks** | `P7-T16` |
| **Retires** | none |
| **Implements** | `NFR-16` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `docs/09` §7's `[BLOCKER]` "no key appears in `Zotero.debug` output at any log level" is
shown by a test: a full summarize job, a report job and an audio job run on recorded fixtures with
`logLevel` `debug` and a planted test key per provider, and the captured output and the diagnostics
bundle contain none of the keys.

**Read first.**
- `docs/09` §7 (the logging lines), §2.1 (the redaction patterns); §0.4 line 17
- the integration flow specs that run jobs on fixtures (`test/integration/reportWindow-flow.spec.ts`,
  the summarize flow), and `test/unit/integration/noKeyTransport.test.ts`

**Files.**
- create `test/integration/redactionAudit.spec.ts` (captures `Zotero.debug` output for the three
  jobs; greps for each planted key, its prefix pattern and its base64 form)
- create `plan/reports/P7-T14.md` (what was captured, the counts searched, the result)

**Do.**
1. Plant synthetic keys of each provider's shape in the secret store of the test profile; run the
   three jobs on replayed fixtures.
2. Capture the debug output and `buildDiagnostics`' text; search for each key, its first eight
   characters, and the header names' values.
3. Any hit is a release blocker: stop and report it with the line.

**Do NOT.**
- Do **not** use a real key, or run a keyed path (`plan/09` §0.2 item 20).

**Done when.**
- [ ] The spec passes three times in a row, and the report records the zero result and the number of
      lines searched.

**Verify with.**
```bash
npm run test:integration -- redactionAudit
```

**Notes.** Needs: `P3-T30` (fixtures), `P4-T18`, `P6-T18`. Callers: none.

---

### P7-T15 — Startup, memory and main-thread profiling

| Field | Value |
|---|---|
| **ID** | `P7-T15` |
| **State** | `TODO` — the agent's part built 2026-11-18, awaiting the owner's review and the owner's run on a library copy (`G-34`; only the owner sets `DONE`). Report at `plan/reports/P7-T15.md`. *2026-11-18, batch F:* the test-profile workload memory measurement (item 401(a)) built and run three times; its figures are test-profile figures only; owner questions in `plan/00` §6 item 403. *2026-11-18, batch G:* item 403(b)'s Gecko profile recorded and its cause written in the report; item 405(a) holds the fix as an owner question with a draft card. |
| **Depends on** | `P7-T06`, `P7-T13` |
| **Blocks** | `P7-T24`, `P7-T39`, `P7-T40` |
| **Retires** | `R-10` |
| **Implements** | `NFR-3`, `NFR-7`, `NFR-10`, `NFR-18` |
| **Estimate** | 2.25 d |
| **Human gate** | **Yes** — gate `G-34` (Windows only for v1.0): the owner provides a **copy** of a large real library (~10 k items) in a separate Zotero profile, never the original, and runs the profiling procedure on it. |

**Goal.** NFR-3 (no task over 100 ms), NFR-7 (idle ≤ 30 MB, reference workload peak ≤ 150 MB, 500-item
full-text job ≤ 400 MB), NFR-10 (≤ 200 ms added to startup, no startup request) and NFR-18 (XPI ≤ 3 MB)
each have a measured figure on Windows, with the method.

**Read first.**
- `docs/10` NFR-3, NFR-7, NFR-10, NFR-18; `docs/13` §8.1, §8.8; `docs/11` R-10
- `test/unit/integration/startupRequests.test.ts`, `test/integration/zotero/import-perf.spec.ts`,
  `scripts/bench-search.ts`

**Files.**
- create `docs/spikes/phase-7-profiling.md` (the procedure, the figures, the machine)
- create `test/integration/startupCost.spec.ts` (the plugin's own startup time from its hooks'
  timestamps, and no request at startup)
- create `test/integration/workloadMemory.spec.ts` (*added 2026-11-18, `plan/00` §6 item 401(a)*:
  `NFR-7`'s two workload figures and `docs/13` §8.8's growth line, in the test profile, through a
  fake provider)

**Do.**
1. Write the procedure: startup with and without the plugin (median of five), `about:memory` before
   and after the reference workload on fixtures and after five consecutive jobs, the Gecko profiler
   for long tasks during import and report; **stop for the owner** to run it on the library copy.
2. Record each figure beside its budget; a figure over budget is a finding (rule 9 if it blocks).
3. The XPI size from `npm run build`.

**Do NOT.**
- Do **not** run any step on the owner's original library (`G-38`).
- Do **not** make a paid call for the workload; it runs on recorded fixtures.

**Done when.**
- [ ] Each of the four NFRs has a figure and a pass/fail in `phase-7-profiling.md`.
- [ ] `startupCost.spec.ts` passes three times in a row.

**Verify with.**
```bash
npm run build && npm run test:integration -- startupCost
```
Then the owner's run of the written procedure.

**Notes.** Needs: Phases 1–6 built. Callers: none.

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(a)): "만듦".** The workload memory measurement is
> built in the test profile with a fake provider: no network, no key, no spend. The Estimate rose
> 1.5 → 2.0 d (item 402(a)). Its figures go into `docs/release/v1.0-checklist.md` as test-profile
> figures only; the large-library run (`G-34`) stays the owner's. The reading is heap, not
> `explicit`, which Zotero 10.0.3's reporter does not have (item 402(b)). The budgets are logged,
> not asserted (item 402(c)). The method is in `docs/spikes/phase-7-profiling.md` §3.2–§3.3, and
> the figures are in its §6.1 and `plan/reports/P7-T15.md`. The three findings it measured are owner
> questions in `plan/00` §6 item 403:
> - growth after five jobs, item (a);
> - a long timer gap in a 500-item summarize job, item (b);
> - the 500-item full-text peak over 400 MB in one of seven runs, item (e).
>
> **DECIDED 2026-11-18 (owner, plan/00 §6 item 403(b)): "먼저 원인 기록".** A local Gecko profile of
> the 500-item job, with Zotero's own profiler, in the test profile only, nothing uploaded; about
> 0.25 d; the cause recorded in `plan/reports/P7-T15.md` and `plan/00` §6 item 403(b); no fix here.
> *Recorded 2026-11-18 (batch G):* the gap is one synchronous task in summarize `prepare`, the
> duplicate screen (`screenItems` → `findCollectionDuplicates` → `levenshtein`), 91.6 % of the
> gap's main-thread samples. The fix is owner question `plan/00` §6 item 405(a), with a draft card.
>
> *Estimate history:* 1.5 d (decomposition) → 2.0 d (item 401(a), the memory measurement) → 2.25 d
> (item 403(b), the profile; item 404(b)).

---

### P7-T16 — `docs/09` §7 security review, `SECURITY.md`, dependency audit

| Field | Value |
|---|---|
| **ID** | `P7-T16` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T16.md`. |
| **Depends on** | `P7-T10`, `P7-T14`, `P7-T21`, `P7-T32` |
| **Blocks** | `P7-T24`, `P7-T26`, `P7-T34`, `P7-T35`, `P7-T36`, `P7-T37`, `P7-T38` |
| **Retires** | none |
| **Implements** | `NFR-16`, `NFR-19`, part of `NFR-20` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Every line of `docs/09` §7 has a recorded result — a test, a grep, a run or a document — and
every `[BLOCKER]` is met or the release stops; `SECURITY.md` exists with a contact address and a
response expectation; `npm audit` shows no high-severity advisory.

**Read first.**
- `docs/09` §7 entire, §6.3, §1.8; `docs/10` NFR-19
- `plan/reports/P7-T14.md`

**Files.**
- create `SECURITY.md` (contact: the maintainer address of D10; response expectation; the
  post-compromise plan with "rotate all configured API keys" first)
- create `docs/spikes/phase-7-security-review.md` (each §7 line → evidence)
- modify `docs/09-security-privacy-and-api-keys.md` (§7: a dated note per line resolved; the answer
  to §0.4 line 19 was written on 2026-11-16, item 381)

**Do.**
1. Walk §7 line by line; cite the test, grep or report that shows each line; a line without evidence
   is a finding.
2. The "no background, idle-time, or on-import processing" `[BLOCKER]`: read what `autoSummarize`
   does and record it. *DECIDED 2026-11-16 (owner, `plan/00` §6 item 381; §0.4 line 23):* the blocker
   stands; `autoSummarize` ships `false` and is **hidden from the preferences pane** in v1.0 (`P7-T08`
   step 2 builds no control for it). Record as evidence that no pane control, menu or other UI can set
   it (grep `addon/content/` and `src/ui/` for the preference key), and that it ships `false`
   (`test/unit/prefs/schema.test.ts`); a UI path that can set it is a finding that stops the release.
3. The `update_hash` `[BLOCKER]`: *DECIDED 2026-11-16 (owner, `plan/00` §6 item 381; §0.4 line 19):* a
   CI-generated `sha512:` hash meets it; `docs/09` §7's wording now reads "a CI-generated sha256 or
   sha512 hash" (corrected 2026-11-16). Check `P7-T21`'s output against that wording: the hash is
   written by the workflow, never by hand.
4. `npm audit --omit=dev` and the full audit; record both; a high-severity runtime advisory stops the
   release.
5. Grep the built XPI for anything shaped like a key or token (§7's "no secret in the XPI").

**Do NOT.**
- Do **not** mark a line met from the code's comments alone.

**Done when.**
- [ ] Every §7 line has a row in the review file with evidence or a named finding.
- [ ] `SECURITY.md` exists; `npm audit` results are recorded.

**Verify with.**
```bash
npm audit --omit=dev; npm run build && npm run test:unit
```

**Notes.** Needs: Phases 1–6 built. Callers: none.

---

### P7-T17 — Provider-policy re-verification and dated retention text

| Field | Value |
|---|---|
| **ID** | `P7-T17` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T17.md`. Korean for 6 ids awaits `G-41`. *Updated 2026-11-17: the owner approved the 6 and they are live (`plan/00` §6 item 394).* |
| **Depends on** | `P7-T08` |
| **Blocks** | `P7-T19`, `P7-T24` |
| **Retires** | none |
| **Implements** | `docs/09` §8 items 6 and 7 |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Every provider policy claim that reaches user-facing text is re-read on the provider's own
page, dated, and shown in the pane's Privacy section with its verification date; a claim that cannot be
re-verified is kept out of the UI.

> **DECIDED 2026-11-16 (coordinator, under `plan/00` §6 item 313):** `docs/09` §8 item 7 — re-verify
> at each minor release and stamp the verification date next to the retention text (§0.4 line 9).

**Read first.**
- `docs/09` §3.3, §8 items 6 and 7 (notes of 2026-11-16); §7's last three lines
- `P7-T08`'s Privacy section

**Files.**
- modify `docs/09-security-privacy-and-api-keys.md` (§3.3: each claim with its re-verification date;
  the claims that could not be re-fetched)
- create `src/llm/shared/policyNotes.ts` (the dated retention lines the pane shows, a table with an
  `asOf` per provider; caller: `src/ui/prefs/preferencesPane.ts`)
- modify `addon/content/preferences.xhtml`, `src/ui/prefs/preferencesPane.ts`, both bundles
- create `test/unit/llm/policyNotes.test.ts`

**Do.**
1. Fetch each provider's policy page cited in §3.3 (no key; reading only); compare each quoted claim;
   record the date and any change.
2. A page that cannot be fetched keeps its `Unverified` marker, and its claim does not appear in the
   pane.
3. The pane shows each provider's retention line with "verified <date>".
4. The release checklist gets the per-minor-release line (`P7-T24`).

**Do NOT.**
- Do **not** paraphrase a policy into a stronger claim than its page makes (§7's "claims no
  protection it does not provide").

**Done when.**
- [ ] Every claim in the pane has a date and a source; the test checks every row has both.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- policyNotes preferencesPane
```

**Notes.** Needs: nothing earlier. Callers of `policyNotes.ts`: `preferencesPane.ts`.

---

### P7-T18 — Offline verification

| Field | Value |
|---|---|
| **ID** | `P7-T18` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T18.md`. `Do` step 1 is not met: owner question `plan/00` §6 item 393. *Updated 2026-11-17: the owner answered item 393 (393(d)); `P7-T33` builds the message.* |
| **Depends on** | `P7-T12` |
| **Blocks** | `P7-T24`, `P7-T33` |
| **Retires** | none |
| **Implements** | `NFR-9` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** With Zotero offline, the plugin loads, every window opens, existing content is usable, and
every network action fails with NFR-14's clear message rather than a stack trace; a job interrupted by
the network dropping loses no data.

**Read first.**
- `docs/10` NFR-9; `docs/13` §8.7's offline line; `docs/07` §10.5
- `test/unit/integration/liveRequests.test.ts`

**Files.**
- create `test/integration/offline.spec.ts` (sets `Services.io.offline` in the test profile; opens each
  window; starts search, summarize, report, related and audio on fixtures with the network cut mid-job)
- create `plan/reports/P7-T18.md`

**Do.**
1. Each action's message is the `P7-T12` message for a network failure, naming the service.
2. A summarize job cut at its tenth item keeps the nine summaries and resumes (FR-23).
3. Existing notes, reports and audio attachments open.

**Do NOT.**
- Do **not** stub the HTTP client to simulate offline; use Zotero's offline switch, so the real path
  is exercised.

**Done when.**
- [ ] The spec passes three times in a row; the report lists each action's message.

**Verify with.**
```bash
npm run test:integration -- offline
```

**Notes.** Needs: Phases 2–6 built. Callers: none.

---

### P7-T19 — README and CHANGELOG

| Field | Value |
|---|---|
| **ID** | `P7-T19` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T19.md`. |
| **Depends on** | `P7-T11`, `P7-T13`, `P7-T17` |
| **Blocks** | `P7-T20`, `P7-T23`, `P7-T26` |
| **Retires** | none |
| **Implements** | `docs/13` §7.3 items 1–10 |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** `README.md` has the ten sections `docs/13` §7.3 requires, written for a user, and
`CHANGELOG.md` exists in Keep-a-Changelog form with a Compatibility line.

**Read first.**
- `docs/13` §7.1–§7.3 (with the note of 2026-11-16); `docs/09` §1.8, §3; `docs/10` NFR-5
- §0.4 lines 1, 7, 8 and 21; `docs/spikes/phase-7-profiling.md` if it exists
- the current `README.md`

**Files.**
- modify `README.md` (rewritten)
- create `CHANGELOG.md`
- create `docs/images/.gitkeep` (screenshots land here in `P7-T27`)

**Do.**
1. The ten sections. Compatibility: plugin 1.0 ↔ Zotero 10.0.x ↔ Windows tested, macOS and Linux
   untested (§0.4 line 1). Privacy: each service and what it receives, keys in the OS keystore, the
   residual risk, the session-only Linux fallback (line 7), how to remove all content (`P7-T11`).
   Cost: NFR-5's reference workload, full text by default (D7), the ceilings as shipped (line 8).
   Known limitations: no paywalled PDFs, English and Korean only, no scheduled jobs, extraction is
   best-effort (line 21: *DECIDED 2026-11-16 (owner, `plan/00` §6 item 381)* — v1.0 has no
   PDF-extraction-quality validation at scale; the held-out IMRaD measurement of `plan/00` §6 items
   375–377 is the record, and this section says so, citing its figure from `docs/06` §4.3). Troubleshooting: verbose logging and diagnostics (`P7-T13`).
2. Every figure cites a measured source or is omitted; screenshots are placeholders named for
   `P7-T27`.
3. `CHANGELOG.md`: an Unreleased section listing the features, and Compatibility.

**Do NOT.**
- Do **not** state a cost figure that is not measured (`docs/13` §8.4's cost line) — write "measured
  in the release checklist" and link it.
- Do **not** state an update-check interval (`docs/13` §6.4).

**Done when.**
- [ ] A reviewer can tick each of §7.3's ten items against a README heading.

**Verify with.** `grep -n "^## " README.md` against `docs/13` §7.3.

**Notes.** Needs: nothing earlier. Callers: none.

---

### P7-T20 — `README.ko.md`

| Field | Value |
|---|---|
| **ID** | `P7-T20` |
| **State** | `TODO` — built 2026-11-18 as a draft; approved by the owner as written the same day (`G-41`, `plan/00` §6 item 401(c)), so the draft banner is gone; awaiting the owner's `DONE` (only the owner sets it). Reports at `plan/reports/P7-T20.md` and `plan/reports/P7-batchF.md`. |
| **Depends on** | `P7-T19` |
| **Blocks** | `P7-T05`, `P7-T26` |
| **Retires** | none |
| **Implements** | `docs/13` §7.3's Korean README |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A Korean README with the same sections and facts as `README.md`, ready for `P7-T05`'s review.

**Read first.**
- `README.md` (`P7-T19`); the `ko-KR` bundle's terms, so the README names controls as the UI does

**Files.**
- create `README.ko.md`
- modify `README.md` (a link to it at the top)

**Do.**
1. Write each section in Korean; control names exactly as the `ko-KR` bundle has them.
2. List in the report any term with no settled Korean equivalent, for the owner.

**Do NOT.**
- Do **not** add a claim the English README does not make.

**Done when.**
- [ ] Every `README.md` heading has a Korean counterpart in the same order.

**Verify with.** `grep -c "^## " README.md README.ko.md` gives equal counts.

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(c)): "모두 승인".** `README.ko.md` is approved as written. The
> draft comment and the visible draft line were removed and replaced by a one-line provenance comment; every other
> byte is the draft's. `grep -c "^## "` gave 11 and 11 afterwards.

**Notes.** Needs: nothing earlier. Callers: none.

---

### P7-T21 — Release workflow hardening

| Field | Value |
|---|---|
| **ID** | `P7-T21` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T21.md`. |
| **Depends on** | none |
| **Blocks** | `P7-T16`, `P7-T26` |
| **Retires** | none |
| **Implements** | `NFR-17`, `NFR-19`, `docs/13` §5.2, §6.2, §6.3 |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `release.yml` builds from a tag with `npm ci`, runs the unit tests, the l10n check and
`npm audit`, pins every action to a commit, writes an `update.json` whose hash is generated in CI, and
has the narrowest permissions; runtime dependencies are pinned exactly.

**Read first.**
- `docs/13` §5.2, §6.2, §6.3 (the `sha512:` correction); `docs/09` §6.3, §7's supply-chain lines
- `.github/workflows/release.yml`, `ci.yml`; `addon/manifest.json`; `zotero-plugin.config.ts`;
  `package.json`

**Files.**
- modify `.github/workflows/release.yml`, `.github/workflows/ci.yml` (actions pinned by commit; an
  `npm audit --omit=dev --audit-level=high` step)
- modify `package.json`, `package-lock.json` (`zotero-plugin-toolkit` pinned to the exact version the
  lockfile resolves)
- create `test/unit/scripts/releaseWorkflow.test.ts` (reads the two workflow files as text and checks
  the rules below)

**Do.**
1. Remove `FIXTURE_MODE: replay`; run `npm ci`, the unit tests and `npm run l10n:check` before the
   build; fail if `package.json`'s version, the tag and the built manifest disagree.
2. Pin every `uses:` to a full commit hash with the tag as a comment; `permissions:` at the job
   level, `contents: write` only where the release is created.
3. The update hash: *DECIDED 2026-11-16 (owner, `plan/00` §6 item 381; §0.4 line 19):* the scaffold's
   CI-generated `sha512:` hash meets `docs/09` §7's blocker, so this step keeps it and adds no `sha256:`
   step; it checks only that the hash is generated in the workflow, never transcribed.
4. `strict_max_version` stays `10.0.*` unless the tested series changes (§6.2).
5. The test asserts: no `uses:` without a 40-hex commit, no `FIXTURE_MODE`, an audit step, `npm ci`.

**Do NOT.**
- Do **not** push a tag, run the workflow, or push to `release` (`G-35`).

**Done when.**
- [ ] The workflow test passes; `npm run build` passes with the exact pin.

**Verify with.**
```bash
npm ci && npm run test:unit -- releaseWorkflow && npm run build
```

**Notes.** Needs: `P0-T27`. Callers: GitHub on a pushed tag (the owner's, `P7-T26`, `P7-T30`).

---

### P7-T22 — `compat.yml`: the scheduled Zotero-beta job

| Field | Value |
|---|---|
| **ID** | `P7-T22` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T22.md`. |
| **Depends on** | none |
| **Blocks** | `P7-T24` |
| **Retires** | moves `R-1` to ongoing handling |
| **Implements** | `NFR-17`, `docs/13` §5.3 |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A weekly scheduled workflow runs the integration tests against the current Zotero beta and
opens an issue when they fail, so a Zotero change is seen before users see it.

**Read first.**
- `docs/13` §5.3 (and its `ZOTERO_CHANNEL` marker), §6.2; `docs/11` R-1
- the integration job in `.github/workflows/ci.yml`

**Files.**
- create `.github/workflows/compat.yml`
- modify `test/unit/scripts/releaseWorkflow.test.ts` (the same pinning rules for this file)

**Do.**
1. Copy the integration job; select the beta build by downloading it explicitly by URL from Zotero's
   published beta channel, since `ZOTERO_CHANNEL` is untested; record which in the file's header.
2. On failure, open or update one issue with the run link (`issues: write` only).
3. No key and no secret is used.

**Do NOT.**
- Do **not** add the `live-contract` job (§0.4 line 18).

**Done when.**
- [ ] The workflow test passes; the coordinator's first push of the file and its first scheduled run
      are recorded in the checklist (green, or the issue triaged).

**Verify with.**
```bash
npm run test:unit -- releaseWorkflow
```

**Notes.** Needs: `P0-T14`. Callers: GitHub's scheduler.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 390(e)): advance warning only.** A failure of the weekly run is
> notice for the next `strict_max_version`, not a release blocker; `compat.yml`'s header and issue body, `docs/13`
> §5.3, §6.2 and §8.9 say so.

---

### P7-T23 — Forum announcement and community-list drafts

| Field | Value |
|---|---|
| **ID** | `P7-T23` |
| **State** | `TODO` — drafts built 2026-11-18, awaiting the owner's review (only the owner sets `DONE`; the owner posts under `G-36`). Report at `plan/reports/P7-T23.md`. |
| **Depends on** | `P7-T19` |
| **Blocks** | `P7-T31` |
| **Retires** | none |
| **Implements** | `docs/13` §7.2 items 2–3 |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The texts the owner posts and submits are drafted: the Zotero Forums announcement covering
every point `docs/13` §7.2 item 2 lists, and an entry for each community list in its current format.

**Read first.**
- `docs/13` §7.2 (and its `Unverified` note on the lists); `docs/10` §5 Q20 (note of 2026-11-16)
- `README.md`

**Files.**
- create `docs/release/announcement-v1.0.md` (the forum post; the list entries; the date each list's
  process was checked)

**Do.**
1. The post: what it does, Zotero compatibility (Windows tested; macOS and Linux untested), fully
   client-side, user-supplied keys and where they are stored, what data goes where, the licence, the
   repository link.
2. For each list, read its current submission instructions and draft the entry in that format; if a
   list is unmaintained, say so.

**Do NOT.**
- Do **not** post, open a pull request, or create any account (`G-36`).

**Done when.**
- [ ] The post covers each §7.2 item 2 point, ticked in the file.

**Verify with.** Review against `docs/13` §7.2 item 2.

**Notes.** Needs: nothing earlier. Callers: none.

---

### P7-T24 — The release checklist document

| Field | Value |
|---|---|
| **ID** | `P7-T24` |
| **State** | `TODO` — built 2026-11-18, awaiting the owner's review (only the owner sets `DONE`; `P7-T25` fills it, `G-37` signs it). Report at `plan/reports/P7-T24.md`. |
| **Depends on** | `P7-T02`, `P7-T15`, `P7-T16`, `P7-T17`, `P7-T18`, `P7-T22`, `P7-T34`, `P7-T35`, `P7-T36`, `P7-T37`, `P7-T39`, `P7-T40` |
| **Blocks** | `P7-T26` |
| **Retires** | none |
| **Implements** | `docs/11` §1 Phase 7 DoD line 1 |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `docs/release/v1.0-checklist.md` lists every NFR, every `docs/13` §8 line, every `docs/09` §7
line and the phase sign-offs, each with its measured result and source, an explicit waiver with its
reason and decision, or "to be run in `P7-T25`".

> **DECIDED 2026-11-16 (owner, `plan/00` §6 item 380, decision 1):** v1.0 is checked on Windows; macOS
> and Linux are recorded as waived, with the reason, here; the Linux keyring-less check `P3-T37` and
> VoiceOver likewise.

**Read first.**
- `docs/10` §3; `docs/13` §8 (with the notes of 2026-11-16); `docs/09` §7
- the reports and spike files of `P7-T14`–`P7-T18`, `phase-7-profiling.md`,
  `phase-7-security-review.md`, `phase-7-accessibility.md`

**Files.**
- create `docs/release/v1.0-checklist.md`

**Do.**
1. One row per NFR-1…NFR-20: result, measured on, by which card or run, or a waiver. NFR-17: Windows
   measured; macOS and Linux waived under §0.4 line 1.
2. One row per `docs/13` §8 line, in its order; mark those `P7-T25` runs.
3. The §8.9 lines: version agreement, the update hash (§0.4 line 19: a CI-generated `sha512:` hash
   meets it), fixtures' age (read the recording dates; the 180-day rule applies), `live-contract`
   (*DECIDED 2026-11-16 (owner, `plan/00` §6 item 381; §0.4 line 18)*: **waived for v1.0**, with the
   reason "no secret-holding job exists; the job is a later-release candidate", as `docs/13` §8.9's note
   of that day says), the forum draft (`P7-T23`), NCBI (`P7-T28`).
4. The phase sign-offs as they stand: `P3-T31`, `P4-T25`, `P5-T30`, `P6-T19`; and the waived
   `P3-T37`.
5. The per-minor-release policy re-verification line (§0.4 line 9).
6. *Added 2026-11-17 (owner, `plan/00` §6 item 395(e)).* A line the owner runs in `P7-T25`: one summarize
   job with a real key at debug level, then the saved debug output searched for the key and its first eight
   characters; the result is recorded, never the key.
7. *Added 2026-11-17 (owner, `plan/00` §6 item 395(h)).* A line checking that `SECURITY.md`'s contact
   placeholder is gone, filled by the owner before `P7-T26`, and that the 7-day and 30-day response times
   are as decided.

**Do NOT.**
- Do **not** write a result that no card or run produced.

**Done when.**
- [ ] Every NFR and every §8 line has a row; no row is blank.

**Verify with.** `grep -c "NFR-" docs/release/v1.0-checklist.md` is at least 20.

**Notes.** Needs: `P3-T31`, `P4-T25`, `P5-T30`, `P6-T19` for their rows (recorded as they stand).

> **Added 2026-11-17 (`plan/00` §6 items 390(e), 392).** `docs/13` §8.9 gained a line recording the latest weekly
> `zotero-beta` run, which is advance warning and not a blocker (owner); carry it as a recorded line, never as a gate.
> `P7-T17`'s per-minor-release policy line and `P7-T18`'s offline result go in too (their reports).
Callers: none.

---

### P7-T25 — Windows manual QA run on the release candidate

| Field | Value |
|---|---|
| **ID** | `P7-T25` |
| **State** | `TODO` |
| **Depends on** | `P7-T26` |
| **Blocks** | `P7-T29` |
| **Retires** | none |
| **Implements** | `docs/13` §8.1–§8.9 on Windows |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — gates `G-34` (the Windows machine, a fresh profile and data directory, and the library copy), `G-18` (keys entered in the pane), `G-45` (the owner approves each paid run before it runs: the §8.4 reference workload of 100 abstracts and one report, expected ≤ US$1.00 by NFR-5, and one short English and one Korean audio briefing, expected under US$0.25 at `docs/04` §4.2's prices, plus their script calls priced by the dialog), and `G-24`/`G-30`-style judgements where §8.5 and §8.6 ask for a domain reader or a native speaker. |

**Goal.** Every `docs/13` §8 line the checklist marks for this run has a recorded result on the
v0.9.0 build on Windows.

**Read first.**
- `docs/release/v1.0-checklist.md` (`P7-T24`); `docs/13` §8; `plan/06` `G-34`, `G-45`

**Files.**
- modify `docs/release/v1.0-checklist.md` (the results)

**Do.**
1. Give the owner the run order (install, lifecycle, search, related, LLM, report, audio,
   preferences, resources, hygiene) and the expected spend; **stop for `G-45`** before the first paid
   step and before each later one.
2. Record each result as the owner reports it, with the figure where the line asks for one.
3. A failed line is a finding; a fix is a rule-9 card, and the run repeats the lines it touches on a
   new candidate.

**Do NOT.**
- Do **not** run on the owner's real library (`G-38`), or reuse one spend approval.

**Done when.**
- [ ] Every row marked for this run has a result.

**Verify with.** The owner's run; then the checklist has no row marked "to be run in `P7-T25`".

**Notes.** Needs: Phases 1–6 `DONE`. Callers: none.

---

### P7-T26 — Publish the release candidate v0.9.0

| Field | Value |
|---|---|
| **ID** | `P7-T26` |
| **State** | `TODO` |
| **Depends on** | `P7-T05`, `P7-T16`, `P7-T19`, `P7-T20`, `P7-T21`, `P7-T24`, `P7-T38` |
| **Blocks** | `P7-T07`, `P7-T25`, `P7-T27` |
| **Retires** | none |
| **Implements** | `docs/11` §1 Phase 7 DoD line 3 (the starting version) |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-35`: the owner creates the `v0.9.0` tag, lets `release.yml` build it, publishes the GitHub Release (marked pre-release) and confirms `update.json` on the `release` branch advertises 0.9.0 with a correct link and hash. |

**Goal.** A published v0.9.0 build exists for the QA run, the screen-reader test and the walkthrough,
and is the version v1.0.0 upgrades from.

> **DECIDED 2026-11-16 (coordinator, under item 313):** §0.4 line 14.

**Read first.**
- `plan/06` `G-35` (note of 2026-11-16); `docs/13` §5.2, §6.3, §7.1

**Files.**
- modify `package.json` (`version` `0.9.0`), `CHANGELOG.md` (the 0.9.0 entry)
- modify `docs/release/v1.0-checklist.md` (the release link, the hash, the date)

**Do.**
1. Set the version and the CHANGELOG entry; run the full local check; report the commit to tag;
   **stop for the owner**.
2. After the owner publishes: download the XPI from the Release, compare its SHA-256 with
   `SHA256SUMS.txt`, read `update.json` from the `release` branch, record both.

**Do NOT.**
- Do **not** create the tag or publish (`G-35`; §0.2 item 26).

**Done when.**
- [ ] The checklist records the v0.9.0 Release, its checksum match and `update.json`'s entry.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run l10n:check && npm run build
```

**Notes.** Needs: Phases 1–6 `DONE`. Callers: none.

---

### P7-T27 — Fresh-profile README walkthrough and screenshots

| Field | Value |
|---|---|
| **ID** | `P7-T27` |
| **State** | `TODO` |
| **Depends on** | `P7-T26` |
| **Blocks** | `P7-T29` |
| **Retires** | none |
| **Implements** | `docs/11` §1 Phase 7 DoD line 2 |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — gates `G-18` (a key entered on the fresh profile), `G-06` (Google's free-tier terms acknowledged for the Gemini key used), `G-45` (each paid step approved: a search of a few results, a summary of about ten abstracts, one report and one short audio briefing, expected under US$0.50 in all, priced by the dialogs). |

**Goal.** On a fresh Zotero 10 profile, the owner installs v0.9.0 and completes search → summarize →
report → audio using only the README; every place the README did not suffice is recorded and fixed;
the README's screenshots are taken on the way.

**Read first.**
- `README.md`; `docs/11` §1 Phase 7 DoD

**Files.**
- create `docs/images/*.png` (the screenshots `P7-T19` named)
- modify `README.md`, `README.ko.md` (embed the screenshots; fix what the walkthrough found)
- modify `docs/release/v1.0-checklist.md` (the walkthrough's result)

**Do.**
1. Give the owner the four steps and the screenshot list; **stop for the owner**; stop again for
   `G-45` before each paid step.
2. Record each place the owner left the README; fix the README text; the Korean README gets the same
   fix for `G-41`.

**Do NOT.**
- Do **not** coach the owner beyond the README during the run; the gap is the finding.

**Done when.**
- [ ] The checklist's DoD line 2 row has the result, and every gap found has a README fix.

**Verify with.** The owner's run; `ls docs/images`.

**Notes.** Needs: Phases 1–6 `DONE`. Callers: none.

---

### P7-T28 — NCBI registration on file

| Field | Value |
|---|---|
| **ID** | `P7-T28` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P7-T29` |
| **Retires** | none |
| **Implements** | `docs/13` §8.9's NCBI line; `docs/09` §5.1 |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-04`: the owner confirms that the `tool=research_helper` / maintainer-address pair is registered with NCBI, and how the confirmation was received. |

**Goal.** The release checklist records that the NCBI registration is on file, with its date.

**Read first.**
- `plan/06` `G-04` (notes of 2026-10-08 and 2026-11-16); `docs/09` §5.1

**Files.**
- modify `docs/release/v1.0-checklist.md` (or, before it exists, `plan/reports/P7-T28.md`)
- modify `plan/06-human-gates.md` (`G-04`: a dated status note)

**Do.**
1. Read `TOOL_NAME` and `MAINTAINER_EMAIL` from `src/core/http/userAgent.ts` and give them to the
   owner; **stop for the owner**.
2. Record the owner's answer verbatim and the date.

**Do NOT.**
- Do **not** contact NCBI or submit anything.

**Done when.**
- [ ] The NCBI row records the confirmation, or the release stops (no degraded path, `G-04`).

**Verify with.** `grep -n "NCBI" docs/release/v1.0-checklist.md`.

**Notes.** Needs: nothing earlier. Callers: none.

---

### P7-T29 — Release checklist sign-off

| Field | Value |
|---|---|
| **ID** | `P7-T29` |
| **State** | `TODO` |
| **Depends on** | `P7-T07`, `P7-T25`, `P7-T27`, `P7-T28` |
| **Blocks** | `P7-T30` |
| **Retires** | none |
| **Implements** | `docs/11` §1 Phase 7 DoD line 1 |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-37`: the owner walks the checklist, signs it, and explicitly accepts each waiver with its reason, including macOS, Linux, VoiceOver and `P3-T37`; and confirms every `docs/09` §7 `[BLOCKER]` is resolved. |

**Goal.** The checklist is signed: every row has a result or an accepted waiver, and no `[BLOCKER]` is
open.

**Read first.**
- `docs/release/v1.0-checklist.md`; `plan/06` `G-37`

**Files.**
- modify `docs/release/v1.0-checklist.md` (the sign-off block: name, date, the waivers accepted)

**Do.**
1. List the rows without a result and every waiver; **stop for the owner**.
2. Record the sign-off verbatim.

**Do NOT.**
- Do **not** sign, or accept a waiver, for the owner.

**Done when.**
- [ ] The sign-off block exists and names every waiver.

**Verify with.** Review of the checklist.

**Notes.** Needs: `P3-T31`, `P4-T25`, `P5-T30`, `P6-T19` (their rows). Callers: none.

---

### P7-T30 — Publish v1.0.0 and verify the upgrade from v0.9.0

| Field | Value |
|---|---|
| **ID** | `P7-T30` |
| **State** | `TODO` |
| **Depends on** | `P7-T29` |
| **Blocks** | `P7-T31` |
| **Retires** | confirms `R-15` on a real release |
| **Implements** | `docs/11` §1 Phase 7 DoD line 3 |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — gate `G-35`: the owner tags `v1.0.0`, publishes the Release, and on a profile with v0.9.0 installed lets Zotero update it through `update.json`, confirming the version and that settings and keys survived. |

**Goal.** v1.0.0 is published, and an in-place update from v0.9.0 to v1.0.0 through `update.json` is
recorded as succeeding.

**Read first.**
- `plan/06` `G-35`; `docs/13` §6.3, §6.4, §8.1's update line, §8.9

**Files.**
- modify `package.json` (`version` `1.0.0`), `CHANGELOG.md` (the 1.0.0 entry with Compatibility)
- modify `docs/release/v1.0-checklist.md` (the upgrade addendum, after the signed block; §0.4 line 14)

**Do.**
1. Set the version and CHANGELOG; run the full local check; report the commit; **stop for the
   owner**.
2. After publishing: check the Release's checksum and `update.json` as `P7-T26` did; record the
   owner's upgrade result (the version shown, settings kept, keys kept) and how the update was
   triggered (the manual "Check for updates", since the interval is not stated, `docs/13` §6.4).

**Do NOT.**
- Do **not** tag, publish or push (`G-35`).

**Done when.**
- [ ] The addendum records the v0.9.0 → v1.0.0 upgrade result.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run l10n:check && npm run build
```

**Notes.** Needs: nothing beyond `P7-T29`. Callers: none.

---

### P7-T31 — Forum post and community-list submissions

| Field | Value |
|---|---|
| **ID** | `P7-T31` |
| **State** | `TODO` |
| **Depends on** | `P7-T23`, `P7-T30` |
| **Blocks** | none |
| **Retires** | `R-20`'s mitigation |
| **Implements** | `docs/13` §7.2 items 2–3; `docs/10` §5 Q20 |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-36`: the owner posts the announcement on the Zotero Forums and submits the entries to the community lists, under their own identity. |

**Goal.** v1.0 is announced and submitted, and the links are recorded.

> **DECIDED 2026-11-16 (owner, `plan/00` §6 item 380, decision 4):** list at v1.0; posting and
> submitting are the owner's.

**Read first.**
- `docs/release/announcement-v1.0.md` (`P7-T23`); `plan/06` `G-36`

**Files.**
- modify `docs/release/announcement-v1.0.md` (the post's link, each submission's link and state)

**Do.**
1. Re-check each list's submission process on the day (`docs/13` §7.2's note) and update the drafts;
   **stop for the owner**.
2. Record the links the owner gives.

**Do NOT.**
- Do **not** post or submit (§0.2 item 26).

**Done when.**
- [ ] The file records the forum post and each submission, or why a list was skipped.

**Verify with.** Review of the file.

**Notes.** Needs: nothing earlier. Callers: none.

---

### P7-T32 — Gemini in balanced mode: warn and confirm, not refuse

| Field | Value |
|---|---|
| **ID** | `P7-T32` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T32.md`. |
| **Depends on** | none |
| **Blocks** | `P7-T16` |
| **Retires** | none |
| **Implements** | part of `NFR-16` (`docs/09` §3.5's Gemini row) |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** In balanced mode a Gemini chat, summary or report call with a free or unknown key is warned
and proceeds only after the user confirms, as an audio job already is; strict mode still refuses it;
the rule lives in `assertModelAllowed` alone.

> **DECIDED 2026-11-16 (owner, `plan/00` §6 item 381; §0.4 line 20):** Gemini chat, summary and report
> calls in balanced mode follow the audio rule of item 379(d). A free or unknown key → the free-tier
> warning, and the call proceeds only after the user confirms; only strict mode refuses. Recorded in
> `docs/09` §3.5 (note "Decided 2026-11-16 … balanced mode and Gemini chat").

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §3.5's table, its Gemini row and the notes of 2026-10-22
  and 2026-11-16; §3.6 item 3 (the warning is never suppressible)
- `docs/07-architecture-and-data-model.md` §4.5, the note "a Gemini key the user declares paid"
- `src/pipeline/shared/privacyPolicy.ts` (`assertModelAllowed`, `ModelPolicyCheck`, `modelRouteFor`) and
  each caller by name: `summarizeItem` (`src/pipeline/summarize/summarizeItem.ts`), the relevance screen
  (`src/pipeline/shared/relevanceScreen.ts`), `critiqueReport` (`src/pipeline/trendReport/critique.ts`),
  the report model check in `src/pipeline/trendReport/trendReportPipeline.ts`, and
  `src/pipeline/recommend/profileCall.ts` — verify the list yourself with
  `grep -rn "assertModelAllowed(" src`; I believe it is these five

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§4.5's note: the balanced Gemini case; dated note)
- modify `src/pipeline/shared/privacyPolicy.ts` (`assertModelAllowed`; callers: the five above, which
  already handle `requiresConfirmation` for full mode — no caller is expected to change)
- modify `test/unit/pipeline/privacyPolicy.test.ts` (the table, row by row, with and without a route)
- modify the callers' unit tests only where a balanced free-Gemini case now reaches the confirmation
  path instead of `PolicyViolationError` (guess: `summarizeItem.test.ts`, `trendCritique.test.ts`,
  `relevanceScreen.test.ts`; grep them for `geminiPaidTier` first)

**Do.**
1. Documents first: `docs/07` §4.5's note gets a dated line saying balanced mode now treats a free or
   unknown Gemini key as full mode does (warning `may-train-on-input`, `requiresConfirmation: true`).
2. In `assertModelAllowed`, a model reached through Gemini (`route.providerId === "gemini"`) whose key
   is not declared paid is refused in **strict** only; in balanced and full it returns the warning and
   `requiresConfirmation: true`. Every non-Gemini rule of the table is unchanged: a non-Gemini model
   that may train on input is still refused in balanced mode. Without a `route` nothing loosens.
3. Check each caller: where a confirmation is asked (the item pane's Generate, the report run's
   `prepare`), the free-tier warning is shown (`L10N_EGRESS_GEMINI_FREE_TIER`); where none can be asked
   (relevance screening during a search), the call is still not made, as today.

**Do NOT.**
- Do **not** add a second rule site; the audio job's `assertAudioAllowed` (`plan/09` `P6-T15`) and this
  rule must agree, and if `P6-T15` has landed, make it call this one or test both against one table.
- Do **not** suppress the free-tier warning after a confirmation (`docs/09` §3.6 item 3).

**Done when.**
- [ ] The unit table covers strict, balanced and full × Gemini free, unknown and declared paid × with
      and without a route, and a non-Gemini `"yes"` model in balanced mode is still refused.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` exit 0.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- privacyPolicy summarizeItem trendCritique relevanceScreen
```

**Notes.** Added 2026-11-16 (`plan/00` §6 item 381) for §0.4 line 20. Priced 0.75 d: one rule, a
table test, and five callers to check, of which none is expected to change because full mode already
needed the confirmation path. Callers of what it changes: the five above; constructed in
`src/bootstrap/container.ts` with the rest of the privacy policy. It blocks `P7-T16` so that the
security review walks §7's "warned elsewhere" line against the final rule.

---

### P7-T33 — Offline message in report, related and summarize windows

| Field | Value |
|---|---|
| **ID** | `P7-T33` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T33.md`. |
| **Depends on** | `P7-T12`, `P7-T18` |
| **Blocks** | `P7-T03` |
| **Retires** | none |
| **Implements** | part of `NFR-9` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** When a run fails because Zotero is offline, the report, related and summarize windows show
`rh-error-offline`, the message the keyword search already shows, with no new string and no stack
trace.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 393):** "세 창에도 같은 안내" — item 393(c)'s draft
> answer. The three windows show the existing `rh-error-offline` message when a run fails offline.
> `docs/07` §10.5's connectivity probe, offline pause, circuit breaker and badge become a
> later-release candidate with no card (dated notes in `docs/07` §10.5, `docs/10` NFR-9 and
> `docs/13` §8.7).

**Read first.**
- `plan/00` §6 item 393; `plan/reports/P7-T18.md`; `docs/07` §10.5 and its notes of 2026-11-17;
  `docs/10` NFR-9
- `failureView` and `drawFailure` in `src/ui/viewModels/relatedViewModel.ts`; `TrendReportStop` in
  `src/ui/viewModels/reportViewModel.ts`; `publishReportWindowCommands` and
  `createSummarizeSession` in `src/bootstrap/registerUI.ts`; `OfflineError` in `src/core/errors.ts`

**Files.**
- modify `src/ui/viewModels/relatedViewModel.ts` (`failedOffline`; `failureView` takes the lists'
  states; caller: `drawFailure` in the same file)
- modify `src/ui/viewModels/reportViewModel.ts` (`stopForFailure`; caller: `finishRun` and
  `runJob`'s catch in `publishReportWindowCommands`)
- modify `src/ui/dialogs/summarizeDialog.ts` (`SUMMARIZE_OFFLINE_L10N`, `isOfflineFailure`, the
  model's `offline` line; caller: `createSummarizeSession`)
- modify `src/bootstrap/registerUI.ts` (constructs the report window's commands and the summarize
  session), `addon/content/summarize.{xhtml,js}` (the `rh-summarize-offline` line)
- modify `test/unit/ui/relatedViewModel.test.ts`, `test/unit/ui/reportViewModel.test.ts`; create
  `test/unit/ui/summarizeDialog.test.ts`; modify `test/integration/offline.spec.ts`

**Do.**
1. Related: a run that ends `OFFLINE`, or ends `SOURCE` with at least one failed list and every
   failed list `OFFLINE`, draws `rh-error-offline` as the error panel's headline, keeps the code in
   the disclosure and offers Retry.
2. Report: a run that ends `failed` with code `OFFLINE` and no stop of its own gets
   `rh-error-offline` as its stop reason, under the window's own outcome line.
3. Summarize: when a paper or the run fails with code `OFFLINE`, the window shows
   `rh-error-offline` once per run.
4. Only the error's `code` is read, never a message or a `detail` (`plan/00` §6 item 389(f)).
5. Tighten `offline.spec.ts`'s three "a message" assertions to the offline text.

**Do NOT.**
- Do **not** add a string: `rh-error-offline` ships in both bundles.
- Do **not** build the probe, the pause, the breaker or the badge.

**Done when.**
- [ ] Unit tests show each window's offline reading, and that other failures keep their own text.
- [ ] `offline.spec.ts` asserts the offline text in all three windows (three runs).
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- relatedViewModel reportViewModel summarizeDialog && npm run test:integration -- offline
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 393(d)) for the owner's answer. Priced 0.5 d: three
small readings of an existing error code and one existing string, with the integration spec already
written by `P7-T18`. Callers: `drawFailure` (related), `finishRun` and `runJob`'s catch in
`publishReportWindowCommands` (report), `createSummarizeSession` (summarize); constructed in
`src/bootstrap/registerUI.ts`. It blocks `P7-T03` because that sweep edits the same three files.

### P7-T34 — Summary prompts send no tags

| Field | Value |
|---|---|
| **ID** | `P7-T34` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T34.md`. |
| **Depends on** | `P7-T16` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | `docs/09` §3.2 row 3a; `docs/09` §7 "Collection and tag names are not sent by default" |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** No summary request carries the item's Zotero tags unless full mode carries the collection-and-tag-names
opt-in, which no v1.0 setting sets.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 395(a)):** "태그는 안 보냄" — the draft answer. `{{TAGS}}` is "not
> supplied" unless full mode carries the opt-in; no v1.0 UI sets it. The collection name stays in the report and audio
> prompts, recorded in `docs/09` §3.2 row 3b.

**Read first.**
- `docs/spikes/phase-7-security-review.md` (the tags row); `docs/09` §3.2; `docs/12` §4
- `metadataVariables` and `summarizeItem` in `src/pipeline/summarize/summarizeItem.ts`; `allowedInputScope` in
  `src/pipeline/shared/privacyPolicy.ts`

**Files.**
- modify `src/pipeline/summarize/summarizeItem.ts` (`TAGS_NOT_SUPPLIED`; `metadataVariables` takes `sendTags`;
  caller: `summarizeItem` in the same file, which passes `allowedInputScope(...).collectionAndTagNames`)
- modify `test/unit/pipeline/summarizeItem.test.ts`
- modify `docs/12` §4, `docs/09` §3.2 and §7, `README.md` ("What is sent where")

**Do.**
1. `{{TAGS}}` is `not supplied` unless the privacy scope allows collection and tag names; with it, the tags joined
   by `, `, or `none`.
2. Tests in strict, balanced and full without the opt-in, full with it, and an untagged item.
3. Record that the cache key changes, so every summary is made again on its next run.

**Do NOT.**
- Do **not** add a setting for the opt-in.
- Do **not** change the prompt files.

**Done when.**
- [ ] No mode without the opt-in sends a tag; the opt-in sends them.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- summarizeItem
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 398) for the owner's answer to item 395(a). Priced 0.5 d: one
variable, its tests and four documents. Caller: `summarizeItem`; nothing new is constructed (`summarizeItem.ts` is
called by `summarizePipeline.ts`, wired in `src/bootstrap/registerPipelines.ts`).

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 399(a)): "지금대로 둠".** Kept as built: every stored summary is made
> again on its next run, tagged or not, because `{{TAGS}}`'s value changed for an untagged item too (`none` → `not
> supplied`); `docs/12` §4's note of 2026-11-17 carries the dated record.

---

### P7-T35 — Semantic Scholar attribution under the report's references

| Field | Value |
|---|---|
| **ID** | `P7-T35` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T35.md`. |
| **Depends on** | `P7-T16` |
| **Blocks** | `P7-T05`, `P7-T24` |
| **Retires** | none |
| **Implements** | `docs/09` §7 "Semantic Scholar: … attribution present in … generated reports" |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** When any cited record came from Semantic Scholar, the report prints one line under its numbered
references: "Some records: Semantic Scholar, Allen Institute for AI."

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 395(c)):** adopt the draft: the line, a new string, a Korean draft
> and tests.

**Read first.**
- `docs/09` §7's Semantic Scholar line; `docs/02` §6.2 (`rh-sources`, `rh-s2-corpus-id`)
- `formatBibliography` in `src/zotero/bibliography.ts`; `bibliographyBody` in `scaffold.ts`, `bibliographyBlock`
  in `exportMarkdown.ts`, `bibliographyHtml` in `noteHtml.ts`; `reportLabels.ts`

**Files.**
- modify `src/model/trend.ts` (`BibliographyEntry.semanticScholar`), `src/zotero/bibliography.ts`
  (`recordFromSemanticScholar`; caller: `formatBibliography`)
- modify `src/pipeline/trendReport/exportMarkdown.ts` (`DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION`,
  `needsSemanticScholarAttribution`), `scaffold.ts`, `noteHtml.ts`, `reportLabels.ts`
  (`semanticScholarAttribution`, on `KO_REPORT_LABELS_PENDING_REVIEW`)
- modify the callers that pass report labels: `trendReportPipeline.ts` (`renderReportNote`) and
  `src/bootstrap/registerUI.ts` (`labelsOf`)
- create `test/unit/zotero/bibliographySource.test.ts`; modify `trendExport.test.ts`, `trendNoteHtml.test.ts`,
  `trendScaffold.test.ts`, `test/integration/zotero/bibliography.spec.ts`, `test/integration/l10n.spec.ts`
- modify `docs/07` (`BibliographyEntry`), `docs/09` §7

**Do.**
1. Mark an entry whose item's `extra` names `semanticscholar` on `rh-sources` or carries `rh-s2-corpus-id`.
2. Print the line under the numbered entries, before the retracted list, in the scaffold, the export and the note.
3. The Korean is a commented draft; the key waits on `KO_REPORT_LABELS_PENDING_REVIEW` until `G-41`.

**Do NOT.**
- Do **not** count a retracted entry: the report does not cite it.

**Done when.**
- [ ] The three renderers print the line exactly when a numbered entry is marked, and the integration spec marks
      entries Zotero formats.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- bibliographySource trendExport trendNoteHtml trendScaffold
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 398) for the owner's answer to item 395(c). Priced 0.5 d. It blocks
`P7-T05`, which reviews the line's Korean. Callers: `formatBibliography` (through `zoteroBibliographyPort`, a
constant passed in by `trendReportPipeline.ts`), `renderReportNote` and `labelsOf`; constructed in
`src/bootstrap/registerUI.ts` and `src/bootstrap/registerPipelines.ts`.

---

### P7-T36 — Teardown error line through `redact`

| Field | Value |
|---|---|
| **ID** | `P7-T36` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T36.md`. |
| **Depends on** | `P7-T16` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | `docs/09` §7 "Logger redaction runs unconditionally on every message" |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The add-on's teardown reporter writes its line through `redact`, so a key-shaped value in a thrown
teardown error never reaches `Zotero.debug`.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 395(d)):** adopt the draft.

**Read first.** `onError` in `src/addon.ts`; `redact` in `src/core/errors.ts`; `docs/09` §2.1.

**Files.**
- modify `src/core/errors.ts` (`teardownErrorLine`; caller: `onError` in `src/addon.ts`)
- modify `src/addon.ts`; modify `test/unit/core/errors.test.ts`

**Do.**
1. `teardownErrorLine(addonName, message, error)` builds the line and passes all of it through `redact`.
2. A unit test plants a key-shaped synthetic value, built at run time, in a thrown teardown error's message and
   stack; a source-reading test pins `onError` to the helper.

**Done when.**
- [ ] The planted value is absent from the line.
- [ ] Mutation sweep per `plan/08` §0.2 item 24.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- errors
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 398) for the owner's answer to item 395(d). The unit test reads
`src/addon.ts` rather than importing it, because importing it builds the add-on (coordinator, under item 313).
Caller: `onError`, handed to `createScope` in the `Addon` constructor; constructed in `src/index.ts`.

---

### P7-T37 — Redaction audit reads the plugin database

| Field | Value |
|---|---|
| **ID** | `P7-T37` |
| **State** | `TODO` — built 2026-11-17, awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T37.md`. |
| **Depends on** | `P7-T16` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | part of `NFR-16` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** After the audit's three jobs, every text cell of every table of the plugin's own database is searched for
the 30 planted values, and none is found.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 395(f)):** adopt the draft.

**Read first.** `test/integration/redactionAudit.spec.ts`; `pluginDatabaseHasData` in
`src/bootstrap/registerUI.ts` (the `sqlite_master` pattern); `src/bootstrap/migrations.ts`.

**Files.**
- modify `test/integration/redactionAudit.spec.ts` (`searchPluginDatabase`; caller: the spec's one test)

**Do.**
1. List the tables from `sqlite_master`, the columns from `table_info`; search every text cell in the spec and
   every blob cell in SQL; log the counts, never a cell.
2. A control search for a summarized item's key must find it, so a search that reads nothing fails.

**Done when.**
- [ ] Three consecutive clean integration runs find none of the values and the control's key.

**Verify with.**
```bash
npm run test:integration -- --exit-on-finish
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 398) for the owner's answer to item 395(f). Test code only: no
production caller and nothing constructed.

---

### P7-T38 — `npm audit fix` as its own reviewed change

| Field | Value |
|---|---|
| **ID** | `P7-T38` |
| **State** | `TODO` — attempted 2026-11-18: `npm audit fix` stopped with an internal npm error and changed nothing; owner question `plan/00` §6 item 401(d). Report at `plan/reports/P7-T38.md`. *2026-11-18, batch F:* run once with npm 11.21.3 (item 401(d)'s answer). It changed `package-lock.json`, but the remaining `picomatch` advisory can be fixed only by a breaking change, so the package files were restored to HEAD and nothing is to commit; owner question `plan/00` §6 item 403(d). *2026-11-18, batch G:* the owner accepted the development-only advisories for v1.0 (item 403(d)); the closure is recorded, awaiting the owner's review. |
| **Depends on** | `P7-T16` |
| **Blocks** | `P7-T26` |
| **Retires** | none |
| **Implements** | `docs/09` §7 "`npm audit` runs in CI; new high-severity advisories block release" |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The development tree's advisories that `npm audit fix` resolves without `--force` are fixed in one
reviewed change before the release candidate, with every check and three integration runs passing on it.

> **DECIDED 2026-11-17 (owner, `plan/00` §6 item 395(g)):** adopt; its own reviewed change before `P7-T26`.

**Read first.** `docs/spikes/phase-7-security-review.md` (the dependency audit); `package.json`,
`package-lock.json`; `.github/workflows/ci.yml`'s audit step.

**Files.**
- modify `package-lock.json` (and `package.json` only if `npm audit fix` changes it)

**Do.**
1. Record `npm audit` and `npm audit --omit=dev` before.
2. Run `npm audit fix`, never `--force`; record what it changed and what it could not fix.
3. Run every check, the build (typings hashes before and after) and three integration runs.

**Do NOT.**
- Do **not** pass `--force`, and do **not** raise a major version by hand here.
- Do **not** combine this change with any other.

**Done when.**
- [ ] The before and after audits, the lockfile diff and the checks are in the report.

**Verify with.**
```bash
npm audit && npm run typecheck && npm run lint:check && npm run test && npm run build
```

**Notes.** Added 2026-11-17 (`plan/00` §6 item 398) for the owner's answer to item 395(g). Priced 0.5 d by the
coordinator: the fix is one command, but its check is a full run and three integration runs, and a transitive bump
can break the scaffold. Not built in batch D, as the brief says. No caller and nothing constructed.

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(d)): "새 npm으로 한 번만 실행".** Run once through `npx` with the
> exact npm 11 version that `npm view npm@11 version` gives, never `--force` or `--legacy-peer-deps`, and leave the
> installed npm as it is. If it fails or an advisory needs a breaking upgrade, restore the package files and raise an
> owner question. *Done 2026-11-18 (batch F), with npm 11.21.3 (item 402(h)).* It ran and changed `package-lock.json`.
> Its report then said the `picomatch` advisory needs `--force`, which would install `zotero-plugin-scaffold@0.1.7`, a
> breaking change. So the lockfile was restored, `node_modules` was reinstalled from it offline, and every check and
> three integration runs passed on the restored tree. The before and after audits and the lockfile diff are in
> `plan/reports/P7-T38.md`. Owner question: item 403(d).

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 403(d)): "1.0에서는 허용".** `P7-T38` closes as **"development-only
> advisories accepted for v1.0"**. The release gate stays `npm audit --omit=dev --audit-level=high` at 0 (`ci.yml`,
> `release.yml`). Recorded in `docs/09` §7 (the `npm audit` line), `docs/13` §6's release-workflow note and a new row
> in `docs/release/v1.0-checklist.md` §3 Supply chain. No package file changed. *2026-11-18 (batch G): recorded,
> awaiting the owner's review; only the owner sets `DONE`.*

### P7-T39 — Closed plugin windows are freed

| Field | Value |
|---|---|
| **ID** | `P7-T39` |
| **State** | `TODO` — built 2026-11-18 (batch G), awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T39.md`. *Not finished in the batch:* its recorded integration runs and its integration mutants wait on Zotero starting again in the test profile (`plan/00` §6 item 405(d)); the figures so far come from one development run. |
| **Depends on** | `P7-T15` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | `docs/13` §8.8 "no memory growth after 5 consecutive jobs" (the closed windows' share) |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The cost dialog, the report window and the summarize window are not kept alive by the plugin after
they close, and `docs/13` §8.8's growth after five jobs is measured again.

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 403(a)): "둘 다 고침".** Closed windows are freed: find what holds
> them (listeners, observers, closures, caches, `addon.data` references) and release it when the window goes away;
> measure the growth after five jobs again.

**Read first.** `plan/reports/P7-T15.md` (the growth figures); `docs/13` §8.8; `src/bootstrap/registerUI.ts`
(`summarizeState`, `reportWindowState`, `openSummarizeWindowCommand`, `openReportWindowCommand`,
`createSummarizeSession`, `createReportWindowSession`, `publishSummarizeCommands`,
`publishReportWindowCommands`); `test/integration/workloadMemory.spec.ts`.

**Files.**
- modify `src/bootstrap/registerUI.ts` (the holders above, and `heldCount` on both window commands)
- modify `test/integration/workloadMemory.spec.ts` (the hold and retention checks)

**Do.**
1. Find what keeps a closed window alive, with a heap snapshot's paths and a bare window as the control, and
   record it.
2. Release each plugin hold when the window's session runs `closed()`, keeping what teardown waits for.
3. Check in `workloadMemory.spec.ts` that a closed window leaves the hold as it closes and a reopened one stays
   held; check that each window the reference workload closed is freed wherever a bare window is.
4. Measure the growth after five jobs again, with and without the run's `--jsdebugger`; mutation-test the change.

**Do NOT.**
- Do **not** change `server.devtools` for the recorded runs; that is an owner question.
- Do **not** stop waiting at teardown for a run that a closed report window started.

**Done when.**
- [ ] The holder, the fix, the before and after figures and the mutation counts are in the report.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && \
  NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish
```

**Notes.** Added 2026-11-18 (`plan/00` §6 item 404(a)) for the owner's answer to item 403(a). Priced 1 d by the
owner's answer. The edges are a coordinator decision (item 404(a)): the card needs `P7-T15`'s measurement and
feeds the checklist's §8.8 row.

### P7-T40 — The 500-item full-text job within 400 MB

| Field | Value |
|---|---|
| **ID** | `P7-T40` |
| **State** | `TODO` — built 2026-11-18 (batch G), awaiting the owner's review (only the owner sets `DONE`). Report at `plan/reports/P7-T40.md`. *Not finished in the batch:* its recorded integration runs and its integration mutants wait on Zotero starting again in the test profile (`plan/00` §6 item 405(d)); the figures so far come from one development run. |
| **Depends on** | `P7-T15` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | `NFR-7` (the 500-item full-text job's peak over idle, 400 MB) |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The 500-item full-text summarize job's peak over idle stays within 400 MB (10⁶ bytes) in the test
profile, with margin across the recorded runs, and `workloadMemory.spec.ts` states its budgets in MB.

> **DECIDED 2026-11-18 (owner, plan/00 §6 item 403(e)): "둘 다 고침".** Within 400 MB (MB, not MiB) with margin
> across the recorded runs; the spec's budget labels and comparisons in MB. Find where the memory goes before
> changing anything; do not lower the workload to pass.

**Read first.** `plan/reports/P7-T15.md`; `src/pipeline/summarize/acquire.ts` (`acquireSource`,
`detectBodySections`, `tryTier2`); `src/pipeline/summarize/summarizePipeline.ts` (`prepare`, `execute`);
`test/integration/workloadMemory.spec.ts`.

**Files.**
- modify `src/pipeline/summarize/acquire.ts` (`compactText`, `rebaseSections`; their caller is `acquireSource`)
- modify `test/unit/pipeline/acquire.test.ts`
- modify `test/integration/workloadMemory.spec.ts` (MB budgets; the one-copy check)

**Do.**
1. Find where the job's memory goes, with the memory reporter's string list and a heap snapshot's paths, before
   changing anything; record it.
2. Fix what the finding names in the plugin's code, without lowering the workload.
3. Change the spec's budget labels and comparisons to MB; add a check that an acquired paper holds one compact
   copy; unit-test the helpers; mutation-test the change.
4. Record each recorded run's peak in MB beside the budget.

**Do NOT.**
- Do **not** reduce the 500 items, the text per item, or the work the job does.
- Do **not** assert the budget in the spec: `P7-T15`'s Do step 2 makes a figure over budget a finding.

**Done when.**
- [ ] The finding, the fix, each recorded run's peak in MB and the mutation counts are in the report.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && \
  NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish
```

**Notes.** Added 2026-11-18 (`plan/00` §6 item 404(a)) for the owner's answer to item 403(e). Priced 1 d by the
owner's answer. Edges as `P7-T39`'s, a coordinator decision (item 404(a)).

---

## 3. Estimate reconciliation

Where the 34.75 d sit *(28.50 d when first written; 32.00 since 2026-11-17, item 398; 32.50 since 2026-11-18, item 402(a); 34.75 since 2026-11-18, later, item 404(a))* against `plan/05` §4.1's work areas (now §5.1):

| Work area | Cards | Days |
|---|---|---|
| W7-1 Localization completion | `P7-T02`, `P7-T03`, `P7-T04` | 3.25 |
| W7-2 Korean review by a native speaker | `P7-T05`, `P7-T20` | 1.25 |
| W7-3 Accessibility pass | `P7-T06`, `P7-T07` | 2.25 |
| W7-4 Preferences consolidation | `P7-T08`, `P7-T09`, `P7-T10`, `P7-T11` | 5.5 |
| W7-5 Error-message and redaction audit | `P7-T12`, `P7-T13`, `P7-T14` | 3.5 |
| W7-6 Performance and resource profiling | `P7-T15`, `P7-T39`, `P7-T40` (the last two added 2026-11-18, item 404(a)) | 4.25 |
| W7-7 Security review | `P7-T16`, `P7-T17` | 2.25 |
| W7-8 Documentation | `P7-T19` (and `SECURITY.md` in `P7-T16`, `README.ko.md` in W7-2) | 1.5 |
| W7-9 Release engineering | `P7-T21`, `P7-T22`, `P7-T26`, `P7-T30` | 2.25 |
| W7-10 Manual QA execution | `P7-T18`, `P7-T24`, `P7-T25`, `P7-T27` | 3.5 |
| W7-11 Distribution | `P7-T23`, `P7-T31` | 0.75 |
| Not a work area: documents first, NCBI, the sign-off | `P7-T01`, `P7-T28`, `P7-T29` | 1.25 |
| Not a work area: the owner's answer to §0.4 line 20 (added 2026-11-16, item 381) | `P7-T32` | 0.75 |
| Not a work area: the owner's answer to item 393 (added 2026-11-17, item 393(d)) | `P7-T33` | 0.5 |
| Not a work area: the owner's answers to item 395 (added 2026-11-17, item 398) | `P7-T34`, `P7-T35`, `P7-T36`, `P7-T37`, `P7-T38` | 2.0 |
| | **Total** | **34.75** |

**Where the sum is likely low.** (1) `P7-T03` and `P7-T06`: a sweep is priced on the windows that
exist today; Phases 5 and 6 add windows not yet built, and their findings are counted only as
fixes, not as redesigns. (2) `P7-T25`: a failed QA line produces a rule-9 card and a second
candidate; no card prices a second round. (3) `P7-T05`: if the Korean review finds register-level
problems in the prompts, Phase 4's and Phase 6's Korean DoD runs are due again (`plan/05` §4.4, now
§5.4) and nothing here prices them. (4) No card is priced for a second review of this file, which
Phases 4 and 5 both had.

**Where it may be high.** `P7-T22` and `P7-T21` copy and pin existing workflow text; if the beta build
selects by an environment variable after all, 0.25 d comes back.

**Calendar time is not developer time.** Ten cards are human-gated (5.5 d of developer time
between them); six sit on the critical path, and the owner's turnaround on each adds to the calendar,
not to the 28.50 d.

---

## 4. What is not carded, and why

- **macOS and Linux QA, VoiceOver, the Linux keyring-less check** — owner, item 380, decision 1;
  later release, once machines exist (`G-09`).
- **Prompt overrides** — owner, item 380, decision 3; later-release candidate.
- **The `live-contract` job and a `--verify` mode in `scripts/record-fixtures.ts`** — §0.4 line 18,
  open; recommended deferred.
- **Gemini chat in balanced mode with a free or unknown key** — §0.4 line 20, open; a later card if
  the owner says yes.
- **At-scale validation of PDF extraction (R-19)** — §0.4 line 21, open; recommended not in v1.0.
- **A zip debug bundle and a Help-menu entry** — §0.4 line 12.
- **A paid voice preview in the pane** — §0.4 line 13.
- **Submission to the official Zotero plugin registry** — it does not exist yet (`docs/13` §7.2 item 4);
  watching for it is ongoing, not a card.
- **Re-recording fixtures for the 180-day line** — the recording dates are read by `P7-T24`; a
  re-recording, if due, is the owner's keyed run under the existing recorder cards' procedure.

---

## 5. Outline carried over from `plan/05` §4

Moved verbatim from `plan/05` §4.1–§4.4 on 2026-11-16, when `plan/05` §4 became a pointer here, as
`plan/09` §5 did for Phase 6. The text below is the outline as it stood; §0 and §0.4 record what has
changed since. `plan/05` §5.4, Phase 7's gating list, stays in `plan/05` as the record it was.

### 5.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W7-1 | **Localization completion** | Complete `en-US` and `ko-KR` Fluent bundles, no hard-coded strings, `Intl` formatting, and the CI key-parity check flipped from warn to error (FR-55, NFR-11; R-22's mitigation in `docs/11` §3). |
| W7-2 | **Korean review by a native speaker** | Review of the UI strings *and* the Korean prompts, whose academic register and term-with-English-in-parentheses convention `docs/12` §19 item 4 flags as written by a non-native-reviewed process. |
| W7-3 | **Accessibility pass** | Keyboard navigation, focus order, accessible names, light/dark contrast, and the NVDA/VoiceOver smoke test (NFR-13; `docs/08` §9). |
| W7-4 | **Preferences consolidation** | Defaults review against `docs/07` §8.5, the "Clear cache" action, per-namespace storage accounting and cap enforcement (NFR-8), and the clear/delete coverage `docs/09` §3.7 requires. |
| W7-5 | **Error-message and redaction audit** | Every message against NFR-14, the "Copy diagnostics" action, and the log-redaction audit that proves NFR-16 by grepping a full job's debug output (FR-54; `docs/09` §2, §7). |
| W7-6 | **Performance and resource profiling** | Startup, idle and peak memory, and main-thread task duration against NFR-3, NFR-7, NFR-10, plus the XPI size cap NFR-18 (R-10). |
| W7-7 | **Security review** | The `docs/09` §7 checklist end to end, with its `[BLOCKER]` items treated as release blockers rather than findings. |
| W7-8 | **Documentation** | README with all ten required sections, `README.ko.md`, CHANGELOG and screenshots (`docs/13` §7.3), plus `SECURITY.md` with a contact address and a stated response expectation, which is `docs/09` §6.3's requirement and a line item in `docs/09` §7's supply-chain checklist rather than a `docs/13` §7.3 one. |
| W7-9 | **Release engineering** | The tagged-build release workflow, generated `update.json`/`update-beta.json` with `sha256` hashes, the `strict_min_version`/`strict_max_version` policy, and a proven in-place upgrade (`docs/13` §5.2, §6.2, §6.3; R-15). |
| W7-10 | **Manual QA execution** | `docs/13` §8's full checklist on Windows, macOS and Linux, including the offline behaviour section (NFR-9) and the large-library performance runs. |
| W7-11 | **Distribution** | The Zotero Forums announcement, submission to the community lists, and the watch for the official registry (`docs/13` §7.2; R-20). |

### 5.2 Entry conditions

- **Phases 4, 5 and 6 are `DONE`.**
- **V-17 has an answer** — Fluent registration on Zotero 10 including the `ko-KR`
  bundle with English fallback (`docs/11` §4.3). Two related markers must be
  closed with it: `docs/01` §9.2's `> **Unverified:**` about which
  `Localization` argument form to use for a plugin's own files, and the
  `Zotero.ftl.addResourceIds` marker in `docs/01` §10.4, mirrored in `docs/08`
  §8.2.1.
- **V-18 has an answer** — `update.json` delivery end to end. `docs/13` §6.3
  additionally marks `> **Unverified:**` how Zotero reconciles a widened
  `strict_max_version` in the manifest against the narrower value inside an
  installed XPI, and says to verify this in V-18 *before relying on the
  manifest-only bump as the primary compatibility strategy*. That strategy is
  what `docs/13` §6.3 calls the project's single most valuable operational lever
  against R-1.
- **`docs/10` §5 question 20 is answered** — registry-listing timing. `docs/11`
  §5 lists it as the one remaining Before-Phase-7 decision now that D8 has
  settled the license.
- **`docs/09` §8's open decisions 1, 2, 3, 6 and 7 are answered.** All five become
  user-facing text or shipped behaviour in this phase: the Linux-without-libsecret
  path, whether the passphrase tier ships at all, Gemini tier detection, the
  re-verification of every remaining `Unverified`/`Partially verified` policy
  claim before it reaches user-facing text, and the policy-review cadence.
- ~~**The MIT license is confirmed with the institution's IP office.**~~
  **Satisfied — closed 2026-09-09.** D8 records MIT (`docs/00` §3) and
  `docs/10` §5 question 18 carried the instruction to confirm with the
  institution's IP office before first public release; the project owner closed
  that confirmation on 2026-09-09, question 18 is now struck through and records
  the decision itself, and it is recorded at
  [`06-human-gates.md`](06-human-gates.md) G-32. This is no longer an entry
  condition. Reopen it only if the licence changes or the work is reassigned to a
  different institution — the clearance was given for MIT, for this project,
  under its current affiliation.
- **NCBI registration is on file** for the `tool`/`email` pair. `docs/09` §5.1
  states that sending the values is not itself compliance and that registration
  is a release task; `docs/13` §8.9 carries it as a release-hygiene checkbox.
- **The accessibility surface is understood.** `docs/10` §3 marks Zotero 10's
  assistive-technology support surface `> **Unverified:**` and makes the
  NVDA/VoiceOver smoke test a Phase 7 deliverable; `docs/08` §9 additionally marks
  `> **Unverified:**` whether Zotero ships a high-contrast stylesheet that plugin
  panes inherit.
- **The build/test toolchain markers from `docs/13` are closed by Phase 0's
  report.** Specifically the scaffold `test` key names, the `esbuildOptions`
  shape and `xpiDownloadLink` templating, the Gecko target version, whether
  `zotero-plugin test` provisions a Zotero build in CI, and whether a
  `ZOTERO_CHANNEL` variable selects the beta build — all `> **Unverified:**` in
  `docs/13` §1.4, §1.5, §2, §5.1 and §5.3, and all load-bearing for W7-9 and
  W7-10.

### 5.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Registry-listing timing — list at v1.0 or wait (`docs/10` §5 question 20) | `docs/13` §7.2 |
| Linux-without-libsecret fallback: session-only or passphrase first, and whether the passphrase tier ships in v1 at all | `docs/09` §1.7 and the open note under D5 in `docs/00` §3; questions are `docs/09` §8 items 1 and 2 |
| ~~Gemini tier-detection fallback behaviour when no programmatic billing signal exists~~ **Decided 2026-11-16** (owner, `plan/00` §6 item 378(b)): ask once, unknown counts as free, warn on every audio confirmation, strict makes no audio | `docs/09` §3.4 rule 4; question is `docs/09` §8 item 3, marked 2026-11-16 |
| Provider-policy re-verification cadence and the date stamp shown next to retention text in the UI | `docs/09` §3.3; question is `docs/09` §8 item 7 |
| Whether advanced users may override prompts in v1 | `docs/12` §19 item 5, with cache-namespace and bug-report consequences |
| The supported-OS matrix for v1.0, given `docs/13` §8 requires all three for a minor or major release | `docs/13` §8 and the README compatibility table (`docs/13` §7.3 item 2) |
| Which NFRs, if any, ship waived rather than measured | the release checklist; `docs/11` §1 Phase 7 DoD requires each to be measured *or explicitly waived* |
| Final shipped values for the two spend ceilings (`docs/10` §5 question 6's residual half) | `docs/07` §8.5, "and nowhere else" |

*Noted 2026-11-16, on moving this table: every row is now decided or settled — registry timing (§0.4
line 4), the Linux fallback (line 7), the tier (item 378(b)), the cadence (line 9), prompt overrides
(line 3), the OS matrix (line 1), the waivers (recorded per NFR by `P7-T24` and accepted by the owner
in `P7-T29`), the ceilings (line 8).*

### 5.4 What would change the plan

- **V-18 shows the manifest-only compatibility bump does not work.** The fallback
  `docs/13` §6.3 names is a patch release whose only change is the manifest. R-1's
  ongoing cost rises from a one-line commit to a full release cycle per Zotero
  major, which changes the maintenance budget `docs/11` R-1 assumes (~1
  developer-day per major version). **That multiplier grew on 2026-09-09:**
  `docs/11` R-1 now reckons the corrected 7–10-month span at roughly **3–7**
  Zotero majors rather than the 2–3 the old 4–5-month span implied, with §1's
  separate ~15% compatibility contingency (≈ 23–32 d) sitting on top of the
  per-version budget rather than inside it.
- **V-17 fails or is awkward.** W7-1's approach changes at the root — how strings
  are registered, and therefore what R-22's CI parity check reads. This is the
  work area most likely to change shape entirely rather than in degree.
- **The Korean review returns register-level problems, not typos.** W7-2 stops
  being a Phase 7 polish item: `docs/12` §19 item 4 names the Korean *prompts*,
  which means the `TREND_REPORT_KO` and `AUDIO_SCRIPT_KO` outputs from Phases 4
  and 6 must be regenerated and re-judged, and `docs/12` §17.6's "changing a
  prompt costs money" applies. Budget a re-run of the Phase 4 and Phase 6 Korean
  DoD items, not a string sweep.
- **Accessibility support is worse than assumed.** NFR-13 items get explicitly
  waived in the release checklist with the reason recorded, rather than silently
  missed — `docs/11` §1 Phase 7 DoD allows a waiver but not an omission.
- **The official plugin registry opens before v1.0.** W7-11 gains a submission
  task and possibly a review or signing requirement — `docs/01` §11.5 marks
  `> **Unverified:**` whether the planned directory will introduce one.
- **A `docs/09` §7 `[BLOCKER]` cannot be satisfied.** The release does not ship.
  These are the only items in the plan explicitly labelled as must-not-ship-
  unresolved.

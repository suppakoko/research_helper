# Phase 1 — definition-of-done run (`P1-T23`)

> **What this file is.** The measurements `plan/02-phase-1-pubmed.md` §2's five
> criteria were judged on, the figures `R-16`, `R-17`, `NFR-1`, `NFR-3` and
> `NFR-10` need, the `docs/13` §8.1/§8.2 manual-QA rows with a verdict each, and
> a sign-off block for a human.
>
> **Nothing in this file is signed.** `plan/README.md` §4 reserves every `DONE`
> to a human and `P1-T23` carries a human gate; the executing agent produced the
> measurements and must not sign them. §9 is empty on purpose.
>
> **Run date:** 2026-10-12 · **Zotero 10.0.3**, Gecko 140.15.0, Windows
> (`WINNT`) · plugin `research-helper@suppakoko.github.io` version 0.0.2 ·
> installer 138,382 bytes.

---

## 1. Verdict per criterion

`plan/02-phase-1-pubmed.md` §2, verbatim, with the evidence beside it.

| # | §2 criterion | Verdict | Measured |
|---|---|---|---|
| 1 | A search for a real term imports ≥ 50 items into a new collection, each with a non-empty `abstractNote` where PubMed provides one | **PASS**, with one stated limit | 100 records fetched live from PubMed, 100 imported into a new collection, 99 of 100 carry a non-empty `abstractNote`. The "where PubMed provides one" half is **not independently checkable from outside the adapter** — see §3.2. |
| 2 | `NFR-1` measured: 100 pre-fetched records import in ≤ 10 s | **PASS** | **441–624 ms** over four runs, against a 10,000 ms ceiling and a 6,000 ms target. |
| 3 | Cancel mid-search leaves zero items (`FR-10`) | **PASS** | Cancel stopped an in-flight fetch in **121–153 ms** against a 2,000 ms requirement, with **zero** `item`/`collection` notifier events. |
| 4 | Provenance note present and JSON export validates against the schema | **PASS** | Exactly **one** note per import, carrying the note title prefix and the live Zotero version; the exported file is **496 bytes, 12 top-level fields, 0 schema errors**. |
| 5 | Re-running the same search links rather than duplicates | **PASS** | The second live search returned 100 records and reported **100 of 100** as already in the library; the collection stayed at **100** regular items and the library's DOI index stayed at **200** keys. |
| — | The plugin is installable and non-broken; nothing half-built is reachable from a menu (`plan/README.md` §6, `docs/11` §0 principle 5) | **PASS on the letter, one finding** | `npm run build` exits 0 and the plugin installs, starts, tears down and restarts cleanly. **But** `Tools ▸ Research Helper` still shows `Create spike item (P0-T10)` to users. See §6, proposed card **A**. |

**The phase is not recommended for signature yet.** Not because a criterion
failed — none did — but because of the four items in §8. The most important is
that the one live acceptance run produced a **red suite**, for a reason that was
diagnosed and fixed, and the fix has been verified offline but not yet under the
live gate.

---

## 2. How the run was performed

### 2.1 Where the items went

The **scaffold test profile** — `.scaffold/test/profile` with its own data
directory `.scaffold/test/data` — which is the separate practice profile gate
`G-15` requires (owner's answer, 2026-10-08) and the profile every integration
spec already writes to. The runner starts its own Zotero on that profile, so
nothing in this run could reach the owner's own research library.

**Cleanup, as the run reported it:**

| run | line |
|---|---|
| live acceptance run | `cleanup erased 203 item(s) and 2 collection(s)` |
| offline runs | `cleanup erased 101 item(s) and 1 collection(s)` |

The 203 are the 100 pre-fetched stub items of the `NFR-1` measurement, the 100
real PubMed items, and the three provenance notes (one from the `NFR-1` import,
two from the live import and its re-run). `test/integration/zotero/`'s own specs
erase their ~900 fixtures separately and reported doing so in every run.

No item was ever created outside the test profile. The developer profile
(`D:\ZoteroDev\profile`, data `D:\ZoteroDev\data`) was started once for the
manual check described in §4 and no search was run in it, so nothing was written
there either.

### 2.2 What is real and what is a double

| criterion | source of records | network |
|---|---|---|
| 1, 4, 5 | the **real PubMed adapter** against the real `eutils.ncbi.nlm.nih.gov` | **4 HTTP requests**: one `esearch` + one `efetch` per search, twice |
| 2 (`NFR-1`) | a stub `LiteratureSource` registered under the spare id `europepmc` | **none** |
| 3 (`FR-10`) | the same stub, with a 150 ms delay per record | **none** |
| `NFR-10` | — | **none**, and that is the measurement |

Everything else is the shipped product: the host
`src/bootstrap/registerUI.ts` publishes at startup, the real service graph, the
real `searchImport` pipeline, the real batched writer, the real library index,
the real provenance record and its redaction gate, the real note writer and the
real file writer. Nothing in `test/integration/phase1-dod.spec.ts` builds a
service graph, a pipeline, a writer or a view model.

**`P1-T23`'s last `Do NOT` is honoured literally:** criterion 2's import is
mocked and is the `NFR-1` figure; criteria 1, 4 and 5 are live and are the
acceptance run. They are different tests in the file and neither is counted as
the other.

### 2.3 Why the live test is opt-in, and how it was turned on

A live test left permanently in the suite would issue NCBI requests on every
developer's every run, which is the repetition `P1-T23`'s second `Do NOT`
forbids and which `docs/02` §3.1 warns can get an IP blocked. So the live test
reads the environment variable `RH_DOD_LIVE` and is **pending** when it is unset.
The acceptance run was one deliberate invocation:

```powershell
$env:RH_DOD_LIVE = '1'; npm run test:integration -- --exit-on-finish
```

The variable reaches Zotero because `zotero-plugin-scaffold` spawns it with
`{ ...process.env }`, and `Services.env` is how the spec reads it — the route
`test/integration/zotero/batchImport.spec.ts` already uses for its `CI` check.

**Whether that gate should stay is an owner's decision**, and it is item 4 of §8.

### 2.4 Rate limiting, as shipped

`src/core/rateLimit/hostLimiter.ts:196` paces `eutils.ncbi.nlm.nih.gov` at
**2.5 requests per second** without a key, against NCBI's published 3
(`docs/02` §3.1). Nothing in this run raised it, added a key, or parallelised.
The whole acceptance run spent **4** requests on NCBI; the other 8 requests the
observer saw were the test runner's own reporter posting to localhost.

### 2.5 The debugger was attached, and every figure is an upper bound

`zotero-plugin.config.ts:196` sets `server.devtools: true`. Verified
independently for this run by reading the installed scaffold's own source,
`node_modules/zotero-plugin-scaffold/dist/shared/scaffold-src-D5mM4ypK.mjs`:
`:3737` appends `--jsdebugger` when `options.binary.devtools` is set, and `:3934`
builds the **test** runner's `binary.devtools` from `this.ctx.server.devtools`.
The scaffold CLI offers no flag to turn it off — its whole flag list is
`--abort-on-fail`, `--dev`, `--dist`, `--exit-on-finish`, `--no-watch`,
`--preid`, `--yes`.

So the Browser Toolbox is attached to every figure below, and **no figure was
measured without it**. Turning it off means editing
`zotero-plugin.config.ts`, which is outside `P1-T23`'s `Files` list, so it is
reported rather than done (`plan/README.md` §5 rule 2). Every number here is
therefore a ceiling, not a best case — which is the safe direction for a
requirement.

**This matters less than it would for a text-rendering figure.** The timings
below are taken by polling the Zotero database for the collection's child count,
not by waiting on rendered text, so the bimodal Fluent slowness `P1-T46`
measured (`plan/00` §6 item 23) is not in the measured region at all. No window
is opened by this spec.

---

## 3. The measured figures

### 3.1 `NFR-1` — 100 pre-fetched records (criterion 2)

Measured from the call that stands in for "the user clicks Import" to the first
moment the collection **contains 100 items**, which is `docs/10` NFR-1's own
wording. The clock stops on a database read, not on the promise: `runImport`
also composes the summary and writes the provenance note, and both happen after
the hundredth item exists.

| run | 100 items present | whole `runImport` incl. the note | budget |
|---|---|---|---|
| offline #1 | 624 ms | 893 ms | ≤ 10,000 ms, target 6,000 |
| live run | **456 ms** | 721 ms | ″ |
| offline #2 | 621 ms | 937 ms | ″ |
| `Verify with` run | 441 ms | 770 ms | ″ |

**Verdict: PASS, by a factor of 16 against the ceiling and 10 against the
target.**

For comparison, through the writer alone rather than through the whole pipeline,
`test/integration/zotero/import-perf.spec.ts` measured the same 100 records in
**448–513 ms** in the first three of those runs (`index 8–13 + mapping 20–21 + write
414–478`). The pipeline therefore adds roughly **100–170 ms** on top of the
writer, which is the fetch-side plumbing, the lift to `CanonicalWork` and the
collection read-back.

### 3.2 `R-17` — abstract coverage on a real query (criterion 1)

Query: `lipid nanoparticle mRNA delivery`, in `FR-3`'s shipped default window
(the current calendar year and the two before it — 2024–2026).

| figure | value |
|---|---|
| records PubMed returned | **100** |
| items created | **100** (linked 0, skipped 0, failed 0) |
| items with a non-empty `abstractNote` | **99** |
| coverage, counted in the library | **99 %** |
| coverage, as the plugin itself published it | **99 %** |

The two counts are independent of each other: the library figure is read off
each stored item's `abstractNote`, and the plugin's figure is the writer's
`abstractCoveragePercent` computed inside the write half and carried to the
window as `research-helper-import-abstract-coverage`'s `$percent`. **They agree,
which means nothing was lost between the works and the items.**

**What is not checked, stated plainly.** Criterion 1 says "where PubMed provides
one". `SearchWindowRecord` carries no abstract, so the source-side truth is not
observable from outside the adapter, and **no assertion in this run can tell
"PubMed had no abstract for that record" apart from "the adapter dropped it"**.
The one record without an abstract was not chased to PubMed, because doing so
would have meant another live request. The adapter-side half of the claim is
covered by the 28 fixture-backed contract tests, which assert the mapper against
recorded PubMed XML.

`R-17` ("abstract coverage is poor") is **retired for PubMed** on this
measurement. Its cross-source half is Phase 2's, as `plan/02` §1 already says.

### 3.3 `R-16` and `docs/07` §7.2 — the write chunk size

The shipped chunk is `DEFAULT_CHUNK_SIZE` = **50**, so a 100-record import runs
**2** transactions. Observed through the pipeline, by polling the collection:

| run | 50 items present | 100 items present | implied 1st / 2nd chunk |
|---|---|---|---|
| offline #1 | 424 ms | 624 ms | ~424 / ~200 ms |
| live run | 273 ms | 456 ms | ~273 / ~183 ms |
| offline #2 | 441 ms | 621 ms | ~441 / ~180 ms |
| `Verify with` run | 256 ms | 441 ms | ~256 / ~185 ms |

`import-perf.spec.ts` instruments the transactions directly in the same runs and
reports `chunkMs=[246, 191]`, `[258, 241]`, `[251, 183]` — consistent with the
above once the one-off index build and mapping are taken out of the first chunk.

**`docs/07` §7.2's chunk-size question was already closed, and this card's own
`Notes` did not know that.** §7.2's note reads "**Chunk size: MEASURED
2026-10-01 (`P1-T14`), this half of the marker is closed. Ship 50.**"
(`docs/07-architecture-and-data-model.md:2196`). So what follows is **not a new
answer; it is four independent reproductions of an answer already on record** —
which is worth having, because `docs/07`'s table is one run and single runs are
what this phase has been bitten by three times. The sweep, four runs:

| chunk size | transactions | total ms (4 runs) | ms/item | slowest single transaction | longest main-window stall |
|---|---|---|---|---|---|
| 25 | 8 | 890 / 943 / 976 / 1040 | 4.45–5.20 | 175–219 ms | 44–53 ms |
| **50** | 4 | 839 / 779 / 889 / 835 | 3.90–4.45 | 239–317 ms | 34–53 ms |
| 100 | 2 | 920 / 815 / 835 / 834 | 4.08–4.60 | 406–488 ms | 40–50 ms |
| 200 | 1 | 1188 / 846 / 730 / 730 | 3.65–5.94 | 715–1173 ms | 48–59 ms |

**Three things the table says, and only one of them was expected.**

1. **Throughput is flat.** 200 records cost 730–1188 ms at *every* chunk size,
   and no ordering survives all four runs — 200 is the slowest in one run and
   the fastest in two others. So chunk size does not buy throughput at this scale.
2. **What chunk size does change is the longest single transaction**, and that
   grows roughly linearly with it: ~200 ms at 25, ~280 ms at 50, ~430 ms at 100,
   ~900 ms at 200. That is the figure that matters for a responsive UI.
3. **And yet the main window's longest stall never exceeded 59 ms at any chunk
   size** — not even behind a single 1,173 ms transaction. So a long
   `executeTransaction` is *not* one long main-thread task on this platform;
   something inside it yields. This is worth knowing before anyone "fixes"
   responsiveness by shrinking the chunk.

**Recommendation, which is a recommendation and not a change: keep 50**, which is
what `docs/07` §7.2 already ships. 50 is the best or joint-best ms/item in three
of the four runs, it keeps the slowest transaction near 280 ms, and it costs four
transactions for 200 records.

**Two of §7.2's own sentences read differently against four runs than against
one, and both matter less than they look.**

- §7.2 says "**25 costs 47 % more for nothing**", from a single run in which 25
  cost 1,244 ms and 50 cost 847. Across the four runs here, 25 cost **7–25 %**
  more than 50, never 47 %. The direction holds; the size of the penalty does
  not. The conclusion — ship 50, not 25 — is unaffected.
- §7.2 says "**50, 100 and 200 are within noise of each other**". Four runs
  **agree**, and widen it: *all four* sizes are within noise on total time.

§7.2's third point is reproduced exactly and is the one worth repeating: a long
`executeTransaction` is not one long main-thread task, because, as `P0-T20`
measured and §7.2 records, the transaction yields between `save()` calls. Four
more runs found no main-window gap over 59 ms at any chunk size.

**`docs/07` §7.2 was not edited, for two reasons rather than one.** First,
`docs/07` is not in `P1-T23`'s `Files` list. Second, and more to the point,
**there is nothing left in §7.2 for this card to close**: the chunk-size half of
the marker was closed on 2026-10-01, and the only `> **Unverified:**` still
standing there (`:2219`) is "whether `Zotero.Notifier` suppression is safe for
bulk plugin writes in Zotero 10" — which `P1-T14` deliberately did not implement,
and which this card does not touch either. See §6, finding **E**.

`R-16` ("Zotero item creation slower than NFR-1 allows") is **retired** on §3.1's
figures.

### 3.4 `NFR-3` — main-thread responsiveness

A 10 ms interval on the Zotero main window for the whole import, with an idle
baseline first so a throttled timer cannot be mistaken for a quiet thread.

| run | idle baseline median | samples during import | median | **longest gap** | gaps > 100 ms |
|---|---|---|---|---|---|
| offline #1 | 15 ms | 46 | 16 ms | 50 ms | **0** |
| live run | 10 ms | 50 | 11 ms | 54 ms | **0** |
| offline #2 | 10 ms | 55 | 13 ms | 52 ms | **0** |
| `Verify with` run | 11 ms | 59 | 11 ms | 38 ms | **0** |

**Verdict: PASS** against `docs/10` NFR-3's 100 ms. `P0-T20` measured 77 ms for
100 items in one transaction, so this is no worse than the spike.

### 3.5 `NFR-10` — startup cost and startup network silence

| run | plugin startup | budget | requests while the plugin was absent | requests while it started |
|---|---|---|---|---|
| offline #1 | **13 ms** | ≤ 200 ms | 0 | **0** |
| live run | **10 ms** | ″ | 0 | **0** |
| offline #2 | **16 ms** | ″ | 0 | **0** |
| `Verify with` run | **14 ms** | ″ | 0 | **0** |

**No network request is issued at startup. Verdict: PASS**, and it is measured
rather than argued: a Gecko `http-on-modify-request` observer recorded every
channel in the process, with a **control window** in which the plugin was
disabled so that any host seen only during startup would stand out. Both lists
were empty, so there is nothing to attribute.

**What the 10–16 ms is, and what it is not.** It is a **disable/enable cycle**
of the installed plugin, timed from `enable()` to `addon.data.initialized`. It
includes everything the plugin's own startup does — `registerUI()`,
`installServices()`, `registerSources()`, `registerPipelines()`, the
secret-store probe, the view-model construction, the host publication and
`onMainWindowLoad` for every open window. It **excludes** Zotero's own startup
and the three platform promises `onStartup` awaits first
(`initializationPromise`, `unlockPromise`, `uiReadyPromise`), which are already
resolved by then and which on a cold start are Zotero's wait rather than the
plugin's.

**It is therefore the plugin's own added cost, which is what the requirement is
about, but it is not a cold-start number.** A cold-start figure cannot be taken
from inside a spec that only exists once Zotero has started, and the plugin
records no startup timestamp (`src/hooks.ts` has no clock and is outside this
card's `Files`). The honest reading of 10–16 ms against a 200 ms budget is that
there is **more than an order of magnitude of headroom**, so even a cold start
that cost ten times as much would pass. A human who wants the literal figure
should run the §4 row for it.

### 3.6 `FR-10` — cancel mid-search (criterion 3)

| run | time from `cancel()` to the run stopping | budget | `item`/`collection` notifier events |
|---|---|---|---|
| offline #1 | 123 ms | ≤ 2,000 ms | **0** |
| live run | 128 ms | ″ | **0** |
| offline #2 | 121 ms | ″ | **0** |
| `Verify with` run | 153 ms | ″ | **0** |

The cancel is fired only after the first progress report, so it lands inside
`Fetching` rather than before `Planning`. **Zero items, zero collections**, and
the zero is measured by a notifier spy rather than inferred from a count.

### 3.7 Criterion 4 — the provenance note and the JSON export

| check | result |
|---|---|
| notes in the collection after the live import | **exactly 1** |
| note title | carries `PROVENANCE_NOTE_TITLE_PREFIX` |
| note body | carries the live `Zotero.version`, so the composition root's binding is real |
| `exportProvenance(path)` | returned `written` |
| file on disk | **496 bytes**, 12 top-level fields |
| validation against `schema/provenance.schema.json` | **0 errors** |
| the chosen path inside the file | **absent** — the owner's 2026-10-08 decision (`docs/09` §2.2), asserted |

The validator is a subset validator in the spec file, and it carries the same
honesty guard the two existing copies carry: it fails if the shipped schema uses
a keyword it does not enforce. That guard passed, so every keyword in
`schema/provenance.schema.json` — `type`, `const`, `enum`, `properties`,
`required`, `additionalProperties`, `items`, `oneOf`, `minimum`, `$ref` — is one
this run enforced.

**This is now the third copy of that validator** in the repository, after
`test/unit/core/provenance.test.ts` and
`test/integration/searchDialog-flow.spec.ts`. None can import another: the unit
copy needs `vitest` and `node:fs`, which the Zotero sandbox does not have, and a
spec is bundled on its own. `P1-T36` already asked for a shared test helper; a
third copy is the strongest argument for it yet. Proposed card **D**.

### 3.8 Criterion 5 — the re-run

| check | before the re-run | after |
|---|---|---|
| records the second search returned | — | **100** |
| of those, reported as already in the library | — | **100** |
| regular items in the collection | 100 | **100** |
| the library's DOI index keys | 200 | **200** |
| top-level items the index scanned | 202 | **203** |

The single extra top-level item is the re-run's **own provenance note**:
`buildLibraryIndex` searches with `noChildren: "true"` and an `FR-8` note is a
standalone note, so one new note per run is expected and is what "one note per
import" above already measured. **No record was duplicated.**

The 200 DOI keys are the 100 live PubMed items plus the 100 stub items the
`NFR-1` measurement had written earlier in the same run; both sets were erased
afterwards.

---

## 4. `docs/13` §8.1 and §8.2 — the manual QA rows

`docs/13` §8's preamble asks for Windows plus one other platform for a minor
release, a fresh profile with a fresh data directory for the install rows, and a
copy of a large real library (~10k items) for the performance rows. **This run
is Windows only.** Rows are marked:

- **PASS (auto)** — asserted mechanically in this run, with the evidence named.
- **HUMAN** — needs eyes, another platform, or an action no runner can take.
- **PHASE 2** — the row describes something Phase 1 deliberately does not build
  (`plan/02` §3), so it cannot pass and is not a Phase 1 defect.

### 4.1 Install and lifecycle (`docs/13` §8.1)

| row | verdict | evidence |
|---|---|---|
| XPI installs by drag-and-drop onto Tools → Plugins on a fresh profile, with no errors | **HUMAN** | The runner installs the plugin as a **temporary** add-on over the remote debugging protocol, which is a different code path from a user's drag-and-drop. Not done in this run. |
| Plugin appears with the correct name, version, icon and description | **HUMAN** | Needs eyes on the Plugins pane. |
| Restarting Zotero leaves the plugin working | **PASS (auto)**, partially | Every integration run is a fresh Zotero start with the plugin loading into it; 108 tests then pass against it. A *user's* restart of an installed (not temporary) plugin is the **HUMAN** half. |
| Disabling the plugin removes every menu item and the preferences pane, with no errors in debug output (`FR-56`) | **PASS (auto)** | `test/integration/lifecycle.spec.ts`: after a disable, zero Research Helper menus, zero menu items, zero window Fluent links, and `scope.liveHandles()` reports `[]`. |
| Re-enabling restores everything; repeat the cycle 5 times without leaks or duplicated menu items | **PASS (auto)** for one cycle; **HUMAN** for five | `lifecycle.spec.ts` asserts one clean cycle and this run added a second one for `NFR-10`. Five consecutive cycles were measured by `P0-T11`, not by this run. |
| Uninstalling leaves previously created items, collections, notes and audio attachments intact (`NFR-20`) | **HUMAN** | No runner can uninstall the plugin under test and then inspect the library. |
| In-place update from the previous released version via `update.json` succeeds, and settings are preserved (`R-15`) | **HUMAN** | There is no previous release: the version is 0.0.2 and nothing has been published. |
| Zotero startup time is not visibly degraded; no network request is issued at startup (`NFR-10`) | **PASS (auto)** for the network half and the plugin's own cost; **HUMAN** for "visibly" and for a cold start | §3.5. 10–16 ms of plugin work against a 200 ms budget, and zero requests with a control window. |

### 4.2 Search and import (`docs/13` §8.2)

| row | verdict | evidence |
|---|---|---|
| Search dialog opens from Tools and from the collection context menu (`FR-1`) | **PASS (auto)** | `test/integration/menus.spec.ts` drives both entry points in a live Zotero. Whether the window *looks* right is **HUMAN**. |
| All seven sources are selectable; deselecting all disables the Search button (`FR-2`) | **PHASE 2** for "all seven" — Phase 1 registers `pubmed` only, by design (`plan/02` §3). The **gate** half is **PASS (auto)**: `searchDialog-flow.spec.ts` asserts the Search button's gate. |
| Default date range is the last 3 years; overriding to "All years" works and is recorded (`FR-3`) | **PASS (auto)** | The live search above ran in the shipped default window, 2024–2026, and the exported provenance records the window it used. The "All years" override is asserted in the unit layer, not here. |
| A real multi-source search returns results, and a known cross-indexed paper appears exactly once (`FR-50`) | **PHASE 2** | One source ships. The single-source half is §3.2's live run. |
| Preview selection is honoured exactly: unchecking N rows imports `total - N` items (`FR-5`) | **PASS (auto)** | `searchDialog-flow.spec.ts`, "imports exactly the checked set". |
| Imported items have correct item types, creators, dates, DOIs and non-empty abstracts where the source provides them (`FR-6`, `FR-7`) | **PASS (auto)** for abstracts and for the field mapping; **HUMAN** for a spot-check of real metadata against PubMed | §3.2 plus `test/integration/zotero/itemMapper.spec.ts`. **Nobody read the 100 real items' titles and authors**, which is the check a human does in a minute and no assertion here makes. |
| Preprints import as `preprint` with repository and archive ID | **PHASE 2** | `plan/02` §3: `preprint` mapping is Phase 2's. `P1-T12` deliberately refuses to half-map one. |
| Importing a record already in the library links it rather than duplicating (`FR-51`) | **PASS (auto)** | §3.8, on real PubMed records, plus `import-perf.spec.ts`'s `created 0, linked 100`. |
| Cancel mid-search aborts within ~2 s and creates zero items (`FR-10`) | **PASS (auto)** | §3.6. |
| Disconnecting the network mid-search produces a clear error, not a stack trace (`NFR-9`, `NFR-14`) | **PASS (auto)** with an injected error; **HUMAN** for a real cable pull | `searchDialog-flow.spec.ts` renders the OFFLINE row from an injected `OfflineError` and asserts no stack trace reaches the surface. **No network interface was actually taken down in this run.** |
| Provenance note exists, is accurate, and its JSON export validates against `schema/provenance.schema.json` (`FR-8`) | **PASS (auto)** for existence and validation; **HUMAN** for "is accurate" | §3.7. "Accurate" is a reading of the note against what the user did, which is a human judgement. |
| **Performance:** 100 records import within the `NFR-1` budget; the Zotero UI stays responsive throughout (`NFR-3`) | **PASS (auto)** on a small library; **HUMAN** on a ~10k-item real library | §3.1 and §3.4. The test profile held a few hundred items, not the ~10,000 `docs/13` §8 asks for. `P1-T13` separately measured insertion at ~1.26 ms/item at 9,685 items, i.e. *faster* per item than at 100, so library size is not expected to break this — but it was not measured here. |

### 4.3 The one press nobody has witnessed — **NOT DONE**

`P1-T45` recorded that a native save dialog blocks the test runner until the
whole suite times out, so `nsIFilePicker.show()` is never called by a test. What
is unverified is that **the operating system draws the dialog** and that its
accept and cancel paths behave.

**This run did not press that button.** The developer profile's Zotero was
started for it and permission to control the application was **denied**, so the
press was not performed. It stays a human action, and it is item 1 of §8.

**What this run did do instead is remove the main suspicion by reading the
code.** `P1-T45` flagged "whether the return-code branch is written the right
way round, which no test here can reach". That branch was checked against the
shipped module's own source, extracted from
`C:\Program Files\Zotero\app\omni.ja` at
`chrome/content/zotero/modules/filePicker.mjs` (Zotero 10.0.3):

```js
FilePicker.prototype.modeOpen = 0;
FilePicker.prototype.modeSave = 1;
FilePicker.prototype.returnOK = 0;
FilePicker.prototype.returnCancel = 1;
FilePicker.prototype.returnReplace = 2;
```

and `show()` resolves with the constant `nsIFilePicker.open`'s callback hands it.
The product's branch in `addon/content/searchDialog.js` is

```js
const result = await picker.show();
if (result !== picker.returnOK && result !== picker.returnReplace) {
  return "";
}
```

which accepts `0` (OK) and `2` (an acknowledged overwrite) and rejects `1`
(Cancel). **It is written the right way round.** Three further details check out
against the same source: `init(window, title, picker.modeSave)` is right because
the wrapper reads `parentWindow.browsingContext` itself and `modeSave` is `1`;
the `file` getter returns `val.path`, a **string**, which is what the product
tests for; and `defaultString` is a property whose getter delegates to the
XPCOM object, which is consistent with `P1-T45`'s finding that reading it back
throws `NS_ERROR_FAILURE` on Windows while writing it works — and the product
only ever writes it.

So what remains unwitnessed is narrower than it was: **that Windows draws the
dialog at all, and that `appendFilter` and `defaultExtension` behave on this
platform.** Everything after the dialog closes is now verified against the
shipped source.

---

## 5. Every run made for this card

| # | command | result |
|---|---|---|
| 1 | `npm run typecheck` | exit 0, no output |
| 2 | `npm run lint:check` | exit 0 |
| 3 | `npm run test` | **1,234 unit in 28 files**, **28 contract**, exit 0 |
| 4 | `npm run build` | exit 0, installer **138,382 bytes**; six `ko-KR` missing-id warnings, all of them `G-41`'s known deferrals |
| 5 | `npm run test:integration -- --exit-on-finish` (clean tree, before this card's spec) | **105 passed**, exit 0, 88 s |
| 6 | `npm run typecheck` + `npx eslint` on the new spec | exit 0 both, first attempt |
| 7 | `npm run test:integration -- --exit-on-finish`, live gate **off** | **108 passed**, exit 0 |
| 8 | the same, full log captured | **108 passed**, exit 0 — the offline figures above |
| 9 | the same with `RH_DOD_LIVE=1` — **the live acceptance run** | **108 passed, 1 failed**, exit 1. All five §2 criteria measured and passing. The one failure is in another spec and is diagnosed in §6, finding **B**. |
| 10 | `npm run test:integration -- --exit-on-finish`, live gate off, after the §6 **B** fix | **108 passed**, exit 0; the restore line confirms `0 notice(s)` and panel `empty` |
| 11 | extracted and read `chrome/content/zotero/modules/filePicker.mjs` from the installed Zotero | §4.3 |
| 12 | `npm start` (developer profile) then stopped; permission to control Zotero **denied** | §4.3; nothing was written to the developer library |
| 13 | `P1-T23`'s own `Verify with`, in full | see §7 |
| 14 | `npm run build`, once more | exit 0, installer **138,382 bytes**. Needed only because the test runner empties `.scaffold/build`, so the installer the `Verify with` chain built is gone by the time the chain ends. The size is the figure that matters and it is unchanged. |

Every run killed leftover test-profile Zotero processes first, by command line
containing `.scaffold\test\profile` and never by process name, because the
owner's own Zotero is the same binary. `NODE_USE_SYSTEM_CA=1` was set for every
Node command and certificate verification was never disabled.

**No run's result was discarded and no measurement was repeated to get a better
number.** The live fetch was performed **once**.

---

## 6. Findings, as proposed cards

Nothing below was fixed. `P1-T23`'s `Do` step 7 and `plan/README.md` §5 rule 2
make each of these a new card.

### A — A developer spike command ships in the Tools menu

`Tools ▸ Research Helper` contains **`Create spike item (P0-T10)`** beside
`Search & Import…`. It is not half-built — it works — so it does not breach
`docs/11` §0 principle 5 on the letter. But it is a developer artefact, labelled
with an internal task ID, visible to every user of a release.
`plan/01-phase-0-toolchain-spike.md:3355` calls the id "deliberate and permanent
while the spike command exists", and **no card retires the command**.

The card needs to decide one of three things and then do it: retire the command,
hide it behind a developer preference, or keep it and record why a release ships
it. Note the entanglement the Phase 0 text warns about:
`research-helper-menu-spike-create-item` is the key
`test/integration/l10n.spec.ts`'s `ko-KR` fallback assertion is built on, and
`test/integration/lifecycle.spec.ts` counts menu items by that same id — so
removing the command means rewriting two integration assertions.
Files: `src/ui/menus/toolsMenu.ts`, both `.ftl` bundles, `src/i18n/keys.ts`,
`test/integration/lifecycle.spec.ts`, `test/integration/l10n.spec.ts`.

### B — `P1-T45`'s "hidden before any run" test depends on being first in the suite

**This is the failure the live acceptance run produced**, and it is a real
assertion failing on real behaviour rather than a flake:

```
✖ P1-T45: the export control is hidden before any run,
  FR-8's export control is revealed by view state, ...: expected false to be true
```

The chain is three shipped decisions meeting:

1. The view model is **application-scoped** — the composition root builds one at
   startup.
2. `P1-T36` decided deliberately that `connect()` does **not** clear the
   retained provenance record, so that reopening the window can still export the
   run on screen, and it does not reset the view state either.
3. The document derives the control's visibility from `state.notices.length > 0`
   (`addon/content/searchDialog.js`, `logic.exportAvailable`).

So **any** import anywhere in the suite leaves the export control revealed for
every window opened afterwards. `searchDialog-flow.spec.ts`'s own comment admits
the dependency — the test is "the only moment in the suite when a real window has
connected to the real host and no import has happened yet" — and
`phase1-dod.spec.ts` sorts before it.

**Worked around inside this card's own file, and only inside it.**
`test/integration/phase1-dod.spec.ts`'s `after()` runs one empty offline search,
because `runJob` publishes `notices: []` at the **start** of every run
(`src/ui/viewModels/searchImportViewModel.ts:1318`) and a search never puts any
back. Verified in run 10: `0 notice(s) in the last published state, panel
"empty", and exportProvenance("") answers "no-path"`.

**That is a restore, not a fix.** The card should make the assertion
order-independent — the honest shape is a test that drives a *fresh* view model,
or a published boolean the document reads instead of deriving (which `plan/00`
§6 item 21 already asks for). Files: `test/integration/searchDialog-flow.spec.ts`.

**Note for whoever runs the live gate next:** the restore was verified under the
offline import path, which is the identical code path — the live import differs
only in where its records came from, and the restore reads none of that. A
confirming run with `RH_DOD_LIVE=1` is still item 2 of §8.

### C — The stub source cannot be removed from the registry

`SourceRegistry.register` throws on a duplicate id and the interface declares no
unregister, so a spec that needs a stub must take a spare `SourceId` and leave
it in the application-wide registry for the rest of the process.
`searchDialog-flow.spec.ts` takes `crossref`; `phase1-dod.spec.ts` now takes
`europepmc`. Two specs, two spare ids, and **Phase 2 ships adapters for both** —
at which point neither spec can register its stub at all and both break.

`P1-T35` already reported the need for a test seam. This card raises its
priority from tidiness to a dated deadline: it must land **before** the first
Phase 2 adapter card. Files: `src/sources/registry.ts` and the two specs.

### D — The provenance schema validator now exists three times

`test/unit/core/provenance.test.ts`, `test/integration/searchDialog-flow.spec.ts`
and now `test/integration/phase1-dod.spec.ts` each carry their own subset
validator of `schema/provenance.schema.json`, about 200 lines each. None can
import another: the unit copy needs `vitest` and `node:fs`, which the Zotero
sandbox lacks, and each integration spec is bundled on its own.

`P1-T36` asked for a shared test helper. The shape that works is a plain module
under `test/support/` that imports **nothing** — no test framework, no Node
built-ins — so all three layers can bundle it. Files: one new
`test/support/*.ts` plus the three call sites.

### E — `P1-T23`'s own `Notes` asks for work that was finished eleven days earlier

The card's `Notes` (`plan/02-phase-1-pubmed.md:4696–4698`) says this is "the card
that turns `docs/07` §7.2's '**Unverified:** the exact optimal transaction chunk
size' into a measured number — write the answer back into `docs/07` in the same
change", and `Do` step 2 repeats it ("feeding `docs/07` §7.2's unverified note").

**Both are stale.** `docs/07-architecture-and-data-model.md:2196` has read
"**Chunk size: MEASURED 2026-10-01 (`P1-T14`), this half of the marker is
closed. Ship 50.**" since 2026-10-01, with the sweep table, the `ms/item`
column, the slowest-chunk column and the NFR-3 conclusion already in it. The
only `> **Unverified:**` still standing in §7.2 is `:2219`'s "whether
`Zotero.Notifier` suppression is safe for bulk plugin writes in Zotero 10",
which `P1-T14` deliberately did not implement and which this card does not
address.

So **nothing needed writing back**, `docs/07` was not edited, and the fact that
`docs/07` is also absent from the `Files` list turns out not to matter. §3.3
above holds four fresh reproductions of §7.2's table instead, plus the one
correction they produce: §7.2's "25 costs 47 % more for nothing" is a
single-run figure that four runs put at **7–25 %**.

**The card needed:** either correct `P1-T23`'s `Notes` and `Do` step 2, or —
better, since the figure is small and the sentence is load-bearing nowhere —
soften §7.2's "47 %" to the measured spread and name the number of runs behind
each figure. Files: `plan/02-phase-1-pubmed.md` and
`docs/07-architecture-and-data-model.md`.

**And the wider lesson is `plan/README.md` §5 rule 8 again, for the sixth time
this week.** Rule 8 was added because a card's own text was the plan's most
common defect, and the shape each time is the same: a grepped fact with an
unchecked claim built on top. Here the claim was not even grepped — §7.2 had said
`MEASURED` for eleven days.

### F — Four stale counts in `plan/00-task-index.md`'s own header

Re-derived from the cards' `State` rows on 2026-10-12, which is what
`plan/00`'s header says it does and §7 says to do after editing any card:

| the header says | the cards say |
|---|---|
| 133 tasks | **137** (35 + 46 + 25 + 31) — and §1's own table already says 137 |
| 71 `DONE`, 62 `TODO` | **74 `DONE`, 63 `TODO`** |
| Phase 0 is 34 of 35 | 34 of 35 — correct |
| Phase 1 is 34 of 42 `DONE` | **37 of 46** |
| Phase 2 3 of 25 | 3 of 25 — correct |

§4's Phase 1 table is stale in two further ways: it stops at `P1-T23`, so the 22
cards `P1-T24`–`P1-T45` are missing from it, and `P1-T23`'s own `Depends on` cell
reads `P1-T11, P1-T22` while the card reads `P1-T11, P1-T22, P1-T28, P1-T35,
P1-T36, P1-T45, P1-T46`.

**None of this was corrected here**, because every one of those figures is
derived from a `State` and `P1-T23`'s `Files` row says "the measured figures
only, never a state". §7's regeneration is a card of its own.

---

## 7. `P1-T23`'s `Verify with`

```
npm run lint:check && npm run typecheck && npm run test:unit && npm run test:contract && npm run build && npm run test:integration -- --exit-on-finish --abort-on-fail
```

Result, run in full on 2026-10-12 with the live gate **off** — see §8 item 2:

| step | result |
|---|---|
| `npm run lint:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1,234 passed in 28 files |
| `npm run test:contract` | 28 passed |
| `npm run build` | exit 0, installer 138,382 bytes |
| `npm run test:integration -- --exit-on-finish --abort-on-fail` | 108 passed, 0 failed |

Counts against the baseline a clean tree gave before this card: unit 1,234 →
1,234, contract 28 → 28, installer 138,382 → 138,382 bytes (**unchanged to the
byte**: this card adds a test file and no production code), integration 105 →
**108**, which is three new passing tests plus one pending live test.

---

## 8. What a human must do before this phase can be signed

> **Item 2 is done. Confirmed 2026-10-13 by the coordinator, with the owner's permission to make a
> second live run** — the card prohibits repeating a live search to get a number, and closing a known
> collateral failure is a different purpose, so the owner was asked and said yes.
>
> The whole `Verify with` chain was run with `RH_DOD_LIVE=1`: style 0, types 0, **1,234 unit**, **28
> contract**, build 0, and the integration suite **109 passed, 0 failed** — one more than the offline 108,
> which is the live test running instead of pending. **Finding B's collateral failure is closed.**
>
> What the run reported of itself: Zotero **10.0.3** on Windows, Gecko **140.15.0**; **100 records from
> PubMed in 1,983 ms**; import of 100 in **1,211 ms with the network included, so not an NFR-1 figure**;
> abstract coverage **99 of 100**, agreeing with the plugin's own published figure; the re-run recognised
> **100 of 100** as already present; and **12 HTTP requests in total, 4 of them to NCBI** — which is the
> four the earlier report predicted, and the eight others belong to other tests in the suite.
>
> **So one thing is left for a person before signing: item 1, the one press of the export control.** The
> rows in item 3 remain, and items 4 and 5 are decisions rather than work.

1. **Press the export button once and watch Windows draw the save dialog.** Open
   the Search & Import window, run a search, import, press the export control,
   and confirm that the dialog appears, that saving writes a file and that
   Cancel writes nothing and shows nothing. §4.3 narrowed what is at risk but
   could not do this.
2. **Run `P1-T23`'s `Verify with` once with `RH_DOD_LIVE=1` and confirm it is
   green.** The one live acceptance run was red because of finding **B**, which
   has since been restored inside this card's file and verified offline. One
   live confirmation closes it. It costs four NCBI requests.
3. **Walk the `docs/13` §8.1/§8.2 rows marked HUMAN in §4.** The install, the
   uninstall, the five disable/enable cycles, a look at 100 real items' metadata
   and — if this is to be a minor release — a second platform.
4. **Decide whether the live test stays gated.** Keeping the gate means the DoD
   run is a deliberate act and the suite never touches the network; removing it
   means every developer run makes four NCBI requests. §2.3.
5. **Decide the six findings in §6** — which become cards, and in what order.
   **C** has a deadline: it must land before the first Phase 2 adapter.
6. **Then, and only then, set `P1-T23` to `DONE` and sign §9.** Note that eight
   Phase 1 cards are still `TODO` (`P1-T37`–`P1-T44`). None of them is one of
   §2's five criteria, so the phase's definition of done does not wait on them —
   but whether the phase closes with them open is the owner's call, not this
   document's.

---

## 9. Sign-off

**Deliberately empty.** `plan/README.md` §4: only a human sets a task to `DONE`,
and `P1-T23`'s human gate is "a human must sign off the five criteria and the
measured numbers before the phase is marked done". The executing agent produced
§1–§8 and must not sign them.

| field | value |
|---|---|
| Signed by | |
| Date | |
| Criteria accepted | |
| Findings in §6 accepted as cards | |
| Items in §8 completed | |

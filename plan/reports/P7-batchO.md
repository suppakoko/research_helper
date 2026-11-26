# Phase 7 batch O: why `searchDialog-flow.spec.ts` timed out waiting for Fluent

**Date:** 2026-11-26 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-26 (batch O) · **Commit base:** 2a5f81c, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository. Batch O's own files there start with `o-`. In everything this batch writes, the Windows
user name is replaced by `<user>`.

## Finding

**The search window was hidden, not slow, and commit 1674121 has nothing to do with it.** Zotero opens the search
window in the test run while the owner works in another application. Windows does not let a background program take
the foreground, so the window opens behind the owner's browser or file manager. When that window covers it fully,
Gecko's occlusion tracking (`widget.windows.window_occlusion_tracking.enabled`, on by default) marks the search window
hidden. A hidden window's refresh driver (the timer that drives painting) ticks after 1 s and then at doubling
intervals. Fluent (Firefox's translation system) writes text for a changed `data-l10n-id` only on such a tick. So
each test's text wait took about 1, 2, 4, 8 and 16 s, and the next one passed the spec's 25 s limit. That is exactly
the pattern in the failing logs. `document.l10n.formatMessages` does not wait for a tick, which is why it stayed fast
(item 45's old observation). The fix is one test-profile preference: tracking off, so a covered window still counts as
visible. With it, the spec run alone under an always-on-top window passed 3 of 3 times; without it, 6 of 6 such runs
failed 2–3 tests each, with 1674121's files in place or reverted. The fix is carded as `P7-T43` (0.25 d), built, and
followed by three recorded full runs (see Runs).

## The evidence

### 1. The failing logs have a timing signature

Per-test durations in the `P1-T22` block (`searchDialog-flow.spec.ts`), read from the earlier logs. A clean run is
about 30–40 ms per test. In every failing run they double, at near whole seconds:

| Run | PARTIAL | OFFLINE | TIMEOUT | NETWORK | 429 | empty keyword | out of range | no collection | cancel |
|---|---|---|---|---|---|---|---|---|---|
| l-rec1 (clean) | 36 ms | 43 | 50 | 41 | 44 | 34 | 35 | 69 | 163 |
| m-dev1 | 941 | 1,946 | 4,071 | 7,903 | 16,001 | FAIL | 6,873 | FAIL | FAIL |
| m-dev2 | 914 | 999 | 1,983 | 3,952 | 7,989 | 15,987 | FAIL | 6,882 | FAIL |
| n-rec1 | 2,959 | 3,991 | 7,968 | 15,985 | FAIL | 6,864 | FAIL | FAIL | 13,822 |
| n-rec3 (passed) | 921 | 1,995 | 3,975 | 7,981 | 10,670 | 29 | 36 | 63 | 199 |
| n-rec4 | 905 | 1,054 | 1,899 | 3,988 | 8,018 | 15,952 | FAIL | 6,893 | FAIL |

- After a 25 s failure the next test takes about 6.9 s: the remainder of a 32 s interval.
- n-rec3 drops back to 29 ms in the middle of the block: the window became visible again.
- The 1, 2, 4, 8 s steps are the inactive refresh timer's, not a load curve.

### 2. A probe measured the mechanism in the real search window

A temporary spec (`test/o-probe/o-probe.spec.ts`, deleted) opened the search window, added one element, changed its
`data-l10n-args` five times and timed each paint. It also counted animation frames for 3 s.

| Condition | `visibilityState` / `isFullyOccluded` | Frames in 3 s | Five paints (ms) |
|---|---|---|---|
| Tracking on, just opened, behind the owner's browser window | hidden / true | 2 | 3,138; 7,995; 16,006; over 20,000; 12,012 |
| Tracking on, minimized | hidden / false | 0 | 18,944–20,015 each (the 20 s cap) |
| Tracking on, restored | hidden / true | 3 | 1,087; 4,019; 7,999; 16,006; over 20,000 |
| Tracking on, under a second Zotero window | hidden / true | 0 | 1,617; 2,016; 4,004; 8,016; 16,007 |
| Tracking off, just opened | visible / false | 182 | 17; 12; 12; 19; 33 |
| Tracking off, minimized | hidden / false | 2 | 2,720; 8,013; 15,986; over 20,000; 12,006 |
| Tracking off, restored | visible / false | 182 | 35; 27; 19; 16; 18 |
| Tracking off, under a second Zotero window | visible / false | 182 | 13; 14; 15; 16; 15 |

- Zotero 10.0.8, Gecko 140.17.0. Defaults read in the test profile: tracking `true`,
  `..._display_state.enabled` `false`, `..._session_lock.enabled` `true`, `layout.throttled_frame_rate` 1.
- Just after the first probe, the foreground window was the owner's browser at 979–3042 × 132–1178 px. The search
  window sat at 1235–2205 × 376–1015 px, fully inside it. Only the process name and rectangle were read, no title.
- The window had focus inside Zotero in every row; focus does not make it visible.

### 3. The spec alone, with and without 1674121, with and without the fix

`searchDialog-flow.spec.ts` can be run alone. zotero-plugin-scaffold 0.9.2 has no CLI option for it, but it bundles
every `*.spec.ts` under `test.entries`. For these development runs `zotero-plugin.config.ts` read a temporary
`RH_O_ENTRIES` variable, pointing at a temporary folder with two files: a sampler spec, then a one-line import of the
real spec. The sampler logged the search window's `visibilityState` and `isFullyOccluded` every second, whenever they
changed. In the "covered" runs it also kept an always-on-top blank Zotero window over the search window, standing in
for another application's window. A run alone takes 1.5–4 minutes and has 63 tests.

| Cell | Tree | Screen | Runs failing | Tests failed per run | Search window, as sampled |
|---|---|---|---|---|---|
| H-nat | HEAD | as the owner left it | 1 of 4 | 3, 0, 0, 0 | hidden in the failing run; visible in the other three |
| H-cov | HEAD | covered | 3 of 3 | 3, 3, 3 | hidden |
| R-nat | HEAD, 1674121's two files reverted | as the owner left it | 1 of 3 | 0, 1, 0 | hidden for part of the failing run; visible in the other two |
| R-cov | HEAD, 1674121's two files reverted | covered | 3 of 3 | 3, 2, 3 | hidden |
| F-cov | HEAD + the fix | covered | 0 of 3 | 0, 0, 0 | visible throughout |
| F-nat | HEAD + the fix | as the owner left it | 0 of 3 | 0, 0, 0 | visible throughout |

- H-nat counts the first single run (`o-head-1`) and `o-H-nat-1`…`3`.
- **1674121 does not move the rate.** Covered, both trees fail every run. Uncovered, both pass. With the owner's
  screen as it was, each tree failed exactly in its runs where the sampler saw the window hidden.
- **The fix holds under the same cover.** In F-nat-1 and F-nat-2 the owner's browser window covered the search
  window's rectangle at launch, the case that failed H-nat-1, and both passed.
- The tests that failed were the same Fluent waits as in the earlier logs. They were "empty keyword", "no
  collection" and "cancel", or "out of range" and "cancel", or the 429 row.
- The reverted files were `addon/locale/ko-KR/research-helper-searchDialog.ftl` and `src/i18n/keys.ts`, taken
  from `1674121~1`. Both were restored from HEAD and checked against sha256 sums taken before the revert: both OK.
  `typings/i10n.d.ts` kept the same hash (`86f684d1…94fc4`) through all of it.
- Also unchanged: the `P1-T22` block pins the window to `en-US` (`pinUILocale`), so the Korean added by 1674121 is
  never rendered there.
- The owner was at the machine throughout. The longest time without keyboard or mouse input was 227 s in the
  development runs and 286 s in the recorded runs, below the display's 600 s switch-off. The session was never locked (`o-idle.ps1`, sampled every 5 s).

### 4. Why batches I–L saw none of it

Not measured. Their logs carry no window state. The likely reason is the owner's screen: the failure needs another
application's window to cover the search window's rectangle for the whole block. Items 20, 23 and 45 recorded the
same doubling on 2026-10-07/12 and read it as machine load. Item 23 has a dated answer pointing here.

## The fix (`P7-T43`)

- **`docs/13` §2.3**, amended first: a dated note on what occlusion does, with the figures above.
- **`zotero-plugin.config.ts`**: `VISIBLE_WINDOW_PREFS` sets `widget.windows.window_occlusion_tracking.enabled` to
  `false`, and is spread into `test.prefs`. The scaffold writes `test.prefs` into the test profile's `prefs.js`
  before each start (`ZoteroRunner.setupProfile`). This is a Gecko preference of the test profile, not a plugin
  preference, so `docs/07` §8.5 is unaffected. The built XPI is the same size as batch M's (736,406 bytes), because
  the config is not shipped.
- **`test/integration/searchDialog-flow.spec.ts`**: `assertWindowVisible` waits up to 5 s for the window to read
  "visible" and otherwise fails at once with the reason. It is called in the `before` hooks of the `P1-T35` and
  `P1-T22` blocks, right after each opens the window. A minimized window, which the preference does not cover, then
  fails at the start of the block instead of as timeouts several tests later. `waitUntil`'s comment gained a dated
  correction: the "under load" renders it describes were reproduced without load.
- **Not changed:** the 25 s waits; any Fluent id, English or Korean text; any plugin preference; the product code.
  A user looks at the window whose text they read, and a window that becomes visible paints at once.
- **Not measured:** a locked session (`..._session_lock.enabled` is `true` and belongs to the same tracker), and
  macOS or Linux. Occlusion tracking of this kind is Windows-only; on CI's Linux runner the preference is ignored.

**Estimate:** Phase 7 36.75–51 → 37.00–52 d over 43 cards; the project 233.50–327 → 233.75–328 d over 282 cards,
still about 11–15 months; the critical path 165.25–231 → 165.50–232 d. The margins to the Phase 3 and Phase 5 routes
did not change, and inside Phase 7 the card ends at 0.25 d, so the phase's path stays 16.50 d. These figures were
re-derived by script from the card bodies (`o-propagate.mjs` over batch K's `k-sums.mjs`), written to the five
`plan/README` §7 sites, and `npm run index:derive` was run.

## Cards a failure affects

- **`DONE` cards** (no `State` was changed):
  - `P1-T22`: its block holds the failing tests.
  - `P1-T35`: its State gives the earlier failures as "load sensitivity" (item 20).
  - `P1-T46`: its evidence was built on that reading; its state taps remain right for transient text.
  - `P1-T23`: it was gated by item 20.
  Their work stands; only the stated cause was wrong (item 421(a)).
- **`TODO` cards:**
  - `P1-T37` and `P1-T38`: their tests are among those that timed out.
  - `P7-T43`: the new card.

## Decisions and questions

- **Decisions:** `plan/00` §6 item 420 (a)–(e), each marked DECIDED 2026-11-26 (coordinator, under item 313):
  - (a) the cause, and the card;
  - (b) 1674121 is not the cause;
  - (c) the measurement method;
  - (d) a minimized window is left as it is;
  - (e) the scripts.
- **Owner question:** item 421(a), whether to note the corrected cause on the four `DONE` cards. The draft answer
  is not adopted. No Korean or UI text change was needed, so there is no wording question.

## Runs

**Development runs.**

| Run | What | Result |
|---|---|---|
| o-probe1 | probe, tracking on | 1 passed; the first table in §2 |
| o-probe2 | probe, tracking off | 1 passed; the second table in §2 |
| o-head-1, o-H-nat-1…3, o-H-cov-1…3, o-R-nat-1…3, o-R-cov-1…3, o-F-cov-1…3, o-F-nat-1…3 | the spec alone | §3's table |

**Recorded runs** (full suite, debugger on, tree manifest `o-tree.sha`, 1,235 files):

| Run | Start–end (2026-11-26) | Result | Live-request guard |
|---|---|---|---|
| o-rec1-on | 16:23:18–16:40:56 | exit 0, 395 passed | 1,503 channels; let through `127.0.0.1:59321`, `localhost:64562`; away from loopback: none |
| o-rec2-on | 16:41:00–16:58:48 | exit 0, 395 passed | 1,503 channels; let through `127.0.0.1:59321`, `localhost:56604`; away from loopback: none |
| o-rec3-on | 16:58:52–17:17:01 | exit 0, 395 passed | 1,503 channels; let through `127.0.0.1:59321`, `localhost:60729`; away from loopback: none |

The live-request guard is the suite's check that no test reached the network: it reads every channel Zotero opened
and lists the hosts it let through. Both hosts are on this machine (the test fixtures' local servers). The tree
matched `o-tree.sha` after the third run too. Longest time without keyboard or mouse input: 183 s, 286 s and 144 s;
the session was never locked.

- **Before every launch:**
  - the launch gate passed its four checks: Zotero 10.0.8; no `active-update.xml`; Zotero's `updater.exe` not
    running; no test-profile `zotero.exe` running;
  - the time was written into the scaffold's npm check cache. It was also written before the build.
- **Before each recorded run:** the `/* MUTANT` and `.only(` greps were empty, no build was running, and the tree
  matched `o-tree.sha`.
- **The integration command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration --
  --exit-on-finish`.

## Checks

Run on the final tree before the recorded runs; the tree did not change after.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's step, `--base en-US --target ko-KR`, no `--allow`) | exit 0; 3 files, 572 messages, 0 allowed holes |
| `npm run test` | exit 0; unit 165 files, 8,547 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | exit 0; XPI 736,406 bytes (batch M: 736,406) |
| Typings hashes | all five equal to batch M's (`i10n.d.ts` 86f684d1…94fc4) |

## Tree changes

Uncommitted; base 2a5f81c.

- **Modified:**
  - `zotero-plugin.config.ts`
  - `test/integration/searchDialog-flow.spec.ts`
  - `docs/13-testing-build-and-release.md`
  - `docs/11-implementation-roadmap.md`
  - `plan/10-phase-7-release.md`: the card, its roll-up row, `P7-T24`'s Depends on, and the estimate prose;
  - `plan/00-task-index.md`: §1, items 23, 420 and 421, and the derived tables.
- **Created:** `plan/reports/P7-batchO.md`.
- **Created and deleted:**
  - `test/o-probe/o-probe.spec.ts`;
  - `test/o-single/` and `test/o-cover/` (the sampler and the one-line import);
  - the config's two temporary lines (`RH_O_ENTRIES`, `RH_O_OCCLUSION`).
- **Reverted and restored:** 1674121's two files, verified by sha256.

No key, PDF, user name or e-mail address was written. No label, theme, Korean or UI text was written or changed.

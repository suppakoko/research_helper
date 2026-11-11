# Theme contrast test: wait for the switch, not a fixed time (plan/00 §6 item 367(c))

**Findings.** The search dialog's light-and-dark contrast test failed in most runs because it set the dark-theme preference and then waited a fixed 250 milliseconds, which was often too short, so it measured the light colours twice. The test now waits until the switch has actually happened, for at most 5 seconds: in the light step, until the window reports a light colour scheme; in the dark step, until the window reports a dark colour scheme and the measured cell's colours differ from the light reading. If the switch does not happen in time, the test fails with a message that names what did not change. The 4.5 to 1 bar, both theme measurements and the closing "two different themes" check are unchanged, and no product code was touched. No other integration test switches the theme, so nothing else needed this repair. With the change, three consecutive integration runs were clean (355 passed, 0 failed, 2 pending each), and all other checks passed. In all three runs the readings matched the one passing run of the earlier report: light 4.76 to 1 (rgba(0, 0, 0, 0.55) on rgb(255, 255, 255)), dark 5.91 to 1 (rgba(255, 255, 255, 0.55) on rgb(30, 30, 30)).

## 1. The change

File: `test/integration/searchDialog-flow.spec.ts`, test "keeps a greyed row at 4.5:1 or better in the light and the dark theme (P5-T16 line 14, NFR-13)". This is the only file changed.

- **Shared helper reused.** The wait uses the spec file's own `waitUntil(predicate, what, timeoutMs)`, which polls every 25 milliseconds, with a 5,000-millisecond bound. The integration folder has no shared wait helper: each spec declares its own `waitUntil`. This spec's copy is the one used.
- **New local `drawnDark()`.** It returns whether the dialog window's `matchMedia("(prefers-color-scheme: dark)")` matches. The window type the test reads (`view`) was moved out of `contrast()` so both functions use it, and it gained `matchMedia`.
- **Light step.** After `ui.systemUsesDarkTheme = 0`, the test waits until `drawnDark()` is false. On timeout the message is "the window's colour scheme to turn light after ui.systemUsesDarkTheme = 0".
- **Dark step.** After `ui.systemUsesDarkTheme = 1`, the test waits until `drawnDark()` is true **and** `contrast().words` differs from the light reading. On timeout the message is "the window's colour scheme to turn dark and the greyed cell's colours to change from the light reading (…) after ui.systemUsesDarkTheme = 1", with the light reading filled in.
- **Restoring the theme.** The `finally` block used a fixed 100-millisecond wait after clearing the preference. It now waits, for at most 5 seconds, until `drawnDark()` returns to the value it had before the test began. It does not fail at this point, so it cannot hide an earlier failure. If the theme has not returned, it logs "[P5-T16] the window's colour scheme did not return to the system's within 5,000 ms". That line did not appear in any of the three runs.
- **Unchanged.** `assert.isAbove(ratio, 4.5, …)` for both themes, and the closing check that the two readings differ.

## 2. Other specs with the same pattern

None. The test folder was searched for `systemUsesDarkTheme`, `prefers-`, `color-scheme`, `colorScheme`, "dark theme" and "light theme". The only theme switch in `test/` is the one in this test. The other fixed waits found in `test/integration` (for example `Zotero.Promise.delay(250)` in `relatedWindow.spec.ts` and `recommendWindow.spec.ts`) do not follow a theme switch, so they were left alone.

## 3. Checks

All were run with OPENROUTER_API_KEY removed from the environment.

| Check | Result |
|---|---|
| `env -u OPENROUTER_API_KEY npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 (Prettier: all files formatted) |
| `npx eslint .` | exit 0 |
| `npm run test`, unit tests | 138 files, 7,736 passed, 105 skipped, 0 failed |
| `npm run test`, contract tests | 6 files, 84 passed, 28 skipped, 0 failed |

**Integration** (`NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`). Before each run, the case-sensitive `/* MUTANT` search over `src` and `test` was empty, and no zotero.exe with `.scaffold\test\profile` on its command line was running. No process was killed. None was left running afterwards.

| Run | Time | Passed | Failed | Pending | Contrast test readings |
|---|---|---|---|---|---|
| 1 | 22:02:51–22:08:31 | 355 | 0 | 2 | light 4.76:1, dark 5.91:1, 115 ms |
| 2 | 22:09:39–22:15:18 | 355 | 0 | 2 | light 4.76:1, dark 5.91:1, 123 ms |
| 3 | 22:15:19–22:20:57 | 355 | 0 | 2 | light 4.76:1, dark 5.91:1, 112 ms |

The two pending tests are the opt-in real-PubMed import test and the opt-in 10,000-item index test, as before. The test now takes about 115 milliseconds, against the 350 milliseconds or more of fixed waiting it had before. The switch therefore lands well inside the 5-second bound when the test waits for it.

Logs: C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\t367\ (unit.log, integ-1.log to integ-3.log; run.sh is the script that ran the pre-run checks).

## 4. Left for the owner

1. **The closing integration condition for P2-T39 and this repair.** Item 367(c) says the three clean runs taken after this repair count for both cards. These three runs were taken on the tree at commit a9ea442 (P2-T39) plus this one test change, so they can close P2-T39's condition if the owner accepts them.
2. **Not committed.** The change is in the working tree only, as instructed.
3. **Not tested: the failure path.** The test was not deliberately made to time out, so the failure message was not seen in a real run. It is built from the same `waitUntil` that the file's other tests use.
4. **Memory note.** The memory note gives the last commit as becbeca. The tree's last commit is a9ea442.

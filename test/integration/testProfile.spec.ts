/**
 * `plan/00` §6 item 405(d), owner, 2026-11-18: the running test profile
 * carries the preferences that keep Zotero from updating itself during a
 * run. During batch G's runs Zotero's own update check reached
 * `www.zotero.org` and staged 10.0.8, and every later start ran `updater.exe`.
 * `zotero-plugin.config.ts`'s `NO_APP_UPDATE_PREFS` sets them, the scaffold
 * writes them into the profile's `prefs.js`, and this spec reads them where
 * Gecko reads them. `test/unit/integration/testProfilePrefs.test.ts` checks
 * the configuration itself.
 *
 * It also logs the running Zotero's version and whether the run has the
 * debugger (`researchHelper.test.devtools`, item 405(b)), so a run's log
 * says which configuration it measured.
 */

interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void> | void,
): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

/** How long a whole run may take, at most, for the timer's start time. */
const RUN_HOURS = 6;

function boolPref(name: string): boolean | undefined {
  return Services.prefs.getPrefType(name) === Services.prefs.PREF_BOOL
    ? Services.prefs.getBoolPref(name)
    : undefined;
}

describe("item 405(d): the test profile keeps Zotero from updating itself", function () {
  it("carries app.update.auto, checkInstallTime and staging.enabled false, and a fresh background-update time", function () {
    debug(
      `[405 profile] Zotero ${Services.appinfo.version} (build ` +
        `${Services.appinfo.appBuildID}); debugger ` +
        `${String(boolPref("researchHelper.test.devtools"))}`,
    );
    for (const name of [
      "app.update.enabled",
      "app.update.auto",
      "app.update.checkInstallTime",
      "app.update.staging.enabled",
    ]) {
      assert.strictEqual(boolPref(name), false, `${name} is false`);
      assert.strictEqual(
        Services.prefs.prefHasUserValue(name),
        true,
        `${name} is set by the test profile, not left to a default`,
      );
    }
    // UpdateTimerManager's "seconds since the epoch" of the last daily check:
    // set to the run's start by the configuration, or later if the timer has
    // fired since. Zero or absent would make it due at once.
    const name = "app.update.lastUpdateTime.background-update-timer";
    const last =
      Services.prefs.getPrefType(name) === Services.prefs.PREF_INT
        ? Services.prefs.getIntPref(name)
        : 0;
    const now = Math.round(Date.now() / 1000);
    debug(
      `[405 profile] ${name} = ${String(last)} (${String(now - last)} s ago)`,
    );
    assert.isAbove(last, now - RUN_HOURS * 3600, `${name} is recent`);
    assert.isAtMost(last, now, `${name} is not in the future`);
  });
});

/**
 * `plan/00` §6 items 405(b) and 405(d), owner, 2026-11-18: the integration
 * runner's configuration. `zotero-plugin.config.ts` is read here as the
 * scaffold reads it (its default export), with the environment set and unset.
 *
 * - **405(d):** the test profile's preferences turn Zotero's own application
 *   update off, as far as a profile can (the file's `NO_APP_UPDATE_PREFS`
 *   comment says which of them Gecko 140 reads). Zotero itself is checked by
 *   `test/integration/testProfile.spec.ts`, which reads them in the running
 *   profile.
 * - **405(b):** `RH_DEVTOOLS=off` turns `server.devtools` (Zotero's
 *   `--jsdebugger`) off; without it the default is unchanged, on.
 *
 * Nothing is started and nothing is fetched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

interface LoadedConfig {
  readonly server: { readonly devtools: boolean };
  readonly test: { readonly prefs: Readonly<Record<string, unknown>> };
}

async function loadConfig(
  devtoolsEnv: string | undefined,
): Promise<LoadedConfig> {
  vi.resetModules();
  if (devtoolsEnv === undefined)
    vi.stubEnv("RH_DEVTOOLS", undefined as unknown as string);
  else vi.stubEnv("RH_DEVTOOLS", devtoolsEnv);
  const module = (await import("../../../zotero-plugin.config")) as {
    default: LoadedConfig;
  };
  return module.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the test profile turns Zotero's application update off (item 405(d))", () => {
  it("sets the update preferences Gecko reads, and the scaffold's own", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { test } = await loadConfig(undefined);
    expect(test.prefs).toMatchObject({
      "app.update.enabled": false,
      "app.update.auto": false,
      "app.update.checkInstallTime": false,
      "app.update.staging.enabled": false,
      // Zotero's own retraction lookup stays off too (2026-11-05).
      "extensions.zotero.retractions.enabled": false,
    });
    // The background-update timer was last run "now", so it is not due for a
    // day; a run takes well under an hour.
    const last =
      test.prefs["app.update.lastUpdateTime.background-update-timer"];
    expect(typeof last).toBe("number");
    expect(last as number).toBeGreaterThanOrEqual(before - 1);
    expect(last as number).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 1,
    );
    expect(Number.isInteger(last)).toBe(true);
  });
});

describe("RH_DEVTOOLS=off runs Zotero without the debugger (item 405(b))", () => {
  it("keeps the debugger on by default, and tells the specs so", async () => {
    const config = await loadConfig(undefined);
    expect(config.server.devtools).toBe(true);
    expect(config.test.prefs["researchHelper.test.devtools"]).toBe(true);
  });

  it("turns it off for RH_DEVTOOLS=off, and only for that value", async () => {
    const off = await loadConfig("off");
    expect(off.server.devtools).toBe(false);
    expect(off.test.prefs["researchHelper.test.devtools"]).toBe(false);
    for (const value of ["", "0", "on", "OFF", "false"]) {
      const config = await loadConfig(value);
      expect(
        config.server.devtools,
        `RH_DEVTOOLS=${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });
});

/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and observes the platform's own channels and add-on manager; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P7-T15` — the plugin's own startup cost and its startup network silence
 * (`NFR-10`: "≤ 200 ms added to startup, no startup request").
 *
 * **What it measures.** `hooks.onStartup` keeps four timestamps on
 * `addon.data.startup` (`src/bootstrap/startupTimings.ts`): Zotero's own
 * readiness wait, `registerUI`, the per-window registrations, and their sum,
 * the plugin's own work. This spec reads them twice:
 *
 * 1. on the instance it finds, which Zotero started when the test profile
 *    launched, or which an earlier spec started by a disable/enable cycle
 *    (the log says which cannot be told apart here); and
 * 2. on a fresh instance it starts itself by disabling and re-enabling the
 *    plugin, while recording every HTTP request in the process, with a
 *    control window of the same length while the plugin is absent.
 *
 * Each `ownMs` must be at most 200 ms, and no request may carry the plugin's
 * `User-Agent` or go to a host the control window did not see
 * (`countedStartupHosts`, `./support/startupRequests.ts`, which also leaves
 * Zotero's own `api.zotero.org` out, as the owner decided under `plan/00` §6
 * item 265 (d)).
 *
 * **What it does not measure**, and why `docs/spikes/phase-7-profiling.md`
 * exists: the time Zotero spends loading the plugin's bundle before
 * `onStartup` runs, and a cold Zotero start with and without the plugin.
 * Those are the owner's procedure (`G-34`), on a copy of a large library in a
 * separate profile. The figures here come from the test profile, with its
 * handful of items.
 *
 * Same shape as `phase1-dod.spec.ts`'s NFR-10 test, whose disable/enable and
 * request-recording helpers are transcribed here (each spec in this folder
 * keeps its own copy; `lifecycle.spec.ts` measured the bootstrap observer).
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import type { StartupTimings } from "../../src/bootstrap/startupTimings";
import {
  countedStartupHosts,
  isPluginRequest,
  isZoteroOwnRequest,
  type ObservedRequest,
} from "./support/startupRequests";

interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare const assert: {
  isTrue(value: boolean, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  isAtLeast(value: number, floor: number, message?: string): void;
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

/** `NFR-10`'s budget for what the plugin adds to startup. */
const NFR10_STARTUP_MS = 200;

function log(line: string): void {
  debug(`[P7-T15] ${line}`);
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(25);
  }
}

function describeTimings(timings: StartupTimings): string {
  return (
    `own work ${String(timings.ownMs)} ms (registerUI ` +
    `${String(timings.registerUIMs)} ms + main windows ` +
    `${String(timings.windowsMs)} ms); Zotero's readiness wait ` +
    `${String(timings.barrierMs)} ms, not counted`
  );
}

/** The timings an instance kept, checked for shape. */
function timingsOf(instance: Addon | undefined, which: string): StartupTimings {
  const timings = instance?.data.startup;
  if (timings === undefined) {
    assert.fail(`${which}: addon.data.startup was not set by onStartup`);
  }
  for (const [name, value] of Object.entries(timings)) {
    assert.isTrue(
      Number.isInteger(value) && value >= 0,
      `${which}: ${name} is a whole, non-negative number of ms (${String(value)})`,
    );
  }
  assert.strictEqual(
    timings.ownMs,
    timings.registerUIMs + timings.windowsMs,
    `${which}: own work is registerUI plus the main windows`,
  );
  return timings;
}

/* ------------------------------------------- transcribed from phase1-dod */

const observerService = Services.obs as unknown as {
  addObserver(observer: unknown, topic: string): void;
  removeObserver(observer: unknown, topic: string): void;
};

interface ObservedChannel {
  readonly URI?: { readonly spec?: string };
  getRequestHeader?(name: string): string;
}

function httpChannel(subject: unknown): ObservedChannel {
  const queryInterface = (subject as { QueryInterface?: unknown })
    .QueryInterface;
  if (typeof queryInterface !== "function") return subject as ObservedChannel;
  try {
    return (queryInterface as (iid: unknown) => unknown).call(
      subject,
      Components.interfaces.nsIHttpChannel,
    ) as ObservedChannel;
  } catch {
    return subject as ObservedChannel;
  }
}

/** Every HTTP request Gecko makes while `body` runs, with its `User-Agent`. */
async function recordingRequests<T>(
  body: () => Promise<T>,
): Promise<{ result: T; requests: readonly ObservedRequest[] }> {
  const requests: ObservedRequest[] = [];
  const observer = {
    observe(subject: unknown): void {
      try {
        const channel = httpChannel(subject);
        const spec = channel.URI?.spec;
        if (typeof spec !== "string") return;
        let userAgent: string | undefined;
        try {
          userAgent = channel.getRequestHeader?.("User-Agent");
        } catch {
          userAgent = undefined;
        }
        requests.push({ url: spec, userAgent });
      } catch {
        // An observer that throws must not fail the measurement it serves.
      }
    },
  };
  observerService.addObserver(observer, "http-on-modify-request");
  try {
    const result = await body();
    await Zotero.Promise.delay(250);
    return { result, requests };
  } finally {
    observerService.removeObserver(observer, "http-on-modify-request");
  }
}

interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

async function researchHelperAddon(): Promise<AddonWrapper> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) assert.fail(`AddonManager does not know ${config.addonID}`);
  return wrapper;
}

/** Resolve after Zotero has finished the plugin's bootstrap `method`. */
function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) return;
        clearTimeout(timer);
        Zotero.Plugins.removeObserver(observer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      Zotero.Plugins.removeObserver(observer);
      reject(new Error(`timed out waiting for bootstrap ${method}`));
    }, 30_000);
    Zotero.Plugins.addObserver(observer);
    action().catch((error: unknown) => {
      clearTimeout(timer);
      Zotero.Plugins.removeObserver(observer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/* ------------------------------------------------------------- the spec */

describe("P7-T15: the plugin's own startup cost (NFR-10)", function () {
  it("the instance found kept its startup timings, and its own work is within 200 ms", async function () {
    this.timeout(60_000);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      "the plugin to have initialized",
    );
    const timings = timingsOf(pluginInstance(), "the instance found");
    log(
      `instance found (Zotero's launch of the test profile, or an earlier ` +
        `spec's re-enable): ${describeTimings(timings)}`,
    );
    assert.isAtMost(
      timings.ownMs,
      NFR10_STARTUP_MS,
      `NFR-10: the plugin's own startup work took ${String(timings.ownMs)} ms`,
    );
  });

  it("a fresh start keeps its timings within 200 ms and sends no request of its own", async function () {
    this.timeout(120_000);
    const wrapper = await researchHelperAddon();
    assert.isTrue(wrapper.isActive, "the plugin is enabled before the cycle");

    // The control window: the plugin absent for about as long as a start.
    const { requests: baseline } = await recordingRequests(async () => {
      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await waitUntil(
        () => pluginInstance() === undefined,
        `Zotero.${config.addonInstance} to be removed by onShutdown`,
      );
      await Zotero.Promise.delay(2_000);
    });

    const { result: wallMs, requests } = await recordingRequests(async () => {
      const startedAt = Date.now();
      await afterBootstrapCall("startup", () => wrapper.enable());
      await waitUntil(
        () => pluginInstance()?.data.initialized === true,
        "the fresh instance to finish initializing",
      );
      return Date.now() - startedAt;
    });

    const timings = timingsOf(pluginInstance(), "the fresh instance");
    log(`fresh instance (disable/enable cycle): ${describeTimings(timings)}`);
    log(
      `fresh instance: enable() to initialized ${String(wallMs)} ms by the ` +
        `wall clock, which includes the add-on manager and the bundle load`,
    );
    assert.isAtLeast(
      wallMs,
      timings.ownMs,
      "the wall-clock start contains the plugin's own work",
    );

    const fromPlugin = requests.filter(isPluginRequest);
    const zoteroOwn = requests.filter(isZoteroOwnRequest);
    const counted = countedStartupHosts(baseline, requests);
    log(
      `requests: control window ${String(baseline.length)}, start window ` +
        `${String(requests.length)} (${String(zoteroOwn.length)} to Zotero's ` +
        `own hosts, not counted; ${String(fromPlugin.length)} with the ` +
        `plugin's User-Agent); counted hosts: ` +
        `${counted.length === 0 ? "none" : counted.join(",")}`,
    );
    assert.deepEqual(
      counted,
      [],
      "NFR-10: no request at startup is the plugin's, or goes to a host the " +
        "control window did not see",
    );
    assert.isAtMost(
      timings.ownMs,
      NFR10_STARTUP_MS,
      `NFR-10: the plugin's own startup work took ${String(timings.ownMs)} ms`,
    );
  });
});

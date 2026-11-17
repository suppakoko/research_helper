/**
 * `P3-T02` step 3: `uninstall()` in `addon/bootstrap.js` removes every stored
 * key, and `shutdown()` never does (`docs/09` §2.5). `P7-T10` step 5: the same
 * sweep removes the plugin's data and preferences too (`docs/09` §7), in the
 * order `runUninstallSweep` (`src/core/dataReset.ts`) sets, each step whatever
 * the one before it did.
 *
 * The real file is run in a Node `vm` context whose globals are fakes: a
 * `Zotero` holding a plugin object, a `Services.scriptloader` that stands in for
 * loading the bundle, and Gecko's bootstrap reason constants. `onUninstall` is
 * a spy, so no keystore and no key is involved.
 *
 * The build replaces `__addonRef__` and `__addonInstance__` in this file. They
 * are valid identifiers as written, so the fakes use the raw names.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  runUninstallSweep,
  type UninstallReport,
  type UninstallSteps,
} from "../../../src/core/dataReset";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../addon/bootstrap.js"),
  "utf8",
);

/** Gecko's bootstrap reason codes (`resource://gre/modules/AddonManager`). */
const REASONS = {
  APP_STARTUP: 1,
  APP_SHUTDOWN: 2,
  ADDON_ENABLE: 3,
  ADDON_DISABLE: 4,
  ADDON_INSTALL: 5,
  ADDON_UNINSTALL: 6,
  ADDON_UPGRADE: 7,
  ADDON_DOWNGRADE: 8,
} as const;

interface Hooks {
  onUninstall: ReturnType<typeof vi.fn>;
  onShutdown: ReturnType<typeof vi.fn>;
}

interface Harness {
  readonly zotero: { __addonInstance__?: { hooks: Hooks }; debug: unknown };
  readonly hooks: Hooks;
  readonly loadSubScript: ReturnType<typeof vi.fn>;
  readonly debugLines: string[];
  call(name: "uninstall" | "shutdown", reason: number): Promise<void>;
}

/** What a sweep removed, as `onUninstall` resolves it. */
const REPORT: UninstallReport = {
  keys: 3,
  rows: 12,
  entries: 7,
  files: 2,
  prefs: 5,
  failed: [],
};

/**
 * Run `addon/bootstrap.js` in a fresh context.
 *
 * @param loaded - whether the plugin object is still on `Zotero`. When it is
 *   not, the fake `loadSubScript` puts one there, as loading the bundle does.
 */
function harness(loaded: boolean): Harness {
  const debugLines: string[] = [];
  const hooks: Hooks = {
    onUninstall: vi.fn(() => Promise.resolve(REPORT)),
    onShutdown: vi.fn(() => Promise.resolve()),
  };
  const zotero: Harness["zotero"] = {
    debug: (line: string) => {
      debugLines.push(line);
    },
  };
  if (loaded) zotero.__addonInstance__ = { hooks };
  const loadSubScript = vi.fn(() => {
    zotero.__addonInstance__ = { hooks };
  });
  const context = createContext({
    ...REASONS,
    Zotero: zotero,
    Services: { scriptloader: { loadSubScript } },
    Components: {},
    ChromeUtils: {},
  });
  runInContext(SOURCE, context);
  const data = {
    id: "research-helper@test",
    version: "0.0.0",
    rootURI: "jar:file:///synthetic.xpi!/",
  };
  return {
    zotero,
    hooks,
    loadSubScript,
    debugLines,
    call: async (name, reason) => {
      const hook = context[name] as (d: unknown, r: number) => Promise<void>;
      await hook(data, reason);
    },
  };
}

describe("addon/bootstrap.js uninstall() (P3-T02)", () => {
  it("calls onUninstall on the plugin object when it is still loaded", async () => {
    const h = harness(true);
    await h.call("uninstall", REASONS.ADDON_UNINSTALL);
    expect(h.hooks.onUninstall).toHaveBeenCalledTimes(1);
    expect(h.loadSubScript).not.toHaveBeenCalled();
    expect(h.zotero.__addonInstance__).toBeDefined();
    expect(h.debugLines).toEqual([
      "[__addonRef__] uninstall removed 3 stored key(s), 12 stored row(s), " +
        "7 cache entr(ies), 2 report file(s), 5 preference(s)",
    ]);
  });

  it("loads the bundle again when shutdown() already removed the plugin object, and removes it afterwards", async () => {
    const h = harness(false);
    await h.call("uninstall", REASONS.ADDON_UNINSTALL);
    expect(h.loadSubScript).toHaveBeenCalledTimes(1);
    expect(h.loadSubScript.mock.calls[0]?.[0]).toBe(
      "jar:file:///synthetic.xpi!/content/scripts/__addonRef__.js",
    );
    expect(h.hooks.onUninstall).toHaveBeenCalledTimes(1);
    expect(h.hooks.onShutdown).not.toHaveBeenCalled();
    expect(h.zotero.__addonInstance__).toBeUndefined();
  });

  it("clears nothing on an upgrade or a downgrade", async () => {
    for (const reason of [REASONS.ADDON_UPGRADE, REASONS.ADDON_DOWNGRADE]) {
      const h = harness(true);
      await h.call("uninstall", reason);
      expect(h.hooks.onUninstall).not.toHaveBeenCalled();
      expect(h.loadSubScript).not.toHaveBeenCalled();
    }
  });

  it("never throws: a failed sweep is one debug line and the uninstall goes on", async () => {
    const h = harness(true);
    h.hooks.onUninstall.mockImplementation(() =>
      Promise.reject(new Error("login store unreadable")),
    );
    await expect(
      h.call("uninstall", REASONS.ADDON_UNINSTALL),
    ).resolves.toBeUndefined();
    // The error's name only: a message can carry a path (docs/09 §2.2).
    expect(h.debugLines).toEqual([
      "[__addonRef__] uninstall could not run its sweep: Error",
    ]);
  });

  it("names the steps that failed, and still counts the others (P7-T10)", async () => {
    const h = harness(true);
    h.hooks.onUninstall.mockImplementation(() =>
      Promise.resolve({
        ...REPORT,
        rows: 0,
        entries: 0,
        files: 0,
        failed: ["data"],
      }),
    );
    await h.call("uninstall", REASONS.ADDON_UNINSTALL);
    expect(h.debugLines).toEqual([
      "[__addonRef__] uninstall removed 3 stored key(s), 0 stored row(s), " +
        "0 cache entr(ies), 0 report file(s), 5 preference(s); failed: data",
    ]);
  });
});

describe("runUninstallSweep (P7-T10 step 5)", () => {
  function steps(
    overrides: Partial<UninstallSteps> = {},
  ): UninstallSteps & { order: string[] } {
    const order: string[] = [];
    return {
      order,
      clearKeys: () => {
        order.push("keys");
        return Promise.resolve(2);
      },
      deleteData: () => {
        order.push("data");
        return Promise.resolve({
          rows: 9,
          entries: 4,
          bytes: 100,
          files: 1,
          byTable: { summary: 3 },
        });
      },
      clearPrefs: () => {
        order.push("prefs");
        return 6;
      },
      ...overrides,
    };
  }

  it("clears keys, then data, then preferences, and reports each count", async () => {
    const s = steps();
    const report = await runUninstallSweep(s);
    expect(s.order).toStrictEqual(["keys", "data", "prefs"]);
    expect(report).toStrictEqual({
      keys: 2,
      rows: 9,
      entries: 4,
      files: 1,
      prefs: 6,
      failed: [],
    });
  });

  it("runs every step whatever the one before it did, and never throws", async () => {
    const order: string[] = [];
    const report = await runUninstallSweep({
      clearKeys: () => {
        order.push("keys");
        return Promise.reject(new Error("store"));
      },
      deleteData: () => {
        order.push("data");
        return Promise.reject(new Error("locked"));
      },
      clearPrefs: () => {
        order.push("prefs");
        throw new Error("prefs");
      },
    });
    expect(order).toStrictEqual(["keys", "data", "prefs"]);
    expect(report).toStrictEqual({
      keys: 0,
      rows: 0,
      entries: 0,
      files: 0,
      prefs: 0,
      failed: ["keys", "data", "prefs"],
    });
  });

  it("with no database file, still clears keys and preferences", async () => {
    const s = steps({ deleteData: () => Promise.resolve(undefined) });
    const report = await runUninstallSweep(s);
    expect(report).toMatchObject({
      keys: 2,
      rows: 0,
      files: 0,
      prefs: 6,
      failed: [],
    });
  });

  it("is what onUninstall runs, over the three platform steps", () => {
    const hooks = readFileSync(
      resolve(__dirname, "../../../src/hooks.ts"),
      "utf8",
    );
    expect(hooks).toContain('await import("./bootstrap/uninstall")');
    expect(hooks).toMatch(
      /async function onUninstall\(\): Promise<UninstallReport> \{\s+const \{ uninstallSweep \} = await import\("\.\/bootstrap\/uninstall"\);\s+return uninstallSweep\(\);/,
    );
    const uninstall = readFileSync(
      resolve(__dirname, "../../../src/bootstrap/uninstall.ts"),
      "utf8",
    );
    expect(uninstall).toMatch(
      /ZOTERO_UNINSTALL_STEPS: UninstallSteps = \{\s+clearKeys: clearAllSecretsOnUninstall,\s+deleteData: uninstallPluginData,\s+clearPrefs: uninstallPreferences,\s+\}/,
    );
    expect(uninstall).toContain(
      "return runUninstallSweep(ZOTERO_UNINSTALL_STEPS);",
    );
  });
});

describe("addon/bootstrap.js shutdown() (P3-T02)", () => {
  it("never calls onUninstall, for any reason", async () => {
    for (const reason of [
      REASONS.APP_SHUTDOWN,
      REASONS.ADDON_DISABLE,
      REASONS.ADDON_UNINSTALL,
      REASONS.ADDON_UPGRADE,
    ]) {
      const h = harness(true);
      await h.call("shutdown", reason);
      expect(h.hooks.onUninstall).not.toHaveBeenCalled();
    }
  });
});

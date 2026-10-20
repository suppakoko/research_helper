/**
 * `P3-T02` step 3: `uninstall()` in `addon/bootstrap.js` removes every stored
 * key, and `shutdown()` never does (`docs/09` §2.5).
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

/**
 * Run `addon/bootstrap.js` in a fresh context.
 *
 * @param loaded - whether the plugin object is still on `Zotero`. When it is
 *   not, the fake `loadSubScript` puts one there, as loading the bundle does.
 */
function harness(loaded: boolean): Harness {
  const debugLines: string[] = [];
  const hooks: Hooks = {
    onUninstall: vi.fn(() => Promise.resolve(3)),
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
      "[__addonRef__] uninstall removed 3 stored key(s)",
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
    expect(h.debugLines).toEqual([
      "[__addonRef__] uninstall could not remove stored keys: Error: login store unreadable",
    ]);
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

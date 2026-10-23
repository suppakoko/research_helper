/**
 * `P3-T03`: the session-only store (tier 2), the degradation dialog, and the
 * rule that no `src/zotero/` export writes a key through the `PrefStore` port.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no keystore.
 *
 * **Every value here is synthetic and built at run time**
 * (`rh-p3t03-synthetic-<id>-<random hex>`); none has the shape of a real
 * provider key, and none is printed.
 *
 * **Why three platform globals are stubbed.** `src/zotero/keychain.ts` builds
 * its login-info constructor from `Components` in its module body, and its
 * tier-1 functions call `Zotero.OSKeyStore` and `Services.logins`. Step 5's
 * check runs those functions for real, so the stubs below are working
 * in-memory fakes: a reversible "encryption" that keeps the `oskv1:` prefix,
 * and a login list. Nothing here reaches a real keystore.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface FakeLogin {
  origin: string;
  httpRealm: string;
  username: string;
  password: string;
}

const platform = vi.hoisted(() => {
  const logins: FakeLogin[] = [];
  const globals = globalThis as Record<string, unknown>;
  globals.Components = {
    Constructor: () =>
      function FakeLoginInfo(
        this: FakeLogin,
        origin: string,
        _formActionOrigin: string | null,
        httpRealm: string,
        username: string,
        password: string,
      ): void {
        Object.assign(this, { origin, httpRealm, username, password });
      },
    interfaces: { nsILoginInfo: {} },
  };
  const PREFIX = "oskv1:";
  globals.Zotero = {
    OSKeyStore: {
      encrypt: (value: string): Promise<string> =>
        Promise.resolve(PREFIX + Buffer.from(value, "utf8").toString("base64")),
      decrypt: (value: string): Promise<string> =>
        Promise.resolve(
          Buffer.from(value.slice(PREFIX.length), "base64").toString("utf8"),
        ),
      isEncrypted: (value: string): boolean => value.startsWith(PREFIX),
    },
  };
  globals.Services = {
    logins: {
      initializationPromise: Promise.resolve(),
      searchLoginsAsync: (query: {
        origin: string;
        httpRealm: string;
      }): Promise<FakeLogin[]> =>
        Promise.resolve(
          logins.filter(
            (login) =>
              login.origin === query.origin &&
              login.httpRealm === query.httpRealm,
          ),
        ),
      addLoginAsync: (login: FakeLogin): Promise<void> => {
        logins.push(login);
        return Promise.resolve();
      },
      removeLogin: (login: FakeLogin): void => {
        const at = logins.indexOf(login);
        if (at >= 0) logins.splice(at, 1);
      },
    },
  };
  return {
    logins,
    encryptedForm: (value: string) =>
      PREFIX + Buffer.from(value, "utf8").toString("base64"),
  };
});

import {
  createMemoryPrefStore,
  type PrefScalar,
  type PrefStore,
} from "../../../src/core/config";
import { SECRET_IDS, type SecretId } from "../../../src/core/secretStore";
import {
  PREFS,
  PREF_NAMES,
  getPref,
  setPrefStore,
  type PrefDef,
  type PrefName,
} from "../../../src/prefs";
import { backendBadge } from "../../../src/ui/prefs/preferencesPane";
import {
  SECRET_BACKEND_CHOICES,
  SECRET_BACKEND_DIALOG_FEATURES,
  SECRET_BACKEND_DIALOG_L10N,
  SECRET_BACKEND_DIALOG_NAME,
  SECRET_BACKEND_DIALOG_ROOT_ID,
  SECRET_BACKEND_DIALOG_URL,
  openSecretBackendDialog,
  type SecretBackendChoice,
} from "../../../src/ui/dialogs/secretBackendDialog";
import { KO_PRESENT, MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import * as keychain from "../../../src/zotero/keychain";

const REPO = resolve(__dirname, "../../..");

afterAll(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.Components;
  delete globals.Zotero;
  delete globals.Services;
});

/** A value no real key looks like, different on every call. */
function synthetic(id: SecretId): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `rh-p3t03-synthetic-${id}-${hex}`;
}

/** A memory `PrefStore` that also records every write, in order. */
function recordingPrefStore(
  initial: Readonly<Record<string, PrefScalar>> = {},
): PrefStore & { readonly writes: [string, PrefScalar][] } {
  const base = createMemoryPrefStore(initial);
  const writes: [string, PrefScalar][] = [];
  return {
    writes,
    get: (key) => base.get(key),
    set: (key, value) => {
      writes.push([key, value]);
      base.set(key, value);
    },
    clear: (key) => base.clear(key),
    observe: (key, handler) => base.observe(key, handler),
  };
}

/** The `PrefName` whose branch-relative key is `key`. */
function prefNameOf(key: string): PrefName | undefined {
  return PREF_NAMES.find((name) => PREFS[name].key === key);
}

/** Every `*.keyPresent` flag, by its branch-relative key, set to `value`. */
function allFlags(value: boolean): Record<string, boolean> {
  return Object.fromEntries(
    keychain.keyPresenceFlags().map((flag) => [PREFS[flag].key, value]),
  );
}

beforeEach(() => {
  keychain.clearSessionSecrets();
  platform.logins.length = 0;
});

afterEach(() => {
  setPrefStore(undefined);
});

// ---------------------------------------------------------------------------
// Step 1 — the tier-2 store
// ---------------------------------------------------------------------------

describe("createSessionSecretStore (P3-T03 step 1)", () => {
  it("is tier 2: backend session-only, and unattended false (step 4)", () => {
    setPrefStore(createMemoryPrefStore());
    const store = keychain.createSessionSecretStore();
    expect(store.backend).toBe("session-only");
    expect(store.unattended).toBe(false);
  });

  it("round-trips a synthetic value, and after a simulated shutdown has() returns false", async () => {
    setPrefStore(createMemoryPrefStore());
    const store = keychain.createSessionSecretStore();
    const value = synthetic("llm.openrouter");

    await store.set("llm.openrouter", value);
    expect(await store.get("llm.openrouter")).toBe(value);
    expect(await store.has("llm.openrouter")).toBe(true);
    expect(await store.listStoredIds()).toEqual(["llm.openrouter"]);

    // What the scope's teardown runs at shutdown().
    expect(keychain.clearSessionSecrets()).toBe(1);

    expect(await store.has("llm.openrouter")).toBe(false);
    expect(await store.get("llm.openrouter")).toBeUndefined();
    expect(await store.listStoredIds()).toEqual([]);
  });

  it("shares one map across stores, so a second store is not a second, empty session", async () => {
    setPrefStore(createMemoryPrefStore());
    await keychain
      .createSessionSecretStore()
      .set("source.ncbi", synthetic("source.ncbi"));
    expect(await keychain.createSessionSecretStore().has("source.ncbi")).toBe(
      true,
    );
  });

  it("maintains the presence flags from the map, a shared flag meaning either key", async () => {
    setPrefStore(createMemoryPrefStore());
    const store = keychain.createSessionSecretStore();

    await store.set("tts.gemini", synthetic("tts.gemini"));
    await store.set("llm.gemini", synthetic("llm.gemini"));
    expect(getPref("geminiKeyPresent")).toBe(true);

    await store.clear("tts.gemini");
    expect(getPref("geminiKeyPresent")).toBe(true);
    await store.clear("llm.gemini");
    expect(getPref("geminiKeyPresent")).toBe(false);

    await store.set("source.ncbi", synthetic("source.ncbi"));
    expect(getPref("ncbiKeyPresent")).toBe(true);
    expect(getPref("openrouterKeyPresent")).toBe(false);
  });

  it("clearAll() empties the map, resolves to the count and leaves every flag false", async () => {
    setPrefStore(createMemoryPrefStore());
    const store = keychain.createSessionSecretStore();
    for (const id of [
      "llm.openai",
      "llm.anthropic",
      "source.semanticscholar",
    ] as const) {
      await store.set(id, synthetic(id));
    }
    expect(await store.clearAll()).toBe(3);
    expect(await store.listStoredIds()).toEqual([]);
    for (const flag of keychain.keyPresenceFlags()) {
      expect(getPref(flag), flag).toBe(false);
    }
  });

  it("reconcileSessionKeyPresence() resets a flag a previous session left true", async () => {
    const prefs = createMemoryPrefStore(allFlags(true));
    setPrefStore(prefs);
    const written = await keychain.reconcileSessionKeyPresence();
    expect([...written.values()].every((present) => !present)).toBe(true);
    for (const flag of keychain.keyPresenceFlags()) {
      expect(getPref(flag), flag).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3 — the preference value and the badge
// ---------------------------------------------------------------------------

describe("the secretBackend preference (P3-T03 step 3; owner item 267)", () => {
  it("maps the port's backends onto docs/07 §8.5's three values, and nothing onto passphrase", () => {
    expect(keychain.secretBackendPrefValue("os-keychain")).toBe("oskeystore");
    expect(keychain.secretBackendPrefValue("session-only")).toBe("session");
    expect(keychain.secretBackendPrefValue(undefined)).toBe("");
    expect(
      keychain.secretBackendPrefValue({ backend: "os-keychain", elapsedMs: 0 }),
    ).toBe("oskeystore");
    // A failed probe is not tier 2: tier 2 exists only once the user chooses it.
    expect(
      keychain.secretBackendPrefValue({
        backend: "unavailable",
        failure: "encrypt-threw",
        detail: "Error: synthetic",
        elapsedMs: 0,
      }),
    ).toBe("");
    expect(new Set(Object.values(keychain.SECRET_BACKEND_PREF_VALUES))).toEqual(
      new Set(["oskeystore", "session"]),
    );
    for (const value of [
      ...Object.values(keychain.SECRET_BACKEND_PREF_VALUES),
      keychain.SECRET_BACKEND_UNAVAILABLE,
    ]) {
      expect(PREFS.secretBackend.values).toContain(value);
    }
  });

  it("reads session after the tier-2 choice, and backendBadge reports a warning state for it", () => {
    setPrefStore(createMemoryPrefStore());
    const store = keychain.adoptSessionSecretStore();
    expect(store.backend).toBe("session-only");
    expect(getPref("secretBackend")).toBe("session");
    for (const platformName of ["win", "mac", "linux", "other"] as const) {
      expect(backendBadge(getPref("secretBackend"), platformName).warning).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Step 5 — no src/zotero/ export writes a SecretId value through PrefStore
// ---------------------------------------------------------------------------

/** Every `.ts` file under `src/zotero/`, as repository-relative paths. */
function zoteroSources(dir = join(REPO, "src/zotero")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return zoteroSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The runtime exports of `src/zotero/keychain.ts`, each classified. A new
 * export fails the first test below until it is put in one list or the other,
 * so it cannot escape the write check by being added after it.
 */
const EXERCISED = [
  "setSecret",
  "getSecret",
  "hasSecret",
  "clearSecret",
  "listStoredIds",
  "refreshKeyPresence",
  "reconcileKeyPresence",
  "clearAllSecrets",
  "clearAllSecretsOnUninstall",
  "probeKeystore",
  "probeAndRecordBackend",
  "createKeychainSecretStore",
  "createSessionSecretStore",
  "adoptSessionSecretStore",
  "reconcileSessionKeyPresence",
  "clearSessionSecrets",
  // P3-T14: the validation status pair (docs/07 §8.5), written as an enum
  // and an ISO time, never a value.
  "recordValidation",
  "resetValidation",
  "markProviderKeyRejected",
] as const;

/** Exports no value passes through: constants, pure lookups, the removal primitive. */
const VALUE_FREE = [
  "SECRET_IDS",
  "LOGIN_ORIGIN",
  "LOGIN_REALM",
  "KEY_PRESENCE_PREFS",
  "SECRET_BACKEND_UNAVAILABLE",
  "SECRET_BACKEND_PREF_VALUES",
  "removeLogin",
  "loginRemovalMethod",
  "keyPresencePrefFor",
  "secretIdsForFlag",
  "keyPresenceFlags",
  "deriveKeyPresence",
  "deriveAllKeyPresence",
  "secretBackendPrefValue",
  "VALIDATION_PREFS",
  "readValidation",
] as const;

describe("no src/zotero/ export writes a SecretId value through PrefStore (P3-T03 step 5)", () => {
  it("keychain.ts is the only src/zotero/ module that handles a SecretId, and its exports are all classified", () => {
    const handlers = zoteroSources()
      .filter((path) =>
        /\bSecretId\b|\bSecretStore\b|\bSECRET_IDS\b/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => path.slice(REPO.length + 1).replace(/\\/g, "/"));
    expect(
      handlers,
      "a second src/zotero/ module that handles a SecretId needs its exports added to this check",
    ).toEqual(["src/zotero/keychain.ts"]);

    expect(Object.keys(keychain).sort()).toEqual(
      [...EXERCISED, ...VALUE_FREE].sort(),
    );
  });

  it("writes only boolean flags and the backend name while every value-handling export runs", async () => {
    const prefs = recordingPrefStore(allFlags(true));
    setPrefStore(prefs);
    const values = new Map(
      SECRET_IDS.map((id) => [id, synthetic(id)] as const),
    );

    // Tier 1, through the module functions and through the store object.
    for (const [id, value] of values) await keychain.setSecret(id, value);
    for (const [id, value] of values) {
      expect(await keychain.getSecret(id)).toBe(value);
      expect(await keychain.hasSecret(id)).toBe(true);
    }
    expect([...(await keychain.listStoredIds())].sort()).toEqual(
      [...SECRET_IDS].sort(),
    );
    for (const id of SECRET_IDS) await keychain.refreshKeyPresence(id);
    await keychain.reconcileKeyPresence();
    expect((await keychain.probeKeystore()).backend).toBe("os-keychain");
    await keychain.probeAndRecordBackend();
    const tierOne = keychain.createKeychainSecretStore();
    await tierOne.set("llm.openai", values.get("llm.openai") ?? "");
    expect(await keychain.clearSecret("source.ncbi")).toBe(1);
    expect(await keychain.clearAllSecrets()).toBe(SECRET_IDS.length - 1);
    for (const [id, value] of values) await keychain.setSecret(id, value);
    expect(await keychain.clearAllSecretsOnUninstall()).toBe(SECRET_IDS.length);
    // P3-T14: the validation status pair.
    expect(
      keychain.recordValidation("llm.openai", "ok", "2026-10-23T09:00:00.000Z"),
    ).toBe(true);
    expect(keychain.markProviderKeyRejected("anthropic", 0)).toBe(true);
    keychain.resetValidation("source.ncbi");
    expect(keychain.readValidation("tts.gemini")).toBeUndefined();

    // Tier 2.
    await keychain.reconcileSessionKeyPresence();
    const session = keychain.adoptSessionSecretStore();
    const sessionToo = keychain.createSessionSecretStore();
    for (const [id, value] of values) await session.set(id, value);
    for (const [id, value] of values)
      expect(await sessionToo.get(id)).toBe(value);
    await session.clear("llm.gemini");
    expect(await session.clearAll()).toBe(SECRET_IDS.length - 1);
    for (const [id, value] of values) await session.set(id, value);
    expect(keychain.clearSessionSecrets()).toBe(SECRET_IDS.length);

    expect(prefs.writes.length).toBeGreaterThan(0);
    const flagKeys = new Set<string>(
      keychain.keyPresenceFlags().map((flag) => PREFS[flag].key),
    );
    const validationNames = Object.values(keychain.VALIDATION_PREFS);
    const resultKeys = new Set<string>(
      validationNames.map((names) => PREFS[names.result].key),
    );
    const atKeys = new Set<string>(
      validationNames.map((names) => PREFS[names.at].key),
    );
    const forbidden = [...values.values()].flatMap((value) => [
      value,
      platform.encryptedForm(value),
    ]);
    for (const [key, written] of prefs.writes) {
      const name = prefNameOf(key);
      expect(name, `${key} is not a schema row`).toBeDefined();
      if (name === undefined) continue;
      const def: PrefDef<unknown> = PREFS[name];
      expect(def.secret ?? false, key).toBe(false);
      if (flagKeys.has(key)) {
        expect(typeof written, key).toBe("boolean");
      } else if (resultKeys.has(key)) {
        expect(["ok", "rejected", "forbidden", "inconclusive", ""]).toContain(
          written,
        );
      } else if (atKeys.has(key)) {
        expect(String(written), key).toMatch(
          /^(?:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/,
        );
      } else {
        expect(key).toBe(PREFS.secretBackend.key);
        expect(["oskeystore", "session", ""]).toContain(written);
      }
      for (const value of forbidden) {
        expect(String(written).includes(value), `${key} holds a key`).toBe(
          false,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Step 2 — the dialog, and installSecretStore on a failed probe
// ---------------------------------------------------------------------------

describe("openSecretBackendDialog (P3-T03 step 2)", () => {
  function recordingHost(window: unknown = { focus: () => undefined }) {
    const calls: unknown[][] = [];
    return {
      calls,
      openDialog: (...args: unknown[]): unknown => {
        calls.push(args);
        return window;
      },
    };
  }

  function argsOf(host: ReturnType<typeof recordingHost>): {
    onChoice(choice: string): void;
  } {
    return host.calls[0]?.[3] as { onChoice(choice: string): void };
  }

  it("opens the document over the host window and resolves with the first choice only", async () => {
    const host = recordingHost();
    const choice = openSecretBackendDialog(host);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]?.slice(0, 3)).toEqual([
      SECRET_BACKEND_DIALOG_URL,
      SECRET_BACKEND_DIALOG_NAME,
      SECRET_BACKEND_DIALOG_FEATURES,
    ]);
    expect(SECRET_BACKEND_DIALOG_URL).toBe(
      "chrome://research-helper/content/secretBackend.xhtml",
    );
    argsOf(host).onChoice("session");
    argsOf(host).onChoice("none");
    await expect(choice).resolves.toBe("session");
  });

  it("reads an answer it does not know as none, which stores nothing", async () => {
    const host = recordingHost();
    const choice = openSecretBackendDialog(host);
    argsOf(host).onChoice("passphrase");
    await expect(choice).resolves.toBe("none");
  });

  it("rejects when no window opens, rather than choosing for the user", async () => {
    await expect(openSecretBackendDialog(recordingHost(null))).rejects.toThrow(
      /returned no window/,
    );
  });

  it("offers exactly session and none: no passphrase tier, no plaintext tier", () => {
    expect([...SECRET_BACKEND_CHOICES]).toEqual(["session", "none"]);
  });
});

describe("installSecretStore on a failed probe (P3-T03 step 2)", () => {
  const KEYCHAIN = "../../../src/zotero/keychain";

  type InstallSecretStore =
    typeof import("../../../src/bootstrap/container").installSecretStore;

  function fakeKeychain() {
    const order: string[] = [];
    return {
      order,
      probeAndRecordBackend: vi.fn(() =>
        Promise.resolve({
          backend: "unavailable",
          failure: "encrypt-threw",
          detail: "Error: synthetic",
          elapsedMs: 0,
        }),
      ),
      createKeychainSecretStore: vi.fn(() => ({ backend: "os-keychain" })),
      reconcileKeyPresence: vi.fn(() => Promise.resolve(new Map())),
      reconcileSessionKeyPresence: vi.fn(() => {
        order.push("reset flags");
        return Promise.resolve(new Map());
      }),
      adoptSessionSecretStore: vi.fn(() => {
        order.push("adopt session");
        return { backend: "session-only", unattended: false };
      }),
      clearSessionSecrets: vi.fn(() => 0),
    };
  }

  function quietLogger(): Parameters<InstallSecretStore>[0] {
    const logger = {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
      child: () => logger,
      time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
    };
    return logger;
  }

  async function loadWith(
    fake: ReturnType<typeof fakeKeychain>,
  ): Promise<InstallSecretStore> {
    vi.resetModules();
    vi.doMock(KEYCHAIN, () => fake);
    return (await import("../../../src/bootstrap/container"))
      .installSecretStore;
  }

  afterEach(() => {
    vi.doUnmock(KEYCHAIN);
    vi.resetModules();
  });

  /** Let every pending promise callback run. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }

  it("shows the dialog, installs no store until a choice is made, then installs tier 2 on session", async () => {
    const fake = fakeKeychain();
    const installSecretStore = await loadWith(fake);
    let answer: (choice: SecretBackendChoice) => void = () => undefined;
    const chooseSecretBackend = vi.fn(() => {
      fake.order.push("dialog shown");
      return new Promise<SecretBackendChoice>((resolve) => {
        answer = resolve;
      });
    });
    const deferred: string[] = [];
    let installed: unknown = "pending";

    const pending = installSecretStore(quietLogger(), {
      chooseSecretBackend,
      scope: {
        defer: (description: string) => void deferred.push(description),
      },
    }).then((store) => {
      installed = store;
    });
    await settle();

    expect(chooseSecretBackend).toHaveBeenCalledTimes(1);
    expect(installed).toBe("pending");
    expect(fake.adoptSessionSecretStore).not.toHaveBeenCalled();
    expect(fake.createKeychainSecretStore).not.toHaveBeenCalled();
    expect(deferred).toEqual([]);

    answer("session");
    await pending;

    expect(installed).toEqual({ backend: "session-only", unattended: false });
    expect(fake.order).toEqual([
      "reset flags",
      "dialog shown",
      "adopt session",
    ]);
    expect(deferred).toHaveLength(1);
    expect(fake.reconcileKeyPresence).not.toHaveBeenCalled();
  });

  it("installs nothing when the user declines, and still resets the flags", async () => {
    const fake = fakeKeychain();
    const installSecretStore = await loadWith(fake);
    const store = await installSecretStore(quietLogger(), {
      chooseSecretBackend: () => Promise.resolve("none"),
    });
    expect(store).toBeUndefined();
    expect(fake.adoptSessionSecretStore).not.toHaveBeenCalled();
    expect(fake.reconcileSessionKeyPresence).toHaveBeenCalledTimes(1);
  });

  it("installs nothing when the dialog cannot be shown", async () => {
    const fake = fakeKeychain();
    const installSecretStore = await loadWith(fake);
    const store = await installSecretStore(quietLogger(), {
      chooseSecretBackend: () => Promise.reject(new Error("no main window")),
    });
    expect(store).toBeUndefined();
    expect(fake.adoptSessionSecretStore).not.toHaveBeenCalled();
  });

  it("never falls back to tier 2 silently: with no dialog to ask, no store is installed", async () => {
    const fake = fakeKeychain();
    const installSecretStore = await loadWith(fake);
    expect(await installSecretStore(quietLogger())).toBeUndefined();
    expect(fake.adoptSessionSecretStore).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The dialog's document and window script
// ---------------------------------------------------------------------------

describe("addon/content/secretBackend.xhtml and secretBackend.js (P3-T03)", () => {
  const XHTML = readFileSync(
    join(REPO, "addon/content/secretBackend.xhtml"),
    "utf8",
  );
  const SCRIPT = readFileSync(
    join(REPO, "addon/content/secretBackend.js"),
    "utf8",
  );

  it("declares every dialog string on the main-window surface and on KO_PRESENT (owner-reviewed 2026-10-22, G-41)", () => {
    for (const id of Object.values(SECRET_BACKEND_DIALOG_L10N)) {
      expect(MAIN_WINDOW_MESSAGE_IDS as readonly string[]).toContain(id);
      expect(KO_PRESENT as readonly string[]).toContain(id);
    }
  });

  it("binds the three paragraphs in the document and the other three in the script", () => {
    const { explain, session, none, title, accept, decline } =
      SECRET_BACKEND_DIALOG_L10N;
    for (const id of [explain, session, none]) {
      expect(XHTML).toContain(`data-l10n-id="${id}"`);
    }
    for (const id of [title, accept, decline]) {
      expect(SCRIPT).toContain(`"${id}"`);
    }
    expect(XHTML).toContain(`id="${SECRET_BACKEND_DIALOG_ROOT_ID}"`);
    expect(XHTML).toContain('defaultButton="cancel"');
    expect(XHTML).toContain('href="__addonRef__-mainWindow.ftl"');
    expect(XHTML).not.toMatch(/<script>[^<]/);
  });

  /** Run the window script in a fresh context with a fake window and document. */
  function loadScript(onChoice: (choice: string) => void) {
    const listeners = new Map<string, (() => void)[]>();
    const on = (type: string, handler: () => void): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    };
    const fire = (type: string): void => {
      for (const handler of listeners.get(type) ?? []) handler();
    };
    const attributes = new Map<string, string>();
    const context = createContext({
      window: { arguments: [{ onChoice }], addEventListener: on },
      document: {
        addEventListener: on,
        getElementById: () => ({
          setAttribute: (name: string, value: string) =>
            attributes.set(name, value),
        }),
        l10n: {
          formatMessages: () =>
            Promise.resolve([
              { value: "synthetic title", attributes: [] },
              {
                value: null,
                attributes: [{ name: "label", value: "accept label" }],
              },
              {
                value: null,
                attributes: [{ name: "label", value: "decline label" }],
              },
            ]),
        },
        title: "",
      },
      Zotero: {
        UIProperties: { registerRoot: () => undefined },
        debug: () => undefined,
      },
    });
    runInContext(SCRIPT, context);
    fire("load");
    return { fire, attributes, context };
  }

  it("reports session once on accept, and the unload after it does not report none", () => {
    const choices: string[] = [];
    const { fire } = loadScript((choice) => choices.push(choice));
    fire("dialogaccept");
    fire("unload");
    expect(choices).toEqual(["session"]);
  });

  it("reports none on cancel, and none when the window is simply closed", () => {
    const cancelled: string[] = [];
    loadScript((choice) => cancelled.push(choice)).fire("dialogcancel");
    expect(cancelled).toEqual(["none"]);

    const closed: string[] = [];
    loadScript((choice) => closed.push(choice)).fire("unload");
    expect(closed).toEqual(["none"]);
  });

  it("sets the two button labels from Fluent", async () => {
    const { attributes } = loadScript(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attributes.get("buttonlabelaccept")).toBe("accept label");
    expect(attributes.get("buttonlabelcancel")).toBe("decline label");
  });
});

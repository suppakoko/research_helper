/**
 * `P3-T02` steps 1–2: the key-presence table and the rule that derives each
 * flag, without a keystore.
 *
 * **Nothing here touches the OS keystore or the login manager.** The functions
 * under test take the existence check as a parameter, and each test passes a
 * check backed by a plain set of ids. No value, synthetic or real, is stored.
 * The round trip through the real keystore is
 * `test/integration/zotero/keychain.spec.ts`.
 *
 * **Why `Components` is stubbed.** `src/zotero/keychain.ts` builds the
 * login-info constructor in its module body, and `Components` exists only in
 * the Zotero sandbox. The stub gives that one call something to return. Nothing
 * in this file calls the constructor.
 */

import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).Components = {
    Constructor: () =>
      function unusedLoginInfo(): never {
        throw new Error("the login-info constructor is not used in unit tests");
      },
    interfaces: { nsILoginInfo: {} },
  };
});

import { SECRET_IDS, type SecretId } from "../../../src/core/secretStore";
import { PREFS, type PrefDef } from "../../../src/prefs";
import {
  KEY_PRESENCE_PREFS,
  deriveAllKeyPresence,
  deriveKeyPresence,
  keyPresenceFlags,
  keyPresencePrefFor,
  secretIdsForFlag,
} from "../../../src/zotero/keychain";

afterAll(() => {
  delete (globalThis as Record<string, unknown>).Components;
});

/** An existence check over a set of ids. */
function storedIds(...ids: SecretId[]): (id: SecretId) => Promise<boolean> {
  const set = new Set(ids);
  return (id) => Promise.resolve(set.has(id));
}

/** Every flag false, as a plain object, for readable equality checks. */
const ALL_FALSE = {
  openrouterKeyPresent: false,
  openaiKeyPresent: false,
  geminiKeyPresent: false,
  anthropicKeyPresent: false,
  ncbiKeyPresent: false,
  semanticscholarKeyPresent: false,
} as const;

describe("KEY_PRESENCE_PREFS (P3-T02 step 1)", () => {
  it("maps all seven ids to docs/07 §8.5's six flags, tts.gemini sharing Gemini's", () => {
    expect(KEY_PRESENCE_PREFS).toEqual({
      "llm.openrouter": "openrouterKeyPresent",
      "llm.openai": "openaiKeyPresent",
      "llm.gemini": "geminiKeyPresent",
      "llm.anthropic": "anthropicKeyPresent",
      "tts.gemini": "geminiKeyPresent",
      "source.ncbi": "ncbiKeyPresent",
      "source.semanticscholar": "semanticscholarKeyPresent",
    });
    for (const id of SECRET_IDS) {
      expect(keyPresencePrefFor(id)).toBeDefined();
    }
    expect(keyPresenceFlags()).toHaveLength(6);
  });

  it("names only boolean, non-secret <provider>.keyPresent rows", () => {
    for (const flag of keyPresenceFlags()) {
      const def: PrefDef<unknown> = PREFS[flag];
      expect(def.key).toMatch(/^[a-z]+\.keyPresent$/);
      expect(def.type).toBe("boolean");
      expect(def.secret).not.toBe(true);
    }
  });

  it("lists both Gemini ids for geminiKeyPresent and one id for every other flag", () => {
    expect(secretIdsForFlag("geminiKeyPresent")).toEqual([
      "llm.gemini",
      "tts.gemini",
    ]);
    expect(secretIdsForFlag("openrouterKeyPresent")).toEqual([
      "llm.openrouter",
    ]);
    expect(secretIdsForFlag("ncbiKeyPresent")).toEqual(["source.ncbi"]);
  });
});

describe("deriving a flag from the keystore (P3-T02 step 2)", () => {
  it("reads every flag false when nothing is stored", async () => {
    const flags = await deriveAllKeyPresence(storedIds());
    expect(Object.fromEntries(flags)).toEqual(ALL_FALSE);
  });

  it("sets only openrouterKeyPresent for an OpenRouter key", async () => {
    const flags = await deriveAllKeyPresence(storedIds("llm.openrouter"));
    expect(Object.fromEntries(flags)).toEqual({
      ...ALL_FALSE,
      openrouterKeyPresent: true,
    });
  });

  it("sets geminiKeyPresent from either Gemini id alone", async () => {
    await expect(
      deriveKeyPresence("geminiKeyPresent", storedIds("llm.gemini")),
    ).resolves.toBe(true);
    await expect(
      deriveKeyPresence("geminiKeyPresent", storedIds("tts.gemini")),
    ).resolves.toBe(true);
    await expect(
      deriveKeyPresence("geminiKeyPresent", storedIds("llm.openai")),
    ).resolves.toBe(false);
  });

  it("sets every flag when every id is stored", async () => {
    const flags = await deriveAllKeyPresence(storedIds(...SECRET_IDS));
    expect([...flags.values()]).toEqual([true, true, true, true, true, true]);
  });

  it("propagates a failed existence check instead of guessing a value", async () => {
    const failing = (): Promise<boolean> =>
      Promise.reject(new Error("login store unreadable"));
    await expect(deriveAllKeyPresence(failing)).rejects.toThrow(
      "login store unreadable",
    );
  });
});

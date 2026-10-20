/**
 * `P3-T02` step 3: `clearEveryStoredId`, the one `clearAll()` sweep every
 * `SecretStore` tier delegates to.
 *
 * Driven through an in-memory store that holds ids only. No value is ever
 * stored here, synthetic or otherwise: the sweep never reads one.
 */

import { describe, expect, it } from "vitest";

import {
  clearEveryStoredId,
  type SecretId,
  type SecretStore,
} from "../../../src/core/secretStore";

/** The two port members the sweep uses, over a set of ids. */
function idStore(
  ids: readonly SecretId[],
  failOn: readonly SecretId[] = [],
): Pick<SecretStore, "listStoredIds" | "clear"> & {
  readonly stored: Set<SecretId>;
  readonly attempts: SecretId[];
} {
  const stored = new Set<SecretId>(ids);
  const attempts: SecretId[] = [];
  return {
    stored,
    attempts,
    listStoredIds: () => Promise.resolve([...stored]),
    clear: (id) => {
      attempts.push(id);
      if (failOn.includes(id)) {
        return Promise.reject(new Error(`removal refused for ${id}`));
      }
      stored.delete(id);
      return Promise.resolve();
    },
  };
}

describe("clearEveryStoredId (P3-T02)", () => {
  it("clears three stored ids, resolves to 3 and leaves nothing listed", async () => {
    const store = idStore(["llm.openrouter", "tts.gemini", "source.ncbi"]);
    await expect(clearEveryStoredId(store)).resolves.toBe(3);
    expect(await store.listStoredIds()).toEqual([]);
  });

  it("resolves to 0 and clears nothing when nothing is stored", async () => {
    const store = idStore([]);
    await expect(clearEveryStoredId(store)).resolves.toBe(0);
    expect(store.attempts).toEqual([]);
  });

  it("keeps sweeping past a failed id, then throws naming only the failed id", async () => {
    const store = idStore(
      ["llm.openai", "llm.anthropic", "source.semanticscholar"],
      ["llm.anthropic"],
    );
    const failure = await clearEveryStoredId(store).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    expect(error.message).toContain("1 of 3");
    expect(error.message).toContain("llm.anthropic");
    expect(error.message).not.toContain("llm.openai");
    expect((error.cause as Error).message).toBe(
      "removal refused for llm.anthropic",
    );
    // Every id was tried, and only the refused one is left.
    expect(store.attempts).toEqual([
      "llm.openai",
      "llm.anthropic",
      "source.semanticscholar",
    ]);
    expect([...store.stored]).toEqual(["llm.anthropic"]);
  });
});

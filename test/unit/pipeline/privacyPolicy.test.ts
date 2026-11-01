/**
 * `P3-T15`: privacy modes, the egress disclosure, the Gemini free-tier warning,
 * `collection_settings` and the egress log (`docs/09` §3.5, §3.6; `docs/07`
 * §4.5's `PrivacyPolicy`, declared by the owner on 2026-10-21, `plan/00` §6
 * item 267).
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network, no live LLM call. The
 * `collection_settings` store runs against a real SQLite (`node:sqlite`, as
 * `test/unit/zotero/userPriceStore.test.ts` does) migrated by the shipped
 * `runMigrations`. Every key below is SYNTHETIC and built at run time.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  COLLECTION_SETTINGS_DDL,
  LATEST_SCHEMA_VERSION,
  runMigrations,
} from "../../../src/bootstrap/migrations";
import { createMemoryPrefStore } from "../../../src/core/config";
import { PolicyViolationError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  createJobRecord,
  toJobRow,
} from "../../../src/core/jobQueue/jobRecord";
import type { HttpClient, HttpResponse } from "../../../src/core/http/client";
import type { SecretStore } from "../../../src/core/secretStore";
import {
  L10N_EGRESS_FIRST_JOB_NOTICE,
  L10N_EGRESS_GEMINI_DECLARED_PAID,
  L10N_EGRESS_GEMINI_FREE_TIER,
  L10N_EGRESS_REPORT_NOTICE,
} from "../../../src/i18n/keys";
import { readModelList } from "../../../src/llm/gemini/mapper";
import { createOpenRouterProvider } from "../../../src/llm/openrouter/openRouterProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type { ChatRequest, ModelInfo } from "../../../src/llm/types";
import {
  buildEgressDisclosure,
  createEgressResumeGuard,
  egressLogEntry,
  type EgressDisclosure,
  type EgressDisclosureInput,
  mustAskConfirmation,
  readEgressLog,
  routineConfirmationFor,
  settleDisclosure,
  withEgressLog,
} from "../../../src/pipeline/shared/egressDisclosure";
import {
  allowedInputScope,
  assertModelAllowed,
  createPrivacyPolicy,
  effectiveMode,
  loadPrivacyPolicy,
  loadStrictestPrivacyPolicy,
  type ModelRoute,
  modelRouteFor,
  planInputScopeKind,
  PRIVACY_MODES,
  type PrivacyMode,
  readCollectionPrivacySettings,
  routingHints,
  writeCollectionPrivacySettings,
} from "../../../src/pipeline/shared/privacyPolicy";
import { getPrefStore, setPrefStore } from "../../../src/prefs";
import {
  createCollectionSettingsStore,
  type CollectionSettingsStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
const read = (path: string): string =>
  readFileSync(resolve(ROOT, path), "utf8");

/** SYNTHETIC: a credential-shaped string, built at run time. */
const SYNTHETIC_KEY = ["sk", "or", "v1", "0123456789abcdef".repeat(4)].join(
  "-",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function model(
  trainsOnInputByDefault: unknown,
  id = "vendor/model-x",
): ModelInfo {
  return {
    id,
    displayName: id,
    contextWindowTokens: 100_000,
    maxOutputTokens: 4_000,
    supportsJsonSchema: true,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: {
      trainsOnInputByDefault,
      retention: { days: "unknown", note: "SYNTHETIC" },
    } as ModelInfo["dataPolicy"],
  };
}

const NO_OVERRIDE = createBaseUrlResolver({ override: () => "" });

function disclosure(
  overrides: Partial<EgressDisclosureInput> = {},
  acknowledged = false,
): EgressDisclosure {
  return buildEgressDisclosure(
    {
      providerId: "openrouter",
      modelId: "anthropic/claude-sonnet-5",
      privacyMode: "balanced",
      items: ["abstract", "abstract"],
      ...overrides,
    },
    { baseUrls: NO_OVERRIDE, egressAcknowledged: () => acknowledged },
  );
}

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
}

function sqlite(): Connection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  };
}

async function migratedStore(): Promise<{
  connection: Connection;
  store: CollectionSettingsStore;
}> {
  const connection = sqlite();
  await runMigrations(connection);
  return { connection, store: createCollectionSettingsStore(connection) };
}

const COLLECTION = { libraryID: 1, collectionKey: "ABCD2345" };

// ---------------------------------------------------------------------------
// 1. effectiveMode — only ever stricter
// ---------------------------------------------------------------------------

describe("effectiveMode — a per-collection setting can only be stricter (docs/09 §3.5)", () => {
  it("meets the card's two Done-when lines", () => {
    expect(effectiveMode("balanced", "strict")).toBe("strict");
    expect(effectiveMode("strict", "full")).toBe("strict");
  });

  it("returns the stricter of the two for all nine pairs, and the global mode with no override", () => {
    for (const global of PRIVACY_MODES) {
      expect(effectiveMode(global, undefined)).toBe(global);
      for (const override of PRIVACY_MODES) {
        const expected =
          PRIVACY_MODES[
            Math.min(
              PRIVACY_MODES.indexOf(global),
              PRIVACY_MODES.indexOf(override),
            )
          ];
        expect(effectiveMode(global, override)).toBe(expected);
      }
    }
  });

  it("fails closed: a mode this build does not know counts as strict on either side", () => {
    const later = "local-only" as PrivacyMode;
    expect(effectiveMode("full", later)).toBe("strict");
    expect(effectiveMode(later, undefined)).toBe("strict");
  });

  it("builds a policy whose mode is the effective one and whose checks are the three functions", () => {
    const policy = createPrivacyPolicy("full", "balanced");
    expect(policy.mode).toBe("balanced");
    expect(policy.effectiveMode).toBe(effectiveMode);
    expect(policy.allowedInputScope).toBe(allowedInputScope);
    expect(policy.assertModelAllowed).toBe(assertModelAllowed);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(createPrivacyPolicy("strict", "full").mode).toBe("strict");
  });
});

// ---------------------------------------------------------------------------
// 2. allowedInputScope and the plan
// ---------------------------------------------------------------------------

describe("allowedInputScope — what a job may send (docs/09 §3.5's table)", () => {
  it("forces fullTextMode to never in strict, and keeps the run's choice otherwise (auto by default)", () => {
    expect(
      allowedInputScope("strict", { fullTextMode: "always" }).fullTextMode,
    ).toBe("never");
    expect(allowedInputScope("strict").fullTextMode).toBe("never");
    expect(allowedInputScope("balanced").fullTextMode).toBe("auto");
    expect(
      allowedInputScope("balanced", { fullTextMode: "always" }).fullTextMode,
    ).toBe("always");
    expect(
      allowedInputScope("full", { fullTextMode: "never" }).fullTextMode,
    ).toBe("never");
  });

  it("sends notes, annotations and collection and tag names only under full, and only with their own opt-in", () => {
    const all = {
      optIns: { notes: true, annotations: true, collectionAndTagNames: true },
    };
    for (const mode of ["strict", "balanced"] as const) {
      expect(allowedInputScope(mode, all)).toMatchObject({
        notes: false,
        annotations: false,
        collectionAndTagNames: false,
      });
    }
    expect(allowedInputScope("full")).toMatchObject({
      notes: false,
      annotations: false,
      collectionAndTagNames: false,
    });
    expect(allowedInputScope("full", all)).toMatchObject({
      notes: true,
      annotations: true,
      collectionAndTagNames: true,
    });
    expect(
      allowedInputScope("full", { optIns: { notes: true } }),
    ).toMatchObject({
      notes: true,
      annotations: false,
      collectionAndTagNames: false,
    });
  });

  it("plans a full-text item as abstract in strict mode (the card's Done-when line)", () => {
    const source = { tier: "fulltext_pdf" as const, abstract: "An abstract." };
    expect(planInputScopeKind(allowedInputScope("strict"), source)).toBe(
      "abstract",
    );
    expect(
      planInputScopeKind(allowedInputScope("strict"), {
        tier: "fulltext_epmc",
        abstract: "An abstract.",
      }),
    ).toBe("abstract");
    expect(planInputScopeKind(allowedInputScope("balanced"), source)).toBe(
      "abstract+fulltext",
    );
  });

  it("plans metadata-only when there is no abstract to fall back to", () => {
    const strict = allowedInputScope("strict");
    expect(
      planInputScopeKind(strict, { tier: "fulltext_pdf", abstract: null }),
    ).toBe("metadata-only");
    expect(
      planInputScopeKind(strict, { tier: "fulltext_pdf", abstract: "  " }),
    ).toBe("metadata-only");
    expect(
      planInputScopeKind(allowedInputScope("full"), {
        tier: "metadata_only",
        abstract: null,
      }),
    ).toBe("metadata-only");
    expect(
      planInputScopeKind(allowedInputScope("full"), {
        tier: "abstract",
        abstract: "A.",
      }),
    ).toBe("abstract");
  });

  it("names the four kinds docs/07 §5.2's SummaryInputScope declares", () => {
    const docs = read("docs/07-architecture-and-data-model.md");
    const start = docs.indexOf("export type SummaryInputScope =");
    const block = docs.slice(
      start,
      docs.indexOf(";", docs.indexOf("abstract+notes", start)),
    );
    const kinds = [...block.matchAll(/kind: "([^"]+)"/g)].map((m) => m[1]);
    const planned: string[] = [];
    const allowed = [
      allowedInputScope("strict"),
      allowedInputScope("balanced"),
    ];
    for (const a of allowed) {
      planned.push(
        planInputScopeKind(a, { tier: "fulltext_pdf", abstract: "A." }),
      );
      planned.push(
        planInputScopeKind(a, { tier: "metadata_only", abstract: null }),
      );
    }
    expect(kinds).toEqual([
      "metadata-only",
      "abstract",
      "abstract+fulltext",
      "abstract+notes",
    ]);
    for (const kind of planned) expect(kinds).toContain(kind);
  });
});

// ---------------------------------------------------------------------------
// 3. assertModelAllowed
// ---------------------------------------------------------------------------

describe("assertModelAllowed — the data policy against the mode (docs/09 §3.4 rule 3, §3.5)", () => {
  it("throws PolicyViolationError for an unknown policy in strict, and only warns in balanced (Done-when)", () => {
    expect(() => assertModelAllowed(model("unknown"), "strict")).toThrow(
      PolicyViolationError,
    );
    expect(assertModelAllowed(model("unknown"), "balanced")).toStrictEqual({
      warnings: ["data-policy-unknown"],
      requiresConfirmation: false,
    });
  });

  it("allows an unknown policy in full with no warning, as §3.5's table says", () => {
    expect(assertModelAllowed(model("unknown"), "full")).toStrictEqual({
      warnings: [],
      requiresConfirmation: false,
    });
  });

  it("refuses a model that may train in strict and balanced, and warns and asks in full", () => {
    for (const mode of ["strict", "balanced"] as const) {
      expect(() => assertModelAllowed(model("yes"), mode)).toThrow(
        PolicyViolationError,
      );
    }
    expect(assertModelAllowed(model("yes"), "full")).toStrictEqual({
      warnings: ["may-train-on-input"],
      requiresConfirmation: true,
    });
  });

  it("allows a model that does not train in every mode, with no warning", () => {
    for (const mode of PRIVACY_MODES) {
      expect(assertModelAllowed(model("no"), mode)).toStrictEqual({
        warnings: [],
        requiresConfirmation: false,
      });
    }
  });

  it("guesses no policy: a missing or unrecognised value is unknown", () => {
    for (const value of [undefined, "maybe", null]) {
      expect(() => assertModelAllowed(model(value), "strict")).toThrow(
        PolicyViolationError,
      );
      expect(assertModelAllowed(model(value), "balanced").warnings).toEqual([
        "data-policy-unknown",
      ]);
    }
  });

  it("names the mode, the model and the policy in the error's context, with the POLICY code", () => {
    let caught: unknown;
    try {
      assertModelAllowed(model("unknown", "vendor/m"), "strict");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    const error = caught as PolicyViolationError;
    expect(error.code).toBe("POLICY");
    expect(error.context).toStrictEqual({
      mode: "strict",
      modelId: "vendor/m",
      trainsOnInputByDefault: "unknown",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. The OpenRouter provider block (step 4)
// ---------------------------------------------------------------------------

describe("routingHints — the mode reaches OpenRouter's provider block (step 4, docs/09 §3.4 rule 1)", () => {
  it("asks for zero retention in strict mode only, and for no training in every mode", () => {
    expect(routingHints("strict")).toStrictEqual({
      requireNoTraining: true,
      requireZeroRetention: true,
    });
    expect(routingHints("balanced")).toStrictEqual({ requireNoTraining: true });
    expect(routingHints("full")).toStrictEqual({ requireNoTraining: true });
  });

  it("sends zdr: true for a strict collection through the real adapter, even with a balanced global mode", async () => {
    const bodies: unknown[] = [];
    const http: HttpClient = {
      request(_method, url, options) {
        bodies.push(JSON.parse(String(options?.body)));
        const response: HttpResponse = {
          status: 200,
          url,
          body: JSON.stringify({
            model: "m",
            choices: [{ finish_reason: "stop", message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          rawHeaders: "",
        } as HttpResponse;
        return Promise.resolve(response);
      },
    };
    const secrets = {
      backend: "test",
      unattended: true,
      get: () => Promise.resolve(SYNTHETIC_KEY),
      set: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      has: () => Promise.resolve(true),
      listStoredIds: () => Promise.resolve([]),
      clearAll: () => Promise.resolve(0),
    } as unknown as SecretStore;
    const provider = createOpenRouterProvider({
      secrets,
      baseUrls: NO_OVERRIDE,
      http,
      privacyMode: () => "balanced",
    });
    const token = createCancellationTokenSource().token;
    const request = (mode: PrivacyMode): ChatRequest => ({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      routing: routingHints(createPrivacyPolicy("balanced", mode).mode),
      traceId: "t",
    });
    await provider.chat(request("strict"), { token });
    await provider.chat(request("balanced"), { token });
    // `chatStream` builds the same body (`chatBody`, `P3-T11`); the stub's
    // answer is not a stream, so only the request it sent is checked.
    const stream = provider.chatStream?.(request("strict"), { token });
    expect(stream).toBeDefined();
    try {
      for await (const chunk of stream ?? []) void chunk;
    } catch {
      // The decoder refusing a non-stream body is not under test here.
    }
    const blocks = bodies.map((b) => (b as { provider: unknown }).provider);
    expect(blocks[0]).toStrictEqual({ data_collection: "deny", zdr: true });
    expect(blocks[1]).toStrictEqual({ data_collection: "deny" });
    expect(bodies[2]).toMatchObject({
      stream: true,
      provider: { data_collection: "deny", zdr: true },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. The disclosure (step 5) and privacy.egressAcknowledged
// ---------------------------------------------------------------------------

describe("buildEgressDisclosure — data the cost dialog embeds (docs/09 §3.6 item 1)", () => {
  it("names the effective host: gateway.example under openrouter.baseUrl = https://gateway.example/v1 (Done-when)", () => {
    const baseUrls = createBaseUrlResolver({
      override: (id) =>
        id === "openrouter" ? "https://gateway.example/v1" : "",
    });
    const d = buildEgressDisclosure(
      {
        providerId: "openrouter",
        modelId: "m",
        privacyMode: "balanced",
        items: ["abstract"],
      },
      { baseUrls, egressAcknowledged: () => true },
    );
    expect(d.host).toBe("gateway.example");
    expect(disclosure().host).toBe("openrouter.ai");
  });

  it("carries provider, model, item count, the scope per kind and the mode in force", () => {
    const d = disclosure({
      privacyMode: "full",
      items: ["abstract", "abstract+fulltext", "metadata-only", "abstract"],
    });
    expect(d).toMatchObject({
      providerId: "openrouter",
      modelId: "anthropic/claude-sonnet-5",
      itemCount: 4,
      privacyMode: "full",
      scope: {
        "metadata-only": 1,
        abstract: 2,
        "abstract+fulltext": 1,
        "abstract+notes": 0,
      },
    });
  });

  it("includes the first-job notice only while privacy.egressAcknowledged is false", () => {
    expect(disclosure({}, false).noticeIds).toEqual([
      L10N_EGRESS_FIRST_JOB_NOTICE,
    ]);
    expect(disclosure({}, true).noticeIds).toEqual([]);
    expect(disclosure({}, true).firstJobNotice).toBe(false);
  });

  it("shows the Gemini warning whenever the tier is free or unknown — never suppressed by the acknowledgement", () => {
    for (const acknowledged of [false, true]) {
      for (const tier of ["free-or-unknown", undefined] as const) {
        const d = disclosure(
          {
            providerId: "gemini",
            ...(tier !== undefined && { geminiTier: tier }),
          },
          acknowledged,
        );
        expect(d.geminiFreeTierWarning).toBe(true);
        expect(d.noticeIds).toContain(L10N_EGRESS_GEMINI_FREE_TIER);
      }
    }
    expect(
      disclosure({ providerId: "gemini", geminiTier: "paid" }, true).noticeIds,
    ).toEqual([]);
    expect(
      disclosure({ providerId: "openai" }, true).geminiFreeTierWarning,
    ).toBe(false);
  });

  it("reads privacy.egressAcknowledged from the preference by default", () => {
    const previous = getPrefStore();
    try {
      setPrefStore(
        createMemoryPrefStore({ "privacy.egressAcknowledged": true }),
      );
      const d = buildEgressDisclosure(
        {
          providerId: "openai",
          modelId: "m",
          privacyMode: "balanced",
          items: [],
        },
        { baseUrls: NO_OVERRIDE },
      );
      expect(d.firstJobNotice).toBe(false);
    } finally {
      setPrefStore(previous);
    }
  });
});

describe("settleDisclosure — privacy.egressAcknowledged is written once, on confirm only (Done-when)", () => {
  const previous = getPrefStore();
  afterEach(() => setPrefStore(previous));

  function spyingStore(initial: boolean) {
    const store = createMemoryPrefStore({
      "privacy.egressAcknowledged": initial,
    });
    const writes: [string, unknown][] = [];
    const set = store.set.bind(store);
    store.set = (key, value) => {
      writes.push([key, value]);
      set(key, value);
    };
    setPrefStore(store);
    return { store, writes };
  }

  it("confirming calls setPref for privacy.egressAcknowledged once", () => {
    const { store, writes } = spyingStore(false);
    settleDisclosure(disclosure({}, false), "confirmed");
    expect(writes).toEqual([["privacy.egressAcknowledged", true]]);
    expect(store.values.get("privacy.egressAcknowledged")).toBe(true);
  });

  it("cancelling calls it zero times", () => {
    const { writes } = spyingStore(false);
    settleDisclosure(disclosure({}, false), "cancelled");
    expect(writes).toEqual([]);
  });

  it("with it true, the per-job disclosure and the Gemini warning still render, and confirming writes nothing", () => {
    const { writes } = spyingStore(true);
    const d = buildEgressDisclosure(
      {
        providerId: "gemini",
        modelId: "gemini-3.8-flash",
        privacyMode: "full",
        items: ["abstract"],
      },
      { baseUrls: NO_OVERRIDE },
    );
    expect(d.itemCount).toBe(1);
    expect(d.host).toBe("generativelanguage.googleapis.com");
    expect(d.noticeIds).toEqual([L10N_EGRESS_GEMINI_FREE_TIER]);
    settleDisclosure(d, "confirmed");
    expect(writes).toEqual([]);
  });

  it("uses an injected writer when one is given", () => {
    let calls = 0;
    settleDisclosure(disclosure({}, false), "confirmed", {
      acknowledge: () => (calls += 1),
    });
    settleDisclosure(disclosure({}, false), "cancelled", {
      acknowledge: () => (calls += 1),
    });
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. "Don't ask again for this collection" (step 6)
// ---------------------------------------------------------------------------

describe('mustAskConfirmation — what "don\'t ask again" can never suppress (docs/09 §3.6 item 2)', () => {
  const routine = routineConfirmationFor(disclosure({}, true));

  it("skips only the routine confirmation under the same provider and mode", () => {
    expect(mustAskConfirmation(disclosure({}, true), routine)).toStrictEqual({
      ask: false,
      reasons: [],
    });
    expect(
      mustAskConfirmation(disclosure({}, true), undefined).reasons,
    ).toEqual(["not-suppressed"]);
  });

  it("never suppresses a change of provider or of privacy mode", () => {
    expect(
      mustAskConfirmation(disclosure({ providerId: "openai" }, true), routine)
        .reasons,
    ).toEqual(["provider-changed"]);
    expect(
      mustAskConfirmation(disclosure({ privacyMode: "strict" }, true), routine)
        .reasons,
    ).toEqual(["privacy-mode-changed"]);
  });

  it("never suppresses the first full-text send, and covers full text once it was confirmed", () => {
    const fullText = disclosure({ items: ["abstract+fulltext"] }, true);
    expect(mustAskConfirmation(fullText, routine).reasons).toEqual([
      "first-full-text",
    ]);
    expect(
      mustAskConfirmation(fullText, routineConfirmationFor(fullText)).ask,
    ).toBe(false);
  });

  it("never suppresses the Gemini free-or-unknown warning, nor the first-job notice", () => {
    const gemini = disclosure({ providerId: "gemini" }, true);
    expect(
      mustAskConfirmation(gemini, routineConfirmationFor(gemini)).reasons,
    ).toEqual(["gemini-free-tier"]);
    const first = disclosure({}, false);
    expect(
      mustAskConfirmation(first, routineConfirmationFor(first)).reasons,
    ).toEqual(["first-job-notice"]);
  });
});

// ---------------------------------------------------------------------------
// 7. collection_settings (step 9) and its privacy members
// ---------------------------------------------------------------------------

describe("collection_settings — migration version 5, docs/07 §8.3's statement", () => {
  it("copies collection_settings from docs/07 §8.3 byte for byte, as version 5", async () => {
    const docs = read("docs/07-architecture-and-data-model.md");
    const start = docs.indexOf("CREATE TABLE collection_settings (");
    expect(COLLECTION_SETTINGS_DDL).toBe(
      docs.slice(start, docs.indexOf(";", start)),
    );
    // 6 since P3-T25 appended `summary` after it, 7 since P4-T14 appended `report`.
    expect(LATEST_SCHEMA_VERSION).toBe(7);
    const { connection } = await migratedStore();
    expect(
      connection.db
        .prepare("PRAGMA table_info(collection_settings)")
        .all()
        .map((r) => {
          const c = r as {
            name: string;
            type: string;
            notnull: number;
            pk: number;
          };
          return [c.name, c.type, c.notnull, c.pk];
        }),
    ).toStrictEqual([
      ["library_id", "INTEGER", 1, 1],
      ["collection_key", "TEXT", 1, 2],
      ["json", "TEXT", 1, 0],
    ]);
  });

  it("brings a version-4 file through version 5 without touching user_price", async () => {
    const connection = sqlite();
    await runMigrations(connection, [
      { version: 4, statements: ["CREATE TABLE user_price (model_id TEXT)"] },
    ]);
    connection.db.exec("INSERT INTO user_price VALUES ('kept')");
    expect(await runMigrations(connection)).toStrictEqual({ from: 4, to: 7 });
    expect(
      connection.db.prepare("SELECT * FROM user_price").all(),
    ).toHaveLength(1);
  });

  it("round-trips one object per collection, upserting in place and deleting", async () => {
    const { connection, store } = await migratedStore();
    expect(await store.get(1, "ABCD2345")).toBeUndefined();
    await store.put(1, "ABCD2345", { privacyMode: "strict" });
    await store.put(1, "ABCD2345", { privacyMode: "balanced", model: "x" });
    await store.put(2, "ABCD2345", { privacyMode: "full" });
    expect(await store.get(1, "ABCD2345")).toStrictEqual({
      privacyMode: "balanced",
      model: "x",
    });
    expect(await store.get(2, "ABCD2345")).toStrictEqual({
      privacyMode: "full",
    });
    await store.delete(1, "ABCD2345");
    await store.delete(1, "MISSING1");
    expect(await store.get(1, "ABCD2345")).toBeUndefined();
    expect(
      connection.db
        .prepare("SELECT COUNT(*) AS n FROM collection_settings")
        .get(),
    ).toMatchObject({ n: 1 });
  });

  it("refuses a value that is not an object, a bad key, and an object the redaction gate would change", async () => {
    const { connection, store } = await migratedStore();
    await expect(store.put(1, "K", [] as never)).rejects.toThrow(RangeError);
    await expect(store.put(1.5, "K", {})).rejects.toThrow(RangeError);
    await expect(store.put(1, " ", {})).rejects.toThrow(RangeError);
    await expect(
      store.put(1, "K", { model: `x ${SYNTHETIC_KEY}` }),
    ).rejects.toThrow(/credential/);
    await expect(store.put(1, "K", { apiKey: "k3y-qqqqqqqq" })).rejects.toThrow(
      /credential/,
    );
    const rows = connection.db
      .prepare("SELECT json FROM collection_settings")
      .all();
    expect(rows).toEqual([]);
  });

  it("throws, never reads as absent, when a stored row is not a JSON object", async () => {
    const { connection, store } = await migratedStore();
    for (const text of ["not json", "[1]", "null"]) {
      connection.db
        .prepare(
          "INSERT OR REPLACE INTO collection_settings VALUES (1, 'K', ?)",
        )
        .run(text);
      await expect(store.get(1, "K")).rejects.toThrow(/not a JSON object/);
    }
  });

  it("merges the privacy members into the object, keeping every other member, and removes one with undefined", async () => {
    const { store } = await migratedStore();
    await store.put(1, "ABCD2345", { model: "kept" });
    await writeCollectionPrivacySettings(store, COLLECTION, {
      privacyMode: "strict",
      routineConfirmation: {
        providerId: "openai",
        privacyMode: "strict",
        fullText: false,
      },
    });
    expect(await store.get(1, "ABCD2345")).toStrictEqual({
      model: "kept",
      privacyMode: "strict",
      routineConfirmation: {
        providerId: "openai",
        privacyMode: "strict",
        fullText: false,
      },
    });
    await writeCollectionPrivacySettings(store, COLLECTION, {
      routineConfirmation: undefined,
    });
    expect(await store.get(1, "ABCD2345")).toStrictEqual({
      model: "kept",
      privacyMode: "strict",
    });
  });

  it("reads an unknown override as strict, and a malformed confirmation record as absent", () => {
    expect(readCollectionPrivacySettings(undefined)).toStrictEqual({});
    expect(
      readCollectionPrivacySettings({ privacyMode: "local-only" }),
    ).toStrictEqual({ privacyMode: "strict" });
    expect(readCollectionPrivacySettings({ privacyMode: null })).toStrictEqual(
      {},
    );
    expect(
      readCollectionPrivacySettings({
        routineConfirmation: {
          providerId: "nope",
          privacyMode: "strict",
          fullText: false,
        },
      }),
    ).toStrictEqual({});
    expect(
      readCollectionPrivacySettings({
        routineConfirmation: {
          providerId: "gemini",
          privacyMode: "full",
          fullText: true,
        },
      }),
    ).toStrictEqual({
      routineConfirmation: {
        providerId: "gemini",
        privacyMode: "full",
        fullText: true,
      },
    });
  });

  it("keeps the report run's own record beside the summarize run's, each written and removed alone (P4-T18 step 7, item 292(f))", async () => {
    const { store } = await migratedStore();
    const summarize = {
      providerId: "openai",
      privacyMode: "balanced",
      fullText: false,
    } as const;
    const report = {
      providerId: "openai",
      privacyMode: "balanced",
      fullText: false,
    } as const;
    await writeCollectionPrivacySettings(store, COLLECTION, {
      routineConfirmation: summarize,
    });
    expect(
      readCollectionPrivacySettings(await store.get(1, "ABCD2345")),
    ).toStrictEqual({ routineConfirmation: summarize });
    await writeCollectionPrivacySettings(store, COLLECTION, {
      reportRoutineConfirmation: report,
    });
    expect(
      readCollectionPrivacySettings(await store.get(1, "ABCD2345")),
    ).toStrictEqual({
      routineConfirmation: summarize,
      reportRoutineConfirmation: report,
    });
    await writeCollectionPrivacySettings(store, COLLECTION, {
      reportRoutineConfirmation: undefined,
    });
    expect(
      readCollectionPrivacySettings(await store.get(1, "ABCD2345")),
    ).toStrictEqual({ routineConfirmation: summarize });
    // A malformed report record reads as absent: the report run asks again.
    expect(
      readCollectionPrivacySettings({
        reportRoutineConfirmation: { providerId: "openai" },
      }),
    ).toStrictEqual({});
  });
});

describe("loadPrivacyPolicy — the job's policy, failing closed", () => {
  it("tightens the global mode with a stricter override and ignores a looser one", async () => {
    const { store } = await migratedStore();
    await writeCollectionPrivacySettings(store, COLLECTION, {
      privacyMode: "strict",
    });
    expect(
      (await loadPrivacyPolicy({ globalMode: () => "full", store }, COLLECTION))
        .mode,
    ).toBe("strict");
    await writeCollectionPrivacySettings(store, COLLECTION, {
      privacyMode: "full",
    });
    expect(
      (
        await loadPrivacyPolicy(
          { globalMode: () => "balanced", store },
          COLLECTION,
        )
      ).mode,
    ).toBe("balanced");
  });

  it("uses the global mode for a job with no collection, or a collection with no row", async () => {
    const { store } = await migratedStore();
    expect(
      (await loadPrivacyPolicy({ globalMode: () => "full", store }, undefined))
        .mode,
    ).toBe("full");
    expect(
      (await loadPrivacyPolicy({ globalMode: () => "full", store }, COLLECTION))
        .mode,
    ).toBe("full");
  });

  it("runs strict, with a warning, when the store is missing or cannot read the row", async () => {
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) } as never;
    expect(
      (
        await loadPrivacyPolicy(
          { globalMode: () => "full", store: undefined, logger },
          COLLECTION,
        )
      ).mode,
    ).toBe("strict");
    const { connection, store } = await migratedStore();
    connection.db
      .prepare(
        "INSERT INTO collection_settings VALUES (1, 'ABCD2345', 'not json')",
      )
      .run();
    expect(
      (
        await loadPrivacyPolicy(
          { globalMode: () => "full", store, logger },
          COLLECTION,
        )
      ).mode,
    ).toBe("strict");
    expect(warnings).toHaveLength(2);
  });
});

describe("loadStrictestPrivacyPolicy — an item's collections (plan/00 §6 item 305(a))", () => {
  const STRICT = { libraryID: 1, collectionKey: "STRICT23" };
  const LOOSE = { libraryID: 1, collectionKey: "LOOSE234" };
  const BALANCED = { libraryID: 1, collectionKey: "BALAN234" };
  const NOROW = { libraryID: 1, collectionKey: "NOROW234" };

  async function seeded() {
    const migrated = await migratedStore();
    await writeCollectionPrivacySettings(migrated.store, STRICT, {
      privacyMode: "strict",
    });
    await writeCollectionPrivacySettings(migrated.store, LOOSE, {
      privacyMode: "full",
    });
    await writeCollectionPrivacySettings(migrated.store, BALANCED, {
      privacyMode: "balanced",
    });
    return migrated;
  }

  it("an item in a strict collection is strict under a balanced global mode", async () => {
    const { store } = await seeded();
    expect(
      (
        await loadStrictestPrivacyPolicy(
          { globalMode: () => "balanced", store },
          [STRICT],
        )
      ).mode,
    ).toBe("strict");
  });

  it("an item in two collections takes the stricter, in either order; an override never loosens", async () => {
    const { store } = await seeded();
    const modeOf = async (
      globalMode: "strict" | "balanced" | "full",
      collections: readonly (typeof STRICT)[],
    ) =>
      (
        await loadStrictestPrivacyPolicy(
          { globalMode: () => globalMode, store },
          collections,
        )
      ).mode;
    expect(await modeOf("full", [BALANCED, STRICT])).toBe("strict");
    expect(await modeOf("full", [STRICT, BALANCED])).toBe("strict");
    expect(await modeOf("full", [LOOSE, BALANCED])).toBe("balanced");
    expect(await modeOf("full", [BALANCED, LOOSE])).toBe("balanced");
    expect(await modeOf("balanced", [LOOSE, NOROW])).toBe("balanced");
    expect(await modeOf("strict", [LOOSE])).toBe("strict");
    expect(await modeOf("full", [])).toBe("full");
  });

  it("fails closed: one unreadable row among several gives strict, and so does a missing store", async () => {
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) } as never;
    const { connection, store } = await seeded();
    connection.db
      .prepare(
        "INSERT INTO collection_settings VALUES (1, 'BROKEN23', 'not json')",
      )
      .run();
    expect(
      (
        await loadStrictestPrivacyPolicy(
          { globalMode: () => "full", store, logger },
          [LOOSE, { libraryID: 1, collectionKey: "BROKEN23" }],
        )
      ).mode,
    ).toBe("strict");
    expect(
      (
        await loadStrictestPrivacyPolicy(
          { globalMode: () => "full", store: undefined, logger },
          [LOOSE],
        )
      ).mode,
    ).toBe("strict");
    expect(warnings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8. The egress log (step 8) and the resume guard
// ---------------------------------------------------------------------------

describe("the egress log — in the job record, through the P3-T36 gate, locally only", () => {
  it("records provider, host, model, item count, scope and mode, and reads back off the stored record", () => {
    const d = disclosure({ items: ["abstract", "abstract+fulltext"] }, true);
    const entry = egressLogEntry(d, 1_790_000_000_000);
    expect(entry).toStrictEqual({
      providerId: "openrouter",
      host: "openrouter.ai",
      modelId: "anthropic/claude-sonnet-5",
      itemCount: 2,
      scope: {
        "metadata-only": 0,
        abstract: 1,
        "abstract+fulltext": 1,
        "abstract+notes": 0,
      },
      privacyMode: "balanced",
      confirmedAtEpochMs: 1_790_000_000_000,
    });
    const record = createJobRecord({
      id: "job-1",
      pipelineId: "summarize",
      input: withEgressLog({ collectionKey: "ABCD2345" }, entry),
      createdAtEpochMs: 1,
      createdByPluginVersion: "0.0.0",
    });
    const stored = toJobRow(record);
    expect(readEgressLog(stored.record)).toStrictEqual(entry);
    expect(stored.record.redaction.input).toBeUndefined();
    expect(readEgressLog({ input: { collectionKey: "x" } })).toBeUndefined();
    expect(readEgressLog({ input: undefined })).toBeUndefined();
  });

  it("passes the persisted log through the gate: no synthetic key survives, and the record is marked", () => {
    const d = buildEgressDisclosure(
      {
        providerId: "openrouter",
        modelId: `vendor/${SYNTHETIC_KEY}`,
        privacyMode: "balanced",
        items: ["abstract"],
      },
      { baseUrls: NO_OVERRIDE, egressAcknowledged: () => true },
    );
    const record = createJobRecord({
      id: "job-2",
      pipelineId: "summarize",
      input: withEgressLog({}, egressLogEntry(d, 2)),
      createdAtEpochMs: 1,
      createdByPluginVersion: "0.0.0",
    });
    const stored = toJobRow(record);
    expect(stored.row.input_json).not.toContain(SYNTHETIC_KEY);
    expect(stored.row.input_json).not.toContain("0123456789abcdef");
    expect(stored.record.redaction.input?.partlyRedacted).toBe(true);
    expect(readEgressLog(stored.record)?.itemCount).toBe(1);
  });

  it("resumes an interrupted job only once the egress is acknowledged (ResumeGuards.egress)", async () => {
    const record = createJobRecord({
      id: "job-3",
      pipelineId: "summarize",
      input: {},
      createdAtEpochMs: 1,
      createdByPluginVersion: "0.0.0",
    });
    expect(await createEgressResumeGuard(() => true)(record)).toStrictEqual({
      proceed: true,
    });
    expect(await createEgressResumeGuard(() => false)(record)).toStrictEqual({
      proceed: false,
      pauseReason: "egress-unacknowledged",
    });
  });
});

// ---------------------------------------------------------------------------
// 9. The strings (step 7)
// ---------------------------------------------------------------------------

describe("the two notices' strings (docs/09 §3.6; G-41)", () => {
  const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
  const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");

  function entry(ftl: string, id: string): string | undefined {
    const match = new RegExp(`^${id} = (.+)$`, "m").exec(ftl);
    return match?.[1];
  }

  it("transcribes the Gemini warning from docs/09 §3.6 item 3, verbatim", () => {
    const docs = read("docs/09-security-privacy-and-api-keys.md");
    const quoted =
      /The Gemini free-tier warning is not suppressible\*\* while the tier is free or unknown: \*"([^"]+)"\*/.exec(
        docs,
      );
    expect(quoted?.[1]).toBeDefined();
    expect(entry(enUS, L10N_EGRESS_GEMINI_FREE_TIER)).toBe(quoted?.[1]);
  });

  it("ships an en-US first-job notice", () => {
    expect(entry(enUS, L10N_EGRESS_FIRST_JOB_NOTICE)).toMatch(
      /provider you chose/,
    );
  });

  it("carries both in ko-KR as the owner-reviewed Korean (2026-10-22, G-41), not as stubs", () => {
    for (const id of [
      L10N_EGRESS_FIRST_JOB_NOTICE,
      L10N_EGRESS_GEMINI_FREE_TIER,
    ]) {
      expect(entry(koKR, id)).toBeDefined();
      expect(koKR).not.toContain(`# ${id} =`);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. A Gemini key the user declares paid (owner, 2026-10-22, plan/00 §6 item
//     269(b)–(c); docs/07 §4.5's note, docs/09 §3.5's corrected row, §3.6
//     item 3's extension)
// ---------------------------------------------------------------------------

/** A Gemini model as P3-T10's mapper lists it for a free or unknown tier. */
function geminiModel(): ModelInfo {
  const [listed] = readModelList(
    {
      models: [
        {
          name: "models/gemini-3.8-flash",
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 65_536,
        },
      ],
    },
    "free-or-unknown",
  );
  if (listed === undefined) throw new Error("the mapper listed no model");
  return listed;
}

describe("assertModelAllowed — a Gemini key the user declares paid (item 269(b))", () => {
  const route = (geminiPaidTier?: boolean): ModelRoute =>
    geminiPaidTier === undefined
      ? { providerId: "gemini" }
      : { providerId: "gemini", geminiPaidTier };

  it("keeps the mapper's encoding: a free or unknown Gemini tier says it may train on input", () => {
    expect(geminiModel().dataPolicy.trainsOnInputByDefault).toBe("yes");
  });

  it("judges Gemini in strict mode by its training policy alone: a declared-paid key passes, a free or unknown one is refused (item 270)", () => {
    for (const policy of ["yes", "no", "unknown"]) {
      expect(
        assertModelAllowed(model(policy), "strict", route(true)),
        `${policy}, declared paid`,
      ).toStrictEqual({ warnings: [], requiresConfirmation: false });
    }
    for (const declared of [false, undefined]) {
      expect(() =>
        assertModelAllowed(geminiModel(), "strict", route(declared)),
      ).toThrow(PolicyViolationError);
      expect(() =>
        assertModelAllowed(model("unknown"), "strict", route(declared)),
      ).toThrow(PolicyViolationError);
      expect(
        assertModelAllowed(model("no"), "strict", route(declared)),
      ).toStrictEqual({ warnings: [], requiresConfirmation: false });
    }
  });

  it("allows a declared-paid key in balanced mode with no warning, and still refuses a free or unknown one", () => {
    expect(
      assertModelAllowed(geminiModel(), "balanced", route(true)),
    ).toStrictEqual({ warnings: [], requiresConfirmation: false });
    for (const declared of [false, undefined]) {
      expect(() =>
        assertModelAllowed(geminiModel(), "balanced", route(declared)),
      ).toThrow(PolicyViolationError);
    }
  });

  it("in full mode, needs no confirmation for a declared-paid key and still warns and asks for a free one", () => {
    expect(
      assertModelAllowed(geminiModel(), "full", route(true)),
    ).toStrictEqual({ warnings: [], requiresConfirmation: false });
    expect(
      assertModelAllowed(geminiModel(), "full", route(false)),
    ).toStrictEqual({
      warnings: ["may-train-on-input"],
      requiresConfirmation: true,
    });
  });

  it("loosens nothing without a route, and reads the declaration for Gemini only", () => {
    // No route: the data policy alone, which refuses a free Gemini tier.
    expect(() => assertModelAllowed(geminiModel(), "balanced")).toThrow(
      PolicyViolationError,
    );
    // Another provider's route ignores a Gemini declaration.
    expect(() =>
      assertModelAllowed(model("yes"), "balanced", {
        providerId: "openai",
        geminiPaidTier: true,
      }),
    ).toThrow(PolicyViolationError);
    expect(
      assertModelAllowed(model("no"), "strict", { providerId: "openai" }),
    ).toStrictEqual({ warnings: [], requiresConfirmation: false });
  });

  it("names the provider and the declaration in a Gemini refusal's context", () => {
    let caught: unknown;
    try {
      assertModelAllowed(geminiModel(), "strict", route(false));
    } catch (error) {
      caught = error;
    }
    expect((caught as PolicyViolationError).context).toStrictEqual({
      mode: "strict",
      modelId: "gemini-3.8-flash",
      trainsOnInputByDefault: "yes",
      providerId: "gemini",
      geminiPaidTier: false,
    });
  });

  it("modelRouteFor reads gemini.paidTier on demand, on every call, and only for Gemini", () => {
    let reads = 0;
    let value = false;
    const reader = (): boolean => {
      reads += 1;
      return value;
    };
    expect(modelRouteFor("openai", reader)).toStrictEqual({
      providerId: "openai",
    });
    expect(reads).toBe(0);
    expect(modelRouteFor("gemini", reader)).toStrictEqual({
      providerId: "gemini",
      geminiPaidTier: false,
    });
    value = true;
    expect(modelRouteFor("gemini", reader).geminiPaidTier).toBe(true);
    expect(reads).toBe(2);
  });

  it("modelRouteFor reads the preference by default", () => {
    const previous = getPrefStore();
    try {
      setPrefStore(createMemoryPrefStore({}));
      expect(modelRouteFor("gemini").geminiPaidTier).toBe(false);
      setPrefStore(createMemoryPrefStore({ "gemini.paidTier": true }));
      expect(modelRouteFor("gemini").geminiPaidTier).toBe(true);
    } finally {
      setPrefStore(previous);
    }
  });
});

describe("buildEgressDisclosure — the declared-paid reminder replaces the Gemini warning (item 269(b))", () => {
  function gemini(
    declared: boolean,
    acknowledged: boolean,
    overrides: Partial<EgressDisclosureInput> = {},
  ): EgressDisclosure {
    return buildEgressDisclosure(
      {
        providerId: "gemini",
        modelId: "gemini-3.8-flash",
        privacyMode: "balanced",
        items: ["abstract"],
        ...overrides,
      },
      {
        baseUrls: NO_OVERRIDE,
        egressAcknowledged: () => acknowledged,
        geminiPaidTier: () => declared,
      },
    );
  }

  it("shows the reminder instead of the warning on every job, whatever the acknowledgement or the detected tier", () => {
    for (const acknowledged of [false, true]) {
      for (const tier of ["free-or-unknown", "paid", undefined] as const) {
        const d = gemini(true, acknowledged, {
          ...(tier !== undefined && { geminiTier: tier }),
        });
        expect(d.geminiDeclaredPaidReminder).toBe(true);
        expect(d.geminiFreeTierWarning).toBe(false);
        expect(d.noticeIds).toContain(L10N_EGRESS_GEMINI_DECLARED_PAID);
        expect(d.noticeIds).not.toContain(L10N_EGRESS_GEMINI_FREE_TIER);
      }
    }
    expect(gemini(true, true).noticeIds).toEqual([
      L10N_EGRESS_GEMINI_DECLARED_PAID,
    ]);
  });

  it("brings the free-tier warning back when the declaration is off", () => {
    const d = gemini(false, true);
    expect(d.geminiDeclaredPaidReminder).toBe(false);
    expect(d.noticeIds).toEqual([L10N_EGRESS_GEMINI_FREE_TIER]);
  });

  it("reads gemini.paidTier on every Gemini disclosure, and never for another provider", () => {
    let reads = 0;
    const deps = {
      baseUrls: NO_OVERRIDE,
      egressAcknowledged: () => true,
      geminiPaidTier: () => {
        reads += 1;
        return true;
      },
    };
    const input = {
      modelId: "m",
      privacyMode: "balanced" as const,
      items: [],
    };
    const other = buildEgressDisclosure(
      { ...input, providerId: "openai" },
      deps,
    );
    expect(reads).toBe(0);
    expect(other.geminiDeclaredPaidReminder).toBe(false);
    buildEgressDisclosure({ ...input, providerId: "gemini" }, deps);
    buildEgressDisclosure({ ...input, providerId: "gemini" }, deps);
    expect(reads).toBe(2);
  });

  it("reads gemini.paidTier from the preference by default", () => {
    const previous = getPrefStore();
    try {
      setPrefStore(
        createMemoryPrefStore({
          "privacy.egressAcknowledged": true,
          "gemini.paidTier": true,
        }),
      );
      const d = buildEgressDisclosure(
        {
          providerId: "gemini",
          modelId: "gemini-3.8-flash",
          privacyMode: "balanced",
          items: ["abstract"],
        },
        { baseUrls: NO_OVERRIDE },
      );
      expect(d.noticeIds).toEqual([L10N_EGRESS_GEMINI_DECLARED_PAID]);
    } finally {
      setPrefStore(previous);
    }
  });

  it("has no suppression path: the reminder forces the confirmation that the collection's checkbox would skip", () => {
    const d = gemini(true, true);
    expect(mustAskConfirmation(d, routineConfirmationFor(d))).toStrictEqual({
      ask: true,
      reasons: ["gemini-declared-paid"],
    });
  });
});

describe("the declared-paid reminder's string (docs/09 §3.6 item 3; G-41)", () => {
  const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
  const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");
  const id = L10N_EGRESS_GEMINI_DECLARED_PAID;

  it("transcribes the reminder from docs/09 §3.6 item 3's extension, verbatim", () => {
    const docs = read("docs/09-security-privacy-and-api-keys.md");
    const quoted =
      /replaced, on every job, by a\s+one-line reminder: \*"([^"]+)"\*/.exec(
        docs,
      );
    expect(quoted?.[1]).toBeDefined();
    const entry = new RegExp(`^${id} = (.+)$`, "m").exec(enUS)?.[1];
    expect(entry).toBe(quoted?.[1]);
  });

  it("carries it in ko-KR as the owner-reviewed Korean (2026-10-23, G-41), not as a stub", () => {
    expect(koKR).not.toContain(`# ${id} =`);
    expect(new RegExp(`^${id} =`, "m").test(koKR)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. A trend-report run's own notice (P4-T16; docs/09 §3 row 3b; docs/07
//     §4.5's note of 2026-10-27)
// ---------------------------------------------------------------------------

describe("buildEgressDisclosure — a report run's own notice (P4-T16)", () => {
  const THREE = {
    map: "vendor/small-model",
    report: "vendor/strong-model",
    critique: "vendor/critic-model",
  };

  it("names all three models of a run whose map, report and critique models differ, in one notice, first", () => {
    const d = disclosure(
      {
        modelId: THREE.report,
        report: { papers: 42, models: THREE },
      },
      false,
    );
    expect(d.noticeIds).toEqual([
      L10N_EGRESS_REPORT_NOTICE,
      L10N_EGRESS_FIRST_JOB_NOTICE,
    ]);
    expect(
      d.noticeIds.filter((id) => id === L10N_EGRESS_REPORT_NOTICE),
    ).toHaveLength(1);
    expect(d.report).toEqual({
      papers: 42,
      modelIds: [THREE.map, THREE.report, THREE.critique],
    });
    expect(d.modelId).toBe(THREE.report);
  });

  it("names a model once, and leaves out a role the run does not call", () => {
    expect(
      disclosure({
        report: {
          papers: 3,
          models: { map: "m", report: "r", critique: "m" },
        },
      }).report?.modelIds,
    ).toEqual(["m", "r"]);
    expect(
      disclosure({ report: { papers: 3, models: { report: "r" } } }).report
        ?.modelIds,
    ).toEqual(["r"]);
  });

  it("leaves a summarize run's disclosure byte-identical to what P3-T15 built", () => {
    const d = disclosure({}, false);
    expect("report" in d).toBe(false);
    expect(JSON.stringify(d)).toBe(
      JSON.stringify({
        providerId: "openrouter",
        modelId: "anthropic/claude-sonnet-5",
        host: "openrouter.ai",
        itemCount: 2,
        scope: {
          "metadata-only": 0,
          abstract: 2,
          "abstract+fulltext": 0,
          "abstract+notes": 0,
        },
        privacyMode: "balanced",
        firstJobNotice: true,
        geminiFreeTierWarning: false,
        geminiDeclaredPaidReminder: false,
        noticeIds: [L10N_EGRESS_FIRST_JOB_NOTICE],
      }),
    );
    const entry = egressLogEntry(d, 1);
    expect("report" in entry).toBe(false);
  });

  it("forces nothing on its own: the routine question stays mustAskConfirmation's", () => {
    const plain = disclosure({}, true);
    const report = disclosure(
      { report: { papers: 2, models: { report: "r" } } },
      true,
    );
    const stored = routineConfirmationFor(plain);
    expect(mustAskConfirmation(report, stored)).toEqual(
      mustAskConfirmation(plain, stored),
    );
    expect(mustAskConfirmation(report, stored).ask).toBe(false);
    expect(mustAskConfirmation(report, undefined).ask).toBe(true);
  });

  it("puts every model in the job's egress log (docs/09 §3.6 item 4)", () => {
    const d = disclosure({ report: { papers: 42, models: THREE } }, true);
    const entry = egressLogEntry(d, Date.UTC(2026, 9, 27));
    expect(entry.report).toEqual({
      papers: 42,
      modelIds: [THREE.map, THREE.report, THREE.critique],
    });
    expect(entry.report?.modelIds).not.toBe(d.report?.modelIds);
    expect(readEgressLog({ input: withEgressLog({}, entry) })?.report).toEqual(
      entry.report,
    );
  });
});

describe("the report notice's string (P4-T16; G-41)", () => {
  const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
  const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");

  it("ships en-US with its two arguments, and ko-KR as the owner-reviewed Korean (2026-10-27, G-41, item 292(a)), not as a stub", () => {
    const start = enUS.indexOf(`${L10N_EGRESS_REPORT_NOTICE} =`);
    expect(start).toBeGreaterThan(-1);
    const text = enUS.slice(
      start,
      enUS.indexOf("\nresearch-helper-", start + 1),
    );
    expect(text).toContain("{ $papers ->");
    expect(text).toContain("{ $models }");
    expect(text).toContain("not sent again");
    expect(koKR).toMatch(new RegExp(`^${L10N_EGRESS_REPORT_NOTICE} =`, "m"));
    expect(koKR).not.toMatch(
      new RegExp(`^# ${L10N_EGRESS_REPORT_NOTICE} =`, "m"),
    );
    const ko = new RegExp(`^${L10N_EGRESS_REPORT_NOTICE} = (.+)$`, "m").exec(
      koKR,
    )?.[1];
    expect(ko).toContain("{ $papers }");
    expect(ko).toContain("{ $models }");
  });
});

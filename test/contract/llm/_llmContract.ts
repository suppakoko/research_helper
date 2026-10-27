/**
 * The LLM contract suite, once — `P3-T30` (split by `plan/00` §6 item 298(b)),
 * `docs/13` §2.2 layer 2 for the four LLM adapters. Each
 * `<provider>.contract.test.ts` beside this file calls
 * {@link defineLlmContractSuite} for its provider; the four suites differ only
 * in their fixtures and their request snapshot.
 *
 * **No network, ever.** Every request goes to `createLlmReplayTransport`
 * (`../_transport.ts`), which reads the provider's fixture directory and
 * nothing else; a missing fixture is an error naming the command that records
 * it. The key is synthetic, built by the recorder (`invalidLlmKey`), and is
 * never written: the request snapshot replaces it.
 *
 * **What runs today, and what waits for the owner.** The fixture-set checks,
 * the request snapshots and the four synthetic scenarios run on every
 * `npm run test:contract`. The seven recorded scenarios (`docs/13` §3.1's note
 * of 2026-10-27) **skip, saying so, until the owner records them** with
 * `docs/13` §3.4's steps. From the first recording of a provider on, a missing
 * recorded fixture fails its test with the record command.
 *
 * Tags, as in `../pubmed.contract.test.ts`: **`[ours]`** fails only when our
 * code changes; **`[service]`** fails when the provider changes what it sends;
 * **`[both]`** is a parser snapshot either side can break. **Never hand-edit
 * a fixture to make one pass** (`docs/13` §3.3 rule 4): re-record it.
 */

import { readdirSync, readFileSync } from "node:fs";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type Clock, createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  ContentFilterError,
  ContextLengthExceededError,
  KEYISH_FIELD,
  RateLimitError,
  redact,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { tryParseJson } from "../../../src/llm/shared/jsonMode";
import { validateAgainstSchema } from "../../../src/llm/shared/schemaValidate";
import type {
  ChatResponse,
  ChatStreamChunk,
  LLMCallContext,
} from "../../../src/llm/types";
import { PROMPT_SCHEMAS } from "../../../src/prompts/index";
import {
  chooseLlmModel,
  createLlmAdapter,
  geminiLegacyChat,
  invalidLlmKey,
  LLM_KEY_ENV_VARS,
  LLM_SCENARIOS,
  llmFixtureDirFor,
  llmHeaderAllowed,
  llmPriceSource,
  type LlmAdapterDeps,
  type LlmRecordableProvider,
  type LlmScenario,
  llmScenarioKind,
  llmScenarioRequest,
  singleKeyStore,
} from "../../../scripts/record-fixtures";
import {
  assertFixturesFresh,
  createLlmReplayTransport,
  FIXTURE_STALE_FAIL_DAYS,
  FROZEN_NOW_EPOCH_MS,
  type LlmFixtureMeta,
  llmFixtureKey,
  llmRecordCommand,
  type LlmReplayTransport,
  META_SUFFIX,
  ReplayBrowserOfflineException,
  ReplayCancelledException,
  ReplaySecurityException,
  ReplayTimeoutException,
  ReplayUnexpectedStatusException,
} from "../_transport";

/** The `User-Agent` version; fixed so a version bump cannot move a snapshot. */
const UA_VERSION = "0.0.2";

/** What the request snapshot writes instead of the synthetic key. */
const KEY_PLACEHOLDER = "<withheld: the key>";

/** What it writes instead of the `User-Agent`, which carries the maintainer address (D10). */
const UA_PLACEHOLDER = "<withheld: buildUserAgent(), decision D10>";

/**
 * A request header's value as the snapshot may hold it: no key and no
 * address ever reaches the file. The key must be where the header's name says
 * (`KEYISH_FIELD`) and the `User-Agent` must be the shipped one, or this
 * throws, so withholding them cannot hide a wrong value.
 */
function withheld(name: string, value: string, testKey: string): string {
  if (name.toLowerCase() === "user-agent") {
    expect(value).toBe(buildUserAgent(UA_VERSION));
    return UA_PLACEHOLDER;
  }
  if (KEYISH_FIELD.test(name)) {
    expect(value.endsWith(testKey), name).toBe(true);
    return value.split(testKey).join(KEY_PLACEHOLDER);
  }
  expect(value.includes(testKey), name).toBe(false);
  return value;
}

/** The paper-summary schema the `chat-json-ok` answer must satisfy. */
const PAPER_SUMMARY_SCHEMA = PROMPT_SCHEMAS["paper-summary.v1.json"];

function scenarioNamed(name: string): LlmScenario {
  const found = LLM_SCENARIOS.find((s) => s.scenario === name);
  if (found === undefined) throw new Error(`no scenario ${name}`);
  return found;
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

/** The sidecars of `dir`, read synchronously so a `describe` can be skipped on them. */
function sidecarsSync(dir: string): readonly LlmFixtureMeta[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(META_SUFFIX))
    .map(
      (n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as LlmFixtureMeta,
    );
}

/** One adapter over one transport, as the recorder builds it. */
function adapterOver(
  provider: LlmRecordableProvider,
  transport: HttpTransport,
  clock: Clock = createManualClock(FROZEN_NOW_EPOCH_MS),
): {
  readonly deps: LlmAdapterDeps;
  readonly adapter: ReturnType<typeof createLlmAdapter>;
} {
  const http = createHttpClient({
    transport,
    userAgent: buildUserAgent(UA_VERSION),
    clock,
  });
  const deps: LlmAdapterDeps = {
    http,
    secrets: singleKeyStore(provider, invalidLlmKey(provider)),
    clock,
  };
  return { deps, adapter: createLlmAdapter(provider, deps) };
}

/** GET (the model list) to one transport, everything else to another. */
function byMethod(
  get: LlmReplayTransport,
  post: LlmReplayTransport,
): HttpTransport {
  return {
    ...post,
    request: (method, url, options) =>
      method === "GET"
        ? get.request(method, url, options)
        : post.request(method, url, options),
  };
}

/** Run one scenario's call the way the recorder ran it. */
async function drive(
  provider: LlmRecordableProvider,
  scenario: LlmScenario,
  built: ReturnType<typeof adapterOver>,
  model: string,
): Promise<ChatResponse | readonly ChatStreamChunk[]> {
  const request = llmScenarioRequest(scenario.scenario, model);
  switch (llmScenarioKind(provider, scenario)) {
    case "chat-legacy":
      return geminiLegacyChat(built.deps, request, ctx());
    case "chat-stream": {
      const chunks: ChatStreamChunk[] = [];
      const stream = built.adapter.chatStream?.(request, ctx());
      if (stream === undefined) throw new Error("no chatStream");
      for await (const chunk of stream) chunks.push(chunk);
      return chunks;
    }
    default:
      return built.adapter.chat(request, ctx());
  }
}

class CapturedRequest extends Error {}

/** A transport that records each request and answers none (no network). */
function requestRecorder(): HttpTransport & {
  readonly sent: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  }[];
} {
  const sent: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  }[] = [];
  return {
    sent,
    request(method, url, options): Promise<HttpTransportXhr> {
      sent.push({
        method,
        url,
        headers: { ...(options.headers ?? {}) },
        ...(options.body !== undefined && { body: options.body }),
      });
      return Promise.reject(new CapturedRequest("captured; not sent"));
    },
    UnexpectedStatusException:
      ReplayUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: ReplayTimeoutException,
    BrowserOfflineException: ReplayBrowserOfflineException,
    SecurityException: ReplaySecurityException,
    CancelledException: ReplayCancelledException,
  };
}

/**
 * The whole contract suite for one provider.
 *
 * @param provider - the provider
 */
export function defineLlmContractSuite(provider: LlmRecordableProvider): void {
  const dir = llmFixtureDirFor(provider);
  const model = chooseLlmModel(
    provider,
    llmPriceSource(),
    FROZEN_NOW_EPOCH_MS,
  ).model;
  const synthetic = LLM_SCENARIOS.filter((s) => s.recording === "synthetic");
  const live = LLM_SCENARIOS.filter((s) => s.recording === "live");
  const recorded = sidecarsSync(dir).filter((m) => !m.synthetic);
  const absentNote =
    `${provider}: no recording yet, so the ${String(live.length)} recorded ` +
    `scenarios are skipped. The owner records them with docs/13 §3.4 ` +
    `(${LLM_KEY_ENV_VARS[provider]} in the environment for one session, a ` +
    `confirmed spend); an agent never does.`;
  if (recorded.length === 0) console.warn(`[P3-T30] ${absentNote}`);

  describe(`${provider} — the fixture set`, () => {
    it("pairs every fixture with a sidecar named for its scenario and page [ours]", async () => {
      const names = await readdir(dir);
      const fixtures = names.filter(
        (n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX),
      );
      const sidecars = names.filter((n) => n.endsWith(META_SUFFIX));
      expect(fixtures.length).toBeGreaterThan(0);
      expect(
        sidecars.map((n) => n.slice(0, -META_SUFFIX.length)).sort(),
      ).toEqual(fixtures.map((n) => n.slice(0, -".json".length)).sort());
      for (const name of sidecars) {
        const meta = JSON.parse(
          await readFile(join(dir, name), "utf8"),
        ) as LlmFixtureMeta;
        const listed = scenarioNamed(meta.scenario);
        expect(llmFixtureKey(meta.scenario, meta.page), name).toBe(
          name.slice(0, -META_SUFFIX.length),
        );
        expect(meta.provider, name).toBe(provider);
        expect(meta.synthetic, name).toBe(listed.recording === "synthetic");
        if (meta.synthetic) expect(meta.syntheticReason, name).toBeTruthy();
      }
    });

    it("holds every synthetic scenario, or names the command that writes it [ours]", () => {
      const present = new Set(sidecarsSync(dir).map((m) => m.scenario));
      const missing = synthetic
        .filter((s) => !present.has(s.scenario))
        .map(
          (s) =>
            `${s.scenario}: ${llmRecordCommand(provider, s.scenario, true)}`,
        );
      expect(missing, missing.join("\n")).toEqual([]);
    });

    it("once recorded, holds every recorded scenario, or names the command that records it [ours]", () => {
      if (recorded.length === 0) return; // nothing recorded yet: see the skipped block below
      const present = new Set(recorded.map((m) => m.scenario));
      const missing = live
        .filter((s) => !present.has(s.scenario))
        .map(
          (s) =>
            `${s.scenario}: ${llmRecordCommand(provider, s.scenario, false)}`,
        );
      expect(missing, missing.join("\n")).toEqual([]);
    });

    it("carries no key, no credential header, no address and no stray header [ours]", async () => {
      const testKey = invalidLlmKey(provider);
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".json")) continue;
        const text = await readFile(join(dir, name), "utf8");
        expect(redact(text), `${name} matches a KEY_PATTERNS shape`).toBe(text);
        expect(text.includes(testKey), name).toBe(false);
        expect(text, name).not.toMatch(
          /"(?:authorization|x-api-key|x-goog-api-key|cookie|set-cookie)"\s*:/iu,
        );
        expect(text, name).not.toMatch(
          /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u,
        );
        if (name.endsWith(META_SUFFIX)) continue;
        const stored = JSON.parse(text) as { headers: Record<string, string> };
        const stray = Object.keys(stored.headers).filter(
          (h) => !llmHeaderAllowed(h),
        );
        expect(stray, name).toEqual([]);
      }
    });

    it("is fresh, and a sidecar older than 365 days fails the suite [ours]", async () => {
      await expect(assertFixturesFresh(dir, Date.now())).resolves.toBeDefined();
      const tmp = await mkdtemp(join(tmpdir(), `rh-llm-stale-${provider}-`));
      try {
        await copyFile(join(dir, "refusal.json"), join(tmp, "refusal.json"));
        const meta = JSON.parse(
          await readFile(join(dir, `refusal${META_SUFFIX}`), "utf8"),
        ) as LlmFixtureMeta;
        const now = Date.parse("2028-01-01T00:00:00Z");
        const old = new Date(now - (FIXTURE_STALE_FAIL_DAYS + 1) * 86_400_000);
        await writeFile(
          join(tmp, `refusal${META_SUFFIX}`),
          JSON.stringify({ ...meta, recordedAt: old.toISOString() }),
        );
        await expect(assertFixturesFresh(tmp, now)).rejects.toThrow(
          /past 365 days/u,
        );
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe(`${provider} — request shape`, () => {
    it("sends exactly the committed request for every recorded scenario [ours]", async () => {
      const testKey = invalidLlmKey(provider);
      const entries: unknown[] = [];
      for (const scenario of live) {
        const recorder = requestRecorder();
        const built = adapterOver(provider, recorder);
        await (
          scenario.kind === "list-models"
            ? built.adapter.listModels(ctx())
            : drive(provider, scenario, built, model)
        ).catch(() => undefined);
        expect(recorder.sent, scenario.scenario).toHaveLength(1);
        for (const sent of recorder.sent) {
          const headers = Object.fromEntries(
            Object.entries(sent.headers)
              .map(([n, v]) => [n, withheld(n, v, testKey)] as const)
              .sort(([a], [b]) => a.localeCompare(b)),
          );
          entries.push({
            scenario: scenario.scenario,
            method: sent.method,
            url: sent.url,
            headers,
            body:
              sent.body === undefined
                ? null
                : (JSON.parse(sent.body) as unknown),
          });
        }
      }
      const text = `${JSON.stringify(entries, null, 2)}\n`;
      expect(text.includes(testKey)).toBe(false);
      await expect(text).toMatchFileSnapshot(
        `./__snapshots__/${provider}.requests.snap`,
      );
    });

    it("fails with the record command, and sends nothing, when a fixture is missing [ours]", async () => {
      const empty = await mkdtemp(
        join(tmpdir(), `rh-llm-missing-${provider}-`),
      );
      try {
        const scenario = scenarioNamed("chat-nonstream-ok");
        const transport = createLlmReplayTransport(
          empty,
          provider,
          scenario.scenario,
          false,
        );
        const built = adapterOver(provider, transport);
        await expect(drive(provider, scenario, built, model)).rejects.toThrow(
          /^Missing fixture .*chat-nonstream-ok\.json[\s\S]*Record it with: .*--live --confirm-spend-usd/u,
        );
        expect(transport.calls).toHaveLength(1);
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });
  });

  describe(`${provider} — synthetic error shapes (docs/03 §11.5)`, () => {
    const replay = (name: string) => {
      const scenario = scenarioNamed(name);
      const transport = createLlmReplayTransport(dir, provider, name, true);
      return { scenario, transport, built: adapterOver(provider, transport) };
    };

    it("maps error-429 to RateLimitError carrying Retry-After [ours]", async () => {
      const { scenario, transport, built } = replay("error-429");
      const error: unknown = await drive(
        provider,
        scenario,
        built,
        model,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterMs).toBe(2000);
      expect(transport.calls).toHaveLength(1);
    });

    it("maps error-429-no-retry-after to RateLimitError with no wait [ours]", async () => {
      const { scenario, built } = replay("error-429-no-retry-after");
      const error: unknown = await drive(
        provider,
        scenario,
        built,
        model,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterMs).toBeUndefined();
    });

    it("maps error-context-length to ContextLengthExceededError [ours]", async () => {
      const { scenario, built } = replay("error-context-length");
      await expect(
        drive(provider, scenario, built, model),
      ).rejects.toBeInstanceOf(ContextLengthExceededError);
    });

    it("maps a refusal on HTTP 200 to ContentFilterError [ours]", async () => {
      const { scenario, built } = replay("refusal");
      await expect(
        drive(provider, scenario, built, model),
      ).rejects.toBeInstanceOf(ContentFilterError);
    });
  });

  describe.skipIf(recorded.length === 0)(
    recorded.length === 0
      ? `${provider} — recorded responses: SKIPPED. ${absentNote}`
      : `${provider} — recorded responses`,
    () => {
      const recordedMeta = (name: string): LlmFixtureMeta | undefined =>
        recorded.find((m) => m.scenario === name && m.page === 1);
      /** The model list first, as the recorder sent it, then the scenario. */
      const replay = async (name: string) => {
        const scenario = scenarioNamed(name);
        const list = createLlmReplayTransport(
          dir,
          provider,
          "models-list",
          false,
        );
        const post = createLlmReplayTransport(dir, provider, name, false);
        const built = adapterOver(provider, byMethod(list, post));
        await built.adapter.listModels(ctx());
        return { scenario, built };
      };

      it("models-list: lists the model the recording was made with [service]", async () => {
        const list = createLlmReplayTransport(
          dir,
          provider,
          "models-list",
          false,
        );
        const built = adapterOver(provider, list);
        const models = await built.adapter.listModels(ctx());
        expect(models.length).toBeGreaterThan(0);
        const made = recordedMeta("models-list")?.model;
        expect(made).toBeDefined();
        expect(models.map((m) => m.id)).toContain(made);
      });

      it("chat-nonstream-ok: text, a stop, and the usage the budget guard settles on [both]", async () => {
        const { scenario, built } = await replay("chat-nonstream-ok");
        const answer = (await drive(
          provider,
          scenario,
          built,
          model,
        )) as ChatResponse;
        expect(answer.text.trim()).not.toBe("");
        expect(answer.finishReason).toBe("stop");
        expect(answer.usage.inputTokens).toBeGreaterThan(0);
        expect(answer.usage.outputTokens).toBeGreaterThan(0);
        if (provider === "openrouter") {
          // docs/07 §5.1's Usage: "Provider-reported cost where available (OpenRouter reports this)".
          expect(typeof answer.usage.costUsd).toBe("number");
        }
      });

      it("chat-stream-ok: deltas, then one terminal chunk with usage [both]", async () => {
        const { scenario, built } = await replay("chat-stream-ok");
        const chunks = (await drive(
          provider,
          scenario,
          built,
          model,
        )) as readonly ChatStreamChunk[];
        expect(chunks.length).toBeGreaterThan(0);
        expect(
          chunks
            .map((c) => c.deltaText)
            .join("")
            .trim(),
        ).not.toBe("");
        expect(chunks.at(-1)?.done).toBe(true);
        expect(chunks.filter((c) => c.done)).toHaveLength(1);
        expect(chunks.at(-1)?.usage?.outputTokens).toBeGreaterThan(0);
      });

      it("chat-json-ok: a parsed object that satisfies the paper-summary schema [both]", async () => {
        const { scenario, built } = await replay("chat-json-ok");
        const answer = (await drive(
          provider,
          scenario,
          built,
          model,
        )) as ChatResponse;
        expect(answer.json).toBeDefined();
        if (PAPER_SUMMARY_SCHEMA === undefined) throw new Error("no schema");
        const verdict = validateAgainstSchema(
          answer.json,
          PAPER_SUMMARY_SCHEMA,
        );
        expect(verdict.errors).toEqual([]);
        expect((answer.json as { itemKey?: unknown }).itemKey).toBe("RHFIXT01");
      });

      it("chat-json-malformed: not JSON as a whole, recoverable by the fence-stripping parse [service]", async () => {
        const { scenario, built } = await replay("chat-json-malformed");
        const answer = (await drive(
          provider,
          scenario,
          built,
          model,
        )) as ChatResponse;
        expect(() => JSON.parse(answer.text) as unknown).toThrow();
        expect(tryParseJson(answer.text)).toEqual({ ok: true, n: 3 });
      });

      it("error-truncated: finishReason length [both]", async () => {
        const { scenario, built } = await replay("error-truncated");
        const answer = (await drive(
          provider,
          scenario,
          built,
          model,
        )) as ChatResponse;
        expect(answer.finishReason).toBe("length");
      });

      it("error-401: AuthenticationError [both]", async () => {
        const { scenario, built } = await replay("error-401");
        await expect(
          drive(provider, scenario, built, model),
        ).rejects.toBeInstanceOf(AuthenticationError);
      });
    },
  );
}

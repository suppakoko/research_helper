import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  ContentFilterError,
  NetworkError,
  OperationCancelledError,
  OutputTruncatedError,
  QuotaExceededError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpOptions,
  type HttpTransport,
  type HttpTransportObservedXhr,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import {
  type CancellationToken,
  createCancellationTokenSource,
} from "../../../src/core/jobQueue/cancellation";
import {
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_STREAM_TOTAL_TIMEOUT_MS,
} from "../../../src/core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import { createAnthropicProvider } from "../../../src/llm/anthropic/anthropicProvider";
import { createGeminiProvider } from "../../../src/llm/gemini/geminiProvider";
import { createOpenAiProvider } from "../../../src/llm/openai/openAiProvider";
import { createOpenRouterProvider } from "../../../src/llm/openrouter/openRouterProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import {
  createSseParser,
  parseSse,
  streamSseEvents,
} from "../../../src/llm/shared/sse";
import type {
  ChatRequest,
  ChatStreamChunk,
  LLMCallContext,
  LLMProvider,
} from "../../../src/llm/types";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
} from "../../helpers/mockLLM";

/**
 * `P3-T11`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real key. Every adapter is driven through the **real** `HttpClient`
 * (`src/core/http/client.ts`) over a fake transport that behaves like
 * `Zotero.HTTP.request` with `requestObserver` (`docs/01` §8.4.1): the body
 * grows in `responseText` and a `progress` event fires per slice.
 *
 * **Every fixture is SYNTHETIC — hand-built from the shapes `docs/03` §6
 * records, never recorded from a live call.** Gemini's stream payloads are
 * the assumptions `createGeminiStreamDecoder` states, because §6.3 records
 * only their event names. The key is built at run time and lives only in the
 * memory keystore below.
 */

const SYNTHETIC_KEY = ["test", "only", "not", "a", "key"].join("-");
const UA =
  "research_helper/9.9.9 (https://example.test; mailto:x@example.test)";
/** Multi-byte text, so "byte-identical" means something. */
const TEXT = "This randomized trial found a 12% reduction — ünïcode ✓ 漢字.";
const PIECES = [
  "This rand",
  "omized trial found a 12% ",
  "reduction — ünïcode ✓ 漢字.",
];

// ---------------------------------------------------------------------------
// A fake `Zotero.HTTP` that streams
// ---------------------------------------------------------------------------

class StubTimeoutException extends Error {}
class StubBrowserOfflineException extends Error {}
class StubCancelledException extends Error {}
class StubSecurityException extends Error {}
class StubUnexpectedStatusException extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super("unexpected status");
  }
}

/** An in-flight XHR whose every `responseText` read is counted. */
class FakeXhr implements HttpTransportXhr, HttpTransportObservedXhr {
  text = "";
  aborted = false;
  readsAfterAbort = 0;
  readonly listeners: (() => void)[] = [];
  readonly responseURL = "";
  constructor(public status: number) {}
  get responseText(): string {
    if (this.aborted) this.readsAfterAbort += 1;
    return this.text;
  }
  getAllResponseHeaders(): string {
    return "";
  }
  addEventListener(type: "progress", listener: () => void): void {
    if (type === "progress") this.listeners.push(listener);
  }
}

/** One request the fake received, with the controls a test drives it by. */
interface FakeCall {
  readonly options: HttpTransportOptions;
  readonly body: unknown;
  readonly xhr: FakeXhr;
  /** Append text and fire `progress`, as a real XHR would. */
  push(text: string): void;
  /** Fire `progress` with nothing new — or, after an abort, a stray event. */
  tick(): void;
  /** The response completed. */
  finish(): void;
  /** The connection dropped: status 0, the body gone (XHR network error). */
  cut(): void;
}

interface FakeTransport extends HttpTransport {
  readonly calls: FakeCall[];
}

/**
 * `answer` decides each request. A plain request (no `requestObserver`) is
 * answered at once with `plain`; a streamed one gets `stream`'s chunks, one
 * per macrotask, then `end`.
 */
function fakeTransport(script: {
  readonly plain?: string;
  readonly stream?: readonly string[];
  readonly status?: number;
  readonly end?: "finish" | "cut" | "hold";
}): FakeTransport {
  const calls: FakeCall[] = [];
  return {
    calls,
    request(_method, _url, options) {
      const xhr = new FakeXhr(script.status ?? 200);
      let resolve!: (x: HttpTransportXhr) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<HttpTransportXhr>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      let settled = false;
      const call: FakeCall = {
        options,
        body: JSON.parse(options.body ?? "null") as unknown,
        xhr,
        push(text) {
          if (settled) return;
          xhr.text += text;
          for (const listener of xhr.listeners) listener();
        },
        tick() {
          for (const listener of xhr.listeners) listener();
        },
        finish() {
          if (settled) return;
          settled = true;
          resolve(xhr);
        },
        cut() {
          if (settled) return;
          settled = true;
          xhr.status = 0;
          xhr.text = "";
          resolve(xhr);
        },
      };
      calls.push(call);
      // Zotero calls the receiver once, synchronously, before sending; the
      // canceller rejects with CancelledException 0 ms later (P0-T17).
      options.cancellerReceiver?.(() => {
        xhr.aborted = true;
        if (settled) return;
        settled = true;
        reject(new StubCancelledException());
      });
      options.requestObserver?.(xhr);
      if (options.requestObserver === undefined) {
        xhr.text = script.plain ?? "";
        call.finish();
      } else if (script.stream !== undefined) {
        void (async () => {
          for (const chunk of script.stream ?? []) {
            await macrotask();
            call.push(chunk);
          }
          await macrotask();
          if (script.end === "cut") call.cut();
          else if (script.end !== "hold") call.finish();
        })();
      }
      return promise;
    },
    UnexpectedStatusException:
      StubUnexpectedStatusException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubTimeoutException,
    BrowserOfflineException: StubBrowserOfflineException,
    SecurityException: StubSecurityException,
    CancelledException: StubCancelledException,
  };
}

function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Split `text` every `size` characters — mid-line, mid-frame, mid-CRLF. */
function slices(text: string, size = 29): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** An SSE body: `event:` lines optional, comments allowed, blank-line framed. */
function sse(
  frames: readonly ({ event?: string; data: unknown } | { comment: string })[],
): string {
  return frames
    .map((frame) =>
      "comment" in frame
        ? `: ${frame.comment}\n\n`
        : `${frame.event === undefined ? "" : `event: ${frame.event}\n`}data: ${
            typeof frame.data === "string"
              ? frame.data
              : JSON.stringify(frame.data)
          }\n\n`,
    )
    .join("");
}

function memoryStore(id: SecretId): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get: (asked) => Promise.resolve(asked === id ? SYNTHETIC_KEY : undefined),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: (asked) => Promise.resolve(asked === id),
    listStoredIds: () => Promise.resolve([id]),
    clearAll: () => Promise.resolve(0),
  };
}

function ctxWith(token?: CancellationToken): LLMCallContext {
  return { token: token ?? createCancellationTokenSource().token };
}

function request(model: string): ChatRequest {
  return {
    model,
    messages: [{ role: "user", content: "Summarize this abstract." }],
    maxOutputTokens: 512,
    traceId: "trace-1",
  };
}

async function collect(
  stream: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

type ProviderName = "openrouter" | "openai" | "anthropic" | "gemini";

function clientOver(transport: FakeTransport): HttpClient {
  return createHttpClient({
    transport,
    userAgent: UA,
    clock: createManualClock(),
  });
}

function build(name: ProviderName, http: HttpClient): LLMProvider {
  const baseUrls = createBaseUrlResolver({ override: () => "" });
  const clock = createManualClock();
  switch (name) {
    case "openrouter":
      return createOpenRouterProvider({
        secrets: memoryStore("llm.openrouter"),
        baseUrls,
        http,
        clock,
      });
    case "openai":
      return createOpenAiProvider({
        secrets: memoryStore("llm.openai"),
        baseUrls,
        http,
        clock,
      });
    case "anthropic":
      return createAnthropicProvider({
        secrets: memoryStore("llm.anthropic"),
        baseUrls,
        http,
        clock,
      });
    case "gemini":
      return createGeminiProvider({
        secrets: memoryStore("llm.gemini"),
        baseUrls,
        http,
        clock,
      });
  }
}

// ---------------------------------------------------------------------------
// The four synthetic fixture pairs (docs/03 §6.1–§6.4)
// ---------------------------------------------------------------------------

interface FixturePair {
  readonly model: string;
  /** The non-streamed answer body. */
  readonly plain: unknown;
  /** The streamed body of the same answer. */
  readonly stream: string;
  /** The usage the terminal chunk must carry. */
  readonly usage: ChatStreamChunk["usage"];
}

const OPENROUTER_MODEL = "test-author/test-model";
const OPENROUTER: FixturePair = {
  model: OPENROUTER_MODEL,
  plain: {
    id: "gen-synthetic",
    object: "chat.completion",
    model: OPENROUTER_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: TEXT },
      },
    ],
    usage: {
      prompt_tokens: 412,
      completion_tokens: 118,
      total_tokens: 530,
      cost: 0.000752,
    },
  },
  stream: sse([
    { comment: "OPENROUTER PROCESSING" },
    ...PIECES.map((content, i) => ({
      data: {
        id: "gen-synthetic",
        object: "chat.completion.chunk",
        model: OPENROUTER_MODEL,
        choices: [
          {
            index: 0,
            delta: i === 0 ? { role: "assistant", content } : { content },
            finish_reason: null,
          },
        ],
      },
    })),
    {
      data: {
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      },
    },
    {
      data: {
        choices: [],
        usage: {
          prompt_tokens: 412,
          completion_tokens: 118,
          total_tokens: 530,
          cost: 0.000752,
        },
      },
    },
    { data: "[DONE]" },
  ]),
  usage: {
    inputTokens: 412,
    outputTokens: 118,
    totalTokens: 530,
    costUsd: 0.000752,
  },
};

const OPENAI_MODEL = "gpt-test";
const OPENAI_RESPONSE = {
  id: "resp_synthetic",
  object: "response",
  status: "completed",
  model: OPENAI_MODEL,
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: TEXT, annotations: [] }],
    },
  ],
  usage: { input_tokens: 412, output_tokens: 118, total_tokens: 530 },
};
const OPENAI: FixturePair = {
  model: OPENAI_MODEL,
  plain: OPENAI_RESPONSE,
  // §6.1: typed events, and no [DONE].
  stream: sse([
    {
      event: "response.created",
      data: {
        type: "response.created",
        response: { id: "resp_synthetic", status: "in_progress" },
      },
    },
    ...PIECES.map((delta) => ({
      event: "response.output_text.delta",
      data: { type: "response.output_text.delta", delta },
    })),
    {
      event: "response.completed",
      data: { type: "response.completed", response: OPENAI_RESPONSE },
    },
  ]),
  usage: {
    inputTokens: 412,
    outputTokens: 118,
    totalTokens: 530,
    costUsd: undefined,
  },
};

const ANTHROPIC_MODEL = "claude-test";
const ANTHROPIC: FixturePair = {
  model: ANTHROPIC_MODEL,
  plain: {
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: ANTHROPIC_MODEL,
    content: [{ type: "text", text: TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 25, output_tokens: 15 },
  },
  // §6.2, including the ping and the placeholder output_tokens: 1.
  stream: sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_synthetic",
          type: "message",
          role: "assistant",
          content: [],
          model: ANTHROPIC_MODEL,
          stop_reason: null,
          usage: { input_tokens: 25, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    { event: "ping", data: { type: "ping" } },
    ...PIECES.map((text) => ({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    })),
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 15 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]),
  usage: {
    inputTokens: 25,
    outputTokens: 15,
    totalTokens: 40,
    costUsd: undefined,
  },
};

const GEMINI_MODEL = "gemini-test";
const GEMINI_INTERACTION = {
  id: "int_synthetic",
  model: GEMINI_MODEL,
  status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text: TEXT }] }],
  usage: {
    total_input_tokens: 10,
    total_output_tokens: 20,
    total_tokens: 30,
  },
};
const GEMINI: FixturePair = {
  model: GEMINI_MODEL,
  plain: GEMINI_INTERACTION,
  // §6.3's event names; the payloads are createGeminiStreamDecoder's
  // ASSUMPTIONS. No `event:` lines, so the frame's `event_type` is read.
  stream: sse([
    {
      data: {
        event_type: "interaction.created",
        interaction: { id: "int_synthetic", status: "in_progress" },
      },
    },
    { data: { event_type: "step.start", index: 0 } },
    {
      data: {
        event_type: "step.delta",
        index: 0,
        delta: { type: "thought_summary", text: "not answer text" },
      },
    },
    ...PIECES.map((text) => ({
      data: {
        event_type: "step.delta",
        index: 0,
        delta: { type: "text", text },
      },
    })),
    { data: { event_type: "step.stop", index: 0 } },
    {
      data: {
        event_type: "interaction.completed",
        interaction: GEMINI_INTERACTION,
      },
    },
  ]),
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    costUsd: undefined,
  },
};

const PAIRS: readonly [ProviderName, FixturePair][] = [
  ["openrouter", OPENROUTER],
  ["openai", OPENAI],
  ["anthropic", ANTHROPIC],
  ["gemini", GEMINI],
];

// ---------------------------------------------------------------------------
// 1. The parser (P0-T16's surface, unchanged)
// ---------------------------------------------------------------------------

describe("the frame parser keeps its P0-T16 surface", () => {
  it("parses a whole stream and the same stream split anywhere identically", () => {
    const whole = parseSse(ANTHROPIC.stream);
    const parser = createSseParser();
    const split = [
      ...slices(ANTHROPIC.stream, 3).flatMap((chunk) => parser.push(chunk)),
      ...parser.end(),
    ];
    expect(split).toStrictEqual(whole);
    // ping carries data in §6.2's record, so it is an event; comments are not.
    expect(whole.map((event) => event.type)).toContain("ping");
    expect(parseSse(OPENROUTER.stream)[0]?.data).not.toContain("PROCESSING");
  });
});

// ---------------------------------------------------------------------------
// 2. Done-when 1: streamed text is byte-identical to the non-streamed text
// ---------------------------------------------------------------------------

describe("each provider's streamed fixture reconstructs its non-streamed text", () => {
  for (const [name, pair] of PAIRS) {
    it(`${name}: same text, exactly one terminal chunk, final usage on it`, async () => {
      const transport = fakeTransport({
        plain: JSON.stringify(pair.plain),
        stream: slices(pair.stream),
      });
      // Records what the adapter asks the client for (item 268(c)).
      const real = clientOver(transport);
      const asked: (HttpOptions | undefined)[] = [];
      const provider = build(name, {
        request: (method, url, options) => {
          asked.push(options);
          return real.request(method, url, options);
        },
      });

      const plain = await provider.chat(request(pair.model), ctxWith());
      const chunks = await collect(
        provider.chatStream!(request(pair.model), ctxWith()),
      );

      const streamed = chunks.map((chunk) => chunk.deltaText).join("");
      expect(plain.text).toBe(TEXT);
      expect(Buffer.from(streamed, "utf8")).toStrictEqual(
        Buffer.from(plain.text, "utf8"),
      );
      expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
      expect(chunks.at(-1)).toStrictEqual({
        deltaText: "",
        done: true,
        usage: pair.usage,
      });
      // Text arrived progressively, not as one block at the end.
      expect(chunks.filter((chunk) => !chunk.done).length).toBeGreaterThan(1);
      // The streamed request is the plain one plus `stream: true`.
      const [plainCall, streamCall] = transport.calls;
      expect(streamCall?.body).toStrictEqual({
        ...(plainCall?.body as object),
        stream: true,
      });
      expect(plainCall?.options.requestObserver).toBeUndefined();
      expect(streamCall?.options.requestObserver).toBeTypeOf("function");
      expect(streamCall?.options.responseType).toBe("text");
      // Item 268(c): a plain request keeps 3 minutes; a stream has 15 in all,
      // as the XHR timeout, and its 3-minute idle limit is the client's own.
      expect(plainCall?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
      expect(streamCall?.options.timeout).toBe(LLM_STREAM_TOTAL_TIMEOUT_MS);
      const [plainAsked, streamAsked] = asked;
      expect(plainAsked?.idleTimeoutMs).toBeUndefined();
      expect(streamAsked?.onBodyText).toBeTypeOf("function");
      expect(streamAsked?.idleTimeoutMs).toBe(LLM_STREAM_IDLE_TIMEOUT_MS);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Done-when 2: a cut stream is a NetworkError, never a short result
// ---------------------------------------------------------------------------

describe("a stream cut mid-frame surfaces a NetworkError", () => {
  for (const [name, pair] of PAIRS) {
    it(`${name}: the connection drops mid-frame (status 0)`, async () => {
      const cutAt = Math.floor(pair.stream.length * 0.6);
      const transport = fakeTransport({
        stream: slices(pair.stream.slice(0, cutAt)),
        end: "cut",
      });
      const provider = build(name, clientOver(transport));
      const seen: ChatStreamChunk[] = [];

      const error = await (async () => {
        for await (const chunk of provider.chatStream!(
          request(pair.model),
          ctxWith(),
        )) {
          seen.push(chunk);
        }
      })().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect(seen.some((chunk) => chunk.done)).toBe(false);
    });

    it(`${name}: the response ends cleanly but mid-frame`, async () => {
      // Everything up to the middle of the last frame, then a clean end.
      const cutAt = pair.stream.lastIndexOf("data:") + 9;
      const transport = fakeTransport({
        stream: slices(pair.stream.slice(0, cutAt)),
      });
      const provider = build(name, clientOver(transport));

      const error = await collect(
        provider.chatStream!(request(pair.model), ctxWith()),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
    });
  }

  it("never infers completion from an empty delta", async () => {
    // OpenRouter's finish chunk carries an empty delta; without [DONE] the
    // stream is cut, however final the last chunk looked.
    const withoutDone = OPENROUTER.stream.slice(
      0,
      OPENROUTER.stream.indexOf("data: [DONE]"),
    );
    const transport = fakeTransport({ stream: slices(withoutDone) });
    const provider = build("openrouter", clientOver(transport));

    await expect(
      collect(provider.chatStream!(request(OPENROUTER_MODEL), ctxWith())),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ---------------------------------------------------------------------------
// 4. Done-when 3: aborting stops iteration and issues no further reads
// ---------------------------------------------------------------------------

describe("aborting mid-stream", () => {
  it("a consumer that stops iterating aborts the request, reads nothing more and throws nothing", async () => {
    const transport = fakeTransport({ stream: [], end: "hold" });
    const provider = build("anthropic", clientOver(transport));
    const events = parseSse(ANTHROPIC.stream);
    const firstDelta = events.findIndex(
      (event) => event.type === "content_block_delta",
    );
    const head = ANTHROPIC.stream.split("\n\n").slice(0, firstDelta + 1);

    const iterator = provider.chatStream!(request(ANTHROPIC_MODEL), ctxWith())[
      Symbol.asyncIterator
    ]();
    const next = iterator.next();
    await macrotask();
    const call = transport.calls[0]!;
    call.push(`${head.join("\n\n")}\n\n`);
    const first = await next;
    expect(first.value).toStrictEqual({ deltaText: PIECES[0], done: false });

    // The consumer leaves: `break` in a for-await calls `return()`.
    await expect(iterator.return!()).resolves.toMatchObject({ done: true });

    expect(call.xhr.aborted).toBe(true);
    // A stray progress event after the abort reads nothing.
    call.xhr.text += "event: content_block_delta\ndata: {}\n\n";
    call.tick();
    expect(call.xhr.readsAfterAbort).toBe(0);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it("a cancelled job token stops the stream with OperationCancelledError, not a network failure", async () => {
    const transport = fakeTransport({ stream: [], end: "hold" });
    const provider = build("openrouter", clientOver(transport));
    const source = createCancellationTokenSource();
    const seen: string[] = [];

    const done = (async () => {
      for await (const chunk of provider.chatStream!(
        request(OPENROUTER_MODEL),
        ctxWith(source.token),
      )) {
        seen.push(chunk.deltaText);
      }
    })().catch((e: unknown) => e);
    await macrotask();
    const call = transport.calls[0]!;
    const frames = OPENROUTER.stream.split("\n\n");
    call.push(`${frames.slice(0, 3).join("\n\n")}\n\n`);
    await macrotask();
    source.cancel({ kind: "user" });

    const error = await done;
    expect(error).toBeInstanceOf(OperationCancelledError);
    expect((error as OperationCancelledError).userFacing).toBe(false);
    expect(seen).toStrictEqual([PIECES[0], PIECES[1]]);
    expect(call.xhr.aborted).toBe(true);
    call.tick();
    expect(call.xhr.readsAfterAbort).toBe(0);
  });

  it("a consumer that leaves before the request is sent cancels it before the wire", async () => {
    const transport = fakeTransport({ stream: slices(OPENAI.stream) });
    const provider = build("openai", clientOver(transport));
    const stream = provider.chatStream!(request(OPENAI_MODEL), ctxWith());

    // Never iterated past creation: an async generator does not start until
    // `next()`, so nothing is sent at all.
    await stream[Symbol.asyncIterator]().return?.();

    expect(transport.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Done-when 4: the router falls back to chat() with no caller branch
// ---------------------------------------------------------------------------

describe("the router's streaming fallback", () => {
  it("routes a model with supportsStreaming: false through chat()", async () => {
    const mock = mockLLM([chatResponse("two words")], {
      streaming: true,
      models: [mockModel("no-stream", { supportsStreaming: false })],
    });
    const router = mockLLMRouter(
      [mock],
      mockSettings({ keyPresent: { openrouter: true } }),
    );

    const chunks = await collect(
      router.chatStream(request("no-stream"), ctxWith()),
    );

    expect(chunks).toStrictEqual([
      {
        deltaText: "two words",
        done: true,
        usage: chatResponse("two words").usage,
      },
    ]);
  });

  it("streams a model with supportsStreaming: true, and one the adapter does not know", async () => {
    for (const model of ["streams", "unknown-model"]) {
      const mock = mockLLM([chatResponse("two words")], {
        streaming: true,
        models: [mockModel("streams", { supportsStreaming: true })],
      });
      const router = mockLLMRouter(
        [mock],
        mockSettings({ keyPresent: { openrouter: true } }),
      );

      const chunks = await collect(
        router.chatStream(request(model), ctxWith()),
      );

      expect(chunks.map((chunk) => chunk.deltaText)).toStrictEqual([
        "two ",
        "words",
        "",
      ]);
    }
  });

  it("applies the stream's truncation rule to the chat() fallback", async () => {
    const mock = mockLLM([chatResponse("cut off", { finishReason: "length" })]);
    const router = mockLLMRouter(
      [mock],
      mockSettings({ keyPresent: { openrouter: true } }),
    );

    await expect(
      collect(router.chatStream(request("mock-small"), ctxWith())),
    ).rejects.toBeInstanceOf(OutputTruncatedError);
  });
});

// ---------------------------------------------------------------------------
// 6. Truncation, refusal and errors after HTTP 200
// ---------------------------------------------------------------------------

describe("what a terminal or error event means", () => {
  it("a truncated stream throws OutputTruncatedError after the text it delivered", async () => {
    const truncated = ANTHROPIC.stream.replace(
      '"stop_reason":"end_turn"',
      '"stop_reason":"max_tokens"',
    );
    const transport = fakeTransport({ stream: slices(truncated) });
    const provider = build("anthropic", clientOver(transport));
    const seen: string[] = [];

    const error = await (async () => {
      for await (const chunk of provider.chatStream!(
        request(ANTHROPIC_MODEL),
        ctxWith(),
      )) {
        seen.push(chunk.deltaText);
      }
    })().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OutputTruncatedError);
    expect((error as OutputTruncatedError).context).toMatchObject({
      finishReason: "length",
      maxOutputTokens: 512,
      outputLength: TEXT.length,
    });
    expect(seen.join("")).toBe(TEXT);
  });

  it("OpenAI's response.incomplete with max_output_tokens is a truncation too", async () => {
    const incomplete = {
      ...OPENAI_RESPONSE,
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    const stream = OPENAI.stream.replace(
      sse([
        {
          event: "response.completed",
          data: { type: "response.completed", response: OPENAI_RESPONSE },
        },
      ]),
      sse([
        {
          event: "response.incomplete",
          data: { type: "response.incomplete", response: incomplete },
        },
      ]),
    );
    const transport = fakeTransport({ stream: slices(stream) });
    const provider = build("openai", clientOver(transport));

    await expect(
      collect(provider.chatStream!(request(OPENAI_MODEL), ctxWith())),
    ).rejects.toBeInstanceOf(OutputTruncatedError);
  });

  it("a refusal on the stream is ContentFilterError, as on chat()", async () => {
    const filtered = OPENROUTER.stream.replace(
      '"finish_reason":"stop"',
      '"finish_reason":"content_filter"',
    );
    const transport = fakeTransport({ stream: slices(filtered) });
    const provider = build("openrouter", clientOver(transport));

    await expect(
      collect(provider.chatStream!(request(OPENROUTER_MODEL), ctxWith())),
    ).rejects.toBeInstanceOf(ContentFilterError);
  });

  it("Anthropic's event: error after HTTP 200 is the 529 overload, not a short success (§6.2 note 4)", async () => {
    const frames = ANTHROPIC.stream.split("\n\n");
    const overloaded = [
      ...frames.slice(0, 5),
      sse([
        {
          event: "error",
          data: {
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          },
        },
      ]).trimEnd(),
      "",
    ].join("\n\n");
    const transport = fakeTransport({
      stream: slices(overloaded),
      end: "hold",
    });
    const provider = build("anthropic", clientOver(transport));

    const error = await collect(
      provider.chatStream!(request(ANTHROPIC_MODEL), ctxWith()),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamServerError);
    expect((error as UpstreamServerError).context).toMatchObject({
      overloaded: true,
    });
    // The error ended the stream; the still-open request was aborted.
    expect(transport.calls[0]?.xhr.aborted).toBe(true);
  });

  it("OpenRouter's mid-stream error chunk maps through mapProviderError", async () => {
    const stream = sse([
      {
        data: {
          error: { code: 402, message: "spend cap" },
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "error" },
          ],
        },
      },
    ]);
    const transport = fakeTransport({ stream: [stream] });
    const provider = build("openrouter", clientOver(transport));

    await expect(
      collect(provider.chatStream!(request(OPENROUTER_MODEL), ctxWith())),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("an error status before the stream is classified whole, as for chat()", async () => {
    const transport = fakeTransport({
      status: 402,
      stream: [JSON.stringify({ error: { code: 402, message: "spend cap" } })],
    });
    const provider = build("openrouter", clientOver(transport));

    await expect(
      collect(provider.chatStream!(request(OPENROUTER_MODEL), ctxWith())),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

// ---------------------------------------------------------------------------
// 7. The bridge on its own
// ---------------------------------------------------------------------------

describe("streamSseEvents", () => {
  it("yields events as text arrives and rethrows the request's failure after them", async () => {
    let sink: ((text: string) => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const events = streamSseEvents(
      (hooks) =>
        new Promise((_resolve, reject) => {
          sink = hooks.onBodyText;
          fail = reject;
        }),
      createCancellationTokenSource().token,
    );

    const first = events.next();
    await macrotask();
    sink?.("data: a\n\nda");
    expect((await first).value).toMatchObject({ data: "a" });
    const second = events.next();
    sink?.("ta: b\n\n");
    expect((await second).value).toMatchObject({ data: "b" });
    const third = events.next();
    fail?.(new NetworkError("dropped"));
    await expect(third).rejects.toBeInstanceOf(NetworkError);
  });
});

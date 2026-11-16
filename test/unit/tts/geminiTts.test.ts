/**
 * `plan/09` `P6-T05` — the Gemini TTS client, layer 1 (`docs/13` §2.1): plain
 * Node, no Zotero, **no network and no live call**. Every body below is
 * hand-built from `docs/04` §2.3–§2.4 and `docs/03` §11.5's error envelope;
 * the stand-ins of `test/fixtures/tts/gemini/` are replayed by
 * `test/contract/tts/geminiTts.contract.test.ts`.
 *
 * Every key is synthetic and assembled at run time in Google's key shape, so
 * the redactor would recognise one that leaked and no key-shaped literal sits
 * in the source.
 */

import { describe, expect, it } from "vitest";

import { type Clock, createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ContentFilterError,
  MissingCredentialError,
  OperationCancelledError,
  RateLimitError,
  TTSError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { retryPolicyFromBudget } from "../../../src/core/http/retry";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import {
  LLM_ATTEMPT_TIMEOUT_MS,
  LLM_KEY_TEST_TIMEOUT_MS,
  LLM_RETRY_BUDGET,
} from "../../../src/core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import {
  GEMINI_API_KEY_HEADER,
  GEMINI_HOST,
  GEMINI_SECRET_ID,
} from "../../../src/llm/gemini/geminiProvider";
import { readTtsModelList } from "../../../src/llm/gemini/mapper";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type { LLMCallContext } from "../../../src/llm/types";
import {
  audioLanguageOf,
  buildTtsBody,
  createGeminiTts,
  decodeBase64,
  GEMINI_TTS_DEFAULT_VOICE,
  GEMINI_TTS_FALLBACK_MODEL,
  GEMINI_TTS_MAX_CHUNK_CHARS,
  GEMINI_TTS_VOICES,
  type GeminiTtsDeps,
  maxChunkCharsFor,
  ttsFailureReason,
} from "../../../src/tts/geminiTts";
import type { SynthesisRequest } from "../../../src/tts/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const BASE = "https://generativelanguage.googleapis.com";
const MODELS_URL = `${BASE}/v1beta/models`;
const UA = "research_helper/9.9.9 (https://example.test)";
const MODEL = "gemini-9.9-flash-tts";

/** A synthetic Google-shaped key. */
function syntheticKey(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let tail = "";
  for (let i = 0; i < 35; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "x";
  }
  return ["AI", "za"].join("") + tail;
}

/** A `SecretStore` holding one value, under `id`. */
function memorySecrets(
  id: SecretId,
  value: string | undefined,
): SecretStore & { gets: SecretId[] } {
  const gets: SecretId[] = [];
  return {
    gets,
    backend: "session-only",
    unattended: true,
    get: (asked) => {
      gets.push(asked);
      return Promise.resolve(asked === id ? value : undefined);
    },
    has: (asked) => Promise.resolve(asked === id && value !== undefined),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    listStoredIds: () => Promise.resolve(value === undefined ? [] : [id]),
    clearAll: () => Promise.resolve(0),
  };
}

interface Answer {
  readonly status: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

class StubZoteroException extends Error {}

/** A `Zotero.HTTP`-shaped transport answering call `i` with `answers[i]` (the last repeats). */
function scriptedTransport(
  answers: readonly Answer[],
): HttpTransport & { readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    request(method, url, options) {
      const answer = answers[Math.min(calls.length, answers.length - 1)];
      calls.push({ method, url, options });
      const block = Object.entries(answer?.headers ?? {})
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      const xhr: HttpTransportXhr = {
        status: answer?.status ?? 0,
        responseText: answer?.body ?? "",
        responseURL: url,
        getAllResponseHeaders: () => block,
      };
      return Promise.resolve(xhr);
    },
    UnexpectedStatusException:
      StubZoteroException as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: StubZoteroException,
    BrowserOfflineException: StubZoteroException,
    SecurityException: StubZoteroException,
    CancelledException: StubZoteroException,
  };
}

/** A clock whose waits return at once. */
function instantClock(): Clock {
  return { now: () => NOW, sleep: () => Promise.resolve() };
}

/**
 * The shipped client with Gemini's LLM retry budget, as the container gives it,
 * so a test can show `synthesize` is **not** retried by it.
 */
function shippedClient(transport: HttpTransport): HttpClient {
  return createHttpClient({
    transport,
    userAgent: UA,
    clock: instantClock(),
    retryFor: (host) =>
      host === GEMINI_HOST
        ? retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0)
        : undefined,
  });
}

function capturingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const write = (msg: string, context?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(context ?? {})}`);
  };
  const logger: Logger & { lines: string[] } = {
    lines,
    child: () => logger,
    error: write,
    warn: write,
    info: write,
    debug: write,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function build(
  answers: readonly Answer[],
  /** `null`: no key stored. */
  key: string | null = syntheticKey(),
  extra: Partial<GeminiTtsDeps> = {},
) {
  const transport = scriptedTransport(answers);
  const secrets = memorySecrets(GEMINI_SECRET_ID, key ?? undefined);
  const logger = capturingLogger();
  const tts = createGeminiTts({
    http: shippedClient(transport),
    secrets,
    secretId: GEMINI_SECRET_ID,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    clock: createManualClock(NOW),
    logger,
    ...extra,
  });
  return { tts, transport, secrets, logger, key: key ?? "" };
}

function request(overrides: Partial<SynthesisRequest> = {}): SynthesisRequest {
  return {
    text: "Lipid nanoparticles now dominate CRISPR delivery.",
    language: "en-US",
    voice: "Charon",
    model: MODEL,
    styleInstruction: "Read calmly.\n\n---\n\n",
    traceId: "trace-1",
    ...overrides,
  };
}

/** Bytes → standard base64, through Node's own encoder (the oracle). */
function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** `docs/04` §2.4's answer, synthetic, around `pcm`. */
function audioAnswer(
  pcm: Uint8Array,
  overrides: { mimeType?: string; usage?: Record<string, unknown> | null } = {},
): Answer {
  const body: Record<string, unknown> = {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType:
                  overrides.mimeType ?? "audio/L16;codec=pcm;rate=24000",
                data: base64Of(pcm),
              },
            },
          ],
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
  };
  if (overrides.usage !== null) {
    body.usageMetadata = overrides.usage ?? {
      promptTokenCount: 38,
      candidatesTokenCount: 780,
      totalTokenCount: 818,
    };
  }
  return { status: 200, body: JSON.stringify(body) };
}

function geminiError(
  code: number,
  status: string,
  message: string,
  reasons: readonly string[] = [],
): string {
  return JSON.stringify({
    error: {
      code,
      message,
      status,
      details: reasons.map((reason) => ({ reason })),
    },
  });
}

function modelList(ids: readonly string[]): Answer {
  return {
    status: 200,
    body: JSON.stringify({
      models: [
        {
          name: "models/gemini-9.9-flash",
          supportedGenerationMethods: ["generateContent", "countTokens"],
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 65_536,
        },
        ...ids.map((id) => ({
          name: `models/${id}`,
          displayName: id.toUpperCase(),
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 32_000,
        })),
      ],
    }),
  };
}

/** A tiny PCM buffer: `n` 16-bit samples. */
function pcmOf(samples: number): Uint8Array {
  const out = new Uint8Array(samples * 2);
  for (let i = 0; i < out.length; i += 1) out[i] = (i * 37) & 0xff;
  return out;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

describe("buildTtsBody (docs/04 §2.3)", () => {
  it("sends the style instruction then the text, byte for byte, with the voice", () => {
    const body = buildTtsBody(request());
    expect(body).toEqual({
      contents: [
        {
          parts: [
            {
              text: "Read calmly.\n\n---\n\nLipid nanoparticles now dominate CRISPR delivery.",
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
        },
      },
    });
  });

  it("sends the text alone when there is no style instruction", () => {
    const { styleInstruction: _drop, ...rest } = request();
    expect(buildTtsBody(rest).contents[0]?.parts[0]?.text).toBe(rest.text);
  });

  it("carries no Interactions field: no store, language or response_format", () => {
    const text = JSON.stringify(buildTtsBody(request({ language: "ko-KR" })));
    expect(text).not.toMatch(/"store"|"language"|response_format|ko-KR/u);
  });
});

describe("synthesize", () => {
  it("POSTs generateContent with the key in x-goog-api-key only, and returns the PCM", async () => {
    const pcm = pcmOf(1200);
    const { tts, transport, key } = build([audioAnswer(pcm)]);
    const audio = await tts.synthesize(request(), ctx());

    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${BASE}/v1beta/models/${MODEL}:generateContent`);
    expect(call?.url).not.toContain(key);
    expect(call?.url).not.toMatch(/[?&]key=/u);
    expect(call?.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(key);
    expect(call?.options.timeout).toBe(LLM_ATTEMPT_TIMEOUT_MS);
    expect(JSON.parse(call?.options.body ?? "{}")).toEqual(
      buildTtsBody(request()),
    );

    expect(Array.from(audio.data)).toEqual(Array.from(pcm));
    expect(audio.sampleRateHz).toBe(24000);
    expect(audio.durationSeconds).toBeCloseTo(1200 / 24000, 10);
    expect(audio.mimeType).toBe("audio/L16;codec=pcm;rate=24000");
    expect(audio.fileExtension).toBe("pcm");
    expect(audio.model).toBe(MODEL);
    expect(audio.voice).toBe("Charon");
    expect(audio.usage).toEqual({
      inputTokens: 38,
      outputTokens: 780,
      totalTokens: 818,
      costUsd: undefined,
    });
  });

  it("reads the sample rate from the mimeType", async () => {
    const { tts } = build([
      audioAnswer(pcmOf(10), { mimeType: "audio/L16;codec=pcm;rate=16000" }),
    ]);
    const audio = await tts.synthesize(request(), ctx());
    expect(audio.sampleRateHz).toBe(16000);
    expect(audio.durationSeconds).toBeCloseTo(10 / 16000, 10);
  });

  it("leaves usage undefined when the answer carries no usageMetadata", async () => {
    const { tts } = build([audioAnswer(pcmOf(4), { usage: null })]);
    expect((await tts.synthesize(request(), ctx())).usage).toBeUndefined();
  });

  it("encodes the model id into the path", async () => {
    const { tts, transport } = build([audioAnswer(pcmOf(4))]);
    await tts.synthesize(request({ model: "a b/c" }), ctx());
    expect(transport.calls[0]?.url).toBe(
      `${BASE}/v1beta/models/a%20b%2Fc:generateContent`,
    );
  });

  it("makes one attempt on a 429, whatever the host's retry policy (P6-T11 retries)", async () => {
    const { tts, transport } = build([
      {
        status: 429,
        body: geminiError(429, "RESOURCE_EXHAUSTED", "quota"),
        headers: { "retry-after": "2" },
      },
      audioAnswer(pcmOf(4)),
    ]);
    const error = await rejectionOf(tts.synthesize(request(), ctx()));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(2000);
    expect(transport.calls).toHaveLength(1);
  });

  it("makes one attempt on a 5xx too", async () => {
    const { tts, transport } = build([
      { status: 503, body: geminiError(503, "UNAVAILABLE", "overloaded") },
      audioAnswer(pcmOf(4)),
    ]);
    const error = await rejectionOf(tts.synthesize(request(), ctx()));
    expect(error).toBeInstanceOf(UpstreamServerError);
    expect(transport.calls).toHaveLength(1);
  });

  it.each([
    [
      "a bad key (400 API_KEY_INVALID)",
      {
        status: 400,
        body: geminiError(400, "INVALID_ARGUMENT", "API key not valid", [
          "API_KEY_INVALID",
        ]),
      },
      AuthenticationError,
    ],
    [
      "401",
      { status: 401, body: geminiError(401, "UNAUTHENTICATED", "no") },
      AuthenticationError,
    ],
    [
      "403 (no entitlement)",
      { status: 403, body: geminiError(403, "PERMISSION_DENIED", "denied") },
      AuthorizationError,
    ],
    [
      "404 (model gone)",
      { status: 404, body: geminiError(404, "NOT_FOUND", "no such model") },
      BadRequestError,
    ],
  ])(
    "maps %s to its own class, with no key in any message",
    async (_label, answer, cls) => {
      const { tts, transport, key } = build([answer]);
      const error = await rejectionOf(tts.synthesize(request(), ctx()));
      expect(error).toBeInstanceOf(cls);
      expect(String((error as Error).message)).not.toContain(key);
      expect(JSON.stringify((error as TTSError).context)).not.toContain(key);
      expect(transport.calls).toHaveLength(1);
    },
  );

  it("does not leak a key the service echoes back in an error body", async () => {
    const key = syntheticKey();
    const { tts } = build(
      [
        {
          status: 403,
          body: geminiError(403, "PERMISSION_DENIED", `key ${key} refused`),
        },
      ],
      key,
    );
    const error = (await rejectionOf(
      tts.synthesize(request(), ctx()),
    )) as AuthorizationError;
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(`${error.message} ${JSON.stringify(error.context)}`).not.toContain(
      key,
    );
  });

  it("reads a 200 safety stop as ContentFilterError", async () => {
    const { tts } = build([
      {
        status: 200,
        body: JSON.stringify({
          candidates: [{ finishReason: "SAFETY", content: { parts: [] } }],
        }),
      },
    ]);
    expect(await rejectionOf(tts.synthesize(request(), ctx()))).toBeInstanceOf(
      ContentFilterError,
    );
  });

  it("refuses a 200 with only a text part as TTSError reason no-audio", async () => {
    const { tts } = build([
      {
        status: 200,
        body: JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "I cannot." }] },
              finishReason: "STOP",
            },
          ],
        }),
      },
    ]);
    const error = await rejectionOf(tts.synthesize(request(), ctx()));
    expect(error).toBeInstanceOf(TTSError);
    expect(ttsFailureReason(error)).toBe("no-audio");
  });

  it("refuses an empty or undecodable audio part as no-audio", async () => {
    for (const data of ["", "not base64 !!"]) {
      const { tts } = build([
        {
          status: 200,
          body: JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;codec=pcm;rate=24000",
                        data,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      ]);
      const error = await rejectionOf(tts.synthesize(request(), ctx()));
      expect(ttsFailureReason(error)).toBe("no-audio");
    }
  });

  it.each(["audio/mpeg", "audio/wav", "audio/L24;rate=24000", ""])(
    "refuses mimeType %j as unsupported-format",
    async (mimeType) => {
      const { tts } = build([audioAnswer(pcmOf(8), { mimeType })]);
      const error = await rejectionOf(tts.synthesize(request(), ctx()));
      expect(error).toBeInstanceOf(TTSError);
      expect(ttsFailureReason(error)).toBe("unsupported-format");
    },
  );

  it("accepts the PCM mimeType in any case", async () => {
    const { tts } = build([
      audioAnswer(pcmOf(2), { mimeType: "AUDIO/l16; rate=24000" }),
    ]);
    expect((await tts.synthesize(request(), ctx())).sampleRateHz).toBe(24000);
  });

  it("refuses audio that is not whole 16-bit samples as malformed-response", async () => {
    const { tts } = build([audioAnswer(new Uint8Array([1, 2, 3]))]);
    const error = await rejectionOf(tts.synthesize(request(), ctx()));
    expect(ttsFailureReason(error)).toBe("malformed-response");
  });

  it("refuses a 200 that is not a JSON object as malformed-response", async () => {
    const { tts } = build([{ status: 200, body: "<html>nope</html>" }]);
    const error = await rejectionOf(tts.synthesize(request(), ctx()));
    expect(ttsFailureReason(error)).toBe("malformed-response");
  });

  it("throws MissingCredentialError with zero requests when no key is stored", async () => {
    const { tts, transport } = build([audioAnswer(pcmOf(2))], null);
    expect(await rejectionOf(tts.synthesize(request(), ctx()))).toBeInstanceOf(
      MissingCredentialError,
    );
    expect(transport.calls).toHaveLength(0);
  });

  it("throws MissingCredentialError with no store at all", async () => {
    const { tts, transport } = build([audioAnswer(pcmOf(2))], null, {
      secrets: undefined,
    });
    expect(tts.isConfigured()).toBe(false);
    expect(await rejectionOf(tts.synthesize(request(), ctx()))).toBeInstanceOf(
      MissingCredentialError,
    );
    expect(transport.calls).toHaveLength(0);
  });

  it("reads the key from the secret id it was built with", async () => {
    const other: SecretId = "tts.gemini";
    const key = syntheticKey();
    const transport = scriptedTransport([audioAnswer(pcmOf(2))]);
    const secrets = memorySecrets(other, key);
    const tts = createGeminiTts({
      http: shippedClient(transport),
      secrets,
      secretId: other,
      baseUrls: createBaseUrlResolver({ override: () => "" }),
    });
    await tts.synthesize(request(), ctx());
    expect(secrets.gets).toEqual([other]);
    expect(transport.calls[0]?.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(
      key,
    );
  });

  it("sends nothing on a cancelled token", async () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const { tts, transport } = build([audioAnswer(pcmOf(2))]);
    expect(
      await rejectionOf(tts.synthesize(request(), { token: source.token })),
    ).toBeInstanceOf(OperationCancelledError);
    expect(transport.calls).toHaveLength(0);
  });

  it("logs the request without the key", async () => {
    const { tts, logger, key } = build([audioAnswer(pcmOf(2))]);
    await tts.synthesize(request(), ctx());
    expect(logger.lines.join("\n")).not.toContain(key);
    expect(logger.lines.some((l) => l.startsWith("gemini tts request"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// The model, the voices, the sizes, the key test
// ---------------------------------------------------------------------------

describe("resolveModel (docs/04 §2.2, §7.5)", () => {
  it("returns tts.model when set, with no request", async () => {
    const { tts, transport } = build([modelList([])]);
    expect(await tts.resolveModel("  my-own-tts  ", ctx())).toBe("my-own-tts");
    expect(transport.calls).toHaveLength(0);
  });

  it("takes the dated recommendation when the live list holds it", async () => {
    const { tts, transport } = build([
      modelList(["gemini-9.9-pro-tts", GEMINI_TTS_FALLBACK_MODEL]),
    ]);
    expect(await tts.resolveModel("", ctx())).toBe(GEMINI_TTS_FALLBACK_MODEL);
    expect(transport.calls[0]?.method).toBe("GET");
    expect(transport.calls[0]?.url).toBe(MODELS_URL);
  });

  it("takes the first TTS model of the list otherwise", async () => {
    const { tts } = build([modelList(["gemini-9.9-pro-tts", MODEL])]);
    expect(await tts.resolveModel("", ctx())).toBe("gemini-9.9-pro-tts");
  });

  it("refuses a list with no TTS model as model-gone", async () => {
    const { tts } = build([modelList([])]);
    expect(
      ttsFailureReason(await rejectionOf(tts.resolveModel("", ctx()))),
    ).toBe("model-gone");
  });

  it("falls back to the one compiled-in id when the list cannot be read, and logs no body", async () => {
    const { tts, logger } = build([
      { status: 500, body: geminiError(500, "INTERNAL", "secret-body-text") },
    ]);
    expect(await tts.resolveModel("", ctx())).toBe(GEMINI_TTS_FALLBACK_MODEL);
    expect(logger.lines.join("\n")).toContain("fallback model");
    expect(logger.lines.join("\n")).not.toContain("secret-body-text");
  });

  it("falls back when the list is not JSON", async () => {
    const { tts } = build([{ status: 200, body: "nope" }]);
    expect(await tts.resolveModel("", ctx())).toBe(GEMINI_TTS_FALLBACK_MODEL);
  });

  it("does not fall back on a missing key or a cancel", async () => {
    const missing = build([modelList([MODEL])], null);
    expect(
      await rejectionOf(missing.tts.resolveModel("", ctx())),
    ).toBeInstanceOf(MissingCredentialError);
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const cancelled = build([modelList([MODEL])]);
    expect(
      await rejectionOf(
        cancelled.tts.resolveModel("", { token: source.token }),
      ),
    ).toBeInstanceOf(OperationCancelledError);
  });
});

describe("readTtsModelList (mapper)", () => {
  it("keeps TTS entries that support generateContent, prefix stripped, in list order", () => {
    const raw = {
      models: [
        {
          name: "models/gemini-9.9-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/x-9-tts",
          supportedGenerationMethods: ["generateContent"],
          displayName: "X",
        },
        {
          name: "models/y-9-tts",
          supportedGenerationMethods: ["embedContent"],
        },
        { name: "models/z-9-tts" },
        {
          displayName: "no name",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "w-9-tts-preview",
          supportedGenerationMethods: ["generateContent"],
        },
        "not a record",
      ],
    };
    expect(readTtsModelList(raw)).toEqual([
      { id: "x-9-tts", displayName: "X" },
      { id: "w-9-tts-preview", displayName: "w-9-tts-preview" },
    ]);
  });

  it("reads an answer with no models array as empty", () => {
    expect(readTtsModelList({})).toEqual([]);
  });
});

describe("listVoices (docs/04 §2.7)", () => {
  it("lists the 30 documented voices, unique, multilingual, with the default among them", async () => {
    const { tts, transport } = build([modelList([])]);
    const voices = await tts.listVoices("ko-KR", ctx());
    expect(voices).toBe(GEMINI_TTS_VOICES);
    expect(voices).toHaveLength(30);
    expect(new Set(voices.map((v) => v.id)).size).toBe(30);
    expect(voices.every((v) => v.languages === "multilingual")).toBe(true);
    expect(
      voices.find((v) => v.id === GEMINI_TTS_DEFAULT_VOICE)?.description,
    ).toBe("Informative");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("maxInputChars (docs/04 §5.2)", () => {
  it("is 900 for English and 450 for Korean", () => {
    const { tts } = build([]);
    expect(GEMINI_TTS_MAX_CHUNK_CHARS).toEqual({ en: 900, ko: 450 });
    expect(tts.maxInputChars("en")).toBe(900);
    expect(tts.maxInputChars("en-US")).toBe(900);
    expect(tts.maxInputChars("ko")).toBe(450);
    expect(tts.maxInputChars("ko-KR")).toBe(450);
  });

  it("gives an unshipped language the smaller target", () => {
    expect(maxChunkCharsFor("fr-FR")).toBe(450);
    expect(audioLanguageOf("fr")).toBeUndefined();
    expect(audioLanguageOf(" KO_kr ")).toBe("ko");
  });
});

describe("validateCredentials", () => {
  it("reads the model list once, in one 15 s attempt, and makes no billed call", async () => {
    const { tts, transport } = build([modelList([MODEL])]);
    expect(await tts.validateCredentials(ctx())).toEqual({
      ok: true,
      messageKey: "research-helper-prefs-test-ok",
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.method).toBe("GET");
    expect(transport.calls[0]?.options.timeout).toBe(LLM_KEY_TEST_TIMEOUT_MS);
  });

  it("answers a bad key with its message id and status, not a throw", async () => {
    const { tts } = build([
      {
        status: 400,
        body: geminiError(400, "INVALID_ARGUMENT", "bad", ["API_KEY_INVALID"]),
      },
    ]);
    expect(await tts.validateCredentials(ctx())).toEqual({
      ok: false,
      messageKey: "rh-error-auth",
      httpStatus: 400,
    });
  });

  it("counts a 429 as an accepted key, after one attempt", async () => {
    const { tts, transport } = build([
      { status: 429, body: geminiError(429, "RESOURCE_EXHAUSTED", "slow") },
    ]);
    expect((await tts.validateCredentials(ctx())).ok).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });
});

describe("decodeBase64", () => {
  it("matches Node's decoder on every length and padding", () => {
    for (let n = 0; n < 40; n += 1) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 151 + n) & 0xff;
      const encoded = base64Of(bytes);
      expect(Array.from(decodeBase64(encoded) ?? [])).toEqual(
        Array.from(bytes),
      );
      expect(
        Array.from(decodeBase64(encoded.replace(/=+$/u, "")) ?? []),
      ).toEqual(Array.from(bytes));
    }
  });

  it("ignores whitespace and refuses a character outside the alphabet", () => {
    expect(Array.from(decodeBase64("AQID\nBA==") ?? [])).toEqual([1, 2, 3, 4]);
    expect(decodeBase64("AQ-D")).toBeUndefined();
    expect(decodeBase64("A")).toBeUndefined();
  });
});

describe("the client's identity", () => {
  it("is Gemini, paced on Gemini's host", () => {
    const { tts } = build([]);
    expect(tts.id).toBe("gemini");
    expect(tts.rateLimitKey).toBe(GEMINI_HOST);
    expect(tts.displayNameKey).toBe("research-helper-provider-gemini");
    expect(tts.isConfigured()).toBe(true);
  });
});

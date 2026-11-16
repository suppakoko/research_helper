/**
 * The Gemini TTS client's contract tests — `plan/09` `P6-T05`, `docs/13` §2.2
 * layer 2, over `test/fixtures/tts/gemini/` (`P6-T03`'s stand-ins; the owner's
 * recordings replace them under `P6-T04`, gate `G-44`).
 *
 * **No network, ever.** Each request is answered from the scenario's fixture
 * file by the transport below and nothing else; a missing fixture is an error
 * naming the command that writes it. The key is the recorder's synthetic
 * `invalidLlmKey("gemini")`, built at run time.
 *
 * **What a stand-in proves.** Today every fixture is `"synthetic": true`: the
 * response shape is `docs/04` §2.4's around a generated tone, so these tests
 * pin the client to the documented shape and to the recorder's request. When
 * `P6-T04`'s recordings land the same tests read them unchanged; a failure then
 * is the service changing, not our code (`[service]`).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  GEMINI_API_KEY_HEADER,
  GEMINI_SECRET_ID,
} from "../../../src/llm/gemini/geminiProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type { LLMCallContext } from "../../../src/llm/types";
import {
  buildTtsBody,
  createGeminiTts,
  decodeBase64,
  type GeminiTts,
  GEMINI_TTS_FALLBACK_MODEL,
  ttsFailureReason,
} from "../../../src/tts/geminiTts";
import type { SynthesisRequest } from "../../../src/tts/types";
import {
  invalidLlmKey,
  singleKeyStore,
  ttsFixtureDirFor,
  ttsRequestBody,
  TTS_TEXTS,
  TTS_UNKNOWN_MODEL,
  TTS_VOICE,
} from "../../../scripts/record-fixtures";
import {
  FROZEN_NOW_EPOCH_MS,
  type RecordedExchange,
  ReplayBrowserOfflineException,
  ReplayCancelledException,
  ReplaySecurityException,
  ReplayTimeoutException,
  ReplayUnexpectedStatusException,
} from "../_transport";

const DIR = ttsFixtureDirFor("gemini-tts");
const KEY = invalidLlmKey("gemini");
const BASE = "https://generativelanguage.googleapis.com";

/** One request the replay answered. */
interface ReplayCall {
  readonly method: string;
  readonly url: string;
  readonly options: HttpTransportOptions;
}

/** Answers every request with `<scenario>.json`, whatever its body. */
function scenarioTransport(
  scenario: string,
): HttpTransport & { readonly calls: ReplayCall[] } {
  const calls: ReplayCall[] = [];
  return {
    calls,
    async request(method, url, options): Promise<HttpTransportXhr> {
      calls.push({ method, url, options });
      let recorded: RecordedExchange;
      try {
        recorded = JSON.parse(
          await readFile(join(DIR, `${scenario}.json`), "utf8"),
        ) as RecordedExchange;
      } catch {
        throw new Error(
          `Missing fixture ${DIR}/${scenario}.json for gemini-tts scenario ` +
            `"${scenario}". Write the stand-ins with: FIXTURE_MODE=synthetic ` +
            `npm run fixtures:record -- --source gemini-tts`,
        );
      }
      const block = Object.entries(recorded.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      return {
        status: recorded.status,
        responseText: recorded.body,
        responseURL: url,
        getAllResponseHeaders: () => block,
      };
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

function clientFor(scenario: string): {
  readonly tts: GeminiTts;
  readonly transport: ReturnType<typeof scenarioTransport>;
} {
  const transport = scenarioTransport(scenario);
  const clock = createManualClock(FROZEN_NOW_EPOCH_MS);
  const tts = createGeminiTts({
    http: createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
    }),
    secrets: singleKeyStore("gemini", KEY),
    secretId: GEMINI_SECRET_ID,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    clock,
  });
  return { tts, transport };
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function speak(
  language: "en" | "ko",
  model = GEMINI_TTS_FALLBACK_MODEL,
): SynthesisRequest {
  return {
    text: TTS_TEXTS[language],
    language: language === "en" ? "en-US" : "ko-KR",
    voice: TTS_VOICE,
    model,
    traceId: `contract-${language}`,
  };
}

/** The fixture's own audio part and usage, read independently of the client. */
async function fixtureAudio(scenario: string): Promise<{
  readonly base64: string;
  readonly candidatesTokenCount: number;
}> {
  const recorded = JSON.parse(
    await readFile(join(DIR, `${scenario}.json`), "utf8"),
  ) as RecordedExchange;
  const body = JSON.parse(recorded.body) as {
    candidates: { content: { parts: { inlineData: { data: string } }[] } }[];
    usageMetadata: { candidatesTokenCount: number };
  };
  const data = body.candidates[0]?.content.parts[0]?.inlineData.data;
  if (data === undefined) throw new Error(`${scenario}: no audio part`);
  return {
    base64: data,
    candidatesTokenCount: body.usageMetadata.candidatesTokenCount,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("gemini-tts — the request matches the recorder's [ours]", () => {
  it("sends the recorder's body, to generateContent, with the key in its header only", async () => {
    const { tts, transport } = clientFor("tts-en-short");
    await tts.synthesize(speak("en"), ctx());
    const call = transport.calls[0];
    expect(transport.calls).toHaveLength(1);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(
      `${BASE}/v1beta/models/${GEMINI_TTS_FALLBACK_MODEL}:generateContent`,
    );
    expect(call?.url).not.toContain(KEY);
    expect(call?.options.headers?.[GEMINI_API_KEY_HEADER]).toBe(KEY);
    expect(JSON.parse(call?.options.body ?? "{}")).toEqual(
      ttsRequestBody(TTS_TEXTS.en, TTS_VOICE),
    );
    expect(buildTtsBody(speak("en"))).toEqual(
      ttsRequestBody(TTS_TEXTS.en, TTS_VOICE),
    );
  });
});

describe("gemini-tts — the answers parse [both]", () => {
  it.each(["tts-en-short", "tts-ko-short"] as const)(
    "%s parses into the PCM its base64 decodes to, at 24 kHz, with the output token count",
    async (scenario) => {
      const language = scenario === "tts-en-short" ? "en" : "ko";
      const { tts } = clientFor(scenario);
      const audio = await tts.synthesize(speak(language), ctx());
      const expected = await fixtureAudio(scenario);
      const decoded = Buffer.from(expected.base64, "base64");

      expect(audio.data.byteLength).toBe(decoded.byteLength);
      expect(Buffer.from(audio.data).equals(decoded)).toBe(true);
      expect(Array.from(decodeBase64(expected.base64) ?? [])).toEqual(
        Array.from(decoded),
      );
      expect(audio.sampleRateHz).toBe(24000);
      expect(audio.usage?.outputTokens).toBe(expected.candidatesTokenCount);
      expect(audio.durationSeconds).toBeCloseTo(decoded.byteLength / 48000, 10);
    },
  );

  it("models-list resolves the model and lists only TTS entries", async () => {
    const { tts, transport } = clientFor("models-list");
    const models = await tts.listTtsModels(ctx());
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => /-tts\b/u.test(m.id))).toBe(true);
    expect(models.every((m) => !m.id.startsWith("models/"))).toBe(true);
    const resolved = await tts.resolveModel("", ctx());
    expect(models.map((m) => m.id)).toContain(resolved);
    expect(transport.calls.every((c) => c.method === "GET")).toBe(true);
    expect(transport.calls[0]?.url).toBe(`${BASE}/v1beta/models`);
  });
});

describe("gemini-tts — the failures are specific [ours]", () => {
  it("error-invalid-key is AuthenticationError", async () => {
    const { tts } = clientFor("error-invalid-key");
    const error = await rejectionOf(tts.synthesize(speak("en"), ctx()));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it("error-unknown-model is BadRequestError with HTTP 404", async () => {
    const { tts } = clientFor("error-unknown-model");
    const error = await rejectionOf(
      tts.synthesize(speak("en", TTS_UNKNOWN_MODEL), ctx()),
    );
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).httpStatus).toBe(404);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it("error-429 is RateLimitError carrying Retry-After, after one attempt", async () => {
    const { tts, transport } = clientFor("error-429");
    const error = await rejectionOf(tts.synthesize(speak("en"), ctx()));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(2000);
    expect(transport.calls).toHaveLength(1);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it("no-audio-part is TTSError reason no-audio", async () => {
    const { tts } = clientFor("no-audio-part");
    const error = await rejectionOf(tts.synthesize(speak("en"), ctx()));
    expect(ttsFailureReason(error)).toBe("no-audio");
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it("the four failures are four different class-or-reason pairs", async () => {
    const seen = new Set<string>();
    for (const scenario of [
      "error-invalid-key",
      "error-unknown-model",
      "error-429",
      "no-audio-part",
    ]) {
      const { tts } = clientFor(scenario);
      const error = (await rejectionOf(
        tts.synthesize(speak("en"), ctx()),
      )) as Error;
      seen.add(`${error.name}/${ttsFailureReason(error) ?? ""}`);
    }
    expect(seen.size).toBe(4);
  });
});

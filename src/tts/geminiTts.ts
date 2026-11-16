/**
 * The Gemini TTS client — `docs/07` §4.4's `TTSProvider` over the legacy
 * `generateContent` path (`plan/09` `P6-T05`).
 *
 * **Caller and construction.** Constructed once in
 * `src/bootstrap/registerProviders.ts`, beside the Gemini chat adapter, and
 * held on `LLMServices.tts`; called by `synthesizeChunks` in
 * `src/pipeline/audioReport/synthesize.ts` (`P6-T11`) and, for the voice list
 * and the model, by the audio job (`P6-T16`).
 *
 * **Authority.** `docs/04` §2.1's note of 2026-11-16 (legacy surface only,
 * `plan/09` §0.4 line 5), §2.2 (never hardcode a model id), §2.3–§2.4 (the
 * request and the response), §2.7 (the voices), §5.2 (the chunk sizes), §6.2
 * (`ttsChunk`: the status is checked before the body is read); `docs/03`
 * §11.5–§11.6 for the error taxonomy, reached through `mapProviderError`.
 *
 * ## What it reuses, rather than copies
 *
 * The key header (`geminiHeaders`, the only `expose()` of the key), the host
 * (`GEMINI_HOST`), the model-list path (`MODELS_PATH`), the display-name id
 * and the secret id come from `src/llm/gemini/geminiProvider.ts`; the TTS
 * filter (`TTS_MODEL_ID`, `readTtsModelList`) from `src/llm/gemini/mapper.ts`;
 * every error answer is classified by `mapProviderError`
 * (`src/llm/shared/errorMap.ts`) inside the HTTP client's own attempt, as on
 * the chat path. The chat adapter's private transport is not exported, and it
 * reads `GEMINI_SECRET_ID` unconditionally; this client takes its secret id as
 * a constructor argument (`P6-T05`'s Notes), so it has its own four-line send.
 *
 * ## One request, never retried
 *
 * `synthesize` sends exactly one attempt (`HttpOptions.singleAttempt`), so the
 * host's retry policy does not re-send it behind the caller's back: the
 * synthesis loop owns retries and re-sends the same request byte for byte
 * (`docs/04` §5.3; `P6-T11`). The model-list reads keep the host's policy.
 *
 * ## The key
 *
 * Read from the `SecretStore` on every request, wrapped in `Secret` at once,
 * and sent only as `x-goog-api-key`; never in a URL (`docs/03` §1.3), never in
 * a log line (`loggableHeaders`), never in an error (every message below
 * passes `redact`, and `mapProviderError`'s context is already redacted).
 */

import { createSystemClock, type Clock } from "../core/clock";
import {
  LLMError,
  loggableHeaders,
  MissingCredentialError,
  OperationCancelledError,
  redact,
  ResearchHelperError,
  TTSError,
  UpstreamError,
} from "../core/errors";
import {
  httpRequest,
  type HttpClient,
  type HttpMethod,
  type HttpResponse,
} from "../core/http/client";
import type { Logger } from "../core/logger";
import {
  LLM_KEY_TEST_ATTEMPT,
  llmAttemptTimeouts,
  type LlmAttemptLimits,
} from "../core/rateLimit/hostLimiter";
import type { SecretId, SecretStore } from "../core/secretStore";
import {
  GEMINI_DISPLAY_NAME_KEY,
  GEMINI_HOST,
  geminiHeaders,
  MODELS_PATH,
} from "../llm/gemini/geminiProvider";
import {
  parseJsonObject,
  readTtsModelList,
  type TtsModelEntry,
} from "../llm/gemini/mapper";
import type { BaseUrlResolver } from "../llm/shared/baseUrl";
import { isKeyAcceptedFailure, mapProviderError } from "../llm/shared/errorMap";
import type { CredentialCheckResult, LLMCallContext } from "../llm/types";
import type { AudioLanguage } from "../model/audio";
import type { Usage } from "../model/usage";
import { Secret } from "../prefs/secrets";

import { pcmFormatFromMimeType } from "./audioStore";
import type {
  AudioArtifact,
  GeminiTtsRequest,
  SynthesisRequest,
  TTSProvider,
  VoiceInfo,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/**
 * The last-resort model, used **only** when the model list cannot be read
 * (`docs/04` §2.2: "Ship one hardcoded ID only as a last-resort fallback when
 * the list fetch fails"; `plan/09` §0.2 item 24). It is also `docs/04` §7.5's
 * dated recommendation, taken from the live list when the list holds it. The
 * one TTS model id compiled into `src/`; `P6-T05`'s grep checks there is no
 * other.
 */
export const GEMINI_TTS_FALLBACK_MODEL = "gemini-2.5-flash-preview-tts"; // LAST-RESORT FALLBACK, docs/04 §2.2

/**
 * `docs/04` §5.2's upper chunk targets, in UTF-16 code units: 900 English and
 * 450 Korean characters (about 40–60 and 55–80 seconds of speech). What
 * `TTSProvider.maxInputChars` returns, and what `chunkScript`
 * (`src/tts/chunk.ts`, `P6-T09`) reads.
 */
export const GEMINI_TTS_MAX_CHUNK_CHARS: Readonly<
  Record<AudioLanguage, number>
> = Object.freeze({ en: 900, ko: 450 });

/** `tts.voice`'s default (`docs/07` §8.5; `docs/04` §2.7's default narrator). */
export const GEMINI_TTS_DEFAULT_VOICE = "Charon";

/**
 * `docs/04` §2.7's 30 prebuilt voices with Google's descriptors, read column
 * by column from the table. A **default list, not a closed one**: the stored
 * `tts.voice` is validated by a real call (`P6-T19`), and a voice Google
 * rejects surfaces as that call's error. The same voices speak every language
 * (`docs/04` §2.8), hence `"multilingual"`.
 */
export const GEMINI_TTS_VOICES: readonly VoiceInfo[] = Object.freeze(
  (
    [
      ["Zephyr", "Bright"],
      ["Puck", "Upbeat"],
      ["Charon", "Informative"],
      ["Kore", "Firm"],
      ["Fenrir", "Excitable"],
      ["Leda", "Youthful"],
      ["Orus", "Firm"],
      ["Aoede", "Breezy"],
      ["Callirrhoe", "Easy-going"],
      ["Autonoe", "Bright"],
      ["Enceladus", "Breathy"],
      ["Iapetus", "Clear"],
      ["Umbriel", "Easy-going"],
      ["Algieba", "Smooth"],
      ["Despina", "Smooth"],
      ["Erinome", "Clear"],
      ["Algenib", "Gravelly"],
      ["Rasalgethi", "Informative"],
      ["Laomedeia", "Upbeat"],
      ["Achernar", "Soft"],
      ["Alnilam", "Firm"],
      ["Schedar", "Even"],
      ["Gacrux", "Mature"],
      ["Pulcherrima", "Forward"],
      ["Achird", "Friendly"],
      ["Zubenelgenubi", "Casual"],
      ["Vindemiatrix", "Gentle"],
      ["Sadachbia", "Lively"],
      ["Sadaltager", "Knowledgeable"],
      ["Sulafat", "Warm"],
    ] as const
  ).map(([id, description]): VoiceInfo =>
    Object.freeze({
      id,
      displayName: id,
      languages: "multilingual",
      description,
    }),
  ),
);

/** The `inlineData.mimeType` the legacy path returns: 16-bit linear PCM (`docs/04` §3.1). */
const PCM16_MIME_TYPE = /^audio\/l16(?:\s*;|$)/i;

/** The model id a model-list error is reported against. */
const MODEL_LIST_ID = "(tts model list)";

/** The installed client, reached through `httpRequest` on every call. */
const INSTALLED_CLIENT: HttpClient = {
  request: (method, url, options) => httpRequest({ method, url, ...options }),
};

/** The pane's success id, as the chat adapters spell it (`llm/` may not import `ui/`). */
const TEST_OK_MESSAGE_KEY = "research-helper-prefs-test-ok";

// ---------------------------------------------------------------------------
// 2. Errors with a reason
// ---------------------------------------------------------------------------

/**
 * Why a 2xx answer carried no usable audio. Carried in `TTSError.context.reason`
 * until `P6-T14` gives `TTSError` its reasons; `no-audio` is that card's name.
 */
export type GeminiTtsFailureReason =
  "no-audio" | "unsupported-format" | "malformed-response" | "model-gone";

/** A `TTSError` with its reason in the (redacted) context. */
function ttsFailure(
  reason: GeminiTtsFailureReason,
  message: string,
  context: Record<string, unknown> = {},
): TTSError {
  return new TTSError(redact(message), { ...context, reason });
}

/** The reason a `TTSError` carries, or `undefined` for any other error. */
export function ttsFailureReason(
  error: unknown,
): GeminiTtsFailureReason | undefined {
  if (!(error instanceof TTSError)) return undefined;
  const { reason } = error.context;
  return typeof reason === "string"
    ? (reason as GeminiTtsFailureReason)
    : undefined;
}

// ---------------------------------------------------------------------------
// 3. Pure helpers
// ---------------------------------------------------------------------------

/**
 * The audio language of a BCP-47 tag (or `"en"` / `"ko"`): `ko…` is Korean,
 * `en…` English, anything else `undefined`.
 */
export function audioLanguageOf(tag: string): AudioLanguage | undefined {
  const primary = tag.trim().toLowerCase().split(/[-_]/u)[0];
  if (primary === "ko") return "ko";
  if (primary === "en") return "en";
  return undefined;
}

/**
 * The upper chunk target for `language`. A language v1.0 does not ship gets
 * the smaller (Korean) figure, so a chunk is never sized above what either
 * documented target allows.
 */
export function maxChunkCharsFor(language: string): number {
  const lang = audioLanguageOf(language);
  return lang === undefined
    ? Math.min(GEMINI_TTS_MAX_CHUNK_CHARS.en, GEMINI_TTS_MAX_CHUNK_CHARS.ko)
    : GEMINI_TTS_MAX_CHUNK_CHARS[lang];
}

/**
 * `docs/04` §2.3's single-speaker body. The sent text is the style
 * instruction (when there is one) followed by the chunk, byte for byte, as
 * §2.9 and §5.3 require: Gemini has no style parameter. No `language`,
 * `store` or `response_format` field: the legacy surface has none (§2.8,
 * `P6-T05`'s **Do NOT**).
 *
 * @param request - one chunk's request
 * @returns the POST body
 */
export function buildTtsBody(request: SynthesisRequest): GeminiTtsRequest {
  return {
    contents: [
      { parts: [{ text: `${request.styleInstruction ?? ""}${request.text}` }] },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voice } },
      },
    },
  };
}

/** The standard base64 alphabet's value for each character code. */
const BASE64_VALUES: ReadonlyMap<number, number> = new Map(
  Array.from(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    (character, index) => [character.charCodeAt(0), index] as const,
  ),
);

/**
 * Decode standard base64 (padding optional, whitespace ignored) into bytes.
 * Written out rather than through `atob`, so the same code runs in Node and
 * in the plugin sandbox and a bad character is refused rather than skipped.
 *
 * @param text - the base64 text
 * @returns the bytes, or `undefined` when `text` is not base64
 */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/\s+/gu, "").replace(/={1,2}$/u, "");
  if (clean.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = BASE64_VALUES.get(clean.charCodeAt(i));
    if (value === undefined) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (buffer >> bits) & 0xff;
      at += 1;
    }
  }
  return out;
}

/** A finite, non-negative count, or `undefined`. */
function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `usageMetadata` as `docs/07` §5's `Usage`; `undefined` when the answer had none. */
function usageOf(raw: Record<string, unknown>): Usage | undefined {
  const meta = raw.usageMetadata;
  if (!isRecord(meta)) return undefined;
  return {
    inputTokens: countOf(meta.promptTokenCount),
    outputTokens: countOf(meta.candidatesTokenCount),
    totalTokens: countOf(meta.totalTokenCount),
    costUsd: undefined,
  };
}

/**
 * Read a 2xx `generateContent` answer into an {@link AudioArtifact}, or throw
 * the {@link TTSError} reason it means (`P6-T05` step 2).
 *
 * @param raw - the parsed body
 * @param request - the request it answers
 * @returns the PCM and its facts
 */
export function readTtsResponse(
  raw: Record<string, unknown>,
  request: SynthesisRequest,
): AudioArtifact {
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const parts = candidates
    .filter(isRecord)
    .flatMap((candidate) => {
      const content = candidate.content;
      return isRecord(content) && Array.isArray(content.parts)
        ? content.parts
        : [];
    })
    .filter(isRecord);
  const inline = parts
    .map((part) => part.inlineData)
    .find((data): data is Record<string, unknown> => isRecord(data));
  if (inline === undefined) {
    throw ttsFailure("no-audio", "Gemini answered without an audio part", {
      model: request.model,
      parts: parts.length,
    });
  }
  const mimeType = typeof inline.mimeType === "string" ? inline.mimeType : "";
  if (!PCM16_MIME_TYPE.test(mimeType)) {
    throw ttsFailure(
      "unsupported-format",
      `Gemini returned audio that is not 16-bit PCM (${mimeType || "no type"})`,
      { model: request.model, mimeType: redact(mimeType) },
    );
  }
  const data =
    typeof inline.data === "string" ? decodeBase64(inline.data) : undefined;
  if (data === undefined || data.byteLength === 0) {
    throw ttsFailure("no-audio", "Gemini's audio part holds no audio", {
      model: request.model,
    });
  }
  const format = pcmFormatFromMimeType(mimeType);
  const bytesPerFrame = (format.bitsPerSample / 8) * format.channels;
  // `docs/04` §6.3: an odd byte count shifts every later sample by one byte.
  if (data.byteLength % bytesPerFrame !== 0) {
    throw ttsFailure(
      "malformed-response",
      `Gemini's audio is ${data.byteLength} bytes, not whole samples`,
      { model: request.model },
    );
  }
  return {
    data,
    mimeType,
    fileExtension: "pcm",
    durationSeconds: data.byteLength / (format.sampleRateHz * bytesPerFrame),
    sampleRateHz: format.sampleRateHz,
    model: request.model,
    voice: request.voice,
    usage: usageOf(raw),
  };
}

// ---------------------------------------------------------------------------
// 4. The client
// ---------------------------------------------------------------------------

/** What {@link createGeminiTts} is built from. */
export interface GeminiTtsDeps {
  /** The shared `HttpClient`; absent, the installed one through `httpRequest`. */
  readonly http?: HttpClient | undefined;
  /** Tier 1 or session store; `undefined` when no backend is available. */
  readonly secrets: SecretStore | undefined;
  /**
   * The secret the key is read from. `registerProviders` passes
   * `GEMINI_SECRET_ID` (`"llm.gemini"`): TTS reads the chat key (owner,
   * `plan/00` §6 item 379; `plan/09` §0.4 line 24).
   */
  readonly secretId: SecretId;
  /** `gemini.baseUrl`, else `docs/03` §4.1 — the chat adapter's resolver. */
  readonly baseUrls: BaseUrlResolver;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

/** {@link TTSProvider}, plus the TTS model list the resolver reads. */
export interface GeminiTts extends TTSProvider {
  readonly id: "gemini";
  /** `GET /v1beta/models`, kept to its TTS entries; no billed call. */
  listTtsModels(ctx: LLMCallContext): Promise<readonly TtsModelEntry[]>;
}

/**
 * Build the Gemini TTS client.
 *
 * @param deps - see {@link GeminiTtsDeps}
 * @returns the client
 */
export function createGeminiTts(deps: GeminiTtsDeps): GeminiTts {
  const clock = deps.clock ?? createSystemClock();
  let keyKnownPresent: boolean | undefined;

  async function readKey(): Promise<ReturnType<typeof geminiHeaders>> {
    if (deps.secrets === undefined) {
      keyKnownPresent = false;
      throw new MissingCredentialError("gemini");
    }
    const value = await deps.secrets.get(deps.secretId);
    keyKnownPresent = value !== undefined && value !== "";
    if (!keyKnownPresent || value === undefined) {
      throw new MissingCredentialError("gemini");
    }
    return geminiHeaders(new Secret(value));
  }

  function url(path: string): string {
    return `${deps.baseUrls.resolveBaseUrl("gemini")}${path}`;
  }

  async function send(
    method: HttpMethod,
    target: string,
    modelId: string,
    body: GeminiTtsRequest | undefined,
    ctx: LLMCallContext,
    limits: LlmAttemptLimits,
  ): Promise<HttpResponse> {
    ctx.token.throwIfCancelled();
    const headers = await readKey();
    deps.logger?.debug("gemini tts request", {
      method,
      headers: loggableHeaders(headers),
    });
    return (deps.http ?? INSTALLED_CLIENT).request(method, target, {
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...limits,
      token: ctx.token,
      mapErrorResponse: (response, nowEpochMs) =>
        mapProviderError(
          "gemini",
          modelId,
          response.status,
          (name) => response.header(name),
          response.body,
          nowEpochMs,
        ),
    });
  }

  async function listTtsModels(
    ctx: LLMCallContext,
    limits: LlmAttemptLimits = llmAttemptTimeouts(false),
  ): Promise<readonly TtsModelEntry[]> {
    const response = await send(
      "GET",
      url(MODELS_PATH),
      MODEL_LIST_ID,
      undefined,
      ctx,
      limits,
    );
    const raw = parseJsonObject(response.body);
    if (raw === undefined) {
      throw new LLMError(
        "gemini",
        MODEL_LIST_ID,
        "Gemini's model list is not a JSON object",
        { httpStatus: response.status },
      );
    }
    return readTtsModelList(raw);
  }

  if (deps.secrets !== undefined) {
    void deps.secrets.has(deps.secretId).then(
      (present) => {
        keyKnownPresent ??= present;
      },
      () => {
        keyKnownPresent ??= false;
      },
    );
  }

  return {
    id: "gemini",
    displayNameKey: GEMINI_DISPLAY_NAME_KEY,
    rateLimitKey: GEMINI_HOST,

    maxInputChars: maxChunkCharsFor,

    isConfigured(): boolean {
      return deps.secrets !== undefined && keyKnownPresent !== false;
    },

    async validateCredentials(
      ctx: LLMCallContext,
    ): Promise<CredentialCheckResult> {
      // No billed call: the model list, one attempt of at most 15 s (item
      // 279(b)), as the chat adapter's key Test.
      try {
        await listTtsModels(ctx, LLM_KEY_TEST_ATTEMPT);
        return { ok: true, messageKey: TEST_OK_MESSAGE_KEY };
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        if (!(error instanceof ResearchHelperError)) throw error;
        const httpStatus =
          error instanceof UpstreamError ? error.httpStatus : undefined;
        return {
          ok: isKeyAcceptedFailure(error),
          messageKey: error.messageKey,
          ...(httpStatus !== undefined && { httpStatus }),
        };
      }
    },

    async resolveModel(
      preferredModelId: string,
      ctx: LLMCallContext,
    ): Promise<string> {
      const preferred = preferredModelId.trim();
      if (preferred !== "") return preferred;
      let models: readonly TtsModelEntry[];
      try {
        models = await listTtsModels(ctx);
      } catch (error) {
        if (
          error instanceof OperationCancelledError ||
          error instanceof MissingCredentialError
        ) {
          throw error;
        }
        // `docs/04` §2.2: the list could not be read, so the one compiled-in
        // id is used. The error is logged by class, never by body.
        deps.logger?.warn("gemini tts model list unavailable; fallback model", {
          error: error instanceof Error ? error.name : "unknown",
        });
        return GEMINI_TTS_FALLBACK_MODEL;
      }
      if (models.some((model) => model.id === GEMINI_TTS_FALLBACK_MODEL)) {
        return GEMINI_TTS_FALLBACK_MODEL;
      }
      const first = models[0];
      if (first === undefined) {
        throw ttsFailure(
          "model-gone",
          "Gemini's model list holds no text-to-speech model for this key",
        );
      }
      return first.id;
    },

    listVoices(): Promise<readonly VoiceInfo[]> {
      return Promise.resolve(GEMINI_TTS_VOICES);
    },

    listTtsModels: (ctx) => listTtsModels(ctx),

    async synthesize(
      request: SynthesisRequest,
      ctx: LLMCallContext,
    ): Promise<AudioArtifact> {
      const response = await send(
        "POST",
        url(
          `${MODELS_PATH}/${encodeURIComponent(request.model)}:generateContent`,
        ),
        request.model,
        buildTtsBody(request),
        ctx,
        { ...llmAttemptTimeouts(false), singleAttempt: true },
      );
      // A 2xx may still be a safety stop (`mapProviderError`'s refusal row).
      const declined = mapProviderError(
        "gemini",
        request.model,
        response.status,
        (name) => response.header(name),
        response.body,
        clock.now(),
      );
      if (declined !== undefined) throw declined;
      const raw = parseJsonObject(response.body);
      if (raw === undefined) {
        throw ttsFailure(
          "malformed-response",
          "Gemini answered with a body that is not a JSON object",
          { model: request.model, httpStatus: response.status },
        );
      }
      return readTtsResponse(raw, request);
    },
  };
}

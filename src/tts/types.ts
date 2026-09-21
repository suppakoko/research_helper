/**
 * TTS types.
 *
 * **Scope.** `P0-T25` spike version. `docs/07-architecture-and-data-model.md`
 * §4.4 names this exact path and owns every domain shape in it; `plan/README.md`
 * §5 rule 3 makes doc 07 the sole authority for types, so nothing here is a
 * working-name sketch and nothing is invented. The Gemini wire shapes below
 * come from `docs/04-audio-report-tts.md` §2.3 / §2.4 / §3.1 and
 * `docs/03-llm-provider-integration.md` §9.3, each cited on the declaration.
 *
 * **Types only.** No value is exported: `plan/README.md` §4 gives this card
 * exactly two files, so a runtime helper here would be scope the card did not
 * grant. The two helpers the spike needs — the §3.3 WAV writer and the §3.3
 * `rate=` parser — live in `scripts/spike-tts-korean.ts`, and `P0-T26` is the
 * card that creates `src/tts/audioStore.ts` for the shipped versions.
 *
 * ## Three §4.4 declarations that are deliberately absent
 *
 * Each depends on a module no card has created yet, and `P0-T25`'s `Files`
 * list does not include those modules. Re-declaring them here would build the
 * parallel type system `plan/README.md` §5 rule 3 forbids, so they are named
 * rather than guessed:
 *
 * 1. **`TTSProvider`** (§4.4) — its methods take `LLMCallContext` and return
 *    `CredentialCheckResult`, both owned by `src/llm/types.ts` (doc 07 §4.3).
 * 2. **`AudioArtifact.usage: Usage | undefined`** (§4.4) — `Usage` is owned by
 *    `src/model/usage.ts` (doc 07 §5). {@link AudioArtifact} below is §4.4's
 *    interface **minus that one field**; the card that creates
 *    `src/model/usage.ts` must add it back, importing rather than restating it.
 * 3. **`VoiceInfo.languages`** keeps §4.4's `readonly string[] | "multilingual"`
 *    union verbatim, including the string member, because doc 04 §2.8's "the
 *    same 30 voices work across languages" is what that member encodes.
 *
 * ## One shape the corpus does not fix
 *
 * `GET /v1beta/models` — `docs/03` §9.3 fixes the *entry* fields (`name`,
 * `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`,
 * `supportedGenerationMethods`) but says nothing about the envelope that
 * carries them, nor about pagination. {@link GeminiModelsListResponse} is
 * therefore written as an open, fully optional shape and flagged as such, not
 * asserted. Same for the Interactions API response (`docs/04` §2.6 shows only
 * the *request*): it is not declared here at all.
 */

// ---------------------------------------------------------------------------
// 1. Domain shapes — docs/07 §4.4, verbatim except where noted above
// ---------------------------------------------------------------------------

/**
 * The three provider choices `04-audio-report-tts.md` §7.5 requires in the
 * picker, and the value set of the `tts.provider` preference (doc 07 §8.5).
 * `04-…` §7.5 owns the ranking: `gemini` is the default for both languages,
 * `openai` is the fallback when the user has no Gemini key or Gemini is down,
 * and `system` is the Web Speech path (`04-…` §7.1).
 *
 * Do not narrow this union to `"gemini"` — a one-member union makes the
 * fallback ordering in `04-…` §7.5 unrepresentable.
 */
export type TtsProviderId = "gemini" | "openai" | "system";

/** docs/07 §4.4. */
export interface SynthesisRequest {
  /** Plain, already-speakable text. Markdown must be flattened before this. */
  readonly text: string;
  /** BCP-47 language tag; the plugin ships "en-US" and "ko-KR". */
  readonly language: string;
  readonly voice: string;
  readonly model: string;
  /**
   * Optional natural-language style instruction, where the provider supports
   * it. On Gemini it is not a parameter at all: doc 04 §2.9 says the
   * instruction is prepended to `text` itself, under 60 tokens, with an
   * explicit "do not add commentary" clause and a delimiter. There is no
   * `speed`, `pitch` or `rate` field anywhere in this interface because the
   * API has none (doc 04 §2.9), and SSML must never be sent — it is read
   * aloud.
   */
  readonly styleInstruction?: string;
  readonly traceId: string;
}

/**
 * docs/07 §4.4, minus its `usage` field — see the file header, absence 2.
 *
 * For the Gemini legacy path the field values are fixed by doc 04 §3.1:
 * `mimeType` arrives as `audio/L16;codec=pcm;rate=24000`, the samples are
 * signed 16-bit little-endian mono at 24,000 Hz, and there is **no container**,
 * so `data` is only playable after doc 04 §3.2–§3.3's RIFF/WAVE header is
 * prepended and `fileExtension` becomes `"wav"`.
 */
export interface AudioArtifact {
  /** Raw audio bytes as returned/converted. */
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly fileExtension: string;
  readonly durationSeconds: number | undefined;
  readonly sampleRateHz: number | undefined;
  readonly model: string;
  readonly voice: string;
}

/** docs/07 §4.4. */
export interface VoiceInfo {
  readonly id: string;
  readonly displayName: string;
  /** Languages the voice is documented to handle; may be "multilingual". */
  readonly languages: readonly string[] | "multilingual";
  readonly description?: string;
}

/**
 * The properties of raw PCM that a RIFF/WAVE header needs, and that doc 04
 * §3.1's table fixes for Gemini's legacy path: `sampleRateHz` 24000,
 * `channels` 1, `bitsPerSample` 16.
 *
 * Only `sampleRateHz` is actually recoverable from the response — doc 04 §3.3
 * parses it out of `rate=` in the `mimeType`. **`channels` and `bitsPerSample`
 * are not stated anywhere in the response**; `L16` implies 16-bit by its RTP
 * payload name, and mono comes from §3.1's table alone. Treat them as
 * assumptions carried from the doc, not as measurements.
 */
export interface PcmFormat {
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}

// ---------------------------------------------------------------------------
// 2. Gemini legacy `generateContent` wire shapes — docs/04 §2.3, §2.4
//
// camelCase throughout. docs/03 §4.5 warns that the Interactions API is
// snake_case and that an adapter supporting both must not share a serializer;
// nothing here may be reused for that surface.
// ---------------------------------------------------------------------------

/** docs/04 §2.3: the only `parts` member a TTS request sends. */
export interface GeminiTextPart {
  readonly text: string;
}

/** docs/04 §2.3. */
export interface GeminiContent {
  readonly parts: readonly GeminiTextPart[];
}

/** docs/04 §2.3, single-speaker. */
export interface GeminiPrebuiltVoiceConfig {
  readonly voiceName: string;
}

/** docs/04 §2.3, single-speaker. */
export interface GeminiVoiceConfig {
  readonly prebuiltVoiceConfig: GeminiPrebuiltVoiceConfig;
}

/**
 * docs/04 §2.3. The multi-speaker alternative,
 * `multiSpeakerVoiceConfig.speakerVoiceConfigs[]` (§2.5, max 2 speakers), is
 * not declared: §2.5's own recommendation is single-speaker first, and
 * `P0-T25`'s `Do NOT` list keeps the spike to one voice.
 */
export interface GeminiSpeechConfig {
  readonly voiceConfig: GeminiVoiceConfig;
}

/**
 * docs/04 §2.3. There is **no `language` field** on this surface — doc 04 §2.8
 * states the legacy path has none and the model infers the language from the
 * text. The Interactions API's `speech_config.speakers[].language` (§2.6) is
 * the only place a language may be stated, and that surface is not modelled
 * here.
 */
export interface GeminiTtsGenerationConfig {
  readonly responseModalities: readonly ["AUDIO"];
  readonly speechConfig: GeminiSpeechConfig;
}

/** docs/04 §2.3: the whole POST body for single-speaker TTS. */
export interface GeminiTtsRequest {
  readonly contents: readonly GeminiContent[];
  readonly generationConfig: GeminiTtsGenerationConfig;
}

/**
 * docs/04 §2.4 / §3.1: base64 audio, no container on the legacy path.
 *
 * Optional because a non-audio part (or an error-shaped candidate) may arrive
 * instead; `docs/04` §2.4's own sanity check is that `data` normally decodes
 * to bare PCM, and a payload beginning `UklGR` is a complete WAV file that
 * must **not** be wrapped again.
 */
export interface GeminiInlineData {
  readonly mimeType?: string;
  readonly data?: string;
}

/** docs/04 §2.4. */
export interface GeminiResponsePart {
  readonly inlineData?: GeminiInlineData;
  readonly text?: string;
}

/** docs/04 §2.4. */
export interface GeminiResponseContent {
  readonly parts?: readonly GeminiResponsePart[];
  readonly role?: string;
}

/** docs/04 §2.4. */
export interface GeminiCandidate {
  readonly content?: GeminiResponseContent;
  readonly finishReason?: string;
}

/**
 * docs/04 §2.4. The legacy surface's token accounting; doc 03 §4.4 warns it is
 * **not** the Interactions API's `total_input_tokens` / `total_output_tokens`.
 *
 * There is no cost field: Google reports tokens only, and doc 03 §9.3 records
 * that Gemini's model list does not expose pricing either.
 */
export interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
}

/** docs/04 §2.4, trimmed to what a TTS caller reads. */
export interface GeminiTtsResponse {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
}

// ---------------------------------------------------------------------------
// 3. Model discovery — docs/03 §9.3, docs/04 §2.2
// ---------------------------------------------------------------------------

/**
 * One entry of `GET /v1beta/models`, per `docs/03` §9.3.
 *
 * `name` arrives prefixed (`models/gemini-3.8-flash`) and the prefix must be
 * stripped before use. Every field is optional here because §9.3 describes
 * what the endpoint "returns entries with" rather than declaring a schema, and
 * a missing field must not crash a picker. **Pricing is not exposed** (§9.3),
 * which is why no price field exists on this type and why a TTS cost estimate
 * has to come from doc 04 §4.2's dated, human-readable table instead.
 */
export interface GeminiModelEntry {
  readonly name?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
  /**
   * doc 04 §2.2's robust TTS filter: prefer entries whose
   * `supportedGenerationMethods` include the method being called over matching
   * `/-tts/` against the ID.
   */
  readonly supportedGenerationMethods?: readonly string[];
}

/**
 * The envelope of `GET /v1beta/models`.
 *
 * > **Unverified — the corpus does not fix this shape.** `docs/03` §9.3
 * > documents the entry fields and nothing else: not the array's property
 * > name, not whether the endpoint paginates, not a `pageSize`/`pageToken`
 * > pair. `models` and `nextPageToken` below are what Google's other list
 * > endpoints use, so a reader must treat both as *probable* and a consumer
 * > must tolerate their absence — which is why both are optional and why
 * > `scripts/spike-tts-korean.ts` reports the raw key set it actually
 * > received. Resolve this from a real response before any shipped code
 * > depends on it.
 */
export interface GeminiModelsListResponse {
  readonly models?: readonly GeminiModelEntry[];
  readonly nextPageToken?: string;
}

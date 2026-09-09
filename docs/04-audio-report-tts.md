# 04 — Audio Report Generation (Text-to-Speech)

**Project:** `research_helper` (Zotero 10.x bootstrapped plugin, fully client-side)
**Scope:** Producing a spoken "recent research trends" report in **English or Korean** — primarily via Gemini TTS, with evaluated alternatives, chunking strategy, script generation, and delivery inside Zotero.
**Verified:** 2026-09-08

> **Re-verify before implementing.** Google's speech-generation surface changed twice in 2026: the `generateContent` endpoint is now labelled **legacy** in Google's own documentation, and the Interactions API (GA June 2026) uses a **different, incompatible** speech configuration shape. Both are live. Model IDs, voice names, and prices below were checked on **2026-09-08**; TTS models are all `-preview` and will churn. Read the model list at runtime (§2.2).

---

## Table of contents

1. [Why a separate audio script step](#1-why-a-separate-audio-script-step)
2. [Gemini TTS in depth](#2-gemini-tts-in-depth)
3. [Audio output format and writing a WAV container in JavaScript](#3-audio-output-format-and-wav)
4. [Limits and pricing](#4-limits-and-pricing)
5. [Chunking a long report into TTS calls](#5-chunking-a-long-report)
6. [Concatenating audio client-side](#6-concatenating-audio-client-side)
7. [Alternatives and fallbacks](#7-alternatives-and-fallbacks)
8. [Script generation before TTS](#8-script-generation-before-tts)
9. [Korean-specific handling](#9-korean-specific-handling)
10. [Delivery in Zotero](#10-delivery-in-zotero)
11. [Worked cost example: a 10-minute report](#11-worked-cost-example)
12. [Implementation checklist](#12-implementation-checklist)
13. [Sources](#sources)

---

## 1. Why a separate audio script step

The natural but wrong design is: generate the trend report → feed the markdown to TTS → done. This produces unlistenable audio, for reasons that are all fixable **before** the TTS call:

| Problem in the written report | What TTS does with it |
| --- | --- |
| `## Recent trends in CRISPR delivery` | Reads "hash hash" or drops the heading with no audible section break |
| `\| Method \| n \| Year \|` tables | Reads cell contents as an unpunctuated run-on |
| `(Kim et al., 2024; Zhang et al., 2025)` | Reads "open paren Kim et al comma 2024 semicolon…" — dozens of times |
| `[12]`, `[3,7,9]` | Reads bracket numbers as content |
| `CRISPR-Cas9`, `scRNA-seq`, `AUC-ROC` | Letter-by-letter or mangled |
| `p < 0.001`, `95% CI [1.2, 3.4]` | "p less than zero point zero zero one" is fine; the CI brackets are not |
| `n=1,247` | "n equals one comma two four seven" |
| Bullet lists | No audible list structure |
| A 4,000-word document | No transitions, no orientation, listener is lost by minute 3 |

**Therefore: always insert an LLM rewrite pass between the report and the TTS call.** The plugin's pipeline is:

```
collection → per-paper summaries → written trend report (markdown, shown in Zotero)
                                            │
                                            ▼
                            audio-script rewrite (LLM, EN or KO)
                                            │
                                            ▼
                            sentence-aware chunking (§5)
                                            │
                                            ▼
                                  TTS calls (§2)
                                            │
                                            ▼
                        PCM concatenation → single WAV (§6)
                                            │
                                            ▼
                          Zotero attachment on the report note (§10)
```

The rewrite is one extra LLM call over ~4,000 tokens — a fraction of a cent (§11) — and it is the difference between a usable audio report and a novelty. Full prompt templates are in §8.

---

## 2. Gemini TTS in depth

### 2.1 Two API surfaces, two different shapes

Google's TTS is available through both surfaces, and **the configuration is not the same**. This is the single most important fact in this document.

| | Legacy `generateContent` | Interactions API (current) |
| --- | --- | --- |
| Endpoint | `POST /v1beta/models/{model}:generateContent` | `POST /v1beta/interactions` |
| Doc title | "Gemini Generate Content API (**Legacy**)" | GA since June 2026 |
| Request audio flag | `generationConfig.responseModalities: ["AUDIO"]` | `response_format: { "type": "audio", ... }` |
| Voice config | `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` | `generation_config.speech_config.speakers[].voice` |
| Multi-speaker | `speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs[]` | additional entries in `speech_config.speakers[]` |
| Casing | camelCase | snake_case |
| Output container | raw PCM (`audio/L16;codec=pcm;rate=24000`) | selectable: `audio/mp3`, `audio/wav`, `audio/ogg_opus`, `audio/l16` |

> **Recommendation for `research_helper`: implement the Interactions API path as primary.** It can return **`audio/mp3` or `audio/wav` directly**, which eliminates the entire manual WAV-header problem (§3) for the common case, and it is the surface Google is developing. Keep the legacy `generateContent` path implemented as a fallback, because it is what every existing example and community snippet uses and it is the better-documented of the two today. Section 3 documents the WAV writer regardless — it is still needed for the legacy path, for `audio/l16`, and for chunk concatenation (§6).

### 2.2 Model IDs (verified 2026-09-08)

| Model ID | Notes |
| --- | --- |
| `gemini-3.1-flash-tts-preview` | Current. "Speech generation with expressive control." **Streaming is supported on TTS models from version 3.1 onward** — of the three here, only this one. Do not read that as a property of this model ID; it is a version gate, and the next 3.x TTS preview will have it too. |
| `gemini-2.5-flash-preview-tts` | Prior generation, cheaper. "Controllable text-to-speech generation." |
| `gemini-2.5-pro-preview-tts` | Prior generation, pro tier. |

Sources: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation).

All three carry `-preview` in the ID. **Do not hardcode.** Fetch `GET /v1beta/models` and filter for IDs matching `/-tts/` (or, more robustly, for entries whose `supportedGenerationMethods` include the relevant method), then let the user pick. Ship one hardcoded ID only as a last-resort fallback when the list fetch fails.

### 2.3 Request — legacy `generateContent`, single speaker

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent" \
  -X POST \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{
        "text": "Read this in a calm, measured tone suitable for an academic briefing: Over the past three years, research on CRISPR delivery has shifted decisively toward lipid nanoparticles."
      }]
    }],
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": {
            "voiceName": "Kore"
          }
        }
      }
    }
  }'
```

### 2.4 Response — legacy (trimmed)

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/L16;codec=pcm;rate=24000",
              "data": "AAAAAP//AQD+/wMA/P8FAPr/BwD4/wkA9v8LAPT/DQDy/w8A..."
            }
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 38,
    "candidatesTokenCount": 780,
    "totalTokenCount": 818
  }
}
```

`inlineData.data` is **base64-encoded raw PCM** — no container, no header. See §3.

> **Sanity check when debugging:** a correct legacy-path payload decodes to bare samples. If the first four decoded bytes are `52 49 46 46` (`RIFF`) — i.e. the base64 begins `UklGR` — you are being handed a complete WAV file, not raw PCM, and wrapping it again with §3.3 produces a double-headered file that most players render as a click followed by noise. Detect the magic bytes and skip the wrap rather than assuming either shape.

### 2.5 Request — legacy, multi-speaker (max 2)

```json
{
  "contents": [{
    "parts": [{
      "text": "TTS the following conversation between Anna and Ben:\nAnna: The trend is clear.\nBen: Agreed — lipid nanoparticles dominate."
    }]
  }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "multiSpeakerVoiceConfig": {
        "speakerVoiceConfigs": [
          {
            "speaker": "Anna",
            "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Kore" } }
          },
          {
            "speaker": "Ben",
            "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Puck" } }
          }
        ]
      }
    }
  }
}
```

The `speaker` string must match the speaker labels used in the prompt text. **Maximum 2 speakers.**

**Is multi-speaker useful here?** A two-voice "host + expert" format makes a 10-minute literature briefing markedly more listenable, and it is a genuine differentiator over a monotone read. But it doubles the script-generation complexity (the LLM must write dialogue, not prose) and halves the reliability (speaker-label mismatches produce silent failures). **Recommendation: ship single-speaker first; treat a two-voice "podcast mode" as an optional phase-2 preset.**

### 2.6 Request — Interactions API

```json
POST https://generativelanguage.googleapis.com/v1beta/interactions
x-goog-api-key: AIza...

{
  "model": "gemini-3.1-flash-tts-preview",
  "input": "Read this in a calm, measured tone suitable for an academic briefing: Over the past three years, research on CRISPR delivery has shifted decisively toward lipid nanoparticles.",
  "response_format": {
    "type": "audio",
    "mime_type": "audio/wav",
    "sample_rate": 24000
  },
  "generation_config": {
    "speech_config": {
      "speakers": [
        { "voice": "Kore", "language": "en-US" }
      ]
    }
  }
}
```

Per the [Interactions API reference](https://ai.google.dev/api/interactions-api):
- `response_format.type: "audio"` with `mime_type` one of `audio/mp3`, `audio/wav`, `audio/ogg_opus`, `audio/l16`, `audio/alaw`, `audio/mulaw`, plus optional `sample_rate`, `bit_rate` (compressed formats only), and `delivery` (`inline` | `uri`). Only the first four are relevant here; a-law/μ-law are telephony codecs.
- `generation_config.speech_config.speakers[]` entries take `{ language, speaker, voice }`, and `speech_config` itself also accepts `sample_rate` / `bit_rate`.
- `delivery: "uri"` is worth investigating for long reports — it would avoid holding a multi-megabyte base64 string in the Zotero process — but it is not exercised anywhere in this design. Treat it as `inline` until tested.

Multi-speaker on this surface is additional `speakers[]` entries with `speaker` labels matching the script.

**`mime_type: "audio/mp3"` is the single biggest simplification available.** It removes the WAV header code, shrinks the attachment substantially versus 16-bit PCM, and plays natively everywhere. How much smaller depends entirely on `bit_rate`: 24 kHz mono PCM is a fixed 384 kbit/s, so MP3 at 128 kbps is **3×** smaller, at 64 kbps **6×**, at 48 kbps (ample for a single speaking voice) **8×**. Pick the bit rate deliberately — the default is not documented, so set it. Its one drawback: **MP3 chunks cannot be concatenated by simple byte-joining** the way raw PCM can (§6). If the report is chunked, request `audio/l16` (or use the legacy endpoint) for the chunks and assemble one WAV; if a chunk fits in a single call, request `audio/mp3` and write it straight to disk.

### 2.7 Voice names and characteristics

30 prebuilt voices, with Google's own descriptors ([speech generation docs](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)):

| Voice | Character | Voice | Character | Voice | Character |
| --- | --- | --- | --- | --- | --- |
| Zephyr | Bright | Iapetus | Clear | Gacrux | Mature |
| Puck | Upbeat | Umbriel | Easy-going | Pulcherrima | Forward |
| Charon | Informative | Algieba | Smooth | Achird | Friendly |
| Kore | Firm | Despina | Smooth | Zubenelgenubi | Casual |
| Fenrir | Excitable | Erinome | Clear | Vindemiatrix | Gentle |
| Leda | Youthful | Algenib | Gravelly | Sadachbia | Lively |
| Orus | Firm | Rasalgethi | Informative | Sadaltager | Knowledgeable |
| Aoede | Breezy | Laomedeia | Upbeat | Sulafat | Warm |
| Callirrhoe | Easy-going | Achernar | Soft | | |
| Autonoe | Bright | Alnilam | Firm | | |
| Enceladus | Breathy | Schedar | Even | | |

**Recommended defaults for a research briefing**, based on the descriptors:

| Use | Voice | Rationale |
| --- | --- | --- |
| Default narrator | **`Charon`** ("Informative") | Descriptor matches the genre exactly |
| Alternate narrator | **`Rasalgethi`** ("Informative") or **`Sadaltager`** ("Knowledgeable") | Same register, different timbre |
| Neutral/steady | **`Schedar`** ("Even") | Least distracting over 10 minutes |
| Warmer read | **`Sulafat`** ("Warm") or **`Achird`** ("Friendly") | For users who find the informative voices dry |
| Two-voice mode | **`Charon`** + **`Sulafat`** | Contrast without either sounding jokey |

Avoid `Fenrir` (Excitable), `Puck`/`Laomedeia` (Upbeat), and `Sadachbia` (Lively) for a literature briefing — the register fights the content.

> **Unverified:** Google notes that the voice set available on `generateContent` differs slightly from the Live API's set. Whether the Interactions API set matches the legacy `generateContent` set exactly is not stated in the current docs. **Do not hardcode the 30 names into the UI as a fixed list.** Ship them as a default list, but validate the user's selection against an actual test call during setup, and surface a clear error if a voice is rejected.

### 2.8 Language support — Korean confirmed

The TTS models **detect the input language automatically** across 100+ languages. Google's documented list explicitly includes **Korean (`ko-KR`)** alongside Arabic, Bengali, Chinese, English, French, German, Hindi, Japanese, Portuguese, Russian, Spanish, and others.

Practical implications:

- There is **no `language` parameter on the legacy `generateContent` path** — the model infers language from the text. Feed it Korean text and it speaks Korean.
- The Interactions API's `speech_config.speakers[].language` field lets you state it explicitly. **Use it when available** — it removes the guessing on mixed Korean/English text, which is exactly the case in §9.
- **The same 30 voices work across languages.** You do not need a separate Korean voice roster; `Charon` speaks Korean. This is a real advantage over Azure/Google Cloud TTS, where voices are per-locale.
- **Mixed-language text is the risk.** A Korean script containing "transformer", "self-supervised learning", and "CRISPR-Cas9" may cause the model to switch accent mid-sentence or read English terms with Korean phonology. §9 covers mitigation.

### 2.9 Style and tone control via prompt

Gemini TTS is prompt-controllable: the *instruction* to speak a certain way goes **inside the text you send**, not in a parameter.

```
Read the following aloud in a calm, measured, professional tone,
as a researcher briefing colleagues. Pause briefly between sections.
Do not add any commentary of your own.

---
<script text>
```

Notes:
- There is **no `speed`, `pitch`, or `rate` parameter** — unlike OpenAI's `speed`, Azure's SSML `<prosody>`, or the Web Speech API's `rate`/`pitch`. All prosody control is prompt-based.
- **The style instruction is billed as input tokens on every chunk.** For a chunked 10-minute report the instruction repeats N times. Keep it short (< 60 tokens), and see §5.3 for why it must nonetheless be repeated verbatim.
- The instruction can leak into the audio if phrased ambiguously. Always include an explicit "Do not add commentary" clause and separate the instruction from the content with a clear delimiter.
- **SSML is not supported.** Do not send SSML tags; they will be read aloud.

---

## 3. Audio output format and WAV

### 3.1 What Gemini returns

| Property | Value |
| --- | --- |
| Encoding | Linear PCM, signed 16-bit little-endian |
| Sample rate | **24,000 Hz** |
| Channels | **1 (mono)** |
| Bit depth | **16-bit** (2 bytes per sample) |
| Container | **None** on the legacy path — `mimeType: "audio/L16;codec=pcm;rate=24000"` |
| Transport | base64 in `candidates[0].content.parts[0].inlineData.data` |

Bitrate: 24,000 samples/s × 2 bytes × 1 channel = **48,000 bytes/second = 2.88 MB per minute**. A 10-minute report is **~28.8 MB** of raw PCM. That is a large Zotero attachment — §6.4 covers this.

### 3.2 You must add the container yourself (legacy path)

Raw PCM has no header, so no player will open it. `Zotero.openInViewer` / the OS handler needs a real container. The 44-byte canonical RIFF/WAVE header is trivial to write and requires no external binary.

### 3.3 WAV header writer (JavaScript, no dependencies)

```js
/**
 * Wrap raw PCM samples in a canonical 44-byte RIFF/WAVE header.
 *
 * Gemini TTS returns signed 16-bit little-endian mono PCM at 24 kHz,
 * so the defaults below match its output exactly.
 *
 * @param {Uint8Array} pcm         Raw PCM sample bytes (no header).
 * @param {object}     [opts]
 * @param {number}     [opts.sampleRate=24000]
 * @param {number}     [opts.channels=1]
 * @param {number}     [opts.bitsPerSample=16]
 * @returns {Uint8Array} Complete .wav file bytes.
 */
function pcmToWav(pcm, opts = {}) {
  const sampleRate    = opts.sampleRate    ?? 24000;
  const channels      = opts.channels      ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign     = channels * bytesPerSample;
  const byteRate       = sampleRate * blockAlign;
  const dataSize       = pcm.byteLength;

  const header = new ArrayBuffer(44);
  const view   = new DataView(header);

  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // ── RIFF chunk descriptor ──────────────────────────────────────────────
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);   // ChunkSize = 4 + (8+16) + (8+dataSize)
  ascii(8, 'WAVE');

  // ── "fmt " sub-chunk (PCM, 16 bytes) ───────────────────────────────────
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size = 16 for PCM
  view.setUint16(20, 1, true);              // AudioFormat  = 1 (PCM, uncompressed)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // ── "data" sub-chunk ───────────────────────────────────────────────────
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Decode the base64 payload Gemini returns into raw PCM bytes. */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse `audio/L16;codec=pcm;rate=24000` → 24000. Falls back to 24000. */
function sampleRateFromMime(mimeType) {
  const m = /rate=(\d+)/.exec(mimeType || '');
  return m ? parseInt(m[1], 10) : 24000;
}
```

Two correctness details that are easy to get wrong:

1. **Every multi-byte field is little-endian** — the `true` third argument to every `setUint32`/`setUint16`. A big-endian header produces a file that opens but plays as noise.
2. **`ChunkSize` at offset 4 is `36 + dataSize`, not `44 + dataSize`.** It counts everything after the first 8 bytes. Off-by-eight here yields a file that some players accept and others truncate.

`atob` handles the ~4 MB base64 strings a single chunk produces without difficulty. For very large payloads, decode per-chunk rather than concatenating base64 first.

---

## 4. Limits and pricing

### 4.1 Limits

| Limit | Value | Source |
| --- | --- | --- |
| **TTS session context window** | **32,000 tokens** | [speech generation docs](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation) |
| Speakers per request | **2 maximum** | ibid. |
| Streaming | Only on `gemini-3.1-flash-tts-preview` | [models](https://ai.google.dev/gemini-api/docs/models) |
| Audio output rate | **25 output tokens per second of audio** — *not documented by Google; secondary sources only, see the Unverified callout in §4.2* | §4.2 |
| Rate limits | Per usage tier; published in the [AI Studio dashboard](https://aistudio.google.com/rate-limit) rather than a static table. Spend-based limits apply on a rolling 10-minute window: Tier 1 $10, Tier 2 $50, Tier 3 $200 | [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |

> **Unverified:** Google documents the 32k-token *context* limit but does not publish an explicit **maximum audio duration** per request. The 32k context is the practical ceiling: at 25 output tokens/sec, 32,000 tokens ≈ 21 minutes of audio *if* output tokens were the only consumer of the window — but input text also counts, so the real ceiling is lower. (And the 25 tok/s figure is itself unverified — see §4.2.) **Do not rely on a single call for a 10-minute report.** Chunk defensively (§5) with a conservative per-chunk target, and treat any long-single-call success as a bonus rather than the design.
>
> What Google *does* document, under Limitations on the [speech-generation page](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation), is that **"speech quality and consistency may begin to drift" on outputs longer than a few minutes**, with an explicit recommendation to split the transcript into smaller chunks. That is a first-party argument for §5 independent of any token accounting, and it sets the chunk target: minutes, not tens of minutes.

**Free tier:** Gemini has a real free tier, but TTS-model availability and RPD on it should be confirmed empirically — free-tier model access is described as "limited access to certain models" and TTS previews may or may not be included.

### 4.2 Pricing (verified 2026-09-08)

| Model | $/1M input tokens (text) | $/1M output tokens (audio) |
| --- | --- | --- |
| `gemini-3.1-flash-tts-preview` | $1.00 | $20.00 |
| `gemini-2.5-flash-preview-tts` | $0.50 | $10.00 |
| `gemini-2.5-pro-preview-tts` | $1.00 | $20.00 |

All three re-confirmed on the [Gemini pricing page](https://ai.google.dev/gemini-api/docs/pricing) on 2026-09-08. Note that `gemini-2.5-pro-preview-tts` costs the same as the newer `gemini-3.1-flash-tts-preview` — there is no cost argument for the older pro model.

**The key conversion: audio output is billed at 25 tokens per second.** Therefore:

- 1,000,000 output tokens = 40,000 seconds = **11.1 hours** of audio.
- `gemini-3.1-flash-tts-preview`: 25 tok/s × 60 s = 1,500 tokens/minute × $20/1M = **$0.030 per minute**.
- `gemini-2.5-flash-preview-tts`: **$0.015 per minute**.

> **Unverified — the 25 tokens/second rate itself.** The per-1M prices above are on Google's own pricing page, but **the tokens-per-second conversion is not**. Neither the pricing page nor the speech-generation page states an audio output token rate (re-checked 2026-09-08); 25 tok/s comes only from third-party write-ups. Every per-minute and per-report figure in this document (§11 included) is derived from it, so **the whole TTS cost model inherits this uncertainty**. Before shipping a cost estimator: make one real call, read `usageMetadata.candidatesTokenCount`, divide by the measured audio duration, and calibrate from that. Until then, present TTS costs as an order of magnitude, not a quote. Re-verify by 2026-12-01 in any case — preview-model pricing is exactly the kind of thing that changes.

---

## 5. Chunking a long report

### 5.1 Why chunk at all

Three independent reasons:

1. **The 32k TTS context window.** A 10-minute script is ~1,500 English words ≈ 2,000 input tokens — comfortably within 32k on input alone. But **output tokens share the window**: 10 minutes of audio is 15,000 output tokens. Input + output is ~17,000 tokens — already **over half** the window for a 10-minute report — and exceeds 32k at about **19 minutes** (per minute: 25 tok/s × 60 s = 1,500 output tokens + 2,000 input tokens ÷ 10 min = 200 input tokens ⇒ 1,700 tok/min; 32,000 ÷ 1,700 = 18.8 min). A 30-minute report from a 200-paper collection will not fit.
2. **Failure blast radius.** One 10-minute call that fails at 90% wastes the whole spend and the whole wait. Ten 1-minute calls lose 10%.
3. **Progress feedback.** Zotero users expect a progress bar on long operations. Chunks give you one for free.

### 5.2 Sentence- and paragraph-aware splitting

**Never split mid-sentence.** A mid-sentence boundary produces an audible cut and, worse, causes the model to re-derive prosody from a fragment, which sounds wrong even after concatenation.

Target **600–900 characters per chunk** for English (roughly **40–60 seconds** of speech at the ~900 characters/minute rate used in §9.3 and §11), and **300–450 characters for Korean** (~55–80 seconds at ~330 characters/minute — Korean is far denser per character, see §9.3).

```js
/**
 * Split an audio script into TTS-sized chunks on paragraph, then sentence,
 * boundaries. Never splits mid-sentence.
 *
 * @param {string} script
 * @param {object} [opts]
 * @param {number} [opts.maxChars=900]   Soft ceiling per chunk.
 * @param {number} [opts.minChars=300]   Avoid trailing slivers.
 * @param {'en'|'ko'} [opts.lang='en']
 * @returns {string[]}
 */
function chunkScript(script, opts = {}) {
  const lang     = opts.lang ?? 'en';
  const maxChars = opts.maxChars ?? (lang === 'ko' ? 450 : 900);
  const minChars = opts.minChars ?? (lang === 'ko' ? 150 : 300);

  // 1. Paragraphs are the strongest natural boundary — a paragraph break in
  //    the script corresponds to a section transition in the report.
  const paragraphs = script.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks = [];
  let current = '';

  const flush = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // 2. Paragraph too long — fall back to sentence boundaries.
      flush();
      for (const sentence of splitSentences(para, lang)) {
        if (current.length + sentence.length + 1 > maxChars && current.length >= minChars) {
          flush();
        }
        current += (current ? ' ' : '') + sentence;
      }
      flush();
    } else if (current.length + para.length + 2 > maxChars) {
      flush();
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  flush();
  return chunks;
}

/**
 * Sentence splitter tolerant of academic abbreviations and Korean endings.
 * Deliberately conservative: a missed split costs a slightly long chunk,
 * a wrong split costs an audible mid-sentence cut.
 */
function splitSentences(text, lang = 'en') {
  if (lang === 'ko') {
    // Korean declarative/interrogative endings, plus Latin punctuation.
    return text.match(/[^.!?。？！]+[.!?。？！]+["'”’)\]]*\s*|[^.!?。？！]+$/g) || [text];
  }
  // Protect common academic abbreviations from being treated as sentence ends
  // by swapping their periods for a sentinel that cannot occur in the text,
  // splitting, then restoring.
  const SENTINEL = '\u0001';   // control char; never present in report text
  const PROTECT = /\b(?:et al|e\.g|i\.e|cf|vs|Fig|Eq|Ref|approx|ca|Dr|Prof|Inc|Ltd|St|No|vol|pp)\./gi;
  const guarded = text.replace(PROTECT, m => m.split('.').join(SENTINEL));
  const parts = guarded.match(/[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g) || [guarded];
  return parts.map(s => s.split(SENTINEL).join('.').trim()).filter(Boolean);
}
```

### 5.3 Keeping voice consistency across chunks

Gemini TTS has no session or seed concept — each call is independent. Consistency comes from making the calls as identical as possible:

| Rule | Why |
| --- | --- |
| **Same `voiceName` on every chunk** | Obvious, but must be captured once at the start of a run and reused, not re-read from prefs per chunk (the user could change it mid-run). |
| **Same model ID on every chunk** | Never fall back to a different TTS model mid-report; the timbre changes audibly. |
| **Byte-identical style instruction, prepended to every chunk** | The instruction *is* the prosody control. Omitting it on chunks 2..N produces a noticeably different register from chunk 1. |
| **Chunk on paragraph boundaries where possible** | The model naturally resets intonation at a paragraph; a paragraph-aligned boundary is inaudible, a mid-paragraph one is not. |
| **Do not include cross-chunk context** | Tempting ("here is the previous sentence for continuity") but it makes the model re-speak or acknowledge it. Keep chunks clean and independent. |
| **Insert explicit silence between chunks** | ~250 ms of silence at a section transition covers residual prosody mismatch and reads as an intentional beat (§6.2). |
| **Retry a chunk with identical inputs** | Because calls are independent, a retried chunk is drop-in compatible. Never retry with modified text. |

```js
const STYLE_PREFIX =
  'Read the following aloud in a calm, measured, professional tone, as a ' +
  'researcher briefing colleagues. Do not add any commentary of your own.\n\n---\n\n';

// Prepend the SAME prefix to every chunk. Costs ~40 input tokens per chunk
// (~$0.00004 on gemini-3.1-flash-tts-preview) — negligible, and essential.
const requests = chunks.map(text => ({ text: STYLE_PREFIX + text }));
```

### 5.4 Sequencing and concurrency

Run chunks **sequentially, or at most 2-way concurrent**. Rationale:

- Order must be preserved for concatenation. Concurrency requires indexed collection, which is fine, but adds a class of bug for little gain.
- TTS calls are slow (multiple seconds each) and rate limits bite fast on Gemini's free and Tier-1 tiers. A 10-chunk report fired 10-way parallel is a reliable way to get `429 RESOURCE_EXHAUSTED`.
- Sequential gives a clean, honest progress bar: "Generating audio: chunk 4 of 11".
- **Persist completed chunks** (as PCM in a temp directory keyed by a run ID) so a failure at chunk 9 of 11 resumes rather than restarts. At $0.03/min this is more about the user's time than the money.

---

## 6. Concatenating audio client-side

### 6.1 Why raw PCM concatenation is the clean approach

The requirement is to join N audio segments into one file **inside a Zotero plugin, with no external binaries** (no ffmpeg, no sox — shipping or shelling out to those is a non-starter for a cross-platform Zotero plugin).

| Format | Can you concatenate by joining bytes? | Verdict |
| --- | --- | --- |
| **Raw PCM (L16)** | **Yes, trivially.** PCM is a bare sequence of samples with no framing, no header, no per-segment state. Appending sample arrays is exactly equivalent to appending audio. | **Use this.** |
| WAV | No — each file has its own 44-byte header. Joining produces a valid first segment followed by garbage (the second header read as samples: an audible click, then possibly silence). | Strip headers first — i.e. reduce to the PCM case. |
| MP3 | No, not safely. Frame-aligned, with a bit reservoir spanning frames, plus ID3 tags and an optional Xing/LAME header. Naive joining usually "works" in tolerant players but yields wrong duration metadata, seek breakage, and clicks at boundaries. Proper joining needs a frame parser. | Avoid for multi-chunk. |
| Opus/Ogg | No. Page-structured with per-stream granule positions and serial numbers. Requires a real Ogg muxer. | Avoid for multi-chunk. |

**Therefore the design is: request PCM for every chunk, concatenate the raw sample bytes, and write exactly one WAV header over the total.** This is a handful of lines, has no dependencies, is bit-exact, and produces a file with correct duration metadata — which naive MP3 joining does not.

This is the single reason to prefer `audio/l16` (or the legacy `generateContent` path) when chunking, even though the Interactions API can return MP3 directly. **Single chunk → request MP3. Multiple chunks → request PCM, concatenate, wrap once.**

### 6.2 Implementation

```js
/**
 * Generate a complete WAV file from an array of script chunks.
 *
 * All chunks MUST be requested with identical model, voice, and style prefix
 * (see §5.3) and at the same sample rate.
 *
 * @param {string[]} chunks
 * @param {object}   cfg  { apiKey, model, voiceName, stylePrefix, onProgress }
 * @returns {Promise<Uint8Array>} .wav file bytes
 */
async function synthesizeReport(chunks, cfg) {
  const SILENCE_MS = 250;           // beat between chunks
  const segments = [];              // Uint8Array of raw PCM, in order
  let sampleRate = null;            // fixed by the first chunk, then enforced

  for (let i = 0; i < chunks.length; i++) {
    cfg.onProgress?.({ index: i, total: chunks.length });

    const { pcm, rate } = await ttsChunk(chunks[i], cfg);   // retries internally

    // §6.3: a rate change mid-report would concatenate into a pitch shift.
    // Fail loudly; do NOT silently adopt the last chunk's rate.
    if (sampleRate === null) sampleRate = rate;
    else if (rate !== sampleRate) {
      throw new Error(
        `TTS sample rate changed mid-report: chunk ${i} returned ${rate} Hz, ` +
        `expected ${sampleRate} Hz. Refusing to concatenate.`);
    }

    if (i > 0) segments.push(silencePcm(SILENCE_MS, sampleRate));
    segments.push(pcm);
  }

  // Single flat buffer, then ONE header over the whole thing.
  const total = segments.reduce((n, s) => n + s.byteLength, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const s of segments) { all.set(s, offset); offset += s.byteLength; }

  return pcmToWav(all, { sampleRate, channels: 1, bitsPerSample: 16 });
}

/** N milliseconds of digital silence as 16-bit mono PCM (all zero samples). */
function silencePcm(ms, sampleRate) {
  const samples = Math.round((sampleRate * ms) / 1000);
  return new Uint8Array(samples * 2);   // 2 bytes per 16-bit sample; zeros = silence
}

/** One TTS call → raw PCM bytes. Legacy generateContent path. */
async function ttsChunk(text, cfg) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`;

  const res = await httpPost(url, {
    'x-goog-api-key': cfg.apiKey,
    'Content-Type': 'application/json',
  }, {
    contents: [{ parts: [{ text: cfg.stylePrefix + text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voiceName } },
      },
    },
  });

  // httpPost deliberately does not throw on non-2xx (doc 03 §14.4), so the
  // status check belongs here. Without it a 429 falls through to the "no audio
  // payload" branch below and is retried as an unclassified error, defeating
  // the retry-after handling in doc 03 §11.6.
  if (res.status < 200 || res.status >= 300) {
    throw toLLMError('gemini', res);            // doc 03 §11.5 taxonomy mapper
  }

  const json = JSON.parse(res.text);
  const part = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error('TTS returned no audio payload');

  return {
    pcm:  base64ToBytes(part.inlineData.data),
    rate: sampleRateFromMime(part.inlineData.mimeType),
  };
}
```

### 6.3 Correctness notes

- **Silence must be an even number of bytes** — 16-bit samples are 2 bytes. An odd-length silence buffer shifts every subsequent sample by one byte and turns the rest of the file into white noise. `samples * 2` guarantees evenness.
- **Assert a consistent sample rate across chunks.** If one chunk comes back at a different rate (a model change, a fallback), concatenating produces a pitch shift. Fail loudly rather than producing a file that plays at the wrong speed.
- **Memory.** A 10-minute report is ~28.8 MB of PCM plus per-chunk copies. Building one flat `Uint8Array` at the end (rather than repeatedly growing one) keeps peak usage near 2× final size, which is fine. For a 60-minute report (170 MB), stream chunks to a temp file with `IOUtils.write({ mode: 'append' })` and prepend the header at the end instead of holding it all in memory.

### 6.4 Recommendation on the delivered format

A 10-minute WAV is **~28.8 MB**. That is a heavy Zotero attachment, especially for users syncing to Zotero storage with a 300 MB free quota — a dozen audio reports would fill it.

Options, in order of preference:

1. **Single-chunk reports → request `audio/mp3` from the Interactions API.** At 128 kbps that is 16 kB/s, so **~9.6 MB for 10 minutes** — a third of the WAV, not a tenth. Set `bit_rate` explicitly: 48 kbps mono is transparent enough for one speaking voice and brings the same 10 minutes down to **~3.6 MB**. Zero extra work either way.
2. **Multi-chunk reports → concatenate PCM → WAV, and store it as a *linked file* rather than an imported attachment** (§10.2). The bytes then live in a user-chosen folder and never enter Zotero storage or sync.
3. **Offer WAV as the default only when storage is not a concern**, and surface the file size in the UI before writing.
4. **Do not plan on transcoding after the fact.** No pure-JS MP3 encoder should be bundled (LAME-in-WASM is ~1 MB and adds a licensing question), so the container must be chosen at request time.
   > **Unverified:** whether a second Interactions call can be used to transcode already-generated audio. Nothing in the API reference describes an audio-in/audio-out transcode path, but this was not tested. Do not design around it either way; assume it is unavailable.

---

## 7. Alternatives and fallbacks

### 7.1 Web Speech API (`speechSynthesis`) — zero cost, no key

Zotero runs on Gecko, and `window.speechSynthesis` is available to chrome-privileged code. **This is confirmed in practice**: the community plugin [ZoTTS](https://github.com/ImperialSquid/zotero-zotts) adds text-to-speech to Zotero using the OS's built-in voices, and Zotero itself now ships a **built-in text-to-speech feature (in beta)** — ZoTTS's README notes it "will probably not receive any major updates going forward" as a result.

```js
// Enumerate voices, filtering for Korean.
const voices = win.speechSynthesis.getVoices();
const ko = voices.filter(v => v.lang.startsWith('ko'));

const utter = new win.SpeechSynthesisUtterance(chunkText);
utter.voice = ko[0] ?? voices[0];
utter.rate  = 0.95;
utter.pitch = 1.0;
win.speechSynthesis.speak(utter);
```

**Assessment:**

| | |
| --- | --- |
| Cost | **Zero.** No key, no network, no quota. |
| Quality | Noticeably below neural TTS. Windows SAPI voices are intelligible but flat over 10 minutes. |
| **Cannot produce a file** | **This is the disqualifying limitation.** `speechSynthesis` renders to the audio device only. There is no documented way to capture its output to a buffer from a plugin. So it supports *"read this to me now"* but not *"save an audio report I can put on my phone."* |
| Voice availability | Depends entirely on OS-installed voices. Varies per machine; `getVoices()` may return `[]` on first call before the `voiceschanged` event fires — a classic bug. |
| Korean on Windows | > **Unverified:** Windows 10/11 provides Korean SAPI voices (commonly reported as "Microsoft Heami") **only when the Korean language pack / speech pack is installed**. Many users will have no `ko-*` voice at all. The plugin must call `getVoices()`, filter for `ko`, and **disable the Korean Web Speech option with a clear explanation when none is found** rather than silently reading Korean text with an English voice — which produces gibberish. |
| Sandboxing | ZoTTS reports init failures for Linux users running Zotero under flatpak/snap. Expect the same. |

**Verdict: ship it, but as a distinct "Read aloud" feature, not as the audio-report fallback.** It answers a different user need (listen now, in-app, free) and cannot answer the report need (a portable file). Offer both.

### 7.2 OpenAI TTS

Endpoint: `POST https://api.openai.com/v1/audio/speech`.

| Property | Value |
| --- | --- |
| Models | `gpt-4o-mini-tts` (current, supports speech-style control), `tts-1`, `tts-1-hd` |
| Voices (13) | `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`. OpenAI recommends **`marin`** or **`cedar`** for best quality. **All 13 are `gpt-4o-mini-tts` only** — `tts-1` / `tts-1-hd` accept a smaller set of nine (`alloy`, `ash`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`), so `marin`/`cedar` are unavailable on the two cheaper models |
| Output containers | **`mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`** — returns a real container, no header work needed |
| Style control | `instructions` parameter (accent, emotional range, intonation, impressions, speed, tone, whispering) — a **real parameter**, unlike Gemini's prompt-embedded approach. **`gpt-4o-mini-tts` only**; `tts-1` / `tts-1-hd` have no style control at all |
| Korean | **Supported.** Language support "generally follows the Whisper model", covering 99+ languages including Korean — but the docs explicitly state **"voices are currently optimized for English."** |
| Streaming | Yes, via chunked transfer encoding; OpenAI recommends `wav` or `pcm` as the response format when streaming |
| Pricing | `tts-1` **$15 per 1M characters**; `tts-1-hd` **$30 per 1M characters**; `gpt-4o-mini-tts` is **token**-priced at **$0.60 per 1M text input tokens + $12.00 per 1M audio output tokens** (re-confirmed on the [pricing page](https://developers.openai.com/api/docs/pricing), 2026-09-08). Mixing a per-character and a per-token model in one estimator is the trap here — see §11 |

```bash
curl https://api.openai.com/v1/audio/speech \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini-tts",
    "voice": "marin",
    "input": "Over the past three years, research on CRISPR delivery has shifted decisively toward lipid nanoparticles.",
    "instructions": "Speak in a calm, measured, professional tone, as a researcher briefing colleagues.",
    "response_format": "mp3"
  }' --output chunk-01.mp3
```

**Assessment vs. Gemini:** genuinely competitive, and in two respects better — it returns real containers (no WAV plumbing), and `instructions` is a first-class parameter. Its weakness for this project is exactly the one that matters: **voices are English-optimized**, and this plugin's headline audio feature is bilingual EN/KO. Also `response_format: "pcm"` exists, so the §6 concatenation approach works here too.

**Recommend as the primary fallback for English**, and as a secondary option for Korean with a quality caveat shown in the UI.

### 7.3 ElevenLabs

Best-in-class prosody and strong multilingual models, with real Korean support. Rejected as a default for three reasons: it is a **fifth API key** the user must obtain (the brief already asks for four), it is **substantially more expensive** per minute than Gemini or OpenAI, and it is outside the brief's stated provider set. Worth a line in the docs as "if you already have an ElevenLabs key and care most about quality, we could add it" — a plausible community contribution, not a v1 feature.

> **Unverified:** current ElevenLabs model IDs and per-character pricing were not checked in this pass.

### 7.4 Azure / Google Cloud Text-to-Speech

Both offer excellent, mature Korean neural voices (Google Cloud's `ko-KR-Neural2-*` / `ko-KR-Wavenet-*` families; Azure's `ko-KR-SunHiNeural` and siblings), full **SSML** support (real `<break>`, `<prosody>`, `<phoneme>` control — which neither Gemini nor OpenAI TTS provides), and per-character pricing.

Rejected for v1 because **authentication is the wrong shape for this plugin**. Both are GCP/Azure services expecting service accounts, OAuth2 flows, or resource-scoped keys — not a single paste-in API key. Google Cloud TTS in particular is a different product from the Gemini Developer API with a different credential model, which would confuse users who have already pasted a Gemini key.

If SSML-grade pronunciation control for Korean ever becomes a requirement (e.g. forcing the reading of specific technical terms), Google Cloud TTS is the escape hatch. Note that as a strategic option, not a v1 dependency.

> **Unverified:** current per-character pricing for both services.

### 7.5 Recommendation and fallback ordering

| Rank | Option | When |
| --- | --- | --- |
| **1** | **Gemini TTS.** The model ID is **resolved at call time** from the live list (§2.2), never hardcoded and never written into `prefs.js`: `tts.model` ships empty and empty means "the model this document currently recommends for the selected provider" (`07-architecture-and-data-model.md` §8.5). *Current recommendation, verified 2026-09-08 — a dated recommendation, not an instruction to hardcode:* `gemini-2.5-flash-preview-tts`, on §11 lever 2's price argument (half the price of the newer model), with `gemini-3.1-flash-tts-preview` offered as the quality upgrade and as the only one of §2.2's three that supports streaming. Both IDs carry `-preview` and churn on a scale of weeks; §2.2 and §12 item 1 require the ID come from `GET /v1beta/models` filtered on `/-tts/`, with a single hardcoded ID permitted **only** as a last-resort fallback when that fetch fails. | **Default for both English and Korean.** Single API key already required by the brief; genuine Korean support; the same 30 voices work in both languages; ~$0.03/min. |
| **2** | **OpenAI TTS** (`gpt-4o-mini-tts`, voice `marin`/`cedar`) | Fallback when the user has no Gemini key, or when Gemini is rate-limited/down. Better containers, first-class `instructions`; caveat the Korean quality in the UI. |
| **3** | **Web Speech API** | Offered as a **separate "Read aloud (offline, free)" action**, not as a file-producing fallback. Also the emergency path when no key is configured at all. Disable the Korean option if `getVoices()` yields no `ko-*` voice. |
| 4 | ElevenLabs / Azure / Google Cloud TTS | Documented as future options. Not implemented in v1. |

**Every model ID in the table above is a dated recommendation, not a constant to compile in.** That applies to rank 2's `gpt-4o-mini-tts` exactly as it applies to rank 1's Gemini IDs: the ranking is what this section owns; the ID is resolved from the provider's live model list at call time, per §2.2 and §12 item 1, and no ID is written into `prefs.js` (§8.5's `tts.model` ships empty for this reason). A hardcoded ID is permissible in exactly one place — the last-resort fallback taken when the model-list fetch fails — and it must be marked as such in the code.

Present the choice in prefs as: **TTS provider** (Gemini / OpenAI / System voices), **Voice** (populated per provider), **Language** (English / Korean), and a **cost estimate per 10 minutes** shown live.

---

## 8. Script generation before TTS

### 8.1 What the rewrite pass must do

| Transformation | Example |
| --- | --- |
| Strip all markdown | `## Trends` → an audible section transition |
| Convert tables to prose | Table of 5 methods → "Five methods dominate: first, …" |
| Remove inline citations | `(Kim et al., 2024)` → deleted, or "Kim and colleagues, in 2024" if attribution matters |
| Remove bracket references | `[12]`, `[3,7,9]` → deleted entirely |
| Expand or gloss acronyms on **first** use | `LNP` → "lipid nanoparticles, or L N P" |
| Spell out symbols and stats | `p < 0.001` → "p less than zero point zero zero one"; `n=1,247` → "a sample of one thousand two hundred forty-seven" |
| Convert lists to enumerated prose | Bullets → "There are three. First… Second… And third…" |
| Add explicit transitions | "Turning now to methods." / "That covers delivery. Next, targeting." |
| Add an opening and closing | "This is a summary of 100 papers on CRISPR delivery published since 2023." … "That concludes the summary." |
| Shorten sentences | Written academic sentences average 25–30 words; spoken should average 15–20 |
| Remove URLs and DOIs | Never readable aloud |

### 8.2 English prompt template

```
You are rewriting a written research-trends report into a script that will be
read aloud by a text-to-speech system. The listener is a researcher who wants
to understand the state of a field while commuting or walking.

Rewrite the report below as a spoken script.

HARD REQUIREMENTS
1. Output ONLY the script text. No preamble, no markdown, no headings, no
   bullet points, no tables, no asterisks, no hash marks, no numbered lists.
2. Remove every inline citation, bracketed reference number, DOI, and URL.
   If a specific study genuinely must be attributed, say it naturally:
   "a 2024 study by Kim and colleagues".
3. Expand every acronym on first use, then use the short form:
   "lipid nanoparticles, or L N P, ..." Write initialisms that should be
   spelled out with spaces between the letters: "R N A", "P C R", "M R I".
   Write acronyms that are pronounced as words normally: "CRISPR", "GWAS".
4. Convert all statistics into spoken form. "p < 0.001" becomes "p less than
   zero point zero zero one". "n=1,247" becomes "a sample of one thousand two
   hundred and forty-seven". "95% CI [1.2, 3.4]" becomes "a ninety-five percent
   confidence interval from one point two to three point four".
5. Convert every table and list into flowing prose with explicit enumeration:
   "Three approaches dominate. The first is ... The second is ... And the third
   is ..."
6. Replace section headings with spoken transitions: "Let's start with delivery
   methods." / "That covers delivery. Turning now to targeting." Do not read
   heading text verbatim as a fragment.
7. Open with one sentence stating what this is and how many papers it covers.
   Close with one sentence signalling the end.
8. Use short sentences. Aim for fifteen to twenty words on average. Break long
   written sentences into two or three spoken ones.
9. Write out author names phonetically ONLY where the standard spelling would
   be badly mispronounced. Otherwise leave names as written.
10. Preserve every substantive finding, number, and caveat from the source
    report. This is a format change, not a summary. Do not add facts that are
    not in the source.

TARGET LENGTH
Approximately {WORD_COUNT} words (about {MINUTES} minutes when read aloud at
roughly 150 words per minute).

SOURCE REPORT
---
{REPORT_MARKDOWN}
---
```

### 8.3 Korean prompt template

```
당신은 작성된 연구 동향 보고서를 음성 합성(TTS) 시스템이 읽을 수 있는
낭독용 스크립트로 다시 쓰는 역할을 합니다. 청취자는 출퇴근 중이나 걸으면서
해당 분야의 현황을 파악하려는 연구자입니다.

아래 보고서를 한국어 낭독 스크립트로 다시 작성하십시오.

필수 요구사항
1. 스크립트 본문만 출력하십시오. 머리말, 마크다운, 제목 기호, 글머리 기호,
   표, 별표, 우물 정 기호, 번호 목록을 일절 사용하지 마십시오.
2. 본문 내 인용 표기, 대괄호 참고문헌 번호, DOI, URL을 모두 제거하십시오.
   특정 연구를 반드시 언급해야 한다면 자연스럽게 서술하십시오.
   예: "2024년 김 연구팀의 연구에 따르면".
3. 영어 전문 용어 처리 규칙:
   - 한국 학계에서 영어 원어 그대로 통용되는 용어는 영어를 그대로 두되,
     처음 등장할 때 한국어 설명을 덧붙이십시오.
     예: "지질 나노입자, 즉 리피드 나노파티클은".
   - 머리글자를 하나씩 읽어야 하는 약어는 한글 음차로 풀어 쓰십시오.
     예: "RNA"는 "알엔에이", "PCR"은 "피시아르", "MRI"는 "엠아르아이".
   - 하나의 단어처럼 발음되는 약어는 한글 음차로 쓰십시오.
     예: "CRISPR"는 "크리스퍼", "GWAS"는 "지와스".
   - 한 문장 안에서 영어와 한국어를 번갈아 쓰지 마십시오. 음성 합성기의
     발음이 불안정해집니다.
4. 모든 숫자와 통계를 한국어로 읽을 수 있게 풀어 쓰십시오.
   "p < 0.001"은 "유의확률 피 값이 영 점 영영일 미만",
   "n=1,247"은 "표본 천이백사십칠 명",
   "95% CI [1.2, 3.4]"는 "구십오 퍼센트 신뢰구간 일 점 이에서 삼 점 사".
5. 단위는 한국어로 풀어 쓰십시오. "mg/kg"은 "밀리그램 퍼 킬로그램",
   "μm"은 "마이크로미터", "°C"는 "섭씨 몇 도".
6. 표와 목록은 모두 서술형 문장으로 바꾸고 순서를 명시하십시오.
   예: "주요 접근법은 세 가지입니다. 첫째는 ... 둘째는 ... 셋째는 ...".
7. 제목 대신 구어체 전환 문장을 사용하십시오.
   예: "먼저 전달 방식부터 살펴보겠습니다." /
       "전달 방식은 여기까지입니다. 이제 표적화로 넘어가겠습니다."
8. 첫 문장에서 이 보고서가 무엇이며 몇 편의 논문을 다루는지 밝히고,
   마지막 문장에서 마무리를 알리십시오.
9. 문장을 짧게 쓰십시오. 한 문장은 사십 자 내외를 목표로 하십시오.
10. 문체는 정중한 해요체 또는 하십시오체로 일관되게 유지하십시오.
    한 스크립트 안에서 문체를 섞지 마십시오.
11. 원문 보고서의 모든 실질적 발견, 수치, 한계점을 보존하십시오.
    이것은 형식 변환이지 요약이 아닙니다. 원문에 없는 사실을 추가하지 마십시오.

목표 분량
약 {CHAR_COUNT}자 (분당 약 330자 기준 약 {MINUTES}분 분량).

원본 보고서
---
{REPORT_MARKDOWN}
---
```

### 8.4 Which model to use for the rewrite

This is one call over ~4,000 input tokens producing ~2,000 output tokens. On `gemini-3.8-flash` that is roughly **$0.01**. Use the same model configured for the trend report (`reportModel` in doc `03` §16) — quality matters here and the cost is negligible. **Do not use the cheap summarization model for this step**; acronym expansion and Korean number formatting are exactly the tasks where the cheapest tier degrades visibly.

### 8.5 Validation before sending to TTS

Cheap guards worth running on the generated script:

```js
const LEAKS = [
  { re: /^#{1,6}\s/m,          msg: 'markdown heading survived' },
  { re: /^\s*[-*+]\s/m,        msg: 'bullet list survived' },
  { re: /\|.*\|/,              msg: 'table row survived' },
  { re: /\*\*|__/,             msg: 'bold markers survived' },
  { re: /\[\d+([,;]\s*\d+)*\]/,msg: 'bracket citation survived' },
  { re: /https?:\/\//,         msg: 'URL survived' },
  { re: /\b10\.\d{4,}\//,      msg: 'DOI survived' },
  { re: /\bet al\./,           msg: 'et al. survived' },
  { re: /```/,                 msg: 'code fence survived' },
];

function validateScript(script) {
  return LEAKS.filter(l => l.re.test(script)).map(l => l.msg);
}
```

If any fire, retry the rewrite once with the failures appended as explicit corrections. This costs one extra cheap call and catches the majority of unlistenable output before spending TTS money on it.

---

## 9. Korean-specific handling

Korean TTS quality is dominated by three issues, all of which are solved in the **script** (§8.3), not in the TTS call.

### 9.1 English technical terms inside Korean text

This is the dominant problem in Korean scientific TTS. Korean research prose is saturated with English terms — `transformer`, `attention`, `fine-tuning`, `CRISPR-Cas9`, `single-cell RNA-seq`.

Failure modes when English is left inline:
- The model **switches accent mid-sentence**, producing a jarring English-voice interjection.
- The model reads English with **Korean phonology**, producing something between the two that is worse than either.
- On a code-switch, prosody resets and the sentence loses its intonation contour.

Mitigations, in order of effectiveness:

1. **Transliterate to Hangul in the script.** `transformer` → `트랜스포머`, `attention` → `어텐션`, `fine-tuning` → `파인튜닝`. The TTS then reads pure Korean with stable prosody. **This is the recommended default** and is what §8.3 rule 3 instructs.
2. **Gloss on first use, then use the Korean form.** "트랜스포머, 즉 transformer 구조는…" — but note this reintroduces the English token once. Prefer glossing with a Korean *description* rather than the Latin spelling.
3. **Set `language: "ko-KR"` explicitly** on the Interactions API's `speech_config.speakers[].language`. This anchors the model even when a stray Latin token appears. **Do this whenever the Interactions path is used.**
4. **Never mix scripts within one sentence** if avoidable — §8.3 rule 3, final bullet.

For domain-specific terms the model might transliterate inconsistently across chunks, maintain a small **glossary injected into the rewrite prompt**:

```
용어 표기 통일 (아래 표기를 반드시 사용하십시오):
  CRISPR → 크리스퍼
  transformer → 트랜스포머
  fine-tuning → 파인튜닝
  single-cell RNA-seq → 단일세포 알엔에이 시퀀싱
  lipid nanoparticle → 지질 나노입자
```

Build this glossary from the collection's own frequent terms and persist it per-collection so repeated runs stay consistent.

### 9.2 Numbers and units

Korean has **two number systems** (Sino-Korean 일이삼 and native 하나둘셋) and the correct one depends on the counter word. TTS engines get this wrong routinely on bare Arabic numerals.

| Written | Wrong (bare numeral) | Correct in script |
| --- | --- | --- |
| `3년` | may read native 셋 | `삼 년` |
| `100편의 논문` | ambiguous | `백 편의 논문` |
| `p < 0.001` | reads Latin `p` unpredictably | `유의확률 피 값이 영 점 영영일 미만` |
| `95% CI` | `%` and `CI` both risky | `구십오 퍼센트 신뢰구간` |
| `12.5 mg/kg` | unit read as letters | `십이 점 오 밀리그램 퍼 킬로그램` |
| `2024년` | usually fine | `이천이십사 년` (safer) |
| `μm` | often silent or mangled | `마이크로미터` |
| `°C` | often silent | `섭씨 ○○ 도` |
| `n = 1,247` | comma read as pause | `표본 천이백사십칠 명` |

**Rule: no bare Arabic numerals, no symbolic units, and no Latin statistical symbols should reach the Korean TTS call.** §8.3 rules 4 and 5 enforce this. A post-rewrite regex check for `[0-9]` and `[%°μ]` in the Korean script is a cheap safety net — flag rather than hard-fail, since some numerals are acceptable in context.

### 9.3 Length and cost differences

Korean is **substantially denser per character** than English:

- English: ~150 words/minute ≈ ~900 characters/minute of speech.
- Korean: ~330 characters/minute of speech.
- Token density: Korean consumes roughly **2.5–3× more tokens per character** than English.

Consequences:

1. **Chunk sizes must differ by language.** 900 chars is ~60 s in English but ~2.7 min in Korean. §5.2 uses 450 chars for Korean.
2. **Input token cost is higher for the same audio duration**, though input is a small share of TTS cost (§11) so the effect on the bill is minor.
3. **The script-generation call is more expensive in Korean** — same reason, and there output tokens dominate.
4. **The 32k TTS context window is reached sooner** in Korean for the same audio length.

### 9.4 Language detection and defaults

Do not infer the audio language from the papers — a Korean researcher reading English-language papers wants a **Korean** briefing. Make it an explicit user choice with a persistent per-collection preference, defaulting from Zotero's UI locale (`Zotero.locale`) on first run.

---

## 10. Delivery in Zotero

### 10.1 Where to put the audio

Three candidate homes, evaluated:

| Option | Pros | Cons |
| --- | --- | --- |
| **Child attachment on a report note/item** *(recommended)* | Appears in the item tree next to the report; discoverable; deletable through normal Zotero UI; survives library operations | Imported attachments count against Zotero storage quota and sync |
| File in the Zotero data directory | Simple; no item plumbing | **Invisible to the user.** Not in the item tree, not synced, orphaned on plugin uninstall. Users will never find it. |
| Temp file + immediate "open" | Zero storage cost | Not persistent; the user cannot come back to it |

**Recommended structure:**

```
Collection: "CRISPR delivery 2023–2026"
└── Standalone item (type: Document, or Report)
    title: "Research trends: CRISPR delivery 2023–2026"
    ├── Note child: the full written trend report (HTML/markdown-rendered)
    └── Attachment child: "…-audio-en.wav"  (or .mp3)
```

A **standalone parent item** (rather than attaching to an existing paper) is right because the report is *about* the collection, not about any one paper. Put it in the same collection so it sits alongside its sources.

### 10.2 Imported vs. linked attachment

| | `Zotero.Attachments.importFromFile()` | `Zotero.Attachments.linkFromFile()` |
| --- | --- | --- |
| File location | Copied into Zotero storage | Stays where it is; Zotero stores a path |
| Syncs | Yes (counts against quota) | No |
| Portable | Yes | Breaks if the file moves |
| Right for | MP3 (~3.6 MB / 10 min at 48 kbps; ~9.6 MB at 128 kbps) | WAV (~28.8 MB / 10 min) |

Both take an options object including `file`, `parentItemID`, `contentType`, and `title` ([Zotero forums](https://forums.zotero.org/discussion/121004/creating-link-attachments-using-the-javascript-api)).

> **Unverified:** the exact current signature and full option set for `Zotero.Attachments.importFromFile` in Zotero 10. The Zotero JavaScript API documentation explicitly states it "is under-documented, and at present requires a lot of looking around in the source code" ([Zotero JS API](https://www.zotero.org/support/dev/client_coding/javascript_api)). **Check `chrome/content/zotero/xpcom/attachments.js` in the Zotero source for the target version before implementing.** The sketch below is a design outline, not verified working code.

```js
// DESIGN SKETCH — verify signatures against Zotero 10 source before use.

// 1. Write the audio to a temp path.
const tmpDir  = await Zotero.getTempDirectory().path;   // verify accessor
const fileName = buildFileName(collection, lang, 'wav');
const tmpPath = PathUtils.join(tmpDir, fileName);
await IOUtils.write(tmpPath, wavBytes);

// 2. Create the parent report item, if not already created.
const parent = new Zotero.Item('document');
parent.setField('title', `Research trends: ${collection.name}`);
parent.setField('date', new Date().toISOString().slice(0, 10));
parent.addToCollection(collection.id);
await parent.saveTx();

// 3. Attach the written report as a child note.
const note = new Zotero.Item('note');
note.parentItemID = parent.id;
note.setNote(reportHtml);
await note.saveTx();

// 4. Attach the audio. Import small MP3s; link large WAVs.
const useLink = wavBytes.byteLength > 10 * 1024 * 1024;   // 10 MB threshold
const attachOpts = {
  file:         tmpPath,
  parentItemID: parent.id,
  contentType:  'audio/wav',        // or 'audio/mpeg' for MP3
  title:        `Audio report (${lang === 'ko' ? 'Korean' : 'English'})`,
};

const attachment = useLink
  ? await Zotero.Attachments.linkFromFile(attachOpts)
  : await Zotero.Attachments.importFromFile(attachOpts);
```

For linked attachments the file must live somewhere permanent — prompt the user for a folder once and persist it in prefs; do not link to a temp path.

### 10.3 Naming

Names must sort chronologically, be unique across re-runs, and be safe on Windows/macOS/Linux:

```
<collection-slug>-trends-<YYYYMMDD>-<lang>.<ext>

crispr-delivery-2023-2026-trends-20260908-en.wav
crispr-delivery-2023-2026-trends-20260908-ko.mp3
```

```js
function buildFileName(collection, lang, ext) {
  const slug = collection.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')   // keep Hangul; strip punctuation
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug}-trends-${date}-${lang}.${ext}`;
}
```

Notes: keep Unicode letters (`\p{L}`) so Korean collection names survive; cap the slug so the full path stays under the Windows 260-character limit; if the same collection is re-run on the same day, append `-2`, `-3` rather than overwriting.

### 10.4 How the user plays it

| Path | Mechanism | Notes |
| --- | --- | --- |
| **Double-click the attachment** | Zotero's default handler opens it in the OS default audio app | **Zero extra work — this is the primary path.** Requires a correct `contentType` on the attachment. |
| "Play audio report" menu item | `Zotero.launchFile(path)` (verify the current API name) | A one-click affordance from the collection context menu |
| In-app player | An `<audio>` element in a plugin-provided panel | Nicer UX (scrubbing, speed control, resume position) but real work: a XUL/HTML panel, playback state, and a resume-position store. **Phase 2.** |
| Sync to phone | Zotero sync carries imported attachments to the mobile apps | The actual reason to produce a file rather than use `speechSynthesis` — this is the feature's whole point. Argues for MP3 and for *imported* rather than linked attachments where quota allows. |

**Set `contentType` correctly**: `audio/mpeg` for MP3, `audio/wav` for WAV. Getting this wrong is the most common reason a Zotero attachment fails to open in the right application.

---

## 11. Worked cost example

**Scenario:** a 10-minute English audio report generated from a trend report covering 100 papers.

**Assumptions**

| Quantity | Value |
| --- | --- |
| Spoken rate | 150 words/minute |
| Script length | 1,500 words ≈ 2,000 tokens ≈ 9,000 characters |
| Audio duration | 600 seconds |
| Audio output tokens | 600 s × 25 tok/s = **15,000 tokens** |
| Chunks | 9,000 chars ÷ 900 = **10 chunks** |
| Style prefix | 40 tokens, repeated on all 10 chunks = 400 tokens |
| Total TTS input | 2,000 + 400 = **2,400 tokens** |
| Source trend report (rewrite input) | ~4,000 tokens |
| Rewrite output | ~2,000 tokens |

**Step 1 — Script generation (one LLM call)**

| Model | Input (4,000 tok) | Output (2,000 tok) | Total |
| --- | --- | --- | --- |
| `gemini-3.8-flash` ($0.75/$3.75) | $0.0030 | $0.0075 | **$0.011** |
| `claude-sonnet-5` ($2/$10) | $0.0080 | $0.0200 | **$0.028** |
| `gpt-5.6-terra` ($2/$12) | $0.0080 | $0.0240 | **$0.032** |

**Step 2 — TTS synthesis (10 chunks)**

| Model | Input (2,400 tok) | Output (15,000 tok) | Total |
| --- | --- | --- | --- |
| `gemini-3.1-flash-tts-preview` ($1/$20) | $0.0024 | $0.3000 | **$0.302** |
| `gemini-2.5-flash-preview-tts` ($0.50/$10) | $0.0012 | $0.1500 | **$0.151** |
| OpenAI `tts-1` ($15/1M **chars**) | 9,000 chars → | — | **$0.135** |
| OpenAI `tts-1-hd` ($30/1M chars) | 9,000 chars → | — | **$0.270** |
| Web Speech API | — | — | **$0.000** (no file) |

> **Unverified — `gpt-4o-mini-tts` is missing from this table on purpose.** It is the model §7.5 actually recommends as the OpenAI fallback, and its prices are known ($0.60/1M text input, $12.00/1M audio output), but it is billed **per audio output token** and OpenAI does not publish an audio-tokens-per-second rate. The 2,400 input tokens cost $0.0014; the output side cannot be derived without measuring one real call. Do that before putting `gpt-4o-mini-tts` in the cost estimator, and do not assume Gemini's 25 tok/s carries over. Re-verify by 2026-12-01.

**Total per 10-minute English report**

| Configuration | Total |
| --- | --- |
| `gemini-3.8-flash` script + `gemini-2.5-flash-preview-tts` | **$0.16** |
| `gemini-3.8-flash` script + `gemini-3.1-flash-tts-preview` | **$0.31** |
| `claude-sonnet-5` script + `gemini-3.1-flash-tts-preview` | **$0.33** |
| `gemini-3.8-flash` script + OpenAI `tts-1` | **$0.15** |

**Korean variant.** Same 10 minutes = 3,300 characters of Korean script ≈ **2,500–3,300 tokens** — doc `03` §10.2's estimator uses ~1.3 characters/token for Korean, which gives ~2,540; 1 token/char is the conservative upper bound. Audio output tokens are unchanged (duration-based, not text-based), so **TTS cost is identical at ~$0.30**. The script-generation call costs slightly more (~$0.013–$0.015 vs $0.011). **Korean is essentially the same price as English** — the input-side token penalty is real but is a rounding error against duration-priced audio output.

**End-to-end, including doc `03`'s summarization pipeline:**

| Stage | Cost (cheap config) |
| --- | --- |
| Summarize 100 abstracts (`gemini-3.8-flash`, cached) | $0.15 |
| Write trend report | included above |
| Rewrite as audio script | $0.011 |
| TTS 10 minutes (`gemini-2.5-flash-preview-tts`) | $0.151 |
| **Total** | **~$0.31** |

**Roughly 30 cents for a complete written-plus-spoken literature briefing over 100 papers.** That is cheap enough that per-run cost is not a barrier to adoption — but show the estimate before running anyway, because users with no API-spend intuition will worry regardless. And retries are billed: a failed run that gets halfway and restarts costs 1.5×.

**Cost control levers, in order:**
1. **Duration is the whole bill.** Audio output is **~99%** of TTS cost ($0.300 of $0.302 above) and is priced purely by seconds. A 5-minute report costs half a 10-minute one. Offer a "brief / standard / detailed" length control — it is the only lever that matters. Those three labels are presets over the `tts.targetMinutes` preference (§12 item 1; schema row in `07-architecture-and-data-model.md` §8.5), which stores minutes rather than an enum so the cost estimate is a direct multiplication.
2. `gemini-2.5-flash-preview-tts` is **half the price** of `gemini-3.1-flash-tts-preview`. Make it the recommended model and offer the newer one as a quality upgrade. This is a *recommendation of this document*, resolved at call time from the live model list (§2.2) — it is **not** written into `prefs.js`, and `tts.model` ships empty precisely so this recommendation can change without a pref migration.
3. Cache the generated audio script alongside the report — regenerating audio (e.g. to try a different voice) should not re-run the rewrite.
4. Never regenerate unchanged chunks. If the user changes only the voice, all chunks change; if they edit one paragraph, only its chunk does. A content-hash-per-chunk cache makes edit-and-retry nearly free.

---

## 12. Implementation checklist

1. **Prefs:** TTS provider (Gemini / OpenAI / System voices); TTS model (fetched at runtime); voice
   (fetched/validated); language (EN / KO, defaulting from `Zotero.locale`); target length; output
   format (MP3 / WAV); linked-file folder for large WAVs.

   The **keys, types, defaults and allowed values for all of these are owned by
   `07-architecture-and-data-model.md` §8.5** and are not restated here. The three this document
   was previously missing a name for are now declared there as:

   | Setting | Key | Notes this document owns |
   | --- | --- | --- |
   | TTS model | `tts.model` | Empty default = "use the model this document recommends for the selected provider, resolved at call time". §2.2's IDs all carry `-preview` and churn, so **no model ID is hardcoded** — not in `prefs.js`, not anywhere outside the live model list (§2.2; the same never-hardcode rule as `03-llm-provider-integration.md` §9). §11 lever 2's price argument is what makes the prior-generation model the current recommendation; when that changes, this document changes and the pref does not. |
   | Target length | `tts.targetMinutes` | An integer count of minutes, because duration is what is billed (§11 lever 1: audio output is ~99% of the TTS cost and is priced purely by seconds). `0` = derive from the report's own target length; the derivation is below. The "brief / standard / detailed" framing in §11 is the *UI presentation* of three preset minute values, not a third enum stored in prefs. |
   | Output format | `tts.outputFormat` | `wav` \| `mp3`, per §6.4's format trade-off and §10.2's import-vs-link rule: WAV is linked (~28.8 MB / 10 min), MP3 is imported (~3.6–9.6 MB / 10 min). |

   **Resolving `tts.targetMinutes: 0`.** This document owns the derivation, because it owns the
   speaking rate and the briefing-compression ratio; `06-summarization-and-trend-report.md` §9.2
   owns only the *report's* target word count that feeds it.

   ```
   targetMinutes = round(reportTargetWords / 300)      // clamped to doc 07 §8.5's 1–60 range
   ```

   The 300 is `150 words/minute` (§11's spoken rate) × the `≈2×` compression the rewrite pass
   applies, both taken from §11's worked example rather than chosen: a 100-paper collection has a
   doc 06 §9.2 report target of 2,800–4,000 words, and §11's worked example turns that into a 1,500-word,
   **10-minute** script — which is exactly what `round(3000 / 300)` gives. The compression is what
   makes the audio a briefing rather than a reading (§1, §8.1); speaking the report verbatim at 150
   wpm would run ~19 minutes and roughly double the bill for the same content.

   The caller resolves `0` **before** the rewrite call, so `12-prompt-library.md` §13's
   `{{TARGET_MINUTES}}` never receives `0`.

   The provider, voice, language and linked-file-folder keys are doc 07 §8.5 rows too; that table
   still carries a ⚠ on the ones no document has named, including the linked-file folder.
   (Note that this document has its own §8.5 — "Validation before sending to TTS" — so a bare
   `§8.5` here would resolve to the wrong section. Always qualify it.)
2. **Script pass:** run the §8 rewrite with the language-appropriate template and the per-collection Korean glossary (§9.1); run `validateScript()` (§8.5); retry once on leaks; **persist the script** next to the report.
3. **Chunker:** §5.2, with language-dependent size targets. Show chunk count and estimated duration/cost before proceeding.
4. **TTS loop:** sequential, ≤2 concurrent; identical model/voice/style-prefix per chunk; retry with jitter per doc `03` §11.6; persist completed chunk PCM under a run ID for resume.
5. **Assembly:** PCM concatenation with 250 ms inter-chunk silence → single WAV header (§3, §6); assert consistent sample rate; or write MP3 directly for single-chunk reports.
6. **Delivery:** standalone `document` item in the collection; written report as a child note; audio as a child attachment (import if < 10 MB, link otherwise); correct `contentType`; §10.3 naming.
7. **Separate "Read aloud" action** using `speechSynthesis` — free, offline, no file. Disable the Korean option when `getVoices()` returns no `ko-*` voice, and handle the `voiceschanged` race.
8. **Before shipping, re-verify:** TTS model IDs (all `-preview`), the voice list against the Interactions API, TTS pricing, whether the Interactions or legacy path is the better primary, and `Zotero.Attachments.*` signatures against the target Zotero 10 build.

---

## Sources

All URLs verified 2026-09-08.

**Google Gemini**
- [Speech generation (TTS)](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation) — voice names and characteristics, multi-speaker `speechConfig` shape, language list, 24 kHz/16-bit/mono PCM output, 32k TTS context window
- [Models](https://ai.google.dev/gemini-api/docs/models) — TTS model IDs, streaming availability
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Interactions API reference](https://ai.google.dev/api/interactions-api) — `response_format` audio shape, `generation_config.speech_config.speakers[]`
- [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [generateContent reference (legacy)](https://ai.google.dev/api/generate-content)
- [Gemini cookbook — Get_started_TTS](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_TTS.ipynb) — WAV writing pattern, `audio/l16; rate=24000` MIME
- [Gemini 3.1 Flash TTS pricing (secondary)](https://www.nemovideo.com/blog/gemini-3-1-flash-tts-pricing) — 25 tokens/second of audio, per-minute derivation

**OpenAI**
- [Text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) — endpoint, models, 13 voices, `instructions`, formats, Korean support caveat
- [Pricing](https://developers.openai.com/api/docs/pricing) — `tts-1` / `tts-1-hd` per-character rates

**Zotero**
- [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api)
- [Zotero 7 for developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [ZoTTS — Zotero text-to-speech plugin](https://github.com/ImperialSquid/zotero-zotts) — evidence that OS speech synthesis is reachable from a Zotero plugin; sandboxing caveats
- [Enable SpeechSynthesis within Zotero? (forums)](https://forums.zotero.org/discussion/102228/enable-speechsynthesis-within-zotero)
- [Creating link attachments using the JavaScript API (forums)](https://forums.zotero.org/discussion/121004/creating-link-attachments-using-the-javascript-api) — `Zotero.Attachments.linkFromFile` / `importFromFile` option shape

**Other**
- [MDN — Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- Related project document: `03-llm-provider-integration.md` (provider adapters, retry policy, cost model)

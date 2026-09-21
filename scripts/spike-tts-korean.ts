/**
 * P0-T25 (spike V-10) — throwaway Gemini TTS probe for **Korean**, run by the
 * owner from Zotero's Tools → Developer → Run JavaScript window.
 *
 * `docs/11` §4.2 V-10 asks whether Gemini TTS returns acceptable audio for a
 * ~200-word Korean script carrying embedded English technical terms, **judged
 * by a native Korean speaker**. No agent can answer that half. This probe does
 * the half a machine can: it picks a TTS model from the live list, sends one
 * script, records every measurement that does not need ears, writes a playable
 * `.wav` (plus the raw PCM and a Korean listening checklist) outside the
 * repository, and prints where they landed.
 *
 * It goes through the real `src/core/http/client.ts`, so the run also
 * exercises docs/07 §7.4's option set, exactly as `scripts/spike-network.ts`
 * (P0-T15) does.
 *
 * ## Producing the paste-ready block
 *
 * From the repository root:
 *
 * ```sh
 * npx tsx scripts/spike-tts-korean.ts | Set-Clipboard   # PowerShell
 * npx tsx scripts/spike-tts-korean.ts | clip            # cmd.exe
 * npx tsx scripts/spike-tts-korean.ts > probe.js        # anywhere, to inspect
 * ```
 *
 * Run under Node, this file reads its own source, cuts it at the
 * `NODE-ONLY BELOW THIS LINE` marker, bundles the part above with esbuild
 * (IIFE, global `RHSpikeTtsKorean`, target firefox140, ASCII-only) and prints
 * plain JavaScript to stdout, followed by the one `return await …main(…)` line
 * that Run JavaScript's async mode needs. Nothing is written to disk by the
 * emitter and none of the Node-side code reaches the block. This is
 * `spike-network.ts`'s emitter, deliberately duplicated rather than extracted:
 * `P0-T25`'s `Files` list is two files, `scripts/spike-network.ts` belongs to
 * another card that is being worked on concurrently, and both probes are
 * throwaway.
 *
 * ## The key — asked for, never stored
 *
 * `Services.prompt.promptPassword(parent, title, text, { value })`, Gecko
 * 140's 4-argument form, the same dialog P0-T15 established. **Cancelling, or
 * entering nothing, aborts before a single byte goes out** and says so. The
 * key lives in one local variable, goes out only as the `x-goog-api-key`
 * header — never as Gemini's `key` query parameter, which docs/09 §2.1
 * forbids because query strings reach proxy logs and bug reports — and every
 * line of output passes through {@link redact} (docs/09 §2.1's patterns,
 * including `AIza…`) before it is shown or handed to `Zotero.debug`. No key
 * reaches a pref (D5), a file, or this repository.
 *
 * ## Money
 *
 * One `generateContent` call over ~200 Korean words. Expected spend is
 * **about $0.04**, and under $0.10 on the dearest of doc 04 §2.2's three
 * models — itemised by {@link estimateCost} and shown *inside the password
 * dialog*, so the owner approves the spend at the moment they approve the key.
 * `GET /v1beta/models` carries no documented charge.
 *
 * Google publishes **no machine-readable price list** — docs/03 §9.3 records
 * that the model list omits pricing — so, unlike P0-T15's OpenRouter ranking,
 * the estimate here can only come from doc 04 §4.2's dated table. That table
 * is transcribed once, in {@link DOC04_PRICES}, with its verification date,
 * and the probe prints the provenance on every cost line. It also prints the
 * calibration doc 04 §4.2's Unverified callout explicitly asks for:
 * `candidatesTokenCount ÷ measured audio seconds`, i.e. the real audio output
 * token rate, against the 25 tok/s that every cost figure in the corpus rests
 * on.
 *
 * ## What this probe does not decide
 *
 * The verdict. `docs/11` §4.2 and `P0-T25`'s `Do NOT` list both require a
 * native speaker, so the output ends in a Korean checklist and a blank the
 * owner fills in, not in a PASS.
 *
 * Because the code runs in the *main window's* global, `console`,
 * `performance`, `atob` and `AbortController` may well exist there; this probe
 * uses none of them (it carries its own base64 decoder and times with
 * `Date.now()`), because the plugin sandbox's measured global set does not
 * include them — docs/01 §2.3. It does *report* `typeof atob`, because doc 04
 * §3.3's decoder calls `atob` while §2.3's measured list does not name it.
 */

import {
  createHttpClient,
  HttpError,
  type HttpClient,
  type HttpResponse,
  type HttpTransport,
} from "../src/core/http/client";
import { buildUserAgent, TOOL_NAME } from "../src/core/http/userAgent";
import type {
  GeminiModelEntry,
  GeminiTtsRequest,
  PcmFormat,
} from "../src/tts/types";

// ---------------------------------------------------------------------------
// Configuration — every value cites the section that owns it
// ---------------------------------------------------------------------------

/** docs/04 §2.3, docs/03 §9.3. */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Where the audio lands. **Deliberately not the Zotero data directory.**
 * docs/07 §8.4 and `P0-T26` own that path (`Zotero.DataDirectory.dir`) and the
 * attachment plumbing; `P0-T25`'s `Do NOT` list keeps this card out of it. This
 * is a scratch folder on the owner's machine, outside the repository, so the
 * files can be played, kept, and handed to `P0-T26` without a second call.
 */
const OUTPUT_DIR = "D:\\ZoteroDev\\tts";

/** Filename stem; ASCII and slash-free (docs/01 §12 gotcha 18). */
const FILE_STEM = "rh-p0t25-korean";

/**
 * docs/07 §8.5, the `tts.voice` row: default `"Charon"` ("Informative"),
 * doc 04 §2.7's recommended narrator for a research briefing. A preference
 * default is the one place `plan/README.md` §5 rule 4 allows a literal.
 * doc 04 §2.8: the same 30 voices work across languages, so this is the
 * Korean narrator too.
 */
const VOICE = "Charon";

/**
 * doc 04 §4.2's published prices, **verified by that document on 2026-09-08**
 * and carrying its own instruction to re-verify by 2026-12-01. Transcribed
 * here only because Google exposes no price API (docs/03 §9.3) — contrast
 * P0-T15, which ranks OpenRouter models by live catalogue price as
 * `plan/README.md` §5 rule 4 prefers. These figures order the candidate list
 * and size the estimate; they are never a model *choice*, which comes from the
 * live list below.
 */
const DOC04_PRICES: Readonly<
  Record<string, { readonly inPerMTok: number; readonly outPerMTok: number }>
> = {
  "gemini-3.1-flash-tts-preview": { inPerMTok: 1.0, outPerMTok: 20.0 },
  "gemini-2.5-flash-preview-tts": { inPerMTok: 0.5, outPerMTok: 10.0 },
  "gemini-2.5-pro-preview-tts": { inPerMTok: 1.0, outPerMTok: 20.0 },
};

/** The date doc 04 §4.2 attaches to {@link DOC04_PRICES}. */
const DOC04_PRICES_VERIFIED = "2026-09-08";

/**
 * doc 04 §4.2: audio output is billed at 25 tokens per second — and the same
 * section's Unverified callout says this number is **not** on Google's pricing
 * page and comes from third-party write-ups only. Every pre-run figure this
 * probe prints inherits that uncertainty; the post-run calibration replaces it
 * with a measurement.
 */
const AUDIO_TOKENS_PER_SECOND = 25;

/** doc 04 §9.3: Korean speech runs at roughly 330 characters per minute. */
const KOREAN_CHARS_PER_MINUTE = 330;

/** doc 04 §11 "Korean variant", quoting doc 03 §10.2's estimator. */
const KOREAN_CHARS_PER_TOKEN = 1.3;

/**
 * doc 04 §2.2's last-resort fallback, used **only** when `GET /v1beta/models`
 * cannot be read. doc 04 §7.5 rank 1 and §11 lever 2 make this the current
 * dated recommendation (half the price of the newer model); §2.2 permits one
 * hardcoded ID for exactly this case and no other.
 */
const FALLBACK_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** doc 04 §3.1's table. Only `sampleRateHz` is recoverable from a response. */
const EXPECTED_FORMAT: PcmFormat = {
  sampleRateHz: 24_000,
  channels: 1,
  bitsPerSample: 16,
};

/**
 * The style prefix. doc 04 §2.9: prosody is prompt-controlled, the instruction
 * must stay under 60 tokens, must carry an explicit "do not add commentary"
 * clause, and must be separated from the content by a clear delimiter. There
 * is no `speed`/`pitch`/`rate` parameter and **no SSML** — it would be read
 * aloud.
 *
 * Written in Korean rather than doc 04 §2.9's English, so the whole payload
 * stays in one script: §9.1 mitigation 4 says never to mix scripts inside a
 * sentence, and a monolingual prompt removes one way for the model to guess
 * the wrong language. The corpus does not fix the instruction's language, so
 * this is a judgement, and checklist item 6 is what tests it — if the prefix
 * leaks into the audio, the owner will hear it.
 *
 * ~64 characters ≈ 49 tokens at doc 04 §11's 1.3 chars/token for Korean.
 */
const STYLE_PREFIX =
  "\uCC28\uBD84\uD558\uACE0 \uC548\uC815\uB41C \uC5B4\uC870\uB85C " +
  "\uD559\uC220 \uBE0C\uB9AC\uD551\uCC98\uB7FC \uC77D\uC5B4 " +
  "\uC8FC\uC2ED\uC2DC\uC624. \uB17C\uD3C9\uC744 \uB367\uBD99\uC774\uC9C0 " +
  "\uB9D0\uACE0, \uAD6C\uBD84\uC120 \uC544\uB798 \uBCF8\uBB38\uB9CC " +
  "\uADF8\uB300\uB85C \uC77D\uC73C\uC2ED\uC2DC\uC624.\n\n---\n";

/**
 * The script under test: 197 Korean words (\uC5B4\uC808), 923 characters,
 * ≈2.8 minutes of speech at doc 04 §9.3's 330 chars/min.
 *
 * `P0-T25` step 3 asks for ~200 Korean words with **at least five embedded
 * English technical terms**; there are six, in Latin script:
 * `lipid nanoparticle`, `CRISPR-Cas9`, `single-cell RNA-seq`, `transformer`,
 * `self-supervised learning`, `fine-tuning`. It also carries the numeric forms
 * doc 04 §9.2 lists as the risky ones — `2024\uB144`, `12.5 mg/kg`,
 * `p < 0.001`, `n = 1,247`, `95%`, `4.8%`, `62%`, `350\uB2EC\uB7EC`,
 * `18\uAC1C\uC6D4` — plus §8.3 rule 2's allowed in-prose attribution
 * ("2024\uB144 \uAE40 \uC5F0\uAD6C\uD300\uC774 \uC9C0\uC801\uD588\uB4EF\uC774")
 * in place of a bracket citation.
 *
 * > **This contradicts doc 04 §9.1 and §9.2 on purpose.** Both say the
 * > *shipping* path must transliterate English terms to Hangul and spell
 * > numbers out **before** the TTS call. V-10 asks what happens when it does
 * > not — that is the whole question, and a pre-mitigated script would answer
 * > a different one. Nothing here may be copied into `src/`: §8.3's rewrite
 * > prompt and §9.1's per-collection glossary are the shipped answer, and
 * > Phase 6 owns them.
 *
 * Written as `\u` escapes so this source file, the emitted paste block and a
 * trip through `clip`/`Set-Clipboard` are all pure ASCII end to end.
 */
const KOREAN_SCRIPT = [
  "\uC774\uBC88 \uBCF4\uACE0\uC11C\uB294 \uCD5C\uADFC 3\uB144\uAC04 ",
  "\uBC1C\uD45C\uB41C \uB17C\uBB38 100\uD3B8\uC744 \uC815\uB9AC\uD55C ",
  "\uAC83\uC785\uB2C8\uB2E4. \uD06C\uAC8C \uC138 \uAC00\uC9C0 ",
  "\uD750\uB984\uC73C\uB85C \uB098\uB204\uC5B4 ",
  "\uB9D0\uC500\uB4DC\uB9AC\uACA0\uC2B5\uB2C8\uB2E4.\n\n",

  "\uBA3C\uC800 \uC720\uC804\uC790 \uC804\uB2EC ",
  "\uAE30\uC220\uBD80\uD130 \uC0B4\uD3B4\uBCF4\uACA0\uC2B5\uB2C8\uB2E4. ",
  "2024\uB144 \uC774\uD6C4 lipid nanoparticle \uAE30\uBC18 ",
  "\uC804\uB2EC \uBC29\uC2DD\uC774 \uBE60\uB974\uAC8C ",
  "\uD655\uC0B0\uB418\uC5C8\uACE0, CRISPR-Cas9 \uD3B8\uC9D1 ",
  "\uD6A8\uC728\uB3C4 \uD568\uAED8 ",
  "\uB192\uC544\uC84C\uC2B5\uB2C8\uB2E4. \uD55C \uB2E4\uAE30\uAD00 ",
  "\uC784\uC0C1 \uC5F0\uAD6C\uC5D0\uC11C\uB294 12.5 mg/kg ",
  "\uC6A9\uB7C9\uC5D0\uC11C \uD45C\uC801 \uC870\uC9C1 ",
  "\uB3C4\uB2EC\uB960\uC774 \uB6CC\uB837\uD558\uAC8C ",
  "\uC99D\uAC00\uD588\uC73C\uBA70, \uADF8 \uCC28\uC774\uB294 ",
  "p < 0.001 \uC218\uC900\uC774\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uB9CC ",
  "\uD45C\uBCF8\uC774 n = 1,247\uBA85\uC73C\uB85C ",
  "\uC81C\uD55C\uB418\uC5B4 \uC788\uC5B4 ",
  "\uC77C\uBC18\uD654\uC5D0\uB294 \uC8FC\uC758\uAC00 ",
  "\uD544\uC694\uD569\uB2C8\uB2E4. \uBD80\uC791\uC6A9 \uBCF4\uACE0\uB294 ",
  "\uC804\uCCB4\uC758 4.8%\uB85C \uB0AE\uC740 ",
  "\uD3B8\uC774\uC5C8\uC2B5\uB2C8\uB2E4.\n\n",

  "\uB2E4\uC74C\uC740 \uBD84\uC11D \uBC29\uBC95\uC758 ",
  "\uBCC0\uD654\uC785\uB2C8\uB2E4. single-cell RNA-seq ",
  "\uB370\uC774\uD130\uAC00 \uC313\uC774\uBA74\uC11C \uC138\uD3EC ",
  "\uC720\uD615\uC744 \uAD6C\uBD84\uD558\uB294 \uBAA8\uB378\uC774 ",
  "\uBE60\uB974\uAC8C \uBC1C\uC804\uD588\uC2B5\uB2C8\uB2E4. \uD2B9\uD788 ",
  "transformer \uAD6C\uC870\uB97C \uAE30\uBC18\uC73C\uB85C \uD55C ",
  "\uBAA8\uB378\uC774 \uAE30\uC874 \uBC29\uBC95\uC744 ",
  "\uB300\uCCB4\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uB300\uADDC\uBAA8 ",
  "\uB370\uC774\uD130\uB85C self-supervised learning \uC744 ",
  "\uC218\uD589\uD55C \uB4A4, \uC18C\uADDC\uBAA8 \uB370\uC774\uD130\uB85C ",
  "fine-tuning \uD558\uB294 \uBC29\uC2DD\uC774 \uC0AC\uC2E4\uC0C1 ",
  "\uD45C\uC900\uC774 \uB418\uC5C8\uC2B5\uB2C8\uB2E4. ",
  "\uC7AC\uD604\uC728\uC740 95% ",
  "\uC2E0\uB8B0\uAD6C\uAC04\uC5D0\uC11C \uAC1C\uC120\uB418\uC5C8\uACE0, ",
  "\uC804\uCCB4 \uB17C\uBB38\uC758 \uC57D 62%\uAC00 \uC774 ",
  "\uBC29\uC2DD\uC744 \uB530\uB790\uC2B5\uB2C8\uB2E4. \uB2E4\uB9CC ",
  "\uBC30\uCE58 \uD6A8\uACFC\uB97C \uC81C\uB300\uB85C ",
  "\uBCF4\uC815\uD55C \uC5F0\uAD6C\uB294 \uC808\uBC18\uC5D0 ",
  "\uBBF8\uCE58\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.\n\n",

  "\uC138 \uBC88\uC9F8\uB294 \uD3C9\uAC00 ",
  "\uAE30\uC900\uC785\uB2C8\uB2E4. \uC11C\uB85C \uB2E4\uB978 ",
  "\uC5F0\uAD6C\uAC00 \uAC19\uC740 \uC9C0\uD45C\uB97C \uB2E4\uB974\uAC8C ",
  "\uC815\uC758\uD558\uB294 \uACBD\uC6B0\uAC00 \uB9CE\uC544, ",
  "\uC218\uCE58\uB97C \uC9C1\uC811 \uBE44\uAD50\uD558\uAE30 ",
  "\uC5B4\uB824\uC6E0\uC2B5\uB2C8\uB2E4. 2025\uB144\uC5D0 ",
  "\uACF5\uAC1C\uB41C \uACF5\uB3D9 \uBCA4\uCE58\uB9C8\uD06C\uAC00 \uC774 ",
  "\uBB38\uC81C\uB97C \uC77C\uBD80 \uD574\uC18C\uD588\uC9C0\uB9CC, ",
  "\uC544\uC9C1 \uCC38\uC5EC \uAE30\uAD00\uC740 \uC77C\uACF1 ",
  "\uACF3\uBF10\uC785\uB2C8\uB2E4.\n\n",

  "\uB9C8\uC9C0\uB9C9\uC73C\uB85C \uD55C\uACC4\uB97C ",
  "\uC9DA\uACA0\uC2B5\uB2C8\uB2E4. \uC5F0\uAD6C \uB300\uBD80\uBD84\uC774 ",
  "\uB2E8\uC77C \uAE30\uAD00\uC5D0\uC11C ",
  "\uC218\uD589\uB418\uC5C8\uACE0, \uC7A5\uAE30 \uCD94\uC801 ",
  "\uAD00\uCC30 \uAE30\uAC04\uC740 \uD3C9\uADE0 18\uAC1C\uC6D4\uC5D0 ",
  "\uADF8\uCCE4\uC2B5\uB2C8\uB2E4. 2024\uB144 \uAE40 ",
  "\uC5F0\uAD6C\uD300\uC774 \uC9C0\uC801\uD588\uB4EF\uC774, ",
  "\uB2E4\uAE30\uAD00 \uAC80\uC99D\uC774 \uB2E4\uC74C ",
  "\uACFC\uC81C\uB85C \uB0A8\uC544 \uC788\uC2B5\uB2C8\uB2E4. \uBE44\uC6A9 ",
  "\uCE21\uBA74\uC5D0\uC11C\uB3C4 \uAC80\uC0AC \uD55C \uAC74\uB2F9 ",
  "\uC57D 350\uB2EC\uB7EC\uAC00 \uB4E4\uC5B4 \uD604\uC7A5 ",
  "\uB3C4\uC785\uC740 \uC544\uC9C1 ",
  "\uC81C\uD55C\uC801\uC785\uB2C8\uB2E4.\n\n",

  "\uC774\uC0C1\uC73C\uB85C \uC694\uC57D\uC744 ",
  "\uB9C8\uCE69\uB2C8\uB2E4.",
].join("");

/** Characters of a response body quoted in the summary. */
const EXCERPT_CHARS = 500;

// ---------------------------------------------------------------------------
// Environment handed in by the paste block's last line
// ---------------------------------------------------------------------------

/** The slice of `IOUtils` this probe uses (docs/01 §5.6). */
export interface IoPort {
  makeDirectory(
    path: string,
    options: { createAncestors: boolean; ignoreExisting: boolean },
  ): Promise<void>;
  write(path: string, data: Uint8Array): Promise<number>;
  writeUTF8(path: string, contents: string): Promise<number>;
  read(path: string): Promise<Uint8Array>;
}

/** The slice of `PathUtils` this probe uses (docs/01 §5.6). */
export interface PathPort {
  join(...components: string[]): string;
  toFileURI(path: string): string;
}

/** Just enough of an `<audio>` element to ask a real decoder for a duration. */
export interface AudioProbeElement {
  preload: string;
  src: string;
  readonly duration: number;
  readonly error: { readonly code: number } | null;
  load(): void;
  addEventListener(type: string, listener: () => void): void;
}

/**
 * The main window. Present only because Run JavaScript evaluates there; the
 * plugin sandbox has no `document` and shipped code must not assume one.
 */
export interface MainWindowPort {
  readonly document: { createElement(tag: "audio"): AudioProbeElement };
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface ProbeEnv {
  readonly zotero: {
    readonly version: string;
    readonly HTTP: HttpTransport;
    debug(message: string): void;
  };
  readonly services: Pick<JSServices, "prompt" | "wm">;
  readonly io: IoPort;
  readonly paths: PathPort;
  /** `null` when the block is evaluated somewhere without a window. */
  readonly window: MainWindowPort | null;
  /** package.json `version` at emit time; goes into the D10 User-Agent. */
  readonly version: string;
  /** `typeof atob !== "undefined"` in the evaluating global. Reported only. */
  readonly hasAtob: boolean;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export async function main(env: ProbeEnv): Promise<string> {
  const lines: string[] = [];
  const secrets: string[] = [];
  const say = (line = ""): void => {
    const safe = redact(line, secrets);
    lines.push(safe);
    try {
      env.zotero.debug(`[research_helper P0-T25] ${safe}`);
    } catch {
      /* the summary still comes back as the result */
    }
  };

  try {
    const userAgent = buildUserAgent(env.version);
    const started = new Date();
    say("research_helper P0-T25 Gemini TTS Korean probe (V-10)");
    say(`run at      ${started.toISOString()}`);
    say(`zotero      ${env.zotero.version}`);
    say(`user-agent  ${userAgent}`);
    say("client      src/core/http/client.ts (anon, successCodes:false,");
    say("            noRetryOnThrottle, errorDelayMax:0, logBodyLength:0)");
    say(`atob here   ${env.hasAtob ? "defined" : "NOT defined"} (reported`);
    say("            only: doc 04 §3.3 decodes with atob, docs/01 §2.3's");
    say("            measured sandbox globals do not list it; this probe");
    say("            carries its own decoder either way)");

    say();
    const est = estimateCost();
    for (const line of est.lines) say(line);

    say();
    const key = askForKey(env, est.dialogText);
    if (key === null) {
      say("ABORTED before any request: no key entered (dialog cancelled or");
      say("empty). Nothing was sent, nothing was spent, nothing was written.");
      say("Re-run and paste the Gemini key when the dialog appears.");
      return lines.join("\n");
    }
    secrets.push(key);
    say(
      `key         entered via password dialog (${key.length} chars; ` +
        "never shown, never stored, header-only)",
    );

    const client = createHttpClient({ transport: env.zotero.HTTP, userAgent });

    say();
    const model = await pickModel(client, key, est, say);

    say();
    const synth = await synthesize(client, key, model, say);
    if (synth === null) {
      say();
      say("VERDICT (machine half): FAIL - no audio bytes returned.");
      say("The native-speaker half cannot start. See the failure above.");
      return lines.join("\n");
    }

    say();
    const written = await writeArtifacts(env, model, synth, started, say);

    say();
    const decoded = await decodeCheck(env, written.wavUri, say);

    say();
    say("---------------- MACHINE HALF: what was measured ----------------");
    say(`model used        ${model.id} (${model.source})`);
    say(`voice             ${VOICE} (docs/07 §8.5 tts.voice default)`);
    say(`HTTP status       ${synth.status}`);
    say(`latency           ${synth.ms} ms`);
    say(`response bytes    ${synth.bodyChars} chars of JSON`);
    say(`mimeType          ${synth.mimeType ?? "(absent)"}`);
    say(`  vs doc 04 §3.1  ${synth.mimeVerdict}`);
    say(
      `encoding          ${synth.isRiff ? "RIFF/WAVE already" : "raw PCM"}, ` +
        `${EXPECTED_FORMAT.bitsPerSample}-bit LE, ` +
        `${EXPECTED_FORMAT.channels} ch (bit depth and channel count are ` +
        "doc 04 §3.1 assumptions - the response states neither)",
    );
    say(`sample rate       ${synth.sampleRateHz} Hz (parsed from mimeType)`);
    say(`audio bytes       ${synth.audioBytes} (PCM payload)`);
    say(`wav file bytes    ${written.wavBytes}`);
    say(`duration          ${synth.durationSeconds.toFixed(2)} s (from byte`);
    say("                  count; exact if the format assumptions hold)");
    say(`peak / rms        ${synth.peakDbfs} / ${synth.rmsDbfs} dBFS`);
    say(`non-silent        ${synth.nonSilent ? "yes" : "NO - all zeroes"}`);
    say(`decodes           ${decoded}`);
    say(`usage tokens      ${synth.usageText}`);
    say(`cost reported     ${synth.costReported}`);
    for (const line of actualCost(model.id, synth)) say(line);

    say();
    say(`WAV  ${written.wavPath}`);
    say(`PCM  ${written.pcmPath}`);
    say(`TXT  ${written.txtPath}`);

    say();
    for (const line of checklistKorean()) say(line);

    say();
    say("---------------- HUMAN HALF: still open ----------------");
    say("P0-T25 'Done when' box 3 needs a NATIVE KOREAN SPEAKER's verdict,");
    say("recorded in their own words and not paraphrased into a pass.");
    say("Nothing above is that verdict. Paste the answers to the checklist");
    say("into P0-T25's Findings, then P0-T26 can reuse the PCM file above");
    say("without spending again.");
  } catch (e) {
    say(`PROBE ABORTED: ${describeError(e)}`);
  }
  return lines.join("\n");
}

// --- The spend gate ---------------------------------------------------------

interface CostEstimate {
  readonly lines: readonly string[];
  readonly dialogText: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Pre-run estimate, itemised, from doc 04 §4.2's table and §9.3's speaking
 * rate. Both the cheapest and the dearest of doc 04 §2.2's three models are
 * priced, because which one the live list yields is not known until the call
 * after this one.
 */
function estimateCost(): CostEstimate {
  const chars = KOREAN_SCRIPT.length + STYLE_PREFIX.length;
  const minutes = KOREAN_SCRIPT.length / KOREAN_CHARS_PER_MINUTE;
  const seconds = minutes * 60;
  const inputTokens = Math.ceil(chars / KOREAN_CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(seconds * AUDIO_TOKENS_PER_SECOND);

  const priced = Object.entries(DOC04_PRICES)
    .map(([id, p]) => ({
      id,
      usd:
        (inputTokens * p.inPerMTok) / 1e6 + (outputTokens * p.outPerMTok) / 1e6,
      p,
    }))
    .sort((a, b) => a.usd - b.usd);

  const lines: string[] = [];
  lines.push("[0] EXPECTED SPEND (pre-run estimate)");
  lines.push(
    `    script ${KOREAN_SCRIPT.length} chars + style prefix ` +
      `${STYLE_PREFIX.length} chars = ${chars} chars`,
  );
  lines.push(
    `    input  ~${inputTokens} tok (doc 04 §11: ${KOREAN_CHARS_PER_TOKEN} ` +
      "chars/token for Korean)",
  );
  lines.push(
    `    audio  ~${minutes.toFixed(2)} min (doc 04 §9.3: ` +
      `${KOREAN_CHARS_PER_MINUTE} chars/min)`,
  );
  lines.push(
    `    output ~${outputTokens} tok (doc 04 §4.2: ` +
      `${AUDIO_TOKENS_PER_SECOND} tok/s - UNVERIFIED, third-party only)`,
  );
  for (const m of priced) {
    lines.push(
      `    ${m.id}: $${m.p.inPerMTok.toFixed(2)}/$${m.p.outPerMTok.toFixed(2)} ` +
        `per 1M -> $${m.usd.toFixed(4)}`,
    );
  }
  lines.push(
    `    prices: doc 04 §4.2 table, verified ${DOC04_PRICES_VERIFIED}, ` +
      "re-verify by 2026-12-01.",
  );
  lines.push(
    "    Google publishes no machine-readable price list (docs/03 §9.3:" +
      " pricing is not exposed by GET /v1beta/models), so this estimate" +
      " cannot be read live the way P0-T15 reads OpenRouter's.",
  );
  lines.push("    GET /v1beta/models carries no documented charge.");

  const cheapest = priced[0];
  const dearest = priced[priced.length - 1];
  const dialogText =
    "Enter your Gemini API key.\n\n" +
    "It is used for ONE text-to-speech call over a " +
    `${KOREAN_SCRIPT.length}-character Korean script ` +
    `(about ${minutes.toFixed(1)} minutes of audio), then discarded.\n\n` +
    "Expected spend: about $" +
    `${(cheapest?.usd ?? 0).toFixed(3)}, at most $` +
    `${(dearest?.usd ?? 0).toFixed(3)} on the dearest of the three TTS ` +
    "models.\nSource: docs/04 §4.2's price table (verified " +
    `${DOC04_PRICES_VERIFIED}); Google publishes no price API.\n\n` +
    "The key is sent only as the x-goog-api-key header. It is not stored, " +
    "logged or displayed.\n\n" +
    "Cancel aborts before anything is sent and nothing is spent.";

  return { lines, dialogText, inputTokens, outputTokens };
}

function askForKey(env: ProbeEnv, text: string): string | null {
  const pass = { value: "" };
  // Parent the dialog on the Run JavaScript window so it opens in front of
  // it; a null parent is accepted by the prompt service.
  const parent = env.services.wm.getMostRecentWindow("zotero:run-js");
  const ok = env.services.prompt.promptPassword(
    parent,
    `${TOOL_NAME} - P0-T25 Gemini TTS Korean probe`,
    text,
    pass,
  );
  const key = ok ? pass.value.trim() : "";
  pass.value = "";
  return key === "" ? null : key;
}

// --- Model discovery --------------------------------------------------------

interface ChosenModel {
  readonly id: string;
  /** How it was arrived at, for the record. */
  readonly source: string;
}

/**
 * doc 04 §2.2: **do not hardcode**. Fetch the live list, keep the entries that
 * are TTS models, and order them by doc 04 §11 lever 2's price argument. The
 * single hardcoded ID is reached only when the list cannot be read.
 */
async function pickModel(
  client: HttpClient,
  key: string,
  est: CostEstimate,
  say: (line?: string) => void,
): Promise<ChosenModel> {
  const url = `${GEMINI_BASE}/models`;
  say(`[1] Gemini GET ${url} (live model list, doc 04 §2.2)`);

  const x = await timed(() =>
    client.request("GET", url, {
      headers: { "x-goog-api-key": key, Accept: "application/json" },
      timeoutMs: 60_000,
    }),
  );
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    say(`    last-resort fallback (doc 04 §2.2): ${FALLBACK_TTS_MODEL}`);
    return { id: FALLBACK_TTS_MODEL, source: "doc 04 §2.2 last-resort" };
  }
  const r = x.response;
  const doc = parseJson(r.body);
  say(
    `    status ${r.status}, ${x.ms} ms, ${r.body.length} chars, ` +
      `complete JSON: ${doc === undefined ? "NO" : "yes"}`,
  );
  // The envelope's shape is not fixed by the corpus (src/tts/types.ts,
  // GeminiModelsListResponse). Report what actually arrived.
  say(`    top-level keys: ${JSON.stringify(keysOf(doc))}`);
  const entries = arr(at(doc, "models"))
    .map(asModelEntry)
    .filter((e): e is GeminiModelEntry => e !== null);
  if (r.status !== 200 || entries.length === 0) {
    say(`    body: ${excerpt(r.body)}`);
    say(`    last-resort fallback (doc 04 §2.2): ${FALLBACK_TTS_MODEL}`);
    return { id: FALLBACK_TTS_MODEL, source: "doc 04 §2.2 last-resort" };
  }
  say(`    ${entries.length} models listed`);

  // doc 04 §2.2's two filters, both applied: the robust one on
  // supportedGenerationMethods, and the /-tts/ match on the ID.
  const candidates: { id: string; usd: number | null }[] = [];
  for (const e of entries) {
    const name = e.name ?? "";
    const id = name.startsWith("models/") ? name.slice("models/".length) : name;
    const methods = e.supportedGenerationMethods ?? [];
    if (!/-tts/.test(id)) continue;
    if (methods.length > 0 && !methods.includes("generateContent")) {
      say(`    - ${id}: skipped, no generateContent in ${methods.join("/")}`);
      continue;
    }
    const price = DOC04_PRICES[id];
    const usd =
      price === undefined
        ? null
        : (est.inputTokens * price.inPerMTok) / 1e6 +
          (est.outputTokens * price.outPerMTok) / 1e6;
    say(
      `    - ${id}: ${
        usd === null
          ? "no price in doc 04 §4.2's table"
          : `~$${usd.toFixed(4)} for this script`
      }`,
    );
    candidates.push({ id, usd });
  }

  if (candidates.length === 0) {
    say("    no TTS model in the live list matched /-tts/");
    say(`    last-resort fallback (doc 04 §2.2): ${FALLBACK_TTS_MODEL}`);
    return { id: FALLBACK_TTS_MODEL, source: "doc 04 §2.2 last-resort" };
  }

  // doc 04 §11 lever 2: cheapest first. Unpriced entries sort last rather
  // than being guessed at. Ties break on the ID so the run is reproducible.
  candidates.sort(
    (a, b) =>
      (a.usd ?? Number.POSITIVE_INFINITY) -
        (b.usd ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id),
  );
  const chosen = candidates[0];
  if (chosen === undefined) {
    return { id: FALLBACK_TTS_MODEL, source: "doc 04 §2.2 last-resort" };
  }
  say(
    `    chosen: ${chosen.id} - cheapest of ${candidates.length} live TTS ` +
      "models by doc 04 §11 lever 2's price argument, not a hardcoded ID",
  );
  return { id: chosen.id, source: "live GET /v1beta/models, cheapest" };
}

/**
 * Read one live entry into `src/tts/types.ts`'s {@link GeminiModelEntry}.
 *
 * Deliberately a narrowing read rather than a cast: docs/03 §9.3 describes
 * what the endpoint "returns entries with" and does not publish a schema, so
 * the only honest way to hold one is to check the fields that are used and
 * drop the rest. An entry without a `name` is unusable and is dropped.
 */
function asModelEntry(v: unknown): GeminiModelEntry | null {
  const name = str(at(v, "name"));
  if (name === null) return null;
  const displayName = str(at(v, "displayName"));
  return {
    name,
    supportedGenerationMethods: arr(at(v, "supportedGenerationMethods")).filter(
      (m): m is string => typeof m === "string",
    ),
    ...(displayName === null ? {} : { displayName }),
  };
}

// --- Synthesis --------------------------------------------------------------

interface SynthResult {
  readonly status: number;
  readonly ms: number;
  readonly bodyChars: number;
  readonly mimeType: string | null;
  readonly mimeVerdict: string;
  readonly isRiff: boolean;
  readonly sampleRateHz: number;
  readonly audioBytes: number;
  readonly durationSeconds: number;
  readonly peakDbfs: string;
  readonly rmsDbfs: string;
  readonly nonSilent: boolean;
  readonly usageText: string;
  readonly costReported: string;
  readonly promptTokens: number | null;
  readonly candidateTokens: number | null;
  readonly pcm: Uint8Array;
  readonly wav: Uint8Array;
}

async function synthesize(
  client: HttpClient,
  key: string,
  model: ChosenModel,
  say: (line?: string) => void,
): Promise<SynthResult | null> {
  const url = `${GEMINI_BASE}/models/${model.id}:generateContent`;
  // doc 04 §2.3, single speaker. No `language` field: doc 04 §2.8 says the
  // legacy path has none. No speed/pitch/rate: doc 04 §2.9 says there is none.
  const payload: GeminiTtsRequest = {
    contents: [{ parts: [{ text: STYLE_PREFIX + KOREAN_SCRIPT }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
    },
  };
  const body = JSON.stringify(payload);

  say(`[2] Gemini POST ${url}`);
  say(`    auth: x-goog-api-key header (docs/09 §2.1 - never the ?key= param)`);
  say(
    `    voice ${VOICE}, responseModalities ["AUDIO"], body ${body.length} chars`,
  );
  say(`    text: style prefix ${STYLE_PREFIX.length} chars + script`);
  say(`          ${KOREAN_SCRIPT.length} chars, delimiter "---" (doc 04 §2.9)`);

  const x = await timed(() =>
    client.request("POST", url, {
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body,
      // doc 04: ~3 minutes of audio is generated before the first byte
      // arrives; docs/01 §12 gotcha 14 says never accept the 30 s default.
      timeoutMs: 300_000,
    }),
  );
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    return null;
  }
  const r = x.response;
  const doc = parseJson(r.body);
  say(
    `    status ${r.status}, ${x.ms} ms, ${r.body.length} chars, ` +
      `complete JSON: ${doc === undefined ? "NO" : "yes"}, ` +
      `content-type ${r.header("content-type") ?? "-"}`,
  );
  if (r.status !== 200) {
    say(`    error.status:  ${String(at(doc, "error", "status") ?? "-")}`);
    say(`    error.message: ${str(at(doc, "error", "message")) ?? "-"}`);
    say(`    body: ${excerpt(r.body)}`);
    return null;
  }

  const part = at(doc, "candidates", 0, "content", "parts", 0);
  const mimeType = str(at(part, "inlineData", "mimeType"));
  const data = str(at(part, "inlineData", "data"));
  const finish = str(at(doc, "candidates", 0, "finishReason"));
  say(`    finishReason ${finish ?? "-"}`);
  if (data === null || data === "") {
    say("    NO inlineData.data on candidates[0].content.parts[0]");
    say(`    text part instead: ${JSON.stringify(str(at(part, "text")))}`);
    say(`    body: ${excerpt(r.body)}`);
    return null;
  }
  say(`    inlineData.data ${data.length} base64 chars (never printed)`);

  const decodedBytes = base64ToBytes(data);
  // doc 04 §2.4's sanity check: `UklGR` / 52 49 46 46 means a complete WAV
  // arrived and wrapping it again produces a double-headered file.
  const isRiff =
    decodedBytes[0] === 0x52 &&
    decodedBytes[1] === 0x49 &&
    decodedBytes[2] === 0x46 &&
    decodedBytes[3] === 0x46;
  say(
    `    first 4 bytes ${hex4(decodedBytes)} -> ` +
      `${isRiff ? "RIFF: already a WAV, NOT wrapping again (doc 04 §2.4)" : "bare PCM as doc 04 §3.1 expects"}`,
  );

  const sampleRateHz = sampleRateFromMime(mimeType);
  const pcm = isRiff ? decodedBytes.subarray(44) : decodedBytes;
  const wav = isRiff
    ? decodedBytes
    : pcmToWav(pcm, {
        sampleRate: sampleRateHz,
        channels: EXPECTED_FORMAT.channels,
        bitsPerSample: EXPECTED_FORMAT.bitsPerSample,
      });

  const bytesPerFrame =
    (EXPECTED_FORMAT.bitsPerSample / 8) * EXPECTED_FORMAT.channels;
  const durationSeconds = pcm.byteLength / (sampleRateHz * bytesPerFrame);
  const level = analysePcm(pcm);

  const mimeVerdict = describeMime(mimeType, sampleRateHz);
  say(`    mimeType ${mimeType ?? "(absent)"} -> ${mimeVerdict}`);

  const promptTokens = num(at(doc, "usageMetadata", "promptTokenCount"));
  const candidateTokens = num(at(doc, "usageMetadata", "candidatesTokenCount"));
  const totalTokens = num(at(doc, "usageMetadata", "totalTokenCount"));
  const usageText =
    `prompt ${promptTokens ?? "-"}, candidates ${candidateTokens ?? "-"}, ` +
    `total ${totalTokens ?? "-"}`;

  return {
    status: r.status,
    ms: x.ms,
    bodyChars: r.body.length,
    mimeType,
    mimeVerdict,
    isRiff,
    sampleRateHz,
    audioBytes: pcm.byteLength,
    durationSeconds,
    peakDbfs: level.peakDbfs,
    rmsDbfs: level.rmsDbfs,
    nonSilent: level.nonSilent,
    usageText,
    costReported:
      "none - the Gemini legacy surface reports tokens only " +
      "(doc 04 §2.4); no cost field exists",
    promptTokens,
    candidateTokens,
    pcm,
    wav,
  };
}

/** Compare the returned `mimeType` against doc 04 §3.1's stated value. */
function describeMime(mimeType: string | null, rate: number): string {
  if (mimeType === null) return "ABSENT - doc 04 §3.1 expects audio/L16";
  const l16 = /audio\/L16/i.test(mimeType);
  const pcm = /codec=pcm/i.test(mimeType);
  const rateOk = rate === EXPECTED_FORMAT.sampleRateHz;
  if (l16 && pcm && rateOk) return "MATCHES doc 04 §3.1 exactly";
  const misses: string[] = [];
  if (!l16) misses.push("not audio/L16");
  if (!pcm) misses.push("no codec=pcm");
  if (!rateOk) misses.push(`rate ${rate} != ${EXPECTED_FORMAT.sampleRateHz}`);
  return `DIFFERS from doc 04 §3.1: ${misses.join(", ")}`;
}

/** Post-run cost, and the calibration doc 04 §4.2's Unverified callout asks for. */
function actualCost(modelId: string, s: SynthResult): readonly string[] {
  const out: string[] = [];
  const price = DOC04_PRICES[modelId];
  if (price === undefined) {
    out.push(
      `cost actual       not computable: ${modelId} is not in doc 04 §4.2's ` +
        "price table, and Google exposes no price API (docs/03 §9.3)",
    );
  } else if (s.promptTokens === null || s.candidateTokens === null) {
    out.push("cost actual       not computable: usageMetadata incomplete");
  } else {
    const inUsd = (s.promptTokens * price.inPerMTok) / 1e6;
    const outUsd = (s.candidateTokens * price.outPerMTok) / 1e6;
    out.push(
      `cost actual       $${(inUsd + outUsd).toFixed(5)} = input $` +
        `${inUsd.toFixed(5)} + audio $${outUsd.toFixed(5)}`,
    );
    out.push(
      `                  at doc 04 §4.2's $${price.inPerMTok.toFixed(2)}/$` +
        `${price.outPerMTok.toFixed(2)} per 1M, verified ` +
        `${DOC04_PRICES_VERIFIED}`,
    );
  }
  if (s.candidateTokens !== null && s.durationSeconds > 0) {
    const measured = s.candidateTokens / s.durationSeconds;
    out.push(
      `tok/s CALIBRATED  ${measured.toFixed(2)} output tokens per second of ` +
        `audio (${s.candidateTokens} tok / ${s.durationSeconds.toFixed(2)} s)`,
    );
    out.push(
      `                  doc 04 §4.2 assumes ${AUDIO_TOKENS_PER_SECOND} and ` +
        "flags it Unverified; this line is the measurement it asks for.",
    );
  }
  return out;
}

// --- Files ------------------------------------------------------------------

interface WrittenArtifacts {
  readonly wavPath: string;
  readonly pcmPath: string;
  readonly txtPath: string;
  readonly wavUri: string;
  readonly wavBytes: number;
}

async function writeArtifacts(
  env: ProbeEnv,
  model: ChosenModel,
  s: SynthResult,
  started: Date,
  say: (line?: string) => void,
): Promise<WrittenArtifacts> {
  const stamp = timestamp(started);
  const base = `${FILE_STEM}-${stamp}`;
  const wavPath = env.paths.join(OUTPUT_DIR, `${base}.wav`);
  const pcmPath = env.paths.join(OUTPUT_DIR, `${base}.pcm`);
  const txtPath = env.paths.join(OUTPUT_DIR, `${base}.txt`);

  say(`[3] writing to ${OUTPUT_DIR} (outside the repository)`);
  await env.io.makeDirectory(OUTPUT_DIR, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await env.io.write(wavPath, s.wav);
  // The raw PCM is kept on purpose: P0-T26 wraps it with doc 04 §3.3's header
  // and attaches it, and its card says to reuse these bytes rather than pay
  // for a second synthesis.
  await env.io.write(pcmPath, s.pcm);
  await env.io.writeUTF8(txtPath, sidecarText(model, s, started));

  // Read the WAV back so "it is on disk and intact" is a measurement.
  const readBack = await env.io.read(wavPath);
  const header = parseWavHeader(readBack);
  say(`    wav ${readBack.byteLength} bytes re-read from disk`);
  say(`    header: ${header}`);
  say(`    pcm ${s.pcm.byteLength} bytes (for P0-T26)`);
  say(`    txt: the script sent, the measurements, and the checklist`);

  return {
    wavPath,
    pcmPath,
    txtPath,
    wavUri: env.paths.toFileURI(wavPath),
    wavBytes: readBack.byteLength,
  };
}

function sidecarText(
  model: ChosenModel,
  s: SynthResult,
  started: Date,
): string {
  return [
    "research_helper P0-T25 - Gemini TTS Korean quality spike (V-10)",
    `run: ${started.toISOString()}`,
    `model: ${model.id} (${model.source})`,
    `voice: ${VOICE}`,
    `mimeType: ${s.mimeType ?? "(absent)"} - ${s.mimeVerdict}`,
    `sample rate: ${s.sampleRateHz} Hz, ` +
      `${EXPECTED_FORMAT.channels} ch, ` +
      `${EXPECTED_FORMAT.bitsPerSample}-bit (doc 04 §3.1)`,
    `duration: ${s.durationSeconds.toFixed(2)} s`,
    `pcm bytes: ${s.audioBytes}   wav bytes: ${s.wav.byteLength}`,
    `usage: ${s.usageText}`,
    "",
    "=== STYLE PREFIX SENT (doc 04 §2.9) ===",
    STYLE_PREFIX,
    "=== SCRIPT SENT ===",
    KOREAN_SCRIPT,
    "",
    ...checklistKorean(),
    "",
  ].join("\n");
}

// --- Does it actually decode? ----------------------------------------------

/**
 * Hand the written file to a real media decoder and ask it for a duration.
 *
 * Any failure is reported as "not evidenced" rather than as a fault in the
 * audio: the file URI may be refused for reasons that have nothing to do with
 * the bytes. The structural evidence — the header re-parsed from disk and the
 * non-silence check — is the primary answer; this is corroboration, and a
 * duration that disagrees with the byte-count duration is the signal that doc
 * 04 §3.1's channel/bit-depth assumptions are wrong.
 */
async function decodeCheck(
  env: ProbeEnv,
  uri: string,
  say: (line?: string) => void,
): Promise<string> {
  const w = env.window;
  if (w === null) return "not attempted (no window handed in)";
  say("[4] handing the file to a media decoder for a second duration");
  return new Promise<string>((resolve) => {
    let settled = false;
    const finish = (verdict: string): void => {
      if (!settled) {
        settled = true;
        resolve(verdict);
      }
    };
    try {
      const audio = w.document.createElement("audio");
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => {
        finish(`yes - decoder reports ${audio.duration.toFixed(2)} s`);
      });
      audio.addEventListener("error", () => {
        finish(
          `not evidenced - decoder error code ${audio.error?.code ?? "?"} ` +
            "(may be the file: URI, not the bytes)",
        );
      });
      w.setTimeout(() => {
        finish("not evidenced - decoder did not answer within 15 s");
      }, 15_000);
      audio.src = uri;
      audio.load();
    } catch (e) {
      finish(`not evidenced - ${describeError(e)}`);
    }
  });
}

// --- The listening checklist (Korean) --------------------------------------

/**
 * `P0-T25` step 6 and `Done when` box 3, phrased so each item takes a yes/no
 * or a single line. Korean, because the person answering is a native Korean
 * speaker; ASCII-escaped so the paste block stays ASCII end to end.
 */
function checklistKorean(): readonly string[] {
  return [
    "=== \uCCAD\uCDE8 \uC810\uAC80\uD45C (\uD55C\uAD6D\uC5B4 \uBAA8\uAD6D\uC5B4 \uD654\uC790\uC6A9) ===",
    ".wav \uD30C\uC77C\uC744 \uB05D\uAE4C\uC9C0 \uD55C \uBC88 \uB4E4\uC73C\uC2E0 \uB4A4,",
    "\uC544\uB798 \uC544\uD649 \uAC00\uC9C0\uC5D0 \uC608/\uC544\uB2C8\uC624 \uB610\uB294 \uD55C \uC904\uB85C \uB2F5\uD574 \uC8FC\uC2ED\uC2DC\uC624.",
    "",
    "1. \uC790\uC5F0\uC2A4\uB7EC\uC6C0: \uC0AC\uB78C\uC774 \uC77D\uB294 \uAC83\uCC98\uB7FC \uB4E4\uB9BD\uB2C8\uAE4C?",
    "   (\uC5B5\uC591, \uB04A\uC5B4 \uC77D\uAE30, \uBB38\uC7A5 \uB05D \uC5B5\uC591) \uC608 / \uC544\uB2C8\uC624:",
    "",
    "2. \uC18D\uB3C4\uC640 \uC74C\uB192\uC774\uAC00 \uC815\uC0C1\uC785\uB2C8\uAE4C?",
    "   (\uB290\uB9AC\uAC70\uB098 \uB0AE\uAC8C \uB4E4\uB9AC\uBA74 \uC0D8\uD50C\uB808\uC774\uD2B8\uB098 \uCC44\uB110 \uC624\uB958\uC785\uB2C8\uB2E4) \uC608 / \uC544\uB2C8\uC624:",
    "",
    "3. \uC601\uC5B4 \uC804\uBB38 \uC6A9\uC5B4\uAC00 \uC54C\uC544\uB4E4\uC744 \uB9CC\uD558\uAC8C \uBC1C\uC74C\uB429\uB2C8\uAE4C?",
    "   lipid nanoparticle / CRISPR-Cas9 / single-cell RNA-seq /",
    "   transformer / self-supervised learning / fine-tuning",
    "   \uAC01\uAC01 \uC608 / \uC544\uB2C8\uC624, \uC548 \uB418\uB294 \uAC83\uC774 \uC788\uC73C\uBA74 \uC801\uC5B4 \uC8FC\uC2ED\uC2DC\uC624:",
    "",
    "4. \uC601\uC5B4 \uB2E8\uC5B4\uAC00 \uB098\uC62C \uB54C \uB9D0\uD22C\uB098 \uC5B5\uC591\uC774 \uAC11\uC790\uAE30 \uC601\uC5B4\uC2DD\uC73C\uB85C \uBC14\uB01D\uB2C8\uAE4C?",
    "   \uBC14\uB010\uB2E4\uBA74 \uC5B4\uB290 \uB2E8\uC5B4\uC5D0\uC11C\uC785\uB2C8\uAE4C? \uC608 / \uC544\uB2C8\uC624:",
    "",
    "5. \uC22B\uC790\uC640 \uB2E8\uC704\uAC00 \uC81C\uB300\uB85C \uC77D\uD799\uB2C8\uAE4C?",
    "   3\uB144\uAC04 / 100\uD3B8 / 2024\uB144 / 12.5 mg/kg / p < 0.001 /",
    "   n = 1,247\uBA85 / 95% / 4.8% / 62% / 18\uAC1C\uC6D4 / 350\uB2EC\uB7EC",
    "   \uD2C0\uB9AC\uAC8C \uC77D\uD78C \uAC83\uB9CC \uC801\uC5B4 \uC8FC\uC2ED\uC2DC\uC624:",
    "",
    '6. \uC9C0\uC2DC\uBB38("\uCC28\uBD84\uD558\uACE0 \uC548\uC815\uB41C \uC5B4\uC870\uB85C...")\uC774 \uC74C\uC131\uC5D0 \uC11E\uC5EC \uB098\uC635\uB2C8\uAE4C?',
    "   \uC608 / \uC544\uB2C8\uC624:",
    "",
    "7. \uC911\uAC04\uC5D0 \uB04A\uAE30\uAC70\uB098, \uBE60\uC9C4 \uBB38\uC7A5\uC774\uAC70\uB098, \uBC18\uBCF5\uB41C \uBD80\uBD84\uC774 \uC788\uC2B5\uB2C8\uAE4C?",
    "   \uC608 / \uC544\uB2C8\uC624 (\uC788\uC73C\uBA74 \uB300\uB7B5 \uBA87 \uCD08 \uC9C0\uC810\uC778\uC9C0):",
    "",
    "8. \uC774 \uC74C\uC131\uC744 \uC5F0\uAD6C \uC694\uC57D \uB4E3\uAE30\uC6A9\uC73C\uB85C \uC2E4\uC81C\uB85C \uC4F0\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?",
    "   \uC608 / \uC544\uB2C8\uC624 / \uC870\uAC74\uBD80 (\uC870\uAC74\uC774 \uC788\uC73C\uBA74 \uD55C \uC904\uB85C):",
    "",
    "9. \uCD1D\uD3C9\uC744 \uD55C\uB450 \uBB38\uC7A5\uC73C\uB85C \uC368 \uC8FC\uC2ED\uC2DC\uC624.",
    "   (P0-T25\uB294 \uC694\uC57D\uD558\uC9C0 \uB9D0\uACE0 \uC801\uC73C\uC2E0 \uD45C\uD604 \uADF8\uB300\uB85C \uAE30\uB85D\uD558\uB77C\uACE0 \uC694\uAD6C\uD569\uB2C8\uB2E4)",
    "   >",
    "",
    '8\uBC88\uC774 "\uC544\uB2C8\uC624"\uC774\uBA74 R-8 \uC81C\uACF5\uC5C5\uCCB4 \uC7AC\uAC80\uD1A0 \uC9C8\uBB38\uC774 P0-T28\uB85C \uC62C\uB77C\uAC11\uB2C8\uB2E4.',
  ];
}

// --- doc 04 §3.3: WAV writer and base64, dependency-free --------------------

/**
 * Wrap raw PCM samples in a canonical 44-byte RIFF/WAVE header — doc 04 §3.3,
 * transcribed rather than re-derived, including the two details that section
 * calls out: every multi-byte field is little-endian, and `ChunkSize` at
 * offset 4 is `36 + dataSize`.
 */
function pcmToWav(
  pcm: Uint8Array,
  opts: { sampleRate: number; channels: number; bitsPerSample: number },
): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = opts;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** doc 04 §3.3: parse `audio/L16;codec=pcm;rate=24000` -> 24000. */
function sampleRateFromMime(mimeType: string | null): number {
  const m = /rate=(\d+)/.exec(mimeType ?? "");
  const parsed = m?.[1];
  return parsed === undefined
    ? EXPECTED_FORMAT.sampleRateHz
    : parseInt(parsed, 10);
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * doc 04 §3.3 decodes with `atob`. This does not: docs/01 §2.3's measured
 * sandbox global list does not name `atob`, and a probe that silently depends
 * on the main window's globals proves less than it appears to. Same output,
 * one pass, no intermediate string.
 */
function base64ToBytes(b64: string): Uint8Array {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    lut[B64_ALPHABET.charCodeAt(i)] = i;
  }
  const out = new Uint8Array(Math.ceil((b64.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    const v = c < 128 ? (lut[c] ?? -1) : -1;
    if (v < 0) continue; // whitespace, '=', anything else
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

// --- Measurements on the bytes ----------------------------------------------

/** Peak and RMS of signed 16-bit LE samples, and whether anything is there. */
function analysePcm(pcm: Uint8Array): {
  peakDbfs: string;
  rmsDbfs: string;
  nonSilent: boolean;
} {
  const frames = Math.floor(pcm.byteLength / 2);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < frames; i++) {
    const lo = pcm[i * 2] ?? 0;
    const hi = pcm[i * 2 + 1] ?? 0;
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sumSq += v * v;
  }
  const rms = frames > 0 ? Math.sqrt(sumSq / frames) : 0;
  const dbfs = (x: number): string =>
    x > 0 ? (20 * Math.log10(x / 32768)).toFixed(1) : "-inf";
  return { peakDbfs: dbfs(peak), rmsDbfs: dbfs(rms), nonSilent: peak > 0 };
}

/** Re-read the RIFF header from the file that was written, and describe it. */
function parseWavHeader(bytes: Uint8Array): string {
  if (bytes.byteLength < 44) return `too short (${bytes.byteLength} bytes)`;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string =>
    String.fromCharCode(
      bytes[o] ?? 0,
      bytes[o + 1] ?? 0,
      bytes[o + 2] ?? 0,
      bytes[o + 3] ?? 0,
    );
  const riff = tag(0);
  const wave = tag(8);
  const fmt = tag(12);
  const data = tag(36);
  const chunkSize = view.getUint32(4, true);
  const dataSize = view.getUint32(40, true);
  const ok =
    riff === "RIFF" &&
    wave === "WAVE" &&
    fmt === "fmt " &&
    data === "data" &&
    chunkSize === 36 + dataSize &&
    bytes.byteLength === 44 + dataSize;
  return (
    `${riff}/${wave}/${fmt}/${data}, audioFormat ${view.getUint16(20, true)}, ` +
    `${view.getUint16(22, true)} ch, ${view.getUint32(24, true)} Hz, ` +
    `${view.getUint16(34, true)}-bit, byteRate ${view.getUint32(28, true)}, ` +
    `dataSize ${dataSize}, ChunkSize ${chunkSize} -> ` +
    `${ok ? "structurally valid" : "INVALID"}`
  );
}

function hex4(b: Uint8Array): string {
  const h = (n: number | undefined): string =>
    (n ?? 0).toString(16).padStart(2, "0");
  return `${h(b[0])} ${h(b[1])} ${h(b[2])} ${h(b[3])}`;
}

// --- Helpers ----------------------------------------------------------------

async function timed(
  run: () => Promise<HttpResponse>,
): Promise<{ ms: number; response?: HttpResponse; error?: unknown }> {
  const t0 = Date.now(); // docs/01 §2.3: no `performance` in the sandbox
  try {
    const response = await run();
    return { ms: Date.now() - t0, response };
  } catch (error) {
    return { ms: Date.now() - t0, error };
  }
}

function describeError(e: unknown): string {
  if (e instanceof HttpError) {
    return `HttpError code=${e.code} zoteroException=${e.source} message="${e.message}"`;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  const message = at(e, "message");
  return typeof message === "string"
    ? `non-Error exception: ${message}`
    : `non-Error thrown: ${String(e)}`;
}

/**
 * Replace every typed secret, then anything shaped like a Google API key or a
 * bearer credential (docs/09 §2.1's patterns, spelled with character classes
 * so a leak grep over this source file does not match the pattern itself).
 */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s !== "") out = out.split(s).join(`[redacted:${s.length}]`);
  }
  return out
    .replace(/\bAI[z]a[A-Za-z0-9_-]{30,}/g, "[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "$1 [redacted]");
}

function excerpt(text: string, max = EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max
    ? flat
    : `${flat.slice(0, max)}... (+${flat.length - max} chars)`;
}

/** `YYYYMMDD-HHMMSS` in UTC; ASCII and slash-free for a filename. */
function timestamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function keysOf(v: unknown): readonly string[] {
  return v !== null && typeof v === "object" ? Object.keys(v) : [];
}

function at(v: unknown, ...path: readonly (string | number)[]): unknown {
  let cur = v;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

// ---------------------------------------------------------------------------
// NODE-ONLY BELOW THIS LINE: the emitter. It is cut off before bundling, so
// none of it reaches the paste block.
// ---------------------------------------------------------------------------

const NODE_ONLY_MARKER = "// NODE-ONLY BELOW THIS LINE";

async function emitPasteBlock(scriptPath: string): Promise<void> {
  const { build } = await import("esbuild");
  const { readFileSync } = await import("node:fs");
  const { basename, dirname, join } = await import("node:path");

  const root = join(dirname(scriptPath), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const version = typeof pkg.version === "string" ? pkg.version : "";
  buildUserAgent(version); // fail here, not in Zotero, on a bad version

  // The first occurrence is the marker comment above; everything from there
  // on (this emitter) is dropped, so the bundle is the probe alone.
  const source = readFileSync(scriptPath, "utf8");
  const cut = source.indexOf(NODE_ONLY_MARKER);
  if (cut < 0) throw new Error("node-only marker not found");

  const result = await build({
    stdin: {
      contents: source.slice(0, cut),
      loader: "ts",
      resolveDir: dirname(scriptPath),
      sourcefile: basename(scriptPath),
    },
    absWorkingDir: root,
    bundle: true,
    format: "iife",
    globalName: "RHSpikeTtsKorean",
    platform: "browser",
    target: "firefox140",
    charset: "ascii",
    legalComments: "none",
    write: false,
    logLevel: "warning",
  });
  const js = result.outputFiles[0]?.text;
  if (js === undefined) throw new Error("esbuild produced no output");

  // `charset: "ascii"` escapes strings and identifiers but not comments; make
  // the whole block ASCII so a trip through `clip` cannot mangle it.
  const ascii = js.replace(
    /[^\t\n\r -~]/g, // anything outside printable ASCII
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  process.stdout.write(
    [
      "// research_helper P0-T25 Gemini TTS Korean probe (V-10).",
      `// Generated ${new Date().toISOString()} from scripts/spike-tts-korean.ts, version ${version}.`,
      "// Tools > Developer > Run JavaScript: paste, make sure 'Run as async function'",
      "// is checked, press Run. A password dialog asks for the Gemini key and states",
      "// the expected spend; Cancel aborts before anything is sent.",
      "// Never type the key into this editor. Nothing here needs editing.",
      `// Audio is written to ${OUTPUT_DIR} and the exact paths are printed.`,
      ascii.trimEnd(),
      "return await RHSpikeTtsKorean.main({",
      "  zotero: Zotero,",
      "  services: Services,",
      "  io: IOUtils,",
      "  paths: PathUtils,",
      '  window: typeof window !== "undefined" ? window : null,',
      '  hasAtob: typeof atob !== "undefined",',
      `  version: ${JSON.stringify(version)},`,
      "});",
      "",
    ].join("\n"),
  );
}

const nodeScriptPath = process.argv[1];
if (nodeScriptPath === undefined) {
  process.stderr.write("spike-tts-korean: cannot determine the script path\n");
  process.exitCode = 1;
} else {
  emitPasteBlock(nodeScriptPath).catch((e: unknown) => {
    process.stderr.write(`spike-tts-korean: ${String(e)}\n`);
    process.exitCode = 1;
  });
}

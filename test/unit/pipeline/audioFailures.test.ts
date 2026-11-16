/**
 * `plan/09` `P6-T14` — the audio run's failure paths
 * (`src/pipeline/audioReport/failures.ts`), layer 1: classification, the
 * Fluent variants in both bundles, the script kept before TTS, and the two
 * saves. The 403 comes from the shipped TTS client over a scripted transport;
 * no network, no key but a synthetic one.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { createManualClock, type Clock } from "../../../src/core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  OperationCancelledError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
  TTS_ERROR_REASONS,
  TTSError,
} from "../../../src/core/errors";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import type { SecretStore } from "../../../src/core/secretStore";
import { GEMINI_SECRET_ID } from "../../../src/llm/gemini/geminiProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type { TrendReport } from "../../../src/model/trend";
import {
  classifyAudioFailure,
  saveAudioAs,
  saveScriptAsText,
  scriptTextFileContent,
  scriptTextFileName,
  withAudioScript,
} from "../../../src/pipeline/audioReport/failures";
import type { ScriptRejected } from "../../../src/pipeline/audioReport/script";
import {
  concatPcm,
  GEMINI_PCM_FORMAT,
  pcmToWav,
} from "../../../src/tts/audioStore";
import { createGeminiTts } from "../../../src/tts/geminiTts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NOW = 1_800_000_000_000;
const NOTHING = { scriptAvailable: false, audioAssembled: false };
const SCRIPT_ONLY = { scriptAvailable: true, audioAssembled: false };

/** A synthetic Google-shaped key, built at run time. */
function syntheticKey(): string {
  return ["AI", "za"].join("") + "Q".repeat(35);
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

class StubZoteroException extends Error {}

/** Answers every request with `status` and `body`. */
function fixedTransport(status: number, body: string): HttpTransport {
  return {
    request(_method, url) {
      const xhr: HttpTransportXhr = {
        status,
        responseText: body,
        responseURL: url,
        getAllResponseHeaders: () => "content-type: application/json",
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

function secrets(value: string): SecretStore {
  return {
    backend: "session-only",
    unattended: true,
    get: (id) => Promise.resolve(id === GEMINI_SECRET_ID ? value : undefined),
    has: (id) => Promise.resolve(id === GEMINI_SECRET_ID),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    listStoredIds: () => Promise.resolve([GEMINI_SECRET_ID]),
    clearAll: () => Promise.resolve(0),
  };
}

/** The shipped TTS client's error for one Gemini answer. */
async function ttsErrorFor(status: number, body: string): Promise<unknown> {
  const clock: Clock = { now: () => NOW, sleep: () => Promise.resolve() };
  const tts = createGeminiTts({
    http: createHttpClient({
      transport: fixedTransport(status, body),
      userAgent: "research_helper/9.9.9 (https://example.test)",
      clock,
    }),
    secrets: secrets(syntheticKey()),
    secretId: GEMINI_SECRET_ID,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    clock: createManualClock(NOW),
  });
  return tts
    .synthesize(
      {
        text: "Tide gauges sink.",
        language: "en-US",
        voice: "Charon",
        model: "gemini-9.9-flash-tts",
        styleInstruction: "Read calmly.\n\n---\n\n",
        traceId: "t",
      },
      { token: createCancellationTokenSource().token },
    )
    .then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error,
    );
}

function geminiError(code: number, status: string, message: string): string {
  return JSON.stringify({ error: { code, message, status, details: [] } });
}

function report(overrides: Partial<TrendReport> = {}): TrendReport {
  return {
    id: "report-ko-1",
    libraryID: 1,
    collectionKey: "COLL0001",
    collectionName: "해수면 / Coastal: sea level?",
    title: "연구 동향: 해수면 (2026-11-17)",
    language: "ko",
    generatedAtEpochMs: Date.UTC(2026, 10, 17, 12),
    pluginVersion: "0.0.2",
    scope: {
      totalCount: 6,
      analysedCount: 5,
      excludedCount: 1,
      fullTextCount: 2,
      abstractCount: 3,
      yearMin: 2019,
      yearMax: 2025,
    },
    reductionPasses: 0,
    sections: [],
    clustering: { themes: [], assignments: [] },
    bibliography: [],
    retracted: [],
    excluded: [],
    summaryIds: [],
    qualityProxies: {
      citationDensity: undefined,
      coverageRatio: 1,
      brokenCitationCount: 0,
      meanGroundingScore: undefined,
      contradictionCount: 0,
      unresolvedHighSeverityCount: 0,
    },
    critique: { rounds: 0, unresolved: [], revisedAfterLastCritique: false },
    markdown: "# 보고서",
    audioScripts: { en: "An earlier English script." },
    citedItemKeys: [],
    warnings: [],
    providerId: "openrouter",
    prompts: [],
    usage: undefined,
    ...overrides,
  };
}

const KO_SCRIPT = {
  language: "ko" as const,
  text: "Testa 연구팀은 조위계 열두 개를 보정했습니다.",
};

// ---------------------------------------------------------------------------
// The Fluent variants (Done when, line 1)
// ---------------------------------------------------------------------------

/** The variant keys of `rh-error-tts` in a bundle, commented or not. */
function variantsIn(path: string): string[] {
  const text = readFileSync(resolve(repo, path), "utf8");
  const start = text.search(/^#? ?rh-error-tts = \{ \$reason ->$/mu);
  expect(start).toBeGreaterThan(-1);
  const block = text.slice(start, text.indexOf("}", start));
  return [...block.matchAll(/^#?\s*\*?\[([a-z-]+)\]/gmu)].map(
    (m) => m[1] ?? "",
  );
}

const SIX = [
  "unentitled",
  "model-gone",
  "no-audio",
  "sample-rate",
  "script-rejected",
  "rate-limited",
];

describe("rh-error-tts has one variant per reason in both bundles", () => {
  it("en-US carries the six and a default; ko-KR's commented draft the same", () => {
    const en = variantsIn("addon/locale/en-US/research-helper-mainWindow.ftl");
    const ko = variantsIn("addon/locale/ko-KR/research-helper-mainWindow.ftl");
    expect(en).toEqual([...SIX, "other"]);
    expect(ko).toEqual(en);
    expect(TTS_ERROR_REASONS.slice(0, 6)).toEqual(SIX);
  });
});

// ---------------------------------------------------------------------------
// classifyAudioFailure (Done when, line 2)
// ---------------------------------------------------------------------------

describe("classifyAudioFailure", () => {
  it("a 403 from the TTS client is unentitled, offers the script, and leaves the stored report as it was apart from audioScripts", async () => {
    const before = report();
    const store = new Map<string, TrendReport>([[before.id, before]]);
    // P6-T16 step: the validated script is stored before the first TTS request.
    store.set(before.id, withAudioScript(before, KO_SCRIPT));
    const error = await ttsErrorFor(
      403,
      geminiError(403, "PERMISSION_DENIED", "denied"),
    );
    expect(error).toBeInstanceOf(AuthorizationError);
    const failure = classifyAudioFailure(error, SCRIPT_ONLY);
    expect(failure).toMatchObject({
      reason: "unentitled",
      messageKey: "rh-error-tts",
      messageArgs: { reason: "unentitled" },
      offerScriptText: true,
      offerAudioSaveAs: false,
      cancelled: false,
    });
    expect(failure.error).not.toHaveProperty("stack");
    expect(failure.error.httpStatus).toBe(403);
    const after = store.get(before.id);
    expect({ ...after, audioScripts: undefined }).toEqual({
      ...before,
      audioScripts: undefined,
    });
    expect(after?.audioScripts).toEqual({
      en: "An earlier English script.",
      ko: KO_SCRIPT.text,
    });
  });

  it.each([
    [
      "401",
      () => new AuthenticationError(401, "HTTP 401 from gemini"),
      "unentitled",
    ],
    [
      "404",
      () => new BadRequestError(404, "HTTP 404 from gemini"),
      "model-gone",
    ],
    [
      "429 after the retries",
      () => new RateLimitError(429, 1000, "gemini"),
      "rate-limited",
    ],
    ["no audio", () => new TTSError("x", { reason: "no-audio" }), "no-audio"],
    [
      "a sample-rate change",
      () => new TTSError("x", { reason: "sample-rate" }),
      "sample-rate",
    ],
    [
      "an unsupported format",
      () => new TTSError("x", { reason: "unsupported-format" }),
      "unsupported-format",
    ],
  ] as const)("%s → %s", (_label, make, reason) => {
    const failure = classifyAudioFailure(make(), SCRIPT_ONLY);
    expect(failure.reason).toBe(reason);
    expect(failure.messageKey).toBe("rh-error-tts");
    expect(failure.messageArgs).toEqual({ reason });
    expect(failure.offerScriptText).toBe(true);
  });

  it("a rejected script is script-rejected and offers its text; no leak text is in the error", () => {
    const rejected: ScriptRejected = {
      kind: "script-rejected",
      reportId: "report-ko-1",
      language: "ko",
      leaks: ["heading", "bold"],
      text: "## 비밀 제목 **굵게**",
      usage: undefined,
      calls: 2,
    };
    const failure = classifyAudioFailure(rejected, SCRIPT_ONLY);
    expect(failure.reason).toBe("script-rejected");
    expect(failure.offerScriptText).toBe(true);
    expect(JSON.stringify(failure)).not.toContain("비밀");
  });

  it("anything else keeps its own class; an unknown throw reads the default variant", () => {
    const quota = classifyAudioFailure(
      new QuotaExceededError(429, "spend cap"),
      SCRIPT_ONLY,
    );
    expect(quota.reason).toBeUndefined();
    expect(quota.messageKey).toBe("rh-error-quota");
    expect(quota.messageArgs).toEqual({});
    const timeout = classifyAudioFailure(
      new TimeoutError(90_000, "https://generativelanguage.googleapis.com/x"),
      NOTHING,
    );
    expect(timeout.messageKey).toBe("rh-error-timeout");
    expect(timeout.offerScriptText).toBe(false);
    const plain = classifyAudioFailure(new Error("boom"), NOTHING);
    expect(plain).toMatchObject({
      reason: undefined,
      messageKey: "rh-error-tts",
      messageArgs: { reason: "other" },
    });
  });

  it("a cancellation offers nothing; an assembled run whose Zotero write failed offers Save as", () => {
    const cancelled = classifyAudioFailure(
      new OperationCancelledError({ kind: "user" }),
      { scriptAvailable: true, audioAssembled: true },
    );
    expect(cancelled).toMatchObject({
      cancelled: true,
      offerScriptText: false,
      offerAudioSaveAs: false,
    });
    const writeFailed = classifyAudioFailure(new Error("disk full"), {
      scriptAvailable: true,
      audioAssembled: true,
    });
    expect(writeFailed.offerAudioSaveAs).toBe(true);
    expect(writeFailed.offerScriptText).toBe(true);
  });

  it("TTSError.reason is one of TTS_ERROR_REASONS or undefined; an unknown reason reads the default variant", () => {
    expect(new TTSError("x", { reason: "no-audio" }).reason).toBe("no-audio");
    expect(new TTSError("x", { reason: "bogus" }).reason).toBeUndefined();
    expect(new TTSError("x").reason).toBeUndefined();
    expect(
      classifyAudioFailure(new TTSError("x", { reason: "bogus" }), NOTHING)
        .messageArgs,
    ).toEqual({ reason: "other" });
  });

  it("redacts a key an error message quotes", () => {
    const key = syntheticKey();
    const failure = classifyAudioFailure(
      new AuthorizationError(403, `key ${key} refused`),
      SCRIPT_ONLY,
    );
    expect(JSON.stringify(failure)).not.toContain(key);
    const plain = classifyAudioFailure(new Error(`bad ${key}`), NOTHING);
    expect(JSON.stringify(plain)).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// The saves (Done when, line 3)
// ---------------------------------------------------------------------------

describe("saveScriptAsText and saveAudioAs", () => {
  const dir = mkdtempSync(join(tmpdir(), "rh-p6t14-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const nodeWriter = {
    writeTextFile: (path: string, text: string): Promise<void> => {
      writeFileSync(path, text, "utf8");
      return Promise.resolve();
    },
  };

  it("writes UTF-8 with Hangul intact, a header naming the report, its language and date, and logs no path", async () => {
    const path = join(dir, "비밀-폴더-script.txt");
    const logger = capturingLogger();
    const outcome = await saveScriptAsText(path, report(), KO_SCRIPT, {
      files: nodeWriter,
      logger,
    });
    expect(outcome).toBe("saved");
    const bytes = readFileSync(path);
    const expected = `연구 동향: 해수면 (2026-11-17) · ko · 2026-11-17\n\n${KO_SCRIPT.text}\n`;
    expect(bytes.equals(Buffer.from(expected, "utf8"))).toBe(true);
    expect(bytes.toString("utf8")).toBe(expected.normalize("NFC"));
    expect(logger.lines.join("\n")).not.toContain(dir);
    expect(logger.lines.join("\n")).not.toContain("비밀");
  });

  it("writes nothing for no path, and a failed write logs neither the path nor the error", async () => {
    const logger = capturingLogger();
    expect(
      await saveScriptAsText("", report(), KO_SCRIPT, {
        files: nodeWriter,
        logger,
      }),
    ).toBe("no-path");
    const secretPath = join(dir, "secret-place", "x.txt");
    const failing = {
      writeTextFile: (): Promise<void> =>
        Promise.reject(new Error(`ENOENT ${secretPath}`)),
    };
    expect(
      await saveScriptAsText(secretPath, report(), KO_SCRIPT, {
        files: failing,
        logger,
      }),
    ).toBe("failed");
    expect(logger.lines.join("\n")).not.toContain("secret-place");
  });

  it("suggests a safe file name dated by the report", () => {
    expect(scriptTextFileName(report(), "ko")).toBe(
      "해수면 - Coastal- sea level- — spoken script 2026-11-17 (ko).txt",
    );
    expect(
      scriptTextFileContent(report(), { language: "en", text: "  Hi.  " }),
    ).toBe("연구 동향: 해수면 (2026-11-17) · en · 2026-11-17\n\nHi.\n");
  });

  it("saveAudioAs writes the held chunks as one WAV, joined as the store joins them", async () => {
    const chunks = [
      { pcm: new Uint8Array([1, 0, 2, 0]), sampleRateHz: 24000 },
      { pcm: new Uint8Array([3, 0]), sampleRateHz: 24000 },
    ];
    const written: { path: string; bytes: Uint8Array }[] = [];
    const logger = capturingLogger();
    const outcome = await saveAudioAs(
      join(dir, "audio.wav"),
      { chunks, sampleRateHz: 24000 },
      {
        files: {
          writeFile: (path, bytes) => {
            written.push({ path, bytes });
            return Promise.resolve();
          },
        },
        logger,
        reportId: "report-ko-1",
      },
    );
    expect(outcome).toBe("saved");
    expect(written).toHaveLength(1);
    expect(written[0]?.bytes).toEqual(
      pcmToWav(
        concatPcm(chunks, { format: GEMINI_PCM_FORMAT }),
        GEMINI_PCM_FORMAT,
      ),
    );
    expect(logger.lines.join("\n")).not.toContain(dir);
    const failed = await saveAudioAs(
      join(dir, "x.wav"),
      { chunks, sampleRateHz: 24000 },
      {
        files: { writeFile: () => Promise.reject(new Error("EACCES")) },
        logger,
        reportId: "r",
      },
    );
    expect(failed).toBe("failed");
    expect(
      await saveAudioAs(
        "",
        { chunks, sampleRateHz: 24000 },
        {
          files: { writeFile: () => Promise.resolve() },
          logger,
          reportId: "r",
        },
      ),
    ).toBe("no-path");
  });
});

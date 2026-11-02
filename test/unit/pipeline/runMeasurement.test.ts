/**
 * `src/pipeline/trendReport/runMeasurement.ts`: the recording router and the
 * size measure (`plan/07` `P4-T23` step 4's data source; `docs/07` §5.2's note of
 * 2026-11-02). Whole runs through the real pipeline are in `trendKorean.test.ts`.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no network, no key, no model.
 */

import { describe, expect, it } from "vitest";

import { redactRecord } from "../../../src/core/provenance";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { completeJSON } from "../../../src/llm/shared/jsonMode";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMCallContext,
  LLMRouter,
  Usage,
} from "../../../src/llm/types";
import type { ThemeAnalysis } from "../../../src/model/trend";
import {
  createRunCallRecorder,
  runMeasurementOf,
  themeAnalysisSize,
  UNLABELLED_CALL,
} from "../../../src/pipeline/trendReport/runMeasurement";
import { REPORT_VERBATIM_KEYS } from "../../../src/zotero/db";

const MARKER = "MARKER-CONTENT-7f3a";

const USAGE: Usage = {
  inputTokens: 11,
  outputTokens: 22,
  totalTokens: 33,
  costUsd: 0.5,
  reasoningTokens: 4,
};

const CTX: LLMCallContext = { token: createCancellationTokenSource().token };

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: `model-${MARKER}`,
    messages: [{ role: "user", content: `prompt ${MARKER}` }],
    maxOutputTokens: 100,
    traceId: `trace-${MARKER}`,
    accounting: { promptId: "THEME_CLUSTER", papers: 9 },
    ...overrides,
  };
}

function answer(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    text: `answer ${MARKER}`,
    json: { marker: MARKER },
    model: `served-${MARKER}`,
    finishReason: "stop",
    usage: USAGE,
    servedBy: `route-${MARKER}`,
    latencyMs: 1,
    raw: { marker: MARKER },
    ...overrides,
  };
}

interface Scripted {
  readonly chat?: () => Promise<ChatResponse>;
  readonly chunks?: () => AsyncIterable<ChatStreamChunk>;
}

function router(scripted: Scripted = {}): LLMRouter {
  return {
    activeProvider: () => "openrouter",
    resolveModel: () => ({
      providerId: "openrouter",
      modelId: "the-model",
      fromPref: "reportModel",
    }),
    chat: scripted.chat ?? (() => Promise.resolve(answer())),
    chatStream: () =>
      (
        scripted.chunks ??
        async function* (): AsyncGenerator<ChatStreamChunk> {
          await Promise.resolve();
          yield { deltaText: "a", done: false };
          yield { deltaText: `b ${MARKER}`, done: false };
          yield { deltaText: "", done: true, usage: USAGE };
        }
      )(),
  };
}

async function drain(
  stream: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const ENTRY = {
  promptId: "THEME_CLUSTER",
  inputTokens: 11,
  outputTokens: 22,
  totalTokens: 33,
  reasoningTokens: 4,
  costUsd: 0.5,
  maxOutputTokens: 100,
  papers: 9,
};

describe("the recording router", () => {
  it("writes down exactly the call's numbers and label from a chat", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm().chat(request(), CTX);
    expect(recorder.calls()).toStrictEqual([ENTRY]);
  });

  it("writes down the terminal chunk of a stream, once", async () => {
    const recorder = createRunCallRecorder(router());
    const chunks = await drain(recorder.llm().chatStream(request(), CTX));
    expect(chunks).toHaveLength(3);
    expect(recorder.calls()).toStrictEqual([ENTRY]);
  });

  it("hands the stage the answer and every chunk as they arrived", async () => {
    const inner = answer();
    const recorder = createRunCallRecorder(
      router({ chat: () => Promise.resolve(inner) }),
    );
    expect(await recorder.llm().chat(request(), CTX)).toBe(inner);
    const chunks = await drain(recorder.llm().chatStream(request(), CTX));
    expect(chunks.map((c) => c.deltaText)).toEqual(["a", `b ${MARKER}`, ""]);
    expect(chunks.at(-1)?.usage).toBe(USAGE);
  });

  it("leaves the provider and the model to the wrapped router", () => {
    const llm = createRunCallRecorder(router()).llm();
    expect(llm.activeProvider()).toBe("openrouter");
    expect(llm.resolveModel("strong").modelId).toBe("the-model");
  });

  it("marks a report's own calls and leaves a shared one unmarked", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm().chat(request(), CTX);
    await recorder.llm("en").chat(request(), CTX);
    await drain(recorder.llm("ko").chatStream(request(), CTX));
    const calls = recorder.calls();
    expect(calls[0]).not.toHaveProperty("language");
    expect(calls[1]?.language).toBe("en");
    expect(calls[2]?.language).toBe("ko");
  });

  it("keeps a figure the provider did not report absent, never 0", async () => {
    const recorder = createRunCallRecorder(
      router({
        chat: () =>
          Promise.resolve(
            answer({
              usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
                costUsd: undefined,
              },
            }),
          ),
      }),
    );
    await recorder.llm().chat(request(), CTX);
    expect(recorder.calls()).toStrictEqual([
      { promptId: "THEME_CLUSTER", maxOutputTokens: 100, papers: 9 },
    ]);
  });

  it("keeps a reported 0 as 0", async () => {
    const recorder = createRunCallRecorder(
      router({
        chat: () =>
          Promise.resolve(
            answer({
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                costUsd: 0,
                reasoningTokens: 0,
              },
            }),
          ),
      }),
    );
    await recorder.llm().chat(request({ maxOutputTokens: 0 }), CTX);
    expect(recorder.calls()).toStrictEqual([
      {
        promptId: "THEME_CLUSTER",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        maxOutputTokens: 0,
        papers: 9,
      },
    ]);
  });

  it("counts a stream's terminal chunk that carries no usage as a call with no figures", async () => {
    const recorder = createRunCallRecorder(
      router({
        chunks: async function* () {
          await Promise.resolve();
          yield { deltaText: "", done: true };
        },
      }),
    );
    await drain(recorder.llm().chatStream(request(), CTX));
    expect(recorder.calls()).toStrictEqual([
      { promptId: "THEME_CLUSTER", maxOutputTokens: 100, papers: 9 },
    ]);
  });

  it("names a call with no label as unlabelled, and no ceiling as none", async () => {
    const recorder = createRunCallRecorder(router());
    const { accounting: _a, maxOutputTokens: _m, ...bare } = request();
    await recorder.llm().chat(bare, CTX);
    expect(recorder.calls()[0]?.promptId).toBe(UNLABELLED_CALL);
    expect(recorder.calls()[0]).not.toHaveProperty("maxOutputTokens");
    expect(recorder.calls()[0]).not.toHaveProperty("papers");
  });

  it("leaves no entry for a call that threw, in either form", async () => {
    const recorder = createRunCallRecorder(
      router({
        chat: () => Promise.reject(new Error("no")),
        chunks: async function* () {
          await Promise.resolve();
          yield { deltaText: "partly", done: false };
          throw new Error("cut off");
        },
      }),
    );
    await expect(recorder.llm().chat(request(), CTX)).rejects.toThrow("no");
    await expect(
      drain(recorder.llm().chatStream(request(), CTX)),
    ).rejects.toThrow("cut off");
    expect(recorder.calls()).toEqual([]);
  });

  it("hands out a copy, so a reader cannot change the run's list", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm().chat(request(), CTX);
    (recorder.calls() as unknown[]).length = 0;
    expect(recorder.calls()).toHaveLength(1);
  });

  it("one list across every router of the run, in answer order", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm().chat(request(), CTX);
    await recorder.llm("ko").chat(request(), CTX);
    await recorder.llm().chat(request(), CTX);
    expect(recorder.calls().map((c) => c.language)).toEqual([
      undefined,
      "ko",
      undefined,
    ]);
  });
});

describe("no content reaches the entry", () => {
  it("nothing of the request or the answer but numbers and the label", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm("en").chat(request(), CTX);
    await drain(recorder.llm("en").chatStream(request(), CTX));
    const stored = JSON.stringify(recorder.calls());
    expect(stored).not.toContain(MARKER);
    expect(stored).not.toContain("hello");
    for (const call of recorder.calls()) {
      for (const [name, value] of Object.entries(call)) {
        if (name === "promptId") expect(value).toBe("THEME_CLUSTER");
        else if (name === "language") expect(value).toBe("en");
        else expect(typeof value).toBe("number");
      }
    }
  });

  it("the size carries no text either", () => {
    const size = themeAnalysisSize(
      {
        themeId: "T1",
        name: MARKER,
        narrative: MARKER,
        trajectory: MARKER,
      } as unknown as ThemeAnalysis,
      3,
    );
    expect(JSON.stringify(size)).not.toContain(MARKER);
  });
});

describe("through the one gate", () => {
  it("redactRecord changes nothing and marks nothing, every *Tokens member kept", async () => {
    const recorder = createRunCallRecorder(router());
    await recorder.llm("ko").chat(request(), CTX);
    const measurement = runMeasurementOf(
      recorder.calls(),
      [{ tokens: 5, narrativeTokens: 2, papers: 3 }],
      true,
    );
    const gated = redactRecord(
      { runMeasurement: measurement },
      { verbatimKeys: REPORT_VERBATIM_KEYS },
    );
    expect(gated.record.runMeasurement).toStrictEqual(measurement);
    expect(gated.mark.partlyRedacted).toBe(false);
  });
});

describe("the structured path's every request is labelled and counted", () => {
  const SCHEMA = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };

  function structured(): ChatRequest & {
    readonly responseFormat: {
      readonly kind: "json_schema";
      readonly name: string;
      readonly schema: object;
    };
  } {
    return request({
      temperature: 0.2,
      accounting: { promptId: "CLUSTER_REDUCE" },
      responseFormat: { kind: "json_schema", name: "S", schema: SCHEMA },
    }) as ReturnType<typeof structured>;
  }

  it("a repair call carries the original's label, so it is counted under its prompt", async () => {
    const texts = ["{ not json", '{"ok":true}'];
    const recorder = createRunCallRecorder(
      router({
        chat: () =>
          Promise.resolve(
            answer({ text: texts.shift() as string, json: undefined }),
          ),
      }),
    );
    await completeJSON(recorder.llm(), structured(), CTX, {
      includeBodies: false,
    });
    expect(recorder.calls().map((c) => c.promptId)).toEqual([
      "CLUSTER_REDUCE",
      "CLUSTER_REDUCE",
    ]);
  });
});

describe("a theme analysis's size", () => {
  const ANALYSIS = {
    themeId: "T1",
    name: "A theme",
    narrative: "Some narrative text of a certain length for the estimate.",
    representativePapers: [],
    trajectory: "flat",
  } as unknown as ThemeAnalysis;

  it("is the raw estimate of the whole as JSON, and of its narrative", () => {
    expect(themeAnalysisSize(ANALYSIS, 7)).toStrictEqual({
      tokens: estTokens(JSON.stringify(ANALYSIS)),
      narrativeTokens: estTokens(ANALYSIS.narrative),
      papers: 7,
    });
    expect(estTokens(JSON.stringify(ANALYSIS))).toBeGreaterThan(
      estTokens(ANALYSIS.narrative),
    );
  });
});

describe("the run's measurement", () => {
  it("says resumed only on a resumed job", () => {
    const fresh = runMeasurementOf([], [], false);
    expect(fresh).toStrictEqual({ calls: [], themeAnalyses: [] });
    expect(runMeasurementOf([], [], true).resumed).toBe(true);
  });
});
